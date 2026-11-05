import { describe, expect, it } from "vitest";
import {
  Combatant,
  type ContentDb,
  type DamageAttacker,
  FIXED_STEP_SECONDS,
  type ResolvedSkill,
  Rng,
  SkillExecution,
  TagIndex,
  evaluateEffects,
  resolveHit,
  resolveSkill,
  staggerProfiles,
} from "../src/index.ts";
import { effect, fullCombatDb, tag } from "./helpers/content.ts";

const strike = (extra: Record<string, unknown> = {}) => ({
  type: "strike",
  shape: { type: "sector", radius: 1.4, angleDeg: 70 },
  ...extra,
});
const skill = (id: string, extra: Record<string, unknown>) => ({
  id,
  text: `s.${id.toLowerCase()}`,
  tags: ["TAG-FORM-MELEE"],
  kind: "weapon",
  pct: 1,
  mpCost: 0,
  cooldown: 0,
  action: strike(),
  ...extra,
});
const SKILLS = [
  skill("SKL-FLURRY", {
    pct: 0.6,
    action: strike({ hits: 3, hitInterval: 0.12 }),
    gauge: { gainOnHit: 1 },
    weaponVariants: [
      { weaponTag: "TAG-WPN-CLAW", mods: { hits: 4, ailmentChance: { "TAG-AIL-BLEED": 0.25 } } },
    ],
  }),
  skill("SKL-PIERCE", { gauge: { cost: "all" }, finisher: { pctPerPoint: 0.8, forceCritAt: 5 } }),
  skill("SKL-STEP", { pct: 0, action: { type: "teleport", range: 8, behind: 0.6 } }),
  skill("SKL-COAT", {
    pct: 0,
    tags: [],
    action: { type: "selfBuff", effects: ["EFF-COAT"], duration: 12 },
  }),
  skill("SKL-SMOKE", {
    pct: 0,
    action: {
      type: "zone",
      range: 6,
      radius: 3,
      duration: 4,
      interval: 1,
      enemyEffects: ["EFF-COAT"],
      ailment: "TAG-AIL-WEAKEN",
    },
  }),
  skill("SKL-TRAP", {
    pct: 1.2,
    action: { type: "trap", range: 5, radius: 1, duration: 10, max: 3 },
    ailmentChance: { "TAG-AIL-BLEED": 1 },
  }),
];

const db: ContentDb = fullCombatDb(
  [
    effect("EFF-COAT", "jobSkill", [
      {
        kind: "added",
        stat: "STAT-AILMENT-CHANCE",
        value: 0.4,
        filter: { allOf: ["TAG-AIL-POISON"] },
      },
    ]),
  ],
  { tags: [tag("TAG-WPN-CLAW", "weapon")], skills: SKILLS },
);
const tags = new TagIndex(db.tags);
const resolve = (id: string, weapon = "TAG-WPN-DAGGER", gaugeSpent?: number): ResolvedSkill => {
  const def = db.skills.get(id);
  if (def === undefined) throw new Error(id);
  return resolveSkill(db, def, {
    stages: [],
    weaponTags: tags.closure([weapon]),
    ...(gaugeSpent === undefined ? {} : { gaugeSpent }),
  });
};
const runAll = (exec: SkillExecution, seconds = 2) => {
  const ticks = [];
  for (let i = 0; i < seconds * 60 && !exec.finished; i++)
    ticks.push(exec.update(FIXED_STEP_SECONDS, { position: { x: 0, y: 0 }, held: true, mp: 100 }));
  return ticks;
};

describe("盗賊の技の仕組み（仕様書5.6）", () => {
  it("連刃：短剣は3連撃、爪は4連撃で出血の基本付与率25%", () => {
    const dagger = runAll(new SkillExecution(resolve("SKL-FLURRY"), 0, 1.6));
    expect(dagger.flatMap((t) => t.strikes)).toHaveLength(3);
    const claw = resolve("SKL-FLURRY", "TAG-WPN-CLAW");
    expect(claw.ailmentChance).toEqual({ "TAG-AIL-BLEED": 0.25 });
    expect(runAll(new SkillExecution(claw, 0, 1.7)).flatMap((t) => t.strikes)).toHaveLength(4);
  });

  it("連撃の間隔：1撃目は当たり判定の始まり、2撃目からは0.12秒ごと", () => {
    const ticks = runAll(new SkillExecution(resolve("SKL-FLURRY"), 0, 1));
    const at = ticks.flatMap((t, i) => (t.strikes.length > 0 ? [i + 1] : []));
    expect(at).toEqual([18, 26, 33]); // 0.3秒・0.42秒・0.54秒を過ぎた最初の刻み
  });

  it("急所穿ち：コンボ点1につき+80%、5点なら必ず会心", () => {
    expect(resolve("SKL-PIERCE", "TAG-WPN-DAGGER", 3).damage.pct).toBeCloseTo(3.4);
    expect(resolve("SKL-PIERCE", "TAG-WPN-DAGGER", 4).forceCrit).toBe(false);
    const five = resolve("SKL-PIERCE", "TAG-WPN-DAGGER", 5);
    expect(five.damage.pct).toBeCloseTo(5);
    expect(five.forceCrit).toBe(true);
    const strikes = runAll(new SkillExecution(five, 0, 1)).flatMap((t) => t.strikes);
    expect(strikes[0]?.forceCrit).toBe(true);
  });

  it("影走り：行き先へ瞬間移動する", () => {
    const ticks = runAll(
      new SkillExecution(resolve("SKL-STEP"), 0, 1, { teleportTo: { x: 5, y: 2 } }),
    );
    const moved = ticks.reduce(
      (s, t) => ({ x: s.x + t.displacement.x, y: s.y + t.displacement.y }),
      {
        x: 0,
        y: 0,
      },
    );
    expect(moved).toEqual({ x: 5, y: 2 });
  });

  it("毒塗り・煙玉・罠：自分の効果、照準の位置（射程内に収める）の範囲と罠", () => {
    const coat = runAll(new SkillExecution(resolve("SKL-COAT"), 0, 1));
    expect(coat.find((t) => t.selfBuff !== undefined)?.selfBuff).toEqual({
      effects: ["EFF-COAT"],
      duration: 12,
    });
    const smoke = runAll(
      new SkillExecution(resolve("SKL-SMOKE"), 0, 1, { aimPoint: { x: 10, y: 0 } }),
    ).find((t) => t.zone !== undefined)?.zone;
    expect(smoke?.center).toEqual({ x: 6, y: 0 });
    expect(smoke?.ailment).toBe("TAG-AIL-WEAKEN");
    const trap = runAll(
      new SkillExecution(resolve("SKL-TRAP"), 0, 1, { aimPoint: { x: 2, y: 1 } }),
    ).find((t) => t.trap !== undefined)?.trap;
    expect(trap).toEqual({ center: { x: 2, y: 1 }, radius: 1, duration: 10, max: 3 });
  });
});

describe("背面判定の補正と、必ず会心", () => {
  const { view } = evaluateEffects(db, tags, []);
  const attacker: DamageAttacker = {
    db,
    view,
    characterLevel: 1,
    weapon: {
      uid: "d",
      tags: ["TAG-WPN-DAGGER"],
      base: { physical: { min: 10, max: 10 } },
      critChance: 0,
    },
  };
  const target = () =>
    new Combatant(db, {
      id: "t",
      team: "enemy",
      position: { x: 0, y: 0 },
      radius: 0.5,
      facing: Math.PI, // 左を向いている → 右側が背後
      maxHp: 1e6,
      staggerProfile: staggerProfiles(db).enemy,
    });
  const crits = (from: { x: number; y: number }, bonus: boolean, forceCrit = false) => {
    const rng = Rng.fromSeed(7);
    let n = 0;
    for (let i = 0; i < 2000; i++) {
      const r = resolveHit({
        db,
        attacker,
        attackerPosition: from,
        skill: { tags: ["TAG-FORM-MELEE"], kind: "weapon", pct: 1 },
        skillChance: { "TAG-AIL-BLEED": 0.25 },
        target: target(),
        rng,
        ...(bonus ? { backstabBonus: { critChance: 0.1, ailmentChance: 0.25 } } : {}),
        forceCrit,
      });
      if (r.hit.crit) n += 1;
    }
    return n / 2000;
  };

  it("盗賊の背面判定：背後からのヒットだけ、会心率+10%", () => {
    expect(crits({ x: 1, y: 0 }, true)).toBeCloseTo(0.1, 1);
    expect(crits({ x: -1, y: 0 }, true)).toBe(0);
    expect(crits({ x: 1, y: 0 }, false)).toBe(0);
  });

  it("必ず会心", () => {
    expect(crits({ x: -1, y: 0 }, false, true)).toBe(1);
  });
});
