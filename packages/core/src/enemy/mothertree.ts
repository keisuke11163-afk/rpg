/**
 * 腐根の母樹・深淵の母樹（補助仕様書 11章）：3段階・根渡り・触手・暴走・段階切替の無敵。
 * 通常の敵のAI（ai.ts）とは別の、専用の行動。
 */
import type { Rng } from "../rng.ts";
import type { Vec2 } from "../player/controller.ts";
import { angleDiff, shapeHits } from "../combat/geometry.ts";
import type { Enemy, EnemyEvent, Target } from "./ai.ts";
import type { EnemyAttackDef } from "./def.ts";
import { standardEnemyHp } from "./stats.ts";

/** 段階の切り替えは、HP66%・33%で、2秒間ダメージを受けない（本仕様書 8.4） */
export const PHASE_THRESHOLDS = [0.66, 0.33] as const;
export const PHASE_INVULNERABLE_SECONDS = 2;
export const TURN_DEGREES_PER_SECOND = 90;
export const TENTACLE_INTERVAL = 20;
export const ROOT_WALK_SECONDS = 1.5;
export const ROOT_WALK_INTERVAL = 15;
export const ROOT_WALK_INTERVAL_ABYSS = 10;
export const ENGAGE_RANGE = 16;

type ActionKind = "slam" | "sweep" | "spores" | "rampage" | "tentacles" | "rootwalk";

interface Action {
  kind: ActionKind;
  stage: "windup" | "active" | "recovery";
  t: number;
  /** 地面を狙う攻撃の範囲 */
  at: { pos: Vec2; radius: number }[];
  /** 連続の攻撃の残り回数（暴走3連・叩きつけ2連・深淵の胞子2連） */
  repeatsLeft: number;
}

export interface MotherTreeState {
  engaged: boolean;
  phase: 1 | 2 | 3;
  action: Action | undefined;
  invulnerableLeft: number;
  staggerLeft: number;
  tentacleCd: number;
  rootCd: number;
  /** 攻撃どうしの間（秒） */
  restLeft: number;
  /** 根渡りの先 */
  rootFrom: Vec2 | undefined;
  rootTo: Vec2 | undefined;
}

export function createMotherTreeState(): MotherTreeState {
  return {
    engaged: false,
    phase: 1,
    action: undefined,
    invulnerableLeft: 0,
    staggerLeft: 0,
    tentacleCd: TENTACLE_INTERVAL,
    rootCd: ROOT_WALK_INTERVAL,
    restLeft: 1,
    rootFrom: undefined,
    rootTo: undefined,
  };
}

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

function attackOf(enemy: Enemy, id: string): EnemyAttackDef {
  const a = enemy.def.attacks.find((x) => x.id === id);
  if (!a) throw new Error(`母樹の攻撃がない: ${id}`);
  return a;
}

/** 母樹を1刻み進める */
export function stepMotherTree(enemy: Enemy, target: Target, dt: number, rng: Rng): EnemyEvent[] {
  const events: EnemyEvent[] = [];
  const st = enemy.script as MotherTreeState;
  const cfg = enemy.def.script;
  if (!cfg) return events;
  const body = enemy.body;

  // 持続ダメージ・崩しゲージ・状態の時間
  body.breakGauge.tick(dt);
  body.breakTaken.left = Math.max(0, body.breakTaken.left - dt);
  const lock = body.hp;
  const dots = body.ailments.tick(dt, {
    addPct: 0,
    mult: 1,
    enemyDamageTaken: body.ailments.enemyDamageTakenMultiplier,
    resistance: body.resistance,
    // 出血は、移動中（根渡り）に2倍
    moving: st.action?.kind === "rootwalk",
  });
  if (!body.invulnerable) body.hp = Math.max(0, body.hp - dots.reduce((a, d) => a + d.damage, 0));
  else body.hp = lock;
  if (body.hp <= 0) return events;

  // 戦いの開始
  if (!st.engaged) {
    if (dist(body.pos, target.pos) <= ENGAGE_RANGE) st.engaged = true;
    else return events;
  }

  // 段階の切り替え：HP66%・33%で2秒間ダメージを受けない
  const ratio = body.hp / body.maxHp;
  const nextPhase: 1 | 2 | 3 =
    ratio <= PHASE_THRESHOLDS[1] ? 3 : ratio <= PHASE_THRESHOLDS[0] ? 2 : 1;
  if (nextPhase > st.phase) {
    st.phase = nextPhase;
    st.action = undefined;
    st.invulnerableLeft = PHASE_INVULNERABLE_SECONDS;
    body.invulnerable = true;
    st.restLeft = 1;
  }
  if (st.invulnerableLeft > 0) {
    st.invulnerableLeft -= dt;
    if (st.invulnerableLeft <= 0) body.invulnerable = false;
    return events;
  }

  // 顔の向き：毎秒90°でプレイヤーの方を向く（攻撃中も変える）
  const maxTurn = (TURN_DEGREES_PER_SECOND * Math.PI * dt) / 180;
  const toPlayer = Math.atan2(target.pos.y - body.pos.y, target.pos.x - body.pos.x);
  body.facing += Math.max(-maxTurn, Math.min(maxTurn, angleDiff(toPlayer, body.facing)));

  // 崩れたら怯む（根渡り中は崩れない）
  if (body.breakGauge.broken && st.action?.kind !== "rootwalk") {
    st.action = undefined;
    st.staggerLeft = Math.max(st.staggerLeft, 0.05);
    return events;
  }
  if (st.staggerLeft > 0) {
    st.staggerLeft -= dt;
    return events;
  }

  st.tentacleCd -= dt;
  st.rootCd -= dt;
  const std = standardEnemyHp(enemy.level);
  const accuracy = 1e9;

  if (!st.action) {
    st.restLeft -= dt;
    if (st.restLeft > 0) return events;
    // 次の攻撃を選ぶ
    const kinds = chooseActions(st, st.tentacleCd <= 0, st.rootCd <= 0);
    const kind = kinds[rng.int(0, kinds.length - 1)] as ActionKind;
    st.action = { kind, stage: "windup", t: 0, at: [], repeatsLeft: 0 };
    beginWindup(enemy, st, st.action, target, rng, events, cfg.abyss);
    return events;
  }

  const act = st.action;
  const def = attackOf(enemy, act.kind === "rampage" ? "rampage" : act.kind);
  act.t += dt;

  if (act.kind === "rootwalk") {
    // 1.5秒かけて地中を移動し、別の地点に現れる
    const from = st.rootFrom ?? body.pos;
    const to = st.rootTo ?? body.pos;
    const k = Math.min(1, act.t / ROOT_WALK_SECONDS);
    body.pos.x = from.x + (to.x - from.x) * k;
    body.pos.y = from.y + (to.y - from.y) * k;
    body.invulnerable = true;
    if (act.t >= ROOT_WALK_SECONDS) {
      body.invulnerable = false;
      st.action = undefined;
      st.restLeft = 0.8;
      st.rootCd = cfg.abyss ? ROOT_WALK_INTERVAL_ABYSS : ROOT_WALK_INTERVAL;
    }
    return events;
  }

  if (act.stage === "windup") {
    if (act.t >= def.telegraphSeconds) {
      act.stage = "active";
      act.t = 0;
      resolveActive(enemy, st, act, def, target, std, accuracy, events);
    }
  } else if (act.stage === "active") {
    if (act.t >= def.activeSeconds) {
      act.stage = "recovery";
      act.t = 0;
    }
  } else if (act.t >= def.recoverySeconds) {
    if (act.repeatsLeft > 0) {
      // 連続の攻撃：次の予兆に入る
      act.repeatsLeft--;
      act.stage = "windup";
      act.t = 0;
      act.at = [];
      beginWindup(enemy, st, act, target, rng, events, cfg.abyss, true);
    } else {
      st.action = undefined;
      st.restLeft = 0.8;
    }
  }
  return events;
}

/** 段階ごとに出せる攻撃（本仕様書 11.1） */
function chooseActions(
  st: MotherTreeState,
  tentacleReady: boolean,
  rootReady: boolean,
): ActionKind[] {
  const base: ActionKind[] = ["slam", "sweep", "spores"];
  if (st.phase === 1) return base;
  if (st.phase === 2) return tentacleReady ? ["tentacles"] : base;
  // 第3段階：根渡り（15秒ごと）・暴走
  if (rootReady) return ["rootwalk"];
  return ["rampage", "rampage", "slam", "sweep", "spores"];
}

function randomNear(center: Vec2, radius: number, rng: Rng): Vec2 {
  const a = rng.next() * Math.PI * 2;
  const r = Math.sqrt(rng.next()) * radius;
  return { x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r };
}

function beginWindup(
  enemy: Enemy,
  st: MotherTreeState,
  act: Action,
  target: Target,
  rng: Rng,
  events: EnemyEvent[],
  abyss: boolean,
  continued = false,
): void {
  const def = attackOf(enemy, act.kind);
  const at: { pos: Vec2; radius: number }[] = [];
  switch (act.kind) {
    case "slam":
      at.push({ pos: { x: target.pos.x, y: target.pos.y }, radius: def.ground?.radius ?? 3 });
      // 第2段階から、根の叩きつけが2連続になる
      if (!continued && st.phase >= 2) act.repeatsLeft = 1;
      break;
    case "rampage":
      at.push({ pos: { x: target.pos.x, y: target.pos.y }, radius: def.ground?.radius ?? 2.5 });
      if (!continued) act.repeatsLeft = 2; // 3連続
      break;
    case "spores":
      for (let i = 0; i < 3; i++)
        at.push({ pos: randomNear(target.pos, 6, rng), radius: def.cloud?.radius ?? 2.5 });
      // 深淵：第2段階から、毒の胞子が2回連続になる
      if (!continued && abyss && st.phase >= 2) act.repeatsLeft = 1;
      break;
    case "rootwalk": {
      const cfg = enemy.def.script;
      const center = enemy.spawn;
      const points = (cfg?.rootPoints ?? []).map((p) => ({ x: center.x + p.x, y: center.y + p.y }));
      // 今いる所から遠い地点を選ぶ
      points.sort((a, b) => dist(b, enemy.body.pos) - dist(a, enemy.body.pos));
      st.rootFrom = { ...enemy.body.pos };
      st.rootTo = points[rng.int(0, Math.min(1, points.length - 1))] ?? { ...center };
      break;
    }
    default:
      break;
  }
  act.at = at;
  events.push({
    type: "windup",
    enemy,
    attack: def,
    angle: enemy.body.facing,
    ...(at.length > 0 ? { at } : {}),
  });
}

function resolveActive(
  enemy: Enemy,
  st: MotherTreeState,
  act: Action,
  def: EnemyAttackDef,
  target: Target,
  std: number,
  accuracy: number,
  events: EnemyEvent[],
): void {
  const body = enemy.body;
  const damage = std * def.damageRatio;
  switch (act.kind) {
    case "slam":
    case "rampage": {
      const zone = act.at[0];
      if (
        zone &&
        !target.invulnerable &&
        dist(zone.pos, target.pos) <= zone.radius + target.radius
      ) {
        events.push({ type: "hit", enemy, attack: def, damage, accuracy });
      }
      // 暴走：叩いた場所に毒だまりが残る
      if (act.kind === "rampage" && zone && def.cloud) {
        events.push({ type: "cloud", enemy, attack: def, pos: zone.pos, damage: std * 0.03 });
      }
      break;
    }
    case "sweep":
      if (
        !target.invulnerable &&
        shapeHits(def.shape, body.pos, body.facing, { pos: target.pos, radius: target.radius })
      ) {
        events.push({ type: "hit", enemy, attack: def, damage, accuracy });
      }
      break;
    case "spores":
      for (const z of act.at)
        events.push({ type: "cloud", enemy, attack: def, pos: z.pos, damage: std * 0.03 });
      break;
    case "tentacles":
      events.push({ type: "summon", enemy, attack: def });
      st.tentacleCd = TENTACLE_INTERVAL;
      break;
    default:
      break;
  }
}
