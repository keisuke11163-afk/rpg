// 仮実装: U-18a feature/town-and-dungeon-base で、町とダンジョンの地図に置き換える（試験用の場）
import Phaser from "phaser";
import { FixedStepClock, PlayerMotion, length } from "@stella/core";
import { SCREEN } from "../config.ts";
import { InputSystem } from "../input/InputSystem.ts";
import { TEXTURES } from "../world/placeholders.ts";
import { PIXELS_PER_METER, toMeters, toPixels } from "../world/units.ts";
import { exposeDebug } from "../debug.ts";

/** 試験用の場の大きさ（m）。 */
const ARENA = { width: 40, height: 24 };

/**
 * 回避の無敵時間を確かめるための「試験用の危険地帯」。
 * 2秒ごとに0.6秒の予兆（枠だけ）を出し、その後0.2秒だけ当たり判定が出る。
 */
const HAZARD = { x: 26, y: 12, radius: 2.5, period: 2, telegraph: 0.6, active: 0.2 };

export class ArenaScene extends Phaser.Scene {
  private motion!: PlayerMotion;
  private controls!: InputSystem;
  private clock = new FixedStepClock();
  private body!: Phaser.GameObjects.Image;
  private facing!: Phaser.GameObjects.Image;
  private hazardGraphics!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Text;
  private staminaBar!: Phaser.GameObjects.Graphics;
  private time0 = 0;
  private hazardHits = 0;
  private hazardAvoided = 0;
  private hazardResolved = -1;

  constructor() {
    super("arena");
  }

  create(): void {
    this.add
      .tileSprite(0, 0, toPixels(ARENA.width), toPixels(ARENA.height), TEXTURES.floor)
      .setOrigin(0, 0);
    this.hazardGraphics = this.add.graphics();
    this.motion = new PlayerMotion({ x: 12, y: 12 }, undefined, {
      minX: 0.5,
      minY: 0.75,
      maxX: ARENA.width - 0.5,
      maxY: ARENA.height - 0.25,
    });
    this.body = this.add.image(0, 0, TEXTURES.player).setOrigin(0.5, 1);
    this.facing = this.add.image(0, 0, TEXTURES.facing).setOrigin(-0.6, 0.5);
    this.controls = new InputSystem(this);

    const camera = this.cameras.main;
    camera.setBounds(0, 0, toPixels(ARENA.width), toPixels(ARENA.height));
    camera.startFollow(this.body, true, 0.2, 0.2);
    camera.setRoundPixels(true);

    this.staminaBar = this.add.graphics().setScrollFactor(0);
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
        x: this.motion.position.x,
        y: this.motion.position.y,
        direction8: this.motion.direction8,
        stamina: this.motion.currentStamina,
        dodging: this.motion.dodging,
        invulnerable: this.motion.invulnerable,
        // 画面の上の位置（ゲームのピクセル。カメラの位置を引いたもの）
        screenX: this.body.x - this.cameras.main.scrollX,
        screenY: this.body.y - 12 - this.cameras.main.scrollY,
      }),
      hazard: () => ({
        hits: this.hazardHits,
        avoided: this.hazardAvoided,
        phase: this.time0 % HAZARD.period,
        x: HAZARD.x,
        y: HAZARD.y,
      }),
    });
    document.body.dataset["stellaReady"] = "true";
  }

  override update(_time: number, deltaMs: number): void {
    const frame = this.controls.read();
    const { steps } = this.clock.advance(deltaMs / 1000);
    for (let i = 0; i < steps; i++) {
      const pos = this.motion.position;
      const aim = {
        x: toMeters(frame.pointerWorld.x) - pos.x,
        y: toMeters(frame.pointerWorld.y) - pos.y,
      };
      // 押した瞬間の入力は、最初の1刻みにだけ渡す
      this.motion.update(this.clock.stepSeconds, {
        move: frame.move,
        aim,
        dodge: i === 0 && frame.pressed.has("dodge"),
      });
      this.time0 += this.clock.stepSeconds;
      this.updateHazard();
    }
    this.render();
  }

  private updateHazard(): void {
    const cycle = Math.floor(this.time0 / HAZARD.period);
    const t = this.time0 - cycle * HAZARD.period;
    const active = t >= HAZARD.telegraph && t < HAZARD.telegraph + HAZARD.active;
    if (!active || this.hazardResolved === cycle) return;
    const p = this.motion.position;
    const inside = length({ x: p.x - HAZARD.x, y: p.y - HAZARD.y }) <= HAZARD.radius;
    if (!inside) return;
    // 当たり判定が出ている間に1回だけ判定する。回避の無敵時間なら無効
    this.hazardResolved = cycle;
    if (this.motion.invulnerable) this.hazardAvoided += 1;
    else this.hazardHits += 1;
  }

  private render(): void {
    const p = this.motion.position;
    const x = Math.round(toPixels(p.x));
    const y = Math.round(toPixels(p.y));
    this.body.setPosition(x, y).setAlpha(this.motion.invulnerable ? 0.5 : 1);
    this.facing.setPosition(x, y - 12).setRotation((this.motion.direction8 * Math.PI) / 4);

    const t = this.time0 % HAZARD.period;
    const g = this.hazardGraphics.clear();
    const hx = toPixels(HAZARD.x);
    const hy = toPixels(HAZARD.y);
    const r = HAZARD.radius * PIXELS_PER_METER;
    if (t < HAZARD.telegraph) g.lineStyle(1, 0xff6b6b, 0.4 + t).strokeCircle(hx, hy, r);
    else if (t < HAZARD.telegraph + HAZARD.active) g.fillStyle(0xff6b6b, 0.5).fillCircle(hx, hy, r);

    const ratio = this.motion.currentStamina / this.motion.config.maxStamina;
    this.staminaBar
      .clear()
      .fillStyle(0x2a2934, 1)
      .fillRect(8, SCREEN.height - 14, 100, 6)
      .fillStyle(0x7bd389, 1)
      .fillRect(8, SCREEN.height - 14, Math.round(100 * ratio), 6);
    this.hud.setText([
      "試験用の場（WASDで移動・マウスで照準・スペースで回避）",
      `危険地帯：被弾 ${String(this.hazardHits)}／回避で無効 ${String(this.hazardAvoided)}`,
      `気力 ${this.motion.currentStamina.toFixed(0)}`,
    ]);
  }
}
