/**
 * シード付きの乱数（開発環境構築計画 5章：core では Math.random を使わない）。
 *
 * アルゴリズムは sfc32（32ビットの状態を4つ持つ）。状態を保存・復元でき、
 * 用途ごとに独立した乱数の列を fork で作れる（例：ドロップと戦闘で列を分ける）。
 */

/** 乱数の状態（保存・復元に使う）。 */
export type RngState = readonly [number, number, number, number];

const UINT32 = 0x1_0000_0000;

/** 文字列を32ビットの値に変換する（FNV-1a）。 */
function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** シードから初期状態を作る（splitmix32 で4つの値を作る）。 */
function seedState(seed: number): [number, number, number, number] {
  let x = seed >>> 0;
  const next = (): number => {
    x = (x + 0x9e3779b9) >>> 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  return [next(), next(), next(), next()];
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  private constructor(state: RngState) {
    [this.a, this.b, this.c, this.d] = state;
    // 全てが0の状態では乱数にならないため避ける
    if ((this.a | this.b | this.c | this.d) === 0) this.d = 1;
  }

  /** シード（数値または文字列）から作る。同じシードからは同じ列が出る。 */
  static fromSeed(seed: number | string): Rng {
    const n = typeof seed === "string" ? hashString(seed) : seed;
    const rng = new Rng(seedState(n));
    // 最初の数回は状態が十分に混ざっていないので捨てる
    for (let i = 0; i < 12; i++) rng.nextUint32();
    return rng;
  }

  /** 保存した状態から作り直す。 */
  static fromState(state: RngState): Rng {
    return new Rng(state);
  }

  /** 現在の状態（保存用）。 */
  getState(): RngState {
    return [this.a, this.b, this.c, this.d];
  }

  /** 0以上 2^32 未満の整数。 */
  nextUint32(): number {
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = (this.b ^ (this.b >>> 9)) >>> 0;
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.c = (this.c + t) >>> 0;
    return t;
  }

  /** 0以上1未満の数。 */
  next(): number {
    return this.nextUint32() / UINT32;
  }

  /** min以上max以下の整数（両端を含む）。偏りが出ないように、範囲外の値は引き直す。 */
  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`int(${String(min)}, ${String(max)}) の範囲が正しくない`);
    }
    const span = max - min + 1;
    if (span > UINT32) throw new RangeError("範囲が広すぎる（2^32 まで）");
    const limit = UINT32 - (UINT32 % span);
    let value = this.nextUint32();
    while (value >= limit) value = this.nextUint32();
    return min + (value % span);
  }

  /** min以上max未満の数。 */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** 確率 p（0〜1）で true。 */
  chance(p: number): boolean {
    if (p <= 0) return false;
    if (p >= 1) return true;
    return this.next() < p;
  }

  /** 配列から1つを等しい確率で選ぶ。 */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError("空の配列からは選べない");
    return items[this.int(0, items.length - 1)] as T;
  }

  /** 重みに比例した確率で1つを選ぶ。重みは0以上で、合計は0より大きいこと。 */
  weighted<T>(entries: readonly { readonly item: T; readonly weight: number }[]): T {
    let total = 0;
    for (const entry of entries) {
      if (!(entry.weight >= 0) || !Number.isFinite(entry.weight)) {
        throw new RangeError("重みは0以上の有限の数");
      }
      total += entry.weight;
    }
    if (total <= 0) throw new RangeError("重みの合計が0");
    let roll = this.next() * total;
    for (const entry of entries) {
      roll -= entry.weight;
      if (roll < 0) return entry.item;
    }
    // 浮動小数点の誤差で最後まで来た場合は、重みが正の最後の要素
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry !== undefined && entry.weight > 0) return entry.item;
    }
    throw new RangeError("重みの合計が0");
  }

  /** 用途ごとの、独立した乱数の列を作る。元の列は1回分だけ進む。 */
  fork(label: string): Rng {
    return Rng.fromSeed((this.nextUint32() ^ hashString(label)) >>> 0);
  }
}
