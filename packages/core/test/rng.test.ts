import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Rng } from "../src/index.ts";

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
});
