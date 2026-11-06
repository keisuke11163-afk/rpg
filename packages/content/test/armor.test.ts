/**
 * 防具・盾・アクセサリーのベース（U-11 の残り、仕様書v0.2 3.1〜3.4、補助仕様書14章）と、
 * 受ける側の能力値（防具値・回避値・魔障・耐性・受けるダメージ・崩し値・移動速度）。
 */
import {
  ARMOR_SLOTS,
  Character,
  type ContentDb,
  Equipment,
  type ItemInstance,
  type JobDef,
  TagIndex,
  JOB_AFFIX_BOOST,
  buildCharacterSheet,
  candidateAffixes,
  slotsFor,
} from "@stella/core";
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../src/index.ts";

const db: ContentDb = loadGameContent();
const tags = new TagIndex(db.tags);
const job = (id: string): JobDef => {
  const j = db.jobs.get(id);
  if (j === undefined) throw new Error(`${id} がない`);
  return j;
};
const WARRIOR = job("JOB-WARRIOR");
const item = (uid: string, base: string, enhance = 0): ItemInstance => ({
  uid,
  base,
  rarity: "normal",
  itemLevel: 1,
  affixes: [],
  ...(enhance > 0 ? { enhance } : {}),
});

function sheetWith(ids: readonly string[], level = 15, enhance = 0) {
  const equipment = new Equipment(db);
  ids.forEach((id, i) => {
    const base = db.itemBases.get(id);
    if (base === undefined) throw new Error(`${id} がない`);
    const slot = slotsFor(base, true).find((s) => equipment.get(s) === undefined);
    if (slot === undefined) throw new Error(`${id} の部位が空いていない`);
    equipment.equip(item(`itm_${String(i)}`, id, enhance), slot, true);
  });
  return buildCharacterSheet(db, tags, {
    character: new Character({ origin: WARRIOR, level }),
    job: WARRIOR,
    equipment,
  });
}

const parts = (mat: string) => ARMOR_SLOTS.map((p) => `BASE-ARM-${mat}-${p.toUpperCase()}-T1`);

describe("MVPのベース（補助仕様書14章）", () => {
  it("防具3種類×5部位・小盾・大盾・アクセサリー（銀の指輪・紅玉の指輪・琥珀の首飾り）", () => {
    for (const mat of ["IRON", "LEATHER", "LINEN"])
      for (const id of parts(mat)) expect(db.itemBases.has(id), id).toBe(true);
    expect(db.itemBases.get("BASE-ARM-IRON-BODY-T1")?.defense).toEqual({
      type: "heavy",
      armor: 40,
    });
    expect(db.itemBases.get("BASE-ARM-LEATHER-BODY-T1")?.defense).toEqual({
      type: "light",
      evasion: 40,
    });
    expect(db.itemBases.get("BASE-ARM-LINEN-BODY-T1")?.defense).toEqual({ type: "robe", ward: 15 });
    expect(db.itemBases.get("BASE-SHD-BUCKLER-T1")?.shield?.guard).toBe(0.5);
    expect(db.itemBases.get("BASE-SHD-TOWER-T1")?.shield?.guard).toBe(0.7);
    for (const id of ["BASE-ACC-SILVER-RING-T1", "BASE-ACC-RUBY-RING-T1", "BASE-ACC-AMBER-NECK-T1"])
      expect(db.itemBases.get(id)?.requirement).toBeUndefined();
    // 防具の要求値は10（補助仕様書14章）
    expect(db.itemBases.get("BASE-ARM-IRON-HEAD-T1")?.requirement).toEqual({
      attribute: "go",
      value: 10,
    });
  });
});

describe("受ける側の能力値", () => {
  it("防具の防具値・回避値・魔障が能力値に入り、強化（+5%／段階）が掛かる", () => {
    const base = sheetWith([]);
    expect(sheetWith(["BASE-ARM-IRON-BODY-T1"]).defense.armor).toBeCloseTo(base.defense.armor + 40);
    expect(sheetWith(["BASE-ARM-IRON-BODY-T1"], 15, 10).defense.armor).toBeCloseTo(
      base.defense.armor + 60,
    );
    expect(sheetWith(["BASE-ARM-LEATHER-BODY-T1"]).defense.evasion).toBeGreaterThan(
      base.defense.evasion,
    );
  });

  it("要求値を満たさないと、防具の基礎性能が-40%", () => {
    // 戦士の Lv1 は剛が足りる。理（法衣）は足りない
    const robe = sheetWith(["BASE-ARM-LINEN-BODY-T1"], 1);
    expect(robe.attributes.ri).toBeLessThan(10);
    expect(robe.defense.maxWard).toBeCloseTo(15 * 0.6);
  });

  it("統一ボーナス：重装4部位で受ける崩し値-30%、法衣4部位で魔障の回復が1秒早い、3部位では無い", () => {
    expect(sheetWith(parts("IRON").slice(0, 4)).uniform).toBe("heavy");
    expect(sheetWith(parts("IRON").slice(0, 4)).defense.staggerTaken).toBeCloseTo(0.7);
    expect(sheetWith(parts("IRON").slice(0, 3)).uniform).toBeUndefined();
    expect(sheetWith(parts("IRON").slice(0, 3)).defense.staggerTaken).toBe(1);
    const robe = sheetWith(parts("LINEN"));
    expect(robe.uniform).toBe("robe");
    expect(robe.defense.wardRechargeDelay).toBe(1);
    expect(sheetWith([]).defense.wardRechargeDelay).toBe(2);
    expect(sheetWith(parts("LEATHER")).uniform).toBe("light");
  });

  it("アクセサリー・盾・帯の基本刻印", () => {
    const base = sheetWith([]);
    const silver = sheetWith(["BASE-ACC-SILVER-RING-T1"]);
    expect(silver.defense.resist.fire - base.defense.resist.fire).toBeCloseTo(0.05);
    expect(silver.defense.resist.holy - base.defense.resist.holy).toBeCloseTo(0.05);
    expect(silver.defense.resist.physical).toBe(base.defense.resist.physical);
    const amber = sheetWith(["BASE-ACC-AMBER-NECK-T1"]);
    expect(amber.attributes.go - base.attributes.go).toBe(8);
    expect(amber.attributes.kon - base.attributes.kon).toBe(8);
    expect(sheetWith(["BASE-SHD-TOWER-T1"]).moveSpeed).toBeCloseTo(0.95);
    const chain = sheetWith(["BASE-ARM-IRON-BELT-T1"]);
    expect(chain.moveSpeed).toBeCloseTo(0.98);
    expect(chain.defense.armor).toBeCloseTo((base.defense.armor + 8) * 1.15);
  });
});

describe("詞の追加（U-11 の残り）：職詞・系統詞・一般の詞", () => {
  const base = (id: string) => {
    const b = db.itemBases.get(id);
    if (b === undefined) throw new Error(`${id} がない`);
    return b;
  };
  const weightOf = (pool: ReturnType<typeof candidateAffixes>, id: string): number | undefined =>
    pool.find((c) => c.affix.id === id)?.weight;

  it("MVPの詞は30種類前後（一般29・職詞2・系統詞1）", () => {
    expect(db.affixes.size).toBeGreaterThanOrEqual(30);
    expect([...db.affixes.values()].filter((a) => a.job !== undefined)).toHaveLength(2);
    expect([...db.affixes.values()].filter((a) => a.family !== undefined)).toHaveLength(1);
  });

  it("系統詞【獣狩りの】は、獣の敵のドロップにだけ付く", () => {
    const boots = base("BASE-ARM-LEATHER-FEET-T1");
    expect(weightOf(candidateAffixes(db, boots, 5), "AFX-SUF-BEAST-HUNTER")).toBeUndefined();
    const beast = tags.closure(["TAG-FAMILY-BEAST"]);
    expect(
      weightOf(candidateAffixes(db, boots, 5, { families: beast }), "AFX-SUF-BEAST-HUNTER"),
    ).toBe(50);
  });

  it("職詞は重み25・頭は2倍・ジョブに合わせたドロップでは、そのジョブの職詞が4倍", () => {
    const helm = base("BASE-ARM-IRON-HEAD-T1");
    const body = base("BASE-ARM-IRON-BODY-T1");
    expect(weightOf(candidateAffixes(db, body, 5), "AFX-PRE-JOB-WARRIOR")).toBe(25);
    expect(weightOf(candidateAffixes(db, helm, 5), "AFX-PRE-JOB-WARRIOR")).toBe(50);
    const targeted = candidateAffixes(db, body, 5, { targetJob: "TAG-JOB-WARRIOR" });
    expect(weightOf(targeted, "AFX-PRE-JOB-WARRIOR")).toBe(25 * JOB_AFFIX_BOOST);
    expect(weightOf(targeted, "AFX-PRE-JOB-ROGUE")).toBe(25);
  });

  it("職詞は、そのジョブがメインジョブのときだけ効く", () => {
    const equipment = new Equipment(db);
    equipment.equip(
      {
        uid: "h",
        base: "BASE-ARM-IRON-HEAD-T1",
        rarity: "magic",
        itemLevel: 5,
        affixes: [{ id: "AFX-PRE-JOB-WARRIOR", tier: 7, rolls: [15] }],
      },
      "head",
      true,
    );
    const gain = (origin: JobDef) =>
      buildCharacterSheet(db, tags, {
        character: new Character({ origin, level: 5 }),
        job: origin,
        equipment,
      }).evaluated.view.stat("STAT-GAUGE-GAIN").increased;
    expect(gain(WARRIOR)).toBeCloseTo(0.15);
    expect(gain(job("JOB-ROGUE"))).toBe(0);
  });

  it("短剣は背面からの会心率+5%、爪はヒットでHP吸収0.5%（どちらもその武器のヒットだけ）", () => {
    expect(base("BASE-WPN-DAGGER-T1").implicitEffects).toEqual(["EFF-IMP-BACKSTAB-CRIT-5"]);
    expect(base("BASE-WPN-CLAW-T1").implicitEffects).toEqual(["EFF-IMP-LIFE-LEECH-05"]);
    expect(db.effects.get("EFF-IMP-BACKSTAB-CRIT-5")?.locality).toBe("local");
    expect(db.effects.get("EFF-IMP-LIFE-LEECH-05")?.locality).toBe("local");
  });
});
