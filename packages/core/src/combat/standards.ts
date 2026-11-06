/**
 * 「標準」の値（補助仕様書 0.1・仕様書v0.2 2.8）。
 * - 標準HP：2.8の表を直線で補った値（敵の攻撃の強さの基準）
 * - 標準DPS：2.8の表を比で補った値（毎Lv同じ倍率で伸ばす）。ボスのHP＝標準DPS×90秒
 * - 通常の敵のHP：30 × 1.06^(Lv-1)
 */

/** 仕様書v0.2 2.8 の表のうち、標準HPと標準DPS。 */
const TABLE: readonly { level: number; hp: number; dps: number }[] = [
  { level: 1, hp: 60, dps: 15 },
  { level: 15, hp: 300, dps: 60 },
  { level: 30, hp: 650, dps: 220 },
  { level: 60, hp: 1600, dps: 1600 },
  { level: 80, hp: 2800, dps: 5500 },
  { level: 100, hp: 4500, dps: 15000 },
];

function bracket(level: number): [(typeof TABLE)[number], (typeof TABLE)[number], number] {
  if (!(level >= 1 && level <= 100)) throw new RangeError(`Lvは1〜100：${String(level)}`);
  for (let i = 0; i < TABLE.length - 1; i++) {
    const a = TABLE[i];
    const b = TABLE[i + 1];
    if (a !== undefined && b !== undefined && level <= b.level)
      return [a, b, (level - a.level) / (b.level - a.level)];
  }
  throw new RangeError("表の範囲外");
}

/** 標準HP（直線で補う）。 */
export function standardHp(level: number): number {
  const [a, b, t] = bracket(level);
  return a.hp + (b.hp - a.hp) * t;
}

/** 標準DPS（比で補う）。 */
export function standardDps(level: number): number {
  const [a, b, t] = bracket(level);
  return a.dps * (b.dps / a.dps) ** t;
}

/** 通常の敵のHP。 */
export function normalEnemyHp(level: number): number {
  return 30 * 1.06 ** (level - 1);
}

/** 章ボスのHP ＝ 標準DPS × 90秒（仕様書v0.2 2.8）。第1章のボス（Lv14）はLv15の値を使う。 */
export function chapterBossHp(level: number): number {
  return standardDps(level) * 90;
}
