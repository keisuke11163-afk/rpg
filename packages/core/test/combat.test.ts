import { describe, expect, it } from "vitest";
import {
  AttackRunner,
  ProjectilePool,
  WEAPONS,
  basicAttackTiming,
  computeDamage,
  createCombatant,
  createRng,
  createTrainingDummy,
  isBackHit,
  resolveHit,
  shapeHits,
  strike,
  type DamageInput,
  type HitSpec,
} from "../src/index.ts";

const sword = WEAPONS["longsword"];
if (!sword) throw new Error("武器");
const damage: DamageInput = { base: { physical: 8 }, skillMultiplier: 1 };
const spec: HitSpec = {
  shape: { kind: "cone", range: 1.6, arcDegrees: 90 },
  damage,
  weaponCrit: 0,
  accuracy: 100,
};
const at = (x: number, y = 0) => ({ x, y });

describe("当たり判定の形", () => {
  const c = (x: number, y: number) => ({ pos: at(x, y), radius: 0.5 });
  it("扇形：範囲と角度", () => {
    const cone = { kind: "cone", range: 1.6, arcDegrees: 90 } as const;
    expect(shapeHits(cone, at(0), 0, c(1.5, 0))).toBe(true);
    expect(shapeHits(cone, at(0), 0, c(3, 0))).toBe(false);
    expect(shapeHits(cone, at(0), 0, c(0, 1.5))).toBe(false);
    expect(shapeHits(cone, at(0), 0, c(1.2, 1.0))).toBe(true);
    expect(shapeHits(cone, at(0), 0, c(-1, 0))).toBe(false);
  });
  it("円と直線", () => {
    expect(shapeHits({ kind: "circle", radius: 2 }, at(0), 0, c(-2, 0))).toBe(true);
    expect(shapeHits({ kind: "circle", radius: 2 }, at(0), 0, c(3, 0))).toBe(false);
    const line = { kind: "line", length: 6, width: 1.5 } as const;
    expect(shapeHits(line, at(0), 0, c(5, 0.5))).toBe(true);
    expect(shapeHits(line, at(0), 0, c(5, 2))).toBe(false);
    expect(shapeHits(line, at(0), Math.PI / 2, c(0, 5))).toBe(true);
    expect(shapeHits(line, at(0), 0, c(-3, 0))).toBe(false);
  });
});

describe("背面の判定", () => {
  it("敵の向きと反対側から攻撃すると背面", () => {
    // 敵は左（π）を向いている → 右側（x>0）が背面
    expect(isBackHit(at(2), at(0), Math.PI)).toBe(true);
    expect(isBackHit(at(-2), at(0), Math.PI)).toBe(false);
    expect(isBackHit(at(0, 2), at(0), Math.PI)).toBe(false);
  });
});

describe("ヒットの解決", () => {
  it("人形を叩くと、ルールの中核の計算どおりのダメージが出る", () => {
    const dummy = createTrainingDummy(at(1.2));
    const expected = computeDamage(damage).total;
    const out = strike(at(0), 0, [dummy], spec, createRng(1));
    expect(out).toHaveLength(1);
    expect(out[0]?.result.damage).toBeCloseTo(expected);
    expect(dummy.hp).toBeCloseTo(dummy.maxHp - expected);
  });
  it("背面からのヒットが判定され、背面の会心率が乗る", () => {
    const front = createTrainingDummy(at(1.2), Math.PI); // 攻撃者のほうを向く（正面）
    const back = createTrainingDummy(at(1.2), 0); // 反対を向く（背面）
    const s: HitSpec = { ...spec, weaponCrit: 0, backCritAdd: 1 };
    const a = resolveHit(at(0), front, s, createRng(1));
    const b = resolveHit(at(0), back, s, createRng(1));
    expect(a.back).toBe(false);
    expect(a.crit).toBe(false);
    expect(b.back).toBe(true);
    expect(b.crit).toBe(true);
    expect(b.damage).toBeCloseTo(a.damage * 1.5);
  });
  it("範囲外・倒れた対象には当たらない", () => {
    const far = createTrainingDummy(at(5));
    expect(strike(at(0), 0, [far], spec, createRng(1))).toHaveLength(0);
    const dead = createCombatant({ id: "D", pos: at(1), maxHp: 1 });
    dead.hp = 0;
    expect(strike(at(0), 0, [dead], spec, createRng(1))).toHaveLength(0);
  });
  it("崩しが溜まって、崩れる。崩れると受けるダメージが増える", () => {
    const e = createCombatant({ id: "E", pos: at(1), maxHp: 100 });
    const s: HitSpec = {
      ...spec,
      damage: { base: { physical: 40 }, skillMultiplier: 1 },
      breakCoefficient: 0.5,
    };
    let broke = false;
    for (let i = 0; i < 5 && !broke; i++) broke = resolveHit(at(0), e, s, createRng(i)).broke;
    expect(broke).toBe(true);
    expect(e.breakGauge.damageTakenMultiplier).toBe(1.25);
  });
  it("必ず付与する状態異常（罠の出血）", () => {
    const e = createCombatant({ id: "E", pos: at(1), maxHp: 1000 });
    const r = resolveHit(at(0), e, { ...spec, forcedAilments: ["bleed"] }, createRng(1));
    expect(r.appliedAilments).toContain("bleed");
    expect(e.ailments.stackCount("bleed")).toBe(1);
  });
  it("回避される・呪文は回避されない", () => {
    const e = createCombatant({ id: "E", pos: at(1), maxHp: 100, evasion: 1e9 });
    const s: HitSpec = { ...spec, accuracy: 1 };
    let misses = 0;
    for (let i = 0; i < 200; i++) if (!resolveHit(at(0), e, s, createRng(i)).hit) misses++;
    expect(misses).toBeGreaterThan(120);
    expect(resolveHit(at(0), e, { ...s, isSpell: true }, createRng(1)).hit).toBe(true);
  });
  it("会心・崩しで、ヒットの手応え（ヒットストップ）が大きくなる", () => {
    const e = createCombatant({ id: "E", pos: at(1), maxHp: 1e6 });
    const normal = resolveHit(at(0), e, { ...spec, weaponCrit: 0 }, createRng(1));
    const crit = resolveHit(at(0), e, { ...spec, weaponCrit: 1 }, createRng(1));
    expect(crit.feedback.hitStopSeconds).toBeGreaterThan(normal.feedback.hitStopSeconds);
  });
});

describe("攻撃の時刻のデータ", () => {
  it("通常攻撃は「1÷攻撃速度」秒で、ヒットは動作の途中で1回", () => {
    const t = basicAttackTiming(sword.speed);
    expect(t.totalSeconds).toBeCloseTo(1 / 1.4);
    const runner = new AttackRunner(t);
    const fired: number[] = [];
    for (let i = 0; i < 60 && !runner.done; i++) fired.push(...runner.step(1 / 60));
    expect(fired).toEqual([0]);
  });
});

describe("投射物", () => {
  it("使い回す。当たると消え、貫通なら続く。射程で消える", () => {
    const pool = new ProjectilePool();
    const target = { id: "T", pos: at(3), radius: 0.5, hp: 10 };
    const p = pool.spawn({ pos: at(0), angle: 0, speed: 10, radius: 0.2, range: 8 });
    let hits = 0;
    for (let i = 0; i < 60; i++) hits += pool.step(1 / 60, [target]).length;
    expect(hits).toBe(1);
    expect(p.active).toBe(false);
    const q = pool.spawn({ pos: at(0), angle: 0, speed: 10, radius: 0.2, range: 8, pierce: 1 });
    expect(q).toBe(p);
    expect(pool.capacity).toBe(1);
    for (let i = 0; i < 120; i++) pool.step(1 / 60, [target]);
    expect(pool.activeCount).toBe(0);
  });
});
