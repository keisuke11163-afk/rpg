import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Rng } from "../src/index.ts";

/** テストの表示用（undefined は JSON にならないため）。 */
const label = (v: unknown): string => (v === undefined ? "undefined" : JSON.stringify(v));
const take = (rng: Rng, n: number): number[] => Array.from({ length: n }, () => rng.nextUint32());

describe("Rng", () => {
  it("同じシードからは同じ列が出る（数値・文字列）", () => {
    expect(take(Rng.fromSeed(42), 20)).toEqual(take(Rng.fromSeed(42), 20));
    expect(take(Rng.fromSeed("drop"), 20)).toEqual(take(Rng.fromSeed("drop"), 20));
  });

  it("違うシードからは違う列が出る", () => {
    expect(take(Rng.fromSeed(1), 10)).not.toEqual(take(Rng.fromSeed(2), 10));
  });

  it("状態を保存して復元すると、続きから同じ列が出る", () => {
    const a = Rng.fromSeed(7);
    take(a, 5);
    const b = Rng.fromState(a.getState());
    expect(take(a, 10)).toEqual(take(b, 10));
  });

  it("fork した列は、元の列とも、別のラベルの列とも違う", () => {
    const root = Rng.fromSeed(99);
    const combat = Rng.fromSeed(99).fork("combat");
    const drop = Rng.fromSeed(99).fork("drop");
    expect(take(combat, 10)).not.toEqual(take(drop, 10));
    expect(take(Rng.fromSeed(99).fork("combat"), 10)).not.toEqual(take(root, 10));
  });

  it("next は0以上1未満、int は両端を含む範囲に収まる（性質のテスト）", () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: 0, max: 1000 }),
        (seed, min, span) => {
          const rng = Rng.fromSeed(seed);
          for (let i = 0; i < 50; i++) {
            const x = rng.next();
            if (!(x >= 0 && x < 1)) return false;
            const n = rng.int(min, min + span);
            if (!(Number.isInteger(n) && n >= min && n <= min + span)) return false;
          }
          return true;
        },
      ),
    );
  });

  it("int の分布に大きな偏りがない（1〜6 を6万回）", () => {
    const rng = Rng.fromSeed("dice");
    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 60000; i++) {
      const k = rng.int(1, 6) - 1;
      counts[k] = (counts[k] ?? 0) + 1;
    }
    for (const c of counts) expect(Math.abs(c - 10000)).toBeLessThan(400);
  });

  it("weighted は重みに比例して選ぶ（重み0は選ばれない）", () => {
    const rng = Rng.fromSeed(3);
    const tally = { a: 0, b: 0, c: 0 };
    const entries = [
      { item: "a" as const, weight: 1 },
      { item: "b" as const, weight: 3 },
      { item: "c" as const, weight: 0 },
    ];
    for (let i = 0; i < 40000; i++) tally[rng.weighted(entries)]++;
    expect(tally.c).toBe(0);
    expect(tally.b / tally.a).toBeGreaterThan(2.8);
    expect(tally.b / tally.a).toBeLessThan(3.2);
  });

  it("正しくない引数は例外になる", () => {
    const rng = Rng.fromSeed(0);
    expect(() => rng.int(5, 1)).toThrow(RangeError);
    expect(() => rng.int(0.5, 2)).toThrow(RangeError);
    expect(() => rng.pick([])).toThrow(RangeError);
    expect(() => rng.weighted([{ item: 1, weight: 0 }])).toThrow(RangeError);
    expect(() => rng.weighted([{ item: 1, weight: -1 }])).toThrow(RangeError);
  });

  it("chance は 0 と 1 で必ず結果が決まる", () => {
    const rng = Rng.fromSeed(5);
    for (let i = 0; i < 100; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });

  it("状態を保存・復元した後の列は、元の列と完全に一致する（性質のテスト）", () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: 0, max: 200 }), (seed, skip) => {
        const a = Rng.fromSeed(seed);
        take(a, skip);
        const state = a.getState();
        const b = Rng.fromState(state);
        // 状態そのものも同じ
        if (JSON.stringify(b.getState()) !== JSON.stringify(state)) return false;
        return JSON.stringify(take(a, 30)) === JSON.stringify(take(b, 30));
      }),
    );
  });

  it("JSONを通した状態からも、同じ列を復元できる（セーブデータの形）", () => {
    const a = Rng.fromSeed("save");
    take(a, 3);
    const restored = JSON.parse(JSON.stringify(a.getState())) as [number, number, number, number];
    const b = Rng.fromState(restored);
    expect(take(b, 20)).toEqual(take(a, 20));
  });

  it("有効な状態の境界値（0 と 2^32 - 1）は受け入れる", () => {
    const max = 0xffff_ffff;
    expect(Rng.fromState([0, 0, 0, 1]).getState()).toEqual([0, 0, 0, 1]);
    expect(Rng.fromState([max, max, max, max]).getState()).toEqual([max, max, max, max]);
    expect(Rng.fromState([1, 0, 0, 0]).getState()).toEqual([1, 0, 0, 0]);
  });

  it("fromState は正しくない状態を RangeError にする（書き換えて受け入れない）", () => {
    const bad: unknown[] = [
      [0, 0, 0, 0], // 全て0
      [1, 2, 3], // 3要素
      [1, 2, 3, 4, 5], // 5要素
      [], // 空
      [1, 2, 3, -1], // 負の数
      [1, 2, 3, 0x1_0000_0000], // 2^32
      [1, 2, 3, 1.5], // 整数でない
      [1, 2, 3, Number.NaN],
      [1, 2, 3, Number.POSITIVE_INFINITY],
      [1, 2, 3, Number.NEGATIVE_INFINITY],
      [1, 2, 3, "4"], // 文字列
      [1, 2, 3, null],
      [1, 2, 3, undefined],
      "1,2,3,4", // 配列でない
      { 0: 1, 1: 2, 2: 3, 3: 4, length: 4 }, // 配列に似たもの
      null,
      undefined,
      42,
    ];
    for (const state of bad) {
      expect(() => Rng.fromState(state as never), label(state)).toThrow(RangeError);
    }
  });

  it("float は min 以上 max 未満。min と max が同じなら min", () => {
    const rng = Rng.fromSeed(11);
    for (let i = 0; i < 1000; i++) {
      const x = rng.float(-2.5, 3);
      expect(x).toBeGreaterThanOrEqual(-2.5);
      expect(x).toBeLessThan(3);
    }
    expect(rng.float(4, 4)).toBe(4);
    expect(rng.float(-0.5, -0.5)).toBe(-0.5);
    // 大きいが有限の範囲
    const big = rng.float(-1e300, 1e300);
    expect(Number.isFinite(big)).toBe(true);
  });

  it("float は正しくない引数を RangeError にする", () => {
    const rng = Rng.fromSeed(12);
    const bad: [number, number][] = [
      [1, 0], // max < min
      [0, -Number.EPSILON],
      [Number.NaN, 1],
      [0, Number.NaN],
      [Number.NEGATIVE_INFINITY, 0],
      [0, Number.POSITIVE_INFINITY],
      [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY],
      [-Number.MAX_VALUE, Number.MAX_VALUE], // 差が有限の数にならない
    ];
    for (const [min, max] of bad) {
      expect(() => rng.float(min, max), `${String(min)}, ${String(max)}`).toThrow(RangeError);
    }
  });

  it("chance は 0〜1 の確率で true（境界の 0 と 1 を含む）", () => {
    const rng = Rng.fromSeed(13);
    let hits = 0;
    for (let i = 0; i < 20000; i++) if (rng.chance(0.25)) hits++;
    expect(Math.abs(hits / 20000 - 0.25)).toBeLessThan(0.02);
    expect(typeof rng.chance(Number.MIN_VALUE)).toBe("boolean"); // 0 より大きい最小の確率
    // 1 の直前でも例外にならない
    expect(typeof rng.chance(1 - Number.EPSILON)).toBe("boolean");
  });

  it("chance は 0 と 1 では乱数の列を進めない（既存の動作）", () => {
    const a = Rng.fromSeed(14);
    const b = Rng.fromSeed(14);
    a.chance(0);
    a.chance(1);
    expect(take(a, 5)).toEqual(take(b, 5));
  });

  it("chance は正しくない確率を RangeError にする", () => {
    const rng = Rng.fromSeed(15);
    for (const p of [
      -Number.EPSILON,
      -1,
      1 + Number.EPSILON,
      2,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(() => rng.chance(p), String(p)).toThrow(RangeError);
    }
  });
});
