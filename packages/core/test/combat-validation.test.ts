import { describe, expect, it } from "vitest";
import {
  ActionTimeline,
  FIXED_STEP_SECONDS,
  ProjectilePool,
  type ProjectileSpawn,
  type TimelineSpec,
} from "../src/index.ts";

/** 不正な数（NaN・±Infinity）。 */
const NON_FINITE = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
/** 0以上の有限の数でないもの。 */
const BAD_NON_NEGATIVE = [...NON_FINITE, -1, -1e-9, -Number.MIN_VALUE];

const target = (id: string, x: number, team = "enemy") => ({
  id,
  team,
  position: { x, y: 0 },
  radius: 0.5,
});

function validSpawn(overrides: Partial<ProjectileSpawn<string>> = {}): ProjectileSpawn<string> {
  return {
    position: { x: 0, y: 0 },
    direction: { x: 1, y: 0 },
    speed: 10,
    range: 20,
    radius: 0.1,
    pierce: 0,
    team: "player",
    payload: "arrow",
    ...overrides,
  };
}

/** 入れ物の状態の写し（不正な入力で変わっていないことを確かめるため）。 */
function snapshot(pool: ProjectilePool<string>) {
  return { active: pool.active, positions: pool.positions() };
}

describe("ProjectilePool.spawn の入力の検証", () => {
  it.each(BAD_NON_NEGATIVE)("速さ %s を拒否する", (speed) => {
    const pool = new ProjectilePool<string>(2);
    expect(() => pool.spawn(validSpawn({ speed }))).toThrow(RangeError);
    expect(pool.active).toBe(0);
  });

  it.each(BAD_NON_NEGATIVE)("射程 %s を拒否する", (range) => {
    const pool = new ProjectilePool<string>(2);
    expect(() => pool.spawn(validSpawn({ range }))).toThrow(RangeError);
    expect(pool.active).toBe(0);
  });

  it.each(BAD_NON_NEGATIVE)("半径 %s を拒否する", (radius) => {
    const pool = new ProjectilePool<string>(2);
    expect(() => pool.spawn(validSpawn({ radius }))).toThrow(RangeError);
    expect(pool.active).toBe(0);
  });

  it.each([-1, -0.5, 0.5, 1.2, ...NON_FINITE])(
    "貫通する数 %s を拒否する（負の数・小数・非有限）",
    (pierce) => {
      const pool = new ProjectilePool<string>(2);
      expect(() => pool.spawn(validSpawn({ pierce }))).toThrow(RangeError);
      expect(pool.active).toBe(0);
    },
  );

  it.each(NON_FINITE)("位置に %s を含むと拒否する", (v) => {
    const pool = new ProjectilePool<string>(2);
    expect(() => pool.spawn(validSpawn({ position: { x: v, y: 0 } }))).toThrow(RangeError);
    expect(() => pool.spawn(validSpawn({ position: { x: 0, y: v } }))).toThrow(RangeError);
    expect(pool.active).toBe(0);
  });

  it.each(NON_FINITE)("向きに %s を含むと拒否する（-1 ではなく例外）", (v) => {
    const pool = new ProjectilePool<string>(2);
    expect(() => pool.spawn(validSpawn({ direction: { x: v, y: 0 } }))).toThrow(RangeError);
    expect(() => pool.spawn(validSpawn({ direction: { x: 1, y: v } }))).toThrow(RangeError);
    expect(pool.active).toBe(0);
  });

  it("不正な入力は、既に飛んでいる投射物の状態を変えない", () => {
    const pool = new ProjectilePool<string>(3);
    expect(pool.spawn(validSpawn())).toBe(0);
    pool.update(0.1, []);
    const before = snapshot(pool);
    const bad: Partial<ProjectileSpawn<string>>[] = [
      { speed: -1 },
      { range: Number.NaN },
      { radius: Number.POSITIVE_INFINITY },
      { pierce: 0.5 },
      { position: { x: Number.NaN, y: 0 } },
      { direction: { x: 0, y: Number.NEGATIVE_INFINITY } },
    ];
    for (const b of bad) expect(() => pool.spawn(validSpawn(b))).toThrow(RangeError);
    expect(snapshot(pool)).toEqual(before);
    // 空いている入れ物は使われずに残っている
    expect(pool.spawn(validSpawn())).toBe(1);
  });

  it("入れ物が満杯でも、不正な入力は -1 ではなく例外にする", () => {
    const pool = new ProjectilePool<string>(1);
    expect(pool.spawn(validSpawn())).toBe(0);
    expect(() => pool.spawn(validSpawn({ speed: -1 }))).toThrow(RangeError);
  });

  it("従来どおり：向きの長さが0なら -1、満杯なら -1", () => {
    const pool = new ProjectilePool<string>(1);
    expect(pool.spawn(validSpawn({ direction: { x: 0, y: 0 } }))).toBe(-1);
    expect(pool.spawn(validSpawn({ direction: { x: -0, y: 0 } }))).toBe(-1);
    expect(pool.active).toBe(0);
    expect(pool.spawn(validSpawn())).toBe(0);
    expect(pool.spawn(validSpawn())).toBe(-1);
    expect(pool.active).toBe(1);
  });

  it("境界の値（速さ・射程・半径0、貫通0）と大きな整数の貫通は受け付ける", () => {
    const pool = new ProjectilePool<string>(4);
    expect(pool.spawn(validSpawn({ speed: 0 }))).toBe(0);
    expect(pool.spawn(validSpawn({ radius: 0 }))).toBe(1);
    expect(pool.spawn(validSpawn({ pierce: 3 }))).toBe(2);
    expect(pool.spawn(validSpawn({ range: 0 }))).toBe(3);
    expect(pool.active).toBe(4);
    // 射程0の投射物は最初の更新で消える
    pool.update(0, []);
    expect(pool.positionOf(3)).toBeUndefined();
  });

  it("成分が大きな向きでも、長さ1に正しく揃える（溢れない）", () => {
    const pool = new ProjectilePool<string>(1);
    pool.spawn(validSpawn({ direction: { x: 1e308, y: 1e308 } }));
    const d = pool.positions()[0]?.direction;
    expect(d?.x).toBeCloseTo(Math.SQRT1_2, 12);
    expect(d?.y).toBeCloseTo(Math.SQRT1_2, 12);
  });
});

describe("ProjectilePool.update の経過時間の検証", () => {
  it.each(BAD_NON_NEGATIVE)("経過時間 %s を拒否し、投射物の状態を変えない", (dt) => {
    const pool = new ProjectilePool<string>(2);
    pool.spawn(validSpawn({ pierce: 1 }));
    pool.spawn(validSpawn({ position: { x: 0, y: 3 } }));
    pool.update(0.05, []);
    const before = snapshot(pool);
    expect(() => pool.update(dt, [target("a", 0.6)])).toThrow(RangeError);
    expect(snapshot(pool)).toEqual(before);
    // 当たった記録も変わっていない：同じ相手に、正しい更新で当たる
    const hits = pool.update(0.05, [target("a", 1.2)]);
    expect(hits.map((h) => h.targetId)).toEqual(["a"]);
  });

  it("経過時間0は受け付け、何も動かさない", () => {
    const pool = new ProjectilePool<string>(1);
    pool.spawn(validSpawn());
    const before = snapshot(pool);
    expect(pool.update(0, [])).toEqual([]);
    expect(snapshot(pool)).toEqual(before);
  });
});

describe("ProjectilePool：正しい入力での挙動は従来どおり", () => {
  it("向きを長さ1に揃え、速さ×時間だけ進み、射程で消える", () => {
    const pool = new ProjectilePool<string>(1);
    pool.spawn(validSpawn({ direction: { x: 3, y: 4 }, speed: 5, range: 2 }));
    pool.update(0.2, []);
    const p = pool.positionOf(0);
    expect(p?.x).toBeCloseTo(0.6, 12);
    expect(p?.y).toBeCloseTo(0.8, 12);
    pool.update(1, []);
    expect(pool.active).toBe(0);
  });

  it("貫通・同じ相手に1回・味方に当たらない", () => {
    const pool = new ProjectilePool<string>(1);
    pool.spawn(validSpawn({ speed: 200, range: 30, pierce: 1 }));
    const hits = pool.update(0.1, [
      target("ally", 2, "player"),
      target("a", 4),
      target("b", 8),
      target("c", 12),
    ]);
    expect(hits.map((h) => h.targetId)).toEqual(["a", "b"]);
    expect(hits.every((h) => h.payload === "arrow")).toBe(true);
    expect(pool.active).toBe(0);
  });
});

describe("ActionTimeline の constructor の検証", () => {
  const base: TimelineSpec = { windup: 0.2, active: 0.1, recovery: 0.3 };
  for (const key of ["windup", "active", "recovery"] as const) {
    it.each(BAD_NON_NEGATIVE)(`${key} の %s を拒否する`, (v) => {
      expect(() => new ActionTimeline({ ...base, [key]: v })).toThrow(RangeError);
    });
  }

  it("各フェーズが有限でも、合計が溢れて無限大になる時間は拒否する", () => {
    expect(
      () =>
        new ActionTimeline({
          windup: Number.MAX_VALUE,
          active: Number.MAX_VALUE,
          recovery: 0,
        }),
    ).toThrow(RangeError);
  });

  it("渡した時間を後から書き換えても、検証済みの値を使う", () => {
    const spec = { windup: 0.2, active: 0.1, recovery: 0.3 };
    const t = new ActionTimeline(spec);
    spec.windup = Number.NaN;
    expect(t.spec.windup).toBe(0.2);
    expect(t.total).toBeCloseTo(0.6, 12);
  });
});

describe("ActionTimeline.update の経過時間の検証", () => {
  it.each(BAD_NON_NEGATIVE)("経過時間 %s を拒否し、elapsed・イベントの状態を変えない", (dt) => {
    const t = new ActionTimeline({ windup: 0.2, active: 0.1, recovery: 0.3 });
    t.update(0.1);
    const before = { phase: t.phase, progress: t.progress };
    expect(() => t.update(dt)).toThrow(RangeError);
    expect({ phase: t.phase, progress: t.progress }).toEqual(before);
    // イベントは、不正な dt の後も正しい時刻に1回ずつだけ起きる
    expect(t.update(0.1)).toEqual({ activeStarted: true, finished: false });
    expect(t.update(0.4)).toEqual({ activeStarted: false, finished: true });
    expect(t.update(1)).toEqual({ activeStarted: false, finished: false });
  });

  it("不正な dt の後に、発火済みのイベントが再び起きない", () => {
    const t = new ActionTimeline({ windup: 0, active: 0, recovery: 0 });
    expect(t.update(0)).toEqual({ activeStarted: true, finished: true });
    expect(() => t.update(Number.NaN)).toThrow(RangeError);
    expect(() => t.update(-1)).toThrow(RangeError);
    expect(t.update(0)).toEqual({ activeStarted: false, finished: false });
    expect(t.phase).toBe("done");
  });
});

describe("ActionTimeline：従来の仕様の維持", () => {
  it("全てのフェーズが0秒なら、最初の更新で当たり判定の始まりと終わりを同時に1回だけ知らせる", () => {
    const t = new ActionTimeline({ windup: 0, active: 0, recovery: 0 });
    expect(t.phase).toBe("done");
    expect(t.progress).toBe(1);
    expect(t.update(0)).toEqual({ activeStarted: true, finished: true });
    expect(t.update(FIXED_STEP_SECONDS)).toEqual({ activeStarted: false, finished: false });
  });

  it("予兆0秒なら最初の更新で当たり判定が始まる。当たり判定0秒でも始まりは知らせる", () => {
    const a = new ActionTimeline({ windup: 0, active: 0.1, recovery: 0.1 });
    expect(a.phase).toBe("active");
    expect(a.update(FIXED_STEP_SECONDS)).toEqual({ activeStarted: true, finished: false });

    const b = new ActionTimeline({ windup: 0.1, active: 0, recovery: 0.1 });
    const events: string[] = [];
    for (let i = 0; i < 20; i++) {
      const e = b.update(FIXED_STEP_SECONDS);
      if (e.activeStarted) events.push(`active@${String(i)}`);
      if (e.finished) events.push(`end@${String(i)}`);
    }
    expect(events).toEqual(["active@5", "end@11"]);
  });

  it("硬直0秒なら、当たり判定の終わりで動作が終わる", () => {
    const t = new ActionTimeline({ windup: 0.1, active: 0.1, recovery: 0 });
    const events: string[] = [];
    for (let i = 0; i < 20; i++) {
      const e = t.update(FIXED_STEP_SECONDS);
      if (e.activeStarted) events.push(`active@${String(i)}`);
      if (e.finished) events.push(`end@${String(i)}`);
    }
    expect(events).toEqual(["active@5", "end@11"]);
  });

  it("1/60秒の積み重ねの誤差で1刻み遅れない（0.2秒の予兆は12刻み目に始まる）", () => {
    const t = new ActionTimeline({ windup: 0.2, active: 0.1, recovery: 0.3 });
    const events: string[] = [];
    for (let i = 0; i < 60; i++) {
      const e = t.update(FIXED_STEP_SECONDS);
      if (e.activeStarted) events.push(`active@${String(i)}`);
      if (e.finished) events.push(`end@${String(i)}`);
    }
    expect(events).toEqual(["active@11", "end@35"]);
  });

  it("1回の大きな dt で全てのフェーズを越えても、それぞれ1回だけ知らせる", () => {
    const t = new ActionTimeline({ windup: 0.2, active: 0.1, recovery: 0.3 });
    expect(t.update(5)).toEqual({ activeStarted: true, finished: true });
    expect(t.update(5)).toEqual({ activeStarted: false, finished: false });
    expect(t.phase).toBe("done");
  });
});
