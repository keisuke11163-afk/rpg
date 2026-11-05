/**
 * PR #8（U-05 DPSシミュレーター）のレビュー指摘の回帰テスト：シミュレーションの時間の端数。
 *
 * 指定の時間が1/60秒の整数倍でないとき、最後の時間刻みを切り上げずに残りの時間だけ進める。
 * MPの回復・持続ダメージ・崩し・CD・動作の時間・的の攻撃・経過時間が、指定の時間を超えない。
 * 1/60秒の整数倍なら、従来と同じ結果になる。
 */
import { readFileSync } from "node:fs";
import { FIXED_STEP_SECONDS } from "@stella/core";
import { loadGameContent } from "@stella/content";
import { describe, expect, it } from "vitest";
import { type Build, type SimSkill, type Target, buildSchema } from "../src/build.ts";
import { simulate, splitSteps } from "../src/simulate.ts";
import { dummy, targetByName } from "../src/targets.ts";

const db = loadGameContent();
const dt = FIXED_STEP_SECONDS;
/** 境界値の比較の許容誤差（秒・MP・ダメージ）。 */
const EPS = 1e-9;

/** 打撃値が決まった値（10）になる武器（会心なし・1回/秒）。 */
const WEAPON: NonNullable<Build["weapon"]> = {
  uid: "wpn-a",
  tags: ["TAG-WPN-DAGGER"],
  base: { physical: { min: 10, max: 10 } },
  critChance: 0,
  attackSpeed: 1,
};

/** 崩し係数0（崩れて受けるダメージが変わらないように）。 */
const STRIKE: SimSkill = {
  name: "一撃",
  tags: ["TAG-FORM-MELEE"],
  kind: "weapon",
  pct: 1,
  mpCost: 0,
  cooldown: 0,
  staggerCoefficient: 0,
};

const SPELL: SimSkill = {
  name: "呪文",
  tags: ["TAG-FORM-SPELL"],
  kind: "spell",
  pct: 1,
  base: { physical: { min: 10, max: 10 } },
  mpCost: 0,
  cooldown: 0,
  castTime: 1,
  staggerCoefficient: 0,
};

function build(rotation: SimSkill[]): Build {
  return { id: "test", name: "テスト", characterLevel: 1, weapon: WEAPON, rotation };
}

const run = (b: Build, seconds: number, target: Target = dummy(1), seed = 1) =>
  simulate(db, b, target, { seconds, seed });

const FRACTIONAL = [0.001, 0.01, 0.51, 1.01] as const;

describe("時間刻みの分け方（splitSteps）", () => {
  it("整数倍でなければ、dt の回数と dt 未満の残りに分ける", () => {
    for (const s of FRACTIONAL) {
      const { fullSteps, remainder } = splitSteps(s, dt);
      expect(remainder).toBeGreaterThan(0);
      expect(remainder).toBeLessThan(dt);
      expect(fullSteps * dt + remainder).toBeCloseTo(s, 12);
    }
    expect(splitSteps(0.001, dt)).toEqual({ fullSteps: 0, remainder: 0.001 });
  });

  it("浮動小数点の誤差で僅かにずれた整数倍は、整数倍として扱う（余分な極小の刻みを作らない）", () => {
    for (const s of [dt, 0.1, 0.5, 1, 1.1, 60, 120, 307 * dt, 1000 / 3]) {
      const { fullSteps, remainder } = splitSteps(s, dt);
      expect(remainder).toBe(0);
      expect(fullSteps).toBe(Math.round(s / dt));
    }
  });
});

describe("経過時間が指定の時間を超えない", () => {
  for (const s of FRACTIONAL) {
    it(`${String(s)}秒を指定すると、経過時間は${String(s)}秒（超えない）`, () => {
      for (const b of [build([STRIKE]), build([SPELL])]) {
        const r = run(b, s);
        expect(r.seconds).toBeLessThanOrEqual(s + EPS);
        expect(r.seconds).toBeCloseTo(s, 12);
        expect(r.killTime).toBeUndefined();
        expect(r.dps).toBeCloseTo(r.totalDamage / s, 9);
      }
    });
  }
});

describe("1/60秒の整数倍なら、従来の計算結果を維持する", () => {
  const load = (id: string): Build =>
    buildSchema.parse(
      JSON.parse(readFileSync(new URL(`../builds/${id}.json`, import.meta.url), "utf-8")),
    );
  // 修正の前の実装（Math.ceil(seconds/dt) 回の固定の刻み）で求めた値（シード7）
  const GOLDEN: [string, string, number, Record<string, number | undefined>, number[]][] = [
    [
      "lv1-basic-longsword",
      "dummy-1",
      1,
      { seconds: dt, killTime: undefined, totalDamage: 7.232727450551465, mpSpent: 0 },
      [1],
    ],
    [
      "lv1-basic-longsword",
      "dummy-1",
      3600,
      { seconds: 60, killTime: undefined, totalDamage: 739.4695951081812, mpSpent: 0 },
      [85],
    ],
    [
      "lv1-basic-longsword",
      "boss-14@15",
      7200,
      { seconds: 120, totalDamage: 1490.4807660939405, damageTaken: 2036.5714285714291 },
      [169],
    ],
    [
      "lv1-basic-longsword",
      "enemy-1",
      307,
      { seconds: 2.15, killTime: 2.15, totalDamage: 30 },
      [4],
    ],
    [
      "lv1-rogue-dagger",
      "dummy-1",
      3600,
      { seconds: 60, totalDamage: 1052.0285323067314, mpSpent: 272 },
      [68, 29],
    ],
    [
      "lv1-rogue-dagger",
      "boss-14@15",
      7200,
      { totalDamage: 1985.1998305123875, damageTaken: 2036.5714285714291, mpSpent: 488 },
      [122, 71],
    ],
    [
      "lv1-rogue-dagger",
      "enemy-1",
      307,
      { seconds: 1.25, killTime: 1.25, totalDamage: 30, mpSpent: 12 },
      [3, 0],
    ],
    [
      "lv1-warrior-longsword",
      "dummy-1",
      1,
      { seconds: dt, totalDamage: 9.402545685716905, mpSpent: 4 },
      [1, 0],
    ],
    [
      "lv1-warrior-longsword",
      "dummy-1",
      3600,
      { seconds: 60, totalDamage: 916.7089436713597, mpSpent: 272 },
      [68, 17],
    ],
    [
      "lv1-warrior-longsword",
      "boss-14@15",
      7200,
      { totalDamage: 1808.9090779923688, damageTaken: 2036.5714285714291, mpSpent: 488 },
      [122, 47],
    ],
    [
      "lv1-warrior-longsword",
      "enemy-1",
      307,
      { seconds: 1.4333333333333333, killTime: 1.4333333333333333, totalDamage: 30 },
      [3, 0],
    ],
  ];

  for (const [id, targetName, steps, expected, uses] of GOLDEN) {
    it(`${id} / ${targetName} / ${String(steps)}刻み`, () => {
      const r = run(load(id), steps * dt, targetByName(targetName), 7);
      for (const [key, value] of Object.entries(expected)) {
        expect(r[key as keyof typeof r], key).toBe(value);
      }
      expect(r.skills.map((s) => s.uses)).toEqual(uses);
    });
  }

  it("整数倍の時間では、短い時間の結果が長い時間の途中経過と一致する（端数の刻みを作らない）", () => {
    const b = build([{ ...STRIKE, ailmentChance: { "TAG-AIL-BLEED": 0.5 } }]);
    const short = run(b, 0.5);
    const shortByCount = run(b, 30 * dt);
    expect(short).toEqual(shortByCount);
  });
});

describe("最後の端数の刻みの、時間に依存する計算", () => {
  /** 最大MP（60）を全て使う技（1回だけ使える。以後は回復するだけ）。毎秒の回復は 60×6%＝3.6。 */
  const drain = build([{ ...STRIKE, mpCost: 60 }]);
  const REGEN = 60 * 0.06;

  it("最後の刻みのMPの回復は、実際の経過時間の分だけ", () => {
    for (const s of [0.51, 1.01]) {
      const r = run(drain, s);
      expect(r.mpSpent).toBe(60);
      // 1刻み目（dt）の終わりに使い切り、その後 (s − dt) 秒だけ回復する
      expect(r.finalMp).toBeCloseTo(REGEN * (s - dt), 9);
      // 切り上げた刻み（ceil(s/dt)×dt）の分は回復しない
      expect(r.finalMp).toBeLessThan(REGEN * (Math.ceil(s / dt) * dt - dt) - 1e-6);
    }
  });

  it("最後の刻みの持続ダメージは、実際の経過時間の分だけ（直前と直後の整数倍の刻みの間を比で補う）", () => {
    // 1回だけ出血を付ける技（その後は CD の間、何もしない）。崩し係数0・移動なしで、毎秒の持続ダメージは一定
    const once = build([{ ...STRIKE, ailmentChance: { "TAG-AIL-BLEED": 1 }, cooldown: 1000 }]);
    for (const s of [0.51, 1.01]) {
      const k = Math.floor(s / dt);
      const before = run(once, k * dt).dotDamage;
      const after = run(once, (k + 1) * dt).dotDamage;
      const r = run(once, s);
      expect(r.ailmentsApplied["TAG-AIL-BLEED"]).toBe(1);
      expect(after).toBeGreaterThan(before);
      const fraction = (s - k * dt) / dt;
      expect(r.dotDamage).toBeCloseTo(before + (after - before) * fraction, 9);
      expect(r.dotDamage).toBeLessThan(after - 1e-9);
    }
  });
});

describe("指定の時間を超える攻撃・詠唱・敵の攻撃が起きない", () => {
  it("次の攻撃・詠唱が指定の時間より後なら、使わない", () => {
    // 1回目は1刻み目（dt）の終わり。動作の時間は1秒（端数を持ち越す）なので、2回目は 60×dt（＝1秒）。
    // 従来の切り上げでは、0.99秒でも1秒まで進めて2回目を使っていた
    for (const b of [build([STRIKE]), build([SPELL])]) {
      expect(run(b, 0.99).skills[0]?.uses).toBe(1);
      expect(run(b, 59 * dt + dt / 2).skills[0]?.uses).toBe(1);
      expect(run(b, 60 * dt).skills[0]?.uses).toBe(2);
      expect(run(b, 1.01).skills[0]?.uses).toBe(2);
      expect(run(b, 1.99).skills[0]?.uses).toBe(2);
      // 最初の動作は、指定の時間が短くても、その時間の中で使う
      expect(run(b, 0.001).skills[0]?.uses).toBe(1);
    }
  });

  it("CD が指定の時間より後に明ける技は、使わない", () => {
    // 1.0秒の CD・速い動作の技を優先。CD の間は通常攻撃でつなぐ。CD は1刻み目の終わりから数え、61×dt で明ける
    const fast = { ...WEAPON, attackSpeed: 10 };
    const b: Build = {
      ...build([{ ...STRIKE, name: "強撃", cooldown: 1 }, STRIKE]),
      weapon: fast,
    };
    expect(run(b, 1.01).skills[0]?.uses).toBe(1);
    expect(run(b, 61 * dt).skills[0]?.uses).toBe(2);
    expect(run(b, 1.02).skills[0]?.uses).toBe(2);
  });

  it("敵の攻撃が指定の時間より後なら、受けない", () => {
    // 0.5秒ごとに、標準HP（Lv1で60）の10%の呪文（回避されない）。1回で6
    const target: Target = {
      ...dummy(1),
      attack: { ratioOfStandardHp: 0.1, interval: 0.5, element: "fire", spell: true },
    };
    const b = build([STRIKE]);
    expect(run(b, 0.49, target).damageTaken).toBe(0);
    expect(run(b, 0.51, target).damageTaken).toBeCloseTo(6, 9);
    expect(run(b, 1.01, target).damageTaken).toBeCloseTo(12, 9);
    expect(run(b, 0.001, target).damageTaken).toBe(0);
  });
});

describe("撃破の時間は指定の時間以内", () => {
  /** 1ヒットの打撃値。 */
  const perHit = run(build([STRIKE]), dt).hitDamage;
  const withHp = (maxHp: number): Target => ({ ...dummy(1), maxHp });

  it("最後の端数の刻みで倒すと、撃破の時間は指定の時間", () => {
    expect(perHit).toBeGreaterThan(0);
    for (const s of FRACTIONAL) {
      const r = run(build([STRIKE]), s, withHp(perHit * 0.5));
      expect(r.killTime).toBeDefined();
      expect(r.killTime ?? Infinity).toBeLessThanOrEqual(s + EPS);
      expect(r.seconds).toBe(r.killTime);
      expect(r.totalDamage).toBeCloseTo(perHit * 0.5, 9);
    }
  });

  it("指定の時間より後に倒すはずの的は、倒さない（撃破の時間を返さない）", () => {
    // 2回目の攻撃（60×dt＝1秒）で倒れる的
    const target = withHp(perHit * 1.5);
    const r = run(build([STRIKE]), 0.99, target);
    expect(r.killTime).toBeUndefined();
    expect(r.seconds).toBeCloseTo(0.99, 12);
    expect(r.totalDamage).toBeCloseTo(perHit, 9);
    const later = run(build([STRIKE]), 1.01, target);
    expect(later.killTime).toBeCloseTo(60 * dt, 12);
    expect(later.killTime ?? Infinity).toBeLessThanOrEqual(1.01 + EPS);
  });

  it("指定の時間の途中で倒したら、従来どおりその刻みの終わりが撃破の時間", () => {
    const r = run(build([STRIKE]), 10.005, withHp(perHit * 1.5));
    expect(r.killTime).toBeCloseTo(60 * dt, 12);
    expect(r.seconds).toBe(r.killTime);
  });
});
