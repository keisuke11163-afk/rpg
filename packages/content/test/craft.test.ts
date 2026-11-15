import fc from "fast-check";
import {
  CRACK_CHANCE,
  Equipment,
  ItemBag,
  MATERIAL,
  MAX_STRAIN,
  Purse,
  RISK_STRAIN,
  awaken,
  carve,
  computeGear,
  createRng,
  disassemble,
  disassembleYield,
  enhance,
  enhanceCost,
  enhanceMultiplier,
  eyeOpen,
  generateItem,
  inscribe,
  mend,
  offerInscriptions,
  reroll,
  seal,
  tune,
  type ItemInstance,
} from "@stella/core";
import { describe, expect, it } from "vitest";
import { CRAFT_DATA, GEAR_DATA, GENERATION_DATA, INSCRIPTIONS, itemBase } from "../src/index.ts";

let n = 0;
const uid = (): string => `c_${String(n++)}`;
const gen = (rarity: ItemInstance["rarity"], seed: number, ilvl = 14): ItemInstance =>
  generateItem(GENERATION_DATA, { ilvl, rarity, uid }, createRng(seed));
const baseOf = (it: ItemInstance) => itemBase(it.baseId);
const rich = (): Purse => {
  const p = new Purse();
  for (const id of Object.values(MATERIAL)) p.addMaterial(id, 1000);
  return p;
};

describe("強化（本仕様書 3.9）", () => {
  it("コストが段階的に上がる：+1〜+3 魔塵10/20/30、+4〜+6 魔塵40＋星砂2/4/6、+7〜+9 星砂10/14/18、+10 星砂30＋章ボスの核1", () => {
    expect(enhanceCost(1)).toEqual({ [MATERIAL.magicDust]: 10 });
    expect(enhanceCost(3)).toEqual({ [MATERIAL.magicDust]: 30 });
    expect(enhanceCost(4)).toEqual({ [MATERIAL.magicDust]: 40, [MATERIAL.starSand]: 2 });
    expect(enhanceCost(6)).toEqual({ [MATERIAL.magicDust]: 40, [MATERIAL.starSand]: 6 });
    expect([7, 8, 9].map((l) => enhanceCost(l)[MATERIAL.starSand])).toEqual([10, 14, 18]);
    expect(enhanceCost(10)).toEqual({ [MATERIAL.starSand]: 30, [MATERIAL.bossCoreCh1]: 1 });
    expect(() => enhanceCost(11)).toThrow();
  });
  it("失敗しない。素材が足りなければ何も減らず強化されない。+10が上限", () => {
    const it = gen("normal", 1);
    const purse = new Purse();
    expect(enhance(it, purse)).toEqual({ ok: false, reason: "material", events: [] });
    expect(it.enhance).toBe(0);
    for (const id of Object.values(MATERIAL)) purse.addMaterial(id, 1000);
    for (let i = 1; i <= 10; i++) {
      expect(enhance(it, purse).ok).toBe(true);
      expect(it.enhance).toBe(i);
    }
    expect(enhance(it, purse).reason).toBe("maxEnhance");
    // 合計：魔塵 10+20+30+40×3 = 180、星砂 2+4+6+10+14+18+30 = 84、核 1
    expect(1000 - purse.material(MATERIAL.magicDust)).toBe(180);
    expect(1000 - purse.material(MATERIAL.starSand)).toBe(84);
    expect(1000 - purse.material(MATERIAL.bossCoreCh1)).toBe(1);
  });
  it("基礎性能が1段階ごとに+5%（+10で+50%）。攻撃速度・会心率・基本刻印は上がらない。指輪・首は数値が上がらない", () => {
    const sword: ItemInstance = {
      uid: "s",
      baseId: "BASE-WPN-GREATSWORD-T1",
      rarity: "normal",
      ilvl: 1,
      affixes: [],
      enhance: 10,
    };
    const eq = new Equipment();
    eq.equip(sword, GEAR_DATA);
    const g = computeGear(eq, GEAR_DATA, { 剛: 99 });
    expect(g.weapon?.min).toBeCloseTo(14 * 1.5);
    expect(g.weapon?.max).toBeCloseTo(24 * 1.5);
    expect(g.weapon?.speed).toBe(1.05);
    expect(g.weapon?.crit).toBe(0.05);
    expect(g.totals["崩し値"]).toBeCloseTo(0.15);
    expect(enhanceMultiplier(sword)).toBeCloseTo(1.5);
    const armor = new Equipment();
    armor.equip(
      {
        uid: "a",
        baseId: "BASE-ARM-HEAVY-BODY-T1",
        rarity: "normal",
        ilvl: 1,
        affixes: [],
        enhance: 4,
      },
      GEAR_DATA,
    );
    expect(computeGear(armor, GEAR_DATA, { 剛: 99 }).armor).toBeCloseTo(40 * 1.2);
    const ring = new Equipment();
    ring.equip(
      {
        uid: "r",
        baseId: "BASE-ACC-RING-SILVER-T1",
        rarity: "normal",
        ilvl: 1,
        affixes: [],
        enhance: 10,
      },
      GEAR_DATA,
    );
    expect(computeGear(ring, GEAR_DATA, {}).totals["全属性耐性"]).toBeCloseTo(0.05);
  });
  it("要求値の未達（-40%）と強化は、基礎性能に重なる", () => {
    const eq = new Equipment();
    eq.equip(
      {
        uid: "s",
        baseId: "BASE-WPN-GREATSWORD-T1",
        rarity: "normal",
        ilvl: 1,
        affixes: [],
        enhance: 10,
      },
      GEAR_DATA,
    );
    expect(computeGear(eq, GEAR_DATA, { 剛: 1 }).weapon?.min).toBeCloseTo(14 * 0.6 * 1.5);
  });
  it("+10で銘を刻める：3つの候補から1つ選ぶ。+10未満・2回目は刻めない。効果は能力値に反映される", () => {
    const it0 = gen("rare", 2);
    const offer = offerInscriptions(CRAFT_DATA, createRng(1));
    expect(offer).toHaveLength(3);
    expect(new Set(offer.map((o) => o.id)).size).toBe(3);
    expect(inscribe(it0, offer[0] as never).reason).toBe("notMax");
    it0.enhance = 10;
    expect(inscribe(it0, INSCRIPTIONS[2] as never).ok).toBe(true);
    expect(it0.inscription).toBe("INS-BREAK");
    expect(inscribe(it0, offer[0] as never).reason).toBe("alreadyInscribed");
    const eq = new Equipment();
    eq.equip({ ...it0, baseId: "BASE-ARM-HEAVY-BODY-T1", affixes: [] }, GEAR_DATA);
    expect(computeGear(eq, GEAR_DATA, { 剛: 99 }).totals["崩し値"]).toBeCloseTo(0.1);
  });
});

describe("分解（本仕様書 3.10）", () => {
  it("白・青→魔塵、黄→星砂、ユニーク→輝石。装備は失われる", () => {
    const bag = new ItemBag();
    const purse = new Purse();
    const normal = gen("normal", 3, 10);
    const magic = gen("magic", 4, 10);
    const rare = gen("rare", 5, 10);
    const unique = { ...gen("normal", 6), rarity: "unique" as const };
    for (const it of [normal, magic, rare, unique]) bag.add(it);
    expect(Object.keys(disassembleYield(normal))).toEqual([MATERIAL.magicDust]);
    expect(Object.keys(disassembleYield(magic))).toEqual([MATERIAL.magicDust]);
    expect(Object.keys(disassembleYield(rare))).toEqual([MATERIAL.starSand]);
    expect(Object.keys(disassembleYield(unique))).toEqual([MATERIAL.radiance]);
    for (const it of [normal, magic, rare, unique])
      expect(disassemble(it.uid, bag, purse).ok).toBe(true);
    expect(bag.count).toBe(0);
    expect(purse.material(MATERIAL.radiance)).toBe(1);
    expect(disassemble("none", bag, purse).ok).toBe(false);
  });
});

describe("素材による操作", () => {
  it("目覚めの粉（白→青・負荷+5）・開眼の結晶（青→黄・負荷+10）：レアリティと詞の数が変わる", () => {
    const it0 = gen("normal", 7);
    const purse = rich();
    const rng = createRng(1);
    expect(eyeOpen(it0, baseOf(it0), CRAFT_DATA, purse, rng).reason).toBe("rarity");
    expect(awaken(it0, baseOf(it0), CRAFT_DATA, purse, rng).ok).toBe(true);
    expect(it0.rarity).toBe("magic");
    expect(it0.affixes.length).toBeGreaterThanOrEqual(1);
    expect(it0.affixes.length).toBeLessThanOrEqual(2);
    expect(it0.strain).toBe(5);
    const kept = it0.affixes.map((a) => a.id);
    expect(awaken(it0, baseOf(it0), CRAFT_DATA, purse, rng).reason).toBe("rarity");
    expect(eyeOpen(it0, baseOf(it0), CRAFT_DATA, purse, rng).ok).toBe(true);
    expect(it0.rarity).toBe("rare");
    expect(it0.affixes.length).toBeGreaterThanOrEqual(3);
    expect(it0.affixes.length).toBeLessThanOrEqual(6);
    for (const id of kept) expect(it0.affixes.map((a) => a.id)).toContain(id);
    expect(it0.strain).toBe(15);
    expect(1000 - purse.material(MATERIAL.awakeningDust)).toBe(1);
  });
  it("素材が足りなければ使えず、負荷も増えない", () => {
    const it0 = gen("normal", 8);
    const empty = new Purse();
    expect(awaken(it0, baseOf(it0), CRAFT_DATA, empty, createRng(1)).reason).toBe("material");
    expect(it0.strain ?? 0).toBe(0);
    expect(it0.rarity).toBe("normal");
  });
  it("転詞の石：希少の詞を全て抽選し直す（封詞した詞は残る）。負荷+15", () => {
    const it0 = gen("rare", 9);
    const purse = rich();
    const rng = createRng(3);
    const sealedId = it0.affixes[0]?.id ?? "";
    const sealedRolls = [...(it0.affixes[0]?.rolls ?? [])];
    expect(seal(it0, 0, CRAFT_DATA, purse, rng).ok).toBe(true);
    const count = it0.affixes.length;
    const before = it0.strain ?? 0;
    expect(reroll(it0, baseOf(it0), CRAFT_DATA, purse, rng).ok).toBe(true);
    expect(it0.strain).toBe(before + 15);
    expect(it0.affixes.length).toBeLessThanOrEqual(count);
    const kept = it0.affixes.find((a) => a.id === sealedId);
    expect(kept?.rolls).toEqual(sealedRolls);
    // 封印は1回の操作で外れる
    expect(it0.affixes.every((a) => a.sealed !== true)).toBe(true);
    const white = gen("magic", 10);
    expect(reroll(white, baseOf(white), CRAFT_DATA, purse, rng).reason).toBe("rarity");
  });
  it("調律の音叉：選んだ詞の数値を、同じtierの範囲内で抽選し直す（tierは変わらない）。負荷+5", () => {
    const it0 = gen("rare", 11);
    const purse = rich();
    const rng = createRng(4);
    const idx = it0.affixes.findIndex(
      (a) => GENERATION_DATA.affixes.find((d) => d.id === a.id)?.added !== true,
    );
    const a = it0.affixes[idx];
    if (!a) throw new Error("affix");
    const tier = a.tier;
    const seen = new Set<number>();
    for (let i = 0; i < 40; i++) {
      it0.strain = 0;
      expect(tune(it0, idx, CRAFT_DATA, purse, rng).ok).toBe(true);
      expect(a.tier).toBe(tier);
      seen.add(a.rolls[0] ?? 0);
    }
    expect(it0.strain).toBe(5);
    expect(tune(it0, 99, CRAFT_DATA, purse, rng).reason).toBe("noAffix");
    const def = GENERATION_DATA.affixes.find((d) => d.id === a.id);
    expect(def).toBeDefined();
  });
  it("削詞の刃：詞をランダムに1つ消す。封印した詞は消えない。負荷+10", () => {
    const it0 = gen("rare", 12);
    const purse = rich();
    const rng = createRng(5);
    const count = it0.affixes.length;
    const first = it0.affixes[0]?.id;
    seal(it0, 0, CRAFT_DATA, purse, rng);
    it0.strain = 0;
    for (let i = 0; i < 1; i++) expect(carve(it0, CRAFT_DATA, purse, rng).ok).toBe(true);
    expect(it0.affixes).toHaveLength(count - 1);
    expect(it0.affixes.map((a) => a.id)).toContain(first);
    expect(it0.strain).toBe(10);
  });
  it("封詞の蝋：負荷+5。2個目以降は負荷+15（合計+20）。同じ詞は二重に封印できない", () => {
    const it0 = gen("rare", 13);
    const purse = rich();
    const rng = createRng(6);
    expect(seal(it0, 0, CRAFT_DATA, purse, rng).ok).toBe(true);
    expect(it0.strain).toBe(5);
    expect(seal(it0, 0, CRAFT_DATA, purse, rng).reason).toBe("alreadySealed");
    expect(seal(it0, 1, CRAFT_DATA, purse, rng).ok).toBe(true);
    expect(it0.strain).toBe(5 + 20);
  });
});

describe("鍛造負荷・亀裂・霊感・定着（T13）", () => {
  it("負荷が100を超える操作はできない（定着）。定着しても強化はできる", () => {
    const it0 = gen("rare", 14);
    it0.strain = 90;
    const purse = rich();
    const rng = createRng(7);
    expect(reroll(it0, baseOf(it0), CRAFT_DATA, purse, rng).reason).toBe("settled");
    expect(it0.strain).toBe(90);
    expect(purse.material(MATERIAL.turnStone)).toBe(1000);
    // ちょうど100になる操作はできる
    it0.strain = 85;
    expect(reroll(it0, baseOf(it0), CRAFT_DATA, purse, rng).ok).toBe(true);
    expect(it0.strain).toBe(100);
    // 定着：強化以外ができない
    expect(carve(it0, CRAFT_DATA, purse, rng).reason).toBe("settled");
    expect(seal(it0, 0, CRAFT_DATA, purse, rng).reason).toBe("settled");
    expect(enhance(it0, purse).ok).toBe(true);
    expect(it0.strain).toBe(100);
  });
  it("負荷60以上の操作は、20%で亀裂（小さなマイナスの詞）、10%で霊感（tier+1）。60未満では起きない", () => {
    let cracks = 0;
    let inspirations = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const it0 = gen("rare", 1000 + i, 30);
      it0.strain = 60;
      const purse = rich();
      const r = tune(
        it0,
        it0.affixes.findIndex(
          (a) => GENERATION_DATA.affixes.find((d) => d.id === a.id)?.added !== true,
        ),
        CRAFT_DATA,
        purse,
        createRng(`t${String(i)}`),
      );
      if (!r.ok) continue;
      if (r.events.some((e) => e.type === "crack")) cracks++;
      if (r.events.some((e) => e.type === "inspiration")) inspirations++;
    }
    expect(cracks / N).toBeGreaterThan(CRACK_CHANCE - 0.03);
    expect(cracks / N).toBeLessThan(CRACK_CHANCE + 0.03);
    expect(inspirations / N).toBeGreaterThan(0.07);
    expect(inspirations / N).toBeLessThan(0.13);
    for (let i = 0; i < 300; i++) {
      const it0 = gen("rare", 5000 + i);
      it0.strain = RISK_STRAIN - 6;
      const r = tune(it0, 0, CRAFT_DATA, rich(), createRng(i));
      expect(r.events).toEqual([]);
    }
  });
  it("亀裂は能力値にマイナスとして反映され、繕いの糸で消せる（負荷+10）", () => {
    const it0: ItemInstance = {
      uid: "x",
      baseId: "BASE-ARM-LIGHT-FEET-T1",
      rarity: "rare",
      ilvl: 10,
      affixes: [],
      enhance: 0,
      strain: 60,
      fractures: [{ id: "AFX-CRK-MOVE", tier: 7, rolls: [-3] }],
    };
    const eq = new Equipment();
    eq.equip(it0, GEAR_DATA);
    expect(computeGear(eq, GEAR_DATA, { 迅: 99 }).totals["移動速度"]).toBeCloseTo(-0.03);
    const purse = rich();
    expect(mend(it0, CRAFT_DATA, purse, createRng(1)).ok).toBe(true);
    expect(it0.fractures).toEqual([]);
    expect(it0.strain).toBe(70);
    expect(mend(it0, CRAFT_DATA, purse, createRng(1)).reason).toBe("noCrack");
  });
  it("ランダムな操作の列でも、負荷は100を超えず、装備は消えず、封詞した詞は次の操作で残る", () => {
    const ops = fc.array(fc.integer({ min: 0, max: 7 }), { minLength: 1, maxLength: 40 });
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100000 }), ops, (seed, list) => {
        const it0 = gen(seed % 2 === 0 ? "normal" : "rare", seed, 20);
        const purse = rich();
        const rng = createRng(seed);
        let sealedBefore: { id: string; rolls: number[] } | undefined;
        for (const op of list) {
          const base = baseOf(it0);
          const wasSealed = it0.affixes.find((a) => a.sealed === true);
          sealedBefore = wasSealed ? { id: wasSealed.id, rolls: [...wasSealed.rolls] } : undefined;
          let r;
          switch (op) {
            case 0:
              r = awaken(it0, base, CRAFT_DATA, purse, rng);
              break;
            case 1:
              r = eyeOpen(it0, base, CRAFT_DATA, purse, rng);
              break;
            case 2:
              r = reroll(it0, base, CRAFT_DATA, purse, rng);
              break;
            case 3:
              r = tune(it0, rng.int(0, 5), CRAFT_DATA, purse, rng);
              break;
            case 4:
              r = carve(it0, CRAFT_DATA, purse, rng);
              break;
            case 5:
              r = seal(it0, rng.int(0, 5), CRAFT_DATA, purse, rng);
              break;
            case 6:
              r = mend(it0, CRAFT_DATA, purse, rng);
              break;
            default:
              r = enhance(it0, purse);
          }
          expect(it0.strain ?? 0).toBeLessThanOrEqual(MAX_STRAIN);
          expect(it0.baseId).toBeTruthy();
          // 封詞した詞は、次の操作（reroll・carve・tune）の後も残る
          if (sealedBefore && r.ok && (op === 2 || op === 4 || op === 3)) {
            const still = it0.affixes.find((a) => a.id === sealedBefore?.id);
            expect(still?.rolls).toEqual(sealedBefore.rolls);
          }
          expect(it0.affixes.length).toBeLessThanOrEqual(6);
          expect(new Set(it0.affixes.map((a) => a.id)).size).toBe(it0.affixes.length);
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe("セーブ", () => {
  it("負荷・亀裂・銘・封印・封詞の使用回数が、保存して読み込んでも残る", async () => {
    const {
      MemoryStorage,
      SaveManager,
      newSave,
      toSave,
      createStandardJobs,
      newGameState,
      fromSave,
    } = await import("@stella/core");
    const state = newGameState(createStandardJobs(), "T", "JOB-WARRIOR");
    const it0 = gen("rare", 21);
    it0.strain = 75;
    it0.enhance = 10;
    it0.inscription = "INS-BREAK";
    it0.fractures = [{ id: "AFX-CRK-MOVE", tier: 7, rolls: [-3] }];
    it0.sealsUsed = 2;
    if (it0.affixes[0]) it0.affixes[0].sealed = true;
    state.bag.add(it0);
    const mgr = new SaveManager(new MemoryStorage());
    await mgr.save(1, toSave(state));
    const res = await mgr.load(1);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const loaded = fromSave(res.data, createStandardJobs(), GEAR_DATA).bag.items()[0];
    expect(loaded).toEqual(it0);
    expect(newSave({ name: "A", originJob: "JOB-WARRIOR" }).saveVersion).toBeGreaterThan(0);
  });
});
