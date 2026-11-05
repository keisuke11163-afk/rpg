// 仮実装: U-18a feature/town-and-dungeon-base で、町とダンジョンの地図に置き換える（試験用の場）
import Phaser from "phaser";
import { SCREEN } from "../config.ts";
import { InputSystem } from "../input/InputSystem.ts";
import { TEXTURES } from "../world/placeholders.ts";
import { PIXELS_PER_METER, toPixels } from "../world/units.ts";
import { exposeDebug } from "../debug.ts";
import { ARENA, ArenaSimulation, HAZARD } from "./arena-simulation.ts";

export class ArenaScene extends Phaser.Scene {
  private sim!: ArenaSimulation;
  private controls!: InputSystem;
  private body!: Phaser.GameObjects.Image;
  private facing!: Phaser.GameObjects.Image;
  private hazardGraphics!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Text;
  private staminaBar!: Phaser.GameObjects.Graphics;
  /** 開発用：描画のフレームの経過時間を固定する（ミリ秒）。null なら実際の経過時間を使う。 */
  private debugFrameDeltaMs: number | null = null;

  constructor() {
    super("arena");
  }

  create(): void {
    this.add
      .tileSprite(0, 0, toPixels(ARENA.width), toPixels(ARENA.height), TEXTURES.floor)
      .setOrigin(0, 0);
    this.hazardGraphics = this.add.graphics();
    this.sim = new ArenaSimulation();
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
        screenY: this.body.y - 12 - this.cameras.main.scrollY,
      }),
      hazard: () => ({
        hits: this.sim.hazardHits,
        avoided: this.sim.hazardAvoided,
        phase: this.sim.time % HAZARD.period,
        x: HAZARD.x,
        y: HAZARD.y,
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

  private render(): void {
    const motion = this.sim.motion;
    const p = motion.position;
    const x = Math.round(toPixels(p.x));
    const y = Math.round(toPixels(p.y));
    this.body.setPosition(x, y).setAlpha(motion.invulnerable ? 0.5 : 1);
    this.facing.setPosition(x, y - 12).setRotation((motion.direction8 * Math.PI) / 4);

    const t = this.sim.time % HAZARD.period;
    const g = this.hazardGraphics.clear();
    const hx = toPixels(HAZARD.x);
    const hy = toPixels(HAZARD.y);
    const r = HAZARD.radius * PIXELS_PER_METER;
    if (t < HAZARD.telegraph) g.lineStyle(1, 0xff6b6b, 0.4 + t).strokeCircle(hx, hy, r);
    else if (t < HAZARD.telegraph + HAZARD.active) g.fillStyle(0xff6b6b, 0.5).fillCircle(hx, hy, r);

    const ratio = motion.currentStamina / motion.config.maxStamina;
    this.staminaBar
      .clear()
      .fillStyle(0x2a2934, 1)
      .fillRect(8, SCREEN.height - 14, 100, 6)
      .fillStyle(0x7bd389, 1)
      .fillRect(8, SCREEN.height - 14, Math.round(100 * ratio), 6);
    this.hud.setText([
      "試験用の場（WASDで移動・マウスで照準・スペースで回避）",
      `危険地帯：被弾 ${String(this.sim.hazardHits)}／回避で無効 ${String(this.sim.hazardAvoided)}`,
      `気力 ${motion.currentStamina.toFixed(0)}`,
    ]);
  }
}
