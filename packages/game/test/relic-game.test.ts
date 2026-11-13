/**
 * 遺物の調律（仕様書v0.2 3.11.6。MVPの後の機能。docs/progress A-4）：ゲームの操作とセーブデータ。
 */
import { describe, expect, it } from "vitest";
import { MemoryBackend, SaveStore } from "@stella/core";
import { ArenaSimulation } from "../src/scenes/arena-simulation.ts";

const V = (n: number): string => `STAR-VIPER-0${String(n)}`;

function withFlute(): ArenaSimulation {
  const sim = new ArenaSimulation(undefined, { enemies: false });
  sim.gainXp(1e7);
  expect(
    sim.inventory.addItem({
      uid: "itm_flute",
      base: "BASE-RELIC-SNAKE-FLUTE",
      rarity: "normal",
      itemLevel: 20,
      affixes: [],
    }),
  ).toBe(true);
  return sim;
}

describe("遺物の調律（ゲーム）", () => {
  it("写す小星を選び、遺物の部位に装備すると、星辰盤に写しが効く", () => {
    const sim = withFlute();
    expect(sim.setRelicNodes("itm_flute", [1, 2, 3, 4].map(V))).toMatch(/3つまで/);
    expect(sim.setRelicNodes("itm_flute", ["STAR-JIN-0001"])).toBeDefined();
    expect(sim.setRelicNodes("test-dagger", [])).toBe("遺物ではない");
    expect(sim.setRelicNodes("itm_flute", [1, 2, 3].map(V))).toBeUndefined();
    expect(sim.equipFromInventory("itm_flute")).toBe(true);
    expect(sim.equipment.get("relic")?.uid).toBe("itm_flute");
    expect(sim.sheet.board?.relicNodes).toEqual([1, 2, 3].map(V));
    // 装備したまま選び直すと、すぐに反映する
    expect(sim.setRelicNodes("itm_flute", [7, 8, 9].map(V))).toBeUndefined();
    expect(sim.sheet.board?.relicNodes).toEqual([7, 8, 9].map(V));
  });

  it("選んだ小星はセーブデータに残る。正しくない写しは参照の問題", () => {
    const sim = withFlute();
    expect(sim.setRelicNodes("itm_flute", [7, 8, 9].map(V))).toBeUndefined();
    expect(sim.equipFromInventory("itm_flute")).toBe(true);
    const data = sim.saveData();
    expect(data.items["itm_flute"]?.relic_nodes).toEqual([7, 8, 9].map(V));
    const store = new SaveStore(sim.db, new MemoryBackend());
    store.save(1, data);
    const r = store.load(1);
    if (!r.ok) throw new Error(r.error?.message ?? "空");
    const back = new ArenaSimulation(undefined, { enemies: false, db: sim.db, profile: r.profile });
    expect(back.sheet.board?.relicNodes).toEqual([7, 8, 9].map(V));
    const flute = data.items["itm_flute"];
    if (flute === undefined) throw new Error("骨笛が無い");
    const bad = {
      ...data,
      items: { ...data.items, itm_flute: { ...flute, relic_nodes: [1, 2, 3, 4].map(V) } },
    };
    const store2 = new SaveStore(sim.db, new MemoryBackend());
    expect(() => {
      store2.save(1, bad);
    }).toThrow();
  });
});
