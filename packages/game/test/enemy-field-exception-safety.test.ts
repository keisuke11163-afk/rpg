import { type Mock, afterEach, describe, expect, it, vi } from "vitest";
import {
  Combatant,
  type ContentDb,
  type Enemy,
  EnemyAttackers,
  FIXED_STEP_SECONDS,
  Rng,
  staggerProfiles,
} from "@stella/core";
import { loadGameContent } from "@stella/content";
import { EnemyField, type FieldHooks } from "../src/world/EnemyField.ts";

/**
 * EnemyField.update の例外安全（PR #12 の再レビュー指摘 P2）。
 * - 累積する値（倒れてからの時間・雲の残り時間・雲の次に状態異常を付けるまでの時間・
 *   もう一度出すまでの時間）が有限でなくなる入力は、状態を変える前に RangeError
 * - 後ろの敵の更新が失敗しても、前の敵・投射物・雲・もう一度出すまでの時間・倒した数・乱数・
 *   プレイヤーは何も変わらない
 * - 例外の後も、例外を経験していない場と全く同じに振る舞う
 */

const MAX = Number.MAX_VALUE;
const dt = FIXED_STEP_SECONDS;
const db: ContentDb = loadGameContent();
const BOUNDS = { minX: 0.5, minY: 0.5, maxX: 79.5, maxY: 39.5 };
const PLAYER_AT = { x: 30, y: 20 };

interface World {
  readonly field: EnemyField;
  readonly rng: Rng;
  readonly player: Combatant;
  readonly hooks: {
    readonly onPlayerHit: Mock<FieldHooks["onPlayerHit"]>;
    readonly onAvoided: Mock<FieldHooks["onAvoided"]>;
    readonly onEnemyKilled: Mock<FieldHooks["onEnemyKilled"]>;
  };
}

function newWorld(): World {
  const rng = Rng.fromSeed(11);
  const field = new EnemyField(db, rng, BOUNDS);
  // 倒れて戦いが止まらないよう、HPを多くする
  const player = new Combatant(db, {
    id: "player",
    team: "player",
    position: { ...PLAYER_AT },
    radius: 0.35,
    maxHp: 1e6,
    staggerProfile: staggerProfiles(db).player,
  });
  return {
    field,
    rng,
    player,
    hooks: {
      onPlayerHit: vi.fn<FieldHooks["onPlayerHit"]>(),
      onAvoided: vi.fn<FieldHooks["onAvoided"]>(),
      onEnemyKilled: vi.fn<FieldHooks["onEnemyKilled"]>(),
    },
  };
}

function step(w: World, seconds = dt): void {
  w.field.update(seconds, w.player, false, 0, w.hooks);
}

function kill(e: Enemy): void {
  e.combatant.health.takeDamage(e.combatant.health.maxHp * 10);
}

/**
 * 戦いの途中の場：プレイヤーの近くに、投射物を撃つ蜥蜴・雲を出す苗・森狼・牙猪を出し、
 * 投射物と雲が場にある状態まで進める。試験用の群れ「牙猪」を倒して、もう一度出すまでの時間を進め、
 * 最後に棘鼠を1体倒して1刻み進める（倒れてから消えるまでの途中の敵がいる）。
 */
function midFight(): World {
  const w = newWorld();
  const { field } = w;
  field.spawn("ENM-SPINE-LIZARD", "normal", 3, { x: 35, y: 20 }, "test-lizard");
  field.spawn("ENM-ROT-SAPLING", "normal", 3, { x: 32, y: 22 }, "test-sapling");
  field.spawn("ENM-FOREST-WOLF", "normal", 2, { x: 31.5, y: 19 }, "test-wolf");
  field.spawn("ENM-TUSK-BOAR", "normal", 4, { x: 27, y: 20 }, "test-boar");
  const boar = field.entries.find((v) => v.group === "boar");
  if (boar === undefined) throw new Error("牙猪の群れがない");
  kill(boar.enemy);
  for (let i = 0; i < 1200; i++) {
    step(w);
    if (i > 60 && field.projectiles.active > 0 && field.clouds.length > 0) break;
  }
  const rat = field.entries.find((v) => v.group === "rats");
  if (rat === undefined) throw new Error("棘鼠の群れがない");
  kill(rat.enemy);
  step(w);
  return w;
}

/** 外から読める敵の状態の全て。 */
function enemyState(e: Enemy) {
  const c = e.combatant;
  const health = c.health.planUpdate(0);
  const stagger = c.stagger.planUpdate(0);
  return {
    id: e.id,
    state: e.state,
    timeInState: e.timeInState,
    attack: e.currentAttack?.id,
    targetPoint: e.targetPoint,
    position: e.position,
    facing: e.facing,
    moving: c.moving,
    dotTaken: e.dotTaken,
    cooldowns: Object.fromEntries(e.def.attacks.map((a) => [a.id, e.cooldowns.remaining(a.id)])),
    health: { hp: health.hp, ward: health.ward, sinceHit: health.sinceHit, dead: c.health.dead },
    stagger: { value: stagger.value, brokenFor: stagger.brokenFor, sinceLast: stagger.sinceLast },
    ailments: c.ailments.activeTags(),
  };
}

/** 場の状態（敵・投射物・雲・もう一度出すまでの時間・倒した数）。 */
function fieldState(f: EnemyField) {
  return {
    entries: f.entries.map((v) => ({
      group: v.group,
      deadFor: v.deadFor,
      hitGroups: [...v.hitGroups],
      enemy: enemyState(v.enemy),
    })),
    projectiles: f.projectiles.positions(),
    projectileCount: f.projectiles.active,
    clouds: f.clouds.map((c) => ({ ...c, application: { ...c.application } })),
    respawn: [...f.respawnTimers()],
    kills: f.kills,
  };
}

/** 場・乱数・プレイヤー・hooks の呼び出しの全て。 */
function snapshot(w: World) {
  const p = w.player;
  return {
    field: fieldState(w.field),
    rng: w.rng.getState(),
    player: {
      position: p.position,
      hp: p.health.hp,
      sinceHit: p.health.planUpdate(0).sinceHit,
      stagger: p.stagger.planUpdate(0).value,
      ailments: p.ailments.activeTags(),
      dots: p.ailments.planTick(0).updates.map(({ inst }) => ({
        id: inst.def.id,
        remaining: inst.remaining,
        remainingTime: inst.remainingTime,
      })),
    },
    hits: w.hooks.onPlayerHit.mock.calls.length,
    avoided: w.hooks.onAvoided.mock.calls.length,
    killed: w.hooks.onEnemyKilled.mock.calls.map(([e]) => e.id),
  };
}

/** 例外の後も、例外を経験していない場と全く同じに振る舞うこと。 */
function expectSameFuture(a: World, b: World, steps = 600): void {
  for (let i = 0; i < steps; i++) {
    step(a);
    step(b);
    expect(snapshot(a)).toEqual(snapshot(b));
  }
  // 比べた間に、攻撃・投射物・雲・倒れた敵の消去・もう一度出すことが起きていること
  expect(a.hooks.onPlayerHit).toHaveBeenCalled();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("前提：準備した戦いの途中の場", () => {
  it("投射物・雲・倒れてから消えるまでの途中の敵・もう一度出すまでの時間・予兆などの途中の敵がある", () => {
    const w = midFight();
    const f = w.field;
    expect(f.projectiles.active).toBeGreaterThan(0);
    expect(f.clouds.length).toBeGreaterThan(0);
    expect(f.entries.some((v) => v.enemy.state === "dead" && v.deadFor > 0)).toBe(true);
    expect(f.respawnTimers().get("boar")).toBeGreaterThan(0);
    expect(f.entries.some((v) => v.enemy.state !== "idle" && v.enemy.state !== "dead")).toBe(true);
    // 後ろの敵ほど、先に更新される敵が多い
    expect(f.entries.length).toBeGreaterThan(10);
    // 同じ準備は同じ状態になる（比べる相手として使える）
    expect(snapshot(w)).toEqual(snapshot(midFight()));
  });
});

describe("EnemyField.update：後ろの敵の更新が失敗しても、場は何も変わらない", () => {
  it("最後の敵の戦う者の更新が失敗したら、前の敵・投射物・雲・時間・乱数・プレイヤーは変わらない", () => {
    const a = midFight();
    const b = midFight();
    const before = snapshot(a);
    const last = a.field.entries.at(-1)?.enemy;
    if (last === undefined) throw new Error("敵がいない");
    const spy = vi.spyOn(last.combatant, "planUpdate").mockImplementationOnce(() => {
      throw new RangeError("試験用の失敗");
    });
    expect(() => {
      step(a);
    }).toThrow("試験用の失敗");
    expect(spy).toHaveBeenCalledOnce();
    // 修正前は、前の敵が1刻み進み、投射物・雲・時間も進まないまま前の敵だけ変わっていた
    expect(snapshot(a)).toEqual(before);
    expect(snapshot(a)).toEqual(snapshot(b));
    expectSameFuture(a, b);
  });

  it("後ろの敵が、その時間で動くと位置が溢れる場合（前の敵だけなら有効な時間）", () => {
    const build = () => {
      const w = midFight();
      // 最後に出した敵だけが、極端に遠くにいる
      w.field.spawn("ENM-FOREST-WOLF", "normal", 2, { x: MAX, y: 20 }, "test-far");
      return w;
    };
    const a = build();
    const b = build();
    const big = 1e292;
    // 前の敵は、この時間の計画を作れる（修正前は、前の敵だけが進んでいた）
    for (const v of a.field.entries.slice(0, -1))
      expect(() => v.enemy.planUpdate(big)).not.toThrow();
    const before = snapshot(a);
    expect(() => {
      step(a, big);
    }).toThrow(/位置が有限の数でなくなる/);
    expect(snapshot(a)).toEqual(before);
    expectSameFuture(a, b);
  });
});

describe("EnemyField.update：累積する値の溢れ", () => {
  it("倒れてからの時間が溢れる場合は RangeError で、何も変わらない", () => {
    const build = () => {
      const w = midFight();
      const dead = w.field.entries.find((v) => v.enemy.state === "dead");
      if (dead === undefined) throw new Error("倒れた敵がいない");
      dead.deadFor = MAX;
      return w;
    };
    const a = build();
    const b = build();
    // dt 自体は有限で、他の値（敵の位置・状態の経過時間・雲）では溢れない
    const big = 1e292;
    expect(MAX + big).toBe(Infinity);
    const before = snapshot(a);
    expect(() => {
      step(a, big);
    }).toThrow(/倒れてからの時間/);
    expect(snapshot(a)).toEqual(before);
    expectSameFuture(a, b);
  });

  it.each([
    ["残り時間", "remaining", /雲の残り時間/],
    ["次に状態異常を付けるまでの時間", "untilNext", /雲の次に状態異常を付けるまでの時間/],
  ] as const)("雲の%sが溢れる場合は RangeError で、何も変わらない", (_, key, message) => {
    const build = () => {
      const w = midFight();
      const cloud = w.field.clouds[0];
      if (cloud === undefined) throw new Error("雲がない");
      cloud[key] = -MAX;
      return w;
    };
    const a = build();
    const b = build();
    const before = snapshot(a);
    expect(() => {
      step(a, 1e292);
    }).toThrow(message);
    expect(snapshot(a)).toEqual(before);
    // 溢れない時間なら、従来どおり進む（-MAX の値は、次の刻みで雲を消す）
    expectSameFuture(a, b);
  });

  it("もう一度出すまでの時間が溢れる場合は RangeError で、何も変わらない", () => {
    // 正しい刻みでは8秒で出るので溢れない。内部の値を直接書き換えて検証を確かめる
    const build = () => {
      const w = midFight();
      (w.field as unknown as { respawn: Map<string, number> }).respawn.set("boar", MAX);
      return w;
    };
    const a = build();
    const b = build();
    const before = snapshot(a);
    expect(() => {
      step(a, 1e292);
    }).toThrow(/群れ boar をもう一度出すまでの時間/);
    expect(snapshot(a)).toEqual(before);
    expectSameFuture(a, b);
  });
});

describe("EnemyField.update：プレイヤーへの影響は場を全て反映した後", () => {
  it("hooks が例外を出しても、場はその刻みを全て終えている（前の敵だけ進んだ状態にならない）", () => {
    const a = midFight();
    const b = midFight();
    a.hooks.onPlayerHit.mockImplementation(() => {
      throw new Error("試験用の hooks の失敗");
    });
    let thrown = false;
    for (let i = 0; i < 1200 && !thrown; i++) {
      try {
        step(a);
      } catch (e) {
        expect(e).toEqual(new Error("試験用の hooks の失敗"));
        thrown = true;
      }
      step(b);
      // 場（乱数・プレイヤーを除く）は、hooks が失敗しない場と同じ
      expect(fieldState(a.field)).toEqual(fieldState(b.field));
    }
    expect(thrown).toBe(true);
  });
});

describe("EnemyField.update：正しい経過時間では従来どおり", () => {
  it("倒れてからの時間・雲の時間・もう一度出すまでの時間が dt だけ進む", () => {
    const w = midFight();
    const dead = w.field.entries.find((v) => v.enemy.state === "dead");
    const cloud = w.field.clouds[0];
    if (dead === undefined || cloud === undefined) throw new Error("準備の失敗");
    const deadFor = dead.deadFor;
    const remaining = cloud.remaining;
    const untilNext = cloud.untilNext;
    const respawn = w.field.respawnTimers().get("boar") ?? 0;
    step(w);
    expect(dead.deadFor).toBeCloseTo(deadFor + dt, 12);
    expect(cloud.remaining).toBeCloseTo(remaining - dt, 12);
    const expectedUntil = untilNext - dt <= 1e-9 ? untilNext - dt + cloud.interval : untilNext - dt;
    expect(cloud.untilNext).toBeCloseTo(expectedUntil, 12);
    expect(w.field.respawnTimers().get("boar")).toBeCloseTo(respawn + dt, 12);
  });

  it("倒れた敵は消えて倒した数に数え、群れは8秒後にもう一度出る", () => {
    const w = midFight();
    const kills = w.field.kills;
    for (let i = 0; i < 60; i++) step(w);
    expect(w.field.entries.some((v) => v.group === "rats" && v.enemy.state === "dead")).toBe(false);
    expect(w.field.kills).toBeGreaterThan(kills);
    for (let i = 0; i < 8 * 60 && w.field.respawnTimers().has("boar"); i++) step(w);
    expect(w.field.entries.some((v) => v.group === "boar")).toBe(true);
  });

  it("敵の攻撃・投射物・雲がプレイヤーに当たり、回避の無敵時間では避けたと知らせる", () => {
    const w = midFight();
    for (let i = 0; i < 600; i++) step(w);
    expect(w.hooks.onPlayerHit).toHaveBeenCalled();
    expect(w.player.health.hp).toBeLessThan(w.player.health.maxHp);
    const v = midFight();
    for (let i = 0; i < 600; i++) v.field.update(dt, v.player, true, 0, v.hooks);
    expect(v.hooks.onAvoided).toHaveBeenCalled();
  });

  it("dt = 0 は、倒れてからの時間・雲の時間・もう一度出すまでの時間を進めない", () => {
    const w = midFight();
    const before = fieldState(w.field);
    step(w, 0);
    const after = fieldState(w.field);
    expect(after.entries.map((e) => e.deadFor)).toEqual(before.entries.map((e) => e.deadFor));
    expect(after.respawn).toEqual(before.respawn);
    expect(after.clouds.map((c) => c.remaining)).toEqual(before.clouds.map((c) => c.remaining));
  });
});

describe("EnemyField.update：倒した敵の経験値（hooks.onEnemyKilled。U-10）", () => {
  it("倒した敵1体につき1回だけ、倒れてから消えるまでの間も繰り返さずに呼ぶ", () => {
    const w = newWorld();
    const target = w.field.spawn("ENM-THORN-RAT", "normal", 1, { x: 60, y: 5 }, "test-xp");
    step(w);
    expect(w.hooks.onEnemyKilled).not.toHaveBeenCalled();
    kill(target);
    // 倒れた状態になる刻みで1回
    step(w);
    expect(w.hooks.onEnemyKilled.mock.calls.filter(([e]) => e === target)).toHaveLength(1);
    expect(target.state).toBe("dead");
    // 倒れてから消えるまで（0.6秒）と、消えた後も、もう呼ばない
    for (let i = 0; i < 120; i++) step(w);
    expect(w.field.entries.some((v) => v.enemy === target)).toBe(false);
    expect(w.hooks.onEnemyKilled.mock.calls.filter(([e]) => e === target)).toHaveLength(1);
  });

  it("同じ刻みに複数の敵が倒れたら、それぞれ1回ずつ、敵の順に呼ぶ", () => {
    const w = newWorld();
    const a = w.field.spawn("ENM-THORN-RAT", "normal", 1, { x: 60, y: 5 }, "test-xp");
    const b = w.field.spawn("ENM-THORN-RAT", "normal", 1, { x: 62, y: 5 }, "test-xp", 1);
    kill(b);
    kill(a);
    step(w);
    expect(w.hooks.onEnemyKilled.mock.calls.map(([e]) => e)).toEqual([a, b]);
  });

  it("持続ダメージで倒れた（この刻みの計画の HP が0以下になった）敵も、1回だけ呼ぶ", () => {
    const w = newWorld();
    const target = w.field.spawn("ENM-THORN-RAT", "normal", 1, { x: 60, y: 5 }, "test-xp");
    // 最大HPを超える毒を付ける（倒れるのは、この刻みの持続ダメージによる）
    target.combatant.ailments.apply({
      ailmentId: "AIL-POISON",
      tag: "TAG-AIL-POISON",
      total: target.combatant.health.maxHp * 1e3,
      duration: 5,
      maxStacks: undefined,
    });
    expect(target.combatant.health.dead).toBe(false);
    step(w);
    expect(target.state).toBe("dead");
    expect(w.hooks.onEnemyKilled.mock.calls.filter(([e]) => e === target)).toHaveLength(1);
    for (let i = 0; i < 120; i++) step(w);
    expect(target.state).toBe("dead");
    expect(w.hooks.onEnemyKilled.mock.calls.filter(([e]) => e === target)).toHaveLength(1);
  });

  it("後ろの敵の更新が失敗したら、前で倒れた敵の経験値も入らない（次に成功した刻みで1回入る）", () => {
    const a = midFight();
    const b = midFight();
    const victim = (w: World) => {
      const v = w.field.entries.find((x) => x.group === "wolves" && x.enemy.state !== "dead");
      if (v === undefined) throw new Error("生きている森狼がいない");
      return v.enemy;
    };
    const va = victim(a);
    const vb = victim(b);
    // 倒される敵は、失敗する敵より前にいる
    expect(a.field.entries.findIndex((x) => x.enemy === va)).toBeLessThan(
      a.field.entries.length - 1,
    );
    kill(va);
    kill(vb);
    const killedBefore = a.hooks.onEnemyKilled.mock.calls.length;
    const before = snapshot(a);
    const last = a.field.entries.at(-1)?.enemy;
    if (last === undefined) throw new Error("敵がいない");
    vi.spyOn(last.combatant, "planUpdate").mockImplementationOnce(() => {
      throw new RangeError("試験用の失敗");
    });
    expect(() => {
      step(a);
    }).toThrow("試験用の失敗");
    expect(a.hooks.onEnemyKilled).toHaveBeenCalledTimes(killedBefore);
    expect(va.state).not.toBe("dead");
    expect(snapshot(a)).toEqual(before);
    // 次の刻み（成功）で1回だけ入り、その後は失敗しなかった場と同じ
    step(a);
    step(b);
    expect(a.hooks.onEnemyKilled.mock.calls.filter(([e]) => e === va)).toHaveLength(1);
    expect(snapshot(a)).toEqual(snapshot(b));
    expectSameFuture(a, b, 120);
  });

  it("経験値の hooks が例外を出しても、場はその刻みを全て終えている", () => {
    const a = midFight();
    const b = midFight();
    a.hooks.onEnemyKilled.mockImplementation(() => {
      throw new Error("試験用の経験値の失敗");
    });
    for (const w of [a, b]) {
      const v = w.field.entries.find((x) => x.group === "wolves" && x.enemy.state !== "dead");
      if (v === undefined) throw new Error("生きている森狼がいない");
      kill(v.enemy);
    }
    expect(() => {
      step(a);
    }).toThrow("試験用の経験値の失敗");
    step(b);
    expect(fieldState(a.field)).toEqual(fieldState(b.field));
  });
});

describe("EnemyField：敵の攻撃の命中の評価（statusViews）を溜め続けない（PR #13 のレビュー指摘3）", () => {
  it("一定時間の効果がかかった敵が倒れる・消えると、その敵の分を消す", () => {
    const w = midFight();
    const near = w.field.entries
      .map((v) => v.enemy)
      .filter((e) => e.state !== "dead" && e.packId.startsWith("test-"));
    for (const e of near) e.combatant.statuses.add("EFF-ROGUE-SMOKE", 1000, "SKL-ROGUE-SMOKE");
    // 効果のかかった敵の攻撃が当たり、評価が作られるまで進める
    for (let i = 0; i < 1200 && w.field.cachedStatusViews().length === 0; i++) step(w);
    const cached = w.field.cachedStatusViews();
    expect(cached.length).toBeGreaterThan(0);
    // 倒れた刻みで、その敵の分は消える
    const ids = new Set(cached);
    for (const e of near) if (ids.has(e.id)) kill(e);
    step(w);
    expect(w.field.cachedStatusViews().filter((id) => ids.has(id))).toEqual([]);
    // 消えた後も、倒れた敵の投射物が当たっても、残らない
    for (let i = 0; i < 300; i++) {
      step(w);
      expect(w.field.cachedStatusViews().filter((id) => ids.has(id))).toEqual([]);
    }
  });

  it("長く戦っても、評価は場に出ている生きた敵の分を超えない", () => {
    const w = midFight();
    for (let i = 0; i < 3000; i++) {
      for (const v of w.field.entries)
        if (v.enemy.state !== "dead" && !v.enemy.combatant.statuses.has("EFF-ROGUE-SMOKE"))
          v.enemy.combatant.statuses.add("EFF-ROGUE-SMOKE", 1, "SKL-ROGUE-SMOKE");
      // 時々、場の敵を倒して入れ替える
      if (i % 200 === 199) for (const v of w.field.entries) kill(v.enemy);
      step(w);
      const alive = new Set(
        w.field.entries.filter((v) => v.enemy.state !== "dead").map((v) => v.enemy.id),
      );
      for (const id of w.field.cachedStatusViews()) expect(alive.has(id)).toBe(true);
    }
    expect(w.field.kills).toBeGreaterThan(20);
  });
});

describe("U-10 の追加（煙玉の命中低下・衰弱）が、場の3段階の更新で働く", () => {
  const accuracyOf = (attackers: EnemyAttackers, e: Enemy) => {
    const attack = e.def.attacks[0];
    if (attack === undefined) throw new Error("攻撃がない");
    const a = attackers.attacker(e, attack);
    return { accuracy: a.view.stat("STAT-ACCURACY").value, damage: a.weapon?.base };
  };

  it("煙玉：命中-30%。効果が切れる（Enemy.commitUpdate で時間が進む）と元に戻り、評価も消える", () => {
    const w = newWorld();
    const e = w.field.spawn("ENM-THORN-RAT", "normal", 3, { x: 60, y: 5 }, "test-smoke");
    const attackers = new EnemyAttackers(db);
    const base = accuracyOf(attackers, e).accuracy;
    e.combatant.statuses.add("EFF-ROGUE-SMOKE", 0.5, "SKL-ROGUE-SMOKE");
    expect(accuracyOf(attackers, e).accuracy).toBeCloseTo(base * 0.7, 9);
    expect(attackers.cachedStatusViews()).toEqual([e.id]);
    for (let i = 0; i < 40; i++) step(w);
    expect(e.combatant.statuses.has("EFF-ROGUE-SMOKE")).toBe(false);
    expect(accuracyOf(attackers, e).accuracy).toBe(base);
    expect(attackers.cachedStatusViews()).toEqual([]);
  });

  it("衰弱：敵の与えるダメージ×0.85。持続が切れる（場の更新で時間が進む）と元に戻る", () => {
    const w = newWorld();
    const e = w.field.spawn("ENM-THORN-RAT", "normal", 3, { x: 60, y: 5 }, "test-weaken");
    const attackers = new EnemyAttackers(db);
    const base = accuracyOf(attackers, e).damage?.physical?.min ?? NaN;
    e.combatant.ailments.apply({
      ailmentId: "AIL-WEAKEN",
      tag: "TAG-AIL-WEAKEN",
      total: 0,
      duration: 0.5,
      maxStacks: undefined,
    });
    expect(accuracyOf(attackers, e).damage?.physical?.min).toBeCloseTo(base * 0.85, 9);
    for (let i = 0; i < 40; i++) step(w);
    expect(accuracyOf(attackers, e).damage?.physical?.min).toBe(base);
  });
});
