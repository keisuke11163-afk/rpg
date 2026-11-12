/**
 * U-17 強化・クラフト（開発計画書 T13）：負荷は100を超えない／装備が消えない（分解を除く）／
 * 封詞した詞が次の操作で残る／定着した装備には強化以外ができない。
 */
import fc from "fast-check";
import {
  CRACK_CHANCE,
  CRAFT_MATERIALS,
  type ContentDb,
  type CraftOp,
  Equipment,
  INSCRIPTIONS,
  INSPIRATION_CHANCE,
  Inventory,
  type ItemInstance,
  MAX_FORGE_LOAD,
  Rng,
  craft,
  craftBlock,
  craftWithInventory,
  disassembleFromInventory,
  enhance,
  enhanceCost,
  enhanceWithInventory,
  generateItem,
  inscribe,
  itemEffectInstances,
  opLoad,
} from "@stella/core";
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../src/index.ts";

const db: ContentDb = loadGameContent();
const base = (id: string) => {
  const b = db.itemBases.get(id);
  if (b === undefined) throw new Error(`${id} がない`);
  return b;
};
const normal = (uid = "n"): ItemInstance => ({
  uid,
  base: "BASE-WPN-LONGSWORD-T1",
  rarity: "normal",
  itemLevel: 10,
  affixes: [],
});
const rare = (seed = "r", uid = "r"): ItemInstance =>
  generateItem(db, Rng.fromSeed(seed), {
    uid,
    base: base("BASE-WPN-LONGSWORD-T1"),
    rarity: "rare",
    itemLevel: 10,
  });

describe("強化（仕様書v0.2 3.9）", () => {
  it("+1ごとに基礎ダメージ+5%（攻撃速度・会心率は変わらない）。失敗しない。+10まで", () => {
    const attrs = { go: 30, jin: 30, ri: 5, kon: 5 };
    let item = normal();
    const eq = new Equipment(db);
    eq.equip(item, "mainHand", true);
    const before = eq.mainWeapon(attrs);
    for (let i = 0; i < 10; i++) item = enhance(item);
    expect(item.enhance).toBe(10);
    expect(() => enhance(item)).toThrow(RangeError);
    const eq2 = new Equipment(db);
    eq2.equip(item, "mainHand", true);
    const after = eq2.mainWeapon(attrs);
    expect(after?.weapon.base.physical?.min).toBeCloseTo(
      (before?.weapon.base.physical?.min ?? 0) * 1.5,
      12,
    );
    expect(after?.attackSpeed).toBe(before?.attackSpeed);
    expect(after?.weapon.critChance).toBe(before?.weapon.critChance);
  });

  it("コストは段階で上がる（仕様書の表）。負荷は増えず、定着した装備も強化できる", () => {
    expect(enhanceCost(normal())).toEqual({ [CRAFT_MATERIALS.magicDust]: 10 });
    expect(enhanceCost({ ...normal(), enhance: 3 })).toEqual({
      [CRAFT_MATERIALS.magicDust]: 40,
      [CRAFT_MATERIALS.starSand]: 2,
    });
    expect(enhanceCost({ ...normal(), enhance: 9 })).toEqual({
      [CRAFT_MATERIALS.starSand]: 30,
      [CRAFT_MATERIALS.bossCore]: 1,
    });
    expect(enhanceCost({ ...normal(), enhance: 10 })).toBeUndefined();
    const settled = { ...normal(), forgeLoad: 100 };
    expect(enhance(settled).forgeLoad).toBe(100);
    const inv = new Inventory();
    inv.addItem(normal("a"));
    expect(enhanceWithInventory(inv, "a")).toBe(false);
    inv.addMaterial(CRAFT_MATERIALS.magicDust, 10);
    expect(enhanceWithInventory(inv, "a")).toBe(true);
    expect(inv.material(CRAFT_MATERIALS.magicDust)).toBe(0);
    expect(inv.items[0]?.enhance).toBe(1);
  });

  it("銘は +10 で、候補から1つ刻める（1回だけ）。銘の効果は装備の効果に入る", () => {
    const ten = { ...normal(), enhance: 10 };
    expect(() => inscribe(normal(), INSCRIPTIONS[0])).toThrow(RangeError);
    expect(() => inscribe(ten, "EFF-NONE")).toThrow(RangeError);
    const done = inscribe(ten, INSCRIPTIONS[0]);
    expect(() => inscribe(done, INSCRIPTIONS[1])).toThrow(RangeError);
    expect(itemEffectInstances(db, done).some((e) => e.effectId === INSCRIPTIONS[0])).toBe(true);
    for (const id of INSCRIPTIONS) expect(db.effects.get(id)?.origin).toBe("inscription");
  });
});

describe("クラフトの操作（仕様書v0.2 3.10）", () => {
  const rng = (): Rng => Rng.fromSeed("craft");

  it("目覚めの粉：白→青（1〜2の詞）。開眼の結晶：青→黄（青の詞を残して足す）。レアリティが違えばできない", () => {
    const magic = craft(db, rng(), normal(), { kind: "awaken" }).item;
    expect(magic.rarity).toBe("magic");
    expect(magic.affixes.length).toBeGreaterThanOrEqual(1);
    expect(magic.affixes.length).toBeLessThanOrEqual(2);
    expect(magic.forgeLoad).toBe(5);
    expect(craftBlock(magic, { kind: "awaken" })).toBe("rarity");
    const r = craft(db, rng(), magic, { kind: "insight" }).item;
    expect(r.rarity).toBe("rare");
    expect(r.forgeLoad).toBe(15);
    for (const a of magic.affixes) expect(r.affixes).toContainEqual(a);
    expect(r.affixes.length).toBeGreaterThanOrEqual(magic.affixes.length);
  });

  it("転詞の石：希少の詞を全て抽選し直す（封詞した詞は残り、封詞は外れる）", () => {
    const item = rare();
    const keep = item.affixes[0];
    if (keep === undefined) throw new Error("詞が無い");
    const sealed = craft(db, rng(), item, { kind: "seal", affix: keep.id }).item;
    expect(sealed.sealed).toBe(keep.id);
    expect(sealed.forgeLoad).toBe(5);
    const after = craft(db, Rng.fromSeed("t2"), sealed, { kind: "transmute" }).item;
    expect(after.affixes).toContainEqual(keep);
    expect(after.sealed).toBeUndefined();
    expect(after.forgeLoad).toBe(20);
  });

  it("調律の音叉：選んだ詞の値を、同じtierの範囲で抽選し直す。封詞した詞は調律できない", () => {
    const item = rare("tune");
    const target = item.affixes.find((a) => db.affixes.get(a.id)?.roll === "range");
    if (target === undefined) return;
    const out = craft(db, rng(), item, { kind: "tune", affix: target.id }).item;
    const tuned = out.affixes.find((a) => a.id === target.id);
    expect(tuned?.tier).toBe(target.tier);
    expect(craftBlock(item, { kind: "tune", affix: "AFX-NONE" })).toBe("noAffix");
    expect(craftBlock({ ...item, sealed: target.id }, { kind: "tune", affix: target.id })).toBe(
      "sealed",
    );
  });

  it("削詞の刃：封詞していない詞をランダムに1つ消す", () => {
    const item = rare("erase");
    const keep = item.affixes[0];
    if (keep === undefined) throw new Error("詞が無い");
    const sealed = { ...item, sealed: keep.id };
    const out = craft(db, rng(), sealed, { kind: "erase" }).item;
    expect(out.affixes).toHaveLength(item.affixes.length - 1);
    expect(out.affixes).toContainEqual(keep);
    expect(craftBlock({ ...item, affixes: [keep], sealed: keep.id }, { kind: "erase" })).toBe(
      "noAffix",
    );
  });

  it("封詞の蝋：2個目以降は負荷+15", () => {
    const item = rare();
    expect(opLoad(item, { kind: "seal", affix: "x" })).toBe(5);
    expect(opLoad({ ...item, sealsUsed: 1 }, { kind: "seal", affix: "x" })).toBe(15);
  });

  it("負荷が100を超える操作はできない（定着）。ユニークはクラフトできない", () => {
    expect(craftBlock({ ...rare(), forgeLoad: 90 }, { kind: "transmute" })).toBe("settled");
    expect(craftBlock({ ...rare(), forgeLoad: 85 }, { kind: "transmute" })).toBeUndefined();
    expect(craftBlock({ ...rare(), rarity: "unique" }, { kind: "erase" })).toBe("unique");
    expect(() => craft(db, rng(), { ...rare(), forgeLoad: 96 }, { kind: "erase" })).toThrow(
      RangeError,
    );
  });

  it("負荷が60以上の操作では、およそ20%で亀裂、10%で霊感が起きる。60未満では起きない", () => {
    const item = rare("stat");
    const target = item.affixes[0];
    if (target === undefined) throw new Error("詞が無い");
    const op: CraftOp = { kind: "tune", affix: target.id };
    const r = Rng.fromSeed("unstable");
    let cracks = 0;
    let inspired = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const out = craft(db, r, { ...item, forgeLoad: 60 }, op);
      if (out.cracked !== undefined) cracks += 1;
      if (out.inspired !== undefined) inspired += 1;
      const low = craft(db, r, { ...item, forgeLoad: 59 }, op);
      expect(low.cracked).toBeUndefined();
      expect(low.inspired).toBeUndefined();
    }
    const sd = (p: number): number => Math.sqrt((p * (1 - p)) / n);
    expect(Math.abs(cracks / n - CRACK_CHANCE)).toBeLessThan(5 * sd(CRACK_CHANCE));
    // 霊感は、上げられる詞が無ければ起きない（iLv10 は T7 だけの詞もある）
    expect(inspired / n).toBeLessThanOrEqual(INSPIRATION_CHANCE + 5 * sd(INSPIRATION_CHANCE));
  });

  it("素材が無ければ、何も変えない。あれば1つ使い、同じ uid のまま入れ替える", () => {
    const inv = new Inventory();
    inv.addItem(normal("a"));
    expect(craftWithInventory(db, rng(), inv, "a", { kind: "awaken" })).toBe("material");
    expect(inv.items[0]?.rarity).toBe("normal");
    inv.addMaterial(CRAFT_MATERIALS.awakeningDust, 1);
    const r = craftWithInventory(db, rng(), inv, "a", { kind: "awaken" });
    expect(typeof r).toBe("object");
    expect(inv.items[0]?.uid).toBe("a");
    expect(inv.items[0]?.rarity).toBe("magic");
    expect(inv.material(CRAFT_MATERIALS.awakeningDust)).toBe(0);
  });

  it("分解：白・青→魔塵、黄→星砂。装備はなくなる", () => {
    const inv = new Inventory();
    inv.addItem(normal("a"));
    inv.addItem({ ...rare(), uid: "b" });
    expect(disassembleFromInventory(inv, "a")).toEqual({ [CRAFT_MATERIALS.magicDust]: 3 });
    expect(disassembleFromInventory(inv, "b")).toEqual({ [CRAFT_MATERIALS.starSand]: 3 });
    expect(inv.items).toHaveLength(0);
    expect(inv.material(CRAFT_MATERIALS.magicDust)).toBe(3);
  });
});

describe("T13：ランダムな操作の列でも、不変条件が保たれる", () => {
  const OPS = ["awaken", "insight", "transmute", "tune", "erase", "seal", "enhance"] as const;

  it("負荷は100を超えない／装備は消えない／封詞した詞は次の操作で残る／定着したら強化だけ", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.array(fc.tuple(fc.constantFrom(...OPS), fc.nat()), { maxLength: 40 }),
        (seed, ops) => {
          const rng = Rng.fromSeed(`t13-${String(seed)}`);
          const inv = new Inventory();
          inv.addItem(normal("x"));
          for (const m of Object.values(CRAFT_MATERIALS)) inv.addMaterial(m, 1000);
          for (const [kind, pick] of ops) {
            const before = inv.items.find((i) => i.uid === "x");
            if (before === undefined) return false;
            if (kind === "enhance") {
              enhanceWithInventory(inv, "x");
              continue;
            }
            const target = before.affixes[pick % Math.max(1, before.affixes.length)]?.id ?? "none";
            const op: CraftOp =
              kind === "tune" || kind === "seal" ? { kind, affix: target } : { kind };
            const r = craftWithInventory(db, rng, inv, "x", op);
            const after = inv.items.find((i) => i.uid === "x");
            // 装備は消えない（同じ uid がインベントリにある）
            expect(after).toBeDefined();
            // 負荷は100を超えない
            expect(after?.forgeLoad ?? 0).toBeLessThanOrEqual(MAX_FORGE_LOAD);
            if (typeof r === "string") {
              // できなかった操作は、何も変えない
              expect(after).toEqual(before);
              continue;
            }
            // 封詞した詞は、次の1回の操作（封詞そのものを除く）で残る
            if (before.sealed !== undefined && kind !== "seal") {
              const kept = before.affixes.find((a) => a.id === before.sealed);
              if (kind === "transmute" || kind === "erase")
                expect(after?.affixes).toContainEqual(kept);
            }
          }
          // 定着（どの操作も負荷が足りない）なら、強化以外はできない
          const last = inv.items.find((i) => i.uid === "x");
          if (last !== undefined && (last.forgeLoad ?? 0) > MAX_FORGE_LOAD - 5)
            for (const kind of ["awaken", "insight", "transmute", "erase"] as const)
              expect(craftBlock(last, { kind })).not.toBeUndefined();
          return true;
        },
      ),
      { numRuns: 300 },
    );
  });
});
