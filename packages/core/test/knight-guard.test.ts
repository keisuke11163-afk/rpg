/**
 * 騎士のガード・パリィ・信念（仕様書v0.2 5.3、H-05 ②）の規則。
 * 数値は試験用の規則で渡す（ジョブのデータには依存しない）。
 */
import { describe, expect, it } from "vitest";
import {
  type GaugeDef,
  type GuardRule,
  type IncomingAttack,
  GuardState,
  JobGauge,
  Rng,
  TagIndex,
  computeHit,
  evaluateEffects,
  gaugeSchema,
  isInFront,
} from "../src/index.ts";
import { buildDb, combatFixture } from "./helpers/content.ts";

const RULE: GuardRule = {
  parryWindow: 0.18,
  frontAngleDeg: 180,
  staminaCost: 15,
  parryStaggerRatio: 0.35,
  counterBonus: 1,
  counterSeconds: 4,
  moveSpeedMultiplier: 0.6,
  minRaise: 0.3,
  parryCooldown: 0.6,
};

/** 敵が正面（+x）にいる攻撃。 */
function attack(now: number, extra: Partial<IncomingAttack> = {}): IncomingAttack {
  return {
    now,
    from: { x: 2, y: 0 },
    position: { x: 0, y: 0 },
    facing: 0,
    guardRate: 0.6,
    canPay: true,
    parryWindowBonus: 0,
    ...extra,
  };
}

/** now の刻みでガードを押し始める。 */
function raisedAt(now: number): GuardState {
  const g = new GuardState(RULE);
  g.input(now, true, true, true);
  return g;
}

describe("ガードの結果（防ぐ・パリィ・防げない）", () => {
  it("ガードを上げていなければ、そのまま受ける", () => {
    expect(new GuardState(RULE).judge(attack(1))).toEqual({ kind: "none" });
  });

  it("上げてから受付の秒数より後に当たると、ガード率で防ぐ", () => {
    expect(raisedAt(0).judge(attack(0.5))).toEqual({ kind: "guard", rate: 0.6 });
  });

  it("パリィの受付の境界：0.18秒ちょうどはパリィ、それを超えるとガード", () => {
    expect(raisedAt(1).judge(attack(1.18))).toEqual({ kind: "parry" });
    expect(raisedAt(1).judge(attack(1.181))).toEqual({ kind: "guard", rate: 0.6 });
    expect(raisedAt(1).judge(attack(1))).toEqual({ kind: "parry" });
  });

  it("職詞の加算（+0.05秒）で、受付が 0.23秒まで広がる", () => {
    const bonus = { parryWindowBonus: 0.05 };
    expect(raisedAt(0).judge(attack(0.23, bonus))).toEqual({ kind: "parry" });
    expect(raisedAt(0).judge(attack(0.24, bonus))).toEqual({ kind: "guard", rate: 0.6 });
    expect(raisedAt(0).judge(attack(0.23))).toEqual({ kind: "guard", rate: 0.6 });
  });

  it("押し続けたままのガード（上げ直していない）にはパリィが付かない", () => {
    const g = new GuardState(RULE);
    g.input(0, true, false, false); // 押したままだが、ガードできない間
    g.input(0.1, true, false, true); // できるようになった
    expect(g.raised).toBe(true);
    expect(g.judge(attack(0.12))).toEqual({ kind: "guard", rate: 0.6 });
  });

  it("気力が足りなければ防げない。パリィは気力を使わないので成功する", () => {
    expect(raisedAt(0).judge(attack(0.5, { canPay: false }))).toEqual({ kind: "none" });
    expect(raisedAt(0).judge(attack(0.1, { canPay: false }))).toEqual({ kind: "parry" });
  });

  it("盾が無い（ガード率0）と防げない。ガード率は1が上限", () => {
    expect(raisedAt(0).judge(attack(0.5, { guardRate: 0 }))).toEqual({ kind: "none" });
    expect(raisedAt(0).judge(attack(0.5, { guardRate: 3 }))).toEqual({ kind: "guard", rate: 1 });
  });

  it("後ろからの攻撃は防げない", () => {
    expect(raisedAt(0).judge(attack(0.1, { from: { x: -2, y: 0 } }))).toEqual({ kind: "none" });
    expect(isInFront({ x: 0, y: 2 }, { x: 0, y: 0 }, 0, 180)).toBe(true);
    expect(isInFront({ x: -1, y: 0.01 }, { x: 0, y: 0 }, 0, 180)).toBe(false);
  });

  it("短く押して離しても、最短の秒数まではガードが続き、その後に下りる", () => {
    const g = new GuardState(RULE);
    g.input(0, false, true, true);
    g.input(0.1, false, false, true);
    expect(g.raised).toBe(true);
    g.input(0.31, false, false, true);
    expect(g.raised).toBe(false);
  });

  it("反撃権：パリィで得て、4秒以内の次の攻撃で1度だけ+100%", () => {
    const g = raisedAt(0);
    expect(g.consumeCounter(0)).toBe(0);
    g.grantCounter(1);
    expect(g.hasCounter(4.9)).toBe(true);
    expect(g.consumeCounter(2)).toBe(1);
    expect(g.consumeCounter(2.1)).toBe(0);
    g.grantCounter(10);
    expect(g.consumeCounter(14.1)).toBe(0);
  });
});

describe("パリィの連打の対策（D-KNT-10）", () => {
  /** 0.13秒ごとに押して離す（気力なし）。毎回、敵の攻撃がその直後に当たる。 */
  it("連打しても、パリィは続かない（受付の間隔の間は、ガードの扱い）", () => {
    const g = new GuardState(RULE);
    const kinds: string[] = [];
    for (let i = 0; i < 17; i++) {
      const t = i * 0.13;
      g.input(t, false, true, true); // 押した刻み
      kinds.push(g.judge(attack(t + 0.05, { canPay: false })).kind);
      g.input(t + 0.06, false, false, true); // 離す（最短0.3秒は上がったまま）
    }
    expect(kinds.filter((k) => k === "parry").length).toBeLessThanOrEqual(4);
    expect(kinds[0]).toBe("parry");
    expect(kinds.slice(1, 5)).not.toContain("parry");
  });

  it("普通の1回のパリィは従来どおり成立する。間隔（0.6秒）をあければ、また成立する", () => {
    const g = new GuardState(RULE);
    g.input(1, true, true, true);
    expect(g.judge(attack(1.1)).kind).toBe("parry");
    g.input(1.6, false, false, true);
    g.input(2, true, true, true);
    expect(g.judge(attack(2.1)).kind).toBe("parry");
  });

  it("パリィに成功した受付は閉じる：同じ受付の2発目はガード扱い", () => {
    const g = raisedAt(0);
    expect(g.judge(attack(0.05)).kind).toBe("parry");
    expect(g.judge(attack(0.1))).toEqual({ kind: "guard", rate: 0.6 });
  });
});

describe("ガードの軽減（ダメージの式）", () => {
  const db = buildDb(combatFixture());
  const { view } = evaluateEffects(db, new TagIndex(db.tags), [], { baseStats: {} });

  it("ガード率の分だけ打撃値が減る。ガードしていなければ減らない", () => {
    const attacker = {
      db,
      view,
      characterLevel: 1,
      weapon: {
        uid: "w",
        tags: ["TAG-WPN-SWORD"],
        base: { physical: { min: 10, max: 10 } },
        critChance: 0.05,
      },
    };
    const skill = { tags: ["TAG-FORM-MELEE"], kind: "weapon" as const, pct: 1 };
    const avg = { rng: Rng.fromSeed(1), roll: "average" as const };
    const open = computeHit(attacker, skill, {}, avg).total;
    const guarded = computeHit(attacker, skill, { guard: 0.6 }, avg).total;
    expect(open).toBeGreaterThan(0);
    expect(guarded).toBeCloseTo(open * 0.4);
    expect(computeHit(attacker, skill, { guard: 0 }, avg).total).toBeCloseTo(open);
  });
});

/** 信念（データと同じ形の、試験用の定義）。 */
const FAITH: GaugeDef = gaugeSchema.parse({
  id: "GAU-TEST-FAITH",
  text: "gauge.faith",
  max: 10,
  gains: [
    { on: "guardSuccess", value: 1 },
    { on: "parrySuccess", value: 3 },
    { on: "hitTaken", value: -1 },
  ],
  decayOutOfCombat: 0,
  stages: [],
});

describe("信念（騎士の職能ゲージ）", () => {
  it("ガード成功で+1・パリィ成功で+3・防げずに受けると-1", () => {
    const g = new JobGauge(FAITH);
    expect(g.onGuard(false)).toBe(1);
    expect(g.onGuard(true)).toBe(3);
    expect(g.value).toBe(4);
    g.onHitTaken();
    expect(g.value).toBe(3);
  });

  it("0より下・最大値（10）より上にはならない", () => {
    const g = new JobGauge(FAITH);
    g.onHitTaken();
    expect(g.value).toBe(0);
    for (let i = 0; i < 5; i++) g.onGuard(true);
    expect(g.value).toBe(10);
  });

  it("戦闘が終わっても減らない（D-KNT-3）", () => {
    const g = new JobGauge(FAITH);
    g.onGuard(true);
    g.update(30);
    expect(g.value).toBe(3);
  });

  it("信念を持たないゲージ（サブジョブの職能ゲージ）では、ガードしても増えない＝信念は0として扱う", () => {
    const other = gaugeSchema.parse({
      id: "GAU-TEST-OTHER",
      text: "gauge.focus",
      max: 100,
      gains: [{ on: "hitSameTarget", value: 5 }],
      decayOutOfCombat: 0,
      stages: [],
    });
    const g = new JobGauge(other);
    expect(g.onGuard(false)).toBe(0);
    expect(g.onGuard(true)).toBe(0);
    expect(g.value).toBe(0);
  });
});
