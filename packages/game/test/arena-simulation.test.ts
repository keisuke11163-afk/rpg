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
    expect(sim.attacker.weapon).toBeUndefined();
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
