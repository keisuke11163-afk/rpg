import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { FIXED_STEP_SECONDS, FixedStepClock, type MotionInput, PlayerMotion } from "@stella/core";
import type { Action } from "../src/input/actions.ts";
import type { InputFrame } from "../src/input/frame.ts";
import { ARENA, ArenaSimulation } from "../src/scenes/arena-simulation.ts";
import { toMeters, toPixels } from "../src/world/units.ts";

const STEP = FIXED_STEP_SECONDS;
const START = { x: 12, y: 12 };

/** 照準は右（プレイヤーの右10m）。押した瞬間の行動と移動を指定できる。 */
function input(opts: { pressed?: Action[]; move?: { x: number; y: number } } = {}): InputFrame {
  return {
    held: new Set<Action>(),
    pressed: new Set<Action>(opts.pressed ?? []),
    move: opts.move ?? { x: 0, y: 0 },
    pointerWorld: { x: toPixels(START.x + 10), y: toPixels(START.y) },
  };
}

/** 各刻みで PlayerMotion に渡された回避の入力を記録する。 */
function recordDodges(sim: ArenaSimulation): boolean[] {
  const log: boolean[] = [];
  const original = sim.motion.update.bind(sim.motion);
  vi.spyOn(sim.motion, "update").mockImplementation((dt: number, i: MotionInput) => {
    log.push(i.dodge);
    original(dt, i);
  });
  return log;
}

describe("ArenaSimulation：回避の入力を刻みまで保持する", () => {
  it("刻みが0のフレームで押した回避は、消えずに次の刻みで発動する", () => {
    const sim = new ArenaSimulation();
    const dodges = recordDodges(sim);
    expect(sim.frame(0, input({ pressed: ["dodge"] }))).toBe(0);
    // まだ刻みがないので、発動はせず、保持している
    expect(sim.dodgePending).toBe(true);
    expect(sim.motion.dodging).toBe(false);
    expect(sim.motion.currentStamina).toBe(100);
    expect(dodges).toEqual([]);

    expect(sim.frame(STEP, input())).toBe(1);
    expect(dodges).toEqual([true]);
    expect(sim.dodgePending).toBe(false);
    expect(sim.motion.dodging).toBe(true);
    expect(sim.motion.currentStamina).toBe(75);
  });

  it("刻みが進まない描画のフレームが続いても、入力を保持し続ける", () => {
    const sim = new ArenaSimulation();
    sim.frame(0, input({ pressed: ["dodge"] }));
    // 1刻み（1/60秒）未満のフレームを何回か（合計も1刻み未満）
    for (let i = 0; i < 5; i++) {
      expect(sim.frame(STEP / 10, input())).toBe(0);
      expect(sim.dodgePending).toBe(true);
    }
    expect(sim.motion.position).toEqual(START);
    // 合計が1刻みに届いたフレームで発動する
    expect(sim.frame(STEP / 2, input())).toBe(1);
    expect(sim.motion.dodging).toBe(true);
    expect(sim.dodgePending).toBe(false);
  });

  it("消費した回避の入力は、その後の刻みで再び発動しない", () => {
    const sim = new ArenaSimulation();
    const dodges = recordDodges(sim);
    sim.frame(0, input({ pressed: ["dodge"] }));
    // 回避（0.35秒）が終わり、さらに十分な時間が経つまで進める
    for (let i = 0; i < 120; i++) sim.frame(STEP, input());
    expect(dodges.filter(Boolean)).toHaveLength(1);
    expect(dodges[0]).toBe(true);
    expect(sim.motion.dodging).toBe(false);
    // 回避は1回だけ：右（照準の方向）へ4m
    expect(sim.motion.position.x - START.x).toBeCloseTo(4, 6);
    expect(sim.motion.position.y).toBe(START.y);
  });

  it("1フレームで複数の刻みを進めても、回避の入力は最初の刻みにだけ渡る", () => {
    const sim = new ArenaSimulation();
    const dodges = recordDodges(sim);
    expect(sim.frame(5 * STEP, input({ pressed: ["dodge"] }))).toBe(5);
    expect(dodges).toEqual([true, false, false, false, false]);
    expect(sim.motion.currentStamina).toBe(75);
    // 刻みが0のフレームで押した後、複数の刻みを進めるフレームが来ても1回だけ
    const sim2 = new ArenaSimulation();
    const dodges2 = recordDodges(sim2);
    sim2.frame(0, input({ pressed: ["dodge"] }));
    expect(sim2.frame(4 * STEP, input())).toBe(4);
    expect(dodges2).toEqual([true, false, false, false]);
    for (let i = 0; i < 10; i++) sim2.frame(5 * STEP, input());
    expect(dodges2.filter(Boolean)).toHaveLength(1);
    expect(sim2.motion.position.x - START.x).toBeCloseTo(4, 6);
  });

  it("経過時間が正しくないフレームでは、例外を出し、入力も保持しない", () => {
    const sim = new ArenaSimulation();
    expect(() => sim.frame(Number.POSITIVE_INFINITY, input({ pressed: ["dodge"] }))).toThrow(
      RangeError,
    );
    expect(sim.dodgePending).toBe(false);
  });

  it("試験用の場で使わない行動の押した瞬間の入力は保持しない（後で発動しないように）", () => {
    const sim = new ArenaSimulation();
    // U-08 で skill3〜6 は戦士の技の枠になったので、使わない行動は薬瓶・調べる
    sim.frame(0, input({ pressed: ["flaskHp", "flaskMp", "interact"] }));
    expect(sim.dodgePending).toBe(false);
    expect(sim.attackPending).toBe(false);
    expect(sim.pending("skill2")).toBe(false);
    sim.frame(STEP, input());
    expect(sim.motion.dodging).toBe(false);
    expect(sim.executing).toBeUndefined();
  });
});

describe("ArenaSimulation：技の枠の入力も刻みまで保持する（U-07 の通常攻撃・U-08 の技）", () => {
  it("刻みが0のフレームで押した通常攻撃は、次の刻みで1回だけ始まる", () => {
    const sim = new ArenaSimulation();
    expect(sim.frame(0, input({ pressed: ["skill1"] }))).toBe(0);
    expect(sim.attackPending).toBe(true);
    expect(sim.executing).toBeUndefined();
    sim.frame(STEP, input());
    expect(sim.attackPending).toBe(false);
    expect(sim.executing).toBe("skill1");
    // 攻撃（下級の大剣：1秒未満）が終わった後に、再び始まらない
    for (let i = 0; i < 120; i++) sim.frame(STEP, input());
    expect(sim.executing).toBeUndefined();
    expect(sim.uses.get("SKL-BASIC-ATTACK")).toBe(1);
  });

  it("刻みが0のフレームで押した右クリック（薙ぎ払い）は、次の刻みで1回だけ使う", () => {
    // U-07 の試験用の投射物（右クリック）は、U-08 で戦士の薙ぎ払いに置き換えた
    const sim = new ArenaSimulation();
    sim.frame(0, input({ pressed: ["skill2"] }));
    expect(sim.pending("skill2")).toBe(true);
    expect(sim.uses.get("SKL-WARRIOR-SWEEP")).toBeUndefined();
    sim.frame(3 * STEP, input());
    expect(sim.pending("skill2")).toBe(false);
    expect(sim.uses.get("SKL-WARRIOR-SWEEP")).toBe(1);
    for (let i = 0; i < 120; i++) sim.frame(STEP, input());
    expect(sim.uses.get("SKL-WARRIOR-SWEEP")).toBe(1);
  });

  it("R（破軍）の押した瞬間も、刻みが0のフレームで保持し、闘志100で次の刻みに使う", () => {
    const sim = new ArenaSimulation();
    sim.setFervor(100);
    sim.frame(0, input(), { routPressed: true });
    expect(sim.pending("rout")).toBe(true);
    sim.frame(STEP, input());
    expect(sim.pending("rout")).toBe(false);
    expect(sim.executing).toBe("rout");
    expect(sim.uses.get("SKL-WARRIOR-ROUT")).toBe(1);
  });

  it("Tab で武器を替える。技の実行中は替えない", () => {
    const sim = new ArenaSimulation();
    expect(sim.weapon.uid).toBe("test-greatsword");
    sim.frame(STEP, input(), { switchWeapon: true });
    expect(sim.weapon.uid).toBe("test-greataxe");
    sim.frame(STEP, input({ pressed: ["skill1"] }));
    expect(sim.executing).toBe("skill1");
    sim.frame(STEP, input(), { switchWeapon: true });
    expect(sim.weapon.uid).toBe("test-greataxe");
  });

  it("人形の正面から通常攻撃が当たり、ヒットの手応えで止まる間も押した回避を保持する", () => {
    const hits: boolean[] = [];
    const sim = new ArenaSimulation(undefined, { onHit: (r) => hits.push(r.backstab) });
    // 人形（20, 12）の左1.2mまで歩く。照準は右（人形の方）
    while (sim.motion.position.x < 18.8 - 1e-9) sim.frame(STEP, input({ move: { x: 1, y: 0 } }));
    const before = sim.dummy.health.hp;
    sim.frame(STEP, input({ pressed: ["skill1"] }));
    // 当たるまで進める（予兆は 0.3/1.4 秒）
    let guard = 0;
    while (sim.hitCount === 0 && guard++ < 60) sim.frame(STEP, input());
    expect(sim.hitCount).toBe(1);
    expect(hits).toEqual([false]); // 正面からなので背面ではない
    expect(sim.dummy.health.hp).toBeLessThan(before);
    // ヒットの手応え（0.05秒）の最中に押した回避は、止まっている刻みでは使われず保持される
    const time = sim.time;
    sim.frame(STEP, input({ pressed: ["dodge"] }));
    expect(sim.time).toBe(time);
    expect(sim.dodgePending).toBe(true);
    for (let i = 0; i < 5; i++) sim.frame(STEP, input());
    expect(sim.dodgePending).toBe(false);
    expect(sim.motion.dodging).toBe(true);
    // 回避で攻撃を取り消す
    expect(sim.executing).toBeUndefined();
  });
});

describe("ArenaSimulation：回避の入力がない場合は従来どおり", () => {
  it("移動は毎秒5m（フレームの区切り方によらない）", () => {
    const sim = new ArenaSimulation();
    // 0刻みのフレームを混ぜても、合計1秒で5m
    for (let i = 0; i < 60; i++) {
      sim.frame(STEP / 2, input({ move: { x: 0, y: -1 } }));
      sim.frame(STEP / 2, input({ move: { x: 0, y: -1 } }));
    }
    expect(START.y - sim.motion.position.y).toBeCloseTo(5, 6);
    expect(sim.motion.dodging).toBe(false);
    expect(sim.motion.currentStamina).toBe(100);
  });

  it("照準はマウスの位置へ向く", () => {
    const sim = new ArenaSimulation();
    sim.frame(STEP, {
      ...input(),
      pointerWorld: { x: toPixels(START.x), y: toPixels(START.y - 5) },
    });
    expect(sim.motion.direction8).toBe(6);
  });

  it("刻みが1以上のフレームで押した場合は、修正前と同じ結果になる", () => {
    // 修正前の処理（そのフレームの最初の刻みにだけ回避を渡す）を参照として、結果を比べる
    const frameArb = fc.record({
      steps: fc.integer({ min: 1, max: 5 }),
      dodge: fc.boolean(),
      mx: fc.integer({ min: -1, max: 1 }),
      my: fc.integer({ min: -1, max: 1 }),
    });
    fc.assert(
      fc.property(fc.array(frameArb, { maxLength: 80 }), (frames) => {
        // 入力の処理の比較なので、試験用の敵は出さない（U-09。敵の攻撃でよろめくと移動が変わるため）
        const sim = new ArenaSimulation(new FixedStepClock(STEP, 5), { enemies: false });
        const ref = new PlayerMotion({ ...START }, undefined, {
          minX: 0.5,
          minY: 0.75,
          maxX: ARENA.width - 0.5,
          maxY: ARENA.height - 0.25,
        });
        for (const f of frames) {
          const frame = input({
            pressed: f.dodge ? ["dodge"] : [],
            move: { x: f.mx, y: f.my },
          });
          sim.frame(f.steps * STEP, frame);
          for (let i = 0; i < f.steps; i++) {
            const p = ref.position;
            ref.update(STEP, {
              move: frame.move,
              aim: {
                x: toMeters(frame.pointerWorld.x) - p.x,
                y: toMeters(frame.pointerWorld.y) - p.y,
              },
              dodge: i === 0 && f.dodge,
            });
          }
          expect(sim.dodgePending).toBe(false);
        }
        expect(sim.motion.position).toEqual(ref.position);
        expect(sim.motion.currentStamina).toBe(ref.currentStamina);
        expect(sim.motion.dodging).toBe(ref.dodging);
      }),
      { numRuns: 200 },
    );
  });
});

describe("ArenaSimulation：試験用の敵（U-09）", () => {
  it("第1章の敵6種類の群れが出て、技の対象になる", () => {
    const sim = new ArenaSimulation();
    const groups = new Set(sim.field?.entries.map((e) => e.group));
    expect([...groups].sort()).toEqual(["bear", "boar", "lizards", "rats", "saplings", "wolves"]);
    expect(sim.field?.targets().length).toBeGreaterThan(0);
  });

  it("近くに出した敵に通常攻撃が当たり、敵のヒットとして数える（人形のヒットには数えない）", () => {
    const at: { x: number; y: number }[] = [];
    const sim = new ArenaSimulation(undefined, { onHit: (_r, p) => at.push({ ...p }) });
    const id = sim.spawnEnemy("ENM-THORN-RAT");
    const rat = sim.field?.enemies.find((e) => e.id === id);
    expect(rat).toBeDefined();
    // 照準は右（敵は右3m）。近づいてくる敵に、押し続けで通常攻撃を繰り返す
    const held = { ...input(), held: new Set<Action>(["skill1"]) };
    for (let i = 0; i < 240 && sim.enemyHits === 0; i++) sim.frame(STEP, held);
    expect(sim.enemyHits).toBeGreaterThan(0);
    expect(sim.hitCount).toBe(0);
    expect(at.length).toBeGreaterThan(0);
  });

  it("よろめいている間は、技も回避も使えない（押した回避は保持されずに消える）", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    expect(sim.player.stagger.breakNow()).toBe(true);
    sim.frame(STEP, input({ pressed: ["dodge", "skill1"] }));
    expect(sim.motion.dodging).toBe(false);
    expect(sim.executing).toBeUndefined();
    expect(sim.dodgePending).toBe(false);
  });
});

describe("ArenaSimulation：転職・経験値（U-10）", () => {
  it("G で転職すると、技の並び・職能ゲージ・武器が盗賊のものになり、ジョブLvは混ざらない", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    expect(sim.job.id).toBe("JOB-WARRIOR");
    expect(sim.character.jobLevel("JOB-WARRIOR")).toBe(15);
    sim.frame(STEP, input(), { changeJob: true });
    expect(sim.job.id).toBe("JOB-ROGUE");
    expect(sim.loadout[1]?.skill).toBe("SKL-ROGUE-FLURRY");
    expect(sim.weapon.uid).toBe("test-dagger");
    expect(sim.jobGauge.def.id).not.toBe("GAU-FERVOR");
    expect(sim.character.jobLevel("JOB-WARRIOR")).toBe(15);
    // 盗賊の連刃（右クリック）は、刻みが0のフレームで押しても保持され、次の刻みで使う
    sim.frame(0, input({ pressed: ["skill2"] }));
    expect(sim.pending("skill2")).toBe(true);
    sim.frame(STEP, input());
    expect(sim.uses.get("SKL-ROGUE-FLURRY")).toBe(1);
  });

  it("経験値でLvが上がると、HPを全回復する", () => {
    const texts: string[] = [];
    const sim = new ArenaSimulation(undefined, {
      enemies: false,
      onText: (label) => texts.push(label),
    });
    const before = sim.character.level;
    sim.player.health.takeDamage(10);
    sim.gainXp(1e6);
    expect(sim.character.level).toBeGreaterThan(before);
    expect(sim.player.health.hp).toBe(sim.player.health.maxHp);
    expect(sim.levelUps).toBeGreaterThan(0);
    expect(texts.length).toBe(1);
  });
});

describe("EnemyField.update：経過時間の検証", () => {
  it.each([Infinity, NaN, -1])("%s は、敵を1体も動かす前に RangeError", (bad) => {
    const sim = new ArenaSimulation();
    const field = sim.field;
    if (field === undefined) throw new Error("敵の場がない");
    const before = field.enemies.map((e) => ({
      state: e.state,
      time: e.timeInState,
      position: e.position,
      facing: e.facing,
      hp: e.combatant.health.hp,
    }));
    const hooks = { onPlayerHit: vi.fn(), onAvoided: vi.fn(), onEnemyKilled: vi.fn() };
    expect(() => {
      field.update(bad, sim.player, false, 0, hooks);
    }).toThrow(RangeError);
    expect(
      field.enemies.map((e) => ({
        state: e.state,
        time: e.timeInState,
        position: e.position,
        facing: e.facing,
        hp: e.combatant.health.hp,
      })),
    ).toEqual(before);
    expect(hooks.onPlayerHit).not.toHaveBeenCalled();
  });
});
