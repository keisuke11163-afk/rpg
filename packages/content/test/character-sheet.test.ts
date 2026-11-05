/**
 * キャラクターの能力値（U-12）：戦闘の計算と、キャラクターの画面の表示が、同じ1つの計算の結果を使うこと。
 * 「着替えると、表示の数値と戦闘の数値が一致する」（MVP実装単位 U-12 の完了の条件）を確かめる。
 */
import {
  Character,
  type ContentDb,
  Equipment,
  type ItemInstance,
  type JobDef,
  Rng,
  TagIndex,
  UNARMED_WEAPON_TAG,
  UNMET_REQUIREMENT_MULTIPLIER,
  buildCharacterSheet,
  computeHit,
  damagePreview,
  sheetRows,
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
const ROGUE = job("JOB-ROGUE");
const BASIC = { tags: ["TAG-FORM-MELEE"], kind: "weapon", pct: 1 } as const;

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

function sheetOf(origin: JobDef, equipment?: Equipment) {
  const character = new Character({ origin, level: 5 });
  return buildCharacterSheet(db, tags, {
    character,
    job: origin,
    ...(equipment === undefined ? {} : { equipment }),
  });
}

describe("キャラクターの能力値（U-12）", () => {
  it("素手：武器なし・素手のタグ・適性A・攻撃速度は素手の値", () => {
    const s = sheetOf(WARRIOR);
    expect(s.weapon).toBeUndefined();
    expect(s.attacker.weapon).toBeUndefined();
    expect(s.weaponTags).toEqual([UNARMED_WEAPON_TAG]);
    expect(s.affinity).toBe("A");
    // 素手の攻撃速度1 ×（1＋迅の攻撃速度の増加）
    const inc = sheetRows(db, s, ["STAT-ATTACK-SPEED"])[0]?.result.increased ?? NaN;
    expect(s.attackSpeed).toBeCloseTo(1 + inc, 12);
  });

  it("装備の基本刻印と詞が、能力値の行と内訳（出どころは装備の uid）に出る", () => {
    const eq = new Equipment(db);
    eq.equip(
      item("sword", "BASE-WPN-LONGSWORD-T1", [
        { id: "AFX-SUF-ATTACK-SPEED", tier: 7, rolls: [4] },
        { id: "AFX-PRE-INC-PHYSICAL-WPN", tier: 7, rolls: [10] },
      ]),
      "mainHand",
      true,
    );
    const bare = sheetOf(WARRIOR);
    const s = sheetOf(WARRIOR, eq);
    const rows = new Map(sheetRows(db, s).map((r) => [r.stat, r]));
    const accuracy = rows.get("STAT-ACCURACY");
    const bareAccuracy = sheetRows(db, bare).find((r) => r.stat === "STAT-ACCURACY");
    // 長剣の基本刻印：命中+40
    expect(accuracy?.value).toBe((bareAccuracy?.value ?? 0) + 40);
    expect(
      accuracy?.breakdown.some(
        (b) =>
          b.sourceKind === "equipment" &&
          b.sourceRef === "sword" &&
          JSON.stringify(b.value) === JSON.stringify({ min: 40, max: 40 }),
      ),
    ).toBe(true);
    // 攻撃速度の詞+4%：戦闘の攻撃速度 ＝ 武器の基礎 ×（1＋攻撃速度の増加＋適性の補正）。表示の行の加算と一致する
    const speed = rows.get("STAT-ATTACK-SPEED");
    const bareSpeed = sheetRows(db, bare, ["STAT-ATTACK-SPEED"])[0]?.result.increased ?? NaN;
    expect(speed?.result.increased).toBeCloseTo(bareSpeed + 0.04, 12);
    // 戦士の剣の適性はA（攻撃速度の補正なし）
    expect(s.affinity).toBe("A");
    expect(s.attackSpeed).toBeCloseTo(1.4 * (1 + bareSpeed + 0.04), 12);
  });

  it("局所の効果（武器の物理ダメージ増加）は、内訳で局所として示す", () => {
    const eq = new Equipment(db);
    eq.equip(
      item("sword", "BASE-WPN-LONGSWORD-T1", [
        { id: "AFX-PRE-INC-PHYSICAL-WPN", tier: 7, rolls: [10] },
      ]),
      "mainHand",
      true,
    );
    const s = sheetOf(WARRIOR, eq);
    const [row] = sheetRows(db, s, [{ stat: "STAT-DAMAGE", tags: ["TAG-ELEM-PHYSICAL"] }]);
    const line = row?.breakdown.find((b) => b.sourceRef === "sword");
    expect(line?.local).toBe(true);
  });

  it("着替えると、表示の数値（ダメージの見積もり）と戦闘の数値（ヒットの計算）が一致する", () => {
    const eq = new Equipment(db);
    const check = (): void => {
      const s = sheetOf(WARRIOR, eq);
      const preview = damagePreview(s, BASIC, Rng.fromSeed("p"));
      // 戦闘：同じ攻撃する側でヒットを計算する（平均の値・会心でない）
      const hit = computeHit(
        s.attacker,
        BASIC,
        { resist: {}, armor: 0, evasion: 0 },
        { rng: Rng.fromSeed("c"), roll: "average" },
      );
      expect(hit.preMitigationTotal).toBeCloseTo(preview.average, 9);
      expect(hit.critChance).toBeCloseTo(preview.critChance, 12);
      // 戦闘のHP・MPは、表示の行の値と同じ
      const rows = new Map(sheetRows(db, s).map((r) => [r.stat, r.value]));
      expect(s.maxHp).toBe(rows.get("STAT-HP-MAX"));
      expect(s.maxMp).toBe(rows.get("STAT-MP-MAX"));
    };
    check();
    eq.equip(item("gs", "BASE-WPN-GREATSWORD-T1"), "mainHand", true);
    check();
    const gs = damagePreview(sheetOf(WARRIOR, eq), BASIC, Rng.fromSeed("p")).average;
    eq.equip(
      item("sword", "BASE-WPN-LONGSWORD-T1", [
        { id: "AFX-PRE-ADDED-PHYSICAL-WPN", tier: 7, rolls: [2, 4] },
        { id: "AFX-PRE-INC-PHYSICAL-WPN", tier: 7, rolls: [10] },
        { id: "AFX-SUF-CRIT-CHANCE", tier: 7, rolls: [12] },
      ]),
      "mainHand",
      true,
    );
    check();
    const sword = damagePreview(sheetOf(WARRIOR, eq), BASIC, Rng.fromSeed("p"));
    expect(sword.average).not.toBeCloseTo(gs, 3);
    // 会心率の詞（増加12%）：長剣の基本の会心率5% ×（1＋0.12）
    expect(sword.critChance).toBeCloseTo(0.05 * 1.12, 12);
  });

  it("要求値を満たさない武器は、基礎ダメージだけ-40%（会心率・攻撃速度は変わらない）", () => {
    const eq = new Equipment(db);
    eq.equip(item("gs", "BASE-WPN-GREATSWORD-T1"), "mainHand", true);
    const strong = sheetOf(WARRIOR, eq); // 剛20 ≥ 18
    const weak = sheetOf(ROGUE, eq); // 剛10 < 18
    expect(strong.weapon?.requirementMet).toBe(true);
    expect(weak.weapon?.requirementMet).toBe(false);
    expect(weak.attacker.weapon?.base.physical?.min).toBeCloseTo(
      14 * UNMET_REQUIREMENT_MULTIPLIER,
      12,
    );
    expect(weak.attacker.weapon?.critChance).toBe(strong.attacker.weapon?.critChance);
    expect(weak.weapon?.baseAttackSpeed).toBe(strong.weapon?.baseAttackSpeed);
  });

  it("同じ入力なら、何度計算しても同じ（装備の順序に依らない）", () => {
    const a = new Equipment(db);
    const b = new Equipment(db);
    const sword = item("s", "BASE-WPN-AXE-T1", [
      { id: "AFX-SUF-ATTACK-SPEED", tier: 7, rolls: [3] },
    ]);
    const axe = item("a", "BASE-WPN-AXE-T1");
    a.equip(sword, "mainHand", true);
    a.equip(axe, "offHand", true);
    b.equip(axe, "offHand", true);
    b.equip(sword, "mainHand", true);
    const ra = sheetRows(db, sheetOf(WARRIOR, a)).map((r) => [r.stat, r.value]);
    const rb = sheetRows(db, sheetOf(WARRIOR, b)).map((r) => [r.stat, r.value]);
    expect(ra).toEqual(rb);
  });
});
