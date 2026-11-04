import { describe, expect, it } from "vitest";
import {
  type AilmentApplication,
  type ContentDb,
  type DamageAttacker,
  type DamageSkill,
  type EffectInstance,
  AilmentState,
  Rng,
  StaggerGauge,
  TagIndex,
  ailmentCandidates,
  computeHit,
  countAilmentTypes,
  evaluateEffects,
  rollAilments,
  staggerProfiles,
  staggerValue,
} from "../src/index.ts";
import { buildDb, combatFixture, effect, tag } from "./helpers/content.ts";

const fx = combatFixture();
const AIL_TAGS = ["BURN", "CHILL", "FREEZE", "SHOCK", "POISON", "WEAKEN", "STIGMA", "STAGGER"].map(
  (c) => tag(`TAG-AIL-${c}`, "ailment"),
);
/** packages/content の data/ailments/ailments.json と同じ値。 */
const AILMENTS = [
  {
    id: "AIL-BURN",
    tag: "TAG-AIL-BURN",
    kind: "dot",
    sourceElements: ["fire"],
    dotElement: "fire",
    totalRatio: 0.5,
    duration: 4,
    stacking: { mode: "strongest" },
  },
  {
    id: "AIL-BLEED",
    tag: "TAG-AIL-BLEED",
    kind: "dot",
    sourceElements: ["physical"],
    dotElement: "physical",
    totalRatio: 1.5,
    duration: 5,
    stacking: { mode: "stack", maxStacks: 8 },
    movingMultiplier: 2,
  },
  {
    id: "AIL-POISON",
    tag: "TAG-AIL-POISON",
    kind: "dot",
    sourceElements: ["physical", "dark"],
    dotElement: "dark",
    totalRatio: 0.6,
    duration: 3,
    stacking: { mode: "stack" },
  },
  {
    id: "AIL-WEAKEN",
    tag: "TAG-AIL-WEAKEN",
    kind: "debuff",
    sourceElements: ["dark"],
    duration: 4,
    dealtMultiplier: 0.85,
    bossDealtMultiplier: 0.92,
  },
  {
    id: "AIL-STAGGER",
    tag: "TAG-AIL-STAGGER",
    kind: "stagger",
    defaultCoefficient: 0.3,
    enemy: {
      gaugeRatio: 0.2,
      decayDelay: 3,
      decayPerSecond: 0.1,
      breakDuration: 2,
      takenMultiplier: 1.25,
      growthPerBreak: 1,
    },
    boss: {
      gaugeRatio: 0.15,
      decayDelay: 3,
      decayPerSecond: 0.1,
      breakDuration: 1,
      takenMultiplier: 1.15,
      growthPerBreak: 1.5,
    },
    player: {
      gaugeRatio: 0.5,
      decayDelay: 2,
      decayPerSecond: 0.2,
      breakDuration: 0.6,
      takenMultiplier: 1,
      growthPerBreak: 1,
    },
  },
  { id: "AIL-CHILL", tag: "TAG-AIL-CHILL", kind: "pending", note: "MVPの範囲外" },
];
const STATS = [
  ...fx.stats,
  { id: "STAT-AILMENT-CHANCE", text: "s.ac", unit: "ratio", min: 0 },
  { id: "STAT-AILMENT-DAMAGE", text: "s.ad", unit: "ratio" },
  { id: "STAT-AILMENT-DURATION", text: "s.adu", unit: "seconds", min: 0 },
  { id: "STAT-AILMENT-MAX-STACKS", text: "s.ams", unit: "flat", min: 0 },
  { id: "STAT-STAGGER", text: "s.st", unit: "ratio" },
  { id: "STAT-STAGGER-RESIST", text: "s.str", unit: "ratio", min: 0, baseCap: 1 },
];
const EFFECTS = [
  effect("EFF-GENERIC-CHANCE", "affix", [
    { kind: "added", stat: "STAT-AILMENT-CHANCE", value: 0.25 },
  ]),
  effect("EFF-BLEED-CHANCE", "affix", [
    {
      kind: "added",
      stat: "STAT-AILMENT-CHANCE",
      value: 0.3,
      filter: { allOf: ["TAG-AIL-BLEED"] },
    },
  ]),
  effect("EFF-FORCE-BLEED", "unique", [
    {
      kind: "flag",
      flag: "ailmentApply",
      mode: "force",
      target: "TAG-AIL-BLEED",
      filter: { allOf: ["TAG-ELEM-PHYSICAL"] },
    },
  ]),
  effect("EFF-NO-BLEED", "keystone", [
    { kind: "flag", flag: "ailmentApply", mode: "forbid", target: "TAG-AIL-BLEED" },
  ]),
  effect("EFF-BLEED-STACKS", "unique", [
    {
      kind: "added",
      stat: "STAT-AILMENT-MAX-STACKS",
      value: 4,
      filter: { allOf: ["TAG-AIL-BLEED"] },
    },
  ]),
  effect("EFF-AIL-DMG", "minorStar", [
    {
      kind: "increased",
      stat: "STAT-AILMENT-DAMAGE",
      value: 0.5,
      filter: { allOf: ["TAG-AIL-BLEED"] },
    },
  ]),
  effect("EFF-AIL-MORE", "keystone", [{ kind: "more", stat: "STAT-AILMENT-DAMAGE", value: 1.5 }]),
  effect("EFF-BLEED-DUR", "minorStar", [
    {
      kind: "added",
      stat: "STAT-AILMENT-DURATION",
      value: 1,
      filter: { allOf: ["TAG-AIL-BLEED"] },
    },
  ]),
  effect("EFF-STAGGER-30", "minorStar", [{ kind: "increased", stat: "STAT-STAGGER", value: 0.3 }]),
  effect("EFF-SCYTHE-DARK", "implicit", [
    { kind: "convert", from: "physical", to: "dark", value: 0.5 },
  ]),
];

function setup(
  effects: string[],
  weaponBase = { min: 10, max: 10 },
): { db: ContentDb; attacker: DamageAttacker } {
  const db = buildDb({
    tags: [...fx.tags, ...AIL_TAGS],
    stats: STATS,
    effects: EFFECTS,
    ailments: AILMENTS,
  });
  const instances: EffectInstance[] = effects.map((id) => ({
    effectId: id,
    source: { kind: "test", ref: id },
  }));
  const { view } = evaluateEffects(db, new TagIndex(db.tags), instances);
  const attacker: DamageAttacker = {
    db,
    view,
    characterLevel: 1,
    weapon: {
      uid: "itm_w",
      tags: ["TAG-WPN-DAGGER"],
      base: { physical: weaponBase },
      critChance: 0,
    },
  };
  return { db, attacker };
}
const MELEE: DamageSkill = { tags: ["TAG-FORM-MELEE"], kind: "weapon", pct: 1.0 };
const FIRE_SPELL: DamageSkill = {
  tags: ["TAG-FORM-SPELL"],
  kind: "spell",
  pct: 1,
  base: { fire: { min: 10, max: 10 } },
};
const avg = { rng: Rng.fromSeed(1), roll: "average" as const };

function candidates(
  effects: string[],
  skill: DamageSkill = MELEE,
  skillChance?: Record<string, number>,
) {
  const { db, attacker } = setup(effects);
  const hit = computeHit(attacker, skill, {}, avg);
  const list = ailmentCandidates({
    db,
    view: attacker.view,
    hit,
    tags: skill.tags,
    ...(skillChance === undefined ? {} : { skillChance }),
    weaponUid: "itm_w",
  });
  return Object.fromEntries(list.map((c) => [c.application.tag, c]));
}

describe("付与率（開発計画書 T5・仕様書v0.2 2.7）", () => {
  it("技の基本付与率がなく、補正もなければ0%（武器・属性そのものには付与率がない）", () => {
    const c = candidates([]);
    expect(c["TAG-AIL-BLEED"]?.chance).toBe(0);
    expect(c["TAG-AIL-POISON"]?.chance).toBe(0);
  });

  it("その属性のダメージを持たないヒットは、その状態異常を付与できない（火のヒットで出血しない）", () => {
    const c = candidates(["EFF-GENERIC-CHANCE"], FIRE_SPELL);
    expect(c["TAG-AIL-BLEED"]).toBeUndefined();
    expect(c["TAG-AIL-BURN"]?.chance).toBeCloseTo(0.25);
  });

  it("汎用の付与率は、物理のヒットなら出血と毒の両方に足す。種類を指定した補正は、その種類だけ", () => {
    const c = candidates(["EFF-GENERIC-CHANCE", "EFF-BLEED-CHANCE"]);
    expect(c["TAG-AIL-BLEED"]?.chance).toBeCloseTo(0.55);
    expect(c["TAG-AIL-POISON"]?.chance).toBeCloseTo(0.25);
    expect(c["TAG-AIL-WEAKEN"]).toBeUndefined(); // 闇のダメージがない
  });

  it("技の基本付与率を足す。上限は100%", () => {
    expect(candidates([], MELEE, { "TAG-AIL-BLEED": 0.25 })["TAG-AIL-BLEED"]?.chance).toBeCloseTo(
      0.25,
    );
    expect(
      candidates(["EFF-BLEED-CHANCE"], MELEE, { "TAG-AIL-BLEED": 0.9 })["TAG-AIL-BLEED"]?.chance,
    ).toBe(1);
  });

  it("「必ず付与」は100%、「付与しない」は0%（禁止が勝つ）", () => {
    expect(candidates(["EFF-FORCE-BLEED"])["TAG-AIL-BLEED"]?.chance).toBe(1);
    expect(candidates(["EFF-FORCE-BLEED", "EFF-NO-BLEED"])["TAG-AIL-BLEED"]?.chance).toBe(0);
  });

  it("総量 ＝ 基準値 × 総量の割合 ×（1＋状態異常の加算）× 状態異常の乗算", () => {
    const c = candidates(["EFF-AIL-DMG", "EFF-AIL-MORE"]);
    expect(c["TAG-AIL-BLEED"]?.application.total).toBeCloseTo(10 * 1.5 * 1.5 * 1.5);
    expect(c["TAG-AIL-POISON"]?.application.total).toBeCloseTo(10 * 0.6 * 1.5); // 加算は出血だけ
  });

  it("毒の基準値は物理と闇の合計（変換で闇になった分も含む）", () => {
    const c = candidates(["EFF-SCYTHE-DARK"]);
    expect(c["TAG-AIL-POISON"]?.application.total).toBeCloseTo(10 * 0.6);
    expect(c["TAG-AIL-BLEED"]?.application.total).toBeCloseTo(5 * 1.5);
    expect(c["TAG-AIL-WEAKEN"]).toBeDefined();
  });

  it("持続と最大スタックの補正", () => {
    const c = candidates(["EFF-BLEED-DUR", "EFF-BLEED-STACKS"]);
    expect(c["TAG-AIL-BLEED"]?.application.duration).toBe(6);
    expect(c["TAG-AIL-BLEED"]?.application.maxStacks).toBe(12);
  });

  it("回避されたヒットは何も付与しない", () => {
    const { db, attacker } = setup(["EFF-FORCE-BLEED"]);
    const hit = { ...computeHit(attacker, MELEE, {}, avg), evaded: true };
    expect(
      rollAilments({ db, view: attacker.view, hit, tags: MELEE.tags, rng: Rng.fromSeed(1) }),
    ).toEqual([]);
  });

  it("確率の付与は、確率に近い割合で起きる", () => {
    const { db, attacker } = setup(["EFF-BLEED-CHANCE"]);
    const hit = computeHit(attacker, MELEE, {}, avg);
    const rng = Rng.fromSeed("roll");
    let bleeds = 0;
    for (let i = 0; i < 10000; i++) {
      if (
        rollAilments({ db, view: attacker.view, hit, tags: MELEE.tags, rng }).some(
          (a) => a.tag === "TAG-AIL-BLEED",
        )
      )
        bleeds++;
    }
    expect(bleeds / 10000).toBeGreaterThan(0.27);
    expect(bleeds / 10000).toBeLessThan(0.33);
  });
});

const app = (
  id: string,
  tagId: string,
  total: number,
  duration: number,
  maxStacks?: number,
): AilmentApplication => ({
  ailmentId: id,
  tag: tagId,
  total,
  duration,
  maxStacks,
});

describe("持続ダメージ（仕様書v0.2 2.7）", () => {
  const { db } = setup([]);

  it("出血は1スタックあたり総量を5秒で与える（総量150%）。敵が移動中は2倍", () => {
    const state = new AilmentState(db);
    state.apply(app("AIL-BLEED", "TAG-AIL-BLEED", 15, 5, 8));
    let sum = 0;
    for (let i = 0; i < 300; i++) sum += state.tick(1 / 60).physical ?? 0;
    expect(sum).toBeCloseTo(15);
    expect(state.stacks("AIL-BLEED")).toBe(0);

    const moving = new AilmentState(db);
    moving.apply(app("AIL-BLEED", "TAG-AIL-BLEED", 15, 5, 8));
    expect(moving.tick(5, { moving: true }).physical).toBeCloseTo(30);
  });

  it("出血は最大8スタック（千の小傷で12）。上限では残り時間の最も短いものと入れ替える", () => {
    const state = new AilmentState(db);
    for (let i = 0; i < 15; i++) {
      state.apply(app("AIL-BLEED", "TAG-AIL-BLEED", 1, 5, 8));
      state.tick(0.1);
    }
    expect(state.stacks("AIL-BLEED")).toBe(8);
    const more = new AilmentState(db);
    for (let i = 0; i < 15; i++) more.apply(app("AIL-BLEED", "TAG-AIL-BLEED", 1, 5, 12));
    expect(more.stacks("AIL-BLEED")).toBe(12);
  });

  it("毒は無制限に重なる", () => {
    const state = new AilmentState(db);
    for (let i = 0; i < 50; i++) state.apply(app("AIL-POISON", "TAG-AIL-POISON", 6, 3));
    expect(state.stacks("AIL-POISON")).toBe(50);
    expect(state.tick(3).dark).toBeCloseTo(300);
  });

  it("燃焼は重ならず、最も強いもの1つが残る", () => {
    const state = new AilmentState(db);
    state.apply(app("AIL-BURN", "TAG-AIL-BURN", 10, 4));
    state.apply(app("AIL-BURN", "TAG-AIL-BURN", 4, 4)); // 弱いので無視
    expect(state.stacks("AIL-BURN")).toBe(1);
    expect(state.remainingDotTotal()).toBeCloseTo(10);
    state.apply(app("AIL-BURN", "TAG-AIL-BURN", 20, 4)); // 強いので入れ替え
    expect(state.remainingDotTotal()).toBeCloseTo(20);
  });

  it("耐性は1回だけかけ、防具値はかけない。受けるダメージの倍率はかける", () => {
    const state = new AilmentState(db);
    state.apply(app("AIL-POISON", "TAG-AIL-POISON", 10, 3));
    expect(state.tick(3, { resist: { dark: 0.5 }, takenMultiplier: 1.25 }).dark).toBeCloseTo(
      10 * 0.5 * 1.25,
    );
  });

  it("衰弱：敵の与えるダメージ-15%（ボスは-8%）。重ならず、持続が新しくなる", () => {
    const state = new AilmentState(db);
    state.apply(app("AIL-WEAKEN", "TAG-AIL-WEAKEN", 0, 4));
    state.apply(app("AIL-WEAKEN", "TAG-AIL-WEAKEN", 0, 4));
    expect(state.dealtMultiplier(false)).toBeCloseTo(0.85);
    expect(state.dealtMultiplier(true)).toBeCloseTo(0.92);
    state.tick(3.9);
    state.apply(app("AIL-WEAKEN", "TAG-AIL-WEAKEN", 0, 4));
    state.tick(3.9);
    expect(state.dealtMultiplier(false)).toBeCloseTo(0.85);
    state.tick(0.2);
    expect(state.dealtMultiplier(false)).toBe(1);
  });

  it("千変のための、残りの持続ダメージの取り出し（60%を与えて消える）", () => {
    const state = new AilmentState(db);
    state.apply(app("AIL-BLEED", "TAG-AIL-BLEED", 10, 5, 8));
    state.apply(app("AIL-POISON", "TAG-AIL-POISON", 5, 3));
    state.tick(1);
    const remaining = state.remainingDotTotal();
    const burst = state.consumeDots(0.6);
    expect((burst.physical ?? 0) + (burst.dark ?? 0)).toBeCloseTo(remaining * 0.6);
    expect(state.remainingDotTotal()).toBe(0);
  });

  it("まだ実装していない状態異常は、付与できない（例外）", () => {
    const state = new AilmentState(db);
    expect(() => {
      state.apply(app("AIL-CHILL", "TAG-AIL-CHILL", 0, 2));
    }).toThrow();
  });
});

describe("状態異常の種類の数え方（仕様書v0.2 2.7・M-04）", () => {
  it("冷却と凍結は1種類、崩しは数えない", () => {
    expect(countAilmentTypes(["TAG-AIL-BLEED", "TAG-AIL-POISON", "TAG-AIL-WEAKEN"])).toBe(3);
    expect(countAilmentTypes(["TAG-AIL-CHILL", "TAG-AIL-FREEZE"])).toBe(1);
    expect(countAilmentTypes(["TAG-AIL-BLEED", "TAG-AIL-STAGGER"])).toBe(1);
  });

  it("受けている状態異常の種類の数", () => {
    const { db } = setup([]);
    const state = new AilmentState(db);
    state.apply(app("AIL-BLEED", "TAG-AIL-BLEED", 1, 5, 8));
    state.apply(app("AIL-BLEED", "TAG-AIL-BLEED", 1, 5, 8));
    state.apply(app("AIL-POISON", "TAG-AIL-POISON", 1, 3));
    expect(state.typeCount()).toBe(2);
    state.apply(app("AIL-WEAKEN", "TAG-AIL-WEAKEN", 0, 4));
    expect(state.typeCount()).toBe(3);
  });
});

describe("崩し（仕様書v0.2 2.7・補助仕様書3.3）", () => {
  const { db, attacker } = setup(["EFF-STAGGER-30"]);
  const profiles = staggerProfiles(db);

  it("崩し値 ＝ 打撃値（会心の後・防御の前）× 崩し係数 ×（1＋崩し値の補正）×（1－崩されにくさ）", () => {
    const hit = computeHit(attacker, MELEE, { armor: 1000, resist: { physical: 0.5 } }, avg);
    expect(hit.preMitigationTotal).toBeCloseTo(10);
    expect(staggerValue({ db, view: attacker.view, hit, tags: MELEE.tags })).toBeCloseTo(
      10 * 0.3 * 1.3,
    );
    expect(
      staggerValue({
        db,
        view: attacker.view,
        hit,
        tags: MELEE.tags,
        coefficient: 0.8,
        targetResist: 0.5,
      }),
    ).toBeCloseTo(10 * 0.8 * 1.3 * 0.5);
    expect(
      staggerValue({ db, view: attacker.view, hit, tags: MELEE.tags, targetImmune: true }),
    ).toBe(0);
  });

  it("敵：最大値は最大HPの0.2倍。満タンでダウン2秒・受けるダメージ×1.25。その後0に戻る", () => {
    const g = new StaggerGauge(profiles.enemy, 100);
    expect(g.max).toBeCloseTo(20);
    expect(g.add(19)).toBe(false);
    expect(g.add(1)).toBe(true);
    expect(g.broken).toBe(true);
    expect(g.takenMultiplier).toBe(1.25);
    expect(g.current).toBe(0);
    expect(g.add(50)).toBe(false); // 崩れている間は溜まらない
    g.update(2);
    expect(g.broken).toBe(false);
    expect(g.takenMultiplier).toBe(1);
  });

  it("崩しを受けない状態が3秒続くと、毎秒最大値の10%ずつ減る", () => {
    const g = new StaggerGauge(profiles.enemy, 100);
    g.add(10);
    g.update(3);
    expect(g.current).toBeCloseTo(10);
    g.update(1);
    expect(g.current).toBeCloseTo(8);
    g.update(10);
    expect(g.current).toBe(0);
  });

  it("ボス：最大HPの0.15倍・怯み1秒・×1.15。崩れるたびに最大値が1.5倍", () => {
    const g = new StaggerGauge(profiles.boss, 1000);
    expect(g.max).toBeCloseTo(150);
    g.add(150);
    expect(g.takenMultiplier).toBe(1.15);
    g.update(1);
    expect(g.broken).toBe(false);
    expect(g.max).toBeCloseTo(225);
  });

  it("プレイヤー：最大HPの0.5倍・よろめき0.6秒。2秒後から毎秒20%減る", () => {
    const g = new StaggerGauge(profiles.player, 100);
    expect(g.max).toBe(50);
    g.add(10);
    g.update(2);
    expect(g.current).toBe(10);
    g.update(0.5);
    expect(g.current).toBeCloseTo(5);
    expect(g.add(50)).toBe(true);
    g.update(0.6);
    expect(g.broken).toBe(false);
  });
});
