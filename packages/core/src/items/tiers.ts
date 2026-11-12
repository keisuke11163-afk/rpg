import { type AffixDef, type AffixTier, AFFIX_TIERS, TIER_MIN_ILVL } from "../content/item.ts";

/** 表示の単位の値の範囲。 */
export interface TierValue {
  readonly min: number;
  readonly max: number;
}

/**
 * 詞の全てのtierの値（表示の単位）。表に載っていないtierは、隣の載っているtierの間を
 * 等間隔で補う。端数は切り上げ（仕様書v0.2 3.6。例：T6 ＝ T7 ＋（T4 − T7）× 1/3）。
 * 載っている最も低いtierより低い・最も高いtierより高いtierは、補わない（その詞には無い）。
 */
export function affixTierValues(affix: AffixDef): ReadonlyMap<AffixTier, TierValue> {
  const listed = new Map<number, TierValue>();
  for (const t of affix.tiers) listed.set(t.tier, { min: t.min, max: t.max });
  const out = new Map<AffixTier, TierValue>();
  // AFFIX_TIERS は低い順（7 → 0）
  let lower: { tier: number; value: TierValue } | undefined;
  for (const tier of AFFIX_TIERS) {
    const value = listed.get(tier);
    if (value !== undefined) {
      out.set(tier, value);
      lower = { tier, value };
      continue;
    }
    if (lower === undefined) continue;
    // 次に載っている（高い）tier
    const upperTier = AFFIX_TIERS.find((t) => t < tier && listed.has(t));
    const upper = upperTier === undefined ? undefined : listed.get(upperTier);
    if (upperTier === undefined || upper === undefined) continue;
    const ratio = (lower.tier - tier) / (lower.tier - upperTier);
    out.set(tier, {
      min: interpolate(lower.value.min, upper.min, ratio),
      max: interpolate(lower.value.max, upper.max, ratio),
    });
  }
  return out;
}

/** 等間隔で補った値。端数は切り上げ（浮動小数点の誤差で整数が切り上がらないように、少しだけ丸める）。 */
function interpolate(from: number, to: number, ratio: number): number {
  const v = from + (to - from) * ratio;
  return Math.ceil(Math.round(v * 1e9) / 1e9);
}

/**
 * アイテムLvで出現できるtier（高い順）。極T0は、回廊の第12階層以上だけ（allowT0）。
 */
export function eligibleTiers(
  affix: AffixDef,
  itemLevel: number,
  options: { readonly allowT0?: boolean } = {},
): AffixTier[] {
  const values = affixTierValues(affix);
  return [...values.keys()]
    .filter((t) => TIER_MIN_ILVL[t] <= itemLevel && (t !== 0 || options.allowT0 === true))
    .sort((a, b) => a - b);
}

/**
 * tierの重み（仕様書v0.2 3.6）：出現できるtierのうち最も高いものを40、残りを60として等分する。
 * 出現できるtierが1つなら、それが100%。tiers は高い順（eligibleTiers の結果）。
 */
export function tierWeights(tiers: readonly AffixTier[]): { tier: AffixTier; weight: number }[] {
  if (tiers.length === 0) return [];
  if (tiers.length === 1) return [{ tier: tiers[0] as AffixTier, weight: 100 }];
  const rest = 60 / (tiers.length - 1);
  return tiers.map((tier, i) => ({ tier, weight: i === 0 ? 40 : rest }));
}
