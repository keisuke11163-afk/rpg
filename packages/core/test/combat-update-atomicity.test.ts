import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AilmentApplication,
  Combatant,
  type CombatantInit,
  Health,
  StaggerGauge,
  staggerProfiles,
} from "../src/index.ts";
import { fullCombatDb } from "./helpers/content.ts";

/**
 * Combatant.update の例外安全（PR #10 のレビュー指摘 P3）。
 * 途中の計算（持続ダメージ・HPと魔障・崩しゲージ）のどれが失敗しても、
 * 状態異常・HP・魔障・崩しゲージ・経過時間が部分的に変わらないことを確かめる。
 */

const MAX = Number.MAX_VALUE;
const db = fullCombatDb();
const enemyProfile = staggerProfiles(db).enemy; // 最大HPの20%・3秒後から毎秒10%減る・崩れて2秒

function combatant(overrides: Partial<CombatantInit> = {}): Combatant {
  return new Combatant(db, {
    id: "dummy",
    team: "enemy",
    position: { x: 0, y: 0 },
    radius: 0.4,
    maxHp: 1000,
    maxWard: 100,
    staggerProfile: enemyProfile,
    ...overrides,
  });
}

const dot = (
  ailmentId: string,
  total: number,
  duration: number,
  maxStacks?: number,
): AilmentApplication => ({
  ailmentId,
  tag: `TAG-${ailmentId}`,
  total,
  duration,
  maxStacks,
});
const burn = (total: number, duration = 4) => dot("AIL-BURN", total, duration);
const poison = (total: number, duration = 4) => dot("AIL-POISON", total, duration);
const bleed = (total: number, duration = 5) => dot("AIL-BLEED", total, duration, 8);
const weaken = (duration = 4): AilmentApplication => ({
  ailmentId: "AIL-WEAKEN",
  tag: "TAG-AIL-WEAKEN",
  total: 0,
  duration,
  maxStacks: undefined,
});

/**
 * Combatant の状態の全て（内部の経過時間を含む）。
 * 内部の値は、状態を変えない計画（経過時間0）で読み出す：
 * - 崩しゲージ：値・崩れている残り時間・崩しを受けていない時間・崩れた回数
 * - HP：HP・魔障・被弾からの時間
 * - 状態異常：持続ダメージ1つずつの残りの量・残り時間、衰弱の有無と次に切れる時間
 */
function fullState(c: Combatant) {
  const stagger = c.stagger.planUpdate(0);
  const health = c.health.planUpdate(0);
  const ailments = c.ailments.planTick(0);
  return {
    health: { hp: health.hp, ward: health.ward, sinceHit: health.sinceHit, dead: c.health.dead },
    stagger: {
      value: stagger.value,
      brokenFor: stagger.brokenFor,
      sinceLast: stagger.sinceLast,
      breaks: c.stagger.breaks,
      max: c.stagger.max,
    },
    dots: ailments.updates.map(({ inst }) => ({
      id: inst.def.id,
      remaining: inst.remaining,
      remainingTime: inst.remainingTime,
    })),
    tags: c.ailments.activeTags(),
    nextExpiry: c.ailments.nextDotExpiry(),
    dealt: c.ailments.dealtMultiplier(false),
  };
}

/** 同じ準備をした2体（片方だけで例外を起こし、その後の振る舞いを比べる）。 */
function pair(setup: (c: Combatant) => void, overrides: Partial<CombatantInit> = {}) {
  const a = combatant(overrides);
  const b = combatant(overrides);
  setup(a);
  setup(b);
  return [a, b] as const;
}

/** 例外の後も、例外を経験していない個体と全く同じに振る舞うこと（時間が進んでいないこと）。 */
function expectSameFuture(a: Combatant, b: Combatant) {
  for (const dt of [0.25, 0.5, 1, 2, 3, 5]) {
    expect(a.update(dt)).toBe(b.update(dt));
    expect(fullState(a)).toEqual(fullState(b));
  }
}

/** 修正前の Combatant.update と同じ順で、各部品の update を直接呼ぶ（通常の dt での比較用）。 */
function referenceUpdate(c: Combatant, dt: number): number {
  const out = c.ailments.tick(dt, {
    resist: c.resist,
    takenMultiplier: c.takenMultiplier,
    moving: c.moving,
  });
  let total = 0;
  for (const v of Object.values(out)) total += v;
  if (total > 0) c.health.takeDamage(total);
  c.stagger.update(dt);
  c.health.update(dt);
  return total;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. 極端に大きな有限の dt
// ---------------------------------------------------------------------------

describe("Combatant.update：極端に大きな有限の dt", () => {
  it("1回なら正しく計算する（崩しゲージは0に、魔障は最大まで回復、持続ダメージは全て受ける）", () => {
    const c = combatant();
    c.health.takeDamage(50); // 魔障 100 → 50
    c.stagger.add(100); // 最大 200 の半分
    c.ailments.apply(burn(100, 4));
    c.ailments.apply(weaken(4));
    // 修正前は「最大値 × 毎秒の割合 × 時間」が Infinity になり RangeError（巨大な dt を一律に拒否していた）
    expect(c.update(MAX)).toBeCloseTo(100, 10);
    const s = fullState(c);
    expect(s.stagger.value).toBe(0);
    expect(s.stagger.sinceLast).toBe(MAX);
    expect(s.health.ward).toBe(100); // 燃焼の100で魔障0 → 2秒後から回復し、最大で止まる
    expect(s.health.hp).toBe(950); // 魔障50の残りの50がHPへ
    expect(s.health.sinceHit).toBe(MAX);
    expect(s.dots).toEqual([]);
    expect(s.tags).toEqual([]);
  });

  it("崩しを受けていない時間の累計が溢れる場合は RangeError で、状態は何も変わらない", () => {
    const [a, b] = pair((c) => {
      c.update(MAX); // 崩しを受けていない時間 = MAX（被弾していないので、被弾からの時間は Infinity のまま）
      c.health.takeDamage(30); // 魔障 100 → 70、被弾からの時間 0
      c.ailments.apply(burn(100, 4));
      c.ailments.apply(bleed(50, 5));
      c.ailments.apply(weaken(4));
    });
    const before = fullState(a);
    // 前提：崩しゲージ以外の計算は成功する
    expect(() => a.ailments.planTick(MAX)).not.toThrow();
    expect(() => a.health.planUpdate(MAX, 150)).not.toThrow();
    expect(() => a.update(MAX)).toThrow(/崩しを受けていない時間/);
    expect(fullState(a)).toEqual(before);
    expect(fullState(a)).toEqual(fullState(b));
    expectSameFuture(a, b);
  });

  it("被弾からの時間の累計が溢れる場合は RangeError で、状態は何も変わらない", () => {
    // 火に完全耐性：燃焼は時間とともに減るが、ダメージは0（被弾からの時間が0に戻らない）
    const [a, b] = pair(
      (c) => {
        c.health.takeDamage(1); // 被弾からの時間 0
        c.update(MAX); // 被弾からの時間 = MAX
        c.stagger.add(10); // 崩しを受けていない時間 0（崩しゲージの計算は成功する）
        c.ailments.apply(burn(100, 4));
        c.ailments.apply(weaken(4));
      },
      { resist: { fire: 1 } },
    );
    const before = fullState(a);
    expect(before.health.sinceHit).toBe(MAX);
    expect(() => a.stagger.planUpdate(MAX)).not.toThrow();
    expect(() => a.update(MAX)).toThrow(/被弾からの時間/);
    expect(fullState(a)).toEqual(before);
    expect(fullState(a)).toEqual(fullState(b));
    expectSameFuture(a, b);
  });

  it("一度も被弾していない（Infinity）なら、巨大な dt を何度与えても溢れにならない", () => {
    const c = combatant();
    c.update(MAX);
    c.stagger.add(1);
    expect(() => c.update(MAX)).not.toThrow();
    expect(fullState(c).health.sinceHit).toBe(Infinity);
  });
});

// ---------------------------------------------------------------------------
// 2. 部品の計算の失敗（計画の段階での例外）
// ---------------------------------------------------------------------------

describe("Combatant.update：途中の計算が失敗しても、部分的に変わらない", () => {
  const setup = (c: Combatant) => {
    c.health.takeDamage(50); // 魔障 100 → 50、被弾からの時間 0
    c.stagger.add(100);
    c.update(1); // 時間を少し進めておく（被弾からの時間・崩しを受けていない時間 1）
    c.ailments.apply(burn(100, 4));
    c.ailments.apply(poison(40, 4));
    c.ailments.apply(weaken(4));
  };

  it("StaggerGauge の計算が失敗：崩しゲージ・経過時間・状態異常・HP・魔障が変わらない", () => {
    const [a, b] = pair(setup);
    const before = fullState(a);
    const spy = vi.spyOn(a.stagger, "planUpdate").mockImplementation(() => {
      throw new RangeError("崩しゲージの計算の失敗（試験）");
    });
    expect(() => a.update(1)).toThrow(/崩しゲージの計算の失敗/);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    expect(fullState(a)).toEqual(before);
    expect(fullState(a)).toEqual(fullState(b));
    expectSameFuture(a, b);
  });

  it("Health の計算が失敗：状態が変わらない", () => {
    const [a, b] = pair(setup);
    const before = fullState(a);
    const spy = vi.spyOn(a.health, "planUpdate").mockImplementation(() => {
      throw new RangeError("HPの計算の失敗（試験）");
    });
    expect(() => a.update(1)).toThrow(/HPの計算の失敗/);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    expect(fullState(a)).toEqual(before);
    expect(fullState(a)).toEqual(fullState(b));
    expectSameFuture(a, b);
  });

  it("持続ダメージの事前計算が失敗（属性ごとの溢れ）：状態が変わらない", () => {
    // 火が弱点（2倍）で、燃焼1つ分の受けるダメージが Infinity に溢れる
    const [a, b] = pair((c) => {
      setup(c);
      c.ailments.apply(burn(0.75 * MAX, 1));
    });
    a.resist = { fire: -1 };
    const before = fullState(a);
    expect(() => a.update(1)).toThrow(/受けるダメージ/);
    expect(fullState(a)).toEqual(before);
    a.resist = {};
    expect(fullState(a)).toEqual(fullState(b));
    expectSameFuture(a, b);
  });

  it("持続ダメージの事前計算が失敗（耐性が NaN）：状態が変わらない", () => {
    const [a, b] = pair(setup);
    a.resist = { dark: Number.NaN };
    const before = fullState(a);
    expect(() => a.update(1)).toThrow(RangeError);
    expect(fullState(a)).toEqual(before);
    a.resist = {};
    expect(fullState(a)).toEqual(fullState(b));
    expectSameFuture(a, b);
  });

  it("持続ダメージの合計の溢れ：状態が変わらない", () => {
    const [a, b] = pair((c) => {
      setup(c);
      c.ailments.apply(burn(MAX, 1));
      c.ailments.apply(poison(MAX, 1));
    });
    const before = fullState(a);
    expect(() => a.update(1)).toThrow(/持続ダメージの合計/);
    expect(fullState(a)).toEqual(before);
    expect(fullState(a)).toEqual(fullState(b));
  });

  it("全ての計算（計画）が終わってから反映する（反映の途中に計算はない）", () => {
    const c = combatant();
    setup(c);
    const calls = {
      planTick: vi.spyOn(c.ailments, "planTick"),
      planHealth: vi.spyOn(c.health, "planUpdate"),
      planStagger: vi.spyOn(c.stagger, "planUpdate"),
      commitTick: vi.spyOn(c.ailments, "commitTick"),
      commitHealth: vi.spyOn(c.health, "commitUpdate"),
      commitStagger: vi.spyOn(c.stagger, "commitUpdate"),
      // 反映の段階で、状態を変える他の入口を使わない
      tick: vi.spyOn(c.ailments, "tick"),
      takeDamage: vi.spyOn(c.health, "takeDamage"),
      healthUpdate: vi.spyOn(c.health, "update"),
      staggerUpdate: vi.spyOn(c.stagger, "update"),
    };
    c.update(1);
    const order = (s: { mock: { invocationCallOrder: number[] } }) => {
      expect(s.mock.invocationCallOrder).toHaveLength(1);
      return s.mock.invocationCallOrder[0] ?? Number.NaN;
    };
    const lastPlan = Math.max(
      order(calls.planTick),
      order(calls.planHealth),
      order(calls.planStagger),
    );
    const firstCommit = Math.min(
      order(calls.commitTick),
      order(calls.commitHealth),
      order(calls.commitStagger),
    );
    expect(lastPlan).toBeLessThan(firstCommit);
    for (const s of [calls.tick, calls.takeDamage, calls.healthUpdate, calls.staggerUpdate])
      expect(s).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. 通常の dt では従来どおり
// ---------------------------------------------------------------------------

describe("Combatant.update：通常の dt では従来と全く同じ結果", () => {
  /** 修正前の順序（tick → takeDamage → stagger.update → health.update）と、1刻みずつ比べる。 */
  function compare(
    setup: (c: Combatant) => void,
    steps: readonly number[],
    overrides: Partial<CombatantInit> = {},
  ) {
    const [a, b] = pair(setup, overrides);
    for (const dt of steps) {
      expect(a.update(dt)).toBe(referenceUpdate(b, dt));
      expect(fullState(a)).toEqual(fullState(b));
    }
    return a;
  }
  const frames = (n: number) => Array.from({ length: n }, () => 1 / 60);

  it("持続ダメージ・魔障が先に吸収・魔障の回復（2秒後から毎秒20%）", () => {
    const c = compare(
      (x) => {
        x.ailments.apply(burn(100, 4));
        x.ailments.apply(poison(40, 2));
      },
      [...frames(600), 0.5, 2, 3],
    );
    expect(c.health.ward).toBe(100);
    expect(c.health.hp).toBeCloseTo(1000 - 40, 9);
  });

  it("状態異常の時間経過・移動中の出血・衰弱が切れる", () => {
    const c = compare(
      (x) => {
        x.moving = true;
        x.ailments.apply(bleed(50, 5));
        x.ailments.apply(weaken(3));
      },
      [...frames(240), 1, 2],
      { maxWard: 0, resist: { physical: 0.5 } },
    );
    expect(c.ailments.activeTags()).toEqual([]);
    expect(c.health.hp).toBeCloseTo(1000 - 50, 9);
  });

  it("崩しゲージの減少（3秒後から毎秒10%）・崩れている時間の経過・受けるダメージの倍率", () => {
    const c = compare(
      (x) => {
        x.stagger.add(150);
      },
      [...frames(300), 0.5, 1],
    );
    // 最大 200：6.5秒のうち、3秒後からの3.5秒で 200 × 10% × 3.5 = 70 減る
    expect(c.stagger.current).toBeCloseTo(80, 9);
    const d = compare(
      (x) => {
        x.stagger.add(200); // 崩れる（2秒）
        x.ailments.apply(burn(100, 4));
      },
      [...frames(180), 1],
      { maxWard: 0 },
    );
    expect(d.stagger.broken).toBe(false);
  });

  it("死亡：持続ダメージで HP が0になった後は、ダメージも魔障の回復も起きない", () => {
    const c = compare(
      (x) => {
        x.ailments.apply(burn(2000, 2));
      },
      [...frames(150), 1, 5],
      { maxHp: 500, maxWard: 50 },
    );
    expect(c.health.dead).toBe(true);
    expect(c.health.hp).toBe(0);
    expect(c.health.ward).toBe(0);
  });

  it("dt = 0 は何も変えない", () => {
    const c = combatant();
    c.health.takeDamage(20);
    c.stagger.add(30);
    c.ailments.apply(burn(100, 4));
    const before = fullState(c);
    expect(c.update(0)).toBe(0);
    expect(fullState(c)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// 4. 部品ごとの計画（状態を変えない）と反映
// ---------------------------------------------------------------------------

describe("StaggerGauge.planUpdate・commitUpdate", () => {
  it("planUpdate は状態を変えず、update と同じ結果を commitUpdate で反映する", () => {
    const a = new StaggerGauge(enemyProfile, 1000);
    const b = new StaggerGauge(enemyProfile, 1000);
    a.add(120);
    b.add(120);
    for (const dt of [1, 1.5, 0.75, 2, 4]) {
      const plan = a.planUpdate(dt);
      expect(a.planUpdate(0)).toEqual(b.planUpdate(0)); // 計画では変わらない
      a.commitUpdate(plan);
      b.update(dt);
      expect(a.planUpdate(0)).toEqual(b.planUpdate(0));
      expect(a.current).toBe(b.current);
    }
  });

  it("減る量が Infinity に溢れても、正しく0まで減る（崩しを受けていない時間は有限）", () => {
    const g = new StaggerGauge({ ...enemyProfile, decayPerSecond: 1e300 }, 1e10);
    g.add(1e9);
    g.update(10); // 減り始めて7秒：1e10 × 0.2 × 1e300 × 7 は溢れる
    expect(g.current).toBe(0);
  });

  it("毎秒の割合が0なら、巨大な dt でも減らない", () => {
    const g = new StaggerGauge({ ...enemyProfile, decayPerSecond: 0 }, 1000);
    g.add(50);
    g.update(MAX);
    expect(g.current).toBe(50);
  });

  it("崩しを受けていない時間が溢れる場合は、崩れている時間も値も変えずに RangeError", () => {
    // 崩れている時間が長い設定（崩れている間に溢れる場合も、崩れている時間が変わらないことを見る）
    const g = new StaggerGauge({ ...enemyProfile, breakDuration: MAX }, 1000);
    expect(g.add(200)).toBe(true); // 崩れる（MAX 秒）。崩しを受けていない時間 0
    g.update(1e308); // 崩しを受けていない時間 1e308、崩れている残り MAX - 1e308
    expect(g.broken).toBe(true);
    const before = g.planUpdate(0);
    expect(before.sinceLast).toBe(1e308);
    expect(before.brokenFor).toBe(MAX - 1e308);
    expect(() => {
      g.update(1e308); // 2e308 は溢れる
    }).toThrow(/崩しを受けていない時間/);
    expect(g.planUpdate(0)).toEqual(before);
    expect(g.broken).toBe(true);
    expect(g.breaks).toBe(1);
  });
});

describe("Health.planUpdate・commitUpdate", () => {
  it("planUpdate(dt, damage) は状態を変えず、takeDamage(damage) → update(dt) と同じ結果になる", () => {
    const a = new Health({ maxHp: 300, maxWard: 60 });
    const b = new Health({ maxHp: 300, maxWard: 60 });
    for (const [dt, dmg] of [
      [0.5, 40],
      [1, 0],
      [2.5, 0],
      [1, 100],
      [3, 0],
      [0, 500],
      [1, 10],
    ] as const) {
      const plan = a.planUpdate(dt, dmg);
      expect(a.hp).toBe(b.hp);
      expect(a.ward).toBe(b.ward);
      a.commitUpdate(plan);
      expect(plan.applied).toEqual(b.takeDamage(dmg));
      b.update(dt);
      expect(a.planUpdate(0)).toEqual(b.planUpdate(0));
    }
    expect(a.dead).toBe(true);
  });

  it("不正な damage・dt は、状態を変えずに RangeError", () => {
    const h = new Health({ maxHp: 100, maxWard: 10 });
    h.takeDamage(5);
    const before = h.planUpdate(0);
    for (const bad of [Number.NaN, Infinity, -Infinity, -1]) {
      expect(() => h.planUpdate(bad)).toThrow(/経過時間/);
      expect(() => h.planUpdate(1, bad)).toThrow(/ダメージ/);
    }
    expect(h.planUpdate(0)).toEqual(before);
  });

  it("魔障の回復量が Infinity に溢れても、正しく最大魔障で止まる", () => {
    const h = new Health({ maxHp: 100, maxWard: 1e300 });
    h.takeDamage(1e300);
    h.update(1e10); // 1e300 × 0.2 × (1e10 - 2) は溢れる
    expect(h.ward).toBe(1e300);
  });

  it("被弾からの時間が溢れる場合は、HP・魔障を変えずに RangeError", () => {
    const h = new Health({ maxHp: 100, maxWard: 10 });
    h.takeDamage(15); // 魔障0・HP 95
    h.update(MAX);
    expect(h.ward).toBe(10);
    h.heal(0);
    const before = h.planUpdate(0);
    expect(() => {
      h.update(MAX);
    }).toThrow(/被弾からの時間/);
    expect(h.planUpdate(0)).toEqual(before);
    // ダメージを受けると被弾からの時間が0に戻るので、同じ dt でも溢れない
    expect(() => h.planUpdate(MAX, 1)).not.toThrow();
  });
});
