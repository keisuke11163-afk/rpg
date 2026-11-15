/**
 * 職奥義（仕様書v0.2 5.3・5.4・5.5）：鉄の守り・断罪者（騎士）、単相の極み・無詠唱（魔法使い）、一体入魂・死の循環（召喚士）。
 * 効く条件・効かない条件・境界値。docs/progress/sessions/job-ultimates.md
 *
 * 職紋盤のつながりは作り直しの途中なので、始点から職奥義までの道は、データのつながり（jobLinks）からその場で探す。
 */
import { describe, expect, it } from "vitest";
import { FIXED_STEP_SECONDS, TagIndex } from "@stella/core";
import { loadGameContent } from "@stella/content";
import type { Action } from "../src/input/actions.ts";
import type { InputFrame } from "../src/input/frame.ts";
import {
  ArenaSimulation,
  DUMMY_POSITION,
  newCharacterProfile,
} from "../src/scenes/arena-simulation.ts";
import { toPixels } from "../src/world/units.ts";

const STEP = FIXED_STEP_SECONDS;
const db = loadGameContent();

function simOf(job: string, seed = "ult", enemies = false): ArenaSimulation {
  const sim = new ArenaSimulation(undefined, {
    db,
    enemies,
    rngSeed: seed,
    profile: newCharacterProfile(db, job, "試験"),
  });
  sim.gainXp(1e9);
  return sim;
}

/**
 * 始点から職奥義までの最短の道（ほかの職奥義を通らない）を取る。take=false なら職奥義の手前までを取る
 * （道の途中の小さなノードの効果をそろえて、職奥義だけの差を比べるため）。
 */
function takeMastery(sim: ArenaSimulation, nodeId: string, take = true): void {
  const target = db.jobNodes.get(nodeId);
  if (target === undefined) throw new Error(`${nodeId} が無い`);
  const start = [...db.jobNodes.values()].find((n) => n.job === target.job && n.kind === "start");
  if (start === undefined) throw new Error("始点が無い");
  const prev = new Map<string, string>([[start.id, start.id]]);
  const queue = [start.id];
  while (queue.length > 0 && !prev.has(nodeId)) {
    const cur = queue.shift() as string;
    for (const next of db.jobLinks.get(cur) ?? []) {
      if (prev.has(next)) continue;
      const kind = db.jobNodes.get(next)?.kind;
      if (kind === "mastery" && next !== nodeId) continue;
      prev.set(next, cur);
      queue.push(next);
    }
  }
  const path: string[] = [];
  for (let cur = nodeId; cur !== start.id; cur = prev.get(cur) as string) {
    if (!prev.has(cur)) throw new Error(`${nodeId} に届かない`);
    path.unshift(cur);
  }
  if (!take) path.pop();
  for (const id of path) expect(sim.allocateJobNode(id), id).toBe(true);
}

function frame(
  held: Action[] = [],
  pressed: Action[] = [],
  move = { x: 0, y: 0 },
  at: { x: number; y: number } = DUMMY_POSITION,
): InputFrame {
  return {
    held: new Set<Action>(held),
    pressed: new Set<Action>(pressed),
    move,
    pointerWorld: { x: toPixels(at.x), y: toPixels(at.y) },
  };
}

function run(sim: ArenaSimulation, seconds: number, f: InputFrame = frame()): void {
  for (let i = 0; i < Math.round(seconds / STEP); i++) sim.frame(STEP, f);
}

function slotOf(sim: ArenaSimulation, skill: string): Action {
  const a = sim.loadout.find((l) => l.skill === skill)?.action;
  if (a === undefined) throw new Error(`${skill} が枠に無い`);
  return a;
}

/** 技を1回使い、動作が終わるまで進める。動作にかかった刻みの数を返す。 */
function use(sim: ArenaSimulation, skill: string, at?: { x: number; y: number }): number {
  const slot = slotOf(sim, skill);
  sim.frame(STEP, frame([slot], [slot], undefined, at));
  let steps = 1;
  for (; steps < 400 && sim.executing !== undefined; steps++)
    sim.frame(STEP, frame([], [], undefined, at));
  return steps;
}

// ---------------------------------------------------------------------------------------------
describe("騎士の職奥義「鉄の守り」：ガード中も移動速度が落ちない", () => {
  /** 右クリックでガードを上げたまま（guard=false なら上げずに）1秒、東へ歩いた距離。 */
  function walked(iron: boolean, guard: boolean): number {
    const sim = simOf("JOB-KNIGHT");
    takeMastery(sim, "JBN-KNIGHT-M-IRON", iron);
    const held: Action[] = guard ? ["skill2"] : [];
    sim.frame(STEP, frame(held, held));
    run(sim, 0.3, frame(held));
    expect(sim.guard?.raised).toBe(guard);
    const x = sim.motion.position.x;
    run(sim, 1, frame(held, [], { x: 1, y: 0 }));
    expect(sim.guard?.raised).toBe(guard);
    return sim.motion.position.x - x;
  }

  it("選ぶと、ガードを上げていても、上げていないときと同じ速さで歩く", () => {
    expect(walked(true, true)).toBeCloseTo(walked(false, false), 6);
  });

  it("選んでいなければ、ガード中は規則の倍率（×0.6）で遅くなる", () => {
    const rule = db.jobs.get("JOB-KNIGHT")?.guard?.moveSpeedMultiplier ?? NaN;
    expect(walked(false, true) / walked(false, false)).toBeCloseTo(rule, 2);
  });

  it("ガードしていないときの速さは変わらない", () => {
    expect(walked(true, false)).toBeCloseTo(walked(false, false), 6);
  });
});

describe("騎士の職奥義「断罪者」：信念の最大値+10、断罪の刃は信念1点につき+30%", () => {
  /** 人形の隣まで歩いた騎士。 */
  function nearDummy(condemn: boolean): ArenaSimulation {
    const sim = simOf("JOB-KNIGHT", "condemn", true);
    takeMastery(sim, "JBN-KNIGHT-M-CONDEMN", condemn);
    for (let i = 0; i < 600 && DUMMY_POSITION.x - sim.motion.position.x > 1.3; i++)
      sim.frame(STEP, frame([], [], { x: 1, y: 0 }));
    return sim;
  }
  /** 信念を faith にして断罪の刃を当て、そのヒットの技倍率（技レベルの倍率を含む）を返す。 */
  function judgmentPct(sim: ArenaSimulation, faith: number): number {
    sim.jobGauge.add(faith);
    expect(sim.jobGauge.value).toBe(Math.min(faith, sim.jobGauge.max));
    const c = sim.hitCount;
    const slot = slotOf(sim, "SKL-KNIGHT-JUDGMENT");
    sim.frame(STEP, frame([slot], [slot]));
    for (let i = 0; i < 120 && sim.hitCount === c; i++) sim.frame(STEP, frame());
    const h = sim.lastHit?.hit;
    if (h === undefined || sim.hitCount === c) throw new Error("当たらない");
    expect(sim.jobGauge.value).toBe(0);
    return h.trace.skillPct;
  }

  it("信念の最大値は 10 → 20。20まで溜まる", () => {
    const sim = simOf("JOB-KNIGHT");
    expect(sim.jobGauge.max).toBe(10);
    takeMastery(sim, "JBN-KNIGHT-M-CONDEMN");
    expect(sim.jobGauge.max).toBe(20);
    sim.jobGauge.add(25);
    expect(sim.jobGauge.value).toBe(20);
  });

  it("信念10の断罪の刃：選ぶと技倍率 2.0+10×0.3=5.0、選ばなければ 2.0+10×0.2=4.0（比 1.25）", () => {
    // 技倍率は技レベルの分だけ両方に同じ量が足されるので、差で比べる（5.0 − 4.0）
    const a = judgmentPct(nearDummy(false), 10);
    const b = judgmentPct(nearDummy(true), 10);
    expect(b - a).toBeCloseTo(1.0, 9);
  });

  it("信念20（断罪者の最大）なら 2.0+20×0.3=8.0（信念10・断罪者なしの4.0より+4.0）", () => {
    const a = judgmentPct(nearDummy(false), 10);
    const b = judgmentPct(nearDummy(true), 20);
    expect(b - a).toBeCloseTo(8.0 - 4.0, 9);
  });

  it("信念0なら、選んでも技倍率は変わらない（2.0）", () => {
    const a = judgmentPct(nearDummy(false), 0);
    const b = judgmentPct(nearDummy(true), 0);
    expect(b).toBeCloseTo(a, 9);
  });

  it("殉教は、まだ効果を持たない（守護の誓いの肩代わりが無い。D-ULT-8）", () => {
    expect(db.jobNodes.get("JBN-KNIGHT-M-MARTYR")?.effects ?? []).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
const FIRE: Action = "skill2";
const ICE: Action = "skill3";

describe("魔法使いの職奥義「単相の極み」：位相がなくなり、同じ属性を続けるたびに+8%（最大5回）", () => {
  function mage(single: boolean, seed = "single"): ArenaSimulation {
    const sim = simOf("JOB-MAGE", seed);
    takeMastery(sim, "JBN-MAGE-M-SINGLE", single);
    return sim;
  }
  /** 呪文を使い、弾が人形に当たるまで進めて、そのヒットの軽減の前のダメージを返す。 */
  function castHit(sim: ArenaSimulation, slot: Action): number {
    const before = sim.hitCount;
    sim.frame(STEP, frame([slot], [slot]));
    for (let i = 0; i < 200 && sim.executing !== undefined; i++) sim.frame(STEP, frame());
    run(sim, 1.5);
    expect(sim.hitCount).toBe(before + 1);
    const h = sim.lastHit?.hit;
    if (h === undefined) throw new Error("ヒットが無い");
    return h.preMitigationTotal;
  }

  it("位相は0のまま・合成魔法（蒸爆）に変わらない。同じ属性の回数は 0,1,2…と数え、違う属性で0", () => {
    const sim = mage(true);
    expect(sim.jobGauge.singlePhase).toBe(true);
    for (const [slot, streak] of [
      [FIRE, 0],
      [ICE, 0],
      [FIRE, 0],
      [FIRE, 1],
      [FIRE, 2],
    ] as const) {
      castHit(sim, slot);
      expect(sim.jobGauge.sameElementStreak).toBe(streak);
      expect(sim.jobGauge.value).toBe(0);
      expect(sim.lastSkill?.variants).not.toContain("fusion:steam");
    }
  });

  it("同じ乱数で比べると、1回目は同じ、続けた n 回目は（1＋増加＋0.08×n）／（1＋増加）倍。5回で止まる", () => {
    const a = mage(false);
    const b = mage(true);
    const inc = a.sheet.evaluated.view.stat("STAT-DAMAGE", [
      ...new TagIndex(db.tags).closure(db.skills.get("SKL-MAGE-FIREBALL")?.tags ?? []),
    ]).increased;
    for (let n = 0; n <= 6; n++) {
      const plain = castHit(a, FIRE);
      const single = castHit(b, FIRE);
      const k = Math.min(n, 5);
      expect(single / plain, `n=${String(n)}`).toBeCloseTo((1 + inc + 0.08 * k) / (1 + inc), 6);
    }
  });

  it("選んでいなければ、今までどおり位相が増えて蒸爆になる", () => {
    const sim = mage(false);
    castHit(sim, FIRE);
    castHit(sim, ICE);
    castHit(sim, FIRE);
    expect(sim.jobGauge.stages).toEqual(["steam"]);
    expect(sim.jobGauge.sameElementStreak).toBe(0);
  });

  it("職奥義を返すと（試し打ちの場）、位相に戻る", () => {
    const sim = mage(true);
    for (let i = 0; i < 600 && sim.motion.position.x < DUMMY_POSITION.x - 2; i++)
      sim.frame(STEP, frame([], [], { x: 1, y: 0 }));
    expect(sim.startTrial()).toBe(true);
    castHit(sim, FIRE);
    castHit(sim, FIRE);
    expect(sim.jobGauge.sameElementStreak).toBe(1);
    expect(sim.refundJobNode("JBN-MAGE-M-SINGLE")).toBe(true);
    expect(sim.jobGauge.singlePhase).toBe(false);
    castHit(sim, ICE);
    expect(sim.jobGauge.value).toBe(1);
  });
});

describe("魔法使いの職奥義「無詠唱」：詠唱速度+25%", () => {
  function mage(silent: boolean): ArenaSimulation {
    const sim = simOf("JOB-MAGE", "silent");
    takeMastery(sim, "JBN-MAGE-M-SILENT", silent);
    return sim;
  }

  it("呪文の動作の時間が 1/1.25 になる（火球）", () => {
    // 人形と反対の向きに撃つ（当たったときの手応えの停止を数えないため）
    const away = { x: -40, y: 12 };
    const plain = use(mage(false), "SKL-MAGE-FIREBALL", away);
    const fast = use(mage(true), "SKL-MAGE-FIREBALL", away);
    expect(fast).toBeLessThan(plain);
    // 刻み（1/60秒）の丸めがあるので、1刻みまでの差を許す
    expect(Math.abs(fast - plain / 1.25)).toBeLessThanOrEqual(1);
  });

  it("呪文でない技（杖の通常攻撃）の速さは変わらない", () => {
    const away = { x: -40, y: 12 };
    expect(use(mage(true), "SKL-BASIC-ATTACK", away)).toBe(
      use(mage(false), "SKL-BASIC-ATTACK", away),
    );
  });

  it("詠唱速度の増加は無詠唱からだけ（選ばなければ0。既存のビルドの速さは変わらない）", () => {
    expect(mage(false).sheet.evaluated.view.stat("STAT-CAST-SPEED").increased).toBe(0);
    expect(mage(true).sheet.evaluated.view.stat("STAT-CAST-SPEED").increased).toBeCloseTo(0.25, 9);
  });

  it("三相同調は、まだ効果を持たない（天変の中身が仕様に無い。D-ULT-9）", () => {
    expect(db.jobNodes.get("JBN-MAGE-M-TRIPHASE")?.effects ?? []).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
describe("召喚士の職奥義「一体入魂」：召喚物は1体だけ。契約枠1枠につきHP・ダメージ+25%", () => {
  function summoner(solo: boolean): ArenaSimulation {
    const sim = simOf("JOB-SUMMONER", "solo");
    takeMastery(sim, "JBN-SUMMONER-M-SINGLE", solo);
    expect(sim.setSlotSkill(0, "SKL-SUMMONER-SKELETON")).toBe(true);
    expect(sim.setSlotSkill(1, "SKL-SUMMONER-FIRE-SPIRIT")).toBe(true);
    return sim;
  }

  it("1体呼ぶと、枠が余っていても2体目は呼べない（契約枠の不足と同じ gauge）", () => {
    const sim = summoner(true);
    use(sim, "SKL-SUMMONER-SKELETON");
    expect(sim.minions.length).toBe(1);
    expect(sim.blockOf("SKL-SUMMONER-FIRE-SPIRIT")).toBe("gauge");
    expect(sim.blockOf("SKL-SUMMONER-SKELETON")).toBe("gauge");
  });

  it("選んでいなければ2体目も呼べる", () => {
    const sim = summoner(false);
    use(sim, "SKL-SUMMONER-SKELETON");
    expect(sim.blockOf("SKL-SUMMONER-FIRE-SPIRIT")).toBeUndefined();
  });

  it("その1体の最大HPは（1＋召喚物HP＋0.25×契約枠10）／（1＋召喚物HP）倍", () => {
    const a = summoner(false);
    const b = summoner(true);
    use(a, "SKL-SUMMONER-SKELETON");
    use(b, "SKL-SUMMONER-SKELETON");
    const h = a.sheet.evaluated.view.stat("STAT-MINION-HP").increased;
    const ha = a.minions[0]?.combatant.health.maxHp ?? NaN;
    const hb = b.minions[0]?.combatant.health.maxHp ?? NaN;
    expect(hb / ha).toBeCloseTo((1 + h + 2.5) / (1 + h), 6);
  });

  it("その1体のダメージも（1＋召喚物ダメージ＋2.5）／（1＋召喚物ダメージ）倍（同じ乱数の最初の一撃）", () => {
    const first = (solo: boolean): number => {
      const sim = summoner(solo);
      // 人形の隣で呼び、人形を指揮で狙わせなくても、近くの標的として攻撃する
      for (let i = 0; i < 600 && sim.motion.position.x < DUMMY_POSITION.x - 2; i++)
        sim.frame(STEP, frame([], [], { x: 1, y: 0 }));
      use(sim, "SKL-SUMMONER-SKELETON");
      const seen = sim.lastHit;
      for (let i = 0; i < 1200 && sim.lastHit === seen; i++) sim.frame(STEP, frame());
      const h = sim.lastHit?.hit;
      if (h === undefined || sim.lastHit === seen) throw new Error("召喚物が当てない");
      return h.preMitigationTotal;
    };
    const d = summoner(false).sheet.evaluated.view.stat("STAT-MINION-DAMAGE").increased;
    expect(first(true) / first(false)).toBeCloseTo((1 + d + 2.5) / (1 + d), 6);
  });

  it("倒れた後は、また1体呼べる", () => {
    const sim = summoner(true);
    use(sim, "SKL-SUMMONER-SKELETON");
    const m = sim.minions[0];
    if (m === undefined) throw new Error("召喚物がいない");
    m.combatant.health.takeDamage(m.combatant.health.maxHp * 10);
    run(sim, 0.1);
    expect(sim.minions.length).toBe(0);
    expect(sim.blockOf("SKL-SUMMONER-FIRE-SPIRIT")).toBeUndefined();
  });
});

describe("召喚士の職奥義「死の循環」：召喚物が死ぬと、5秒間だけ契約枠が1つ増える", () => {
  function summoner(cycle: boolean): ArenaSimulation {
    const sim = simOf("JOB-SUMMONER", "cycle");
    takeMastery(sim, "JBN-SUMMONER-M-CYCLE", cycle);
    expect(sim.setSlotSkill(0, "SKL-SUMMONER-SKELETON")).toBe(true);
    expect(sim.setSlotSkill(1, "SKL-SUMMONER-SACRIFICE")).toBe(true);
    return sim;
  }
  function killAll(sim: ArenaSimulation): void {
    for (const m of sim.minions) m.combatant.health.takeDamage(m.combatant.health.maxHp * 10);
    run(sim, STEP);
  }

  it("倒されると契約枠 10 → 11。5秒の直前は11、5秒を過ぎると10", () => {
    const sim = summoner(true);
    use(sim, "SKL-SUMMONER-SKELETON");
    expect(sim.minionField.squad.capacity).toBe(10);
    killAll(sim);
    expect(sim.minions.length).toBe(0);
    expect(sim.minionField.squad.capacity).toBe(11);
    expect(sim.deathCycleSlots).toBe(1);
    run(sim, 4.9);
    expect(sim.minionField.squad.capacity).toBe(11);
    run(sim, 0.2);
    expect(sim.minionField.squad.capacity).toBe(10);
  });

  it("2体が倒れると、1体ごとに +1（11 ではなく 12）", () => {
    const sim = summoner(true);
    use(sim, "SKL-SUMMONER-SKELETON");
    run(sim, 1);
    use(sim, "SKL-SUMMONER-SKELETON");
    expect(sim.minions.length).toBe(2);
    killAll(sim);
    expect(sim.minionField.squad.capacity).toBe(12);
  });

  it("魂の供儀で犠牲にした召喚物も数える（D-ULT-7）", () => {
    const sim = summoner(true);
    use(sim, "SKL-SUMMONER-SKELETON");
    const m = sim.minions[0];
    if (m === undefined) throw new Error("召喚物がいない");
    use(sim, "SKL-SUMMONER-SACRIFICE", m.position);
    expect(sim.minions.length).toBe(0);
    expect(sim.minionField.squad.capacity).toBe(11);
  });

  it("増えた枠で、5秒の間は呼べる数が増える。期限が切れても、いる召喚物は消えない", () => {
    const sim = summoner(true);
    // 骸兵（2枠）を5体＝10枠。1体倒れると 8/11 → 2体呼べて 12/11 にはならない（10/11 で1枠余る）
    for (let i = 0; i < 5; i++) {
      use(sim, "SKL-SUMMONER-SKELETON");
      run(sim, 1);
    }
    expect(sim.minionField.squad.used).toBe(10);
    const m = sim.minions[0];
    if (m === undefined) throw new Error("召喚物がいない");
    m.combatant.health.takeDamage(m.combatant.health.maxHp * 10);
    run(sim, STEP);
    expect(sim.minionField.squad.capacity).toBe(11);
    use(sim, "SKL-SUMMONER-SKELETON");
    expect(sim.minionField.squad.used).toBe(10);
    run(sim, 5);
    expect(sim.minionField.squad.capacity).toBe(10);
    expect(sim.minions.length).toBe(5);
  });

  it("選んでいなければ、倒されても枠は増えない", () => {
    const sim = summoner(false);
    use(sim, "SKL-SUMMONER-SKELETON");
    killAll(sim);
    expect(sim.minionField.squad.capacity).toBe(10);
    expect(sim.deathCycleSlots).toBe(0);
  });

  it("転職で召喚物が消えると、一時的な枠も消える", () => {
    const sim = summoner(true);
    use(sim, "SKL-SUMMONER-SKELETON");
    killAll(sim);
    expect(sim.deathCycleSlots).toBe(1);
    expect(sim.changeJob()).toBe("ok");
    expect(sim.deathCycleSlots).toBe(0);
  });
});
