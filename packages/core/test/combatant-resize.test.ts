import { describe, expect, it } from "vitest";
import {
  Combatant,
  type DamageAttacker,
  Health,
  Rng,
  TagIndex,
  evaluateEffects,
  resolveHit,
  staggerProfiles,
} from "../src/index.ts";
import { effect, fullCombatDb } from "./helpers/content.ts";

/**
 * 能力値が変わったときに、戦う者を作り直さずに最大HP・最大魔障・魔障の回復の遅れを変える
 * （Health.resize・Combatant.resize。PR #17 のレビュー指摘1。2026-11-13）。
 */

/** HP・魔障・被弾からの時間（状態を変えない計画で読み出す）。 */
function healthState(h: Health) {
  const p = h.planUpdate(0);
  return { hp: p.hp, ward: p.ward, sinceHit: p.sinceHit, maxHp: h.maxHp, maxWard: h.maxWard };
}

describe("Health.resize：最大HP・最大魔障・魔障の回復の遅れをその場で変える", () => {
  it("HP・魔障は割合を保ち、最大値が増えても回復しない。被弾からの時間はそのまま", () => {
    const h = new Health({ maxHp: 100, maxWard: 40, wardRechargeDelay: 2 });
    h.takeDamage(60); // 魔障40 → 0、HP 100 → 80
    h.update(2.5); // 2秒後から回復：0.5秒で 40×0.2×0.5 = 4
    expect(h.ward).toBeCloseTo(4, 12);
    const sinceHit = h.planUpdate(0).sinceHit;
    h.resize({ maxHp: 200, maxWard: 80, wardRechargeDelay: 1 });
    expect(h.maxHp).toBe(200);
    expect(h.hp).toBeCloseTo(160, 12);
    expect(h.ward).toBeCloseTo(8, 12);
    expect(h.wardRechargeDelay).toBe(1);
    expect(h.planUpdate(0).sinceHit).toBe(sinceHit);
    // 減らしても割合のまま
    h.resize({ maxHp: 50, maxWard: 20 });
    expect(h.hp).toBeCloseTo(40, 12);
    expect(h.ward).toBeCloseTo(2, 12);
  });

  it("倒れていれば倒れたまま。最大魔障が0から増えたら0から回復する（一度も被弾していなければ、すぐに）", () => {
    const dead = new Health({ maxHp: 100 });
    dead.takeDamage(1000);
    dead.resize({ maxHp: 300 });
    expect(dead.dead).toBe(true);
    const h = new Health({ maxHp: 100 });
    h.resize({ maxHp: 100, maxWard: 50 });
    expect(h.ward).toBe(0);
    h.update(1);
    expect(h.ward).toBeCloseTo(10, 12);
    // 外して着け直しても、満タンには戻らない
    h.resize({ maxHp: 100, maxWard: 0 });
    h.resize({ maxHp: 100, maxWard: 50 });
    expect(h.ward).toBe(0);
  });

  it("不正な値・HPの下限が新しい最大HP以上なら、何も変えずに RangeError", () => {
    const h = new Health({ maxHp: 100, maxWard: 10 });
    h.takeDamage(30);
    h.setFloor(50);
    const before = healthState(h);
    for (const bad of [
      { maxHp: Number.NaN },
      { maxHp: 0 },
      { maxHp: 100, maxWard: -1 },
      { maxHp: 100, wardRechargeDelay: Infinity },
      { maxHp: 50 },
    ]) {
      expect(() => {
        h.resize(bad);
      }).toThrow(RangeError);
      expect(healthState(h)).toEqual(before);
    }
  });
});

const db = fullCombatDb([
  effect("EFF-FORCE-BLEED", "unique", [
    { kind: "flag", flag: "ailmentApply", mode: "force", target: "TAG-AIL-BLEED" },
  ]),
]);
const attacker: DamageAttacker = {
  db,
  view: evaluateEffects(db, new TagIndex(db.tags), [
    { effectId: "EFF-FORCE-BLEED", source: { kind: "test", ref: "t" } },
  ]).view,
  characterLevel: 1,
  weapon: {
    uid: "w",
    tags: ["TAG-WPN-SWORD"],
    base: { physical: { min: 6, max: 11 } },
    critChance: 0,
  },
};

function target(): Combatant {
  return new Combatant(db, {
    id: "t",
    team: "enemy",
    position: { x: 0, y: 0 },
    facing: 0,
    radius: 0.4,
    maxHp: 1000,
    maxWard: 10,
    staggerProfile: staggerProfiles(db).enemy,
  });
}

const hit = (c: Combatant, seed = 1) =>
  resolveHit({
    db,
    attacker,
    attackerPosition: { x: 1, y: 0 },
    skill: { tags: ["TAG-FORM-MELEE"], kind: "weapon", pct: 1 },
    staggerCoefficient: 1,
    target: c,
    rng: Rng.fromSeed(seed),
  });

function combatState(c: Combatant) {
  return {
    health: healthState(c.health),
    stagger: { value: c.stagger.current, max: c.stagger.max, breaks: c.stagger.breaks },
    bleed: c.ailments.stacks("AIL-BLEED"),
    dots: c.ailments.planTick(0).updates.map(({ inst }) => ({
      remaining: inst.remaining,
      remainingTime: inst.remainingTime,
    })),
  };
}

describe("Combatant.resize：状態異常・崩し・一定時間の効果を残す", () => {
  it("出血・崩しゲージの割合・一定時間の効果が残り、HPは割合を保つ", () => {
    const c = target();
    hit(c);
    c.statuses.add("EFF-FORCE-BLEED", 3, "t");
    const before = combatState(c);
    expect(before.bleed).toBe(1);
    expect(before.stagger.value).toBeGreaterThan(0);
    c.resize({ maxHp: 2000, maxWard: 20 });
    const after = combatState(c);
    expect(after.bleed).toBe(1);
    expect(after.dots).toEqual(before.dots);
    expect(after.stagger.breaks).toBe(before.stagger.breaks);
    expect(after.stagger.max).toBeCloseTo(before.stagger.max * 2, 9);
    expect(after.stagger.value / after.stagger.max).toBeCloseTo(
      before.stagger.value / before.stagger.max,
      12,
    );
    expect(after.health.hp / 2000).toBeCloseTo(before.health.hp / 1000, 12);
    expect(c.statuses.remaining("EFF-FORCE-BLEED")).toBe(3);
  });

  it("不正な値なら、HPも崩しゲージも何も変えない", () => {
    const c = target();
    hit(c);
    const before = combatState(c);
    expect(() => {
      c.resize({ maxHp: Infinity });
    }).toThrow(RangeError);
    expect(combatState(c)).toEqual(before);
  });
});
