/**
 * 開発計画書 T10（相互作用の回帰テスト）のうち、他のテストのファイルに無いもの。
 * MVP の範囲の I-xx・V-xx とテストの対応は docs/progress「T10 の対応」に一覧がある。
 */
import { describe, expect, it } from "vitest";
import { MIN_COOLDOWN, effectiveCooldown } from "../src/scenes/arena-simulation.ts";

describe("V-11：クールダウンの短縮を積み重ねても、CDは0にならない", () => {
  it("短縮は90%まで、CDは0.25秒より短くならない", () => {
    expect(MIN_COOLDOWN).toBe(0.25);
    expect(effectiveCooldown(10, 0.5)).toBeCloseTo(5);
    expect(effectiveCooldown(10, 5)).toBeCloseTo(1); // 90%まで
    expect(effectiveCooldown(1, 0.9)).toBe(0.25); // 0.1秒ではなく0.25秒
  });

  it("CDの無い技は0のまま。元のCDが0.25秒より短い技は元のまま", () => {
    expect(effectiveCooldown(0, 0.9)).toBe(0);
    expect(effectiveCooldown(0.2, 0)).toBeCloseTo(0.2);
    expect(effectiveCooldown(0.2, 0.9)).toBeCloseTo(0.2);
  });
});

describe("V-25：MPを使わない通常攻撃が、MPの技の意味を失わせない", () => {
  it("通常攻撃は技倍率100%・付与率なし・武器による変化と段階による変化なし", async () => {
    const { loadGameContent } = await import("@stella/content");
    const def = loadGameContent().skills.get("SKL-BASIC-ATTACK");
    expect(def?.pct).toBe(1);
    expect(def?.mpCost).toBe(0);
    expect(def?.ailmentChance).toBeUndefined();
    expect(def?.weaponVariants).toBeUndefined();
    expect(def?.stageVariants).toBeUndefined();
  });
});

describe("I-16：武器適性（仕様書v0.2 5章）", () => {
  it("攻撃速度：S +10%・A 標準・B -5%・C -10%", async () => {
    const { AFFINITY_ATTACK_SPEED } = await import("@stella/core");
    expect(AFFINITY_ATTACK_SPEED).toEqual({ S: 0.1, A: 0, B: -0.05, C: -0.1 });
  });

  it("適性Sの大剣の戦士は、同じ武器の基礎の攻撃速度より10%速い", async () => {
    const { ArenaSimulation } = await import("../src/scenes/arena-simulation.ts");
    const sim = new ArenaSimulation(undefined, { enemies: false });
    expect(sim.affinity).toBe("S");
    expect(
      sim.sheet.attackSpeed / (sim.sheet.weapon?.baseAttackSpeed ?? Infinity),
    ).toBeGreaterThanOrEqual(1.1 - 1e-9);
  });
});
