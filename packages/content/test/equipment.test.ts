/**
 * 装備（U-12 のルールの中核）：部位の規則・両手武器・二刀流・要求値の未達（基礎性能-40%）・
 * インベントリとの出し入れ・装備の効果。実際のデータの武器のベースで確かめる。
 */
import {
  type Attributes,
  type ContentDb,
  Equipment,
  INVENTORY_SLOTS,
  Inventory,
  type ItemBaseDef,
  type ItemInstance,
  Rng,
  TagIndex,
  UNMET_REQUIREMENT_MULTIPLIER,
  computeHit,
  equipFromInventory,
  evaluateEffects,
  levelMet,
  requirementMet,
  slotsFor,
  unequipToInventory,
} from "@stella/core";
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../src/index.ts";

const db: ContentDb = loadGameContent();
const tags = new TagIndex(db.tags);
const base = (id: string): ItemBaseDef => {
  const b = db.itemBases.get(id);
  if (b === undefined) throw new Error(`${id} がない`);
  return b;
};
const item = (
  uid: string,
  baseId: string,
  affixes: ItemInstance["affixes"] = [],
): ItemInstance => ({
  uid,
  base: baseId,
  rarity: affixes.length > 0 ? "magic" : "normal",
  itemLevel: 1,
  affixes,
});
const STRONG: Attributes = { go: 30, jin: 30, ri: 5, kon: 5 };
const WEAK: Attributes = { go: 10, jin: 10, ri: 5, kon: 5 };

describe("装備できる部位（仕様書v0.2 3.1・3.2）", () => {
  it("片手武器は、二刀流ができれば副手にも。両手武器は主手だけ", () => {
    expect(slotsFor(base("BASE-WPN-LONGSWORD-T1"), true)).toEqual(["mainHand", "offHand"]);
    expect(slotsFor(base("BASE-WPN-LONGSWORD-T1"), false)).toEqual(["mainHand"]);
    expect(slotsFor(base("BASE-WPN-GREATSWORD-T1"), true)).toEqual(["mainHand"]);
  });

  it("盾は副手、指輪は2つの指輪の部位、防具は同じ名前の部位", () => {
    const fake = (category: ItemBaseDef["category"]): ItemBaseDef => ({
      id: "X",
      text: "x.x",
      category,
      tags: [],
      tier: 1,
      requiredLevel: 1,
    });
    expect(slotsFor(fake("shield"), true)).toEqual(["offHand"]);
    expect(slotsFor(fake("ring"), false)).toEqual(["ring1", "ring2"]);
    expect(slotsFor(fake("head"), false)).toEqual(["head"]);
    expect(slotsFor(fake("belt"), false)).toEqual(["belt"]);
  });
});

describe("部位の規則", () => {
  it("両手武器を主手に持つと、副手（二刀流の片手武器）が外れる", () => {
    const eq = new Equipment(db);
    expect(eq.equip(item("a", "BASE-WPN-LONGSWORD-T1"), "mainHand", true)).toEqual([]);
    expect(eq.equip(item("b", "BASE-WPN-AXE-T1"), "offHand", true)).toEqual([]);
    const out = eq.equip(item("c", "BASE-WPN-GREATSWORD-T1"), "mainHand", true);
    expect(out.map((i) => i.uid).sort()).toEqual(["a", "b"]);
    expect(eq.get("offHand")).toBeUndefined();
    expect(eq.get("mainHand")?.uid).toBe("c");
  });

  it("主手が両手武器のときに副手に装備すると、主手が外れる", () => {
    const eq = new Equipment(db);
    eq.equip(item("c", "BASE-WPN-GREATSWORD-T1"), "mainHand", true);
    const out = eq.equip(item("a", "BASE-WPN-DAGGER-T1"), "offHand", true);
    expect(out.map((i) => i.uid)).toEqual(["c"]);
    expect(eq.get("mainHand")).toBeUndefined();
  });

  it("装備できない部位・同じ物の二重の装備は、状態を変えずに RangeError", () => {
    const eq = new Equipment(db);
    const sword = item("a", "BASE-WPN-LONGSWORD-T1");
    expect(() => eq.equip(sword, "offHand", false)).toThrow(RangeError);
    expect(() => eq.equip(sword, "head", true)).toThrow(RangeError);
    eq.equip(sword, "mainHand", true);
    expect(() => eq.equip(sword, "offHand", true)).toThrow(RangeError);
    expect(eq.entries().map(([s, i]) => [s, i.uid])).toEqual([["mainHand", "a"]]);
  });
});

describe("要求値（仕様書v0.2 2.2：満たさなければ基礎性能-40%）", () => {
  it("大剣（剛18）：満たせば基礎ダメージ 14–24、満たさなければ ×0.6。会心率・攻撃速度は変わらない", () => {
    const eq = new Equipment(db);
    eq.equip(item("g", "BASE-WPN-GREATSWORD-T1"), "mainHand", true);
    expect(requirementMet(base("BASE-WPN-GREATSWORD-T1"), STRONG)).toBe(true);
    expect(requirementMet(base("BASE-WPN-GREATSWORD-T1"), WEAK)).toBe(false);
    const ok = eq.mainWeapon(STRONG);
    const weak = eq.mainWeapon(WEAK);
    expect(ok?.weapon.base.physical).toEqual({ min: 14, max: 24 });
    expect(weak?.weapon.base.physical).toEqual({
      min: 14 * UNMET_REQUIREMENT_MULTIPLIER,
      max: 24 * UNMET_REQUIREMENT_MULTIPLIER,
    });
    expect(weak?.weapon.critChance).toBe(ok?.weapon.critChance);
    expect(weak?.attackSpeed).toBe(1.05);
  });

  it("表示の数値と戦闘の数値が一致する：装備した武器の値が、そのままダメージの計算に使われる", () => {
    const eq = new Equipment(db);
    const sword = item("w", "BASE-WPN-LONGSWORD-T1", [
      { id: "AFX-PRE-ADDED-PHYSICAL-WPN", tier: 7, rolls: [1, 3] },
    ]);
    eq.equip(sword, "mainHand", true);
    for (const attrs of [STRONG, WEAK]) {
      const main = eq.mainWeapon(attrs);
      if (main === undefined) throw new Error("武器が無い");
      const { view } = evaluateEffects(db, tags, eq.effects(), {
        equippedTags: eq.equippedTags(),
      });
      const hit = computeHit(
        { db, view, characterLevel: 1, weapon: main.weapon },
        { tags: ["TAG-FORM-MELEE"], kind: "weapon", pct: 1 },
        { resist: {}, armor: 0, evasion: 0 },
        { rng: Rng.fromSeed("eq"), roll: "average" },
      );
      // 表示の値：武器の基礎（要求値の補正後）の平均＋詞の追加（局所：この武器のヒットだけ）の平均
      const shown =
        (main.weapon.base.physical?.min ?? 0) / 2 +
        (main.weapon.base.physical?.max ?? 0) / 2 +
        (1 + 3) / 2;
      expect(hit.preMitigationTotal).toBeCloseTo(shown * (hit.crit ? hit.critMultiplier : 1), 9);
    }
  });
});

describe("インベントリとの出し入れ", () => {
  it("装備すると、インベントリから出し、外れた物を戻す", () => {
    const inv = new Inventory();
    const eq = new Equipment(db);
    inv.addItem(item("a", "BASE-WPN-LONGSWORD-T1"));
    inv.addItem(item("b", "BASE-WPN-AXE-T1"));
    inv.addItem(item("g", "BASE-WPN-GREATSWORD-T1"));
    expect(equipFromInventory(inv, eq, "a", "mainHand", true, 1)).toBe(true);
    expect(equipFromInventory(inv, eq, "b", "offHand", true, 1)).toBe(true);
    expect(inv.items.map((i) => i.uid)).toEqual(["g"]);
    expect(equipFromInventory(inv, eq, "g", "mainHand", true, 1)).toBe(true);
    expect(inv.items.map((i) => i.uid).sort()).toEqual(["a", "b"]);
    expect(eq.get("mainHand")?.uid).toBe("g");
  });

  it("外れた物がインベントリに入りきらないなら、何も変えずに false", () => {
    const inv = new Inventory();
    const eq = new Equipment(db);
    eq.equip(item("a", "BASE-WPN-LONGSWORD-T1"), "mainHand", true);
    eq.equip(item("b", "BASE-WPN-AXE-T1"), "offHand", true);
    inv.addItem(item("g", "BASE-WPN-GREATSWORD-T1"));
    for (let i = 1; i < INVENTORY_SLOTS; i++)
      inv.addItem(item(`f${String(i)}`, "BASE-WPN-CLAW-T1"));
    expect(inv.full).toBe(true);
    // 両手武器：1枠空くが、2つ外れる
    expect(equipFromInventory(inv, eq, "g", "mainHand", true, 1)).toBe(false);
    expect(eq.get("mainHand")?.uid).toBe("a");
    expect(eq.get("offHand")?.uid).toBe("b");
    expect(inv.items).toHaveLength(INVENTORY_SLOTS);
    // 外すのも、いっぱいならできない
    expect(unequipToInventory(inv, eq, "mainHand")).toBe(false);
    expect(eq.get("mainHand")?.uid).toBe("a");
    // 片手武器どうしの入れ替えは1枠空いて1つ外れるので、できる
    expect(equipFromInventory(inv, eq, "f1", "mainHand", true, 1)).toBe(true);
    expect(eq.get("mainHand")?.uid).toBe("f1");
    expect(inv.items.some((i) => i.uid === "a")).toBe(true);
  });

  it("インベントリに無い物は RangeError", () => {
    expect(() =>
      equipFromInventory(new Inventory(), new Equipment(db), "none", "mainHand", true, 1),
    ).toThrow(RangeError);
  });
});

describe("必要Lv（ItemBaseDef.requiredLevel）", () => {
  // 実際のデータのベースは今は全て必要Lv1なので、長剣を必要Lv10にしたベースを足した db で確かめる
  const LEVEL10_ID = "BASE-TEST-LONGSWORD-LV10";
  const level10: ItemBaseDef = {
    ...base("BASE-WPN-LONGSWORD-T1"),
    id: LEVEL10_ID,
    requiredLevel: 10,
  };
  const dbLv: ContentDb = {
    ...db,
    itemBases: new Map([...db.itemBases, [LEVEL10_ID, level10]]),
  };

  it("levelMet の境界：必要Lv−1 は届かない、ちょうど・+1 は届く", () => {
    expect(levelMet(level10, 9)).toBe(false);
    expect(levelMet(level10, 10)).toBe(true);
    expect(levelMet(level10, 11)).toBe(true);
  });

  it("必要Lvに届いていない装備は equipFromInventory で着られず、持ち物も装備も変わらない", () => {
    const inv = new Inventory();
    const eq = new Equipment(dbLv);
    eq.equip(item("a", "BASE-WPN-AXE-T1"), "mainHand", true);
    inv.addItem(item("h", LEVEL10_ID));
    inv.addItem(item("x", "BASE-WPN-CLAW-T1"));
    const invBefore = inv.items.map((i) => i.uid);
    const eqBefore = eq.entries().map(([s, i]) => [s, i.uid]);
    expect(equipFromInventory(inv, eq, "h", "mainHand", true, 9)).toBe(false);
    expect(equipFromInventory(inv, eq, "h", "offHand", true, 9)).toBe(false);
    expect(inv.items.map((i) => i.uid)).toEqual(invBefore);
    expect(eq.entries().map(([s, i]) => [s, i.uid])).toEqual(eqBefore);
  });

  it("必要Lvちょうどなら着られる", () => {
    const inv = new Inventory();
    const eq = new Equipment(dbLv);
    eq.equip(item("a", "BASE-WPN-AXE-T1"), "mainHand", true);
    inv.addItem(item("h", LEVEL10_ID));
    expect(equipFromInventory(inv, eq, "h", "mainHand", true, 10)).toBe(true);
    expect(eq.get("mainHand")?.uid).toBe("h");
    expect(inv.items.map((i) => i.uid)).toEqual(["a"]);
  });
});
