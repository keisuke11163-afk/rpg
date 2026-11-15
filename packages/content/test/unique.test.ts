import {
  DiscoveryTracker,
  Equipment,
  TagRegistry,
  WARRIOR_JOB,
  ROGUE_JOB,
  activeLatents,
  boardFlags,
  buildBoardContext,
  createCombatant,
  createFighter,
  createRng,
  describeItem,
  equippedUniqueEffects,
  evaluate,
  generateItem,
  rollDrops,
  StarBoard,
  JobBoard,
  type ActiveEffect,
  type Combatant,
  type Fighter,
  type ItemInstance,
} from "@stella/core";
import { describe, expect, it } from "vitest";
import {
  BOARD_DATA,
  GEAR_DATA,
  GENERATION_DATA,
  JOB_BOARDS,
  TAG_DATA,
  UNIQUE_DATA,
  UNIQUES,
  loadContent,
} from "../src/index.ts";

const tags = new TagRegistry(TAG_DATA);
const nameToId = new Map(TAG_DATA.map((t) => [t.name, t.id]));
const stats = { 剛: 30, 迅: 30, 理: 5, 魂: 5 };
const O = { x: 0, y: 0 };
let n = 0;
const uniqueItem = (id: string, enhance = 0): ItemInstance => {
  const def = UNIQUE_DATA.uniques.get(id);
  if (!def) throw new Error(id);
  return {
    uid: `u_${String(n++)}`,
    baseId: def.baseId,
    rarity: "unique",
    ilvl: 20,
    affixes: [],
    enhance,
    uniqueId: id,
  };
};
const foe = (x = 1.2, facing = Math.PI, hp = 1e7): Combatant =>
  createCombatant({ id: `F${String(n++)}`, pos: { x, y: 0 }, maxHp: hp, facing });

/** 装備とツリーの「旗」から、ユニークの効果を戦闘に組み込んだ戦闘者を作る */
function build(opts: {
  job: "warrior" | "rogue";
  uniques: string[];
  star?: string[];
  jobBoard?: string[];
  weapon?: string;
  flags?: string[];
}): { f: Fighter; eq: Equipment; flags: Set<string>; latentActive: string[] } {
  const jobDef = opts.job === "warrior" ? WARRIOR_JOB : ROGUE_JOB;
  const eq = new Equipment();
  if (opts.weapon)
    eq.equip(
      {
        uid: `w_${String(n++)}`,
        baseId: opts.weapon,
        rarity: "normal",
        ilvl: 1,
        affixes: [],
        enhance: 0,
      },
      GEAR_DATA,
    );
  for (const id of opts.uniques) eq.equip(uniqueItem(id), GEAR_DATA, { canDualWield: true });
  const bc = buildBoardContext(eq, GEAR_DATA, {
    tags,
    characterStats: stats,
    ...(opts.flags?.includes("二刀流") ? { dualWield: true } : {}),
  });
  // ツリー
  const star = new StarBoard(
    BOARD_DATA,
    opts.job === "warrior" ? "STAR-GOU-START" : "STAR-JIN-START",
  );
  const jb = JOB_BOARDS[jobDef.id];
  const job = new JobBoard(jb?.data as never, jb?.start as string, jobDef.id);
  const takeByName = (
    board: { allocate(id: string, p: number): unknown; has(id: string): boolean },
    data: typeof BOARD_DATA,
    start: string,
    names: string[],
  ): void => {
    for (const name of names) {
      const target = name.startsWith("#")
        ? name.slice(1)
        : [...data.nodes.values()].find((x) => x.name === name)?.id;
      if (!target) throw new Error(name);
      const prev = new Map<string, string>();
      const q = [start];
      const seen = new Set(q);
      while (q.length) {
        const id = q.shift() as string;
        for (const l of data.nodes.get(id)?.links ?? [])
          if (!seen.has(l)) {
            seen.add(l);
            prev.set(l, id);
            q.push(l);
          }
      }
      const path: string[] = [];
      for (let c: string | undefined = target; c && c !== start; c = prev.get(c)) path.unshift(c);
      for (const id of path) if (!board.has(id)) board.allocate(id, 999);
    }
  };
  takeByName(star, BOARD_DATA, star.entrances[0] as string, opts.star ?? []);
  takeByName(job.board, jb?.data as never, jb?.start as string, opts.jobBoard ?? []);
  const starEval = star.evaluate(999, bc);
  const jobEval = job.evaluate(999, bc);
  const flags = boardFlags([
    { data: BOARD_DATA, evaluation: starEval },
    { data: jb?.data as never, evaluation: jobEval },
  ]);
  for (const x of opts.flags ?? []) flags.add(x);
  const ctx = { ...bc.ctx, flags: new Set([...bc.ctx.flags, ...flags]) };
  const entries: ActiveEffect[] = [
    ...starEval.effects,
    ...jobEval.effects,
    ...equippedUniqueEffects(eq, UNIQUE_DATA),
  ];
  const f = createFighter(jobDef, {
    maxHp: 100,
    maxMp: 1000,
    weaponKey: opts.job === "warrior" ? "greatsword" : "dagger",
    weaponClass: opts.job === "warrior" ? "greatsword" : "dagger",
    jobLevel: 12,
  });
  f.setEffectSource(entries, ctx, (skill) =>
    tags.expand(skill.tags.map((t) => nameToId.get(t)).filter((x): x is string => x !== undefined)),
  );
  const latentActive = activeLatents(evaluate(entries, ctx), UNIQUE_DATA);
  return { f, eq, flags, latentActive };
}

describe("ユニークのデータ（MVPの9個）", () => {
  it("U02・U03・U06・U13〜U18。検証を通り、ベースが実在し、潜在効果は条件を持つ", () => {
    expect(loadContent().issues).toEqual([]);
    expect([...UNIQUE_DATA.uniques.keys()].sort()).toEqual([
      "UNQ-U02",
      "UNQ-U03",
      "UNQ-U06",
      "UNQ-U13",
      "UNQ-U14",
      "UNQ-U15",
      "UNQ-U16",
      "UNQ-U17",
      "UNQ-U18",
    ]);
    for (const u of UNIQUE_DATA.uniques.values()) {
      expect(GEAR_DATA.bases.has(u.baseId)).toBe(true);
      expect(UNIQUE_DATA.effects.get(u.latent.effect)?.conditions.length).toBeGreaterThan(0);
    }
    expect(UNIQUES).toHaveLength(9);
  });
  it("第1章ボス専用（U03・U13・U18）は、ボスのドロップだけに出る", () => {
    const fromBoss = new Set<string>();
    const fromMob = new Set<string>();
    const gen1 = (source: string, i: number): string =>
      generateItem(
        GENERATION_DATA,
        { ilvl: 30, rarity: "unique", uid: () => `x${String(n++)}`, uniqueSource: source },
        createRng(i),
      ).uniqueId ?? "";
    for (let i = 0; i < 400; i++) {
      fromBoss.add(gen1("boss-ch1", i));
      fromMob.add(gen1("any", i));
    }
    for (const id of ["UNQ-U03", "UNQ-U13", "UNQ-U18"]) {
      expect(fromBoss.has(id)).toBe(true);
      expect(fromMob.has(id)).toBe(false);
    }
  });
  it("獣系の精鋭から、狼牙の首飾りが出やすい", () => {
    const count = (source: "normal" | "elite", family?: string): number => {
      let c = 0;
      for (let i = 0; i < 6000; i++) {
        const d = rollDrops(
          GENERATION_DATA,
          {
            source,
            enemyLevel: 10,
            ...(family ? { family } : {}),
            generate: {},
            uid: () => `d${String(n++)}`,
          },
          createRng(`${source}${String(i)}`),
        );
        c += d.items.filter((it) => it.uniqueId === "UNQ-U14").length;
      }
      return c;
    };
    expect(count("elite", "TAG-ENEMY-BEAST")).toBeGreaterThan(count("elite"));
  });
});

describe("潜在効果の発動（I-09）と「？？？」の解放", () => {
  it("条件を満たすまで潜在効果は発動しない。満たすと発動する（U03×毒血同源・U18×毒蛇座）", () => {
    expect(build({ job: "rogue", uniques: ["UNQ-U03"] }).latentActive).toEqual([]);
    expect(
      build({ job: "rogue", uniques: ["UNQ-U03"], jobBoard: ["毒血同源"] }).latentActive,
    ).toEqual(["UNQ-U03"]);
    expect(build({ job: "rogue", uniques: ["UNQ-U18"] }).latentActive).toEqual([]);
    const viper = BOARD_DATA.constellations.get("CONST-VIPER");
    const names = viper?.nodes.map((id) => `#${id}`) ?? [];
    expect(names.length).toBe(9);
    expect(
      build({
        job: "rogue",
        uniques: ["UNQ-U18"],
        star: names,
      }).latentActive,
    ).toContain("UNQ-U18");
  });
  it("各ユニークの潜在効果は、定義した他のシステムの条件で目覚める（U13〜U18の潜在効果）", () => {
    const jobFlag = (u: string, flags: string[]): string[] =>
      build({ job: "warrior", uniques: [u], flags }).latentActive;
    expect(jobFlag("UNQ-U13", [])).toEqual([]);
    expect(jobFlag("UNQ-U13", ["ノード:徒手の極意"])).toEqual(["UNQ-U13"]);
    expect(jobFlag("UNQ-U14", ["ノード:傷口を抉る"])).toEqual(["UNQ-U14"]);
    expect(jobFlag("UNQ-U15", ["ノード:鬼神化"])).toEqual([]); // 鬼神の間だけ
    expect(jobFlag("UNQ-U15", ["ノード:鬼神化", "鬼神中"])).toEqual(["UNQ-U15"]);
    expect(jobFlag("UNQ-U16", ["ノード:影法師"])).toEqual(["UNQ-U16"]);
    expect(jobFlag("UNQ-U17", ["星座:双刃座"])).toEqual([]); // 二刀流のときだけ
    expect(jobFlag("UNQ-U17", ["星座:双刃座", "二刀流"])).toEqual(["UNQ-U17"]);
    expect(jobFlag("UNQ-U02", ["星座:風見座"])).toEqual(["UNQ-U02"]);
    expect(jobFlag("UNQ-U06", ["ノード:心眼"])).toEqual(["UNQ-U06"]);
  });
  it("ツールチップは、発動するまで「？？？（ヒント）」。発動すると中身が出る。解放は1回だけ通知する", () => {
    const item = uniqueItem("UNQ-U03");
    const before = describeItem(item, GEAR_DATA, { revealedLatents: new Set() });
    expect(before.find((l) => l.kind === "latent")?.text).toBe(
      "潜在効果：？？？（盗賊の毒の術に応える）",
    );
    expect(before[0]?.text).toContain("千の小傷");
    const tracker = new DiscoveryTracker();
    expect(tracker.update(["UNQ-U03"])).toEqual(["UNQ-U03"]);
    expect(tracker.update(["UNQ-U03"])).toEqual([]);
    const after = describeItem(item, GEAR_DATA, { revealedLatents: new Set(tracker.all()) });
    expect(after.find((l) => l.kind === "latent")?.text).toContain("毒血同源");
    expect(new DiscoveryTracker(tracker.all()).has("UNQ-U03")).toBe(true);
  });
  it("同じユニークは二重に数えない（V-01）", () => {
    const eq = new Equipment();
    eq.equip(uniqueItem("UNQ-U14"), GEAR_DATA);
    eq.equip(uniqueItem("UNQ-U15"), GEAR_DATA);
    expect(equippedUniqueEffects(eq, UNIQUE_DATA)).toHaveLength(4);
    const dup = new Equipment();
    dup.equip(uniqueItem("UNQ-U14"), GEAR_DATA);
    dup.equip({ ...uniqueItem("UNQ-U14"), baseId: "BASE-ACC-NECK-STARIRON-T1" }, GEAR_DATA);
    expect(equippedUniqueEffects(dup, UNIQUE_DATA)).toHaveLength(2);
  });
});

describe("固有効果が戦闘で働く", () => {
  it("U03 千の小傷：打撃値-40%・物理ヒットは必ず出血・出血の最大スタック12", () => {
    const { f } = build({ job: "rogue", uniques: ["UNQ-U03"] });
    const plain = build({ job: "rogue", uniques: [] }).f;
    const e = foe(1.2, 0);
    for (let i = 0; i < 20; i++) {
      f.mp = 1000;
      f.use("SKL-ROG-FLURRY", O, 0, [e], createRng(i));
    }
    expect(e.ailments.stackCount("bleed")).toBe(12);
    const a =
      f.hitSpec(f.effective(f.init.skills[0] as never), createRng(1)).damage.generic?.mult ?? 1;
    const b =
      plain.hitSpec(plain.effective(plain.init.skills[0] as never), createRng(1)).damage.generic
        ?.mult ?? 1;
    expect(a / b).toBeCloseTo(0.6);
    expect(
      f.hitSpec(f.effective(f.init.skills[0] as never), createRng(1)).forcedAilments,
    ).toContain("bleed");
  });
  it("U03 × 毒血同源（I-30・V-08）：出血が毒としても数えられ、ダメージは二重にならない。千変の種類が早く揃う", () => {
    const { f } = build({ job: "rogue", uniques: ["UNQ-U03"], jobBoard: ["毒血同源"] });
    const e = foe(1.2, Math.PI);
    for (let i = 0; i < 12; i++) {
      f.mp = 1000;
      f.use("SKL-ROG-FLURRY", O, 0, [e], createRng(i));
    }
    expect(e.ailments.stackCount("poison")).toBe(0);
    expect(e.ailments.stackCount("bleed")).toBe(12);
    expect(e.ailments.countedStacks("poison")).toBe(12);
    // 出血1種類が、出血と毒の2種類として数えられる
    expect(e.ailments.countedKinds()).toBe(2);
    // 毒を実際に付与しないので、持続ダメージは出血の分だけ（二重にならない）
    const dots = e.ailments.tick(1, { addPct: 0, mult: 1, enemyDamageTaken: 1, resistance: {} });
    expect(dots.every((d) => d.kind === "bleed")).toBe(true);
    // 煙玉の衰弱が加わると3種類になる（千変の臨界の条件）
    e.ailments.apply("weaken", { reference: {} });
    expect(e.ailments.countedKinds()).toBe(3);
    const without = build({ job: "rogue", uniques: ["UNQ-U03"] }).f;
    const e2 = foe(1.2, Math.PI);
    without.use("SKL-ROG-FLURRY", O, 0, [e2], createRng(1));
    expect(e2.ailments.countedKinds()).toBe(1);
  });
  it("U18 母樹の根冠：毒10スタックにつき被ダメージ×1.04（最大×1.20）。毒蛇座の完成で×1.30。出血が毒に数えられる", () => {
    const mult = (b: { f: Fighter }, poisonStacks: number): number => {
      const e = foe(1.2, 0);
      for (let i = 0; i < poisonStacks; i++)
        e.ailments.apply("poison", { reference: { physical: 1 } });
      const spec = b.f.hitSpec(b.f.effective(b.f.init.skills[0] as never), createRng(1));
      return spec.targetBonus?.(e).mult ?? 1;
    };
    const a = build({ job: "rogue", uniques: ["UNQ-U18"] });
    expect(mult(a, 9)).toBeCloseTo(1);
    expect(mult(a, 10)).toBeCloseTo(1.04);
    expect(mult(a, 25)).toBeCloseTo(1.04 ** 2);
    expect(mult(a, 500)).toBeCloseTo(1.2);
    const viper = BOARD_DATA.constellations.get("CONST-VIPER")?.nodes.map((id) => `#${id}`) ?? [];
    const b = build({ job: "rogue", uniques: ["UNQ-U18"], star: viper });
    expect(mult(b, 500)).toBeCloseTo(1.3);
  });
  it("U06 盲目の賢者の目隠し：必中・会心しない・会心率の増加1%ごとにダメージ+0.5%", () => {
    const { f } = build({ job: "rogue", uniques: ["UNQ-U06"] });
    const spec = f.hitSpec(f.effective(f.init.skills[0] as never), createRng(1));
    expect(spec.alwaysHit).toBe(true);
    expect(spec.noCrit).toBe(true);
    const e = createCombatant({ id: "E", pos: { x: 1.2, y: 0 }, maxHp: 1e7, evasion: 1e9 });
    let hits = 0;
    let crits = 0;
    for (let i = 0; i < 50; i++) {
      f.mp = 1000;
      const out = f.use("SKL-ROG-FLURRY", O, 0, [e], createRng(i));
      hits += out.hits.filter((h) => h.result.hit).length;
      crits += out.hits.filter((h) => h.result.crit).length;
    }
    expect(hits).toBe(150);
    expect(crits).toBe(0);
  });
  it("U02 旅人の古靴：移動速度+12%、10m移動するごとにクールダウン-0.3秒（1秒あたり最大1.0秒分）", () => {
    const { f } = build({ job: "warrior", uniques: ["UNQ-U02"] });
    expect(f.moveSpeedMultiplier).toBeCloseTo(1.12);
    f.use("SKL-WAR-RIFT", O, 0, [], createRng(1));
    const before = f.cooldownLeft("SKL-WAR-RIFT");
    f.noteMovement(true, 10, 0.1);
    expect(f.cooldownLeft("SKL-WAR-RIFT")).toBeCloseTo(before - 0.3);
    f.noteMovement(true, 100, 0.1); // 10回分でも、1秒あたり1.0秒分まで
    expect(f.cooldownLeft("SKL-WAR-RIFT")).toBeCloseTo(before - 0.3 - 0.6, 5);
    const c = build({ job: "warrior", uniques: ["UNQ-U02"], flags: ["星座:風見座"] }).f;
    c.use("SKL-WAR-RIFT", O, 0, [], createRng(1));
    const b2 = c.cooldownLeft("SKL-WAR-RIFT");
    c.noteMovement(true, 10, 0.1);
    expect(c.cooldownLeft("SKL-WAR-RIFT")).toBeCloseTo(b2 - 0.5);
  });
  it("U13 樹皮の盾：止まっている間に防具値が上がり（最大+50%）、攻撃してきた敵に毒。徒手の極意で周囲3mの敵にも", () => {
    const a = build({ job: "warrior", uniques: ["UNQ-U13"] });
    expect(a.f.armorMultiplier).toBeCloseTo(1);
    for (let i = 0; i < 3; i++) a.f.noteMovement(false, 0, 1);
    expect(a.f.armorMultiplier).toBeCloseTo(1.3);
    for (let i = 0; i < 10; i++) a.f.noteMovement(false, 0, 1);
    expect(a.f.armorMultiplier).toBeCloseTo(1.5);
    a.f.noteMovement(true, 1, 0.1);
    expect(a.f.armorMultiplier).toBeCloseTo(1);
    const attacker = foe(3);
    const bystander = foe(4);
    const far = foe(20);
    a.f.retaliate(attacker, 20, [bystander, far]);
    expect(attacker.ailments.stackCount("poison")).toBe(1);
    expect(bystander.ailments.stackCount("poison")).toBe(0);
    const b = build({ job: "warrior", uniques: ["UNQ-U13"], flags: ["ノード:徒手の極意"] });
    const att2 = foe(3);
    const by2 = foe(4);
    const far2 = foe(20);
    b.f.retaliate(att2, 20, [by2, far2]);
    expect(by2.ailments.stackCount("poison")).toBe(1);
    expect(far2.ailments.stackCount("poison")).toBe(0);
    // 毒の基準値は受けたダメージの30%：総量 = 20×0.3×0.6（持続ダメージの係数）
    const total = att2.ailments
      .tick(3.1, { addPct: 0, mult: 1, enemyDamageTaken: 1, resistance: {} })
      .reduce((s, d) => s + d.damage, 0);
    expect(total).toBeCloseTo(20 * 0.3 * 0.6, 1);
  });
  it("U14 狼牙の首飾り：出血している敵を倒すと、出血が最も近い敵1体に移る（1スタック）。傷口を抉るでスタック数を保つ", () => {
    const run = (flags: string[]): { near: Combatant; far: Combatant } => {
      const { f } = build({ job: "rogue", uniques: ["UNQ-U14"], flags });
      const dead = foe(1);
      const near = foe(3);
      const far = foe(10);
      for (let i = 0; i < 5; i++) dead.ailments.apply("bleed", { reference: { physical: 10 } });
      dead.hp = 0;
      f.onEnemyKilled(dead, [dead, near, far]);
      return { near, far };
    };
    const a = run([]);
    expect(a.near.ailments.stackCount("bleed")).toBe(1);
    expect(a.far.ailments.stackCount("bleed")).toBe(0);
    expect(run(["ノード:傷口を抉る"]).near.ailments.stackCount("bleed")).toBe(5);
  });
  it("U15 打ち鳴らしの籠手：崩れた敵へのヒットで闘志+3（重撃+9）。崩しの拡散は30%、鬼神の間は50%", () => {
    const { f } = build({ job: "warrior", uniques: ["UNQ-U15"] });
    const e = foe(1.5, Math.PI);
    e.breakGauge.add(1e12);
    expect(e.breakGauge.broken).toBe(true);
    f.use("SKL-WAR-SWEEP", O, 0, [e], createRng(1));
    // 通常のヒット+2 と 崩れた敵への+3
    expect(f.gauge.value).toBe(5);
    f.tick(1);
    f.use("SKL-WAR-RIFT", O, 0, [e], createRng(2));
    expect(f.gauge.value).toBe(5 + 6 + 9);
    // 満タンにした瞬間、周囲4mの敵の崩しゲージが最大値の30%増える
    const run = (flags: string[]): number => {
      const g = build({ job: "warrior", uniques: ["UNQ-U15"], flags }).f;
      const main = foe(1.5, Math.PI, 1000);
      const bystander = createCombatant({
        id: `B${String(n++)}`,
        pos: { x: 1.5, y: 3 },
        maxHp: 1000,
        facing: Math.PI,
      });
      const out = foe(30, Math.PI, 1000);
      main.breakGauge.add(main.breakGauge.currentMax - 1);
      g.use("SKL-WAR-RIFT", O, 0, [main, bystander, out], createRng(1));
      expect(out.breakGauge.gauge).toBe(0);
      return bystander.breakGauge.gauge / bystander.breakGauge.currentMax;
    };
    expect(run([])).toBeGreaterThan(0.29);
    expect(run([])).toBeLessThan(0.45);
  });
  it("U16 背向けの外套：背後にいる間の被ダメージ-15%。移動の技の後2秒間、全てのヒットが背面になる。影法師では代わりにコンボ点", () => {
    const a = build({ job: "rogue", uniques: ["UNQ-U16"] });
    const dmg = a.f.takeDamage(20, { playerBehindAttacker: true });
    const plain = build({ job: "rogue", uniques: [] }).f.takeDamage(20, {
      playerBehindAttacker: true,
    });
    expect(dmg / plain).toBeCloseTo(0.85);
    // 影走り（移動の技）の後は、正面の敵にも背面ヒット
    const e = foe(1.2, Math.PI); // 攻撃者のほうを向いている＝正面
    a.f.use("SKL-ROG-SHADOWSTEP", O, 0, [foe(5, 0)], createRng(1), { aim: { x: 5, y: 0 } });
    const forced = a.f.use("SKL-ROG-FLURRY", O, 0, [e], createRng(1));
    expect(forced.hits[0]?.result.back).toBe(true);
    a.f.tick(2.1);
    const e2 = foe(1.2, Math.PI);
    expect(a.f.use("SKL-ROG-FLURRY", O, 0, [e2], createRng(2)).hits[0]?.result.back).toBe(false);
    // 影法師：背面ヒットでコンボ点+1（1秒に1回まで）。移動の技の後の背面扱いは働かない
    const b = build({ job: "rogue", uniques: ["UNQ-U16"], flags: ["ノード:影法師"] });
    const back = foe(1.2, 0);
    b.f.use("SKL-ROG-FLURRY", O, 0, [back], createRng(1));
    expect(b.f.gauge.value).toBe(2); // 連刃のコンボ+1 と 背面ヒット+1
    b.f.use("SKL-ROG-FLURRY", O, 0, [foe(1.2, 0)], createRng(2));
    expect(b.f.gauge.value).toBe(3); // 1秒以内の背面ヒットでは増えない（連刃の+1だけ）
  });
  it("U17 二股の枝：ヒットのたびに近くの別の敵1体に50%のダメージ。分かれたヒットは状態異常を付与しない（双刃座×二刀流で付与）", () => {
    const run = (flags: string[]): { forked: number; primary: number; ail: number } => {
      const { f } = build({
        job: "warrior",
        uniques: ["UNQ-U17"],
        weapon: "BASE-WPN-AXE-T1",
        flags,
      });
      f.mp = 1000;
      const main = foe(1.5, Math.PI);
      const other = foe(4.5, Math.PI);
      const out = f.use("SKL-WAR-SWEEP", O, 0, [main, other], createRng(1));
      const primary = out.hits.find((h) => h.target === main)?.result.damage ?? 0;
      const forked = out.hits.find((h) => h.target === other)?.result.damage ?? 0;
      return { forked, primary, ail: other.ailments.activeKinds().length };
    };
    const a = run([]);
    expect(a.forked).toBeGreaterThan(0);
    expect(a.forked / a.primary).toBeGreaterThan(0.3);
    expect(a.forked / a.primary).toBeLessThan(0.7);
    expect(a.ail).toBe(0);
  });
});

describe("相互作用の回帰", () => {
  it("V-01：同じユニークを装備と残響で同時には使えない（二重に数えない）", () => {
    const eq = new Equipment();
    eq.equip(uniqueItem("UNQ-U18"), GEAR_DATA);
    const twice = [
      ...equippedUniqueEffects(eq, UNIQUE_DATA),
      ...equippedUniqueEffects(eq, UNIQUE_DATA),
    ];
    expect(twice).toHaveLength(4);
    expect(equippedUniqueEffects(eq, UNIQUE_DATA)).toHaveLength(2);
  });
});
