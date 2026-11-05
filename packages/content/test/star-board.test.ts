/**
 * U-14 星辰盤の仕組み（開発計画書 T9）：テスト用の盤（本物のジョブ・タグ・能力値に、テスト用のノードと効果を足す）で、
 * 取得・返却・星門・休眠・星座・ポイントの上限・3段階の評価を確かめる。
 */
import fc from "fast-check";
import {
  type ContentDb,
  Equipment,
  type ItemInstance,
  type RawContent,
  StarAllocation,
  TagIndex,
  evaluateStarBoard,
  evaluateEffects,
  formatContentError,
  itemEffectInstances,
  loadContent,
  startNodeOf,
  starPoints,
} from "@stella/core";
import { describe, expect, it } from "vitest";
import { rawContent } from "../src/index.ts";

/** テスト用の効果（小星・星座）。 */
const FX = [
  {
    id: "EFF-T-HP",
    origin: "minorStar",
    modifiers: [{ kind: "added", stat: "STAT-HP-MAX", value: 10 }],
    affects: { hit: false, ailmentBase: false },
    scope: "self",
  },
  {
    id: "EFF-T-HP-BIG",
    origin: "minorStar",
    modifiers: [{ kind: "added", stat: "STAT-HP-MAX", value: 1000 }],
    affects: { hit: false, ailmentBase: false },
    scope: "self",
  },
  {
    id: "EFF-T-ACC",
    origin: "notableStar",
    modifiers: [{ kind: "added", stat: "STAT-ACCURACY", value: 50 }],
    affects: { hit: true, ailmentBase: false },
    scope: "self",
  },
  {
    id: "EFF-T-CONST",
    origin: "constellation",
    modifiers: [{ kind: "added", stat: "STAT-ACCURACY", value: 7 }],
    affects: { hit: true, ailmentBase: false },
    scope: "self",
  },
];

const n = (
  id: string,
  links: string[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  kind: "minor",
  region: "gou",
  links,
  effects: ["EFF-T-HP"],
  position: { x: 0, y: 0 },
  ...extra,
});

/**
 * テスト用の盤：
 * W(戦士の始点) - a1 - a2 - a3 - SWORD(刃の門) - b1 - b2
 *                   a2 - c1 - c2 - c3（星座）
 *                   a3 - d1 - d2 - R(盗賊の始点)
 *                   a1 - HPGATE(最大HP 1000以上) - e1(最大HP+1000)
 *                   a1 - e1 （門を通らずに e1 へは行けない：e1 は HPGATE の先だけ）
 */
const NODES = [
  n("T-W", ["T-A1"], { kind: "start", startFor: ["JOB-WARRIOR"], effects: [] }),
  n("T-A1", ["T-A2", "T-HPGATE"]),
  n("T-A2", ["T-A3", "T-C1"]),
  n("T-A3", ["T-SWORD", "T-D1"]),
  n("T-SWORD", ["T-B1"], {
    kind: "gate",
    effects: [],
    gate: { conditions: [{ type: "equippedTag", tag: "TAG-WPNGRP-SWORD", slot: "mainHand" }] },
  }),
  n("T-B1", ["T-B2"], { kind: "notable", effects: ["EFF-T-ACC"] }),
  n("T-B2", []),
  n("T-C1", ["T-C2"]),
  n("T-C2", ["T-C3"]),
  n("T-C3", []),
  n("T-D1", ["T-D2"]),
  n("T-D2", ["T-R"]),
  n("T-R", [], { kind: "start", startFor: ["JOB-ROGUE"], effects: [], region: "jin" }),
  n("T-HPGATE", ["T-E1"], {
    kind: "gate",
    effects: [],
    gate: { conditions: [{ type: "statAtLeast", stat: "STAT-HP-MAX", value: 1000 }] },
  }),
  n("T-E1", [], { effects: ["EFF-T-HP-BIG"] }),
];
const CONSTS = [
  {
    id: "CONST-T",
    text: "test.const",
    nodes: ["T-C1", "T-C2", "T-C3"],
    completionEffect: "EFF-T-CONST",
  },
];

function testDb(nodes: unknown[] = NODES, consts: unknown[] = CONSTS): ContentDb {
  const raw: RawContent = {
    ...rawContent,
    texts: { ...rawContent.texts, "test.const": "テストの星座" },
    collections: {
      ...rawContent.collections,
      effects: [...rawContent.collections.effects, { file: "test-effects.json", entries: FX }],
      starNodes: [{ file: "test-nodes.json", entries: nodes }],
      constellations: [{ file: "test-consts.json", entries: consts }],
    },
  };
  const r = loadContent(raw);
  if (!r.ok) throw new Error(r.errors.map(formatContentError).join("\n"));
  return r.content;
}

const db = testDb();
const tags = new TagIndex(db.tags);
const W = startNodeOf(db, "JOB-WARRIOR");
const sword: ItemInstance = {
  uid: "sw",
  base: "BASE-WPN-LONGSWORD-T1",
  rarity: "normal",
  itemLevel: 1,
  affixes: [],
};
const axe: ItemInstance = { ...sword, uid: "ax", base: "BASE-WPN-AXE-T1" };

function evalWith(
  alloc: readonly string[],
  weapon?: ItemInstance,
  points = 99,
  rootJob = "JOB-WARRIOR",
) {
  const eq = new Equipment(db);
  if (weapon !== undefined) eq.equip(weapon, "mainHand", true);
  return evaluateStarBoard(db, tags, {
    allocation: alloc,
    points,
    rootJob,
    baseInstances: eq.effects(),
    facts: { equippedTags: eq.equippedTags(), baseStats: { "STAT-HP-MAX": 100 } },
  });
}

describe("星辰盤のデータの検証", () => {
  it("存在しないノードへのつながり・始点の無いジョブの重複・出どころの違う効果・星門の無い条件を誤りにする", () => {
    const bad = (nodes: unknown[], consts: unknown[] = []): string => {
      try {
        testDb(nodes, consts);
        return "ok";
      } catch (e) {
        return String(e);
      }
    };
    expect(bad([n("X", ["NONE"])])).toContain("unknown-ref");
    expect(bad([n("X", [], { effects: ["EFF-T-ACC"] })])).toContain("出どころ");
    expect(bad([n("X", [], { kind: "gate" })])).toContain("星門");
    expect(bad([n("X", [], { kind: "start", effects: [] })])).toContain("startFor");
    expect(
      bad([
        n("X", [], { kind: "start", startFor: ["JOB-WARRIOR"], effects: [] }),
        n("Y", [], { kind: "start", startFor: ["JOB-WARRIOR"], effects: [] }),
      ]),
    ).toContain("始点が2つ");
    expect(
      bad(
        [n("X", []), n("Y", [])],
        [{ id: "C", text: "test.const", nodes: ["X", "Y"], completionEffect: "EFF-T-HP" }],
      ),
    ).toContain("完成ボーナス");
    expect(bad([n("X", ["X"])])).toContain("自分自身");
  });

  it("つながりは向きを持たない（片方に書けば両方からたどれる）", () => {
    expect(db.starLinks.get("T-A1")?.has("T-W")).toBe(true);
    expect(db.starLinks.get("T-W")?.has("T-A1")).toBe(true);
  });
});

describe("取得と返却（仕様書v0.2 4.3・4.9.1）", () => {
  it("始点か取ったノードの隣だけ取れる。ポイントが無ければ取れない。始点・取ったノードは取れない", () => {
    const a = new StarAllocation(db);
    expect(a.allocateBlock("T-A2", W, 5)).toBe("notAdjacent");
    expect(a.allocate("T-A1", W, 5)).toBe(true);
    expect(a.allocateBlock("T-A1", W, 5)).toBe("taken");
    expect(a.allocateBlock("T-W", W, 5)).toBe("start");
    expect(a.allocate("T-A2", W, 2)).toBe(true);
    expect(a.allocateBlock("T-A3", W, 2)).toBe("points");
    expect(a.allocateBlock("NONE", W, 5)).toBe("unknown");
  });

  it("返すと始点からつながらなくなるノードがあれば、返せない。葉は返せる", () => {
    const a = new StarAllocation(db, ["T-A1", "T-A2", "T-A3"]);
    expect(a.canRefund("T-A2", W)).toBe(false);
    expect(a.canRefund("T-A3", W)).toBe(true);
    expect(a.refund("T-A3", W)).toBe(true);
    expect(a.refund("T-A3", W)).toBe(false);
    expect(a.nodes).toEqual(["T-A1", "T-A2"]);
  });

  it("不正な取得の記録は RangeError（データに無い・始点・重なり）", () => {
    expect(() => new StarAllocation(db, ["NONE"])).toThrow(RangeError);
    expect(() => new StarAllocation(db, ["T-W"])).toThrow(RangeError);
    expect(() => new StarAllocation(db, ["T-A1", "T-A1"])).toThrow(RangeError);
  });

  it("ポイント：キャラLv−1＋クエスト＋探索", () => {
    expect(starPoints(1)).toBe(0);
    expect(starPoints(20, 3, 1)).toBe(23);
    expect(() => starPoints(-1)).toThrow(RangeError);
  });
});

describe("評価：星門・休眠・星座・上限（仕様書v0.2 4.9・4.9.1）", () => {
  const path = ["T-A1", "T-A2", "T-A3", "T-SWORD", "T-B1", "T-B2"];

  it("装備を替えると、星門の先が休眠・復帰する（ポイントは使ったまま）", () => {
    const on = evalWith(path, sword);
    expect(on.active).toEqual(path);
    expect(on.gates.get("T-SWORD")).toBe(true);
    const off = evalWith(path, axe);
    expect(off.active).toEqual(["T-A1", "T-A2", "T-A3"]);
    expect(off.dormant.get("T-SWORD")).toMatchObject({ type: "gate", gate: "T-SWORD" });
    expect(off.dormant.get("T-B2")).toMatchObject({ type: "gate", gate: "T-SWORD" });
    expect(off.spent).toBe(6);
    // 戻すと元どおり
    expect(evalWith(path, sword).active).toEqual(path);
  });

  it("星門の条件は第1段階の値だけで判定する（門の先のノードの効果で門を開けない＝循環しない）", () => {
    const r = evalWith(["T-A1", "T-HPGATE", "T-E1"], sword);
    expect(r.gates.get("T-HPGATE")).toBe(false);
    expect(r.active).toEqual(["T-A1"]);
    expect(r.dormant.get("T-E1")).toMatchObject({ type: "gate", gate: "T-HPGATE" });
  });

  it("ポイントの上限を超えた分は、最後に取ったものから休眠する", () => {
    const r = evalWith(path, sword, 4);
    expect(r.active).toEqual(["T-A1", "T-A2", "T-A3", "T-SWORD"]);
    expect(r.dormant.get("T-B1")).toEqual({ type: "budget" });
    expect(r.dormant.get("T-B2")).toEqual({ type: "budget" });
  });

  it("始点（メインジョブ）からつながらないノードは休眠する（転職で始点が変わる）", () => {
    const r = evalWith(["T-A1", "T-A2"], sword, 99, "JOB-ROGUE");
    expect(r.active).toEqual([]);
    expect(r.dormant.get("T-A1")).toEqual({ type: "disconnected" });
  });

  it("星座は全て有効なら完成し、完成ボーナスの効果が出る", () => {
    const part = evalWith(["T-A1", "T-A2", "T-C1", "T-C2"]);
    expect(part.constellations).toEqual([]);
    const full = evalWith(["T-A1", "T-A2", "T-C1", "T-C2", "T-C3"]);
    expect(full.constellations).toEqual(["CONST-T"]);
    expect(full.effects.some((e) => e.effectId === "EFF-T-CONST")).toBe(true);
    // 上限で星座の一部が休眠すると、完成しない
    expect(evalWith(["T-A1", "T-A2", "T-C1", "T-C2", "T-C3"], undefined, 4).constellations).toEqual(
      [],
    );
  });

  it("有効なノードの効果は、出どころ starNode・ref はノードのID", () => {
    const r = evalWith(["T-A1"]);
    expect(r.effects).toEqual([
      { effectId: "EFF-T-HP", source: { kind: "starNode", ref: "T-A1" } },
    ]);
  });
});

describe("T9：ランダムな取得・返却・装備の着脱を繰り返しても、不変条件が保たれる", () => {
  const ids = [...db.starNodes.keys()].filter((id) => db.starNodes.get(id)?.kind !== "start");
  const op = fc.oneof(
    fc.record({ t: fc.constant("alloc" as const), node: fc.constantFrom(...ids) }),
    fc.record({ t: fc.constant("refund" as const), node: fc.constantFrom(...ids) }),
    fc.record({ t: fc.constant("weapon" as const), w: fc.constantFrom("sword", "axe", "none") }),
    fc.record({ t: fc.constant("points" as const), p: fc.integer({ min: 0, max: 15 }) }),
  );

  it("有効なノードは全て始点につながる／使ったポイントは上限以下で有効／同じ状態で2回評価すると同じ／休眠は条件が戻ると戻る", () => {
    fc.assert(
      fc.property(fc.array(op, { maxLength: 60 }), (ops) => {
        const a = new StarAllocation(db);
        let weapon: ItemInstance | undefined;
        let points = 10;
        for (const o of ops) {
          if (o.t === "alloc") a.allocate(o.node, W, points);
          else if (o.t === "refund") a.refund(o.node, W);
          else if (o.t === "weapon")
            weapon = o.w === "sword" ? sword : o.w === "axe" ? axe : undefined;
          else points = o.p;
          const r = evalWith(a.nodes, weapon, points);
          // 有効なノードの数は上限以下
          expect(r.active.length).toBeLessThanOrEqual(points);
          // 有効なノードは、有効なノードだけをたどって始点につながる
          const active = new Set(r.active);
          const seen = new Set<string>();
          const queue = W === undefined ? [] : [W];
          while (queue.length > 0) {
            const cur = queue.shift() as string;
            for (const next of db.starLinks.get(cur) ?? [])
              if (active.has(next) && !seen.has(next)) {
                seen.add(next);
                queue.push(next);
              }
          }
          expect([...active].every((x) => seen.has(x))).toBe(true);
          // 取ったノードは、有効か休眠のどちらか1つ
          expect(r.active.length + r.dormant.size).toBe(a.nodes.length);
          // 取得の記録は、全て始点からつながる（返却の規則）。上限を超えて取っていない分は、取った順に上限まで
          // 同じ状態で2回評価すると同じ
          const again = evalWith(a.nodes, weapon, points);
          expect(again.active).toEqual(r.active);
          expect([...again.dormant]).toEqual([...r.dormant]);
          expect(again.effects).toEqual(r.effects);
          // 剣を持てば、星門の理由の休眠は全て戻る（ポイント・つながりの休眠は残る）
          const withSword = evalWith(a.nodes, sword, points);
          for (const [id, why] of r.dormant)
            if (why.type === "gate" && why.gate === "T-SWORD")
              expect(withSword.active).toContain(id);
          // 能力値の評価も2回で同じ（順序に依らない）
          const eq = new Equipment(db);
          if (weapon !== undefined) eq.equip(weapon, "mainHand", true);
          const instances = [
            ...(weapon === undefined ? [] : itemEffectInstances(db, weapon)),
            ...r.effects,
          ];
          const v1 = evaluateEffects(db, tags, instances).view.stat("STAT-HP-MAX").value;
          const v2 = evaluateEffects(db, tags, [...instances].reverse()).view.stat(
            "STAT-HP-MAX",
          ).value;
          expect(v1).toBe(v2);
        }
      }),
      { numRuns: 200 },
    );
  });
});
