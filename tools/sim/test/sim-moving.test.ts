/**
 * PR #8（U-05 DPSシミュレーター）のレビュー指摘の回帰テスト：端数の刻みでの移動の割合。
 *
 * 的が移動している時間は、刻みの回数ではなく実際の経過時間 × 移動の割合で割り振る。
 * 端数の刻み（1/60秒未満）でも、その幅に応じた分だけ移動中として扱い、1つの刻みに移動と停止が
 * 混ざるときは、それぞれの時間で AilmentState.tick() を呼ぶ（tick の持続ダメージは経過時間に比例する）。
 * 割合0・1、および割合を指定しない的の、1/60秒の整数倍の時間での結果は従来と同じ。
 */
import { FIXED_STEP_SECONDS } from "@stella/core";
import { loadGameContent } from "@stella/content";
import { describe, expect, it } from "vitest";
import type { Build, SimSkill, Target } from "../src/build.ts";
import { simulate } from "../src/simulate.ts";
import { dummy } from "../src/targets.ts";

const db = loadGameContent();
const dt = FIXED_STEP_SECONDS;
/** 時間（秒）の比較の許容誤差（浮動小数点の誤差の積み重ねを見込む）。 */
const TIME_EPS = 1e-9;
/** ダメージの比較の相対の許容誤差。 */
const REL_EPS = 1e-9;

/** 出血の移動中の倍率（データ：TAG-AIL-BLEED の movingMultiplier）。 */
const bleedDef = [...db.ailments.values()].find((d) => d.tag === "TAG-AIL-BLEED");
const MOVING_MULTIPLIER =
  bleedDef !== undefined && "movingMultiplier" in bleedDef ? (bleedDef.movingMultiplier ?? 1) : 1;

/** 打撃値が決まった値（10）になる武器（会心なし・1回/秒）。 */
const WEAPON: NonNullable<Build["weapon"]> = {
  uid: "wpn-a",
  tags: ["TAG-WPN-DAGGER"],
  base: { physical: { min: 10, max: 10 } },
  critChance: 0,
  attackSpeed: 1,
};

/** 必ず出血を付ける技。崩し係数0（崩れて受けるダメージが変わらないように）。 */
const BLEED: SimSkill = {
  name: "出血の一撃",
  tags: ["TAG-FORM-MELEE"],
  kind: "weapon",
  pct: 1,
  mpCost: 0,
  cooldown: 0,
  ailmentChance: { "TAG-AIL-BLEED": 1 },
  staggerCoefficient: 0,
};

const build = (skill: SimSkill): Build => ({
  id: "test",
  name: "テスト",
  characterLevel: 1,
  weapon: WEAPON,
  rotation: [skill],
});
/** 1回だけ出血を付ける（その後は CD の間、何もしない。持続ダメージの速さが一定）。 */
const once = build({ ...BLEED, cooldown: 1000 });
/** 毎秒、出血を付け直す。 */
const repeated = build(BLEED);

const target = (movingRatio: number | undefined): Target =>
  movingRatio === undefined ? dummy(1) : { ...dummy(1), movingRatio };
const run = (b: Build, seconds: number, movingRatio: number | undefined, seed = 1) =>
  simulate(db, b, target(movingRatio), { seconds, seed });

const FRACTIONAL = [0.51, 1.01] as const;
const RATIOS = [0, 0.3, 0.55, 0.999, 1] as const;

describe("前提：出血は移動中に持続ダメージが増える", () => {
  it("出血の定義に、1より大きい移動中の倍率がある", () => {
    expect(MOVING_MULTIPLIER).toBeGreaterThan(1);
  });
});

describe("移動の時間は、経過時間 × 移動の割合", () => {
  for (const s of [...FRACTIONAL, 0.5, 1, 30 * dt + dt / 3]) {
    it(`${String(s)}秒：移動の時間 ＝ ${String(s)} × 割合`, () => {
      for (const r of RATIOS) {
        const result = run(once, s, r);
        expect(result.seconds).toBeCloseTo(s, 12);
        expect(Math.abs(result.movingSeconds - s * r), `割合 ${String(r)}`).toBeLessThanOrEqual(
          TIME_EPS,
        );
      }
    });
  }

  it("割合0なら移動の時間は0、割合1なら経過時間の全て", () => {
    for (const s of [...FRACTIONAL, 0.001, 60 * dt]) {
      expect(run(once, s, 0).movingSeconds).toBe(0);
      expect(run(once, s, undefined).movingSeconds).toBe(0);
      expect(Math.abs(run(once, s, 1).movingSeconds - s)).toBeLessThanOrEqual(TIME_EPS);
    }
  });

  it("1刻み（1/60秒）より短い時間でも、その幅 × 割合だけ移動する", () => {
    expect(Math.abs(run(once, 0.001, 0.55).movingSeconds - 0.00055)).toBeLessThanOrEqual(TIME_EPS);
  });
});

describe("持続ダメージは、移動と停止の時間の配分どおり", () => {
  it("出血の持続ダメージ ＝ 止まっているときの値 ×（1 ＋（倍率−1）× 割合）（端数の刻みを含む）", () => {
    // 出血は1回だけ・5秒持続なので、この時間の中では持続ダメージの速さが一定
    for (const s of [...FRACTIONAL, 0.5, 1, 2.345]) {
      const still = run(once, s, 0).dotDamage;
      expect(still).toBeGreaterThan(0);
      for (const r of RATIOS) {
        const expected = still * (1 + (MOVING_MULTIPLIER - 1) * r);
        const actual = run(once, s, r).dotDamage;
        expect(
          Math.abs(actual - expected) / expected,
          `${String(s)}秒・割合 ${String(r)}`,
        ).toBeLessThanOrEqual(REL_EPS);
      }
    }
  });

  it("出血が最後まで切れるとき、持続ダメージの合計は 総量 ×（1 ＋（倍率−1）× 割合）", () => {
    const total = run(once, 10, 0).dotDamage;
    for (const r of RATIOS) {
      const expected = total * (1 + (MOVING_MULTIPLIER - 1) * r);
      expect(Math.abs(run(once, 10, r).dotDamage - expected) / expected).toBeLessThanOrEqual(
        REL_EPS,
      );
    }
  });

  it("出血を重ね続けても、持続ダメージは割合に比例して増える（割合0と1の間を直線で補う）", () => {
    for (const s of [...FRACTIONAL, 3.21]) {
      const still = run(repeated, s, 0).dotDamage;
      const moving = run(repeated, s, 1).dotDamage;
      expect(moving).toBeGreaterThan(still);
      for (const r of RATIOS) {
        const expected = still + (moving - still) * r;
        expect(Math.abs(run(repeated, s, r).dotDamage - expected) / expected).toBeLessThanOrEqual(
          REL_EPS,
        );
      }
    }
  });
});

describe("端数の刻みの有無で、持続ダメージが不自然に増減しない", () => {
  it("端数の刻みの持続ダメージは、直前と直後の整数倍の刻みの間を比で補った値", () => {
    for (const s of FRACTIONAL) {
      const k = Math.floor(s / dt);
      const fraction = (s - k * dt) / dt;
      for (const r of RATIOS) {
        const before = run(once, k * dt, r).dotDamage;
        const after = run(once, (k + 1) * dt, r).dotDamage;
        const actual = run(once, s, r).dotDamage;
        expect(after).toBeGreaterThan(before);
        expect(actual).toBeGreaterThan(before);
        expect(actual).toBeLessThan(after);
        expect(actual).toBeCloseTo(before + (after - before) * fraction, 9);
      }
    }
  });

  it("時間を少しずつ延ばしても、持続ダメージは単調に増え、時間あたりの増え方が一定", () => {
    // 割合0.55：刻みごとの判定（従来）なら、端数の刻みでも丸ごと移動中か停止中のどちらかになり、増え方が跳ねる
    const r = 0.55;
    const rate = run(once, 1, r).dotDamage - run(once, 0.5, r).dotDamage; // 0.5秒あたり
    let previous = run(once, 0.5, r).dotDamage;
    for (let s = 0.5 + 0.001; s <= 1 + 1e-12; s += 0.001) {
      const current = run(once, s, r).dotDamage;
      expect(current).toBeGreaterThanOrEqual(previous);
      expect(current - run(once, 0.5, r).dotDamage).toBeCloseTo((rate * (s - 0.5)) / 0.5, 9);
      previous = current;
    }
  });
});

describe("割合0・1と、割合を指定しない的では、整数倍の時間で従来の結果を維持する", () => {
  // 修正の前の実装（刻みの回数で移動を判定）で求めた値（シード11・出血の確率0.5）
  const chance = build({ ...BLEED, ailmentChance: { "TAG-AIL-BLEED": 0.5 } });
  const GOLDEN: [number | undefined, number, number, number][] = [
    [0, 600, 36.09999999999988, 146.09999999999988],
    [0, 1800, 171.10000000000392, 481.1000000000039],
    [undefined, 1800, 171.10000000000392, 481.1000000000039],
    [1, 600, 72.19999999999976, 182.19999999999976],
    [1, 1800, 342.20000000000783, 652.2000000000078],
  ];
  for (const [r, steps, dotDamage, totalDamage] of GOLDEN) {
    it(`割合 ${String(r)} / ${String(steps)}刻み`, () => {
      const result = run(chance, steps * dt, r, 11);
      expect(result.dotDamage).toBe(dotDamage);
      expect(result.totalDamage).toBe(totalDamage);
    });
  }

  it("割合0の結果は、割合を指定しない的と同じ", () => {
    for (const s of [...FRACTIONAL, 0.5, 10]) {
      expect(run(repeated, s, 0)).toEqual(run(repeated, s, undefined));
    }
  });
});
