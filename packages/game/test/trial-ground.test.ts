/**
 * 試し打ちの場（MVP後の機能の提案 5章・M-22）：人形の近くで F → 振り直しが無料 → 離れると元に戻る。
 */
import { describe, expect, it } from "vitest";
import { FIXED_STEP_SECONDS } from "@stella/core";
import type { Action } from "../src/input/actions.ts";
import type { InputFrame } from "../src/input/frame.ts";
import { ArenaSimulation, DUMMY_POSITION, TRIAL_RADIUS } from "../src/scenes/arena-simulation.ts";
import { toPixels } from "../src/world/units.ts";

const STEP = FIXED_STEP_SECONDS;
const frame = (opts: { pressed?: Action[]; move?: { x: number; y: number } } = {}): InputFrame => ({
  held: new Set<Action>(),
  pressed: new Set<Action>(opts.pressed ?? []),
  move: opts.move ?? { x: 0, y: 0 },
  pointerWorld: { x: toPixels(DUMMY_POSITION.x), y: toPixels(DUMMY_POSITION.y) },
});

/** 人形の左2mまで歩く。 */
function walkToDummy(sim: ArenaSimulation): void {
  for (let i = 0; i < 600 && sim.motion.position.x < DUMMY_POSITION.x - 2; i++)
    sim.frame(STEP, frame({ move: { x: 1, y: 0 } }));
}

const W = "JBN-WARRIOR-";

describe("試し打ちの場", () => {
  it("人形の近くで F を押すと始まり、職紋盤の振り直しが無料になる。離れると星辰盤・職紋盤・技の枠が元に戻る", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    expect(sim.allocateJobNode(`${W}T1`)).toBe(true);
    const stars0 = [...sim.stars.nodes];
    const slots0 = sim.loadout.map((l) => l.skill);
    walkToDummy(sim);
    expect(sim.nearDummy).toBe(true);
    sim.frame(STEP, frame({ pressed: ["interact"] }));
    expect(sim.inTrial).toBe(true);
    expect(sim.jobBoardRespecCost).toBe(0);

    // 試す：職紋盤を無料で振り直して別の枝を取る・星辰盤を取る・技の枠を替える
    const gold = sim.inventory.gold;
    expect(sim.resetJobBoard()).toBe(true);
    expect(sim.inventory.gold).toBe(gold);
    expect(sim.allocateJobNode(`${W}B1A`)).toBe(false); // T1 から先なので、まず T1
    expect(sim.allocateJobNode(`${W}T1`)).toBe(true);
    expect(sim.allocateJobNode(`${W}B1A`)).toBe(true);
    const root = sim.starRoot;
    const first = [...(sim.db.starLinks.get(root ?? "") ?? [])][0];
    if (first !== undefined) expect(sim.allocateStar(first)).toBe(true);
    expect(sim.setSlotSkill(5, undefined)).toBe(true);

    // 試している間のセーブは、試す前の配置
    expect(sim.saveData().jobs["JOB-WARRIOR"]?.board_allocation).toEqual([`${W}T1`]);
    expect(sim.switchLoadout(2)).toBe("busy");

    // 離れる
    for (let i = 0; i < 600 && sim.inTrial; i++) sim.frame(STEP, frame({ move: { x: -1, y: 0 } }));
    expect(sim.inTrial).toBe(false);
    expect(
      Math.hypot(
        sim.motion.position.x - DUMMY_POSITION.x,
        sim.motion.position.y - DUMMY_POSITION.y,
      ),
    ).toBeGreaterThan(TRIAL_RADIUS);
    expect(sim.jobBoard.nodes).toEqual([`${W}T1`]);
    expect([...sim.stars.nodes]).toEqual(stars0);
    expect(sim.loadout.map((l) => l.skill)).toEqual(slots0);
    expect(sim.jobBoardRespecCost).toBeGreaterThan(0);
  });

  it("もう一度 F を押しても終わる。人形から遠いと始まらない", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    expect(sim.startTrial()).toBe(false);
    walkToDummy(sim);
    sim.frame(STEP, frame({ pressed: ["interact"] }));
    expect(sim.inTrial).toBe(true);
    sim.frame(STEP, frame({ pressed: ["interact"] }));
    expect(sim.inTrial).toBe(false);
  });
});
