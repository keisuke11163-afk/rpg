/**
 * シード付きの乱数（開発計画書 F-1・7.1、開発環境構築計画 5章）。
 *
 * ルールの中核では Math.random を使わず、必ずこの乱数を使う（リントで禁止している）。
 * 同じシードなら、どの環境でも同じ乱数の列が出る。状態を保存・復元できるので、
 * セーブ（U-13）やリプレイ・失敗したテストの再現に使える。
 *
 * 方式：SFC32（32ビットの整数演算だけで動く。周期は少なくとも 2^32）。
 * シードは SplitMix32 で4つの状態に広げる。
 * 方式を変えると、同じシードで出る列が変わる。変えるときは RNG_ALGORITHM_VERSION を上げる。
 */

/** 乱数の方式の版。方式を変えたら上げる（保存した状態との互換性の判断に使う）。 */
export const RNG_ALGORITHM_VERSION = 1;

/** 乱数の状態。4つの32ビットの符号なし整数。そのまま JSON に保存できる。 */
export type RngState = readonly [number, number, number, number];

const UINT32 = 0x1_0000_0000;

function splitMix32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

/** 文字列を32ビットの整数にする（FNV-1a）。名前の付いたシード（"drop-table" など）に使う。 */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  }
  return hash >>> 0;
}

function isUint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < UINT32;
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  private constructor(state: RngState) {
    [this.a, this.b, this.c, this.d] = state;
  }

  /** シードから作る。シードは整数（32ビットに丸める）か文字列。 */
  static fromSeed(seed: number | string): Rng {
    if (typeof seed === "number" && !Number.isInteger(seed)) {
      throw new RangeError(`シードは整数か文字列にする: ${String(seed)}`);
    }
    const next = splitMix32(typeof seed === "string" ? hashSeed(seed) : seed);
    const rng = new Rng([next(), next(), next(), next()]);
    // 最初の数回の出力は状態の偏りが残るので捨てる
    for (let i = 0; i < 12; i++) rng.nextUint32();
    return rng;
  }

  /** 保存した状態から作る（セーブから読んだ値でもよいように、形を確かめる）。 */
  static fromState(state: readonly number[]): Rng {
    const [a, b, c, d] = state;
    if (
      state.length !== 4 ||
      a === undefined ||
      b === undefined ||
      c === undefined ||
      d === undefined ||
      !state.every(isUint32)
    ) {
      throw new RangeError("乱数の状態は、32ビットの符号なし整数4つにする");
    }
    if (state.every((v) => v === 0)) {
      throw new RangeError("乱数の状態を全て0にはできない");
    }
    return new Rng([a, b, c, d]);
  }

  /** 今の状態（保存用）。 */
  getState(): RngState {
    return [this.a, this.b, this.c, this.d];
  }

  /** 同じ状態の、独立した複製。 */
  clone(): Rng {
    return new Rng(this.getState());
  }

  /**
   * この乱数から、別の列を持つ乱数を作る。親の列も1回分進む。
   * 用途ごとに列を分けると、片方の乱数の使い方を変えても、もう片方の結果が変わらない。
   */
  fork(label = ""): Rng {
    const seed = (this.nextUint32() ^ hashSeed(label)) >>> 0;
    return Rng.fromSeed(seed);
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

  /** min以上max以下の整数（偏りがないように、範囲外の値は引き直す）。 */
  int(min: number, max: number): number {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) {
      throw new RangeError(`int の範囲が正しくない: ${String(min)}〜${String(max)}`);
    }
    const range = max - min + 1;
    if (range > UINT32) throw new RangeError("int の範囲は 2^32 以下にする");
    const limit = UINT32 - (UINT32 % range);
    let value = this.nextUint32();
    while (value >= limit) value = this.nextUint32();
    return min + (value % range);
  }

  /** min以上max未満の数。 */
  float(min: number, max: number): number {
    if (!(min <= max))
      throw new RangeError(`float の範囲が正しくない: ${String(min)}〜${String(max)}`);
    return min + this.next() * (max - min);
  }

  /** 確率 p で true。p が0以下なら必ず false、1以上なら必ず true（乱数は1回分進む）。 */
  chance(p: number): boolean {
    if (Number.isNaN(p)) throw new RangeError("確率が NaN");
    return this.next() < p;
  }

  /** 配列から1つ選ぶ。 */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError("空の配列からは選べない");
    return items[this.int(0, items.length - 1)] as T;
  }

  /** 重みに比例した確率で、添字を選ぶ。重みは0以上の有限の数で、合計は正にする。 */
  weightedIndex(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) {
      if (!Number.isFinite(w) || w < 0) throw new RangeError(`重みが正しくない: ${String(w)}`);
      total += w;
    }
    if (total <= 0) throw new RangeError("重みの合計が0");
    let roll = this.next() * total;
    let lastPositive = 0;
    for (let i = 0; i < weights.length; i++) {
      const w = weights[i] as number;
      if (w === 0) continue;
      lastPositive = i;
      if (roll < w) return i;
      roll -= w;
    }
    // 浮動小数の誤差で最後まで来たときは、重みが正の最後の要素
    return lastPositive;
  }

  /** 配列を並べ替えた新しい配列（Fisher–Yates）。 */
  shuffle<T>(items: readonly T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [result[i], result[j]] = [result[j] as T, result[i] as T];
    }
    return result;
  }
}
