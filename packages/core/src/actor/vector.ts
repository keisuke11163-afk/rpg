/** 2次元のベクトル（単位はm。x は右、y は下が正）。 */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export const ZERO: Vec2 = { x: 0, y: 0 };

export function length(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

/** 長さ1に揃える。長さ0なら0のまま。 */
export function normalize(v: Vec2): Vec2 {
  const len = length(v);
  return len > 1e-9 ? { x: v.x / len, y: v.y / len } : ZERO;
}

export function scale(v: Vec2, k: number): Vec2 {
  return { x: v.x * k, y: v.y * k };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

/**
 * 角度（ラジアン）を8方向の番号に丸める（補助仕様書 1.1・2章：見た目の向きは8方向）。
 * 0＝右、1＝右下、2＝下、3＝左下、4＝左、5＝左上、6＝上、7＝右上（y は下が正）。
 */
export function toDirection8(angle: number): number {
  const step = Math.PI / 4;
  return (((Math.round(angle / step) % 8) + 8) % 8) | 0;
}
