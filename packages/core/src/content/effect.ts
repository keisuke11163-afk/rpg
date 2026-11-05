import { z } from "zod";
import { idSchema, provisionalFields } from "./ids.ts";

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
]);
export type Modifier = z.infer<typeof modifierSchema>;

/**
 * 効果の定義（仕様書 10.1、開発計画書 6.4）。
 * 全ての効果に「打撃値・基準値への影響」と「範囲」を明記する（開発計画書 6.1 の原則4）。
 */
export const effectSchema = z.strictObject({
  id: idSchema,
  origin: z.enum(EFFECT_ORIGINS),
  modifiers: z.array(modifierSchema).min(1),
  /** ダメージを変える修正値が、打撃値・基準値に効くか（仕様書 2.7、V-07）。 */
  affects: z.strictObject({ hit: z.boolean(), ailmentBase: z.boolean() }),
  /** 範囲（仕様書 10.1）。 */
  scope: z.enum(["self", "minions", "enemies", "allies"]),
  /** 効く範囲（仕様書v0.2 3.7 の原則5）。武器の効果は local（その武器のヒットだけ）。 */
  locality: z.enum(["local", "global"]).optional(),
  ...provisionalFields,
});
export type EffectDef = z.infer<typeof effectSchema>;
