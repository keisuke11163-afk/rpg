import Phaser from "phaser";
import type { Enemy, EnemyRank, HitShape, Vec2 } from "@stella/core";
import { text, type TextKey } from "@stella/content";
import type { EnemyField } from "./EnemyField.ts";
import { enemyTexture, TEXTURES } from "./placeholders.ts";
import { PIXELS_PER_METER, toPixels } from "./units.ts";

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

interface EnemySprites {
  readonly body: Phaser.GameObjects.Image;
  readonly facing: Phaser.GameObjects.Image | undefined;
  readonly label: Phaser.GameObjects.Text;
}

/**
 * 試験用の場の敵の表示（EnemyField の状態を描く）。
 * 敵の画像は、場に出た敵ごとに作り、場から消えた敵の画像は消す。
 */
export class EnemyFieldView {
  private readonly scene: Phaser.Scene;
  private readonly sprites = new Map<Enemy, EnemySprites>();
  private readonly projectileImages: Phaser.GameObjects.Image[] = [];

  constructor(scene: Phaser.Scene, field: EnemyField) {
    this.scene = scene;
    for (let i = 0; i < field.projectiles.capacity; i++)
      this.projectileImages.push(
        scene.add.image(0, 0, TEXTURES.projectile).setVisible(false).setTint(0x9fdf6f),
      );
  }

  private create(e: Enemy): EnemySprites {
    const body = this.scene.add.image(0, 0, enemyTexture(e.def.id)).setScale(e.rank.scale);
    const facing =
      e.def.turnRate === null
        ? undefined
        : this.scene.add
            .image(0, 0, TEXTURES.facing)
            .setOrigin(-0.4, 0.5)
            .setScale(0.7)
            .setTint(0xff6b6b);
    const label = this.scene.add
      .text(0, 0, `${text(e.def.text as TextKey)} Lv${String(e.level)}`, {
        fontFamily: "sans-serif",
        fontSize: "8px",
        color: RANK_COLOR[e.rank.rank],
      })
      .setOrigin(0.5, 1);
    return { body, facing, label };
  }

  /** 場の敵と画像を合わせる（新しい敵の画像を作り、消えた敵の画像を消す）。 */
  private sync(field: EnemyField): void {
    const alive = new Set<Enemy>();
    for (const f of field.entries) {
      alive.add(f.enemy);
      if (!this.sprites.has(f.enemy)) this.sprites.set(f.enemy, this.create(f.enemy));
    }
    for (const [e, s] of this.sprites) {
      if (alive.has(e)) continue;
      s.body.destroy();
      s.facing?.destroy();
      s.label.destroy();
      this.sprites.delete(e);
    }
  }

  /** 予兆（地面の範囲）・雲・投射物・体・HPを描く。 */
  render(
    field: EnemyField,
    g: Phaser.GameObjects.Graphics,
    drawShape: (shape: HitShape, origin: Vec2, facing: number) => void,
  ): void {
    this.sync(field);
    for (const c of field.clouds) {
      g.fillStyle(0x7bd389, 0.18).fillCircle(
        toPixels(c.center.x),
        toPixels(c.center.y),
        c.radius * PIXELS_PER_METER,
      );
    }
    for (const { enemy: e } of field.entries) {
      const a = e.currentAttack;
      // 相手の位置を狙う連続の叩きつけ（母樹）：当たり判定が出ている間も、次の1回の位置を示す
      if (a !== undefined && e.state === "active") {
        const d = a.delivery;
        if (d.type === "strike" && d.aim === "target" && d.repeat !== undefined) {
          g.fillStyle(0xff6b6b, 0.3);
          drawShape(d.shape, e.targetPoint, 0);
        }
      }
      // 根渡り：現れる地点を示す
      const to = e.burrowDestination;
      if (to !== undefined)
        g.lineStyle(1, 0xc8a2ff, 0.9).strokeCircle(
          toPixels(to.x),
          toPixels(to.y),
          e.combatant.radius * PIXELS_PER_METER,
        );
      // 予兆：地面に範囲を示す（溜めの間、だんだん濃くなる）
      if (a !== undefined && e.state === "windup") {
        const progress = Math.min(1, e.timeInState / Math.max(a.windup, 1e-6));
        g.fillStyle(0xff6b6b, 0.12 + 0.25 * progress);
        const d = a.delivery;
        switch (d.type) {
          case "strike":
            if (d.aim === "target") drawShape(d.shape, e.targetPoint, 0);
            else drawShape(d.shape, e.position, e.facing);
            break;
          case "burrow":
          case "summon":
            break;
          case "dash":
            drawShape({ type: "line", length: d.distance, width: d.width }, e.position, e.facing);
            break;
          case "projectile":
            drawShape({ type: "line", length: 2, width: 0.2 }, e.position, e.facing);
            break;
          case "cloud": {
            // 1つ目は相手の位置、残りはその周りに等しい角度で（Enemy の雲の置き方と同じ）
            const count = d.count ?? 1;
            const c = e.targetPoint;
            const base = Math.atan2(c.y - e.position.y, c.x - e.position.x);
            for (let i = 0; i < count; i++) {
              const ang = base + (2 * Math.PI * (i - 1)) / Math.max(1, count - 1);
              const r = i === 0 ? 0 : (d.spread ?? 0);
              drawShape(
                { type: "circle", radius: d.radius },
                { x: c.x + Math.cos(ang) * r, y: c.y + Math.sin(ang) * r },
                0,
              );
            }
            break;
          }
        }
      }
    }
    for (const { enemy: e } of field.entries) {
      const v = this.sprites.get(e);
      if (v === undefined) continue;
      const x = Math.round(toPixels(e.position.x));
      const y = Math.round(toPixels(e.position.y));
      v.body.setPosition(x, y).setAlpha(e.state === "dead" || e.underground ? 0.3 : 1);
      if (e.combatant.stagger.broken) v.body.setTint(0xffd166);
      else if (e.shielded) v.body.setTint(0xc8a2ff);
      else if (e.state === "windup") v.body.setTint(0xff9f9f);
      else v.body.clearTint();
      v.facing
        ?.setPosition(x, y)
        .setRotation(e.facing)
        .setVisible(e.state !== "dead");
      const half = (v.body.displayHeight / 2) | 0;
      v.label.setPosition(x, y - half - 5);
      // ボス：段階と、切り替えの無敵を名前に添える
      if (e.def.boss !== undefined)
        v.label.setText(
          `${text(e.def.text as TextKey)} Lv${String(e.level)} 第${String(e.phase)}段階${e.shielded ? "（無敵）" : ""}`,
        );
      const outline = RANK_OUTLINE[e.rank.rank];
      if (outline !== undefined)
        g.lineStyle(1, outline, 1).strokeRect(
          x - v.body.displayWidth / 2 - 1,
          y - half - 1,
          v.body.displayWidth + 2,
          v.body.displayHeight + 2,
        );
      if (e.state !== "dead") {
        const w = Math.max(12, Math.round(v.body.displayWidth));
        g.fillStyle(0x2a2934, 1)
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
    for (const pr of field.projectiles.positions()) {
      this.projectileImages[pr.index]
        ?.setVisible(true)
        .setPosition(toPixels(pr.position.x), toPixels(pr.position.y))
        .setRotation(Math.atan2(pr.direction.y, pr.direction.x));
    }
  }
}
