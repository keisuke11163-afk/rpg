import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type EffectInstance, ModifierView, TagIndex, evaluateEffects } from "../src/index.ts";
import { buildDb, effect, stat, tag } from "./helpers/content.ts";

const TAGS = [
  tag("TAG-FORM-MELEE", "form"),
  tag("TAG-FORM-PROJECTILE", "form"),
  tag("TAG-ELEM-PHYSICAL", "element"),
  tag("TAG-ELEM-COLD", "element"),
  tag("TAG-AIL-BLEED", "ailment"),
  tag("TAG-AIL-POISON", "ailment"),
  tag("TAG-WPNGRP-SWORD", "weaponGroup"),
  tag("TAG-WPN-SWORD", "weapon", ["TAG-WPNGRP-SWORD"]),
  tag("TAG-WPN-GREATSWORD", "weapon", ["TAG-WPNGRP-SWORD"]),
  tag("TAG-WPN-DAGGER", "weapon"),
  tag("TAG-JOB-WARRIOR", "job"),
  tag("TAG-JOB-ROGUE", "job"),
];
const STATS = [
  stat("STAT-DAMAGE", { unit: "ratio" }),
  stat("STAT-RI"),
  stat("STAT-RESIST-FIRE", { unit: "ratio", baseCap: 0.75 }),
  stat("STAT-MOVE", { unit: "ratio", min: 0 }),
];
const src = (ref: string) => ({ kind: "test", ref });
const inst = (effectId: string, stacks?: number): EffectInstance => ({
  effectId,
  source: src(effectId),
  ...(stacks === undefined ? {} : { stacks }),
});

describe("タグの条件（開発計画書 T2）", () => {
  const db = buildDb({ tags: TAGS });
  const index = new TagIndex(db.tags);

  it("親タグを含めて照合する（大剣は剣系の条件に当てはまる）", () => {
    const ctx = index.closure(["TAG-WPN-GREATSWORD"]);
    expect(ctx.has("TAG-WPNGRP-SWORD")).toBe(true);
    expect(TagIndex.matches({ allOf: ["TAG-WPNGRP-SWORD"] }, ctx)).toBe(true);
    expect(
      TagIndex.matches({ allOf: ["TAG-WPNGRP-SWORD"] }, index.closure(["TAG-WPN-DAGGER"])),
    ).toBe(false);
  });

  it("allOf は全て、anyOf はどれか、noneOf はどれも含まない", () => {
    const ctx = index.closure(["TAG-FORM-PROJECTILE", "TAG-ELEM-COLD"]);
    expect(TagIndex.matches({ allOf: ["TAG-FORM-PROJECTILE", "TAG-ELEM-COLD"] }, ctx)).toBe(true);
    expect(TagIndex.matches({ allOf: ["TAG-FORM-PROJECTILE", "TAG-FORM-MELEE"] }, ctx)).toBe(false);
    expect(TagIndex.matches({ anyOf: ["TAG-FORM-MELEE", "TAG-ELEM-COLD"] }, ctx)).toBe(true);
    expect(TagIndex.matches({ anyOf: ["TAG-FORM-MELEE"] }, ctx)).toBe(false);
    expect(TagIndex.matches({ noneOf: ["TAG-FORM-MELEE"] }, ctx)).toBe(true);
    expect(TagIndex.matches({ noneOf: ["TAG-ELEM-COLD"] }, ctx)).toBe(false);
    expect(TagIndex.matches(undefined, ctx)).toBe(true);
  });

  it("仕様書1.5の記述例：[投射][氷] の条件は、投射で氷の技にだけ効く", () => {
    const filter = { allOf: ["TAG-FORM-PROJECTILE", "TAG-ELEM-COLD"] };
    expect(TagIndex.matches(filter, index.closure(["TAG-FORM-PROJECTILE", "TAG-ELEM-COLD"]))).toBe(
      true,
    );
    expect(
      TagIndex.matches(filter, index.closure(["TAG-FORM-PROJECTILE", "TAG-ELEM-PHYSICAL"])),
    ).toBe(false);
    expect(TagIndex.matches(filter, index.closure(["TAG-FORM-MELEE", "TAG-ELEM-COLD"]))).toBe(
      false,
    );
  });
});

describe("修正値の集計", () => {
  const db = buildDb({
    tags: TAGS,
    stats: STATS,
    effects: [
      effect("EFF-PHYS-30", "minorStar", [
        {
          kind: "increased",
          stat: "STAT-DAMAGE",
          value: 0.3,
          filter: { allOf: ["TAG-ELEM-PHYSICAL"] },
        },
      ]),
      effect("EFF-MELEE-20", "minorStar", [
        {
          kind: "increased",
          stat: "STAT-DAMAGE",
          value: 0.2,
          filter: { allOf: ["TAG-FORM-MELEE"] },
        },
      ]),
      effect("EFF-MORE-12", "unique", [{ kind: "more", stat: "STAT-DAMAGE", value: 1.2 }]),
      effect("EFF-MORE-15", "keystone", [{ kind: "more", stat: "STAT-DAMAGE", value: 1.5 }]),
      effect("EFF-ADD", "affix", [
        { kind: "added", stat: "STAT-DAMAGE", value: { min: 2, max: 6 } },
      ]),
      effect("EFF-FIXED", "unique", [{ kind: "fixedAdded", stat: "STAT-DAMAGE", value: 10 }]),
      effect("EFF-RESIST-CAP", "notableStar", [
        { kind: "cap", stat: "STAT-RESIST-FIRE", value: 0.05 },
      ]),
      effect("EFF-RESIST", "affix", [{ kind: "increased", stat: "STAT-RESIST-FIRE", value: 0 }]),
      effect("EFF-SLOW", "keystone", [{ kind: "increased", stat: "STAT-MOVE", value: -5 }]),
      effect("EFF-OVR-LOW", "unique", [
        { kind: "override", stat: "STAT-RI", value: 1, priority: 1 },
      ]),
      effect("EFF-OVR-HIGH", "keystone", [
        { kind: "override", stat: "STAT-RI", value: 2, priority: 9 },
      ]),
    ],
  });
  const index = new TagIndex(db.tags);

  it("加算％は種類が違っても足し合わせる（仕様書2.4の例：物理+30%・近接+20% → +50%）", () => {
    const { view } = evaluateEffects(db, index, [inst("EFF-PHYS-30"), inst("EFF-MELEE-20")]);
    expect(view.stat("STAT-DAMAGE", ["TAG-ELEM-PHYSICAL", "TAG-FORM-MELEE"]).increased).toBeCloseTo(
      0.5,
    );
    // 条件に当てはまらない修正値は入らない
    expect(view.stat("STAT-DAMAGE", ["TAG-ELEM-COLD", "TAG-FORM-MELEE"]).increased).toBeCloseTo(
      0.2,
    );
    expect(view.stat("STAT-DAMAGE").increased).toBe(0);
  });

  it("乗算は掛け合わせる", () => {
    const { view } = evaluateEffects(db, index, [inst("EFF-MORE-12"), inst("EFF-MORE-15")]);
    expect(view.stat("STAT-DAMAGE").more).toBeCloseTo(1.8);
  });

  it("重ねた数：加算・追加は値×数、乗算は値の数乗", () => {
    const { view } = evaluateEffects(db, index, [
      inst("EFF-PHYS-30", 3),
      inst("EFF-MORE-12", 2),
      inst("EFF-ADD", 2),
    ]);
    const r = view.stat("STAT-DAMAGE", ["TAG-ELEM-PHYSICAL"]);
    expect(r.increased).toBeCloseTo(0.9);
    expect(r.more).toBeCloseTo(1.44);
    expect(r.added).toEqual({ min: 4, max: 12 });
  });

  it("追加値（技倍率を受ける）と固定の追加（受けない）を分けて集計する（仕様書v0.2 2.4）", () => {
    const { view } = evaluateEffects(db, index, [inst("EFF-ADD"), inst("EFF-FIXED")]);
    const r = view.stat("STAT-DAMAGE");
    expect(r.added).toEqual({ min: 2, max: 6 });
    expect(r.fixedAdded).toEqual({ min: 10, max: 10 });
  });

  it("上限の初期値と、上限を変える修正値", () => {
    const base = { baseStats: { "STAT-RESIST-FIRE": 0.9 } };
    expect(
      evaluateEffects(db, index, [inst("EFF-RESIST")], base).view.stat("STAT-RESIST-FIRE").value,
    ).toBeCloseTo(0.75);
    const raised = evaluateEffects(db, index, [inst("EFF-RESIST-CAP")], base).view.stat(
      "STAT-RESIST-FIRE",
    );
    expect(raised.cap).toBeCloseTo(0.8);
    expect(raised.value).toBeCloseTo(0.8);
  });

  it("下限より下がらない", () => {
    const { view } = evaluateEffects(db, index, [inst("EFF-SLOW")], {
      baseStats: { "STAT-MOVE": 1 },
    });
    expect(view.stat("STAT-MOVE").value).toBe(0);
  });

  it("上書きは、優先度の高いものが勝つ（仕様書v0.2 2.4.1 の規則4）", () => {
    const { view } = evaluateEffects(db, index, [inst("EFF-OVR-LOW"), inst("EFF-OVR-HIGH")], {
      baseStats: { "STAT-RI": 50 },
    });
    const r = view.stat("STAT-RI");
    expect(r.value).toBe(2);
    expect(r.override?.effectId).toBe("EFF-OVR-HIGH");
  });

  it("修正値の内訳（どの出どころから、いくつ）を返す", () => {
    const { view } = evaluateEffects(db, index, [
      { effectId: "EFF-PHYS-30", source: { kind: "starNode", ref: "STAR-JIN-0001" } },
      { effectId: "EFF-MORE-12", source: { kind: "equipment", ref: "itm_000001" } },
    ]);
    const c = view.stat("STAT-DAMAGE", ["TAG-ELEM-PHYSICAL"]).contributions;
    expect(c).toEqual([
      {
        effectId: "EFF-MORE-12",
        origin: "unique",
        source: { kind: "equipment", ref: "itm_000001" },
        kind: "more",
        value: 1.2,
      },
      {
        effectId: "EFF-PHYS-30",
        origin: "minorStar",
        source: { kind: "starNode", ref: "STAR-JIN-0001" },
        kind: "increased",
        value: 0.3,
      },
    ]);
  });

  it("データにない効果・能力値を指定すると例外になる", () => {
    expect(() => evaluateEffects(db, index, [inst("EFF-NOPE")])).toThrow();
    expect(() => evaluateEffects(db, index, []).view.stat("STAT-NOPE")).toThrow();
    expect(() => evaluateEffects(db, index, [inst("EFF-ADD", -1)])).toThrow(RangeError);
  });
});

describe("効果の優先順位（開発計画書 T3・仕様書v0.2 2.4.1）", () => {
  const db = buildDb({
    tags: TAGS,
    stats: STATS,
    effects: [
      // 規則1：盲目の賢者の目隠し「会心しない」と、急所穿ち「5点なら必ず会心」
      effect("EFF-NO-CRIT", "unique", [{ kind: "flag", flag: "crit", mode: "forbid" }]),
      effect("EFF-FORCE-CRIT", "jobSkill", [
        { kind: "flag", flag: "crit", mode: "force", filter: { allOf: ["TAG-FORM-MELEE"] } },
      ]),
      // 千の小傷「物理ヒットは必ず出血を付与」
      effect("EFF-FORCE-BLEED", "unique", [
        {
          kind: "flag",
          flag: "ailmentApply",
          mode: "force",
          target: "TAG-AIL-BLEED",
          filter: { allOf: ["TAG-ELEM-PHYSICAL"] },
        },
      ]),
      // 規則3：一騎当千「召喚物を維持できない」と、召喚物を生む効果
      effect("EFF-NO-MINION", "keystone", [{ kind: "flag", flag: "spawnMinion", mode: "forbid" }]),
      effect("EFF-SPAWN", "uniqueLatent", [{ kind: "flag", flag: "spawnMinion", mode: "force" }]),
    ],
  });
  const index = new TagIndex(db.tags);

  it("規則1：禁止は強制に勝つ（目隠し＋急所穿ち → 会心しない）", () => {
    const { view } = evaluateEffects(db, index, [inst("EFF-NO-CRIT"), inst("EFF-FORCE-CRIT")]);
    const r = view.flag("crit", undefined, ["TAG-FORM-MELEE"]);
    expect(r.resolution).toBe("forbid");
    expect(r.forbiddenBy).toEqual(["EFF-NO-CRIT"]);
    expect(r.forcedBy).toEqual(["EFF-FORCE-CRIT"]);
  });

  it("強制だけなら強制、どちらもなければ通常（確率で決める）", () => {
    const { view } = evaluateEffects(db, index, [inst("EFF-FORCE-CRIT")]);
    expect(view.flag("crit", undefined, ["TAG-FORM-MELEE"]).resolution).toBe("force");
    expect(view.flag("crit", undefined, ["TAG-FORM-PROJECTILE"]).resolution).toBeUndefined();
  });

  it("対象付きの印は、対象ごとに解決する（出血は必ず、毒は通常）", () => {
    const { view } = evaluateEffects(db, index, [inst("EFF-FORCE-BLEED")]);
    expect(view.flag("ailmentApply", "TAG-AIL-BLEED", ["TAG-ELEM-PHYSICAL"]).resolution).toBe(
      "force",
    );
    expect(
      view.flag("ailmentApply", "TAG-AIL-POISON", ["TAG-ELEM-PHYSICAL"]).resolution,
    ).toBeUndefined();
    expect(
      view.flag("ailmentApply", "TAG-AIL-BLEED", ["TAG-ELEM-COLD"]).resolution,
    ).toBeUndefined();
  });

  it("規則3：生成を禁止する効果があると、召喚物を生む効果は発動しない", () => {
    const { view } = evaluateEffects(db, index, [inst("EFF-NO-MINION"), inst("EFF-SPAWN")]);
    expect(view.flag("spawnMinion", undefined).resolution).toBe("forbid");
  });
});

describe("段階に分けた評価（仕様書v0.2 4.9.1）", () => {
  const db = buildDb({
    tags: TAGS,
    stats: STATS,
    effects: [
      effect("EFF-RI-NODE", "minorStar", [{ kind: "added", stat: "STAT-RI", value: 20 }]),
      // 理の門の先のノード：理+50。門の条件は「理が200以上」
      effect("EFF-BEYOND-GATE", "notableStar", [{ kind: "added", stat: "STAT-RI", value: 50 }], {
        conditions: [{ type: "statAtLeast", stat: "STAT-RI", value: 200 }],
      }),
      // 刃の門：主手に剣系
      effect(
        "EFF-BLADE-GATE",
        "notableStar",
        [{ kind: "increased", stat: "STAT-DAMAGE", value: 0.25 }],
        { conditions: [{ type: "equippedTag", tag: "TAG-WPNGRP-SWORD", slot: "mainHand" }] },
      ),
      // 重荷の誇り：重装4部位以上で崩されない
      effect("EFF-HEAVY-4", "keystone", [{ kind: "flag", flag: "beStaggered", mode: "forbid" }], {
        conditions: [{ type: "factAtLeast", fact: "armor.heavy.count", value: 4 }],
      }),
      // 潜在効果【戦士】
      effect(
        "EFF-LATENT-WARRIOR",
        "uniqueLatent",
        [{ kind: "more", stat: "STAT-DAMAGE", value: 1.3 }],
        { conditions: [{ type: "mainJob", job: "TAG-JOB-WARRIOR" }] },
      ),
    ],
  });
  const index = new TagIndex(db.tags);

  it("条件の判定には、条件付きの効果自身の値を含めない（理の門の循環が起きない）", () => {
    // 基礎の理が180＋小星20＝200 → 門が開き、先のノードの+50が加わる
    const open = evaluateEffects(db, index, [inst("EFF-RI-NODE"), inst("EFF-BEYOND-GATE")], {
      baseStats: { "STAT-RI": 180 },
    });
    expect(open.view.stat("STAT-RI").value).toBe(250);
    expect(open.dormant).toEqual([]);

    // 基礎の理が170 → 第1段階は190なので門は閉じる（先のノードの+50で240になっても、開かない）
    const closed = evaluateEffects(db, index, [inst("EFF-RI-NODE"), inst("EFF-BEYOND-GATE")], {
      baseStats: { "STAT-RI": 170 },
    });
    expect(closed.view.stat("STAT-RI").value).toBe(190);
    expect(closed.dormant.map((d) => d.instance.effectId)).toEqual(["EFF-BEYOND-GATE"]);
    expect(closed.dormant[0]?.unmet).toEqual([
      { type: "statAtLeast", stat: "STAT-RI", value: 200 },
    ]);
  });

  it("同じ状態で何度評価しても、結果は同じ", () => {
    const input = [inst("EFF-RI-NODE"), inst("EFF-BEYOND-GATE")];
    const facts = { baseStats: { "STAT-RI": 175 } };
    const a = evaluateEffects(db, index, input, facts);
    const b = evaluateEffects(db, index, input, facts);
    expect(a.view.stat("STAT-RI")).toEqual(b.view.stat("STAT-RI"));
    expect(a.dormant).toEqual(b.dormant);
  });

  it("刃の門：長剣・大剣で開き、短剣では閉じる（休眠の理由を返す）", () => {
    const withTag = (tagId: string) =>
      evaluateEffects(db, index, [inst("EFF-BLADE-GATE")], { equippedTags: { mainHand: [tagId] } });
    expect(withTag("TAG-WPN-SWORD").view.stat("STAT-DAMAGE").increased).toBeCloseTo(0.25);
    expect(withTag("TAG-WPN-GREATSWORD").view.stat("STAT-DAMAGE").increased).toBeCloseTo(0.25);
    const dagger = withTag("TAG-WPN-DAGGER");
    expect(dagger.view.stat("STAT-DAMAGE").increased).toBe(0);
    expect(dagger.dormant[0]?.unmet[0]).toEqual({
      type: "equippedTag",
      tag: "TAG-WPNGRP-SWORD",
      slot: "mainHand",
    });
    // 副手の剣系では開かない
    const offHand = evaluateEffects(db, index, [inst("EFF-BLADE-GATE")], {
      equippedTags: { offHand: ["TAG-WPN-SWORD"] },
    });
    expect(offHand.dormant).toHaveLength(1);
  });

  it("事実とメインジョブの条件", () => {
    const three = evaluateEffects(db, index, [inst("EFF-HEAVY-4")], {
      facts: { "armor.heavy.count": 3 },
    });
    expect(three.view.flag("beStaggered", undefined).resolution).toBeUndefined();
    const four = evaluateEffects(db, index, [inst("EFF-HEAVY-4")], {
      facts: { "armor.heavy.count": 4 },
    });
    expect(four.view.flag("beStaggered", undefined).resolution).toBe("forbid");

    expect(
      evaluateEffects(db, index, [inst("EFF-LATENT-WARRIOR")], {
        mainJob: "TAG-JOB-WARRIOR",
      }).view.stat("STAT-DAMAGE").more,
    ).toBeCloseTo(1.3);
    expect(
      evaluateEffects(db, index, [inst("EFF-LATENT-WARRIOR")], {
        mainJob: "TAG-JOB-ROGUE",
      }).view.stat("STAT-DAMAGE").more,
    ).toBe(1);
  });

  it("入力の並び順が違っても、結果は同じ（性質のテスト）", () => {
    const pool = [
      "EFF-RI-NODE",
      "EFF-BEYOND-GATE",
      "EFF-BLADE-GATE",
      "EFF-HEAVY-4",
      "EFF-LATENT-WARRIOR",
    ];
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ id: fc.constantFrom(...pool), stacks: fc.integer({ min: 1, max: 4 }) }),
          { maxLength: 12 },
        ),
        fc.integer({ min: 0, max: 400 }),
        (list, ri) => {
          const instances = list.map((x, i) => ({
            effectId: x.id,
            source: src(`s${String(i % 3)}`),
            stacks: x.stacks,
          }));
          const facts = {
            baseStats: { "STAT-RI": ri },
            equippedTags: { mainHand: ["TAG-WPN-SWORD"] },
            mainJob: "TAG-JOB-WARRIOR",
          };
          const a = evaluateEffects(db, index, instances, facts);
          const b = evaluateEffects(db, index, [...instances].reverse(), facts);
          const pick = (e: typeof a) => [
            e.view.stat("STAT-RI").value,
            e.view.stat("STAT-DAMAGE").increased,
            e.view.stat("STAT-DAMAGE").more,
          ];
          return (
            JSON.stringify(pick(a)) === JSON.stringify(pick(b)) &&
            a.dormant.length === b.dormant.length
          );
        },
      ),
    );
  });
});

describe("入力・枠の置き換え（仕様書v0.2 2.4.1 の規則2）", () => {
  const hooks = new Set(["guardStance", "shadowStep", "jobDodge"]);
  const db = buildDb(
    {
      tags: TAGS,
      stats: STATS,
      effects: [
        // 不動の誓い（天極）と、影縫いの装束の4部位（セット）
        effect("EFF-K02", "keystone", [{ kind: "replace", slot: "dodge", hook: "guardStance" }]),
        effect("EFF-SET-SHADOW", "set", [{ kind: "replace", slot: "dodge", hook: "shadowStep" }]),
        effect("EFF-JOB-DODGE", "jobSkill", [{ kind: "replace", slot: "dodge", hook: "jobDodge" }]),
        effect("EFF-SET-A", "set", [{ kind: "replace", slot: "dodge", hook: "shadowStep" }]),
      ],
    },
    hooks,
  );
  const index = new TagIndex(db.tags);

  it("天極 ＞ セット ＞ 職技：上位の1つだけが有効で、負けたものも返す", () => {
    const { view } = evaluateEffects(db, index, [
      inst("EFF-JOB-DODGE"),
      inst("EFF-SET-SHADOW"),
      inst("EFF-K02"),
    ]);
    const r = view.replacement("dodge");
    expect(r.winner).toEqual({ hook: "guardStance", effectId: "EFF-K02", origin: "keystone" });
    expect(r.overridden.map((o) => o.effectId)).toEqual(["EFF-SET-SHADOW", "EFF-JOB-DODGE"]);
  });

  it("置き換えがなければ winner は undefined", () => {
    expect(evaluateEffects(db, index, []).view.replacement("dodge").winner).toBeUndefined();
  });

  it("同じ順位どうしは、効果のIDの順で決まる（並び順に左右されない）", () => {
    const a = evaluateEffects(db, index, [
      inst("EFF-SET-SHADOW"),
      inst("EFF-SET-A"),
    ]).view.replacement("dodge");
    const b = evaluateEffects(db, index, [
      inst("EFF-SET-A"),
      inst("EFF-SET-SHADOW"),
    ]).view.replacement("dodge");
    expect(a.winner?.effectId).toBe("EFF-SET-A");
    expect(b.winner?.effectId).toBe("EFF-SET-A");
  });
});

describe("重ねた数（stacks）の検証と、0のときの扱い", () => {
  const hooks = new Set(["guardStance", "shadowStep"]);
  const kinds = [
    effect("EFF-Z-ADD", "affix", [
      { kind: "added", stat: "STAT-DAMAGE", value: { min: 1, max: 3 } },
    ]),
    effect("EFF-Z-FIXED", "affix", [{ kind: "fixedAdded", stat: "STAT-DAMAGE", value: 2 }]),
    effect("EFF-Z-INC", "minorStar", [{ kind: "increased", stat: "STAT-DAMAGE", value: 0.3 }]),
    effect("EFF-Z-MORE", "keystone", [{ kind: "more", stat: "STAT-DAMAGE", value: 1.2 }]),
    // 上限：基礎の上限がない能力値（STAT-RI）と、ある能力値（STAT-RESIST-FIRE）
    effect("EFF-Z-CAP", "keystone", [
      { kind: "cap", stat: "STAT-RI", value: 250 },
      { kind: "cap", stat: "STAT-RESIST-FIRE", value: 0.05 },
    ]),
    effect("EFF-Z-OVR", "keystone", [
      { kind: "override", stat: "STAT-MOVE", value: 0.5, priority: 1 },
    ]),
    effect("EFF-Z-FORCE", "unique", [{ kind: "flag", flag: "crit", mode: "force" }]),
    effect("EFF-Z-FORBID", "unique", [{ kind: "flag", flag: "crit", mode: "forbid" }]),
    effect("EFF-Z-REPL", "set", [{ kind: "replace", slot: "dodge", hook: "shadowStep" }]),
    effect("EFF-Z-BEH", "unique", [{ kind: "behavior", hook: "guardStance", params: { a: 1 } }]),
    effect("EFF-Z-CONV", "unique", [{ kind: "convert", from: "physical", to: "cold", value: 0.2 }]),
    effect("EFF-Z-RETAG", "unique", [{ kind: "retag", from: ["physical"], to: "cold" }]),
    effect("EFF-Z-COND", "notableStar", [{ kind: "increased", stat: "STAT-DAMAGE", value: 0.1 }], {
      conditions: [{ type: "mainJob", job: "TAG-JOB-WARRIOR" }],
    }),
    effect("EFF-Z-RI", "minorStar", [{ kind: "added", stat: "STAT-RI", value: 100 }]),
    effect("EFF-Z-GATE", "notableStar", [{ kind: "increased", stat: "STAT-DAMAGE", value: 0.5 }], {
      conditions: [{ type: "statAtLeast", stat: "STAT-RI", value: 350 }],
    }),
  ];
  const db = buildDb({ tags: TAGS, stats: STATS, effects: kinds }, hooks);
  const index = new TagIndex(db.tags);
  /** 条件のない効果の全ての種類（印は強制だけ。禁止は別に確かめる）。 */
  const ALL = [
    "EFF-Z-ADD",
    "EFF-Z-FIXED",
    "EFF-Z-INC",
    "EFF-Z-MORE",
    "EFF-Z-CAP",
    "EFF-Z-OVR",
    "EFF-Z-FORCE",
    "EFF-Z-REPL",
    "EFF-Z-BEH",
    "EFF-Z-CONV",
    "EFF-Z-RETAG",
  ];
  const facts = { baseStats: { "STAT-RI": 300, "STAT-MOVE": 0.1 }, mainJob: "TAG-JOB-WARRIOR" };
  const evaluateAll = (stacks: number) =>
    evaluateEffects(
      db,
      index,
      ALL.map((id) => inst(id, stacks)),
      facts,
    );

  it("stacks = 0：全ての種類の効果が何も効かない（数値・上限・上書き・印・置き換え・挙動・変換・付け替え）", () => {
    const { view, active, dormant } = evaluateAll(0);
    const dmg = view.stat("STAT-DAMAGE", ["TAG-ELEM-PHYSICAL"]);
    expect([dmg.added, dmg.fixedAdded, dmg.increased, dmg.more]).toEqual([
      { min: 0, max: 0 },
      { min: 0, max: 0 },
      0,
      1,
    ]);
    expect(dmg.contributions).toEqual([]);
    expect(view.stat("STAT-MOVE").override).toBeUndefined();
    expect(view.stat("STAT-MOVE").value).toBe(0.1);
    expect(view.flag("crit", undefined).resolution).toBeUndefined();
    expect(view.replacement("dodge")).toEqual({ winner: undefined, overridden: [] });
    expect(view.activeBehaviors()).toEqual([]);
    expect(view.conversions()).toEqual([]);
    expect(view.retagging()).toEqual([]);
    expect(active).toEqual([]);
    expect(dormant).toEqual([]);
  });

  it("stacks = 0：上限が0になる副作用がない（基礎の上限がない能力値は上限なし、ある能力値は基礎の上限のまま）", () => {
    const { view } = evaluateAll(0);
    const ri = view.stat("STAT-RI");
    expect(ri.cap).toBeUndefined();
    expect(ri.value).toBe(300);
    const fire = view.stat("STAT-RESIST-FIRE");
    expect(fire.cap).toBe(0.75);
    expect(fire.contributions).toEqual([]);
  });

  it("stacks = 0：禁止の印も効かない（ほかの効果の強制が勝つ）", () => {
    const { view } = evaluateEffects(db, index, [inst("EFF-Z-FORBID", 0), inst("EFF-Z-FORCE", 1)]);
    const r = view.flag("crit", undefined);
    expect(r.resolution).toBe("force");
    expect(r.forbiddenBy).toEqual([]);
  });

  it("stacks = 0：置き換え・挙動の候補にも入らない（ほかの置き換えを負かさない）", () => {
    const { view } = evaluateEffects(db, index, [inst("EFF-Z-REPL", 0), inst("EFF-Z-BEH", 0)]);
    expect(view.replacement("dodge").winner).toBeUndefined();
    expect(view.activeBehaviors()).toEqual([]);
  });

  it("stacks = 1：通常どおり働く", () => {
    const { view, active } = evaluateAll(1);
    const dmg = view.stat("STAT-DAMAGE", ["TAG-ELEM-PHYSICAL"]);
    expect(dmg.added).toEqual({ min: 1, max: 3 });
    expect(dmg.fixedAdded).toEqual({ min: 2, max: 2 });
    expect(dmg.increased).toBeCloseTo(0.3);
    expect(dmg.more).toBeCloseTo(1.2);
    expect(view.stat("STAT-RI").cap).toBe(250);
    expect(view.stat("STAT-RI").value).toBe(250);
    expect(view.stat("STAT-RESIST-FIRE").cap).toBeCloseTo(0.8);
    expect(view.stat("STAT-MOVE").value).toBe(0.5);
    expect(view.flag("crit", undefined).resolution).toBe("force");
    expect(view.replacement("dodge").winner?.hook).toBe("shadowStep");
    expect(view.activeBehaviors().map((b) => [b.hook, b.stacks])).toEqual([["guardStance", 1]]);
    expect(view.conversions().map((c) => c.value)).toEqual([0.2]);
    expect(view.retagging().map((r) => r.to)).toEqual(["cold"]);
    expect(active).toHaveLength(ALL.length);
  });

  it("stacks = 2：既存の重ね方（加算・追加・上限・変換は値×数、乗算は数乗、上書き・印は1つ分）", () => {
    const { view } = evaluateAll(2);
    const dmg = view.stat("STAT-DAMAGE", ["TAG-ELEM-PHYSICAL"]);
    expect(dmg.added).toEqual({ min: 2, max: 6 });
    expect(dmg.fixedAdded).toEqual({ min: 4, max: 4 });
    expect(dmg.increased).toBeCloseTo(0.6);
    expect(dmg.more).toBeCloseTo(1.44);
    expect(view.stat("STAT-RI").cap).toBe(500);
    expect(view.stat("STAT-RI").value).toBe(300);
    expect(view.stat("STAT-RESIST-FIRE").cap).toBeCloseTo(0.85);
    expect(view.stat("STAT-MOVE").value).toBe(0.5);
    expect(view.flag("crit", undefined).resolution).toBe("force");
    expect(view.activeBehaviors().map((b) => b.stacks)).toEqual([2]);
    expect(view.conversions().map((c) => c.value)).toEqual([0.4]);
  });

  it("stacks = 0 の条件付きの効果：条件を満たさなければ休眠（理由つき）、満たしても有効にはしない", () => {
    const met = evaluateEffects(db, index, [inst("EFF-Z-COND", 0)], facts);
    expect(met.active).toEqual([]);
    expect(met.dormant).toEqual([]);
    expect(met.view.stat("STAT-DAMAGE").increased).toBe(0);
    const unmet = evaluateEffects(db, index, [inst("EFF-Z-COND", 0)], {
      ...facts,
      mainJob: "TAG-JOB-ROGUE",
    });
    expect(unmet.active).toEqual([]);
    expect(unmet.dormant.map((d) => d.unmet)).toEqual([
      [{ type: "mainJob", job: "TAG-JOB-WARRIOR" }],
    ]);
    // stacks = 1 なら、これまでどおり条件で有効・休眠が決まる
    expect(evaluateEffects(db, index, [inst("EFF-Z-COND", 1)], facts).active).toHaveLength(1);
  });

  it("stacks = 0 の効果は、条件の判定（第1段階の値）にも入らない", () => {
    // 理300＋100（重ねた数0）では、理350以上の条件を満たさない
    const zero = evaluateEffects(db, index, [inst("EFF-Z-RI", 0), inst("EFF-Z-GATE", 1)], facts);
    expect(zero.dormant.map((d) => d.instance.effectId)).toEqual(["EFF-Z-GATE"]);
    const one = evaluateEffects(db, index, [inst("EFF-Z-RI", 1), inst("EFF-Z-GATE", 1)], facts);
    expect(one.active.map((i) => i.effectId)).toEqual(["EFF-Z-GATE", "EFF-Z-RI"]);
  });

  it("小数・NaN・Infinity・-Infinity・負の数は RangeError（条件付きの効果・休眠する効果でも）", () => {
    for (const bad of [
      1.5,
      0.5,
      -1,
      -0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(() => evaluateEffects(db, index, [inst("EFF-Z-INC", bad)]), String(bad)).toThrow(
        RangeError,
      );
      expect(
        () =>
          evaluateEffects(db, index, [inst("EFF-Z-COND", bad)], {
            ...facts,
            mainJob: "TAG-JOB-ROGUE",
          }),
        `条件付き ${String(bad)}`,
      ).toThrow(RangeError);
      expect(
        () => new ModifierView(db, index, [inst("EFF-Z-INC", bad)], {}),
        `ModifierView ${String(bad)}`,
      ).toThrow(RangeError);
    }
    // 大きな整数は受け付ける
    expect(
      evaluateEffects(db, index, [inst("EFF-Z-INC", 10)]).view.stat("STAT-DAMAGE").increased,
    ).toBeCloseTo(3);
  });

  it("stacks の省略は1として働く（プロパティなし・実行時の undefined のどちらも）", () => {
    const omitted = evaluateEffects(
      db,
      index,
      ALL.map((id) => inst(id)),
      facts,
    );
    const one = evaluateAll(1);
    expect(omitted.view.stat("STAT-DAMAGE")).toEqual(one.view.stat("STAT-DAMAGE"));
    expect(omitted.view.stat("STAT-DAMAGE").increased).toBeCloseTo(0.3);
    expect(omitted.view.activeBehaviors().map((b) => [b.hook, b.stacks])).toEqual([
      ["guardStance", 1],
    ]);
    expect(omitted.view.conversions()).toEqual(one.view.conversions());
    expect(omitted.active.map((i) => i.effectId)).toEqual(one.active.map((i) => i.effectId));
    // 型では書けないが、JavaScript からは stacks: undefined が来うる。これも省略として1にする
    const explicitUndefined = {
      effectId: "EFF-Z-INC",
      source: src("EFF-Z-INC"),
      stacks: undefined,
    } as unknown as EffectInstance;
    expect(
      evaluateEffects(db, index, [explicitUndefined]).view.stat("STAT-DAMAGE").increased,
    ).toBeCloseTo(0.3);
    expect(
      new ModifierView(db, index, [explicitUndefined], {}).stat("STAT-DAMAGE").increased,
    ).toBeCloseTo(0.3);
  });

  it("stacks: null は省略とみなさず RangeError（条件付きの効果・休眠する効果・ModifierView でも）", () => {
    // 型では書けないが、JavaScript や保存データの復元からは null が来うる
    const withNull = (effectId: string) =>
      ({ effectId, source: src(effectId), stacks: null }) as unknown as EffectInstance;
    expect(() => evaluateEffects(db, index, [withNull("EFF-Z-INC")])).toThrow(RangeError);
    expect(() => evaluateEffects(db, index, [withNull("EFF-Z-INC")])).toThrow(/null/);
    // 正しい効果と混ざっていても拒否する（並べ替えで先に比べられても、null を1として扱わない）
    expect(() =>
      evaluateEffects(db, index, [inst("EFF-Z-INC", 1), withNull("EFF-Z-INC"), inst("EFF-Z-ADD")]),
    ).toThrow(RangeError);
    // 条件を満たさず休眠する効果でも拒否する
    expect(() =>
      evaluateEffects(db, index, [withNull("EFF-Z-COND")], { ...facts, mainJob: "TAG-JOB-ROGUE" }),
    ).toThrow(RangeError);
    expect(() => new ModifierView(db, index, [withNull("EFF-Z-INC")], {})).toThrow(RangeError);
  });
});
