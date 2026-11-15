/**
 * 敵の行動の流れ（補助仕様書 10.2）：
 * 待機 → 追跡 →（間合い）→ 予兆 → 攻撃 → 硬直 → 追跡。崩しでダウン、離れすぎで帰還。
 */
import type { Rng } from "../rng.ts";
import type { Vec2 } from "../player/controller.ts";
import { createCombatant, type Combatant } from "../combat/combatant.ts";
import { angleDiff, shapeHits } from "../combat/geometry.ts";
import {
  LEASH_DISTANCE,
  PACK_ALERT_RANGE,
  RANK_MULTIPLIERS,
  SIGHT_ARC_DEGREES,
  SIGHT_RANGE,
  enemyAccuracy,
  type EnemyAttackDef,
  type EnemyDef,
  type EnemyRank,
} from "./def.ts";
import { standardEnemyHp } from "./stats.ts";

export type EnemyState = "idle" | "chase" | "windup" | "attack" | "recovery" | "down" | "return";

/** 敵から見たプレイヤー */
export interface Target {
  pos: Vec2;
  radius: number;
  /** 回避の無敵などで、攻撃が当たらない */
  invulnerable: boolean;
}

/** 敵のこの刻みの出来事。表示と、プレイヤーへのダメージの適用は呼び出し側が行う */
export type EnemyEvent =
  | { type: "windup"; enemy: Enemy; attack: EnemyAttackDef; angle: number }
  | { type: "hit"; enemy: Enemy; attack: EnemyAttackDef; damage: number; accuracy: number }
  | {
      type: "projectile";
      enemy: Enemy;
      attack: EnemyAttackDef;
      pos: Vec2;
      angle: number;
      damage: number;
    }
  | { type: "cloud"; enemy: Enemy; attack: EnemyAttackDef; pos: Vec2; damage: number }
  | { type: "summon"; enemy: Enemy; attack: EnemyAttackDef }
  | { type: "alert"; enemy: Enemy }
  | { type: "returned"; enemy: Enemy };

export interface Enemy {
  def: EnemyDef;
  level: number;
  rank: EnemyRank;
  body: Combatant;
  spawn: Vec2;
  state: EnemyState;
  /** 同じ群れの識別子（群れの仲間が気づくため） */
  packId: string | undefined;
  stateTime: number;
  attack: EnemyAttackDef | undefined;
  attackHitDone: boolean;
  cooldowns: Map<string, number>;
  /** 回り込みの向き（+1・-1） */
  flankSide: 1 | -1;
  /** 標準HPと格の倍率から決まる、攻撃の強さの基準 */
  attackPower: number;
  /** 攻撃速度の強化（遠吠え：+20%を8秒）。動作の時間が短くなる */
  buff: { bonus: number; left: number };
  /** 今回の攻撃で、すでに出したヒットの数（多段の攻撃） */
  hitsDone: number;
}

export function createEnemy(init: {
  def: EnemyDef;
  level: number;
  pos: Vec2;
  rank?: EnemyRank;
  packId?: string;
  id: string;
  facing?: number;
  rng?: Rng;
}): Enemy {
  const rank = init.rank ?? "normal";
  const mult = RANK_MULTIPLIERS[rank];
  const std = standardEnemyHp(init.level);
  const maxHp = std * init.def.hpMultiplier * mult.hp;
  const body = createCombatant({
    id: init.id,
    pos: init.pos,
    maxHp,
    radius: (init.def.radius ?? 0.5) * mult.scale,
    facing: init.facing ?? Math.PI,
    armor: (init.def.armorPerLevel ?? 0) * init.level,
    evasion: (init.def.evasionPerLevel ?? 0) * init.level,
    resistance: init.def.resistance ?? {},
  });
  if (init.def.noFacing === true) body.noFacing = true;
  return {
    def: init.def,
    level: init.level,
    rank,
    body,
    spawn: { ...init.pos },
    state: init.def.stationary === true ? "idle" : "idle",
    packId: init.packId,
    stateTime: 0,
    attack: undefined,
    attackHitDone: false,
    cooldowns: new Map(),
    flankSide: init.rng?.chance(0.5) === false ? -1 : 1,
    attackPower: std * mult.damage,
    buff: { bonus: 0, left: 0 },
    hitsDone: 0,
  };
}

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

function turnToward(enemy: Enemy, angle: number, dt: number): void {
  if (enemy.def.noFacing === true) return;
  const maxTurn = (enemy.def.turnDegreesPerSecond * Math.PI * dt) / 180;
  const diff = angleDiff(angle, enemy.body.facing);
  enemy.body.facing += Math.max(-maxTurn, Math.min(maxTurn, diff));
}

function moveToward(enemy: Enemy, to: Vec2, speed: number, dt: number): void {
  const d = dist(enemy.body.pos, to);
  if (d < 1e-6) return;
  const step = Math.min(d, speed * dt);
  enemy.body.pos.x += ((to.x - enemy.body.pos.x) / d) * step;
  enemy.body.pos.y += ((to.y - enemy.body.pos.y) / d) * step;
}

/** プレイヤーが視界（前方180°・8m）に入っているか */
export function canSee(enemy: Enemy, target: Target): boolean {
  if (enemy.def.noFacing === true) return dist(enemy.body.pos, target.pos) <= SIGHT_RANGE;
  const d = dist(enemy.body.pos, target.pos);
  if (d > SIGHT_RANGE) return false;
  const angle = Math.atan2(target.pos.y - enemy.body.pos.y, target.pos.x - enemy.body.pos.x);
  return Math.abs(angleDiff(angle, enemy.body.facing)) <= (SIGHT_ARC_DEGREES * Math.PI) / 360;
}

/** 攻撃を受けた、または仲間に呼ばれて気づく */
export function alertEnemy(enemy: Enemy): boolean {
  if (enemy.state === "idle") {
    enemy.state = "chase";
    enemy.stateTime = 0;
    return true;
  }
  return false;
}

/** 攻撃を受けて気づく。同じ群れの仲間（10m以内）にも伝わる */
export function alertPack(enemies: readonly Enemy[], enemy: Enemy): void {
  alertEnemy(enemy);
  if (enemy.packId === undefined) return;
  for (const other of enemies) {
    if (
      other !== enemy &&
      other.packId === enemy.packId &&
      other.body.hp > 0 &&
      dist(other.body.pos, enemy.body.pos) <= PACK_ALERT_RANGE
    ) {
      alertEnemy(other);
    }
  }
}

/** 敵の全体を1刻み進める。群れの気づきも扱う */
export function stepEnemies(
  enemies: readonly Enemy[],
  target: Target,
  dt: number,
  rng: Rng,
): EnemyEvent[] {
  const events: EnemyEvent[] = [];
  for (const enemy of enemies) {
    if (enemy.body.hp <= 0) continue;
    events.push(...stepEnemy(enemy, target, dt, rng));
  }
  // 同じ群れの仲間が気づく（10m以内）
  for (const e of events.filter((x) => x.type === "alert")) {
    if (e.enemy.packId === undefined) continue;
    for (const other of enemies) {
      if (
        other !== e.enemy &&
        other.packId === e.enemy.packId &&
        other.body.hp > 0 &&
        dist(other.body.pos, e.enemy.body.pos) <= PACK_ALERT_RANGE &&
        alertEnemy(other)
      ) {
        events.push({ type: "alert", enemy: other });
      }
    }
  }
  return events;
}

/** 敵1体を進める */
export function stepEnemy(enemy: Enemy, target: Target, dt: number, rng: Rng): EnemyEvent[] {
  const events: EnemyEvent[] = [];
  const body = enemy.body;
  for (const [id, left] of enemy.cooldowns) {
    const next = left - dt;
    if (next <= 0) enemy.cooldowns.delete(id);
    else enemy.cooldowns.set(id, next);
  }
  body.breakGauge.tick(dt);
  body.breakTaken.left = Math.max(0, body.breakTaken.left - dt);
  body.accuracyPenalty.left = Math.max(0, body.accuracyPenalty.left - dt);
  const dots = body.ailments.tick(dt, {
    addPct: 0,
    mult: 1,
    enemyDamageTaken: body.ailments.enemyDamageTakenMultiplier,
    resistance: body.resistance,
  });
  body.hp = Math.max(0, body.hp - dots.reduce((s, d) => s + d.damage, 0));
  if (body.hp <= 0) return events;
  enemy.buff.left = Math.max(0, enemy.buff.left - dt);
  enemy.stateTime += dt * (1 + (enemy.buff.left > 0 ? enemy.buff.bonus : 0));

  // 崩しでダウン（行動中でも中断される）
  if (body.breakGauge.broken && enemy.state !== "down") {
    enemy.state = "down";
    enemy.stateTime = 0;
    enemy.attack = undefined;
    return events;
  }

  const toPlayer = Math.atan2(target.pos.y - body.pos.y, target.pos.x - body.pos.x);
  const d = dist(body.pos, target.pos);
  const slow = 1 - body.ailments.slow;
  const speed = enemy.def.speed * slow;
  const frozen = body.ailments.frozen;

  switch (enemy.state) {
    case "down":
      if (!body.breakGauge.broken) {
        enemy.state = "chase";
        enemy.stateTime = 0;
      }
      break;
    case "idle":
      if (canSee(enemy, target) && dist(body.pos, target.pos) <= SIGHT_RANGE) {
        enemy.state = "chase";
        enemy.stateTime = 0;
        events.push({ type: "alert", enemy });
      }
      break;
    case "return": {
      moveToward(enemy, enemy.spawn, enemy.def.speed, dt);
      if (dist(body.pos, enemy.spawn) < 0.2) {
        body.hp = body.maxHp;
        enemy.state = "idle";
        events.push({ type: "returned", enemy });
      }
      break;
    }
    case "chase": {
      if (frozen) break;
      if (dist(body.pos, enemy.spawn) >= LEASH_DISTANCE) {
        enemy.state = "return";
        break;
      }
      if (enemy.def.stationary === true) {
        turnToward(enemy, toPlayer, dt);
      } else {
        turnToward(enemy, toPlayer, dt);
        const keep = enemy.def.keepDistance;
        if (keep) {
          if (d < keep.min) {
            const away = {
              x: body.pos.x - Math.cos(toPlayer) * 2,
              y: body.pos.y - Math.sin(toPlayer) * 2,
            };
            moveToward(enemy, away, speed, dt);
          } else if (d > keep.max) {
            moveToward(enemy, target.pos, speed, dt);
          }
        } else if (enemy.def.flank === true && d > 3) {
          // 横や背後へ回り込む：プレイヤーの周りの、斜め後ろの点を目指す
          const around = toPlayer + Math.PI + enemy.flankSide * 1.1;
          const goal = {
            x: target.pos.x + Math.cos(around) * Math.min(d, 3),
            y: target.pos.y + Math.sin(around) * Math.min(d, 3),
          };
          moveToward(enemy, goal, speed, dt);
        } else {
          const minRange = Math.min(...enemy.def.attacks.map((a) => a.range));
          if (d > minRange * 0.8) moveToward(enemy, target.pos, speed, dt);
        }
      }
      // 攻撃の選択：間合いに入っていて、使える攻撃から選ぶ
      const usable = enemy.def.attacks.filter(
        (a) => d <= a.range + target.radius && !enemy.cooldowns.has(a.id),
      );
      const facingOk =
        Math.abs(angleDiff(toPlayer, body.facing)) < 0.6 || enemy.def.noFacing === true;
      if (usable.length > 0 && facingOk) {
        const chosen = usable[rng.int(0, usable.length - 1)] as EnemyAttackDef;
        enemy.attack = chosen;
        enemy.state = "windup";
        enemy.stateTime = 0;
        enemy.attackHitDone = false;
        enemy.hitsDone = 0;
        events.push({ type: "windup", enemy, attack: chosen, angle: body.facing });
      }
      break;
    }
    case "windup": {
      const a = enemy.attack as EnemyAttackDef;
      // 予兆の間は向きを変えない（ボスを除く）
      if (enemy.def.boss !== undefined) turnToward(enemy, toPlayer, dt * 0.5);
      if (enemy.stateTime >= a.telegraphSeconds) {
        enemy.state = "attack";
        enemy.stateTime = 0;
      }
      break;
    }
    case "attack": {
      const a = enemy.attack as EnemyAttackDef;
      const damage = enemy.attackPower * a.damageRatio;
      const accuracy =
        enemyAccuracy(enemy.level) *
        (1 - (body.accuracyPenalty.left > 0 ? body.accuracyPenalty.value : 0));
      if (a.summon) {
        if (!enemy.attackHitDone) {
          enemy.attackHitDone = true;
          events.push({ type: "summon", enemy, attack: a });
        }
      } else if (a.dashSpeed !== undefined) {
        // 突進の間は曲がれない
        body.pos.x += Math.cos(body.facing) * a.dashSpeed * dt;
        body.pos.y += Math.sin(body.facing) * a.dashSpeed * dt;
        const touching = dist(body.pos, target.pos) <= body.radius + target.radius;
        if (!enemy.attackHitDone && touching && !target.invulnerable) {
          enemy.attackHitDone = true;
          events.push({ type: "hit", enemy, attack: a, damage, accuracy });
        }
      } else if (a.hitCount !== undefined && a.hitCount > 1) {
        // 多段：当たり判定の時間を等分して、段ごとに判定する
        const due = Math.min(
          a.hitCount,
          Math.floor((enemy.stateTime / a.activeSeconds) * a.hitCount) + 1,
        );
        while (enemy.hitsDone < due) {
          enemy.hitsDone++;
          if (
            !target.invulnerable &&
            shapeHits(a.shape, body.pos, body.facing, { pos: target.pos, radius: target.radius })
          ) {
            events.push({ type: "hit", enemy, attack: a, damage, accuracy });
          }
        }
      } else if (!enemy.attackHitDone) {
        enemy.attackHitDone = true;
        if (a.projectile) {
          events.push({
            type: "projectile",
            enemy,
            attack: a,
            pos: { ...body.pos },
            angle: body.facing,
            damage,
          });
        } else if (a.cloud) {
          events.push({ type: "cloud", enemy, attack: a, pos: { ...body.pos }, damage });
        } else if (
          !target.invulnerable &&
          shapeHits(a.shape, body.pos, body.facing, { pos: target.pos, radius: target.radius })
        ) {
          events.push({ type: "hit", enemy, attack: a, damage, accuracy });
        }
      }
      if (enemy.stateTime >= a.activeSeconds) {
        enemy.state = "recovery";
        enemy.stateTime = 0;
        if (a.cooldownSeconds) enemy.cooldowns.set(a.id, a.cooldownSeconds);
      }
      break;
    }
    case "recovery": {
      const a = enemy.attack as EnemyAttackDef;
      if (enemy.stateTime >= a.recoverySeconds) {
        enemy.state = "chase";
        enemy.stateTime = 0;
        enemy.attack = undefined;
      }
      break;
    }
  }
  return events;
}

/** 格に応じて、敵の群れを作る。人数は定義の範囲から選ぶ */
export function spawnPack(init: {
  def: EnemyDef;
  level: number;
  center: Vec2;
  rng: Rng;
  packId: string;
  rank?: EnemyRank;
}): Enemy[] {
  const range = init.def.pack ?? { min: 1, max: 1 };
  const count = init.rng.int(range.min, range.max);
  const out: Enemy[] = [];
  for (let i = 0; i < count; i++) {
    const a = init.rng.next() * Math.PI * 2;
    const r = count === 1 ? 0 : 1 + init.rng.next() * 2;
    out.push(
      createEnemy({
        def: init.def,
        level: init.level,
        pos: { x: init.center.x + Math.cos(a) * r, y: init.center.y + Math.sin(a) * r },
        ...(init.rank ? { rank: init.rank } : {}),
        packId: init.packId,
        id: `${init.packId}-${String(i)}`,
        rng: init.rng,
      }),
    );
  }
  return out;
}

/**
 * 遠吠え：仲間を呼び、周囲の同種の敵の攻撃速度を上げる（補助仕様書 10.5）。
 * 呼んだ敵は、呼んだ側と同じ群れとして加わる。
 */
export function performSummon(
  summoner: Enemy,
  attack: EnemyAttackDef,
  lookup: (id: string) => EnemyDef,
  rng: Rng,
  all: readonly Enemy[],
): Enemy[] {
  const s = attack.summon;
  if (!s) return [];
  const def = lookup(s.enemyId);
  const created: Enemy[] = [];
  for (let i = 0; i < s.count; i++) {
    const a = rng.next() * Math.PI * 2;
    created.push(
      createEnemy({
        def,
        level: summoner.level,
        pos: {
          x: summoner.body.pos.x + Math.cos(a) * 2.5,
          y: summoner.body.pos.y + Math.sin(a) * 2.5,
        },
        ...(summoner.packId ? { packId: summoner.packId } : {}),
        id: `${summoner.body.id}-call-${String(rng.int(0, 1e9))}`,
        rng,
      }),
    );
  }
  // 周囲の同種の敵（呼ばれた敵を含む）の攻撃速度を上げる
  for (const e of [...all, ...created]) {
    if (e.def.id !== def.id || e.body.hp <= 0) continue;
    if (dist(e.body.pos, summoner.body.pos) <= s.radius) {
      e.buff = { bonus: s.attackSpeedBonus, left: s.buffSeconds };
      // 呼ばれた敵はすでに気づいている
      if (e.state === "idle") e.state = "chase";
    }
  }
  return created;
}
