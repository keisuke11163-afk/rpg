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
  /** 群れの1体が魔法の敵になる確率（省略すると10%。A5は15%。補助仕様書9.3）。 */
  magicPackChance: z.number().min(0).max(1).optional(),
  eliteSpawns: z.array(point).optional(),
  woodChests: z.array(point).optional(),
  oldChests: z.array(point).optional(),
  /** 決まった位置に、いつも出る敵（中ボス・ボスなど。補助仕様書9.2）。 */
  fixedEnemies: z
    .array(
      z.strictObject({
        id: idSchema,
        enemy: idSchema,
        level: z.number().int().min(1),
        at: point,
        /** 根渡りで現れる地点（ボスの間。補助仕様書11.1：3か所）。 */
        anchors: z.array(point).optional(),
      }),
    )
    .optional(),
  /** 隠し星（調べると探索のポイント。補助仕様書9.5）。1回だけ。 */
  secrets: z
    .array(
      z.strictObject({
        id: idSchema,
        text: textKeySchema,
        at: point,
        explorationPoints: z.number().int().positive(),
      }),
    )
    .optional(),
  /**
   * 出口（その範囲に入ると、別の地域へ移る）。requires があれば、その敵を一度でも倒すまで閉じている
   * （A5 は母樹を初めて倒すと開く。補助仕様書9.2）。
   */
  exits: z
    .array(
      z.strictObject({
        to: idSchema,
        rect,
        requires: z.strictObject({ defeated: idSchema }).optional(),
      }),
    )
    .optional(),
  /** 町の施設。 */
  facilities: z.array(z.strictObject({ kind: z.enum(FACILITIES), at: point })).optional(),
  ...provisionalFields,
});
export type RegionDef = z.infer<typeof regionSchema>;

/** 点が四角の中にあるか。 */
export function inRect(p: { x: number; y: number }, r: Rect): boolean {
  return p.x >= r.x && p.y >= r.y && p.x <= r.x + r.width && p.y <= r.y + r.height;
}

/**
 * クエスト（補助仕様書9.6）：段階ごとの条件と、星図の欠片（星辰盤のクエストのポイント）。
 */
export const questSchema = z.strictObject({
  id: idSchema,
  text: textKeySchema,
  stages: z
    .array(
      z.strictObject({
        id: idSchema,
        text: textKeySchema,
        trigger: z.discriminatedUnion("type", [
          z.strictObject({ type: z.literal("enterRegion"), region: idSchema }),
          z.strictObject({ type: z.literal("defeat"), enemy: idSchema }),
        ]),
        questPoints: z.number().int().nonnegative(),
      }),
    )
    .min(1),
  ...provisionalFields,
});
export type QuestDef = z.infer<typeof questSchema>;
