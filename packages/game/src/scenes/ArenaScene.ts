// 仮実装: U-18a feature/town-and-dungeon-base で、町とダンジョンの地図に置き換える（試験用の場）
import Phaser from "phaser";
import type { HitReport } from "@stella/core";
import { SCREEN } from "../config.ts";
import { exposeDebug } from "../debug.ts";
import { InputSystem } from "../input/InputSystem.ts";
import { TEXTURES } from "../world/placeholders.ts";
import { PIXELS_PER_METER, toPixels } from "../world/units.ts";
import { ARENA, ArenaSimulation, BASIC_SHAPE, DUMMY_POSITION, HAZARD } from "./arena-simulation.ts";

export class ArenaScene extends Phaser.Scene {
  private sim!: ArenaSimulation;
  private controls!: InputSystem;
  private body!: Phaser.GameObjects.Image;
  private facing!: Phaser.GameObjects.Image;
  private dummyImage!: Phaser.GameObjects.Image;
  private dummyFacing!: Phaser.GameObjects.Image;
  private fx!: Phaser.GameObjects.Graphics;
  private projectileImages: Phaser.GameObjects.Image[] = [];
  private hud!: Phaser.GameObjects.Text;
  private bars!: Phaser.GameObjects.Graphics;
  /** 開発用：描画のフレームの経過時間を固定する（ミリ秒）。null なら実際の経過時間を使う。 */
  private debugFrameDeltaMs: number | null = null;

  constructor() {
    super("arena");
  }

  create(): void {
    this.add
      .tileSprite(0, 0, toPixels(ARENA.width), toPixels(ARENA.height), TEXTURES.floor)
      .setOrigin(0, 0);
    this.fx = this.add.graphics();
    this.sim = new ArenaSimulation(undefined, {
      onHit: (report) => {
        if (report.hit.crit) this.cameras.main.shake(80, 0.004);
        this.popDamage(report);
      },
    });
    // 位置は体の中心（照準を合わせた所に当たるように。docs/progress D-U07-4）
    this.dummyImage = this.add
      .image(toPixels(DUMMY_POSITION.x), toPixels(DUMMY_POSITION.y), TEXTURES.dummy)
      .setOrigin(0.5, 0.5);
    this.dummyFacing = this.add
      .image(toPixels(DUMMY_POSITION.x), toPixels(DUMMY_POSITION.y), TEXTURES.facing)
      .setOrigin(-0.6, 0.5)
      .setRotation(Math.PI)
      .setTint(0xa07850);
    this.body = this.add.image(0, 0, TEXTURES.player).setOrigin(0.5, 0.5);
    this.facing = this.add.image(0, 0, TEXTURES.facing).setOrigin(-0.6, 0.5);
    for (let i = 0; i < this.sim.projectiles.capacity; i++) {
      this.projectileImages.push(this.add.image(0, 0, TEXTURES.projectile).setVisible(false));
    }
    this.controls = new InputSystem(this);

    const camera = this.cameras.main;
    camera.setBounds(0, 0, toPixels(ARENA.width), toPixels(ARENA.height));
    camera.startFollow(this.body, true, 0.2, 0.2);
    camera.setRoundPixels(true);

    this.bars = this.add.graphics().setScrollFactor(0);
    this.hud = this.add
      .text(8, 8, "", {
        fontFamily: "sans-serif",
        fontSize: "10px",
        color: "#e8e6f0",
        lineSpacing: 2,
      })
      .setScrollFactor(0);

    exposeDebug({
      player: () => ({
        x: this.sim.motion.position.x,
        y: this.sim.motion.position.y,
        direction8: this.sim.motion.direction8,
        stamina: this.sim.motion.currentStamina,
        dodging: this.sim.motion.dodging,
        invulnerable: this.sim.motion.invulnerable,
        dodgePending: this.sim.dodgePending,
        totalSteps: this.sim.clock.totalSteps,
        // 画面の上の位置（ゲームのピクセル。カメラの位置を引いたもの）
        screenX: this.body.x - this.cameras.main.scrollX,
        screenY: this.body.y - this.cameras.main.scrollY,
      }),
      hazard: () => ({
        hits: this.sim.hazardHits,
        avoided: this.sim.hazardAvoided,
        phase: this.sim.time % HAZARD.period,
        x: HAZARD.x,
        y: HAZARD.y,
      }),
      dummy: () => ({
        x: this.sim.dummy.position.x,
        y: this.sim.dummy.position.y,
        hp: this.sim.dummy.health.hp,
        maxHp: this.sim.dummy.health.maxHp,
        hits: this.sim.hitCount,
        lastDamage: this.sim.lastHit?.hit.total ?? 0,
        lastCrit: this.sim.lastHit?.hit.crit ?? false,
        lastBackstab: this.sim.lastHit?.backstab ?? false,
        shotsFired: this.sim.shotsFired,
        projectilesActive: this.sim.projectiles.active,
        projectilePositions: this.sim.projectiles
          .positions()
          .map((p) => [p.position.x, p.position.y, p.direction.x, p.direction.y]),
        screenX: this.dummyImage.x - this.cameras.main.scrollX,
        screenY: this.dummyImage.y - this.cameras.main.scrollY,
      }),
      // 刻みが0のフレームを再現するため（pnpm e2e）。null で元に戻す
      setFrameDeltaMs: (ms: number | null) => {
        this.debugFrameDeltaMs = ms;
      },
    });
    document.body.dataset["stellaReady"] = "true";
  }

  override update(_time: number, deltaMs: number): void {
    // 入力の取得はフレームごと。保持と刻みへの受け渡しは ArenaSimulation が行う
    const frame = this.controls.read();
    this.sim.frame((this.debugFrameDeltaMs ?? deltaMs) / 1000, frame);
    this.render();
  }

  private popDamage(report: HitReport): void {
    const color = report.hit.crit ? "#ffd166" : report.backstab ? "#c3a6ff" : "#ffffff";
    const label = `${report.hit.total.toFixed(0)}${report.hit.crit ? "!" : ""}${report.backstab ? "（背面）" : ""}`;
    const t = this.add
      .text(this.dummyImage.x, this.dummyImage.y - 18, label, {
        fontFamily: "sans-serif",
        fontSize: report.hit.crit ? "12px" : "10px",
        color,
      })
      .setOrigin(0.5, 1);
    this.tweens.add({
      targets: t,
      y: t.y - 16,
      alpha: 0,
      duration: 700,
      onComplete: () => {
        t.destroy();
      },
    });
  }

  private render(): void {
    const sim = this.sim;
    const motion = sim.motion;
    const p = motion.position;
    const x = Math.round(toPixels(p.x));
    const y = Math.round(toPixels(p.y));
    this.body.setPosition(x, y).setAlpha(motion.invulnerable ? 0.5 : 1);
    this.facing.setPosition(x, y).setRotation((motion.direction8 * Math.PI) / 4);
    // Phaser 4 では setTintFill が無くなり、setTint ＋ setTintMode で白く光らせる
    if (sim.flash > 0) this.dummyImage.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    else this.dummyImage.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
    this.dummyFacing.setVisible(true);

    const g = this.fx.clear();
    const t = sim.time % HAZARD.period;
    const hx = toPixels(HAZARD.x);
    const hy = toPixels(HAZARD.y);
    const r = HAZARD.radius * PIXELS_PER_METER;
    if (t < HAZARD.telegraph) g.lineStyle(1, 0xff6b6b, 0.4 + t).strokeCircle(hx, hy, r);
    else if (t < HAZARD.telegraph + HAZARD.active) g.fillStyle(0xff6b6b, 0.5).fillCircle(hx, hy, r);
    // 攻撃の当たり判定（当たり判定が出ている間だけ）
    if (sim.attack?.phase === "active") {
      const half = (BASIC_SHAPE.type === "sector" ? BASIC_SHAPE.angleDeg : 90) / 2;
      const rad = (BASIC_SHAPE.type === "sector" ? BASIC_SHAPE.radius : 1) * PIXELS_PER_METER;
      g.fillStyle(0xffffff, 0.25)
        .slice(
          x,
          y,
          rad,
          motion.facing - (half * Math.PI) / 180,
          motion.facing + (half * Math.PI) / 180,
        )
        .fillPath();
    }
    // 人形のHP
    const dummy = sim.dummy;
    const dx = this.dummyImage.x - 12;
    const dy = this.dummyImage.y - 18;
    g.fillStyle(0x2a2934, 1)
      .fillRect(dx, dy, 24, 3)
      .fillStyle(0xff6b6b, 1)
      .fillRect(dx, dy, Math.round((24 * dummy.health.hp) / dummy.health.maxHp), 3);

    this.projectileImages.forEach((img) => img.setVisible(false));
    for (const pr of sim.projectiles.positions()) {
      this.projectileImages[pr.index]
        ?.setVisible(true)
        .setPosition(toPixels(pr.position.x), toPixels(pr.position.y))
        .setRotation(Math.atan2(pr.direction.y, pr.direction.x));
    }

    const bar = (row: number, ratio: number, color: number): void => {
      const by = SCREEN.height - 30 + row * 8;
      this.bars
        .fillStyle(0x2a2934, 1)
        .fillRect(8, by, 100, 5)
        .fillStyle(color, 1)
        .fillRect(8, by, Math.round(100 * Math.max(0, Math.min(1, ratio))), 5);
    };
    this.bars.clear();
    bar(0, sim.playerHealth.hp / sim.playerHealth.maxHp, 0xff6b6b);
    bar(1, sim.mp / sim.maxMp, 0x6fa8ff);
    bar(2, motion.currentStamina / motion.config.maxStamina, 0x7bd389);

    const last = sim.lastHit;
    this.hud.setText([
      "試験用の場（WASD移動・マウス照準・左クリック通常攻撃・右クリック試験用の投射物・スペース回避）",
      `人形：HP ${dummy.health.hp.toFixed(0)}／${dummy.health.maxHp.toFixed(0)}・DPS ${sim.dps().toFixed(1)}・ヒット ${String(sim.hitCount)}`,
      last === undefined
        ? "最後のヒット：なし"
        : `最後のヒット：${last.hit.evaded ? "回避された" : `${last.hit.total.toFixed(1)}${last.hit.crit ? "・会心" : ""}${last.backstab ? "・背面" : ""}`}`,
      `危険地帯：被弾 ${String(sim.hazardHits)}／回避で無効 ${String(sim.hazardAvoided)}`,
      `HP ${sim.playerHealth.hp.toFixed(0)}・MP ${sim.mp.toFixed(0)}・気力 ${motion.currentStamina.toFixed(0)}`,
    ]);
  }
}
