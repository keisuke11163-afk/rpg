/**
 * PR #8（U-05 DPSシミュレーター）のレビュー指摘の回帰テスト。
 *
 * 1. 武器の局所の効果が、別の武器・呪文のヒットに漏れない（状態異常の計算に渡す weaponUid）
 * 2. 攻撃速度・詠唱速度・MPの回復に、乗算（more）も効く（ModifierView の規則）
 * 3. 的を倒した後のヒット・持続ダメージ・状態異常を計上しない（オーバーキルを除く）
 * 4. シミュレーションの時間（seconds）の検証（本体と CLI）
 */
import { type ContentDb, type RawContent, FIXED_STEP_SECONDS, loadContent } from "@stella/core";
import { rawContent } from "@stella/content";
import { describe, expect, it } from "vitest";
import type { Build, SimSkill, Target } from "../src/build.ts";
import { DEFAULT_SECONDS, argValue, parseSeconds } from "../src/options.ts";
import { simulate, validateSeconds } from "../src/simulate.ts";
import { dummy } from "../src/targets.ts";

const effect = (
  id: string,
  origin: string,
  modifiers: unknown[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  origin,
  modifiers,
  affects: { hit: true, ailmentBase: true },
  scope: "self",
  ...extra,
});

/** ゲームのデータに、テスト用の効果を足したもの。 */
const TEST_EFFECTS = [
  // 武器の局所の効果：必ず出血
  effect(
    "EFF-TEST-LOCAL-FORCE-BLEED",
    "unique",
    [{ kind: "flag", flag: "ailmentApply", mode: "force", target: "TAG-AIL-BLEED" }],
    { locality: "local" },
  ),
  // 武器の局所の効果：出血の付与率 +100%（STAT-AILMENT-CHANCE の追加値）
  effect(
    "EFF-TEST-LOCAL-BLEED-CHANCE",
    "affix",
    [
      {
        kind: "added",
        stat: "STAT-AILMENT-CHANCE",
        value: 1,
        filter: { allOf: ["TAG-AIL-BLEED"] },
      },
    ],
    { locality: "local" },
  ),
  // 全体の効果：必ず出血（呪文でも出血しうることの対照）
  effect("EFF-TEST-GLOBAL-FORCE-BLEED", "unique", [
    { kind: "flag", flag: "ailmentApply", mode: "force", target: "TAG-AIL-BLEED" },
  ]),
  effect("EFF-TEST-AS-MORE", "unique", [{ kind: "more", stat: "STAT-ATTACK-SPEED", value: 2 }]),
  effect("EFF-TEST-AS-INC", "affix", [
    { kind: "increased", stat: "STAT-ATTACK-SPEED", value: 0.5 },
  ]),
  effect("EFF-TEST-CS-MORE", "unique", [{ kind: "more", stat: "STAT-CAST-SPEED", value: 2 }]),
  effect("EFF-TEST-CS-INC", "affix", [{ kind: "increased", stat: "STAT-CAST-SPEED", value: 0.5 }]),
  effect("EFF-TEST-MP-MORE", "unique", [{ kind: "more", stat: "STAT-MP-REGEN", value: 2 }]),
  effect("EFF-TEST-MP-INC", "affix", [{ kind: "increased", stat: "STAT-MP-REGEN", value: 0.5 }]),
];

function testDb(): ContentDb {
  const raw: RawContent = {
    ...rawContent,
    collections: {
      ...rawContent.collections,
      effects: [
        ...rawContent.collections.effects,
        { file: "test/effects.json", entries: TEST_EFFECTS },
      ],
    },
  };
  const r = loadContent(raw);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.content;
}

const db = testDb();
const dt = FIXED_STEP_SECONDS;

/** 打撃値が決まった値（10）になる武器（会心なし）。 */
const weapon = (uid: string): NonNullable<Build["weapon"]> => ({
  uid,
  tags: ["TAG-WPN-DAGGER"],
  base: { physical: { min: 10, max: 10 } },
  critChance: 0,
  attackSpeed: 1,
});

/** 崩し係数0（崩れて受けるダメージが変わらないように、打撃値を毎回同じにする）。 */
const STRIKE: SimSkill = {
  name: "一撃",
  tags: ["TAG-FORM-MELEE"],
  kind: "weapon",
  pct: 1,
  mpCost: 0,
  cooldown: 0,
  staggerCoefficient: 0,
};

const PHYS_SPELL: SimSkill = {
  name: "物理の呪文",
  tags: ["TAG-FORM-SPELL"],
  kind: "spell",
  pct: 1,
  base: { physical: { min: 10, max: 10 } },
  mpCost: 0,
  cooldown: 0,
  castTime: 1,
};

function build(partial: Partial<Build> & Pick<Build, "rotation">): Build {
  return { id: "test", name: "テスト", characterLevel: 1, weapon: weapon("wpn-a"), ...partial };
}

/** 1ステップだけ戦って、1回目の技の結果を返す。 */
function firstUse(b: Build, target: Target = dummy(1)) {
  return simulate(db, b, target, { seconds: dt, seed: 1 });
}

// ---------------------------------------------------------------------------
// 修正1：武器の局所の効果の範囲
// ---------------------------------------------------------------------------

describe("修正1：武器の局所の状態異常の補正は、その武器の攻撃だけに効く", () => {
  const fromA = [
    { id: "EFF-TEST-LOCAL-FORCE-BLEED", sourceKind: "equipment" as const, source: "wpn-a" },
  ];
  const chanceFromA = [
    { id: "EFF-TEST-LOCAL-BLEED-CHANCE", sourceKind: "equipment" as const, source: "wpn-a" },
  ];

  it("武器Aの局所の補正（必ず出血・付与率）は、武器Aの攻撃に効く", () => {
    const forced = firstUse(build({ effects: fromA, rotation: [STRIKE] }));
    expect(forced.ailmentsApplied["TAG-AIL-BLEED"]).toBe(1);
    const chance = firstUse(build({ effects: chanceFromA, rotation: [STRIKE] }));
    expect(chance.ailmentsApplied["TAG-AIL-BLEED"]).toBe(1);
    // source を省略すると、ビルドの武器の uid が出どころになる
    const implicit = firstUse(
      build({
        effects: [{ id: "EFF-TEST-LOCAL-FORCE-BLEED", sourceKind: "equipment" }],
        rotation: [STRIKE],
      }),
    );
    expect(implicit.ailmentsApplied["TAG-AIL-BLEED"]).toBe(1);
  });

  it("武器Aの局所の補正は、武器Bの攻撃に効かない", () => {
    for (const effects of [fromA, chanceFromA]) {
      const r = simulate(
        db,
        build({ weapon: weapon("wpn-b"), effects, rotation: [STRIKE] }),
        dummy(1),
        {
          seconds: 10,
          seed: 2,
        },
      );
      expect(r.skills[0]?.hits).toBeGreaterThan(5);
      expect(r.ailmentsApplied["TAG-AIL-BLEED"]).toBeUndefined();
    }
  });

  it("武器Aを持っていても、呪文には武器Aの局所の補正が効かない（例外にもならない）", () => {
    for (const effects of [fromA, chanceFromA]) {
      const r = simulate(db, build({ effects, rotation: [PHYS_SPELL] }), dummy(1), {
        seconds: 10,
        seed: 3,
      });
      expect(r.skills[0]?.hits).toBeGreaterThan(5);
      expect(r.hitDamage).toBeGreaterThan(0);
      expect(r.ailmentsApplied["TAG-AIL-BLEED"]).toBeUndefined();
    }
    // 対照：全体の効果なら、同じ呪文でも出血する（呪文の物理ヒットは出血しうる）
    const global = simulate(
      db,
      build({ effects: ["EFF-TEST-GLOBAL-FORCE-BLEED"], rotation: [PHYS_SPELL] }),
      dummy(1),
      { seconds: 10, seed: 3 },
    );
    expect(global.ailmentsApplied["TAG-AIL-BLEED"]).toBeGreaterThan(5);
  });

  it("武器と呪文を交互に使っても、局所の補正は武器の攻撃だけに効く", () => {
    const r = simulate(
      db,
      build({
        effects: fromA,
        rotation: [
          { ...PHYS_SPELL, cooldown: 2 },
          { ...STRIKE, cooldown: 2 },
        ],
      }),
      dummy(1),
      { seconds: 20, seed: 4 },
    );
    const strike = r.skills.find((s) => s.name === STRIKE.name);
    expect(strike?.hits).toBeGreaterThan(0);
    // 出血は武器の攻撃の回数だけ（呪文の回数は含まない）
    expect(r.ailmentsApplied["TAG-AIL-BLEED"]).toBe(strike?.hits);
  });
});

// ---------------------------------------------------------------------------
// 修正2：速度・回復の乗算
// ---------------------------------------------------------------------------

describe("修正2：攻撃速度・詠唱速度・MPの回復に、加算と乗算の両方が効く（（1＋加算）×乗算）", () => {
  const SECONDS = 600;
  /** 動作の時間が 1/速度 のとき、SECONDS 秒の使用回数（0秒の1回目を含む）。 */
  const usesAt = (speed: number): number => 1 + SECONDS * speed;
  const uses = (b: Build): number =>
    simulate(db, b, dummy(1), { seconds: SECONDS, seed: 5 }).skills[0]?.uses ?? 0;

  it("攻撃速度に乗算が効く", () => {
    expect(uses(build({ rotation: [STRIKE] }))).toBeCloseTo(usesAt(1), -0.5);
    expect(uses(build({ effects: ["EFF-TEST-AS-MORE"], rotation: [STRIKE] }))).toBeCloseTo(
      usesAt(2),
      -0.5,
    );
  });

  it("詠唱速度に乗算が効く", () => {
    expect(uses(build({ rotation: [PHYS_SPELL] }))).toBeCloseTo(usesAt(1), -0.5);
    expect(uses(build({ effects: ["EFF-TEST-CS-MORE"], rotation: [PHYS_SPELL] }))).toBeCloseTo(
      usesAt(2),
      -0.5,
    );
  });

  it("加算と乗算を同時に付けると（1＋0.5）×2＝3倍になる（攻撃速度・詠唱速度）", () => {
    expect(
      uses(build({ effects: ["EFF-TEST-AS-INC", "EFF-TEST-AS-MORE"], rotation: [STRIKE] })),
    ).toBeCloseTo(usesAt(3), -0.5);
    expect(
      uses(build({ effects: ["EFF-TEST-CS-INC", "EFF-TEST-CS-MORE"], rotation: [PHYS_SPELL] })),
    ).toBeCloseTo(usesAt(3), -0.5);
    // 加算だけ（従来どおり）
    expect(uses(build({ effects: ["EFF-TEST-AS-INC"], rotation: [STRIKE] }))).toBeCloseTo(
      usesAt(1.5),
      -0.5,
    );
  });

  /** MPを使い切る技（10MP・1回/秒より速い）だけのビルドで、SECONDS 秒に使ったMP。 */
  const mpSpent = (effects: string[]): number =>
    simulate(
      db,
      build({
        weapon: { ...weapon("wpn-a"), attackSpeed: 4 },
        effects,
        rotation: [{ ...STRIKE, mpCost: 10 }, STRIKE],
      }),
      dummy(1),
      { seconds: SECONDS, seed: 6 },
    ).mpSpent;
  /** 最初のMP（60）＋回復（最大MP60 × 6% × 倍率 × 秒）。使い切れなかった端数（技1回分未満）を許す。 */
  const expectSpent = (spent: number, multiplier: number): void => {
    const supply = 60 + 60 * 0.06 * multiplier * SECONDS;
    expect(spent).toBeLessThanOrEqual(supply + 1e-6);
    expect(spent).toBeGreaterThan(supply - 10 - 1e-6);
  };

  it("MPの回復に乗算が効く", () => {
    expectSpent(mpSpent([]), 1);
    expectSpent(mpSpent(["EFF-TEST-MP-MORE"]), 2);
  });

  it("MPの回復に加算と乗算を同時に付けると（1＋0.5）×2＝3倍になる", () => {
    expectSpent(mpSpent(["EFF-TEST-MP-INC"]), 1.5);
    expectSpent(mpSpent(["EFF-TEST-MP-INC", "EFF-TEST-MP-MORE"]), 3);
  });
});

// ---------------------------------------------------------------------------
// 修正3：撃破の後のダメージ
// ---------------------------------------------------------------------------

describe("修正3：的を倒した後のダメージ・状態異常を計上しない", () => {
  const TRIPLE: SimSkill = { ...STRIKE, name: "三連撃", hits: 3 };
  /** 1ヒットの打撃値（人形に1回だけ使って求める）。 */
  const perHit = (() => {
    const r = firstUse(build({ rotation: [TRIPLE] }));
    expect(r.skills[0]?.hits).toBe(3);
    return r.hitDamage / 3;
  })();
  const withHp = (maxHp: number): Target => ({ ...dummy(1), maxHp });

  it("1回の技の途中のヒットで倒すと、そのヒットで撃破になり、残りHPまでしか計上しない", () => {
    expect(perHit).toBeGreaterThan(0);
    const maxHp = perHit * 1.5;
    const r = simulate(db, build({ rotation: [TRIPLE] }), withHp(maxHp), { seconds: 10, seed: 7 });
    expect(r.killTime).toBeCloseTo(dt, 12);
    expect(r.seconds).toBe(r.killTime);
    expect(r.totalDamage).toBeCloseTo(maxHp, 9);
    expect(r.hitDamage).toBeCloseTo(maxHp, 9);
    expect(r.skills[0]?.damage).toBeCloseTo(maxHp, 9);
    expect(r.overkillDamage).toBeCloseTo(perHit * 0.5, 9);
    expect(r.dps).toBeCloseTo(maxHp / dt, 6);
  });

  it("倒した後の残りのヒットは計上しない（3ヒットの技で2ヒット目に倒す）", () => {
    const r = simulate(db, build({ rotation: [TRIPLE] }), withHp(perHit * 1.5), {
      seconds: 10,
      seed: 7,
    });
    expect(r.skills[0]?.uses).toBe(1);
    expect(r.skills[0]?.hits).toBe(2);
    expect(r.totalDamage).toBeLessThan(perHit * 2);
  });

  it("倒したヒット・その後のヒットでは、状態異常・崩しを新たに与えない", () => {
    const bleeding: SimSkill = {
      ...TRIPLE,
      ailmentChance: { "TAG-AIL-BLEED": 1 },
      staggerCoefficient: 1000,
    };
    // 人形なら3ヒットとも出血する
    expect(firstUse(build({ rotation: [bleeding] })).ailmentsApplied["TAG-AIL-BLEED"]).toBe(3);
    const r = simulate(db, build({ rotation: [bleeding] }), withHp(perHit * 1.5), {
      seconds: 10,
      seed: 8,
    });
    // 1ヒット目だけ（2ヒット目で倒し、3ヒット目は計算しない）
    expect(r.ailmentsApplied["TAG-AIL-BLEED"]).toBe(1);
    // 倒した時間刻みでは持続ダメージを進めない
    expect(r.dotDamage).toBe(0);
    // 1ヒットで倒す場合は、状態異常も崩しも与えない
    const oneShot = simulate(db, build({ rotation: [bleeding] }), withHp(perHit * 0.5), {
      seconds: 10,
      seed: 8,
    });
    expect(oneShot.ailmentsApplied["TAG-AIL-BLEED"]).toBeUndefined();
    expect(oneShot.staggerBreaks).toBe(0);
    expect(oneShot.totalDamage).toBeCloseTo(perHit * 0.5, 9);
  });

  it("持続ダメージで倒したとき、残りHPを超える分は計上しない", () => {
    // 1回だけ出血を付ける技（その後は CD の間、何もしない）
    const once: SimSkill = { ...STRIKE, ailmentChance: { "TAG-AIL-BLEED": 1 }, cooldown: 1000 };
    const b = build({ rotation: [once] });
    const remaining = 7.0123;
    const maxHp = perHit + remaining;
    const r = simulate(db, b, withHp(maxHp), { seconds: 30, seed: 9 });
    expect(r.killTime).toBeDefined();
    expect(r.killTime).toBeGreaterThan(dt);
    expect(r.hitDamage).toBeCloseTo(perHit, 9);
    expect(r.dotDamage).toBeCloseTo(remaining, 9);
    expect(r.totalDamage).toBeCloseTo(maxHp, 9);
    expect(r.totalDamage).toBeLessThanOrEqual(maxHp);
    expect(r.overkillDamage).toBeGreaterThan(0);
    expect(r.seconds).toBe(r.killTime);
    expect(r.dps).toBeCloseTo(maxHp / (r.killTime ?? 1), 9);
    // 対照：倒れない的なら、同じ時間までにもっと多くの持続ダメージが出ている（＝上で切り捨てた分がある）
    const free = simulate(db, b, dummy(1), { seconds: r.killTime ?? 0, seed: 9 });
    expect(free.dotDamage).toBeGreaterThan(remaining);
    expect(free.dotDamage - remaining).toBeCloseTo(r.overkillDamage, 9);
  });

  it("的が生き残る場合は、従来どおりに計算する（HPのない人形と同じ結果）", () => {
    const b = build({
      rotation: [{ ...TRIPLE, ailmentChance: { "TAG-AIL-BLEED": 0.5 }, staggerCoefficient: 1 }],
    });
    // 崩しゲージの最大値は、HPのない的では 1e9 を使うので、同じ HP の的と比べる
    const big = simulate(db, b, withHp(1e9), { seconds: 30, seed: 10 });
    const free = simulate(db, b, dummy(1), { seconds: 30, seed: 10 });
    expect(big.killTime).toBeUndefined();
    expect(big.overkillDamage).toBe(0);
    expect(big.totalDamage).toBe(free.totalDamage);
    expect(big.hitDamage).toBe(free.hitDamage);
    expect(big.dotDamage).toBe(free.dotDamage);
    expect(big.ailmentsApplied).toEqual(free.ailmentsApplied);
    expect(big.seconds).toBeCloseTo(30, 9);
    expect(big.dps).toBeCloseTo(big.totalDamage / 30, 9);
    expect(big.skills[0]?.damage).toBe(big.hitDamage);
  });
});

// ---------------------------------------------------------------------------
// 修正4：時間の検証
// ---------------------------------------------------------------------------

describe("修正4：シミュレーションの時間（seconds）の検証", () => {
  const b = build({ rotation: [STRIKE] });
  const run = (seconds: number) => simulate(db, b, dummy(1), { seconds, seed: 11 });

  it("0・負の数・NaN・Infinity・-Infinity は拒否する（0や既定値に置き換えない）", () => {
    for (const bad of [0, -0, -1, -0.5, Number.NaN, Infinity, -Infinity]) {
      expect(() => run(bad)).toThrow(RangeError);
      expect(() => validateSeconds(bad)).toThrow(/seconds/);
    }
    expect(() => run(-1)).toThrow(/-1/);
    expect(() => run(Number.NaN)).toThrow(/NaN/);
    expect(() => run(Infinity)).toThrow(/Infinity/);
    // 時間刻みの回数が安全な整数に収まらない値も拒否する
    expect(() => run(Number.MAX_VALUE)).toThrow(RangeError);
  });

  it("正の有限の値は、従来どおり実行できる", () => {
    expect(run(60).seconds).toBeCloseTo(60, 9);
    expect(run(0.5).seconds).toBeCloseTo(0.5, 9);
    expect(run(dt).skills[0]?.uses).toBe(1);
    expect(validateSeconds(12.5)).toBe(12.5);
  });

  it("CLI の --seconds：省略したときだけ60秒。正の数はそのまま読む", () => {
    expect(parseSeconds(undefined)).toBe(DEFAULT_SECONDS);
    expect(DEFAULT_SECONDS).toBe(60);
    expect(parseSeconds("120")).toBe(120);
    expect(parseSeconds("0.5")).toBe(0.5);
    expect(parseSeconds("1e2")).toBe(100);
  });

  it("CLI の --seconds：0・負の数・NaN・Infinity・数でない値は、入力の値を示して拒否する", () => {
    for (const bad of ["0", "-5", "NaN", "Infinity", "-Infinity", "abc", "", " ", "0x10", "10s"]) {
      expect(() => parseSeconds(bad)).toThrow(RangeError);
      expect(() => parseSeconds(bad)).toThrow(`「${bad}」`);
    }
  });

  it("CLI の引数：--seconds の値がなければ拒否する（既定値にしない）", () => {
    expect(argValue(["node", "x", "--seconds", "30"], "seconds")).toBe("30");
    expect(argValue(["node", "x"], "seconds")).toBeUndefined();
    expect(() => argValue(["node", "x", "--seconds"], "seconds")).toThrow(/--seconds/);
    expect(() => argValue(["node", "x", "--seconds", "--seed", "1"], "seconds")).toThrow(
      /--seconds/,
    );
  });
});
