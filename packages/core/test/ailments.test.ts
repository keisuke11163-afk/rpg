import { describe, expect, it } from "vitest";
import {
  AILMENT_DEFS,
  AILMENT_KINDS,
  AilmentSet,
  BreakGauge,
  applyChance,
  ailmentsForElements,
  breakValue,
  countAilmentKinds,
  createRng,
  enemyBreakParams,
  playerBreakParams,
  rollApply,
  type DotContext,
} from "../src/index.ts";

const dot: DotContext = { addPct: 0, mult: 1, enemyDamageTaken: 1, resistance: {} };
const mob = { maxHp: 1000, isBoss: false };
const boss = { maxHp: 1000, isBoss: true };
const sum = (set: AilmentSet, secs: number, ctx = dot): number => {
  let total = 0;
  for (let i = 0; i < secs * 10; i++) total += set.tick(0.1, ctx).reduce((a, t) => a + t.damage, 0);
  return total;
};

describe("T5 状態異常", () => {
  it("定義は8種類すべてが形を持つ", () => {
    expect(AILMENT_KINDS).toHaveLength(8);
    expect(AILMENT_KINDS.every((k) => AILMENT_DEFS[k].durationSeconds > 0)).toBe(true);
  });
  it("出血：基準値×150%を5秒で与える。最大8スタック（千の小傷で12）", () => {
    const s = new AilmentSet(mob);
    s.apply("bleed", { reference: { physical: 100 } });
    expect(sum(s, 5.1)).toBeCloseTo(150, 0);
    const t = new AilmentSet(mob);
    for (let i = 0; i < 20; i++) t.apply("bleed", { reference: { physical: 10 } });
    expect(t.stackCount("bleed")).toBe(8);
    t.setMaxStacks("bleed", 12);
    for (let i = 0; i < 20; i++) t.apply("bleed", { reference: { physical: 10 } });
    expect(t.stackCount("bleed")).toBe(12);
  });
  it("出血は敵が移動中だとダメージ2倍", () => {
    const a = new AilmentSet(mob);
    const b = new AilmentSet(mob);
    a.apply("bleed", { reference: { physical: 100 } });
    b.apply("bleed", { reference: { physical: 100 } });
    expect(sum(b, 6, { ...dot, moving: true })).toBeCloseTo(sum(a, 6) * 2, 3);
  });
  it("毒：物理＋闇の基準値×60%を3秒。無制限に重なる", () => {
    const s = new AilmentSet(mob);
    for (let i = 0; i < 30; i++) s.apply("poison", { reference: { physical: 50, dark: 50 } });
    expect(s.stackCount("poison")).toBe(30);
    expect(sum(s, 3.1)).toBeCloseTo(30 * 60, 0);
  });
  it("燃焼：重ね掛けされず、最も強い1つが残る", () => {
    const s = new AilmentSet(mob);
    s.apply("burn", { reference: { fire: 100 } });
    s.apply("burn", { reference: { fire: 40 } });
    expect(s.stackCount("burn")).toBe(1);
    expect(sum(s, 4.1)).toBeCloseTo(50, 0);
  });
  it("持続ダメージ：状態異常の加算％・乗算・敵が受ける倍率・耐性が1回ずつ", () => {
    const s = new AilmentSet(mob);
    s.apply("poison", { reference: { dark: 100 } });
    const ctx: DotContext = {
      addPct: 0.5,
      mult: 2,
      enemyDamageTaken: 1.25,
      resistance: { dark: 0.2 },
    };
    expect(sum(s, 3.1, ctx)).toBeCloseTo(60 * 1.5 * 2 * 1.25 * 0.8, 3);
  });
  it("感電：倍率 ＝ 1＋min(0.25, 2.5×雷÷最大HP)。ボスは0.15。強いほうで上書き", () => {
    const s = new AilmentSet(mob);
    s.apply("shock", { reference: { lightning: 40 } });
    expect(s.enemyDamageTakenMultiplier).toBeCloseTo(1.1);
    s.apply("shock", { reference: { lightning: 20 } });
    expect(s.enemyDamageTakenMultiplier).toBeCloseTo(1.1);
    s.apply("shock", { reference: { lightning: 9999 } });
    expect(s.enemyDamageTakenMultiplier).toBeCloseTo(1.25);
    const b = new AilmentSet(boss);
    b.apply("shock", { reference: { lightning: 9999 } });
    expect(b.enemyDamageTakenMultiplier).toBeCloseTo(1.15);
    sum(s, 4.2);
    expect(s.enemyDamageTakenMultiplier).toBe(1);
  });
  it("冷却：行動速度の低下は最大30%（ボス15%）。ゲージ100で凍結", () => {
    const s = new AilmentSet(mob);
    s.apply("chill", { reference: { cold: 9999 } });
    expect(s.slow).toBeCloseTo(0.3);
    expect(s.frozen).toBe(true);
    sum(s, 1.3);
    expect(s.frozen).toBe(false);
    const b = new AilmentSet(boss);
    b.apply("chill", { reference: { cold: 9999 } });
    expect(b.slow).toBeCloseTo(0.15);
  });
  it("ボスの凍結は0.4秒、その後8秒は凍結しない", () => {
    const b = new AilmentSet(boss);
    b.apply("chill", { reference: { cold: 9999 } });
    expect(b.frozen).toBe(true);
    sum(b, 0.5);
    expect(b.frozen).toBe(false);
    b.apply("chill", { reference: { cold: 9999 } });
    expect(b.frozen).toBe(false);
    sum(b, 8);
    b.apply("chill", { reference: { cold: 9999 } });
    expect(b.frozen).toBe(true);
  });
  it("衰弱：与えるダメージ-15%（ボス-8%）", () => {
    const s = new AilmentSet(mob);
    s.apply("weaken", { reference: {} });
    expect(s.damageDealtMultiplier).toBeCloseTo(0.85);
    const b = new AilmentSet(boss);
    b.apply("weaken", { reference: {} });
    expect(b.damageDealtMultiplier).toBeCloseTo(0.92);
  });
  it("聖痕：5スタックで破裂（聖の基準値合計×150%、不死・魔人は×1.5）", () => {
    const s = new AilmentSet(mob);
    let burst = 0;
    for (let i = 0; i < 5; i++) burst = s.apply("stigma", { reference: { holy: 10 } });
    expect(burst).toBeCloseTo(75);
    const u = new AilmentSet({ ...mob, isUndeadOrDemon: true });
    for (let i = 0; i < 5; i++) burst = u.apply("stigma", { reference: { holy: 10 } });
    expect(burst).toBeCloseTo(112.5);
  });
  it("種類の数え方：冷却と凍結は1種類、崩しは数えない", () => {
    expect(countAilmentKinds(["chill", "freeze", "bleed", "poison"])).toBe(3);
  });
  it("付与率：基本＋補正で上限100%。必ず付与は100%。属性ごとに起こせる種類", () => {
    expect(applyChance(0.3, 0.9)).toBe(1);
    expect(applyChance(0, 0, true)).toBe(1);
    expect(ailmentsForElements(["physical"])).toEqual(["bleed", "poison"]);
    expect(ailmentsForElements(["dark", "fire"])).toEqual(["burn", "poison", "weaken"]);
    const rng = createRng("a");
    let n = 0;
    for (let i = 0; i < 10000; i++) if (rollApply(rng, 0.3)) n++;
    expect(n / 10000).toBeGreaterThan(0.27);
    expect(n / 10000).toBeLessThan(0.33);
  });
});

describe("崩し", () => {
  it("敵：最大＝最大HP×0.2。満タンでダウン2秒・受けるダメージ×1.25", () => {
    const g = new BreakGauge(enemyBreakParams(1000, false));
    expect(g.currentMax).toBe(200);
    expect(g.add(breakValue(100))).toBe(false);
    expect(g.add(breakValue(600))).toBe(true);
    expect(g.broken).toBe(true);
    expect(g.damageTakenMultiplier).toBe(1.25);
    g.tick(2.1);
    expect(g.broken).toBe(false);
    expect(g.damageTakenMultiplier).toBe(1);
  });
  it("ボス：最大0.15・怯み1秒・×1.15・崩れるたびに最大が1.5倍", () => {
    const g = new BreakGauge(enemyBreakParams(1000, true));
    expect(g.currentMax).toBe(150);
    g.add(1000);
    expect(g.damageTakenMultiplier).toBe(1.15);
    expect(g.currentMax).toBe(225);
    g.tick(1.1);
    g.add(1000);
    expect(g.currentMax).toBe(337.5);
  });
  it("崩しを受けない状態が3秒続くと毎秒10%ずつ減る", () => {
    const g = new BreakGauge(enemyBreakParams(1000, false));
    g.add(100);
    g.tick(3);
    expect(g.gauge).toBe(100);
    g.tick(1);
    expect(g.gauge).toBeCloseTo(80);
  });
  it("プレイヤー：最大＝最大HP×0.5、よろめき0.6秒、崩されない効果で溜まらない", () => {
    const g = new BreakGauge(playerBreakParams(400));
    expect(g.currentMax).toBe(200);
    g.immune = true;
    expect(g.add(999)).toBe(false);
    g.immune = false;
    expect(g.add(200)).toBe(true);
    g.tick(0.7);
    expect(g.broken).toBe(false);
  });
});
