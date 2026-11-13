import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AilmentApplication,
  type ContentDb,
  Cooldowns,
  Enemy,
  type EnemyEvent,
  type EnemyTarget,
  FIXED_STEP_SECONDS,
  ProjectilePool,
  Rng,
} from "../src/index.ts";
import { fullCombatDb, tag } from "./helpers/content.ts";

/**
 * Enemy.update の時間の検証と例外安全（PR #12 のレビュー指摘 P2）。
 * - 経過時間が0以上の有限の数でない・状態の経過時間の累計が溢れる・動くと位置が溢れる場合は RangeError
 * - 例外の前後で、敵の状態（行動の状態・経過時間・攻撃・位置・向き・クールダウン・HP・魔障・
 *   崩しゲージ・状態異常）と乱数の状態が変わらず、その後も例外を経験していない個体と同じに振る舞う
 */

const MAX = Number.MAX_VALUE;
const dt = FIXED_STEP_SECONDS;

const attack = (id: string, extra: Record<string, unknown>) => ({
  id,
  text: `a.${id}`,
  windup: 0.5,
  active: 0.15,
  recovery: 0.6,
  ratio: 0.1,
  staggerCoefficient: 0.2,
  element: "physical",
  range: 1,
  cooldown: 1,
  delivery: { type: "strike", shape: { type: "sector", radius: 1.2, angleDeg: 90 } },
  ...extra,
});
const enemy = (id: string, extra: Record<string, unknown>) => ({
  id,
  text: `e.${id.toLowerCase()}`,
  family: "TAG-FAMILY-BEAST",
  hpMultiplier: 1,
  moveSpeed: 5,
  turnRate: 360,
  radius: 0.4,
  defense: {},
  attacks: [attack("bite", {})],
  behavior: { type: "chase" },
  pack: { min: 1, max: 1 },
  ...extra,
});
const ENEMIES = [
  enemy("ENM-CHASER", {
    attacks: [attack("bite", {}), attack("lunge", { range: 0.5, cooldown: 20, weight: 0.0001 })],
  }),
  enemy("ENM-FLANKER", { behavior: { type: "flank", distance: 1 } }),
  enemy("ENM-CHARGER", {
    turnRate: 180,
    attacks: [
      attack("charge", {
        windup: 0.8,
        ratio: 0.18,
        range: 8,
        minRange: 3,
        delivery: { type: "dash", distance: 8, speed: 12, width: 1.2 },
      }),
    ],
  }),
  enemy("ENM-SPORE", {
    turnRate: null,
    moveSpeed: 0,
    attacks: [
      attack("spores", {
        windup: 0.8,
        ratio: 0,
        range: 7,
        delivery: {
          type: "cloud",
          radius: 2.5,
          duration: 5,
          interval: 1,
          ailment: "TAG-AIL-POISON",
          baseRatio: 0.03,
        },
      }),
    ],
    behavior: { type: "stationary" },
  }),
];
const RANKS = [
  {
    id: "RANK-NORMAL",
    rank: "normal",
    text: "r.n",
    hpMultiplier: 1,
    damageMultiplier: 1,
    xpMultiplier: 1,
    scale: 1,
  },
];

const db: ContentDb = fullCombatDb([], {
  tags: [tag("TAG-FAMILY-BEAST", "enemyFamily")],
  enemies: ENEMIES,
  enemyRanks: RANKS,
});

function make(id: string, at = { x: 0, y: 0 }, facing = 0): Enemy {
  const def = db.enemies.get(id);
  const rank = db.enemyRanks.get("normal");
  if (def === undefined || rank === undefined) throw new Error(id);
  return new Enemy(db, {
    id: `${id}-1`,
    def,
    rank,
    level: 1,
    position: at,
    packId: "p",
    packIndex: 0,
    facing,
  });
}

const target = (x: number, y: number): EnemyTarget => ({
  position: { x, y },
  radius: 0.35,
  facing: Math.PI,
  targetable: true,
});
const FAR = target(100, 0);

const poison = (total: number): AilmentApplication => ({
  ailmentId: "AIL-POISON",
  tag: "TAG-AIL-POISON",
  total,
  duration: 4,
  maxStacks: undefined,
});

/** 外から読める敵の状態の全て（乱数の状態を含む）。 */
function snapshot(e: Enemy, rng: Rng) {
  const c = e.combatant;
  const health = c.health.planUpdate(0);
  const stagger = c.stagger.planUpdate(0);
  return {
    state: e.state,
    timeInState: e.timeInState,
    attack: e.currentAttack?.id,
    targetPoint: e.targetPoint,
    alerted: e.alerted,
    position: e.position,
    facing: e.facing,
    combatantFacing: c.facing,
    moving: c.moving,
    dotTaken: e.dotTaken,
    cooldowns: Object.fromEntries(e.def.attacks.map((a) => [a.id, e.cooldowns.remaining(a.id)])),
    health: { hp: health.hp, ward: health.ward, sinceHit: health.sinceHit, dead: c.health.dead },
    stagger: {
      value: stagger.value,
      brokenFor: stagger.brokenFor,
      sinceLast: stagger.sinceLast,
      broken: c.stagger.broken,
      breaks: c.stagger.breaks,
    },
    ailments: {
      tags: c.ailments.activeTags(),
      dots: c.ailments.planTick(0).updates.map(({ inst }) => ({
        id: inst.def.id,
        remaining: inst.remaining,
        remainingTime: inst.remainingTime,
      })),
    },
    rng: rng.getState(),
  };
}

/**
 * 同じ準備をした2体と2つの乱数（片方だけで例外を起こし、その後の振る舞いを比べる）。
 * 準備では、攻撃の途中・クールダウン中・被弾済み・崩しゲージ・状態異常（毒）の状態にする。
 */
function pair(id: string, setup: (e: Enemy, rng: Rng) => void) {
  const build = () => {
    const e = make(id);
    const rng = Rng.fromSeed(7);
    setup(e, rng);
    return { e, rng };
  };
  return [build(), build()] as const;
}

/** 戦いの途中の状態にする：近づいて攻撃を始め、毒・崩し・被弾を受け、クールダウンがある。 */
function midFight(t: EnemyTarget, steps: number) {
  return (e: Enemy, rng: Rng) => {
    e.combatant.health.takeDamage(3);
    e.combatant.stagger.add(1);
    e.combatant.ailments.apply(poison(10));
    for (let i = 0; i < steps; i++) e.update(dt, t, rng);
  };
}

/** 例外の後も、例外を経験していない個体と全く同じに振る舞うこと。 */
function expectSameFuture(
  a: { e: Enemy; rng: Rng },
  b: { e: Enemy; rng: Rng },
  t: EnemyTarget,
  steps = 240,
) {
  for (let i = 0; i < steps; i++) {
    const ea: EnemyEvent[] = a.e.update(dt, t, a.rng);
    const eb: EnemyEvent[] = b.e.update(dt, t, b.rng);
    expect(ea).toEqual(eb);
    expect(snapshot(a.e, a.rng)).toEqual(snapshot(b.e, b.rng));
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Enemy.update：経過時間の検証", () => {
  const near = target(1.2, 0);
  // 予兆の途中（0.2秒）。bite の予兆は0.5秒
  const setup = midFight(near, 12);

  it.each([
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
    ["NaN", NaN],
    ["負の数", -1],
    ["最小の負の数", -Number.MIN_VALUE],
  ])("%s を RangeError で拒否し、状態は何も変わらない", (_, bad) => {
    const [a, b] = pair("ENM-CHASER", setup);
    expect(a.e.state).toBe("windup");
    expect(a.e.combatant.ailments.activeTags()).toContain("TAG-AIL-POISON");
    const before = snapshot(a.e, a.rng);
    expect(() => a.e.update(bad, near, a.rng)).toThrow(RangeError);
    expect(snapshot(a.e, a.rng)).toEqual(before);
    expect(snapshot(a.e, a.rng)).toEqual(snapshot(b.e, b.rng));
    expectSameFuture(a, b, near);
  });

  it("状態の経過時間の累計が Infinity になる入力を拒否し、状態は何も変わらない", () => {
    // 動かない敵（位置の溢れの検証に掛からない）を、遠くの相手の前で待機させる
    const [a, b] = pair("ENM-SPORE", (e, rng) => {
      e.cooldowns.start("spores", 5);
      e.update(MAX * 0.75, FAR, rng); // 状態の経過時間 = MAX × 0.75（有限）
    });
    expect(a.e.state).toBe("idle");
    expect(a.e.timeInState).toBe(MAX * 0.75);
    const before = snapshot(a.e, a.rng);
    // dt 自体は有限だが、足すと Infinity
    expect(Number.isFinite(MAX * 0.5)).toBe(true);
    expect(() => a.e.update(MAX * 0.5, FAR, a.rng)).toThrow(/状態の経過時間の累計/);
    expect(snapshot(a.e, a.rng)).toEqual(before);
    expectSameFuture(a, b, FAR, 30);
  });

  it("その時間で動くと位置が Infinity になる入力を拒否し、状態は何も変わらない", () => {
    const [a, b] = pair("ENM-CHASER", midFight(target(6, 0), 10)); // 追跡中
    expect(a.e.state).toBe("chase");
    const before = snapshot(a.e, a.rng);
    // 経過時間の累計は有限だが、移動の速さ（5m/秒）× dt が溢れる
    expect(() => a.e.update(MAX / 2, target(6, 0), a.rng)).toThrow(/位置が有限の数でなくなる/);
    expect(snapshot(a.e, a.rng)).toEqual(before);
    expectSameFuture(a, b, target(6, 0));
  });

  it("突進の速さも、位置の溢れの検証に使う", () => {
    // 移動の速さ5 × dt は有限だが、突進の速さ12 × dt は溢れる
    const big = MAX / 8;
    expect(Number.isFinite(5 * big)).toBe(true);
    expect(Number.isFinite(12 * big)).toBe(false);
    const e = make("ENM-CHARGER");
    const rng = Rng.fromSeed(1);
    const before = snapshot(e, rng);
    expect(() => e.update(big, FAR, rng)).toThrow(RangeError);
    expect(snapshot(e, rng)).toEqual(before);
  });
});

describe("Enemy.update：途中の計算が失敗しても、部分的に変わらない", () => {
  it("戦う者の更新（被弾からの時間の溢れ）で失敗したら、経過時間・クールダウンも変わらない", () => {
    const [a, b] = pair("ENM-SPORE", (e, rng) => {
      e.combatant.health.takeDamage(1); // 被弾からの時間 0
      e.combatant.update(MAX); // 被弾からの時間 = MAX
      e.combatant.stagger.add(1);
      e.cooldowns.start("spores", 5);
      e.update(dt, FAR, rng); // 状態の経過時間 = 1/60
    });
    const before = snapshot(a.e, a.rng);
    expect(before.timeInState).toBeCloseTo(dt, 12);
    expect(before.cooldowns.spores).toBeCloseTo(5 - dt, 12);
    // 経過時間・累計・位置の検証は通り、戦う者の更新で溢れる
    expect(() => a.e.update(MAX / 2, FAR, a.rng)).toThrow(/被弾からの時間/);
    // 修正前は、状態の経過時間とクールダウンだけが進んでいた
    expect(snapshot(a.e, a.rng)).toEqual(before);
    expectSameFuture(a, b, FAR, 30);
  });

  it.each([
    ["予兆", "ENM-CHASER", 12, target(1.2, 0)],
    ["攻撃（突進の途中）", "ENM-CHARGER", 55, target(6, 0)],
    ["硬直", "ENM-CHASER", 45, target(1.2, 0)],
    ["待機（うろつき）", "ENM-FLANKER", 90, FAR],
  ] as const)("%s の途中で戦う者の更新が失敗しても、何も変わらない", (_, id, steps, t) => {
    const [a, b] = pair(id, midFight(t, steps));
    const before = snapshot(a.e, a.rng);
    vi.spyOn(a.e.combatant, "planUpdate").mockImplementationOnce(() => {
      throw new RangeError("試験用の失敗");
    });
    expect(() => a.e.update(dt, t, a.rng)).toThrow("試験用の失敗");
    expect(snapshot(a.e, a.rng)).toEqual(before);
    expectSameFuture(a, b, t);
  });

  it("前提：準備した状態が、それぞれの途中であること", () => {
    const states = (id: string, steps: number, t: EnemyTarget) => {
      const e = make(id);
      midFight(t, steps)(e, Rng.fromSeed(7));
      return e.state;
    };
    expect(states("ENM-CHASER", 12, target(1.2, 0))).toBe("windup");
    expect(states("ENM-CHARGER", 55, target(6, 0))).toBe("active");
    expect(states("ENM-CHASER", 45, target(1.2, 0))).toBe("recovery");
    expect(states("ENM-FLANKER", 90, FAR)).toBe("idle");
  });
});

describe("Enemy.update：正しい経過時間では従来どおり", () => {
  it("dt = 0 は時間を進めない（経過時間・クールダウン・HP・状態異常・位置・向きは変わらない）", () => {
    const t = target(1.2, 0);
    const e = make("ENM-CHASER");
    const rng = Rng.fromSeed(7);
    midFight(t, 12)(e, rng);
    e.cooldowns.start("lunge", 3);
    const before = snapshot(e, rng);
    for (let i = 0; i < 10; i++) expect(e.update(0, t, rng)).toEqual([]);
    expect(snapshot(e, rng)).toEqual({ ...before, moving: false, dotTaken: 0 });
  });

  it("有限の dt で、経過時間・クールダウン・持続ダメージが dt だけ進む", () => {
    const t = target(1.2, 0);
    const e = make("ENM-CHASER");
    const rng = Rng.fromSeed(7);
    midFight(t, 12)(e, rng);
    e.cooldowns.start("lunge", 3);
    const before = snapshot(e, rng);
    e.update(dt, t, rng);
    const after = snapshot(e, rng);
    expect(after.state).toBe("windup");
    expect(after.timeInState).toBeCloseTo(before.timeInState + dt, 12);
    expect(after.cooldowns.lunge).toBeCloseTo(3 - dt, 12);
    expect(after.dotTaken).toBeGreaterThan(0);
    expect(after.health.hp + after.health.ward).toBeCloseTo(
      before.health.hp + before.health.ward - after.dotTaken,
      9,
    );
    // 予兆の間は、向きも位置も変えない
    expect(after.facing).toBe(before.facing);
    expect(after.position).toEqual(before.position);
  });

  it("予兆 → 攻撃 → 硬直 → 追跡の流れと、攻撃の後のクールダウンは従来どおり", () => {
    const t = target(1.2, 0);
    const e = make("ENM-CHASER");
    const rng = Rng.fromSeed(7);
    const states: string[] = [];
    const strikes: EnemyEvent[] = [];
    for (let i = 0; i < 90; i++) {
      for (const ev of e.update(dt, t, rng)) if (ev.type === "strike") strikes.push(ev);
      if (states[states.length - 1] !== e.state) states.push(e.state);
    }
    expect(states.slice(0, 5)).toEqual(["chase", "windup", "active", "recovery", "chase"]);
    expect(strikes).toHaveLength(1);
    expect(e.cooldowns.remaining("bite")).toBeGreaterThan(0);
  });

  it("雲の状態異常は作るときに計算し、出来事ごとに別の写しを渡す", () => {
    const e = make("ENM-SPORE");
    const rng = Rng.fromSeed(1);
    const clouds: AilmentApplication[] = [];
    for (let i = 0; i < 60 * 6; i++)
      for (const ev of e.update(dt, target(4, 0), rng))
        if (ev.type === "cloud") clouds.push(ev.application);
    expect(clouds.length).toBeGreaterThanOrEqual(2);
    const [first, second] = clouds;
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });
});

describe("Cooldowns.update：経過時間の検証", () => {
  it.each([Infinity, -Infinity, NaN, -1])("%s を拒否し、残り時間は変わらない", (bad) => {
    const c = new Cooldowns();
    c.start("a", 2);
    expect(() => {
      c.update(bad);
    }).toThrow(RangeError);
    expect(c.remaining("a")).toBe(2);
  });

  it("0 と有限の値は従来どおり", () => {
    const c = new Cooldowns();
    c.start("a", 2);
    c.update(0);
    expect(c.remaining("a")).toBe(2);
    c.update(0.5);
    expect(c.remaining("a")).toBe(1.5);
    c.update(MAX);
    expect(c.remaining("a")).toBe(0);
  });
});

describe("Enemy.planUpdate / commitUpdate（EnemyField.update の、全て検証してから全て反映する更新）", () => {
  it.each([
    ["追跡・攻撃", "ENM-CHASER", target(1.2, 0)],
    ["回り込み", "ENM-FLANKER", target(3, 0)],
    ["突進", "ENM-CHARGER", target(6, 0)],
    ["雲", "ENM-SPORE", target(4, 0)],
    ["うろつき", "ENM-FLANKER", FAR],
  ] as const)("%s：計画して反映すると、update と全く同じ結果になる", (_, id, t) => {
    const [a, b] = pair(id, midFight(t, 0));
    for (let i = 0; i < 300; i++) {
      const ea = a.e.update(dt, t, a.rng);
      const eb = b.e.commitUpdate(b.e.planUpdate(dt), t, b.rng);
      expect(eb).toEqual(ea);
      expect(snapshot(b.e, b.rng)).toEqual(snapshot(a.e, a.rng));
    }
  });

  it("計画は状態を変えない。失敗する計画は update と同じ RangeError", () => {
    const [a] = pair("ENM-CHASER", midFight(target(1.2, 0), 12));
    const before = snapshot(a.e, a.rng);
    a.e.planUpdate(dt);
    a.e.planUpdate(1);
    expect(snapshot(a.e, a.rng)).toEqual(before);
    for (const bad of [NaN, -1, Infinity, MAX / 2])
      expect(() => a.e.planUpdate(bad)).toThrow(RangeError);
    expect(snapshot(a.e, a.rng)).toEqual(before);
  });

  it("計画の後に仲間から気づかされても（notice）、update と同じ結果になる", () => {
    const [a, b] = pair("ENM-CHASER", () => undefined);
    for (let i = 0; i < 30; i++) {
      a.e.update(dt, FAR, a.rng);
      b.e.update(dt, FAR, b.rng);
    }
    const plan = b.e.planUpdate(dt);
    expect(a.e.notice()).toBe(true);
    expect(b.e.notice()).toBe(true);
    expect(b.e.commitUpdate(plan, FAR, b.rng)).toEqual(a.e.update(dt, FAR, a.rng));
    expect(snapshot(b.e, b.rng)).toEqual(snapshot(a.e, a.rng));
    expect(b.e.timeInState).toBeCloseTo(dt, 12);
  });

  it("別の敵の計画は反映せず、何も変えない", () => {
    const [a, b] = pair("ENM-CHASER", midFight(target(1.2, 0), 12));
    const before = snapshot(a.e, a.rng);
    expect(() => a.e.commitUpdate(b.e.planUpdate(dt), target(1.2, 0), a.rng)).toThrow(
      "別の敵の計画",
    );
    expect(() => a.e.combatant.commitUpdate(b.e.combatant.planUpdate(dt))).toThrow(
      "別の戦う者の計画",
    );
    expect(snapshot(a.e, a.rng)).toEqual(before);
  });
});

describe("ProjectilePool.checkUpdate", () => {
  it("update と同じ入力を拒否し、投射物の状態は変えない", () => {
    const pool = new ProjectilePool<number>(2);
    pool.spawn({
      position: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
      speed: 10,
      range: 20,
      radius: MAX,
      pierce: 0,
      team: "enemy",
      payload: 1,
    });
    const before = pool.positions();
    const ok = { id: "p", team: "player", position: { x: 5, y: 0 }, radius: 0 };
    pool.checkUpdate(dt, [ok]);
    expect(pool.positions()).toEqual(before);
    expect(() => {
      pool.checkUpdate(NaN, [ok]);
    }).toThrow(RangeError);
    expect(() => {
      pool.checkUpdate(dt, [{ ...ok, radius: MAX }]);
    }).toThrow(RangeError);
    expect(() => {
      pool.checkUpdate(dt, [{ ...ok, position: { x: NaN, y: 0 } }]);
    }).toThrow(RangeError);
    expect(pool.positions()).toEqual(before);
    expect(pool.active).toBe(1);
  });
});
