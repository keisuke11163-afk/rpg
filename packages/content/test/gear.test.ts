import {
  Equipment,
  ItemBag,
  Merchant,
  Purse,
  WEAPONS,
  compareTotals,
  computeGear,
  createFighter,
  createRng,
  describeItem,
  ROGUE_JOB,
  WARRIOR_JOB,
  withGearStats,
  type ItemInstance,
  type RolledAffix,
} from "@stella/core";
import { describe, expect, it } from "vitest";
import { GENERATION_DATA, GEAR_DATA } from "../src/index.ts";

let n = 0;
const item = (
  baseId: string,
  affixes: RolledAffix[] = [],
  rarity: ItemInstance["rarity"] = "rare",
  ilvl = 10,
): ItemInstance => ({
  uid: `g_${String(n++)}`,
  baseId,
  rarity,
  ilvl,
  affixes,
  enhance: 0,
});
const stats = { 剛: 20, 迅: 10, 理: 5, 魂: 5 };

describe("装備の着脱", () => {
  it("部位が違うと装備できない。指輪は2つ", () => {
    const eq = new Equipment();
    expect(eq.equip(item("BASE-ARM-HEAVY-HEAD-T1"), GEAR_DATA, { slot: "胴" }).ok).toBe(false);
    const a = eq.equip(item("BASE-ACC-RING-SILVER-T1"), GEAR_DATA);
    const b = eq.equip(item("BASE-ACC-RING-RUBY-T1"), GEAR_DATA);
    expect([a.slot, b.slot]).toEqual(["指輪1", "指輪2"]);
    const c = eq.equip(item("BASE-ACC-RING-SILVER-T1"), GEAR_DATA);
    expect(c.replaced).toHaveLength(1);
  });
  it("両手武器は副手を空ける。両手武器の間は副手に持てない", () => {
    const eq = new Equipment();
    eq.equip(item("BASE-SHD-SMALL-T1"), GEAR_DATA);
    expect(eq.get("副手")).toBeDefined();
    const r = eq.equip(item("BASE-WPN-GREATSWORD-T1"), GEAR_DATA);
    expect(r.replaced).toHaveLength(1);
    expect(eq.get("副手")).toBeUndefined();
    expect(eq.equip(item("BASE-SHD-SMALL-T1"), GEAR_DATA).reason).toBe("twoHanded");
  });
  it("副手の片手武器（二刀流）は、二刀流のできるジョブだけ", () => {
    const eq = new Equipment();
    eq.equip(item("BASE-WPN-LONGSWORD-T1"), GEAR_DATA);
    expect(eq.equip(item("BASE-WPN-DAGGER-T1"), GEAR_DATA, { slot: "副手" }).ok).toBe(false);
    const r = eq.equip(item("BASE-WPN-DAGGER-T1"), GEAR_DATA, { canDualWield: true });
    expect(r.ok).toBe(true);
    expect(r.slot).toBe("副手");
  });
  it("外すと、その装備が戻る", () => {
    const eq = new Equipment();
    const w = item("BASE-WPN-LONGSWORD-T1");
    eq.equip(w, GEAR_DATA);
    expect(eq.unequip("主手")?.uid).toBe(w.uid);
    expect(eq.get("主手")).toBeUndefined();
  });
});

describe("能力値の計算", () => {
  it("武器：詞の追加ダメージは局所（その武器だけ）。増加%・攻撃速度・会心率が集計される", () => {
    const eq = new Equipment();
    eq.equip(
      item("BASE-WPN-LONGSWORD-T1", [
        { id: "AFX-PRE-ADDED-PHYS-WPN", tier: 7, rolls: [2, 3] },
        { id: "AFX-PRE-ADDED-FIRE-WPN", tier: 7, rolls: [1, 4] },
        { id: "AFX-PRE-PHYS-INC-WPN", tier: 7, rolls: [15] },
        { id: "AFX-SUF-ATKSPD", tier: 7, rolls: [4] },
      ]),
      GEAR_DATA,
    );
    eq.equip(
      item("BASE-ACC-RING-SILVER-T1", [{ id: "AFX-SUF-ATKSPD", tier: 7, rolls: [3] }]),
      GEAR_DATA,
    );
    const g = computeGear(eq, GEAR_DATA, stats);
    expect(g.weapon?.addedPhysical).toEqual({ min: 2, max: 3 });
    expect(g.weapon?.addedFire).toEqual({ min: 1, max: 4 });
    expect(g.totals["物理ダメージ増加%"]).toBeCloseTo(0.15);
    expect(g.totals["攻撃速度"]).toBeCloseTo(0.07);
    expect(g.totals["命中"]).toBe(40);
    expect(g.totals["全属性耐性"]).toBeCloseTo(0.05);
    expect(g.breakdown.some((b) => b.stat === "攻撃速度" && b.slot === "指輪1")).toBe(true);
  });
  it("防具：防具値・回避値・魔障を合計。重鎖の帯は防具値+15%", () => {
    const eq = new Equipment();
    eq.equip(item("BASE-ARM-HEAVY-BODY-T1"), GEAR_DATA);
    eq.equip(item("BASE-ARM-HEAVY-HEAD-T1"), GEAR_DATA);
    eq.equip(item("BASE-ARM-ROBE-HANDS-T1"), GEAR_DATA);
    let g = computeGear(eq, GEAR_DATA, { ...stats, 理: 99 });
    expect(g.armor).toBe(40 + 24);
    expect(g.barrier).toBe(6);
    eq.equip(item("BASE-ACC-BELT-CHAIN-T1"), GEAR_DATA);
    g = computeGear(eq, GEAR_DATA, { ...stats, 理: 99 });
    expect(g.armor).toBeCloseTo(64 * 1.15);
    expect(g.totals["移動速度"]).toBeCloseTo(-0.02);
  });
  it("要求値の未達で、基礎性能が-40%（詞・基本刻印は下がらない）", () => {
    const eq = new Equipment();
    eq.equip(item("BASE-WPN-GREATSWORD-T1"), GEAR_DATA);
    const ok = computeGear(eq, GEAR_DATA, { ...stats, 剛: 18 });
    const low = computeGear(eq, GEAR_DATA, { ...stats, 剛: 17 });
    expect(ok.penalized).toEqual([]);
    expect(low.penalized).toEqual(["主手"]);
    expect(low.weapon?.min).toBeCloseTo(14 * 0.6);
    expect(low.weapon?.max).toBeCloseTo(24 * 0.6);
    expect(low.weapon?.speed).toBe(1.05);
    expect(low.totals["崩し値"]).toBeCloseTo(0.15);
  });
  it("全能力値+8（琥珀の首飾り）。装備の能力値は、要求値の判定には含めない", () => {
    const eq = new Equipment();
    eq.equip(item("BASE-ACC-NECK-AMBER-T1"), GEAR_DATA);
    const g = computeGear(eq, GEAR_DATA, stats);
    expect(withGearStats(stats, g)).toEqual({ 剛: 28, 迅: 18, 理: 13, 魂: 13 });
  });
  it("着替えの比較", () => {
    const a = new Equipment();
    const b = new Equipment();
    a.equip(item("BASE-WPN-LONGSWORD-T1"), GEAR_DATA);
    b.equip(
      item("BASE-WPN-LONGSWORD-T1", [{ id: "AFX-SUF-ATKSPD", tier: 7, rolls: [4] }]),
      GEAR_DATA,
    );
    const diff = compareTotals(
      computeGear(a, GEAR_DATA, stats).totals,
      computeGear(b, GEAR_DATA, stats).totals,
    );
    expect(diff).toEqual([{ stat: "攻撃速度", from: 0, to: 0.04 }]);
  });
});

describe("着替えると、表示の数値と戦闘の数値が一致する（U-12 の完了の条件）", () => {
  const fighterWith = (eq: Equipment): ReturnType<typeof createFighter> => {
    const f = createFighter(WARRIOR_JOB, {
      maxHp: 100,
      maxMp: 100,
      weaponKey: "longsword",
      weaponClass: "longsword",
      jobLevel: 1,
    });
    f.setGear(computeGear(eq, GEAR_DATA, stats));
    return f;
  };
  it("武器のダメージの幅・攻撃速度・最大HPが、装備を替えるたびに反映される", () => {
    const eq = new Equipment();
    eq.equip(item("BASE-WPN-LONGSWORD-T1"), GEAR_DATA);
    const f = fighterWith(eq);
    expect(f.weaponDamageRange().physical).toEqual({ min: 6, max: 11 });
    eq.equip(
      item("BASE-WPN-GREATSWORD-T1", [
        { id: "AFX-PRE-ADDED-PHYS-WPN", tier: 7, rolls: [3, 5] },
        { id: "AFX-SUF-ATKSPD", tier: 7, rolls: [10] },
      ]),
      GEAR_DATA,
    );
    eq.equip(
      item("BASE-ARM-HEAVY-BODY-T1", [{ id: "AFX-PRE-MAXHP", tier: 7, rolls: [15] }]),
      GEAR_DATA,
    );
    f.setGear(computeGear(eq, GEAR_DATA, stats));
    expect(f.weaponDamageRange().physical).toEqual({ min: 14 + 3, max: 24 + 5 });
    expect(f.attackSpeed).toBeCloseTo(1.05 * (1 + 0.1));
    expect(f.maxHp).toBe(115);
  });
  it("実際のヒットのダメージの平均が、表示の幅（最小・最大）の中央と一致する", () => {
    const eq = new Equipment();
    eq.equip(
      item("BASE-WPN-LONGSWORD-T1", [
        { id: "AFX-PRE-ADDED-PHYS-WPN", tier: 7, rolls: [2, 4] },
        { id: "AFX-PRE-PHYS-INC-WPN", tier: 7, rolls: [20] },
      ]),
      GEAR_DATA,
    );
    const f = fighterWith(eq);
    const range = f.weaponDamageRange().physical;
    const eff = f.effective(WARRIOR_JOB.skills[0] as never);
    const rng = createRng("avg");
    let sum = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const spec = f.hitSpec(eff, rng);
      sum += spec.damage.base.physical ?? 0;
      expect(spec.damage.byElement?.physical?.addPct).toBeCloseTo(0.2);
    }
    expect(sum / N).toBeGreaterThan((range.min + range.max) / 2 - 0.1);
    expect(sum / N).toBeLessThan((range.min + range.max) / 2 + 0.1);
  });
  it("要求値の未達は、戦闘のダメージにも反映される", () => {
    const eq = new Equipment();
    eq.equip(item("BASE-WPN-GREATSWORD-T1"), GEAR_DATA);
    const f = createFighter(WARRIOR_JOB, {
      maxHp: 1,
      maxMp: 1,
      weaponKey: "greatsword",
      weaponClass: "greatsword",
      jobLevel: 1,
    });
    f.setGear(computeGear(eq, GEAR_DATA, { 剛: 10 }));
    expect(f.weaponDamageRange().physical.min).toBeCloseTo(14 * 0.6);
  });
  it("盗賊の背面会心率に、短剣の基本刻印（+5%）が加わる", () => {
    const eq = new Equipment();
    eq.equip(item("BASE-WPN-DAGGER-T1"), GEAR_DATA);
    const f = createFighter(ROGUE_JOB, {
      maxHp: 1,
      maxMp: 1,
      weaponKey: "dagger",
      weaponClass: "dagger",
      jobLevel: 1,
    });
    f.setGear(computeGear(eq, GEAR_DATA, { 迅: 20 }));
    const spec = f.hitSpec(f.effective(ROGUE_JOB.skills[0] as never), createRng(1));
    expect(spec.backCritAdd).toBeCloseTo(0.15);
    expect(WEAPONS["dagger"]).toBeDefined();
  });
});

describe("ツールチップ", () => {
  const a: RolledAffix = { id: "AFX-JOB-ROGUE-COMBO", tier: 7, rolls: [1] };
  it("要求値の未達を警告する。職詞は今のジョブで有効か教える", () => {
    const it0 = item("BASE-WPN-GREATSWORD-T1", [a, { id: "AFX-SUF-CRIT", tier: 7, rolls: [12] }]);
    const lines = describeItem(it0, GEAR_DATA, { jobId: "JOB-WARRIOR", stats: { 剛: 10 } });
    expect(lines[0]?.text).toContain("希少の大剣");
    expect(lines.some((l) => l.kind === "warning" && l.text.includes("未達"))).toBe(true);
    expect(lines.some((l) => l.kind === "hint" && l.text.includes("今のジョブでは無効"))).toBe(
      true,
    );
    const ok = describeItem(it0, GEAR_DATA, { jobId: "JOB-ROGUE", stats: { 剛: 99 } });
    expect(ok.some((l) => l.kind === "warning")).toBe(false);
    expect(ok.some((l) => l.text.includes("職詞：JOB-ROGUE"))).toBe(true);
  });
  it("基本刻印・防具値・ユニークの潜在効果は「？？？」", () => {
    const lines = describeItem({ ...item("BASE-ARM-LIGHT-BODY-T1"), uniqueId: "UNQ-X" }, GEAR_DATA);
    expect(lines.some((l) => l.text.includes("回避値 40"))).toBe(true);
    expect(lines.some((l) => l.kind === "latent")).toBe(true);
  });
});

describe("商人", () => {
  it("通常のベースを 10＋4×iLv で買える。金貨が足りない・いっぱいなら買えない", () => {
    const m = new Merchant();
    m.restock(GENERATION_DATA, 5, () => `m_${String(n++)}`, createRng(1));
    expect(m.stock).toHaveLength(8);
    expect(m.stock.every((s) => s.rarity === "normal")).toBe(true);
    const purse = new Purse();
    const bag = new ItemBag();
    const first = m.stock[0] as ItemInstance;
    expect(m.buy(first.uid, bag, purse)).toEqual({ ok: false, reason: "gold" });
    purse.gold = 100;
    expect(m.buy(first.uid, bag, purse).ok).toBe(true);
    expect(purse.gold).toBe(100 - 30);
    expect(bag.count).toBe(1);
    expect(m.buy("none", bag, purse).reason).toBe("none");
  });
  it("装備を売る／目覚めの粉を買う（30G）", () => {
    const m = new Merchant();
    const bag = new ItemBag();
    const purse = new Purse();
    const w = item("BASE-WPN-LONGSWORD-T1", [], "magic", 10);
    bag.add(w);
    expect(m.sell(w.uid, bag, purse)).toEqual({ ok: true, gold: 18 });
    expect(purse.gold).toBe(18);
    expect(m.buyAwakeningDust(purse)).toBe(false);
    purse.gold = 60;
    expect(m.buyAwakeningDust(purse, 2)).toBe(true);
    expect(purse.gold).toBe(0);
    expect(purse.material("MAT-AWAKENING-DUST")).toBe(2);
  });
});
