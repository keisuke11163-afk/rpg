/**
 * MVPの完成の条件6：3つ目のジョブを、ゲームの本体を変えずに、データだけで足せる（MVP実装単位 1.1）。
 * データの写しに試験用のジョブ（弓使いのタグを借りる）と技を足し、出自にして作り、技を使えることを確かめる。
 */
import { describe, expect, it } from "vitest";
import { type RawContent, FIXED_STEP_SECONDS, loadContent } from "@stella/core";
import { rawContent } from "@stella/content";
import type { Action } from "../src/input/actions.ts";
import type { InputFrame } from "../src/input/frame.ts";
import { ArenaSimulation, newCharacterProfile } from "../src/scenes/arena-simulation.ts";

const JOB = "JOB-TEST-THIRD";
const SKILL = "SKL-TEST-THIRD-SHOT";

function withThirdJob(): RawContent {
  const c = rawContent.collections;
  return {
    ...rawContent,
    collections: {
      ...c,
      skills: [
        ...(c.skills ?? []),
        {
          file: "test/third-job-skills.json",
          entries: [
            {
              id: SKILL,
              text: "skill.rogue.flurry",
              job: JOB,
              tags: ["TAG-FORM-MELEE"],
              kind: "weapon",
              pct: 1.5,
              mpCost: 2,
              cooldown: 0,
              action: { type: "strike", shape: { type: "sector", radius: 1.4, angleDeg: 70 } },
            },
          ],
        },
      ],
      jobs: [
        ...(c.jobs ?? []),
        {
          file: "test/third-job.json",
          entries: [
            {
              id: JOB,
              tag: "TAG-JOB-ARCHER",
              text: "job.rogue",
              gauge: "GAU-COMBO",
              skills: [{ skill: SKILL, level: 1 }],
              affinity: { "TAG-WPN-SWORD": "S" },
              originAttributes: { go: 10, jin: 15, ri: 5, kon: 5 },
              defaultSlots: ["SKL-BASIC-ATTACK", SKILL],
              startingWeapon: "BASE-WPN-LONGSWORD-T1",
            },
          ],
        },
      ],
    },
  };
}

describe("3つ目のジョブをデータだけで足す（MVPの完成の条件6）", () => {
  it("出自にして作ると、初期の武器と技の枠がデータのとおりで、技を使える", () => {
    const loaded = loadContent(withThirdJob());
    if (!loaded.ok) throw new Error(loaded.errors.map((e) => e.message).join("\n"));
    const db = loaded.content;
    const profile = newCharacterProfile(db, JOB, "試験");
    expect(profile.equipment.get("mainHand")?.base).toBe("BASE-WPN-LONGSWORD-T1");
    const sim = new ArenaSimulation(undefined, { db, profile, enemies: false });
    expect(sim.loadout.map((l) => l.skill)).toEqual(["SKL-BASIC-ATTACK", SKILL]);
    const slot = sim.loadout.find((l) => l.skill === SKILL)?.action;
    expect(slot).toBeDefined();
    const frame: InputFrame = {
      held: new Set<Action>(slot === undefined ? [] : [slot]),
      pressed: new Set<Action>(),
      move: { x: 0, y: 0 },
      pointerWorld: { x: 100, y: 0 },
    };
    for (let i = 0; i < 60; i++) sim.frame(FIXED_STEP_SECONDS, frame);
    expect(sim.uses.get(SKILL) ?? 0).toBeGreaterThan(0);
  });
});
