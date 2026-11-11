import { describe, expect, it } from "vitest";
import { DEFAULT_STEP_SECONDS, FixedStepClock } from "../src/index.ts";

describe("FixedStepClock（固定の時間刻み）", () => {
  it("標準は60回／秒", () => {
    expect(DEFAULT_STEP_SECONDS).toBeCloseTo(1 / 60, 12);
    expect(new FixedStepClock().stepSeconds).toBe(DEFAULT_STEP_SECONDS);
  });

  it("描画の間隔が違っても、同じ時間なら同じ回数だけ進む", () => {
    const at60fps = new FixedStepClock();
    const at144fps = new FixedStepClock();
    const at30fps = new FixedStepClock();
    for (let i = 0; i < 60 * 10; i++) at60fps.advance(1 / 60);
    for (let i = 0; i < 144 * 10; i++) at144fps.advance(1 / 144);
    for (let i = 0; i < 30 * 10; i++) at30fps.advance(1 / 30);
    expect(at60fps.tick).toBe(600);
    expect(at144fps.tick).toBe(600);
    expect(at30fps.tick).toBe(600);
    expect(at60fps.elapsedSeconds).toBeCloseTo(10, 9);
  });

  it("端数は持ち越し、補間の割合 alpha を返す", () => {
    const clock = new FixedStepClock({ stepSeconds: 0.1 });
    expect(clock.advance(0.25)).toEqual({
      steps: 2,
      alpha: expect.closeTo(0.5, 9) as number,
      droppedSeconds: 0,
    });
    const next = clock.advance(0.05);
    expect(next.steps).toBe(1);
    expect(next.alpha).toBeCloseTo(0, 9);
    expect(clock.tick).toBe(3);
  });

  it("1回に進める刻みには上限があり、超えた時間は捨てる", () => {
    const clock = new FixedStepClock({ stepSeconds: 0.1, maxStepsPerAdvance: 3 });
    const result = clock.advance(1.05);
    expect(result.steps).toBe(3);
    expect(result.droppedSeconds).toBeCloseTo(0.7, 9);
    expect(result.alpha).toBeCloseTo(0.5, 9);
    expect(clock.tick).toBe(3);
  });

  it("負の数・NaN・無限大は0として扱う", () => {
    const clock = new FixedStepClock();
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(clock.advance(bad)).toEqual({ steps: 0, alpha: 0, droppedSeconds: 0 });
    }
    expect(clock.tick).toBe(0);
  });

  it("reset で最初の状態に戻る", () => {
    const clock = new FixedStepClock();
    clock.advance(1);
    clock.reset();
    expect(clock.tick).toBe(0);
    expect(clock.advance(0).alpha).toBe(0);
  });

  it("正しくない設定を拒む", () => {
    expect(() => new FixedStepClock({ stepSeconds: 0 })).toThrow(RangeError);
    expect(() => new FixedStepClock({ maxStepsPerAdvance: 0 })).toThrow(RangeError);
    expect(() => new FixedStepClock({ maxStepsPerAdvance: 1.5 })).toThrow(RangeError);
  });
});
