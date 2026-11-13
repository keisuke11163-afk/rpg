import { describe, expect, it } from "vitest";
import {
  AWAKENING_DUST,
  CRAFT_MATERIALS,
  Inventory,
  buyAwakeningDust,
  disassembleFromInventory,
} from "../src/index.ts";

/**
 * 途中で失敗すると半端な状態になる処理を、先に確かめる形にする（PR #17 のレビュー指摘3。2026-11-13）。
 */

const SAFE = Number.MAX_SAFE_INTEGER;

describe("分解・目覚めの粉の購入：あふれで失敗したら何も変わらない（PR #17 レビュー指摘3）", () => {
  it("分解の素材が持ちきれないなら、装備も素材も変えずに RangeError", () => {
    const inv = new Inventory();
    inv.addItem({ uid: "a", base: "B", rarity: "normal", itemLevel: 8, affixes: [] });
    inv.addMaterial(CRAFT_MATERIALS.magicDust, SAFE - 1);
    expect(() => disassembleFromInventory(inv, "a")).toThrow(RangeError);
    expect(inv.items.map((i) => i.uid)).toEqual(["a"]);
    expect(inv.material(CRAFT_MATERIALS.magicDust)).toBe(SAFE - 1);
  });

  it("目覚めの粉が持ちきれないなら、金貨を払わずに RangeError", () => {
    const inv = new Inventory();
    inv.addGold(100);
    inv.addMaterial(AWAKENING_DUST, SAFE);
    expect(() => buyAwakeningDust(inv)).toThrow(RangeError);
    expect(inv.gold).toBe(100);
    expect(inv.material(AWAKENING_DUST)).toBe(SAFE);
    // 値段が溢れる数も、金貨を払わない
    expect(() => buyAwakeningDust(inv, Math.floor(SAFE / 10))).toThrow(RangeError);
    expect(inv.gold).toBe(100);
  });
});
