import { describe, expect, it } from "vitest";
import { Rng, hashSeed } from "../src/index.ts";

function take(rng: Rng, n: number): number[] {
  return Array.from({ length: n }, () => rng.nextUint32());
}

/** draw を n 回呼び、0〜size-1 の各値が出た回数を数える。 */
function tally(n: number, size: number, draw: () => number): number[] {
  const counts = Array.from({ length: size }, () => 0);
  for (let i = 0; i < n; i++) {
    const k = draw();
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

describe("Rng（シード付きの乱数）", () => {
  it("同じシードなら、同じ乱数の列が出る", () => {
    expect(take(Rng.fromSeed(12345), 1000)).toEqual(take(Rng.fromSeed(12345), 1000));
    expect(take(Rng.fromSeed("drop"), 100)).toEqual(take(Rng.fromSeed("drop"), 100));
  });

  it("違うシードなら、違う列が出る", () => {
    expect(take(Rng.fromSeed(1), 10)).not.toEqual(take(Rng.fromSeed(2), 10));
  });

  it("方式が変わっていない（変えたら RNG_ALGORITHM_VERSION を上げ、この値を更新する）", () => {
    expect(take(Rng.fromSeed(0), 4)).toEqual(GOLDEN_SEED_0);
    expect(take(Rng.fromSeed("stella"), 2)).toEqual(GOLDEN_SEED_STELLA);
  });

  it("状態を保存して復元すると、続きの列が同じになる", () => {
    const rng = Rng.fromSeed(42);
    take(rng, 37);
    const state = rng.getState();
    const restored = Rng.fromState(JSON.parse(JSON.stringify(state)) as typeof state);
    expect(take(restored, 50)).toEqual(take(rng, 50));
  });

  it("clone は同じ列、fork は別の列を作り、どちらも再現できる", () => {
    const a = Rng.fromSeed(7);
    expect(take(a.clone(), 5)).toEqual(take(a.clone(), 5));
    const f1 = Rng.fromSeed(7).fork("loot");
    const f2 = Rng.fromSeed(7).fork("loot");
    expect(take(f1, 5)).toEqual(take(f2, 5));
    expect(take(Rng.fromSeed(7).fork("ai"), 5)).not.toEqual(take(Rng.fromSeed(7).fork("loot"), 5));
  });

  it("next は0以上1未満、int は範囲の両端を含む", () => {
    const rng = Rng.fromSeed(3);
    const seen = new Set<number>();
    for (let i = 0; i < 10000; i++) {
      const x = rng.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      const n = rng.int(-2, 2);
      expect(n).toBeGreaterThanOrEqual(-2);
      expect(n).toBeLessThanOrEqual(2);
      seen.add(n);
    }
    expect([...seen].sort()).toEqual([-1, -2, 0, 1, 2].sort());
  });

  it("int の分布に大きな偏りがない（6面ダイス 60,000回）", () => {
    const rng = Rng.fromSeed(99);
    const counts = tally(60000, 6, () => rng.int(0, 5));
    for (const c of counts) expect(Math.abs(c - 10000)).toBeLessThan(400);
  });

  it("weightedIndex は重みに比例し、重み0は選ばない", () => {
    const rng = Rng.fromSeed(5);
    const [c0 = 0, c1 = 0, c2 = 0] = tally(40000, 3, () => rng.weightedIndex([1, 0, 3]));
    expect(c1).toBe(0);
    expect(c0 / 40000).toBeCloseTo(0.25, 1);
    expect(c2 / 40000).toBeCloseTo(0.75, 1);
  });

  it("chance は0なら必ず false、1なら必ず true", () => {
    const rng = Rng.fromSeed(8);
    for (let i = 0; i < 1000; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });

  it("shuffle は要素を保ち、元の配列を変えない", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = Rng.fromSeed(11).shuffle(items);
    expect([...shuffled].sort()).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("正しくない入力を拒む", () => {
    const rng = Rng.fromSeed(1);
    expect(() => Rng.fromSeed(1.5)).toThrow(RangeError);
    expect(() => Rng.fromState([0, 0, 0, 0])).toThrow(RangeError);
    expect(() => Rng.fromState([1, 2, 3, -1])).toThrow(RangeError);
    expect(() => rng.int(3, 2)).toThrow(RangeError);
    expect(() => rng.pick([])).toThrow(RangeError);
    expect(() => rng.weightedIndex([0, 0])).toThrow(RangeError);
    expect(() => rng.weightedIndex([1, -1])).toThrow(RangeError);
  });

  it("hashSeed は文字列ごとに決まった値を返す", () => {
    expect(hashSeed("")).toBe(0x811c9dc5);
    expect(hashSeed("a")).toBe(hashSeed("a"));
    expect(hashSeed("a")).not.toBe(hashSeed("b"));
  });
});

const GOLDEN_SEED_0 = [4205396811, 3543653536, 1222415357, 3047368389];
const GOLDEN_SEED_STELLA = [2292870844, 3930659982];
