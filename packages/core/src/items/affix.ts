/**
 * 詞のtierと値の抽選（本仕様書 3.6）。
 */
import type { Rng } from "../rng.ts";
import { TIER_MIN_ILVL, type AffixDef, type RolledAffix, type TierRange } from "./types.ts";

/** T7からT4への差を等間隔で補う（T6は1/3、T5は2/3。端数は切り上げ。仮値） */
export function tierRange(def: AffixDef, tier: number): TierRange {
  if (tier === 7) return def.t7;
  if (tier === 4) return def.t4;
  const steps = tier === 6 ? 1 : tier === 5 ? 2 : -1;
  if (steps < 0) throw new Error(`tier ${String(tier)} は未対応（MVPはT7〜T4）`);
  const lerp = (a: number, b: number): number => Math.ceil(a + ((b - a) * steps) / 3 - 1e-9);
  return { min: lerp(def.t7.min, def.t4.min), max: lerp(def.t7.max, def.t4.max) };
}

/** iLvで出現できるtier（新しいほうが先。tierFloor 以下の数字は出さない） */
export function eligibleTiers(ilvl: number, tierFloor: number): number[] {
  return [7, 6, 5, 4, 3, 2, 1, 0]
    .filter((t) => t >= tierFloor && ilvl >= (TIER_MIN_ILVL[t] ?? Infinity))
    .sort((a, b) => a - b);
}

/** tierの抽選：出現できるtierのうち最も高いものを40、残りを60として等分する */
export function rollTier(ilvl: number, tierFloor: number, rng: Rng): number {
  const tiers = eligibleTiers(ilvl, tierFloor); // 小さい数字（高いtier）が先
  if (tiers.length === 0) throw new Error("出現できるtierがない");
  if (tiers.length === 1) return tiers[0] as number;
  const rest = 60 / (tiers.length - 1);
  const weights = tiers.map((_, i) => (i === 0 ? 40 : rest));
  return tiers[rng.weightedIndex(weights)] as number;
}

/** 詞1つの値を抽選する */
export function rollAffix(def: AffixDef, ilvl: number, tierFloor: number, rng: Rng): RolledAffix {
  const tier = rollTier(ilvl, tierFloor, rng);
  const range = tierRange(def, tier);
  const rolls = def.added === true ? [range.min, range.max] : [rng.int(range.min, range.max)];
  return { id: def.id, tier, rolls };
}
