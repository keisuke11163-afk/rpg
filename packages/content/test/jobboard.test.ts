import {
  Equipment,
  Fighter,
  JobBoard,
  Purse,
  ROGUE_JOB,
  StarBoard,
  TagRegistry,
  WARRIOR_JOB,
  applyGaugeHooks,
  buildBoardContext,
  createCombatant,
  createFighter,
  createRng,
  createStandardJobs,
  doubleNearStart,
  evaluate,
  fromSave,
  jobRespecCost,
  newGameState,
  toSave,
  type ItemInstance,
} from "@stella/core";
import { describe, expect, it } from "vitest";
import { BOARD_DATA, GEAR_DATA, JOB_BOARDS, STAR_START_OF_JOB, TAG_DATA } from "../src/index.ts";

const tags = new TagRegistry(TAG_DATA);
const nameToId = new Map(TAG_DATA.map((t) => [t.name, t.id]));
const stats = { 剛: 30, 迅: 20, 理: 5, 魂: 5 };
let n = 0;
const item = (baseId: string): ItemInstance => ({
  uid: `j_${String(n++)}`,
  baseId,
  rarity: "normal",
  ilvl: 1,
  affixes: [],
  enhance: 0,
});
const board = (job: string): JobBoard => {
  const b = JOB_BOARDS[job];
  if (!b) throw new Error(job);
  return new JobBoard(b.data, b.start, job);
};
const idOf = (job: string, name: string): string => {
  const node = [...(JOB_BOARDS[job]?.data.nodes.values() ?? [])].find((x) => x.name === name);
  if (!node) throw new Error(name);
  return node.id;
};
/** 始点から target までを取る */
function take(jb: JobBoard, job: string, name: string, points = 99): void {
  const data = JOB_BOARDS[job]?.data;
  if (!data) throw new Error(job);
  const target = idOf(job, name);
  const prev = new Map<string, string>();
  const q = [JOB_BOARDS[job]?.start as string];
  const seen = new Set(q);
  while (q.length) {
    const id = q.shift() as string;
    for (const l of data.nodes.get(id)?.links ?? [])
      if (!seen.has(l)) {
        seen.add(l);
        prev.set(l, id);
        q.push(l);
      }
  }
  const path: string[] = [];
  for (let c: string | undefined = target; c && c !== JOB_BOARDS[job]?.start; c = prev.get(c))
    path.unshift(c);
  for (const id of path) if (!jb.board.has(id)) expect(jb.allocate(id, points).ok).toBe(true);
}
const bc = (eq = new Equipment(), extra: string[] = []) =>
  buildBoardContext(eq, GEAR_DATA, { tags, characterStats: stats, flags: extra });

describe("職紋盤のデータ", () => {
  it("戦士・盗賊それぞれ、小星15（輝星含む）・職奥義3・接続3", () => {
    for (const job of ["JOB-WARRIOR", "JOB-ROGUE"]) {
      const nodes = [...(JOB_BOARDS[job]?.data.nodes.values() ?? [])];
      expect(nodes.filter((x) => x.type === "職奥義")).toHaveLength(3);
      expect(nodes.filter((x) => x.type === "接続")).toHaveLength(3);
      const regular = nodes.filter((x) => x.type === "小星" || x.type === "輝星");
      expect(regular.length).toBeGreaterThanOrEqual(14);
      expect(regular.length).toBeLessThanOrEqual(20);
    }
  });
  it("星辰盤のデータには職紋盤のノードが混ざらない", () => {
    expect([...BOARD_DATA.nodes.keys()].some((id) => id.startsWith("JNODE-"))).toBe(false);
  });
});

describe("職奥義は3つから1つ", () => {
  it("2つ目は取れない。外せば別のものを選べる", () => {
    const jb = board("JOB-WARRIOR");
    take(jb, "JOB-WARRIOR", "不屈の闘志");
    expect(jb.mastery).toBe(idOf("JOB-WARRIOR", "不屈の闘志"));
    const other = idOf("JOB-WARRIOR", "怒涛");
    expect(
      jb.canAllocate(other, 99).reason === "masteryTaken" ||
        jb.canAllocate(other, 99).reason === "notAdjacent",
    ).toBe(true);
    jb.clearMastery();
    expect(jb.mastery).toBeUndefined();
    take(jb, "JOB-WARRIOR", "怒涛");
    expect(jb.mastery).toBe(other);
    expect(jb.allocate(idOf("JOB-WARRIOR", "鬼神化"), 99).ok).toBe(false);
  });
});

describe("ジョブごとの配置とポイント", () => {
  it("ポイントはジョブLv 2〜20で19（ジョブごと）。転職すると職紋盤が切り替わり、配置はジョブごとに残る", () => {
    const registry = createStandardJobs();
    const state = newGameState(registry, "T", "JOB-WARRIOR");
    state.progression.character.level = 15;
    state.progression.jobState("JOB-WARRIOR").level = 6;
    const boards = { "JOB-WARRIOR": board("JOB-WARRIOR"), "JOB-ROGUE": board("JOB-ROGUE") };
    take(
      boards["JOB-WARRIOR"],
      "JOB-WARRIOR",
      "闘志の炉",
      state.progression.jobPoints("JOB-WARRIOR"),
    );
    expect(boards["JOB-WARRIOR"].pointsUsed).toBe(1);
    state.progression.changeJob("JOB-ROGUE");
    expect(state.progression.jobPoints("JOB-ROGUE")).toBe(0);
    expect(
      boards["JOB-ROGUE"].allocate(
        idOf("JOB-ROGUE", "毒血同源"),
        state.progression.jobPoints("JOB-ROGUE"),
      ).reason,
    ).toBe("points");
    state.progression.changeJob("JOB-WARRIOR");
    expect(boards["JOB-WARRIOR"].pointsUsed).toBe(1);
    expect(boards["JOB-ROGUE"].pointsUsed).toBe(0);
  });
  it("振り直しは 20×ジョブLv の金貨。足りなければ何も変えない", () => {
    const jb = board("JOB-WARRIOR");
    take(jb, "JOB-WARRIOR", "闘志の炉");
    const purse = new Purse();
    purse.gold = 59;
    expect(jobRespecCost(3)).toBe(60);
    expect(jb.respec(3, purse)).toBe(false);
    expect(jb.pointsUsed).toBe(1);
    purse.gold = 60;
    expect(jb.respec(3, purse)).toBe(true);
    expect(jb.pointsUsed).toBe(0);
    expect(purse.gold).toBe(0);
  });
  it("セーブして読み込むと、ジョブごとの配置と職奥義が戻る", () => {
    const registry = createStandardJobs();
    const state = newGameState(registry, "T", "JOB-WARRIOR");
    const jb = board("JOB-WARRIOR");
    take(jb, "JOB-WARRIOR", "鬼神化");
    state.jobBoards["JOB-WARRIOR"] = jb.snapshot();
    const loaded = fromSave(toSave(state), registry, GEAR_DATA);
    const restored = board("JOB-WARRIOR");
    restored.restore(loaded.jobBoards["JOB-WARRIOR"]?.allocation ?? []);
    expect(restored.allocated).toEqual(jb.allocated);
    expect(restored.mastery).toBe(idOf("JOB-WARRIOR", "鬼神化"));
    expect(loaded.jobBoards["JOB-WARRIOR"]?.mastery).toBe(idOf("JOB-WARRIOR", "鬼神化"));
  });
});

describe("職奥義・職紋盤のノードが、それぞれ動く", () => {
  const hooksOf = (jb: JobBoard) => {
    const ev = jb.evaluate(99, bc());
    return evaluate(ev.effects, bc().ctx).hooks();
  };
  it("戦士：闘志の炉（自然減少-50%）・血を燃やす（被弾の獲得×2）", () => {
    const jb = board("JOB-WARRIOR");
    take(jb, "JOB-WARRIOR", "闘志の炉");
    take(jb, "JOB-WARRIOR", "血を燃やす");
    const f = createFighter(WARRIOR_JOB, {
      maxHp: 100,
      maxMp: 100,
      weaponKey: "greatsword",
      weaponClass: "greatsword",
      jobLevel: 1,
    });
    applyGaugeHooks(f.gauge, hooksOf(jb));
    expect(f.gauge.mods.decayMultiplier).toBe(0.5);
    expect(f.gauge.mods.damagedGainMultiplier).toBe(2);
    f.gauge.add(50);
    f.gauge.tick(5);
    f.gauge.tick(2);
    expect(f.gauge.value).toBeCloseTo(45);
  });
  it("戦士：不屈の闘志（30より下がらない）・鬼神化（常に激化・解放技は使えない）", () => {
    const a = board("JOB-WARRIOR");
    take(a, "JOB-WARRIOR", "不屈の闘志");
    const f = createFighter(WARRIOR_JOB, {
      maxHp: 100,
      maxMp: 100,
      weaponKey: "greatsword",
      weaponClass: "greatsword",
      jobLevel: 12,
    });
    applyGaugeHooks(f.gauge, hooksOf(a));
    f.gauge.add(100);
    f.gauge.consume();
    expect(f.gauge.value).toBe(30);
    f.gauge.tick(60);
    expect(f.gauge.value).toBe(30);
    const b = board("JOB-WARRIOR");
    take(b, "JOB-WARRIOR", "鬼神化");
    applyGaugeHooks(f.gauge, hooksOf(b));
    f.gauge.mods = {};
    expect(f.gauge.forceIntensified).toBe(true);
    expect(f.gauge.releaseDisabled).toBe(true);
    f.gauge.add(100);
    expect(f.canUse("SKL-WAR-RUIN").reason).toBe("gauge");
    const c = board("JOB-WARRIOR");
    take(c, "JOB-WARRIOR", "怒涛");
    expect(hooksOf(c).some((h) => h.hook === "解放後のCD短縮")).toBe(true);
  });
  it("盗賊：無限連撃でコンボ点の最大値+3", () => {
    const jb = board("JOB-ROGUE");
    take(jb, "JOB-ROGUE", "無限連撃");
    const f = createFighter(ROGUE_JOB, {
      maxHp: 100,
      maxMp: 100,
      weaponKey: "dagger",
      weaponClass: "dagger",
      jobLevel: 12,
    });
    applyGaugeHooks(f.gauge, hooksOf(jb));
    expect(f.gauge.max).toBe(8);
    f.gauge.add(20);
    expect(f.gauge.value).toBe(8);
  });
  it("盗賊：毒血同源は、出血を毒として数える挙動を持つ。影法師は背面判定が全方向", () => {
    const jb = board("JOB-ROGUE");
    take(jb, "JOB-ROGUE", "毒血同源");
    const h = hooksOf(jb).find((x) => x.hook === "別の異常として数える");
    expect(h?.params).toEqual({ from: "TAG-AIL-BLEED", to: "TAG-AIL-POISON" });
    const s = board("JOB-ROGUE");
    take(s, "JOB-ROGUE", "影法師");
    expect(hooksOf(s).some((x) => x.hook === "背面判定が全方向")).toBe(true);
  });
  it("戦士：両手の誇り（両手武器のとき崩し値+25%）。片手では効かない", () => {
    const jb = board("JOB-WARRIOR");
    take(jb, "JOB-WARRIOR", "両手の誇り");
    const brk = (weapon: string): number => {
      const eq = new Equipment();
      eq.equip(item(weapon), GEAR_DATA);
      const ctx = buildBoardContext(eq, GEAR_DATA, { tags, characterStats: stats });
      return evaluate(jb.evaluate(99, ctx).effects, ctx.ctx).stat({ stat: "崩し値" }, 0).addPct;
    };
    expect(brk("BASE-WPN-GREATSWORD-T1")).toBeCloseTo(0.25);
    expect(brk("BASE-WPN-LONGSWORD-T1")).toBeCloseTo(0);
  });
});

describe("ヒットの瞬間の状態で変わる効果（崩しの達人・静かなる刃）", () => {
  const withBoard = (
    job: string,
    jobDef: typeof WARRIOR_JOB,
    names: string[],
    weaponKey: string,
    wc: "greatsword" | "dagger",
  ): { f: Fighter } => {
    const jb = board(job);
    for (const nm of names) take(jb, job, nm);
    const eq = new Equipment();
    const ctx = buildBoardContext(eq, GEAR_DATA, { tags, characterStats: stats });
    const ev = jb.evaluate(99, ctx);
    const f = createFighter(jobDef, {
      maxHp: 100,
      maxMp: 100,
      weaponKey,
      weaponClass: wc,
      jobLevel: 12,
    });
    f.setEffectSource(ev.effects, ctx.ctx, (s) =>
      tags.expand(s.tags.map((t) => nameToId.get(t)).filter((x): x is string => x !== undefined)),
    );
    return { f };
  };
  it("崩しの達人：崩れた敵への職技ダメージ+25%", () => {
    const { f } = withBoard("JOB-WARRIOR", WARRIOR_JOB, ["崩しの達人"], "greatsword", "greatsword");
    const eff = f.effective(WARRIOR_JOB.skills[0] as never);
    const spec = f.hitSpec(eff, createRng(1));
    const foe = createCombatant({ id: "E", pos: { x: 1, y: 0 }, maxHp: 1000 });
    expect(spec.targetBonus?.(foe).addPct).toBeCloseTo(0);
    foe.breakGauge.add(1e9);
    expect(spec.targetBonus?.(foe).addPct).toBeCloseTo(0.25);
  });
  it("静かなる刃：戦闘外からの最初の一撃だけ×3（乗算）。2撃目からは通常", () => {
    const { f } = withBoard("JOB-ROGUE", ROGUE_JOB, ["静かなる刃"], "dagger", "dagger");
    f.gauge.tick(10); // 戦闘外
    const foe = createCombatant({ id: "E", pos: { x: 1, y: 0 }, maxHp: 1e7, facing: 0 });
    const d1 = f.use("SKL-ROG-FLURRY", { x: 0, y: 0 }, 0, [foe], createRng(1));
    const first = d1.hits[0]?.result.damage ?? 0;
    f.mp = 100;
    f.tick(0.5);
    const second =
      f.use("SKL-ROG-FLURRY", { x: 0, y: 0 }, 0, [foe], createRng(1)).hits[0]?.result.damage ?? 0;
    expect(first / second).toBeGreaterThan(2.5);
    expect(first / second).toBeLessThan(3.5);
  });
});

describe("接続ノード：星辰盤の始点の周りの小星が×2", () => {
  it("半径3ノード以内の小星の効果が2倍。それより遠い小星・輝星は変わらない。何個取っても×2", () => {
    const startId = STAR_START_OF_JOB["JOB-WARRIOR"] as string;
    const star = new StarBoard(BOARD_DATA, startId);
    // 始点から4ノード先まで取る
    let cur = startId;
    const chain: string[] = [];
    for (let i = 0; i < 4; i++) {
      const next = BOARD_DATA.nodes
        .get(cur)
        ?.links.find(
          (l) =>
            BOARD_DATA.nodes.get(l)?.type === "小星" &&
            !star.has(l) &&
            !chain.includes(l) &&
            l !== startId,
        );
      if (!next) break;
      star.allocate(next, 99);
      chain.push(next);
      cur = next;
    }
    expect(chain.length).toBe(4);
    const ev = star.evaluate(99, bc());
    const plain = ev.effects.map((e) =>
      e.effect.modifiers.map((m) => ("value" in m ? m.value : 0)),
    );
    const doubled = doubleNearStart(BOARD_DATA, ev, startId, 3, 2).map((e) =>
      e.effect.modifiers.map((m) => ("value" in m ? m.value : 0)),
    );
    for (let i = 0; i < 3; i++)
      expect(doubled[i]).toEqual((plain[i] as number[]).map((v) => v * 2));
    expect(doubled[3]).toEqual(plain[3]);
    // 接続ノードの有効判定
    const jb = board("JOB-WARRIOR");
    expect(jb.connectionActive(jb.evaluate(99, bc()))).toBe(false);
    take(jb, "JOB-WARRIOR", "星辰盤への接続 1");
    expect(jb.connectionActive(jb.evaluate(99, bc()))).toBe(true);
  });
});
