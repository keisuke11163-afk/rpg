import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ConditionRegistry,
  HookRegistry,
  TagRegistry,
  effectSchema,
  evaluate,
  explain,
  matchesFilter,
  resolveForceForbid,
  resolveOverride,
  resolveReplace,
  resolveSpawn,
  type ActiveEffect,
  type EvalContext,
  type TagDef,
} from "../src/index.ts";

const tag = (id: string, parents?: string[]): TagDef => ({
  id,
  category: "試験",
  name: id,
  ...(parents ? { parents } : {}),
});
const tags = new TagRegistry([
  tag("TAG-WPNGRP-SWORD"),
  tag("TAG-WPN-SWORD", ["TAG-WPNGRP-SWORD"]),
  tag("TAG-WPN-GREATSWORD", ["TAG-WPNGRP-SWORD"]),
  tag("TAG-WPN-DAGGER"),
  tag("TAG-FORM-PROJECTILE"),
  tag("TAG-ELEM-COLD"),
]);

const ctx = (over: Partial<EvalContext> = {}): EvalContext => ({
  tags: new Set(),
  stats: {},
  counts: {},
  flags: new Set(),
  ...over,
});

let seq = 0;
function fx(partial: Record<string, unknown>): ActiveEffect {
  seq += 1;
  const effect = effectSchema.parse({
    id: `EFF-T-${String(seq)}`,
    source: "天極",
    affects: { 打撃値: false, 基準値: false },
    scope: "自分",
    modifiers: [{ kind: "加算％", stat: "ダメージ", value: 0.1 }],
    ...partial,
  });
  return { effect, origin: `O${String(seq)}` };
}

describe("T2 タグの照合", () => {
  it("武器は親タグも持つ（刃の門：長剣・大剣で開き、短剣では閉じる）", () => {
    const gate = { any_of: ["TAG-WPNGRP-SWORD"] };
    expect(matchesFilter(gate, tags.expand(["TAG-WPN-GREATSWORD"]))).toBe(true);
    expect(matchesFilter(gate, tags.expand(["TAG-WPN-SWORD"]))).toBe(true);
    expect(matchesFilter(gate, tags.expand(["TAG-WPN-DAGGER"]))).toBe(false);
  });
  it("[投射][氷] は、投射で氷の技にだけ効く", () => {
    const e = fx({
      target_skill_tags: { all_of: ["TAG-FORM-PROJECTILE", "TAG-ELEM-COLD"] },
    });
    const ev = evaluate([e], ctx());
    const q = (...ids: string[]) =>
      ev.stat({ stat: "ダメージ", tags: tags.expand(ids) }, 100).value;
    expect(q("TAG-FORM-PROJECTILE", "TAG-ELEM-COLD")).toBeCloseTo(110);
    expect(q("TAG-FORM-PROJECTILE")).toBe(100);
    expect(q("TAG-ELEM-COLD")).toBe(100);
  });
  it("none_of と any_of", () => {
    const set = tags.expand(["TAG-WPN-DAGGER"]);
    expect(matchesFilter({ none_of: ["TAG-WPN-DAGGER"] }, set)).toBe(false);
    expect(matchesFilter({ any_of: ["TAG-WPN-DAGGER", "TAG-ELEM-COLD"] }, set)).toBe(true);
    expect(matchesFilter(undefined, set)).toBe(true);
  });
});

describe("修正値の集計", () => {
  it("式：(基礎＋固定)×(1＋加算％の合計)×乗算の積", () => {
    const ev = evaluate(
      [
        fx({ modifiers: [{ kind: "加算％", stat: "ダメージ", value: 0.3 }], source: "詞" }),
        fx({ modifiers: [{ kind: "加算％", stat: "ダメージ", value: 0.2 }], source: "詞" }),
        fx({ modifiers: [{ kind: "固定の追加", stat: "ダメージ", value: 10 }], source: "詞" }),
        fx({ modifiers: [{ kind: "乗算", stat: "ダメージ", value: 1.5 }] }),
        fx({ modifiers: [{ kind: "乗算", stat: "ダメージ", value: 2 }], source: "ユニーク" }),
      ],
      ctx(),
    );
    const r = ev.stat({ stat: "ダメージ" }, 100);
    expect(r.value).toBeCloseTo((100 + 10) * 1.5 * 1.5 * 2);
    expect(r.breakdown).toHaveLength(5);
    expect(explain(r)).toContain("EFF-T-");
  });
  it("フィルター（出血だけ）と重ね掛け・上限", () => {
    const bleed = fx({
      modifiers: [
        {
          kind: "加算％",
          stat: "状態異常ダメージ",
          filter: { ailment: "TAG-AIL-BLEED" },
          value: 0.06,
          cap: 0.2,
        },
      ],
      stack_cap: 5,
    });
    bleed.stacks = 10;
    const ev = evaluate([bleed], ctx());
    expect(ev.stat({ stat: "状態異常ダメージ", ailment: "TAG-AIL-BLEED" }, 1).value).toBeCloseTo(
      1.2,
    );
    expect(ev.stat({ stat: "状態異常ダメージ", ailment: "TAG-AIL-POISON" }, 1).value).toBe(1);
  });
  it("per（数えた分だけ）と上限の変更", () => {
    const e = fx({
      modifiers: [
        {
          kind: "加算％",
          stat: "ダメージ",
          per: { count: "装備中の防具種", value: "重装" },
          value: 0.05,
        },
        { kind: "上限", stat: "耐性", value: 0.15 },
      ],
    });
    const ev = evaluate([e], ctx({ counts: { "装備中の防具種:重装": 4 } }));
    expect(ev.stat({ stat: "ダメージ" }, 100).value).toBeCloseTo(120);
    const r = ev.stat({ stat: "耐性" }, 2, 0.75);
    expect(r.value).toBeCloseTo(0.9);
    expect(ev.stat({ stat: "耐性" }, 0.85, 0.75).value).toBeCloseTo(0.85);
    expect(ev.stat({ stat: "耐性" }, 0.95, 0.75).capped).toBe(true);
  });
});

describe("段階に分けた評価（本仕様書 4.9.1）", () => {
  it("条件を満たさない効果は休眠し、満たすと有効になる", () => {
    const gate = fx({
      conditions: [{ type: "能力値", stat: "理", min: 200 }],
      modifiers: [{ kind: "加算％", stat: "ダメージ", value: 0.5 }],
    });
    expect(evaluate([gate], ctx({ stats: { 理: 199 } })).dormant).toHaveLength(1);
    const ok = evaluate([gate], ctx({ stats: { 理: 200 } }));
    expect(ok.dormant).toHaveLength(0);
    expect(ok.stat({ stat: "ダメージ" }, 100).value).toBeCloseTo(150);
  });
  it("条件付きの効果自身は、判定に使う値に含まれない（循環しない）", () => {
    // 「理200以上で、理+50」：判定は第1段階の理（190）で行うので、+50されても門は開かない
    const gate = fx({
      conditions: [{ type: "能力値", stat: "理", min: 200 }],
      modifiers: [{ kind: "固定の追加", stat: "理", value: 50 }],
    });
    const base = fx({ modifiers: [{ kind: "固定の追加", stat: "理", value: 190 }], source: "詞" });
    const first = evaluate([base], ctx()).stat({ stat: "理" }).value;
    const ev = evaluate([base, gate], ctx({ stats: { 理: first } }));
    expect(ev.dormant).toHaveLength(1);
    expect(ev.stat({ stat: "理" }).value).toBe(190);
  });
  it("修飾子の条件・旗・未登録の条件", () => {
    const e = fx({
      modifiers: [
        {
          kind: "加算％",
          stat: "ダメージ",
          value: 0.2,
          conditions: [{ type: "旗", name: "冷却状態の敵" }],
        },
      ],
    });
    expect(evaluate([e], ctx()).stat({ stat: "ダメージ" }, 100).value).toBe(100);
    expect(
      evaluate([e], ctx({ flags: new Set(["冷却状態の敵"]) })).stat({ stat: "ダメージ" }, 100)
        .value,
    ).toBeCloseTo(120);
    const bad = fx({ conditions: [{ type: "知らない条件" }] });
    expect(() => evaluate([bad], ctx())).toThrow(/未登録/);
    const reg = new ConditionRegistry();
    reg.register("知らない条件", () => true);
    expect(evaluate([bad], ctx(), reg).active).toHaveLength(1);
    expect(() => {
      reg.register("知らない条件", () => true);
    }).toThrow();
  });
  it("同じ入力なら何度評価しても同じ。入力の並びにも依らない（冪等）", () => {
    const effects = fc.array(
      fc.record({
        v: fc.integer({ min: -50, max: 80 }).map((n) => n / 100),
        kind: fc.constantFrom("加算％", "固定の追加"),
      }),
      { minLength: 1, maxLength: 12 },
    );
    fc.assert(
      fc.property(effects, fc.integer(), (list, seed) => {
        const entries = list.map((x, i) => {
          const e = fx({ modifiers: [{ kind: x.kind, stat: "S", value: x.v }], source: "詞" });
          e.origin = `ORG-${String(i)}`;
          return e;
        });
        const a = evaluate(entries, ctx()).stat({ stat: "S" }, 10).value;
        const b = evaluate(entries, ctx()).stat({ stat: "S" }, 10).value;
        const shuffled = [...entries].sort(
          (p, q) => ((seed ^ p.origin.length) % 3) - 1 || (p.origin < q.origin ? 1 : -1),
        );
        const c = evaluate(shuffled, ctx()).stat({ stat: "S" }, 10).value;
        expect(b).toBe(a);
        expect(c).toBe(a);
      }),
    );
  });
});

describe("T3 効果の優先順位（本仕様書 2.4.1）", () => {
  const behavior = (hook: string, extra: Record<string, unknown> = {}): ActiveEffect =>
    fx({
      modifiers: [{ kind: "挙動", hook, ...(extra["params"] ? { params: extra["params"] } : {}) }],
      ...(extra["effect"] as object),
    });
  const calls = (...list: ActiveEffect[]) => evaluate(list, ctx()).hooks();

  it("規則1：禁止は強制に勝つ（盲目の賢者の目隠し＋急所穿ち）", () => {
    const c = calls(behavior("禁止:会心"), behavior("強制:会心"));
    expect(resolveForceForbid(c, "会心")).toBe("forbid");
    expect(resolveForceForbid(calls(behavior("強制:会心")), "会心")).toBe("force");
    expect(resolveForceForbid([], "会心")).toBe("none");
  });
  it("規則2：天極＞ユニーク＞セット＞輝星・転変＞職技。下位は無効", () => {
    const c = calls(
      behavior("置換:回避", { effect: { source: "職技" } }),
      behavior("置換:回避", { effect: { source: "ユニーク" } }),
      behavior("置換:回避", { effect: { source: "輝星" } }),
    );
    const r = resolveReplace(c, "回避");
    expect(r.winner?.source).toBe("ユニーク");
    expect(r.overridden.map((o) => o.source)).toEqual(["輝星", "職技"]);
    expect(resolveReplace(c, "別の枠").winner).toBeUndefined();
  });
  it("規則3：生成を禁止する効果があると、他の生成は発動しない", () => {
    const spawn = behavior("生成:召喚物");
    expect(resolveSpawn(calls(spawn), "召喚物")).toHaveLength(1);
    expect(resolveSpawn(calls(spawn, behavior("生成禁止:召喚物")), "召喚物")).toHaveLength(0);
  });
  it("規則4：上書きは優先度の大きいものが勝つ", () => {
    const c = calls(
      behavior("上書き:移動速度", { params: { priority: 1, value: 1 } }),
      behavior("上書き:移動速度", { params: { priority: 5, value: 2 } }),
    );
    expect(resolveOverride(c, "移動速度")?.params["value"]).toBe(2);
  });
});

describe("ルールフックの登録", () => {
  it("登録・重複の拒否・構造の名前は登録なしで書ける", () => {
    const hooks = new HookRegistry();
    let called = 0;
    hooks.register("投射物の追加", () => (called += 1));
    expect(() => {
      hooks.register("投射物の追加", () => undefined);
    }).toThrow();
    hooks.get("投射物の追加")?.({});
    expect(called).toBe(1);
    expect(hooks.has("置換:回避")).toBe(true);
    expect(hooks.has("知らない処理")).toBe(false);
    expect(hooks.names()).toEqual(["投射物の追加"]);
  });
});
