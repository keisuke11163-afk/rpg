import { effectSchema, type ActiveEffect } from "@stella/core";
import { describe, expect, it } from "vitest";
import { STANDARD_DUMMY, WEAPONS, simulate, type BuildDef } from "../src/sim.ts";

const longsword = WEAPONS["longsword"];
if (!longsword) throw new Error("武器がない");
const lv1: BuildDef = {
  name: "Lv1",
  charLevel: 1,
  weapon: longsword,
  skills: [{ name: "通常攻撃", multiplier: 1, cooldown: 0 }],
  stats: { 剛: 20 },
};
const bonus = (v: number): ActiveEffect => ({
  origin: "ツリー",
  effect: effectSchema.parse({
    id: "EFF-SIM-1",
    source: "基本ノード",
    modifiers: [{ kind: "加算％", stat: "ダメージ", value: v }],
    affects: { 打撃値: false, 基準値: false },
    scope: "自分",
  }),
});

describe("DPSシミュレーター", () => {
  it("Lv1・下級の長剣で、2.8の「DPS15」の近く（±20%）になる", () => {
    // 手計算：平均8.5 × 1.4回/秒 × (1＋剛20×0.2%) × (1＋会心5%×0.5) ≒ 12.7
    // 15との差は仕様の疑問として報告する（ベースの値か、標準ビルドの前提が不足している）
    const r = simulate(lv1, STANDARD_DUMMY, { seed: 1, maxSeconds: 120 });
    expect(r.dps).toBeGreaterThan(15 * 0.8);
    expect(r.dps).toBeLessThan(15 * 1.2);
  });
  it("同じシードなら同じ結果、違うシードなら違う結果", () => {
    const a = simulate(lv1, STANDARD_DUMMY, { seed: "x", maxSeconds: 30 });
    const b = simulate(lv1, STANDARD_DUMMY, { seed: "x", maxSeconds: 30 });
    const c = simulate(lv1, STANDARD_DUMMY, { seed: "y", maxSeconds: 30 });
    expect(b).toEqual(a);
    expect(c.totalDamage).not.toBe(a.totalDamage);
  });
  it("補正を足すとDPSが比例して上がる", () => {
    const base = simulate(lv1, STANDARD_DUMMY, { seed: 3, maxSeconds: 60 });
    const buffed = simulate({ ...lv1, effects: [bonus(0.5)] }, STANDARD_DUMMY, {
      seed: 3,
      maxSeconds: 60,
    });
    expect(buffed.dps / base.dps).toBeGreaterThan(1.35);
    expect(buffed.dps / base.dps).toBeLessThan(1.5);
  });
  it("撃破時間を出す", () => {
    const r = simulate(lv1, { maxHp: 30 }, { seed: 1 });
    expect(r.timeToKill).toBeDefined();
    expect(r.timeToKill).toBeLessThan(10);
    expect(simulate(lv1, { maxHp: 1e9 }, { seed: 1, maxSeconds: 5 }).timeToKill).toBeUndefined();
  });
  it("防具値と耐性で、与えるダメージが減る", () => {
    const base = simulate(lv1, STANDARD_DUMMY, { seed: 3, maxSeconds: 30 });
    const armored = simulate(lv1, { ...STANDARD_DUMMY, armor: 1000 }, { seed: 3, maxSeconds: 30 });
    expect(armored.dps).toBeLessThan(base.dps);
  });
});
