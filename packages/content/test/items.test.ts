import fc from "fast-check";
import {
  AFFIX_LIMITS,
  GroundLoot,
  ItemBag,
  Purse,
  sellPrice,
  MATERIAL,
  createRng,
  dropItemLevel,
  eligibleTiers,
  generateItem,
  itemFindMultipliers,
  rarityWeights,
  rollDrops,
  rollGold,
  rollItemCount,
  rollRarity,
  rollTier,
  tierRange,
  type GenerateContext,
  type ItemInstance,
  type Rarity,
} from "@stella/core";
import { describe, expect, it } from "vitest";
import { AFFIXES, GENERATION_DATA, ITEM_BASES, itemBase, loadContent } from "../src/index.ts";

let n = 0;
const uid = (): string => `itm_${String(n++)}`;
const gen = (ctx: Partial<GenerateContext> & { ilvl: number }, seed: number | string) =>
  generateItem(GENERATION_DATA, { uid, ...ctx }, createRng(seed));

describe("データ", () => {
  it("ベース：武器7・盾2・防具15・アクセサリー6。要求値（補助仕様書 14章）", () => {
    expect(ITEM_BASES.filter((b) => b.kind === "weapon")).toHaveLength(7);
    expect(ITEM_BASES.filter((b) => b.kind === "shield")).toHaveLength(2);
    expect(ITEM_BASES.filter((b) => b.kind === "armor")).toHaveLength(15);
    expect(ITEM_BASES.filter((b) => b.kind === "accessory")).toHaveLength(6);
    expect(itemBase("BASE-WPN-GREATSWORD-T1").requirement).toEqual({ stat: "剛", value: 18 });
    expect(itemBase("BASE-WPN-LONGSWORD-T1").requirement).toEqual({ stat: "剛", value: 12 });
    expect(itemBase("BASE-WPN-DAGGER-T1").requirement?.stat).toBe("迅");
    expect(itemBase("BASE-ARM-HEAVY-BODY-T1").defense).toEqual({ kind: "armor", value: 40 });
    expect(itemBase("BASE-ARM-ROBE-BODY-T1").defense?.kind).toBe("barrier");
  });
  it("IDが重複せず、タグの参照（系統詞）が実在する", () => {
    const ids = [...ITEM_BASES.map((b) => b.id), ...AFFIXES.map((a) => a.id)];
    expect(new Set(ids).size).toBe(ids.length);
    const tags = new Set(loadContent().data.tags.map((t) => t.id));
    for (const a of AFFIXES) if (a.family) expect(tags.has(a.family)).toBe(true);
  });
});

describe("詞のtier", () => {
  const phys = AFFIXES.find((a) => a.id === "AFX-PRE-PHYS-INC-WPN");
  if (!phys) throw new Error("詞");
  it("T6は、T7からT4への差の1/3だけ進めた値（切り上げ）、T5は2/3", () => {
    expect(tierRange(phys, 7)).toEqual({ min: 10, max: 19 });
    expect(tierRange(phys, 4)).toEqual({ min: 40, max: 54 });
    expect(tierRange(phys, 6)).toEqual({ min: 20, max: 31 });
    expect(tierRange(phys, 5)).toEqual({ min: 30, max: 43 });
  });
  it("iLvで出現できるtier：iLv1〜11はT7、12〜24はT6まで、25以上でT5", () => {
    expect(eligibleTiers(5, 5)).toEqual([7]);
    expect(eligibleTiers(12, 5)).toEqual([6, 7]);
    expect(eligibleTiers(25, 5)).toEqual([5, 6, 7]);
    expect(eligibleTiers(60, 5)).toEqual([5, 6, 7]);
  });
  it("tierの抽選：最も高いものが40、残りを等分して60", () => {
    const rng = createRng("tier");
    const c = new Map<number, number>();
    for (let i = 0; i < 100000; i++) {
      const t = rollTier(25, 5, rng);
      c.set(t, (c.get(t) ?? 0) + 1);
    }
    const share = (t: number): number => (c.get(t) ?? 0) / 100000;
    expect(share(5)).toBeGreaterThan(0.38);
    expect(share(5)).toBeLessThan(0.42);
    expect(share(6)).toBeGreaterThan(0.28);
    expect(share(6)).toBeLessThan(0.32);
    expect(rollTier(3, 5, rng)).toBe(7);
  });
});

describe("T12 レアリティの抽選", () => {
  it("手順：基本は 通常66／魔法26／希少7／固有0.8／星座0.2", () => {
    const w = rarityWeights({ rank: "normal" });
    expect(w.normal).toBeCloseTo(66);
    expect(w.magic).toBeCloseTo(26);
    expect(w.rare).toBeCloseTo(7);
    expect(w.unique).toBeCloseTo(0.8);
    expect(w.set).toBeCloseTo(0.2);
  });
  it("敵の格：精鋭は希少以上×2.5。通常の重みで合計100に調整", () => {
    const w = rarityWeights({ rank: "elite" });
    expect(w.rare).toBeCloseTo(17.5);
    expect(w.unique).toBeCloseTo(2);
    expect(w.magic).toBeCloseTo(26);
    expect(w.normal + w.magic + w.rare + w.unique + w.set).toBeCloseTo(100);
  });
  it("発見率：希少は×(1＋IF)、固有は IF×200÷(IF＋200)（IF100%で+67%、300%で+120%）", () => {
    expect(itemFindMultipliers(100).rare).toBeCloseTo(2);
    expect(itemFindMultipliers(100).unique).toBeCloseTo(1.6667, 3);
    expect(itemFindMultipliers(300).unique).toBeCloseTo(2.2, 3);
    const w = rarityWeights({ rank: "normal", itemFind: 1 });
    expect(w.rare).toBeCloseTo(14);
  });
  it("通常が0を下回るときは、通常を0にして残りを比例で縮める", () => {
    const w = rarityWeights({ rank: "elite", floorBonus: 1.5, itemFind: 5 });
    expect(w.normal).toBe(0);
    expect(w.magic + w.rare + w.unique + w.set).toBeCloseTo(100);
  });
  it("100万回の抽選で、割合が仕様の許容範囲に入る", () => {
    const rng = createRng("million");
    const c: Partial<Record<Rarity, number>> = {};
    const N = 1_000_000;
    for (let i = 0; i < N; i++) {
      const r = rollRarity({ rank: "normal" }, 10, rng);
      c[r] = (c[r] ?? 0) + 1;
    }
    expect((c.normal ?? 0) / N).toBeCloseTo(0.66, 2);
    expect((c.magic ?? 0) / N).toBeCloseTo(0.26, 2);
    expect((c.rare ?? 0) / N).toBeCloseTo(0.07, 2);
    expect((c.unique ?? 0) / N).toBeGreaterThan(0.0065);
    expect((c.unique ?? 0) / N).toBeLessThan(0.0095);
    expect((c.set ?? 0) / N).toBeGreaterThan(0.0012);
    expect((c.set ?? 0) / N).toBeLessThan(0.0028);
  });
  it("星刻：希少のうち2%（iLv60以上だけ）", () => {
    const rng = createRng("astral");
    let rare = 0;
    let astral = 0;
    for (let i = 0; i < 200000; i++) {
      const r = rollRarity({ rank: "normal" }, 60, rng);
      if (r === "rare") rare++;
      if (r === "astral") astral++;
    }
    expect(astral / (rare + astral)).toBeGreaterThan(0.015);
    expect(astral / (rare + astral)).toBeLessThan(0.025);
    expect(rollRarity({ rank: "normal" }, 59, createRng(1))).not.toBe("astral");
  });
});

describe("アイテムの生成", () => {
  const countBy = (item: ItemInstance, pos: "prefix" | "suffix"): number =>
    item.affixes.filter(
      (a) =>
        AFFIXES.find((d) => d.id === a.id)?.position === pos &&
        !AFFIXES.find((d) => d.id === a.id)?.beltSlot,
    ).length;

  it("詞の数：通常0・魔法1〜2・希少3〜6。部位の上限を超えない（ランダムな組み合わせ）", () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.integer({ min: 1, max: 30 }),
        fc.constantFrom<Rarity>("normal", "magic", "rare"),
        (seed, ilvl, rarity) => {
          const item = gen({ ilvl, rarity, enemyFamily: "TAG-ENEMY-BEAST" }, seed);
          const base = itemBase(item.baseId);
          const limit = AFFIX_LIMITS[base.slot];
          expect(countBy(item, "prefix")).toBeLessThanOrEqual(limit.prefix);
          expect(countBy(item, "suffix")).toBeLessThanOrEqual(limit.suffix);
          expect(item.affixes.length).toBeLessThanOrEqual(limit.prefix + limit.suffix + limit.belt);
          if (rarity === "normal") expect(item.affixes).toHaveLength(0);
          if (rarity === "magic") expect(item.affixes.length).toBeGreaterThanOrEqual(1);
          if (rarity === "magic") expect(item.affixes.length).toBeLessThanOrEqual(2);
          expect(new Set(item.affixes.map((a) => a.id)).size).toBe(item.affixes.length);
          for (const a of item.affixes) {
            const def = AFFIXES.find((d) => d.id === a.id);
            expect(def?.slots).toContain(base.slot);
            expect(a.tier).toBeGreaterThanOrEqual(5);
            expect(a.tier).toBeLessThanOrEqual(7);
          }
        },
      ),
      { numRuns: 500 },
    );
  });
  it("tierはiLvの範囲内（iLv1〜11はT7だけ、12以上でT6、25以上でT5）", () => {
    for (let i = 0; i < 300; i++) {
      for (const a of gen({ ilvl: 5, rarity: "rare" }, i).affixes) expect(a.tier).toBe(7);
      for (const a of gen({ ilvl: 14, rarity: "rare" }, i).affixes)
        expect(a.tier).toBeGreaterThanOrEqual(6);
    }
  });
  it("値は、tierの範囲の中。追加ダメージは最小・最大の組", () => {
    for (let i = 0; i < 300; i++) {
      for (const a of gen({ ilvl: 14, rarity: "rare" }, i).affixes) {
        const def = AFFIXES.find((d) => d.id === a.id);
        if (!def) throw new Error("def");
        const r = tierRange(def, a.tier);
        if (def.added) expect(a.rolls).toEqual([r.min, r.max]);
        else {
          expect(a.rolls).toHaveLength(1);
          expect(a.rolls[0]).toBeGreaterThanOrEqual(r.min);
          expect(a.rolls[0]).toBeLessThanOrEqual(r.max);
        }
      }
    }
  });
  it("星鉄の首飾り：共鳴紋が確定で付き、詞の枠が1つ減る。共鳴紋は星核を除く星域", () => {
    let seen = 0;
    for (let i = 0; i < 2000 && seen < 30; i++) {
      const item = gen({ ilvl: 14, rarity: "rare" }, `s${String(i)}`);
      if (item.baseId !== "BASE-ACC-NECK-STARIRON-T1") continue;
      seen++;
      const res = item.affixes.filter((a) => a.id === "AFX-SUF-RESONANCE");
      expect(res).toHaveLength(1);
      expect(res[0]?.params?.["region"]).toMatch(/^TAG-REGION-/);
      expect(res[0]?.params?.["region"]).not.toBe("TAG-REGION-CORE");
      expect(countBy(item, "suffix")).toBeLessThanOrEqual(3);
    }
    expect(seen).toBeGreaterThan(0);
  });
  it("系統詞（獣狩りの）は、獣系の敵からだけ。他では出ない", () => {
    let withBeast = 0;
    for (let i = 0; i < 3000; i++) {
      if (
        gen({ ilvl: 14, rarity: "rare", enemyFamily: "TAG-ENEMY-BEAST" }, i).affixes.some(
          (a) => a.id === "AFX-FAM-BEASTHUNTER",
        )
      )
        withBeast++;
      expect(
        gen({ ilvl: 14, rarity: "rare" }, i).affixes.some((a) => a.id === "AFX-FAM-BEASTHUNTER"),
      ).toBe(false);
    }
    expect(withBeast).toBeGreaterThan(0);
  });
  it("帯紋は腰だけ。腰は前2／後2＋帯紋1", () => {
    for (let i = 0; i < 3000; i++) {
      const item = gen({ ilvl: 14, rarity: "rare" }, `b${String(i)}`);
      const has = item.affixes.some((a) => a.id === "AFX-BELT-FLASK");
      if (has) expect(itemBase(item.baseId).slot).toBe("腰");
      if (itemBase(item.baseId).slot === "腰") {
        expect(item.affixes.length).toBeLessThanOrEqual(5);
      }
    }
  });
  it("35%はジョブに合わせる：適性A以上の武器種と、そのジョブの職詞", () => {
    const job = {
      jobId: "JOB-WARRIOR",
      weaponClasses: ["greatsword", "greataxe", "greathammer", "axe", "longsword"] as const,
    };
    let goodWeapon = 0;
    let jobAffix = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const item = gen(
        { ilvl: 10, rarity: "rare", job: { ...job, weaponClasses: [...job.weaponClasses] } },
        `j${String(i)}`,
      );
      const base = itemBase(item.baseId);
      if (
        base.kind === "weapon" &&
        base.weaponClass &&
        (job.weaponClasses as readonly string[]).includes(base.weaponClass)
      )
        goodWeapon++;
      if (item.affixes.some((a) => a.id === "AFX-JOB-WARRIOR-FURY")) jobAffix++;
    }
    // 35%は必ず適性A以上の武器。残り65%は完全にランダム（全ベース 30 のうち適性A以上の武器 5）
    const expected = 0.35 + 0.65 * (5 / ITEM_BASES.length);
    expect(goodWeapon / N).toBeGreaterThan(expected - 0.03);
    expect(goodWeapon / N).toBeLessThan(expected + 0.03);
    expect(jobAffix).toBeGreaterThan(0);
    // 寄せないときと比べて、職詞が増える
    let plain = 0;
    for (let i = 0; i < N; i++) {
      if (
        gen({ ilvl: 10, rarity: "rare" }, `j${String(i)}`).affixes.some(
          (a) => a.id === "AFX-JOB-WARRIOR-FURY",
        )
      )
        plain++;
    }
    expect(jobAffix).toBeGreaterThan(plain);
  });
  it("ユニークの抽選元が空のあいだは、希少になる（U-16 で9個を入れる）", () => {
    expect(gen({ ilvl: 10, rarity: "unique" }, 1).rarity).toBe("rare");
  });
  it("同じシードで同じアイテム", () => {
    n = 0;
    const a = gen({ ilvl: 10, rarity: "rare" }, "same");
    n = 0;
    const b = gen({ ilvl: 10, rarity: "rare" }, "same");
    expect(b).toEqual(a);
  });
});

describe("ドロップ", () => {
  it("アイテムの数：通常は10%で1個／魔法は60%で1〜2個／精鋭は2〜4／中ボス4〜6／章ボス6〜10", () => {
    const rng = createRng("count");
    const stat = (src: Parameters<typeof rollItemCount>[0], f: (c: number) => void) => {
      for (let i = 0; i < 20000; i++) f(rollItemCount(src, rng));
    };
    let normal = 0;
    stat("normal", (c) => (normal += c));
    expect(normal / 20000).toBeGreaterThan(0.09);
    expect(normal / 20000).toBeLessThan(0.11);
    let magicZero = 0;
    stat("magic", (c) => {
      expect(c).toBeLessThanOrEqual(2);
      if (c === 0) magicZero++;
    });
    expect(magicZero / 20000).toBeGreaterThan(0.38);
    expect(magicZero / 20000).toBeLessThan(0.42);
    stat("elite", (c) => {
      expect(c >= 2 && c <= 4).toBe(true);
    });
    stat("midBoss", (c) => {
      expect(c >= 4 && c <= 6).toBe(true);
    });
    stat("chapterBoss", (c) => {
      expect(c >= 6 && c <= 10).toBe(true);
    });
  });
  it("iLv：敵のLv（精鋭は+2、ボスは+4）", () => {
    expect(dropItemLevel("normal", 5)).toBe(5);
    expect(dropItemLevel("elite", 5)).toBe(7);
    expect(dropItemLevel("midBoss", 11)).toBe(15);
    expect(dropItemLevel("chapterBoss", 14)).toBe(18);
  });
  it("金貨：通常25%で(1＋Lv)×(1〜2)、精鋭は必ず5倍", () => {
    const rng = createRng("gold");
    let got = 0;
    for (let i = 0; i < 20000; i++) if (rollGold("normal", 4, rng) > 0) got++;
    expect(got / 20000).toBeGreaterThan(0.23);
    expect(got / 20000).toBeLessThan(0.27);
    for (let i = 0; i < 100; i++) {
      const g = rollGold("elite", 4, rng);
      expect(g === 25 || g === 50).toBe(true);
    }
  });
  it("中ボスは希少以上が1個確定、還星の灯1個確定、目覚めの粉1個", () => {
    for (let i = 0; i < 200; i++) {
      const r = rollDrops(
        GENERATION_DATA,
        { source: "midBoss", enemyLevel: 11, generate: {}, uid },
        createRng(i),
      );
      expect(r.items.length).toBeGreaterThanOrEqual(4);
      expect(["rare", "unique", "set"]).toContain(r.items[0]?.rarity);
      expect(r.materials[MATERIAL.returnLamp]).toBe(1);
      expect(r.materials[MATERIAL.awakeningDust]).toBe(1);
    }
  });
  it("素材：獣系は獣牙を3%で落とす。還星の灯は通常で0.2%", () => {
    let fang = 0;
    let lamp = 0;
    const N = 100000;
    const rng = createRng("mat");
    for (let i = 0; i < N; i++) {
      const r = rollDrops(
        GENERATION_DATA,
        { source: "normal", enemyLevel: 3, family: "TAG-ENEMY-BEAST", generate: {}, uid },
        rng,
      );
      if (r.materials[MATERIAL.beastFang]) fang++;
      if (r.materials[MATERIAL.returnLamp]) lamp++;
    }
    expect(fang / N).toBeGreaterThan(0.027);
    expect(fang / N).toBeLessThan(0.033);
    expect(lamp / N).toBeGreaterThan(0.0015);
    expect(lamp / N).toBeLessThan(0.0025);
  });
  it("精鋭のドロップは、希少以上の率が通常の約2.5倍", () => {
    const rate = (src: "normal" | "elite"): number => {
      const rng = createRng(`rate-${src}`);
      let r = 0;
      const N = 200000;
      for (let i = 0; i < N; i++) {
        const k = rollRarity({ rank: src }, 5, rng);
        if (k === "rare" || k === "unique" || k === "set") r++;
      }
      return r / N;
    };
    expect(rate("elite") / rate("normal")).toBeGreaterThan(2.2);
    expect(rate("elite") / rate("normal")).toBeLessThan(2.8);
  });
});

describe("地面のドロップとインベントリ", () => {
  const dropOf = (n: number) => ({
    items: Array.from({ length: n }, () => gen({ ilvl: 5, rarity: "magic" }, n)),
    gold: 10,
    materials: { [MATERIAL.awakeningDust]: 2 },
  });
  it("金貨・素材は半径1.5m以内で自動で拾う。遠いと拾わない", () => {
    const loot = new GroundLoot();
    const purse = new Purse();
    loot.spawn({ x: 5, y: 0 }, dropOf(0));
    expect(loot.autoPickup({ x: 0, y: 0 }, purse)).toHaveLength(0);
    expect(loot.autoPickup({ x: 4.8, y: 0 }, purse)).toHaveLength(2);
    expect(purse.gold).toBe(10);
    expect(purse.material(MATERIAL.awakeningDust)).toBe(2);
    expect(loot.entries).toHaveLength(0);
  });
  it("装備はFで最も近いものを拾う。装備は自動では拾わない", () => {
    const loot = new GroundLoot();
    const bag = new ItemBag();
    loot.spawn({ x: 1, y: 0 }, dropOf(2));
    loot.autoPickup({ x: 1, y: 0 }, new Purse());
    expect(loot.entries.filter((e) => e.kind === "item")).toHaveLength(2);
    expect(loot.pickupNearestItem({ x: 30, y: 0 }, bag)).toEqual({ ok: false, reason: "none" });
    expect(loot.pickupNearestItem({ x: 1, y: 0 }, bag).ok).toBe(true);
    expect(bag.count).toBe(1);
  });
  it("インベントリは60枠。いっぱいなら拾えず、地面に残る", () => {
    const bag = new ItemBag();
    for (let i = 0; i < 60; i++) expect(bag.add(gen({ ilvl: 3, rarity: "normal" }, i))).toBe(true);
    expect(bag.full).toBe(true);
    const loot = new GroundLoot();
    loot.spawn({ x: 0, y: 0 }, dropOf(1));
    expect(loot.pickupNearestItem({ x: 0, y: 0 }, bag)).toEqual({ ok: false, reason: "full" });
    expect(loot.entries.some((e) => e.kind === "item")).toBe(true);
    const first = bag.items()[0];
    if (!first) throw new Error("none");
    expect(bag.remove(first.uid)?.uid).toBe(first.uid);
    expect(bag.add(gen({ ilvl: 3, rarity: "normal" }, 999))).toBe(true);
  });
  it("素材・金貨は足りなければ減らない", () => {
    const p = new Purse();
    p.addMaterial("X", 1);
    expect(p.spendMaterial("X", 2)).toBe(false);
    expect(p.material("X")).toBe(1);
    expect(p.spendGold(1)).toBe(false);
  });
  it("売却額：通常＝1＋⌊iLv÷2⌋。魔法×3、希少×8、ユニーク×15", () => {
    const item = (rarity: Rarity): ItemInstance => ({
      ...gen({ ilvl: 10, rarity: "normal" }, 1),
      rarity,
    });
    expect(sellPrice(item("normal"))).toBe(6);
    expect(sellPrice(item("magic"))).toBe(18);
    expect(sellPrice(item("rare"))).toBe(48);
    expect(sellPrice(item("unique"))).toBe(90);
  });
});
