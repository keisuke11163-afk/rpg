// 仮実装: U-18a feature/town-and-dungeon-base で、地域の群れの出現地点（補助仕様書9.3）に置き換える（試験用の敵の配置）
import Phaser from "phaser";
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
  type HitShape,
  ProjectilePool,
  type Rng,
  type Vec2,
  length,
  overlapsShape,
  resolveHit,
  separate,
} from "@stella/core";
import { text, type TextKey } from "@stella/content";
import { enemyTexture, TEXTURES } from "./placeholders.ts";
import { PIXELS_PER_METER, toPixels } from "./units.ts";

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

const RANK_COLOR: Readonly<Record<EnemyRank, string>> = {
  normal: "#e8e6f0",
  magic: "#6fa8ff",
  elite: "#ffd166",
};
const RANK_OUTLINE: Readonly<Record<EnemyRank, number | undefined>> = {
  normal: undefined,
  magic: 0x6fa8ff,
  elite: 0xffd166,
};

interface Cloud {
  readonly center: Vec2;
  readonly radius: number;
  readonly interval: number;
  readonly application: AilmentApplication;
  remaining: number;
  untilNext: number;
}

interface EnemyView {
  readonly enemy: Enemy;
  readonly group: string;
  readonly body: Phaser.GameObjects.Image;
  readonly facing: Phaser.GameObjects.Image | undefined;
  readonly label: Phaser.GameObjects.Text;
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
}

/** 試験用の場の敵：出現・行動・攻撃の処理・表示。 */
export class EnemyField {
  private readonly scene: Phaser.Scene;
  private readonly db: ContentDb;
  private readonly rng: Rng;
  private readonly bounds: Bounds;
  private readonly attackers: EnemyAttackers;
  private views: EnemyView[] = [];
  private readonly clouds: Cloud[] = [];
  private readonly respawn = new Map<string, number>();
  private readonly projectiles = new ProjectilePool<{ enemy: Enemy; attack: EnemyAttackDef }>(64);
  private readonly projectileImages: Phaser.GameObjects.Image[] = [];
  private serial = 0;
  kills = 0;

  constructor(scene: Phaser.Scene, db: ContentDb, rng: Rng, bounds: Bounds) {
    this.scene = scene;
    this.db = db;
    this.rng = rng;
    this.bounds = bounds;
    this.attackers = new EnemyAttackers(db);
    for (let i = 0; i < this.projectiles.capacity; i++)
      this.projectileImages.push(
        scene.add.image(0, 0, TEXTURES.projectile).setVisible(false).setTint(0x9fdf6f),
      );
    for (const g of TEST_GROUPS) this.spawnGroup(g);
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
    return this.clouds.length;
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
    const body = this.scene.add.image(0, 0, enemyTexture(enemyId)).setScale(rank.scale);
    const facing =
      def.turnRate === null
        ? undefined
        : this.scene.add
            .image(0, 0, TEXTURES.facing)
            .setOrigin(-0.4, 0.5)
            .setScale(0.7)
            .setTint(0xff6b6b);
    const label = this.scene.add
      .text(0, 0, `${text(def.text as TextKey)} Lv${String(level)}`, {
        fontFamily: "sans-serif",
        fontSize: "8px",
        color: RANK_COLOR[rank.rank],
      })
      .setOrigin(0.5, 1);
    this.views.push({ enemy, group, body, facing, label, deadFor: 0, hitGroups: new Set() });
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
            this.clouds.push({
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
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
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
      if (c.remaining <= 1e-9) this.clouds.splice(i, 1);
    }

    // 倒れた敵を消し、群れが全て倒れたら、しばらくしてからもう一度出す（試験用）
    const removed = this.views.filter((v) => v.deadFor >= CORPSE_SECONDS);
    for (const v of removed) {
      v.body.destroy();
      v.facing?.destroy();
      v.label.destroy();
      this.kills += 1;
    }
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
        this.spawnGroup(g);
      } else this.respawn.set(g.id, t);
    }
  }

  /** 予兆（地面の範囲）・雲・投射物・体・HPを描く。 */
  render(
    g: Phaser.GameObjects.Graphics,
    drawShape: (shape: HitShape, origin: Vec2, facing: number) => void,
  ): void {
    for (const c of this.clouds) {
      g.fillStyle(0x7bd389, 0.18).fillCircle(
        toPixels(c.center.x),
        toPixels(c.center.y),
        c.radius * PIXELS_PER_METER,
      );
    }
    for (const v of this.views) {
      const e = v.enemy;
      const a = e.currentAttack;
      // 予兆：地面に範囲を示す（溜めの間、だんだん濃くなる）
      if (a !== undefined && e.state === "windup") {
        const progress = Math.min(1, e.timeInState / Math.max(a.windup, 1e-6));
        g.fillStyle(0xff6b6b, 0.12 + 0.25 * progress);
        const d = a.delivery;
        switch (d.type) {
          case "strike":
            drawShape(d.shape, e.position, e.facing);
            break;
          case "dash":
            drawShape({ type: "line", length: d.distance, width: d.width }, e.position, e.facing);
            break;
          case "projectile":
            drawShape({ type: "line", length: 2, width: 0.2 }, e.position, e.facing);
            break;
          case "cloud":
            drawShape({ type: "circle", radius: d.radius }, e.targetPoint, 0);
            break;
        }
      }
    }
    const pg = g;
    for (const v of this.views) {
      const e = v.enemy;
      const x = Math.round(toPixels(e.position.x));
      const y = Math.round(toPixels(e.position.y));
      v.body.setPosition(x, y).setAlpha(e.state === "dead" ? 0.3 : 1);
      if (e.combatant.stagger.broken) v.body.setTint(0xffd166);
      else if (e.state === "windup") v.body.setTint(0xff9f9f);
      else v.body.clearTint();
      v.facing
        ?.setPosition(x, y)
        .setRotation(e.facing)
        .setVisible(e.state !== "dead");
      const half = (v.body.displayHeight / 2) | 0;
      v.label.setPosition(x, y - half - 5);
      const outline = RANK_OUTLINE[e.rank.rank];
      if (outline !== undefined)
        pg.lineStyle(1, outline, 1).strokeRect(
          x - v.body.displayWidth / 2 - 1,
          y - half - 1,
          v.body.displayWidth + 2,
          v.body.displayHeight + 2,
        );
      if (e.state !== "dead") {
        const w = Math.max(12, Math.round(v.body.displayWidth));
        pg.fillStyle(0x2a2934, 1)
          .fillRect(x - w / 2, y - half - 4, w, 2)
          .fillStyle(0xff6b6b, 1)
          .fillRect(
            x - w / 2,
            y - half - 4,
            Math.round((w * e.combatant.health.hp) / e.combatant.health.maxHp),
            2,
          );
      }
    }
    this.projectileImages.forEach((img) => img.setVisible(false));
    for (const pr of this.projectiles.positions()) {
      this.projectileImages[pr.index]
        ?.setVisible(true)
        .setPosition(toPixels(pr.position.x), toPixels(pr.position.y))
        .setRotation(Math.atan2(pr.direction.y, pr.direction.x));
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
