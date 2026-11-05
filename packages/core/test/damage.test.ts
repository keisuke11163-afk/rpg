import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type ContentDb,
  type DamageAttacker,
  type DamagePortion,
  type DamageSkill,
  type EffectInstance,
  CONVERSION_ORDER,
  EQUIPMENT_SOURCE_KIND,
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

describe("局所の効果の適用範囲（仕様書v0.2 3.7 の原則5・H-08）", () => {
  const local = { locality: "local" };
  const db = buildDb({
    ...fixture,
    effects: [
      // 武器の局所の効果（乗算・追加値・変換・付け替え・職技レベル・命中）
      effect(
        "EFF-LOCAL-MORE",
        "unique",
        [{ kind: "more", stat: "STAT-DAMAGE", value: 1.5 }],
        local,
      ),
      effect(
        "EFF-LOCAL-ADD-PHYS",
        "affix",
        [{ kind: "added", stat: "STAT-ADDED-PHYSICAL", value: { min: 10, max: 10 } }],
        local,
      ),
      effect(
        "EFF-LOCAL-ADD-FIRE",
        "affix",
        [{ kind: "added", stat: "STAT-ADDED-FIRE", value: { min: 10, max: 10 } }],
        local,
      ),
      effect(
        "EFF-LOCAL-TO-FIRE",
        "unique",
        [{ kind: "convert", from: "physical", to: "fire", value: 0.5 }],
        local,
      ),
      effect(
        "EFF-LOCAL-RETAG",
        "unique",
        [{ kind: "retag", from: ["physical", "fire"], to: "cold" }],
        local,
      ),
      effect(
        "EFF-LOCAL-SKILL-LV2",
        "affix",
        [{ kind: "added", stat: "STAT-SKILL-LEVEL", value: 2 }],
        local,
      ),
      effect(
        "EFF-LOCAL-ACC",
        "affix",
        [{ kind: "added", stat: "STAT-ACCURACY", value: 100 }],
        local,
      ),
      effect("EFF-LOCAL-CRIT", "unique", [{ kind: "flag", flag: "crit", mode: "force" }], local),
      // 非局所の効果（防具・星辰盤など）
      effect("EFF-GLOBAL-INC-30", "minorStar", [
        { kind: "increased", stat: "STAT-DAMAGE", value: 0.3 },
      ]),
      effect("EFF-GLOBAL-SKILL-LV1", "affix", [
        { kind: "added", stat: "STAT-SKILL-LEVEL", value: 1 },
      ]),
      effect("EFF-GLOBAL-TO-FIRE", "affix", [
        { kind: "convert", from: "physical", to: "fire", value: 0.5 },
      ]),
      effect("EFF-GLOBAL-RETAG", "keystone", [
        { kind: "retag", from: ["physical", "fire"], to: "cold" },
      ]),
    ],
  });
  const FLAT_SWORD = { ...LONGSWORD, base: { physical: { min: 10, max: 10 } } };
  const FLAT_SCYTHE = { ...SCYTHE, base: { physical: { min: 10, max: 10 } } };
  const FLAT_FIREBALL: DamageSkill = { ...FIREBALL, base: { fire: { min: 10, max: 10 } } };

  /** 効果を、出どころを指定して有効にする（武器の効果は、その武器の uid を出どころにする）。 */
  function attackerFrom(
    instances: readonly { id: string; from: string }[],
    weapon: DamageAttacker["weapon"] = FLAT_SWORD,
  ): DamageAttacker {
    const { view } = evaluateEffects(
      db,
      new TagIndex(db.tags),
      instances.map(({ id, from }) => ({
        effectId: id,
        source: { kind: from.startsWith("itm_") ? "equipment" : "starNode", ref: from },
      })),
    );
    return { db, view, characterLevel: 1, weapon };
  }
  const onSword = (...ids: string[]): { id: string; from: string }[] =>
    ids.map((id) => ({ id, from: LONGSWORD.uid }));

  it("1. 武器Aの局所の効果は、武器Aのヒットに効く", () => {
    const r = computeHit(
      attackerFrom(onSword("EFF-LOCAL-MORE", "EFF-LOCAL-ADD-PHYS")),
      BASIC,
      {},
      avg,
    );
    expect(r.damage.physical).toBeCloseTo((10 + 10) * 1.5);
  });

  it("2. 武器Aの局所の効果は、武器Bのヒットには効かない（同じ効果でも出どころが違えば効かない）", () => {
    const a = attackerFrom(onSword("EFF-LOCAL-MORE", "EFF-LOCAL-ADD-PHYS"), FLAT_SCYTHE);
    expect(computeHit(a, BASIC, {}, avg).damage.physical).toBeCloseTo(10);
    // 武器Bを出どころにした同じ効果は、武器Bに効く
    const b = attackerFrom([{ id: "EFF-LOCAL-MORE", from: SCYTHE.uid }], FLAT_SCYTHE);
    expect(computeHit(b, BASIC, {}, avg).damage.physical).toBeCloseTo(15);
  });

  it("3. 武器Aの局所の効果は、武器Aを持っていても呪文には効かない", () => {
    const a = attackerFrom(
      onSword("EFF-LOCAL-MORE", "EFF-LOCAL-ADD-FIRE", "EFF-LOCAL-SKILL-LV2", "EFF-LOCAL-RETAG"),
    );
    const r = computeHit(a, FLAT_FIREBALL, {}, avg);
    expect(r.damage).toEqual({ fire: 10 });
    expect(r.trace.skillLevel).toBe(1);
  });

  it("4. 局所の変換は、対象の武器のヒットだけに効く", () => {
    const a = attackerFrom(onSword("EFF-LOCAL-TO-FIRE"));
    const sword = computeHit(a, BASIC, {}, avg);
    expect(sword.damage.physical).toBeCloseTo(5);
    expect(sword.damage.fire).toBeCloseTo(5);
    const scythe = computeHit({ ...a, weapon: FLAT_SCYTHE }, BASIC, {}, avg);
    expect(scythe.damage).toEqual({ physical: 10 });
    // 変換の一覧には、適用元（出どころ）が残る
    expect(a.view.conversions([], { weaponUid: LONGSWORD.uid })).toEqual([
      expect.objectContaining({
        effectId: "EFF-LOCAL-TO-FIRE",
        source: { kind: "equipment", ref: LONGSWORD.uid },
      }),
    ]);
    expect(a.view.conversions([], { weaponUid: SCYTHE.uid })).toEqual([]);
    expect(a.view.conversions([], { weaponUid: undefined })).toEqual([]);
  });

  it("5. 局所の付け替えは、対象の武器のヒットだけに効く（呪文にも効かない）", () => {
    const a = attackerFrom(onSword("EFF-LOCAL-RETAG"));
    expect(computeHit(a, BASIC, {}, avg).damage).toEqual({ cold: 10 });
    expect(computeHit({ ...a, weapon: FLAT_SCYTHE }, BASIC, {}, avg).damage).toEqual({
      physical: 10,
    });
    expect(computeHit(a, FLAT_FIREBALL, {}, avg).damage).toEqual({ fire: 10 });
    expect(a.view.retagging([], { weaponUid: LONGSWORD.uid })).toEqual([
      expect.objectContaining({
        effectId: "EFF-LOCAL-RETAG",
        source: { kind: "equipment", ref: LONGSWORD.uid },
      }),
    ]);
    expect(a.view.retagging([], { weaponUid: SCYTHE.uid })).toEqual([]);
  });

  it("6. 局所の職技レベルの追加値は、対象の武器のヒットだけに効く", () => {
    const a = attackerFrom(onSword("EFF-LOCAL-SKILL-LV2"));
    const sword = computeHit(a, BASIC, {}, avg);
    expect(sword.trace.skillLevel).toBe(3);
    expect(sword.damage.physical).toBeCloseTo(10 * (1 + 0.08 * 2));
    const scythe = computeHit({ ...a, weapon: FLAT_SCYTHE }, BASIC, {}, avg);
    expect(scythe.trace.skillLevel).toBe(1);
    expect(scythe.damage.physical).toBeCloseTo(10);
  });

  it("局所の命中は、対象の武器のヒットだけに効く", () => {
    const a = attackerFrom(onSword("EFF-LOCAL-ACC"));
    expect(computeHit(a, BASIC, { evasion: 100 }, avg).hitChance).toBeCloseTo(hitChance(100, 100));
    expect(
      computeHit({ ...a, weapon: FLAT_SCYTHE }, BASIC, { evasion: 100 }, avg).hitChance,
    ).toBeCloseTo(hitChance(100, 0));
  });

  it("局所の印（必ず会心）は、対象の武器のヒットだけに効く", () => {
    const a = attackerFrom(onSword("EFF-LOCAL-CRIT"));
    expect(computeHit(a, BASIC, {}, avg).critChance).toBe(1);
    expect(computeHit({ ...a, weapon: FLAT_SCYTHE }, BASIC, {}, avg).critChance).toBeCloseTo(
      SCYTHE.critChance,
    );
  });

  it("7. 非局所の効果は、従来どおり全ての武器と呪文に効く", () => {
    const a = attackerFrom([
      { id: "EFF-GLOBAL-INC-30", from: "node-1" },
      { id: "EFF-GLOBAL-SKILL-LV1", from: "node-2" },
    ]);
    const inc = 1 + 0.3 + 0.08;
    expect(computeHit(a, BASIC, {}, avg).damage.physical).toBeCloseTo(10 * inc);
    expect(computeHit({ ...a, weapon: FLAT_SCYTHE }, BASIC, {}, avg).damage.physical).toBeCloseTo(
      10 * inc,
    );
    const spell = computeHit(a, FLAT_FIREBALL, {}, avg);
    expect(spell.damage.fire).toBeCloseTo(10 * inc);
    expect(spell.trace.skillLevel).toBe(2);
    // 非局所の変換・付け替えも、全ての武器に効く
    const conv = attackerFrom([{ id: "EFF-GLOBAL-TO-FIRE", from: "node-3" }], FLAT_SCYTHE);
    expect(computeHit(conv, BASIC, {}, avg).damage).toEqual({ physical: 5, fire: 5 });
    const retag = attackerFrom([{ id: "EFF-GLOBAL-RETAG", from: "node-4" }], FLAT_SCYTHE);
    expect(computeHit(retag, BASIC, {}, avg).damage).toEqual({ cold: 10 });
    expect(computeHit(retag, FLAT_FIREBALL, {}, avg).damage).toEqual({ cold: 10 });
  });

  it("範囲を指定しない問い合わせは、従来どおり局所の効果も含めて集計する", () => {
    const a = attackerFrom(onSword("EFF-LOCAL-SKILL-LV2", "EFF-LOCAL-TO-FIRE"));
    expect(a.view.stat("STAT-SKILL-LEVEL").value).toBe(2);
    expect(a.view.conversions()).toHaveLength(1);
  });
});

describe("ダメージの計算の非有限値（NaN・Infinity）の検出", () => {
  const db = buildDb({
    ...fixture,
    effects: [
      effect("EFF-MORE-10", "unique", [{ kind: "more", stat: "STAT-DAMAGE", value: 10 }]),
      effect("EFF-RETAG-COLD", "keystone", [
        { kind: "retag", from: ["physical", "fire"], to: "cold" },
      ]),
      effect("EFF-CRIT-INC", "affix", [{ kind: "increased", stat: "STAT-CRIT-CHANCE", value: 10 }]),
    ],
  });
  const HUGE = 1e308;

  it("有限の値どうしの乗算で Infinity になる（基礎値 1e300 × 乗算 1e10）と RangeError", () => {
    // 乗算×10 を10重ねて、乗算の積 1e10（有限。効果の評価の検証は通る）にする
    const { view } = evaluateEffects(db, new TagIndex(db.tags), [
      { effectId: "EFF-MORE-10", source: { kind: "test", ref: "x" }, stacks: 10 },
    ]);
    expect(view.stat("STAT-DAMAGE").more).toBeCloseTo(1e10);
    const a: DamageAttacker = {
      db,
      view,
      characterLevel: 1,
      weapon: { ...LONGSWORD, base: { physical: { min: 1e300, max: 1e300 } } },
    };
    expect(() => computeHit(a, BASIC, {}, avg)).toThrow(RangeError);
    expect(() => computeHit(a, BASIC, {}, avg)).toThrow(/打撃値（physical・加算と乗算の後）/);
  });

  it("有限の値どうしの乗算で Infinity になる（基礎値 1.5e308 × 技倍率 1.3）と RangeError", () => {
    const a = attackerWith(db, [], {
      weapon: { ...LONGSWORD, base: { physical: { min: 1.5e308, max: 1.5e308 } } },
    });
    // 技倍率1.0なら有限
    expect(Number.isFinite(computeHit(a, BASIC, {}, avg).total)).toBe(true);
    expect(() => computeHit(a, SWEEP, {}, avg)).toThrow(/基礎値（physical）/);
  });

  it("同じ属性への合算（付け替えで物理と火が冷気に集まる）の加算で Infinity になると RangeError", () => {
    const a = attackerWith(db, ["EFF-RETAG-COLD"], {
      weapon: {
        ...LONGSWORD,
        base: { physical: { min: HUGE, max: HUGE }, fire: { min: HUGE, max: HUGE } },
      },
    });
    expect(() => computeHit(a, BASIC, {}, avg)).toThrow(/打撃値（cold・加算と乗算の後）/);
  });

  it("属性ごとの値は有限でも、最終の打撃値の合計の加算が Infinity になると RangeError", () => {
    const a = attackerWith(db, [], {
      weapon: {
        ...LONGSWORD,
        base: { physical: { min: HUGE, max: HUGE }, fire: { min: HUGE, max: HUGE } },
      },
    });
    expect(() => computeHit(a, BASIC, {}, avg)).toThrow(/最終の打撃値の合計/);
  });

  it("敵が受けるダメージの倍率をかけた最終の打撃値が Infinity になると RangeError", () => {
    const a = attackerWith(db, [], {
      weapon: { ...LONGSWORD, base: { physical: { min: HUGE, max: HUGE } } },
    });
    expect(() => computeHit(a, BASIC, { takenMultiplier: 2 }, avg)).toThrow(
      /最終の打撃値（physical）/,
    );
  });

  it("会心率の計算が Infinity になると RangeError（上限100%に丸めて隠さない）", () => {
    const a = attackerWith(db, ["EFF-CRIT-INC"], {
      weapon: { ...LONGSWORD, critChance: HUGE },
    });
    expect(() => computeHit(a, BASIC, {}, avg)).toThrow(/会心率/);
  });

  it("NaN が混入する（武器の基礎値・耐性・防具値・ガード・回避値・敵が受けるダメージの倍率・会心率）と RangeError", () => {
    const nanBase = attackerWith(db, [], {
      weapon: { ...LONGSWORD, base: { physical: { min: NaN, max: 10 } } },
    });
    expect(() => computeHit(nanBase, BASIC, {}, avg)).toThrow(RangeError);
    const a = attackerWith(db, []);
    for (const defender of [
      { resist: { physical: NaN } },
      { armor: NaN },
      { guard: NaN },
      { evasion: NaN },
      { takenMultiplier: NaN },
    ]) {
      expect(() => computeHit(a, BASIC, defender, avg)).toThrow(RangeError);
    }
    const nanCrit = attackerWith(db, [], { weapon: { ...LONGSWORD, critChance: NaN } });
    expect(() => computeHit(nanCrit, BASIC, {}, avg)).toThrow(/会心率/);
  });

  it("期待値の計算で Infinity になる（打撃値は有限、会心の期待値をかけると溢れる）と RangeError", () => {
    const a = attackerWith(db, [], {
      weapon: { ...LONGSWORD, critChance: 0.5, base: { physical: { min: 1.5e308, max: 1.5e308 } } },
    });
    // 1回のヒットの打撃値そのものは有限
    expect(Number.isFinite(computeHit(a, BASIC, {}, avg).total)).toBe(true);
    expect(() => expectedHitDamage(a, BASIC, {}, Rng.fromSeed(1))).toThrow(/期待値/);
  });

  it("通常のダメージの計算は従来どおり（有限の値では結果が変わらない）", () => {
    const a = attackerWith(db, []);
    const r = computeHit(a, BASIC, { resist: { physical: 0.2 }, guard: 0.1 }, avg);
    expect(r.damage.physical).toBeCloseTo(8.5 * 0.8 * 0.9);
    expect(r.total).toBeCloseTo(8.5 * 0.8 * 0.9);
    expect(r.ailmentBase.physical).toBeCloseTo(8.5);
    expect(expectedHitDamage(a, BASIC, {}, Rng.fromSeed(1))).toBeCloseTo(
      8.5 * (1 + LONGSWORD.critChance * 0.5),
    );
  });
});

describe("局所の効果の出どころの判定（種類と uid の両方）", () => {
  const db = buildDb({
    ...fixture,
    effects: [
      effect("EFF-LOCAL-MORE", "unique", [{ kind: "more", stat: "STAT-DAMAGE", value: 1.5 }], {
        locality: "local",
      }),
      effect("EFF-GLOBAL-INC-30", "minorStar", [
        { kind: "increased", stat: "STAT-DAMAGE", value: 0.3 },
      ]),
    ],
  });
  const FLAT_SWORD = { ...LONGSWORD, base: { physical: { min: 10, max: 10 } } };
  const FLAT_SCYTHE = { ...SCYTHE, base: { physical: { min: 10, max: 10 } } };
  const FLAT_FIREBALL: DamageSkill = { ...FIREBALL, base: { fire: { min: 10, max: 10 } } };
  const attacker = (
    sources: readonly { id: string; kind: string; ref: string }[],
    weapon: DamageAttacker["weapon"] = FLAT_SWORD,
  ): DamageAttacker => {
    const { view } = evaluateEffects(
      db,
      new TagIndex(db.tags),
      sources.map(({ id, kind, ref }) => ({ effectId: id, source: { kind, ref } })),
    );
    return { db, view, characterLevel: 1, weapon };
  };
  const onSword = { id: "EFF-LOCAL-MORE", kind: EQUIPMENT_SOURCE_KIND, ref: LONGSWORD.uid };

  it("出どころの種類が装備で、uid がそのヒットの武器と一致すれば効く", () => {
    const a = attacker([onSword]);
    expect(computeHit(a, BASIC, {}, avg).damage.physical).toBeCloseTo(15);
    expect(a.view.stat("STAT-DAMAGE", [], { weaponUid: LONGSWORD.uid }).more).toBeCloseTo(1.5);
  });

  it("uid だけが一致し、出どころの種類が装備でなければ効かない", () => {
    for (const kind of ["starNode", "jobNode", "buff", "test"]) {
      const a = attacker([{ ...onSword, kind }]);
      expect(computeHit(a, BASIC, {}, avg).damage.physical).toBeCloseTo(10);
      expect(a.view.stat("STAT-DAMAGE", [], { weaponUid: LONGSWORD.uid }).more).toBe(1);
    }
  });

  it("別の武器の出どころの局所の効果は、このヒットに効かない", () => {
    const a = attacker([onSword], FLAT_SCYTHE);
    expect(computeHit(a, BASIC, {}, avg).damage.physical).toBeCloseTo(10);
  });

  it("呪文には、武器の局所の効果が効かない", () => {
    const a = attacker([onSword]);
    expect(computeHit(a, FLAT_FIREBALL, {}, avg).damage).toEqual({ fire: 10 });
  });

  it("グローバルの効果は、出どころの種類に関係なく、武器と呪文の両方に引き続き効く", () => {
    for (const kind of [EQUIPMENT_SOURCE_KIND, "starNode"]) {
      const a = attacker([{ id: "EFF-GLOBAL-INC-30", kind, ref: LONGSWORD.uid }]);
      expect(computeHit(a, BASIC, {}, avg).damage.physical).toBeCloseTo(13);
      expect(computeHit({ ...a, weapon: FLAT_SCYTHE }, BASIC, {}, avg).damage.physical).toBeCloseTo(
        13,
      );
      expect(computeHit(a, FLAT_FIREBALL, {}, avg).damage.fire).toBeCloseTo(13);
    }
  });
});

describe("会心率の計算経路：武器の技と呪文（現行実装の動作確認。呪文の基本の会心率は未確定 D-U04a-7）", () => {
  const db = buildDb({ ...fixture, effects: [] });

  it("武器の技は、そのヒットに使う武器の基本の会心率を使う（仕様書v0.2 2.4）", () => {
    expect(computeHit(attackerWith(db, []), BASIC, {}, avg).critChance).toBeCloseTo(
      LONGSWORD.critChance,
    );
    expect(
      computeHit(attackerWith(db, [], { weapon: SCYTHE }), BASIC, {}, avg).critChance,
    ).toBeCloseTo(SCYTHE.critChance);
  });

  it("現行実装では、呪文は持っている武器の基本の会心率を使い、武器がなければ0になる（D-U04a-7：未確定の仮の扱い）", () => {
    expect(computeHit(attackerWith(db, []), FIREBALL, {}, avg).critChance).toBeCloseTo(
      LONGSWORD.critChance,
    );
    const { view } = evaluateEffects(db, new TagIndex(db.tags), []);
    expect(computeHit({ db, view, characterLevel: 1 }, FIREBALL, {}, avg).critChance).toBe(0);
  });
});

describe("防御の計算の中間値の溢れ（有限の入力から Infinity・NaN を作らない）", () => {
  // 修正前の式（通常の入力では、修正後もこれと1ビットも違わないことを確かめる）
  const naiveArmor = (a: number, d: number) =>
    a <= 0 || d <= 0 ? 0 : Math.min(0.85, a / (a + 10 * d));
  const naiveEvade = (e: number, acc: number) =>
    e <= 0 ? 0 : Math.min(0.75, e / (e + Math.max(0, acc) * 1.5));

  it("防具値の分母（防具値＋10×受けるダメージ）が Infinity になっても、本当の比を返す", () => {
    // 修正前：1e308 ÷ Infinity ＝ 0（軽減なし）になっていた。本当の値は 1 ÷ 11
    expect(naiveArmor(1e308, 1e308)).toBe(0);
    expect(armorReduction(1e308, 1e308)).toBeCloseTo(1 / 11, 12);
    // 10×受けるダメージだけで溢れる：本当の値は約 1e-309（0に近い有限の値）
    const tiny = armorReduction(1, 1e308);
    expect(Number.isFinite(tiny)).toBe(true);
    expect(tiny).toBeGreaterThanOrEqual(0);
    expect(tiny).toBeLessThan(1e-300);
    // 防具値も受けるダメージも有限の最大値
    expect(armorReduction(Number.MAX_VALUE, Number.MAX_VALUE)).toBeCloseTo(1 / 11, 12);
    // 上限85%は変わらない
    expect(armorReduction(Number.MAX_VALUE, 1e300)).toBe(0.85);
  });

  it("回避率の分母（回避値＋命中×1.5）が Infinity になっても、本当の比を返す", () => {
    // 修正前：1e308 ÷ Infinity ＝ 0（回避率0%）になっていた。本当の値は 1 ÷ 2.5 ＝ 0.4
    expect(naiveEvade(1e308, 1e308)).toBe(0);
    expect(evadeChance(1e308, 1e308)).toBeCloseTo(0.4, 12);
    expect(hitChance(1e308, 1e308)).toBeCloseTo(0.6, 12);
    // 命中×1.5 だけで溢れる（1.5e308 × 1.5）：本当の値は 1 ÷ 3.25
    expect(evadeChance(1e308, 1.5e308)).toBeCloseTo(1 / 3.25, 12);
    expect(evadeChance(Number.MAX_VALUE, Number.MAX_VALUE)).toBeCloseTo(0.4, 12);
  });

  it("ダメージの計算でも、防具値・回避の分母の溢れで軽減・回避が消えない", () => {
    const db = buildDb(fixture);
    const huge = attackerWith(
      db,
      [],
      { weapon: { ...LONGSWORD, base: { physical: { min: 1e308, max: 1e308 } } } },
      { "STAT-ACCURACY": 1e308 },
    );
    const r = computeHit(huge, BASIC, { armor: 1e308, evasion: 1e308 }, avg);
    expect(r.hitChance).toBeCloseTo(0.6, 12);
    expect(r.total).toBeCloseTo(1e308 * (10 / 11), -296);
  });

  it("防具値・回避の入力が NaN・Infinity なら RangeError（0などに置き換えない）", () => {
    for (const [a, d] of [
      [NaN, 100],
      [Infinity, 100],
      [100, NaN],
      [100, Infinity],
      [0, NaN],
      [-Infinity, 1],
    ] as const) {
      expect(() => armorReduction(a, d)).toThrow(RangeError);
    }
    for (const [e, acc] of [
      [NaN, 100],
      [Infinity, 100],
      [100, NaN],
      [100, Infinity],
      [0, NaN],
      [100, -Infinity],
    ] as const) {
      expect(() => evadeChance(e, acc)).toThrow(RangeError);
      expect(() => hitChance(e, acc)).toThrow(RangeError);
    }
    const a = attackerWith(buildDb(fixture), []);
    expect(() => computeHit(a, BASIC, { armor: Infinity }, avg)).toThrow(/防具値/);
    expect(() => computeHit(a, BASIC, { evasion: Infinity }, avg)).toThrow(/回避値/);
  });

  it("通常の防具値の軽減・回避率は従来どおり（修正前の式と1ビットも違わない）", () => {
    expect(armorReduction(1000, 200)).toBe(1000 / (1000 + 2000));
    expect(evadeChance(100, 100)).toBe(100 / (100 + 150));
    const value = fc.double({ min: 0, max: 1e12, noNaN: true });
    fc.assert(
      fc.property(value, value, (x, y) => {
        expect(armorReduction(x, y)).toBe(naiveArmor(x, y));
        expect(evadeChance(x, y)).toBe(naiveEvade(x, y));
        expect(hitChance(x, y)).toBe(1 - naiveEvade(x, y));
      }),
    );
    // 負の命中は0として扱う・防具値や回避値が0以下なら0（従来どおり）
    expect(evadeChance(100, -50)).toBe(naiveEvade(100, -50));
    expect(armorReduction(-5, 100)).toBe(0);
    expect(evadeChance(-5, 100)).toBe(0);
  });
});

describe("会心率の非有限値の検出（強制会心・会心禁止の印があっても見逃さない）", () => {
  const db = buildDb({
    ...fixture,
    effects: [
      effect("EFF-CRIT-FLAT", "minorStar", [
        { kind: "added", stat: "STAT-CRIT-CHANCE", value: 0.05 },
      ]),
      effect("EFF-CRIT-INC", "affix", [{ kind: "increased", stat: "STAT-CRIT-CHANCE", value: 10 }]),
      effect("EFF-FORCE-CRIT", "jobSkill", [{ kind: "flag", flag: "crit", mode: "force" }]),
      effect("EFF-NO-CRIT", "unique", [{ kind: "flag", flag: "crit", mode: "forbid" }]),
    ],
  });

  it("強制会心の印があっても、会心率に NaN が混入すれば RangeError", () => {
    const a = attackerWith(db, ["EFF-FORCE-CRIT"], { weapon: { ...LONGSWORD, critChance: NaN } });
    expect(() => computeHit(a, BASIC, {}, avg)).toThrow(RangeError);
    expect(() => computeHit(a, BASIC, {}, avg)).toThrow(/会心率/);
    expect(() => expectedHitDamage(a, BASIC, {}, Rng.fromSeed(1))).toThrow(/会心率/);
  });

  it("会心禁止の印があっても、会心率に Infinity が混入すれば RangeError", () => {
    // 武器の会心率そのものが Infinity
    const inf = attackerWith(db, ["EFF-NO-CRIT"], {
      weapon: { ...LONGSWORD, critChance: Infinity },
    });
    expect(() => computeHit(inf, BASIC, {}, avg)).toThrow(/会心率/);
    // 有限の値どうしの計算で Infinity（1e308 ×（1＋10））
    const overflow = attackerWith(db, ["EFF-NO-CRIT", "EFF-CRIT-INC"], {
      weapon: { ...LONGSWORD, critChance: 1e308 },
    });
    expect(() => computeHit(overflow, BASIC, {}, avg)).toThrow(/会心率/);
    // 印がなければ、同じ入力は従来どおり RangeError（印の有無で検出が変わらない）
    const noFlag = attackerWith(db, ["EFF-CRIT-INC"], {
      weapon: { ...LONGSWORD, critChance: 1e308 },
    });
    expect(() => computeHit(noFlag, BASIC, {}, avg)).toThrow(/会心率/);
  });

  it("強制会心・会心禁止の仕様は変わらない（強制は100%、禁止は0%、禁止が勝つ）", () => {
    expect(computeHit(attackerWith(db, ["EFF-FORCE-CRIT"]), BASIC, {}, avg).critChance).toBe(1);
    expect(computeHit(attackerWith(db, ["EFF-NO-CRIT"]), BASIC, {}, avg).critChance).toBe(0);
    expect(
      computeHit(attackerWith(db, ["EFF-FORCE-CRIT", "EFF-NO-CRIT"]), BASIC, {}, avg).critChance,
    ).toBe(0);
    // 印があっても、有限の大きな会心率は上限100%とは別に問題なく計算される
    const big = attackerWith(db, ["EFF-FORCE-CRIT", "EFF-CRIT-INC"], {
      weapon: { ...LONGSWORD, critChance: 1e300 },
    });
    expect(computeHit(big, BASIC, {}, avg).critChance).toBe(1);
  });

  it("通常の会心率は従来どおり（（武器の会心率＋固定値）×（1＋増加%）、上限100%）", () => {
    expect(computeHit(attackerWith(db, []), BASIC, {}, avg).critChance).toBe(0.05);
    expect(computeHit(attackerWith(db, ["EFF-CRIT-FLAT"]), BASIC, {}, avg).critChance).toBe(
      (0.05 + (0.05 + 0.05) / 2) * (1 + 0),
    );
    expect(computeHit(attackerWith(db, ["EFF-CRIT-INC"]), BASIC, {}, avg).critChance).toBe(
      Math.min(1, 0.05 * (1 + 10)),
    );
  });
});
