/**
 * PR #8（U-05 DPSシミュレーター）のレビュー指摘の回帰テスト：時間刻みの途中で切れる持続ダメージと移動の割合。
 *
 * AilmentState.tick() は、各持続ダメージを残り時間までしか進めない。1つの刻みを「移動 → 停止」の順に
 * tick するだけでは、刻みの途中で切れる持続ダメージの有効な時間が、先に呼んだ移動の側に偏る
 * （例：刻み1/60秒・割合0.55・残り0.01秒なら、有効な時間の約92%が移動中になる。本来は55%）。
 * シミュレーターは、持続ダメージが切れる時刻で刻みを区間に分け、各区間に同じ割合で移動と停止を割り振る。
 *
 * ここでは、持続ダメージが有効だった区間だけを対象に、移動・停止の時間の配分と、ダメージの倍率を確かめる。
 */
import {
  type AilmentApplication,
  type AilmentDef,
  type AilmentTickTarget,
  type ContentDb,
  type Element,
  AilmentState,
  FIXED_STEP_SECONDS,
} from "@stella/core";
import { loadGameContent } from "@stella/content";
import { describe, expect, it } from "vitest";
import type { Build, SimSkill, Target } from "../src/build.ts";
import { simulate, splitSteps, tickDots } from "../src/simulate.ts";
import { dummy } from "../src/targets.ts";

const db = loadGameContent();
const dt = FIXED_STEP_SECONDS;
/** 時間（秒）の比較の許容誤差。 */
const TIME_EPS = 1e-12;
/** ダメージの比較の相対の許容誤差。 */
const REL_EPS = 1e-9;

const bleedDef = db.ailments.get("AIL-BLEED");
if (bleedDef === undefined || bleedDef.kind !== "dot") throw new Error("出血の定義がない");
/** 出血の移動中の倍率（データ：AIL-BLEED の movingMultiplier）。 */
const M = bleedDef.movingMultiplier ?? 1;
const MAX_STACKS = bleedDef.stacking.mode === "stack" ? bleedDef.stacking.maxStacks : undefined;

const bleed = (total: number, duration: number): AilmentApplication => ({
  ailmentId: "AIL-BLEED",
  tag: "TAG-AIL-BLEED",
  total,
  duration,
  maxStacks: MAX_STACKS,
});

const relErr = (actual: number, expected: number): number =>
  Math.abs(actual - expected) / Math.abs(expected);

/** tick の呼び出しごとに、持続ダメージが有効だった時間と、そのときの移動の有無・ダメージを記録する。 */
interface TickRecord {
  readonly span: number;
  readonly moving: boolean;
  /** この呼び出しのうち、持続ダメージ（1つだけ付与する前提）が有効だった時間。 */
  readonly active: number;
  readonly damage: number;
}
class RecordingAilmentState extends AilmentState {
  readonly records: TickRecord[] = [];
  override tick(dt: number, target: AilmentTickTarget = {}): Partial<Record<Element, number>> {
    const active = Math.min(dt, this.nextDotExpiry()); // 持続ダメージがなければ Infinity なので dt
    const hasDot = this.nextDotExpiry() !== Infinity;
    const out = super.tick(dt, target);
    let damage = 0;
    for (const v of Object.values(out)) damage += v;
    this.records.push({
      span: dt,
      moving: target.moving === true,
      active: hasDot ? active : 0,
      damage,
    });
    return out;
  }
  sum(moving: boolean, key: "active" | "damage" | "span"): number {
    let s = 0;
    for (const r of this.records) if (r.moving === moving) s += r[key];
    return s;
  }
}

/** 修正の前の実装（移動 → 停止の順に、それぞれの時間で1回ずつ tick）。偏りを示す比較に使う。 */
function tickDotsMovingFirst(state: AilmentState, h: number, movingPart: number): number {
  let total = 0;
  for (const [span, moving] of [
    [movingPart, true],
    [h - movingPart, false],
  ] as const) {
    if (span <= 0) continue;
    for (const v of Object.values(state.tick(span, { moving }))) total += v;
  }
  return total;
}

/** 出血1つ（総量 total・持続 duration）を、幅 h・移動 r×h の刻みで1回進める。 */
function oneStep(total: number, duration: number, h: number, r: number) {
  const state = new RecordingAilmentState(db);
  state.apply(bleed(total, duration));
  const damage = tickDots(state, h, r * h, {});
  return { state, damage };
}

describe("前提", () => {
  it("出血は移動中に持続ダメージが増える（倍率 > 1）", () => {
    expect(M).toBeGreaterThan(1);
  });
});

describe("1刻みより短い残り時間（刻みの途中で切れる）", () => {
  it("刻み1/60秒・割合0.55・残り0.01秒：有効な時間の55%が移動中、45%が停止中", () => {
    const total = 15;
    const d = 0.01;
    const { state, damage } = oneStep(total, d, dt, 0.55);
    expect(state.sum(true, "active")).toBeCloseTo(d * 0.55, 12);
    expect(state.sum(false, "active")).toBeCloseTo(d * 0.45, 12);
    expect(relErr(damage, total * (1 + (M - 1) * 0.55))).toBeLessThanOrEqual(REL_EPS);
    expect(state.stacks("AIL-BLEED")).toBe(0);
    // 刻みの移動・停止の時間の合計は変わらない（刻みの幅 × 割合）
    expect(state.sum(true, "span")).toBeCloseTo(dt * 0.55, 12);
    expect(state.sum(false, "span")).toBeCloseTo(dt * 0.45, 12);
  });

  it("（比較）移動 → 停止の順に tick するだけでは、有効な時間が移動に偏る", () => {
    const state = new AilmentState(db);
    state.apply(bleed(15, 0.01));
    const biased = tickDotsMovingFirst(state, dt, 0.55 * dt);
    // 移動中が 0.55/60 ≒ 0.00917秒（有効な時間の約92%）になり、ダメージが多すぎる
    expect(biased).toBeGreaterThan(15 * (1 + (M - 1) * 0.55) * 1.1);
  });
});

describe("残り時間が、移動と停止の境界（刻みの 0.55 の位置）をまたぐ・またがない", () => {
  const r = 0.55;
  const total = 12;
  // 残り時間 e（刻みに対する比）：境界の手前・ちょうど・後ろ・刻みの終わり・刻みより長い
  for (const k of [0.1, 0.3, 0.5, 0.55, 0.6, 0.8, 0.999, 1, 1.5, 3]) {
    it(`残り ${String(k)} 刻み：有効な時間 × 割合だけ移動中で、ダメージは率 ×（停止 ＋ 倍率 × 移動）`, () => {
      const e = k * dt;
      const { state, damage } = oneStep(total, e, dt, r);
      const active = Math.min(e, dt);
      expect(Math.abs(state.sum(true, "active") - active * r)).toBeLessThanOrEqual(TIME_EPS);
      expect(Math.abs(state.sum(false, "active") - active * (1 - r))).toBeLessThanOrEqual(TIME_EPS);
      const rate = total / e;
      expect(relErr(damage, rate * active * (1 + (M - 1) * r))).toBeLessThanOrEqual(REL_EPS);
      expect(state.stacks("AIL-BLEED")).toBe(k <= 1 ? 0 : 1);
    });
  }

  it("1つの刻みの途中で、残り時間の違う出血がいくつも切れる", () => {
    for (const r of [0.2, 0.55, 0.9]) {
      const state = new AilmentState(db);
      const apps = [
        bleed(6, 0.2 * dt),
        bleed(9, 0.7 * dt),
        bleed(4, 0.55 * dt),
        bleed(30, 5), // 刻みの中では切れない
      ];
      for (const a of apps) state.apply(a);
      const damage = tickDots(state, dt, r * dt, {});
      let expected = 0;
      for (const a of apps) expected += (a.total / a.duration) * Math.min(a.duration, dt);
      expected *= 1 + (M - 1) * r;
      expect(relErr(damage, expected), `割合 ${String(r)}`).toBeLessThanOrEqual(REL_EPS);
      expect(state.stacks("AIL-BLEED")).toBe(1);
    }
  });
});

describe("割合0・1の境界値", () => {
  for (const k of [0.3, 0.55, 1, 2]) {
    it(`残り ${String(k)} 刻み：割合0は全て停止、割合1は全て移動（1回の tick で、区間を分けない）`, () => {
      const e = k * dt;
      const active = Math.min(e, dt);
      const still = oneStep(10, e, dt, 0);
      expect(still.state.records).toHaveLength(1);
      expect(still.state.sum(true, "active")).toBe(0);
      expect(still.state.sum(false, "active")).toBeCloseTo(active, 12);
      expect(relErr(still.damage, (10 / e) * active)).toBeLessThanOrEqual(REL_EPS);
      const moving = oneStep(10, e, dt, 1);
      expect(moving.state.records).toHaveLength(1);
      expect(moving.state.sum(false, "active")).toBe(0);
      expect(moving.state.sum(true, "active")).toBeCloseTo(active, 12);
      expect(relErr(moving.damage, (10 / e) * active * M)).toBeLessThanOrEqual(REL_EPS);
    });
  }

  it("割合を0・1にごく近づけると、ダメージは割合0・1の値に連続して近づく", () => {
    const e = 0.4 * dt;
    expect(relErr(oneStep(10, e, dt, 1e-9).damage, 10)).toBeLessThanOrEqual(1e-8);
    expect(relErr(oneStep(10, e, dt, 1 - 1e-9).damage, 10 * M)).toBeLessThanOrEqual(1e-8);
  });
});

describe("シミュレーター：出血が刻みの途中で切れる（持続だけを変えたデータ）", () => {
  /** 出血の持続だけを d 秒にしたデータ（rollAilments の持続の下限は0.1秒）。 */
  const withBleedDuration = (d: number): ContentDb => {
    const swap = (def: AilmentDef): AilmentDef =>
      def.id === "AIL-BLEED" && def.kind === "dot" ? { ...def, duration: d } : def;
    return {
      ...db,
      ailments: new Map([...db.ailments].map(([k, v]) => [k, swap(v)])),
      ailmentsByTag: new Map([...db.ailmentsByTag].map(([k, v]) => [k, swap(v)])),
    };
  };
  /** 打撃値10（会心なし）・1回だけ必ず出血（総量 10 × 150%）。崩し係数0。 */
  const skill: SimSkill = {
    name: "出血の一撃",
    tags: ["TAG-FORM-MELEE"],
    kind: "weapon",
    pct: 1,
    mpCost: 0,
    cooldown: 1000,
    ailmentChance: { "TAG-AIL-BLEED": 1 },
    staggerCoefficient: 0,
  };
  const build: Build = {
    id: "test",
    name: "テスト",
    characterLevel: 1,
    weapon: {
      uid: "wpn-a",
      tags: ["TAG-WPN-DAGGER"],
      base: { physical: { min: 10, max: 10 } },
      critChance: 0,
      attackSpeed: 1,
    },
    rotation: [skill],
  };
  const target = (r: number): Target => ({ ...dummy(1), movingRatio: r });
  const run = (d: number, seconds: number, r: number) =>
    simulate(withBleedDuration(d), build, target(r), { seconds, seed: 1 });
  const RATIOS = [0, 0.3, 0.55, 0.999, 1] as const;

  it("前提：持続を変えたデータで、出血の総量（15）を最後まで与える", () => {
    expect(run(0.105, 1, 0).dotDamage).toBeCloseTo(15, 9);
  });

  // 0.105秒：7刻み目（0.1〜0.1167秒）の途中、残り0.005秒（移動の部分 0.55/60 ≒ 0.0092秒より短い）で切れる
  for (const d of [0.1001, 0.105, 0.11, 0.1166, 0.25 + dt / 3, 0.5 + 0.9 * dt]) {
    it(`持続 ${d.toFixed(5)}秒：持続ダメージ ＝ 15 ×（1 ＋（倍率−1）× 割合）（割合0.55を含む）`, () => {
      for (const r of RATIOS) {
        const result = run(d, 1, r);
        expect(
          relErr(result.dotDamage, 15 * (1 + (M - 1) * r)),
          `割合 ${String(r)}`,
        ).toBeLessThanOrEqual(REL_EPS);
        // 移動の時間は、従来どおり 経過時間 × 割合
        expect(Math.abs(result.movingSeconds - 1 * r)).toBeLessThanOrEqual(1e-9);
      }
    });
  }

  it("（比較）割合0.55で残り0.005秒の区間を移動 → 停止の順に処理すると、偏りの分だけ多くなる", () => {
    // 7刻み目の残り0.005秒が全て移動中なら 15 ×（0.1×1.55 ＋ 0.005×2）/0.105 で、正しい値より大きい
    const biased = (15 / 0.105) * (0.1 * (1 + (M - 1) * 0.55) + 0.005 * M);
    const correct = 15 * (1 + (M - 1) * 0.55);
    expect(biased).toBeGreaterThan(correct);
    expect(relErr(run(0.105, 1, 0.55).dotDamage, correct)).toBeLessThanOrEqual(REL_EPS);
  });
});

describe("端数の時間（0.51秒・1.01秒）との整合性", () => {
  /** シミュレーターと同じ刻み（整数倍の刻み ＋ 最後の端数の刻み）で、出血1つを進める。 */
  const runSteps = (seconds: number, d: number, r: number) => {
    const state = new RecordingAilmentState(db);
    state.apply(bleed(15, d));
    const { fullSteps, remainder } = splitSteps(seconds, dt);
    let damage = 0;
    let time = 0;
    for (let i = 0; i < fullSteps + (remainder > 0 ? 1 : 0); i++) {
      const partial = i >= fullSteps;
      const h = partial ? remainder : dt;
      const start = time;
      time = partial ? seconds : (i + 1) * dt;
      const movingPart = r <= 0 ? 0 : r >= 1 ? h : Math.min(h, Math.max(0, r * time - r * start));
      damage += tickDots(state, h, movingPart, {});
    }
    return { state, damage };
  };

  for (const s of [0.51, 1.01]) {
    const { fullSteps, remainder } = splitSteps(s, dt);
    // 端数の刻みの直前・途中・ちょうど終わり、整数倍の刻みの途中、時間内に切れない
    const lastStart = fullSteps * dt;
    const durations = [
      lastStart - 0.3 * dt,
      lastStart + 0.25 * remainder,
      lastStart + 0.7 * remainder,
      lastStart + 0.999 * remainder,
      s / 2 + dt / 7,
      s + 0.3,
    ];
    for (const d of durations) {
      it(`${String(s)}秒・持続 ${d.toFixed(5)}秒：有効な時間のうち移動中 ＝ 有効な時間 × 割合、ダメージも対応する`, () => {
        for (const r of [0, 0.3, 0.55, 0.999, 1]) {
          const { state, damage } = runSteps(s, d, r);
          const active = Math.min(d, s);
          const label = `割合 ${String(r)}`;
          expect(Math.abs(state.sum(true, "active") - active * r), label).toBeLessThanOrEqual(1e-9);
          expect(
            Math.abs(state.sum(false, "active") - active * (1 - r)),
            label,
          ).toBeLessThanOrEqual(1e-9);
          // 移動中・停止中の持続ダメージは、それぞれの有効な時間 × 率（移動中は × 倍率）
          const rate = 15 / d;
          if (r > 0)
            expect(
              relErr(state.sum(true, "damage"), rate * active * r * M),
              label,
            ).toBeLessThanOrEqual(REL_EPS);
          if (r < 1)
            expect(
              relErr(state.sum(false, "damage"), rate * active * (1 - r)),
              label,
            ).toBeLessThanOrEqual(REL_EPS);
          expect(relErr(damage, rate * active * (1 + (M - 1) * r)), label).toBeLessThanOrEqual(
            REL_EPS,
          );
          // 刻みの移動の時間の合計は、経過時間 × 割合（端数の刻みを含む）
          expect(Math.abs(state.sum(true, "span") - s * r), label).toBeLessThanOrEqual(1e-9);
        }
      });
    }
  }
});

describe("切れるまでの移動・停止の時間の配分と、持続ダメージ", () => {
  it("割合0.55：出血が切れるまでの移動中・停止中の時間は 0.55 : 0.45、ダメージは移動中だけ倍率がかかる", () => {
    const r = 0.55;
    for (const d of [0.01, 0.105, 0.5 + dt / 3, 1.2345, 5]) {
      const state = new RecordingAilmentState(db);
      state.apply(bleed(15, d));
      let t = 0;
      while (state.stacks("AIL-BLEED") > 0) {
        tickDots(state, dt, r * dt, {});
        t += dt;
        if (t > d + 1) throw new Error("出血が切れない");
      }
      const movingActive = state.sum(true, "active");
      const stillActive = state.sum(false, "active");
      expect(Math.abs(movingActive + stillActive - d), `持続 ${String(d)}`).toBeLessThanOrEqual(
        1e-9,
      );
      expect(Math.abs(movingActive - d * r), `持続 ${String(d)}`).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(stillActive - d * (1 - r)), `持続 ${String(d)}`).toBeLessThanOrEqual(1e-9);
      // 移動中のダメージ ＝ 移動中の有効な時間 × 率 × 倍率、停止中 ＝ 停止中の有効な時間 × 率
      expect(relErr(state.sum(true, "damage"), (15 / d) * movingActive * M)).toBeLessThanOrEqual(
        REL_EPS,
      );
      expect(relErr(state.sum(false, "damage"), (15 / d) * stillActive)).toBeLessThanOrEqual(
        REL_EPS,
      );
    }
  });
});
