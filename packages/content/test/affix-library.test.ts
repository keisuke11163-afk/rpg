/**
 * 詞片の書庫（仕様書v0.2 3.10・3.11.2。MVPの後の機能。docs/progress A-5）：
 * 抽詞の針（装備を壊して詞片・tierは1段階下がる）、書庫（同じ詞片は20個まで）、刻詞の筆（空いた枠・2つまで・負荷+25）。
 */
import {
  AffixLibrary,
  BRUSH_LOAD,
  CRAFT_MATERIALS,
  type ContentDb,
  Inventory,
  type ItemInstance,
  LIBRARY_STACK,
  Rng,
  brushBlock,
  brushFromLibrary,
  extractFromInventory,
  extractedShard,
  shardOfKey,
} from "@stella/core";
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../src/index.ts";

const db: ContentDb = loadGameContent();
const SPEED = "AFX-SUF-ATTACK-SPEED";

const sword = (uid: string, extra: Partial<ItemInstance> = {}): ItemInstance => ({
  uid,
  base: "BASE-WPN-LONGSWORD-T1",
  rarity: "rare",
  itemLevel: 30,
  affixes: [{ id: SPEED, tier: 4, rolls: [8] }],
  ...extra,
});

function setup(): { inv: Inventory; lib: AffixLibrary } {
  const inv = new Inventory();
  inv.addMaterial(CRAFT_MATERIALS.affixNeedle, 5);
  inv.addMaterial(CRAFT_MATERIALS.affixBrush, 5);
  return { inv, lib: new AffixLibrary() };
}

describe("抽詞の針", () => {
  it("装備を壊し、選んだ詞を1段階下のtierの詞片として書庫に入れる（針を1つ使う）", () => {
    const { inv, lib } = setup();
    inv.addItem(sword("a"));
    const r = extractFromInventory(db, inv, lib, "a", SPEED);
    expect(r).toEqual({ affix: SPEED, tier: 5 });
    expect(inv.items).toHaveLength(0);
    expect(inv.material(CRAFT_MATERIALS.affixNeedle)).toBe(4);
    expect(lib.count({ affix: SPEED, tier: 5 })).toBe(1);
  });

  it("最も低いtierなら、そのまま。ユニーク・無い詞・針が無い・書庫がいっぱいなら何も変えない", () => {
    expect(
      extractedShard(db, sword("a", { affixes: [{ id: SPEED, tier: 7, rolls: [3] }] }), SPEED),
    ).toEqual({ affix: SPEED, tier: 7 });
    const { inv, lib } = setup();
    inv.addItem(sword("a"));
    inv.addItem({ ...sword("u"), base: "BASE-UNQ-U03", rarity: "unique" });
    expect(extractFromInventory(db, inv, lib, "u", SPEED)).toBe("unique");
    expect(extractFromInventory(db, inv, lib, "a", "AFX-NONE")).toBe("noAffix");
    for (let i = 0; i < LIBRARY_STACK; i++) lib.add({ affix: SPEED, tier: 5 });
    expect(extractFromInventory(db, inv, lib, "a", SPEED)).toBe("full");
    const empty = new Inventory();
    empty.addItem(sword("b"));
    expect(extractFromInventory(db, empty, new AffixLibrary(), "b", SPEED)).toBe("material");
    expect(inv.items).toHaveLength(2);
    expect(inv.material(CRAFT_MATERIALS.affixNeedle)).toBe(5);
  });
});

describe("書庫", () => {
  it("同じ詞片は20個まで。セーブデータの形で戻せる。正しくない鍵・数は RangeError", () => {
    const lib = new AffixLibrary();
    for (let i = 0; i < LIBRARY_STACK; i++) expect(lib.add({ affix: SPEED, tier: 4 })).toBe(true);
    expect(lib.add({ affix: SPEED, tier: 4 })).toBe(false);
    expect(lib.add({ affix: SPEED, tier: 5 })).toBe(true);
    const rec = lib.toRecord();
    expect(rec).toEqual({ [`${SPEED}@T4`]: 20, [`${SPEED}@T5`]: 1 });
    expect(AffixLibrary.fromRecord(db, rec).toRecord()).toEqual(rec);
    expect(shardOfKey(`${SPEED}@T4`)).toEqual({ affix: SPEED, tier: 4 });
    expect(() => AffixLibrary.fromRecord(db, { "AFX-NONE@T4": 1 })).toThrow(RangeError);
    expect(() => AffixLibrary.fromRecord(db, { [`${SPEED}@T4`]: 21 })).toThrow(RangeError);
    expect(() => AffixLibrary.fromRecord(db, { bad: 1 })).toThrow(RangeError);
  });
});

describe("刻詞の筆", () => {
  const shard = { affix: SPEED, tier: 4 } as const;

  it("空いた枠に、詞片のtierで付ける。負荷+25・筆の数+1・詞片と筆を1つずつ使う", () => {
    const { inv, lib } = setup();
    lib.add(shard);
    inv.addItem(sword("a", { affixes: [] }));
    const r = brushFromLibrary(db, Rng.fromSeed("b"), inv, lib, "a", shard);
    if (typeof r === "string") throw new Error(r);
    expect(r.item.affixes.map((a) => [a.id, a.tier])).toEqual([[SPEED, 4]]);
    expect(r.item.forgeLoad).toBe(BRUSH_LOAD);
    expect(r.item.brushed).toBe(1);
    expect(lib.count(shard)).toBe(0);
    expect(inv.material(CRAFT_MATERIALS.affixBrush)).toBe(4);
  });

  it("付けられない：同じ詞・筆で2つ付けた・枠が無い・負荷・部位・ユニーク・書庫に無い・筆が無い", () => {
    expect(brushBlock(db, sword("a"), shard)).toBe("duplicate");
    expect(brushBlock(db, sword("a", { affixes: [], brushed: 2 }), shard)).toBe("brushLimit");
    expect(brushBlock(db, sword("a", { affixes: [], forgeLoad: 80 }), shard)).toBe("settled");
    expect(brushBlock(db, sword("a", { affixes: [], rarity: "normal" }), shard)).toBe("noSlot");
    expect(
      brushBlock(db, { ...sword("a", { affixes: [] }), base: "BASE-ARM-IRON-FEET-T1" }, shard),
    ).toBe("category");
    expect(brushBlock(db, sword("a", { affixes: [], rarity: "unique" }), shard)).toBe("unique");
    const { inv, lib } = setup();
    inv.addItem(sword("a", { affixes: [] }));
    expect(brushFromLibrary(db, Rng.fromSeed("b"), inv, lib, "a", shard)).toBe("noShard");
    const bare = new Inventory();
    bare.addItem(sword("b", { affixes: [] }));
    lib.add(shard);
    expect(brushFromLibrary(db, Rng.fromSeed("b"), bare, lib, "b", shard)).toBe("material");
    expect(lib.count(shard)).toBe(1);
  });
});
