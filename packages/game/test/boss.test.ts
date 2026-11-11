import { describe, expect, it } from "vitest";
import {
  Combatant,
  type Enemy,
  FIXED_STEP_SECONDS,
  Rng,
  type Vec2,
  staggerProfiles,
} from "@stella/core";
import { loadGameContent } from "@stella/content";
import { EnemyField, type FieldHooks } from "../src/world/EnemyField.ts";

const db = loadGameContent();
const STEP = FIXED_STEP_SECONDS;
const bounds = { minX: 0, minY: 0, maxX: 32, maxY: 28 };
/** 母樹の間（データの REGION-A4-BOSS と同じ形）：中心 (16,14)、根渡りの地点は半径6mの3か所。 */
const CENTER = { x: 16, y: 14 };
const ANCHORS: [Vec2, Vec2, Vec2] = [0, 1, 2].map((i) => ({
  x: CENTER.x + 6 * Math.cos((2 * Math.PI * i) / 3),
  y: CENTER.y + 6 * Math.sin((2 * Math.PI * i) / 3),
})) as [Vec2, Vec2, Vec2];

function player(at: Vec2): Combatant {
  return new Combatant(db, {
    id: "player",
    team: "player",
    position: at,
    radius: 0.35,
    maxHp: 1e9,
    staggerProfile: staggerProfiles(db).player,
  });
}

function bossField(enemy = "ENM-MOTHER-TREE", level = 14, seed = "boss"): EnemyField {
  return new EnemyField(
    db,
    Rng.fromSeed(seed),
    bounds,
    [{ id: "boss", enemy, level, count: 1, at: ANCHORS[0], anchors: ANCHORS }],
    false,
  );
}

function bossOf(field: EnemyField): Enemy {
  const e = field.entries.find((v) => v.enemy.def.boss !== undefined)?.enemy;
  if (e === undefined) throw new Error("ボスがいない");
  return e;
}

interface Log {
  attacks: string[];
  events: { type: string; phase: number; t: number }[];
  hits: { attack: string; at: Vec2 }[];
  t: number;
}

function hooksFor(log: Log, p: Combatant): FieldHooks {
  return {
    onPlayerHit: (_r, _e, a) => log.hits.push({ attack: a.id, at: p.position }),
    onAvoided: () => undefined,
    onEnemyKilled: () => undefined,
    onBossEvent: (_e, type, phase) => log.events.push({ type, phase, t: log.t }),
  };
}

/** n 刻み進める。ボスの攻撃の始まりを記録する。 */
function run(field: EnemyField, p: Combatant, log: Log, steps: number, facing = 0): void {
  const boss = bossOf(field);
  const hooks = hooksFor(log, p);
  for (let i = 0; i < steps; i++) {
    const before = boss.state;
    field.update(STEP, p, false, facing, hooks);
    log.t += STEP;
    if (before !== "windup" && boss.state === "windup" && boss.currentAttack !== undefined)
      log.attacks.push(boss.currentAttack.id);
    // 体力を十分に持たせる（攻撃の流れだけを見る）
    p.health.restoreFull();
  }
}

/** ボスのHPを割合 ratio まで減らす（段階の境目より下には減らない）。 */
function damageTo(boss: Enemy, ratio: number): void {
  const h = boss.combatant.health;
  h.takeDamage(Math.max(0, h.hp - h.maxHp * ratio));
}

const newLog = (): Log => ({ attacks: [], events: [], hits: [], t: 0 });

describe("腐根の母樹（補助仕様書11.1）", () => {
  it("HP 5,400・ボスの崩しゲージ（最大HPの0.15倍）・火-20%・闇+20%", () => {
    const boss = bossOf(bossField());
    expect(boss.combatant.health.maxHp).toBe(5400);
    expect(boss.combatant.isBoss).toBe(true);
    expect(boss.combatant.stagger.max).toBeCloseTo(810);
    expect(boss.combatant.resist).toEqual({ fire: -0.2, dark: 0.2 });
    expect(boss.def.dropSource).toBe("chapterBoss");
    const abyss = bossOf(bossField("ENM-ABYSS-MOTHER-TREE", 21));
    expect(abyss.combatant.health.maxHp).toBe(9100);
    expect(abyss.def.dropSource).toBe("abyssBoss");
    expect(abyss.def.boss?.tokens).toEqual({ id: "TOKEN-BOSS-CH1", count: 2 });
    // 経験値の倍率（補助仕様書4.2：中ボス×30・章ボス×100）
    expect(boss.def.xpMultiplier).toBe(100);
    expect(abyss.def.xpMultiplier).toBe(100);
    expect(db.enemies.get("ENM-PACK-LEADER")?.xpMultiplier).toBe(30);
  });

  it("HP66%・33%で段階が変わり、2秒間ダメージを受けない。大きなダメージでも段階を飛ばさない", () => {
    const field = bossField();
    const boss = bossOf(field);
    const p = player({ x: 30, y: 26 });
    const log = newLog();
    const h = boss.combatant.health;
    // 一度に全てのHPを削るダメージでも、66%で止まる
    h.takeDamage(h.maxHp * 2);
    expect(h.hp).toBeCloseTo(5400 * 0.66);
    run(field, p, log, 1);
    expect(boss.phase).toBe(2);
    expect(log.events).toEqual([{ type: "phase", phase: 2, t: 0 }]);
    expect(boss.shielded).toBe(true);
    expect(h.takeDamage(1000).toHp).toBe(0);
    // 2秒たつと、またダメージを受ける（次は33%で止まる）
    run(field, p, log, Math.ceil(2 / STEP));
    expect(boss.shielded).toBe(false);
    h.takeDamage(h.maxHp);
    expect(h.hp).toBeCloseTo(5400 * 0.33);
    run(field, p, log, 1);
    expect(boss.phase).toBe(3);
    run(field, p, log, Math.ceil(2 / STEP));
    // 第3段階では、倒せる
    h.takeDamage(h.maxHp);
    run(field, p, log, 1);
    expect(boss.state).toBe("dead");
  });

  it("段階ごとに使う攻撃が変わる（第1段階は根の叩きつけ1回、第2段階から2連続と触手、第3段階で根渡りと暴走）", () => {
    const field = bossField("ENM-MOTHER-TREE", 14, "phases");
    const boss = bossOf(field);
    // 広場の中心から少し離れた位置（蔦の薙ぎの間合いの外。叩きつけ・胞子が届く）
    const p = player({ x: CENTER.x - 4, y: CENTER.y });
    const phase1 = newLog();
    run(field, p, phase1, Math.ceil(40 / STEP));
    expect(new Set(phase1.attacks)).toEqual(new Set(["root-slam", "poison-spores"]));
    damageTo(boss, 0.5);
    const phase2 = newLog();
    run(field, p, phase2, Math.ceil(45 / STEP));
    expect(phase2.attacks).toContain("root-slam2");
    expect(phase2.attacks).toContain("tentacles");
    expect(phase2.attacks).not.toContain("root-slam");
    expect(phase2.attacks).not.toContain("root-travel");
    // 触手は20秒ごとに2本（第2段階の45秒で2回）
    const tentacles = field.entries.filter((v) => v.enemy.def.id === "ENM-ROOT-TENTACLE");
    expect(tentacles.length).toBeGreaterThanOrEqual(4);
    expect(tentacles.every((v) => v.enemy.level === 14 && v.enemy.alerted)).toBe(true);
    damageTo(boss, 0.2);
    const phase3 = newLog();
    run(field, p, phase3, Math.ceil(45 / STEP));
    expect(phase3.attacks).toContain("root-travel");
    expect(phase3.attacks).toContain("rot-rampage");
    // 根渡りは15秒ごと（45秒で多くて3回）
    const travels = phase3.attacks.filter((a) => a === "root-travel").length;
    expect(travels).toBeGreaterThanOrEqual(2);
    expect(travels).toBeLessThanOrEqual(3);
  });

  it("根の叩きつけは、予兆の始めのプレイヤーの位置に落ちる（離れていても当たる）", () => {
    const field = bossField("ENM-MOTHER-TREE", 14, "slam");
    const boss = bossOf(field);
    // 蔦の薙ぎの間合いの外で、動かない
    const p = player({ x: ANCHORS[0].x - 8, y: ANCHORS[0].y });
    const log = newLog();
    run(field, p, log, Math.ceil(30 / STEP));
    const slam = log.hits.find((h) => h.attack === "root-slam");
    expect(slam).toBeDefined();
    expect(Math.hypot(boss.position.x - p.position.x, boss.position.y - p.position.y)).toBeCloseTo(
      8,
    );
  });

  it("攻撃中も毎秒90°でプレイヤーの方を向く（通常の敵は向きを変えない）", () => {
    const field = bossField("ENM-MOTHER-TREE", 14, "turn");
    const boss = bossOf(field);
    const p = player({ x: ANCHORS[0].x - 6, y: ANCHORS[0].y });
    const log = newLog();
    // 予兆に入るまで進める
    for (let i = 0; i < 2000 && boss.state !== "windup"; i++) run(field, p, log, 1);
    expect(boss.state).toBe("windup");
    const before = boss.facing;
    // 予兆の間に、ボスの真下（南）へ回り込む
    p.position = { x: boss.position.x, y: boss.position.y + 6 };
    run(field, p, log, 6); // 0.1秒
    const turned = Math.abs(boss.facing - before);
    expect(turned).toBeGreaterThan(0);
    expect(turned).toBeLessThanOrEqual(((90 * Math.PI) / 180) * 0.1 + 1e-6);
  });

  it("根渡り：1.5秒かけて地中を別の地点へ動く。その間は狙われず、ダメージを受けない（移動中として扱う）", () => {
    const field = bossField("ENM-MOTHER-TREE", 14, "travel");
    const boss = bossOf(field);
    const p = player({ x: CENTER.x, y: CENTER.y + 3 });
    const log = newLog();
    damageTo(boss, 0.5);
    run(field, p, log, Math.ceil(3 / STEP));
    damageTo(boss, 0.2);
    expect(boss.phase).toBe(2);
    const start = boss.position;
    let sawUnderground = false;
    let movingUnderground = false;
    for (let i = 0; i < Math.ceil(30 / STEP); i++) {
      run(field, p, log, 1);
      if (boss.underground) {
        sawUnderground = true;
        expect(field.targets()).not.toContain(boss.combatant);
        expect(boss.combatant.health.takeDamage(500).toHp).toBe(0);
        if (boss.combatant.moving) movingUnderground = true;
      }
      if (log.events.some((e) => e.type === "surface")) break;
    }
    expect(sawUnderground).toBe(true);
    expect(movingUnderground).toBe(true);
    const burrow = log.events.find((e) => e.type === "burrow");
    const surface = log.events.find((e) => e.type === "surface");
    expect(burrow).toBeDefined();
    expect(surface).toBeDefined();
    expect((surface?.t ?? 0) - (burrow?.t ?? 0)).toBeCloseTo(1.5, 1);
    // 別の地点に現れる
    expect(Math.hypot(boss.position.x - start.x, boss.position.y - start.y)).toBeGreaterThan(5);
    expect(
      ANCHORS.some((a) => Math.hypot(a.x - boss.position.x, a.y - boss.position.y) < 1e-6),
    ).toBe(true);
    expect(field.targets()).toContain(boss.combatant);
  });

  it("腐根の暴走：叩きつけを3連続、叩いた場所に毒だまりが残る", () => {
    const field = bossField("ENM-MOTHER-TREE", 14, "rampage");
    const boss = bossOf(field);
    const p = player({ x: CENTER.x - 3, y: CENTER.y - 3 });
    const log = newLog();
    damageTo(boss, 0.5);
    run(field, p, log, Math.ceil(3 / STEP));
    damageTo(boss, 0.2);
    run(field, p, log, Math.ceil(3 / STEP));
    let rampage = false;
    let clouds = 0;
    for (let i = 0; i < Math.ceil(60 / STEP) && !rampage; i++) {
      run(field, p, log, 1);
      if (boss.currentAttack?.id === "rot-rampage" && boss.state === "recovery") {
        rampage = true;
        clouds = field.clouds.filter((c) => c.radius === 2).length;
      }
    }
    expect(rampage).toBe(true);
    expect(log.hits.filter((h) => h.attack === "rot-rampage").length).toBe(3);
    expect(clouds).toBe(3);
  });
});

describe("毒の胞子の雲の並べ方（docs/progress D-U21-3）", () => {
  it("3つの雲はプレイヤーの側に寄り、ボスの横（近接の輪の90°の位置）は空いている", () => {
    const field = bossField();
    const boss = bossOf(field);
    // 近接の距離（体の半径1.5＋0.6）でボスの左に立つ
    const p = player({ x: CENTER.x - 2.1, y: CENTER.y });
    const log = newLog();
    let checked = false;
    for (let i = 0; i < Math.ceil(40 / STEP) && !checked; i++) {
      run(field, p, log, 1);
      if (boss.currentAttack?.id !== "poison-spores" || boss.state !== "recovery") continue;
      const clouds = field.clouds.filter((c) => c.radius === 2.5);
      expect(clouds.length).toBe(3);
      const r = boss.combatant.radius + 0.6;
      const inside = (x: number, y: number): boolean =>
        clouds.some((c) => Math.hypot(x - c.center.x, y - c.center.y) <= c.radius);
      // プレイヤーの位置は雲の中、ボスの上下（横）と反対側は雲の外
      expect(inside(p.position.x, p.position.y)).toBe(true);
      expect(inside(boss.position.x, boss.position.y - r)).toBe(false);
      expect(inside(boss.position.x, boss.position.y + r)).toBe(false);
      expect(inside(boss.position.x + r, boss.position.y)).toBe(false);
      checked = true;
    }
    expect(checked).toBe(true);
  });
});

describe("深淵の母樹（補助仕様書11.2）", () => {
  it("第2段階から、毒の胞子が2回連続（3つ×2回）になる", () => {
    const field = bossField("ENM-ABYSS-MOTHER-TREE", 21, "abyss");
    const boss = bossOf(field);
    const p = player({ x: CENTER.x - 4, y: CENTER.y });
    const log = newLog();
    damageTo(boss, 0.5);
    let max = 0;
    for (let i = 0; i < Math.ceil(60 / STEP); i++) {
      run(field, p, log, 1);
      if (boss.currentAttack?.id === "poison-spores2" && boss.state === "recovery")
        max = Math.max(max, field.clouds.filter((c) => c.radius === 2.5).length);
    }
    expect(log.attacks).toContain("poison-spores2");
    expect(log.attacks).not.toContain("poison-spores");
    expect(max).toBeGreaterThanOrEqual(6);
  });

  it("根渡りは10秒ごと", () => {
    const def = db.enemies.get("ENM-ABYSS-MOTHER-TREE");
    expect(def?.attacks.find((a) => a.id === "root-travel")?.cooldown).toBe(10);
    expect(
      db.enemies.get("ENM-MOTHER-TREE")?.attacks.find((a) => a.id === "root-travel")?.cooldown,
    ).toBe(15);
  });
});
