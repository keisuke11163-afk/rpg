import Phaser from "phaser";
import {
  FixedStepper,
  PLAYER,
  TICK_SECONDS,
  canBeHit,
  createPlayer,
  facing8,
  isDodging,
  moveVector,
  pressedActions,
  stepPlayer,
} from "@stella/core";
import { SCREEN } from "../config.ts";

/** 1m = 16ピクセル */
const M = SCREEN.tileSize;

/**
 * 試験用の場面（U-06）。仮素材（図形）のプレイヤーを WASD・マウス・スペースで動かす。
 * 仮実装: U-09 feature/enemy-ai の試験用の小さな地図で置き換える。
 */
export class PlayScene extends Phaser.Scene {
  private readonly pressed = new Set<string>();
  private readonly stepper = new FixedStepper();
  private readonly player = createPlayer({ x: 0, y: 0 });
  private body!: Phaser.GameObjects.Rectangle;
  private arrow!: Phaser.GameObjects.Triangle;
  private hud!: Phaser.GameObjects.Text;
  private dodgePressedOnce = false;
  private hitFlash = 0;
  private readonly dummy = { x: 6, y: 0 };

  constructor() {
    super("play");
  }

  create(): void {
    // 地面（格子）
    const grid = this.add.grid(0, 0, 80 * M, 60 * M, M, M, 0x1d1c26, 1, 0x26253a, 1);
    grid.setDepth(-10);
    this.add.rectangle(this.dummy.x * M, this.dummy.y * M, 14, 20, 0x8a4f4f).setDepth(1);
    this.add.text(this.dummy.x * M - 24, this.dummy.y * M - 24, "的（仮）", {
      fontFamily: "sans-serif",
      fontSize: "8px",
      color: "#a89898",
    });
    this.body = this.add.rectangle(0, 0, 12, 18, 0x6fb1d8).setDepth(2);
    this.arrow = this.add.triangle(0, 0, 0, -3, 0, 3, 7, 0, 0xffffff).setDepth(3);
    this.hud = this.add
      .text(8, 8, "", { fontFamily: "monospace", fontSize: "9px", color: "#cfcde0" })
      .setScrollFactor(0)
      .setDepth(10);
    this.cameras.main.startFollow(this.body, true, 0.15, 0.15);

    const keyboard = this.input.keyboard;
    if (keyboard) {
      keyboard.on("keydown", (e: KeyboardEvent) => {
        this.pressed.add(e.code);
        if (e.code === "Space") this.dodgePressedOnce = true;
        e.preventDefault();
      });
      keyboard.on("keyup", (e: KeyboardEvent) => this.pressed.delete(e.code));
    }
    this.input.mouse?.disableContextMenu();
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) =>
      this.pressed.add(`Mouse${String(p.button)}`),
    );
    this.input.on("pointerup", (p: Phaser.Input.Pointer) =>
      this.pressed.delete(`Mouse${String(p.button)}`),
    );
    this.game.events.on(Phaser.Core.Events.BLUR, () => {
      this.pressed.clear();
    });

    document.body.dataset["stellaReady"] = "true";
  }

  override update(_time: number, delta: number): void {
    const ticks = this.stepper.advance(delta);
    const actions = pressedActions(this.pressed);
    const pointer = this.input.activePointer;
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    for (let i = 0; i < ticks; i++) {
      stepPlayer(
        this.player,
        {
          move: moveVector(actions),
          aimPoint: { x: world.x / M, y: world.y / M },
          dodgePressed: this.dodgePressedOnce || actions.has("dodge"),
        },
        TICK_SECONDS,
      );
      this.dodgePressedOnce = false;
    }
    this.body.setPosition(this.player.pos.x * M, this.player.pos.y * M);
    // 見た目の向きは8方向に丸める（照準自体は自由な角度）
    const angle = (facing8(this.player.aimAngle) * Math.PI) / 4;
    this.arrow.setPosition(this.body.x + Math.cos(angle) * 12, this.body.y + Math.sin(angle) * 12);
    this.arrow.setRotation(angle);
    this.body.setFillStyle(
      isDodging(this.player) ? (canBeHit(this.player) ? 0x6fb1d8 : 0xffffff) : 0x6fb1d8,
    );
    this.body.setAlpha(isDodging(this.player) ? 0.6 : 1);
    this.hitFlash = Math.max(0, this.hitFlash - delta);
    this.hud.setText(
      `気力 ${String(Math.floor(this.player.stamina))}/${String(PLAYER.staminaMax)}\nWASD 移動 / マウス 照準 / Space 回避`,
    );
  }
}
