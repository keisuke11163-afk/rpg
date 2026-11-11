/**
 * データのスキーマ（開発計画書 6.1〜6.4、本仕様書 10.1）。
 *
 * コンテンツのデータ（packages/content/data）の形を、ここで決める。
 * 形の検査（型・値の範囲・必須の項目）はこのスキーマで、
 * ファイルをまたぐ検査（ID参照・重複・乗算の出どころなど）は validate.ts で行う。
 *
 * データの中の名前（項目名・種類の値）は英語、IDは英大文字とハイフン（開発環境構築計画 5章）。
 * 表示名はデータに持たせず、text/ja.json の `name.<ID>` に置く。
 */
import { z } from "zod";

/**
 * データの形の版。全てのデータファイルの `schemaVersion` は、この値と一致しなければならない。
 * 互換性のない形の変更をしたら上げ、同じコミットで全てのデータファイルを新しい形に直す
 * （データはコードと一緒に配布するので、データの移行の処理は持たない。セーブの移行は U-13）。
 */
export const DATA_SCHEMA_VERSION = 1;

/** IDの形：英大文字で始まり、ハイフンで区切った英大文字と数字（例：TAG-WPN-GREATSWORD）。 */
export const ID_PATTERN = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/;

function idWithPrefix(prefix: string) {
  return z
    .string()
    .regex(new RegExp(`^${prefix}-[A-Z0-9]+(?:-[A-Z0-9]+)*$`), `IDは ${prefix}- で始める`);
}

export const TagId = idWithPrefix("TAG");
export const StatId = idWithPrefix("STAT");
export const HookId = idWithPrefix("HOOK");
export const EffectId = z.string().regex(ID_PATTERN, "IDは英大文字とハイフンで書く");

/** 全てのデータの項目に共通する部分。 */
const entryBase = {
  /** 仮値（バランス調整で変わる数値）を含む項目に true を付ける（MVP実装単位 2.1）。 */
  provisional: z.boolean().optional(),
  /** 仮値の理由・決定待ちの事項。 */
  provisionalNote: z.string().min(1).optional(),
  /** 開発者向けのメモ（表示しない）。 */
  note: z.string().min(1).optional(),
};

// ---------------------------------------------------------------------------
// 星紋タグ（本仕様書 1.5、開発計画書 6.3）

export const TAG_CATEGORIES = [
  "form", // 形態
  "element", // 属性
  "ailment", // 状態異常
  "weapon", // 武器
  "weapon_group", // 武器の系統（親タグ）
  "job", // ジョブ
  "region", // 星域
  "enemy_family", // 敵系統
] as const;
export const TagCategory = z.enum(TAG_CATEGORIES);

export const Tag = z
  .strictObject({
    id: TagId,
    category: TagCategory,
    /** 親タグ。このタグを持つものは、親タグにも当てはまる（例：大剣 → 剣系）。 */
    parents: z.array(TagId).min(1).optional(),
    /**
     * 属性の変換の順番（本仕様書 2.5）。小さいほど上流。上流から下流へだけ変換できる。
     * 持たない属性（聖）は、変換の元にも先にもならない。
     */
    conversionRank: z.int().min(0).optional(),
    ...entryBase,
  })
  .refine((tag) => tag.conversionRank === undefined || tag.category === "element", {
    message: "conversionRank は属性（element）のタグだけが持てる",
    path: ["conversionRank"],
  });
export type Tag = z.infer<typeof Tag>;

/** タグの組み合わせの条件。allOf（全て）・anyOf（いずれか）・noneOf（どれでもない）。 */
export const TagMatch = z
  .strictObject({
    allOf: z.array(TagId).min(1).optional(),
    anyOf: z.array(TagId).min(1).optional(),
    noneOf: z.array(TagId).min(1).optional(),
  })
  .refine((m) => m.allOf ?? m.anyOf ?? m.noneOf, {
    message: "allOf・anyOf・noneOf のどれか1つは書く",
  });
export type TagMatch = z.infer<typeof TagMatch>;

// ---------------------------------------------------------------------------
// 能力値（開発計画書 6.2）

export const STAT_UNITS = [
  "number", // そのままの数（最大HP、防具値など）
  "ratio", // 割合（0.1 ＝ 10%。会心率・耐性など）
  "seconds", // 秒数
] as const;

export const Stat = z.strictObject({
  id: StatId,
  unit: z.enum(STAT_UNITS),
  ...entryBase,
});
export type Stat = z.infer<typeof Stat>;

// ---------------------------------------------------------------------------
// ルールフック（開発計画書 6.1：本体に登録された名前の一覧）

export const HOOK_PARAM_TYPES = ["number", "integer", "boolean", "string", "tag", "stat"] as const;
export const HookParamType = z.enum(HOOK_PARAM_TYPES);

export const Hook = z.strictObject({
  id: HookId,
  /** パラメータの名前と型。データから呼び出すときは、ここにある名前を全て渡す。 */
  params: z.record(z.string().regex(/^[a-z][A-Za-z0-9]*$/), HookParamType),
  ...entryBase,
});
export type Hook = z.infer<typeof Hook>;

// ---------------------------------------------------------------------------
// 効果と修正値（開発計画書 6.4、本仕様書 10.1）

/**
 * 効果の出どころ。乗算を持てる出どころは本仕様書 2.4 で限られている（validate.ts で検査する）。
 */
export const EFFECT_SOURCES = [
  "base_implicit", // ベースの基本刻印
  "affix", // 詞
  "unique", // ユニークの固有効果
  "unique_potential", // ユニークの潜在効果
  "set_bonus", // セットの途中の段階
  "set_max_tier", // セットの最大段階
  "star_minor", // 小星
  "star_notable", // 輝星
  "keystone", // 天極
  "mutation", // 転変
  "job_board", // 職紋盤のノード
  "job_skill", // 職技
  "job_mastery", // 職奥義
  "ailment", // 状態異常
  "temporary", // 一時的な効果（薬瓶など）
] as const;
export const EffectSource = z.enum(EFFECT_SOURCES);
export type EffectSource = z.infer<typeof EffectSource>;

/** 乗算を持てる出どころ（本仕様書 2.4・8.3）。 */
export const MULTIPLIER_SOURCES: readonly EffectSource[] = [
  "keystone",
  "unique",
  "job_skill",
  "job_mastery",
  "set_max_tier",
  "ailment",
];
/** 減らす方向（1未満）の乗算だけを持てる出どころ（本仕様書 2.4【v0.2】）。 */
export const REDUCING_MULTIPLIER_SOURCES: readonly EffectSource[] = ["mutation"];

/** 効く範囲（本仕様書 10.1）。 */
export const EFFECT_SCOPES = ["self", "self_skills", "minions", "enemies", "allies"] as const;

/** 発動の条件。U-03 で評価の仕組みを作るときに種類を足す。 */
export const Condition = z.discriminatedUnion("type", [
  /** 技・装備中の武器・敵のタグが条件に合う。 */
  z.strictObject({
    type: z.literal("tags"),
    subject: z.enum(["skill", "equipped_weapon", "target"]),
    match: TagMatch,
  }),
  /** そのタグを持つ装備を、min個以上装備している。 */
  z.strictObject({
    type: z.literal("equipped_count"),
    tag: TagId,
    min: z.int().min(1),
  }),
  /** 能力値が value 以上（星門など。判定は本仕様書 4.9.1 の第1段階の値で行う）。 */
  z.strictObject({
    type: z.literal("stat_at_least"),
    stat: StatId,
    value: z.number(),
  }),
]);
export type Condition = z.infer<typeof Condition>;

const modifierBase = {
  /** この修正値だけに付く条件（効果全体の条件に加えて判定する）。 */
  conditions: z.array(Condition).min(1).optional(),
};
const statModifierBase = {
  ...modifierBase,
  stat: StatId,
  /** 対象を絞るタグ（例：出血だけ）。 */
  filter: TagMatch.optional(),
};

/** 加算％の範囲：-100%〜+1000%（値の誤り、例えば 6 と 0.06 の書き間違いを見つけるため）。 */
export const INCREASED_RANGE = { min: -1, max: 10 } as const;
/** 乗算の範囲：0より大きく、3以下。 */
export const MORE_RANGE = { minExclusive: 0, max: 3 } as const;

export const Modifier = z.discriminatedUnion("kind", [
  /** 追加値：基礎値に足す。技倍率を受ける（本仕様書 2.4）。 */
  z.strictObject({ kind: z.literal("added"), ...statModifierBase, value: z.number() }),
  /** 固定の追加：技倍率を受けない追加分（本仕様書 2.4【v0.2】）。 */
  z.strictObject({ kind: z.literal("flat_bonus"), ...statModifierBase, value: z.number() }),
  /** 加算％：加算の合計に足す（0.06 ＝ +6%）。 */
  z.strictObject({
    kind: z.literal("increased"),
    ...statModifierBase,
    value: z.number().min(INCREASED_RANGE.min).max(INCREASED_RANGE.max),
  }),
  /** 乗算：積に掛ける（0.8 ＝ ×0.8）。持てる出どころは限られる。 */
  z.strictObject({
    kind: z.literal("more"),
    ...statModifierBase,
    value: z.number().gt(MORE_RANGE.minExclusive).max(MORE_RANGE.max),
  }),
  /** 上限：上限の値を変える（耐性の上限など）。 */
  z.strictObject({ kind: z.literal("cap"), ...statModifierBase, value: z.number() }),
  /** 上書き：値を置き換える。同じ能力値の上書きは priority で決め、同じ優先度は作らない（2.4.1-4）。 */
  z.strictObject({
    kind: z.literal("override"),
    ...statModifierBase,
    value: z.union([z.number(), z.boolean()]),
    priority: z.int(),
  }),
  /** 変換：属性を一方向に変える（本仕様書 2.5）。value は割合。 */
  z.strictObject({
    kind: z.literal("conversion"),
    ...modifierBase,
    from: TagId,
    to: TagId,
    value: z.number().gt(0).max(1),
  }),
  /** 付け替え：属性を別の属性として扱い直す（本仕様書 2.5【v0.2】）。 */
  z.strictObject({ kind: z.literal("reattribution"), ...modifierBase, from: TagId, to: TagId }),
  /** 挙動：ルールフックを呼び出す。 */
  z.strictObject({
    kind: z.literal("behavior"),
    ...modifierBase,
    hook: HookId,
    params: z.record(z.string(), z.union([z.number(), z.boolean(), z.string()])).optional(),
  }),
]);
export type Modifier = z.infer<typeof Modifier>;

export const Effect = z.strictObject({
  id: EffectId,
  source: EffectSource,
  /** どのタグを持つものに効くか。書かなければ全てに効く。 */
  targetTags: TagMatch.optional(),
  /** 発動の条件（全てを満たすときに効く）。空なら常に効く。 */
  conditions: z.array(Condition).default([]),
  modifiers: z.array(Modifier).min(1),
  scope: z.enum(EFFECT_SCOPES),
  /** 積み重ねたときの上限（回数）。 */
  maxStacks: z.int().min(1).optional(),
  /** 打撃値・基準値への影響（明記を必須にする。本仕様書 9章 V-07、開発計画書 6.1-4）。 */
  affects: z.strictObject({ hit: z.boolean(), base: z.boolean() }),
  ...entryBase,
});
export type Effect = z.infer<typeof Effect>;

// ---------------------------------------------------------------------------
// データファイル

/** データファイルの種類と、その項目のスキーマ。 */
export const DATA_KINDS = {
  tags: Tag,
  stats: Stat,
  hooks: Hook,
  effects: Effect,
} as const;
export type DataKind = keyof typeof DATA_KINDS;

/** ファイルの外枠（項目のスキーマは種類ごとに validate.ts で当てる）。 */
export const DataFileEnvelope = z.strictObject({
  schemaVersion: z.int().min(1),
  kind: z.enum(Object.keys(DATA_KINDS) as [DataKind, ...DataKind[]]),
  entries: z.array(z.unknown()),
});
