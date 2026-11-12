import { describe, expect, it } from "vitest";
import {
  type AilmentApplication,
  Combatant,
  type CombatantInit,
  FIXED_STEP_SECONDS,
  ProjectilePool,
  type ProjectileSpawn,
  type ProjectileTarget,
  staggerProfiles,
} from "../src/index.ts";
import { fullCombatDb } from "./helpers/content.ts";

const MAX = Number.MAX_VALUE;

// ---------------------------------------------------------------------------
// 1. 投射物：相手の半径＋投射物の半径の合計の溢れ
// ---------------------------------------------------------------------------

function spawnSpec(overrides: Partial<ProjectileSpawn<string>> = {}): ProjectileSpawn<string> {
  return {
    position: { x: 0, y: 0 },
    direction: { x: 1, y: 0 },
    speed: 10,
    range: 100,
    radius: 0.1,
    pierce: 0,
    team: "player",
    payload: "bolt",
    ...overrides,
  };
}

function target(id: string, x: number, y = 0, radius = 0.5, team = "enemy"): ProjectileTarget {
  return { id, team, position: { x, y }, radius };
}

function snapshot(pool: ProjectilePool<string>) {
  return { active: pool.active, positions: pool.positions() };
}

describe("投射物：半径の合計の溢れ（P2）", () => {
  it("両方の半径が有限でも、合計が Infinity に溢れる場合は RangeError", () => {
    // 前提：それぞれは有限だが、合計は Infinity
    expect(Number.isFinite(MAX)).toBe(true);
    expect(MAX + MAX).toBe(Number.POSITIVE_INFINITY);
    const pool = new ProjectilePool<string>(1);
    pool.spawn(spawnSpec({ radius: MAX }));
    // 遠く離れた相手（修正前は、合計の半径が Infinity になり当たっていた）
    expect(() => pool.update(FIXED_STEP_SECONDS, [target("far", 1e6, 1e6, MAX)])).toThrow(
      RangeError,
    );
  });

  it("合計がちょうど Infinity に丸められる境界（MAX と MAX の半分強）でも RangeError", () => {
    const pool = new ProjectilePool<string>(1);
    pool.spawn(spawnSpec({ radius: MAX / 2 }));
    expect(() => pool.update(FIXED_STEP_SECONDS, [target("far", 1e6, 0, MAX)])).toThrow(RangeError);
  });

  it("不正な入力では、位置・射程（寿命）・使っている数・入れ物の状態が変わらない", () => {
    const pool = new ProjectilePool<string>(3);
    // 1つ目：敵の陣営が撃った半径 MAX の投射物。2つ目：プレイヤーの通常の投射物
    pool.spawn(spawnSpec({ radius: MAX, team: "enemy" }));
    pool.spawn(spawnSpec({ position: { x: 0, y: 5 }, radius: 0.1 }));
    const before = snapshot(pool);
    // 2つ目の投射物と通常の相手の組は正しいが、1つ目と大きな相手（プレイヤー側）の組が溢れる
    const targets = [target("near", 0.05, 5, 0.1), target("huge", 1e6, 1e6, MAX, "player")];
    expect(() => pool.update(1, targets)).toThrow(RangeError);
    expect(snapshot(pool)).toEqual(before);
    // 通常の相手だけなら、正しく進む（寿命も検証の前と同じだけ残っている）
    const hits = pool.update(1, [target("near", 0.05, 5, 0.1)]);
    expect(hits.map((h) => [h.projectileIndex, h.targetId])).toEqual([[1, "near"]]);
    // 1つ目は 10m 進み、射程の残りは 90m（溢れた更新で射程が減っていない）
    expect(pool.positionOf(0)).toEqual({ x: 10, y: 0 });
    expect(pool.active).toBe(1);
    pool.update(8.5, []);
    expect(pool.positionOf(0)).toEqual({ x: 95, y: 0 });
    expect(pool.active).toBe(1);
    // 残りの 5m で射程の終わりに達して消える
    pool.update(0.5, []);
    expect(pool.positionOf(0)).toBeUndefined();
    expect(pool.active).toBe(0);
    // 入れ物は再利用できる
    expect(pool.spawn(spawnSpec())).toBeGreaterThanOrEqual(0);
  });

  it("前の相手で当たりを返した後に溢れる組があっても、部分的に当てない（ヒットを1つも返さない）", () => {
    const pool = new ProjectilePool<string>(2);
    pool.spawn(spawnSpec({ radius: 0.1, pierce: 3 }));
    pool.spawn(spawnSpec({ position: { x: 0, y: 50 }, radius: MAX }));
    const targets = [target("first", 0.5, 0, 0.1), target("huge", 1e6, 1e6, MAX)];
    let hits: unknown = "not-called";
    expect(() => {
      hits = pool.update(1, targets);
    }).toThrow(RangeError);
    expect(hits).toBe("not-called");
    // どちらの投射物も、まだ "first" に当たっていない（同じ相手に1回の記録も変わっていない）
    expect(
      pool.update(1, [target("first", 0.5, 0, 0.1)]).map((h) => [h.projectileIndex, h.targetId]),
    ).toEqual([
      [0, "first"],
      [1, "first"],
    ]);
  });

  it("味方・既に当たった相手は判定しないので、合計が溢れても検証の対象外（従来どおり当たらない）", () => {
    const pool = new ProjectilePool<string>(1);
    pool.spawn(spawnSpec({ radius: MAX, pierce: 1 }));
    // 味方
    expect(pool.update(FIXED_STEP_SECONDS, [target("ally", 1, 0, MAX, "player")])).toEqual([]);
    // 既に当たった相手：最初は通常の半径で当て、次の刻みで半径を大きくしても判定しない
    const pool2 = new ProjectilePool<string>(1);
    pool2.spawn(spawnSpec({ radius: 0.1, pierce: 1 }));
    expect(pool2.update(FIXED_STEP_SECONDS, [target("a", 0.1, 0, 0.1)]).length).toBe(1);
    // 投射物の半径 0.1 と MAX の合計は有限（MAX）なので、溢れないことも確認
    expect(pool2.update(FIXED_STEP_SECONDS, [target("a", 0.1, 0, MAX)])).toEqual([]);
  });

  it("片方が非常に大きくても合計が有限なら、従来どおり判定する", () => {
    const pool = new ProjectilePool<string>(1);
    pool.spawn(spawnSpec({ radius: 1 }));
    // MAX + 1 は MAX（有限）。大きな相手の中にいるので始点で当たる
    const hits = pool.update(FIXED_STEP_SECONDS, [target("big", 1e6, 0, MAX)]);
    expect(hits.map((h) => h.targetId)).toEqual(["big"]);
    expect(hits[0]?.position).toEqual({ x: 0, y: 0 });
  });

  it("通常の半径：線分と円の交差・近い順・貫通・射程は従来どおり", () => {
    const pool = new ProjectilePool<string>(1);
    pool.spawn(spawnSpec({ radius: 0.2, speed: 600, pierce: 1, range: 100 }));
    const hits = pool.update(FIXED_STEP_SECONDS, [
      target("b", 6, 0, 0.3),
      target("a", 3, 0.4, 0.3),
      target("miss", 5, 0.6, 0.3),
    ]);
    expect(hits.map((h) => h.targetId)).toEqual(["a", "b"]);
    // b に触れた位置（6 - 0.5）で消える
    expect(hits[1]?.position.x).toBeCloseTo(5.5, 12);
    expect(pool.active).toBe(0);
  });

  it("極小の半径：半径0.001mの投射物と0.01mの相手でも、すり抜けない／わずかに外れれば当たらない", () => {
    const pool = new ProjectilePool<string>(2);
    pool.spawn(spawnSpec({ radius: 0.001, speed: 600 }));
    pool.spawn(spawnSpec({ position: { x: 0, y: 10 }, radius: 0.001, speed: 600 }));
    const hits = pool.update(FIXED_STEP_SECONDS, [
      target("hit", 5, 0.0105, 0.01),
      target("miss", 5, 10.0115, 0.01),
    ]);
    expect(hits.map((h) => h.targetId)).toEqual(["hit"]);
    expect(pool.active).toBe(1);
  });

  it("半径0どうしでも、線の上の相手に当たる", () => {
    const pool = new ProjectilePool<string>(1);
    pool.spawn(spawnSpec({ radius: 0, speed: 600, direction: { x: 1, y: 1 } }));
    const hits = pool.update(FIXED_STEP_SECONDS, [target("on", 3, 3, 0)]);
    expect(hits.map((h) => h.targetId)).toEqual(["on"]);
  });
});

// ---------------------------------------------------------------------------
// 2. Combatant：属性ごとの持続ダメージの合計の溢れ
// ---------------------------------------------------------------------------

const db = fullCombatDb();

function combatant(overrides: Partial<CombatantInit> = {}): Combatant {
  return new Combatant(db, {
    id: "dummy",
    team: "enemy",
    position: { x: 0, y: 0 },
    radius: 0.4,
    maxHp: 1000,
    maxWard: 100,
    staggerProfile: staggerProfiles(db).enemy,
    ...overrides,
  });
}

const burn = (total: number, duration = 1): AilmentApplication => ({
  ailmentId: "AIL-BURN",
  tag: "TAG-AIL-BURN",
  total,
  duration,
  maxStacks: undefined,
});
const poison = (total: number, duration = 1): AilmentApplication => ({
  ailmentId: "AIL-POISON",
  tag: "TAG-AIL-POISON",
  total,
  duration,
  maxStacks: undefined,
});
const bleed = (total: number, duration = 1): AilmentApplication => ({
  ailmentId: "AIL-BLEED",
  tag: "TAG-AIL-BLEED",
  total,
  duration,
  maxStacks: 8,
});

/** 外から見える Combatant の状態の全て。 */
function state(c: Combatant) {
  return {
    hp: c.health.hp,
    ward: c.health.ward,
    dead: c.health.dead,
    stacks: {
      burn: c.ailments.stacks("AIL-BURN"),
      poison: c.ailments.stacks("AIL-POISON"),
      bleed: c.ailments.stacks("AIL-BLEED"),
      weaken: c.ailments.stacks("AIL-WEAKEN"),
    },
    tags: c.ailments.activeTags(),
    // 属性ごとの残り（合計は溢れうるので、属性ごとに見る）。短い時間で、残りの総量・時間の両方を反映する
    dotPreview: c.ailments.previewTick(0.25),
    nextExpiry: c.ailments.nextDotExpiry(),
    stagger: {
      current: c.stagger.current,
      breaks: c.stagger.breaks,
      broken: c.stagger.broken,
    },
  };
}

/** 同じ状態の2体を作る（片方で例外を起こし、もう片方と比べる）。 */
function pair(setup: (c: Combatant) => void): [Combatant, Combatant] {
  const a = combatant();
  const b = combatant();
  setup(a);
  setup(b);
  return [a, b];
}

describe("Combatant.update：持続ダメージの合計の溢れ（P3）", () => {
  it("属性ごとには有限でも、複数の属性の合計が Infinity に溢れる場合は RangeError", () => {
    const c = combatant();
    c.ailments.apply(burn(MAX)); // 火：1秒で MAX
    c.ailments.apply(poison(MAX)); // 闇：1秒で MAX
    // 前提：属性ごとには有限
    const dot = c.ailments.previewTick(1);
    expect(dot.fire).toBe(MAX);
    expect(dot.dark).toBe(MAX);
    expect(() => c.update(1)).toThrow(RangeError);
  });

  it("不正な合計で HP・魔障が変化しない", () => {
    const c = combatant();
    c.health.takeDamage(30); // 魔障 100 → 70
    c.ailments.apply(burn(MAX));
    c.ailments.apply(poison(MAX));
    const hp = c.health.hp;
    const ward = c.health.ward;
    expect(() => c.update(1)).toThrow(RangeError);
    expect(c.health.hp).toBe(hp);
    expect(c.health.ward).toBe(ward);
    expect(c.health.dead).toBe(false);
  });

  it("例外のとき、状態異常・崩しゲージ・魔障・時間が中途半端に更新されない（同じ状態の別の個体と同じに振る舞う）", () => {
    const [a, b] = pair((c) => {
      c.health.takeDamage(50); // 魔障を減らし、被弾からの時間を0にする
      c.stagger.add(100); // 崩しゲージを溜める（最大 200 未満）
      c.ailments.apply(burn(MAX));
      c.ailments.apply(poison(MAX));
      c.ailments.apply({
        ailmentId: "AIL-WEAKEN",
        tag: "TAG-AIL-WEAKEN",
        total: 0,
        duration: 4,
        maxStacks: undefined,
      });
    });
    const before = state(a);
    expect(() => a.update(1)).toThrow(RangeError);
    expect(state(a)).toEqual(before);
    expect(state(a)).toEqual(state(b));
    // その後、同じ正しい入力を与えると、例外を経験していない個体と全く同じ結果になる
    // （状態異常の残り時間・崩しゲージの減り始め・魔障の回復の始まりが進んでいない）
    for (const dt of [0.25, 0.25, 1, 2, 2]) {
      expect(a.update(dt)).toBe(b.update(dt));
      expect(state(a)).toEqual(state(b));
    }
  });

  it("移動中の出血の2倍を含めた合計が溢れる場合も RangeError（補正は従来どおり合計に含まれる）", () => {
    const c = combatant();
    c.ailments.apply(bleed(0.3 * MAX)); // 物理：1秒で 0.3 MAX、移動中は 0.6 MAX
    c.ailments.apply(burn(0.5 * MAX)); // 火：1秒で 0.5 MAX
    c.moving = false;
    // 止まっていれば合計 0.8 MAX（有限）
    expect(Number.isFinite(c.ailments.previewTick(1).physical)).toBe(true);
    c.moving = true;
    const before = state(c);
    expect(() => c.update(1)).toThrow(RangeError);
    expect(state(c)).toEqual(before);
    // 止まると、有限の合計がそのまま HP に適用される
    c.moving = false;
    expect(c.update(1)).toBeCloseTo(0.8 * MAX, -300);
    expect(c.health.dead).toBe(true);
  });

  it("耐性が負（弱点）で属性ごとの値が増え、合計が溢れる場合も RangeError", () => {
    const c = combatant({ resist: { fire: -1 } }); // 火のダメージ2倍
    c.ailments.apply(burn(0.3 * MAX)); // 火：0.6 MAX
    c.ailments.apply(poison(0.5 * MAX)); // 闇：0.5 MAX
    const before = state(c);
    expect(() => c.update(1)).toThrow(RangeError);
    expect(state(c)).toEqual(before);
  });

  it("経過時間が不正なら、状態を変える前に RangeError（従来どおり）", () => {
    for (const dt of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const c = combatant();
      c.ailments.apply(burn(100, 4));
      const before = state(c);
      expect(() => c.update(dt)).toThrow(RangeError);
      expect(state(c)).toEqual(before);
    }
  });

  it("previewTick は状態を変えず、tick と同じ結果を返す", () => {
    const c = combatant();
    c.ailments.apply(burn(100, 4));
    c.ailments.apply(bleed(50, 5));
    const before = state(c);
    const target = { moving: true, resist: { fire: 0.2 } };
    const preview = c.ailments.previewTick(0.5, target);
    expect(state(c)).toEqual(before);
    expect(c.ailments.tick(0.5, target)).toEqual(preview);
  });
});

describe("Combatant.update：通常の持続ダメージは従来どおり", () => {
  it("燃焼（総量100・4秒）を1秒で25受け、魔障が先に吸収する", () => {
    const c = combatant();
    c.ailments.apply(burn(100, 4));
    expect(c.update(1)).toBeCloseTo(25, 10);
    expect(c.health.ward).toBeCloseTo(75, 10);
    expect(c.health.hp).toBe(1000);
  });

  it("複数の属性の合計を受ける（燃焼＋毒）", () => {
    const c = combatant({ maxWard: 0 });
    c.ailments.apply(burn(100, 4)); // 25/秒
    c.ailments.apply(poison(30, 3)); // 10/秒
    expect(c.update(1)).toBeCloseTo(35, 10);
    expect(c.health.hp).toBeCloseTo(965, 10);
  });

  it("耐性をかける・移動中の出血は2倍", () => {
    const c = combatant({ maxWard: 0, resist: { physical: 0.5 } });
    c.ailments.apply(bleed(50, 5)); // 10/秒、耐性で 5/秒
    expect(c.update(1)).toBeCloseTo(5, 10);
    c.moving = true;
    expect(c.update(1)).toBeCloseTo(10, 10);
    expect(c.health.hp).toBeCloseTo(985, 10);
  });

  it("持続ダメージがなければ0を返し、HPは変わらない。切れたら取り除く", () => {
    const c = combatant({ maxWard: 0 });
    expect(c.update(1)).toBe(0);
    expect(c.health.hp).toBe(1000);
    c.ailments.apply(burn(100, 1));
    expect(c.update(2)).toBeCloseTo(100, 10);
    expect(c.ailments.stacks("AIL-BURN")).toBe(0);
    expect(c.update(1)).toBe(0);
  });
});
