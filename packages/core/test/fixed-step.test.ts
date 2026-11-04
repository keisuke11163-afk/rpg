import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FIXED_STEP_SECONDS, FixedStepClock } from "../src/index.ts";

describe("FixedStepClock", () => {
  it("1刻みは1/60秒", () => {
    expect(FIXED_STEP_SECONDS).toBeCloseTo(1 / 60);
  });

  it("ちょうど1秒を受け取ると60刻み進む（上限を十分に大きくした場合）", () => {
    const clock = new FixedStepClock(FIXED_STEP_SECONDS, 1000);
    expect(clock.advance(1).steps).toBe(60);
    expect(clock.totalSteps).toBe(60);
  });

  it("細かく分けて受け取っても、合計の刻みの数は同じ", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 0.05, noNaN: true }), { maxLength: 200 }),
        (deltas) => {
          const clock = new FixedStepClock(FIXED_STEP_SECONDS, 1000);
          for (const d of deltas) clock.advance(d);
          const total = deltas.reduce((a, b) => a + b, 0);
          return Math.abs(clock.totalSteps - Math.floor(total / FIXED_STEP_SECONDS + 1e-9)) <= 1;
        },
      ),
    );
  });

  it("処理が追いつかないときは、上限を超えた分を切り捨てる", () => {
    const clock = new FixedStepClock(FIXED_STEP_SECONDS, 5);
    const r = clock.advance(1);
    expect(r.steps).toBe(5);
    expect(r.droppedSeconds).toBeCloseTo(55 / 60);
    expect(clock.advance(0).steps).toBe(0);
  });

  it("alpha は0以上1未満", () => {
    const clock = new FixedStepClock();
    const r = clock.advance(FIXED_STEP_SECONDS * 1.5);
    expect(r.steps).toBe(1);
    expect(r.alpha).toBeGreaterThanOrEqual(0);
    expect(r.alpha).toBeLessThan(1);
    expect(r.alpha).toBeCloseTo(0.5, 5);
  });

  it("正しくない値は例外になる", () => {
    expect(() => new FixedStepClock(0)).toThrow(RangeError);
    expect(() => new FixedStepClock(FIXED_STEP_SECONDS, 0)).toThrow(RangeError);
    expect(() => new FixedStepClock().advance(-1)).toThrow(RangeError);
    expect(() => new FixedStepClock().advance(Number.NaN)).toThrow(RangeError);
  });
});
