/**
 * 防御の計算（仕様書 2.6、v0.2 2.4）。
 */

import { requireFinite } from "../effects/evaluate.ts";

/** 防具値による物理の軽減の上限（仕様書 2.6）。 */
export const ARMOR_REDUCTION_CAP = 0.85;
/** 回避率の上限（仕様書 2.6）。 */
export const EVASION_CAP = 0.75;

/**
 * 分母が溢れたときに、分子・分母の両方にかける縮小の倍率（2のべき乗）。
 * 2のべき乗をかけても仮数部は変わらない（指数部だけが変わる）ので、比 a ÷（a ＋ k×b）の値は保たれる。
 * k ≤ 15 なら、a・b が有限の最大値（約1.8e308）でも縮めた後の分母は有限に収まる。
 */
const OVERFLOW_SCALE = 2 ** -4;

/**
 * a ÷（a ＋ k × b）を、途中の値が溢れないように計算する（a > 0、b ≥ 0、0 < k ≤ 15 の有限値）。
 *
 * a・b がどちらも有限でも、k × b や a ＋ k × b は Infinity になることがある
 * （例：防具値 1e308、受けるダメージ 1e308 → 分母 1.1e309）。そのまま割ると 0 や NaN になり、
 * 本当の比（この例では約0.09）とは違う値になる。
 * 分母が有限なら従来どおりそのまま計算し（通常の入力では結果は1ビットも変わらない）、
 * 溢れたときだけ a・b を 2のべき乗で縮めてから計算する。縮めた後の分母と結果も検証する。
 */
function ratioWithoutOverflow(a: number, b: number, k: number, what: string): number {
  let numerator = a;
  let denominator = a + k * b;
  if (!Number.isFinite(denominator)) {
    numerator = a * OVERFLOW_SCALE;
    denominator = numerator + k * (b * OVERFLOW_SCALE);
  }
  requireFinite(denominator, () => `${what}の分母`);
  return requireFinite(numerator / denominator, () => what);
}

/**
 * 防具値による軽減率 ＝ 防具値 ÷（防具値 ＋ 10 × 受けるダメージ）。上限85%（仕様書 2.6）。
 * 防具値・受けるダメージが NaN・Infinity なら RangeError（0などに置き換えない）。
 */
export function armorReduction(armor: number, incomingDamage: number): number {
  requireFinite(armor, () => "防具値");
  requireFinite(incomingDamage, () => "防具値の軽減で受けるダメージ");
  if (armor <= 0 || incomingDamage <= 0) return 0;
  return Math.min(
    ARMOR_REDUCTION_CAP,
    ratioWithoutOverflow(armor, incomingDamage, 10, "防具値による軽減率"),
  );
}

/**
 * 回避率 ＝ 回避値 ÷（回避値 ＋ 命中 × 1.5）。上限75%（仕様書 2.6）。
 * プレイヤーが敵の攻撃を避けるときも、敵がプレイヤーの攻撃を避けるときも同じ式を使う（仕様書v0.2 2.4）。
 * 回避値・命中が NaN・Infinity なら RangeError（0などに置き換えない）。
 */
export function evadeChance(evasion: number, accuracy: number): number {
  requireFinite(evasion, () => "回避値");
  requireFinite(accuracy, () => "命中");
  if (evasion <= 0) return 0;
  return Math.min(EVASION_CAP, ratioWithoutOverflow(evasion, Math.max(0, accuracy), 1.5, "回避率"));
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
