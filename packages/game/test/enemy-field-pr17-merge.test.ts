import { type Mock, afterEach, describe, expect, it, vi } from "vitest";
import {
  Combatant,
  type ContentDb,
  type Enemy,
  type EnemyDef,
  FIXED_STEP_SECONDS,
  Rng,
  type Vec2,
  staggerProfiles,
} from "@stella/core";
import { loadGameContent } from "@stella/content";
import { EnemyField, type FieldHooks, type SpawnGroup } from "../src/world/EnemyField.ts";

/**
 * develop（bccfd63 の3段階の EnemyField.update）の取り込みで組み直した、PR #17 の追加の確認（2026-11-13）。
 * - 無敵（プレイヤーの回避）の間のヒットは何も与えない
 * - 後ろの敵の更新が失敗したら、前の敵の仲間を呼ぶ・ボスの段階の切り替えも含めて、場もプレイヤーも何も変わらない
 * - 呼ぶ敵がデータに無ければ、段階1で RangeError（反映の途中で失敗しない）
 * - 段階の切り替えのダメージを受けない間の持続ダメージは、その刻みの後の無敵で決まる（#17 と同じ順）
 */

const db = loadGameContent();
const STEP = FIXED_STEP_SECONDS;
const BOUNDS = { minX: 0, minY: 0, maxX: 60, maxY: 40 };

interface World {
  readonly field: EnemyField;
  readonly rng: Rng;
  readonly player: Combatant;
  readonly hooks: {
    readonly onPlayerHit: Mock<FieldHooks["onPlayerHit"]>;
    readonly onAvoided: Mock<FieldHooks["onAvoided"]>;
    readonly onEnemyKilled: Mock<FieldHooks["onEnemyKilled"]>;
    readonly onBossEvent: Mock<NonNullable<FieldHooks["onBossEvent"]>>;
  };
}

function world(groups: SpawnGroup[], at: Vec2, seed: string, content: ContentDb = db): World {
  const rng = Rng.fromSeed(seed);
  return {
    field: new EnemyField(content, rng, BOUNDS, groups, false),
    rng,
    player: new Combatant(content, {
      id: "player",
      team: "player",
      position: at,
      radius: 0.35,
      maxHp: 1e9,
      staggerProfile: staggerProfiles(content).player,
    }),
    hooks: {
      onPlayerHit: vi.fn<FieldHooks["onPlayerHit"]>(),
      onAvoided: vi.fn<FieldHooks["onAvoided"]>(),
      onEnemyKilled: vi.fn<FieldHooks["onEnemyKilled"]>(),
      onBossEvent: vi.fn<NonNullable<FieldHooks["onBossEvent"]>>(),
    },
  };
}

function step(w: World, invulnerable = false): void {
  w.field.update(STEP, w.player, invulnerable, 0, w.hooks);
}

function enemyState(e: Enemy) {
  const h = e.combatant.health.planUpdate(0);
  return {
    id: e.id,
    state: e.state,
    time: e.timeInState,
    attack: e.currentAttack?.id,
    position: e.position,
    facing: e.facing,
    haste: e.haste,
    phase: e.phase,
    shielded: e.shielded,
    hp: h.hp,
    ward: h.ward,
    stagger: e.combatant.stagger.current,
    ailments: e.combatant.ailments.activeTags(),
  };
}

function snapshot(w: World) {
  const p = w.player;
  return {
    enemies: w.field.entries.map((v) => ({ deadFor: v.deadFor, e: enemyState(v.enemy) })),
    projectiles: w.field.projectiles.positions(),
    clouds: w.field.clouds.map((c) => ({ ...c, application: { ...c.application } })),
    rng: w.rng.getState(),
    player: {
      hp: p.health.hp,
      stagger: p.stagger.current,
      ailments: p.ailments.activeTags(),
    },
    hits: w.hooks.onPlayerHit.mock.calls.length,
    avoided: w.hooks.onAvoided.mock.calls.length,
    boss: w.hooks.onBossEvent.mock.calls.map(([e, type, phase]) => [e.id, type, phase]),
  };
}

/** 最後に出した敵（遠くで待機している森狼）の更新を、次の1回だけ失敗させる。 */
function failLast(w: World): void {
  const last = w.field.entries.at(-1)?.enemy;
  if (last === undefined) throw new Error("敵がいない");
  vi.spyOn(last.combatant, "planUpdate").mockImplementationOnce(() => {
    throw new RangeError("試験用の失敗");
  });
}

const LAST: SpawnGroup = {
  id: "last",
  enemy: "ENM-FOREST-WOLF",
  level: 2,
  count: 1,
  at: { x: 55, y: 35 },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("無敵（回避）の間のヒット", () => {
  it("段階1で決めた無敵：攻撃はプレイヤーにダメージ・状態異常・崩しを何も与えず、避けたと知らせる", () => {
    const w = world(
      [{ id: "wolves", enemy: "ENM-FOREST-WOLF", level: 5, count: 3, at: { x: 21.5, y: 20 } }],
      { x: 20, y: 20 },
      "dodge",
    );
    for (let i = 0; i < 600; i++) step(w, true);
    expect(w.hooks.onAvoided).toHaveBeenCalled();
    expect(w.hooks.onPlayerHit).not.toHaveBeenCalled();
    expect(w.player.health.hp).toBe(w.player.health.maxHp);
    expect(w.player.stagger.current).toBe(0);
    expect(w.player.ailments.activeTags()).toEqual([]);
    // 同じ場で無敵でなければ当たる（前提の確認）
    const v = world(
      [{ id: "wolves", enemy: "ENM-FOREST-WOLF", level: 5, count: 3, at: { x: 21.5, y: 20 } }],
      { x: 20, y: 20 },
      "dodge",
    );
    for (let i = 0; i < 600; i++) step(v);
    expect(v.hooks.onPlayerHit).toHaveBeenCalled();
  });
});

describe("後ろの敵の更新が失敗したら、仲間を呼ぶ・段階の切り替えも含めて何も変わらない", () => {
  const leader = (): World =>
    world(
      [{ id: "boss", enemy: "ENM-PACK-LEADER", level: 11, count: 1, at: { x: 20, y: 20 } }, LAST],
      { x: 28, y: 20 },
      "leader",
    );

  it("仲間を呼ぶ刻みで後ろの敵が失敗しても、仲間は増えず攻撃速度も上がらない。次の刻みで従来どおり呼ぶ", () => {
    // 呼ぶ刻みを、同じ場で探す
    const probe = leader();
    let n = 0;
    while (probe.field.entries.length === 2 && n < 900) {
      step(probe);
      n += 1;
    }
    expect(probe.field.entries.length).toBe(4);
    const a = leader();
    const b = leader();
    for (let i = 0; i < n - 1; i++) {
      step(a);
      step(b);
    }
    const before = snapshot(a);
    failLast(a);
    expect(() => {
      step(a);
    }).toThrow("試験用の失敗");
    expect(snapshot(a)).toEqual(before);
    expect(a.field.entries).toHaveLength(2);
    // 失敗の後も、失敗していない場と同じに進む（呼んだ仲間もその刻みに1回動く）
    for (let i = 0; i < 120; i++) {
      step(a);
      step(b);
      expect(snapshot(a)).toEqual(snapshot(b));
    }
    expect(a.field.entries).toHaveLength(4);
    expect(a.field.entries.filter((v) => v.enemy.haste > 0)).toHaveLength(2);
  });

  it("ボスの段階の境目の刻みで後ろの敵が失敗しても、段階は変わらず知らせも出ない", () => {
    const build = (): World => {
      const w = world(
        [{ id: "boss", enemy: "ENM-MOTHER-TREE", level: 14, count: 1, at: { x: 16, y: 14 } }, LAST],
        { x: 30, y: 26 },
        "phase",
      );
      const boss = w.field.entries[0]?.enemy;
      boss?.combatant.health.takeDamage(boss.combatant.health.maxHp * 2);
      return w;
    };
    const a = build();
    const b = build();
    const before = snapshot(a);
    failLast(a);
    expect(() => {
      step(a);
    }).toThrow("試験用の失敗");
    expect(snapshot(a)).toEqual(before);
    expect(a.hooks.onBossEvent).not.toHaveBeenCalled();
    step(a);
    step(b);
    expect(snapshot(a)).toEqual(snapshot(b));
    expect(a.hooks.onBossEvent.mock.calls.map(([, type, phase]) => [type, phase])).toEqual([
      ["phase", 2],
    ]);
  });
});

describe("呼ぶ敵の検証は段階1", () => {
  it("呼ぶ敵がデータに無ければ、最初の刻みで RangeError（前の敵も動かない）", () => {
    const def = db.enemies.get("ENM-PACK-LEADER");
    if (def === undefined) throw new Error("群れ長が無い");
    const bad: EnemyDef = {
      ...def,
      attacks: def.attacks.map((a) =>
        a.delivery.type === "summon" ? { ...a, delivery: { ...a.delivery, enemy: "ENM-NOPE" } } : a,
      ),
    };
    const enemies = new Map(db.enemies);
    enemies.set(def.id, bad);
    const content: ContentDb = { ...db, enemies };
    const w = world(
      [
        { id: "wolves", enemy: "ENM-FOREST-WOLF", level: 2, count: 2, at: { x: 24, y: 20 } },
        { id: "boss", enemy: "ENM-PACK-LEADER", level: 11, count: 1, at: { x: 20, y: 20 } },
      ],
      { x: 28, y: 20 },
      "bad",
      content,
    );
    const before = snapshot(w);
    expect(() => {
      step(w);
    }).toThrow(/ENM-NOPE/);
    expect(snapshot(w)).toEqual(before);
  });
});

describe("段階の切り替えのダメージを受けない間の持続ダメージ", () => {
  it("刻みの後も無敵なら受けず、無敵が切れる刻みから受ける", () => {
    const w = world(
      [{ id: "boss", enemy: "ENM-MOTHER-TREE", level: 14, count: 1, at: { x: 16, y: 14 } }],
      { x: 30, y: 26 },
      "dot",
    );
    const boss = w.field.entries[0]?.enemy;
    if (boss === undefined) throw new Error("ボスがいない");
    const h = boss.combatant.health;
    h.takeDamage(h.maxHp * 2);
    step(w);
    expect(boss.shielded).toBe(true);
    const poison = db.ailments.get("AIL-POISON");
    if (poison?.kind !== "dot") throw new Error("毒が無い");
    boss.combatant.ailments.apply({
      ailmentId: poison.id,
      tag: poison.tag,
      total: 600,
      duration: 6,
      maxStacks: undefined,
    });
    const log: { shielded: boolean; drop: number }[] = [];
    for (let i = 0; i < Math.ceil(2.5 / STEP); i++) {
      const hp = h.hp;
      step(w);
      log.push({ shielded: boss.shielded, drop: hp - h.hp });
    }
    const first = log.findIndex((x) => !x.shielded);
    expect(first).toBeGreaterThan(0);
    expect(log.slice(0, first).every((x) => x.drop === 0)).toBe(true);
    // 無敵が切れた刻みから、持続ダメージを受ける
    expect(log.slice(first).every((x) => x.drop > 0)).toBe(true);
  });
});
