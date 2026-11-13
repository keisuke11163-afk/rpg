/**
 * 系統素材による偏ったクラフト（仕様書v0.2 3.11.3。docs/progress A-6）：転詞の石と一緒に使うと、
 * その系統の詞が出やすくなる（出現率×3）。獣牙は獣の系統詞を、母樹の樹液は状態異常の詞を出やすくする。
 */
import {
  CRAFT_MATERIALS,
  type ContentDb,
  Inventory,
  type ItemInstance,
  Rng,
  craft,
  craftWithInventory,
  generateItem,
} from "@stella/core";
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../src/index.ts";

const db: ContentDb = loadGameContent();
const FANG = "MAT-BEAST-FANG";
const SAP = CRAFT_MATERIALS.bossCore;

const rareOf = (baseId: string, seed: string): ItemInstance => {
  const base = db.itemBases.get(baseId);
  if (base === undefined) throw new Error(baseId);
  return generateItem(db, Rng.fromSeed(seed), { uid: "x", base, rarity: "rare", itemLevel: 20 });
};

/** 転詞を n 回して、その詞が付いた回数。 */
function count(baseId: string, affix: string, bias: string | undefined, n = 400): number {
  let hits = 0;
  for (let i = 0; i < n; i++) {
    const r = craft(db, Rng.fromSeed(`t${String(i)}`), rareOf(baseId, `g${String(i)}`), {
      kind: "transmute",
      ...(bias === undefined ? {} : { bias }),
    });
    if (r.item.affixes.some((a) => a.id === affix)) hits += 1;
  }
  return hits;
}

describe("系統素材による偏ったクラフト", () => {
  it("獣牙：獣の系統詞（ふだんはクラフトで付かない）が付くようになる", () => {
    expect(count("BASE-ACC-SILVER-RING-T1", "AFX-SUF-BEAST-HUNTER", undefined)).toBe(0);
    expect(count("BASE-ACC-SILVER-RING-T1", "AFX-SUF-BEAST-HUNTER", FANG)).toBeGreaterThan(40);
  });

  it("母樹の樹液：状態異常の詞の出現が増える（重み×3）", () => {
    const plain = count("BASE-WPN-LONGSWORD-T1", "AFX-SUF-AILMENT-CHANCE", undefined);
    const biased = count("BASE-WPN-LONGSWORD-T1", "AFX-SUF-AILMENT-CHANCE", SAP);
    expect(biased).toBeGreaterThan(plain * 1.5);
  });

  it("系統素材も1つ使う。無い・偏りの無い素材なら、何も変えずに material", () => {
    const inv = new Inventory();
    inv.addItem(rareOf("BASE-WPN-LONGSWORD-T1", "a"));
    inv.addMaterial(CRAFT_MATERIALS.transmuteStone, 2);
    const before = inv.items[0];
    expect(
      craftWithInventory(db, Rng.fromSeed("a"), inv, "x", { kind: "transmute", bias: FANG }),
    ).toBe("material");
    expect(
      craftWithInventory(db, Rng.fromSeed("a"), inv, "x", {
        kind: "transmute",
        bias: CRAFT_MATERIALS.magicDust,
      }),
    ).toBe("material");
    expect(inv.items[0]).toBe(before);
    expect(inv.material(CRAFT_MATERIALS.transmuteStone)).toBe(2);
    inv.addMaterial(FANG, 1);
    const r = craftWithInventory(db, Rng.fromSeed("a"), inv, "x", {
      kind: "transmute",
      bias: FANG,
    });
    expect(typeof r).not.toBe("string");
    expect(inv.material(FANG)).toBe(0);
    expect(inv.material(CRAFT_MATERIALS.transmuteStone)).toBe(1);
  });
});
