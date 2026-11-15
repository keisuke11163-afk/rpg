import { describe, expect, it } from "vitest";
import {
  CATCH_UP_GAP,
  GroundEffects,
  JobRegistry,
  Progression,
  ROGUE_JOB,
  WARRIOR_JOB,
  addExp,
  createCombatant,
  createFighter,
  createRng,
  createStandardJobs,
  enemyExp,
  expToNext,
  levelDifferenceFactor,
  tickCombatant,
  type Combatant,
  type Fighter,
  type GaugeDef,
  type JobDef,
  type WeaponClass,
} from "../src/index.ts";

const rogue = (weaponKey: string, weaponClass: WeaponClass, jobLevel = 12, dual = false): Fighter =>
  createFighter(ROGUE_JOB, {
    maxHp: 100,
    maxMp: 200,
    weaponKey,
    weaponClass,
    jobLevel,
    ...(dual ? { dualWield: true } : {}),
  });
const foe = (x: number, y = 0, facing = Math.PI): Combatant =>
  createCombatant({ id: `E${String(x)}${String(y)}`, pos: { x, y }, maxHp: 1e7, facing });
const O = { x: 0, y: 0 };

describe("盗賊の職能ゲージ「コンボ点」と連刃（T6・T7）", () => {
  it("連刃：短剣3連撃・爪4連撃で出血・片手剣2連撃の範囲攻撃。コンボ+1", () => {
    const d = rogue("dagger", "dagger");
    expect(d.effective(d.init.skills[0] as never).hits).toBe(3);
    const c = rogue("claw", "claw");
    const ce = c.effective(c.init.skills[0] as never);
    expect(ce.hits).toBe(4);
    expect(ce.ailments["bleed"]).toBeCloseTo(0.25);
    const s = rogue("longsword", "longsword");
    const se = s.effective(s.init.skills[0] as never);
    expect(se.hits).toBe(2);
    expect(se.shape).toEqual({ kind: "cone", range: 2, arcDegrees: 120 });
    const out = d.use("SKL-ROG-FLURRY", O, 0, [foe(1.2)], createRng(1));
    expect(out.hits).toHaveLength(3);
    expect(d.gauge.value).toBe(1);
  });
  it("コンボ点は5まで。当たらなければ増えない。自然には減らない", () => {
    const d = rogue("dagger", "dagger");
    const e = foe(1.2);
    for (let i = 0; i < 10; i++) {
      d.mp = 200;
      d.use("SKL-ROG-FLURRY", O, 0, [e], createRng(i));
    }
    expect(d.gauge.value).toBe(5);
    d.gauge.tick(60);
    expect(d.gauge.value).toBe(5);
    const miss = rogue("dagger", "dagger");
    miss.use("SKL-ROG-FLURRY", O, 0, [foe(9)], createRng(1));
    expect(miss.gauge.value).toBe(0);
  });
  it("急所穿ち：武器ダメージ100%＋コンボ点1につき+80%。5点なら必ず会心。使うと0", () => {
    const d = rogue("dagger", "dagger");
    d.gauge.add(3);
    const out = d.use("SKL-ROG-FINISH", O, 0, [foe(1.2)], createRng(1));
    expect(out.effective?.multiplier).toBeCloseTo(1 + 0.8 * 3);
    expect(d.gauge.value).toBe(0);
    const full = rogue("dagger", "dagger");
    full.gauge.add(5);
    let crits = 0;
    for (let i = 0; i < 20; i++) {
      full.gauge.add(5);
      full.mp = 200;
      const r = full.use("SKL-ROG-FINISH", O, 0, [foe(1.2)], createRng(i));
      if (r.hits[0]?.result.crit) crits++;
    }
    expect(crits).toBe(20);
    expect(rogue("dagger", "dagger").canUse("SKL-ROG-FINISH").reason).toBe("gauge");
  });
  it("背面判定：会心率+10%・付与率+25%（背後からだけ）", () => {
    const d = rogue("dagger", "dagger");
    // 敵が右を向いている（0）→ 左側の攻撃者（x<敵）が背面… 攻撃者は原点、敵はx=1.2
    const backFoe = foe(1.2, 0, 0);
    const frontFoe = foe(1.2, 0, Math.PI);
    const spec = d.hitSpec(d.effective(d.init.skills[0] as never), createRng(1));
    expect(spec.backCritAdd).toBeCloseTo(0.1);
    expect(spec.backAilmentBonus).toBeCloseTo(0.25);
    const back = d.use("SKL-ROG-FLURRY", O, 0, [backFoe], createRng(1));
    const front = rogue("dagger", "dagger").use("SKL-ROG-FLURRY", O, 0, [frontFoe], createRng(1));
    expect(back.hits[0]?.result.back).toBe(true);
    expect(front.hits[0]?.result.back).toBe(false);
  });
  it("戦士には背面の補正がない（職能の違い）", () => {
    const w = createFighter(WARRIOR_JOB, {
      maxHp: 1,
      maxMp: 1,
      weaponKey: "greatsword",
      weaponClass: "greatsword",
      jobLevel: 1,
    });
    expect(
      w.hitSpec(w.effective(w.init.skills[0] as never), createRng(1)).backCritAdd,
    ).toBeUndefined();
  });
});

describe("盗賊の技", () => {
  it("影走り：照準の近く8m以内の敵の背後へ。対象がいなければ使えず、コストも払わない", () => {
    const d = rogue("dagger", "dagger");
    const e = foe(5, 0, 0); // 右を向く敵 → 背後は左側
    const out = d.use("SKL-ROG-SHADOWSTEP", O, 0, [e], createRng(1), { aim: { x: 5, y: 0 } });
    expect(out.ok).toBe(true);
    expect(out.movedTo?.x).toBeLessThan(5);
    expect(d.mp).toBe(192);
    const d2 = rogue("dagger", "dagger");
    const r = d2.use("SKL-ROG-SHADOWSTEP", O, 0, [foe(30)], createRng(1), { aim: { x: 0, y: 0 } });
    expect(r.reason).toBe("noTarget");
    expect(d2.mp).toBe(200);
  });
  it("毒塗り：12秒間、毒の付与率+40%", () => {
    const d = rogue("dagger", "dagger");
    d.use("SKL-ROG-POISONCOAT", O, 0, [], createRng(1));
    const spec = d.hitSpec(d.effective(d.init.skills[0] as never), createRng(1));
    expect(spec.ailmentBase?.poison).toBeCloseTo(0.4);
    d.tick(13);
    expect(
      d.hitSpec(d.effective(d.init.skills[0] as never), createRng(1)).ailmentBase?.poison,
    ).toBeUndefined();
    let poisoned = 0;
    for (let i = 0; i < 300; i++) {
      const c = rogue("dagger", "dagger");
      c.use("SKL-ROG-POISONCOAT", O, 0, [], createRng(1));
      const e = foe(1.2);
      c.use("SKL-ROG-FLURRY", O, 0, [e], createRng(i));
      if (e.ailments.stackCount("poison") > 0) poisoned++;
    }
    expect(poisoned).toBeGreaterThan(100);
  });
  it("煙玉：4秒続き、中の敵に毎秒衰弱を必ず付与・命中-30%", () => {
    const d = rogue("dagger", "dagger");
    const ground = new GroundEffects();
    const e = foe(4);
    d.use("SKL-ROG-SMOKE", O, 0, [e], createRng(1), { aim: { x: 4, y: 0 }, ground });
    expect(ground.smokes).toHaveLength(1);
    const rng = createRng(1);
    for (let i = 0; i < 70; i++) ground.step(1 / 60, [e], rng);
    expect(e.ailments.damageDealtMultiplier).toBeCloseTo(0.85);
    expect(e.accuracyPenalty.value).toBeCloseTo(0.3);
    for (let i = 0; i < 60 * 4; i++) ground.step(1 / 60, [e], rng);
    expect(ground.smokes).toHaveLength(0);
  });
  it("罠設置：最大3つ・10秒で消える・踏まれると120%で出血を必ず付与", () => {
    const d = rogue("dagger", "dagger");
    const ground = new GroundEffects();
    for (let i = 0; i < 5; i++) {
      d.mp = 200;
      d.use("SKL-ROG-TRAP", O, 0, [], createRng(1), { aim: { x: 1 + i, y: 0 }, ground });
    }
    expect(ground.traps).toHaveLength(3);
    const e = foe(4);
    const events = ground.step(0.1, [e], createRng(1));
    const trap = events.find((x) => x.type === "trap");
    expect(trap).toBeDefined();
    expect(e.ailments.stackCount("bleed")).toBe(events.filter((x) => x.type === "trap").length);
    const lone = new GroundEffects();
    d.mp = 200;
    d.use("SKL-ROG-TRAP", O, 0, [], createRng(1), { aim: { x: 5, y: 0 }, ground: lone });
    lone.step(10.5, [], createRng(1));
    expect(lone.traps).toHaveLength(0);
    expect(tickCombatant(e, 1)).toBeGreaterThan(0);
  });
  it("技はジョブLvで覚える（連刃1・影走り3・急所穿ち5・毒塗り7・煙玉10・罠12）", () => {
    expect(
      rogue("dagger", "dagger", 1)
        .knownSkills()
        .map((s) => s.name),
    ).toEqual(["連刃"]);
    expect(rogue("dagger", "dagger", 10).knownSkills()).toHaveLength(5);
    expect(rogue("dagger", "dagger", 12).knownSkills()).toHaveLength(6);
  });
  it("適性：短剣S・爪S・長剣B・二刀流A", () => {
    expect(rogue("dagger", "dagger").attackSpeed).toBeCloseTo(1.6 * 1.1);
    expect(rogue("longsword", "longsword").attackSpeed).toBeCloseTo(1.4 * 0.95);
    expect(rogue("dagger", "dagger", 12, true).attackSpeed).toBeCloseTo(1.6);
  });
});

describe("経験値とLv（補助仕様書 4章）", () => {
  it("必要経験値 ＝ 290 × L^1.2（表と一致）", () => {
    const table: [number, number][] = [
      [1, 290],
      [2, 666],
      [3, 1084],
      [5, 2001],
      [10, 4596],
      [15, 7477],
      [19, 9929],
    ];
    for (const [l, v] of table) expect(expToNext(l)).toBe(v);
  });
  it("敵の経験値：5＋2×Lv、魔法×3・精鋭×10・中ボス×30・章ボス×100", () => {
    expect(enemyExp(3)).toBe(11);
    expect(enemyExp(3, "magic")).toBe(33);
    expect(enemyExp(3, "elite")).toBe(110);
    expect(enemyExp(11, "midBoss")).toBe(27 * 30);
    expect(enemyExp(14, "chapterBoss")).toBe(33 * 100);
  });
  it("Lvの差：4以上高いと1Lvごとに-20%（最低10%）", () => {
    expect(levelDifferenceFactor(5, 3)).toBe(1);
    expect(levelDifferenceFactor(7, 3)).toBeCloseTo(0.8);
    expect(levelDifferenceFactor(8, 3)).toBeCloseTo(0.6);
    expect(levelDifferenceFactor(20, 1)).toBe(0.1);
  });
  it("Lvが上がる。上限Lv20で貯まらない", () => {
    const s = { level: 1, exp: 0 };
    expect(addExp(s, 290)).toBe(1);
    expect(s).toEqual({ level: 2, exp: 0 });
    expect(addExp(s, 666 + 1084 + 5)).toBe(2);
    const cap = { level: 20, exp: 0 };
    expect(addExp(cap, 1e9)).toBe(0);
    expect(cap.exp).toBe(0);
    const big = { level: 1, exp: 0 };
    addExp(big, 1e9);
    expect(big).toEqual({ level: 20, exp: 0 });
  });
});

describe("転職と、ジョブLvの別管理", () => {
  const make = (): Progression => new Progression(createStandardJobs(), "JOB-WARRIOR");
  it("キャラLv15で転職が開く。それまでは転職できない", () => {
    const p = make();
    expect(p.canChangeJob("JOB-ROGUE")).toEqual({ ok: false, reason: "locked" });
    p.character.level = 15;
    expect(p.canChangeJob("JOB-ROGUE").ok).toBe(true);
    expect(p.canChangeJob("JOB-WARRIOR").reason).toBe("same");
    expect(p.canChangeJob("JOB-NONE").reason).toBe("unknown");
  });
  it("経験値は、キャラとメインジョブの両方に入る。転職してもジョブLvが混ざらない", () => {
    const p = make();
    p.gainExp(290);
    expect(p.character.level).toBe(2);
    expect(p.jobLevel).toBe(2);
    p.character.level = 15;
    p.changeJob("JOB-ROGUE");
    expect(p.mainJob).toBe("JOB-ROGUE");
    expect(p.jobLevel).toBe(1);
    p.gainExp(290);
    expect(p.jobState("JOB-ROGUE").level).toBe(2);
    expect(p.jobState("JOB-WARRIOR").level).toBe(2);
    p.changeJob("JOB-WARRIOR");
    expect(p.jobLevel).toBe(2);
  });
  it("追いつき補正：最も高いジョブLv-10未満のあいだ、ジョブ経験値×2", () => {
    const p = make();
    p.jobState("JOB-WARRIOR").level = 20;
    p.character.level = 15;
    p.changeJob("JOB-ROGUE");
    expect(p.catchUpActive).toBe(true);
    p.gainExp(290);
    expect(p.jobState("JOB-ROGUE").level).toBe(2);
    expect(p.jobState("JOB-ROGUE").exp).toBe(290);
    p.jobState("JOB-ROGUE").level = 20 - CATCH_UP_GAP;
    expect(p.catchUpActive).toBe(false);
  });
  it("ポイント：星辰盤はキャラLv 2〜20で19、職紋盤はジョブLv 2〜20で19（ジョブごと）", () => {
    const p = make();
    p.character.level = 20;
    p.jobState("JOB-WARRIOR").level = 20;
    expect(p.starPointsFromLevel).toBe(19);
    expect(p.jobPoints("JOB-WARRIOR")).toBe(19);
    expect(p.jobPoints("JOB-ROGUE")).toBe(0);
  });
  it("敵を倒した経験値（Lv差の補正込み）", () => {
    const p = make();
    p.gainFromKill(3);
    expect(p.character.exp).toBe(11);
  });
});

describe("拡張性：3つ目のジョブを、データだけで追加できる（MVPの完成の条件6）", () => {
  it("本体のコードを変えずに、新しいジョブ（固有のゲージ・技）が動く", () => {
    const gauge: GaugeDef = {
      id: "GAUGE-TEST-FAITH",
      name: "信念",
      max: 100,
      hitGain: 5,
      heavyHitGain: 10,
      damagedGainPerPercentMaxHp: 0,
      idleDecayPerSecond: 0,
      idleAfterSeconds: 5,
      intensifyAt: 30,
      provisional: true,
    };
    const knight: JobDef = {
      id: "JOB-TEST-KNIGHT",
      name: "試験の騎士",
      gauge,
      aptitude: { longsword: "S" },
      startingStats: { 剛: 15, 魂: 15 },
      startingWeapon: { weaponKey: "longsword", weaponClass: "longsword" },
      skills: [
        {
          id: "SKL-TEST-OATH",
          name: "誓いの一撃",
          tags: ["近接"],
          kind: "attack",
          mpCost: 5,
          cooldownSeconds: 2,
          shape: { kind: "cone", range: 2, arcDegrees: 90 },
          multiplier: 1.5,
          breakCoefficient: 0.4,
          totalSeconds: 0.5,
          hitTimes: [0.2],
          intensified: { multiplier: 2.2 },
          learnLevel: 1,
          provisional: true,
        },
      ],
    };
    const registry = createStandardJobs();
    registry.register(knight);
    expect(registry.ids()).toContain("JOB-TEST-KNIGHT");
    expect(() => {
      registry.register(knight);
    }).toThrow();
    const f = createFighter(knight, {
      maxHp: 100,
      maxMp: 100,
      weaponKey: "longsword",
      weaponClass: "longsword",
      jobLevel: 1,
    });
    expect(f.attackSpeed).toBeCloseTo(1.4 * 1.1);
    const e = foe(1.5);
    f.use("SKL-TEST-OATH", O, 0, [e], createRng(1));
    expect(f.gauge.value).toBe(5);
    f.gauge.add(30);
    expect(f.effective(knight.skills[0] as never).multiplier).toBe(2.2);
    const p = new Progression(registry, "JOB-TEST-KNIGHT");
    expect(p.mainJob).toBe("JOB-TEST-KNIGHT");
  });
  it("技のないジョブは登録できない", () => {
    const r = new JobRegistry();
    expect(() => {
      r.register({ ...WARRIOR_JOB, id: "JOB-EMPTY", skills: [] });
    }).toThrow();
  });
});
