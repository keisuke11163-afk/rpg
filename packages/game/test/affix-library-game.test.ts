/** 詞片の書庫（MVPの後の機能。docs/progress A-5）：鍛冶屋の操作とセーブデータ。 */
import { describe, expect, it } from "vitest";
import { CRAFT_MATERIALS, MemoryBackend, SaveStore } from "@stella/core";
import { ArenaSimulation } from "../src/scenes/arena-simulation.ts";

const SPEED = "AFX-SUF-ATTACK-SPEED";

describe("詞片の書庫（ゲーム）", () => {
  it("抽詞の針で取り出し、刻詞の筆で別の装備に付ける。書庫と筆の数はセーブデータに残る", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    sim.inventory.addMaterial(CRAFT_MATERIALS.affixNeedle, 1);
    sim.inventory.addMaterial(CRAFT_MATERIALS.affixBrush, 1);
    const base = { base: "BASE-WPN-LONGSWORD-T1", rarity: "rare" as const, itemLevel: 30 };
    sim.inventory.addItem({
      uid: "itm_src",
      ...base,
      affixes: [{ id: SPEED, tier: 4, rolls: [8] }],
    });
    sim.inventory.addItem({ uid: "itm_dst", ...base, affixes: [] });
    expect(sim.smith("itm_src", { kind: "extract", affix: SPEED })).toEqual({
      ok: true,
      message: "詞片を取り出した（T5）",
    });
    expect(sim.inventory.items.some((i) => i.uid === "itm_src")).toBe(false);
    expect(sim.smith("itm_dst", { kind: "brush", shard: { affix: SPEED, tier: 5 } }).ok).toBe(true);
    const dst = sim.inventory.items.find((i) => i.uid === "itm_dst");
    expect(dst?.affixes.map((a) => a.id)).toEqual([SPEED]);
    expect(dst?.brushed).toBe(1);
    // 同じ詞は付けられない（理由を返して何も変えない）
    expect(sim.smith("itm_dst", { kind: "brush", shard: { affix: SPEED, tier: 5 } })).toEqual({
      ok: false,
      message: "同じ詞がもう付いている",
    });

    sim.inventory.addMaterial(CRAFT_MATERIALS.affixNeedle, 1);
    sim.inventory.addItem({
      uid: "itm_src2",
      ...base,
      affixes: [{ id: SPEED, tier: 4, rolls: [8] }],
    });
    expect(sim.smith("itm_src2", { kind: "extract", affix: SPEED }).ok).toBe(true);
    const data = sim.saveData();
    expect(data.affix_library).toEqual({ [`${SPEED}@T5`]: 1 });
    expect(data.items["itm_dst"]?.brushed).toBe(1);
    const store = new SaveStore(sim.db, new MemoryBackend());
    store.save(1, data);
    const r = store.load(1);
    if (!r.ok) throw new Error(r.error?.message ?? "空");
    const back = new ArenaSimulation(undefined, { enemies: false, db: sim.db, profile: r.profile });
    expect(back.affixLibrary.toRecord()).toEqual({ [`${SPEED}@T5`]: 1 });
    expect(back.saveData()).toEqual(data);
  });

  it("取り出して壊した装備を登録していたロードアウトは、その部位が空きになる", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    const p = sim.motion.position;
    sim.motion.displace({ x: 17 - p.x, y: 12 - p.y });
    sim.inventory.addMaterial(CRAFT_MATERIALS.affixNeedle, 1);
    sim.inventory.addItem({
      uid: "itm_src",
      base: "BASE-WPN-LONGSWORD-T1",
      rarity: "rare",
      itemLevel: 30,
      affixes: [{ id: SPEED, tier: 4, rolls: [8] }],
    });
    expect(sim.switchLoadout(2)).toBe("ok");
    expect(sim.equipFromInventory("itm_src")).toBe(true);
    expect(sim.switchLoadout(1)).toBe("ok");
    expect(sim.smith("itm_src", { kind: "extract", affix: SPEED }).ok).toBe(true);
    expect(sim.loadouts.find((l) => l.id === 2)?.equipment.mainHand).toBeUndefined();
  });
});
