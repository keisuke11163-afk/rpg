import type { z } from "zod";
import { type AilmentDef, ailmentSchema } from "./ailment.ts";
import {
  type EffectDef,
  MORE_ALLOWED_ORIGINS,
  MORE_REDUCTION_ONLY_ORIGINS,
  effectSchema,
} from "./effect.ts";
import { KNOWN_HOOKS, SKILL_HOOK_PARAMS } from "./hooks.ts";
import {
  type GaugeDef,
  type JobDef,
  type SkillDef,
  type SkillMods,
  gaugeSchema,
  jobSchema,
  skillSchema,
} from "./job.ts";
import { conversionAllowed } from "./elements.ts";
import { FLAG_TARGET_CATEGORY } from "./registries.ts";
import { type Manifest, SUPPORTED_SCHEMA_VERSION, manifestSchema } from "./manifest.ts";
import { type StatDef, statSchema } from "./stat.ts";
import { ALLOWED_PARENT_CATEGORY, type TagDef, tagSchema } from "./tag.ts";

/** データのファイル1つ分（コレクションの要素の配列）。 */
export interface RawSource {
  /** エラーの表示に使うファイルの場所（例：data/tags/forms.json） */
  readonly file: string;
  readonly entries: readonly unknown[];
}

/** 読み込む前のデータ一式。 */
export interface RawContent {
  readonly manifest: { readonly file: string; readonly value: unknown };
  readonly texts: Readonly<Record<string, string>>;
  readonly collections: {
    readonly tags: readonly RawSource[];
    readonly stats: readonly RawSource[];
    readonly effects: readonly RawSource[];
    /** 状態異常の定義（省略すると無し）。 */
    readonly ailments?: readonly RawSource[];
    /** 技・職能ゲージ・ジョブの定義（省略すると無し）。 */
    readonly skills?: readonly RawSource[];
    readonly gauges?: readonly RawSource[];
    readonly jobs?: readonly RawSource[];
  };
}

export type ContentErrorCode =
  | "schema" // 形・値の範囲の誤り
  | "schema-version" // データの形の版が合わない
  | "duplicate-id" // IDの重複（全てのコレクションを通して）
  | "unknown-ref" // 存在しないIDの参照
  | "unknown-text" // 存在しない文章のキー
  | "unknown-hook" // 登録されていないルールフック
  | "forbidden-more" // 乗算を持てない出どころの乗算（仕様書v0.2 2.4）
  | "override-conflict" // 同じ能力値・同じ優先度の上書き（仕様書v0.2 2.4.1）
  | "bad-parent" // 親タグの分類が正しくない
  | "cycle"; // 親タグの循環

export interface ContentError {
  readonly code: ContentErrorCode;
  readonly file: string;
  readonly id?: string;
  /** データの中の場所（例：modifiers.0.value） */
  readonly path?: string;
  readonly message: string;
}

/** 仮値の印が付いたデータ（MVP実装単位 2.1）。 */
export interface ProvisionalEntry {
  readonly collection: string;
  readonly id: string;
  readonly file: string;
  readonly note?: string;
}

/** 検証を通ったデータ一式。 */
export interface ContentDb {
  readonly manifest: Manifest;
  readonly texts: Readonly<Record<string, string>>;
  readonly tags: ReadonlyMap<string, TagDef>;
  readonly stats: ReadonlyMap<string, StatDef>;
  readonly effects: ReadonlyMap<string, EffectDef>;
  readonly ailments: ReadonlyMap<string, AilmentDef>;
  /** 状態異常のタグのID → 定義。 */
  readonly ailmentsByTag: ReadonlyMap<string, AilmentDef>;
  readonly skills: ReadonlyMap<string, SkillDef>;
  readonly gauges: ReadonlyMap<string, GaugeDef>;
  readonly jobs: ReadonlyMap<string, JobDef>;
}

export type LoadResult =
  | {
      readonly ok: true;
      readonly content: ContentDb;
      readonly provisional: readonly ProvisionalEntry[];
    }
  | { readonly ok: false; readonly errors: readonly ContentError[] };

interface Located<T> {
  readonly value: T;
  readonly file: string;
}

function issuePath(path: readonly PropertyKey[]): string {
  return path.map((p) => String(p)).join(".");
}

function entryId(entry: unknown): string | undefined {
  if (typeof entry === "object" && entry !== null && "id" in entry) {
    const id = entry.id;
    return typeof id === "string" ? id : undefined;
  }
  return undefined;
}

/**
 * データ一式を読み込み、検証する（開発計画書 工程F-2）。
 * 誤りは途中で止めずに全て集めて返す。
 */
export interface LoadOptions {
  /** 登録されているルールフックの名前（省略すると KNOWN_HOOKS）。 */
  readonly knownHooks?: ReadonlySet<string>;
}

export function loadContent(raw: RawContent, options: LoadOptions = {}): LoadResult {
  const knownHooks = options.knownHooks ?? KNOWN_HOOKS;
  const errors: ContentError[] = [];
  const err = (e: ContentError): void => {
    errors.push(e);
  };

  // 1. データの形の版
  const manifestResult = manifestSchema.safeParse(raw.manifest.value);
  let manifest: Manifest | undefined;
  if (!manifestResult.success) {
    for (const issue of manifestResult.error.issues) {
      err({
        code: "schema",
        file: raw.manifest.file,
        path: issuePath(issue.path),
        message: issue.message,
      });
    }
  } else if (manifestResult.data.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    err({
      code: "schema-version",
      file: raw.manifest.file,
      message: `データの形の版 ${String(manifestResult.data.schemaVersion)} は読めない（このコードは ${String(SUPPORTED_SCHEMA_VERSION)}）`,
    });
  } else {
    manifest = manifestResult.data;
  }

  // 2. 形の検証。形が誤っていてもIDが読める要素は「存在するが誤り」として記録し、
  //    それを参照する側で、同じ原因の誤り（存在しないIDの参照）を重ねて出さないようにする
  const invalidIds = new Set<string>();
  function parseAll<S extends z.ZodType>(
    sources: readonly RawSource[],
    schema: S,
  ): Located<z.infer<S>>[] {
    const out: Located<z.infer<S>>[] = [];
    for (const source of sources) {
      source.entries.forEach((entry, index) => {
        const result = schema.safeParse(entry);
        if (result.success) {
          out.push({ value: result.data, file: source.file });
        } else {
          const id = entryId(entry);
          if (id !== undefined) invalidIds.add(id);
          for (const issue of result.error.issues) {
            err({
              code: "schema",
              file: source.file,
              ...(id === undefined ? {} : { id }),
              path: `[${String(index)}]${issue.path.length > 0 ? "." : ""}${issuePath(issue.path)}`,
              message: issue.message,
            });
          }
        }
      });
    }
    return out;
  }
  const tags = parseAll(raw.collections.tags, tagSchema);
  const stats = parseAll(raw.collections.stats, statSchema);
  const effects = parseAll(raw.collections.effects, effectSchema);
  const ailments = parseAll(raw.collections.ailments ?? [], ailmentSchema);
  const skills = parseAll(raw.collections.skills ?? [], skillSchema);
  const gauges = parseAll(raw.collections.gauges ?? [], gaugeSchema);
  const jobs = parseAll(raw.collections.jobs ?? [], jobSchema);

  // 3. IDの重複（全てのコレクションを通して）
  const seen = new Map<string, string>();
  const all: Located<{ id: string }>[] = [
    ...tags,
    ...stats,
    ...effects,
    ...ailments,
    ...skills,
    ...gauges,
    ...jobs,
  ];
  for (const { value, file } of all) {
    const prev = seen.get(value.id);
    if (prev !== undefined) {
      err({
        code: "duplicate-id",
        file,
        id: value.id,
        message: `ID ${value.id} が重複している（最初の定義：${prev}）`,
      });
    } else {
      seen.set(value.id, file);
    }
  }

  const tagMap = new Map(tags.map((t) => [t.value.id, t.value]));
  const statMap = new Map(stats.map((s) => [s.value.id, s.value]));
  const effectMap = new Map(effects.map((e) => [e.value.id, e.value]));

  const checkText = (key: string, file: string, id: string): void => {
    if (!(key in raw.texts))
      err({ code: "unknown-text", file, id, path: "text", message: `文章のキー ${key} がない` });
  };

  // 4. タグ：文章・親タグ・循環
  for (const { value: tag, file } of tags) {
    checkText(tag.text, file, tag.id);
    for (const parentId of tag.parents ?? []) {
      const parent = tagMap.get(parentId);
      if (parent === undefined) {
        if (invalidIds.has(parentId)) continue; // 参照先の誤りとして既に報告済み
        err({
          code: "unknown-ref",
          file,
          id: tag.id,
          path: "parents",
          message: `親タグ ${parentId} がない`,
        });
      } else if (ALLOWED_PARENT_CATEGORY[tag.category] !== parent.category) {
        err({
          code: "bad-parent",
          file,
          id: tag.id,
          path: "parents",
          message: `分類 ${tag.category} のタグは、分類 ${parent.category} のタグ（${parentId}）を親にできない`,
        });
      }
    }
  }
  for (const { value: tag, file } of tags) {
    const stack = [...(tag.parents ?? [])];
    const visited = new Set<string>();
    while (stack.length > 0) {
      const current = stack.pop() as string;
      if (current === tag.id) {
        err({
          code: "cycle",
          file,
          id: tag.id,
          path: "parents",
          message: `親タグをたどると ${tag.id} 自身に戻る`,
        });
        break;
      }
      if (visited.has(current)) continue;
      visited.add(current);
      stack.push(...(tagMap.get(current)?.parents ?? []));
    }
  }

  // 5. 能力値：文章
  for (const { value: stat, file } of stats) checkText(stat.text, file, stat.id);

  // 6. 効果：参照・乗算の出どころ・フック
  const overrides = new Map<string, { effectId: string; file: string; path: string }>();
  for (const { value: effect, file } of effects) {
    effect.modifiers.forEach((mod, index) => {
      const at = `modifiers.${String(index)}`;
      const refTag = (tagId: string, where: string): void => {
        if (!tagMap.has(tagId) && !invalidIds.has(tagId)) {
          err({
            code: "unknown-ref",
            file,
            id: effect.id,
            path: `${at}.${where}`,
            message: `タグ ${tagId} がない`,
          });
        }
      };
      for (const t of mod.filter?.allOf ?? []) refTag(t, "filter.allOf");
      for (const t of mod.filter?.anyOf ?? []) refTag(t, "filter.anyOf");
      for (const t of mod.filter?.noneOf ?? []) refTag(t, "filter.noneOf");

      if ("stat" in mod && !statMap.has(mod.stat) && !invalidIds.has(mod.stat)) {
        err({
          code: "unknown-ref",
          file,
          id: effect.id,
          path: `${at}.stat`,
          message: `能力値 ${mod.stat} がない`,
        });
      }

      if (mod.kind === "more") {
        const allowed =
          MORE_ALLOWED_ORIGINS.has(effect.origin) ||
          (MORE_REDUCTION_ONLY_ORIGINS.has(effect.origin) && mod.value < 1);
        if (!allowed) {
          err({
            code: "forbidden-more",
            file,
            id: effect.id,
            path: `${at}.value`,
            message: MORE_REDUCTION_ONLY_ORIGINS.has(effect.origin)
              ? `出どころ ${effect.origin} は、減らす方向（1未満）の乗算しか持てない（仕様書v0.2 2.4）`
              : `出どころ ${effect.origin} は乗算を持てない（仕様書v0.2 2.4）`,
          });
        }
      }

      if (mod.kind === "replace" && !knownHooks.has(mod.hook)) {
        err({
          code: "unknown-hook",
          file,
          id: effect.id,
          path: `${at}.hook`,
          message: `置き換えの挙動 ${mod.hook} は、ルールフックとして登録されていない`,
        });
      }

      if (mod.kind === "flag") {
        const need = FLAG_TARGET_CATEGORY[mod.flag];
        if (need === undefined && mod.target !== undefined) {
          err({
            code: "schema",
            file,
            id: effect.id,
            path: `${at}.target`,
            message: `印 ${mod.flag} は対象を持たない`,
          });
        } else if (need !== undefined) {
          const target = mod.target === undefined ? undefined : tagMap.get(mod.target);
          if (mod.target === undefined) {
            err({
              code: "schema",
              file,
              id: effect.id,
              path: `${at}.target`,
              message: `印 ${mod.flag} には対象（${need}のタグ）が必要`,
            });
          } else if (target === undefined) {
            if (!invalidIds.has(mod.target)) {
              err({
                code: "unknown-ref",
                file,
                id: effect.id,
                path: `${at}.target`,
                message: `タグ ${mod.target} がない`,
              });
            }
          } else if (target.category !== need) {
            err({
              code: "schema",
              file,
              id: effect.id,
              path: `${at}.target`,
              message: `印 ${mod.flag} の対象は${need}のタグ（${mod.target} は ${target.category}）`,
            });
          }
        }
      }

      if (mod.kind === "behavior" && !knownHooks.has(mod.hook)) {
        err({
          code: "unknown-hook",
          file,
          id: effect.id,
          path: `${at}.hook`,
          message: `ルールフック ${mod.hook} は登録されていない`,
        });
      }

      if (mod.kind === "override") {
        const key = `${mod.stat}@${String(mod.priority)}`;
        const prev = overrides.get(key);
        // 同じ効果の中の重複も、ほかの効果との重複と同じく誤りにする（どちらが勝つか決められない）
        if (prev !== undefined) {
          const where =
            prev.effectId === effect.id
              ? `同じ効果の ${prev.path}`
              : `${prev.effectId} の ${prev.path}（${prev.file}）`;
          err({
            code: "override-conflict",
            file,
            id: effect.id,
            path: `${at}.priority`,
            message: `能力値 ${mod.stat} を、同じ優先度 ${String(mod.priority)} で上書きする修正値がほかにある（${where}）。仕様書v0.2 2.4.1`,
          });
        } else {
          overrides.set(key, { effectId: effect.id, file, path: at });
        }
      }

      if (mod.kind === "convert" && mod.from !== mod.to && !conversionAllowed(mod.from, mod.to)) {
        err({
          code: "schema",
          file,
          id: effect.id,
          path: at,
          message:
            mod.from === "holy"
              ? "聖から他の属性への変換はできない（仕様書 2.5）"
              : `変換は上流から下流へだけ（物理→雷→氷→火→闇。仕様書 2.5）：${mod.from} → ${mod.to} はできない`,
        });
      }

      if (mod.kind === "convert" && mod.from === mod.to) {
        err({
          code: "schema",
          file,
          id: effect.id,
          path: at,
          message: "同じ属性への変換はできない",
        });
      }
    });

    // 条件の参照
    (effect.conditions ?? []).forEach((cond, index) => {
      const at = `conditions.${String(index)}`;
      if (cond.type === "statAtLeast" && !statMap.has(cond.stat) && !invalidIds.has(cond.stat)) {
        err({
          code: "unknown-ref",
          file,
          id: effect.id,
          path: `${at}.stat`,
          message: `能力値 ${cond.stat} がない`,
        });
      }
      if (cond.type === "equippedTag" && !tagMap.has(cond.tag) && !invalidIds.has(cond.tag)) {
        err({
          code: "unknown-ref",
          file,
          id: effect.id,
          path: `${at}.tag`,
          message: `タグ ${cond.tag} がない`,
        });
      }
      if (cond.type === "mainJob") {
        const job = tagMap.get(cond.job);
        if (job === undefined) {
          if (!invalidIds.has(cond.job)) {
            err({
              code: "unknown-ref",
              file,
              id: effect.id,
              path: `${at}.job`,
              message: `タグ ${cond.job} がない`,
            });
          }
        } else if (job.category !== "job") {
          err({
            code: "schema",
            file,
            id: effect.id,
            path: `${at}.job`,
            message: `${cond.job} はジョブのタグではない`,
          });
        }
      }
    });
  }

  // 7. 状態異常：タグの参照と、1つのタグに1つの定義
  const ailmentsByTag = new Map<string, AilmentDef>();
  for (const { value: ailment, file } of ailments) {
    const tag = tagMap.get(ailment.tag);
    if (tag === undefined) {
      if (!invalidIds.has(ailment.tag)) {
        err({
          code: "unknown-ref",
          file,
          id: ailment.id,
          path: "tag",
          message: `タグ ${ailment.tag} がない`,
        });
      }
    } else if (tag.category !== "ailment") {
      err({
        code: "schema",
        file,
        id: ailment.id,
        path: "tag",
        message: `${ailment.tag} は状態異常のタグではない`,
      });
    } else if (ailmentsByTag.has(ailment.tag)) {
      err({
        code: "duplicate-id",
        file,
        id: ailment.id,
        path: "tag",
        message: `状態異常のタグ ${ailment.tag} の定義が2つある`,
      });
    } else {
      ailmentsByTag.set(ailment.tag, ailment);
    }
  }

  // 8. 技・職能ゲージ・ジョブ
  const gaugeMap = new Map(gauges.map((g) => [g.value.id, g.value]));
  const skillMap = new Map(skills.map((s) => [s.value.id, s.value]));
  const jobMap = new Map(jobs.map((j) => [j.value.id, j.value]));
  const refCheck = (
    map: ReadonlyMap<string, unknown>,
    what: string,
    ref: string,
    file: string,
    id: string,
    path: string,
  ): boolean => {
    if (map.has(ref)) return true;
    if (!invalidIds.has(ref))
      err({ code: "unknown-ref", file, id, path, message: `${what} ${ref} がない` });
    return false;
  };
  const tagOf = (
    ref: string,
    categories: readonly string[] | undefined,
    file: string,
    id: string,
    path: string,
  ): void => {
    if (!refCheck(tagMap, "タグ", ref, file, id, path) || categories === undefined) return;
    const t = tagMap.get(ref);
    if (t !== undefined && !categories.includes(t.category))
      err({
        code: "schema",
        file,
        id,
        path,
        message: `${ref} は分類 ${categories.join("・")} のタグではない（${t.category}）`,
      });
  };
  const checkMods = (mods: SkillMods, file: string, id: string, path: string): void => {
    for (const tagId of Object.keys(mods.ailmentChance ?? {}))
      tagOf(tagId, ["ailment"], file, id, `${path}.ailmentChance`);
    (mods.behaviors ?? []).forEach((b, i) => {
      const at = `${path}.behaviors.${String(i)}`;
      if (!knownHooks.has(b.hook)) {
        err({
          code: "unknown-hook",
          file,
          id,
          path: `${at}.hook`,
          message: `ルールフック ${b.hook} は登録されていない`,
        });
        return;
      }
      const need = (SKILL_HOOK_PARAMS as Partial<Record<string, readonly string[]>>)[b.hook] ?? [];
      for (const name of need) {
        if (b.params?.[name] === undefined)
          err({
            code: "schema",
            file,
            id,
            path: `${at}.params`,
            message: `ルールフック ${b.hook} にはパラメータ ${name} が必要`,
          });
      }
    });
  };

  for (const { value: gauge, file } of gauges) {
    checkText(gauge.text, file, gauge.id);
    gauge.stages.forEach((st, i) => {
      if (!(st.text in raw.texts))
        err({
          code: "unknown-text",
          file,
          id: gauge.id,
          path: `stages.${String(i)}.text`,
          message: `文章のキー ${st.text} がない`,
        });
      if (st.min > gauge.max)
        err({
          code: "schema",
          file,
          id: gauge.id,
          path: `stages.${String(i)}.min`,
          message: `段階 ${st.id} の値 ${String(st.min)} が、ゲージの最大 ${String(gauge.max)} を超える`,
        });
    });
    gauge.gains.forEach((g, i) => {
      if (g.on === "hitDealt" && g.tag !== undefined)
        tagOf(g.tag, undefined, file, gauge.id, `gains.${String(i)}.tag`);
    });
  }

  /** 技 → それを持つジョブの職能ゲージ（段階の名前の確認に使う）。 */
  const skillGauge = new Map<string, GaugeDef>();
  for (const { value: job, file } of jobs) {
    checkText(job.text, file, job.id);
    tagOf(job.tag, ["job"], file, job.id, "tag");
    const gauge =
      job.gauge === undefined
        ? undefined
        : refCheck(gaugeMap, "職能ゲージ", job.gauge, file, job.id, "gauge")
          ? gaugeMap.get(job.gauge)
          : undefined;
    job.skills.forEach((entry, i) => {
      if (refCheck(skillMap, "技", entry.skill, file, job.id, `skills.${String(i)}.skill`)) {
        const skill = skillMap.get(entry.skill);
        if (skill?.job !== undefined && skill.job !== job.id)
          err({
            code: "schema",
            file,
            id: job.id,
            path: `skills.${String(i)}.skill`,
            message: `技 ${entry.skill} は、ジョブ ${skill.job} の技`,
          });
        if (gauge !== undefined) skillGauge.set(entry.skill, gauge);
      }
    });
    for (const tagId of Object.keys(job.affinity))
      tagOf(tagId, ["weapon"], file, job.id, "affinity");
  }

  for (const { value: skill, file } of skills) {
    checkText(skill.text, file, skill.id);
    if (skill.job !== undefined) refCheck(jobMap, "ジョブ", skill.job, file, skill.id, "job");
    skill.tags.forEach((t, i) => {
      tagOf(t, undefined, file, skill.id, `tags.${String(i)}`);
    });
    for (const tagId of Object.keys(skill.ailmentChance ?? {}))
      tagOf(tagId, ["ailment"], file, skill.id, "ailmentChance");
    if (skill.kind === "spell" && skill.base === undefined)
      err({
        code: "schema",
        file,
        id: skill.id,
        path: "base",
        message: "呪文には基礎値（base）が必要",
      });
    if (skill.action.type === "warcry") {
      const action = skill.action;
      action.allyEffects.forEach((e, i) => {
        refCheck(effectMap, "効果", e, file, skill.id, `action.allyEffects.${String(i)}`);
      });
      (action.enemyEffects ?? []).forEach((e, i) => {
        refCheck(effectMap, "効果", e, file, skill.id, `action.enemyEffects.${String(i)}`);
      });
    }
    (skill.selfEffects ?? []).forEach((e, i) => {
      refCheck(effectMap, "効果", e.effect, file, skill.id, `selfEffects.${String(i)}.effect`);
    });
    const gauge = skillGauge.get(skill.id);
    (skill.stageVariants ?? []).forEach((v, i) => {
      const at = `stageVariants.${String(i)}`;
      if (gauge === undefined || !gauge.stages.some((st) => st.id === v.stage))
        err({
          code: "unknown-ref",
          file,
          id: skill.id,
          path: `${at}.stage`,
          message:
            gauge === undefined
              ? `段階 ${v.stage} の変化があるが、この技を持つジョブに職能ゲージがない`
              : `職能ゲージ ${gauge.id} に段階 ${v.stage} がない`,
        });
      checkMods(v.mods, file, skill.id, `${at}.mods`);
    });
    (skill.weaponVariants ?? []).forEach((v, i) => {
      const at = `weaponVariants.${String(i)}`;
      tagOf(v.weaponTag, ["weapon", "weaponGroup"], file, skill.id, `${at}.weaponTag`);
      checkMods(v.mods, file, skill.id, `${at}.mods`);
    });
    if (skill.dualWieldVariant !== undefined)
      checkMods(skill.dualWieldVariant, file, skill.id, "dualWieldVariant");
  }

  if (errors.length > 0 || manifest === undefined) return { ok: false, errors };

  // 9. 仮値の一覧
  const provisional: ProvisionalEntry[] = [];
  const collect = (
    collection: string,
    list: readonly Located<{
      id: string;
      provisional?: boolean | undefined;
      provisionalNote?: string | undefined;
    }>[],
  ): void => {
    for (const { value, file } of list) {
      if (value.provisional === true) {
        provisional.push({
          collection,
          id: value.id,
          file,
          ...(value.provisionalNote === undefined ? {} : { note: value.provisionalNote }),
        });
      }
    }
  };
  collect("tags", tags);
  collect("stats", stats);
  collect("effects", effects);
  collect("ailments", ailments);
  collect("skills", skills);
  collect("gauges", gauges);
  collect("jobs", jobs);

  return {
    ok: true,
    content: {
      manifest,
      texts: raw.texts,
      tags: tagMap,
      stats: statMap,
      effects: effectMap,
      ailments: new Map(ailments.map((a) => [a.value.id, a.value])),
      ailmentsByTag,
      skills: skillMap,
      gauges: gaugeMap,
      jobs: jobMap,
    },
    provisional,
  };
}

/** 誤りを1行ずつの文章にする（検証の道具・テストの表示用）。 */
export function formatContentError(e: ContentError): string {
  const where = [e.file, e.id, e.path].filter((x) => x !== undefined && x !== "").join(" ");
  return `[${e.code}] ${where}: ${e.message}`;
}
