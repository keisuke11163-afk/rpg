import { describe, expect, it } from "vitest";
import {
  type AilmentApplication,
  type ContentDb,
  type DamageAttacker,
  type DamageSkill,
  type EffectInstance,
  AilmentState,
  EQUIPMENT_SOURCE_KIND,
  Rng,
  StaggerGauge,
  TagIndex,
  ailmentCandidates,
  computeHit,
  countAilmentTypes,
  evaluateEffects,
  resolveMaxStacks,
  rollAilments,
  staggerProfiles,
  staggerValue,
  validateAilmentApplication,
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
    // 武器の技のときだけ武器の uid を渡す（呪文のヒットに武器の uid を渡すと、局所の効果が漏れるので例外になる）
    ...(skill.kind === "weapon" ? { weaponUid: "itm_w" } : {}),
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
    expect(c["TAG-AIL-BLEED"]?.application.maxStacks).toBe(8); // 定義の値
    expect(c["TAG-AIL-BLEED"]?.application.extraStacks).toBe(4); // 千の小傷の補正
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
  extraStacks?: number,
): AilmentApplication => ({
  ailmentId: id,
  tag: tagId,
  total,
  duration,
  maxStacks,
  ...(extraStacks === undefined ? {} : { extraStacks }),
});
/** 出血の付与（定義の最大スタック8 ＋ 補正）。 */
const bleedApp = (total: number, duration: number, extraStacks?: number) =>
  app("AIL-BLEED", "TAG-AIL-BLEED", total, duration, 8, extraStacks);

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
    for (let i = 0; i < 15; i++) more.apply(bleedApp(1, 5, 4));
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

  it("最も早く切れる持続ダメージの残り時間（なければ Infinity。状態は変えない）", () => {
    const state = new AilmentState(db);
    expect(state.nextDotExpiry()).toBe(Infinity);
    state.apply(app("AIL-WEAKEN", "TAG-AIL-WEAKEN", 0, 0.5)); // 弱体化は持続ダメージではないので数えない
    expect(state.nextDotExpiry()).toBe(Infinity);
    state.apply(app("AIL-BLEED", "TAG-AIL-BLEED", 10, 5, 8));
    state.apply(app("AIL-POISON", "TAG-AIL-POISON", 5, 3));
    state.apply(app("AIL-BLEED", "TAG-AIL-BLEED", 10, 2, 8));
    expect(state.nextDotExpiry()).toBe(2);
    expect(state.nextDotExpiry()).toBe(2);
    expect(state.remainingDotTotal()).toBe(25);
    state.tick(1.5);
    expect(state.nextDotExpiry()).toBeCloseTo(0.5, 12);
    state.tick(0.5);
    expect(state.nextDotExpiry()).toBeCloseTo(1, 12);
    state.tick(1);
    expect(state.nextDotExpiry()).toBeCloseTo(2, 12);
    state.tick(2);
    expect(state.nextDotExpiry()).toBe(Infinity);
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

// ---------------------------------------------------------------------------
// PR #7 のレビュー指摘の回帰テスト
// ---------------------------------------------------------------------------

describe("局所の効果の出どころの判定（U-04a と同じ HitScope：種類と uid の両方）", () => {
  const local = { locality: "local" };
  const db = buildDb({
    tags: [...fx.tags, ...AIL_TAGS],
    stats: STATS,
    effects: [
      ...EFFECTS,
      effect(
        "EFF-LOCAL-CHANCE",
        "affix",
        [{ kind: "added", stat: "STAT-AILMENT-CHANCE", value: 0.4 }],
        local,
      ),
      effect(
        "EFF-LOCAL-AIL-MORE",
        "unique",
        [{ kind: "more", stat: "STAT-AILMENT-DAMAGE", value: 2 }],
        local,
      ),
      effect(
        "EFF-LOCAL-DUR",
        "affix",
        [{ kind: "added", stat: "STAT-AILMENT-DURATION", value: 2 }],
        local,
      ),
      effect(
        "EFF-LOCAL-STACKS",
        "unique",
        [
          {
            kind: "added",
            stat: "STAT-AILMENT-MAX-STACKS",
            value: 4,
            filter: { allOf: ["TAG-AIL-BLEED"] },
          },
        ],
        local,
      ),
      effect(
        "EFF-LOCAL-FORCE-BLEED",
        "unique",
        [{ kind: "flag", flag: "ailmentApply", mode: "force", target: "TAG-AIL-BLEED" }],
        local,
      ),
      effect(
        "EFF-LOCAL-STAGGER",
        "unique",
        [{ kind: "increased", stat: "STAT-STAGGER", value: 1 }],
        local,
      ),
    ],
    ailments: AILMENTS,
  });
  const WEAPON_A = {
    uid: "itm_a",
    tags: ["TAG-WPN-DAGGER"],
    base: { physical: { min: 10, max: 10 } },
    critChance: 0,
  };
  const WEAPON_B = { ...WEAPON_A, uid: "itm_b" };
  const PHYS_SPELL: DamageSkill = {
    tags: ["TAG-FORM-SPELL"],
    kind: "spell",
    pct: 1,
    base: { physical: { min: 10, max: 10 } },
  };
  const LOCAL_ALL = [
    "EFF-LOCAL-CHANCE",
    "EFF-LOCAL-AIL-MORE",
    "EFF-LOCAL-DUR",
    "EFF-LOCAL-STACKS",
    "EFF-LOCAL-STAGGER",
  ];
  const onA = (ids: string[], kind: string = EQUIPMENT_SOURCE_KIND): EffectInstance[] =>
    ids.map((id) => ({ effectId: id, source: { kind, ref: WEAPON_A.uid } }));

  /** 出血の候補と崩し値。weaponUid は「武器の技なら使った武器の uid、呪文なら省略」を既定にする。 */
  function evaluate(
    instances: EffectInstance[],
    weapon: typeof WEAPON_A,
    skill: DamageSkill,
    weaponUid: string | undefined = skill.kind === "weapon" ? weapon.uid : undefined,
  ) {
    const { view } = evaluateEffects(db, new TagIndex(db.tags), instances);
    const hit = computeHit({ db, view, characterLevel: 1, weapon }, skill, {}, avg);
    const opt = weaponUid === undefined ? {} : { weaponUid };
    const list = ailmentCandidates({ db, view, hit, tags: skill.tags, ...opt });
    const bleed = list.find((c) => c.application.tag === "TAG-AIL-BLEED");
    const stagger = staggerValue({ db, view, hit, tags: skill.tags, ...opt });
    return { bleed, stagger, view, hit };
  }

  it("武器Aの局所の効果は、武器Aのヒットに効く（付与率・総量・持続・最大スタック・崩し値）", () => {
    const { bleed, stagger } = evaluate(onA(LOCAL_ALL), WEAPON_A, MELEE);
    expect(bleed?.chance).toBeCloseTo(0.4);
    expect(bleed?.application.total).toBeCloseTo(10 * 1.5 * 2);
    expect(bleed?.application.duration).toBe(7);
    expect(bleed?.application.maxStacks).toBe(8);
    expect(bleed?.application.extraStacks).toBe(4);
    expect(stagger).toBeCloseTo(10 * 0.3 * 2);
    expect(evaluate(onA(["EFF-LOCAL-FORCE-BLEED"]), WEAPON_A, MELEE).bleed?.chance).toBe(1);
  });

  it("武器Aの局所の効果は、武器Bのヒットに効かない", () => {
    const { bleed, stagger } = evaluate(onA(LOCAL_ALL), WEAPON_B, MELEE);
    expect(bleed?.chance).toBe(0);
    expect(bleed?.application.total).toBeCloseTo(10 * 1.5);
    expect(bleed?.application.duration).toBe(5);
    expect(bleed?.application.maxStacks).toBe(8);
    expect(stagger).toBeCloseTo(10 * 0.3);
    expect(evaluate(onA(["EFF-LOCAL-FORCE-BLEED"]), WEAPON_B, MELEE).bleed?.chance).toBe(0);
  });

  it("武器Aの局所の効果は、武器Aを持っていても呪文のヒットに効かない", () => {
    const { bleed, stagger } = evaluate(onA(LOCAL_ALL), WEAPON_A, PHYS_SPELL);
    expect(bleed?.chance).toBe(0);
    expect(bleed?.application.total).toBeCloseTo(10 * 1.5);
    expect(bleed?.application.duration).toBe(5);
    expect(bleed?.application.maxStacks).toBe(8);
    expect(stagger).toBeCloseTo(10 * 0.3);
    expect(evaluate(onA(["EFF-LOCAL-FORCE-BLEED"]), WEAPON_A, PHYS_SPELL).bleed?.chance).toBe(0);
  });

  it("呪文のヒットに武器の uid を渡すと、局所の効果が漏れないように例外にする（別の武器の uid も同じ）", () => {
    expect(() => evaluate(onA(LOCAL_ALL), WEAPON_A, PHYS_SPELL, WEAPON_A.uid)).toThrow(
      /一致しない/,
    );
    expect(() => evaluate(onA(LOCAL_ALL), WEAPON_B, MELEE, WEAPON_A.uid)).toThrow(/一致しない/);
  });

  it("weaponUid を指定しなければ、武器のヒットでも局所の効果は効かない", () => {
    const { bleed, stagger } = evaluate(onA(LOCAL_ALL), WEAPON_A, MELEE, undefined);
    // 既定（武器の uid を渡す）を使わないよう、明示的に省略した呼び出しを確かめる
    const { view, hit } = evaluate(onA(LOCAL_ALL), WEAPON_A, MELEE);
    const omitted = ailmentCandidates({ db, view, hit, tags: MELEE.tags }).find(
      (c) => c.application.tag === "TAG-AIL-BLEED",
    );
    expect(omitted?.chance).toBe(0);
    expect(omitted?.application.total).toBeCloseTo(10 * 1.5);
    expect(staggerValue({ db, view, hit, tags: MELEE.tags })).toBeCloseTo(10 * 0.3);
    // evaluate の既定は武器の uid なので、こちらは効く（比較のため）
    expect(bleed?.chance).toBeCloseTo(0.4);
    expect(stagger).toBeCloseTo(10 * 0.3 * 2);
  });

  it("出どころの種類が装備でなければ、ref が武器Aの uid と同じでも効かない", () => {
    for (const kind of ["starNode", "jobNode", "buff", "test"]) {
      const { bleed, stagger } = evaluate(onA(LOCAL_ALL, kind), WEAPON_A, MELEE);
      expect(bleed?.chance).toBe(0);
      expect(bleed?.application.total).toBeCloseTo(10 * 1.5);
      expect(bleed?.application.maxStacks).toBe(8);
      expect(stagger).toBeCloseTo(10 * 0.3);
      expect(evaluate(onA(["EFF-LOCAL-FORCE-BLEED"], kind), WEAPON_A, MELEE).bleed?.chance).toBe(0);
    }
  });

  it("グローバルの効果は、出どころに関係なく、武器A・武器B・呪文のどれにも効く", () => {
    for (const kind of [EQUIPMENT_SOURCE_KIND, "starNode"]) {
      const globals = onA(["EFF-GENERIC-CHANCE", "EFF-AIL-MORE", "EFF-STAGGER-30"], kind);
      for (const [weapon, skill] of [
        [WEAPON_A, MELEE],
        [WEAPON_B, MELEE],
        [WEAPON_A, PHYS_SPELL],
      ] as const) {
        const { bleed, stagger } = evaluate(globals, weapon, skill);
        expect(bleed?.chance).toBeCloseTo(0.25);
        expect(bleed?.application.total).toBeCloseTo(10 * 1.5 * 1.5);
        expect(stagger).toBeCloseTo(10 * 0.3 * 1.3);
      }
    }
  });
});

describe("付与の入力の検証と最大スタック", () => {
  const { db } = setup([]);

  it("maxStacks = 0 は例外にする（無限ループにならない）", () => {
    const state = new AilmentState(db);
    expect(() => {
      state.apply(app("AIL-BLEED", "TAG-AIL-BLEED", 1, 5, 0));
    }).toThrow(RangeError);
    expect(state.stacks("AIL-BLEED")).toBe(0);
  });

  it("maxStacks の負の数・小数・Infinity・NaN・安全な整数の範囲外は例外にする", () => {
    for (const bad of [-1, 1.5, Infinity, -Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      const state = new AilmentState(db);
      state.apply(app("AIL-BLEED", "TAG-AIL-BLEED", 1, 5, 8));
      expect(() => {
        state.apply(app("AIL-BLEED", "TAG-AIL-BLEED", 1, 5, bad));
      }).toThrow(/最大スタック/);
      expect(state.stacks("AIL-BLEED")).toBe(1); // 状態は変わらない
    }
  });

  it("総量は有限かつ0以上、持続は有限かつ正の数でなければ例外にする（黙って補正しない）", () => {
    for (const total of [-1, NaN, Infinity, -Infinity])
      expect(() => {
        validateAilmentApplication(app("AIL-POISON", "TAG-AIL-POISON", total, 3));
      }).toThrow(/総量/);
    for (const duration of [0, -1, NaN, Infinity, -Infinity])
      expect(() => {
        new AilmentState(db).apply(app("AIL-POISON", "TAG-AIL-POISON", 1, duration));
      }).toThrow(/持続/);
    // 弱体化（衰弱）も同じ入口で検証する
    expect(() => {
      new AilmentState(db).apply(app("AIL-WEAKEN", "TAG-AIL-WEAKEN", 0, NaN));
    }).toThrow(/持続/);
    // 正常な値：総量0（弱体化）・maxStacks 省略・1は受け付ける
    expect(() => {
      validateAilmentApplication(app("AIL-WEAKEN", "TAG-AIL-WEAKEN", 0, 4));
      validateAilmentApplication(app("AIL-BLEED", "TAG-AIL-BLEED", 1, 5, 1));
    }).not.toThrow();
  });

  it("正常な上限では従来どおり：上限に達したら残り時間の最も短いものと入れ替える", () => {
    const state = new AilmentState(db);
    // 補正 -6 で上限 2
    state.apply(bleedApp(1, 5, -6)); // 残り 5 → 4
    state.tick(1);
    state.apply(bleedApp(2, 5, -6)); // 残り 5
    state.apply(bleedApp(4, 5, -6)); // 最も短い（総量1）と入れ替え
    expect(state.stacks("AIL-BLEED")).toBe(2);
    expect(state.remainingDotTotal()).toBeCloseTo(2 + 4);
    const one = new AilmentState(db);
    for (let i = 0; i < 5; i++) one.apply(bleedApp(1, 5, -7));
    expect(one.stacks("AIL-BLEED")).toBe(1);
  });

  it("上限が前の付与より小さくなったときは、古いものから取り除いて上限に収める（従来どおり）", () => {
    const state = new AilmentState(db);
    for (let i = 0; i < 12; i++) state.apply(bleedApp(1, 5, 4));
    state.apply(bleedApp(1, 5));
    expect(state.stacks("AIL-BLEED")).toBe(8);
  });
});

describe("非有限値（NaN・Infinity）とオーバーフローの検出", () => {
  const { db, attacker } = setup([]);
  const baseHit = computeHit(attacker, MELEE, {}, avg);
  const withBase = (ailmentBase: Record<string, number>) => ({ ...baseHit, ailmentBase });
  const cands = (hit: typeof baseHit, d: ContentDb = db) =>
    ailmentCandidates({ db: d, view: attacker.view, hit, tags: MELEE.tags, weaponUid: "itm_w" });

  it("属性の基準値の合計がオーバーフローすると例外（毒：物理＋闇）", () => {
    // 出血（物理だけ）の総量が先に溢れないよう、物理は 1e307 にして、闇との合計で溢れさせる
    const hit = withBase({ physical: 1e307, dark: Number.MAX_VALUE });
    expect(() => cands(hit)).toThrow(/基準値の合計/);
  });

  it("基準値が NaN・Infinity なら例外（「> 0」の比較で黙って捨てない）", () => {
    for (const bad of [NaN, Infinity, -Infinity])
      expect(() => cands(withBase({ physical: bad }))).toThrow(/基準値/);
  });

  it("状態異常の総ダメージがオーバーフローすると例外", () => {
    expect(() => cands(withBase({ physical: 1.5e308 }))).toThrow(/持続ダメージの総量/);
  });

  it("持続の計算がオーバーフローすると例外", () => {
    const longDb = buildDb({
      tags: [...fx.tags, ...AIL_TAGS],
      stats: STATS,
      effects: [
        effect("EFF-DUR-INC", "minorStar", [
          { kind: "increased", stat: "STAT-AILMENT-DURATION", value: 1 },
        ]),
      ],
      ailments: AILMENTS.map((a) => (a.id === "AIL-BLEED" ? { ...a, duration: 1e308 } : a)),
    });
    const { view } = evaluateEffects(longDb, new TagIndex(longDb.tags), [
      { effectId: "EFF-DUR-INC", source: { kind: "test", ref: "x" } },
    ]);
    expect(() => ailmentCandidates({ db: longDb, view, hit: baseHit, tags: MELEE.tags })).toThrow(
      /AIL-BLEED の持続/,
    );
  });

  it("技の基本付与率が NaN・Infinity なら、強制・禁止の印の有無にかかわらず例外", () => {
    const forced = setup(["EFF-FORCE-BLEED"]);
    for (const bad of [NaN, Infinity]) {
      expect(() =>
        ailmentCandidates({
          db,
          view: forced.attacker.view,
          hit: baseHit,
          tags: MELEE.tags,
          skillChance: { "TAG-AIL-BLEED": bad },
        }),
      ).toThrow(/付与率/);
    }
  });

  it("tick 中のダメージの計算がオーバーフローすると例外。状態は変えない", () => {
    const state = new AilmentState(db);
    state.apply(app("AIL-POISON", "TAG-AIL-POISON", 1e308, 5));
    expect(() => state.tick(5)).toThrow(/持続ダメージ/); // 総量 × 経過時間 が溢れる
    expect(state.remainingDotTotal()).toBe(1e308);
    expect(() => state.tick(1, { takenMultiplier: 1e10 })).toThrow(/受けるダメージ/);
    expect(state.remainingDotTotal()).toBe(1e308);
    // 同じ属性の合計が溢れる
    const two = new AilmentState(db);
    two.apply(app("AIL-POISON", "TAG-AIL-POISON", 1.5e308, 1));
    two.apply(app("AIL-POISON", "TAG-AIL-POISON", 1.5e308, 1));
    expect(() => two.tick(1)).toThrow(/合計/);
    expect(two.stacks("AIL-POISON")).toBe(2);
  });

  it("tick の経過時間・受ける側の値が不正なら例外", () => {
    const state = new AilmentState(db);
    state.apply(app("AIL-POISON", "TAG-AIL-POISON", 6, 3));
    for (const dt of [-1, NaN, Infinity]) expect(() => state.tick(dt)).toThrow(/経過時間/);
    expect(() => state.tick(1, { takenMultiplier: NaN })).toThrow(/倍率/);
    expect(() => state.tick(1, { resist: { dark: NaN } })).toThrow(/耐性/);
    expect(state.remainingDotTotal()).toBe(6);
  });

  it("consumeDots の割合が NaN・Infinity・負の数なら例外。持続ダメージは消さない", () => {
    const state = new AilmentState(db);
    state.apply(app("AIL-BLEED", "TAG-AIL-BLEED", 10, 5, 8));
    for (const ratio of [NaN, Infinity, -Infinity, -0.1])
      expect(() => state.consumeDots(ratio)).toThrow(/割合/);
    expect(state.remainingDotTotal()).toBe(10);
    const big = new AilmentState(db);
    big.apply(app("AIL-BLEED", "TAG-AIL-BLEED", 1e308, 5, 8));
    expect(() => big.consumeDots(10)).toThrow(/取り出す/);
    expect(big.remainingDotTotal()).toBe(1e308);
  });

  it("StaggerGauge：最大HP・設定・崩し値・経過時間が不正なら例外", () => {
    const { enemy } = staggerProfiles(db);
    for (const hp of [0, -1, NaN, Infinity]) expect(() => new StaggerGauge(enemy, hp)).toThrow();
    expect(() => new StaggerGauge({ ...enemy, gaugeRatio: NaN }, 100)).toThrow(/gaugeRatio/);
    expect(() => new StaggerGauge({ ...enemy, decayPerSecond: Infinity }, 100)).toThrow(
      /decayPerSecond/,
    );
    // 最大HP × 割合 が溢れる
    expect(() => new StaggerGauge({ ...enemy, gaugeRatio: 1e10 }, 1e300)).toThrow(/最大値/);
    const g = new StaggerGauge(enemy, 100);
    for (const bad of [NaN, Infinity, -Infinity, -1]) expect(() => g.add(bad)).toThrow(/崩し値/);
    for (const dt of [NaN, Infinity, -1])
      expect(() => {
        g.update(dt);
      }).toThrow(/経過時間/);
    expect(g.current).toBe(0);
    expect(g.add(0)).toBe(false);
  });

  it("StaggerGauge：崩れるたびの最大値の増加が溢れるなら、状態を変えずに例外", () => {
    const g = new StaggerGauge(
      {
        gaugeRatio: 1,
        decayDelay: 3,
        decayPerSecond: 0.1,
        breakDuration: 1,
        takenMultiplier: 1.15,
        growthPerBreak: 1e300,
      },
      1,
    );
    expect(g.add(1)).toBe(true); // 最大値 1 → 1e300
    g.update(1);
    expect(g.max).toBe(1e300);
    expect(() => g.add(1e300)).toThrow(/最大値/); // 次の最大値 1e600 が溢れる
    expect(g.breaks).toBe(1);
    expect(g.current).toBe(0);
  });

  it("staggerValue：崩されにくさ・打撃値の合計が NaN・Infinity なら例外", () => {
    expect(() =>
      staggerValue({ db, view: attacker.view, hit: baseHit, tags: MELEE.tags, targetResist: NaN }),
    ).toThrow(/崩されにくさ/);
    expect(() =>
      staggerValue({
        db,
        view: attacker.view,
        hit: { ...baseHit, preMitigationTotal: Infinity },
        tags: MELEE.tags,
      }),
    ).toThrow(/打撃値の合計/);
  });

  it("正常な値では、従来と同じ結果になる", () => {
    const c = cands(withBase({ physical: 10, dark: 4 }));
    const bleed = c.find((x) => x.application.tag === "TAG-AIL-BLEED")?.application;
    const poison = c.find((x) => x.application.tag === "TAG-AIL-POISON")?.application;
    expect(bleed).toEqual({
      ailmentId: "AIL-BLEED",
      tag: "TAG-AIL-BLEED",
      total: 10 * 1.5 * (1 + 0) * 1,
      duration: Math.max(0.1, (5 + 0) * (1 + 0)),
      maxStacks: 8,
      extraStacks: 0,
    });
    expect(poison?.total).toBe((10 + 4) * 0.6 * (1 + 0) * 1);
    const state = new AilmentState(db);
    state.apply(app("AIL-BLEED", "TAG-AIL-BLEED", 15, 5, 8));
    expect(state.tick(1, { takenMultiplier: 1.25, resist: { physical: 0.2 } }).physical).toBe(
      ((15 * 1) / 5) * 1 * 1.25 * (1 - 0.2),
    );
    expect(state.consumeDots(0.6).physical).toBe(12 * 0.6);
    const g = new StaggerGauge(staggerProfiles(db).enemy, 100);
    g.add(10);
    g.update(4);
    expect(g.current).toBe(Math.max(0, 10 - 100 * 0.2 * 0.1 * 1));
  });
});

describe("dealtMultiplier の非有限値（NaN・Infinity・オーバーフロー）", () => {
  const { db } = setup([]);
  const weaken = db.ailments.get("AIL-WEAKEN");
  if (weaken?.kind !== "debuff") throw new Error("衰弱の定義がない");
  /** スキーマを通らない不正な定義を、データの読み込みの後に差し込む（呼び出し側の防御の確認）。 */
  const withDebuffs = (...defs: (typeof weaken)[]): ContentDb => {
    const ailments = new Map(db.ailments);
    for (const d of defs) ailments.set(d.id, d);
    return { ...db, ailments };
  };
  const debuff = (id: string, dealt: number, boss: number): typeof weaken => ({
    ...weaken,
    id,
    dealtMultiplier: dealt,
    bossDealtMultiplier: boss,
  });
  const applyAll = (d: ContentDb, ids: string[]) => {
    const state = new AilmentState(d);
    for (const id of ids) state.apply(app(id, "TAG-AIL-WEAKEN", 0, 4));
    return state;
  };

  it("通常の倍率は従来どおり（衰弱なし 1・衰弱 0.85・ボス 0.92）", () => {
    const state = new AilmentState(db);
    expect(state.dealtMultiplier(false)).toBe(1);
    expect(state.dealtMultiplier(true)).toBe(1);
    state.apply(app("AIL-WEAKEN", "TAG-AIL-WEAKEN", 0, 4));
    expect(state.dealtMultiplier(false)).toBe(1 * 0.85);
    expect(state.dealtMultiplier(true)).toBe(1 * 0.92);
  });

  it("複数の倍率の積は有限で、従来と同じ値（通常・ボスの両方）", () => {
    const d = withDebuffs(debuff("AIL-TEST-A", 0.5, 0.75), debuff("AIL-TEST-B", 1e150, 1e150));
    const state = applyAll(d, ["AIL-WEAKEN", "AIL-TEST-A", "AIL-TEST-B"]);
    const normal = state.dealtMultiplier(false);
    const boss = state.dealtMultiplier(true);
    expect(Number.isFinite(normal)).toBe(true);
    expect(Number.isFinite(boss)).toBe(true);
    expect(normal).toBe(1 * 0.85 * 0.5 * 1e150);
    expect(boss).toBe(1 * 0.92 * 0.75 * 1e150);
  });

  it("入力の倍率が NaN なら例外（通常・ボスのそれぞれ）", () => {
    const normalBad = applyAll(withDebuffs(debuff("AIL-WEAKEN", NaN, 0.92)), ["AIL-WEAKEN"]);
    expect(() => normalBad.dealtMultiplier(false)).toThrow(RangeError);
    expect(() => normalBad.dealtMultiplier(false)).toThrow(/与えるダメージの倍率/);
    expect(normalBad.dealtMultiplier(true)).toBe(0.92); // ボスの倍率は正常
    const bossBad = applyAll(withDebuffs(debuff("AIL-WEAKEN", 0.85, NaN)), ["AIL-WEAKEN"]);
    expect(() => bossBad.dealtMultiplier(true)).toThrow(/与えるダメージの倍率（ボス）/);
    expect(bossBad.dealtMultiplier(false)).toBe(0.85);
  });

  it("入力の倍率が Infinity・-Infinity なら例外（通常・ボスのそれぞれ）", () => {
    for (const bad of [Infinity, -Infinity]) {
      const n = applyAll(withDebuffs(debuff("AIL-WEAKEN", bad, 0.92)), ["AIL-WEAKEN"]);
      expect(() => n.dealtMultiplier(false)).toThrow(/有限の値にならない/);
      const b = applyAll(withDebuffs(debuff("AIL-WEAKEN", 0.85, bad)), ["AIL-WEAKEN"]);
      expect(() => b.dealtMultiplier(true)).toThrow(/有限の値にならない/);
    }
  });

  it("有限の倍率どうしの積がオーバーフローしたら例外（0 などに丸めない。通常・ボスのそれぞれ）", () => {
    const d = withDebuffs(debuff("AIL-TEST-A", 1e200, 1), debuff("AIL-TEST-B", 1e200, 1));
    const state = applyAll(d, ["AIL-TEST-A", "AIL-TEST-B"]);
    expect(() => state.dealtMultiplier(false)).toThrow(/与えるダメージの倍率の積/);
    expect(state.dealtMultiplier(true)).toBe(1);
    const db2 = withDebuffs(debuff("AIL-TEST-A", 1, 1e200), debuff("AIL-TEST-B", 1, -1e200));
    const s2 = applyAll(db2, ["AIL-TEST-A", "AIL-TEST-B"]);
    expect(() => s2.dealtMultiplier(true)).toThrow(/与えるダメージの倍率の積（ボス）/); // -Infinity
    expect(s2.dealtMultiplier(false)).toBe(1);
  });
});

describe("AilmentState.apply の最大スタックと定義データの整合性", () => {
  const { db } = setup([]);
  const filled = (n: number) => {
    const state = new AilmentState(db);
    for (let i = 0; i < n; i++) state.apply(bleedApp(1 + i, 5));
    return state;
  };

  it("定義データどおりの最大スタック（出血 8）で付与でき、8 で止まる", () => {
    const state = filled(20);
    expect(state.stacks("AIL-BLEED")).toBe(8);
    const def = (id: string) => {
      const d = db.ailments.get(id);
      if (d === undefined) throw new Error(`${id} の定義がない`);
      return d;
    };
    expect(resolveMaxStacks(def("AIL-BLEED"), bleedApp(1, 5))).toBe(8);
    expect(resolveMaxStacks(def("AIL-BLEED"), bleedApp(1, 5, 4))).toBe(12);
    // 上限のない毒・重ならない燃焼・衰弱は、maxStacks を指定しない
    expect(
      resolveMaxStacks(def("AIL-POISON"), app("AIL-POISON", "TAG-AIL-POISON", 1, 3)),
    ).toBeUndefined();
  });

  it("定義に上限があるのに maxStacks 未指定なら、無制限にせず例外。状態は変えない", () => {
    const state = filled(8);
    expect(() => {
      state.apply(app("AIL-BLEED", "TAG-AIL-BLEED", 100, 5));
    }).toThrow(/未指定/);
    expect(state.stacks("AIL-BLEED")).toBe(8);
    expect(state.remainingDotTotal()).toBe(1 + 2 + 3 + 4 + 5 + 6 + 7 + 8);
  });

  it("定義データと異なる最大スタックは例外（大きい値・小さい値とも）。状態は変えない", () => {
    for (const other of [1, 7, 9, 12, 1000]) {
      const state = filled(3);
      expect(() => {
        state.apply(app("AIL-BLEED", "TAG-AIL-BLEED", 1, 5, other));
      }).toThrow(/定義（8）と一致しない/);
      expect(state.stacks("AIL-BLEED")).toBe(3);
    }
    // 定義に上限のない状態異常に最大スタック・補正を指定するのも例外
    for (const bad of [
      app("AIL-POISON", "TAG-AIL-POISON", 1, 3, 8),
      app("AIL-POISON", "TAG-AIL-POISON", 1, 3, undefined, 2),
      app("AIL-BURN", "TAG-AIL-BURN", 1, 4, 1),
      app("AIL-WEAKEN", "TAG-AIL-WEAKEN", 0, 4, 1),
    ]) {
      const state = new AilmentState(db);
      expect(() => {
        state.apply(bad);
      }).toThrow(/定義に上限がない/);
      expect(state.activeTags()).toEqual([]);
    }
    // 定義とタグが食い違うのも例外
    expect(() => {
      new AilmentState(db).apply(app("AIL-BLEED", "TAG-AIL-POISON", 1, 5, 8));
    }).toThrow(/タグ/);
  });

  it("最大スタック・補正の 0・負の数・小数・NaN・Infinity は例外。状態は変えない", () => {
    for (const bad of [0, -1, -8, 1.5, 8.5, NaN, Infinity, -Infinity]) {
      const state = filled(2);
      expect(() => {
        state.apply(app("AIL-BLEED", "TAG-AIL-BLEED", 1, 5, bad));
      }).toThrow(/最大スタック/);
      expect(state.stacks("AIL-BLEED")).toBe(2);
    }
    for (const bad of [0.5, -0.5, NaN, Infinity, -Infinity, -8, -9, Number.MAX_SAFE_INTEGER]) {
      const state = filled(2);
      expect(() => {
        state.apply(bleedApp(1, 5, bad));
      }).toThrow(/最大スタック/);
      expect(state.stacks("AIL-BLEED")).toBe(2);
      expect(state.remainingDotTotal()).toBe(1 + 2);
    }
  });

  it("上限に達したら従来どおり、残り時間の最も短いものと入れ替える（上限を超えない）", () => {
    const state = new AilmentState(db);
    for (let i = 0; i < 8; i++) {
      state.apply(bleedApp(1, 5));
      state.tick(0.1);
    }
    // 残り時間：最も古いものが 4.2 秒、最も新しいものが 4.9 秒。最も古いもの（残り 4.2/5）を入れ替える
    const before = state.remainingDotTotal();
    state.apply(bleedApp(100, 5));
    expect(state.stacks("AIL-BLEED")).toBe(8);
    expect(state.remainingDotTotal()).toBeCloseTo(before - 4.2 / 5 + 100);
    const exact = new AilmentState(db);
    for (let i = 0; i < 8; i++) exact.apply(bleedApp(1, 5));
    exact.apply(bleedApp(100, 5));
    expect(exact.stacks("AIL-BLEED")).toBe(8);
    expect(exact.remainingDotTotal()).toBe(7 + 100);
  });

  it("不正な付与の後も、既存の状態はそのまま使える", () => {
    const state = filled(8);
    for (const bad of [
      app("AIL-BLEED", "TAG-AIL-BLEED", 1, 5),
      app("AIL-BLEED", "TAG-AIL-BLEED", 1, 5, 12),
      bleedApp(1, 5, NaN),
      bleedApp(NaN, 5),
    ])
      expect(() => {
        state.apply(bad);
      }).toThrow(RangeError);
    expect(state.stacks("AIL-BLEED")).toBe(8);
    expect(state.tick(5).physical).toBeCloseTo(1 + 2 + 3 + 4 + 5 + 6 + 7 + 8);
    expect(state.stacks("AIL-BLEED")).toBe(0);
    state.apply(bleedApp(3, 5));
    expect(state.stacks("AIL-BLEED")).toBe(1);
  });
});
