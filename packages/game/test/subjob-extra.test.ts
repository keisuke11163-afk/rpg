/**
 * サブジョブの追加の確認（ゲーム層・実データ）：6ジョブ全てをサブにしたときの技の枠（2つまで入り、3つ目は入らない）・
 * サブの設定と解除で記録（HP・位置・ヒット）が変わらないこと・サブを外すと枠のサブの技が使えないこと・
 * 転職でサブと同じジョブになったときの枠の戻り・busy の範囲・全ジョブの職紋盤（職奥義・接続は副職紋で取れない）。
 * 基本の確認は packages/game/test/subjob-game.test.ts。
 */
import { describe, expect, it } from "vitest";
import {
  Character,
  FIXED_STEP_SECONDS,
  JobBoardAllocation,
  SUB_SKILL_SLOT_LIMIT,
  subSkillsInSlots,
} from "@stella/core";
import { loadGameContent } from "@stella/content";
import type { Action } from "../src/input/actions.ts";
import type { InputFrame } from "../src/input/frame.ts";
import {
  ArenaSimulation,
  DUMMY_POSITION,
  SKILL_SLOTS,
  newCharacterProfile,
} from "../src/scenes/arena-simulation.ts";
import { toPixels } from "../src/world/units.ts";

const STEP = FIXED_STEP_SECONDS;
const db = loadGameContent();
const JOB_IDS = [...db.jobs.keys()];

const at = (x: number, y: number) => ({ x: toPixels(x), y: toPixels(y) });
function frame(
  pressed: Action[] = [],
  pointer = at(DUMMY_POSITION.x, DUMMY_POSITION.y),
  move = { x: 0, y: 0 },
): InputFrame {
  return { held: new Set(pressed), pressed: new Set(pressed), move, pointerWorld: pointer };
}

/** メインジョブ main・キャラLv level・ジョブごとのジョブLv（省略したジョブは main だけ level）のシミュレーション。 */
function simOf(
  main: string,
  level = 25,
  jobLevels: Readonly<Record<string, number>> = {},
  opts: { seed?: string; enemies?: boolean } = {},
): ArenaSimulation {
  const base = newCharacterProfile(db, main, "追加");
  const origin = db.jobs.get(main);
  if (origin === undefined) throw new Error(main);
  const character = new Character({
    origin,
    jobs: db.jobs,
    level,
    jobLevels: { [main]: level, ...jobLevels },
  });
  return new ArenaSimulation(undefined, {
    db,
    enemies: opts.enemies ?? false,
    rngSeed: opts.seed ?? "sub-extra",
    profile: { ...base, character },
  });
}

const slotsOf = (sim: ArenaSimulation): (string | undefined)[] => {
  const m = new Map(sim.loadout.map((l) => [l.action, l.skill]));
  return SKILL_SLOTS.map((s) => m.get(s));
};

/** 人形の前まで歩く（試し打ちの場に入れる位置）。 */
function walkToDummy(sim: ArenaSimulation): void {
  for (let i = 0; i < 600 && sim.motion.position.x < DUMMY_POSITION.x - 2; i++)
    sim.frame(STEP, frame([], undefined, { x: 1, y: 0 }));
}

describe("6ジョブ全部をサブにしたとき、サブの技は2つまで枠に入る", () => {
  it.each(JOB_IDS)(
    "サブ %s：サブの技2つは入り、そのジョブのほかの技（サブでない）は入らない",
    (sub) => {
      const main = sub === "JOB-WARRIOR" ? "JOB-ROGUE" : "JOB-WARRIOR";
      const sim = simOf(main, 25, { [sub]: 25 });
      expect(sim.setSubJob(sub)).toBe("ok");
      const subs = sim.subSkills();
      expect(subs, sub).toHaveLength(2);
      expect(sim.setSlotSkill(4, subs[0]), sub).toBe(true);
      expect(sim.setSlotSkill(5, subs[1]), sub).toBe(true);
      expect(subSkillsInSlots(slotsOf(sim), subs)).toBe(SUB_SKILL_SLOT_LIMIT);

      const assignable = sim.assignableSkills();
      const third = (db.jobs.get(sub)?.skills.map((s) => s.skill) ?? []).find(
        (s) => !subs.includes(s) && !assignable.includes(s),
      );
      expect(third, `${sub} に、サブでない3つ目の技がある`).toBeDefined();
      // 枠3には主職の初期の技が入っているので、「空のまま」ではなく「入れても変わらない」を確かめる
      const before = slotsOf(sim);
      expect(sim.setSlotSkill(3, third), `${sub} の3つ目`).toBe(false);
      expect(slotsOf(sim)).toEqual(before);
      expect(subSkillsInSlots(slotsOf(sim), subs)).toBe(SUB_SKILL_SLOT_LIMIT);
    },
  );
});

/**
 * 同じ入力列（移動と技）で600刻み進めた記録。HP・位置・ヒットの数・最後のヒット（debug() に当たるもの）。
 */
function trace(sim: ArenaSimulation): unknown[] {
  const moves = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
  ] as const;
  const rows: unknown[] = [];
  for (let i = 0; i < 600; i++) {
    const move = moves[Math.floor(i / 40) % moves.length] ?? { x: 0, y: 0 };
    const pressed: Action[] = i % 50 === 0 ? ["skill2"] : i % 70 === 0 ? ["skill4"] : [];
    sim.frame(STEP, frame(pressed, undefined, move));
    rows.push([
      sim.playerHealth.hp,
      sim.motion.position.x,
      sim.motion.position.y,
      sim.hitCount,
      sim.hitsTaken,
      JSON.stringify(sim.lastHit ?? null),
    ]);
  }
  return rows;
}

describe("サブの設定と解除は、記録に残らない", () => {
  it("設定して外したあとの記録は、一度も設定しなかったときと同じ（同じシード・敵あり）。動きも確かめる", () => {
    const opts = { seed: "trace-extra", enemies: true };
    const plain = simOf("JOB-ARCHER", 25, { "JOB-KNIGHT": 12 }, opts);
    const toggled = simOf("JOB-ARCHER", 25, { "JOB-KNIGHT": 12 }, opts);
    expect(toggled.setSubJob("JOB-KNIGHT")).toBe("ok");
    expect(toggled.clearSubJob()).toBe("ok");
    const a = trace(plain);
    const b = trace(toggled);
    expect(b).toEqual(a);
    // 比べる記録が意味を持つよう、位置は動いている
    expect(new Set(a.map((r) => JSON.stringify((r as unknown[])[1]))).size).toBeGreaterThan(1);
  });
});

describe("サブを外すと、枠のサブの技は使えない", () => {
  it("外したあと、枠に技は残らず、その枠を押しても技は使われない（使った回数も増えない）", () => {
    const sim = simOf("JOB-ROGUE", 25, { "JOB-WARRIOR": 10 });
    expect(sim.setSubJob("JOB-WARRIOR")).toBe("ok");
    expect(sim.setSlotSkill(5, "SKL-WARRIOR-WARCRY")).toBe(true);
    expect(sim.clearSubJob()).toBe("ok");
    expect(sim.loadout.map((l) => l.skill)).not.toContain("SKL-WARRIOR-WARCRY");
    // 枠6（skill6）を押す：戦吼は使えない
    sim.frame(STEP, frame(["skill6"]));
    for (let i = 0; i < 120 && sim.executing !== undefined; i++) sim.frame(STEP, frame());
    expect(sim.uses.get("SKL-WARRIOR-WARCRY") ?? 0).toBe(0);
    expect(sim.cooldowns.remaining("SKL-WARRIOR-WARCRY")).toBe(0);
  });
});

describe("転職でサブと同じジョブになると、枠のメインの技は元に戻る", () => {
  it("戦士（サブ盗賊）で盗賊の技をサブの枠に入れ、盗賊に転職→一周して戦士に戻すと、戦士の枠は最初と同じ", () => {
    const sim = simOf("JOB-WARRIOR", 25, { "JOB-ROGUE": 10 });
    const before = slotsOf(sim);
    expect(sim.setSubJob("JOB-ROGUE")).toBe("ok");
    expect(sim.setSlotSkill(5, "SKL-ROGUE-POISON")).toBe(true);
    expect(sim.setSlotSkill(4, "SKL-ROGUE-SHADOWSTEP")).toBe(true);
    // 次のジョブは盗賊（データの順）：サブと同じになるので、サブは外れる
    expect(sim.changeJob()).toBe("ok");
    expect(sim.job.id).toBe("JOB-ROGUE");
    expect(sim.subJob).toBeUndefined();
    // 盗賊から一周して戦士に戻す（サブは無いまま）
    for (let i = 0; i < 6 && sim.job.id !== "JOB-WARRIOR"; i++) expect(sim.changeJob()).toBe("ok");
    expect(sim.job.id).toBe("JOB-WARRIOR");
    expect(sim.subJob).toBeUndefined();
    expect(slotsOf(sim)).toEqual(before);
  });
});

describe("busy の範囲（試し打ちの場・技の実行中）", () => {
  it("試し打ちの場では cycleSubJob・clearSubJob が busy。出ると設定できる", () => {
    const sim = simOf("JOB-ROGUE", 25, { "JOB-WARRIOR": 10 });
    expect(sim.setSubJob("JOB-WARRIOR")).toBe("ok");
    walkToDummy(sim);
    expect(sim.startTrial()).toBe(true);
    expect(sim.cycleSubJob()).toBe("busy");
    expect(sim.clearSubJob()).toBe("busy");
    expect(sim.subJob?.id).toBe("JOB-WARRIOR");
    expect(sim.endTrial()).toBe(true);
    // 出たあとは、次の候補（戦士の次の、設定できるジョブ）へ進む
    expect(sim.cycleSubJob()).toBe("ok");
    expect(sim.subJob?.id).toBe("JOB-ARCHER");
  });

  it("技の実行中は cycleSubJob・setSubJob が busy。終わると cycleSubJob が働く", () => {
    const sim = simOf("JOB-ROGUE", 25, { "JOB-WARRIOR": 10, "JOB-MAGE": 10 });
    sim.frame(STEP, frame(["skill1"]));
    expect(sim.executing).toBeDefined();
    expect(sim.cycleSubJob()).toBe("busy");
    expect(sim.setSubJob("JOB-MAGE")).toBe("busy");
    for (let i = 0; i < 120 && sim.executing !== undefined; i++) sim.frame(STEP, frame());
    expect(sim.executing).toBeUndefined();
    expect(sim.cycleSubJob()).toBe("ok");
    expect(sim.subJob).toBeDefined();
  });
});

describe("全ジョブの職紋盤：副職紋で取れないのは職奥義・接続だけ（実データ）", () => {
  it.each(JOB_IDS)(
    "%s：小ノード・大ノードは取れ得る。職奥義・接続は副職紋では subOnlyMinor",
    (id) => {
      const nodes = [...db.jobNodes.values()].filter((n) => n.job === id);
      expect(nodes.length).toBeGreaterThan(0);
      const sub = new JobBoardAllocation(db, id, [], "sub");
      const main = new JobBoardAllocation(db, id, []);
      for (const n of nodes) {
        const r = sub.allocateBlock(n.id, 100);
        if (n.kind === "start") expect(r, n.id).toBe("start");
        else if (n.kind === "mastery" || n.kind === "connector") {
          expect(r, n.id).toBe("subOnlyMinor");
          expect(() => new JobBoardAllocation(db, id, [n.id], "sub"), n.id).toThrow(RangeError);
        } else expect(r, n.id).not.toBe("subOnlyMinor");
        // メインの盤では、職奥義・接続も拒否理由が subOnlyMinor にならない（規則は変わらない）
        expect(main.allocateBlock(n.id, 100), n.id).not.toBe("subOnlyMinor");
      }
      // 始点から、小ノード・大ノードだけをつながる順に取る
      const root = db.jobBoardStarts.get(id);
      expect(root, id).toBeDefined();
      const board = new JobBoardAllocation(db, id, [], "sub");
      const queue: string[] = [root ?? ""];
      const seen = new Set(queue);
      let taken = 0;
      while (queue.length > 0) {
        const cur = queue.shift() ?? "";
        for (const next of db.jobLinks.get(cur) ?? []) {
          if (seen.has(next)) continue;
          seen.add(next);
          const n = db.jobNodes.get(next);
          if (n === undefined || (n.kind !== "minor" && n.kind !== "notable")) continue;
          expect(board.allocate(next, 100), next).toBe(true);
          taken += 1;
          queue.push(next);
        }
      }
      expect(taken, id).toBeGreaterThan(0);
    },
  );
});

describe("副職紋のゲージ系ノードはメインのゲージに効かない（レビュー指摘の回帰。docs/progress D-SUB-15）", () => {
  it("メイン弓使い・サブ戦士で、戦士のゲージ系のノードまで取っても、集中の増え方（STAT-GAUGE-GAIN）が変わらない", () => {
    const sim = simOf("JOB-ARCHER", 25, { "JOB-WARRIOR": 20 });
    expect(sim.setSubJob("JOB-WARRIOR")).toBe("ok");
    const before = sim.sheet.evaluated.view.stat("STAT-GAUGE-GAIN").increased;
    // JBN-WARRIOR-T4 は EFF-JBN-WAR-GAIN（STAT-GAUGE-GAIN +5%）を持つ。START から T4 まで一本道
    for (const id of ["JBN-WARRIOR-T1", "JBN-WARRIOR-T2", "JBN-WARRIOR-T3", "JBN-WARRIOR-T4"]) {
      expect(sim.allocateSubJobNode(id), id).toBe(true);
    }
    const after = sim.sheet.evaluated.view.stat("STAT-GAUGE-GAIN").increased;
    expect(after).toBe(before);
  });

  it("同じ盤をメインで取ると、ゲージの増え方は増える（メインの職紋盤は従来どおり働く）", () => {
    const sim = simOf("JOB-WARRIOR", 25);
    const before = sim.sheet.evaluated.view.stat("STAT-GAUGE-GAIN").increased;
    for (const id of ["JBN-WARRIOR-T1", "JBN-WARRIOR-T2", "JBN-WARRIOR-T3", "JBN-WARRIOR-T4"]) {
      expect(sim.allocateJobNode(id), id).toBe(true);
    }
    const after = sim.sheet.evaluated.view.stat("STAT-GAUGE-GAIN").increased;
    expect(after).toBeGreaterThan(before);
  });
});
