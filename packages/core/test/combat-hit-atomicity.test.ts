import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ActionTimeline,
  Combatant,
  type CombatantInit,
  type DamageAttacker,
  type DamageSkill,
  type HitInput,
  Rng,
  TagIndex,
  evaluateEffects,
  resolveHit,
  rollAilments,
  staggerProfiles,
  staggerValue,
} from "../src/index.ts";
import { effect, fullCombatDb } from "./helpers/content.ts";

/**
 * PR #10 のレビュー指摘：
 * - P2：resolveHit の例外安全（後の計算で例外になっても、HP・魔障・状態異常・崩しゲージが部分的に変わらない）
 * - P3：ActionTimeline.update の経過時間の累計の溢れ
 */

const MAX = Number.MAX_VALUE;
const db = fullCombatDb([
  effect("EFF-FORCE-BLEED", "unique", [
    { kind: "flag", flag: "ailmentApply", mode: "force", target: "TAG-AIL-BLEED" },
  ]),
]);
const enemyProfile = staggerProfiles(db).enemy; // 最大HPの20%

const view = (ids: string[]) =>
  evaluateEffects(
    db,
    new TagIndex(db.tags),
    ids.map((id) => ({ effectId: id, source: { kind: "test", ref: id } })),
  ).view;
const attacker = (ids: string[] = ["EFF-FORCE-BLEED"]): DamageAttacker => ({
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

function combatant(overrides: Partial<CombatantInit> = {}): Combatant {
  return new Combatant(db, {
    id: "dummy",
    team: "enemy",
    position: { x: 0, y: 0 },
    facing: 0,
    radius: 0.4,
    maxHp: 1000,
    maxWard: 10,
    staggerProfile: enemyProfile,
    ...overrides,
  });
}

/** 既に被弾・崩し・出血を受けている状態にする（変化が見えるように）。 */
function prepared(overrides: Partial<CombatantInit> = {}): Combatant {
  const c = combatant(overrides);
  resolveHit(hitInput(c, { rng: Rng.fromSeed(7), staggerCoefficient: 1 }));
  c.update(0.5);
  return c;
}

function hitInput(target: Combatant, overrides: Partial<HitInput> = {}): HitInput {
  return {
    db,
    attacker: attacker(),
    attackerPosition: { x: 1, y: 0 },
    skill: BASIC,
    target,
    rng: Rng.fromSeed(1),
    roll: "average",
    ...overrides,
  };
}

/** HP・魔障・状態異常・崩しゲージの全て（内部の時間を含む。状態を変えない計画で読み出す）。 */
function fullState(c: Combatant) {
  const health = c.health.planUpdate(0);
  const stagger = c.stagger.planUpdate(0);
  const ailments = c.ailments.planTick(0);
  return {
    health: { hp: health.hp, ward: health.ward, sinceHit: health.sinceHit, dead: c.health.dead },
    stagger: {
      value: stagger.value,
      brokenFor: stagger.brokenFor,
      sinceLast: stagger.sinceLast,
      breaks: c.stagger.breaks,
      broken: c.stagger.broken,
    },
    dots: ailments.updates.map(({ inst }) => ({
      id: inst.def.id,
      remaining: inst.remaining,
      remainingTime: inst.remainingTime,
    })),
    tags: c.ailments.activeTags(),
    bleed: c.ailments.stacks("AIL-BLEED"),
  };
}

/** 例外を起こした個体が、例外を経験していない個体と全く同じに振る舞うこと。 */
function expectSameFuture(a: Combatant, b: Combatant) {
  for (let i = 0; i < 3; i++) {
    const ra = resolveHit(hitInput(a, { rng: Rng.fromSeed(10 + i), staggerCoefficient: 0.5 }));
    const rb = resolveHit(hitInput(b, { rng: Rng.fromSeed(10 + i), staggerCoefficient: 0.5 }));
    expect(ra).toEqual(rb);
    expect(a.update(0.75)).toBe(b.update(0.75));
    expect(fullState(a)).toEqual(fullState(b));
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveHit：後の計算で例外になっても、受ける側の状態を変えない（P2）", () => {
  it("崩し係数が NaN（崩し値の計算で例外）", () => {
    const c = prepared();
    const twin = prepared();
    const before = fullState(c);
    expect(() => resolveHit(hitInput(c, { staggerCoefficient: Number.NaN }))).toThrow(RangeError);
    expect(fullState(c)).toEqual(before);
    expectSameFuture(c, twin);
  });

  it("崩し係数が極端に大きい（崩し値が Infinity に溢れて例外）", () => {
    const c = prepared();
    const twin = prepared();
    const before = fullState(c);
    expect(() => resolveHit(hitInput(c, { staggerCoefficient: MAX }))).toThrow(RangeError);
    expect(fullState(c)).toEqual(before);
    expectSameFuture(c, twin);
  });

  it("崩れたときの次の最大値が溢れる（崩しゲージの計算で例外）", () => {
    // 最大値 200 → 崩れた後は 200 × 1e308 ＝ Infinity
    const overrides = { staggerProfile: { ...enemyProfile, growthPerBreak: 1e308 } };
    const c = prepared(overrides);
    const twin = prepared(overrides);
    const before = fullState(c);
    expect(c.stagger.current).toBeGreaterThan(0);
    expect(() => resolveHit(hitInput(c, { staggerCoefficient: 100 }))).toThrow(RangeError);
    expect(fullState(c)).toEqual(before);
    expectSameFuture(c, twin);
  });

  it("崩しゲージの計画で例外になっても、HP・魔障・状態異常は変わらない", () => {
    const c = prepared();
    const twin = prepared();
    const before = fullState(c);
    vi.spyOn(c.stagger, "planAdd").mockImplementationOnce(() => {
      throw new RangeError("崩しゲージの計算の失敗（試験）");
    });
    expect(() => resolveHit(hitInput(c, { staggerCoefficient: 1 }))).toThrow(RangeError);
    expect(fullState(c)).toEqual(before);
    expectSameFuture(c, twin);
  });

  it("状態異常の付与の検証で例外になっても、HP・魔障・崩しゲージは変わらない", () => {
    const c = prepared();
    const twin = prepared();
    const before = fullState(c);
    vi.spyOn(c.ailments, "planApply").mockImplementationOnce(() => {
      throw new RangeError("状態異常の付与の検証の失敗（試験）");
    });
    expect(() => resolveHit(hitInput(c, { staggerCoefficient: 1 }))).toThrow(RangeError);
    expect(fullState(c)).toEqual(before);
    expectSameFuture(c, twin);
  });

  it("死亡させるヒットでも、例外なら死亡しない", () => {
    const c = combatant({ maxHp: 1, maxWard: 0 });
    const before = fullState(c);
    expect(() => resolveHit(hitInput(c, { staggerCoefficient: Number.NaN }))).toThrow(RangeError);
    expect(fullState(c)).toEqual(before);
    expect(c.health.dead).toBe(false);
  });
});

describe("resolveHit：正常なヒットは、従来の順（takeDamage → apply → add）と同じ結果", () => {
  it.each([
    [0, 1],
    [1, 0.5],
    [2, 100], // 崩れる
    [3, 0],
  ])("seed %i・崩し係数 %d", (seed, coefficient) => {
    const a = prepared();
    const b = prepared();
    const report = resolveHit(
      hitInput(a, { rng: Rng.fromSeed(seed), staggerCoefficient: coefficient }),
    );

    // 従来の順（状態を順に変える）
    const rng = Rng.fromSeed(seed);
    const atk = attacker();
    const hit = report.hit;
    expect(hit.total).toBeGreaterThan(0);
    // ダメージは resolveHit と同じ値（平均の値）を使う。出血は必ず付与（乱数で判定しない）
    const applied = b.health.takeDamage(hit.total);
    const tags = [...BASIC.tags, ...(atk.weapon?.tags ?? [])];
    const ailments = rollAilments({ db, view: atk.view, hit, tags, weaponUid: "w", rng });
    for (const app of ailments) b.ailments.apply(app);
    const value = staggerValue({
      db,
      view: atk.view,
      hit,
      tags,
      coefficient,
      weaponUid: "w",
    });
    const broke = b.stagger.add(value);

    expect(report.applied).toEqual(applied);
    expect(report.ailments).toEqual(ailments);
    expect(report.staggerValue).toBe(value);
    expect(report.staggerBroke).toBe(broke);
    expect(fullState(a)).toEqual(fullState(b));
  });
});

describe("ActionTimeline.update：経過時間の累計の溢れ（P3）", () => {
  const elapsedOf = (t: ActionTimeline): number => (t as unknown as { elapsed: number }).elapsed;

  it("dt は有限でも累計が Infinity になる場合は拒否し、経過時間・イベントの状態を変えない", () => {
    const t = new ActionTimeline({ windup: MAX, active: 0, recovery: 0 });
    expect(t.update(MAX * 0.75)).toEqual({ activeStarted: false, finished: false });
    const before = { elapsed: elapsedOf(t), phase: t.phase, progress: t.progress };
    expect(before.phase).toBe("windup");
    expect(() => t.update(MAX * 0.5)).toThrow(RangeError);
    expect({ elapsed: elapsedOf(t), phase: t.phase, progress: t.progress }).toEqual(before);
    // イベントは、例外の後も正しい時刻に1回ずつだけ起きる
    expect(t.update(MAX * 0.25)).toEqual({ activeStarted: true, finished: true });
    expect(t.phase).toBe("done");
    expect(t.update(0)).toEqual({ activeStarted: false, finished: false });
  });

  it("当たり判定の始まりを知らせた後でも、終わりは例外の後に1回だけ知らせる", () => {
    const t = new ActionTimeline({ windup: 0, active: 0, recovery: MAX });
    expect(t.update(MAX * 0.75)).toEqual({ activeStarted: true, finished: false });
    const before = { elapsed: elapsedOf(t), phase: t.phase, progress: t.progress };
    expect(before.phase).toBe("recovery");
    expect(() => t.update(MAX)).toThrow(RangeError);
    expect({ elapsed: elapsedOf(t), phase: t.phase, progress: t.progress }).toEqual(before);
    expect(t.update(MAX * 0.25)).toEqual({ activeStarted: false, finished: true });
    expect(t.update(0)).toEqual({ activeStarted: false, finished: false });
  });

  it("動作が終わった後に累計が溢れる場合も拒否し、イベントを再び起こさない", () => {
    const t = new ActionTimeline({ windup: 0.2, active: 0.1, recovery: 0.3 });
    expect(t.update(MAX)).toEqual({ activeStarted: true, finished: true });
    expect(() => t.update(MAX)).toThrow(RangeError);
    expect(elapsedOf(t)).toBe(MAX);
    expect(t.phase).toBe("done");
    expect(t.update(0)).toEqual({ activeStarted: false, finished: false });
  });
});
