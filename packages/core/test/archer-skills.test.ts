import { describe, expect, it } from "vitest";
import {
  type ContentDb,
  FIXED_STEP_SECONDS,
  JobGauge,
  type ResolvedSkill,
  SkillExecution,
  TagIndex,
  resolveSkill,
} from "../src/index.ts";
import { fullCombatDb, tag } from "./helpers/content.ts";

const projectile = (extra: Record<string, unknown> = {}) => ({
  type: "projectile",
  count: 1,
  spreadDeg: 0,
  speed: 25,
  range: 18,
  radius: 0.15,
  pierce: 0,
  ...extra,
});
const skill = (id: string, extra: Record<string, unknown>) => ({
  id,
  text: `s.${id.toLowerCase()}`,
  tags: ["TAG-FORM-PROJECTILE"],
  kind: "weapon",
  pct: 1,
  mpCost: 0,
  cooldown: 0,
  action: projectile(),
  ...extra,
});
const SKILLS = [
  skill("SKL-BASIC", {
    tags: ["TAG-FORM-MELEE"],
    action: { type: "strike", shape: { type: "sector", radius: 1.6, angleDeg: 90 } },
    weaponVariants: [
      {
        weaponTag: "TAG-WPN-BOW",
        mods: { action: projectile(), tags: ["TAG-FORM-PROJECTILE"] },
      },
    ],
  }),
  skill("SKL-SPREAD", { pct: 0.6, action: projectile({ count: 5, spreadDeg: 40 }) }),
  skill("SKL-LEAP", { action: projectile({ leap: { distance: 6, duration: 0.3 } }) }),
  skill("SKL-RAIN", {
    pct: 0.5,
    action: { type: "barrage", range: 12, radius: 3, duration: 3, interval: 0.5 },
  }),
];
const GAUGES = [
  {
    id: "GAU-FOCUS",
    text: "g.focus",
    max: 100,
    gains: [
      { on: "stationary", perSecond: 20 },
      { on: "hitSameTarget", value: 5 },
      { on: "hitTaken", value: -20 },
    ],
    decayOutOfCombat: 0,
    stages: [],
  },
];

const db: ContentDb = fullCombatDb([], {
  tags: [tag("TAG-WPN-BOW", "weapon"), tag("TAG-FORM-PROJECTILE", "form")],
  skills: SKILLS,
  gauges: GAUGES,
});
const tags = new TagIndex(db.tags);
const resolve = (id: string, weapon = "TAG-WPN-BOW"): ResolvedSkill => {
  const def = db.skills.get(id);
  if (def === undefined) throw new Error(id);
  return resolveSkill(db, def, { stages: [], weaponTags: tags.closure([weapon]) });
};
const runAll = (exec: SkillExecution, seconds = 2) => {
  const ticks = [];
  for (let i = 0; i < seconds * 60 && !exec.finished; i++)
    ticks.push(exec.update(FIXED_STEP_SECONDS, { position: { x: 0, y: 0 }, held: true, mp: 100 }));
  return ticks;
};

describe("弓使いの技の仕組み（仕様書v0.2 5.7）", () => {
  it("通常攻撃は、弓系では投射物になり、タグも投射になる（武器による変化で動き方とタグを置き換える）", () => {
    const bow = resolve("SKL-BASIC");
    expect(bow.action.type).toBe("projectile");
    expect(bow.damage.tags).toEqual(["TAG-FORM-PROJECTILE"]);
    const sword = resolve("SKL-BASIC", "TAG-WPN-SWORD");
    expect(sword.action.type).toBe("strike");
    expect(sword.damage.tags).toEqual(["TAG-FORM-MELEE"]);
  });

  it("投射の技は、当たり判定が出始めたときに1回だけ放つ。散弾矢は扇状に5本", () => {
    const ticks = runAll(new SkillExecution(resolve("SKL-SPREAD"), 0, 1));
    const volleys = ticks.flatMap((t) => (t.volley === undefined ? [] : [t.volley]));
    expect(volleys).toHaveLength(1);
    const angles = volleys[0]?.angles ?? [];
    expect(angles).toHaveLength(5);
    expect(angles[0]).toBeCloseTo((-20 * Math.PI) / 180);
    expect(angles[2]).toBeCloseTo(0);
    expect(angles[4]).toBeCloseTo((20 * Math.PI) / 180);
  });

  it("跳躍後退：向きと反対へ6m跳びながら1射する", () => {
    const ticks = runAll(new SkillExecution(resolve("SKL-LEAP"), 0, 1));
    const moved = ticks.reduce((s, t) => s + t.displacement.x, 0);
    expect(moved).toBeCloseTo(-6);
    expect(ticks.filter((t) => t.volley !== undefined)).toHaveLength(1);
  });

  it("跳躍後退：攻撃速度が速く、動作が跳ぶ時間より短くても、跳び終えたら技を終える", () => {
    // 攻撃速度4なら動作は0.25秒で、跳ぶ時間（0.3秒）より短い
    const exec = new SkillExecution(resolve("SKL-LEAP"), 0, 4);
    const ticks = runAll(exec);
    expect(exec.finished).toBe(true);
    const moved = ticks.reduce((s, t) => s + t.displacement.x, 0);
    expect(moved).toBeCloseTo(-6);
    expect(ticks.filter((t) => t.volley !== undefined)).toHaveLength(1);
    expect(ticks.filter((t) => t.finished)).toHaveLength(1);
  });

  it("矢の雨：照準の位置（射程内）に、0.5秒ごとに3秒間（6回）当たり判定を出す", () => {
    const exec = new SkillExecution(resolve("SKL-RAIN"), 0, 1, { aimPoint: { x: 30, y: 0 } });
    const zones = runAll(exec).flatMap((t) => t.zones);
    expect(zones).toHaveLength(1);
    const zone = zones[0];
    if (zone === undefined) throw new Error("zone");
    expect(zone.parts[0]?.origin.x).toBeCloseTo(12);
    let strikes = 0;
    for (let i = 0; i < 4 * 60; i++) strikes += zone.update(FIXED_STEP_SECONDS).length;
    expect(strikes).toBe(6);
  });
});

describe("集中（弓使いの職能ゲージ。M-23 の仮値）", () => {
  const gaugeDef = db.gauges.get("GAU-FOCUS");
  if (gaugeDef === undefined) throw new Error("gauge");

  it("戦闘中、止まっている間は毎秒20増え、動いている間は増えない（疾風なら半分）", () => {
    const g = new JobGauge(gaugeDef);
    g.markCombat();
    g.onStill(1, false);
    expect(g.value).toBeCloseTo(20);
    g.onStill(1, true);
    expect(g.value).toBeCloseTo(20);
    g.movingStationaryMultiplier = 0.5;
    g.onStill(1, true);
    expect(g.value).toBeCloseTo(30);
  });

  it("戦闘外（5秒間、攻撃も被弾も無い）では、止まっていても増えない", () => {
    const g = new JobGauge(gaugeDef);
    g.onStill(1, false);
    expect(g.value).toBe(0);
    g.markCombat();
    g.update(5);
    g.onStill(1, false);
    expect(g.value).toBe(0);
  });

  it("同じ敵に当てるたび+5（最初の敵・違う敵では増えない）。攻撃を受けると-20", () => {
    const g = new JobGauge(gaugeDef);
    g.onHitTarget("a");
    expect(g.value).toBe(0);
    g.onHitTarget("a");
    g.onHitTarget("a");
    expect(g.value).toBe(10);
    g.onHitTarget("b");
    expect(g.value).toBe(10);
    g.onHitTaken();
    expect(g.value).toBe(0);
  });

  it("経過時間が不正なら RangeError（状態を変えない）", () => {
    const g = new JobGauge(gaugeDef);
    expect(() => g.onStill(Number.NaN, false)).toThrow(RangeError);
    expect(() => g.onStill(-1, false)).toThrow(RangeError);
    expect(g.value).toBe(0);
  });
});
