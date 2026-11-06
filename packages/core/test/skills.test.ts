import { describe, expect, it } from "vitest";
import {
  AFFINITY_ATTACK_SPEED,
  Combatant,
  Cooldowns,
  type ContentDb,
  type DamageAttacker,
  FIXED_STEP_SECONDS,
  type GaugeDef,
  JobGauge,
  type JobDef,
  LingeringZone,
  type ResolvedSkill,
  Rng,
  SkillExecution,
  type Strike,
  TagIndex,
  TimedEffects,
  dualWieldAffinity,
  evaluateEffects,
  lowerAffinity,
  pullTowards,
  resolveHit,
  resolveSkill,
  skillBlock,
  staggerProfiles,
  unlockedSkills,
  weaponAffinity,
} from "../src/index.ts";
import { effect, fullCombatDb, tag } from "./helpers/content.ts";

const EXTRA_TAGS = [
  tag("TAG-JOB-T", "job"),
  tag("TAG-FORM-AREA", "form"),
  tag("TAG-FORM-HEAVY", "form"),
  tag("TAG-FORM-WARCRY", "form"),
  tag("TAG-WPNGRP-AXE", "weaponGroup"),
  tag("TAG-WPN-AXE", "weapon", ["TAG-WPNGRP-AXE"]),
  tag("TAG-WPN-GREAT", "weapon"),
  tag("TAG-WPN-UNARMED", "weapon"),
];

const GAUGE = {
  id: "GAU-T",
  text: "g.t",
  max: 100,
  gains: [
    { on: "hitDealt", value: 2, tag: "TAG-FORM-HEAVY", tagValue: 6 },
    { on: "damageTaken", valuePerPercentOfMaxHp: 1 },
  ],
  decayOutOfCombat: 5,
  stages: [
    { id: "empowered", min: 50, text: "g.t.empowered" },
    { id: "release", min: 100, text: "g.t.release" },
  ],
};

const sector = (radius: number, angleDeg: number) => ({ type: "sector", radius, angleDeg });

const SKILLS = {
  sweep: {
    id: "SKL-T-SWEEP",
    text: "s.sweep",
    job: "JOB-T",
    tags: ["TAG-FORM-MELEE", "TAG-FORM-AREA"],
    kind: "weapon",
    pct: 1.3,
    mpCost: 4,
    cooldown: 0,
    action: { type: "strike", shape: sector(2.2, 120) },
    staggerCoefficient: 0.4,
    stageVariants: [{ stage: "empowered", mods: { angleDeg: 180, staggerIncreased: 0.3 } }],
    weaponVariants: [
      { weaponTag: "TAG-WPN-GREAT", mods: { areaMultiplier: 1.2 } },
      { weaponTag: "TAG-WPNGRP-AXE", mods: { ailmentChance: { "TAG-AIL-BLEED": 0.3 } } },
      {
        weaponTag: "TAG-WPN-SWORD",
        mods: { behaviors: [{ hook: "shockwave", params: { ratio: 0.5, length: 4, width: 1 } }] },
      },
    ],
  },
  dash: {
    id: "SKL-T-DASH",
    text: "s.dash",
    job: "JOB-T",
    tags: ["TAG-FORM-MELEE"],
    kind: "weapon",
    pct: 1.5,
    mpCost: 8,
    cooldown: 5,
    action: { type: "dash", distance: 8, duration: 0.4, width: 1.2 },
    stageVariants: [{ stage: "empowered", mods: { behaviors: [{ hook: "fullStagger" }] } }],
    weaponVariants: [{ weaponTag: "TAG-WPN-GREAT", mods: { distanceAdd: 4 } }],
  },
  cry: {
    id: "SKL-T-CRY",
    text: "s.cry",
    job: "JOB-T",
    tags: ["TAG-FORM-WARCRY"],
    kind: "weapon",
    pct: 0,
    mpCost: 12,
    cooldown: 12,
    action: {
      type: "warcry",
      radius: 6,
      duration: 8,
      allyEffects: ["EFF-T-CRY"],
      enemyEffects: ["EFF-T-INTIM"],
    },
    gauge: { gainOnUse: 20 },
    stageVariants: [{ stage: "empowered", mods: { radiusMultiplier: 1.5 } }],
  },
  split: {
    id: "SKL-T-SPLIT",
    text: "s.split",
    job: "JOB-T",
    tags: ["TAG-FORM-MELEE", "TAG-FORM-HEAVY"],
    kind: "weapon",
    pct: 2.2,
    mpCost: 10,
    cooldown: 4,
    action: { type: "strike", shape: { type: "line", length: 6, width: 1.5 } },
    staggerCoefficient: 0.8,
    stageVariants: [
      {
        stage: "empowered",
        mods: {
          behaviors: [
            { hook: "lingeringFissure", params: { ratio: 0.5, duration: 2, interval: 1 } },
          ],
        },
      },
    ],
    weaponVariants: [
      {
        weaponTag: "TAG-WPN-GREAT",
        mods: { behaviors: [{ hook: "crossFissure", params: { length: 4 } }] },
      },
    ],
  },
  spin: {
    id: "SKL-T-SPIN",
    text: "s.spin",
    job: "JOB-T",
    tags: ["TAG-FORM-MELEE", "TAG-FORM-AREA"],
    kind: "weapon",
    pct: 0.9,
    mpCost: 0,
    cooldown: 0,
    action: {
      type: "channel",
      shape: { type: "circle", radius: 2 },
      hitsPerSecond: 4,
      mpInterval: 0.25,
      mpPerInterval: 3,
      moveSpeedMultiplier: 0.8,
    },
    stageVariants: [
      {
        stage: "empowered",
        mods: { behaviors: [{ hook: "pullIn", params: { radius: 4, speed: 2 } }] },
      },
    ],
    dualWieldVariant: { hitsPerSecond: 6, pct: 0.7 },
  },
  final: {
    id: "SKL-T-FINAL",
    text: "s.final",
    job: "JOB-T",
    tags: ["TAG-FORM-MELEE", "TAG-FORM-HEAVY"],
    kind: "weapon",
    pct: 8,
    mpCost: 0,
    cooldown: 0,
    action: { type: "strike", shape: sector(4, 180) },
    staggerCoefficient: 2,
    gauge: { requires: 100, cost: "all" },
    selfEffects: [{ effect: "EFF-T-GUARD", duration: 8 }],
    requiredAffinity: "B",
  },
};

const JOB = {
  id: "JOB-T",
  tag: "TAG-JOB-T",
  text: "j.t",
  gauge: "GAU-T",
  skills: [
    { skill: "SKL-T-SWEEP", level: 1 },
    { skill: "SKL-T-DASH", level: 3 },
    { skill: "SKL-T-CRY", level: 5 },
    { skill: "SKL-T-SPLIT", level: 7 },
    { skill: "SKL-T-SPIN", level: 10 },
    { skill: "SKL-T-FINAL", level: 12 },
  ],
  affinity: { "TAG-WPN-GREAT": "S", "TAG-WPN-SWORD": "A", "TAG-WPN-AXE": "B" },
  dualWield: "B",
};

const EFFECTS = [
  effect("EFF-T-CRY", "jobSkill", [{ kind: "increased", stat: "STAT-DAMAGE", value: 0.15 }]),
  effect(
    "EFF-T-INTIM",
    "jobSkill",
    [{ kind: "increased", stat: "STAT-STAGGER-TAKEN", value: 0.2 }],
    { affects: { hit: false, ailmentBase: false }, scope: "enemies" },
  ),
  effect(
    "EFF-T-GUARD",
    "jobSkill",
    [{ kind: "increased", stat: "STAT-DAMAGE-TAKEN", value: -0.2 }],
    {
      affects: { hit: false, ailmentBase: false },
    },
  ),
];

const db = (): ContentDb =>
  fullCombatDb(EFFECTS, {
    tags: EXTRA_TAGS,
    skills: Object.values(SKILLS),
    gauges: [GAUGE],
    jobs: [JOB],
  });

type Path = readonly (string | number)[];
/** JSONの中の場所の値を変える（最後の要素が "+" なら配列に足す）。 */
function setAt(root: unknown, path: Path, value: unknown): void {
  let node = root as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) node = node[key] as Record<string | number, unknown>;
  const last = path[path.length - 1] ?? "";
  if (last === "+") (node as unknown as unknown[]).push(value);
  else node[last] = value;
}

/** データを1か所だけ変えて読み、誤りのコードを集める。 */
function loadErrors(path: Path, value: unknown): string[] {
  const parts = {
    skills: structuredClone(Object.values(SKILLS)) as unknown[],
    jobs: [structuredClone(JOB)] as unknown[],
    gauges: [structuredClone(GAUGE)] as unknown[],
  };
  setAt(parts, path, value);
  try {
    fullCombatDb(EFFECTS, { tags: EXTRA_TAGS, ...parts });
    return [];
  } catch (e) {
    return [...String(e).matchAll(/\[([a-z-]+)\]/g)].map((m) => m[1] ?? "");
  }
}

const skill = (d: ContentDb, id: string) => {
  const s = d.skills.get(id);
  if (s === undefined) throw new Error(id);
  return s;
};
const gaugeDef = (): GaugeDef => {
  const g = db().gauges.get("GAU-T");
  if (g === undefined) throw new Error("GAU-T");
  return g;
};
const job = (d: ContentDb): JobDef => {
  const j = d.jobs.get("JOB-T");
  if (j === undefined) throw new Error("JOB-T");
  return j;
};

describe("技・職能ゲージ・ジョブのデータの検証", () => {
  it("正しいデータは読める", () => {
    const d = db();
    expect(d.skills.size).toBe(6);
    expect(d.gauges.get("GAU-T")?.max).toBe(100);
    expect(job(d).skills).toHaveLength(6);
  });

  it("職能ゲージにない段階の変化は誤り", () => {
    expect(loadErrors(["skills", 0, "stageVariants", 0, "stage"], "nope")).toEqual(["unknown-ref"]);
  });

  it("登録されていないフック・足りないパラメータは誤り", () => {
    const at = ["skills", 0, "weaponVariants", 2, "mods", "behaviors"];
    expect(loadErrors(at, [{ hook: "nope" }])).toEqual(["unknown-hook"]);
    expect(loadErrors(at, [{ hook: "shockwave", params: { ratio: 0.5 } }])).toEqual([
      "schema",
      "schema",
    ]);
  });

  it("武器による変化のタグは武器・武器の系統、適性のタグは武器", () => {
    expect(loadErrors(["skills", 0, "weaponVariants", 0, "weaponTag"], "TAG-FORM-MELEE")).toEqual([
      "schema",
    ]);
    expect(loadErrors(["jobs", 0, "affinity", "TAG-WPNGRP-AXE"], "S")).toEqual(["schema"]);
  });

  it("参照の誤り：ない技・ない効果・別のジョブの技・ゲージの最大を超える段階", () => {
    expect(loadErrors(["jobs", 0, "skills", "+"], { skill: "SKL-NOPE", level: 1 })).toEqual([
      "unknown-ref",
    ]);
    expect(loadErrors(["skills", 5, "selfEffects", 0, "effect"], "EFF-NOPE")).toEqual([
      "unknown-ref",
    ]);
    expect(loadErrors(["skills", 0, "job"], "JOB-OTHER")).toEqual(["schema", "unknown-ref"]);
    expect(loadErrors(["gauges", 0, "stages", 1, "min"], 120)).toEqual(["schema"]);
  });

  it("呪文には基礎値が必要", () => {
    expect(loadErrors(["skills", 0, "kind"], "spell")).toEqual(["schema"]);
  });
});

describe("職能ゲージ（仕様書5.2 闘志）", () => {
  it("ヒットで+2、重撃は+6。攻撃を受けると最大HPの1%につき+1。最大は100", () => {
    const g = new JobGauge(gaugeDef());
    expect(g.onHitDealt(new Set(["TAG-FORM-MELEE"]))).toBe(2);
    expect(g.onHitDealt(new Set(["TAG-FORM-HEAVY"]))).toBe(6);
    expect(g.onDamageTaken(30, 300)).toBeCloseTo(10);
    expect(g.value).toBeCloseTo(18);
    g.add(500);
    expect(g.value).toBe(100);
  });

  it("50以上で激化、100で解放（T7）", () => {
    const g = new JobGauge(gaugeDef());
    g.add(49);
    expect(g.stages).toEqual([]);
    g.add(1);
    expect(g.stages).toEqual(["empowered"]);
    g.add(50);
    expect(g.stages).toEqual(["empowered", "release"]);
    expect(g.spend("all")).toBe(true);
    expect(g.value).toBe(0);
  });

  it("5秒間攻撃も被弾もなければ、毎秒5ずつ減る。下限があればそこで止まる", () => {
    const g = new JobGauge(gaugeDef());
    g.onHitDealt(new Set());
    g.add(38); // 40
    for (let i = 0; i < 5 * 60; i++) g.update(FIXED_STEP_SECONDS);
    expect(g.value).toBeCloseTo(40);
    for (let i = 0; i < 2 * 60; i++) g.update(FIXED_STEP_SECONDS);
    expect(g.value).toBeCloseTo(30);
    g.floor = 30;
    for (let i = 0; i < 4 * 60; i++) g.update(FIXED_STEP_SECONDS);
    expect(g.value).toBeCloseTo(30);
    expect(g.spend(40)).toBe(false);
  });
});

describe("技の変化（武器・二刀流・激化）", () => {
  const d = db();
  const tags = new TagIndex(d.tags);
  const ctx = (weapon: string, stages: string[] = [], dualWield = false) => ({
    stages,
    weaponTags: tags.closure([weapon]),
    dualWield,
  });

  it("同じ技でも、武器で変わる（T6：大剣は範囲+20%、斧は出血の付与率+30%）", () => {
    const great = resolveSkill(d, skill(d, "SKL-T-SWEEP"), ctx("TAG-WPN-GREAT"));
    const axe = resolveSkill(d, skill(d, "SKL-T-SWEEP"), ctx("TAG-WPN-AXE"));
    expect(great.action).toEqual({ type: "strike", shape: sector(2.2 * 1.2, 120) });
    expect(great.ailmentChance).toEqual({});
    expect(axe.action).toEqual({ type: "strike", shape: sector(2.2, 120) });
    expect(axe.ailmentChance).toEqual({ "TAG-AIL-BLEED": 0.3 });
    expect(axe.variants).toEqual(["weapon:TAG-WPNGRP-AXE"]);
  });

  it("激化：180°・崩し値+30%", () => {
    const r = resolveSkill(d, skill(d, "SKL-T-SWEEP"), ctx("TAG-WPN-AXE", ["empowered"]));
    expect(r.action).toEqual({ type: "strike", shape: sector(2.2, 180) });
    expect(r.staggerCoefficient).toBeCloseTo(0.52);
  });

  it("二刀流の変化：毎秒6回・ダメージ70%", () => {
    const r = resolveSkill(d, skill(d, "SKL-T-SPIN"), ctx("TAG-WPN-AXE", [], true));
    expect(r.damage.pct).toBe(0.7);
    expect(r.action.type === "channel" && r.action.hitsPerSecond).toBe(6);
  });

  it("突進：武器で距離が伸び、激化で崩しのフックが付く", () => {
    const r = resolveSkill(d, skill(d, "SKL-T-DASH"), ctx("TAG-WPN-GREAT", ["empowered"]));
    expect(r.action.type === "dash" && r.action.distance).toBe(12);
    expect(r.behaviors.map((b) => b.hook)).toEqual(["fullStagger"]);
  });

  it("崩し係数を省略すると、崩しの定義の既定値", () => {
    const r = resolveSkill(d, skill(d, "SKL-T-DASH"), ctx("TAG-WPN-SWORD"));
    expect(r.staggerCoefficient).toBe(0.3);
  });
});

describe("武器適性・技を覚える時期・使えるか", () => {
  const d = db();
  const tags = new TagIndex(d.tags);
  it("表の適性。表にない武器はC、素手はA。サブジョブは1段階下げて、高い方", () => {
    const j = job(d);
    expect(weaponAffinity(tags, j, ["TAG-WPN-GREAT"])).toBe("S");
    expect(weaponAffinity(tags, j, ["TAG-WPN-SWORD"])).toBe("A");
    expect(weaponAffinity(tags, j, ["TAG-WPN-DAGGER"])).toBe("C");
    expect(weaponAffinity(tags, j, ["TAG-WPN-UNARMED"])).toBe("A");
    const sub: JobDef = { ...j, affinity: { "TAG-WPN-DAGGER": "S" } };
    expect(weaponAffinity(tags, j, ["TAG-WPN-DAGGER"], sub)).toBe("A");
    expect(lowerAffinity("C")).toBe("C");
    expect(AFFINITY_ATTACK_SPEED).toEqual({ S: 0.1, A: 0, B: -0.05, C: -0.1 });
    expect(dualWieldAffinity(j)).toBe("B");
    const noDual: JobDef = { id: j.id, tag: j.tag, text: j.text, skills: j.skills, affinity: {} };
    expect(dualWieldAffinity(noDual)).toBeUndefined();
    expect(dualWieldAffinity(noDual, j)).toBe("C");
  });

  it("ジョブLvで技を覚える（補助仕様書3.5）", () => {
    expect(unlockedSkills(job(d), 1)).toEqual(["SKL-T-SWEEP"]);
    expect(unlockedSkills(job(d), 7)).toHaveLength(4);
    expect(unlockedSkills(job(d), 12)).toHaveLength(6);
  });

  it("使えない理由：適性・CD・MP・ゲージ", () => {
    const base = { cooldown: 0, mp: 60, gauge: 100, affinity: "A" as const };
    const final = skill(d, "SKL-T-FINAL");
    expect(skillBlock(final, base)).toBeUndefined();
    expect(skillBlock(final, { ...base, affinity: "C" })).toBe("affinity");
    expect(skillBlock(final, { ...base, gauge: 99 })).toBe("gauge");
    expect(skillBlock(final, { ...base, gauge: undefined })).toBe("gauge");
    expect(skillBlock(skill(d, "SKL-T-DASH"), { ...base, mp: 7 })).toBe("mp");
    expect(skillBlock(skill(d, "SKL-T-DASH"), { ...base, cooldown: 1 })).toBe("cooldown");
  });

  it("CDは時間で減る", () => {
    const cd = new Cooldowns();
    cd.start("A", 1);
    for (let i = 0; i < 30; i++) cd.update(FIXED_STEP_SECONDS);
    expect(cd.remaining("A")).toBeCloseTo(0.5);
    for (let i = 0; i < 30; i++) cd.update(FIXED_STEP_SECONDS);
    expect(cd.remaining("A")).toBe(0);
  });
});

describe("技の実行", () => {
  const d = db();
  const tags = new TagIndex(d.tags);
  const resolve = (id: string, weapon: string, stages: string[] = []): ResolvedSkill =>
    resolveSkill(d, skill(d, id), { stages, weaponTags: tags.closure([weapon]) });
  const run = (
    exec: SkillExecution,
    seconds: number,
    input: { held?: boolean; mp?: number } = {},
  ) => {
    const strikes: Strike[] = [];
    const zones: LingeringZone[] = [];
    let mp = input.mp ?? 100;
    let moved = 0;
    let steps = 0;
    for (let i = 0; i < Math.round(seconds * 60) && !exec.finished; i++) {
      const t = exec.update(FIXED_STEP_SECONDS, {
        position: { x: 0, y: 0 },
        held: input.held ?? true,
        mp,
      });
      strikes.push(...t.strikes);
      zones.push(...t.zones);
      mp -= t.mpCost;
      moved += Math.hypot(t.displacement.x, t.displacement.y);
      steps += 1;
    }
    return { strikes, zones, mp, moved, steps };
  };

  it("当たり判定を1回出す技：動作の30%の時点で1回だけ", () => {
    const exec = new SkillExecution(resolve("SKL-T-SWEEP", "TAG-WPN-AXE"), 0, 1);
    const r = run(exec, 2);
    expect(r.strikes).toHaveLength(1);
    expect(r.steps).toBe(60);
  });

  it("剣の薙ぎ払いは衝撃波（技倍率の50%）も出す", () => {
    const r = run(new SkillExecution(resolve("SKL-T-SWEEP", "TAG-WPN-SWORD"), 0, 1), 2);
    expect(r.strikes.map((s) => s.damage.pct)).toEqual([1.3, 0.65]);
    expect(r.strikes[1]?.shape).toEqual({ type: "line", length: 4, width: 1 });
  });

  it("突進：0.4秒で8m進み、通り道の当たり判定は同じ group", () => {
    const r = run(
      new SkillExecution(resolve("SKL-T-DASH", "TAG-WPN-SWORD", ["empowered"]), 0, 1),
      1,
    );
    expect(r.moved).toBeCloseTo(8);
    expect(r.steps).toBe(24);
    expect(new Set(r.strikes.map((s) => s.group))).toEqual(new Set(["dash"]));
    expect(r.strikes.every((s) => s.fullStagger)).toBe(true);
  });

  it("旋風：1秒で4回当たり、0.25秒ごとにMP3（始めた瞬間を含む）", () => {
    const r = run(new SkillExecution(resolve("SKL-T-SPIN", "TAG-WPN-SWORD"), 0, 1), 1);
    expect(r.strikes).toHaveLength(4);
    expect(r.mp).toBe(100 - 12);
  });

  it("旋風：離すか、MPが足りなくなると終わる", () => {
    const released = new SkillExecution(resolve("SKL-T-SPIN", "TAG-WPN-SWORD"), 0, 1);
    expect(run(released, 1, { held: false }).strikes).toHaveLength(0);
    expect(released.finished).toBe(true);
    const poor = new SkillExecution(resolve("SKL-T-SPIN", "TAG-WPN-SWORD"), 0, 1);
    const r = run(poor, 2, { mp: 7 });
    expect(r.mp).toBe(1);
    expect(poor.finished).toBe(true);
  });

  it("激化した旋風は吸い寄せる", () => {
    const exec = new SkillExecution(resolve("SKL-T-SPIN", "TAG-WPN-SWORD", ["empowered"]), 0, 1);
    const t = exec.update(FIXED_STEP_SECONDS, { position: { x: 0, y: 0 }, held: true, mp: 10 });
    expect(t.pull).toEqual({ origin: { x: 0, y: 0 }, radius: 4, speed: 2 });
    expect(t.moveMultiplier).toBe(0.8);
    expect(pullTowards({ x: 3, y: 0 }, { x: 0, y: 0 }, 1, 1)).toEqual({ x: 2, y: 0 });
    expect(pullTowards({ x: 1.2, y: 0 }, { x: 0, y: 0 }, 1, 1)).toEqual({ x: 1, y: 0 });
  });

  it("大槌の地割りは十字（同じ group）。激化で亀裂が残り、1秒ごとに技倍率の50%で再び当たる", () => {
    const r = run(
      new SkillExecution(resolve("SKL-T-SPLIT", "TAG-WPN-GREAT", ["empowered"]), 0, 1),
      2,
    );
    expect(r.strikes).toHaveLength(2);
    expect(r.strikes.map((s) => s.group)).toEqual(["main", "main"]);
    const cross = r.strikes[1];
    expect(cross?.facing).toBeCloseTo(Math.PI / 2);
    expect(cross?.origin.x).toBeCloseTo(3);
    expect(cross?.origin.y).toBeCloseTo(-2);
    expect(r.zones).toHaveLength(1);
    const zone = r.zones[0] as LingeringZone;
    const pulses: Strike[] = [];
    for (let i = 0; i < 180; i++) pulses.push(...zone.update(FIXED_STEP_SECONDS));
    expect(pulses.map((p) => p.group)).toEqual(["pulse1", "pulse1", "pulse2", "pulse2"]);
    expect(pulses[0]?.damage.pct).toBeCloseTo(1.1);
    expect(zone.done).toBe(true);
  });

  it("戦吼：当たり判定の時点で、範囲と効果を知らせる。激化で範囲×1.5", () => {
    const exec = new SkillExecution(resolve("SKL-T-CRY", "TAG-WPN-SWORD", ["empowered"]), 0, 1);
    let radius = 0;
    for (let i = 0; i < 60; i++) {
      const t = exec.update(FIXED_STEP_SECONDS, { position: { x: 0, y: 0 }, held: true, mp: 0 });
      if (t.warcry !== undefined) radius = t.warcry.radius;
    }
    expect(radius).toBe(9);
  });
});

describe("一定時間の効果と、受ける側の倍率", () => {
  const d = db();
  const attacker = (): DamageAttacker => {
    const { view } = evaluateEffects(d, new TagIndex(d.tags), []);
    return {
      db: d,
      view,
      characterLevel: 1,
      weapon: {
        uid: "w",
        tags: ["TAG-WPN-SWORD"],
        base: { physical: { min: 10, max: 10 } },
        critChance: 0,
      },
    };
  };
  const target = () =>
    new Combatant(d, {
      id: "t",
      team: "enemy",
      position: { x: 1, y: 0 },
      radius: 0.5,
      maxHp: 1000,
      staggerProfile: staggerProfiles(d).enemy,
    });
  const hit = (t: Combatant, fullStagger = false) =>
    resolveHit({
      db: d,
      attacker: attacker(),
      attackerPosition: { x: 0, y: 0 },
      skill: { tags: ["TAG-FORM-MELEE"], kind: "weapon", pct: 1 },
      staggerCoefficient: 0.3,
      target: t,
      rng: Rng.fromSeed(1),
      roll: "average",
      fullStagger,
    });

  it("威圧：受ける崩し値+20%。受けるダメージ-20%", () => {
    const plain = hit(target());
    const t = target();
    t.statuses.add("EFF-T-INTIM", 8, "SKL-T-CRY");
    expect(hit(t).staggerValue).toBeCloseTo(plain.staggerValue * 1.2);
    const g = target();
    g.statuses.add("EFF-T-GUARD", 8, "SKL-T-FINAL");
    expect(hit(g).hit.total).toBeCloseTo(plain.hit.total * 0.8);
  });

  it("効果は時間で切れる。同じ効果は重ねず、長い方の時間にする", () => {
    const s = new TimedEffects();
    s.add("EFF-T-INTIM", 2, "x");
    s.add("EFF-T-INTIM", 1, "x");
    expect(s.active).toHaveLength(1);
    expect(s.remaining("EFF-T-INTIM")).toBe(2);
    const v = s.version;
    for (let i = 0; i < 120; i++) s.update(FIXED_STEP_SECONDS);
    expect(s.has("EFF-T-INTIM")).toBe(false);
    expect(s.version).toBe(v + 1);
  });

  it("激化した突進は、当てた敵を崩す", () => {
    const t = target();
    const r = hit(t, true);
    expect(r.staggerBroke).toBe(true);
    expect(t.stagger.broken).toBe(true);
  });

  it("戦吼の強化（攻撃+15%）は、効果の評価で与えるダメージを上げる", () => {
    const tags = new TagIndex(d.tags);
    const { view } = evaluateEffects(d, tags, [
      { effectId: "EFF-T-CRY", source: { kind: "buff", ref: "SKL-T-CRY" } },
    ]);
    expect(view.stat("STAT-DAMAGE", ["TAG-FORM-MELEE"]).increased).toBeCloseTo(0.15);
  });
});

/**
 * 時間を進める処理の検証（PR #11 のレビュー指摘 P2）。
 * ActionTimeline.update と同じく、経過時間は0以上の有限の数だけを受け付け、
 * NaN・負の数・無限大は状態を変える前に RangeError にする。
 */
describe("時間を進める処理は、0以上の有限の数だけを受け付ける", () => {
  const INVALID = [Infinity, -Infinity, NaN, -1, -FIXED_STEP_SECONDS, -Number.MIN_VALUE];
  const d = db();
  const tags = new TagIndex(d.tags);
  const resolve = (id: string, weapon: string, stages: string[] = []): ResolvedSkill =>
    resolveSkill(d, skill(d, id), { stages, weaponTags: tags.closure([weapon]) });
  const origin = { x: 0, y: 0 };
  /** 非公開の状態を読む（テスト専用。例外の前後で変わっていないことを確かめる）。 */
  const internal = (o: object, keys: readonly string[]): Record<string, unknown> => {
    const r = o as Record<string, unknown>;
    return Object.fromEntries(keys.map((k) => [k, r[k]]));
  };

  describe("JobGauge.update", () => {
    const gauge = (): JobGauge => {
      const g = new JobGauge(gaugeDef());
      g.add(40);
      g.markCombat();
      g.update(2); // 戦闘中（最後の攻撃から2秒）
      return g;
    };
    const state = (g: JobGauge) => ({
      value: g.value,
      inCombat: g.inCombat,
      stages: g.stages,
      ...internal(g, ["v", "idle"]),
    });

    it.each(INVALID)("%s は RangeError で、値・戦闘状態は変わらない", (dt) => {
      const g = gauge();
      const before = state(g);
      expect(() => {
        g.update(dt);
      }).toThrow(RangeError);
      expect(state(g)).toEqual(before);
      // その後も、例外がなかったときと同じに進む
      const twin = gauge();
      g.update(4);
      twin.update(4);
      expect(state(g)).toEqual(state(twin));
      expect(g.value).toBeCloseTo(35); // 5秒で戦闘外、その後1秒で-5
    });

    it("0は何も変えない。有限の数では従来どおり減る", () => {
      const g = gauge();
      const before = state(g);
      g.update(0);
      expect(state(g)).toEqual(before);
      g.update(2.9);
      expect(g.inCombat).toBe(true);
      expect(g.value).toBe(40);
      g.update(1.1);
      expect(g.inCombat).toBe(false);
      expect(g.value).toBeCloseTo(35);
    });
  });

  describe("TimedEffects.update", () => {
    const effects = (): TimedEffects => {
      const s = new TimedEffects();
      s.add("EFF-T-INTIM", 2, "a");
      s.add("EFF-T-GUARD", 8, "b");
      return s;
    };
    const state = (s: TimedEffects) => ({
      version: s.version,
      active: s.active.map((e) => ({ ...e })),
    });

    it.each(INVALID)("%s は RangeError で、残りの時間・効果の一覧は変わらない", (dt) => {
      const s = effects();
      const before = state(s);
      expect(() => {
        s.update(dt);
      }).toThrow(RangeError);
      expect(state(s)).toEqual(before);
      expect(s.has("EFF-T-INTIM")).toBe(true);
      expect(s.remaining("EFF-T-GUARD")).toBe(8);
    });

    it("0は何も変えない。有限の数では従来どおり減り、切れたものだけ取り除く", () => {
      const s = effects();
      const before = state(s);
      s.update(0);
      expect(state(s)).toEqual(before);
      s.update(2);
      expect(s.has("EFF-T-INTIM")).toBe(false);
      expect(s.remaining("EFF-T-GUARD")).toBe(6);
      expect(s.version).toBe(before.version + 1);
    });
  });

  describe("Cooldowns.update", () => {
    it.each(INVALID)("%s は RangeError で、残りの時間は変わらない", (dt) => {
      const cd = new Cooldowns();
      cd.start("A", 1);
      cd.start("B", 3);
      expect(() => {
        cd.update(dt);
      }).toThrow(RangeError);
      expect(cd.remaining("A")).toBe(1);
      expect(cd.remaining("B")).toBe(3);
    });

    it("0は何も変えない。有限の数では従来どおり減る", () => {
      const cd = new Cooldowns();
      cd.start("A", 1);
      cd.update(0);
      expect(cd.remaining("A")).toBe(1);
      cd.update(0.25);
      expect(cd.remaining("A")).toBeCloseTo(0.75);
      cd.update(1);
      expect(cd.remaining("A")).toBe(0);
    });
  });

  describe("SkillExecution.update", () => {
    const KEYS = ["elapsed", "hitTimer", "mpTimer", "finishedFlag"];
    const state = (e: SkillExecution) => ({
      finished: e.finished,
      activePhase: e.activePhase,
      ...internal(e, KEYS),
      timeline:
        (e as unknown as { timeline?: object }).timeline === undefined
          ? undefined
          : internal((e as unknown as { timeline: object }).timeline, [
              "elapsed",
              "activeFired",
              "finishedFired",
            ]),
    });
    const tick = (e: SkillExecution, dt: number, mp = 100, held = true) =>
      e.update(dt, { position: origin, held, mp });
    const summary = (t: ReturnType<SkillExecution["update"]>) => ({
      strikes: t.strikes.length,
      displacement: t.displacement,
      mpCost: t.mpCost,
      zones: t.zones.length,
      finished: t.finished,
      warcry: t.warcry !== undefined,
    });
    const CASES: [string, () => SkillExecution][] = [
      [
        "当たり判定（strike）",
        () => new SkillExecution(resolve("SKL-T-SWEEP", "TAG-WPN-SWORD"), 0, 1),
      ],
      ["戦吼（warcry）", () => new SkillExecution(resolve("SKL-T-CRY", "TAG-WPN-SWORD"), 0, 1)],
      ["突進（dash）", () => new SkillExecution(resolve("SKL-T-DASH", "TAG-WPN-SWORD"), 0, 1)],
      ["旋風（channel）", () => new SkillExecution(resolve("SKL-T-SPIN", "TAG-WPN-SWORD"), 0, 1)],
    ];

    describe.each(CASES)("%s", (_name, make) => {
      it.each(INVALID)("%s は RangeError で、実行の状態は変わらない（始める前・途中）", (dt) => {
        for (const warmup of [0, 6]) {
          const e = make();
          const twin = make();
          for (let i = 0; i < warmup; i++) {
            tick(e, FIXED_STEP_SECONDS);
            tick(twin, FIXED_STEP_SECONDS);
          }
          const before = state(e);
          expect(() => tick(e, dt)).toThrow(RangeError);
          expect(state(e)).toEqual(before);
          // その後も、例外がなかったときと同じに進む
          for (let i = 0; i < 90; i++) {
            expect(summary(tick(e, FIXED_STEP_SECONDS))).toEqual(
              summary(tick(twin, FIXED_STEP_SECONDS)),
            );
          }
          expect(state(e)).toEqual(state(twin));
        }
      });

      it.each(INVALID)("%s は、終わった後でも RangeError", (dt) => {
        const e = make();
        tick(e, FIXED_STEP_SECONDS, 100, false);
        for (let i = 0; i < 120 && !e.finished; i++) tick(e, FIXED_STEP_SECONDS);
        if (!e.finished) tick(e, FIXED_STEP_SECONDS, 100, false);
        expect(e.finished).toBe(true);
        const before = state(e);
        expect(() => tick(e, dt)).toThrow(RangeError);
        expect(state(e)).toEqual(before);
      });

      it("0は時間を進めず（旋風は始めた瞬間の分だけ払う）、合計は従来どおり", () => {
        const total = (ticks: ReturnType<SkillExecution["update"]>[]) => ({
          strikes: ticks.reduce((n, t) => n + t.strikes.length, 0),
          mpCost: ticks.reduce((n, t) => n + t.mpCost, 0),
          moved: ticks.reduce((n, t) => n + Math.hypot(t.displacement.x, t.displacement.y), 0),
          warcries: ticks.filter((t) => t.warcry !== undefined).length,
          finishedAt: ticks.findIndex((t) => t.finished),
        });
        const e = make();
        const twin = make();
        const zero = tick(e, 0);
        expect(zero.finished).toBe(false);
        expect(Math.hypot(zero.displacement.x, zero.displacement.y)).toBe(0);
        const a = [zero];
        const b = [];
        for (let i = 0; i < 90; i++) {
          a.push(tick(e, FIXED_STEP_SECONDS));
          b.push(tick(twin, FIXED_STEP_SECONDS));
        }
        const ta = total(a);
        const tb = total(b);
        expect({ ...ta, moved: undefined, finishedAt: undefined }).toEqual({
          ...tb,
          moved: undefined,
          finishedAt: undefined,
        });
        expect(ta.moved).toBeCloseTo(tb.moved);
        // 0の1回の分だけ、終わる刻みの番号が1つずれる
        expect(ta.finishedAt).toBe(tb.finishedAt === -1 ? -1 : tb.finishedAt + 1);
      });
    });

    it("離した瞬間でも、不正な経過時間は終わらせずに RangeError", () => {
      const e = new SkillExecution(resolve("SKL-T-SPIN", "TAG-WPN-SWORD"), 0, 1);
      const before = state(e);
      expect(() => tick(e, NaN, 100, false)).toThrow(RangeError);
      expect(state(e)).toEqual(before);
      expect(e.finished).toBe(false);
    });

    it("突進は、大きな有限の経過時間でも決まった距離だけ進んで終わる", () => {
      const e = new SkillExecution(resolve("SKL-T-DASH", "TAG-WPN-SWORD"), 0, 1);
      const t = tick(e, 10);
      expect(Math.hypot(t.displacement.x, t.displacement.y)).toBeCloseTo(8);
      expect(t.finished).toBe(true);
    });
  });

  describe("LingeringZone.update", () => {
    const zone = (): LingeringZone => {
      const exec = new SkillExecution(resolve("SKL-T-SPLIT", "TAG-WPN-GREAT", ["empowered"]), 0, 1);
      for (let i = 0; i < 120; i++) {
        const t = exec.update(FIXED_STEP_SECONDS, { position: origin, held: true, mp: 100 });
        const z = t.zones[0];
        if (z !== undefined) return z;
      }
      throw new Error("亀裂が出ない");
    };
    const state = (z: LingeringZone) => ({
      done: z.done,
      remaining: z.remaining,
      ...internal(z, ["elapsed", "fired"]),
    });

    it.each(INVALID)("%s は RangeError で、経過時間・発動回数は変わらない", (dt) => {
      for (const warmup of [0, 70]) {
        const z = zone();
        const twin = zone();
        for (let i = 0; i < warmup; i++) {
          z.update(FIXED_STEP_SECONDS);
          twin.update(FIXED_STEP_SECONDS);
        }
        const before = state(z);
        expect(() => z.update(dt)).toThrow(RangeError);
        expect(state(z)).toEqual(before);
        const pulses: string[] = [];
        const twinPulses: string[] = [];
        for (let i = 0; i < 180; i++) {
          pulses.push(...z.update(FIXED_STEP_SECONDS).map((s) => s.group ?? ""));
          twinPulses.push(...twin.update(FIXED_STEP_SECONDS).map((s) => s.group ?? ""));
        }
        expect(pulses).toEqual(twinPulses);
        expect(state(z)).toEqual(state(twin));
      }
    });

    it("0は何も変えない。有限の数では従来どおり1秒ごとに発動する", () => {
      const z = zone();
      const before = state(z);
      expect(z.update(0)).toEqual([]);
      expect(state(z)).toEqual(before);
      expect(z.update(1).map((s) => s.group)).toEqual(["pulse1", "pulse1"]);
      expect(z.update(1).map((s) => s.group)).toEqual(["pulse2", "pulse2"]);
      expect(z.done).toBe(true);
    });
  });
});
