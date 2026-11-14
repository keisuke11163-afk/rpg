import { describe, expect, it } from "vitest";
import {
  ActionTimeline,
  Combatant,
  type DamageAttacker,
  type DamageSkill,
  FIXED_STEP_SECONDS,
  Health,
  ProjectilePool,
  Rng,
  TagIndex,
  computeHit,
  evaluateEffects,
  isBehind,
  overlapsShape,
  playerAttackTimeline,
  resolveHit,
  staggerProfiles,
} from "../src/index.ts";
import { effect, fullCombatDb } from "./helpers/content.ts";

const deg = (d: number): number => (d * Math.PI) / 180;

describe("当たり判定の形（補助仕様書3.6）", () => {
  const o = { x: 0, y: 0 };
  it("周囲（円）：中心からの距離が、半径＋受ける側の半径以内", () => {
    expect(overlapsShape({ type: "circle", radius: 2 }, o, 0, { x: 2.4, y: 0 }, 0.5)).toBe(true);
    expect(overlapsShape({ type: "circle", radius: 2 }, o, 0, { x: 2.6, y: 0 }, 0.5)).toBe(false);
  });

  it("扇形（通常攻撃は90°・1.6m）：向きの左右45°以内（受ける側の大きさの分だけ余裕）", () => {
    const sweep = { type: "sector" as const, radius: 1.6, angleDeg: 90 };
    expect(overlapsShape(sweep, o, 0, { x: 1.5, y: 0 }, 0.4)).toBe(true);
    expect(overlapsShape(sweep, o, 0, { x: 1.1, y: 1.1 }, 0.05)).toBe(true); // 45°ちょうど
    expect(overlapsShape(sweep, o, 0, { x: 1.2, y: 1.2 }, 0.05)).toBe(false); // 45°だが、届かない（1.70m）
    expect(overlapsShape(sweep, o, 0, { x: 0.3, y: 1.5 }, 0.05)).toBe(false); // 横
    expect(overlapsShape(sweep, o, 0, { x: -1, y: 0 }, 0.3)).toBe(false); // 後ろ
    expect(overlapsShape(sweep, o, Math.PI, { x: -1, y: 0 }, 0.3)).toBe(true); // 向きを変えれば当たる
  });

  it("直線（地割りは6m・幅1.5m）", () => {
    const fissure = { type: "line" as const, length: 6, width: 1.5 };
    expect(overlapsShape(fissure, o, 0, { x: 5.9, y: 0.7 }, 0.1)).toBe(true);
    expect(overlapsShape(fissure, o, 0, { x: 5.9, y: 1.2 }, 0.1)).toBe(false);
    expect(overlapsShape(fissure, o, 0, { x: 6.5, y: 0 }, 0.3)).toBe(false);
    expect(overlapsShape(fissure, o, deg(90), { x: 0, y: 5 }, 0.1)).toBe(true);
  });
});

describe("背面判定（仕様書5.6：敵の後方90°）", () => {
  const target = { x: 0, y: 0 };
  const facingRight = 0;
  it("真後ろと、そこから左右45°以内は背面", () => {
    expect(isBehind({ x: -2, y: 0 }, target, facingRight)).toBe(true);
    expect(isBehind({ x: -2, y: 1.9 }, target, facingRight)).toBe(true);
    expect(isBehind({ x: -2, y: -1.9 }, target, facingRight)).toBe(true);
  });
  it("横や正面は背面ではない", () => {
    expect(isBehind({ x: 0, y: 2 }, target, facingRight)).toBe(false);
    expect(isBehind({ x: 2, y: 0 }, target, facingRight)).toBe(false);
    expect(isBehind({ x: -2, y: 2.3 }, target, facingRight)).toBe(false);
  });
});

describe("攻撃の時間の流れ（補助仕様書10.1）", () => {
  it("予兆 → 当たり判定 → 硬直。当たり判定の始まりと終わりは1回だけ知らせる", () => {
    const t = new ActionTimeline({ windup: 0.2, active: 0.1, recovery: 0.3 });
    const events: string[] = [];
    for (let i = 0; i < 60; i++) {
      const e = t.update(FIXED_STEP_SECONDS);
      if (e.activeStarted) events.push(`active@${String(i)}`);
      if (e.finished) events.push(`end@${String(i)}`);
    }
    expect(events).toEqual(["active@11", "end@35"]);
    expect(t.phase).toBe("done");
  });

  it("プレイヤーの攻撃の時間は、動作の時間を30%・10%・60%に分ける（仮値）", () => {
    const spec = playerAttackTimeline(1 / 1.4);
    expect(spec.windup + spec.active + spec.recovery).toBeCloseTo(1 / 1.4);
    expect(spec.windup).toBeCloseTo(0.3 / 1.4);
  });
});

describe("HPと魔障（仕様書2.6）", () => {
  it("魔障がHPより先に吸収する", () => {
    const h = new Health({ maxHp: 100, maxWard: 30 });
    expect(h.takeDamage(50)).toEqual({ toWard: 30, toHp: 20, died: false });
    expect(h.hp).toBe(80);
    expect(h.takeDamage(500).died).toBe(true);
    expect(h.dead).toBe(true);
    expect(h.takeDamage(10).toHp).toBe(0);
  });

  it("被弾がない状態が2秒続くと、魔障が毎秒20%ずつ回復する", () => {
    const h = new Health({ maxHp: 100, maxWard: 50 });
    h.takeDamage(50);
    h.update(2);
    expect(h.ward).toBe(0);
    h.update(1);
    expect(h.ward).toBeCloseTo(10);
    h.update(10);
    expect(h.ward).toBe(50);
  });
});

describe("投射物の使い回し", () => {
  const target = (id: string, x: number, team = "enemy") => ({
    id,
    team,
    position: { x, y: 0 },
    radius: 0.5,
  });

  it("当たると消え（貫通0）、入れ物が再利用される", () => {
    const pool = new ProjectilePool<string>(2);
    const spawn = () =>
      pool.spawn({
        position: { x: 0, y: 0 },
        direction: { x: 1, y: 0 },
        speed: 10,
        range: 20,
        radius: 0.1,
        pierce: 0,
        team: "player",
        payload: "arrow",
      });
    expect(spawn()).toBe(0);
    expect(spawn()).toBe(1);
    expect(spawn()).toBe(-1); // 空きがない
    const hits = [];
    for (let i = 0; i < 60; i++) hits.push(...pool.update(FIXED_STEP_SECONDS, [target("a", 5)]));
    expect(hits.map((h) => h.targetId)).toEqual(["a", "a"]);
    expect(pool.active).toBe(0);
    expect(spawn()).toBe(0);
  });

  it("速い投射物でもすり抜けない。貫通の数だけ進み、同じ相手には1回だけ当たる。味方には当たらない", () => {
    const pool = new ProjectilePool<null>(1);
    pool.spawn({
      position: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
      speed: 200,
      range: 30,
      radius: 0.1,
      pierce: 1,
      team: "player",
      payload: null,
    });
    const hits = pool.update(0.1, [
      target("ally", 2, "player"),
      target("a", 4),
      target("b", 8),
      target("c", 12),
    ]);
    expect(hits.map((h) => h.targetId)).toEqual(["a", "b"]);
    expect(pool.active).toBe(0);
  });

  it("射程で消える", () => {
    const pool = new ProjectilePool<null>(1);
    pool.spawn({
      position: { x: 0, y: 0 },
      direction: { x: 0, y: 1 },
      speed: 10,
      range: 3,
      radius: 0.1,
      pierce: 0,
      team: "player",
      payload: null,
    });
    pool.update(1, []);
    expect(pool.active).toBe(0);
  });
});

describe("ヒットの解決（開発計画書 工程BT-2）", () => {
  const db = fullCombatDb([
    effect("EFF-FORCE-BLEED", "unique", [
      { kind: "flag", flag: "ailmentApply", mode: "force", target: "TAG-AIL-BLEED" },
    ]),
    // 武器の局所の効果（呪文のヒットには効かない）
    effect("EFF-LOCAL-MORE", "unique", [{ kind: "more", stat: "STAT-DAMAGE", value: 2 }], {
      locality: "local",
    }),
  ]);
  const view = (ids: string[]) =>
    evaluateEffects(
      db,
      new TagIndex(db.tags),
      ids.map((id) => ({ effectId: id, source: { kind: "test", ref: id } })),
    ).view;
  const attacker = (ids: string[] = []): DamageAttacker => ({
    db,
    view: view(ids),
    characterLevel: 1,
    weapon: {
      uid: "w",
      tags: ["TAG-WPN-SWORD"],
      base: { physical: { min: 6, max: 11 } },
      critChance: 0,
    },
  });
  const BASIC: DamageSkill = { tags: ["TAG-FORM-MELEE"], kind: "weapon", pct: 1 };
  const dummy = (facing?: number) =>
    new Combatant(db, {
      id: "dummy",
      team: "enemy",
      position: { x: 0, y: 0 },
      radius: 0.4,
      ...(facing === undefined ? {} : { facing }),
      maxHp: 1000,
      staggerProfile: staggerProfiles(db).enemy,
    });

  it("訓練用の人形を通常攻撃で叩くと、computeHit の計算どおりのダメージがHPから減る", () => {
    const d = dummy(0);
    const r = resolveHit({
      db,
      attacker: attacker(),
      attackerPosition: { x: 1, y: 0 },
      skill: BASIC,
      target: d,
      rng: Rng.fromSeed(1),
      roll: "average",
    });
    const expected = computeHit(
      attacker(),
      BASIC,
      {},
      { rng: Rng.fromSeed(1), roll: "average" },
    ).total;
    expect(r.hit.total).toBeCloseTo(expected);
    expect(d.health.hp).toBeCloseTo(1000 - expected);
    expect(r.applied.toHp).toBeCloseTo(expected);
  });

  it("武器を持って呪文を当てても、状態異常の判定で例外にならず、武器の局所の効果は効かない（魔法使いの杖）", () => {
    const SPELL: DamageSkill = {
      tags: ["TAG-FORM-SPELL", "TAG-ELEM-FIRE"],
      kind: "spell",
      pct: 1,
      base: { fire: { min: 10, max: 10 } },
    };
    const { view } = evaluateEffects(db, new TagIndex(db.tags), [
      { effectId: "EFF-LOCAL-MORE", source: { kind: "equipment", ref: "w" } },
      { effectId: "EFF-FORCE-BLEED", source: { kind: "test", ref: "b" } },
    ]);
    const withStaff: DamageAttacker = { ...attacker(), view };
    const hit = (skill: DamageSkill) =>
      resolveHit({
        db,
        attacker: withStaff,
        attackerPosition: { x: 1, y: 0 },
        skill,
        // 呪文は武器のヒットではないので、武器の uid を状態異常の計算に渡さない
        target: dummy(0),
        rng: Rng.fromSeed(5),
        roll: "average",
      });
    const spell = hit(SPELL);
    expect(spell.hit.weaponUid).toBeUndefined();
    expect(spell.hit.total).toBeCloseTo(10 * 1.0); // 局所の×2は効かない
    expect(hit(BASIC).hit.total).toBeGreaterThan(8.5 * 1.9); // 武器のヒットには効く
  });

  it("ダメージを受けない間（ボスの段階の切り替え・根渡り）のヒットは、ダメージ・状態異常・崩しを与えない", () => {
    const d = dummy(0);
    d.health.invulnerable = true;
    const r = resolveHit({
      db,
      attacker: attacker(["EFF-FORCE-BLEED"]),
      attackerPosition: { x: 1, y: 0 },
      skill: BASIC,
      staggerCoefficient: 5,
      target: d,
      rng: Rng.fromSeed(3),
    });
    expect(r.applied).toEqual({ toWard: 0, toHp: 0, died: false });
    expect(r.ailments).toEqual([]);
    expect(r.staggerValue).toBe(0);
    expect(d.health.hp).toBe(1000);
    expect(d.ailments.stacks("AIL-BLEED")).toBe(0);
    expect(d.stagger.current).toBe(0);
  });

  it("無敵になる前に付いた持続ダメージは、無敵の間は減らさず、時間は進む（切れる時期は変わらない）", () => {
    const d = dummy(0);
    resolveHit({
      db,
      attacker: attacker(["EFF-FORCE-BLEED"]),
      attackerPosition: { x: 1, y: 0 },
      skill: BASIC,
      target: d,
      rng: Rng.fromSeed(4),
    });
    expect(d.ailments.stacks("AIL-BLEED")).toBe(1);
    const hp = d.health.hp;
    d.health.invulnerable = true;
    for (let i = 0; i < 120; i++) d.update(FIXED_STEP_SECONDS);
    expect(d.health.hp).toBe(hp);
    expect(d.ailments.stacks("AIL-BLEED")).toBe(1);
    d.health.invulnerable = false;
    // 出血の持続は5秒：無敵の2秒を含めて、付いてから5秒で切れる
    for (let i = 0; i < 60; i++) d.update(FIXED_STEP_SECONDS);
    expect(d.health.hp).toBeLessThan(hp);
    for (let i = 0; i < 125; i++) d.update(FIXED_STEP_SECONDS);
    expect(d.ailments.stacks("AIL-BLEED")).toBe(0);
  });

  it("HPの下限（ボスの段階の境目）より下には、一度のダメージでも減らない", () => {
    const h = new Health({ maxHp: 100 });
    h.setFloor(66);
    expect(h.takeDamage(1000).toHp).toBe(34);
    expect(h.hp).toBe(66);
    expect(h.takeDamage(10).toHp).toBe(0);
    h.setFloor(0);
    expect(h.takeDamage(1000).died).toBe(true);
    expect(() => {
      h.setFloor(100);
    }).toThrow(RangeError);
    expect(() => {
      h.setFloor(Number.NaN);
    }).toThrow(RangeError);
  });

  it("背面からのヒットを判定する（右を向いた人形の左から＝背面）", () => {
    expect(
      resolveHit({
        db,
        attacker: attacker(),
        attackerPosition: { x: -1, y: 0 },
        skill: BASIC,
        target: dummy(0),
        rng: Rng.fromSeed(2),
      }).backstab,
    ).toBe(true);
    expect(
      resolveHit({
        db,
        attacker: attacker(),
        attackerPosition: { x: 1, y: 0 },
        skill: BASIC,
        target: dummy(0),
        rng: Rng.fromSeed(2),
      }).backstab,
    ).toBe(false);
    expect(
      resolveHit({
        db,
        attacker: attacker(),
        attackerPosition: { x: -1, y: 0 },
        skill: BASIC,
        target: dummy(),
        rng: Rng.fromSeed(2),
      }).backstab,
    ).toBe(false); // 向きなし
  });

  it("状態異常と崩しを、受ける側に加える。持続ダメージは時間とともにHPを減らす", () => {
    const d = dummy(0);
    const r = resolveHit({
      db,
      attacker: attacker(["EFF-FORCE-BLEED"]),
      attackerPosition: { x: 1, y: 0 },
      skill: BASIC,
      target: d,
      rng: Rng.fromSeed(3),
      roll: "average",
      staggerCoefficient: 1,
    });
    expect(r.ailments.map((a) => a.tag)).toEqual(["TAG-AIL-BLEED"]);
    expect(d.ailments.stacks("AIL-BLEED")).toBe(1);
    expect(d.stagger.current).toBeCloseTo(r.hit.preMitigationTotal);
    const hpAfterHit = d.health.hp;
    let dot = 0;
    for (let i = 0; i < 300; i++) dot += d.update(FIXED_STEP_SECONDS);
    expect(dot).toBeCloseTo(8.5 * 1.5);
    expect(d.health.hp).toBeCloseTo(hpAfterHit - dot);
  });

  it("崩れている間は、受けるダメージの倍率がかかる", () => {
    const d = dummy(0);
    const first = resolveHit({
      db,
      attacker: attacker(),
      attackerPosition: { x: 1, y: 0 },
      skill: BASIC,
      target: d,
      rng: Rng.fromSeed(4),
      roll: "average",
      staggerCoefficient: 100,
    });
    expect(first.staggerBroke).toBe(true);
    const second = resolveHit({
      db,
      attacker: attacker(),
      attackerPosition: { x: 1, y: 0 },
      skill: BASIC,
      target: d,
      rng: Rng.fromSeed(4),
      roll: "average",
    });
    expect(second.hit.total).toBeCloseTo(first.hit.total * 1.25);
  });
});
