/**
 * 職紋盤（U-15、仕様書v0.2 4.10）：取得・職奥義は1つ・振り直し・星辰盤への接続ノード・能力値への反映。
 */
import {
  Character,
  type ContentDb,
  Equipment,
  JobBoardAllocation,
  type JobDef,
  TagIndex,
  buildCharacterSheet,
  jobBoardPoints,
  jobBoardRespecCost,
  nodesWithin,
  startNodeOf,
} from "@stella/core";
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../src/index.ts";

const db: ContentDb = loadGameContent();
const tags = new TagIndex(db.tags);
const job = (id: string): JobDef => {
  const j = db.jobs.get(id);
  if (j === undefined) throw new Error(`${id} がない`);
  return j;
};
const W = "JBN-WARRIOR-";
const trunk = (n: number): string[] => Array.from({ length: n }, (_, i) => `${W}T${String(i + 1)}`);

describe("職紋盤のデータ", () => {
  it("戦士・盗賊の盤：始点1つ・職奥義3つ・星辰盤への接続ノード3つ。19ポイントでは全部は取れない", () => {
    for (const j of ["JOB-WARRIOR", "JOB-ROGUE"]) {
      const nodes = [...db.jobNodes.values()].filter((n) => n.job === j);
      expect(nodes.filter((n) => n.kind === "start")).toHaveLength(1);
      expect(nodes.filter((n) => n.kind === "mastery")).toHaveLength(3);
      expect(nodes.filter((n) => n.kind === "connector")).toHaveLength(3);
      // 職奥義は1つだけなので、取れる数は（全体−始点−職奥義2つ）
      expect(nodes.length - 1 - 2).toBeGreaterThan(jobBoardPoints(20));
    }
    expect(db.jobNodes.get("JBN-ROGUE-POISON-BLOOD")?.kind).toBe("notable");
    expect(jobBoardPoints(1)).toBe(0);
    expect(jobBoardPoints(20)).toBe(19);
    expect(jobBoardRespecCost(12)).toBe(240);
  });
});

describe("職紋盤の取得", () => {
  it("始点か取ったノードの隣だけ取れる。ポイントが要る。別のジョブの盤は取れない", () => {
    const b = new JobBoardAllocation(db, "JOB-WARRIOR");
    expect(b.allocateBlock(`${W}T2`, 5)).toBe("notAdjacent");
    expect(b.allocateBlock(`${W}T1`, 0)).toBe("points");
    expect(b.allocateBlock("JBN-ROGUE-T1", 5)).toBe("otherJob");
    expect(b.allocateBlock(`${W}START`, 5)).toBe("start");
    expect(b.allocate(`${W}T1`, 5)).toBe(true);
    expect(b.allocateBlock(`${W}T1`, 5)).toBe("taken");
    expect(b.allocate(`${W}T2`, 5)).toBe(true);
    expect(b.spent).toBe(2);
  });

  it("職奥義は3つから1つだけ。返すと別の職奥義を選べる", () => {
    const b = new JobBoardAllocation(db, "JOB-WARRIOR", trunk(7));
    expect(b.allocate(`${W}M-DEMON`, 19)).toBe(true);
    expect(b.mastery).toBe(`${W}M-DEMON`);
    expect(b.allocateBlock(`${W}M-SURGE`, 19)).toBe("masteryChosen");
    expect(b.refund(`${W}M-DEMON`)).toBe(true);
    expect(b.allocate(`${W}M-SURGE`, 19)).toBe(true);
    expect(() => new JobBoardAllocation(db, "JOB-WARRIOR", [`${W}M-DEMON`, `${W}M-SURGE`])).toThrow(
      RangeError,
    );
  });

  it("返せるのは、ほかのノードが始点からつながったままのとき。全て返すと0", () => {
    const b = new JobBoardAllocation(db, "JOB-WARRIOR", trunk(3));
    expect(b.canRefund(`${W}T2`)).toBe(false);
    expect(b.refund(`${W}T3`)).toBe(true);
    b.clear();
    expect(b.spent).toBe(0);
  });

  it("ポイントを超えた分は効かない（ジョブLvが足りないセーブデータなどの守り）", () => {
    const b = new JobBoardAllocation(db, "JOB-WARRIOR", trunk(5));
    expect(b.active(3)).toEqual(trunk(3));
    expect(b.effects(3)).toHaveLength(3);
  });
});

describe("職紋盤の効果", () => {
  const sheet = (jobId: string, nodes: readonly string[], level = 20) => {
    const j = job(jobId);
    return buildCharacterSheet(db, tags, {
      character: new Character({ origin: j, level, jobLevels: { [jobId]: level } }),
      job: j,
      equipment: new Equipment(db),
      starBoard: { allocation: [] },
      jobBoard: new JobBoardAllocation(db, jobId, nodes),
    });
  };

  it("ノードの効果が能力値に入る（闘志の炉：自然減少-50%、不屈の闘志：下限30）", () => {
    const none = sheet("JOB-WARRIOR", []);
    expect(none.evaluated.view.stat("STAT-GAUGE-DECAY").increased).toBe(0);
    const s = sheet("JOB-WARRIOR", [
      ...trunk(7),
      `${W}B1A`,
      `${W}B1B`,
      `${W}FORGE`,
      `${W}M-UNYIELDING`,
    ]);
    expect(s.evaluated.view.stat("STAT-GAUGE-DECAY").increased).toBeCloseTo(-0.5);
    expect(s.evaluated.view.stat("STAT-GAUGE-FLOOR").value).toBe(30);
    expect(s.jobNodes.has(`${W}M-UNYIELDING`)).toBe(true);
  });

  it("メインジョブでないジョブの職紋盤は効かない", () => {
    const j = job("JOB-ROGUE");
    const s = buildCharacterSheet(db, tags, {
      character: new Character({ origin: j, level: 20 }),
      job: j,
      jobBoard: new JobBoardAllocation(db, "JOB-WARRIOR", trunk(3)),
    });
    expect(s.jobNodes.size).toBe(0);
  });

  it("両手の誇り：両手武器のときだけ崩し値+25%", () => {
    const path = [...trunk(3), `${W}B3A`, `${W}B3B`, `${W}TWOHAND`];
    const j = job("JOB-WARRIOR");
    const withWeapon = (base: string) => {
      const e = new Equipment(db);
      e.equip({ uid: "w", base, rarity: "normal", itemLevel: 1, affixes: [] }, "mainHand", true);
      return buildCharacterSheet(db, tags, {
        character: new Character({ origin: j, level: 20, jobLevels: { "JOB-WARRIOR": 20 } }),
        job: j,
        equipment: e,
        jobBoard: new JobBoardAllocation(db, "JOB-WARRIOR", path),
      }).evaluated.view.stat("STAT-STAGGER").increased;
    };
    expect(withWeapon("BASE-WPN-GREATAXE-T1") - withWeapon("BASE-WPN-AXE-T1")).toBeCloseTo(0.25);
  });

  it("星辰盤への接続ノード：1つ取るごとに、始点の周りの小星が×2になる範囲が1ノード広がる", () => {
    const root = startNodeOf(db, "JOB-WARRIOR");
    expect(nodesWithin(db, root, 1).size).toBeGreaterThan(0);
    expect(nodesWithin(db, root, 3).size).toBeGreaterThan(nodesWithin(db, root, 1).size);
    const j = job("JOB-WARRIOR");
    const go = (connectors: number) =>
      buildCharacterSheet(db, tags, {
        character: new Character({ origin: j, level: 20, jobLevels: { "JOB-WARRIOR": 20 } }),
        job: j,
        // 始点の隣（剛+10）と、その先（剛+5・迅+5）
        starBoard: { allocation: ["STAR-GOU-0001", "STAR-GOU-0002"] },
        jobBoard: new JobBoardAllocation(db, "JOB-WARRIOR", [
          ...trunk(5),
          ...["C1", "C2", "C3"].slice(0, connectors).map((c) => W + c),
        ]),
      }).attributes.go;
    const base = go(0);
    expect(go(1) - base).toBe(10); // 半径1：剛+10 が×2
    expect(go(2) - base).toBe(15); // 半径2：剛+5 も×2
  });

  it("千の小傷の潜在効果は、盗賊の職紋盤で毒血同源を取ると働く", () => {
    const j = job("JOB-ROGUE");
    const R = "JBN-ROGUE-";
    const make = (nodes: string[]) => {
      const e = new Equipment(db);
      e.equip(
        { uid: "u03", base: "BASE-UNQ-U03", rarity: "unique", itemLevel: 18, affixes: [] },
        "mainHand",
        true,
      );
      return buildCharacterSheet(db, tags, {
        character: new Character({ origin: j, level: 20, jobLevels: { "JOB-ROGUE": 20 } }),
        job: j,
        equipment: e,
        jobBoard: new JobBoardAllocation(db, "JOB-ROGUE", nodes),
      });
    };
    expect(make([]).latents[0]?.active).toBe(false);
    const s = make([`${R}T1`, `${R}B1A`, `${R}B1B`, `${R}POISON-BLOOD`]);
    expect(s.latents[0]?.active).toBe(true);
    expect(s.evaluated.view.stat("STAT-UNQ-BLEED-AS-POISON").value).toBe(1);
  });
});
