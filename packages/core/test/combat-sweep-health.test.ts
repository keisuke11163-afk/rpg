import { describe, expect, it } from "vitest";
import {
  FIXED_STEP_SECONDS,
  Health,
  type HealthConfig,
  ProjectilePool,
  type ProjectileSpawn,
  type ProjectileTarget,
} from "../src/index.ts";

/** 不正な数（NaN・±Infinity）。 */
const NON_FINITE = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
/** 0以上の有限の数でないもの。 */
const BAD_NON_NEGATIVE = [...NON_FINITE, -1, -1e-9, -Number.MIN_VALUE];

function spawnSpec(overrides: Partial<ProjectileSpawn<string>> = {}): ProjectileSpawn<string> {
  return {
    position: { x: 0, y: 0 },
    direction: { x: 1, y: 0 },
    speed: 10,
    range: 100,
    radius: 0.1,
    pierce: 0,
    team: "player",
    payload: "bolt",
    ...overrides,
  };
}

function target(id: string, x: number, y = 0, radius = 0.5, team = "enemy"): ProjectileTarget {
  return { id, team, position: { x, y }, radius };
}

function snapshot(pool: ProjectilePool<string>) {
  return { active: pool.active, positions: pool.positions() };
}

describe("投射物のすり抜け対策：移動の線分と相手の円の交差", () => {
  it("半径0の投射物が1刻みで16m以上進んでも、途中の相手に当たる", () => {
    const pool = new ProjectilePool<string>(1);
    pool.spawn(spawnSpec({ radius: 0, speed: 1000 }));
    const hits = pool.update(FIXED_STEP_SECONDS, [target("a", 8, 0, 0.3)]);
    expect(hits.map((h) => h.targetId)).toEqual(["a"]);
    // 当たった位置は、相手の円に最初に触れた位置（8 - 0.3）
    expect(hits[0]?.position.x).toBeCloseTo(7.7, 12);
    expect(hits[0]?.position.y).toBe(0);
    expect(pool.active).toBe(0);
  });

  it("半径0.001mの投射物と半径0.01mの相手（合計の半径が0.05m未満）でもすり抜けない", () => {
    const pool = new ProjectilePool<string>(1);
    pool.spawn(spawnSpec({ radius: 0.001, speed: 600 }));
    // 1刻みに10m進む。相手は線から0.0105m横（合計の半径0.011m以内）
    const hits = pool.update(FIXED_STEP_SECONDS, [target("a", 5.037, 0.0105, 0.01)]);
    expect(hits.map((h) => h.targetId)).toEqual(["a"]);
  });

  it("相手の半径が0でも、投射物の半径の内側を通れば当たる", () => {
    const pool = new ProjectilePool<string>(1);
    pool.spawn(spawnSpec({ radius: 0.001, speed: 300 }));
    const hits = pool.update(FIXED_STEP_SECONDS, [target("a", 3.33, 0.0009, 0)]);
    expect(hits.map((h) => h.targetId)).toEqual(["a"]);
  });

  it("半径0どうしでも、線の上にある相手に当たる（斜めの向きでも丸めの誤差で外さない）", () => {
    const axis = new ProjectilePool<string>(1);
    axis.spawn(spawnSpec({ radius: 0, speed: 500 }));
    expect(axis.update(FIXED_STEP_SECONDS, [target("a", 4.25, 0, 0)])).toHaveLength(1);

    const diagonal = new ProjectilePool<string>(1);
    diagonal.spawn(spawnSpec({ radius: 0, speed: 500, direction: { x: 3, y: 4 } }));
    const hits = diagonal.update(FIXED_STEP_SECONDS, [target("a", 3, 4, 0)]);
    expect(hits.map((h) => h.targetId)).toEqual(["a"]);
    expect(hits[0]?.position.x).toBeCloseTo(3, 9);
    expect(hits[0]?.position.y).toBeCloseTo(4, 9);
  });

  it("移動の区間の途中にいる相手に当たり、貫通しないなら当たった位置で止まる", () => {
    const pool = new ProjectilePool<string>(1);
    pool.spawn(spawnSpec({ radius: 0.1, speed: 10, range: 5 }));
    pool.update(0.1, []); // x = 1
    const hits = pool.update(0.5, [target("a", 4, 0, 0.5)]); // 区間は x = 1〜6 のうち射程で 1〜5
    expect(hits.map((h) => h.targetId)).toEqual(["a"]);
    expect(hits[0]?.position.x).toBeCloseTo(3.4, 12);
    expect(pool.active).toBe(0);
  });

  it("触れない相手には当たらない（横に外れる・後ろ・区間の先・射程の外）", () => {
    const pool = new ProjectilePool<string>(1);
    pool.spawn(spawnSpec({ position: { x: 1, y: 0 }, radius: 0.1, speed: 60, range: 6 }));
    const targets = [
      target("side", 3, 0.6 + 1e-6, 0.5), // 合計の半径0.6より、わずかに外
      target("behind", 0.3, 0, 0.1), // 始点の後ろ（始点とは重ならない）
      target("ahead", 3.0, 0, 0.1), // この刻みの区間（1〜2）の先
      target("beyond", 7.3, 0, 0.1), // 射程（1〜7）の先
    ];
    expect(pool.update(1 / 60, targets)).toEqual([]);
    // 次の刻みで、区間の先にいた相手に当たる
    const hits = pool.update(1 / 60, targets);
    expect(hits.map((h) => h.targetId)).toEqual(["ahead"]);
  });

  it("射程の先の相手には、最後まで当たらずに消える", () => {
    const pool = new ProjectilePool<string>(1);
    pool.spawn(spawnSpec({ radius: 0, speed: 1000, range: 5 }));
    expect(pool.update(1, [target("far", 5.31, 0, 0.3)])).toEqual([]);
    expect(pool.active).toBe(0);
  });

  it("円の縁にちょうど触れる場合は当たる（従来どおり、距離が合計の半径以下なら当たり）", () => {
    const pool = new ProjectilePool<string>(1);
    pool.spawn(spawnSpec({ radius: 0.25, speed: 10 }));
    const hits = pool.update(1, [target("edge", 5, 0.75, 0.5)]);
    expect(hits.map((h) => h.targetId)).toEqual(["edge"]);
  });

  it("始点で既に重なっている相手には、始点の位置で当たる（経過時間0でも）", () => {
    const pool = new ProjectilePool<string>(1);
    pool.spawn(spawnSpec({ radius: 0.1 }));
    const hits = pool.update(0, [target("a", 0.2, 0, 0.5)]);
    expect(hits.map((h) => h.targetId)).toEqual(["a"]);
    expect(hits[0]?.position).toEqual({ x: 0, y: 0 });
  });

  it("1刻みに複数の相手に当たるときは、進む向きに沿って近い順（targets の順に関係なく）", () => {
    const pool = new ProjectilePool<string>(1);
    pool.spawn(spawnSpec({ radius: 0, speed: 1200, pierce: 5 }));
    const hits = pool.update(FIXED_STEP_SECONDS, [
      target("c", 15, 0, 0.2),
      target("a", 5, 0, 0.2),
      target("b", 10, 0, 0.2),
    ]);
    expect(hits.map((h) => h.targetId)).toEqual(["a", "b", "c"]);
  });

  it("貫通の数だけ当たり、味方には当たらず、同じ相手には1回だけ（半径0・高速でも）", () => {
    const pool = new ProjectilePool<string>(1);
    pool.spawn(spawnSpec({ radius: 0, speed: 2000, range: 30, pierce: 1 }));
    const hits = pool.update(FIXED_STEP_SECONDS, [
      target("ally", 2, 0, 0.3, "player"),
      target("a", 4, 0, 0.3),
      target("b", 8, 0, 0.3),
      target("c", 12, 0, 0.3),
    ]);
    expect(hits.map((h) => h.targetId)).toEqual(["a", "b"]);
    expect(pool.active).toBe(0);
  });

  it("大きな相手の中を何刻みも進んでも、同じ相手には1回だけ当たる", () => {
    const pool = new ProjectilePool<string>(1);
    pool.spawn(spawnSpec({ radius: 0, speed: 6, pierce: 3 }));
    const hits: string[] = [];
    for (let i = 0; i < 120; i++)
      hits.push(
        ...pool.update(FIXED_STEP_SECONDS, [target("big", 5, 0, 3)]).map((h) => h.targetId),
      );
    expect(hits).toEqual(["big"]);
  });

  it("半径0の投射物でも、当たって消えた入れ物を再利用できる", () => {
    const pool = new ProjectilePool<string>(1);
    pool.spawn(spawnSpec({ radius: 0, speed: 900 }));
    expect(pool.update(FIXED_STEP_SECONDS, [target("a", 10, 0, 0.1)])).toHaveLength(1);
    expect(pool.active).toBe(0);
    expect(pool.spawn(spawnSpec({ radius: 0, speed: 900 }))).toBe(0);
    // 新しい投射物は、前の投射物が当たった相手にも当たる
    expect(pool.update(FIXED_STEP_SECONDS, [target("a", 10, 0, 0.1)])).toHaveLength(1);
  });

  it("極端に大きな座標でも、NaN・無限大の位置を作らず、誤って当たらない", () => {
    const pool = new ProjectilePool<string>(1);
    pool.spawn(
      spawnSpec({ position: { x: 1e308, y: 0 }, speed: 1e308, range: 1.7e308, radius: 0 }),
    );
    const hits = pool.update(1, [target("far", -1e308, 0, 1)]);
    expect(hits).toEqual([]);
    for (const p of pool.positions()) {
      expect(Number.isFinite(p.position.x)).toBe(true);
      expect(Number.isFinite(p.position.y)).toBe(true);
    }
  });
});

describe("ProjectilePool.update の相手の検証", () => {
  const bad: [string, ProjectileTarget][] = [
    ...NON_FINITE.map((v): [string, ProjectileTarget] => [`位置のx ${String(v)}`, target("t", v)]),
    ...NON_FINITE.map((v): [string, ProjectileTarget] => [
      `位置のy ${String(v)}`,
      target("t", 1, v),
    ]),
    ...BAD_NON_NEGATIVE.map((v): [string, ProjectileTarget] => [
      `半径 ${String(v)}`,
      target("t", 1, 0, v),
    ]),
  ];

  it.each(bad)("相手の%sを拒否し、投射物の状態を変えない", (_name, badTarget) => {
    const pool = new ProjectilePool<string>(2);
    pool.spawn(spawnSpec());
    pool.spawn(spawnSpec({ position: { x: 0, y: 3 } }));
    pool.update(0.05, []);
    const before = snapshot(pool);
    expect(() => pool.update(0.05, [target("ok", 0.9), badTarget])).toThrow(RangeError);
    expect(snapshot(pool)).toEqual(before);
    // 当たった記録も変わっていない
    expect(pool.update(0.05, [target("ok", 0.9)]).map((h) => h.targetId)).toEqual(["ok"]);
  });
});

describe("Health の constructor の検証", () => {
  it.each([...NON_FINITE, 0, -1, -Number.MIN_VALUE])("最大HP %s を拒否する", (maxHp) => {
    expect(() => new Health({ maxHp })).toThrow(RangeError);
  });

  it.each(BAD_NON_NEGATIVE)("最大魔障 %s を拒否する", (maxWard) => {
    expect(() => new Health({ maxHp: 100, maxWard })).toThrow(RangeError);
  });

  it.each(BAD_NON_NEGATIVE)("魔障が回復し始めるまでの秒数 %s を拒否する", (wardRechargeDelay) => {
    expect(() => new Health({ maxHp: 100, maxWard: 10, wardRechargeDelay })).toThrow(RangeError);
  });

  it("境界の値（最大HPがごく小さな正の数、最大魔障0、回復までの秒数0）は受け付ける", () => {
    const tiny = new Health({ maxHp: Number.MIN_VALUE });
    expect(tiny.hp).toBe(Number.MIN_VALUE);
    expect(tiny.dead).toBe(false);

    const noWard = new Health({ maxHp: 1, maxWard: 0 });
    expect(noWard.ward).toBe(0);

    const instant = new Health({ maxHp: 100, maxWard: 50, wardRechargeDelay: 0 });
    instant.takeDamage(50);
    instant.update(1);
    expect(instant.ward).toBeCloseTo(10, 12);
  });

  it("省略時は従来どおり（最大魔障0、2秒後から回復）", () => {
    const h = new Health({ maxHp: 100 });
    expect(h.maxWard).toBe(0);
    expect(h.ward).toBe(0);
    const w = new Health({ maxHp: 100, maxWard: 50 } satisfies HealthConfig);
    w.takeDamage(50);
    w.update(1.999);
    expect(w.ward).toBe(0);
    w.update(1.001);
    expect(w.ward).toBeCloseTo(10, 9);
  });
});

/** HP・魔障・回復までの時間の状態の写し（回復までの時間は、この後の回復量で確かめる）。 */
function healthSnapshot(h: Health) {
  return { hp: h.hp, ward: h.ward, dead: h.dead };
}

/** ダメージを受けた直後の、被弾からの時間が進んだ状態の Health。 */
function damaged(): Health {
  const h = new Health({ maxHp: 100, maxWard: 50 });
  h.takeDamage(70); // 魔障0、HP80
  h.update(1); // 被弾から1秒（回復まで、あと1秒）
  return h;
}

/** 被弾からの時間が変わっていないこと：あと1秒で回復が始まり、その1秒後に10回復する。 */
function expectRechargeTimerUnchanged(h: Health): void {
  h.update(1);
  expect(h.ward).toBe(0);
  h.update(1);
  expect(h.ward).toBeCloseTo(10, 9);
}

describe("Health.update の検証", () => {
  it.each(BAD_NON_NEGATIVE)("経過時間 %s を拒否し、状態を変えない", (dt) => {
    const h = damaged();
    const before = healthSnapshot(h);
    expect(() => {
      h.update(dt);
    }).toThrow(RangeError);
    expect(healthSnapshot(h)).toEqual(before);
    expectRechargeTimerUnchanged(h);
  });

  it("経過時間0は受け付け、何も変えない", () => {
    const h = damaged();
    h.update(0);
    expectRechargeTimerUnchanged(h);
  });
});

describe("Health.takeDamage・heal の検証", () => {
  it.each(BAD_NON_NEGATIVE)("ダメージ %s を拒否し、状態と回復までの時間を変えない", (amount) => {
    const h = damaged();
    const before = healthSnapshot(h);
    expect(() => h.takeDamage(amount)).toThrow(RangeError);
    expect(healthSnapshot(h)).toEqual(before);
    expectRechargeTimerUnchanged(h);
  });

  it.each(BAD_NON_NEGATIVE)("回復量 %s を拒否し、状態を変えない", (amount) => {
    const h = damaged();
    const before = healthSnapshot(h);
    expect(() => h.heal(amount)).toThrow(RangeError);
    expect(healthSnapshot(h)).toEqual(before);
    expectRechargeTimerUnchanged(h);
  });

  it("死亡後も、不正な値は拒否する（検証が先）", () => {
    const h = new Health({ maxHp: 10 });
    h.takeDamage(10);
    expect(h.dead).toBe(true);
    for (const v of BAD_NON_NEGATIVE) {
      expect(() => h.takeDamage(v)).toThrow(RangeError);
      expect(() => h.heal(v)).toThrow(RangeError);
      expect(() => {
        h.update(v);
      }).toThrow(RangeError);
    }
    expect(h.hp).toBe(0);
  });

  it("0のダメージ・回復は何もしない（回復までの時間も変えない）", () => {
    const h = damaged();
    expect(h.takeDamage(0)).toEqual({ toWard: 0, toHp: 0, died: false });
    expect(h.heal(0)).toBe(0);
    expect(h.hp).toBe(80);
    expectRechargeTimerUnchanged(h);
  });
});

describe("Health：正しい入力での挙動は従来どおり", () => {
  it("魔障が先に吸収し、HPが0で死亡する。死亡後のダメージ・回復は何もしない", () => {
    const h = new Health({ maxHp: 100, maxWard: 30 });
    expect(h.takeDamage(50)).toEqual({ toWard: 30, toHp: 20, died: false });
    expect(h.takeDamage(1000)).toEqual({ toWard: 0, toHp: 80, died: true });
    expect(h.takeDamage(10)).toEqual({ toWard: 0, toHp: 0, died: false });
    expect(h.heal(50)).toBe(0);
    expect(h.dead).toBe(true);
  });

  it("回復は最大HPまで。死亡後も時間は進み、全回復で元に戻る", () => {
    const h = new Health({ maxHp: 100, maxWard: 20 });
    h.takeDamage(50);
    expect(h.heal(10)).toBe(10);
    expect(h.heal(1000)).toBe(20);
    expect(h.hp).toBe(100);
    h.takeDamage(500);
    h.update(10);
    expect(h.ward).toBe(0); // 死亡中は魔障が回復しない
    h.restoreFull();
    expect({ hp: h.hp, ward: h.ward, dead: h.dead }).toEqual({ hp: 100, ward: 20, dead: false });
  });

  it("回復までの秒数を短くすると（法衣の統一ボーナス）、早く回復し始める", () => {
    const h = new Health({ maxHp: 100, maxWard: 50, wardRechargeDelay: 1 });
    h.takeDamage(50);
    h.update(2);
    expect(h.ward).toBeCloseTo(10, 9);
    h.update(100);
    expect(h.ward).toBe(50);
  });
});
