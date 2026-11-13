import { describe, expect, it } from "vitest";
import type { ItemInstance, LoadoutRecord, MvpEquipSlot } from "@stella/core";
import { ArenaSimulation } from "../src/scenes/arena-simulation.ts";

/**
 * ロードアウトの切り替えは、全て計画して確かめてから反映する（PR #17 のレビュー指摘2。2026-11-13）。
 * インベントリがいっぱいでも、両手武器と副手・部位に合わない装備・必要Lvに届かない装備で、装備が消えない。
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

/** 外から見える持ち物・装備・倉庫・ロードアウトの全て。 */
function belongings(sim: ArenaSimulation) {
  return {
    equipment: sim.equipment.entries().map(([s, i]) => [s, i.uid]),
    inventory: sim.inventory.items.map((i) => i.uid),
    stash: sim.stash.items.map((i) => i.uid),
    loadouts: sim.loadouts,
    active: sim.activeLoadout,
    job: sim.job.id,
    stars: [...sim.stars.nodes],
  };
}

/** 全ての装備の uid（どこにあるかは問わない）。 */
function allUids(sim: ArenaSimulation): string[] {
  return [
    ...sim.equipment.entries().map(([, i]) => i.uid),
    ...sim.inventory.items.map((i) => i.uid),
    ...sim.stash.items.map((i) => i.uid),
  ].sort();
}

/**
 * ロードアウト2：主手に両手の大剣（今の装備）、副手に盾（インベントリ。大剣を外す）、
 * 指輪に爪（倉庫。部位に合わない）、頭に必要Lv20のユニーク（倉庫。キャラLv15では届かない）。
 * 今のロードアウト1は、大剣と法衣の胴。
 */
function tricky(free: number): ArenaSimulation {
  const sim = withWard();
  toSafeZone(sim);
  expect(sim.switchLoadout(2)).toBe("ok");
  expect(sim.switchLoadout(1)).toBe("ok");
  expect(sim.character.level).toBe(15);
  sim.inventory.addItem(item("t-buckler", "BASE-SHD-BUCKLER-T1"));
  sim.stash.addItem(item("t-stash-claw", "BASE-WPN-CLAW-T1"));
  sim.stash.addItem(item("t-u06", "BASE-UNQ-U06"));
  const target: Partial<Record<MvpEquipSlot, string>> = {
    mainHand: "test-greatsword",
    offHand: "t-buckler",
    ring1: "t-stash-claw",
    head: "t-u06",
  };
  const list = (sim as unknown as { loadoutList: LoadoutRecord[] }).loadoutList;
  (sim as unknown as { loadoutList: LoadoutRecord[] }).loadoutList = list.map((l) =>
    l.id === 2 ? { ...l, equipment: target } : l,
  );
  for (let i = 0; sim.inventory.items.length < sim.inventory.capacity - free; i++)
    expect(sim.inventory.addItem(item(`t-filler-${String(i)}`, "BASE-WPN-AXE-T1"))).toBe(true);
  return sim;
}

describe("ロードアウトの切り替えは、全て計画して確かめてから反映する（PR #17 レビュー指摘2）", () => {
  it("インベントリがいっぱいなら、何も変えずに inventoryFull（装備も持ち物も1つも消えない）", () => {
    const sim = tricky(0);
    const before = belongings(sim);
    const uids = allUids(sim);
    expect(sim.switchLoadout(2)).toBe("inventoryFull");
    expect(belongings(sim)).toEqual(before);
    expect(allUids(sim)).toEqual(uids);
  });

  it("あと1枠足りない（空きは2枠。差し引き3枠が要る）ときも、何も変えない", () => {
    // 戻す物：外された大剣・部位に合わない爪・必要Lvに届かないユニーク・使わない法衣の胴（4つ）。
    // インベントリから出す物：盾（1つ）。差し引き3枠が要る
    const sim = tricky(2);
    const before = belongings(sim);
    expect(sim.switchLoadout(2)).toBe("inventoryFull");
    expect(belongings(sim)).toEqual(before);
  });

  it("入りきるなら切り替え、合わない・届かない・外された装備はインベントリに戻る（1つも消えない）", () => {
    const sim = tricky(3);
    const uids = allUids(sim);
    expect(sim.switchLoadout(2)).toBe("ok");
    expect(allUids(sim)).toEqual(uids);
    expect(sim.inventory.items.length).toBe(sim.inventory.capacity);
    // 盾が大剣を外し、爪とユニークは着ない
    expect(sim.equipment.entries().map(([s, i]) => [s, i.uid])).toEqual([["offHand", "t-buckler"]]);
    for (const uid of ["test-greatsword", "t-stash-claw", "t-u06", "t-linen-body"])
      expect(
        sim.inventory.items.some((i) => i.uid === uid),
        uid,
      ).toBe(true);
    expect(sim.stash.items.map((i) => i.uid)).toEqual([]);
  });
});
