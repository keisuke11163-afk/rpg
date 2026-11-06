import { z } from "zod";
import { ELEMENTS } from "./effect.ts";
import { idSchema, provisionalFields, textKeySchema } from "./ids.ts";
import { hitShapeSchema } from "./job.ts";

/** 連続の当たり判定・連続の雲（回数・間隔）。 */
const repeatSchema = z.strictObject({
  count: z.number().int().min(2),
  interval: z.number().positive(),
});

/** 地面に残る雲（腐根の暴走の毒だまり）。中にいると、間隔ごとに状態異常を1つ受ける。 */
const residueSchema = z.strictObject({
  radius: z.number().positive(),
  duration: z.number().positive(),
  interval: z.number().positive(),
  ailment: idSchema,
  /** 状態異常の基準値（標準HPに対する割合）。 */
  baseRatio: z.number().positive(),
});
export type EnemyResidue = z.infer<typeof residueSchema>;

/** 攻撃の届け方。 */
export const enemyDeliverySchema = z.discriminatedUnion("type", [
  // 自分の位置から、向きに合わせて当たり判定を出す（噛みつき・爪・叩きつけ）。
  // repeat があれば、当たり判定が出ている間に間隔ごとに続けて出す（群れ長の大牙の噛みつき3連。それぞれ1回当たる）
  // aim が target なら、予兆の始めの相手の位置に出す（母樹の根の叩きつけ）。連続なら、2回目からは
  // 前の1回が出た瞬間の相手の位置に出す（間隔が次の予兆になる）。residue があれば、出た場所に雲が残る
  z.strictObject({
    type: z.literal("strike"),
    shape: hitShapeSchema,
    repeat: repeatSchema.optional(),
    aim: z.enum(["self", "target"]).optional(),
    residue: residueSchema.optional(),
  }),
  // 決まった距離を、決まった速さで、曲がらずに進む（牙猪の突進）。通り道の相手に1回だけ当たる
  z.strictObject({
    type: z.literal("dash"),
    distance: z.number().positive(),
    speed: z.number().positive(),
    width: z.number().positive(),
  }),
  // 投射物を撃つ（棘吐き蜥蜴の棘）
  z.strictObject({
    type: z.literal("projectile"),
    speed: z.number().positive(),
    range: z.number().positive(),
    radius: z.number().positive(),
  }),
  // 仲間を呼ぶ（群れ長の大牙の遠吠え）。呼んだ仲間と周りの同じ種類の敵の攻撃速度を、一定時間だけ上げる
  z.strictObject({
    type: z.literal("summon"),
    enemy: idSchema,
    count: z.number().int().positive(),
    /** 呼ぶ位置の、自分からの距離（m）。 */
    radius: z.number().positive(),
    /** 周りの敵の攻撃速度の強化（攻撃の予兆・当たり判定・硬直の時間が 1÷(1＋increase) になる）。 */
    haste: z
      .strictObject({
        increase: z.number().positive(),
        duration: z.number().positive(),
        radius: z.number().positive(),
      })
      .optional(),
  }),
  // 予兆の始めの、相手の位置に雲を出す。中にいると、間隔ごとに状態異常を1つ受ける（腐根の苗の胞子）。
  // count が2以上なら、1つ目を相手の位置に、残りをその周り（spread m）に等しい角度で出す（母樹の毒の胞子）。
  // repeat があれば、間隔ごとに、その瞬間の相手の位置へ続けて出す（深淵の母樹の2回連続）
  z.strictObject({
    type: z.literal("cloud"),
    radius: z.number().positive(),
    duration: z.number().positive(),
    interval: z.number().positive(),
    ailment: idSchema,
    /** 状態異常の基準値（標準HPに対する割合）。 */
    baseRatio: z.number().positive(),
    count: z.number().int().positive().optional(),
    spread: z.number().positive().optional(),
    repeat: repeatSchema.optional(),
  }),
  // 地中を移動し、別の地点（ボスの間の根渡りの地点）に現れる（母樹の根渡り）。当たり判定が出ている時間の
  // 間は地中にいて、ダメージを受けず、狙われない。移動しているので、出血の「移動中は2倍」が働く
  z.strictObject({ type: z.literal("burrow") }),
]);
export type EnemyDelivery = z.infer<typeof enemyDeliverySchema>;

/** 敵の攻撃（補助仕様書10.1・10.4）。 */
export const enemyAttackSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  text: textKeySchema,
  /** 予兆・当たり判定が出ている時間・硬直（秒）。突進の当たり判定の時間は、距離÷速さ。 */
  windup: z.number().nonnegative(),
  active: z.number().nonnegative(),
  recovery: z.number().nonnegative(),
  /** 標準HPに対する割合（攻撃の強さ。0.08＝8%）。雲は0（ダメージは状態異常だけ）。 */
  ratio: z.number().min(0).max(1),
  staggerCoefficient: z.number().nonnegative(),
  element: z.enum(ELEMENTS),
  ailmentChance: z.record(idSchema, z.number().min(0).max(1)).optional(),
  /** この距離（m。体の端から端）以内で使い始める。 */
  range: z.number().positive(),
  /** この距離より近いと使わない（突進）。 */
  minRange: z.number().nonnegative().optional(),
  /** 使った後、次に使えるまでの時間（秒）。 */
  cooldown: z.number().nonnegative(),
  /** 使える攻撃が複数あるときの重み（省略すると1）。 */
  weight: z.number().positive().optional(),
  delivery: enemyDeliverySchema,
  /** ボスの段階（1から）のうち、この攻撃を使う段階。省略すると全ての段階。 */
  phases: z.array(z.number().int().min(1)).min(1).optional(),
});
export type EnemyAttackDef = z.infer<typeof enemyAttackSchema>;

/** 敵の動き方（補助仕様書10.4「行動の特徴」）。 */
export const enemyBehaviorSchema = z.discriminatedUnion("type", [
  // まっすぐ近づく
  z.strictObject({ type: z.literal("chase") }),
  // 相手の横や背後へ回り込む（群れの中の順番で、回り込む角度を変える）
  z.strictObject({ type: z.literal("flank"), distance: z.number().positive() }),
  // 決まった距離を保つ
  z.strictObject({
    type: z.literal("kite"),
    min: z.number().positive(),
    max: z.number().positive(),
  }),
  // 動かない
  z.strictObject({ type: z.literal("stationary") }),
]);
export type EnemyBehavior = z.infer<typeof enemyBehaviorSchema>;

/** 敵の種類（補助仕様書10.4）。 */
export const enemySchema = z.strictObject({
  id: idSchema,
  text: textKeySchema,
  /** 敵の系統のタグ（系統がない敵は省略）。 */
  family: idSchema.optional(),
  /** 通常の敵のHP（補助仕様書0.1）に対する倍率。 */
  hpMultiplier: z.number().positive(),
  /** 移動の速さ（m/秒。動かない敵は0）。 */
  moveSpeed: z.number().nonnegative(),
  /** 旋回の速さ（°/秒）。null は向きを持たない（背面判定が起きない。補助仕様書10.1）。 */
  turnRate: z.number().positive().nullable(),
  /** 体の半径（m）。 */
  radius: z.number().positive(),
  defense: z.strictObject({
    evasionPerLevel: z.number().nonnegative().optional(),
    armorPerLevel: z.number().nonnegative().optional(),
    resist: z.partialRecord(z.enum(ELEMENTS), z.number()).optional(),
  }),
  attacks: z.array(enemyAttackSchema).min(1),
  behavior: enemyBehaviorSchema,
  /** 群れの数（単体は1〜1）。 */
  pack: z.strictObject({ min: z.number().int().positive(), max: z.number().int().positive() }),
  /** 倒したときのドロップの出どころ（中ボスは miniBoss。省略すると格〔通常・魔法・精鋭〕）。 */
  dropSource: z.enum(["miniBoss", "chapterBoss", "abyssBoss"]).optional(),
  /** ボス（補助仕様書11章）。段階・段階の切り替えの無敵・攻撃中も向きを変える。 */
  boss: z
    .strictObject({
      /** 最大HP（標準DPS×90秒。補助仕様書11.1・11.2。種類と格の倍率は使わない）。 */
      hp: z.number().positive(),
      /** 次の段階に移るHPの割合（高い順。0.66＝66%）。段階の数は、この数＋1。 */
      phaseThresholds: z.array(z.number().gt(0).lt(1)),
      /** 段階の切り替えで、ダメージを受けない秒数（仕様書8.4）。 */
      transitionInvulnerable: z.number().nonnegative(),
      /** 気づく距離（m。周り全て）。 */
      aggroRange: z.number().positive(),
      /** 倒すたびに得る討伐証（仕様書v0.2 3.12。腐根の母樹と深淵の母樹は共通の討伐証）。 */
      tokens: z.strictObject({ id: idSchema, count: z.number().int().positive() }),
      /** 初めて倒したときに自動で得る隠し星（補助仕様書9.5）。 */
      firstKillSecret: z
        .strictObject({ id: idSchema, explorationPoints: z.number().int().positive() })
        .optional(),
    })
    .optional(),
  ...provisionalFields,
});
export type EnemyDef = z.infer<typeof enemySchema>;

/** 格（補助仕様書10.3）。 */
export const ENEMY_RANKS = ["normal", "magic", "elite"] as const;
export type EnemyRank = (typeof ENEMY_RANKS)[number];

export const enemyRankSchema = z.strictObject({
  id: idSchema,
  rank: z.enum(ENEMY_RANKS),
  text: textKeySchema,
  hpMultiplier: z.number().positive(),
  damageMultiplier: z.number().positive(),
  xpMultiplier: z.number().positive(),
  /** 体の大きさの倍率（精鋭は1.25）。 */
  scale: z.number().positive(),
  ...provisionalFields,
});
export type EnemyRankDef = z.infer<typeof enemyRankSchema>;
