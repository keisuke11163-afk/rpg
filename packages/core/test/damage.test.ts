import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CONVERSION_ORDER,
  DAMAGE_STAGES,
  ELEMENTS,
  TagRegistry,
  armorReduction,
  baseSkillLevel,
  computeDamage,
  critChance,
  critMultiplier,
  effectSchema,
  evaluate,
  hitChance,
  spellBaseMultiplier,
  weaponSkillMultiplier,
  type ActiveEffect,
  type Conversion,
  type Element,
} from "../src/index.ts";

describe("計算の段階の順序（固定）", () => {
  it("開発計画書 6.12 の順序", () => {
    expect(DAMAGE_STAGES).toEqual([
      "base",
      "added",
      "skillMultiplier",
      "flat",
      "conversion",
      "reassign",
      "additivePercent",
      "multiplier",
      "recordReference",
      "crit",
      "enemyDamageTaken",
      "resistance",
      "defense",
    ]);
  });
});

describe("T1 ダメージ計算", () => {
  it("(基礎＋追加)×技倍率＋固定 → ×(1＋加算％)×乗算", () => {
    const r = computeDamage({
      base: { physical: 10 },
      added: { physical: 5 },
      skillMultiplier: 1.3,
      flat: { physical: 4 },
      generic: { addPct: 0.5, mult: 2 },
    });
    expect(r.total).toBeCloseTo(((10 + 5) * 1.3 + 4) * 1.5 * 2);
    expect(r.referenceTotal).toBeCloseTo(r.total);
  });
  it("固定の追加は技倍率を受けないが、加算・乗算は受ける", () => {
    const r = computeDamage({
      base: { physical: 0 },
      skillMultiplier: 2,
      flat: { physical: 10 },
      generic: { addPct: 1 },
    });
    expect(r.total).toBeCloseTo(20);
  });
  it("物理+30%と近接+20% → +50%（加算）", () => {
    const tags = new TagRegistry([]);
    const mk = (id: string, tag: string, v: number): ActiveEffect => ({
      origin: id,
      effect: effectSchema.parse({
        id,
        source: "詞",
        modifiers: [
          { kind: "加算％", stat: "ダメージ", filter: { tags: { all_of: [tag] } }, value: v },
        ],
        affects: { 打撃値: false, 基準値: false },
        scope: "自分",
      }),
    });
    const ev = evaluate(
      [mk("EFF-A-1", "TAG-ELEM-PHYSICAL", 0.3), mk("EFF-A-2", "TAG-FORM-MELEE", 0.2)],
      { tags: new Set(), stats: {}, counts: {}, flags: new Set() },
    );
    const q = tags.expand(["TAG-ELEM-PHYSICAL", "TAG-FORM-MELEE"]);
    expect(ev.stat({ stat: "ダメージ", tags: q }, 100).value).toBeCloseTo(150);
  });
  it("防具値1,000で物理200 → 軽減率 1000÷(1000＋2000)＝33.3%", () => {
    expect(armorReduction(1000, 200)).toBeCloseTo(1 / 3);
    const r = computeDamage({ base: { physical: 200 }, skillMultiplier: 1, armor: 1000 });
    expect(r.total).toBeCloseTo(200 * (1 - armorReduction(1000, 200)));
  });
  it("防具値がいくら高くても軽減率は85%まで", () => {
    expect(armorReduction(1e9, 100)).toBe(0.85);
    expect(armorReduction(0, 100)).toBe(0);
  });
  it("耐性は75%まで（効果で90%まで）、負の耐性は増える", () => {
    const run = (res: number, cap?: number) =>
      computeDamage({
        base: { fire: 100 },
        skillMultiplier: 1,
        resistance: { fire: res },
        ...(cap ? { resistanceCap: cap } : {}),
      }).total;
    expect(run(0.5)).toBeCloseTo(50);
    expect(run(2)).toBeCloseTo(25);
    expect(run(2, 0.9)).toBeCloseTo(10);
    expect(run(2, 5)).toBeCloseTo(10);
    expect(run(-0.1)).toBeCloseTo(110);
  });
  it("会心・敵が受ける倍率は基準値に含まれない", () => {
    const r = computeDamage({
      base: { physical: 100 },
      skillMultiplier: 1,
      crit: true,
      enemyDamageTaken: 1.25,
      generic: { addPct: 0.2 },
    });
    expect(r.referenceTotal).toBeCloseTo(120);
    expect(r.total).toBeCloseTo(120 * 1.5 * 1.25);
  });
  it("2.8：Lv1のDPS15の土台（下級の長剣の通常攻撃）", () => {
    // 仮の確認：基礎ダメージ15・技倍率1.0・攻撃速度1.0 → 1秒あたり15
    expect(computeDamage({ base: { physical: 15 }, skillMultiplier: 1 }).total).toBe(15);
  });
});

describe("命中・会心", () => {
  it("命中率は 1 － 回避値÷(回避値＋命中×1.5)、回避率の上限75%、呪文は回避されない", () => {
    expect(hitChance(150, 100)).toBeCloseTo(0.5);
    expect(hitChance(1e9, 1)).toBeCloseTo(0.25);
    expect(hitChance(1e9, 1, true)).toBe(1);
    expect(hitChance(0, 10)).toBe(1);
  });
  it("会心率の上限100%、倍率は150%＋加算", () => {
    expect(critChance(0.05, 0.05, 0.5)).toBeCloseTo(0.15);
    expect(critChance(0.9, 0.5, 1)).toBe(1);
    expect(critMultiplier(0.3)).toBeCloseTo(1.8);
  });
});

describe("技レベル", () => {
  it("基本の技レベル：Lv1で1、Lv96以上で20", () => {
    expect([1, 5, 6, 15, 95, 96, 100].map(baseSkillLevel)).toEqual([1, 1, 2, 3, 19, 20, 20]);
  });
  it("武器の技は1レベルにつき+1%（薙ぎ払い130%は技レベル20で149%）", () => {
    expect(weaponSkillMultiplier(1.3, 20)).toBeCloseTo(1.49);
  });
  it("呪文・召喚物の基礎値の倍率", () => {
    expect(spellBaseMultiplier(1)).toBe(1);
    expect(spellBaseMultiplier(20)).toBe(17.84);
    expect(spellBaseMultiplier(99)).toBe(17.84);
  });
});

describe("T4 属性の変換・付け替え", () => {
  it("物理を火に変換すると、物理と火の両方の補正を受ける（汎用は1回だけ）", () => {
    const r = computeDamage({
      base: { physical: 100 },
      skillMultiplier: 1,
      conversions: [{ from: "physical", to: "fire", ratio: 0.5 }],
      generic: { addPct: 0.1 },
      byElement: { physical: { addPct: 0.2 }, fire: { addPct: 0.3 } },
    });
    const fire = r.parts.find((p) => p.element === "fire");
    const phys = r.parts.find((p) => p.element === "physical");
    expect(fire?.reference).toBeCloseTo(50 * (1 + 0.1 + 0.2 + 0.3));
    expect(phys?.reference).toBeCloseTo(50 * (1 + 0.1 + 0.2));
  });
  it("多段の変換（物理→雷→火）も、各段の補正が1回ずつ", () => {
    const r = computeDamage({
      base: { physical: 100 },
      skillMultiplier: 1,
      conversions: [
        { from: "physical", to: "lightning", ratio: 1 },
        { from: "lightning", to: "fire", ratio: 1 },
      ],
      byElement: { physical: { addPct: 0.1 }, lightning: { addPct: 0.1 }, fire: { addPct: 0.1 } },
    });
    expect(r.parts).toHaveLength(1);
    expect(r.total).toBeCloseTo(130);
    expect(r.parts[0]?.element).toBe("fire");
  });
  it("下流から上流・聖からの変換は誤り", () => {
    const base = { base: { fire: 1 }, skillMultiplier: 1 };
    expect(() =>
      computeDamage({ ...base, conversions: [{ from: "fire", to: "physical", ratio: 1 }] }),
    ).toThrow();
    expect(() =>
      computeDamage({ ...base, conversions: [{ from: "holy", to: "fire", ratio: 1 }] }),
    ).toThrow();
    expect(() =>
      computeDamage({ ...base, conversions: [{ from: "fire", to: "fire", ratio: 1 }] }),
    ).toThrow();
    expect(() =>
      computeDamage({ ...base, conversions: [{ from: "physical", to: "holy", ratio: 1 }] }),
    ).not.toThrow();
  });
  it("変換の合計は100%を超えない", () => {
    const r = computeDamage({
      base: { physical: 100 },
      skillMultiplier: 1,
      conversions: [
        { from: "physical", to: "fire", ratio: 0.8 },
        { from: "physical", to: "cold", ratio: 0.8 },
      ],
    });
    expect(r.total).toBeCloseTo(100);
    expect(r.parts.find((p) => p.element === "physical")).toBeUndefined();
  });
  it("付け替えは、付け替えた後の属性の補正だけを受け、変換とは混ざらない", () => {
    const r = computeDamage({
      base: { fire: 100, cold: 100 },
      skillMultiplier: 1,
      reassign: { from: ["fire", "cold"], to: "lightning" },
      byElement: { fire: { addPct: 1 }, lightning: { addPct: 0.25 } },
    });
    expect(r.total).toBeCloseTo(250);
    expect(r.parts.every((p) => p.element === "lightning")).toBe(true);
  });
  it("ランダムな変換でも、補正なしなら総量は保存され、負にならない", () => {
    const conversion = fc
      .tuple(
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: 100 }),
      )
      .filter(([f, t]) => t > f)
      .map(([f, t, r]): Conversion => ({
        from: CONVERSION_ORDER[f] as Element,
        to: ELEMENTS[t] ?? "holy",
        ratio: r / 100,
      }))
      .filter(
        (c) => c.to === "holy" || CONVERSION_ORDER.indexOf(c.to) > CONVERSION_ORDER.indexOf(c.from),
      );
    fc.assert(
      fc.property(
        fc.array(conversion, { maxLength: 8 }),
        fc.integer({ min: 1, max: 1000 }),
        (conversions, amount) => {
          const r = computeDamage({
            base: { physical: amount, fire: amount },
            skillMultiplier: 1,
            conversions,
          });
          expect(r.total).toBeCloseTo(amount * 2, 6);
          for (const p of r.parts) {
            expect(p.final).toBeGreaterThanOrEqual(0);
            // 経由した属性は上流から下流の順にだけ並ぶ
            const idx = p.chain.filter((e) => e !== "holy").map((e) => CONVERSION_ORDER.indexOf(e));
            expect([...idx].sort((a, b) => a - b)).toEqual(idx);
          }
        },
      ),
    );
  });
});
