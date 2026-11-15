import { describe, expect, it } from "vitest";
import {
  APTITUDE_SPEED,
  FURY,
  Fighter,
  JobGauge,
  WARRIOR_SKILLS,
  WEAPONS,
  createCombatant,
  createRng,
  tickCombatant,
  type WeaponClass,
  type Aptitude,
} from "../src/index.ts";

const weapon = (k: string) => {
  const w = WEAPONS[k];
  if (!w) throw new Error(k);
  return w;
};
const warrior = (
  wc: WeaponClass,
  wk: string,
  over: { aptitude?: Aptitude; jobLevel?: number; dualWield?: boolean } = {},
) =>
  new Fighter({
    maxHp: 100,
    maxMp: 100,
    weapon: weapon(wk),
    weaponClass: wc,
    aptitude: over.aptitude ?? "S",
    jobLevel: over.jobLevel ?? 12,
    skills: WARRIOR_SKILLS,
    gauge: FURY,
    ...(over.dualWield ? { dualWield: true } : {}),
  });
const foe = (x = 1.5, y = 0) =>
  createCombatant({ id: `E${String(x)}${String(y)}`, pos: { x, y }, maxHp: 1e6, facing: Math.PI });
const O = { x: 0, y: 0 };

describe("T7 職能ゲージ「闘志」", () => {
  it("ヒットで+2、重撃で+6。戦闘外で毎秒-5。50で激化、100で解放", () => {
    const g = new JobGauge(FURY);
    g.onHit(false);
    expect(g.value).toBe(2);
    g.onHit(true);
    expect(g.value).toBe(8);
    g.add(42);
    expect(g.intensified).toBe(true);
    expect(g.canRelease).toBe(false);
    g.add(100);
    expect(g.value).toBe(100);
    expect(g.canRelease).toBe(true);
    g.tick(5);
    expect(g.value).toBe(100); // 戦闘中（5秒以内）は減らない
    g.tick(1);
    g.tick(1);
    expect(g.value).toBeCloseTo(90);
  });
  it("攻撃を受けると、最大HPの1%につき+1", () => {
    const g = new JobGauge(FURY);
    g.onDamaged(10, 100);
    expect(g.value).toBeCloseTo(10);
  });
  it("解放技で0になる。職奥義「不屈の闘志」では30より下がらず、解放後も30から", () => {
    const g = new JobGauge(FURY);
    g.add(100);
    g.consume();
    expect(g.value).toBe(0);
    const h = new JobGauge(FURY);
    h.mods = { floor: 30, keepAfterRelease: 30 };
    h.add(100);
    h.consume();
    expect(h.value).toBe(30);
    h.tick(60);
    expect(h.value).toBe(30);
  });
  it("職紋盤のノード：闘志の炉（自然減少-50%）、血を燃やす（被弾の獲得×2）", () => {
    const g = new JobGauge(FURY);
    g.mods = { decayMultiplier: 0.5, damagedGainMultiplier: 2 };
    g.add(50);
    g.tick(5);
    g.tick(2);
    expect(g.value).toBeCloseTo(45);
    g.onDamaged(5, 100);
    expect(g.value).toBeCloseTo(55);
  });
  it("鬼神化：常に激化。解放技は使えない", () => {
    const g = new JobGauge(FURY);
    g.forceIntensified = true;
    g.releaseDisabled = true;
    g.add(100);
    expect(g.intensified).toBe(true);
    expect(g.canRelease).toBe(false);
  });
});

describe("T6 適性・技を覚える時期", () => {
  it("適性Sで攻撃速度+10%、Cで-10%", () => {
    expect(APTITUDE_SPEED).toEqual({ S: 0.1, A: 0, B: -0.05, C: -0.1 });
    expect(warrior("greatsword", "greatsword", { aptitude: "S" }).attackSpeed).toBeCloseTo(
      1.05 * 1.1,
    );
    expect(warrior("greatsword", "greatsword", { aptitude: "C" }).attackSpeed).toBeCloseTo(
      1.05 * 0.9,
    );
  });
  it("技はジョブLvで覚える（補助仕様書 3.5）", () => {
    expect(
      warrior("greatsword", "greatsword", { jobLevel: 1 })
        .knownSkills()
        .map((s) => s.name),
    ).toEqual(["薙ぎ払い"]);
    expect(
      warrior("greatsword", "greatsword", { jobLevel: 7 })
        .knownSkills()
        .map((s) => s.name),
    ).toEqual(["薙ぎ払い", "地割り", "戦吼", "突進"]);
    expect(warrior("greatsword", "greatsword").knownSkills()).toHaveLength(6);
    expect(warrior("greatsword", "greatsword", { jobLevel: 1 }).canUse("SKL-WAR-RIFT").reason).toBe(
      "notLearned",
    );
  });
});

describe("技の実行（コスト・クールダウン）", () => {
  it("MP・クールダウンを消費し、足りないと使えない", () => {
    const w = warrior("greatsword", "greatsword");
    const rng = createRng(1);
    expect(w.use("SKL-WAR-RIFT", O, 0, [foe(3)], rng).ok).toBe(true);
    expect(w.mp).toBe(90);
    expect(w.use("SKL-WAR-RIFT", O, 0, [foe(3)], rng).reason).toBe("cooldown");
    w.tick(4.1);
    expect(w.canUse("SKL-WAR-RIFT").ok).toBe(true);
    w.mp = 3;
    expect(w.canUse("SKL-WAR-SWEEP").reason).toBe("mp");
  });
  it("薙ぎ払い：前方120°に武器ダメージ130%", () => {
    const w = warrior("greatsword", "greatsword");
    const out = w.use("SKL-WAR-SWEEP", O, 0, [foe(1.5), foe(-1.5), foe(0, 1.5)], createRng(1));
    expect(out.hits).toHaveLength(1);
    expect(out.effective?.multiplier).toBe(1.3);
  });
  it("薙ぎ払い：大剣は範囲+20%、激化で180°・崩し値+30%", () => {
    const w = warrior("greatsword", "greatsword");
    const e = w.effective(WARRIOR_SKILLS[0] as never);
    expect(e.shape).toEqual({ kind: "cone", range: 2.2 * 1.2, arcDegrees: 120 });
    w.gauge.add(50);
    const i = w.effective(WARRIOR_SKILLS[0] as never);
    expect(i.shape).toEqual({ kind: "cone", range: 2.2 * 1.2, arcDegrees: 180 });
    expect(i.breakBonus).toBeCloseTo(0.3);
    expect(i.intensified).toBe(true);
  });
  it("薙ぎ払い：斧は出血の付与率+30%、槌は衝撃波。大剣と斧で変化が違う", () => {
    const axe = warrior("axe", "greataxe").effective(WARRIOR_SKILLS[0] as never);
    const sword = warrior("greatsword", "greatsword").effective(WARRIOR_SKILLS[0] as never);
    expect(axe.ailments["bleed"]).toBeCloseTo(0.3);
    expect(sword.ailments["bleed"]).toBeUndefined();
    expect(warrior("hammer", "greathammer").effective(WARRIOR_SKILLS[0] as never).hooks).toContain(
      "shockwave",
    );
    expect(axe.shape).not.toEqual(sword.shape);
  });
  it("斧の薙ぎ払いは出血を付与する（付与率30%）", () => {
    const w = warrior("axe", "greataxe");
    let bleeds = 0;
    for (let i = 0; i < 200; i++) {
      const e = foe(1.5);
      w.mp = 100;
      const r = w.use("SKL-WAR-SWEEP", O, 0, [e], createRng(i));
      if (r.hits[0]?.result.appliedAilments.includes("bleed")) bleeds++;
    }
    expect(bleeds / 200).toBeGreaterThan(0.2);
    expect(bleeds / 200).toBeLessThan(0.4);
  });
  it("地割り：直線6mに220%、重撃なのでヒットで闘志+6、大槌は十字、激化で亀裂", () => {
    const w = warrior("greathammer", "greathammer");
    const out = w.use("SKL-WAR-RIFT", O, 0, [foe(5), foe(7)], createRng(1));
    expect(out.hits).toHaveLength(1);
    expect(w.gauge.value).toBe(6);
    expect(out.effective?.hooks).toContain("cross");
    w.gauge.add(50);
    expect(w.effective(WARRIOR_SKILLS[1] as never).hooks).toContain("lingering:2");
  });
  it("戦吼：8秒間の攻撃+15%、敵は崩されやすく、闘志+20。範囲は激化で×1.5", () => {
    const w = warrior("greatsword", "greatsword");
    const e = foe(4);
    w.use("SKL-WAR-SHOUT", O, 0, [e], createRng(1));
    expect(w.gauge.value).toBe(20);
    expect(w.buffs.attackBonus.value).toBe(0.15);
    expect(e.breakTaken.bonus).toBe(0.2);
    w.tick(9);
    expect(w.buffs.attackBonus.left).toBe(0);
    w.gauge.add(50);
    expect(w.effective(WARRIOR_SKILLS[2] as never).shape).toEqual({ kind: "circle", radius: 9 });
  });
  it("突進：8m進んで150%。激化では通った敵を全て崩す。槍は+4m", () => {
    const w = warrior("greatsword", "greatsword");
    const e = foe(6);
    const out = w.use("SKL-WAR-CHARGE", O, 0, [e], createRng(1));
    expect(out.movedTo?.x).toBeCloseTo(8);
    expect(out.hits).toHaveLength(1);
    expect(e.breakGauge.broken).toBe(false);
    w.tick(5);
    w.gauge.add(50);
    const e2 = foe(6);
    w.use("SKL-WAR-CHARGE", O, 0, [e2], createRng(1));
    expect(e2.breakGauge.broken).toBe(true);
    expect(
      warrior("spear", "greatsword").use("SKL-WAR-CHARGE", O, 0, [], createRng(1)).movedTo?.x,
    ).toBeCloseTo(12);
  });
  it("旋風：毎秒4回・90%。二刀流は毎秒6回・70%", () => {
    const w = warrior("greatsword", "greatsword");
    const a = w.effective(WARRIOR_SKILLS[4] as never);
    expect(a.hits).toBe(4);
    expect(a.multiplier).toBe(0.9);
    const d = warrior("axe", "dagger", { dualWield: true, aptitude: "B" }).effective(
      WARRIOR_SKILLS[4] as never,
    );
    expect(d.hits).toBe(6);
    expect(d.multiplier).toBe(0.7);
    expect(w.effective(WARRIOR_SKILLS[4] as never).hooks).not.toContain("pull");
    w.gauge.add(50);
    expect(w.effective(WARRIOR_SKILLS[4] as never).hooks).toContain("pull");
  });
  it("破軍：闘志100でだけ使え、800%の斬撃。闘志を使い切り、8秒間の被ダメージ-20%", () => {
    const w = warrior("greatsword", "greatsword");
    expect(w.canUse("SKL-WAR-RUIN").reason).toBe("gauge");
    w.gauge.add(100);
    const out = w.use("SKL-WAR-RUIN", O, 0, [foe(3)], createRng(1));
    expect(out.ok).toBe(true);
    expect(out.effective?.multiplier).toBe(8);
    // 解放技のヒットでも闘志は増えるが、使った直後は0から（重撃+6）
    expect(w.gauge.value).toBe(6);
    expect(w.takeDamage(10)).toBeCloseTo(8);
    w.tick(9);
    expect(w.takeDamage(10)).toBe(10);
  });
  it("闘志50で激化・100で解放（通常のヒットの積み重ね）", () => {
    const w = warrior("greatsword", "greatsword");
    const e = foe(1.5);
    const rng = createRng(3);
    while (w.gauge.value < 50) {
      w.mp = 100;
      w.use("SKL-WAR-SWEEP", O, 0, [e], rng);
    }
    expect(w.gauge.intensified).toBe(true);
  });
  it("敵の持続ダメージ・崩し・状態の時間を進められる", () => {
    const e = foe();
    e.ailments.apply("burn", { reference: { fire: 100 } });
    expect(tickCombatant(e, 1)).toBeGreaterThan(0);
  });
});

describe("MPの回復", () => {
  it("毎秒、最大MPの6%", () => {
    const w = warrior("greatsword", "greatsword");
    w.mp = 0;
    w.tick(1);
    expect(w.mp).toBeCloseTo(6);
  });
});
