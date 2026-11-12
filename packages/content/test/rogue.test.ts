/** 盗賊のデータ（仕様書v0.2 5.6・補助仕様書3.2・3.5・3.6）と、能力値の効果（仕様書2.2）を確かめる。 */
import { Character, TagIndex, evaluateEffects, unlockedSkills, weaponAffinity } from "@stella/core";
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../src/index.ts";

const db = loadGameContent();
const tags = new TagIndex(db.tags);
const job = (id: string) => {
  const j = db.jobs.get(id);
  if (j === undefined) throw new Error(id);
  return j;
};
const skill = (id: string) => {
  const s = db.skills.get(id);
  if (s === undefined) throw new Error(id);
  return s;
};

describe("盗賊（仕様書v0.2 5.6）", () => {
  const rogue = job("JOB-ROGUE");
  it("技を覚える時期・適性・二刀流A・背面判定・初期能力値", () => {
    expect(unlockedSkills(rogue, 12)).toEqual([
      "SKL-ROGUE-FLURRY",
      "SKL-ROGUE-SHADOWSTEP",
      "SKL-ROGUE-PIERCE",
      "SKL-ROGUE-POISON",
      "SKL-ROGUE-SMOKE",
      "SKL-ROGUE-TRAP",
    ]);
    const of = (w: string) => weaponAffinity(tags, rogue, [w]);
    expect(
      ["TAG-WPN-DAGGER", "TAG-WPN-CLAW", "TAG-WPN-SWORD", "TAG-WPN-BOW", "TAG-WPN-STAFF"].map(of),
    ).toEqual(["S", "S", "B", "B", "C"]);
    expect(rogue.dualWield).toBe("A");
    expect(rogue.backstabBonus).toEqual({ critChance: 0.1, ailmentChance: 0.25 });
    expect(rogue.originAttributes).toEqual({ go: 10, jin: 20, ri: 5, kon: 5 });
    expect(job("JOB-WARRIOR").originAttributes).toEqual({ go: 20, jin: 10, ri: 5, kon: 5 });
  });

  it("技の値（MP／CD・技倍率・崩し係数・付与率）", () => {
    const row = (id: string) => {
      const s = skill(id);
      return [s.mpCost, s.cooldown, s.pct, s.staggerCoefficient];
    };
    expect(row("SKL-ROGUE-FLURRY")).toEqual([4, 0, 0.6, 0.15]);
    expect(row("SKL-ROGUE-SHADOWSTEP")).toEqual([8, 4, 0, undefined]);
    expect(row("SKL-ROGUE-POISON")).toEqual([10, 15, 0, undefined]);
    expect(row("SKL-ROGUE-SMOKE")).toEqual([12, 10, 0, undefined]);
    expect(row("SKL-ROGUE-PIERCE")).toEqual([6, 0, 1, 0.3]);
    expect(row("SKL-ROGUE-TRAP")).toEqual([10, 0, 1.2, 0.3]);
    expect(skill("SKL-ROGUE-PIERCE").finisher).toEqual({ pctPerPoint: 0.8, forceCritAt: 5 });
    expect(skill("SKL-ROGUE-TRAP").ailmentChance).toEqual({ "TAG-AIL-BLEED": 1 });
    expect(skill("SKL-ROGUE-SMOKE").action).toMatchObject({ range: 6, radius: 3, duration: 4 });
    expect(skill("SKL-ROGUE-TRAP").action).toMatchObject({ range: 5, radius: 1, max: 3 });
    expect(skill("SKL-ROGUE-SHADOWSTEP").action).toMatchObject({ range: 8 });
    expect(db.gauges.get("GAU-COMBO")?.max).toBe(5);
  });
});

describe("能力値の効果（仕様書2.2）", () => {
  it("戦士の出自（剛20・迅10・理5・魂5）のLv1：HP 60＋40、MP 60＋7.5、命中 2＋30", () => {
    const c = new Character({ origin: job("JOB-WARRIOR"), jobs: db.jobs });
    const { view } = evaluateEffects(db, tags, c.attributeEffects(), { baseStats: c.baseStats() });
    expect(view.stat("STAT-HP-MAX").value).toBe(100);
    expect(view.stat("STAT-MP-MAX").value).toBe(67.5);
    expect(view.stat("STAT-ACCURACY").value).toBe(32);
    expect(view.stat("STAT-DAMAGE", ["TAG-FORM-MELEE", "TAG-ELEM-PHYSICAL"]).increased).toBeCloseTo(
      0.04,
    );
    expect(view.stat("STAT-DAMAGE", ["TAG-FORM-SPELL"]).increased).toBeCloseTo(0.01);
    expect(view.stat("STAT-ATTACK-SPEED").increased).toBeCloseTo(0.01);
    expect(view.stat("STAT-AILMENT-CHANCE").added.min).toBeCloseTo(0.005);
  });
});
