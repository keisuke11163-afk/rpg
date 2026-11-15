import Phaser from "phaser";
import { type Enemy, type EnemyRank, type HitShape, type Vec2, cloudCenters } from "@stella/core";
import { text, type TextKey } from "@stella/content";
import type { EnemyField } from "./EnemyField.ts";
import { type EnemyLook, enemyLook } from "./look-tables.ts";
import { enemyTexture, TEXTURES } from "./placeholders.ts";
import { fillShadow } from "./sprites.ts";
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
  readonly look: EnemyLook;
  readonly facing: Phaser.GameObjects.Image | undefined;
  readonly label: Phaser.GameObjects.Text;
  /** 倒れたのを見た時刻（ミリ秒。散る図形・消えていく表示に使う）。 */
  deadAt: number | undefined;
  /** 今の白い光の終わりの時刻（数え直さないため。確認用の counts）。 */
  flashUntil: number | undefined;
}

/** 当てたときに白く光らせる時間（ミリ秒）。 */
const HIT_FLASH_MS = 70;
/** 倒れてから消えていく時間（ミリ秒。sim から消えるまでは、薄く残す）。 */
const DEATH_FADE_MS = 450;
/** 倒れた後に残す薄さ。 */
const DEAD_ALPHA = 0.15;
/** 倒れたときに広がる輪の時間（ミリ秒）。 */
const DEATH_RING_MS = 220;

/**
 * 試験用の場の敵の表示（EnemyField の状態を描く）。
 * 敵の画像は、場に出た敵ごとに作り、場から消えた敵の画像は消す。
 */
export class EnemyFieldView {
  private readonly scene: Phaser.Scene;
  private readonly sprites = new Map<Enemy, EnemySprites>();
  private readonly projectileImages: Phaser.GameObjects.Image[] = [];
  /** 当てた敵（ID）と、白く光らせる終わりの時刻（ミリ秒）。 */
  private readonly flashes = new Map<string, number>();
  /** 白い光・散る図形を実際に出した回数（開発用の確認。pnpm e2e）。 */
  private flashCount = 0;
  private burstCount = 0;

  constructor(scene: Phaser.Scene, field: EnemyField) {
    this.scene = scene;
    for (let i = 0; i < field.projectiles.capacity; i++)
      this.projectileImages.push(
        scene.add.image(0, 0, TEXTURES.projectile).setVisible(false).setTint(0x9fdf6f),
      );
  }

  private create(e: Enemy): EnemySprites {
    const look = enemyLook(e.def.id);
    const body = this.scene.add.image(0, 0, enemyTexture(e.def.id)).setScale(e.rank.scale);
    const w = body.displayWidth;
    // 向きの印（赤い三角）：体の輪郭のすぐ外に置く（頭に重ねない）。小さな敵は少し小さく
    const facingScale = w < 14 ? 0.55 : 0.7;
    const facing =
      e.def.turnRate === null
        ? undefined
        : this.scene.add
            .image(0, 0, TEXTURES.facing)
            .setOrigin(-(w / 2 - 1) / (10 * facingScale), 0.5)
            .setScale(facingScale)
            .setTint(0xff6b6b);
    const label = this.scene.add
      .text(0, 0, `${text(e.def.text as TextKey)} Lv${String(e.level)}`, {
        fontFamily: "sans-serif",
        fontSize: "8px",
        color: RANK_COLOR[e.rank.rank],
      })
      .setOrigin(0.5, 1);
    return { body, look, facing, label, deadAt: undefined, flashUntil: undefined };
  }

  /** 白い光（描いた敵の数。同じ光は1回）・散る図形を出した回数（このビューを作ってからの累計）。 */
  counts(): { flashes: number; bursts: number } {
    return { flashes: this.flashCount, bursts: this.burstCount };
  }

  /** 敵に当てた（表示だけ。短く白く光らせる）。id は Enemy.id（ヒットの targetId）。 */
  flash(id: string): void {
    this.flashes.set(id, this.scene.time.now + HIT_FLASH_MS);
  }

  /**
   * 倒れた敵から、小さな四角を散らす（表示だけ。ボスは多く・遠くへ）。
   * 体の外まで飛ぶように、届く距離は体の大きさに合わせる（大きな敵では体に隠れて見えなかったため）。
   * 動きは初めに速く（Cubic.Out）、薄くなるのは後半（Quad.In）にして、飛んでいく途中が見えるようにする。
   */
  private burst(x: number, y: number, bodySize: number, boss: boolean, color: number): void {
    this.burstCount += 1;
    const n = boss ? 18 : 10;
    const reach = Math.round(bodySize / 2 + (boss ? 26 : 14));
    const size = boss ? 5 : 4;
    const duration = boss ? 700 : DEATH_FADE_MS;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (i % 2) * 0.3;
      // 奇数番目は少し手前で止める（輪のように揃って見えないように）
      const r = reach * (i % 2 === 0 ? 1 : 0.7);
      const piece = this.scene.add.rectangle(x, y, size, size, color, 1);
      this.scene.tweens.add({
        targets: piece,
        x: { value: x + Math.cos(a) * r, ease: "Cubic.Out" },
        y: { value: y + Math.sin(a) * r, ease: "Cubic.Out" },
        alpha: { value: 0, ease: "Quad.In" },
        duration,
        onComplete: () => {
          piece.destroy();
        },
      });
    }
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
    for (const [id, until] of this.flashes)
      if (until <= this.scene.time.now) this.flashes.delete(id);
  }

  /** 予兆（地面の範囲）・雲・投射物・体・HPを描く。 */
  render(
    field: EnemyField,
    g: Phaser.GameObjects.Graphics,
    drawShape: (shape: HitShape, origin: Vec2, facing: number) => void,
    shadows: Phaser.GameObjects.Graphics,
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
            // 実際の雲と同じ置き方（core の cloudCenters）
            for (const c of cloudCenters(d, e.targetPoint, e.position))
              drawShape({ type: "circle", radius: d.radius }, c, 0);
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
      const now = this.scene.time.now;
      // 倒れた：最初に見たときに散らし、だんだん消す（sim から消えるまで薄く残す）
      if (e.state !== "dead") v.deadAt = undefined;
      else if (v.deadAt === undefined) {
        v.deadAt = now;
        this.burst(
          x,
          y,
          Math.max(v.body.displayWidth, v.body.displayHeight),
          e.def.boss !== undefined,
          e.def.boss !== undefined ? 0xffb07a : 0xe8e6f0,
        );
      }
      const alpha =
        v.deadAt !== undefined
          ? Math.max(DEAD_ALPHA, 1 - (now - v.deadAt) / DEATH_FADE_MS)
          : e.underground
            ? 0.3
            : 1;
      v.body.setPosition(x, y).setAlpha(alpha);
      // 真上から見た獣は、体を向きに合わせて回す（頭が向き。背面を取る遊びのため）。木・苗は回さない
      if (v.look.rotates) v.body.setRotation(e.facing);
      // 影（体の幅、高さは半分。木・苗は根元に平たく）。地中にいる間・消えた後は出さない
      const r0 = v.body.displayWidth / 2;
      if (!e.underground && (v.deadAt === undefined || alpha > DEAD_ALPHA))
        fillShadow(
          shadows,
          x,
          y + Math.round(v.look.rotates ? r0 * 0.25 : r0 * 0.55),
          r0 * 2,
          v.look.rotates ? r0 * 1.1 : r0 * 0.8,
          alpha,
        );
      v.label.setAlpha(v.deadAt === undefined ? 1 : alpha);
      // 当てた直後は白く光らせる（Phaser 4 では setTintFill の代わりに setTint ＋ FILL）
      const flashUntil = this.flashes.get(e.id) ?? 0;
      // 倒れた直後も同じ時間だけ白く光らせる（とどめの手応え）
      const flashing =
        e.state !== "dead"
          ? flashUntil > now
          : v.deadAt !== undefined && now - v.deadAt < HIT_FLASH_MS;
      if (flashing && v.flashUntil !== flashUntil) {
        v.flashUntil = flashUntil;
        this.flashCount += 1;
      }
      if (flashing) v.body.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
      else {
        v.body.setTintMode(Phaser.TintModes.MULTIPLY);
        if (e.combatant.stagger.broken) v.body.setTint(0xffd166);
        else if (e.shielded) v.body.setTint(0xc8a2ff);
        else if (e.state === "windup") v.body.setTint(0xff9f9f);
        else v.body.clearTint();
      }
      // 倒れた直後：体の外へ広がる薄い輪
      if (v.deadAt !== undefined && now - v.deadAt < DEATH_RING_MS) {
        const t = (now - v.deadAt) / DEATH_RING_MS;
        const r0 = Math.max(v.body.displayWidth, v.body.displayHeight) / 2;
        g.lineStyle(2, 0xffffff, 0.7 * (1 - t)).strokeCircle(x, y, r0 + 4 + 10 * t);
      }
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
      // 格（魔法・精鋭）：体を囲む輪と、足元の色の輪（精鋭は二重）。名前の色と同じ色
      const outline = RANK_OUTLINE[e.rank.rank];
      if (outline !== undefined && e.state !== "dead") {
        const rr = v.body.displayWidth / 2;
        const gy = y + Math.round(rr * 0.3);
        g.fillStyle(outline, 0.16).fillEllipse(x, gy, rr * 2 + 8, rr + 6);
        g.lineStyle(1, outline, 0.9).strokeEllipse(x, gy, rr * 2 + 8, rr + 6);
        if (e.rank.rank === "elite")
          g.lineStyle(1, outline, 0.6).strokeEllipse(x, gy, rr * 2 + 14, rr + 10);
        g.lineStyle(1, outline, 0.85).strokeCircle(x, y, rr + 1.5);
      }
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
