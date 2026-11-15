/**
 * 職奥義の仕組み（core の部品を実データで確かめる）：単相の極み（位相のゲージ）・一体入魂（同時に呼べる数）・断罪者（終結技の1点あたりの加算）。
 * docs/progress/sessions/job-ultimates.md
 */
import { describe, expect, it } from "vitest";
import { JobGauge, MinionSquad, loadContent, resolveSkill } from "@stella/core";
import { loadGameContent, rawContent } from "../src/index.ts";

const db = loadGameContent();

function phase(): JobGauge {
  const def = db.gauges.get("GAU-PHASE");
  if (def === undefined) throw new Error("GAU-PHASE が無い");
  return new JobGauge(def);
}

describe("単相の極み（位相のゲージ）", () => {
  it("有効にすると、位相は増えず・合成魔法に変わらない。同じ属性を続けた回数を数える（最初は0）", () => {
    const g = phase();
    g.singlePhaseMax = 5;
    expect(g.singlePhase).toBe(true);
    g.onSpellCast("fire");
    expect(g.sameElementStreak).toBe(0);
    g.onSpellCast("fire");
    expect(g.sameElementStreak).toBe(1);
    g.onSpellCast("cold");
    expect(g.sameElementStreak).toBe(0);
    g.onSpellCast("fire");
    expect(g.value).toBe(0);
    expect(g.fusion).toBeUndefined();
    expect(g.fusionFor(["TAG-ELEM-FIRE", "TAG-FORM-SPELL"])).toBeUndefined();
    expect(g.stages).toEqual([]);
  });

  it("回数は上限（5）で止まる（6回目以降も5）", () => {
    const g = phase();
    g.singlePhaseMax = 5;
    for (let i = 0; i < 6; i++) g.onSpellCast("lightning");
    expect(g.sameElementStreak).toBe(5);
    g.onSpellCast("lightning");
    expect(g.sameElementStreak).toBe(5);
  });

  it("属性を持たない呪文は数えも途切れもしない（位相と同じ neutral: ignore）。戦闘外で0に戻る", () => {
    const g = phase();
    g.singlePhaseMax = 5;
    g.onSpellCast("fire");
    g.onSpellCast("fire");
    g.onSpellCast(undefined);
    expect(g.sameElementStreak).toBe(1);
    g.onSpellCast("fire");
    expect(g.sameElementStreak).toBe(2);
    g.update(5);
    expect(g.sameElementStreak).toBe(0);
  });

  it("位相の開始の量（職詞）・量を足す効果は効かない。外すと位相に戻る（数えていた分は忘れる）", () => {
    const g = phase();
    g.singlePhaseMax = 5;
    g.startValue = 1;
    expect(g.value).toBe(0);
    expect(g.add(2)).toBe(0);
    g.onSpellCast("fire");
    g.onSpellCast("fire");
    g.singlePhaseMax = 0;
    expect(g.singlePhase).toBe(false);
    expect(g.sameElementStreak).toBe(0);
    g.onSpellCast("fire");
    expect(g.value).toBe(1);
  });

  it("無効（既定）なら今までどおりの位相", () => {
    const g = phase();
    expect(g.singlePhase).toBe(false);
    g.onSpellCast("fire");
    g.onSpellCast("cold");
    g.onSpellCast("fire");
    expect(g.value).toBe(3);
    expect(g.sameElementStreak).toBe(0);
  });

  it("位相の仕組みを持たないゲージには効かない", () => {
    const def = db.gauges.get("GAU-FERVOR");
    if (def === undefined) throw new Error("GAU-FERVOR が無い");
    const g = new JobGauge(def);
    g.singlePhaseMax = 5;
    expect(g.singlePhase).toBe(false);
  });
});

describe("一体入魂（同時に呼べる数）", () => {
  const action = db.skills.get("SKL-SUMMONER-DIRE-WOLF")?.action;
  if (action?.type !== "summon") throw new Error("魔狼の契約が無い");
  const wolf = action.minion;

  it("上限1なら、枠が余っていても2体目は count で呼べない", () => {
    const squad = new MinionSquad(14);
    squad.maxCount = 1;
    expect(squad.blockOf(wolf)).toBeUndefined();
    expect(squad.summon(db, wolf, { characterLevel: 20, position: { x: 0, y: 0 } })).toBeDefined();
    expect(squad.free).toBeGreaterThanOrEqual(wolf.slots);
    expect(squad.blockOf(wolf)).toBe("count");
    expect(
      squad.summon(db, wolf, { characterLevel: 20, position: { x: 0, y: 0 } }),
    ).toBeUndefined();
  });

  it("禁止の印は数の上限より先に判定する。既定（無制限）は今までどおり枠だけで決まる", () => {
    const squad = new MinionSquad(10);
    squad.maxCount = 0;
    expect(squad.blockOf(wolf, true)).toBe("forbidden");
    expect(squad.blockOf(wolf)).toBe("count");
    const free = new MinionSquad(10);
    expect(free.maxCount).toBe(Infinity);
    free.summon(db, wolf, { characterLevel: 20, position: { x: 0, y: 0 } });
    free.summon(db, wolf, { characterLevel: 20, position: { x: 0, y: 0 } });
    expect(free.minions.length).toBe(2);
  });
});

describe("断罪者（終結技の1点あたりの加算）", () => {
  const judgment = db.skills.get("SKL-KNIGHT-JUDGMENT");
  if (judgment === undefined) throw new Error("断罪の刃が無い");
  const base = { stages: [], weaponTags: new Set<string>() };

  it("断罪の刃は能力値 STAT-JOB-JUDGMENT-PER-POINT を参照する（+20%の値は変えない）", () => {
    expect(judgment.finisher?.pctPerPoint).toBe(0.2);
    expect(judgment.finisher?.pctPerPointStat).toBe("STAT-JOB-JUDGMENT-PER-POINT");
  });

  it("加算0.1なら1点につき+30%（信念10で 2.0 + 3.0）。加算が無ければ+20%のまま。0点なら変わらない", () => {
    const at = (spent: number, bonus?: number): number =>
      resolveSkill(db, judgment, {
        ...base,
        gaugeSpent: spent,
        ...(bonus === undefined ? {} : { finisherPctPerPointBonus: bonus }),
      }).damage.pct;
    expect(at(10)).toBeCloseTo(4.0, 9);
    expect(at(10, 0.1)).toBeCloseTo(5.0, 9);
    expect(at(20, 0.1)).toBeCloseTo(8.0, 9);
    expect(at(0, 0.1)).toBeCloseTo(2.0, 9);
  });

  it("参照する能力値が無いIDなら、読み込みで誤りになる", () => {
    const raw = structuredClone(rawContent);
    const j = (raw.collections.skills ?? [])
      .flatMap((f) => f.entries as Record<string, unknown>[])
      .find((e) => e.id === "SKL-KNIGHT-JUDGMENT");
    if (j === undefined) throw new Error("断罪の刃が無い");
    j.finisher = { pctPerPoint: 0.2, pctPerPointStat: "STAT-NOPE" };
    const r = loadContent(raw);
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(
        r.errors.some((e) => e.path === "finisher.pctPerPointStat" && e.code === "unknown-ref"),
      ).toBe(true);
  });
});
