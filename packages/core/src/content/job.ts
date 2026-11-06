import { z } from "zod";
import { ELEMENTS } from "./effect.ts";
import { idSchema, provisionalFields, textKeySchema } from "./ids.ts";

/** 武器適性（仕様書5.1）。 */
export const AFFINITIES = ["S", "A", "B", "C"] as const;
export type Affinity = (typeof AFFINITIES)[number];

const range = z.strictObject({ min: z.number().nonnegative(), max: z.number().nonnegative() });

/** 当たり判定の形（補助仕様書3.6。単位はm）。 */
export const hitShapeSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("circle"), radius: z.number().positive() }),
  z.strictObject({
    type: z.literal("sector"),
    radius: z.number().positive(),
    angleDeg: z.number().positive().max(360),
  }),
  z.strictObject({
    type: z.literal("line"),
    length: z.number().positive(),
    width: z.number().positive(),
  }),
]);

/** 技の特別な挙動（ルールフック）。名前は KNOWN_HOOKS に登録されたもの。 */
const skillBehaviorSchema = z.strictObject({
  hook: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
  params: z.record(z.string(), z.number()).optional(),
});

/** 技の変化（激化・武器による変化）で変えるもの。 */
export const skillModsSchema = z.strictObject({
  /** 扇形の角度を置き換える。 */
  angleDeg: z.number().positive().max(360).optional(),
  /** 当たり判定の大きさ（半径・長さ）の倍率。 */
  areaMultiplier: z.number().positive().optional(),
  /** 崩し値の加算（0.3＝+30%）。 */
  staggerIncreased: z.number().optional(),
  /** 状態異常の基本付与率に足す（状態異常のタグ → 0〜1）。 */
  ailmentChance: z.record(idSchema, z.number().min(0).max(1)).optional(),
  /** 突進の距離に足す（m）。 */
  distanceAdd: z.number().optional(),
  /** 持続する技の、1秒あたりのヒットの数を置き換える。 */
  hitsPerSecond: z.number().positive().optional(),
  /** 技倍率を置き換える。 */
  pct: z.number().positive().optional(),
  /** 戦吼の範囲の倍率。 */
  radiusMultiplier: z.number().positive().optional(),
  /** 加える挙動。 */
  behaviors: z.array(skillBehaviorSchema).optional(),
});
export type SkillMods = z.infer<typeof skillModsSchema>;

/** 技の動き方。 */
export const skillActionSchema = z.discriminatedUnion("type", [
  // 当たり判定を1回出す（薙ぎ払い・地割り・破軍・通常攻撃）
  z.strictObject({ type: z.literal("strike"), shape: hitShapeSchema }),
  // 決まった距離を進み、通った敵に当てる（突進）
  z.strictObject({
    type: z.literal("dash"),
    distance: z.number().positive(),
    duration: z.number().positive(),
    width: z.number().positive(),
  }),
  // 周りの味方を強め、敵を弱める（戦吼）
  z.strictObject({
    type: z.literal("warcry"),
    radius: z.number().positive(),
    duration: z.number().positive(),
    allyEffects: z.array(idSchema),
    enemyEffects: z.array(idSchema).optional(),
  }),
  // 押し続けている間、一定の間隔で当たり判定を出す（旋風）
  z.strictObject({
    type: z.literal("channel"),
    shape: hitShapeSchema,
    hitsPerSecond: z.number().positive(),
    /** MPを使う間隔（秒）と量（技の mpCost は始めるときの分）。 */
    mpInterval: z.number().positive(),
    mpPerInterval: z.number().nonnegative(),
    /** 移動の速さの倍率（旋風は0.8）。 */
    moveSpeedMultiplier: z.number().positive(),
  }),
]);
export type SkillAction = z.infer<typeof skillActionSchema>;

/** 技の定義（仕様書5章、補助仕様書3.5・3.6）。 */
export const skillSchema = z.strictObject({
  id: idSchema,
  text: textKeySchema,
  /** 技のジョブ（全ジョブ共通の技なら省略）。 */
  job: idSchema.optional(),
  tags: z.array(idSchema),
  kind: z.enum(["weapon", "spell"]),
  /** 技倍率（技レベル1のとき。ダメージを与えない技（戦吼）は0）。 */
  pct: z.number().nonnegative(),
  /** 呪文の基礎値。 */
  base: z.partialRecord(z.enum(ELEMENTS), range).optional(),
  mpCost: z.number().nonnegative(),
  cooldown: z.number().nonnegative(),
  /** 動作の時間の倍率（1＝1回の攻撃の時間）。 */
  useTimeMultiplier: z.number().positive().optional(),
  action: skillActionSchema,
  /** 崩し係数（補助仕様書3.6）。省略すると崩しの定義の既定値。 */
  staggerCoefficient: z.number().nonnegative().optional(),
  /** 状態異常の基本付与率（状態異常のタグ → 0〜1）。 */
  ailmentChance: z.record(idSchema, z.number().min(0).max(1)).optional(),
  /** 職能ゲージ：必要な量・使う量（all は全て）・使ったときに増える量。 */
  gauge: z
    .strictObject({
      requires: z.number().nonnegative().optional(),
      cost: z.union([z.number().nonnegative(), z.literal("all")]).optional(),
      gainOnUse: z.number().nonnegative().optional(),
    })
    .optional(),
  /** 使った後、自分に一定時間かかる効果（破軍の「受けるダメージ-20%」など）。 */
  selfEffects: z
    .array(z.strictObject({ effect: idSchema, duration: z.number().positive() }))
    .optional(),
  /** ゲージの段階による変化（激化）。 */
  stageVariants: z.array(z.strictObject({ stage: z.string(), mods: skillModsSchema })).optional(),
  /** 武器による変化（武器のタグ、または親タグ）。 */
  weaponVariants: z
    .array(z.strictObject({ weaponTag: idSchema, mods: skillModsSchema }))
    .optional(),
  /** 二刀流のときの変化。 */
  dualWieldVariant: skillModsSchema.optional(),
  /** 必要な武器適性（仕様書v0.2 5.1：省略すると、どの適性でも使える）。 */
  requiredAffinity: z.enum(AFFINITIES).optional(),
  ...provisionalFields,
});
export type SkillDef = z.infer<typeof skillSchema>;

/** 職能ゲージの定義（仕様書5章）。 */
export const gaugeSchema = z.strictObject({
  id: idSchema,
  text: textKeySchema,
  max: z.number().positive(),
  gains: z.array(
    z.discriminatedUnion("on", [
      // ヒットを与えたとき。tag を持つ技のヒットなら value の代わりに tagValue（例：重撃は+6）
      z.strictObject({
        on: z.literal("hitDealt"),
        value: z.number(),
        tag: idSchema.optional(),
        tagValue: z.number().optional(),
      }),
      // ダメージを受けたとき：最大HPの1%につき value
      z.strictObject({ on: z.literal("damageTaken"), valuePerPercentOfMaxHp: z.number() }),
    ]),
  ),
  /** 戦闘外（補助仕様書3.1：5秒間、攻撃も被弾もない）で毎秒減る量。 */
  decayOutOfCombat: z.number().nonnegative(),
  /** 段階（例：50以上で激化、100で解放）。 */
  stages: z.array(
    z.strictObject({ id: z.string(), min: z.number().nonnegative(), text: textKeySchema }),
  ),
  ...provisionalFields,
});
export type GaugeDef = z.infer<typeof gaugeSchema>;

/** ジョブの定義（仕様書5章）。 */
export const jobSchema = z.strictObject({
  id: idSchema,
  tag: idSchema,
  text: textKeySchema,
  gauge: idSchema.optional(),
  /** 技と、覚えるジョブLv（補助仕様書3.5）。 */
  skills: z.array(z.strictObject({ skill: idSchema, level: z.number().int().min(1) })),
  /** 武器の種類のタグ → 適性（仕様書5章）。書かれていない武器はC。 */
  affinity: z.record(idSchema, z.enum(AFFINITIES)),
  /** 二刀流の適性（できないジョブは省略）。 */
  dualWield: z.enum(AFFINITIES).optional(),
  ...provisionalFields,
});
export type JobDef = z.infer<typeof jobSchema>;
