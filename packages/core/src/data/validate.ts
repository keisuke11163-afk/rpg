/**
 * データの検証（開発計画書 F-2・T17）。
 *
 * 1. 形の検査：ファイルの外枠と、項目ごとのスキーマ（schema.ts）
 * 2. 版の検査：schemaVersion が DATA_SCHEMA_VERSION と一致する
 * 3. IDの重複：全ての種類をまたいで、同じIDは1つだけ
 * 4. ID参照：存在しないタグ・能力値・ルールフックを参照していない。参照先の種類も正しい
 * 5. 規則の検査：タグの親子の循環、乗算の出どころ（本仕様書 2.4）、変換の向きと合計（2.5）、
 *    上書きの優先度の重複（2.4.1-4）、ルールフックのパラメータ
 *
 * 誤りは最初の1つで止めず、全て集めて返す（壊れたデータを一度に直せるようにするため）。
 */
import { z } from "zod";
import {
  DATA_KINDS,
  DATA_SCHEMA_VERSION,
  DataFileEnvelope,
  MULTIPLIER_SOURCES,
  REDUCING_MULTIPLIER_SOURCES,
  type Condition,
  type DataKind,
  type Effect,
  type Hook,
  type Modifier,
  type Stat,
  type Tag,
  type TagMatch,
} from "./schema.ts";

/** 検証にかけるデータファイル（読み込みは呼び出す側が行う。core はファイルを読まない）。 */
export interface RawDataFile {
  /** 誤りの表示に使う、ファイルの場所（例："tags/tags.json"）。 */
  readonly path: string;
  /** JSON を読んだ結果。 */
  readonly content: unknown;
}

export const DATA_ERROR_CODES = [
  "schema", // 形・値の範囲・必須の項目
  "schema_version", // データの版が合わない
  "duplicate_id", // IDの重複
  "unknown_reference", // 存在しないIDの参照
  "wrong_reference_kind", // 参照先の種類が違う（タグのはずが能力値など）
  "tag_cycle", // タグの親子の循環
  "multiplier_source", // 乗算を持てない出どころの乗算
  "conversion_direction", // 変換の向き（下流から上流・聖から）
  "conversion_total", // 1つの効果の変換の合計が100%を超える
  "override_priority", // 同じ能力値・同じ優先度の上書き
  "hook_params", // ルールフックのパラメータの過不足・型
] as const;
export type DataErrorCode = (typeof DATA_ERROR_CODES)[number];

export interface DataError {
  readonly code: DataErrorCode;
  readonly file: string;
  /** ファイルの中の場所（例："entries[3].modifiers[0].stat"）。 */
  readonly path: string;
  readonly message: string;
}

/** 検証を通ったデータ。 */
export interface ContentData {
  readonly schemaVersion: number;
  readonly tags: ReadonlyMap<string, Tag>;
  readonly stats: ReadonlyMap<string, Stat>;
  readonly hooks: ReadonlyMap<string, Hook>;
  readonly effects: ReadonlyMap<string, Effect>;
  /** 各IDが定義されているファイル。 */
  readonly origins: ReadonlyMap<string, string>;
}

export type ValidationResult =
  | { readonly ok: true; readonly data: ContentData; readonly errors: readonly [] }
  | { readonly ok: false; readonly errors: readonly DataError[] };

interface Located<T> {
  readonly entry: T;
  readonly file: string;
  readonly path: string;
}

function formatPath(base: string, segments: readonly PropertyKey[]): string {
  let result = base;
  for (const segment of segments) {
    result += typeof segment === "number" ? `[${String(segment)}]` : `.${String(segment)}`;
  }
  return result;
}

export function validateContent(files: readonly RawDataFile[]): ValidationResult {
  const errors: DataError[] = [];
  const report = (code: DataErrorCode, file: string, path: string, message: string): void => {
    errors.push({ code, file, path, message });
  };

  const located: { [K in DataKind]: Located<z.infer<(typeof DATA_KINDS)[K]>>[] } = {
    tags: [],
    stats: [],
    hooks: [],
    effects: [],
  };

  // 形の検査で落ちた項目のID。これを参照している所は、誤りを重ねて報告しない
  const brokenIds = new Map<string, DataKind>();

  // 1・2. 形と版
  for (const file of files) {
    const envelope = DataFileEnvelope.safeParse(file.content);
    if (!envelope.success) {
      for (const issue of envelope.error.issues) {
        report("schema", file.path, formatPath("", issue.path), issue.message);
      }
      continue;
    }
    const { schemaVersion, kind, entries } = envelope.data;
    if (schemaVersion !== DATA_SCHEMA_VERSION) {
      report(
        "schema_version",
        file.path,
        "schemaVersion",
        `データの版が ${String(schemaVersion)}。現在の版は ${String(DATA_SCHEMA_VERSION)}`,
      );
      continue;
    }
    const schema = DATA_KINDS[kind];
    entries.forEach((raw, index) => {
      const path = `entries[${String(index)}]`;
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          report("schema", file.path, formatPath(path, issue.path), issue.message);
        }
        const id: unknown = (raw as { id?: unknown } | null)?.id;
        if (typeof id === "string") brokenIds.set(id, kind);
        return;
      }
      (located[kind] as Located<unknown>[]).push({ entry: parsed.data, file: file.path, path });
    });
  }

  // 3. IDの重複（種類をまたいで）
  const kindOf = new Map<string, DataKind>();
  const origins = new Map<string, string>();
  const firstPlace = new Map<string, string>();
  for (const kind of Object.keys(located) as DataKind[]) {
    for (const { entry, file, path } of located[kind]) {
      const place = `${file} ${path}`;
      const previous = firstPlace.get(entry.id);
      if (previous !== undefined) {
        report(
          "duplicate_id",
          file,
          `${path}.id`,
          `ID ${entry.id} は ${previous} でも定義されている`,
        );
        continue;
      }
      firstPlace.set(entry.id, place);
      kindOf.set(entry.id, kind);
      origins.set(entry.id, file);
    }
  }

  const KIND_NAMES: Record<DataKind, string> = {
    tags: "タグ",
    stats: "能力値",
    hooks: "ルールフック",
    effects: "効果",
  };
  /** 参照を確かめる。正しければ true。 */
  const checkRef = (id: string, expected: DataKind, file: string, path: string): boolean => {
    const actual = kindOf.get(id);
    if (actual === undefined && brokenIds.get(id) === expected) return false;
    if (actual === undefined) {
      report(
        "unknown_reference",
        file,
        path,
        `存在しない${KIND_NAMES[expected]} ${id} を参照している`,
      );
      return false;
    }
    if (actual !== expected) {
      report(
        "wrong_reference_kind",
        file,
        path,
        `${id} は${KIND_NAMES[actual]}。ここには${KIND_NAMES[expected]}を書く`,
      );
      return false;
    }
    return true;
  };
  const checkTagMatch = (match: TagMatch, file: string, path: string): void => {
    for (const key of ["allOf", "anyOf", "noneOf"] as const) {
      match[key]?.forEach((id, i) => {
        checkRef(id, "tags", file, `${path}.${key}[${String(i)}]`);
      });
    }
  };
  const checkConditions = (conditions: readonly Condition[], file: string, path: string): void => {
    conditions.forEach((condition, i) => {
      const at = `${path}[${String(i)}]`;
      switch (condition.type) {
        case "tags":
          checkTagMatch(condition.match, file, `${at}.match`);
          break;
        case "equipped_count":
          checkRef(condition.tag, "tags", file, `${at}.tag`);
          break;
        case "stat_at_least":
          checkRef(condition.stat, "stats", file, `${at}.stat`);
          break;
      }
    });
  };

  const tags = new Map(located.tags.map(({ entry }) => [entry.id, entry]));
  const hooks = new Map(located.hooks.map(({ entry }) => [entry.id, entry]));

  // 4・5. タグ：親の参照と循環
  for (const { entry, file, path } of located.tags) {
    entry.parents?.forEach((parent, i) => {
      checkRef(parent, "tags", file, `${path}.parents[${String(i)}]`);
    });
  }
  const cyclic = new Set<string>();
  for (const { entry, file, path } of located.tags) {
    const seen = new Set<string>();
    const stack: string[] = [...(entry.parents ?? [])];
    while (stack.length > 0) {
      const id = stack.pop() as string;
      if (id === entry.id) {
        if (!cyclic.has(entry.id)) {
          report(
            "tag_cycle",
            file,
            `${path}.parents`,
            `タグ ${entry.id} の親をたどると、自分に戻る`,
          );
          cyclic.add(entry.id);
        }
        break;
      }
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(tags.get(id)?.parents ?? []));
    }
  }

  // 4・5. 効果
  const overrides = new Map<string, string>();
  for (const { entry, file, path } of located.effects) {
    if (entry.targetTags) checkTagMatch(entry.targetTags, file, `${path}.targetTags`);
    checkConditions(entry.conditions, file, `${path}.conditions`);

    let conversionTotal = 0;
    entry.modifiers.forEach((modifier: Modifier, i) => {
      const at = `${path}.modifiers[${String(i)}]`;
      if (modifier.conditions) checkConditions(modifier.conditions, file, `${at}.conditions`);

      switch (modifier.kind) {
        case "added":
        case "flat_bonus":
        case "increased":
        case "more":
        case "cap":
        case "override":
          checkRef(modifier.stat, "stats", file, `${at}.stat`);
          if (modifier.filter) checkTagMatch(modifier.filter, file, `${at}.filter`);
          break;
        case "conversion":
        case "reattribution": {
          const fromOk = checkRef(modifier.from, "tags", file, `${at}.from`);
          const toOk = checkRef(modifier.to, "tags", file, `${at}.to`);
          if (fromOk && toOk) checkElements(modifier, tags, file, at, report);
          break;
        }
        case "behavior":
          if (checkRef(modifier.hook, "hooks", file, `${at}.hook`)) {
            checkHookParams(modifier, hooks.get(modifier.hook) as Hook, kindOf, file, at, report);
          }
          break;
      }

      if (modifier.kind === "more") {
        const reducingOnly = REDUCING_MULTIPLIER_SOURCES.includes(entry.source);
        if (reducingOnly && modifier.value >= 1) {
          report(
            "multiplier_source",
            file,
            `${at}.value`,
            `出どころ ${entry.source} は、減らす方向（1未満）の乗算だけを持てる（本仕様書 2.4）`,
          );
        } else if (!reducingOnly && !MULTIPLIER_SOURCES.includes(entry.source)) {
          report(
            "multiplier_source",
            file,
            `${at}.kind`,
            `出どころ ${entry.source} は乗算を持てない（本仕様書 2.4：${MULTIPLIER_SOURCES.join("・")}）`,
          );
        }
      }
      if (modifier.kind === "conversion") conversionTotal += modifier.value;
      if (modifier.kind === "override") {
        const key = `${modifier.stat}@${String(modifier.priority)}`;
        const previous = overrides.get(key);
        if (previous !== undefined) {
          report(
            "override_priority",
            file,
            `${at}.priority`,
            `${modifier.stat} の優先度 ${String(modifier.priority)} の上書きは、${previous} にもある（本仕様書 2.4.1-4）`,
          );
        } else {
          overrides.set(key, `${entry.id}（${file}）`);
        }
      }
    });
    // 浮動小数の誤差を見込む
    if (conversionTotal > 1 + 1e-9) {
      report(
        "conversion_total",
        file,
        `${path}.modifiers`,
        `変換の合計が ${String(Math.round(conversionTotal * 1000) / 10)}%。100%までにする（本仕様書 2.5）`,
      );
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    data: {
      schemaVersion: DATA_SCHEMA_VERSION,
      tags,
      stats: new Map(located.stats.map(({ entry }) => [entry.id, entry])),
      hooks,
      effects: new Map(located.effects.map(({ entry }) => [entry.id, entry])),
      origins,
    },
  };
}

type Report = (code: DataErrorCode, file: string, path: string, message: string) => void;

/** 変換・付け替えの元と先が属性のタグであること、変換の向きが正しいことを確かめる。 */
function checkElements(
  modifier: Extract<Modifier, { kind: "conversion" | "reattribution" }>,
  tags: ReadonlyMap<string, Tag>,
  file: string,
  at: string,
  report: Report,
): void {
  const from = tags.get(modifier.from) as Tag;
  const to = tags.get(modifier.to) as Tag;
  let bothElements = true;
  for (const [tag, key] of [
    [from, "from"],
    [to, "to"],
  ] as const) {
    if (tag.category !== "element") {
      report("wrong_reference_kind", file, `${at}.${key}`, `${tag.id} は属性のタグではない`);
      bothElements = false;
    }
  }
  if (!bothElements || modifier.kind !== "conversion") return;
  if (from.id === to.id) {
    report("conversion_direction", file, at, `${from.id} から同じ属性には変換できない`);
  } else if (from.conversionRank === undefined) {
    report(
      "conversion_direction",
      file,
      `${at}.from`,
      `${from.id} からは変換できない（本仕様書 2.5）`,
    );
  } else if (to.conversionRank === undefined) {
    // 聖への変換は「特定の効果に限る」（本仕様書 2.5）。MVPには該当する効果がないので、今は全て禁止する
    report("conversion_direction", file, `${at}.to`, `${to.id} へは変換できない（本仕様書 2.5）`);
  } else if (to.conversionRank <= from.conversionRank) {
    report(
      "conversion_direction",
      file,
      at,
      `${from.id} から ${to.id} への変換は、下流から上流への変換（本仕様書 2.5：上流から下流へだけ）`,
    );
  }
}

/** 挙動の修正値のパラメータが、ルールフックの定義と一致することを確かめる。 */
function checkHookParams(
  modifier: Extract<Modifier, { kind: "behavior" }>,
  hook: Hook,
  kindOf: ReadonlyMap<string, DataKind>,
  file: string,
  at: string,
  report: Report,
): void {
  const given = modifier.params ?? {};
  for (const name of Object.keys(hook.params)) {
    if (!(name in given)) {
      report("hook_params", file, `${at}.params`, `${hook.id} のパラメータ ${name} がない`);
    }
  }
  for (const [name, value] of Object.entries(given)) {
    const type = hook.params[name];
    const path = `${at}.params.${name}`;
    if (type === undefined) {
      report("hook_params", file, path, `${hook.id} にパラメータ ${name} はない`);
      continue;
    }
    const ok =
      type === "number"
        ? typeof value === "number" && Number.isFinite(value)
        : type === "integer"
          ? Number.isInteger(value)
          : type === "boolean"
            ? typeof value === "boolean"
            : type === "string"
              ? typeof value === "string"
              : typeof value === "string" &&
                kindOf.get(value) === (type === "tag" ? "tags" : "stats");
    if (!ok) {
      report("hook_params", file, path, `${hook.id} のパラメータ ${name} は ${type} にする`);
    }
  }
}

/** 仮値の一覧の1行。 */
export interface ProvisionalEntry {
  readonly id: string;
  readonly file: string;
  readonly note: string | undefined;
}

/** 仮値（"provisional": true）の項目の一覧（開発計画書 T17）。ファイル・IDの順に並べる。 */
export function listProvisional(data: ContentData): ProvisionalEntry[] {
  const result: ProvisionalEntry[] = [];
  for (const map of [data.tags, data.stats, data.hooks, data.effects] as const) {
    for (const entry of map.values()) {
      if (entry.provisional === true) {
        result.push({
          id: entry.id,
          file: data.origins.get(entry.id) ?? "",
          note: entry.provisionalNote,
        });
      }
    }
  }
  return result.sort((a, b) => a.file.localeCompare(b.file) || a.id.localeCompare(b.id));
}

/** 誤りを1行ずつの文章にする。 */
export function formatDataErrors(errors: readonly DataError[]): string {
  return errors.map((e) => `${e.file} ${e.path} [${e.code}] ${e.message}`).join("\n");
}
