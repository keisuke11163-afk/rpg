/**
 * 表示の側だけで使う、決定的な乱数（座標からのハッシュ）。
 * 地面の模様の配置などに使う。Math.random と違い、同じ地域は撮るたびに同じ絵になる。
 * シミュレーションには何も渡さない（見た目だけ）。Phaser に依存しない。
 */

/** 文字列（地域のIDなど）から32ビットの種を作る（FNV-1a）。 */
export function seedOf(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 整数の座標 (x, y) と種から、0以上1未満の値（同じ引数なら必ず同じ値）。 */
export function hash2(x: number, y: number, seed: number): number {
  let h = (seed ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * なめらかな値のノイズ（格子の間隔 cell ごとのハッシュを、双線形に補間する）。0以上1未満。
 * 地面の大きなまだら（土・草のかたまり）に使う。
 */
export function valueNoise(x: number, y: number, cell: number, seed: number): number {
  // 前提違反（格子の間隔が 0 以下・NaN、座標が有限でない）：割り算が NaN になるので、補間をやめて整数座標のハッシュを返す
  if (!(cell > 0) || !Number.isFinite(cell) || !Number.isFinite(x) || !Number.isFinite(y))
    return hash2(Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0, seed);
  const gx = Math.floor(x / cell);
  const gy = Math.floor(y / cell);
  const fx = x / cell - gx;
  const fy = y / cell - gy;
  // なめらかにつなぐ（smoothstep）
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(gx, gy, seed);
  const b = hash2(gx + 1, gy, seed);
  const c = hash2(gx, gy + 1, seed);
  const d = hash2(gx + 1, gy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
