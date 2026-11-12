/**
 * LootField.autoPickup（U-11）：拾う物を全て決めてから、持ち物にまとめて足す（PR #14 のレビュー指摘）。
 * 途中で合計があふれるなら、持ち物も地面も何も変えずに RangeError。
 */
import { describe, expect, it } from "vitest";
import { type DropResult, Inventory, type ItemInstance, Rng } from "@stella/core";
import { LootField } from "../src/world/LootField.ts";

const HERE = { x: 10, y: 10 };
const FAR = { x: 30, y: 10 };

const item = (uid: string): ItemInstance => ({
  uid,
  base: "BASE-WPN-LONGSWORD-T1",
  rarity: "normal",
  itemLevel: 1,
  affixes: [],
});

function drop(parts: Partial<DropResult>): DropResult {
  return { itemLevel: 1, items: [], jobTargeted: [], gold: 0, materials: [], ...parts };
}

function snapshot(inv: Inventory) {
  return { gold: inv.gold, materials: [...inv.materials], items: inv.items.length };
}

describe("LootField.autoPickup", () => {
  it("成功したときは、範囲内の金貨・素材を全て拾い、範囲外の物と装備は残る", () => {
    const field = new LootField(Rng.fromSeed("loot-ok"));
    field.place(
      drop({
        items: [item("near-item")],
        gold: 12,
        materials: [
          { material: "MAT-A", count: 2 },
          { material: "MAT-B", count: 1 },
        ],
      }),
      HERE,
    );
    field.place(drop({ gold: 30, materials: [{ material: "MAT-A", count: 1 }] }), HERE);
    field.place(drop({ gold: 99, materials: [{ material: "MAT-C", count: 4 }] }), FAR);
    const inv = new Inventory();
    inv.addGold(1);

    const picked = field.autoPickup(HERE, inv);

    expect(picked).toHaveLength(5);
    expect(inv.gold).toBe(1 + 12 + 30);
    expect(inv.material("MAT-A")).toBe(3);
    expect(inv.material("MAT-B")).toBe(1);
    expect(inv.material("MAT-C")).toBe(0);
    expect(inv.items).toHaveLength(0);
    const left = field.drops.map((d) =>
      d.kind === "item" ? d.item.uid : d.kind === "gold" ? `gold:${String(d.amount)}` : d.material,
    );
    expect(left.sort()).toEqual(["MAT-C", "gold:99", "near-item"].sort());
  });

  it("金貨の合計が途中であふれると、持ち物も地面も変わらない（RangeError）", () => {
    const field = new LootField(Rng.fromSeed("loot-gold"));
    // 1つ目の金貨と素材は足せるが、2つ目の金貨で合計があふれる
    field.place(drop({ gold: 5, materials: [{ material: "MAT-A", count: 1 }] }), HERE);
    field.place(drop({ gold: 6 }), HERE);
    const inv = new Inventory();
    inv.addGold(Number.MAX_SAFE_INTEGER - 10);
    const before = snapshot(inv);
    const ground = [...field.drops];

    expect(() => field.autoPickup(HERE, inv)).toThrow(RangeError);
    expect(snapshot(inv)).toEqual(before);
    expect(field.drops).toEqual(ground);
    // 次のフレームでも同じく失敗し、二重に拾われない
    expect(() => field.autoPickup(HERE, inv)).toThrow(RangeError);
    expect(snapshot(inv)).toEqual(before);
  });

  it("素材の合計が途中であふれると、持ち物も地面も変わらない（RangeError）", () => {
    const field = new LootField(Rng.fromSeed("loot-mat"));
    // 金貨と1つ目の素材は足せるが、2つ目の同じ素材で合計があふれる
    field.place(drop({ gold: 7, materials: [{ material: "MAT-A", count: 5 }] }), HERE);
    field.place(drop({ materials: [{ material: "MAT-A", count: 6 }] }), HERE);
    const inv = new Inventory();
    inv.addMaterial("MAT-A", Number.MAX_SAFE_INTEGER - 10);
    const before = snapshot(inv);
    const ground = [...field.drops];

    expect(() => field.autoPickup(HERE, inv)).toThrow(RangeError);
    expect(snapshot(inv)).toEqual(before);
    expect(inv.gold).toBe(0);
    expect(field.drops).toEqual(ground);
  });
});
