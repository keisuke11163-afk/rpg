import { type ItemRarity, ITEM_RARITIES, RARE_OR_BETTER, type RarityDef } from "../content/item.ts";
import type { Rng } from "../random/rng.ts";

/** レアリティの抽選の条件（仕様書v0.2 3.5）。 */
export interface RarityRollInput {
  /** レアリティ → 定義（基本の重み）。 */
  readonly rarities: ReadonlyMap<ItemRarity, RarityDef>;
  /** 敵の格の補正（魔法×1.5・精鋭×2.5。無ければ1）。 */
  readonly rareMultiplier?: number;
  /** 回廊の階層ボーナス（0.5 ＝ +50%。MVPでは0）。 */
  readonly corridorBonus?: number;
  /** 発見率（1 ＝ IF 100%）。 */
  readonly findRate?: number;
  /**
   * 落とせないレアリティ（候補が無い：例えば星座装備のデータが無い、必要LvがアイテムLv以下の
   * ユニークが無い）。重みを0にし、手順4で通常の重みに回す（docs/progress D-U11-2）。
   */
  readonly unavailable?: ReadonlySet<ItemRarity>;
  /** 希少以上だけから抽選する（中ボスの「希少以上が1個確定」。docs/progress D-U11-4）。 */
  readonly rareOrBetterOnly?: boolean;
}

function nonNegativeFinite(value: number, what: string): number {
  if (!(Number.isFinite(value) && value >= 0))
    throw new RangeError(`${what}は0以上の有限の数（${String(value)}）`);
  return value;
}

/**
 * レアリティの重み（仕様書v0.2 3.5 の手順1〜4。合計は100）。
 * 1. 基本の重み
 * 2. 希少以上に、敵の格の補正と回廊の階層ボーナスをかける
 * 3. 発見率：希少は ×（1＋IF）、固有・星座は ×（1＋IF×200÷（IF＋200））。IF は%の数（100 ＝ +100%）
 * 4. 魔法の重みは変えず、合計が100になるように通常の重みで調整する。通常が0を下回る場合は、
 *    通常を0にして残りを比例で縮める
 */
export function rarityWeights(input: RarityRollInput): Map<ItemRarity, number> {
  const rareMultiplier = nonNegativeFinite(input.rareMultiplier ?? 1, "敵の格の補正");
  const corridor = nonNegativeFinite(input.corridorBonus ?? 0, "回廊の階層ボーナス");
  const findRate = nonNegativeFinite(input.findRate ?? 0, "発見率");
  const ifPercent = findRate * 100;
  const out = new Map<ItemRarity, number>();
  for (const rarity of ITEM_RARITIES) {
    const def = input.rarities.get(rarity);
    if (def === undefined || input.unavailable?.has(rarity) === true) {
      out.set(rarity, 0);
      continue;
    }
    let w = nonNegativeFinite(def.weight, `レアリティ ${rarity} の重み`);
    if (RARE_OR_BETTER.has(rarity)) {
      w *= rareMultiplier * (1 + corridor);
      w *= rarity === "rare" ? 1 + findRate : 1 + (ifPercent * 200) / (ifPercent + 200) / 100;
    }
    out.set(rarity, nonNegativeFinite(w, `レアリティ ${rarity} の重み`));
  }
  if (input.rareOrBetterOnly === true) {
    out.set("normal", 0);
    out.set("magic", 0);
    const total = sumOf(out);
    if (total <= 0) throw new RangeError("希少以上のレアリティを落とせない");
    for (const [r, w] of out) out.set(r, (w * 100) / total);
    return out;
  }
  // 手順4：通常で合計を100に合わせる
  const others = sumOf(out) - (out.get("normal") ?? 0);
  const normal = 100 - others;
  if (normal >= 0) {
    out.set("normal", normal);
    return out;
  }
  // 通常が0を下回る：通常を0にして、残りを比例で縮める
  out.set("normal", 0);
  for (const [r, w] of out) out.set(r, (w * 100) / others);
  return out;
}

function sumOf(m: ReadonlyMap<ItemRarity, number>): number {
  let total = 0;
  for (const w of m.values()) total += w;
  return total;
}

/** レアリティを1つ抽選する。 */
export function rollRarity(rng: Rng, input: RarityRollInput): ItemRarity {
  const weights = rarityWeights(input);
  return rng.weighted([...weights].map(([item, weight]) => ({ item, weight })));
}
