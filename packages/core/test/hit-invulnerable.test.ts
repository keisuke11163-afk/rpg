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
 * develop（bccfd63 の3段階）の取り込みで組み直した、ダメージを受けない間のヒット（2026-11-13）。
 * 無敵の判定は計画の段階で行い、無効にしたヒットは何も反映しない。
 */

/** HP・魔障・被弾からの時間（状態を変えない計画で読み出す）。 */
function healthState(h: Health) {
  const p = h.planUpdate(0);
  return { hp: p.hp, ward: p.ward, sinceHit: p.sinceHit, maxHp: h.maxHp, maxWard: h.maxWard };
}

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

describe("resolveHit：ダメージを受けない間のヒットは何も与えない（develop の取り込みで段階1に置いた）", () => {
  it("ダメージ・魔障・出血（必ず付く）・崩しを与えず、何も変えない", () => {
    const c = target();
    hit(c, 3);
    c.health.invulnerable = true;
    const before = combatState(c);
    const r = hit(c, 4);
    expect(r.applied).toEqual({ toWard: 0, toHp: 0, died: false });
    expect(r.ailments).toEqual([]);
    expect(r.staggerValue).toBe(0);
    expect(r.staggerBroke).toBe(false);
    expect(combatState(c)).toEqual(before);
    // 無敵でなければ、同じヒットで出血が付く（前提の確認）
    c.health.invulnerable = false;
    expect(hit(c, 4).ailments).toHaveLength(1);
  });
});
