import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type EffectInstance, TagIndex, evaluateEffects } from "../src/index.ts";
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
