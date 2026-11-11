import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import {
  type Combatant,
  FIXED_STEP_SECONDS,
  FixedStepClock,
  type MotionInput,
  PlayerMotion,
} from "@stella/core";
import type { Action } from "../src/input/actions.ts";
import type { InputFrame } from "../src/input/frame.ts";
import { ARENA, ArenaSimulation, poisonAmplifier } from "../src/scenes/arena-simulation.ts";
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
    // U-08 で skill3〜6 は戦士の技の枠に、U-11 で interact（F）は装備を拾う操作になったので、使わない行動は薬瓶・インベントリ
    sim.frame(0, input({ pressed: ["flaskHp", "flaskMp", "inventory"] }));
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

  it("技の枠に入れた破軍（4キー）の押した瞬間も、刻みが0のフレームで保持し、闘志100で次の刻みに使う", () => {
    const sim = new ArenaSimulation();
    expect(sim.setSlotSkill(5, "SKL-WARRIOR-ROUT")).toBe(true);
    sim.setFervor(100);
    sim.frame(0, input({ pressed: ["skill6"] }));
    expect(sim.pending("skill6")).toBe(true);
    sim.frame(STEP, input());
    expect(sim.pending("skill6")).toBe(false);
    expect(sim.executing).toBe("skill6");
    expect(sim.uses.get("SKL-WARRIOR-ROUT")).toBe(1);
  });

  it("Tab で武器を替える。技の実行中は替えない", () => {
    const sim = new ArenaSimulation();
    expect(sim.weapon?.uid).toBe("test-greatsword");
    sim.frame(STEP, input(), { switchWeapon: true });
    expect(sim.weapon?.uid).toBe("test-greataxe");
    sim.frame(STEP, input({ pressed: ["skill1"] }));
    expect(sim.executing).toBe("skill1");
    sim.frame(STEP, input(), { switchWeapon: true });
    expect(sim.weapon?.uid).toBe("test-greataxe");
  });

  it("人形の正面から通常攻撃が当たり、ヒットの手応えで止まる間も押した回避を保持する", () => {
    const hits: boolean[] = [];
    const sim = new ArenaSimulation(undefined, { onHit: (r) => hits.push(r.backstab) });
    // 人形（20, 12）の左1.2mまで歩く。照準は右（人形の方）
    while (sim.motion.position.x < 18.8 - 1e-9) sim.frame(STEP, input({ move: { x: 1, y: 0 } }));
    const before = sim.dummy?.health.hp ?? 0;
    sim.frame(STEP, input({ pressed: ["skill1"] }));
    // 当たるまで進める（予兆は 0.3/1.4 秒）
    let guard = 0;
    while (sim.hitCount === 0 && guard++ < 60) sim.frame(STEP, input());
    expect(sim.hitCount).toBe(1);
    expect(hits).toEqual([false]); // 正面からなので背面ではない
    expect(sim.dummy?.health.hp).toBeLessThan(before);
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
    expect(sim.weapon?.uid).toBe("test-dagger");
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

describe("ArenaSimulation：地面の物と拾得（U-11、補助仕様書13章）", () => {
  /** プレイヤーの位置にドロップを置く（精鋭 Lv5：アイテム2〜4個・金貨は必ず）。 */
  function withLoot(): ArenaSimulation {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    sim.dropLoot("elite", 5, sim.motion.position);
    return sim;
  }

  it("金貨・素材は半径1.5m以内なら自動で拾い、装備は拾わない", () => {
    const sim = withLoot();
    const items = sim.loot.drops.filter((d) => d.kind === "item").length;
    const owned = sim.inventory.items.length;
    expect(items).toBeGreaterThanOrEqual(2);
    sim.frame(STEP, input());
    expect(sim.inventory.gold).toBeGreaterThan(0);
    expect(sim.loot.drops.every((d) => d.kind === "item")).toBe(true);
    expect(sim.loot.drops).toHaveLength(items);
    expect(sim.inventory.items).toHaveLength(owned);
  });

  it("F で、近くの装備を1回に1つ拾う（刻みが0のフレームで押しても保持する）", () => {
    const sim = withLoot();
    const items = sim.loot.drops.filter((d) => d.kind === "item").length;
    // 試験用の持ち物（装備していない武器）を数に含める
    const owned = sim.inventory.items.length;
    sim.frame(0, input({ pressed: ["interact"] }));
    expect(sim.pending("interact")).toBe(true);
    sim.frame(STEP, input());
    expect(sim.pending("interact")).toBe(false);
    expect(sim.inventory.items).toHaveLength(owned + 1);
    for (let i = 0; i < 10; i++) sim.frame(STEP, input());
    expect(sim.inventory.items).toHaveLength(owned + 1);
    for (let i = 1; i < items; i++) sim.frame(STEP, input({ pressed: ["interact"] }));
    expect(sim.inventory.items).toHaveLength(owned + items);
    expect(sim.loot.drops).toHaveLength(0);
  });

  it("1.5mより遠い物は拾わない", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    const p = sim.motion.position;
    sim.dropLoot("elite", 5, { x: p.x + 6, y: p.y });
    const before = sim.loot.drops.length;
    sim.frame(STEP, input({ pressed: ["interact"] }));
    expect(sim.loot.drops).toHaveLength(before);
    expect(sim.inventory.gold).toBe(0);
  });

  it("インベントリがいっぱいなら、装備は拾えず地面に残る", () => {
    const texts: string[] = [];
    const sim = new ArenaSimulation(undefined, { enemies: false, onText: (t) => texts.push(t) });
    for (let i = 0; i < sim.inventory.capacity; i++)
      sim.inventory.addItem({
        uid: `fill-${String(i)}`,
        base: "BASE-WPN-LONGSWORD-T1",
        rarity: "normal",
        itemLevel: 1,
        affixes: [],
      });
    sim.dropLoot("elite", 5, sim.motion.position);
    const items = sim.loot.drops.filter((d) => d.kind === "item").length;
    sim.frame(STEP, input({ pressed: ["interact"] }));
    expect(sim.inventory.items).toHaveLength(sim.inventory.capacity);
    expect(sim.loot.drops.filter((d) => d.kind === "item")).toHaveLength(items);
    expect(texts).toContain("インベントリがいっぱい");
  });

  it("敵を倒すとドロップを抽選する（同じ操作なら同じ結果）", () => {
    const run = (): number[] => {
      const sim = new ArenaSimulation();
      const id = sim.spawnEnemy("ENM-THORN-RAT");
      const rat = sim.field?.enemies.find((e) => e.id === id);
      // 確実に倒すため、HPを1にしてから通常攻撃を押し続ける
      rat?.combatant.health.takeDamage(rat.combatant.health.hp - 1);
      const held = { ...input(), held: new Set<Action>(["skill1"]) };
      for (let i = 0; i < 240 && (sim.field?.kills ?? 0) === 0; i++) sim.frame(STEP, held);
      for (let i = 0; i < 60; i++) sim.frame(STEP, input());
      return [sim.field?.kills ?? 0, sim.loot.drops.length, sim.inventory.gold];
    };
    const a = run();
    expect(a[0]).toBe(1);
    expect(run()).toEqual(a);
  });
});

describe("ArenaSimulation：装備の着替え（U-12）", () => {
  it("試験用の持ち物は、データのベースの武器。初期の武器を主手に装備している", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    expect(sim.weapon?.base).toBe("BASE-WPN-GREATSWORD-T1");
    expect(sim.inventory.items.every((i) => sim.db.itemBases.has(i.base))).toBe(true);
    expect(sim.inventory.items.some((i) => i.uid === "test-greatsword")).toBe(false);
  });

  it("インベントリの装備を装備・外すと、戦闘の能力値（攻撃する側・攻撃速度）が、表示と同じ計算で変わる", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    const before = sim.attackSpeed;
    expect(sim.equipFromInventory("test-dagger")).toBe(true);
    expect(sim.weapon?.uid).toBe("test-dagger");
    // 大剣はインベントリに戻る
    expect(sim.inventory.items.some((i) => i.uid === "test-greatsword")).toBe(true);
    expect(sim.attackSpeed).not.toBe(before);
    expect(sim.attacker).toBe(sim.sheet.attacker);
    expect(sim.attackSpeed).toBe(sim.sheet.attackSpeed);
    expect(sim.attacker.weapon?.uid).toBe("test-dagger");
    // 戦士は二刀流ができる：片手斧を副手に
    expect(sim.canDualWield).toBe(true);
    expect(sim.equipFromInventory("test-axe", "offHand")).toBe(true);
    expect(sim.equipment.get("offHand")?.uid).toBe("test-axe");
    // 両手武器を主手に持つと、副手が外れる
    expect(sim.equipFromInventory("test-greatsword", "mainHand")).toBe(true);
    expect(sim.equipment.get("offHand")).toBeUndefined();
    expect(sim.unequip("mainHand")).toBe(true);
    expect(sim.weapon).toBeUndefined();
    expect(sim.attacker.weapon?.uid).toBe("unarmed"); // 素手（仕様書v0.2 3.2）
    expect(sim.affinity).toBe("A");
  });

  it("装備できない部位・技の実行中は、何も変えない", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    expect(sim.equipFromInventory("test-greataxe", "offHand")).toBe(false);
    expect(sim.equipFromInventory("no-such-item")).toBe(false);
    sim.frame(STEP, input({ pressed: ["skill1"] }));
    expect(sim.executing).toBe("skill1");
    expect(sim.equipFromInventory("test-dagger")).toBe(false);
    expect(sim.unequip("mainHand")).toBe(false);
    expect(sim.weapon?.uid).toBe("test-greatsword");
  });

  it("着替えた武器で人形を叩くと、そのヒットはその武器で計算される", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    sim.equipFromInventory("test-dagger");
    // 人形（20, 12）の左1.2mまで歩く。照準は右（人形の方）
    while (sim.motion.position.x < 18.8 - 1e-9) sim.frame(STEP, input({ move: { x: 1, y: 0 } }));
    sim.frame(STEP, input({ pressed: ["skill1"] }));
    for (let i = 0; i < 60 && sim.hitCount === 0; i++) sim.frame(STEP, input());
    expect(sim.hitCount).toBe(1);
    expect(sim.lastHit?.hit.weaponUid).toBe("test-dagger");
  });
});

describe("ArenaSimulation：技の枠の設定（U-12）", () => {
  it("初期の並び：枠1は通常攻撃、6つ目より後に覚える技（破軍）は枠に入っていない", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    expect(sim.loadout.map((l) => l.skill)).toEqual([
      "SKL-BASIC-ATTACK",
      "SKL-WARRIOR-SWEEP",
      "SKL-WARRIOR-CHARGE",
      "SKL-WARRIOR-WARCRY",
      "SKL-WARRIOR-EARTHSPLITTER",
      "SKL-WARRIOR-WHIRLWIND",
    ]);
    expect(sim.assignableSkills()).toContain("SKL-WARRIOR-ROUT");
  });

  it("ほかの枠にある技を入れると入れ替わる。空けることもできる。覚えていない技・範囲外の枠は入れない", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    expect(sim.setSlotSkill(1, "SKL-WARRIOR-WARCRY")).toBe(true);
    const at = (i: number): string | undefined =>
      sim.loadout.find((l) => l.action === `skill${String(i + 1)}`)?.skill;
    expect(at(1)).toBe("SKL-WARRIOR-WARCRY");
    expect(at(3)).toBe("SKL-WARRIOR-SWEEP");
    expect(sim.setSlotSkill(2, undefined)).toBe(true);
    expect(at(2)).toBeUndefined();
    expect(sim.setSlotSkill(2, "SKL-ROGUE-FLURRY")).toBe(false);
    expect(sim.setSlotSkill(6, "SKL-WARRIOR-ROUT")).toBe(false);
    expect(sim.setSlotSkill(-1, "SKL-WARRIOR-ROUT")).toBe(false);
  });

  it("順に替える：入れられる技の順に進み、最後の次は空き", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    const options = sim.assignableSkills();
    const seen: (string | undefined)[] = [];
    for (let i = 0; i <= options.length; i++) {
      sim.cycleSlotSkill(5);
      seen.push(sim.loadout.find((l) => l.action === "skill6")?.skill);
    }
    expect(seen).toContain("SKL-WARRIOR-ROUT");
    expect(seen).toContain(undefined);
  });

  it("技の枠はジョブごとに残る（転職して戻すと元の並び）", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    sim.setSlotSkill(5, "SKL-WARRIOR-ROUT");
    sim.changeJob();
    expect(sim.job.id).toBe("JOB-ROGUE");
    expect(sim.loadout[1]?.skill).toBe("SKL-ROGUE-FLURRY");
    sim.changeJob();
    expect(sim.loadout.find((l) => l.action === "skill6")?.skill).toBe("SKL-WARRIOR-ROUT");
  });

  it("技の実行中は替えない", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    sim.frame(STEP, input({ pressed: ["skill1"] }));
    expect(sim.executing).toBe("skill1");
    expect(sim.setSlotSkill(5, "SKL-WARRIOR-ROUT")).toBe(false);
  });
});

describe("ArenaSimulation：セーブ・ロード（U-13）", () => {
  it("セーブデータにして戻すと、着替え・技の枠・金貨・Lvが同じ状態で始まる", async () => {
    const { MemoryBackend, SaveStore } = await import("@stella/core");
    const sim = new ArenaSimulation(undefined, { enemies: false });
    sim.equipFromInventory("test-dagger");
    sim.setSlotSkill(5, "SKL-WARRIOR-ROUT");
    sim.inventory.addGold(77);
    sim.gainXp(500);
    const store = new SaveStore(sim.db, new MemoryBackend());
    store.save(1, sim.saveData());
    const r = store.load(1);
    if (!r.ok) throw new Error(r.error?.message ?? "空");
    const back = new ArenaSimulation(undefined, { enemies: false, db: sim.db, profile: r.profile });
    expect(back.weapon?.uid).toBe("test-dagger");
    expect(back.loadout.find((l) => l.action === "skill6")?.skill).toBe("SKL-WARRIOR-ROUT");
    expect(back.inventory.gold).toBe(77);
    expect(back.character.level).toBe(sim.character.level);
    expect(back.character.progress.xp).toBe(sim.character.progress.xp);
    // 計算し直した能力値が一致する（T11）
    expect(back.attackSpeed).toBe(sim.attackSpeed);
    expect(back.player.health.maxHp).toBe(sim.player.health.maxHp);
    expect(back.saveData()).toEqual(sim.saveData());
  });

  it("試験用の場はダンジョンとして扱い、60秒ごとに自動セーブの時期になる", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    expect(sim.autosave.due()).toBe(false);
    for (let i = 0; i < Math.ceil(60 / STEP) + 1; i++) sim.frame(STEP, input());
    expect(sim.autosave.due()).toBe(true);
    expect(sim.autosave.due()).toBe(false);
  });

  it("拾った物の uid は、セーブデータの装備の番号の続きから振る", async () => {
    const { MemoryBackend, SaveStore } = await import("@stella/core");
    const sim = new ArenaSimulation(undefined, { enemies: false });
    sim.dropLoot("elite", 5, sim.motion.position);
    for (let i = 0; i < 10; i++) sim.frame(STEP, input({ pressed: ["interact"] }));
    const store = new SaveStore(sim.db, new MemoryBackend());
    store.save(1, sim.saveData());
    const r = store.load(1);
    if (!r.ok) throw new Error(r.error?.message ?? "空");
    const back = new ArenaSimulation(undefined, { enemies: false, db: sim.db, profile: r.profile });
    back.dropLoot("elite", 5, back.motion.position);
    const owned = new Set(back.inventory.items.map((i) => i.uid));
    const dropped = back.loot.drops.flatMap((d) => (d.kind === "item" ? [d.item.uid] : []));
    expect(dropped.length).toBeGreaterThan(0);
    expect(dropped.every((u) => !owned.has(u))).toBe(true);
  });
});

describe("ArenaSimulation：星辰盤（U-14）", () => {
  const PATH = [
    "STAR-GOU-0001",
    "STAR-GOU-0002",
    "STAR-GOU-0003",
    "STAR-GOU-0004",
    "STAR-GATE-BLADE",
    "STAR-GOU-0101",
  ];

  it("始点（戦士）の隣から取れる。能力値の小星で剛が増え、能力値の計算に入る", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    expect(sim.starRoot).toBe("STAR-GOU-START");
    expect(sim.starPoints).toBe(14); // キャラLv15
    const go = sim.sheet.attributes.go;
    const hp = sim.player.health.maxHp;
    expect(sim.allocateStar("STAR-GOU-0002")).toBe(false);
    expect(sim.allocateStar("STAR-GOU-0001")).toBe(true);
    expect(sim.sheet.attributes.go).toBe(go + 10);
    // 剛1につき最大HP+2
    expect(sim.player.health.maxHp).toBe(hp + 20);
  });

  it("剣系から斧に持ち替えると、刃の門の先が休眠し、戻すと復帰する", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    for (const id of PATH) expect(sim.allocateStar(id)).toBe(true);
    expect(sim.sheet.board?.active).toEqual(PATH);
    sim.equipFromInventory("test-greataxe");
    expect(sim.sheet.board?.active).toEqual(PATH.slice(0, 4));
    expect(sim.sheet.board?.dormant.get("STAR-GOU-0101")?.type).toBe("gate");
    sim.equipFromInventory("test-greatsword");
    expect(sim.sheet.board?.active).toEqual(PATH);
  });

  it("返すと還星の灯を1つ使う。つながりを切るノードは返せない。灯が無ければ返せない", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    sim.allocateStar("STAR-GOU-0001");
    sim.allocateStar("STAR-GOU-0002");
    const lamps = sim.inventory.material("MAT-RETURN-LAMP");
    expect(sim.refundStar("STAR-GOU-0001")).toBe("blocked");
    expect(sim.refundStar("STAR-GOU-0002")).toBe("ok");
    expect(sim.inventory.material("MAT-RETURN-LAMP")).toBe(lamps - 1);
    sim.inventory.spendMaterial("MAT-RETURN-LAMP", lamps - 1);
    expect(sim.refundStar("STAR-GOU-0001")).toBe("noLamp");
    expect(sim.stars.nodes).toEqual(["STAR-GOU-0001"]);
  });

  it("盗賊に転職すると始点が変わり、戦士の始点からの取得は休眠する（ポイントは使ったまま）", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    sim.allocateStar("STAR-GOU-0001");
    sim.changeJob();
    expect(sim.starRoot).toBe("STAR-JIN-START");
    expect(sim.sheet.board?.dormant.get("STAR-GOU-0001")?.type).toBe("disconnected");
    expect(sim.stars.spent).toBe(1);
  });

  it("星辰盤の取得はセーブデータに入り、戻すと同じ能力値になる", async () => {
    const { MemoryBackend, SaveStore } = await import("@stella/core");
    const sim = new ArenaSimulation(undefined, { enemies: false });
    for (const id of PATH) sim.allocateStar(id);
    const store = new SaveStore(sim.db, new MemoryBackend());
    store.save(1, sim.saveData());
    const r = store.load(1);
    if (!r.ok) throw new Error(r.error?.message ?? "空");
    const back = new ArenaSimulation(undefined, { enemies: false, db: sim.db, profile: r.profile });
    expect(back.stars.nodes).toEqual(PATH);
    expect(back.sheet.attributes).toEqual(sim.sheet.attributes);
    expect(back.player.health.maxHp).toBe(sim.player.health.maxHp);
  });
});

describe("ArenaSimulation：鍛冶屋（U-17）", () => {
  it("強化・クラフト・分解ができ、操作のたびに自動セーブのきっかけを知らせる", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    expect(sim.smith("test-axe", { kind: "enhance" })).toEqual({
      ok: false,
      message: "素材が足りない",
    });
    sim.inventory.addMaterial("MAT-MAGIC-DUST", 10);
    expect(sim.smith("test-axe", { kind: "enhance" }).ok).toBe(true);
    expect(sim.inventory.items.find((i) => i.uid === "test-axe")?.enhance).toBe(1);
    expect(sim.autosave.reason).toBe("craft");
    sim.inventory.addMaterial("MAT-AWAKENING-DUST", 1);
    expect(sim.smith("test-axe", { kind: "awaken" }).ok).toBe(true);
    expect(sim.inventory.items.find((i) => i.uid === "test-axe")?.rarity).toBe("magic");
    expect(sim.smith("test-axe", { kind: "awaken" }).message).toBe("レアリティが合わない");
    const r = sim.smith("test-claw", { kind: "disassemble" });
    expect(r.ok).toBe(true);
    expect(r.message).toContain("魔塵");
    expect(sim.inventory.items.some((i) => i.uid === "test-claw")).toBe(false);
  });

  it("強化した武器を装備すると、基礎ダメージが上がる（戦闘の計算に入る）", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    sim.inventory.addMaterial("MAT-MAGIC-DUST", 1000);
    sim.inventory.addMaterial("MAT-STAR-SAND", 1000);
    for (let i = 0; i < 3; i++) sim.smith("test-dagger", { kind: "enhance" });
    sim.equipFromInventory("test-dagger");
    expect(sim.attacker.weapon?.base.physical?.min).toBeCloseTo(4 * 1.15 * 0.6, 12); // 迅の要求値の未達
  });
});

describe("ArenaSimulation：ロードアウト（U-20、仕様書v0.2 4.13）", () => {
  /** 訓練用の人形の近く（安全地帯）へ動かす。 */
  function toSafeZone(sim: ArenaSimulation): void {
    const p = sim.motion.position;
    sim.motion.displace({ x: 17 - p.x, y: 12 - p.y });
    expect(sim.inSafeZone).toBe(true);
  }

  it("安全地帯でだけ切り替えられる。まだ無いロードアウトは今の状態の写しで作る", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    expect(sim.inSafeZone).toBe(false);
    expect(sim.switchLoadout(2)).toBe("notSafe");
    toSafeZone(sim);
    expect(sim.switchLoadout(1)).toBe("same");
    expect(sim.switchLoadout(4)).toBe("unknown");
    expect(sim.switchLoadout(2)).toBe("ok");
    expect(sim.activeLoadout).toBe(2);
    expect(sim.weapon?.uid).toBe("test-greatsword");
    expect(sim.loadouts.map((l) => l.id)).toEqual([1, 2]);
  });

  it("ロードアウトごとに装備と星辰盤を別々に持ち、切り替えると戻る", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    toSafeZone(sim);
    sim.allocateStar("STAR-GOU-0001");
    expect(sim.switchLoadout(2)).toBe("ok");
    // ロードアウト2：短剣に持ち替え、星辰盤を振り直す
    sim.equipFromInventory("test-dagger");
    expect(sim.resetStars()).toBe(true);
    sim.allocateStar("STAR-GOUJIN-0001");
    expect(sim.switchLoadout(1)).toBe("ok");
    expect(sim.weapon?.uid).toBe("test-greatsword");
    expect(sim.stars.nodes).toEqual(["STAR-GOU-0001"]);
    expect(sim.inventory.items.some((i) => i.uid === "test-dagger")).toBe(true);
    expect(sim.switchLoadout(2)).toBe("ok");
    expect(sim.weapon?.uid).toBe("test-dagger");
    expect(sim.stars.nodes).toEqual(["STAR-GOUJIN-0001"]);
    expect(sim.inventory.items.some((i) => i.uid === "test-greatsword")).toBe(true);
  });

  it("分解した装備を登録していたロードアウトは、その部位が空きになる（M-15）", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    toSafeZone(sim);
    sim.switchLoadout(2);
    sim.equipFromInventory("test-dagger");
    sim.switchLoadout(1);
    // ロードアウト2 の主手の短剣を分解する
    expect(sim.smith("test-dagger", { kind: "disassemble" }).ok).toBe(true);
    expect(sim.loadouts.find((l) => l.id === 2)?.equipment.mainHand).toBeUndefined();
    expect(sim.switchLoadout(2)).toBe("ok");
    expect(sim.weapon).toBeUndefined();
  });

  it("ロードアウトはセーブデータに入り、戻すと同じ一覧になる", async () => {
    const { MemoryBackend, SaveStore } = await import("@stella/core");
    const sim = new ArenaSimulation(undefined, { enemies: false });
    toSafeZone(sim);
    sim.switchLoadout(2);
    sim.equipFromInventory("test-axe");
    sim.allocateStar("STAR-GOU-0001");
    sim.switchLoadout(3);
    const store = new SaveStore(sim.db, new MemoryBackend());
    store.save(1, sim.saveData());
    const r = store.load(1);
    if (!r.ok) throw new Error(r.error?.message ?? "空");
    const back = new ArenaSimulation(undefined, { enemies: false, db: sim.db, profile: r.profile });
    expect(back.activeLoadout).toBe(3);
    expect(back.loadouts).toEqual(sim.loadouts);
  });
});

describe("ArenaSimulation：町とダンジョン（U-18a、補助仕様書7〜9章）", () => {
  const db = new ArenaSimulation(undefined, { enemies: false }).db;
  const town = db.regions.get("REGION-TOWN");
  const a1 = db.regions.get("REGION-A1");
  if (town === undefined || a1 === undefined) throw new Error("地域が無い");
  const walkTo = (sim: ArenaSimulation, x: number, y: number): void => {
    const p = sim.motion.position;
    sim.motion.displace({ x: x - p.x, y: y - p.y });
  };

  it("町：敵はいない・安全地帯・訓練用の人形・商人の品揃え。F で施設を使う", () => {
    const used: string[] = [];
    const sim = new ArenaSimulation(undefined, {
      db,
      region: town,
      onFacility: (k) => used.push(k),
    });
    expect(sim.field).toBeUndefined();
    expect(sim.inSafeZone).toBe(true);
    expect(sim.dummy).toBeDefined();
    expect(sim.merchantStock.length).toBeGreaterThan(0);
    const smith = town.facilities?.find((f) => f.kind === "smith");
    if (smith === undefined) throw new Error("鍛冶屋が無い");
    walkTo(sim, smith.at.x, smith.at.y + 1);
    expect(sim.nearbyInteractable()).toEqual({ kind: "facility", facility: "smith" });
    sim.frame(STEP, input({ pressed: ["interact"] }));
    expect(used).toEqual(["smith"]);
  });

  it("町：倉庫へ移して戻す・売る（ロードアウトの参照も空き）・買う", () => {
    const sim = new ArenaSimulation(undefined, { db, region: town });
    expect(sim.toStash("test-axe")).toBe(true);
    expect(sim.stash.items.map((i) => i.uid)).toEqual(["test-axe"]);
    expect(sim.fromStash("test-axe")).toBe(true);
    const price = sim.sell("test-claw");
    expect(price).toBeGreaterThan(0);
    expect(sim.inventory.gold).toBe(price);
    expect(sim.autosave.reason).toBe("trade");
    sim.inventory.addGold(1000);
    const stock = sim.merchantStock[0];
    if (stock === undefined) throw new Error("品揃えが無い");
    expect(sim.buy(stock.uid)).toBe(true);
    expect(sim.inventory.items.some((i) => i.uid === stock.uid)).toBe(true);
  });

  it("ダンジョン（A1）：入るたびの配置で敵と宝箱を置く。シードが違えば配置が変わる", () => {
    const a = new ArenaSimulation(undefined, { db, region: a1, layoutSeed: "x1" });
    const b = new ArenaSimulation(undefined, { db, region: a1, layoutSeed: "x2" });
    expect(a.field?.entries.length ?? 0).toBeGreaterThan(0);
    expect(a.dummy).toBeUndefined();
    expect(a.inSafeZone).toBe(false);
    expect(a.chests.length).toBeGreaterThanOrEqual(3);
    const pos = (s: ArenaSimulation): string =>
      JSON.stringify(
        s.field?.entries.map((e) => [Math.round(e.enemy.combatant.position.x), e.enemy.def.id]),
      );
    expect(pos(a)).not.toBe(pos(b));
    expect(a.motion.position).toEqual(a1.entrance);
  });

  it("ダンジョン：宝箱を F で開けると中身が出る。転移の石に触れると解放する", () => {
    const sim = new ArenaSimulation(undefined, { db, region: a1, layoutSeed: "chest" });
    const chest = sim.chests[0];
    if (chest === undefined) throw new Error("宝箱が無い");
    walkTo(sim, chest.at.x, chest.at.y + 1);
    sim.frame(STEP, input({ pressed: ["interact"] }));
    expect(chest.opened).toBe(true);
    const stone = a1.teleportStone;
    if (stone === undefined) throw new Error("転移の石が無い");
    walkTo(sim, stone.x + 1, stone.y);
    sim.frame(STEP, input({ pressed: ["interact"] }));
    expect(sim.unlockedRegions.has("REGION-A1")).toBe(true);
    expect(sim.profile().unlockedRegions).toContain("REGION-A1");
  });

  it("ダンジョン：出口に入ると、行き先を知らせる（1回だけ）", () => {
    const exits: string[] = [];
    const sim = new ArenaSimulation(undefined, { db, region: a1, onExit: (to) => exits.push(to) });
    walkTo(sim, 1, 24);
    sim.frame(STEP, input());
    sim.frame(STEP, input());
    expect(exits).toEqual(["REGION-TOWN"]);
  });

  it("ダンジョンで倒れると、死亡の回数と原因を記録し、町に戻すことを知らせる（補助仕様書7章）", () => {
    let died = 0;
    const sim = new ArenaSimulation(undefined, { db, region: a1, onDeath: () => (died += 1) });
    sim.player.health.takeDamage(sim.player.health.maxHp * 2);
    sim.frame(STEP, input());
    sim.frame(STEP, input());
    expect(died).toBe(1);
    expect(sim.deathLog.count).toBe(1);
    expect(sim.profile().deathLog.count).toBe(1);
  });

  it("地域から地域へ移るときは、HP・MPの割合を引き継げる", () => {
    const sim = new ArenaSimulation(undefined, { db, region: a1, carry: { hp: 0.5, mp: 0.25 } });
    expect(sim.player.health.hp / sim.player.health.maxHp).toBeCloseTo(0.5, 9);
    expect(sim.mp / sim.maxMp).toBeCloseTo(0.25, 9);
  });
});

describe("新しいキャラクター（補助仕様書3.4）", () => {
  it("キャラLv1・出自の武器（戦士は大剣・盗賊は短剣）・通常攻撃と、ジョブLv1で覚える技", async () => {
    const { newCharacterProfile } = await import("../src/scenes/arena-simulation.ts");
    const db = new ArenaSimulation(undefined, { enemies: false }).db;
    for (const [job, base, skill] of [
      ["JOB-WARRIOR", "BASE-WPN-GREATSWORD-T1", "SKL-WARRIOR-SWEEP"],
      ["JOB-ROGUE", "BASE-WPN-DAGGER-T1", "SKL-ROGUE-FLURRY"],
    ] as const) {
      const sim = new ArenaSimulation(undefined, {
        db,
        enemies: false,
        profile: newCharacterProfile(db, job, "テスト"),
      });
      expect(sim.character.level).toBe(1);
      expect(sim.job.id).toBe(job);
      expect(sim.weapon?.base).toBe(base);
      expect(sim.inventory.items).toHaveLength(0);
      expect(sim.blockOf("SKL-BASIC-ATTACK")).toBeUndefined();
      expect(sim.blockOf(skill)).not.toBe("locked");
      expect(sim.starPoints).toBe(0);
    }
  });
});

describe("ArenaSimulation：第1章の地域・クエスト・隠し星（U-18b、補助仕様書9章）", () => {
  const db = new ArenaSimulation(undefined, { enemies: false }).db;
  const region = (id: string) => {
    const r = db.regions.get(id);
    if (r === undefined) throw new Error(`${id} が無い`);
    return r;
  };

  it("A1→A2→A3→A4 の出口がつながっている", () => {
    expect(region("REGION-A1").exits?.map((x) => x.to)).toEqual(["REGION-TOWN", "REGION-A2"]);
    expect(region("REGION-A2").exits?.map((x) => x.to)).toEqual(["REGION-A1", "REGION-A3"]);
    expect(region("REGION-A3").exits?.map((x) => x.to)).toEqual(["REGION-A2", "REGION-A4"]);
    expect(region("REGION-A4").exits?.map((x) => x.to)).toEqual(["REGION-A3", "REGION-A4-BOSS"]);
  });

  it("A2 に入るとクエスト「森の異変」の段階1を終え、星辰盤のポイントが1増える（1回だけ）", () => {
    const sim = new ArenaSimulation(undefined, { db, region: region("REGION-A1") });
    const before = sim.starPoints;
    const a2 = new ArenaSimulation(undefined, {
      db,
      region: region("REGION-A2"),
      profile: sim.profile(),
    });
    expect(a2.questStages.has("QUEST-FOREST-1")).toBe(true);
    expect(a2.starPoints).toBe(before + 1);
    const again = new ArenaSimulation(undefined, {
      db,
      region: region("REGION-A2"),
      profile: a2.profile(),
    });
    expect(again.starPoints).toBe(before + 1);
  });

  it("A3 には中ボスがいつもいる。倒すと段階2を終える", () => {
    const sim = new ArenaSimulation(undefined, {
      db,
      region: region("REGION-A3"),
      layoutSeed: "a3",
    });
    const boss = sim.field?.entries.find((e) => e.enemy.def.id === "ENM-PACK-LEADER");
    expect(boss).toBeDefined();
    expect(boss?.enemy.level).toBe(11);
    const points = sim.starPoints;
    // 中ボスのHPを1にして、倒す（敵が倒れたときの処理を通す）
    const c = boss?.enemy.combatant;
    c?.health.takeDamage(c.health.hp + 1);
    for (let i = 0; i < 5; i++) sim.frame(STEP, input());
    expect(sim.questStages.has("QUEST-FOREST-2")).toBe(true);
    expect(sim.starPoints).toBe(points + 1);
  });

  it("A3 の怪しい茂みを F で調べると、隠し星（探索のポイント+1）を1回だけ得る", () => {
    const sim = new ArenaSimulation(undefined, { db, region: region("REGION-A3"), enemies: false });
    const bush = region("REGION-A3").secrets?.[0];
    if (bush === undefined) throw new Error("隠し星が無い");
    const p = sim.motion.position;
    sim.motion.displace({ x: bush.at.x - p.x, y: bush.at.y - 1 - p.y });
    const points = sim.starPoints;
    expect(sim.nearbyInteractable()).toMatchObject({ kind: "secret", id: "SECRET-A3-BUSH" });
    sim.frame(STEP, input({ pressed: ["interact"] }));
    expect(sim.starPoints).toBe(points + 1);
    expect(sim.secretsFound.has("SECRET-A3-BUSH")).toBe(true);
    expect(sim.nearbyInteractable()?.kind).not.toBe("secret");
  });
});

describe("ArenaSimulation：母樹（U-19、補助仕様書9・11章）", () => {
  const db = new ArenaSimulation(undefined, { enemies: false }).db;
  const region = (id: string) => {
    const r = db.regions.get(id);
    if (r === undefined) throw new Error(`${id} が無い`);
    return r;
  };
  /** ボスを倒す（段階の境目ごとに、無敵が切れるのを待って削る）。 */
  const defeat = (sim: ArenaSimulation, enemyId: string): void => {
    const boss = sim.field?.entries.find((e) => e.enemy.def.id === enemyId)?.enemy;
    if (boss === undefined) throw new Error(`${enemyId} がいない`);
    for (let i = 0; i < 2000 && boss.state !== "dead"; i++) {
      const h = boss.combatant.health;
      if (!h.invulnerable) h.takeDamage(h.hp);
      sim.frame(STEP, input());
    }
    for (let i = 0; i < 5; i++) sim.frame(STEP, input());
  };

  it("A4 の先に母樹の間（腐根の母樹 Lv14・根渡りの3地点）。A5 への出口は、母樹を倒すまで閉じている", () => {
    const room = region("REGION-A4-BOSS");
    expect(room.fixedEnemies).toEqual([
      expect.objectContaining({ enemy: "ENM-MOTHER-TREE", level: 14 }),
    ]);
    expect(room.fixedEnemies?.[0]?.anchors).toHaveLength(3);
    const toA5 = room.exits?.find((x) => x.to === "REGION-A5");
    expect(toA5?.requires).toEqual({ defeated: "ENM-MOTHER-TREE" });
    const sim = new ArenaSimulation(undefined, { db, region: room, layoutSeed: "room" });
    expect(toA5 !== undefined && sim.exitOpen(toA5)).toBe(false);
    // 閉じた出口に入っても移らない
    const onExit = vi.fn();
    const closed = new ArenaSimulation(undefined, { db, region: room, onExit, enemies: false });
    const p = closed.motion.position;
    closed.motion.displace({ x: 31.5 - p.x, y: 14 - p.y });
    closed.frame(STEP, input());
    expect(onExit).not.toHaveBeenCalled();
    expect(region("REGION-A5").magicPackChance).toBe(0.15);
    expect(region("REGION-A5").eliteSpawns?.length).toBeGreaterThanOrEqual(4);
    expect(region("REGION-A5-BOSS").fixedEnemies?.[0]).toMatchObject({
      enemy: "ENM-ABYSS-MOTHER-TREE",
      level: 21,
    });
  });

  it("母樹を倒すと：討伐証+1・クエストの段階4・初回だけ隠し星・A5 への出口が開く・ドロップ。2回目は隠し星なし", () => {
    const room = region("REGION-A4-BOSS");
    const sim = new ArenaSimulation(undefined, { db, region: room, layoutSeed: "kill1" });
    const points = sim.starPoints;
    defeat(sim, "ENM-MOTHER-TREE");
    expect(sim.bossKills.get("ENM-MOTHER-TREE")).toBe(1);
    expect(sim.bossTokens.get("TOKEN-BOSS-CH1")).toBe(1);
    expect(sim.questStages.has("QUEST-FOREST-4")).toBe(true);
    expect(sim.secretsFound.has("SECRET-MOTHER-TREE")).toBe(true);
    // 段階4の星図の欠片＋隠し星
    expect(sim.starPoints).toBe(points + 2);
    const toA5 = room.exits?.find((x) => x.to === "REGION-A5");
    expect(toA5 !== undefined && sim.exitOpen(toA5)).toBe(true);
    // 章ボスのドロップ：6〜10個・母樹の樹液1・開眼の結晶2
    const items = sim.loot.drops.filter((d) => d.kind === "item");
    // 6〜10個と、初回は確定の専用ユニーク1つ（千の小傷・樹皮の盾・母樹の根冠から）
    expect(items.length).toBeGreaterThanOrEqual(7);
    expect(items.length).toBeLessThanOrEqual(11);
    const exclusive = sim.loot.drops.flatMap((d) =>
      d.kind === "item" && ["BASE-UNQ-U03", "BASE-UNQ-U13", "BASE-UNQ-U18"].includes(d.item.base)
        ? [d]
        : [],
    );
    expect(exclusive).toHaveLength(1);
    const mats = sim.loot.drops.flatMap((d) => (d.kind === "material" ? [d] : []));
    expect(mats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ material: "MAT-BOSS-CORE-CH1", count: 1 }),
        expect.objectContaining({ material: "MAT-INSIGHT-CRYSTAL", count: 2 }),
      ]),
    );
    // セーブデータに残り、入り直すとボスはまた出る
    const again = new ArenaSimulation(undefined, {
      db,
      region: room,
      layoutSeed: "kill2",
      profile: sim.profile(),
    });
    const before = again.starPoints;
    defeat(again, "ENM-MOTHER-TREE");
    expect(again.bossKills.get("ENM-MOTHER-TREE")).toBe(2);
    expect(again.bossTokens.get("TOKEN-BOSS-CH1")).toBe(2);
    expect(again.starPoints).toBe(before);
    const data = again.saveData();
    expect(data.boss_kills).toEqual({ "ENM-MOTHER-TREE": 2 });
    expect(data.boss_tokens).toEqual({ "TOKEN-BOSS-CH1": 2 });
  });

  it("深淵の母樹を倒すと、共通の討伐証を2個得る", () => {
    const sim = new ArenaSimulation(undefined, {
      db,
      region: region("REGION-A5-BOSS"),
      layoutSeed: "abyss",
    });
    defeat(sim, "ENM-ABYSS-MOTHER-TREE");
    expect(sim.bossKills.get("ENM-ABYSS-MOTHER-TREE")).toBe(1);
    expect(sim.bossTokens.get("TOKEN-BOSS-CH1")).toBe(2);
    expect(sim.secretsFound.has("SECRET-MOTHER-TREE")).toBe(false);
  });
});

describe("ArenaSimulation：防具の値がプレイヤーに効く（U-11 の残り）", () => {
  const give = (sim: ArenaSimulation, base: string, uid: string): void => {
    sim.inventory.addItem({ uid, base, rarity: "normal", itemLevel: 1, affixes: [] });
    expect(sim.equipFromInventory(uid)).toBe(true);
  };

  it("着ると、プレイヤーの防具値・耐性・受けるダメージの倍率が能力値と一致する", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    const before = sim.player.armor;
    give(sim, "BASE-ARM-IRON-BODY-T1", "itm_900001");
    give(sim, "BASE-ACC-SILVER-RING-T1", "itm_900002");
    expect(sim.player.armor).toBeCloseTo(before + 40);
    expect(sim.player.armor).toBeCloseTo(sim.sheet.defense.armor);
    expect(sim.player.resist.fire).toBeCloseTo(sim.sheet.defense.resist.fire);
    expect(sim.player.ownReceived.damage).toBe(sim.sheet.defense.damageTaken);
  });

  it("軽装4部位：回避が終わった直後、移動速度が20%上がる", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    ["HEAD", "BODY", "HANDS", "FEET"].forEach((p, i) => {
      give(sim, `BASE-ARM-LEATHER-${p}-T1`, `itm_90001${String(i)}`);
    });
    expect(sim.sheet.uniform).toBe("light");
    const base = sim.sheet.moveSpeed;
    sim.frame(STEP, input({ pressed: ["dodge"], move: { x: 1, y: 0 } }));
    let boosted = false;
    for (let i = 0; i < 60; i++) {
      sim.frame(STEP, input({ move: { x: 1, y: 0 } }));
      if (sim.sheet.moveSpeed > base + 0.19) boosted = true;
    }
    expect(boosted).toBe(true);
    // 0.5秒の後は元に戻る
    for (let i = 0; i < 60; i++) sim.frame(STEP, input());
    expect(sim.sheet.moveSpeed).toBeCloseTo(base);
  });
});

describe("ArenaSimulation：系統詞・基本刻印（U-11 の残り）", () => {
  const killRat = (sim: ArenaSimulation): void => {
    const id = sim.spawnEnemy("ENM-THORN-RAT");
    const rat = sim.field?.enemies.find((e) => e.id === id);
    rat?.combatant.health.takeDamage(rat.combatant.health.hp - 1);
    const held = { ...input(), held: new Set<Action>(["skill1"]) };
    for (let i = 0; i < 240 && (sim.field?.kills ?? 0) === 0 && rat?.state !== "dead"; i++)
      sim.frame(STEP, held);
  };

  it("【獣狩りの】：獣を倒すと3秒間、移動速度+15%", () => {
    const sim = new ArenaSimulation();
    sim.inventory.addItem({
      uid: "itm_910001",
      base: "BASE-ARM-LEATHER-FEET-T1",
      rarity: "magic",
      itemLevel: 3,
      affixes: [{ id: "AFX-SUF-BEAST-HUNTER", tier: 7, rolls: [15] }],
    });
    expect(sim.equipFromInventory("itm_910001")).toBe(true);
    const base = sim.sheet.moveSpeed;
    killRat(sim);
    sim.frame(STEP, input());
    expect(sim.sheet.moveSpeed).toBeCloseTo(base + 0.15);
    for (let i = 0; i < 200; i++) sim.frame(STEP, input());
    expect(sim.sheet.moveSpeed).toBeCloseTo(base);
  });

  it("爪の「ヒットでHP吸収0.5%」：当てると、与えたダメージの0.5%だけ回復する", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    sim.inventory.addItem({
      uid: "itm_910002",
      base: "BASE-WPN-CLAW-T1",
      rarity: "normal",
      itemLevel: 1,
      affixes: [],
    });
    expect(sim.equipFromInventory("itm_910002")).toBe(true);
    // 訓練用の人形（右）の左に立つ
    const p = sim.motion.position;
    sim.motion.displace({ x: 19 - p.x, y: 12 - p.y });
    sim.player.health.takeDamage(sim.player.health.maxHp / 2);
    const held = { ...input(), held: new Set<Action>(["skill1"]) };
    let checked = false;
    for (let i = 0; i < 120 && !checked; i++) {
      const hp = sim.player.health.hp;
      const hits = sim.hitCount;
      sim.frame(STEP, held);
      if (sim.hitCount > hits) {
        const dealt = sim.lastHit?.applied.toHp ?? 0;
        expect(dealt).toBeGreaterThan(0);
        expect(sim.player.health.hp - hp).toBeCloseTo(dealt * 0.005);
        checked = true;
      }
    }
    expect(checked).toBe(true);
  });
});

describe("ArenaSimulation：薬瓶（補助仕様書6章）", () => {
  it("Q で最大HPの40%を1.5秒かけて回復する。回数は1つ減る", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    const max = sim.player.health.maxHp;
    sim.player.health.takeDamage(max * 0.8);
    const before = sim.player.health.hp;
    sim.frame(STEP, input({ pressed: ["flaskHp"] }));
    expect(sim.hpFlask.charges).toBe(2);
    for (let i = 0; i < 100; i++) sim.frame(STEP, input());
    expect(sim.player.health.hp - before).toBeCloseTo(max * 0.4, 0);
  });

  it("革の帯（薬瓶の回復量+15%）が効く。E は最大MPの50%", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    sim.inventory.addItem({
      uid: "itm_920001",
      base: "BASE-ARM-LEATHER-BELT-T1",
      rarity: "normal",
      itemLevel: 1,
      affixes: [],
    });
    expect(sim.equipFromInventory("itm_920001")).toBe(true);
    const max = sim.player.health.maxHp;
    sim.player.health.takeDamage(max * 0.8);
    const before = sim.player.health.hp;
    sim.frame(STEP, input({ pressed: ["flaskHp"] }));
    for (let i = 0; i < 100; i++) sim.frame(STEP, input());
    expect(sim.player.health.hp - before).toBeCloseTo(max * 0.4 * 1.15, 0);
    expect(sim.mpFlask.charges).toBe(3);
  });

  it("敵を倒すと充填がたまり、ダンジョンからダンジョンへは回数を引き継ぐ", () => {
    const sim = new ArenaSimulation();
    sim.frame(STEP, input({ pressed: ["flaskHp"] }));
    expect(sim.hpFlask.charges).toBe(2);
    const id = sim.spawnEnemy("ENM-THORN-RAT");
    const rat = sim.field?.enemies.find((e) => e.id === id);
    rat?.combatant.health.takeDamage(rat.combatant.health.hp);
    for (let i = 0; i < 3; i++) sim.frame(STEP, input());
    expect(sim.hpFlask.fill).toBe(1);
    const next = new ArenaSimulation(undefined, {
      db: sim.db,
      enemies: false,
      carry: { hp: 1, mp: 1, flasks: { hp: sim.hpFlask.state, mp: sim.mpFlask.state } },
    });
    expect(next.hpFlask.state).toEqual({ charges: 2, fill: 1 });
  });
});

describe("ArenaSimulation：ユニークの入手（U-16）", () => {
  const db = new ArenaSimulation(undefined, { enemies: false }).db;
  const town = db.regions.get("REGION-TOWN");

  it("討伐の祭壇：討伐証10個で、母樹の専用ユニークを1つ選んで交換する（町だけ）", () => {
    if (town === undefined) throw new Error("町が無い");
    const sim = new ArenaSimulation(undefined, { db, region: town, layoutSeed: "altar" });
    expect(sim.altarCandidates()).toEqual([
      { token: "TOKEN-BOSS-CH1", bases: ["BASE-UNQ-U03", "BASE-UNQ-U13", "BASE-UNQ-U18"] },
    ]);
    sim.bossTokens.set("TOKEN-BOSS-CH1", 9);
    expect(sim.exchangeAtAltar("BASE-UNQ-U18")).toBe(false);
    sim.bossTokens.set("TOKEN-BOSS-CH1", 12);
    expect(sim.exchangeAtAltar("BASE-UNQ-U02")).toBe(false); // 候補に無い
    expect(sim.exchangeAtAltar("BASE-UNQ-U18")).toBe(true);
    expect(sim.bossTokens.get("TOKEN-BOSS-CH1")).toBe(2);
    const got = sim.inventory.items.find((i) => i.base === "BASE-UNQ-U18");
    expect(got?.rarity).toBe("unique");
    // ダンジョンでは交換できない
    const field = new ArenaSimulation(undefined, { db, enemies: false });
    field.bossTokens.set("TOKEN-BOSS-CH1", 10);
    expect(field.exchangeAtAltar("BASE-UNQ-U03")).toBe(false);
  });

  it("千の小傷：打撃値-40%・必ず出血・出血の最大スタック+4。潜在効果は職紋盤の後なので「？？？」のまま", () => {
    const sim = new ArenaSimulation(undefined, { db, enemies: false });
    sim.character.gainXp(1e6);
    sim.inventory.addItem({
      uid: "itm_930001",
      base: "BASE-UNQ-U03",
      rarity: "unique",
      itemLevel: 18,
      affixes: [],
    });
    expect(sim.equipFromInventory("itm_930001")).toBe(true);
    const view = sim.sheet.evaluated.view;
    const scope = { weaponUid: "itm_930001" };
    expect(view.stat("STAT-DAMAGE", ["TAG-ELEM-PHYSICAL"], scope).more).toBeCloseTo(0.6);
    expect(view.flag("ailmentApply", "TAG-AIL-BLEED", [], scope).resolution).toBe("force");
    expect(view.stat("STAT-AILMENT-MAX-STACKS", ["TAG-AIL-BLEED"]).value).toBeGreaterThanOrEqual(4);
    expect(sim.sheet.latents).toEqual([{ uid: "itm_930001", base: "BASE-UNQ-U03", active: false }]);
  });
});

describe("ArenaSimulation：ユニークの固有効果（U-16 のルールフック）", () => {
  const wear = (sim: ArenaSimulation, base: string, uid: string): void => {
    sim.inventory.addItem({ uid, base, rarity: "unique", itemLevel: 20, affixes: [] });
    expect(sim.equipFromInventory(uid)).toBe(true);
  };
  const near = (sim: ArenaSimulation, id: string, dx: number): Combatant => {
    const eid = sim.spawnEnemy(id);
    const e = sim.field?.enemies.find((x) => x.id === eid);
    if (e === undefined) throw new Error("敵がいない");
    const p = sim.motion.position;
    e.combatant.position = { x: p.x + dx, y: p.y };
    return e.combatant;
  };

  it("U16 背向けの外套：背後にいる敵から受けるダメージ-15%。移動の技（突進）の後2秒は全てのヒットが背面", () => {
    const sim = new ArenaSimulation();
    wear(sim, "BASE-UNQ-U16", "itm_940010");
    const id = sim.spawnEnemy("ENM-FOREST-WOLF");
    const wolf = sim.field?.enemies.find((e) => e.id === id);
    if (wolf === undefined) throw new Error("狼がいない");
    // 狼は左（π）を向いて出る。右側が背後
    wolf.combatant.position = { x: 30, y: 30 };
    sim.player.position = { x: 31.5, y: 30 };
    expect(sim.behindGuardMultiplier(wolf)).toBeCloseTo(0.85);
    sim.player.position = { x: 28.5, y: 30 };
    expect(sim.behindGuardMultiplier(wolf)).toBe(1);
    expect(sim.allHitsBackstab).toBe(false);
    sim.frame(STEP, input({ pressed: ["skill3"] }));
    expect(sim.allHitsBackstab).toBe(true);
    for (let i = 0; i < Math.ceil(2.1 / STEP); i++) sim.frame(STEP, input());
    expect(sim.allHitsBackstab).toBe(false);
  });

  it("U15 打ち鳴らしの籠手：敵を崩すと、周囲4mの敵の崩しゲージを最大値の30%増やす。崩れた敵へのヒットで闘志", () => {
    const sim = new ArenaSimulation();
    wear(sim, "BASE-UNQ-U15", "itm_940012");
    const a = near(sim, "ENM-BARK-BEAR", 1.4);
    const b = near(sim, "ENM-BARK-BEAR", 4.5);
    a.stagger.add(a.stagger.max - 0.001);
    const held = { ...input(), held: new Set<Action>(["skill1"]) };
    for (let i = 0; i < 120 && !a.stagger.broken; i++) sim.frame(STEP, held);
    expect(a.stagger.broken).toBe(true);
    expect(b.stagger.current).toBeGreaterThanOrEqual(b.stagger.max * 0.3 - 1e-6);
    // 崩れている敵へのヒットで闘志が増える（通常の獲得に+3）
    const before = sim.jobGauge.value;
    const hits = sim.enemyHits;
    for (let i = 0; i < 120 && sim.enemyHits === hits; i++) sim.frame(STEP, held);
    expect(sim.jobGauge.value - before).toBeGreaterThanOrEqual(3);
  });

  it("U02 旅人の古靴：10m移動するごとに、全ての技のクールダウンが0.3秒短くなる", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    wear(sim, "BASE-UNQ-U02", "itm_940011");
    sim.cooldowns.start("TEST", 100);
    const start = sim.motion.position.x;
    let t = 0;
    while (sim.motion.position.x - start < 10.5 && t < 10) {
      sim.frame(STEP, input({ move: { x: 1, y: 0 } }));
      t += STEP;
    }
    expect(sim.cooldowns.remaining("TEST")).toBeCloseTo(100 - t - 0.3, 5);
  });

  it("U06 目隠し：会心率の増加1%ごとにダメージ+0.5%（加算）", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    const before = sim.sheet.evaluated.view.stat("STAT-DAMAGE", ["TAG-ELEM-PHYSICAL"]).increased;
    wear(sim, "BASE-UNQ-U06", "itm_940001");
    sim.inventory.addItem({
      uid: "itm_940002",
      base: "BASE-ACC-AMBER-NECK-T1",
      rarity: "magic",
      itemLevel: 5,
      affixes: [{ id: "AFX-SUF-CRIT-CHANCE", tier: 7, rolls: [14] }],
    });
    expect(sim.equipFromInventory("itm_940002")).toBe(true);
    const view = sim.sheet.evaluated.view;
    const critInc = view.stat("STAT-CRIT-CHANCE").increased;
    expect(critInc).toBeGreaterThan(0);
    expect(view.stat("STAT-DAMAGE", ["TAG-ELEM-PHYSICAL"]).increased - before).toBeCloseTo(
      critInc * 0.5,
    );
  });

  it("U13 樹皮の盾：止まっていると1秒ごとに防具値+10%（最大+50%）。動くと0に戻る", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    sim.character.gainXp(1e6);
    wear(sim, "BASE-UNQ-U13", "itm_940003");
    for (let i = 0; i < Math.ceil(2.5 / STEP); i++) sim.frame(STEP, input());
    expect(sim.stillArmorBonus).toBeCloseTo(0.2);
    for (let i = 0; i < Math.ceil(5 / STEP); i++) sim.frame(STEP, input());
    expect(sim.stillArmorBonus).toBeCloseTo(0.5);
    sim.frame(STEP, input({ move: { x: 1, y: 0 } }));
    expect(sim.stillArmorBonus).toBeCloseTo(0);
  });

  it("U17 二股の枝：近くの別の敵にも、そのヒットの50%が当たる（状態異常は付かない）", () => {
    const sim = new ArenaSimulation();
    wear(sim, "BASE-UNQ-U17", "itm_940004");
    const a = near(sim, "ENM-BARK-BEAR", 1.4);
    const b = near(sim, "ENM-BARK-BEAR", 3.5);
    const held = { ...input(), held: new Set<Action>(["skill1"]) };
    let checked = false;
    for (let i = 0; i < 120 && !checked; i++) {
      const ha = a.health.hp;
      const hb = b.health.hp;
      sim.frame(STEP, held);
      const da = ha - a.health.hp;
      const db2 = hb - b.health.hp;
      // a だけに当たった刻みで、b は a の半分だけ減る
      if (da > 0 && b.ailments.activeTags().length === 0 && db2 > 0) {
        expect(db2).toBeCloseTo(da * 0.5, 5);
        checked = true;
      }
    }
    expect(checked).toBe(true);
  });

  it("U14 狼牙の首飾り：倒した敵の出血が、最も近い敵1体に1スタック移る", () => {
    const sim = new ArenaSimulation();
    sim.character.gainXp(1e6);
    wear(sim, "BASE-UNQ-U14", "itm_940005");
    const dying = near(sim, "ENM-THORN-RAT", 6);
    const other = near(sim, "ENM-BARK-BEAR", 9);
    const bleed = sim.db.ailments.get("AIL-BLEED");
    if (bleed?.kind !== "dot" || bleed.stacking.mode !== "stack") throw new Error("出血が無い");
    for (let i = 0; i < 3; i++)
      dying.ailments.apply({
        ailmentId: bleed.id,
        tag: bleed.tag,
        total: 50,
        duration: bleed.duration,
        maxStacks: bleed.stacking.maxStacks,
      });
    dying.health.takeDamage(dying.health.hp);
    sim.frame(STEP, input());
    expect(other.ailments.stacks("AIL-BLEED")).toBe(1);
  });

  it("U18 母樹の根冠：毒10スタックごとに受けるダメージ×1.04（上限×1.20、潜在効果で×1.30）", () => {
    expect(poisonAmplifier(9, 0.04, 0.2)).toBe(1);
    expect(poisonAmplifier(20, 0.04, 0.2)).toBeCloseTo(1.04 ** 2);
    expect(poisonAmplifier(80, 0.04, 0.2)).toBeCloseTo(1.2);
    expect(poisonAmplifier(80, 0.04, 0.3)).toBeCloseTo(1.3);
    expect(poisonAmplifier(80, 0, 0.2)).toBe(1);
    const sim = new ArenaSimulation(undefined, { enemies: false });
    wear(sim, "BASE-UNQ-U18", "itm_940006");
    const view = sim.sheet.evaluated.view;
    expect(view.stat("STAT-UNQ-POISON-AMP").value).toBeCloseTo(0.04);
    expect(view.stat("STAT-UNQ-POISON-AMP-CAP").value).toBeCloseTo(0.2);
  });
});

describe("ArenaSimulation：毒蛇座の完成ボーナス（毒だまり。仕様書v0.2 4.4）", () => {
  it("毒が10スタック以上の敵が移動すると毒だまりができ、中の別の敵に毒が付く", () => {
    const sim = new ArenaSimulation();
    sim.changeJob();
    expect(sim.job.id).toBe("JOB-ROGUE");
    for (const id of [
      "STAR-JIN-0001",
      "STAR-JIN-0201",
      "STAR-JIN-0202",
      ...Array.from({ length: 9 }, (_, i) => `STAR-VIPER-0${String(i + 1)}`),
    ])
      expect(sim.allocateStar(id), id).toBe(true);
    expect(sim.sheet.board?.constellations).toContain("CONST-VIPER");
    const poison = sim.db.ailments.get("AIL-POISON");
    if (poison?.kind !== "dot") throw new Error("毒が無い");
    const spawn = (id: string) => {
      const eid = sim.spawnEnemy(id);
      const e = sim.field?.enemies.find((x) => x.id === eid);
      if (e === undefined) throw new Error("敵がいない");
      return e;
    };
    // 狼（動く）に毒を10スタック。動かない苗を、狼のすぐ隣に置く
    const wolf = spawn("ENM-FOREST-WOLF");
    const sapling = spawn("ENM-ROT-SAPLING");
    sapling.combatant.position = { x: wolf.position.x + 0.5, y: wolf.position.y };
    for (let i = 0; i < 10; i++)
      wolf.combatant.ailments.apply({
        ailmentId: poison.id,
        tag: poison.tag,
        total: 30,
        duration: 30,
        maxStacks: undefined,
      });
    wolf.notice();
    let made = false;
    for (let i = 0; i < 180 && !made; i++) {
      sim.frame(STEP, input());
      made = sim.poisonPuddles.length > 0;
    }
    expect(made).toBe(true);
    // できた毒だまりの上に苗を置く（毒だまりの毒は、狼の毒の残りの20%）
    const puddle = sim.poisonPuddles[0];
    if (puddle === undefined) throw new Error("毒だまりが無い");
    sapling.combatant.position = { ...puddle.center };
    expect(puddle.total).toBeGreaterThan(0);
    expect(puddle.total).toBeLessThanOrEqual(30 * 0.2);
    for (let i = 0; i < 90; i++) sim.frame(STEP, input());
    expect(sapling.combatant.ailments.stacks("AIL-POISON")).toBeGreaterThanOrEqual(1);
  });

  it("毒蛇座が無ければ、毒だまりはできない", () => {
    const sim = new ArenaSimulation();
    const poison = sim.db.ailments.get("AIL-POISON");
    if (poison?.kind !== "dot") throw new Error("毒が無い");
    const eid = sim.spawnEnemy("ENM-FOREST-WOLF");
    const wolf = sim.field?.enemies.find((x) => x.id === eid);
    for (let i = 0; i < 10; i++)
      wolf?.combatant.ailments.apply({
        ailmentId: poison.id,
        tag: poison.tag,
        total: 30,
        duration: 30,
        maxStacks: undefined,
      });
    wolf?.notice();
    for (let i = 0; i < 120; i++) sim.frame(STEP, input());
    expect(sim.poisonPuddles).toHaveLength(0);
  });
});

describe("ArenaSimulation：職紋盤（U-15、仕様書v0.2 4.10・5.2・5.6）", () => {
  const W = "JBN-WARRIOR-";
  const R = "JBN-ROGUE-";
  const take = (sim: ArenaSimulation, ids: string[]): void => {
    for (const id of ids) expect(sim.allocateJobNode(id), id).toBe(true);
  };
  const trunk = (p: string, n = 7): string[] =>
    Array.from({ length: n }, (_, i) => `${p}T${String(i + 1)}`);

  it("ポイントはメインジョブのジョブLv−1。取得はセーブデータに残り、転職するとジョブごとに別", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    expect(sim.jobBoardPoints).toBe(sim.character.jobLevel(sim.job.id) - 1);
    take(sim, trunk(W, 2));
    expect(sim.saveData().jobs["JOB-WARRIOR"]?.board_allocation).toEqual(trunk(W, 2));
    sim.changeJob();
    expect(sim.jobBoard.spent).toBe(0);
    expect(sim.allocateJobNode(`${W}T3`)).toBe(false);
    sim.changeJob();
    expect(sim.jobBoard.nodes).toEqual(trunk(W, 2));
    const again = new ArenaSimulation(undefined, {
      db: sim.db,
      enemies: false,
      profile: sim.profile(),
    });
    expect(again.jobBoard.nodes).toEqual(trunk(W, 2));
  });

  it("不屈の闘志：闘志が30より下がらない", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    take(sim, [...trunk(W), `${W}M-UNYIELDING`]);
    expect(sim.jobGauge.value).toBe(30);
    sim.jobGauge.add(20);
    sim.jobGauge.spend("all");
    expect(sim.jobGauge.value).toBe(30);
  });

  it("鬼神化：闘志が100になると6秒間、全ての職技が激化版・攻撃速度+20%。解放技は使えない", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    take(sim, [...trunk(W), `${W}M-DEMON`]);
    const speed = sim.attackSpeed;
    const inc = (): number => sim.sheet.evaluated.view.stat("STAT-ATTACK-SPEED").increased;
    const before = inc();
    expect(sim.blockOf("SKL-WARRIOR-ROUT")).toBe("locked");
    sim.jobGauge.add(100);
    sim.frame(STEP, input());
    expect(sim.demon).toBe(true);
    expect(sim.jobGauge.value).toBe(0);
    expect(sim.jobGauge.hasStage("empowered")).toBe(true);
    // 攻撃速度の増加は、適性の補正と足し合わせる（加算）
    expect(sim.attackSpeed).toBeGreaterThan(speed);
    expect(inc() - before).toBeCloseTo(0.2);
    for (let i = 0; i < Math.ceil(6.1 / STEP); i++) sim.frame(STEP, input());
    expect(sim.demon).toBe(false);
    expect(sim.jobGauge.hasStage("empowered")).toBe(false);
    expect(sim.attackSpeed).toBeCloseTo(speed);
  });

  it("怒涛：解放技の後10秒間、職技のCDが-50%", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    take(sim, [...trunk(W), `${W}M-SURGE`]);
    sim.setFervor(100);
    expect(sim.setSlotSkill(1, "SKL-WARRIOR-ROUT")).toBe(true);
    sim.frame(STEP, input({ pressed: ["skill2"] }));
    expect(sim.lastSkill?.id).toBe("SKL-WARRIOR-ROUT");
    for (let i = 0; i < Math.ceil(3 / STEP); i++) sim.frame(STEP, input());
    const charge = sim.db.skills.get("SKL-WARRIOR-CHARGE");
    sim.frame(STEP, input({ pressed: ["skill3"] }));
    expect(sim.lastSkill?.id).toBe("SKL-WARRIOR-CHARGE");
    expect(sim.cooldowns.remaining("SKL-WARRIOR-CHARGE")).toBeCloseTo(
      (charge?.cooldown ?? 0) * 0.5,
      1,
    );
  });

  it("静かなる刃：戦闘外からの最初の一撃だけ×3", () => {
    const hitTotals = (mastery: boolean): number[] => {
      const sim = new ArenaSimulation(undefined, { enemies: false });
      sim.changeJob();
      sim.gainXp(1e7);
      if (mastery) take(sim, [...trunk(R), `${R}M-SILENT`]);
      const p = sim.motion.position;
      sim.motion.displace({ x: 19 - p.x, y: 12 - p.y });
      const out: number[] = [];
      const held = { ...input(), held: new Set<Action>(["skill1"]) };
      for (let i = 0; i < 400 && out.length < 2; i++) {
        const hits = sim.hitCount;
        sim.frame(STEP, held);
        if (sim.hitCount > hits) out.push(sim.lastHit?.hit.total ?? 0);
      }
      return out;
    };
    const plain = hitTotals(false);
    const silent = hitTotals(true);
    // 同じ乱数の列なので、1撃目だけが3倍になる
    expect((silent[0] ?? 0) / (plain[0] ?? 1)).toBeCloseTo(3);
    expect((silent[1] ?? 0) / (plain[1] ?? 1)).toBeCloseTo(1);
  });

  it("無限連撃：コンボ点の最大+3。終結技はコンボ点を使わず、CDが3秒", () => {
    const sim = new ArenaSimulation();
    sim.changeJob();
    sim.gainXp(1e7);
    take(sim, [...trunk(R), `${R}M-ENDLESS`]);
    expect(sim.jobGauge.max).toBe(8);
    sim.jobGauge.add(8);
    const id = sim.spawnEnemy("ENM-BARK-BEAR");
    const bear = sim.field?.enemies.find((e) => e.id === id);
    if (bear !== undefined)
      bear.combatant.position = { x: sim.motion.position.x + 1.3, y: sim.motion.position.y };
    const slot = sim.loadout.find((l) => l.skill === "SKL-ROGUE-PIERCE")?.action;
    if (slot === undefined) throw new Error("急所穿ちが枠に無い");
    sim.frame(STEP, input({ pressed: [slot] }));
    expect(sim.lastSkill?.id).toBe("SKL-ROGUE-PIERCE");
    expect(sim.jobGauge.value).toBe(8);
    expect(sim.cooldowns.remaining("SKL-ROGUE-PIERCE")).toBeCloseTo(3, 1);
  });

  it("影法師：正面からのヒットも背面からのヒットになる", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    sim.changeJob();
    sim.gainXp(1e7);
    take(sim, [...trunk(R), `${R}M-SHADOW`]);
    // 人形は左（プレイヤーの方）を向いている。左から叩くと正面
    const p = sim.motion.position;
    sim.motion.displace({ x: 19 - p.x, y: 12 - p.y });
    const held = { ...input(), held: new Set<Action>(["skill1"]) };
    for (let i = 0; i < 200 && sim.hitCount === 0; i++) sim.frame(STEP, held);
    expect(sim.lastHit?.backstab).toBe(true);
  });

  it("転職神殿の振り直し：金貨 20×ジョブLv で全て返す（安全地帯だけ）", () => {
    const db = new ArenaSimulation(undefined, { enemies: false }).db;
    const town = db.regions.get("REGION-TOWN");
    if (town === undefined) throw new Error("町が無い");
    const sim = new ArenaSimulation(undefined, { db, region: town });
    take(sim, trunk(W, 3));
    const cost = sim.jobBoardRespecCost;
    expect(cost).toBe(20 * sim.character.jobLevel(sim.job.id));
    expect(sim.resetJobBoard()).toBe(false); // 金貨が無い
    sim.inventory.addGold(cost + 5);
    expect(sim.resetJobBoard()).toBe(true);
    expect(sim.jobBoard.spent).toBe(0);
    expect(sim.inventory.gold).toBe(5);
  });

  it("クールダウン短縮の詞が、技のCDに効く", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    sim.inventory.addItem({
      uid: "itm_950001",
      base: "BASE-ARM-IRON-HEAD-T1",
      rarity: "magic",
      itemLevel: 40,
      affixes: [{ id: "AFX-SUF-COOLDOWN-REDUCTION", tier: 4, rolls: [6] }],
    });
    expect(sim.equipFromInventory("itm_950001")).toBe(true);
    const charge = sim.db.skills.get("SKL-WARRIOR-CHARGE");
    sim.frame(STEP, input({ pressed: ["skill3"] }));
    expect(sim.cooldowns.remaining("SKL-WARRIOR-CHARGE")).toBeCloseTo(
      (charge?.cooldown ?? 0) * 0.94,
      1,
    );
  });
});

describe("ArenaSimulation：二刀流の左右交互の攻撃（仕様書v0.2 3.2）", () => {
  const dual = (): ArenaSimulation => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    for (const [uid, base] of [
      ["itm_960001", "BASE-WPN-LONGSWORD-T1"],
      ["itm_960002", "BASE-WPN-AXE-T1"],
    ] as const)
      sim.inventory.addItem({ uid, base, rarity: "normal", itemLevel: 1, affixes: [] });
    expect(sim.equipFromInventory("itm_960001", "mainHand")).toBe(true);
    expect(sim.equipFromInventory("itm_960002", "offHand")).toBe(true);
    const p = sim.motion.position;
    sim.motion.displace({ x: 19 - p.x, y: 12 - p.y });
    return sim;
  };

  it("通常攻撃は主手・副手の順に交互に出て、それぞれの手の武器のダメージを使う", () => {
    const sim = dual();
    expect(sim.sheet.offAttacker?.weapon?.uid).toBe("itm_960002");
    const hands: boolean[] = [];
    const held = { ...input(), held: new Set<Action>(["skill1"]) };
    for (let i = 0; i < 600 && hands.length < 4; i++) {
      const hits = sim.hitCount;
      sim.frame(STEP, held);
      if (sim.hitCount > hits) hands.push(sim.lastHitOffHand);
    }
    expect(hands).toEqual([false, true, false, true]);
  });

  it("片手だけ・盾を持っているときは、いつも主手", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    expect(sim.sheet.offAttacker).toBeUndefined();
    const p = sim.motion.position;
    sim.motion.displace({ x: 19 - p.x, y: 12 - p.y });
    const held = { ...input(), held: new Set<Action>(["skill1"]) };
    for (let i = 0; i < 300 && sim.hitCount < 2; i++) sim.frame(STEP, held);
    expect(sim.lastHitOffHand).toBe(false);
  });
});
