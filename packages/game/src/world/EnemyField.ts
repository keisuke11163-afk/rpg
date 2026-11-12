// 仮実装: U-18a feature/town-and-dungeon-base で、地域の群れの出現地点（補助仕様書9.3）に置き換える（試験用の敵の配置）
import {
  type AilmentApplication,
  type Bounds,
  type Combatant,
  type ContentDb,
  ENEMY_RULES,
  Enemy,
  type EnemyAttackDef,
  EnemyAttackers,
  type EnemyRank,
  type EnemyTarget,
  type EnemyUpdatePlan,
  type HitReport,
  ProjectilePool,
  type ProjectileTarget,
  type Rng,
  type Vec2,
  length,
  overlapsShape,
  resolveHit,
  separate,
} from "@stella/core";

/** 試験用の群れ。 */
export interface SpawnGroup {
  readonly id: string;
  readonly enemy: string;
  readonly level: number;
  readonly count: number;
  readonly at: Vec2;
  /** 群れの中で、魔法・精鋭にする体（先頭から）。 */
  readonly ranks?: readonly EnemyRank[];
}

/** 試験用の場に置く群れ（補助仕様書9.2のA1〜A4の敵を、1種類ずつ）。 */
export const TEST_GROUPS: readonly SpawnGroup[] = [
  {
    id: "wolves",
    enemy: "ENM-FOREST-WOLF",
    level: 2,
    count: 3,
    at: { x: 56, y: 9 },
    ranks: ["magic"],
  },
  { id: "rats", enemy: "ENM-THORN-RAT", level: 1, count: 5, at: { x: 56, y: 31 } },
  { id: "lizards", enemy: "ENM-SPINE-LIZARD", level: 3, count: 2, at: { x: 72, y: 8 } },
  {
    id: "boar",
    enemy: "ENM-TUSK-BOAR",
    level: 4,
    count: 1,
    at: { x: 72, y: 20 },
    ranks: ["elite"],
  },
  { id: "bear", enemy: "ENM-BARK-BEAR", level: 5, count: 1, at: { x: 72, y: 32 } },
  { id: "saplings", enemy: "ENM-ROT-SAPLING", level: 3, count: 2, at: { x: 44, y: 33 } },
];

/** 群れが全て倒れてから、もう一度出るまでの秒数（試験用）。 */
const RESPAWN_SECONDS = 8;
/** 倒れた敵を消すまでの秒数。 */
const CORPSE_SECONDS = 0.6;

/** 胞子の雲（中にいると、間隔ごとに状態異常を1つ受ける）。 */
export interface Cloud {
  readonly center: Vec2;
  readonly radius: number;
  readonly interval: number;
  readonly application: AilmentApplication;
  remaining: number;
  untilNext: number;
}

/** 場に出ている敵1体（倒れてから消えるまでを含む）。 */
export interface FieldEnemy {
  readonly enemy: Enemy;
  readonly group: string;
  deadFor: number;
  /** この攻撃で、すでに当たった group（突進）。 */
  readonly hitGroups: Set<string>;
}

/** 敵の攻撃を受けたときに、場面に知らせること。 */
export interface FieldHooks {
  onPlayerHit(report: HitReport, enemy: Enemy, attack: EnemyAttackDef): void;
  onAvoided(enemy: Enemy, attack: EnemyAttackDef): void;
  /** 敵が倒れた（経験値を得る）。1体につき1回だけ、場の更新を全て反映した後に呼ぶ。 */
  onEnemyKilled(enemy: Enemy): void;
}

/**
 * 試験用の場の敵：出現・行動・攻撃の処理（Phaser に依存しない。表示は EnemyFieldView）。
 */
export class EnemyField {
  private readonly db: ContentDb;
  private readonly rng: Rng;
  private readonly bounds: Bounds;
  private readonly attackers: EnemyAttackers;
  private views: FieldEnemy[] = [];
  private readonly cloudList: Cloud[] = [];
  private readonly respawn = new Map<string, number>();
  readonly projectiles = new ProjectilePool<{ enemy: Enemy; attack: EnemyAttackDef }>(64);
  private serial = 0;
  kills = 0;

  constructor(db: ContentDb, rng: Rng, bounds: Bounds) {
    this.db = db;
    this.rng = rng;
    this.bounds = bounds;
    this.attackers = new EnemyAttackers(db);
    for (const g of TEST_GROUPS) this.spawnGroup(g);
  }

  /** 場に出ている敵（倒れてから消えるまでを含む）。 */
  get entries(): readonly FieldEnemy[] {
    return this.views;
  }

  /** 胞子の雲。 */
  get clouds(): readonly Cloud[] {
    return this.cloudList;
  }

  get enemies(): readonly Enemy[] {
    return this.views.map((v) => v.enemy);
  }

  /** 生きている敵の、戦う者（プレイヤーの技の対象）。 */
  targets(): Combatant[] {
    return this.views.filter((v) => v.enemy.state !== "dead").map((v) => v.enemy.combatant);
  }

  byCombatant(c: Combatant): Enemy | undefined {
    return this.views.find((v) => v.enemy.combatant === c)?.enemy;
  }

  get cloudCount(): number {
    return this.cloudList.length;
  }

  private spawnGroup(g: SpawnGroup): void {
    for (let i = 0; i < g.count; i++) {
      const a = (i / Math.max(1, g.count)) * 2 * Math.PI;
      const r = g.count > 1 ? 1.2 : 0;
      this.spawn(
        g.enemy,
        g.ranks?.[i] ?? "normal",
        g.level,
        {
          x: g.at.x + Math.cos(a) * r,
          y: g.at.y + Math.sin(a) * r,
        },
        g.id,
        i,
      );
    }
  }

  /** 敵を1体出す（確認用にも使う）。 */
  spawn(
    enemyId: string,
    rankKey: EnemyRank,
    level: number,
    at: Vec2,
    group: string,
    index = 0,
  ): Enemy {
    const def = this.db.enemies.get(enemyId);
    const rank = this.db.enemyRanks.get(rankKey);
    if (def === undefined || rank === undefined)
      throw new Error(`敵 ${enemyId}・格 ${rankKey} がない`);
    this.serial += 1;
    const enemy = new Enemy(this.db, {
      id: `${enemyId}#${String(this.serial)}`,
      def,
      rank,
      level,
      position: at,
      packId: group,
      packIndex: index,
      facing: Math.PI,
    });
    this.views.push({ enemy, group, deadFor: 0, hitGroups: new Set() });
    return enemy;
  }

  /** 気づいた敵の、同じ群れの仲間（10m以内）も気づく（補助仕様書10.2）。 */
  alertPack(source: Enemy): void {
    for (const v of this.views) {
      const e = v.enemy;
      if (e === source || e.packId !== source.packId) continue;
      if (
        length({ x: e.position.x - source.position.x, y: e.position.y - source.position.y }) <=
        ENEMY_RULES.alertRadius
      )
        e.notice();
    }
  }

  /** プレイヤーの攻撃を受けた敵は気づき、仲間にも知らせる。 */
  onEnemyHit(c: Combatant): void {
    const e = this.byCombatant(c);
    if (e === undefined) return;
    if (e.notice()) this.alertPack(e);
  }

  /**
   * 1刻み進める：敵の行動・攻撃、投射物、胞子の雲、倒れた敵を消す・群れをもう一度出す。
   *
   * 例外安全：次の3段階で進め、場（敵・投射物・雲・倒れてからの時間・もう一度出すまでの時間・
   * 倒した数・突進の当たった記録・乱数）が中途半端に変わった状態を残さない。
   * 1. 計画と検証（場もプレイヤーも変えない）：経過時間、全ての敵の更新の計画（Enemy.planUpdate：
   *    状態の経過時間の累計・移動後の位置・持続ダメージ・HP・崩しゲージの計算）、倒れてからの時間、
   *    雲の残り時間・次に状態異常を付けるまでの時間、もう一度出すまでの時間、倒した数、
   *    投射物の更新（相手の位置・半径の合計）と、敵が出しうる投射物・雲の値を検証する。
   *    どれかが失敗すれば RangeError で、何も変わらない（後ろの敵の失敗で前の敵が進むことはない）。
   * 2. 場の反映：検証済みの計画と値だけを使い、例外は起きない。
   *    この刻みで倒れる敵（まだ倒れた状態でなく、計画の HP が0以下）も、ここで決める。
   * 3. プレイヤーへの影響：場を全て反映し終えてから、攻撃のヒット（resolveHit と hooks）・敵が倒れたこと
   *    （hooks.onEnemyKilled。経験値）・雲の状態異常を、起きた順（敵の順の攻撃と倒れたこと → 投射物 → 雲）に
   *    プレイヤーへ与える。段階1で失敗すれば、onEnemyKilled も呼ばれない（経験値も入らない）。ここ（プレイヤーの計算や hooks）で
   *    例外になった場合も、場はこの刻みを全て終えた状態で、それより後のプレイヤーへの影響だけが与えられない。
   *
   * 敵の行動はプレイヤーの状態を刻みの始めの値（target）でしか見ないので、プレイヤーへの影響を後に回しても
   * 敵の動きは変わらない。ただし乱数を使う順番（敵の行動 → ヒットの計算）は変わる。
   */
  update(
    dt: number,
    player: Combatant,
    invulnerable: boolean,
    facing: number,
    hooks: FieldHooks,
  ): void {
    const plan = this.plan(dt, player);
    const effects = this.commit(plan, player, facing);
    try {
      this.applyToPlayer(effects, player, invulnerable, hooks);
    } finally {
      // 倒れた・消えた敵の、攻撃の命中の評価を消す（倒れた敵の投射物が段階3で当たって作った分も含む）
      this.attackers.retain(this.enemies);
    }
  }

  /** 攻撃の命中の評価を残している敵の ID（確認用）。 */
  cachedStatusViews(): readonly string[] {
    return this.attackers.cachedStatusViews();
  }

  /** 1. 計画と検証（場もプレイヤーも変えない）。 */
  private plan(dt: number, player: Combatant): FieldPlan {
    if (!(Number.isFinite(dt) && dt >= 0))
      throw new RangeError(`経過時間は有限かつ0以上（${String(dt)}）`);
    // 投射物：相手（プレイヤー）の位置・半径と、今ある投射物の半径との合計
    this.projectiles.checkUpdate(dt, [playerTarget(player)]);
    // 敵：更新の計画（後ろの敵で失敗しても、前の敵はまだ何も変わっていない）
    const enemies = this.views.map((v) => {
      const enemy = v.enemy.planUpdate(dt);
      const deadFor = requireFinite(v.deadFor + dt, `敵 ${v.enemy.id} の倒れてからの時間`);
      checkAttacks(v.enemy, player);
      // この刻みで倒れるか（倒れた状態になるのは、計画の HP が0以下のときだけ。Enemy.commitUpdate を参照）
      const killed = v.enemy.state !== "dead" && enemy.combatant.health.hp <= 0;
      return { enemy, deadFor, killed };
    });
    // 胞子の雲：残り時間と、次に状態異常を付けるまでの時間
    const clouds = this.cloudList.map((c) => {
      const remaining = requireFinite(c.remaining - dt, "雲の残り時間");
      let untilNext = requireFinite(c.untilNext - dt, "雲の次に状態異常を付けるまでの時間");
      const tick = untilNext <= 1e-9;
      if (tick)
        untilNext = requireFinite(untilNext + c.interval, "雲の次に状態異常を付けるまでの時間");
      return { remaining, untilNext, tick };
    });
    // もう一度出すまでの時間（この刻みで群れが全て倒れる場合は 0 + dt で、dt は検証済み）
    for (const [id, t] of this.respawn)
      requireFinite(t + dt, `群れ ${id} をもう一度出すまでの時間`);
    if (!Number.isSafeInteger(this.kills + this.views.length))
      throw new RangeError(`倒した数が安全な整数でなくなる（${String(this.kills)}）`);
    return { dt, enemies, clouds };
  }

  /** 2. 場の反映（検証済みの値だけを使い、例外は起きない）。プレイヤーへの影響を、起きた順に返す。 */
  private commit(plan: FieldPlan, player: Combatant, facing: number): PlayerEffect[] {
    const { dt } = plan;
    const effects: PlayerEffect[] = [];
    const target: EnemyTarget = {
      position: player.position,
      radius: player.radius,
      facing,
      targetable: !player.health.dead,
    };
    const views = this.views;
    const existingClouds = this.cloudList.length;
    views.forEach((v, i) => {
      const p = plan.enemies[i];
      if (p === undefined) return; // 計画は views と同じ数（ここには来ない）
      const e = v.enemy;
      if (e.state === "windup") v.hitGroups.clear();
      for (const ev of e.commitUpdate(p.enemy, target, this.rng, this.bounds)) {
        switch (ev.type) {
          case "noticed":
            this.alertPack(e);
            break;
          case "strike":
            if (!overlapsShape(ev.shape, ev.origin, ev.facing, player.position, player.radius))
              break;
            if (ev.group !== undefined) {
              if (v.hitGroups.has(ev.group)) break;
              v.hitGroups.add(ev.group);
            }
            effects.push({ type: "hit", enemy: e, attack: ev.attack });
            break;
          case "projectile":
            this.projectiles.spawn({
              position: ev.origin,
              direction: ev.direction,
              speed: ev.speed,
              range: ev.range,
              radius: ev.radius,
              pierce: 0,
              team: "enemy",
              payload: { enemy: e, attack: ev.attack },
            });
            break;
          case "cloud":
            this.cloudList.push({
              center: ev.center,
              radius: ev.radius,
              interval: ev.interval,
              application: ev.application,
              remaining: ev.duration,
              untilNext: 0,
            });
            break;
          case "returned":
            break;
        }
      }
      if (e.state === "dead") v.deadFor = p.deadFor;
      if (p.killed) effects.push({ type: "killed", enemy: e });
    });
    separate(this.enemies);

    for (const hit of this.projectiles.update(dt, [playerTarget(player)]))
      effects.push({ type: "hit", enemy: hit.payload.enemy, attack: hit.payload.attack });

    // 胞子の雲：中にいると、間隔ごとに毒を1つ受ける（回避の無敵時間でも受ける。攻撃ではないため）
    // 今ある雲は計画の値を、この刻みに出た雲は検証済みのデータと dt から計算した値を使う
    const ailments: AilmentApplication[] = [];
    for (let i = this.cloudList.length - 1; i >= 0; i--) {
      const c = this.cloudList[i];
      if (c === undefined) continue;
      const next =
        i < existingClouds
          ? plan.clouds[i]
          : (() => {
              const untilNext = -dt;
              const tick = untilNext <= 1e-9;
              return {
                remaining: c.remaining - dt,
                untilNext: tick ? untilNext + c.interval : untilNext,
                tick,
              };
            })();
      if (next === undefined) continue; // 計画は今ある雲と同じ数（ここには来ない）
      c.remaining = next.remaining;
      c.untilNext = next.untilNext;
      if (
        next.tick &&
        length({ x: player.position.x - c.center.x, y: player.position.y - c.center.y }) <=
          c.radius + player.radius
      )
        ailments.push(c.application);
      if (c.remaining <= 1e-9) this.cloudList.splice(i, 1);
    }
    for (const application of ailments) effects.push({ type: "ailment", application });

    // 倒れた敵を消し、群れが全て倒れたら、しばらくしてからもう一度出す（試験用）
    this.kills += this.views.filter((v) => v.deadFor >= CORPSE_SECONDS).length;
    this.views = this.views.filter((v) => v.deadFor < CORPSE_SECONDS);
    for (const g of TEST_GROUPS) {
      const alive = this.views.some((v) => v.group === g.id);
      if (alive) {
        this.respawn.delete(g.id);
        continue;
      }
      const t = (this.respawn.get(g.id) ?? 0) + dt;
      if (t >= RESPAWN_SECONDS) {
        this.respawn.delete(g.id);
        // 作るときと同じデータ（場を作るときに一度作れている）なので、例外は起きない
        this.spawnGroup(g);
      } else this.respawn.set(g.id, t);
    }
    return effects;
  }

  /** 3. プレイヤーへの影響（場を全て反映した後）。 */
  private applyToPlayer(
    effects: readonly PlayerEffect[],
    player: Combatant,
    invulnerable: boolean,
    hooks: FieldHooks,
  ): void {
    for (const ef of effects) {
      if (ef.type === "ailment") {
        player.ailments.apply(ef.application);
        continue;
      }
      if (ef.type === "killed") {
        hooks.onEnemyKilled(ef.enemy);
        continue;
      }
      if (invulnerable) {
        hooks.onAvoided(ef.enemy, ef.attack);
        continue;
      }
      const report = resolveHit({
        db: this.db,
        attacker: this.attackers.attacker(ef.enemy, ef.attack),
        attackerPosition: ef.enemy.position,
        skill: { tags: [], kind: "weapon", pct: 1 },
        ...(ef.attack.ailmentChance === undefined ? {} : { skillChance: ef.attack.ailmentChance }),
        staggerCoefficient: ef.attack.staggerCoefficient,
        target: player,
        rng: this.rng,
      });
      hooks.onPlayerHit(report, ef.enemy, ef.attack);
    }
  }

  /** もう一度出すまでの時間（群れ → 秒。確認用）。 */
  respawnTimers(): ReadonlyMap<string, number> {
    return new Map(this.respawn);
  }

  /** 確認用の状態。 */
  debug(): unknown[] {
    return this.views.map((v) => ({
      id: v.enemy.id,
      def: v.enemy.def.id,
      group: v.group,
      rank: v.enemy.rank.rank,
      state: v.enemy.state,
      attack: v.enemy.currentAttack?.id ?? null,
      x: v.enemy.position.x,
      y: v.enemy.position.y,
      hp: v.enemy.combatant.health.hp,
      maxHp: v.enemy.combatant.health.maxHp,
    }));
  }
}

/** EnemyField.update の計画（検証済みの次の値）。 */
interface FieldPlan {
  readonly dt: number;
  /** views と同じ順。 */
  readonly enemies: readonly {
    readonly enemy: EnemyUpdatePlan;
    readonly deadFor: number;
    /** この刻みで倒れる（hooks.onEnemyKilled を1回呼ぶ）。 */
    readonly killed: boolean;
  }[];
  /** cloudList と同じ順（この刻みの前からある雲）。 */
  readonly clouds: readonly {
    readonly remaining: number;
    readonly untilNext: number;
    readonly tick: boolean;
  }[];
}

/** 場を反映した後に、プレイヤーへ与えるもの。 */
type PlayerEffect =
  | { readonly type: "hit"; readonly enemy: Enemy; readonly attack: EnemyAttackDef }
  | { readonly type: "killed"; readonly enemy: Enemy }
  | { readonly type: "ailment"; readonly application: AilmentApplication };

function playerTarget(player: Combatant): ProjectileTarget {
  return { id: "player", team: "player", position: player.position, radius: player.radius };
}

function requireFinite(value: number, what: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${what}が有限の数でない（${String(value)}）`);
  return value;
}

/**
 * 敵が出しうる投射物・雲の値を検証する（反映の途中で ProjectilePool.spawn・ProjectilePool.update が
 * 例外を起こさないように）：速さ・射程・半径・時間が0以上の有限の数で、半径とプレイヤーの半径の合計が有限。
 */
function checkAttacks(enemy: Enemy, player: Combatant): void {
  for (const a of enemy.def.attacks) {
    const d = a.delivery;
    const values =
      d.type === "projectile"
        ? [d.speed, d.range, d.radius, d.radius + player.radius]
        : d.type === "cloud"
          ? [d.radius, d.duration, d.interval, d.radius + player.radius]
          : [];
    for (const v of values)
      if (!(Number.isFinite(v) && v >= 0))
        throw new RangeError(
          `敵 ${enemy.id} の攻撃 ${a.id} の値が0以上の有限の数でない（${String(v)}）`,
        );
  }
}
