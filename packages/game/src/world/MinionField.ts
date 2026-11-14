import {
  type Bounds,
  type Combatant,
  type ContentDb,
  type HitReport,
  type Minion,
  type MinionDef,
  MinionSquad,
  ProjectilePool,
  type ProjectileTarget,
  type Rng,
  type Vec2,
  resolveMinionHit,
} from "@stella/core";

/**
 * 召喚物の動き（召喚士。仕様書v0.2 5.5）。Phaser に依存しない（表示は ArenaScene）。
 * 仮値: 戻る距離12m・移す距離25m・並ぶ半径1.6m・止まる距離0.4m・追いつく倍率1.5・火球の射程+1m は仕様書に無い（docs/progress D-SUM-3）
 */
export const MINION_AI = {
  /** 持ち主からこれ以上離れたら、敵を捨てて持ち主の所へ戻る（m）。 */
  leash: 12,
  /** これ以上離れたら、持ち主の隣へ移す（地域の出入り・回避で置いていかれたとき。m）。 */
  warp: 25,
  /** 敵がいないとき、持ち主の周りのこの半径に並ぶ（m）。 */
  followRadius: 1.6,
  /** 並ぶ位置からこれ以内なら止まる（m）。 */
  arrive: 0.4,
  /** 持ち主から遠いとき（leash の半分より遠い）の移動の速さの倍率。 */
  catchUp: 1.5,
} as const;

/** 指揮・集中（照準の近くの敵を、全ての召喚物が狙う。その敵への召喚物のダメージ+20%）。 */
export interface MinionCommand {
  readonly target: Combatant;
  readonly until: number;
  readonly damageBonus: number;
}

/** 召喚物の動きに渡すもの（毎刻み）。 */
export interface MinionContext {
  readonly db: ContentDb;
  readonly rng: Rng;
  readonly now: number;
  /** 持ち主（プレイヤー）のキャラLv・位置。 */
  readonly characterLevel: number;
  readonly owner: Vec2;
  /** 狙える敵（生きていて、地中にいない）。 */
  readonly enemies: readonly Combatant[];
  /** 持ち主の「召喚物のダメージ+%」（笏の基本刻印など。加算）。 */
  readonly minionDamage: number;
  readonly command: MinionCommand | undefined;
  readonly bounds?: Bounds | undefined;
  /** 召喚物のヒットが敵に当たった（敵が気づく・表示）。 */
  onHit(report: HitReport, target: Combatant, minion: MinionDef): void;
}

interface Bolt {
  readonly minion: Minion;
}

/** 呼び出している召喚物と、その動き・攻撃（炎霊の火球を含む）。 */
export class MinionField {
  readonly squad: MinionSquad;
  readonly bolts = new ProjectilePool<Bolt>(32);
  /** 召喚物のヒットの数（確認用）。 */
  hits = 0;
  /** 召喚物が与えたダメージの合計（確認用）。 */
  damageDealt = 0;

  constructor(capacity: number) {
    this.squad = new MinionSquad(capacity);
  }

  get minions(): readonly Minion[] {
    return this.squad.minions;
  }

  /** 召喚物の戦う者（敵の標的・当たり判定に渡す）。 */
  combatants(): Combatant[] {
    return this.squad.minions.filter((m) => !m.dead).map((m) => m.combatant);
  }

  /** 全て消す（転職・倒れた・地域を移った）。飛んでいる火球も消える。 */
  clear(): void {
    this.squad.clear();
    this.bolts.clear();
  }

  /**
   * 1刻み進める：狙う敵を決め、近づいて攻撃する。敵がいなければ持ち主に付いて行く。
   * 倒された召喚物は最後に取り除き（枠が戻る）、その一覧を返す。
   */
  update(dt: number, ctx: MinionContext): Minion[] {
    const live = ctx.enemies.filter((e) => !e.health.dead);
    const command =
      ctx.command !== undefined &&
      ctx.now < ctx.command.until &&
      !ctx.command.target.health.dead &&
      live.includes(ctx.command.target)
        ? ctx.command
        : undefined;
    this.squad.minions.forEach((m, index) => {
      if (m.dead) return;
      m.attackCooldown = Math.max(0, m.attackCooldown - dt);
      // 崩されている間は動けない
      if (m.combatant.stagger.broken) return;
      const fromOwner = dist(m.position, ctx.owner);
      if (fromOwner > MINION_AI.warp) {
        m.position = clamp(around(ctx.owner, index, MINION_AI.followRadius), ctx.bounds);
        return;
      }
      const target =
        fromOwner > MINION_AI.leash
          ? undefined
          : (command?.target ?? nearest(m.position, live, m.def.sightRange));
      if (target === undefined) {
        const goal = around(ctx.owner, index, MINION_AI.followRadius);
        const fast = fromOwner > MINION_AI.leash / 2 ? MINION_AI.catchUp : 1;
        this.moveTowards(m, goal, m.def.moveSpeed * fast * dt, MINION_AI.arrive, ctx.bounds);
        return;
      }
      const gap = dist(m.position, target.position) - m.def.radius - target.radius;
      m.facing = Math.atan2(target.position.y - m.position.y, target.position.x - m.position.x);
      m.combatant.facing = m.facing;
      if (gap > m.def.attack.range) {
        this.moveTowards(m, target.position, m.def.moveSpeed * dt, 0, ctx.bounds);
        return;
      }
      if (m.attackCooldown > 0) return;
      m.attackCooldown = m.def.attack.interval;
      const p = m.def.attack.projectile;
      if (p === undefined) {
        this.strike(m, target, ctx, command);
        return;
      }
      this.bolts.spawn({
        position: m.position,
        direction: { x: Math.cos(m.facing), y: Math.sin(m.facing) },
        speed: p.speed,
        range: m.def.attack.range + m.def.radius + target.radius + 1,
        radius: p.radius,
        pierce: 0,
        team: "player",
        payload: { minion: m },
      });
    });
    // 火球
    const targets: ProjectileTarget[] = live.map((e) => ({
      id: e.id,
      team: e.team,
      position: e.position,
      radius: e.radius,
    }));
    for (const hit of this.bolts.update(dt, targets)) {
      const t = live.find((e) => e.id === hit.targetId);
      if (t !== undefined) this.strike(hit.payload.minion, t, ctx, command);
    }
    return this.squad.removeDead();
  }

  /**
   * 召喚物の攻撃（または魂の供儀の爆発）を1体に当てる。持ち主の召喚物ダメージ＋指揮の対象なら+20%（加算）。
   */
  strike(
    m: Minion,
    target: Combatant,
    ctx: MinionContext,
    command: MinionCommand | undefined,
    pct = 1,
  ): HitReport {
    const bonus = command !== undefined && command.target === target ? command.damageBonus : 0;
    const report = resolveMinionHit({
      db: ctx.db,
      minion: m,
      target,
      rng: ctx.rng,
      characterLevel: ctx.characterLevel,
      extraIncreased: ctx.minionDamage + bonus,
      pct,
    });
    this.hits += 1;
    this.damageDealt += report.applied.toHp + report.applied.toWard;
    ctx.onHit(report, target, m.def);
    return report;
  }

  private moveTowards(
    m: Minion,
    goal: Vec2,
    step: number,
    stopAt: number,
    bounds: Bounds | undefined,
  ): void {
    const dx = goal.x - m.position.x;
    const dy = goal.y - m.position.y;
    const d = Math.hypot(dx, dy);
    if (d <= stopAt || d < 1e-9) return;
    const k = Math.min(step, d - stopAt) / d;
    m.facing = Math.atan2(dy, dx);
    m.combatant.facing = m.facing;
    m.position = clamp({ x: m.position.x + dx * k, y: m.position.y + dy * k }, bounds);
    m.combatant.moving = true;
  }
}

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** 位置を場の範囲に収める（範囲が無ければそのまま）。 */
function clamp(p: Vec2, bounds: Bounds | undefined): Vec2 {
  if (bounds === undefined) return p;
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, p.x)),
    y: Math.min(bounds.maxY, Math.max(bounds.minY, p.y)),
  };
}

/** 持ち主の周りの、召喚物ごとの位置（番号で角度をずらす）。 */
function around(owner: Vec2, index: number, radius: number): Vec2 {
  const a = Math.PI * 0.75 + index * 1.1;
  return { x: owner.x + Math.cos(a) * radius, y: owner.y + Math.sin(a) * radius };
}

/** 位置から range 以内（体の端まで）の、最も近い敵。 */
function nearest(at: Vec2, enemies: readonly Combatant[], range: number): Combatant | undefined {
  let best: Combatant | undefined;
  let bestD = Infinity;
  for (const e of enemies) {
    const d = dist(at, e.position) - e.radius;
    if (d <= range && d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}
