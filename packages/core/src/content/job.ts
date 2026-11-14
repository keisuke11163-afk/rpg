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
const baseSkillModsSchema = z.strictObject({
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
  /** 技倍率に掛ける（合成魔法：元の呪文のダメージ×1.8）。置き換えの後に掛ける。 */
  pctMultiplier: z.number().positive().optional(),
  /** 戦吼の範囲の倍率。 */
  radiusMultiplier: z.number().positive().optional(),
  /** 投射物の着弾の範囲の半径（m）を置き換える・足す（蒸爆：元の動き方のまま、着弾の爆発だけを重ねる）。 */
  burst: z.number().positive().optional(),
  /** 連撃の数を置き換える（連刃：爪は4連撃、片手剣は2連撃）。 */
  hits: z.number().int().positive().optional(),
  /** 加える挙動。 */
  behaviors: z.array(skillBehaviorSchema).optional(),
});

/** 技の動き方。 */
export const skillActionSchema = z.discriminatedUnion("type", [
  // 当たり判定を出す（薙ぎ払い・地割り・破軍・通常攻撃）。hits があれば、間隔を空けて連撃する（連刃）
  z.strictObject({
    type: z.literal("strike"),
    shape: hitShapeSchema,
    hits: z.number().int().positive().optional(),
    /** 連撃の間隔（秒）。 */
    hitInterval: z.number().positive().optional(),
  }),
  // 照準の近くの敵の背後へ瞬間移動する（影走り）。対象がいなければ使えない
  z.strictObject({
    type: z.literal("teleport"),
    /** 対象を探す範囲（自分から。m）。 */
    range: z.number().positive(),
    /** 敵の背後の、どれだけ後ろに出るか（体の端から。m）。 */
    behind: z.number().nonnegative(),
  }),
  // 自分に一定時間の効果をかける（毒塗り）
  z.strictObject({
    type: z.literal("selfBuff"),
    effects: z.array(idSchema).min(1),
    duration: z.number().positive(),
  }),
  // 照準の位置（射程内）に、一定時間残る範囲を置く（煙玉）。中の敵に効果をかけ、間隔ごとに状態異常を必ず付ける
  z.strictObject({
    type: z.literal("zone"),
    range: z.number().positive(),
    radius: z.number().positive(),
    duration: z.number().positive(),
    interval: z.number().positive(),
    enemyEffects: z.array(idSchema).optional(),
    /** 中の敵に、間隔ごとに必ず付ける状態異常のタグ。 */
    ailment: idSchema.optional(),
  }),
  // 照準の位置（射程内）に罠を置く。敵が踏むと起爆し、技のダメージを与える（罠設置）
  z.strictObject({
    type: z.literal("trap"),
    range: z.number().positive(),
    radius: z.number().positive(),
    duration: z.number().positive(),
    /** 同時に置ける数。超えると古いものから消える。 */
    max: z.number().int().positive(),
  }),
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
  // 照準の方向に投射物を放つ（弓使いの技・弓の通常攻撃。仕様書v0.2 5.7）。count が2以上なら扇状に広げる。
  // leap があれば、撃ちながら向きと反対へ跳ぶ（跳躍後退）
  z.strictObject({
    type: z.literal("projectile"),
    /** 1回に放つ数。 */
    count: z.number().int().positive(),
    /** 扇の広がり（度。count が1なら使わない）。 */
    spreadDeg: z.number().nonnegative().max(360),
    /** 速さ（m/秒）・射程（m）・半径（m）。 */
    speed: z.number().positive(),
    range: z.number().positive(),
    radius: z.number().positive(),
    /** 貫通する数（0なら最初の1体で消える）。 */
    pierce: z.number().int().nonnegative(),
    /** 向きと反対へ跳ぶ距離（m）と時間（秒）。 */
    leap: z
      .strictObject({ distance: z.number().positive(), duration: z.number().positive() })
      .optional(),
    /** 当たった場所で起きる小さな範囲の半径（m。火球・蒸爆：着弾すると範囲）。当たった敵以外の、範囲内の敵にも同じ技を当てる。 */
    burst: z.number().positive().optional(),
  }),
  // 照準の方向へ、決まった距離まで瞬間移動する（魔法使いの瞬移。仕様書v0.2 5.4）。照準が近ければそこまで
  z.strictObject({
    type: z.literal("blink"),
    distance: z.number().positive(),
  }),
  // 照準の近くの敵に当て、近くの別の敵へ決まった回数だけ連鎖する（魔法使いの雷鎖。仕様書v0.2 5.4）。
  // 同じ敵には1回しか当たらない。対象がいなければ使えない
  z.strictObject({
    type: z.literal("chain"),
    /** 最初の対象を探す範囲（自分から。m）。 */
    range: z.number().positive(),
    /** 連鎖先を探す範囲（今の対象から。m）。 */
    jumpRange: z.number().positive(),
    /** 連鎖の回数（最初の1体は含まない）。 */
    chains: z.number().int().nonnegative(),
  }),
  // 照準の位置（射程内）に、一定時間、間隔ごとに当たり判定を出す範囲を置く（矢の雨）
  z.strictObject({
    type: z.literal("barrage"),
    range: z.number().positive(),
    radius: z.number().positive(),
    duration: z.number().positive(),
    interval: z.number().positive(),
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

/** 技の変化（激化・武器による変化）。動き方・タグを置き換えることもできる（弓の通常攻撃は投射物になる）。 */
export const skillModsSchema = baseSkillModsSchema.extend({
  /** 動き方を置き換える（仕様書v0.2 5章：通常攻撃は弓系では投射）。 */
  action: skillActionSchema.optional(),
  /** 技のタグを置き換える（通常攻撃のタグは、弓系では「投射」）。 */
  tags: z.array(idSchema).optional(),
});
export type SkillMods = z.infer<typeof skillModsSchema>;

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
  /** この技の動作の速さに足す能力値（例：連刃に職紋盤「素早い手」の STAT-JOB-FLURRY-SPEED）。 */
  speedStat: idSchema.optional(),
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
      /** 1回の使用で、1体以上に当たったときに増える量（連刃のコンボ点+1）。 */
      gainOnHit: z.number().nonnegative().optional(),
    })
    .optional(),
  /** 終結技（急所穿ち）：使ったゲージの量1につき技倍率に足す値と、必ず会心になる量。 */
  finisher: z
    .strictObject({
      pctPerPoint: z.number().nonnegative(),
      forceCritAt: z.number().positive().optional(),
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

/** 位相の遷移表の1行：直前の呪文との関係（first＝直前が無い・same＝同じ属性・different＝違う属性）と、位相の増え方。 */
const phaseTransitionSchema = z.strictObject({
  input: z.enum(["first", "same", "different"]),
  add: z.number(),
});

/** 合成魔法の1つ：直前の2つの属性（順不同）で決まり、位相が足りているとき、次の呪文の変化（mods）に変わる。 */
const phaseFusionRowSchema = z.strictObject({
  /** 段階の名前（HUD・テストで使う。例：steam）。 */
  id: z.string(),
  text: textKeySchema,
  elements: z.tuple([z.enum(ELEMENTS), z.enum(ELEMENTS)]),
  /** 呪文に当てはめる変化（動き方・技倍率の倍率・状態異常の付与率など）。 */
  mods: skillModsSchema,
});

/**
 * 位相（魔法使い。仕様書v0.2 5.4・MVP後の機能の提案3章 H-09）の遷移表。
 * 呪文を使うたびに、その属性と直前の属性を比べて、位相が変わる。位相が at に達すると、次の呪文が合成魔法に変わる。
 * ゲージの量そのものが位相。直前の2つの属性は、ゲージの中に覚える（セーブしない）。
 */
const phaseSchema = z.strictObject({
  /** 位相に数える属性（呪文のタグの属性）。 */
  elements: z.array(z.enum(ELEMENTS)).min(1),
  transitions: z.array(phaseTransitionSchema),
  /** 属性を持たない呪文（瞬移・魔法障壁）：ignore＝何もしない・reset＝位相を開始の量に戻す。 */
  neutral: z.enum(["ignore", "reset"]),
  fusion: z.strictObject({
    /** 合成魔法になる位相。 */
    at: z.number().positive(),
    /** 合成魔法を使った後の位相。 */
    after: z.number().nonnegative(),
    /** 合成魔法に変わらない呪文のタグ（隕星：範囲）。 */
    excludeTags: z.array(idSchema),
    table: z.array(phaseFusionRowSchema),
  }),
});
export type PhaseDef = z.infer<typeof phaseSchema>;
export type PhaseFusion = PhaseDef["fusion"]["table"][number];

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
      // 攻撃を受けたとき（回避されなかったヒット1回につき。持続ダメージは含めない）：value（集中は-20）
      z.strictObject({ on: z.literal("hitTaken"), value: z.number() }),
      // 止まっている間：毎秒 perSecond（集中は20。M-23 の仮値）
      z.strictObject({ on: z.literal("stationary"), perSecond: z.number() }),
      // 技の1回の使用で、直前と同じ敵に当てたとき：value（集中は+5。M-23 の仮値）
      z.strictObject({ on: z.literal("hitSameTarget"), value: z.number() }),
    ]),
  ),
  /** 戦闘外（補助仕様書3.1：5秒間、攻撃も被弾もない）で毎秒減る量。 */
  decayOutOfCombat: z.number().nonnegative(),
  /** 位相の遷移表（魔法使い。ゲージの量が位相）。省略すると、位相の仕組みを持たない。 */
  phase: phaseSchema.optional(),
  /** ゲージの量1につき、自分にかける効果（集中：会心率+1%（増加））。値は perPoint × 量。 */
  pointEffect: z.strictObject({ effect: idSchema, perPoint: z.number() }).optional(),
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
  /** 出自にしたときの初期能力値（補助仕様書3.2）。 */
  originAttributes: z
    .strictObject({
      go: z.number().int().nonnegative(),
      jin: z.number().int().nonnegative(),
      ri: z.number().int().nonnegative(),
      kon: z.number().int().nonnegative(),
    })
    .optional(),
  /** 技の枠の初期の並び（枠1から。補助仕様書1.1・3.5。docs/progress D-U12-9）。省略すると通常攻撃だけ。 */
  defaultSlots: z.array(idSchema).max(6).optional(),
  /** 出自にしたときの初期の武器のベース（補助仕様書3.4）。 */
  startingWeapon: idSchema.optional(),
  /** 背面からのヒットの補正（メインジョブのときだけ。盗賊：会心率+10%（固定値）・付与率+25%。仕様書5.6）。 */
  backstabBonus: z
    .strictObject({ critChance: z.number().min(0).max(1), ailmentChance: z.number().min(0).max(1) })
    .optional(),
  /**
   * 適正間合い（メインジョブのときだけ。弓使い：敵との距離が6〜10mなら与ダメージ+20%（加算）、
   * 3m以内なら-20%。仕様書v0.2 5.7）。上限は能力値 STAT-JOB-RANGE-MAX で延びる。
   */
  preferredRange: z
    .strictObject({
      min: z.number().nonnegative(),
      max: z.number().nonnegative(),
      bonus: z.number(),
      close: z.number().nonnegative(),
      closePenalty: z.number(),
    })
    .optional(),
  /**
   * 上位職・混成職の元のジョブ（MVP後の機能の提案 4章：データの形だけ。挙動は変えない）。
   * 上位職は1つ（例：暗殺者 ← 盗賊）、混成職は2つ（例：魔弾射手 ← 弓使い・魔法使い。仕様書v0.2 5.8）。
   */
  advancedFrom: z.array(idSchema).min(1).max(2).optional(),
  /** 上位職・混成職になるための試練（形だけ。内容は上位職ごとの仕様書で決める。M-02）。 */
  trial: z
    .strictObject({
      text: textKeySchema,
      /** 元のジョブに必要なジョブLv（仕様書v0.2 5.1：ジョブLv30）。 */
      jobLevel: z.number().int().min(1),
    })
    .optional(),
  ...provisionalFields,
});
export type JobDef = z.infer<typeof jobSchema>;
