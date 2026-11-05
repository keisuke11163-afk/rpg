import { z } from "zod";
import { conditionSchema } from "./effect.ts";
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
  ...provisionalFields,
});
export type StarNodeDef = z.infer<typeof starNodeSchema>;

/** 星座（仕様書v0.2 4.4）：全てのノードが有効なら、完成ボーナスが効く。 */
export const constellationSchema = z.strictObject({
  id: idSchema,
  text: textKeySchema,
  nodes: z.array(idSchema).min(2),
  completionEffect: idSchema,
  ...provisionalFields,
});
export type ConstellationDef = z.infer<typeof constellationSchema>;
