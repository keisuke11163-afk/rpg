/**
 * シード付きの乱数（開発環境構築計画 5章）。core の中では Math.random を使わず、これだけを使う。
 * アルゴリズムは sfc32。状態は4つの32ビット整数で、保存・復元できる（セーブ・リプレイ用）。
 */

export type RngState = readonly [number, number, number, number];

export interface Rng {
  /** [0, 1) の実数 */
  next(): number;
  /** [min, max] の整数（両端を含む） */
  int(min: number, max: number): number;
  /** 確率 p（0〜1）で true */
  chance(p: number): boolean;
  /** 配列から1つ選ぶ。空配列は誤り */
  pick<T>(items: readonly T[]): T;
  /** 重み付きの抽選。重みの合計が0以下なら誤り。返すのは添字 */
  weightedIndex(weights: readonly number[]): number;
  /** 現在の状態の写し */
  getState(): RngState;
  /** 状態を復元する */
  setState(state: RngState): void;
  /** 独立した乱数を派生させる（ラベルごとに、親の状態を進めずに同じ列を得る用途） */
  fork(label: string): Rng;
}

/** 文字列→32ビットのハッシュ（FNV-1a） */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let z = a;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function createRng(seed: number | string): Rng {
  const numeric = typeof seed === "string" ? hashString(seed) : seed >>> 0;
  const mix = splitmix32(numeric);
  const state: [number, number, number, number] = [mix(), mix(), mix(), mix()];
  const rng = fromState(state);
  // 最初の数回は捨てる（初期状態の偏りを避ける）
  for (let i = 0; i < 12; i++) rng.next();
  return rng;
}

function fromState(state: [number, number, number, number]): Rng {
  const nextUint = (): number => {
    const [a, b, c, d] = state;
    const t = (((a + b) >>> 0) + d) >>> 0;
    state[3] = (d + 1) >>> 0;
    state[0] = (b ^ (b >>> 9)) >>> 0;
    state[1] = (c + (c << 3)) >>> 0;
    state[2] = (((c << 21) | (c >>> 11)) + t) >>> 0;
    return t;
  };
  const rng: Rng = {
    next: () => nextUint() / 4294967296,
    int(min, max) {
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
        throw new RangeError(`int(${String(min)}, ${String(max)}): 範囲が正しくない`);
      }
      return min + Math.floor(rng.next() * (max - min + 1));
    },
    chance: (p) => rng.next() < p,
    pick(items) {
      if (items.length === 0) throw new RangeError("pick: 空の配列");
      return items[rng.int(0, items.length - 1)] as (typeof items)[number];
    },
    weightedIndex(weights) {
      const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
      if (!(total > 0)) throw new RangeError("weightedIndex: 重みの合計が0以下");
      let roll = rng.next() * total;
      for (let i = 0; i < weights.length; i++) {
        roll -= Math.max(0, weights[i] ?? 0);
        if (roll < 0) return i;
      }
      return weights.length - 1;
    },
    getState: () => [state[0], state[1], state[2], state[3]],
    setState(next) {
      state[0] = next[0] >>> 0;
      state[1] = next[1] >>> 0;
      state[2] = next[2] >>> 0;
      state[3] = next[3] >>> 0;
    },
    fork(label) {
      const mix = splitmix32(hashString(label) ^ state[0] ^ Math.imul(state[1], 31));
      const child = fromState([mix(), mix(), mix(), mix()]);
      for (let i = 0; i < 12; i++) child.next();
      return child;
    },
  };
  return rng;
}
