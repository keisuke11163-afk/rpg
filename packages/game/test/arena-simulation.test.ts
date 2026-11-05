import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { FIXED_STEP_SECONDS, FixedStepClock, type MotionInput, PlayerMotion } from "@stella/core";
import type { Action } from "../src/input/actions.ts";
import type { InputFrame } from "../src/input/frame.ts";
import { ArenaSimulation } from "../src/scenes/arena-simulation.ts";
import { toMeters, toPixels } from "../src/world/units.ts";

const STEP = FIXED_STEP_SECONDS;
const START = { x: 12, y: 12 };

/** 照準は右（プレイヤーの右10m）。押した瞬間の行動と移動を指定できる。 */
function input(opts: { pressed?: Action[]; move?: { x: number; y: number } } = {}): InputFrame {
  return {
    held: new Set<Action>(),
    pressed: new Set<Action>(opts.pressed ?? []),
    move: opts.move ?? { x: 0, y: 0 },
    pointerWorld: { x: toPixels(START.x + 10), y: toPixels(START.y) },
  };
}

/** 各刻みで PlayerMotion に渡された回避の入力を記録する。 */
function recordDodges(sim: ArenaSimulation): boolean[] {
  const log: boolean[] = [];
  const original = sim.motion.update.bind(sim.motion);
  vi.spyOn(sim.motion, "update").mockImplementation((dt: number, i: MotionInput) => {
    log.push(i.dodge);
    original(dt, i);
  });
  return log;
}

describe("ArenaSimulation：回避の入力を刻みまで保持する", () => {
  it("刻みが0のフレームで押した回避は、消えずに次の刻みで発動する", () => {
    const sim = new ArenaSimulation();
    const dodges = recordDodges(sim);
    expect(sim.frame(0, input({ pressed: ["dodge"] }))).toBe(0);
    // まだ刻みがないので、発動はせず、保持している
    expect(sim.dodgePending).toBe(true);
    expect(sim.motion.dodging).toBe(false);
    expect(sim.motion.currentStamina).toBe(100);
    expect(dodges).toEqual([]);

    expect(sim.frame(STEP, input())).toBe(1);
    expect(dodges).toEqual([true]);
    expect(sim.dodgePending).toBe(false);
    expect(sim.motion.dodging).toBe(true);
    expect(sim.motion.currentStamina).toBe(75);
  });

  it("刻みが進まない描画のフレームが続いても、入力を保持し続ける", () => {
    const sim = new ArenaSimulation();
    sim.frame(0, input({ pressed: ["dodge"] }));
    // 1刻み（1/60秒）未満のフレームを何回か（合計も1刻み未満）
    for (let i = 0; i < 5; i++) {
      expect(sim.frame(STEP / 10, input())).toBe(0);
      expect(sim.dodgePending).toBe(true);
    }
    expect(sim.motion.position).toEqual(START);
    // 合計が1刻みに届いたフレームで発動する
    expect(sim.frame(STEP / 2, input())).toBe(1);
    expect(sim.motion.dodging).toBe(true);
    expect(sim.dodgePending).toBe(false);
  });

  it("消費した回避の入力は、その後の刻みで再び発動しない", () => {
    const sim = new ArenaSimulation();
    const dodges = recordDodges(sim);
    sim.frame(0, input({ pressed: ["dodge"] }));
    // 回避（0.35秒）が終わり、さらに十分な時間が経つまで進める
    for (let i = 0; i < 120; i++) sim.frame(STEP, input());
    expect(dodges.filter(Boolean)).toHaveLength(1);
    expect(dodges[0]).toBe(true);
    expect(sim.motion.dodging).toBe(false);
    // 回避は1回だけ：右（照準の方向）へ4m
    expect(sim.motion.position.x - START.x).toBeCloseTo(4, 6);
    expect(sim.motion.position.y).toBe(START.y);
  });

  it("1フレームで複数の刻みを進めても、回避の入力は最初の刻みにだけ渡る", () => {
    const sim = new ArenaSimulation();
    const dodges = recordDodges(sim);
    expect(sim.frame(5 * STEP, input({ pressed: ["dodge"] }))).toBe(5);
    expect(dodges).toEqual([true, false, false, false, false]);
    expect(sim.motion.currentStamina).toBe(75);
    // 刻みが0のフレームで押した後、複数の刻みを進めるフレームが来ても1回だけ
    const sim2 = new ArenaSimulation();
    const dodges2 = recordDodges(sim2);
    sim2.frame(0, input({ pressed: ["dodge"] }));
    expect(sim2.frame(4 * STEP, input())).toBe(4);
    expect(dodges2).toEqual([true, false, false, false]);
    for (let i = 0; i < 10; i++) sim2.frame(5 * STEP, input());
    expect(dodges2.filter(Boolean)).toHaveLength(1);
    expect(sim2.motion.position.x - START.x).toBeCloseTo(4, 6);
  });

  it("経過時間が正しくないフレームでは、例外を出し、入力も保持しない", () => {
    const sim = new ArenaSimulation();
    expect(() => sim.frame(Number.POSITIVE_INFINITY, input({ pressed: ["dodge"] }))).toThrow(
      RangeError,
    );
    expect(sim.dodgePending).toBe(false);
  });

  it("回避以外の押した瞬間の入力は保持しない（まだ使わない行動が後で発動しないように）", () => {
    const sim = new ArenaSimulation();
    sim.frame(0, input({ pressed: ["skill1", "flaskHp"] }));
    expect(sim.dodgePending).toBe(false);
    sim.frame(STEP, input());
    expect(sim.motion.dodging).toBe(false);
  });
});

describe("ArenaSimulation：回避の入力がない場合は従来どおり", () => {
  it("移動は毎秒5m（フレームの区切り方によらない）", () => {
    const sim = new ArenaSimulation();
    // 0刻みのフレームを混ぜても、合計1秒で5m
    for (let i = 0; i < 60; i++) {
      sim.frame(STEP / 2, input({ move: { x: 0, y: -1 } }));
      sim.frame(STEP / 2, input({ move: { x: 0, y: -1 } }));
    }
    expect(START.y - sim.motion.position.y).toBeCloseTo(5, 6);
    expect(sim.motion.dodging).toBe(false);
    expect(sim.motion.currentStamina).toBe(100);
  });

  it("照準はマウスの位置へ向く", () => {
    const sim = new ArenaSimulation();
    sim.frame(STEP, {
      ...input(),
      pointerWorld: { x: toPixels(START.x), y: toPixels(START.y - 5) },
    });
    expect(sim.motion.direction8).toBe(6);
  });

  it("刻みが1以上のフレームで押した場合は、修正前と同じ結果になる", () => {
    // 修正前の処理（そのフレームの最初の刻みにだけ回避を渡す）を参照として、結果を比べる
    const frameArb = fc.record({
      steps: fc.integer({ min: 1, max: 5 }),
      dodge: fc.boolean(),
      mx: fc.integer({ min: -1, max: 1 }),
      my: fc.integer({ min: -1, max: 1 }),
    });
    fc.assert(
      fc.property(fc.array(frameArb, { maxLength: 80 }), (frames) => {
        const sim = new ArenaSimulation(new FixedStepClock(STEP, 5));
        const ref = new PlayerMotion({ ...START }, undefined, {
          minX: 0.5,
          minY: 0.75,
          maxX: 39.5,
          maxY: 23.75,
        });
        for (const f of frames) {
          const frame = input({
            pressed: f.dodge ? ["dodge"] : [],
            move: { x: f.mx, y: f.my },
          });
          sim.frame(f.steps * STEP, frame);
          for (let i = 0; i < f.steps; i++) {
            const p = ref.position;
            ref.update(STEP, {
              move: frame.move,
              aim: {
                x: toMeters(frame.pointerWorld.x) - p.x,
                y: toMeters(frame.pointerWorld.y) - p.y,
              },
              dodge: i === 0 && f.dodge,
            });
          }
          expect(sim.dodgePending).toBe(false);
        }
        expect(sim.motion.position).toEqual(ref.position);
        expect(sim.motion.currentStamina).toBe(ref.currentStamina);
        expect(sim.motion.dodging).toBe(ref.dodging);
      }),
      { numRuns: 200 },
    );
  });
});
