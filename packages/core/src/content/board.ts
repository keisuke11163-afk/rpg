import { z } from "zod";
import { conditionSchema } from "./effect.ts";
import { FACTS } from "./registries.ts";
import { idSchema, provisionalFields, textKeySchema } from "./ids.ts";

/** 星辰盤のノードの種類（仕様書v0.2 4.3）。start は始点（ポイントを使わない）。 */
export const STAR_NODE_KINDS = [
  "start",
  "minor",
  "notable",
  "mutation",
  "keystone",
  "gate",
  "socket",
] as const;
export type StarNodeKind = (typeof STAR_NODE_KINDS)[number];

/** 星域（仕様書v0.2 4.2：8つの星域と星核）。 */
export const STAR_REGIONS = [
  "gou",
  "goukon",
  "kon",
  "rikon",
  "ri",
  "jinri",
  "jin",
  "goujin",
  "core",
] as const;
export type StarRegion = (typeof STAR_REGIONS)[number];

/** 種類ごとに、ノードの効果が持てる出どころ（効果の origin）。 */
export const NODE_EFFECT_ORIGIN: Readonly<Record<StarNodeKind, readonly string[]>> = {
  start: ["minorStar"],
  minor: ["minorStar"],
  notable: ["notableStar"],
  mutation: ["mutation"],
  keystone: ["keystone"],
  gate: ["minorStar"],
  socket: [],
};

/** 星辰盤のノード（開発計画書6.8）。つながり（links）は向きを持たない（片方に書けばよい）。 */
export const starNodeSchema = z.strictObject({
  id: idSchema,
  /** 名前の文章のキー（小星は省略してよい。効果の説明を名前の代わりに出す）。 */
  text: textKeySchema.optional(),
  kind: z.enum(STAR_NODE_KINDS),
  region: z.enum(STAR_REGIONS),
  links: z.array(idSchema),
  effects: z.array(idSchema).optional(),
  /** 始点：このノードを始点にするジョブ（kind が start のノードだけ）。 */
  startFor: z.array(idSchema).optional(),
  /** 星門の条件（kind が gate のノードだけ。仕様書v0.2 4.9）。満たさないと、門とその先が休眠する。 */
  gate: z.strictObject({ conditions: z.array(conditionSchema).min(1) }).optional(),
  /** 天極の共鳴変化（仕様書v0.2 4.7）：その星域の共鳴紋が threshold 以上のとき、effects に加えて効く効果。 */
  resonance: z
    .strictObject({ threshold: z.number().int().positive(), effects: z.array(idSchema).min(1) })
    .optional(),
  /** 画面の上の位置（星辰盤の座標。表示だけに使う）。 */
  position: z.strictObject({ x: z.number(), y: z.number() }),
  /**
   * 事実の数だけ重ねる効果（天極「重荷の誇り」：重装の防具1部位につき）。0なら効かない。
   * 盤の評価に渡す事実（装備の事実）で数える。effects とは別に効く。
   */
  factStacked: z
    .strictObject({ fact: z.enum(FACTS), effects: z.array(idSchema).min(1) })
    .optional(),
  ...provisionalFields,
});
export type StarNodeDef = z.infer<typeof starNodeSchema>;

/** 星座（仕様書v0.2 4.4）：全てのノードが有効なら、完成ボーナスが効く。 */
export const constellationSchema = z.strictObject({
  id: idSchema,
  text: textKeySchema,
  nodes: z.array(idSchema).min(2),
  completionEffect: idSchema,
  /** 完成ボーナスを、この事実の数だけ重ねる（鍛冶座：装備の強化値の合計）。省略すると1つ。 */
  completionStacks: z.enum(FACTS).optional(),
  ...provisionalFields,
});
export type ConstellationDef = z.infer<typeof constellationSchema>;

/** 職紋盤のノードの種類（仕様書v0.2 4.10）。mastery は職奥義（1つだけ選べる）、connector は星辰盤への接続ノード。 */
export const JOB_NODE_KINDS = ["start", "minor", "notable", "mastery", "connector"] as const;
export type JobNodeKind = (typeof JOB_NODE_KINDS)[number];

/** 種類ごとに、職紋盤のノードの効果が持てる出どころ。 */
export const JOB_NODE_EFFECT_ORIGIN: Readonly<Record<JobNodeKind, readonly string[]>> = {
  start: [],
  minor: ["jobNode"],
  notable: ["jobNode"],
  mastery: ["jobMastery"],
  connector: ["jobNode"],
};

/** 職紋盤のノード（仕様書v0.2 4.10）。ジョブごとの盤。つながりは向きを持たない。 */
export const jobNodeSchema = z.strictObject({
  id: idSchema,
  job: idSchema,
  text: textKeySchema.optional(),
  /** 説明（名前のあるノード・職奥義）。 */
  description: textKeySchema.optional(),
  kind: z.enum(JOB_NODE_KINDS),
  links: z.array(idSchema),
  effects: z.array(idSchema).optional(),
  position: z.strictObject({ x: z.number(), y: z.number() }),
  ...provisionalFields,
});
export type JobNodeDef = z.infer<typeof jobNodeSchema>;
