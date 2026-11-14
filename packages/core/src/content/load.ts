import type { z } from "zod";
import { type AilmentDef, ailmentSchema } from "./ailment.ts";
import {
  type EffectDef,
  MORE_ALLOWED_ORIGINS,
  MORE_REDUCTION_ONLY_ORIGINS,
  effectSchema,
} from "./effect.ts";
import {
  type EnemyDef,
  type EnemyRank,
  type EnemyRankDef,
  enemyRankSchema,
  enemySchema,
} from "./enemy.ts";
import { KNOWN_HOOKS, SKILL_HOOK_PARAMS } from "./hooks.ts";
import {
  type AffixDef,
  type DropProfileDef,
  type DropSource,
  type ItemBaseDef,
  type ItemRarity,
  type MaterialDef,
  type RarityDef,
  affixSchema,
  dropProfileSchema,
  itemBaseSchema,
  materialSchema,
  raritySchema,
} from "./item.ts";
import {
  type GaugeDef,
  type JobDef,
  type SkillDef,
  type SkillMods,
  gaugeSchema,
  jobSchema,
  skillSchema,
} from "./job.ts";
import {
  type ConstellationDef,
  NODE_EFFECT_ORIGIN,
  type StarNodeDef,
  constellationSchema,
  jobNodeSchema,
  JOB_NODE_EFFECT_ORIGIN,
  type JobNodeDef,
  starNodeSchema,
} from "./board.ts";
import type { Condition } from "./effect.ts";
import { type QuestDef, type RegionDef, inRect, questSchema, regionSchema } from "./region.ts";
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
    /** 敵の種類と格の定義（省略すると無し）。 */
    readonly enemies?: readonly RawSource[];
    readonly enemyRanks?: readonly RawSource[];
    /** アイテム：レアリティ・ベース・詞・素材・ドロップ（省略すると無し）。 */
    readonly rarities?: readonly RawSource[];
    readonly itemBases?: readonly RawSource[];
    readonly affixes?: readonly RawSource[];
    readonly materials?: readonly RawSource[];
    readonly dropProfiles?: readonly RawSource[];
    /** 星辰盤のノードと星座（省略すると無し）。 */
    readonly starNodes?: readonly RawSource[];
    readonly constellations?: readonly RawSource[];
    readonly jobNodes?: readonly RawSource[];
    /** 地域（町・ダンジョン。省略すると無し）。 */
    readonly regions?: readonly RawSource[];
    /** クエスト（省略すると無し）。 */
    readonly quests?: readonly RawSource[];
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
  | "telegraph" // 予兆の規則（補助仕様書10.1：標準HPの25%を超える攻撃は、0.6秒以上の予兆）
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
  readonly enemies: ReadonlyMap<string, EnemyDef>;
  /** 格 → 定義。 */
  readonly enemyRanks: ReadonlyMap<EnemyRank, EnemyRankDef>;
  /** レアリティ → 定義。 */
  readonly rarities: ReadonlyMap<ItemRarity, RarityDef>;
  readonly itemBases: ReadonlyMap<string, ItemBaseDef>;
  readonly affixes: ReadonlyMap<string, AffixDef>;
  readonly materials: ReadonlyMap<string, MaterialDef>;
  /** ドロップの出どころ → 定義。 */
  readonly dropProfiles: ReadonlyMap<DropSource, DropProfileDef>;
  /** 星辰盤のノード。 */
  readonly starNodes: ReadonlyMap<string, StarNodeDef>;
  /** 星辰盤のつながり（向きを持たない。ノード → 隣のノード）。 */
  readonly starLinks: ReadonlyMap<string, ReadonlySet<string>>;
  /** 星座。 */
  readonly constellations: ReadonlyMap<string, ConstellationDef>;
  /** 職紋盤のノード（仕様書v0.2 4.10）と、つながり（両方向）・ジョブごとの始点。 */
  readonly jobNodes: ReadonlyMap<string, JobNodeDef>;
  readonly jobLinks: ReadonlyMap<string, ReadonlySet<string>>;
  readonly jobBoardStarts: ReadonlyMap<string, string>;
  /** 地域（町・ダンジョン）。 */
  readonly regions: ReadonlyMap<string, RegionDef>;
  /** クエスト。 */
  readonly quests: ReadonlyMap<string, QuestDef>;
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
  const enemies = parseAll(raw.collections.enemies ?? [], enemySchema);
  const enemyRanks = parseAll(raw.collections.enemyRanks ?? [], enemyRankSchema);
  const rarities = parseAll(raw.collections.rarities ?? [], raritySchema);
  const itemBases = parseAll(raw.collections.itemBases ?? [], itemBaseSchema);
  const affixes = parseAll(raw.collections.affixes ?? [], affixSchema);
  const materials = parseAll(raw.collections.materials ?? [], materialSchema);
  const dropProfiles = parseAll(raw.collections.dropProfiles ?? [], dropProfileSchema);
  const starNodes = parseAll(raw.collections.starNodes ?? [], starNodeSchema);
  const constellations = parseAll(raw.collections.constellations ?? [], constellationSchema);
  const jobNodes = parseAll(raw.collections.jobNodes ?? [], jobNodeSchema);
  const regions = parseAll(raw.collections.regions ?? [], regionSchema);
  const quests = parseAll(raw.collections.quests ?? [], questSchema);

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
    ...enemies,
    ...enemyRanks,
    ...rarities,
    ...itemBases,
    ...affixes,
    ...materials,
    ...dropProfiles,
    ...starNodes,
    ...constellations,
    ...jobNodes,
    ...regions,
    ...quests,
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
  const itemBaseMap = new Map(itemBases.map((b) => [b.value.id, b.value]));
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
    (mods.tags ?? []).forEach((t, i) => {
      tagOf(t, undefined, file, id, `${path}.tags.${String(i)}`);
    });
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
    if (gauge.pointEffect !== undefined)
      refCheck(effectMap, "効果", gauge.pointEffect.effect, file, gauge.id, "pointEffect.effect");
    // 位相の遷移表（魔法使い）：除く印・合成魔法の文章と変化の参照
    if (gauge.phase !== undefined) {
      gauge.phase.fusion.excludeTags.forEach((t, i) => {
        tagOf(t, undefined, file, gauge.id, `phase.fusion.excludeTags.${String(i)}`);
      });
      const phase = gauge.phase;
      const bad = (path: string, message: string): void => {
        err({ code: "schema", file, id: gauge.id, path, message });
      };
      if (phase.fusion.at > gauge.max)
        bad(
          "phase.fusion.at",
          `合成魔法になる位相 ${String(phase.fusion.at)} が、最大 ${String(gauge.max)} を超える`,
        );
      const inputs = phase.transitions.map((t) => t.input);
      if (new Set(inputs).size !== inputs.length)
        bad("phase.transitions", "遷移表の input が重なっている");
      phase.fusion.table.forEach((row, i) => {
        const at = `phase.fusion.table.${String(i)}`;
        if (row.elements[0] === row.elements[1])
          bad(`${at}.elements`, "合成魔法の組み合わせは、違う2つの属性");
        for (const e of row.elements)
          if (!phase.elements.includes(e))
            bad(`${at}.elements`, `属性 ${e} が phase.elements に無い`);
        if (!gauge.stages.some((st) => st.id === row.id))
          bad(`${at}.id`, `合成魔法 ${row.id} に対応する段階（stages）が無い`);
      });
      phase.fusion.table.forEach((row, i) => {
        checkText(row.text, file, gauge.id);
        checkMods(row.mods, file, gauge.id, `phase.fusion.table.${String(i)}.mods`);
      });
    }
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
    (job.defaultSlots ?? []).forEach((id, i) => {
      if (!refCheck(skillMap, "技", id, file, job.id, `defaultSlots.${String(i)}`)) return;
      const skill = skillMap.get(id);
      if (skill?.job !== undefined && skill.job !== job.id)
        err({
          code: "schema",
          file,
          id: job.id,
          path: `defaultSlots.${String(i)}`,
          message: `技 ${id} は、ジョブ ${skill.job} の技`,
        });
    });
    if (job.startingWeapon !== undefined)
      refCheck(itemBaseMap, "装備のベース", job.startingWeapon, file, job.id, "startingWeapon");
    if (job.startingOffHand !== undefined)
      refCheck(itemBaseMap, "装備のベース", job.startingOffHand, file, job.id, "startingOffHand");
    (job.passiveEffects ?? []).forEach((e, i) => {
      refCheck(effectMap, "効果", e, file, job.id, `passiveEffects.${String(i)}`);
    });
    // 上位職・混成職の形（MVP後の機能の提案 4章）：元のジョブがあり、自分自身でなく、重ならない。試練の文章がある
    (job.advancedFrom ?? []).forEach((from, i) => {
      const at = `advancedFrom.${String(i)}`;
      if (!refCheck(jobMap, "ジョブ", from, file, job.id, at)) return;
      if (from === job.id || (job.advancedFrom ?? []).indexOf(from) !== i)
        err({
          code: "schema",
          file,
          id: job.id,
          path: at,
          message: `元のジョブ ${from} が自分自身か、重なっている`,
        });
    });
    if (job.trial !== undefined) checkText(job.trial.text, file, job.id);
    if (job.trial !== undefined && job.advancedFrom === undefined)
      err({
        code: "schema",
        file,
        id: job.id,
        path: "trial",
        message: "試練は上位職・混成職（advancedFrom がある）にだけ付ける",
      });
  }

  for (const { value: skill, file } of skills) {
    checkText(skill.text, file, skill.id);
    if (skill.job !== undefined) refCheck(jobMap, "ジョブ", skill.job, file, skill.id, "job");
    skill.tags.forEach((t, i) => {
      tagOf(t, undefined, file, skill.id, `tags.${String(i)}`);
    });
    for (const tagId of Object.keys(skill.ailmentChance ?? {}))
      tagOf(tagId, ["ailment"], file, skill.id, "ailmentChance");
    if (skill.speedStat !== undefined)
      refCheck(statMap, "能力値", skill.speedStat, file, skill.id, "speedStat");
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
    if (skill.action.type === "selfBuff") {
      skill.action.effects.forEach((e, i) => {
        refCheck(effectMap, "効果", e, file, skill.id, `action.effects.${String(i)}`);
      });
    }
    // 召喚物（召喚士）：文章・攻撃のタグ・付与率の状態異常・犠牲と憑依の効果
    if (skill.action.type === "summon") {
      const m = skill.action.minion;
      if (!(m.text in raw.texts))
        err({
          code: "unknown-text",
          file,
          id: skill.id,
          path: "action.minion.text",
          message: `文章のキー ${m.text} がない`,
        });
      m.attack.tags.forEach((t, i) => {
        tagOf(t, undefined, file, skill.id, `action.minion.attack.tags.${String(i)}`);
      });
      for (const tagId of Object.keys(m.attack.ailmentChance ?? {}))
        tagOf(tagId, ["ailment"], file, skill.id, "action.minion.attack.ailmentChance");
      (m.sacrifice.selfEffects ?? []).forEach((e, i) => {
        refCheck(
          effectMap,
          "効果",
          e.effect,
          file,
          skill.id,
          `action.minion.sacrifice.selfEffects.${String(i)}.effect`,
        );
      });
      m.possessEffects.forEach((e, i) => {
        refCheck(effectMap, "効果", e, file, skill.id, `action.minion.possessEffects.${String(i)}`);
      });
    }
    if (skill.action.type === "zone") {
      (skill.action.enemyEffects ?? []).forEach((e, i) => {
        refCheck(effectMap, "効果", e, file, skill.id, `action.enemyEffects.${String(i)}`);
      });
      const tagId = skill.action.ailment;
      if (tagId !== undefined) {
        tagOf(tagId, ["ailment"], file, skill.id, "action.ailment");
        if (tagMap.has(tagId) && !ailmentsByTag.has(tagId))
          err({
            code: "unknown-ref",
            file,
            id: skill.id,
            path: "action.ailment",
            message: `状態異常 ${tagId} の定義がない`,
          });
      }
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

  // 9. 敵：文章・系統・状態異常・予兆の規則
  for (const { value: enemy, file } of enemies) {
    checkText(enemy.text, file, enemy.id);
    if (enemy.family !== undefined) tagOf(enemy.family, ["enemyFamily"], file, enemy.id, "family");
    if (enemy.pack.min > enemy.pack.max)
      err({
        code: "schema",
        file,
        id: enemy.id,
        path: "pack",
        message: "群れの数の最小が最大を超えている",
      });
    if (enemy.behavior.type === "kite" && enemy.behavior.min > enemy.behavior.max)
      err({
        code: "schema",
        file,
        id: enemy.id,
        path: "behavior",
        message: "保つ距離の最小が最大を超えている",
      });
    if (enemy.boss !== undefined) {
      const th = enemy.boss.phaseThresholds;
      if (th.some((v, i) => i > 0 && v >= (th[i - 1] ?? 1)))
        err({
          code: "schema",
          file,
          id: enemy.id,
          path: "boss.phaseThresholds",
          message: "段階の境目は、高い順に並べる",
        });
    }
    const attackIds = new Set<string>();
    enemy.attacks.forEach((attack, i) => {
      const at = `attacks.${String(i)}`;
      if (attackIds.has(attack.id))
        err({
          code: "duplicate-id",
          file,
          id: enemy.id,
          path: `${at}.id`,
          message: `攻撃 ${attack.id} が重複している`,
        });
      attackIds.add(attack.id);
      if (!(attack.text in raw.texts))
        err({
          code: "unknown-text",
          file,
          id: enemy.id,
          path: `${at}.text`,
          message: `文章のキー ${attack.text} がない`,
        });
      for (const tagId of Object.keys(attack.ailmentChance ?? {}))
        tagOf(tagId, ["ailment"], file, enemy.id, `${at}.ailmentChance`);
      const cloudAilment = (tagId: string, path: string): void => {
        tagOf(tagId, ["ailment"], file, enemy.id, path);
        if (tagMap.has(tagId) && !ailmentsByTag.has(tagId))
          err({
            code: "unknown-ref",
            file,
            id: enemy.id,
            path,
            message: `状態異常 ${tagId} の定義がない`,
          });
      };
      if (attack.delivery.type === "cloud")
        cloudAilment(attack.delivery.ailment, `${at}.delivery.ailment`);
      if (attack.delivery.type === "strike" && attack.delivery.residue !== undefined)
        cloudAilment(attack.delivery.residue.ailment, `${at}.delivery.residue.ailment`);
      // ボスの段階・根渡りは、ボスだけ
      const phaseCount = (enemy.boss?.phaseThresholds.length ?? 0) + 1;
      if (attack.phases !== undefined && enemy.boss === undefined)
        err({
          code: "schema",
          file,
          id: enemy.id,
          path: `${at}.phases`,
          message: "段階はボスの攻撃だけに付けられる",
        });
      for (const ph of attack.phases ?? [])
        if (enemy.boss !== undefined && ph > phaseCount)
          err({
            code: "schema",
            file,
            id: enemy.id,
            path: `${at}.phases`,
            message: `段階 ${String(ph)} がない（段階は${String(phaseCount)}つ）`,
          });
      if (attack.delivery.type === "burrow" && enemy.boss === undefined)
        err({
          code: "schema",
          file,
          id: enemy.id,
          path: `${at}.delivery`,
          message: "根渡りはボスの攻撃だけ",
        });
      if (attack.delivery.type === "summon") {
        const summoned = attack.delivery.enemy;
        if (!enemies.some((e) => e.value.id === summoned) && !invalidIds.has(summoned))
          err({
            code: "unknown-ref",
            file,
            id: enemy.id,
            path: `${at}.delivery.enemy`,
            message: `呼ぶ敵 ${summoned} がない`,
          });
      }
      const repeat =
        attack.delivery.type === "strike" || attack.delivery.type === "cloud"
          ? attack.delivery.repeat
          : undefined;
      if (repeat !== undefined && repeat.interval * (repeat.count - 1) > attack.active + 1e-9)
        err({
          code: "schema",
          file,
          id: enemy.id,
          path: `${at}.delivery.repeat`,
          message: "連続の当たり判定が、当たり判定の出ている時間に収まらない",
        });
      if (attack.ratio > 0.25 && attack.windup < 0.6)
        err({
          code: "telegraph",
          file,
          id: enemy.id,
          path: `${at}.windup`,
          message: `標準HPの${String(Math.round(attack.ratio * 100))}%の攻撃には、0.6秒以上の予兆が必要（${String(attack.windup)}秒。補助仕様書10.1）`,
        });
    });
  }
  const rankMap = new Map<EnemyRank, EnemyRankDef>();
  for (const { value: rank, file } of enemyRanks) {
    checkText(rank.text, file, rank.id);
    if (rankMap.has(rank.rank))
      err({
        code: "duplicate-id",
        file,
        id: rank.id,
        path: "rank",
        message: `格 ${rank.rank} の定義が2つある`,
      });
    else rankMap.set(rank.rank, rank);
  }

  // 10. アイテム：レアリティ・ベース・詞・素材・ドロップ
  const rarityMap = new Map<ItemRarity, RarityDef>();
  for (const { value: r, file } of rarities) {
    checkText(r.text, file, r.id);
    if (r.affixes.min > r.affixes.max)
      err({
        code: "schema",
        file,
        id: r.id,
        path: "affixes",
        message: "詞の数の最小が最大を超えている",
      });
    if (rarityMap.has(r.rarity))
      err({
        code: "duplicate-id",
        file,
        id: r.id,
        path: "rarity",
        message: `レアリティ ${r.rarity} の定義が2つある`,
      });
    else rarityMap.set(r.rarity, r);
  }
  for (const { value: b, file } of itemBases) {
    checkText(b.text, file, b.id);
    b.tags.forEach((t, i) => {
      tagOf(t, undefined, file, b.id, `tags.${String(i)}`);
    });
    if ((b.category === "weapon") !== (b.weapon !== undefined))
      err({
        code: "schema",
        file,
        id: b.id,
        path: "weapon",
        message: "武器の基礎性能は、分類が weapon のベースだけが持つ（weapon のベースには必須）",
      });
    if (b.weapon !== undefined && b.weapon.damage.physical.min > b.weapon.damage.physical.max)
      err({
        code: "schema",
        file,
        id: b.id,
        path: "weapon.damage",
        message: "最小が最大を超えている",
      });
    (b.implicitEffects ?? []).forEach((e, i) => {
      const at = `implicitEffects.${String(i)}`;
      if (!refCheck(effectMap, "効果", e, file, b.id, at)) return;
      const def = effectMap.get(e);
      if (def !== undefined && def.origin !== "implicit")
        err({
          code: "schema",
          file,
          id: b.id,
          path: at,
          message: `基本刻印の効果 ${e} の出どころが implicit ではない（${def.origin}）`,
        });
    });
    if ((b.category === "relic") !== (b.relic !== undefined))
      err({
        code: "schema",
        file,
        id: b.id,
        path: "relic",
        message: "遺物の定義は、分類が relic のベースだけが持つ（relic のベースには必須）",
      });
    if (b.relic !== undefined) {
      const cid = b.relic.constellation;
      const c = constellations.find((n) => n.value.id === cid)?.value;
      if (c === undefined)
        err({
          code: "unknown-ref",
          file,
          id: b.id,
          path: "relic.constellation",
          message: `星座 ${cid} がない`,
        });
      else if (
        !c.nodes.some((id) => starNodes.find((n) => n.value.id === id)?.value.kind === "minor")
      )
        err({
          code: "schema",
          file,
          id: b.id,
          path: "relic.constellation",
          message: `星座 ${cid} に写し取れる小星がない`,
        });
    }
    const u = b.unique;
    if (u !== undefined) {
      checkText(u.description, file, b.id);
      checkText(u.latent.text, file, b.id);
      [
        ...u.effects.map((e, i) => [e, `unique.effects.${String(i)}`] as const),
        ...u.latent.effects.map((e, i) => [e, `unique.latent.effects.${String(i)}`] as const),
      ].forEach(([e, at]) => {
        if (!refCheck(effectMap, "効果", e, file, b.id, at)) return;
        const def = effectMap.get(e);
        if (def !== undefined && def.origin !== "unique")
          err({
            code: "schema",
            file,
            id: b.id,
            path: at,
            message: `ユニークの効果 ${e} の出どころが unique ではない（${def.origin}）`,
          });
      });
      const c = u.latent.condition;
      const at = "unique.latent.condition";
      if (c.type === "mainJob") tagOf(c.job, ["job"], file, b.id, at);
      else if (c.type === "starNode" && c.pending !== true) {
        if (!starNodes.some((n) => n.value.id === c.id))
          err({
            code: "unknown-ref",
            file,
            id: b.id,
            path: at,
            message: `星辰盤のノード ${c.id} がない`,
          });
      } else if (c.type === "constellation" && c.pending !== true) {
        if (!constellations.some((n) => n.value.id === c.id))
          err({ code: "unknown-ref", file, id: b.id, path: at, message: `星座 ${c.id} がない` });
      } else if ((c.type === "jobNode" || c.type === "jobMastery") && c.pending !== true) {
        const n = jobNodes.find((x) => x.value.id === c.id)?.value;
        if (n === undefined || (n.kind === "mastery") !== (c.type === "jobMastery"))
          err({
            code: "unknown-ref",
            file,
            id: b.id,
            path: at,
            message: `職紋盤の${c.type === "jobMastery" ? "職奥義" : "ノード"} ${c.id} がない`,
          });
      }
    }
  }

  for (const { value: a, file } of affixes) {
    if (a.family !== undefined) tagOf(a.family, ["enemyFamily"], file, a.id, "family");
    if (a.job !== undefined) tagOf(a.job, ["job"], file, a.id, "job");
    checkText(a.text, file, a.id);
    if (refCheck(effectMap, "効果", a.effect, file, a.id, "effect")) {
      const def = effectMap.get(a.effect);
      const mod = def?.modifiers[0];
      if (def !== undefined && def.origin !== "affix")
        err({
          code: "schema",
          file,
          id: a.id,
          path: "effect",
          message: `詞の効果 ${a.effect} の出どころが affix ではない（${def.origin}）`,
        });
      else if (
        def !== undefined &&
        (def.modifiers.length !== 1 || mod === undefined || !("value" in mod))
      )
        err({
          code: "schema",
          file,
          id: a.id,
          path: "effect",
          message: `詞の効果 ${a.effect} は、値を持つ修正値を1つだけ持つ（詞の値で差し替えるため）`,
        });
      else if (
        mod !== undefined &&
        "value" in mod &&
        (a.roll === "added") !== (typeof mod.value === "object")
      )
        err({
          code: "schema",
          file,
          id: a.id,
          path: "roll",
          message:
            a.roll === "added"
              ? "最小・最大の追加ダメージ（roll: added）の効果は、最小・最大の値を持つ修正値にする"
              : "1つの値の詞（roll: range・fixed）の効果は、1つの数の値を持つ修正値にする",
        });
    }
    const seenTiers = new Set<number>();
    a.tiers.forEach((t, i) => {
      const at = `tiers.${String(i)}`;
      if (seenTiers.has(t.tier))
        err({
          code: "duplicate-id",
          file,
          id: a.id,
          path: at,
          message: `T${String(t.tier)} が重複している`,
        });
      seenTiers.add(t.tier);
      if (!(Number.isFinite(t.min) && Number.isFinite(t.max)) || t.min > t.max)
        err({ code: "schema", file, id: a.id, path: at, message: "最小が最大を超えている" });
      if (a.roll === "fixed" && t.min !== t.max)
        err({
          code: "schema",
          file,
          id: a.id,
          path: at,
          message: "tierごとに1つの値（roll: fixed）なら、最小と最大は同じ",
        });
      const prev = a.tiers[i - 1];
      if (prev !== undefined && !(prev.tier > t.tier))
        err({ code: "schema", file, id: a.id, path: at, message: "tierは低い順（7 → 0）に並べる" });
    });
  }
  const affixIds = new Map(affixes.map((a) => [a.value.id, a.value]));
  for (const { value: m, file } of materials) {
    checkText(m.text, file, m.id);
    // 系統素材の偏り（仕様書v0.2 3.11.3）：系統のタグと、詞の参照
    if (m.craftBias?.family !== undefined)
      tagOf(m.craftBias.family, ["enemyFamily"], file, m.id, "craftBias.family");
    (m.craftBias?.affixes ?? []).forEach((a, i) => {
      refCheck(affixIds, "詞", a, file, m.id, `craftBias.affixes.${String(i)}`);
    });
  }
  const materialMap = new Map(materials.map((m) => [m.value.id, m.value]));
  const dropMap = new Map<DropSource, DropProfileDef>();
  for (const { value: d, file } of dropProfiles) {
    if (d.count.min > d.count.max)
      err({ code: "schema", file, id: d.id, path: "count", message: "数の最小が最大を超えている" });
    if (d.guaranteedRareOrBetter > d.count.min)
      err({
        code: "schema",
        file,
        id: d.id,
        path: "guaranteedRareOrBetter",
        message: "希少以上の確定の数が、ドロップの数の最小を超えている",
      });
    d.materials.forEach((m, i) => {
      const at = `materials.${String(i)}`;
      refCheck(materialMap, "素材", m.material, file, d.id, `${at}.material`);
      if (m.family !== undefined) tagOf(m.family, ["enemyFamily"], file, d.id, `${at}.family`);
    });
    if (dropMap.has(d.source))
      err({
        code: "duplicate-id",
        file,
        id: d.id,
        path: "source",
        message: `ドロップの出どころ ${d.source} の定義が2つある`,
      });
    else dropMap.set(d.source, d);
  }

  // 11. 星辰盤：つながり・効果の出どころ・始点・星門・星座
  const starMap = new Map(starNodes.map((n) => [n.value.id, n.value]));
  const starLinks = new Map<string, Set<string>>();
  for (const id of starMap.keys()) starLinks.set(id, new Set());
  const checkCondition = (c: Condition, file: string, id: string, path: string): void => {
    switch (c.type) {
      case "statAtLeast":
        refCheck(statMap, "能力値", c.stat, file, id, `${path}.stat`);
        break;
      case "equippedTag":
        refCheck(tagMap, "タグ", c.tag, file, id, `${path}.tag`);
        break;
      case "mainJob":
        refCheck(jobMap, "ジョブ", c.job, file, id, `${path}.job`);
        break;
      case "factAtLeast":
        break;
    }
  };
  for (const { value: n, file } of starNodes) {
    if (n.text !== undefined) checkText(n.text, file, n.id);
    n.links.forEach((l, i) => {
      const at = `links.${String(i)}`;
      if (l === n.id)
        err({ code: "schema", file, id: n.id, path: at, message: "自分自身とはつながれない" });
      else if (refCheck(starMap, "ノード", l, file, n.id, at)) {
        starLinks.get(n.id)?.add(l);
        starLinks.get(l)?.add(n.id);
      }
    });
    const allowed = NODE_EFFECT_ORIGIN[n.kind];
    for (const [key, list] of [
      ["effects", n.effects ?? []],
      ["resonance.effects", n.resonance?.effects ?? []],
      ["factStacked.effects", n.factStacked?.effects ?? []],
    ] as const)
      list.forEach((e, i) => {
        const at = `${key}.${String(i)}`;
        if (!refCheck(effectMap, "効果", e, file, n.id, at)) return;
        const origin = effectMap.get(e)?.origin ?? "";
        if (!allowed.includes(origin))
          err({
            code: "schema",
            file,
            id: n.id,
            path: at,
            message: `${n.kind} のノードの効果 ${e} の出どころ ${origin} は使えない（${allowed.join("・") || "効果なし"}）`,
          });
      });
    if ((n.kind === "start") !== (n.startFor !== undefined && n.startFor.length > 0))
      err({
        code: "schema",
        file,
        id: n.id,
        path: "startFor",
        message:
          "始点（start）のノードだけが、始点にするジョブ（startFor）を持つ（start には必須）",
      });
    (n.startFor ?? []).forEach((j, i) => {
      refCheck(jobMap, "ジョブ", j, file, n.id, `startFor.${String(i)}`);
    });
    if ((n.kind === "gate") !== (n.gate !== undefined))
      err({
        code: "schema",
        file,
        id: n.id,
        path: "gate",
        message: "星門（gate）のノードだけが条件（gate）を持つ（gate には必須）",
      });
    n.gate?.conditions.forEach((c, i) => {
      checkCondition(c, file, n.id, `gate.conditions.${String(i)}`);
    });
    if (n.resonance !== undefined && n.kind !== "keystone")
      err({
        code: "schema",
        file,
        id: n.id,
        path: "resonance",
        message: "共鳴変化は天極（keystone）だけが持つ",
      });
  }
  // 11b. 職紋盤：ジョブの参照・つながり（同じジョブの中だけ）・効果の出どころ・始点はジョブごとに1つ
  const jobNodeMap = new Map(jobNodes.map((n) => [n.value.id, n.value]));
  const jobLinks = new Map<string, Set<string>>();
  for (const id of jobNodeMap.keys()) jobLinks.set(id, new Set());
  const jobBoardStarts = new Map<string, string>();
  for (const { value: n, file } of jobNodes) {
    if (n.text !== undefined) checkText(n.text, file, n.id);
    if (n.description !== undefined) checkText(n.description, file, n.id);
    refCheck(jobMap, "ジョブ", n.job, file, n.id, "job");
    n.links.forEach((l, i) => {
      const at = `links.${String(i)}`;
      if (l === n.id)
        err({ code: "schema", file, id: n.id, path: at, message: "自分自身とはつながれない" });
      else if (refCheck(jobNodeMap, "職紋盤のノード", l, file, n.id, at)) {
        if (jobNodeMap.get(l)?.job !== n.job)
          err({
            code: "schema",
            file,
            id: n.id,
            path: at,
            message: "別のジョブの盤とはつながれない",
          });
        jobLinks.get(n.id)?.add(l);
        jobLinks.get(l)?.add(n.id);
      }
    });
    const allowed = JOB_NODE_EFFECT_ORIGIN[n.kind];
    (n.effects ?? []).forEach((e, i) => {
      const at = `effects.${String(i)}`;
      if (!refCheck(effectMap, "効果", e, file, n.id, at)) return;
      const origin = effectMap.get(e)?.origin ?? "";
      if (!allowed.includes(origin))
        err({
          code: "schema",
          file,
          id: n.id,
          path: at,
          message: `${n.kind} のノードは、出どころが ${origin} の効果を持てない`,
        });
    });
    if (n.kind === "start") {
      const prev = jobBoardStarts.get(n.job);
      if (prev !== undefined)
        err({
          code: "schema",
          file,
          id: n.id,
          path: "kind",
          message: `ジョブ ${n.job} の職紋盤の始点が2つある（${prev}）`,
        });
      else jobBoardStarts.set(n.job, n.id);
    }
  }
  for (const { value: n, file } of jobNodes)
    if (!jobBoardStarts.has(n.job) && jobMap.has(n.job))
      err({
        code: "schema",
        file,
        id: n.id,
        path: "job",
        message: `ジョブ ${n.job} の職紋盤に始点が無い`,
      });
  const starters = new Map<string, string>();
  for (const { value: n, file } of starNodes)
    for (const j of n.startFor ?? []) {
      const prev = starters.get(j);
      if (prev !== undefined)
        err({
          code: "schema",
          file,
          id: n.id,
          path: "startFor",
          message: `ジョブ ${j} の始点が2つある（${prev}）`,
        });
      else starters.set(j, n.id);
    }
  const inConstellation = new Map<string, string>();
  for (const { value: c, file } of constellations) {
    checkText(c.text, file, c.id);
    c.nodes.forEach((nodeId, i) => {
      const at = `nodes.${String(i)}`;
      if (!refCheck(starMap, "ノード", nodeId, file, c.id, at)) return;
      const prev = inConstellation.get(nodeId);
      if (prev !== undefined)
        err({
          code: "schema",
          file,
          id: c.id,
          path: at,
          message: `ノード ${nodeId} は、ほかの星座（${prev}）にも入っている`,
        });
      else inConstellation.set(nodeId, c.id);
    });
    if (refCheck(effectMap, "効果", c.completionEffect, file, c.id, "completionEffect")) {
      const origin = effectMap.get(c.completionEffect)?.origin;
      if (origin !== "constellation")
        err({
          code: "schema",
          file,
          id: c.id,
          path: "completionEffect",
          message: `完成ボーナスの効果の出どころが constellation ではない（${String(origin)}）`,
        });
    }
  }

  // 12. 地域：敵・出口の参照、候補地点が区画と広さの中にあるか、町は区画を持たない
  const regionMap = new Map(regions.map((r) => [r.value.id, r.value]));
  const enemyMap = new Map(enemies.map((e) => [e.value.id, e.value]));
  for (const { value: r, file } of regions) {
    checkText(r.text, file, r.id);
    const inside = (p: { x: number; y: number }): boolean =>
      p.x >= 0 && p.y >= 0 && p.x <= r.size.width && p.y <= r.size.height;
    const sections = r.sections ?? [];
    if (r.kind === "town" && (sections.length > 0 || (r.packSpawns ?? []).length > 0))
      err({
        code: "schema",
        file,
        id: r.id,
        path: "sections",
        message: "町には敵の区画・群れを置かない",
      });
    if (r.kind === "dungeon" && sections.length === 0)
      err({
        code: "schema",
        file,
        id: r.id,
        path: "sections",
        message: "ダンジョンには区画が必要",
      });
    sections.forEach((sec, i) => {
      if (sec.levels.min > sec.levels.max)
        err({
          code: "schema",
          file,
          id: r.id,
          path: `sections.${String(i)}.levels`,
          message: "最小が最大を超えている",
        });
      sec.enemies.forEach((e, j) => {
        refCheck(enemyMap, "敵", e, file, r.id, `sections.${String(i)}.enemies.${String(j)}`);
      });
    });
    const points: [string, { x: number; y: number }[]][] = [
      ["packSpawns", r.packSpawns ?? []],
      ["eliteSpawns", r.eliteSpawns ?? []],
      ["woodChests", r.woodChests ?? []],
      ["oldChests", r.oldChests ?? []],
    ];
    for (const [key, list] of points)
      list.forEach((p, i) => {
        if (!inside(p))
          err({
            code: "schema",
            file,
            id: r.id,
            path: `${key}.${String(i)}`,
            message: "地域の広さの外にある",
          });
        else if (!sections.some((sec) => inRect(p, sec.rect)))
          err({
            code: "schema",
            file,
            id: r.id,
            path: `${key}.${String(i)}`,
            message: "どの区画にも入っていない",
          });
      });
    if (!inside(r.entrance))
      err({ code: "schema", file, id: r.id, path: "entrance", message: "地域の広さの外にある" });
    (r.fixedEnemies ?? []).forEach((f, i) => {
      refCheck(enemyMap, "敵", f.enemy, file, r.id, `fixedEnemies.${String(i)}.enemy`);
      if (!inside(f.at))
        err({
          code: "schema",
          file,
          id: r.id,
          path: `fixedEnemies.${String(i)}.at`,
          message: "地域の広さの外にある",
        });
    });
    (r.secrets ?? []).forEach((x, i) => {
      checkText(x.text, file, r.id);
      if (!inside(x.at))
        err({
          code: "schema",
          file,
          id: r.id,
          path: `secrets.${String(i)}.at`,
          message: "地域の広さの外にある",
        });
    });
    (r.exits ?? []).forEach((x, i) => {
      if (!regionMap.has(x.to) && !invalidIds.has(x.to))
        err({
          code: "unknown-ref",
          file,
          id: r.id,
          path: `exits.${String(i)}.to`,
          message: `地域 ${x.to} がない`,
        });
      if (x.requires !== undefined)
        refCheck(enemyMap, "敵", x.requires.defeated, file, r.id, `exits.${String(i)}.requires`);
    });
    (r.fixedEnemies ?? []).forEach((f, i) => {
      for (const [j, a] of (f.anchors ?? []).entries())
        if (!inside(a))
          err({
            code: "schema",
            file,
            id: r.id,
            path: `fixedEnemies.${String(i)}.anchors.${String(j)}`,
            message: "地域の広さの外にある",
          });
      const def = enemyMap.get(f.enemy);
      if (
        def?.attacks.some((a) => a.delivery.type === "burrow") === true &&
        (f.anchors ?? []).length < 2
      )
        err({
          code: "schema",
          file,
          id: r.id,
          path: `fixedEnemies.${String(i)}.anchors`,
          message: "根渡りをする敵には、現れる地点が2つ以上いる",
        });
    });
  }

  // 13. クエスト：地域・敵の参照、段階のIDの重なり
  const stageIds = new Set<string>();
  for (const { value: q, file } of quests) {
    checkText(q.text, file, q.id);
    q.stages.forEach((st, i) => {
      checkText(st.text, file, q.id);
      if (stageIds.has(st.id))
        err({
          code: "duplicate-id",
          file,
          id: q.id,
          path: `stages.${String(i)}.id`,
          message: `段階 ${st.id} が重複している`,
        });
      stageIds.add(st.id);
      if (st.trigger.type === "enterRegion" && !regionMap.has(st.trigger.region))
        err({
          code: "unknown-ref",
          file,
          id: q.id,
          path: `stages.${String(i)}.trigger.region`,
          message: `地域 ${st.trigger.region} がない`,
        });
      if (st.trigger.type === "defeat")
        refCheck(enemyMap, "敵", st.trigger.enemy, file, q.id, `stages.${String(i)}.trigger.enemy`);
    });
  }

  if (errors.length > 0 || manifest === undefined) return { ok: false, errors };

  // 14. 仮値の一覧
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
  collect("enemies", enemies);
  collect("enemyRanks", enemyRanks);
  collect("rarities", rarities);
  collect("itemBases", itemBases);
  collect("affixes", affixes);
  collect("materials", materials);
  collect("dropProfiles", dropProfiles);
  collect("starNodes", starNodes);
  collect("constellations", constellations);
  collect("jobNodes", jobNodes);
  collect("regions", regions);
  collect("quests", quests);

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
      enemies: new Map(enemies.map((e) => [e.value.id, e.value])),
      enemyRanks: rankMap,
      rarities: rarityMap,
      itemBases: new Map(itemBases.map((b) => [b.value.id, b.value])),
      affixes: new Map(affixes.map((a) => [a.value.id, a.value])),
      materials: materialMap,
      dropProfiles: dropMap,
      starNodes: starMap,
      starLinks,
      constellations: new Map(constellations.map((c) => [c.value.id, c.value])),
      jobNodes: jobNodeMap,
      jobLinks,
      jobBoardStarts,
      regions: regionMap,
      quests: new Map(quests.map((q) => [q.value.id, q.value])),
    },
    provisional,
  };
}

/** 誤りを1行ずつの文章にする（検証の道具・テストの表示用）。 */
export function formatContentError(e: ContentError): string {
  const where = [e.file, e.id, e.path].filter((x) => x !== undefined && x !== "").join(" ");
  return `[${e.code}] ${where}: ${e.message}`;
}
