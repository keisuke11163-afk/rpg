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
  type HitReport,
  ProjectilePool,
  type Rng,
  type Vec2,
  length,
  overlapsShape,
  resolveHit,
  separate,
} from "@stella/core";

/** 群れ（地域の配置〔補助仕様書9.3〕か、開発用の試験用の場の群れ）。 */
export interface SpawnGroup {
  readonly id: string;
  readonly enemy: string;
  readonly level: number;
  readonly count: number;
  readonly at: Vec2;
  /** 群れの中で、魔法・精鋭にする体（先頭から）。 */
  readonly ranks?: readonly EnemyRank[];
  /** 根渡りで現れる地点（ボス）。 */
  readonly anchors?: readonly Vec2[];
}

/** 開発用の試験用の場に置く群れ（補助仕様書9.2のA1〜A4の敵を、1種類ずつ）。 */
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

/** 群れが全て倒れてから、もう一度出るまでの秒数（開発用の試験用の場だけ。地域では、入り直すまで出ない）。 */
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
  /** 敵が倒れた（経験値を得る）。 */
  onEnemyKilled(enemy: Enemy): void;
  /** ボスの段階が変わった・根渡りで潜った・現れた（表示用。省略できる）。 */
  onBossEvent?(enemy: Enemy, event: "phase" | "burrow" | "surface", phase: number): void;
}

/**
 * 場の敵：出現・行動・攻撃の処理（Phaser に依存しない。表示は EnemyFieldView）。
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
  private readonly respawns: boolean;
  kills = 0;

  /**
   * @param groups 出す群れ（省略すると開発用の試験用の場の群れ）
   * @param respawns 群れが全て倒れたら、しばらくして出し直すか（開発用の試験用の場だけ）
   */
  constructor(
    db: ContentDb,
    rng: Rng,
    bounds: Bounds,
    groups: readonly SpawnGroup[] = TEST_GROUPS,
    respawns = true,
  ) {
    this.db = db;
    this.rng = rng;
    this.bounds = bounds;
    this.respawns = respawns;
    this.attackers = new EnemyAttackers(db);
    for (const g of groups) this.spawnGroup(g);
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

  /** 生きている敵の、戦う者（プレイヤーの技の対象。根渡りで地中にいるボスは除く）。 */
  targets(): Combatant[] {
    return this.views.filter((v) => v.enemy.targetable).map((v) => v.enemy.combatant);
  }

  byCombatant(c: Combatant): Enemy | undefined {
    return this.views.find((v) => v.enemy.combatant === c)?.enemy;
  }

  get cloudCount(): number {
    return this.cloudList.length;
  }

  /** 群れを出す。出した敵の id を返す。 */
  private spawnGroup(g: SpawnGroup): string[] {
    const out: string[] = [];
    for (let i = 0; i < g.count; i++) {
      const a = (i / Math.max(1, g.count)) * 2 * Math.PI;
      const r = g.count > 1 ? 1.2 : 0;
      const e = this.spawn(
        g.enemy,
        g.ranks?.[i] ?? "normal",
        g.level,
        {
          x: g.at.x + Math.cos(a) * r,
          y: g.at.y + Math.sin(a) * r,
        },
        g.id,
        i,
        g.anchors,
      );
      out.push(e.id);
    }
    return out;
  }

  /** 敵を1体出す（確認用にも使う）。 */
  spawn(
    enemyId: string,
    rankKey: EnemyRank,
    level: number,
    at: Vec2,
    group: string,
    index = 0,
    anchors?: readonly Vec2[],
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
      ...(anchors === undefined ? {} : { anchors }),
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

  update(
    dt: number,
    player: Combatant,
    invulnerable: boolean,
    facing: number,
    hooks: FieldHooks,
  ): void {
    const target: EnemyTarget = {
      position: player.position,
      radius: player.radius,
      facing,
      targetable: !player.health.dead,
    };
    const hitPlayer = (enemy: Enemy, attack: EnemyAttackDef): void => {
      if (invulnerable) {
        hooks.onAvoided(enemy, attack);
        return;
      }
      const report = resolveHit({
        db: this.db,
        attacker: this.attackers.attacker(enemy, attack),
        attackerPosition: enemy.position,
        skill: { tags: [], kind: "weapon", pct: 1 },
        ...(attack.ailmentChance === undefined ? {} : { skillChance: attack.ailmentChance }),
        staggerCoefficient: attack.staggerCoefficient,
        target: player,
        rng: this.rng,
      });
      hooks.onPlayerHit(report, enemy, attack);
    };

    for (const v of this.views) {
      const e = v.enemy;
      const wasDead = e.state === "dead";
      if (e.state === "windup") v.hitGroups.clear();
      for (const ev of e.update(dt, target, this.rng, this.bounds)) {
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
            hitPlayer(e, ev.attack);
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
          case "summon": {
            // 仲間を呼ぶ（呼んだ敵と同じLv）。呼んだ仲間と、周りの同じ種類の敵の攻撃速度を上げる
            const id = `summon-${String(++this.serial)}`;
            const ids = this.spawnGroup({
              id,
              enemy: ev.enemy,
              level: e.level,
              count: ev.count,
              at: {
                x: ev.origin.x + Math.cos(e.facing) * ev.radius,
                y: ev.origin.y + Math.sin(e.facing) * ev.radius,
              },
            });
            // 呼ばれた仲間は、すぐに気づいている
            for (const v2 of this.views) if (ids.includes(v2.enemy.id)) v2.enemy.notice();
            const haste = ev.haste;
            if (haste !== undefined)
              for (const other of this.views) {
                const o = other.enemy;
                if (o.state === "dead" || o.def.id !== ev.enemy) continue;
                const near =
                  Math.hypot(o.position.x - ev.origin.x, o.position.y - ev.origin.y) <=
                  haste.radius;
                if (near || ids.includes(o.id)) o.hasten(haste.increase, haste.duration);
              }
            break;
          }
          case "returned":
            break;
          case "phase":
            hooks.onBossEvent?.(e, "phase", ev.phase);
            break;
          case "burrow":
          case "surface":
            hooks.onBossEvent?.(e, ev.type, e.phase);
            break;
        }
      }
      if (e.state === "dead") {
        if (!wasDead) hooks.onEnemyKilled(e);
        v.deadFor += dt;
      }
    }
    separate(this.enemies);

    for (const hit of this.projectiles.update(dt, [
      { id: "player", team: "player", position: player.position, radius: player.radius },
    ])) {
      hitPlayer(hit.payload.enemy, hit.payload.attack);
    }

    // 胞子の雲：中にいると、間隔ごとに毒を1つ受ける（回避の無敵時間でも受ける。攻撃ではないため）
    for (let i = this.cloudList.length - 1; i >= 0; i--) {
      const c = this.cloudList[i];
      if (c === undefined) continue;
      c.remaining -= dt;
      c.untilNext -= dt;
      if (c.untilNext <= 1e-9) {
        c.untilNext += c.interval;
        if (
          length({ x: player.position.x - c.center.x, y: player.position.y - c.center.y }) <=
          c.radius + player.radius
        )
          player.ailments.apply(c.application);
      }
      if (c.remaining <= 1e-9) this.cloudList.splice(i, 1);
    }

    // 倒れた敵を消し、群れが全て倒れたら、しばらくしてからもう一度出す（開発用の試験用の場だけ）
    this.kills += this.views.filter((v) => v.deadFor >= CORPSE_SECONDS).length;
    this.views = this.views.filter((v) => v.deadFor < CORPSE_SECONDS);
    if (!this.respawns) return;
    for (const g of TEST_GROUPS) {
      const alive = this.views.some((v) => v.group === g.id);
      if (alive) {
        this.respawn.delete(g.id);
        continue;
      }
      const t = (this.respawn.get(g.id) ?? 0) + dt;
      if (t >= RESPAWN_SECONDS) {
        this.respawn.delete(g.id);
        this.spawnGroup(g);
      } else this.respawn.set(g.id, t);
    }
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
