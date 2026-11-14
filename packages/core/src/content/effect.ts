import { z } from "zod";
import { idSchema, provisionalFields } from "./ids.ts";
import { EQUIP_SLOTS, FACTS, FLAGS, REPLACE_SLOTS } from "./registries.ts";

/**
 * 効果の出どころ（仕様書 2.4・8.3、開発計画書 6.4）。
 * 乗算を持てる出どころは限られている（MORE_ALLOWED_ORIGINS）。
 */
export const EFFECT_ORIGINS = [
  "minorStar", // 小星
  "notableStar", // 輝星
  "mutation", // 転変ノード（乗算は減らす方向だけ）
  "keystone", // 天極
  "constellation", // 星座の完成ボーナス
  "jobNode", // 職紋盤のノード
  "subJob", // サブジョブ（副職紋のノード。職紋盤の効果を読み替える。乗算は持てない＝jobNode と同じ。docs/progress D-SUB-3）
  "jobMastery", // 職奥義
  "jobSkill", // 職技・職能（ゲージの段階・上位職の仕組みを含む）
  "schoolNode", // 流派盤のノード
  "affix", // 詞（星詞を含む）
  "implicit", // 基本刻印・武器の特性
  "unique", // ユニークの固有効果
  "uniqueLatent", // ユニークの潜在効果
  "set", // セットの段階（最大の段階を除く）
  "setMax", // セットの最大の段階
  "bond", // 縁
  "ailment", // 状態異常（感電・崩しなど）
  "inscription", // 銘
  "attribute", // 能力値（剛・迅・理・魂。仕様書2.2）
] as const;

export type EffectOrigin = (typeof EFFECT_ORIGINS)[number];

/** 乗算（more）を持てる出どころ（仕様書v0.2 2.4）。 */
export const MORE_ALLOWED_ORIGINS: ReadonlySet<EffectOrigin> = new Set<EffectOrigin>([
  "keystone",
  "unique",
  "uniqueLatent",
  "jobSkill",
  "jobMastery",
  "setMax",
  "ailment",
]);

/** 減らす方向（1未満）の乗算だけを持てる出どころ（仕様書v0.2 2.4：転変ノード）。 */
export const MORE_REDUCTION_ONLY_ORIGINS: ReadonlySet<EffectOrigin> = new Set<EffectOrigin>([
  "mutation",
]);

/** 属性（仕様書 2.5）。変換の順序は ELEMENT_CONVERSION_ORDER。 */
export const ELEMENTS = ["physical", "lightning", "cold", "fire", "dark", "holy"] as const;
export type Element = (typeof ELEMENTS)[number];

/** タグの条件。全て省略した場合は、常に当てはまる。 */
export const tagFilterSchema = z.strictObject({
  allOf: z.array(idSchema).optional(),
  anyOf: z.array(idSchema).optional(),
  noneOf: z.array(idSchema).optional(),
});
export type TagFilter = z.infer<typeof tagFilterSchema>;

const base = {
  /** この修正値が効く条件（技・ヒットのタグ）。 */
  filter: tagFilterSchema.optional(),
  /**
   * ユニークの固有効果の「代償」（仕様書v0.2 3.11.5：残響にしても数値は100%のまま）。
   * 印の無い数値は「利点」として残響で50%になる（MVP後の機能の提案 1-1 案A）。
   */
  drawback: z.boolean().optional(),
  /**
   * 数値で表したルールの切り替え（例：狼牙の首飾りの「出血が移る」＝1）。残響にしても数値を変えない
   * （3.11.5「ルール部分はそのまま」。docs/progress D-ECHO-2）。
   */
  echoRule: z.boolean().optional(),
};

const rangeSchema = z
  .strictObject({ min: z.number().nonnegative(), max: z.number().nonnegative() })
  .refine((r) => r.min <= r.max, "最小値が最大値を超えている");

/** 修正値（開発計画書 6.4 の種類）。 */
export const modifierSchema = z.discriminatedUnion("kind", [
  // 追加値：技倍率を受ける（仕様書v0.2 2.4）
  z.strictObject({
    kind: z.literal("added"),
    stat: idSchema,
    value: z.union([z.number(), rangeSchema]),
    ...base,
  }),
  // 固定の追加：技倍率を受けない（仕様書v0.2 2.4）
  z.strictObject({
    kind: z.literal("fixedAdded"),
    stat: idSchema,
    value: z.union([z.number(), rangeSchema]),
    ...base,
  }),
  // 加算％（0.3＝+30%）
  z.strictObject({
    kind: z.literal("increased"),
    stat: idSchema,
    value: z.number().min(-10).max(10),
    ...base,
  }),
  // 乗算（1.2＝×1.2）
  z.strictObject({
    kind: z.literal("more"),
    stat: idSchema,
    value: z.number().positive().max(10),
    ...base,
  }),
  // 変換（仕様書 2.5）：0.15＝15%
  z.strictObject({
    kind: z.literal("convert"),
    from: z.enum(ELEMENTS),
    to: z.enum(ELEMENTS),
    value: z.number().gt(0).max(1),
    ...base,
  }),
  // 付け替え（仕様書v0.2 2.5）
  z.strictObject({
    kind: z.literal("retag"),
    from: z.array(z.enum(ELEMENTS)).min(1),
    to: z.enum(ELEMENTS),
    ...base,
  }),
  // 上限の変更
  z.strictObject({ kind: z.literal("cap"), stat: idSchema, value: z.number(), ...base }),
  // 上書き（仕様書v0.2 2.4.1 の4：同じ能力値・同じ優先度の上書きは作らない）
  z.strictObject({
    kind: z.literal("override"),
    stat: idSchema,
    value: z.number(),
    priority: z.number().int(),
    ...base,
  }),
  // 挙動：本体に登録されたルールフックを呼ぶ
  z.strictObject({
    kind: z.literal("behavior"),
    hook: z.string().regex(/^[a-z][a-zA-Z0-9]*$/, "フックの名前は小文字で始まる英数字"),
    params: z.record(z.string(), z.unknown()).optional(),
    ...base,
  }),
  // 「必ず〜する」（force）／「〜しない」（forbid）。禁止は強制に勝つ（仕様書v0.2 2.4.1 の規則1）
  z.strictObject({
    kind: z.literal("flag"),
    flag: z.enum(FLAGS),
    mode: z.enum(["force", "forbid"]),
    /** 対象のタグ（ailmentApply では状態異常のタグ）。 */
    target: idSchema.optional(),
    ...base,
  }),
  // 入力・枠の置き換え。複数あるときは出どころの順位で1つだけ有効（仕様書v0.2 2.4.1 の規則2）
  z.strictObject({
    kind: z.literal("replace"),
    slot: z.enum(REPLACE_SLOTS),
    /** 置き換えた後の挙動（ルールフックの名前）。 */
    hook: z.string().regex(/^[a-z][a-zA-Z0-9]*$/, "フックの名前は小文字で始まる英数字"),
    ...base,
  }),
]);
export type Modifier = z.infer<typeof modifierSchema>;

/**
 * 効果が働く条件（仕様書v0.2 4.9.1）。条件は「第1段階の値」（条件のない効果だけで計算した値）で判定する。
 */
export const conditionSchema = z.discriminatedUnion("type", [
  // 能力値が一定以上（例：理の門「理が200以上」）
  z.strictObject({ type: z.literal("statAtLeast"), stat: idSchema, value: z.number() }),
  // 事実が一定以上（例：重荷の誇り「重装4部位以上」）
  z.strictObject({ type: z.literal("factAtLeast"), fact: z.enum(FACTS), value: z.number() }),
  // 装備のタグ（例：刃の門「主手に剣系」）。slot を省略すると、どの部位でもよい
  z.strictObject({
    type: z.literal("equippedTag"),
    tag: idSchema,
    slot: z.enum(EQUIP_SLOTS).optional(),
  }),
  // メインジョブ（例：潜在効果【黒騎士】）
  z.strictObject({ type: z.literal("mainJob"), job: idSchema }),
]);
export type Condition = z.infer<typeof conditionSchema>;

/**
 * 効果の定義（仕様書 10.1、開発計画書 6.4）。
 * 全ての効果に「打撃値・基準値への影響」と「範囲」を明記する（開発計画書 6.1 の原則4）。
 */
export const effectSchema = z.strictObject({
  id: idSchema,
  origin: z.enum(EFFECT_ORIGINS),
  modifiers: z.array(modifierSchema).min(1),
  /** 全ての条件を満たしたときだけ働く（省略すると常に働く）。 */
  conditions: z.array(conditionSchema).optional(),
  /** ダメージを変える修正値が、打撃値・基準値に効くか（仕様書 2.7、V-07）。 */
  affects: z.strictObject({ hit: z.boolean(), ailmentBase: z.boolean() }),
  /** 範囲（仕様書 10.1）。 */
  scope: z.enum(["self", "minions", "enemies", "allies"]),
  /** 効く範囲（仕様書v0.2 3.7 の原則5）。武器の効果は local（その武器のヒットだけ）。 */
  locality: z.enum(["local", "global"]).optional(),
  ...provisionalFields,
});
export type EffectDef = z.infer<typeof effectSchema>;
