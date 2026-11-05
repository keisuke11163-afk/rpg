import { z } from "zod";
import { ELEMENTS } from "./effect.ts";
import { idSchema, provisionalFields } from "./ids.ts";

/** 敵が崩れたとき・崩しゲージの設定（仕様書v0.2 2.7・補助仕様書 3.3）。 */
const staggerProfileSchema = z.strictObject({
  /** 崩しゲージの最大値 ＝ 最大HP × この値。 */
  gaugeRatio: z.number().positive(),
  /** 崩しを受けない状態がこの秒数続くと、ゲージが減り始める。 */
  decayDelay: z.number().nonnegative(),
  /** 減り始めた後、毎秒減る量（最大値に対する割合）。 */
  decayPerSecond: z.number().nonnegative(),
  /** 崩れている時間（秒）。ダウン・怯み・よろめき。 */
  breakDuration: z.number().positive(),
  /** 崩れている間に受けるダメージの倍率（プレイヤーは1）。 */
  takenMultiplier: z.number().positive(),
  /** 崩れるたびに、ゲージの最大値に掛ける倍率（ボスは1.5、それ以外は1）。 */
  growthPerBreak: z.number().positive(),
});
export type StaggerProfile = z.infer<typeof staggerProfileSchema>;

const common = {
  id: idSchema,
  /** この状態異常の星紋タグ（分類 ailment）。 */
  tag: idSchema,
  ...provisionalFields,
};

/**
 * 状態異常の定義（仕様書v0.2 2.7）。
 * - dot：持続ダメージ（燃焼・出血・毒）
 * - debuff：敵の能力を下げる（衰弱）
 * - stagger：崩し
 * - pending：MVPの範囲外で、まだ計算を実装していないもの（冷却・凍結・感電・聖痕）
 */
export const ailmentSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...common,
    kind: z.literal("dot"),
    /** 基準値を合計する属性（例：毒は物理と闇）。この属性のダメージを含むヒットだけが付与できる。 */
    sourceElements: z.array(z.enum(ELEMENTS)).min(1),
    /** 持続ダメージの属性（耐性に使う）。 */
    dotElement: z.enum(ELEMENTS),
    /** 1回の付与（1スタック）で与える総量 ＝ 基準値 × この値。 */
    totalRatio: z.number().positive(),
    /** 持続（秒）。 */
    duration: z.number().positive(),
    /** stack＝重ねる（maxStacks を省略すると上限なし）、strongest＝最も強いもの1つだけ。 */
    stacking: z.discriminatedUnion("mode", [
      z.strictObject({
        mode: z.literal("stack"),
        maxStacks: z.number().int().positive().optional(),
      }),
      z.strictObject({ mode: z.literal("strongest") }),
    ]),
    /** 敵が移動しているときのダメージの倍率（出血は2）。 */
    movingMultiplier: z.number().positive().optional(),
  }),
  z.strictObject({
    ...common,
    kind: z.literal("debuff"),
    sourceElements: z.array(z.enum(ELEMENTS)).min(1),
    duration: z.number().positive(),
    /** 付与された敵の与えるダメージの倍率（衰弱は0.85）。 */
    dealtMultiplier: z.number().positive(),
    /** ボスの場合の倍率（衰弱は0.92）。 */
    bossDealtMultiplier: z.number().positive(),
  }),
  z.strictObject({
    ...common,
    kind: z.literal("stagger"),
    /** 技に崩し係数がないときの値。 */
    defaultCoefficient: z.number().nonnegative(),
    enemy: staggerProfileSchema,
    boss: staggerProfileSchema,
    player: staggerProfileSchema,
  }),
  z.strictObject({
    ...common,
    kind: z.literal("pending"),
    /** まだ実装していない理由・実装する時期。 */
    note: z.string(),
  }),
]);
export type AilmentDef = z.infer<typeof ailmentSchema>;
export type DotAilmentDef = Extract<AilmentDef, { kind: "dot" }>;
export type DebuffAilmentDef = Extract<AilmentDef, { kind: "debuff" }>;
export type StaggerAilmentDef = Extract<AilmentDef, { kind: "stagger" }>;
