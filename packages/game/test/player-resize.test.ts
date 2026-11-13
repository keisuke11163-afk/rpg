import { describe, expect, it } from "vitest";
import type { Combatant, ItemInstance } from "@stella/core";
import { ArenaSimulation } from "../src/scenes/arena-simulation.ts";

/**
 * 能力値が変わっても、プレイヤーの戦う者を作り直さない（PR #17 のレビュー指摘1。2026-11-13）。
 * 着替え・星辰盤・職紋盤・ロードアウトの切り替えで、状態異常・崩し・一定時間の効果・魔障が残り、
 * HP・魔障は割合を保つ（最大値が増えても回復しない）。
 */

function item(uid: string, base: string): ItemInstance {
  return { uid, base, rarity: "normal", itemLevel: 1, affixes: [] };
}

/** 訓練用の人形の近く（安全地帯）へ動かす。 */
function toSafeZone(sim: ArenaSimulation): void {
  const p = sim.motion.position;
  sim.motion.displace({ x: 17 - p.x, y: 12 - p.y });
  expect(sim.inSafeZone).toBe(true);
}

const INTIMIDATE = "EFF-WARRIOR-INTIMIDATE";

/** 魔障のある防具（法衣の胴）を着た、戦士 Lv15 の試験用の場。 */
function withWard(): ArenaSimulation {
  const sim = new ArenaSimulation(undefined, { enemies: false });
  expect(sim.inventory.addItem(item("t-linen-body", "BASE-ARM-LINEN-BODY-T1"))).toBe(true);
  expect(sim.equipFromInventory("t-linen-body")).toBe(true);
  expect(sim.player.health.maxWard).toBeGreaterThan(0);
  // 着たときの魔障は0から（割合を保つ）。回復して満タンにする
  sim.player.update(6);
  expect(sim.player.health.ward).toBe(sim.player.health.maxWard);
  return sim;
}

/** 毒・出血・崩し・一定時間の効果をかけ、HPと魔障を減らす。 */
function wound(sim: ArenaSimulation): void {
  const p = sim.player;
  for (const id of ["AIL-POISON", "AIL-BLEED"]) {
    const def = sim.db.ailments.get(id);
    if (def?.kind !== "dot") throw new Error(`${id} が無い`);
    const maxStacks = def.stacking.mode === "stack" ? def.stacking.maxStacks : 1;
    p.ailments.apply({ ailmentId: def.id, tag: def.tag, total: 40, duration: 8, maxStacks });
  }
  p.stagger.add(p.stagger.max * 0.4);
  p.statuses.add(INTIMIDATE, 6, "test");
  // 魔障だけを半分にし（被弾にもなる）、HPは支払いで減らす（魔障を使わない）
  p.health.takeDamage(p.health.ward / 2);
  expect(p.health.payHp(p.health.maxHp * 0.3)).toBe(true);
}

/** 残るべき状態（割合と時間）。 */
function lasting(p: Combatant) {
  return {
    poison: p.ailments.stacks("AIL-POISON"),
    bleed: p.ailments.stacks("AIL-BLEED"),
    dots: p.ailments.planTick(0).updates.map(({ inst }) => ({
      id: inst.def.id,
      remaining: inst.remaining,
      remainingTime: inst.remainingTime,
    })),
    staggerRatio: p.stagger.current / p.stagger.max,
    breaks: p.stagger.breaks,
    intimidate: p.statuses.remaining(INTIMIDATE),
    hpRatio: p.health.hp / p.health.maxHp,
    wardRatio: p.health.ward / p.health.maxWard,
    sinceHit: p.health.planUpdate(0).sinceHit,
  };
}

/** 操作の前後で、最大HP・最大魔障が変わり、戦う者と状態がそのまま残ること。 */
function expectKept(sim: ArenaSimulation, change: () => void): void {
  wound(sim);
  const player = sim.player;
  const before = lasting(player);
  expect(before.poison).toBe(1);
  expect(before.bleed).toBe(1);
  expect(before.staggerRatio).toBeGreaterThan(0);
  expect(before.wardRatio).toBeCloseTo(0.5, 9);
  expect(before.hpRatio).toBeCloseTo(0.7, 9);
  const maxima = [player.health.maxHp, player.health.maxWard];
  change();
  // 能力値が変わった（作り直しの判定に当たる操作であること）
  expect([sim.player.health.maxHp, sim.player.health.maxWard]).not.toEqual(maxima);
  expect(sim.player).toBe(player);
  const after = lasting(sim.player);
  expect(after.poison).toBe(before.poison);
  expect(after.bleed).toBe(before.bleed);
  expect(after.dots).toEqual(before.dots);
  expect(after.staggerRatio).toBeCloseTo(before.staggerRatio, 12);
  expect(after.breaks).toBe(before.breaks);
  expect(after.intimidate).toBe(before.intimidate);
  expect(after.sinceHit).toBe(before.sinceHit);
  // HP・魔障は割合を保つ（最大値が増えても、満タンには戻らない）
  expect(after.hpRatio).toBeCloseTo(before.hpRatio, 12);
  expect(after.wardRatio).toBeCloseTo(before.wardRatio, 12);
}

describe("能力値が変わっても、プレイヤーの戦う者を作り直さない（PR #17 レビュー指摘1）", () => {
  it("着替え（法衣の頭で最大魔障が増える）", () => {
    const sim = withWard();
    sim.inventory.addItem(item("t-linen-head", "BASE-ARM-LINEN-HEAD-T1"));
    expectKept(sim, () => {
      expect(sim.equipFromInventory("t-linen-head")).toBe(true);
    });
    expect(sim.player.health.ward).toBeLessThan(sim.player.health.maxWard);
  });

  it("星を1つ振る（最大HP+20）。最大HPが増えても回復しない", () => {
    const sim = withWard();
    expectKept(sim, () => {
      expect(sim.allocateStar("STAR-GOU-0001")).toBe(true);
    });
    expect(sim.player.health.hp).toBeLessThan(sim.player.health.maxHp);
  });

  it("職紋盤を振る（最大HPのノード）", () => {
    const sim = withWard();
    for (const id of ["JBN-WARRIOR-T1", "JBN-WARRIOR-T2"])
      expect(sim.allocateJobNode(id), id).toBe(true);
    expectKept(sim, () => {
      expect(sim.allocateJobNode("JBN-WARRIOR-T3")).toBe(true);
    });
  });

  it("ロードアウトの切り替え（星辰盤の違うロードアウトへ）", () => {
    const sim = withWard();
    toSafeZone(sim);
    expect(sim.switchLoadout(2)).toBe("ok");
    expect(sim.switchLoadout(1)).toBe("ok");
    expect(sim.allocateStar("STAR-GOU-0001")).toBe(true);
    expectKept(sim, () => {
      expect(sim.switchLoadout(2)).toBe("ok");
    });
  });

  it("戦闘中に星を振っても、毒は消えず魔障も戻らない（そのまま持続ダメージを受け続ける）", () => {
    const sim = withWard();
    wound(sim);
    const ward = sim.player.health.ward;
    expect(sim.allocateStar("STAR-GOU-0001")).toBe(true);
    expect(sim.player.health.ward).toBeCloseTo(ward, 9);
    const hp = sim.player.health.hp;
    sim.player.update(1);
    expect(sim.player.health.hp + sim.player.health.ward).toBeLessThan(hp + ward);
  });
});
