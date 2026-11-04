import { z } from "zod";

const range = z.strictObject({ min: z.number().nonnegative(), max: z.number().nonnegative() });
const elementRanges = z.partialRecord(
  z.enum(["physical", "lightning", "cold", "fire", "dark", "holy"]),
  range,
);

/**
 * シミュレーターで使う技。
 * 職技のデータ（U-08）ができるまでは、ビルドの中に直接書く。U-08 の後は、技のIDで参照する形に置き換える。
 */
export const simSkillSchema = z.strictObject({
  name: z.string(),
  tags: z.array(z.string()),
  kind: z.enum(["weapon", "spell"]),
  /** 技倍率（技レベル1のとき）。 */
  pct: z.number().positive(),
  /** 呪文の基礎値（技レベル1のとき）。 */
  base: elementRanges.optional(),
  mpCost: z.number().nonnegative(),
  cooldown: z.number().nonnegative(),
  /** 動作の時間の倍率（1＝1回の攻撃の時間）。呪文は詠唱の時間（秒）を castTime に書く。 */
  useTimeMultiplier: z.number().positive().optional(),
  castTime: z.number().positive().optional(),
  /** 1回の使用でのヒットの数（連刃なら3）。 */
  hits: z.number().int().positive().optional(),
  /** 技の基本付与率（状態異常のタグ → 0〜1）。 */
  ailmentChance: z.record(z.string(), z.number().min(0).max(1)).optional(),
  /** 崩し係数。 */
  staggerCoefficient: z.number().nonnegative().optional(),
});
export type SimSkill = z.infer<typeof simSkillSchema>;

/** シミュレーターで使うビルド（装備＋ツリー＋ジョブを、効果の一覧として書く）。 */
export const buildSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  note: z.string().optional(),
  characterLevel: z.number().int().min(1).max(100),
  /** 能力値の基礎の値（STAT-… のID → 値。例：命中 ＝ 2×キャラLv＋3×迅）。 */
  baseStats: z.record(z.string(), z.number()).optional(),
  /** 能力値「理」（最大MP ＝ 60 ＋ 理×1.5。仕様書v0.2 2.3・2.2）。 */
  ri: z.number().nonnegative().optional(),
  weapon: z
    .strictObject({
      uid: z.string(),
      tags: z.array(z.string()),
      base: elementRanges,
      critChance: z.number().min(0).max(1),
      /** 武器の速度（回/秒。仕様書3.2）。 */
      attackSpeed: z.number().positive(),
    })
    .optional(),
  effects: z
    .array(
      z.union([
        z.string(),
        z.strictObject({
          id: z.string(),
          stacks: z.number().nonnegative().optional(),
          source: z.string().optional(),
        }),
      ]),
    )
    .optional(),
  /** 優先順位の高い順。使える技のうち、最初のものを使う。 */
  rotation: z.array(simSkillSchema).min(1),
});
export type Build = z.infer<typeof buildSchema>;

/** 標準の的。 */
export const targetSchema = z.strictObject({
  name: z.string(),
  level: z.number().int().min(1).max(100),
  /** HP（省略すると倒れない。DPSを測る的）。 */
  maxHp: z.number().positive().optional(),
  isBoss: z.boolean().optional(),
  resist: z.record(z.string(), z.number()).optional(),
  armor: z.number().nonnegative().optional(),
  evasion: z.number().nonnegative().optional(),
  /** 移動している時間の割合（出血の2倍に使う）。 */
  movingRatio: z.number().min(0).max(1).optional(),
  /** 的の攻撃（受けたダメージを測る）。 */
  attack: z
    .strictObject({
      /** 1回のダメージ ＝ 標準HP × この割合（補助仕様書 10.1）。 */
      ratioOfStandardHp: z.number().positive(),
      interval: z.number().positive(),
      element: z.enum(["physical", "lightning", "cold", "fire", "dark", "holy"]),
      accuracy: z.number().nonnegative().optional(),
      /** 呪文（回避されない）なら true。 */
      spell: z.boolean().optional(),
    })
    .optional(),
});
export type Target = z.infer<typeof targetSchema>;
