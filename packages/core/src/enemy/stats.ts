/**
 * 基準となる数値（本仕様書 2.8）。Lvの間は、表の値の間を指数で補間する（敵のHPは1Lvごとに約1.06倍）。
 */

const ANCHORS: readonly (readonly [number, number])[] = [
  [1, 30],
  [15, 70],
  [30, 170],
  [60, 1000],
  [80, 3200],
  [100, 9600],
];

/** 通常の敵の標準HP */
export function standardEnemyHp(level: number): number {
  const lv = Math.min(100, Math.max(1, level));
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const [l0, h0] = ANCHORS[i] as readonly [number, number];
    const [l1, h1] = ANCHORS[i + 1] as readonly [number, number];
    if (lv <= l1) {
      const t = (lv - l0) / (l1 - l0);
      return h0 * (h1 / h0) ** t;
    }
  }
  return 9600;
}

/** プレイヤーのHPの基礎 ＝ 48 ＋ 12 × キャラLv（本仕様書 2.3。仮値） */
export function basePlayerHp(level: number): number {
  return 48 + 12 * level;
}

/** 章ボスのHPは「標準DPS × 90秒」（本仕様書 2.8）。第1章のボス（Lv14）にはLv15の値を使う */
export const CHAPTER_BOSS_HP: readonly (readonly [number, number])[] = [
  [15, 5400],
  [30, 19800],
  [60, 144000],
  [80, 495000],
  [100, 1350000],
];
