import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FixedStepper, MAX_TICKS_PER_UPDATE, createRng, secondsToTicks } from "../src/index.ts";

describe("シード付きの乱数", () => {
  it("同じシードで同じ列が出る", () => {
    const a = createRng(12345);
    const b = createRng(12345);
    expect(Array.from({ length: 50 }, () => a.next())).toEqual(
      Array.from({ length: 50 }, () => b.next()),
    );
  });

  it("違うシードでは違う列になる", () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
    expect(createRng("a").next()).not.toBe(createRng("b").next());
  });

  it("状態を保存・復元すると続きが一致する", () => {
    const rng = createRng("save");
    for (let i = 0; i < 10; i++) rng.next();
    const state = rng.getState();
    const expected = Array.from({ length: 20 }, () => rng.next());
    rng.setState(state);
    expect(Array.from({ length: 20 }, () => rng.next())).toEqual(expected);
  });

  it("fork は親の状態を進めず、同じラベルなら同じ列", () => {
    const rng = createRng(7);
    const before = rng.getState();
    const x = rng.fork("drop");
    const y = rng.fork("drop");
    expect(rng.getState()).toEqual(before);
    expect(x.next()).toBe(y.next());
    expect(rng.fork("other").next()).not.toBe(rng.fork("drop").next());
  });

  it("int は範囲内、next は [0,1)", () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: -100, max: 100 }), fc.nat(50), (seed, min, w) => {
        const rng = createRng(seed);
        for (let i = 0; i < 20; i++) {
          const v = rng.int(min, min + w);
          expect(v).toBeGreaterThanOrEqual(min);
          expect(v).toBeLessThanOrEqual(min + w);
          const f = rng.next();
          expect(f).toBeGreaterThanOrEqual(0);
          expect(f).toBeLessThan(1);
        }
      }),
    );
  });

  it("おおよそ一様に分布する", () => {
    const rng = createRng("uniform");
    const counts = new Array<number>(10).fill(0);
    for (let i = 0; i < 100000; i++) {
      const k = rng.int(0, 9);
      counts[k] = (counts[k] ?? 0) + 1;
    }
    for (const c of counts) expect(Math.abs(c - 10000)).toBeLessThan(500);
  });

  it("weightedIndex は重みに比例し、重み0は選ばれない", () => {
    const rng = createRng("w");
    const counts = [0, 0, 0];
    for (let i = 0; i < 30000; i++) {
      const k = rng.weightedIndex([1, 0, 2]);
      counts[k] = (counts[k] ?? 0) + 1;
    }
    expect(counts[1]).toBe(0);
    expect((counts[2] ?? 0) / (counts[0] ?? 1)).toBeGreaterThan(1.8);
    expect((counts[2] ?? 0) / (counts[0] ?? 1)).toBeLessThan(2.2);
    expect(() => rng.weightedIndex([0, 0])).toThrow();
  });
});

describe("固定の時間刻み", () => {
  it("フレーム間隔がばらついても、刻みの合計は同じ", () => {
    const total = (frames: number[]): number => {
      const s = new FixedStepper();
      return frames.reduce((sum, ms) => sum + s.advance(ms), 0);
    };
    expect(total(new Array<number>(60).fill(1000 / 60))).toBe(60);
    expect(total([500, 250, 250])).toBe(MAX_TICKS_PER_UPDATE * 3);
    expect(total(new Array<number>(10).fill(100))).toBe(60);
  });

  it("秒を刻みに変換する", () => {
    expect(secondsToTicks(0.3)).toBe(18);
  });
});
