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

describe("上位職・混成職のデータの形（MVP後の機能の提案 4章）", () => {
  const withAdvanced = (entry: Record<string, unknown>): RawContent => {
    const c = rawContent.collections;
    return {
      ...rawContent,
      collections: {
        ...c,
        jobs: [...(c.jobs ?? []), { file: "test/advanced.json", entries: [entry] }],
      },
    };
  };
  const hybrid = {
    id: "JOB-TEST-ARCANE-ARCHER",
    tag: "TAG-JOB-ARCHER",
    text: "job.archer",
    gauge: "GAU-FOCUS",
    skills: [],
    affinity: { "TAG-WPN-BOW": "S" },
    advancedFrom: ["JOB-ARCHER", "JOB-ROGUE"],
    trial: { text: "job.archer", jobLevel: 30 },
  };

  it("元のジョブ（1つか2つ）と試練を持てる。転職の順番・出自には入らない（挙動は変えない）", () => {
    const loaded = loadContent(withAdvanced(hybrid));
    if (!loaded.ok) throw new Error(loaded.errors.map((e) => e.message).join("\n"));
    const db = loaded.content;
    expect(db.jobs.get("JOB-TEST-ARCANE-ARCHER")?.advancedFrom).toEqual([
      "JOB-ARCHER",
      "JOB-ROGUE",
    ]);
    const sim = new ArenaSimulation(undefined, { db, enemies: false });
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      expect(sim.changeJob()).toBe("ok");
      seen.push(sim.job.id);
    }
    expect(seen).toEqual(["JOB-ROGUE", "JOB-ARCHER", "JOB-WARRIOR", "JOB-ROGUE"]);
  });

  it("元のジョブが無い・自分自身・重なり、元のジョブの無い試練は、データの誤り", () => {
    for (const bad of [
      { ...hybrid, advancedFrom: ["JOB-NOPE"] },
      { ...hybrid, advancedFrom: ["JOB-TEST-ARCANE-ARCHER"] },
      { ...hybrid, advancedFrom: ["JOB-ARCHER", "JOB-ARCHER"] },
      { ...hybrid, advancedFrom: undefined },
    ]) {
      const entry = Object.fromEntries(Object.entries(bad).filter(([, v]) => v !== undefined));
      expect(loadContent(withAdvanced(entry)).ok, JSON.stringify(bad.advancedFrom)).toBe(false);
    }
  });
});
