/**
 * U-12 の画面のルール（Phaser に依存しない部分）：ツールチップ（要求値・タグの一致）、装備の比較、倉庫、商人。
 */
import {
  AWAKENING_DUST,
  AWAKENING_DUST_PRICE,
  Character,
  type ContentDb,
  Equipment,
  INVENTORY_SLOTS,
  Inventory,
  type ItemInstance,
  MERCHANT_STOCK_SIZE,
  Rng,
  STASH_SLOTS,
  TagIndex,
  UNMET_REQUIREMENT_MULTIPLIER,
  basePrice,
  buildCharacterSheet,
  buyAwakeningDust,
  buyItem,
  compareEquip,
  createStash,
  damagePreview,
  itemTooltip,
  rollMerchantStock,
  sellItem,
  sellPrice,
  skillContexts,
  transferItem,
} from "@stella/core";
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../src/index.ts";

const db: ContentDb = loadGameContent();
const tags = new TagIndex(db.tags);
const WARRIOR = db.jobs.get("JOB-WARRIOR");
if (WARRIOR === undefined) throw new Error("戦士が無い");
const BASIC = { tags: ["TAG-FORM-MELEE"], kind: "weapon", pct: 1 } as const;

const item = (
  uid: string,
  baseId: string,
  affixes: ItemInstance["affixes"] = [],
  extra: Partial<ItemInstance> = {},
): ItemInstance => ({
  uid,
  base: baseId,
  rarity: affixes.length > 0 ? "magic" : "normal",
  itemLevel: 1,
  affixes,
  ...extra,
});

describe("ツールチップ（補助仕様書16章）", () => {
  const context = (go: number) => ({
    attributes: { go, jin: 10, ri: 5, kon: 5 },
    characterLevel: 1,
    contexts: skillContexts(db, tags, [BASIC.tags], ["TAG-WPN-SWORD"]),
  });

  it("要求値の未達を示し、基礎ダメージは-40%の値を出す", () => {
    const sword = item("s", "BASE-WPN-LONGSWORD-T1");
    const ok = itemTooltip(db, sword, context(20));
    const ng = itemTooltip(db, sword, context(5));
    expect(ok.requirement).toEqual({ attribute: "go", value: 12, met: true });
    expect(ng.requirement?.met).toBe(false);
    expect(ok.weapon?.physical).toEqual({ min: 6, max: 11 });
    expect(ng.weapon?.physical.min).toBeCloseTo(6 * UNMET_REQUIREMENT_MULTIPLIER, 12);
    expect(ng.weapon?.attackSpeed).toBe(ok.weapon?.attackSpeed);
    expect(ok.levelMet).toBe(true);
  });

  it("タグが一致する詞は光る（物理ダメージ増加は物理の技に効く）。タグの条件の無い詞は光らせない", () => {
    const sword = item("s", "BASE-WPN-LONGSWORD-T1", [
      { id: "AFX-PRE-INC-PHYSICAL-WPN", tier: 7, rolls: [12] },
      { id: "AFX-SUF-ATTACK-SPEED", tier: 7, rolls: [3] },
    ]);
    const t = itemTooltip(db, sword, context(20));
    const inc = t.effects.find((e) => e.affix?.id === "AFX-PRE-INC-PHYSICAL-WPN");
    const speed = t.effects.find((e) => e.affix?.id === "AFX-SUF-ATTACK-SPEED");
    expect(inc?.matchesSkills).toBe(true);
    expect(inc?.local).toBe(true);
    expect(inc?.rolled?.rolls).toEqual([12]);
    expect(speed?.matchesSkills).toBe(false);
    // 基本刻印（命中+40）も行に出る
    expect(t.effects[0]?.kind).toBe("implicit");
    expect(t.effects[0]?.effectId).toBe("EFF-IMP-ACCURACY-40");
  });

  it("出血の付与率（片手斧の基本刻印）は、技のヒットで付く出血の文脈に一致して光る", () => {
    const axe = itemTooltip(db, item("a", "BASE-WPN-AXE-T1"), context(20));
    const line = axe.effects.find((e) => e.effectId === "EFF-IMP-BLEED-CHANCE-10");
    expect(line?.matchesSkills).toBe(true);
    // 技の文脈を渡さなければ、どの行も光らない
    const plain = itemTooltip(db, item("a", "BASE-WPN-AXE-T1"), {
      attributes: { go: 20, jin: 10, ri: 5, kon: 5 },
      characterLevel: 1,
    });
    expect(plain.effects.every((e) => !e.matchesSkills)).toBe(true);
  });

  it("ベースが無いアイテムは RangeError", () => {
    expect(() => itemTooltip(db, item("x", "BASE-NONE"), context(20))).toThrow(RangeError);
  });
});

describe("装備の比較（補助仕様書16章）", () => {
  it("装備したときの変化を、今の装備を変えずに計算し、実際に装備したときの値と一致する", () => {
    const character = new Character({ origin: WARRIOR, level: 5 });
    const equipment = new Equipment(db);
    equipment.equip(item("gs", "BASE-WPN-GREATSWORD-T1"), "mainHand", true);
    const sword = item("sw", "BASE-WPN-LONGSWORD-T1", [
      { id: "AFX-SUF-ATTACK-SPEED", tier: 7, rolls: [4] },
    ]);
    const input = { character, job: WARRIOR, equipment };
    const cmp = compareEquip(db, tags, input, sword, "mainHand", {
      canDualWield: true,
      skill: BASIC,
    });
    // 今の装備は変わらない
    expect(equipment.get("mainHand")?.uid).toBe("gs");
    expect(cmp.displaced.map((i) => i.uid)).toEqual(["gs"]);
    // 命中+40（長剣の基本刻印）が変化に出る。崩し+15%（大剣の基本刻印）が無くなる
    const acc = cmp.changes.find((c) => c.stat === "STAT-ACCURACY");
    expect((acc?.after.value ?? 0) - (acc?.before.value ?? 0)).toBe(40);
    const stagger = cmp.changes.find((c) => c.stat === "STAT-STAGGER");
    // 大剣の基本刻印の崩し+15%が無くなる（能力値の分は残る）
    expect((stagger?.before.increased ?? 0) - (stagger?.after.increased ?? 0)).toBeCloseTo(
      0.15,
      12,
    );
    // 実際に装備した後の、戦闘の値と一致する
    equipment.equip(sword, "mainHand", true);
    const real = buildCharacterSheet(db, tags, input);
    expect(cmp.attackSpeed.after).toBeCloseTo(real.attackSpeed, 12);
    expect(cmp.damage?.after.average).toBeCloseTo(
      damagePreview(real, BASIC, Rng.fromSeed("x")).average,
      9,
    );
    expect(cmp.damage?.after.average).toBeLessThan(cmp.damage?.before.average ?? 0);
  });

  it("変わらない能力値は、変化に出さない", () => {
    const character = new Character({ origin: WARRIOR, level: 5 });
    const equipment = new Equipment(db);
    equipment.equip(item("a", "BASE-WPN-LONGSWORD-T1"), "mainHand", true);
    const cmp = compareEquip(
      db,
      tags,
      { character, job: WARRIOR, equipment },
      item("b", "BASE-WPN-LONGSWORD-T1"),
      "mainHand",
      { canDualWield: true },
    );
    expect(cmp.changes).toEqual([]);
    expect(cmp.damage).toBeUndefined();
  });
});

describe("倉庫（補助仕様書13章）", () => {
  it("120枠。インベントリとの間で移し、いっぱいなら何も変えない", () => {
    const stash = createStash();
    const inv = new Inventory();
    expect(stash.capacity).toBe(STASH_SLOTS);
    expect(inv.capacity).toBe(INVENTORY_SLOTS);
    inv.addItem(item("a", "BASE-WPN-AXE-T1"));
    expect(transferItem(inv, stash, "a")).toBe(true);
    expect(inv.items).toHaveLength(0);
    expect(stash.items.map((i) => i.uid)).toEqual(["a"]);
    const tiny = new Inventory(0);
    expect(transferItem(stash, tiny, "a")).toBe(false);
    expect(stash.items).toHaveLength(1);
    expect(() => transferItem(inv, stash, "a")).toThrow(RangeError);
  });
});

describe("商人（補助仕様書5章）", () => {
  it("売値：（1＋⌊iLv÷2⌋）× レアリティの倍率", () => {
    expect(sellPrice(item("a", "BASE-WPN-AXE-T1", [], { itemLevel: 1 }))).toBe(1);
    expect(sellPrice(item("a", "BASE-WPN-AXE-T1", [], { itemLevel: 7, rarity: "magic" }))).toBe(12);
    expect(sellPrice(item("a", "BASE-WPN-AXE-T1", [], { itemLevel: 10, rarity: "rare" }))).toBe(48);
    expect(sellPrice(item("a", "BASE-WPN-AXE-T1", [], { itemLevel: 4, rarity: "unique" }))).toBe(
      45,
    );
  });

  it("売ると金貨が増え、インベントリから出る", () => {
    const inv = new Inventory();
    inv.addItem(item("a", "BASE-WPN-AXE-T1", [], { itemLevel: 6, rarity: "magic" }));
    expect(sellItem(inv, "a")).toBe(12);
    expect(inv.gold).toBe(12);
    expect(inv.items).toHaveLength(0);
    expect(() => sellItem(inv, "a")).toThrow(RangeError);
  });

  it("品揃え：通常のベースを決まった数だけ。同じシードで同じ品揃え。価格は 10＋4×iLv", () => {
    let n = 0;
    const roll = () =>
      rollMerchantStock(db, Rng.fromSeed("shop"), {
        itemLevel: 5,
        nextUid: () => `shop-${String(++n)}`,
      });
    const a = roll();
    const b = roll();
    expect(a).toHaveLength(MERCHANT_STOCK_SIZE);
    expect(a.every((i) => i.rarity === "normal" && i.affixes.length === 0)).toBe(true);
    expect(a.every((i) => i.itemLevel === 5)).toBe(true);
    expect(a.map((i) => i.base)).toEqual(b.map((i) => i.base));
    expect(basePrice(5)).toBe(30);
    expect(() =>
      rollMerchantStock(db, Rng.fromSeed("x"), { itemLevel: 0, nextUid: () => "x" }),
    ).toThrow(RangeError);
  });

  it("買う：金貨が足りなければ何も変えない。足りれば金貨を使い、品揃えから出る", () => {
    const stock = [item("s1", "BASE-WPN-AXE-T1", [], { itemLevel: 5 })];
    const inv = new Inventory();
    inv.addGold(29);
    expect(buyItem(inv, stock, "s1")).toBe(false);
    expect(inv.gold).toBe(29);
    expect(stock).toHaveLength(1);
    inv.addGold(1);
    expect(buyItem(inv, stock, "s1")).toBe(true);
    expect(inv.gold).toBe(0);
    expect(stock).toHaveLength(0);
    expect(inv.items.map((i) => i.uid)).toEqual(["s1"]);
  });

  it("インベントリがいっぱいなら買えない", () => {
    const stock = [item("s1", "BASE-WPN-AXE-T1")];
    const inv = new Inventory(0);
    inv.addGold(100);
    expect(buyItem(inv, stock, "s1")).toBe(false);
    expect(inv.gold).toBe(100);
  });

  it("目覚めの粉を買える（30金貨）", () => {
    const inv = new Inventory();
    inv.addGold(AWAKENING_DUST_PRICE * 2 - 1);
    expect(buyAwakeningDust(inv, 2)).toBe(false);
    expect(buyAwakeningDust(inv)).toBe(true);
    expect(inv.material(AWAKENING_DUST)).toBe(1);
    expect(inv.gold).toBe(AWAKENING_DUST_PRICE - 1);
    expect(() => buyAwakeningDust(inv, 0)).toThrow(RangeError);
  });

  it("金貨を使う：足りなければ何も変えない。不正な数は RangeError", () => {
    const inv = new Inventory();
    inv.addGold(5);
    expect(inv.spendGold(6)).toBe(false);
    expect(inv.spendGold(5)).toBe(true);
    expect(inv.gold).toBe(0);
    expect(() => inv.spendGold(-1)).toThrow(RangeError);
    expect(() => inv.spendGold(0.5)).toThrow(RangeError);
  });
});
