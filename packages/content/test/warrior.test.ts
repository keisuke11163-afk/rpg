/**
 * 戦士のデータ（仕様書v0.2 5.2・補助仕様書3.5・3.6）が、仕様のとおりに働くかを確かめる。
 * 開発計画書のテスト T6（同じ技が武器で変わる）・T7（闘志50で激化、100で解放）を含む。
 */
import {
  type ContentDb,
  FIXED_STEP_SECONDS,
  JobGauge,
  type SkillDef,
  SkillExecution,
  TagIndex,
  resolveSkill,
  skillBlock,
  unlockedSkills,
  weaponAffinity,
} from "@stella/core";
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../src/index.ts";

const db: ContentDb = loadGameContent();
const tags = new TagIndex(db.tags);
const warrior = (() => {
  const j = db.jobs.get("JOB-WARRIOR");
  if (j === undefined) throw new Error("JOB-WARRIOR がない");
  return j;
})();
const skill = (id: string): SkillDef => {
  const s = db.skills.get(id);
  if (s === undefined) throw new Error(`${id} がない`);
  return s;
};
const fervor = (): JobGauge => {
  const g = db.gauges.get(warrior.gauge ?? "");
  if (g === undefined) throw new Error("闘志がない");
  return new JobGauge(g);
};
const resolve = (id: string, weapon: string, stages: readonly string[] = [], dualWield = false) =>
  resolveSkill(db, skill(id), { stages, weaponTags: tags.closure([weapon]), dualWield });

describe("戦士の技（仕様書v0.2 5.2）", () => {
  it("技を覚えるジョブLv（補助仕様書3.5）", () => {
    expect(unlockedSkills(warrior, 1)).toEqual(["SKL-WARRIOR-SWEEP"]);
    expect(unlockedSkills(warrior, 3)).toContain("SKL-WARRIOR-CHARGE");
    expect(unlockedSkills(warrior, 5)).toContain("SKL-WARRIOR-WARCRY");
    expect(unlockedSkills(warrior, 7)).toContain("SKL-WARRIOR-EARTHSPLITTER");
    expect(unlockedSkills(warrior, 10)).toContain("SKL-WARRIOR-WHIRLWIND");
    expect(unlockedSkills(warrior, 11)).not.toContain("SKL-WARRIOR-ROUT");
    expect(unlockedSkills(warrior, 12)).toHaveLength(6);
  });

  it("武器適性：大剣S・大斧S・大槌A・片手斧A・槍A・長剣A・盾B・弓C・杖C・短剣（表にない）C", () => {
    const of = (w: string) => weaponAffinity(tags, warrior, [w]);
    expect(
      [
        "TAG-WPN-GREATSWORD",
        "TAG-WPN-GREATAXE",
        "TAG-WPN-GREATMACE",
        "TAG-WPN-AXE",
        "TAG-WPN-SPEAR",
        "TAG-WPN-SWORD",
        "TAG-WPN-SHIELD",
        "TAG-WPN-BOW",
        "TAG-WPN-STAFF",
        "TAG-WPN-DAGGER",
      ].map(of),
    ).toEqual(["S", "S", "A", "A", "A", "A", "B", "C", "C", "C"]);
    expect(warrior.dualWield).toBe("B");
  });

  it("技の値：薙ぎ払い130%・MP4、地割り220%・MP10・CD4、突進150%・MP8・CD5、破軍800%", () => {
    const pick = (id: string) => {
      const s = skill(id);
      return [s.pct, s.mpCost, s.cooldown, s.staggerCoefficient];
    };
    expect(pick("SKL-WARRIOR-SWEEP")).toEqual([1.3, 4, 0, 0.4]);
    expect(pick("SKL-WARRIOR-EARTHSPLITTER")).toEqual([2.2, 10, 4, 0.8]);
    expect(pick("SKL-WARRIOR-WARCRY")).toEqual([0, 12, 12, undefined]);
    expect(pick("SKL-WARRIOR-CHARGE")).toEqual([1.5, 8, 5, 0.5]);
    expect(pick("SKL-WARRIOR-WHIRLWIND")).toEqual([0.9, 0, 0, 0.2]);
    expect(pick("SKL-WARRIOR-ROUT")).toEqual([8, 0, 0, 2]);
    expect(skill("SKL-WARRIOR-EARTHSPLITTER").tags).toContain("TAG-FORM-HEAVY");
    expect(skill("SKL-WARRIOR-ROUT").tags).toContain("TAG-FORM-HEAVY");
  });

  it("T6：薙ぎ払いは、大剣と斧で違う（大剣は範囲+20%、斧は出血30%、槌は衝撃波）", () => {
    const great = resolve("SKL-WARRIOR-SWEEP", "TAG-WPN-GREATSWORD");
    const axe = resolve("SKL-WARRIOR-SWEEP", "TAG-WPN-GREATAXE");
    const mace = resolve("SKL-WARRIOR-SWEEP", "TAG-WPN-MACE");
    expect(great.action).toEqual({
      type: "strike",
      shape: { type: "sector", radius: 2.2 * 1.2, angleDeg: 120 },
    });
    expect(axe.action).toEqual({
      type: "strike",
      shape: { type: "sector", radius: 2.2, angleDeg: 120 },
    });
    expect(great.ailmentChance).toEqual({});
    expect(axe.ailmentChance).toEqual({ "TAG-AIL-BLEED": 0.3 });
    expect(mace.behaviors.map((b) => b.hook)).toEqual(["shockwave"]);
    expect(great).not.toEqual(axe);
  });

  it("T7：闘志が50になると激化（薙ぎ払いが180°・崩し値+30%）、100で破軍が使える", () => {
    const g = fervor();
    const state = () => ({ cooldown: 0, mp: 100, gauge: g.value, affinity: "S" as const });
    const sweep = () => resolve("SKL-WARRIOR-SWEEP", "TAG-WPN-GREATSWORD", g.stages);
    // 通常のヒットは+2、重撃（地割り）は+6
    for (let i = 0; i < 22; i++) g.onHitDealt(tags.closure(skill("SKL-WARRIOR-SWEEP").tags));
    g.onHitDealt(tags.closure(skill("SKL-WARRIOR-EARTHSPLITTER").tags));
    expect(g.value).toBe(50);
    expect(sweep().action).toMatchObject({ shape: { angleDeg: 180 } });
    expect(sweep().staggerCoefficient).toBeCloseTo(0.52);
    expect(skillBlock(skill("SKL-WARRIOR-ROUT"), state())).toBe("gauge");

    g.add(49);
    expect(skillBlock(skill("SKL-WARRIOR-ROUT"), state())).toBe("gauge");
    g.add(1);
    expect(g.stages).toEqual(["empowered", "release"]);
    expect(skillBlock(skill("SKL-WARRIOR-ROUT"), state())).toBeUndefined();
    // 破軍は闘志を全て使う
    expect(g.spend(skill("SKL-WARRIOR-ROUT").gauge?.cost ?? 0)).toBe(true);
    expect(g.value).toBe(0);
  });

  it("闘志：攻撃を受けると最大HPの1%につき+1、戦闘していないと毎秒-5", () => {
    const g = fervor();
    g.onDamageTaken(12, 120);
    expect(g.value).toBeCloseTo(10);
    for (let i = 0; i < 6 * 60; i++) g.update(FIXED_STEP_SECONDS);
    expect(g.value).toBeCloseTo(5);
  });

  it("激化：地割りは亀裂が残り、突進は崩し、旋風は吸い寄せ、戦吼は範囲×1.5", () => {
    const e = ["empowered"];
    expect(
      resolve("SKL-WARRIOR-EARTHSPLITTER", "TAG-WPN-GREATSWORD", e).behaviors.map((b) => b.hook),
    ).toEqual(["lingeringFissure"]);
    expect(
      resolve("SKL-WARRIOR-CHARGE", "TAG-WPN-GREATSWORD", e).behaviors.map((b) => b.hook),
    ).toEqual(["fullStagger"]);
    expect(
      resolve("SKL-WARRIOR-WHIRLWIND", "TAG-WPN-GREATSWORD", e).behaviors.map((b) => b.hook),
    ).toEqual(["pullIn"]);
    expect(resolve("SKL-WARRIOR-WARCRY", "TAG-WPN-GREATSWORD", e).action).toMatchObject({
      radius: 9,
    });
  });

  it("武器による変化：大槌の地割りは十字、槍の突進は+4m、二刀流の旋風は毎秒6回・70%", () => {
    expect(
      resolve("SKL-WARRIOR-EARTHSPLITTER", "TAG-WPN-GREATMACE").behaviors.map((b) => b.hook),
    ).toEqual(["crossFissure"]);
    expect(resolve("SKL-WARRIOR-CHARGE", "TAG-WPN-SPEAR").action).toMatchObject({
      distance: 12,
    });
    const dual = resolve("SKL-WARRIOR-WHIRLWIND", "TAG-WPN-AXE", [], true);
    expect(dual.damage.pct).toBe(0.7);
    expect(dual.action).toMatchObject({ hitsPerSecond: 6 });
  });

  it("旋風：毎0.25秒にMP3を払い、毎秒4回当たる", () => {
    const exec = new SkillExecution(resolve("SKL-WARRIOR-WHIRLWIND", "TAG-WPN-GREATSWORD"), 0, 1);
    let mp = 0;
    let hits = 0;
    for (let i = 0; i < 120; i++) {
      const t = exec.update(FIXED_STEP_SECONDS, { position: { x: 0, y: 0 }, held: true, mp: 99 });
      mp += t.mpCost;
      hits += t.strikes.length;
    }
    expect(mp).toBe(24);
    expect(hits).toBe(8);
  });

  it("破軍の後8秒間、受けるダメージ-20%。戦吼は闘志+20", () => {
    expect(skill("SKL-WARRIOR-ROUT").selfEffects).toEqual([
      { effect: "EFF-WARRIOR-ROUT-GUARD", duration: 8 },
    ]);
    expect(skill("SKL-WARRIOR-WARCRY").gauge?.gainOnUse).toBe(20);
  });
});

describe("職詞「闘志の獲得量+15%」（U-11 の残り）", () => {
  it("獲得量の倍率は、ヒット・被弾のどちらの獲得にも掛かる", () => {
    const a = fervor();
    const b = fervor();
    b.gainMultiplier = 1.15;
    const t = tags.closure(["TAG-FORM-MELEE"]);
    const ga = a.onHitDealt(t);
    const gb = b.onHitDealt(t);
    expect(gb).toBeCloseTo(ga * 1.15);
    expect(b.onDamageTaken(10, 100)).toBeCloseTo(a.onDamageTaken(10, 100) * 1.15);
  });
});
