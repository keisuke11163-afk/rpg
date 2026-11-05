import { z } from "zod";
import { idSchema, provisionalFields, textKeySchema } from "./ids.ts";

const point = z.strictObject({ x: z.number(), y: z.number() });
const rect = z.strictObject({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});
export type Rect = z.infer<typeof rect>;

/** 町の施設（補助仕様書8章）。 */
export const FACILITIES = [
  "temple",
  "starReader",
  "altar",
  "smith",
  "merchant",
  "stash",
  "teleport",
  "dummy",
] as const;
export type Facility = (typeof FACILITIES)[number];

/**
 * 地域（補助仕様書8・9章）：町か、ダンジョンの地域。地形は固定（手作り）で、群れ・精鋭・宝箱の候補地点を持つ。
 * 入るたびに、候補地点から配置を抽選する（{@link rollRegionLayout}）。
 */
export const regionSchema = z.strictObject({
  id: idSchema,
  text: textKeySchema,
  kind: z.enum(["town", "dungeon"]),
  /** 広さ（m）。 */
  size: z.strictObject({ width: z.number().positive(), height: z.number().positive() }),
  /** 入ったときの位置（町に戻ったとき・地域の入口）。 */
  entrance: point,
  /** 転移の石（補助仕様書9.4：各地域の入口にある。町にもある）。 */
  teleportStone: point.optional(),
  /** 区画（敵のLvと敵の種類。補助仕様書9.1・9.2）。ダンジョンだけ。 */
  sections: z
    .array(
      z.strictObject({
        id: idSchema,
        rect,
        levels: z.strictObject({ min: z.number().int().min(1), max: z.number().int().min(1) }),
        enemies: z.array(idSchema).min(1),
      }),
    )
    .optional(),
  packSpawns: z.array(point).optional(),
  eliteSpawns: z.array(point).optional(),
  woodChests: z.array(point).optional(),
  oldChests: z.array(point).optional(),
  /** 出口（その範囲に入ると、別の地域へ移る）。 */
  exits: z.array(z.strictObject({ to: idSchema, rect })).optional(),
  /** 町の施設。 */
  facilities: z.array(z.strictObject({ kind: z.enum(FACILITIES), at: point })).optional(),
  ...provisionalFields,
});
export type RegionDef = z.infer<typeof regionSchema>;

/** 点が四角の中にあるか。 */
export function inRect(p: { x: number; y: number }, r: Rect): boolean {
  return p.x >= r.x && p.y >= r.y && p.x <= r.x + r.width && p.y <= r.y + r.height;
}
