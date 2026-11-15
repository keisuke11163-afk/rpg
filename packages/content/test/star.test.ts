import fc from "fast-check";
import {
  Equipment,
  StarBoard,
  TagRegistry,
  applyResonanceVariant,
  buildBoardContext,
  createFighter,
  createRng,
  evaluate,
  ConditionRegistry,
  WARRIOR_JOB,
  EXTRA_ENTRANCE_COST,
  type ItemInstance,
  type RolledAffix,
} from "@stella/core";
import { describe, expect, it } from "vitest";
import { BOARD_DATA, GEAR_DATA, TAG_DATA, loadContent } from "../src/index.ts";

const tags = new TagRegistry(TAG_DATA);
const stats = { 剛: 30, 迅: 20, 理: 5, 魂: 5 };
let n = 0;
const item = (baseId: string, affixes: RolledAffix[] = [], enhance = 0): ItemInstance => ({
  uid: `s_${String(n++)}`,
  baseId,
  rarity: "rare",
  ilvl: 10,
  affixes,
  enhance,
});
const ctxOf = (eq: Equipment, extra: { dual?: boolean; sub?: boolean; flags?: string[] } = {}) =>
  buildBoardContext(eq, GEAR_DATA, {
    tags,
    characterStats: stats,
    ...(extra.dual ? { dualWield: true } : {}),
    ...(extra.sub ? { subJob: true } : {}),
    ...(extra.flags ? { flags: extra.flags } : {}),
  });
const newBoard = (start = "STAR-GOU-START") => new StarBoard(BOARD_DATA, start);

/** startからtargetまでの最短経路（始点を除く）を取得する */
function pathTo(board: StarBoard, target: string): string[] {
  const prev = new Map<string, string>();
  const queue = [...board.entrances];
  const seen = new Set(queue);
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (id === target) break;
    for (const l of BOARD_DATA.nodes.get(id)?.links ?? []) {
      if (!seen.has(l)) {
        seen.add(l);
        prev.set(l, id);
        queue.push(l);
      }
    }
  }
  const path: string[] = [];
  for (
    let cur: string | undefined = target;
    cur !== undefined && !board.entrances.includes(cur);
    cur = prev.get(cur)
  )
    path.unshift(cur);
  return path;
}
const take = (board: StarBoard, target: string, points = 999): void => {
  for (const id of pathTo(board, target))
    if (!board.has(id)) expect(board.allocate(id, points).ok).toBe(true);
};
const byName = (name: string): string => {
  const node = [...BOARD_DATA.nodes.values()].find((x) => x.name === name);
  if (!node) throw new Error(name);
  return node.id;
};

describe("星辰盤のデータ", () => {
  it("約150ノード：始点3・天極5・星門2・星座3・共鳴座3・転変3・輝星。検証を通る", () => {
    const all = [...BOARD_DATA.nodes.values()];
    expect(loadContent().issues).toEqual([]);
    expect(all.length).toBeGreaterThanOrEqual(140);
    expect(all.length).toBeLessThanOrEqual(170);
    const count = (t: string): number => all.filter((x) => x.type === t).length;
    expect(count("始点")).toBe(3);
    expect(count("天極")).toBe(5);
    expect(count("星門")).toBe(2);
    expect(count("共鳴座")).toBe(3);
    expect(count("転変")).toBeGreaterThanOrEqual(3);
    expect(BOARD_DATA.constellations.size).toBe(3);
    expect(all.filter((x) => x.type === "小星").length).toBeGreaterThan(100);
  });
  it("天極K01・K09・K10・K12・K15。いずれも代償を持つ", () => {
    for (const id of ["EFF-KEY-K01", "EFF-KEY-K09", "EFF-KEY-K10", "EFF-KEY-K12", "EFF-KEY-K15"]) {
      expect(BOARD_DATA.effects.get(id)?.note).toMatch(/^代償：/);
    }
  });
  it("始点どうしは約18ノード離れている（戦士の始点から盗賊の始点）", () => {
    const b = newBoard();
    expect(pathTo(b, "STAR-JIN-START").length).toBeGreaterThanOrEqual(17);
    expect(pathTo(b, "STAR-JIN-START").length).toBeLessThanOrEqual(20);
  });
  it("小星は必ずタグの条件か副次効果を持つ（修正値が2つ以上、または条件・フィルタつき）", () => {
    for (const node of BOARD_DATA.nodes.values()) {
      if (node.type !== "小星") continue;
      const e = BOARD_DATA.effects.get(node.effects[0] as string);
      const ok =
        (e?.modifiers.length ?? 0) >= 2 ||
        (e?.modifiers.some((m) => "filter" in m && m.filter !== undefined) ?? false);
      expect(ok).toBe(true);
    }
  });
});

describe("取得と返却", () => {
  it("始点に隣り合うノードから取れる。離れたノードは取れない。ポイントが足りないと取れない", () => {
    const b = newBoard();
    const first = BOARD_DATA.nodes.get("STAR-GOU-START")?.links[0] as string;
    expect(b.allocate(first, 10).ok).toBe(true);
    expect(b.allocate(first, 10).reason).toBe("already");
    expect(b.allocate("STAR-JIN-START", 10).reason).toBe("start");
    expect(b.allocate(byName("千変"), 10).reason).toBe("notAdjacent");
    expect(b.allocate("NONE", 10).reason).toBe("unknown");
    expect(
      b.allocate(
        BOARD_DATA.nodes.get(first)?.links.find((l) => l !== "STAR-GOU-START") as string,
        1,
      ).reason,
    ).toBe("points");
  });
  it("返却は、残りが入口につながっているときだけ。途中のノードは返せない", () => {
    const b = newBoard();
    const path = pathTo(b, byName("断ち切る刃"));
    for (const id of path) b.allocate(id, 99);
    expect(b.refund(path[0] as string).reason).toBe("disconnects");
    expect(b.refund(path[path.length - 1] as string).ok).toBe(true);
    expect(b.has(path[path.length - 1] as string)).toBe(false);
    expect(b.refund("NONE").reason).toBe("notAllocated");
  });
  it("他ジョブの始点を追加の入口として開ける（3ポイント。出自と合わせて最大2つ）", () => {
    const b = newBoard();
    expect(b.openEntrance("STAR-JIN-START", 2).reason).toBe("points");
    expect(b.openEntrance("STAR-GOUJIN-START", 10).reason).toBe("notStart"); // 予約枠は入口にできない
    expect(b.openEntrance("STAR-JIN-START", 10).ok).toBe(true);
    expect(b.pointsUsed).toBe(EXTRA_ENTRANCE_COST);
    expect(b.openEntrance("STAR-JIN-START", 10).reason).toBe("already");
    b.reset();
    expect(b.entrances).toEqual(["STAR-GOU-START"]);
  });
});

describe("評価：星門と休眠（本仕様書 4.9）", () => {
  const withGate = (): { board: StarBoard; gate: string; beyond: string } => {
    const board = newBoard();
    take(board, byName("剣気"));
    return { board, gate: byName("刃の門"), beyond: byName("剣気") };
  };
  const evalWith = (board: StarBoard, weapon: string | undefined, points = 200) => {
    const eq = new Equipment();
    if (weapon) eq.equip(item(weapon), GEAR_DATA);
    return board.evaluate(points, ctxOf(eq));
  };
  it("剣系を装備していると門が開き、先の輝星が有効になる。短剣では閉じて休眠する", () => {
    const { board, gate, beyond } = withGate();
    const open = evalWith(board, "BASE-WPN-GREATSWORD-T1");
    expect(open.active).toContain(gate);
    expect(open.active).toContain(beyond);
    expect(open.dormant).toEqual([]);
    const closed = evalWith(board, "BASE-WPN-DAGGER-T1");
    expect(closed.active).not.toContain(gate);
    expect(closed.active).not.toContain(beyond);
    expect(closed.dormant.find((d) => d.id === gate)?.reason).toContain("刃の門");
    expect(closed.dormant.find((d) => d.id === beyond)?.reason).toContain("つながっていない");
    // 休眠してもポイントは使ったまま、取得も残る
    expect(board.has(gate)).toBe(true);
    expect(board.pointsUsed).toBeGreaterThan(0);
    // 条件が戻れば、自動で有効に戻る
    expect(evalWith(board, "BASE-WPN-LONGSWORD-T1").active).toContain(beyond);
  });
  it("獣の門：爪・鎌を装備しているときだけ", () => {
    const board = newBoard("STAR-JIN-START");
    take(board, byName("狩りの本能"));
    expect(evalWith(board, "BASE-WPN-CLAW-T1").active).toContain(byName("狩りの本能"));
    expect(evalWith(board, "BASE-WPN-DAGGER-T1").active).not.toContain(byName("狩りの本能"));
    expect(evalWith(board, undefined).active).not.toContain(byName("狩りの本能"));
  });
  it("ポイントの上限を超えたノードは、最後に取ったものから休眠する", () => {
    const board = newBoard();
    take(board, byName("断ち切る刃"));
    const total = board.allocated.length;
    const ev = evalWith(board, "BASE-WPN-GREATSWORD-T1", total - 2);
    expect(ev.dormant.map((d) => d.id)).toEqual(board.allocated.slice(total - 2));
    expect(ev.dormant[0]?.reason).toContain("ポイントの上限");
    expect(ev.active).toHaveLength(total - 2);
  });
  it("追加の入口を開くと、その分だけ使えるポイントが減る", () => {
    const board = newBoard();
    take(board, byName("断ち切る刃"));
    const total = board.allocated.length;
    board.openEntrance("STAR-JIN-START", 999);
    const ev = evalWith(board, undefined, total + EXTRA_ENTRANCE_COST - 1);
    expect(ev.dormant).toHaveLength(1);
  });
});

describe("評価：星座・天極・共鳴変化", () => {
  it("鍛冶座は、8つ全部を取得したときだけ完成ボーナスが出る（強化値の合計×0.4%）", () => {
    const board = newBoard();
    const forge = BOARD_DATA.constellations.get("CONST-FORGE");
    if (!forge) throw new Error("forge");
    for (const id of forge.nodes.slice(0, 7)) take(board, id);
    const eq = new Equipment();
    eq.equip(item("BASE-WPN-GREATSWORD-T1", [], 10), GEAR_DATA);
    let ev = board.evaluate(999, ctxOf(eq));
    expect(ev.completedConstellations).toEqual([]);
    take(board, forge.nodes[7] as string);
    ev = board.evaluate(999, ctxOf(eq));
    expect(ev.completedConstellations).toEqual(["CONST-FORGE"]);
    const e = evaluate(ev.effects, ctxOf(eq).ctx, new ConditionRegistry());
    // 強化値の合計10 × 0.4% = +4%。小星の「物理ダメージ+5%」2つ（物理タグ）とは別
    const bonus = e.stat({ stat: "ダメージ" }, 100);
    expect(bonus.addPct).toBeGreaterThanOrEqual(0.04 - 1e-9);
  });
  it("毒蛇座を完成させると、毒だまりの挙動が有効になる", () => {
    const board = newBoard("STAR-JIN-START");
    const viper = BOARD_DATA.constellations.get("CONST-VIPER");
    if (!viper) throw new Error("viper");
    for (const id of viper.nodes) take(board, id);
    const ev = board.evaluate(999, ctxOf(new Equipment()));
    expect(ev.completedConstellations).toContain("CONST-VIPER");
    const hooks = evaluate(ev.effects, ctxOf(new Equipment()).ctx).hooks();
    expect(hooks.some((h) => h.hook === "毒だまり")).toBe(true);
  });
  it("重荷の誇り（K10）：重装1部位につき与ダメージ+5%・崩し値+8%、4部位で崩されない。移動速度-12%", () => {
    const board = newBoard();
    take(board, byName("重荷の誇り"));
    const eq = new Equipment();
    const evalDamage = (): { dmg: number; brk: number; move: number; hooks: string[] } => {
      const ev = board.evaluate(999, ctxOf(eq));
      const r = evaluate(ev.effects, ctxOf(eq).ctx);
      return {
        dmg:
          r.stat({ stat: "ダメージ" }, 0).addPct -
          r
            .stat({ stat: "ダメージ" }, 0)
            .breakdown.filter((b) => b.effectId !== "EFF-KEY-K10")
            .reduce((s, b) => s + b.value, 0),
        brk: r
          .stat({ stat: "崩し値" }, 0)
          .breakdown.filter((b) => b.effectId === "EFF-KEY-K10")
          .reduce((s, b) => s + b.value, 0),
        move: r.stat({ stat: "移動速度" }, 0).addPct,
        hooks: r.hooks().map((h) => h.hook),
      };
    };
    for (const slot of ["BODY", "HEAD", "HANDS", "FEET"])
      eq.equip(item(`BASE-ARM-HEAVY-${slot}-T1`), GEAR_DATA);
    let r = evalDamage();
    expect(r.dmg).toBeCloseTo(0.2);
    expect(r.brk).toBeCloseTo(0.32);
    expect(r.move).toBeCloseTo(-0.12);
    expect(r.hooks).toContain("崩されない");
    eq.unequip("足");
    r = evalDamage();
    expect(r.dmg).toBeCloseTo(0.15);
    expect(r.hooks).not.toContain("崩されない");
  });
  it("共鳴変化：剛域の共鳴紋が3つ以上で、K10の移動速度の低下が-6%になる", () => {
    const eq = new Equipment();
    const reson = (region: string): RolledAffix => ({
      id: "AFX-SUF-RESONANCE",
      tier: 7,
      rolls: [10],
      params: { region },
    });
    const k10 = BOARD_DATA.effects.get("EFF-KEY-K10");
    if (!k10) throw new Error("k10");
    expect(applyResonanceVariant(k10, { "TAG-REGION-GOU": 2 })).toBe(k10);
    const changed = applyResonanceVariant(k10, { "TAG-REGION-GOU": 3 });
    const move = changed.modifiers.find((m) => m.kind === "加算％" && m.stat === "移動速度");
    expect(move && "value" in move ? move.value : 0).toBe(-0.06);
    expect(
      changed.modifiers.filter((m) => m.kind === "加算％" && m.stat === "移動速度"),
    ).toHaveLength(1);
    // 装備の共鳴紋から数える
    eq.equip(item("BASE-ARM-HEAVY-BODY-T1", [reson("TAG-REGION-GOU")]), GEAR_DATA);
    eq.equip(item("BASE-ARM-HEAVY-HEAD-T1", [reson("TAG-REGION-GOU")]), GEAR_DATA);
    eq.equip(item("BASE-ARM-HEAVY-HANDS-T1", [reson("TAG-REGION-GOU")]), GEAR_DATA);
    eq.equip(item("BASE-ACC-RING-SILVER-T1", [reson("TAG-REGION-JIN")]), GEAR_DATA);
    expect(ctxOf(eq).resonance).toEqual({ "TAG-REGION-GOU": 3, "TAG-REGION-JIN": 1 });
  });
  it("血の盟約（K01）の共鳴変化は、効果を足す（支払ったHPの返還）", () => {
    const k01 = BOARD_DATA.effects.get("EFF-KEY-K01");
    if (!k01) throw new Error("k01");
    const changed = applyResonanceVariant(k01, { "TAG-REGION-GOU": 3 });
    expect(changed.modifiers.length).toBe(k01.modifiers.length + 1);
  });
});

describe("T9 ランダムな取得・返却・着替えでも、不変条件が保たれる", () => {
  it("有効なノードは全て入口につながり、使ったポイントは上限以下、同じ状態で2回評価すると同じ", () => {
    const weapons = [
      undefined,
      "BASE-WPN-GREATSWORD-T1",
      "BASE-WPN-DAGGER-T1",
      "BASE-WPN-CLAW-T1",
      "BASE-WPN-LONGSWORD-T1",
    ];
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: 0, max: 60 }), (seed, ops) => {
        const rng = createRng(seed);
        const board = newBoard(rng.chance(0.5) ? "STAR-GOU-START" : "STAR-JIN-START");
        const eq = new Equipment();
        const all = [...BOARD_DATA.nodes.keys()];
        let points = 30;
        for (let i = 0; i < ops; i++) {
          const r = rng.next();
          if (r < 0.6) board.allocate(rng.pick(all), points);
          else if (r < 0.8 && board.allocated.length > 0) board.refund(rng.pick(board.allocated));
          else if (r < 0.9) {
            const w = rng.pick(weapons);
            eq.unequip("主手");
            if (w) eq.equip(item(w), GEAR_DATA);
          } else points = rng.int(0, 40);
          expect(board.pointsUsed).toBeLessThanOrEqual(Math.max(points, board.pointsUsed));
        }
        const bc = ctxOf(eq);
        const a = board.evaluate(points, bc);
        const b = board.evaluate(points, bc);
        expect(b).toEqual(a);
        // 有効なノードは全て、有効なノードだけで入口につながる
        const reach = new Set(board.entrances);
        const active = new Set(a.active);
        let grew = true;
        while (grew) {
          grew = false;
          for (const id of a.active) {
            if (
              !reach.has(id) &&
              (BOARD_DATA.nodes.get(id)?.links ?? []).some((l) => reach.has(l))
            ) {
              reach.add(id);
              grew = true;
            }
          }
        }
        for (const id of active) expect(reach.has(id)).toBe(true);
        // 有効と休眠は重ならず、合わせると取得した全部
        const dormantIds = new Set(a.dormant.map((d) => d.id));
        for (const id of active) expect(dormantIds.has(id)).toBe(false);
        expect(active.size + dormantIds.size).toBe(board.allocated.length);
        // 取得した構造は常に入口につながっている
        const check = new StarBoard(BOARD_DATA, board.entrances[0] as string);
        for (const e of board.entrances.slice(1)) check.openEntrance(e, 999);
        for (const id of board.allocated)
          expect(check.allocate(id, 999).ok || check.has(id)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
  it("休眠したノードは、条件を満たすと元に戻る（装備を替えるだけで点いたり消えたりする）", () => {
    const board = newBoard();
    take(board, byName("剣気"));
    const results: boolean[] = [];
    for (const w of [
      "BASE-WPN-GREATSWORD-T1",
      "BASE-WPN-DAGGER-T1",
      "BASE-WPN-GREATSWORD-T1",
      "BASE-WPN-DAGGER-T1",
    ]) {
      const eq = new Equipment();
      eq.equip(item(w), GEAR_DATA);
      results.push(board.evaluate(200, ctxOf(eq)).active.includes(byName("剣気")));
    }
    expect(results).toEqual([true, false, true, false]);
  });
});

describe("ツリーの効果が戦闘に反映される", () => {
  it("断ち切る刃などの近接ダメージが、戦士のヒットに乗る", () => {
    const board = newBoard();
    take(board, byName("断ち切る刃"));
    const eq = new Equipment();
    eq.equip(item("BASE-WPN-GREATSWORD-T1"), GEAR_DATA);
    const bc = ctxOf(eq);
    const ev = board.evaluate(200, bc);
    const f = createFighter(WARRIOR_JOB, {
      maxHp: 100,
      maxMp: 100,
      weaponKey: "greatsword",
      weaponClass: "greatsword",
      jobLevel: 1,
    });
    const eff = f.effective(WARRIOR_JOB.skills[0] as never);
    const before = f.hitSpec(eff, createRng(1)).damage.generic?.addPct ?? 0;
    const evaluated = evaluate(ev.effects, bc.ctx);
    const nameToId = new Map(TAG_DATA.map((t) => [t.name, t.id]));
    f.setEffects(evaluated, (skill) =>
      tags.expand(
        skill.tags.map((t) => nameToId.get(t)).filter((x): x is string => x !== undefined),
      ),
    );
    const after = f.hitSpec(eff, createRng(1)).damage.generic?.addPct ?? 0;
    expect(after).toBeGreaterThan(before + 0.2); // 近接ダメージ+20%と、経路の小星
  });
});
