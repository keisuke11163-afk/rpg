import type { EnemyRank } from "../content/enemy.ts";
import type { ContentDb } from "../content/load.ts";
import { type RegionDef, inRect } from "../content/region.ts";
import type { Rng } from "../random/rng.ts";

/** 群れの出現地点のうち、入るたびに有効にする割合（補助仕様書9.3。仮値）。 */
export const PACK_ACTIVE_CHANCE = 0.7;
/** 群れの1体が魔法の敵になる確率（補助仕様書9.3。仮値。A5は0.15で、地域のデータで変える）。 */
export const MAGIC_PACK_CHANCE = 0.1;
/** 精鋭の出現地点が、それぞれ精鋭を出す確率（補助仕様書9.3。仮値）。 */
export const ELITE_CHANCE = 0.5;
/** 木箱：候補から選ぶ数（補助仕様書9.3。仮値）。 */
export const WOOD_CHESTS = 3;
/** 古びた宝箱：候補から1か所を置く確率（補助仕様書9.3。仮値）。 */
export const OLD_CHEST_CHANCE = 0.5;

export interface LayoutPack {
  readonly at: { x: number; y: number };
  readonly enemy: string;
  readonly level: number;
  readonly count: number;
  /** 先頭から、魔法・精鋭にする体。 */
  readonly ranks: readonly EnemyRank[];
}

export interface LayoutChest {
  readonly at: { x: number; y: number };
  readonly kind: "woodChest" | "oldChest";
  /** 中身の抽選に使うLv（区画のLvの最大）。 */
  readonly level: number;
}

/** 入ったときの、群れ・精鋭・宝箱の配置。 */
export interface RegionLayout {
  readonly packs: readonly LayoutPack[];
  readonly chests: readonly LayoutChest[];
}

/** 配列から、重ならないように n 個を選ぶ（順序は元の順）。 */
function pickDistinct<T>(rng: Rng, list: readonly T[], n: number): T[] {
  const idx = list.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [idx[i], idx[j]] = [idx[j] as number, idx[i] as number];
  }
  return idx
    .slice(0, Math.min(n, list.length))
    .sort((a, b) => a - b)
    .map((i) => list[i] as T);
}

/**
 * 入るたびの配置を抽選する（補助仕様書9.3）。
 * - 群れ：出現地点ごとに70%で有効。中身は、その地点を含む区画の敵の一覧から1種類、Lvは区画の範囲、数は敵の群れの範囲。
 *   群れごとに10%で、1体が魔法の敵
 * - 精鋭：出現地点ごとに50%で、区画の敵の一覧から1体（Lvは区画の最大）
 * - 木箱：候補から3か所。古びた宝箱：50%で、候補から1か所
 * 区画に入っていない地点は使わない（データの検証で防ぐ）。
 */
export function rollRegionLayout(db: ContentDb, region: RegionDef, rng: Rng): RegionLayout {
  const sections = region.sections ?? [];
  const sectionAt = (p: { x: number; y: number }) => sections.find((s) => inRect(p, s.rect));
  const packs: LayoutPack[] = [];
  for (const at of region.packSpawns ?? []) {
    if (!(rng.next() < PACK_ACTIVE_CHANCE)) continue;
    const s = sectionAt(at);
    if (s === undefined) continue;
    const enemy = s.enemies[rng.int(0, s.enemies.length - 1)] as string;
    const def = db.enemies.get(enemy);
    const count = def === undefined ? 1 : rng.int(def.pack.min, def.pack.max);
    const level = rng.int(s.levels.min, s.levels.max);
    const magic = rng.next() < MAGIC_PACK_CHANCE;
    packs.push({ at, enemy, level, count, ranks: magic ? ["magic"] : [] });
  }
  for (const at of region.eliteSpawns ?? []) {
    if (!(rng.next() < ELITE_CHANCE)) continue;
    const s = sectionAt(at);
    if (s === undefined) continue;
    const enemy = s.enemies[rng.int(0, s.enemies.length - 1)] as string;
    packs.push({ at, enemy, level: s.levels.max, count: 1, ranks: ["elite"] });
  }
  const chests: LayoutChest[] = [];
  const levelAt = (p: { x: number; y: number }): number => sectionAt(p)?.levels.max ?? 1;
  for (const at of pickDistinct(rng, region.woodChests ?? [], WOOD_CHESTS))
    chests.push({ at, kind: "woodChest", level: levelAt(at) });
  const old = region.oldChests ?? [];
  if (old.length > 0 && rng.next() < OLD_CHEST_CHANCE) {
    const at = old[rng.int(0, old.length - 1)];
    if (at !== undefined) chests.push({ at, kind: "oldChest", level: levelAt(at) });
  }
  return { packs, chests };
}
