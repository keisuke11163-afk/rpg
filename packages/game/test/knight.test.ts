/**
 * 騎士（仕様書v0.2 5.3）：右クリック（技の枠2）の押し続けでガード（H-05 ②）・転職の順番・データだけでガードのジョブを足せること。
 */
import { describe, expect, it } from "vitest";
import { type RawContent, FIXED_STEP_SECONDS, loadContent } from "@stella/core";
import { loadGameContent, rawContent } from "@stella/content";
import type { Action } from "../src/input/actions.ts";
import type { InputFrame } from "../src/input/frame.ts";
import { ArenaSimulation, newCharacterProfile } from "../src/scenes/arena-simulation.ts";

const STEP = FIXED_STEP_SECONDS;
const db = loadGameContent();

function frame(held: Action[] = [], pressed: Action[] = []): InputFrame {
  return {
    held: new Set<Action>(held),
    pressed: new Set<Action>(pressed),
    move: { x: 0, y: 0 },
    pointerWorld: { x: 100, y: 0 },
  };
}

function simOf(job: string, useDb = db): ArenaSimulation {
  const sim = new ArenaSimulation(undefined, {
    db: useDb,
    enemies: false,
    profile: newCharacterProfile(useDb, job, "試験"),
  });
  sim.gainXp(1e9);
  return sim;
}

describe("騎士の初期の状態", () => {
  it("初期装備は長剣と小盾で、ガードできる。信念は0から始まる", () => {
    const sim = simOf("JOB-KNIGHT");
    expect(sim.job.id).toBe("JOB-KNIGHT");
    expect(sim.canGuard).toBe(true);
    expect(sim.guardRate).toBeGreaterThan(0);
    expect(sim.jobGauge.value).toBe(0);
    expect(sim.jobGauge.def.id).toBe("GAU-FAITH");
  });
});

describe("右クリック（技の枠2）の押し続けでガード", () => {
  it("押している間はガードを上げ、離すと（最短の秒数の後に）下りる。技は使わない", () => {
    const sim = simOf("JOB-KNIGHT");
    const usesBefore = [...sim.uses.values()].reduce((a, b) => a + b, 0);
    sim.frame(STEP, frame(["skill2"], ["skill2"]));
    for (let i = 0; i < 30; i++) sim.frame(STEP, frame(["skill2"]));
    expect(sim.guard?.raised).toBe(true);
    for (let i = 0; i < 60; i++) sim.frame(STEP, frame());
    expect(sim.guard?.raised).toBe(false);
    expect([...sim.uses.values()].reduce((a, b) => a + b, 0)).toBe(usesBefore);
  });

  it("盾を外すとガードできず、右クリックは普通の技の枠に戻る", () => {
    const sim = simOf("JOB-KNIGHT");
    expect(sim.unequip("offHand")).toBe(true);
    expect(sim.canGuard).toBe(false);
    sim.frame(STEP, frame(["skill2"], ["skill2"]));
    for (let i = 0; i < 10; i++) sim.frame(STEP, frame(["skill2"]));
    expect(sim.guard?.raised).toBe(false);
  });

  it("騎士以外のジョブは、盾を持ってもガードの状態を持たない（今までどおり）", () => {
    for (const job of ["JOB-WARRIOR", "JOB-ROGUE", "JOB-ARCHER", "JOB-MAGE"]) {
      const sim = simOf(job);
      expect(sim.guard, job).toBeUndefined();
      expect(sim.canGuard, job).toBe(false);
    }
  });
});

describe("転職の順番", () => {
  it("最初の転職から 盗賊→弓使い→魔法使い→騎士→戦士→盗賊", () => {
    const sim = new ArenaSimulation(undefined, { db, enemies: false });
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      expect(sim.changeJob()).toBe("ok");
      seen.push(sim.job.id);
    }
    expect(seen).toEqual([
      "JOB-ROGUE",
      "JOB-ARCHER",
      "JOB-MAGE",
      "JOB-KNIGHT",
      "JOB-WARRIOR",
      "JOB-ROGUE",
    ]);
  });
});

describe("ガードのジョブをデータだけで足す（MVP後の機能の提案 3章 H-05）", () => {
  const JOB = "JOB-TEST-GUARDIAN";

  function withGuardJob(): RawContent {
    const c = rawContent.collections;
    const knight = (c.jobs ?? [])
      .flatMap((f) => f.entries as Record<string, unknown>[])
      .find((e) => e.id === "JOB-KNIGHT");
    if (knight === undefined) throw new Error("騎士のデータが無い");
    return {
      ...rawContent,
      collections: {
        ...c,
        jobs: [
          ...(c.jobs ?? []),
          {
            file: "test/guardian.json",
            entries: [
              {
                ...knight,
                id: JOB,
                skills: [],
                defaultSlots: ["SKL-BASIC-ATTACK"],
                guard: { ...(knight.guard as object), parryWindow: 0.3 },
              },
            ],
          },
        ],
      },
    };
  }

  it("騎士のデータの写しに別の受付の秒数を持たせると、ゲームの本体を変えずにガードできる", () => {
    const loaded = loadContent(withGuardJob());
    if (!loaded.ok) throw new Error(loaded.errors.map((e) => e.message).join("\n"));
    const sim = simOf(JOB, loaded.content);
    expect(sim.guard?.rule.parryWindow).toBe(0.3);
    expect(sim.canGuard).toBe(true);
    sim.frame(STEP, frame(["skill2"], ["skill2"]));
    for (let i = 0; i < 10; i++) sim.frame(STEP, frame(["skill2"]));
    expect(sim.guard?.raised).toBe(true);
  });
});
