import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type ContentDb,
  type DamageAttacker,
  type DamagePortion,
  type DamageSkill,
  type EffectInstance,
  CONVERSION_ORDER,
  Rng,
  TagIndex,
  applyConversions,
  armorReduction,
  baseSkillLevel,
  computeHit,
  conversionAllowed,
  evadeChance,
  evaluateEffects,
  expectedHitDamage,
  hitChance,
  spellBaseMultiplier,
  weaponSkillPct,
} from "../src/index.ts";
import { buildDb, combatFixture, effect } from "./helpers/content.ts";

const fixture = combatFixture();
const LONGSWORD = {
  uid: "itm_sword",
  tags: ["TAG-WPN-SWORD"],
  base: { physical: { min: 6, max: 11 } },
  critChance: 0.05,
};
const SCYTHE = {
  uid: "itm_scythe",
  tags: ["TAG-WPN-SCYTHE"],
  base: { physical: { min: 12, max: 21 } },
  critChance: 0.06,
};
const BASIC: DamageSkill = { tags: ["TAG-FORM-MELEE"], kind: "weapon", pct: 1.0 };
const SWEEP: DamageSkill = { tags: ["TAG-FORM-MELEE"], kind: "weapon", pct: 1.3 };
const FIREBALL: DamageSkill = {
  tags: ["TAG-FORM-SPELL"],
  kind: "spell",
  pct: 1.0,
  base: { fire: { min: 12, max: 20 } },
};
const avg = { rng: Rng.fromSeed(1), roll: "average" as const };

function attackerWith(
  db: ContentDb,
  effects: string[],
  extra: Partial<DamageAttacker> = {},
  baseStats: Record<string, number> = {},
): DamageAttacker {
  const instances: EffectInstance[] = effects.map((id) => ({
    effectId: id,
    source: { kind: "test", ref: id },
  }));
  const { view } = evaluateEffects(db, new TagIndex(db.tags), instances, { baseStats });
  return { db, view, characterLevel: 1, weapon: LONGSWORD, ...extra };
}

describe("防御の式（開発計画書 T1・仕様書2.6）", () => {
  it("防具値1,000で200のダメージを受ける → 軽減率33.3%", () => {
    expect(armorReduction(1000, 200)).toBeCloseTo(1 / 3);
  });
  it("防具値による軽減は85%まで。防具値0では軽減しない", () => {
    expect(armorReduction(1e9, 1)).toBe(0.85);
    expect(armorReduction(0, 100)).toBe(0);
  });
  it("回避率 ＝ 回避値 ÷（回避値 ＋ 命中×1.5）。75%まで", () => {
    expect(evadeChance(100, 100)).toBeCloseTo(0.4);
    expect(evadeChance(1e9, 1)).toBe(0.75);
    expect(hitChance(100, 100)).toBeCloseTo(0.6);
    expect(hitChance(0, 0)).toBe(1);
  });
});

describe("技レベル（仕様書v0.2 5.1.1）", () => {
  it("基本の技レベル ＝ 1 ＋ ⌊（キャラLv－1）÷5⌋、上限20", () => {
    expect([1, 5, 6, 11, 20, 96, 100].map(baseSkillLevel)).toEqual([1, 1, 2, 3, 4, 20, 20]);
    expect(() => baseSkillLevel(0)).toThrow(RangeError);
  });
  it("武器の技は技倍率+1%／レベル、呪文は表の倍率", () => {
    expect(weaponSkillPct(1.3, 20)).toBeCloseTo(1.49);
    expect(spellBaseMultiplier(1)).toBe(1);
    expect(spellBaseMultiplier(3)).toBe(1.53);
    expect(spellBaseMultiplier(20)).toBe(17.84);
  });
});

describe("ダメージの式（仕様書v0.2 2.4）", () => {
  const db = buildDb({
    ...fixture,
    effects: [
      effect("EFF-PHYS-30", "minorStar", [
        {
          kind: "increased",
          stat: "STAT-DAMAGE",
          value: 0.3,
          filter: { allOf: ["TAG-ELEM-PHYSICAL"] },
        },
      ]),
      effect("EFF-MELEE-20", "minorStar", [
        {
          kind: "increased",
          stat: "STAT-DAMAGE",
          value: 0.2,
          filter: { allOf: ["TAG-FORM-MELEE"] },
        },
      ]),
      effect("EFF-MORE-12", "unique", [{ kind: "more", stat: "STAT-DAMAGE", value: 1.2 }]),
      effect("EFF-ADD-PHYS", "affix", [
        { kind: "added", stat: "STAT-ADDED-PHYSICAL", value: { min: 2, max: 6 } },
      ]),
      effect("EFF-FIXED", "unique", [
        { kind: "fixedAdded", stat: "STAT-ADDED-PHYSICAL", value: 10 },
      ]),
      effect("EFF-SKILL-LV2", "affix", [{ kind: "added", stat: "STAT-SKILL-LEVEL", value: 2 }]),
    ],
  });

  it("下級の長剣（6–11）の通常攻撃は、平均8.5（Lv1・補正なし）", () => {
    expect(computeHit(attackerWith(db, []), BASIC, {}, avg).total).toBeCloseTo(8.5);
  });

  it("抽選すると最小〜最大の間に収まり、同じシードなら同じ結果", () => {
    const a = attackerWith(db, []);
    for (let i = 0; i < 50; i++) {
      const r = computeHit(a, BASIC, {}, { rng: Rng.fromSeed(i) });
      expect(r.total).toBeGreaterThanOrEqual(6);
      expect(r.total).toBeLessThanOrEqual(11 * 1.5); // 会心を含めた上限
    }
    expect(computeHit(a, BASIC, {}, { rng: Rng.fromSeed(7) })).toEqual(
      computeHit(a, BASIC, {}, { rng: Rng.fromSeed(7) }),
    );
  });

  it("技倍率は（基礎値＋追加値）にかかり、固定の追加にはかからない", () => {
    expect(computeHit(attackerWith(db, ["EFF-ADD-PHYS"]), SWEEP, {}, avg).total).toBeCloseTo(
      (8.5 + 4) * 1.3,
    );
    expect(computeHit(attackerWith(db, ["EFF-FIXED"]), SWEEP, {}, avg).total).toBeCloseTo(
      8.5 * 1.3 + 10,
    );
  });

  it("武器の技は、基本の技レベルで技倍率が伸びる（Lv11 → 技レベル3 → 1.32）", () => {
    const r = computeHit(attackerWith(db, [], { characterLevel: 11 }), SWEEP, {}, avg);
    expect(r.trace.skillPct).toBeCloseTo(1.32);
    expect(r.total).toBeCloseTo(8.5 * 1.32);
  });

  it("加算は足し、乗算は掛ける（物理+30%・近接+20%・×1.2）", () => {
    const r = computeHit(
      attackerWith(db, ["EFF-PHYS-30", "EFF-MELEE-20", "EFF-MORE-12"]),
      BASIC,
      {},
      avg,
    );
    expect(r.total).toBeCloseTo(8.5 * 1.5 * 1.2);
  });

  it("職技レベルの詞は、1につきダメージ+8%（加算）", () => {
    const r = computeHit(attackerWith(db, ["EFF-SKILL-LV2"]), BASIC, {}, avg);
    expect(r.total).toBeCloseTo(8.5 * 1.16);
    expect(r.trace.skillLevel).toBe(3);
  });

  it("呪文は技の基礎値を使い、技レベルの表で伸びる。武器の基礎値は使わない", () => {
    expect(computeHit(attackerWith(db, []), FIREBALL, {}, avg).damage).toEqual({ fire: 16 });
    expect(
      computeHit(attackerWith(db, [], { characterLevel: 11 }), FIREBALL, {}, avg).damage.fire,
    ).toBeCloseTo(16 * 1.53);
  });

  it("敵が受けるダメージの倍率 → 耐性 → 防具値（物理だけ）", () => {
    const a = attackerWith(db, []);
    expect(computeHit(a, BASIC, { takenMultiplier: 1.25 }, avg).total).toBeCloseTo(8.5 * 1.25);
    expect(computeHit(a, FIREBALL, { resist: { fire: 0.5 } }, avg).total).toBeCloseTo(8);
    expect(computeHit(a, FIREBALL, { resist: { fire: -0.2 } }, avg).total).toBeCloseTo(19.2);
    expect(computeHit(a, FIREBALL, { armor: 1000 }, avg).total).toBeCloseTo(16); // 防具値は物理だけ
    const armored = computeHit(a, BASIC, { armor: 85 }, avg).total;
    expect(armored).toBeCloseTo(8.5 * (1 - 85 / (85 + 85)));
  });

  it("ガードは割合で減らす", () => {
    expect(computeHit(attackerWith(db, []), BASIC, { guard: 0.7 }, avg).total).toBeCloseTo(
      8.5 * 0.3,
    );
  });
});

describe("会心と命中（仕様書v0.2 2.4・2.4.1）", () => {
  const db = buildDb({
    ...fixture,
    effects: [
      effect("EFF-CRIT-FLAT", "minorStar", [
        { kind: "added", stat: "STAT-CRIT-CHANCE", value: 0.05 },
      ]),
      effect("EFF-CRIT-INC", "affix", [
        { kind: "increased", stat: "STAT-CRIT-CHANCE", value: 1.0 },
      ]),
      effect("EFF-CRIT-MULTI", "affix", [
        { kind: "added", stat: "STAT-CRIT-MULTIPLIER", value: 0.3 },
      ]),
      effect("EFF-NO-CRIT", "unique", [{ kind: "flag", flag: "crit", mode: "forbid" }]),
      effect("EFF-FORCE-CRIT", "jobSkill", [
        { kind: "flag", flag: "crit", mode: "force", filter: { allOf: ["TAG-FORM-FINISHER"] } },
      ]),
      effect("EFF-ALWAYS-HIT", "unique", [{ kind: "flag", flag: "alwaysHit", mode: "force" }]),
    ],
  });
  const FINISHER: DamageSkill = {
    tags: ["TAG-FORM-MELEE", "TAG-FORM-FINISHER"],
    kind: "weapon",
    pct: 1.0,
  };

  it("会心率 ＝（武器の会心率＋固定値の加算）×（1＋増加%）", () => {
    const r = computeHit(attackerWith(db, ["EFF-CRIT-FLAT", "EFF-CRIT-INC"]), BASIC, {}, avg);
    expect(r.critChance).toBeCloseTo((0.05 + 0.05) * 2);
  });

  it("会心倍率 ＝ 150% ＋ 加算", () => {
    expect(
      computeHit(attackerWith(db, ["EFF-CRIT-MULTI"]), BASIC, {}, avg).critMultiplier,
    ).toBeCloseTo(1.8);
  });

  it("「必ず会心」なら毎回会心し、会心倍率がかかる", () => {
    const a = attackerWith(db, ["EFF-FORCE-CRIT"]);
    for (let i = 0; i < 20; i++) {
      const r = computeHit(a, FINISHER, {}, { rng: Rng.fromSeed(i) });
      expect(r.crit).toBe(true);
    }
  });

  it("禁止は強制に勝つ：目隠し＋急所穿ち → 会心しない", () => {
    const a = attackerWith(db, ["EFF-NO-CRIT", "EFF-FORCE-CRIT", "EFF-CRIT-INC"]);
    for (let i = 0; i < 20; i++)
      expect(computeHit(a, FINISHER, {}, { rng: Rng.fromSeed(i) }).crit).toBe(false);
  });

  it("回避された攻撃は、ダメージも基準値も0", () => {
    const a = attackerWith(db, [], {}, { "STAT-ACCURACY": 0 });
    const r = computeHit(a, BASIC, { evasion: 100 }, { rng: Rng.fromSeed(3) });
    // 命中0 → 回避率は上限の75%。何回か試して、回避された結果を確かめる
    const results = Array.from({ length: 40 }, (_, i) =>
      computeHit(a, BASIC, { evasion: 100 }, { rng: Rng.fromSeed(i) }),
    );
    const evaded = results.filter((x) => x.evaded);
    expect(r.hitChance).toBeCloseTo(0.25);
    expect(evaded.length).toBeGreaterThan(0);
    for (const x of evaded) {
      expect(x.total).toBe(0);
      expect(x.ailmentBase).toEqual({});
    }
  });

  it("呪文と、必中の印を持つ攻撃は回避されない", () => {
    expect(computeHit(attackerWith(db, []), FIREBALL, { evasion: 1e9 }, avg).hitChance).toBe(1);
    expect(
      computeHit(attackerWith(db, ["EFF-ALWAYS-HIT"]), BASIC, { evasion: 1e9 }, avg).hitChance,
    ).toBe(1);
  });

  it("期待値は、会心の期待値と命中率を含む", () => {
    const a = attackerWith(db, ["EFF-CRIT-FLAT"], {}, { "STAT-ACCURACY": 150 });
    const r = computeHit(a, BASIC, { evasion: 100 }, avg);
    const expected = 8.5 * (1 + 0.1 * 0.5) * r.hitChance;
    expect(expectedHitDamage(a, BASIC, { evasion: 100 }, Rng.fromSeed(1))).toBeCloseTo(expected);
  });
});

describe("基準値（仕様書v0.2 2.7・C-03）", () => {
  const db = buildDb({
    ...fixture,
    effects: [
      effect("EFF-PHYS-30", "minorStar", [
        {
          kind: "increased",
          stat: "STAT-DAMAGE",
          value: 0.3,
          filter: { allOf: ["TAG-ELEM-PHYSICAL"] },
        },
      ]),
      // 腐敗の聖杯：打撃値-50%（基準値は変わらない）
      effect("EFF-CHALICE", "keystone", [{ kind: "more", stat: "STAT-DAMAGE", value: 0.5 }], {
        affects: { hit: true, ailmentBase: false },
      }),
      // 千の小傷：打撃値と基準値-40%
      effect("EFF-THOUSAND", "unique", [{ kind: "more", stat: "STAT-DAMAGE", value: 0.6 }], {
        affects: { hit: true, ailmentBase: true },
        locality: "local",
      }),
      effect("EFF-CRIT-ALL", "jobSkill", [{ kind: "flag", flag: "crit", mode: "force" }]),
    ],
  });

  it("基準値は乗算までをかけた値で、会心・敵が受けるダメージの倍率・耐性・防御を含まない", () => {
    const a = attackerWith(db, ["EFF-PHYS-30", "EFF-CRIT-ALL"]);
    const r = computeHit(
      a,
      BASIC,
      { takenMultiplier: 1.25, resist: { physical: 0.3 }, armor: 50 },
      { rng: Rng.fromSeed(2), roll: "average" },
    );
    expect(r.ailmentBase.physical).toBeCloseTo(8.5 * 1.3);
    expect(r.total).toBeLessThan(8.5 * 1.3 * 1.5 * 1.25);
  });

  it("打撃値だけを下げる効果は、基準値を変えない（腐敗の聖杯）", () => {
    const r = computeHit(attackerWith(db, ["EFF-CHALICE"]), BASIC, {}, avg);
    expect(r.total).toBeCloseTo(4.25);
    expect(r.ailmentBase.physical).toBeCloseTo(8.5);
  });

  it("打撃値と基準値の両方を下げる効果は、両方を下げる（千の小傷）。局所の効果は、その武器のヒットだけ", () => {
    const thousand: EffectInstance = {
      effectId: "EFF-THOUSAND",
      source: { kind: "equipment", ref: "itm_sword" },
    };
    const { view } = evaluateEffects(db, new TagIndex(db.tags), [thousand]);
    const withSword = computeHit(
      { db, view, characterLevel: 1, weapon: LONGSWORD },
      BASIC,
      {},
      avg,
    );
    expect(withSword.total).toBeCloseTo(8.5 * 0.6);
    expect(withSword.ailmentBase.physical).toBeCloseTo(8.5 * 0.6);
    // 別の武器のヒットには効かない
    const withScythe = computeHit({ db, view, characterLevel: 1, weapon: SCYTHE }, BASIC, {}, avg);
    expect(withScythe.total).toBeCloseTo(16.5);
  });
});

describe("属性の変換と付け替え（開発計画書 T4・仕様書2.5）", () => {
  const db = buildDb({
    ...fixture,
    effects: [
      effect("EFF-SCYTHE-DARK", "implicit", [
        { kind: "convert", from: "physical", to: "dark", value: 0.15 },
      ]),
      effect("EFF-PHYS-30", "minorStar", [
        {
          kind: "increased",
          stat: "STAT-DAMAGE",
          value: 0.3,
          filter: { allOf: ["TAG-ELEM-PHYSICAL"] },
        },
      ]),
      effect("EFF-DARK-50", "minorStar", [
        {
          kind: "increased",
          stat: "STAT-DAMAGE",
          value: 0.5,
          filter: { allOf: ["TAG-ELEM-DARK"] },
        },
      ]),
      effect("EFF-COLD-50", "minorStar", [
        {
          kind: "increased",
          stat: "STAT-DAMAGE",
          value: 0.5,
          filter: { allOf: ["TAG-ELEM-COLD"] },
        },
      ]),
      effect("EFF-TO-FIRE-80", "affix", [
        { kind: "convert", from: "physical", to: "fire", value: 0.8 },
      ]),
      effect("EFF-TO-COLD-60", "affix", [
        { kind: "convert", from: "physical", to: "cold", value: 0.6 },
      ]),
      effect("EFF-STARS", "keystone", [
        { kind: "retag", from: ["fire", "cold", "lightning"], to: "fire" },
      ]),
    ],
  });

  it("鎌（物理の15%を闇に）：変換された分は、元と先の両方の補正を受ける", () => {
    const a = attackerWith(db, ["EFF-SCYTHE-DARK", "EFF-PHYS-30", "EFF-DARK-50"], {
      weapon: { ...SCYTHE, base: { physical: { min: 10, max: 10 } } },
    });
    const r = computeHit(a, BASIC, {}, avg);
    expect(r.damage.physical).toBeCloseTo(8.5 * 1.3);
    expect(r.damage.dark).toBeCloseTo(1.5 * (1 + 0.3 + 0.5));
    expect(r.trace.afterConversion.find((p) => p.element === "dark")?.lineage).toEqual([
      "physical",
      "dark",
    ]);
  });

  it("1つの属性からの変換の合計が100%を超えると、比例して100%に縮める（量は増えない）", () => {
    const a = attackerWith(db, ["EFF-TO-FIRE-80", "EFF-TO-COLD-60"], {
      weapon: { ...LONGSWORD, base: { physical: { min: 14, max: 14 } } },
    });
    const r = computeHit(a, BASIC, {}, avg);
    expect(r.damage.physical).toBeUndefined();
    expect(r.damage.fire).toBeCloseTo(8);
    expect(r.damage.cold).toBeCloseTo(6);
  });

  it("付け替えた後は、付け替えた後の属性の補正だけを受ける（星の巡り）", () => {
    const a = attackerWith(db, ["EFF-TO-COLD-60", "EFF-STARS", "EFF-COLD-50"], {
      weapon: { ...LONGSWORD, base: { physical: { min: 10, max: 10 } } },
    });
    const r = computeHit(a, BASIC, {}, avg);
    expect(r.damage.cold).toBeUndefined();
    expect(r.damage.fire).toBeCloseTo(6); // 氷の+50%は受けない
    expect(r.damage.physical).toBeCloseTo(4);
  });

  it("下流から上流へ・聖から他への変換は、データの検証で誤りになる", () => {
    expect(conversionAllowed("physical", "dark")).toBe(true);
    expect(conversionAllowed("fire", "physical")).toBe(false);
    expect(conversionAllowed("holy", "fire")).toBe(false);
    expect(conversionAllowed("fire", "holy")).toBe(true);
    expect(() =>
      buildDb({
        ...fixture,
        effects: [
          effect("EFF-BAD", "affix", [
            { kind: "convert", from: "fire", to: "physical", value: 0.5 },
          ]),
        ],
      }),
    ).toThrow(/上流から下流/);
    expect(() =>
      buildDb({
        ...fixture,
        effects: [
          effect("EFF-BAD", "affix", [{ kind: "convert", from: "holy", to: "dark", value: 0.5 }]),
        ],
      }),
    ).toThrow(/聖から/);
  });

  it("変換は多重にかからない：量は保たれ、上流に戻らず、聖からは出ない（性質のテスト）", () => {
    const allowed: {
      from: (typeof CONVERSION_ORDER)[number] | "holy";
      to: (typeof CONVERSION_ORDER)[number] | "holy";
    }[] = [];
    const all = [...CONVERSION_ORDER, "holy" as const];
    for (const from of all)
      for (const to of all) if (conversionAllowed(from, to)) allowed.push({ from, to });
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            pair: fc.constantFrom(...allowed),
            value: fc.double({ min: 0.01, max: 1, noNaN: true }),
          }),
          { maxLength: 10 },
        ),
        fc.array(
          fc.record({
            element: fc.constantFrom(...all),
            amount: fc.double({ min: 0, max: 1000, noNaN: true }),
          }),
          { minLength: 1, maxLength: 4 },
        ),
        (rules, start) => {
          const portions: DamagePortion[] = start.map((s) => ({
            element: s.element,
            amount: s.amount,
            lineage: [s.element],
          }));
          const out = applyConversions(
            portions,
            rules.map((r) => ({ from: r.pair.from, to: r.pair.to, value: r.value })),
          );
          const before = portions.reduce((a, p) => a + p.amount, 0);
          const after = out.reduce((a, p) => a + p.amount, 0);
          if (Math.abs(before - after) > 1e-6 * Math.max(1, before)) return false;
          for (const p of out) {
            if (p.amount < 0) return false;
            // 通ってきた属性は、上流から下流の順（聖は最後）に並ぶ
            const idx = p.lineage.map((e) => (e === "holy" ? 99 : CONVERSION_ORDER.indexOf(e)));
            for (let i = 1; i < idx.length; i++)
              if ((idx[i] ?? 0) <= (idx[i - 1] ?? 0)) return false;
            if (p.lineage.slice(0, -1).includes("holy")) return false; // 聖から先へは進まない
            if (p.lineage[p.lineage.length - 1] !== p.element) return false;
          }
          return true;
        },
      ),
    );
  });
});
