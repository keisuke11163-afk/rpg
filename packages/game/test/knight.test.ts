/**
 * 騎士（仕様書v0.2 5.3）：右クリック（技の枠2）の押し続けでガード（H-05 ②）・転職の順番・データだけでガードのジョブを足せること。
 */
import { describe, expect, it } from "vitest";
import { type RawContent, FIXED_STEP_SECONDS, loadContent } from "@stella/core";
import { loadGameContent, rawContent } from "@stella/content";
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

function frame(
  held: Action[] = [],
  pressed: Action[] = [],
  at: { x: number; y: number } = { x: 1e5, y: toPixels(12) },
  move = { x: 0, y: 0 },
): InputFrame {
  return {
    held: new Set<Action>(held),
    pressed: new Set<Action>(pressed),
    move,
    pointerWorld: at,
  };
}

function simOf(job: string, useDb = db): ArenaSimulation {
  const sim = new ArenaSimulation(undefined, {
    db: useDb,
    enemies: false,
    profile: newCharacterProfile(useDb, job, "試験"),
  });
  sim.gainXp(1e9);
  return sim;
}

describe("騎士の初期の状態", () => {
  it("初期装備は長剣と小盾で、ガードできる。信念は0から始まる", () => {
    const sim = simOf("JOB-KNIGHT");
    expect(sim.job.id).toBe("JOB-KNIGHT");
    expect(sim.canGuard).toBe(true);
    expect(sim.guardRate).toBeGreaterThan(0);
    expect(sim.jobGauge.value).toBe(0);
    expect(sim.jobGauge.def.id).toBe("GAU-FAITH");
  });
});

describe("右クリック（技の枠2）の押し続けでガード", () => {
  it("押している間はガードを上げ、離すと（最短の秒数の後に）下りる。技は使わない", () => {
    const sim = simOf("JOB-KNIGHT");
    const usesBefore = [...sim.uses.values()].reduce((a, b) => a + b, 0);
    sim.frame(STEP, frame(["skill2"], ["skill2"]));
    for (let i = 0; i < 30; i++) sim.frame(STEP, frame(["skill2"]));
    expect(sim.guard?.raised).toBe(true);
    for (let i = 0; i < 60; i++) sim.frame(STEP, frame());
    expect(sim.guard?.raised).toBe(false);
    expect([...sim.uses.values()].reduce((a, b) => a + b, 0)).toBe(usesBefore);
  });

  it("盾を外すとガードできず、右クリックは普通の技の枠に戻る", () => {
    const sim = simOf("JOB-KNIGHT");
    expect(sim.unequip("offHand")).toBe(true);
    expect(sim.canGuard).toBe(false);
    sim.frame(STEP, frame(["skill2"], ["skill2"]));
    for (let i = 0; i < 10; i++) sim.frame(STEP, frame(["skill2"]));
    expect(sim.guard?.raised).toBe(false);
  });

  it("騎士以外のジョブは、盾を持ってもガードの状態を持たない（今までどおり）", () => {
    for (const job of ["JOB-WARRIOR", "JOB-ROGUE", "JOB-ARCHER", "JOB-MAGE"]) {
      const sim = simOf(job);
      expect(sim.guard, job).toBeUndefined();
      expect(sim.canGuard, job).toBe(false);
    }
  });
});

/** 戦う場に棘鼠（その場で噛みつく近接の敵）を1体、プレイヤーの東（正面）に出す。 */
function withEnemy(job: string, at: { dx: number; dy: number } = { dx: 1, dy: 0 }, seed = "k") {
  const sim = new ArenaSimulation(undefined, {
    db,
    enemies: true,
    rngSeed: seed,
    profile: newCharacterProfile(db, job, "試験"),
  });
  sim.gainXp(1e9);
  const p = sim.motion.position;
  const wolf = sim.field?.spawn(
    "ENM-THORN-RAT",
    "normal",
    5,
    { x: p.x + at.dx, y: p.y + at.dy },
    "w",
  );
  if (wolf === undefined) throw new Error("敵を出せない");
  return { sim, wolf };
}

/** 判定の中身を直接呼ぶ（敵の攻撃の時刻を決めて当てるため）。 */
interface GuardInternals {
  judgeGuard(e: unknown): { kind: string; rate?: number };
  onParried(e: unknown): void;
}
const internals = (sim: ArenaSimulation): GuardInternals => sim as unknown as GuardInternals;

function slotOf(sim: ArenaSimulation, skill: string): Action {
  const a = sim.loadout.find((l) => l.skill === skill)?.action;
  if (a === undefined) throw new Error(`${skill} が枠に無い`);
  return a;
}

describe("技の枠2と盾（H-05 ②）", () => {
  it("盾を実際に持った戦士の右クリックは、今までどおり技の枠2の技を使う", () => {
    // 試験用の初期の持ち物（戦士）に、片手の長剣と小盾がある
    const sim = new ArenaSimulation(undefined, { db, enemies: false });
    expect(sim.job.id).toBe("JOB-WARRIOR");
    sim.gainXp(1e9);
    expect(sim.equipFromInventory("test-longsword")).toBe(true);
    expect(sim.equipFromInventory("test-buckler", "offHand")).toBe(true);
    expect(sim.equipment.get("offHand")?.uid).toBe("test-buckler");
    const slot2 = sim.loadout.find((l) => l.action === "skill2")?.skill;
    expect(slot2).toBeDefined();
    expect(sim.guard).toBeUndefined();
    sim.frame(STEP, frame(["skill2"], ["skill2"]));
    for (let i = 0; i < 60; i++) sim.frame(STEP, frame(["skill2"]));
    expect(sim.uses.get(slot2 ?? "") ?? 0).toBeGreaterThan(0);
  });

  it("盾を外した騎士は、右クリックで枠2の聖域を使う", () => {
    const sim = simOf("JOB-KNIGHT");
    expect(sim.loadout.find((l) => l.action === "skill2")?.skill).toBe("SKL-KNIGHT-SANCTUARY");
    expect(sim.unequip("offHand")).toBe(true);
    sim.frame(STEP, frame(["skill2"], ["skill2"]));
    for (let i = 0; i < 60; i++) sim.frame(STEP, frame(["skill2"]));
    expect(sim.uses.get("SKL-KNIGHT-SANCTUARY") ?? 0).toBeGreaterThan(0);
  });
});

describe("ガードの働き（敵の攻撃を当てる）", () => {
  it("ガードで防ぐと、気力を使い、信念が+1。ガードしたヒットでは信念は-1にならない", () => {
    const { sim } = withEnemy("JOB-KNIGHT");
    // 押しっぱなしで始める（パリィの受付なし）。狼の噛みつきが当たるまで進める
    for (let i = 0; i < 300 && sim.guardCount < 1; i++)
      sim.frame(STEP, frame(["skill2"], i === 0 ? ["skill2"] : []));
    expect(sim.guardCount).toBe(1);
    expect(sim.parryCount).toBe(0);
    expect(sim.jobGauge.value).toBe(1);
    expect(sim.hitsTaken).toBeGreaterThanOrEqual(1);
  });

  it("防げずに受けると信念が-1（ガードしていないとき）", () => {
    const { sim } = withEnemy("JOB-KNIGHT");
    sim.jobGauge.add(5);
    for (let i = 0; i < 300 && sim.hitsTaken < 1; i++) sim.frame(STEP, frame());
    expect(sim.hitsTaken).toBe(1);
    expect(sim.jobGauge.value).toBe(4);
  });

  it("ガードの結果：気力の消費（15）・正面でない攻撃は防げない・気力切れは防げない", () => {
    const { sim, wolf } = withEnemy("JOB-KNIGHT");
    sim.frame(STEP, frame(["skill2"], ["skill2"]));
    for (let i = 0; i < 13; i++) sim.frame(STEP, frame(["skill2"])); // 受付（0.18秒）を過ぎる（棘鼠の噛みつきは約0.3秒後）
    const before = sim.motion.currentStamina;
    expect(internals(sim).judgeGuard(wolf).kind).toBe("guard");
    expect(sim.motion.currentStamina).toBeCloseTo(before - 15);
    expect(sim.jobGauge.value).toBe(1);
    // 気力切れ
    sim.motion.spendStamina(sim.motion.currentStamina);
    expect(internals(sim).judgeGuard(wolf).kind).toBe("none");
    // 正面でない（背後）
    const back = withEnemy("JOB-KNIGHT", { dx: -2, dy: 0 });
    back.sim.frame(STEP, frame(["skill2"], ["skill2"]));
    for (let i = 0; i < 13; i++) back.sim.frame(STEP, frame(["skill2"]));
    expect(internals(back.sim).judgeGuard(back.wolf).kind).toBe("none");
  });

  it("パリィ：信念+3・崩し35%・気力は使わない。崩しが効かない敵には効かない", () => {
    const { sim, wolf } = withEnemy("JOB-KNIGHT");
    sim.motion.spendStamina(sim.motion.currentStamina); // 気力が無くてもパリィはできる
    sim.frame(STEP, frame(["skill2"], ["skill2"]));
    expect(internals(sim).judgeGuard(wolf).kind).toBe("parry");
    const gauge = wolf.combatant.stagger;
    const before = gauge.current;
    internals(sim).onParried(wolf);
    expect(sim.jobGauge.value).toBe(3);
    expect(gauge.current - before).toBeCloseTo(gauge.max * 0.35);
    // 崩しが効かない敵
    const imm = withEnemy("JOB-KNIGHT");
    imm.wolf.combatant.staggerImmune = true;
    imm.sim.frame(STEP, frame(["skill2"], ["skill2"]));
    const b2 = imm.wolf.combatant.stagger.current;
    internals(imm.sim).onParried(imm.wolf);
    expect(imm.wolf.combatant.stagger.current).toBe(b2);
  });

  it("反撃権：パリィの後の最初のダメージの技が+100%（加算の補正）で、1回だけ", () => {
    const first = (counter: boolean): { a: number; b: number } => {
      const sim = nearDummy("JOB-KNIGHT", "ctr");
      if (counter) sim.guard?.grantCounter(sim.time);
      const basic = slotOf(sim, "SKL-BASIC-ATTACK");
      const out: number[] = [];
      for (let n = 0; n < 2; n++) {
        const c = sim.hitCount;
        sim.frame(STEP, dummyFrame([basic], [basic]));
        for (let i = 0; i < 90 && sim.hitCount === c; i++) sim.frame(STEP, dummyFrame());
        out.push(sim.lastHit?.hit.preMitigationTotal ?? 0);
        for (let i = 0; i < 60; i++) sim.frame(STEP, dummyFrame());
      }
      return { a: out[0] ?? 0, b: out[1] ?? 0 };
    };
    const plain = first(false);
    const ctr = first(true);
    expect(plain.a).toBeGreaterThan(0);
    expect(ctr.a / plain.a).toBeGreaterThan(1.5);
    expect(ctr.a / plain.a).toBeLessThanOrEqual(2);
    // 2回目は、反撃権が消えているので、普通の1回目と同じ（同じ乱数の並びではないので、2倍にはならないことだけ確かめる）
    expect(ctr.b / plain.b).toBeLessThan(1.5);
  });
});

/** 人形のすぐ近くまで歩いた騎士（敵のいる場）。 */
function nearDummy(job: string, seed: string): ArenaSimulation {
  const sim = new ArenaSimulation(undefined, {
    db,
    enemies: true,
    rngSeed: seed,
    profile: newCharacterProfile(db, job, "試験"),
  });
  sim.gainXp(1e9);
  for (let i = 0; i < 600 && DUMMY_POSITION.x - sim.motion.position.x > 1.3; i++)
    sim.frame(STEP, dummyFrame([], [], { x: 1, y: 0 }));
  return sim;
}
function dummyFrame(
  held: Action[] = [],
  pressed: Action[] = [],
  move = { x: 0, y: 0 },
): InputFrame {
  return frame(
    held,
    pressed,
    { x: toPixels(DUMMY_POSITION.x), y: toPixels(DUMMY_POSITION.y) },
    move,
  );
}

describe("騎士の技", () => {
  /** 技を1回使い、人形への最初のヒットを返す。 */
  function useOn(sim: ArenaSimulation, skill: string) {
    const slot = slotOf(sim, skill);
    const c = sim.hitCount;
    sim.frame(STEP, dummyFrame([slot], [slot]));
    for (let i = 0; i < 120 && sim.hitCount === c; i++) sim.frame(STEP, dummyFrame());
    const h = sim.lastHit?.hit;
    if (h === undefined || sim.hitCount === c) throw new Error("当たらない");
    return h;
  }

  it("盾打ち：盾の基礎の防具値の10%（小盾は12 → 1.2）が、固定の物理ダメージに足される", () => {
    const withShield = nearDummy("JOB-KNIGHT", "bash");
    const noShield = nearDummy("JOB-KNIGHT", "bash");
    expect(noShield.unequip("offHand")).toBe(true);
    const a = useOn(withShield, "SKL-KNIGHT-SHIELD-BASH");
    const b = useOn(noShield, "SKL-KNIGHT-SHIELD-BASH");
    const k = a.crit ? a.critMultiplier : 1;
    // 足す分は、ダメージの増加の補正を受ける（わずかに1.2より大きい）
    const diff = a.preMitigationTotal - b.preMitigationTotal;
    expect(diff).toBeGreaterThanOrEqual(1.2 * k - 1e-9);
    expect(diff).toBeLessThan(1.2 * k * 1.2);
  });

  it("断罪の刃：物理ダメージの50%が聖に変わり、信念を全て使う", () => {
    const sim = nearDummy("JOB-KNIGHT", "judge");
    sim.jobGauge.add(4);
    const h = useOn(sim, "SKL-KNIGHT-JUDGMENT");
    expect(h.damage.holy ?? 0).toBeGreaterThan(0);
    expect(h.damage.physical ?? 0).toBeGreaterThan(0);
    expect(sim.jobGauge.value).toBe(0);
  });
});

describe("転職の順番", () => {
  it("最初の転職から 盗賊→弓使い→魔法使い→騎士→戦士→盗賊", () => {
    const sim = new ArenaSimulation(undefined, { db, enemies: false });
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      expect(sim.changeJob()).toBe("ok");
      seen.push(sim.job.id);
    }
    expect(seen).toEqual([
      "JOB-ROGUE",
      "JOB-ARCHER",
      "JOB-MAGE",
      "JOB-KNIGHT",
      "JOB-WARRIOR",
      "JOB-ROGUE",
    ]);
  });
});

describe("ガードのジョブをデータだけで足す（MVP後の機能の提案 3章 H-05）", () => {
  const JOB = "JOB-TEST-GUARDIAN";

  function withGuardJob(): RawContent {
    const c = rawContent.collections;
    const knight = (c.jobs ?? [])
      .flatMap((f) => f.entries as Record<string, unknown>[])
      .find((e) => e.id === "JOB-KNIGHT");
    if (knight === undefined) throw new Error("騎士のデータが無い");
    return {
      ...rawContent,
      collections: {
        ...c,
        jobs: [
          ...(c.jobs ?? []),
          {
            file: "test/guardian.json",
            entries: [
              {
                ...knight,
                id: JOB,
                skills: [],
                defaultSlots: ["SKL-BASIC-ATTACK"],
                guard: { ...(knight.guard as object), parryWindow: 0.3 },
              },
            ],
          },
        ],
      },
    };
  }

  it("騎士のデータの写しに別の受付の秒数を持たせると、ゲームの本体を変えずにガードできる", () => {
    const loaded = loadContent(withGuardJob());
    if (!loaded.ok) throw new Error(loaded.errors.map((e) => e.message).join("\n"));
    const sim = simOf(JOB, loaded.content);
    expect(sim.guard?.rule.parryWindow).toBe(0.3);
    expect(sim.canGuard).toBe(true);
    sim.frame(STEP, frame(["skill2"], ["skill2"]));
    for (let i = 0; i < 10; i++) sim.frame(STEP, frame(["skill2"]));
    expect(sim.guard?.raised).toBe(true);
  });
});
