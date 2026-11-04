/**
 * 防御の計算（仕様書 2.6、v0.2 2.4）。
 */

/** 防具値による物理の軽減の上限（仕様書 2.6）。 */
export const ARMOR_REDUCTION_CAP = 0.85;
/** 回避率の上限（仕様書 2.6）。 */
export const EVASION_CAP = 0.75;

/** 防具値による軽減率 ＝ 防具値 ÷（防具値 ＋ 10 × 受けるダメージ）。上限85%（仕様書 2.6）。 */
export function armorReduction(armor: number, incomingDamage: number): number {
  if (armor <= 0 || incomingDamage <= 0) return 0;
  return Math.min(ARMOR_REDUCTION_CAP, armor / (armor + 10 * incomingDamage));
}

/**
 * 回避率 ＝ 回避値 ÷（回避値 ＋ 命中 × 1.5）。上限75%（仕様書 2.6）。
 * プレイヤーが敵の攻撃を避けるときも、敵がプレイヤーの攻撃を避けるときも同じ式を使う（仕様書v0.2 2.4）。
 */
export function evadeChance(evasion: number, accuracy: number): number {
  if (evasion <= 0) return 0;
  return Math.min(EVASION_CAP, evasion / (evasion + Math.max(0, accuracy) * 1.5));
}

/** 命中率 ＝ 1 － 回避率（仕様書v0.2 2.4）。 */
export function hitChance(evasion: number, accuracy: number): number {
  return 1 - evadeChance(evasion, accuracy);
}

/** 命中の値（仕様書v0.2 2.4）：2 × キャラLv ＋ 迅 × 3（装備などの分は修正値で足す）。 */
export function baseAccuracy(characterLevel: number, jin: number): number {
  return 2 * characterLevel + 3 * jin;
}

/** 敵の命中（補助仕様書10.1）：40 ＋ 12 × 敵のLv。仮値: 補助仕様書10.1 */
export function enemyAccuracy(level: number): number {
  return 40 + 12 * level;
}
