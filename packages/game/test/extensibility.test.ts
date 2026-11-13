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
    for (let i = 0; i < 7; i++) {
      expect(sim.changeJob()).toBe("ok");
      seen.push(sim.job.id);
    }
    expect(seen).toEqual([
      "JOB-ROGUE",
      "JOB-ARCHER",
      "JOB-MAGE",
      "JOB-KNIGHT",
      "JOB-SUMMONER",
      "JOB-WARRIOR",
      "JOB-ROGUE",
    ]);
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

describe("位相のジョブ（魔法使い）をデータだけで足す（MVP後の機能の提案 3章 H-09）", () => {
  const PJOB = "JOB-TEST-PHASE";
  const spell = (id: string, element: "fire" | "cold") => ({
    id,
    text: "skill.mage.fireball",
    job: PJOB,
    tags: ["TAG-FORM-SPELL", element === "fire" ? "TAG-ELEM-FIRE" : "TAG-ELEM-COLD"],
    kind: "spell",
    pct: 1,
    base: { [element]: { min: 10, max: 10 } },
    mpCost: 1,
    cooldown: 0,
    action: { type: "chain", range: 14, jumpRange: 6, chains: 0 },
  });
  // 遷移表だけが違う：最初の呪文は増えない・位相2で合成魔法（氷＋火。名前は test-fuse）
  const gauge = (fusionText: string): Record<string, unknown> => ({
    id: "GAU-TEST-PHASE",
    text: "gauge.phase",
    max: 3,
    gains: [],
    decayOutOfCombat: 0,
    stages: [{ id: "test-fuse", min: 1, text: "gauge.phase.steam" }],
    phase: {
      elements: ["fire", "cold"],
      transitions: [
        { input: "first", add: 0 },
        { input: "same", add: 0 },
        { input: "different", add: 1 },
      ],
      neutral: "reset",
      fusion: {
        at: 1,
        after: 0,
        excludeTags: [],
        table: [
          {
            id: "test-fuse",
            text: fusionText,
            elements: ["cold", "fire"],
            mods: { pctMultiplier: 3 },
          },
        ],
      },
    },
  });
  const withPhaseJob = (
    fusionText: string,
    patch: (g: Record<string, unknown>) => Record<string, unknown> = (g) => g,
  ): RawContent => {
    const c = rawContent.collections;
    return {
      ...rawContent,
      collections: {
        ...c,
        gauges: [
          ...(c.gauges ?? []),
          { file: "test/phase-gauge.json", entries: [patch(gauge(fusionText))] },
        ],
        skills: [
          ...(c.skills ?? []),
          {
            file: "test/phase-skills.json",
            entries: [spell("SKL-TEST-PHASE-FIRE", "fire"), spell("SKL-TEST-PHASE-ICE", "cold")],
          },
        ],
        jobs: [
          ...(c.jobs ?? []),
          {
            file: "test/phase-job.json",
            entries: [
              {
                id: PJOB,
                tag: "TAG-JOB-MAGE",
                text: "job.mage",
                gauge: "GAU-TEST-PHASE",
                skills: [
                  { skill: "SKL-TEST-PHASE-FIRE", level: 1 },
                  { skill: "SKL-TEST-PHASE-ICE", level: 1 },
                ],
                affinity: { "TAG-WPN-STAFF": "S" },
                originAttributes: { go: 5, jin: 5, ri: 20, kon: 10 },
                defaultSlots: ["SKL-BASIC-ATTACK", "SKL-TEST-PHASE-FIRE", "SKL-TEST-PHASE-ICE"],
                startingWeapon: "BASE-WPN-STAFF-T1",
              },
            ],
          },
        ],
      },
    };
  };

  it("遷移表・合成魔法をデータで差し替えると、そのとおりに働く（ゲームの本体は変えない）", () => {
    const loaded = loadContent(withPhaseJob("gauge.phase.steam"));
    if (!loaded.ok) throw new Error(loaded.errors.map((e) => e.message).join("\n"));
    const db = loaded.content;
    const sim = new ArenaSimulation(undefined, {
      db,
      profile: newCharacterProfile(db, PJOB, "試験"),
      enemies: false,
    });
    sim.gainXp(1e7);
    const press = (slot: Action): void => {
      const frame = (pressed: Action[]): InputFrame => ({
        held: new Set<Action>(),
        pressed: new Set<Action>(pressed),
        move: { x: 0, y: 0 },
        pointerWorld: { x: 100, y: 0 },
      });
      sim.frame(FIXED_STEP_SECONDS, frame([slot]));
      for (let i = 0; i < 200 && sim.executing !== undefined; i++)
        sim.frame(FIXED_STEP_SECONDS, frame([]));
    };
    press("skill2"); // 火。最初の呪文は増えない（データの表）
    expect(sim.jobGauge.value).toBe(0);
    press("skill3"); // 氷。違う属性で+1 → 位相1で合成魔法（at: 1）
    expect(sim.jobGauge.value).toBe(1);
    expect(sim.jobGauge.stages).toEqual(["test-fuse"]);
    press("skill2");
    expect(sim.lastSkill?.variants).toContain("fusion:test-fuse");
    expect(sim.jobGauge.value).toBe(0);
  });

  it("合成魔法の文章のキーが無いなど、データの誤りは読み込みの誤りになる", () => {
    const bad = loadContent(withPhaseJob("gauge.phase.nope"));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.some((e) => e.code === "unknown-text")).toBe(true);
  });

  it("位相の表の誤り（位相が最大を超える・組み合わせが同じ属性や範囲外・input の重なり・対応する段階が無い）は読み込みの誤りになる", () => {
    type Phase = {
      transitions: unknown[];
      fusion: { at: number; table: { elements: string[] }[] };
    } & Record<string, unknown>;
    const edit =
      (f: (p: Phase, g: Record<string, unknown>) => void) =>
      (g: Record<string, unknown>): Record<string, unknown> => {
        const copy = structuredClone(g);
        f(copy.phase as Phase, copy);
        return copy;
      };
    const cases: Record<string, (g: Record<string, unknown>) => Record<string, unknown>> = {
      位相が最大を超える: edit((p) => (p.fusion.at = 4)),
      同じ属性の組み合わせ: edit(
        (p) => p.fusion.table[0] && (p.fusion.table[0].elements = ["fire", "fire"]),
      ),
      "phase.elements に無い属性": edit(
        (p) => p.fusion.table[0] && (p.fusion.table[0].elements = ["fire", "dark"]),
      ),
      "input の重なり": edit((p) => p.transitions.push({ input: "same", add: 1 })),
      対応する段階が無い: edit((_, g) => (g.stages = [])),
    };
    for (const [name, patch] of Object.entries(cases)) {
      const r = loadContent(withPhaseJob("gauge.phase.steam", patch));
      expect(r.ok, name).toBe(false);
    }
  });
});
