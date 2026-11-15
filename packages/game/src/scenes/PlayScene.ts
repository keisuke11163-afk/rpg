import Phaser from "phaser";
import {
  AttackRunner,
  FixedStepper,
  PLAYER,
  WEAPONS,
  basicAttackTiming,
  createRng,
  createTrainingDummy,
  strike,
  type HitSpec,
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
  private readonly dummy = createTrainingDummy({ x: 6, y: 0 });
  private dummyBody!: Phaser.GameObjects.Rectangle;
  private readonly rng = createRng("play-scene");
  private attack: AttackRunner | undefined;
  private attackAngle = 0;
  private swing!: Phaser.GameObjects.Graphics;
  private hitStopLeft = 0;
  /** HPとMPの表示用の値（Lv1の基礎値。U-10 の経験値とLvで置き換える） */
  private readonly hp = 60;
  private readonly mp = 60;

  constructor() {
    super("play");
  }

  create(): void {
    // 地面（格子）
    const grid = this.add.grid(0, 0, 80 * M, 60 * M, M, M, 0x1d1c26, 1, 0x26253a, 1);
    grid.setDepth(-10);
    this.dummyBody = this.add
      .rectangle(this.dummy.pos.x * M, this.dummy.pos.y * M, 14, 20, 0x8a4f4f)
      .setDepth(1);
    this.swing = this.add.graphics().setDepth(4);
    this.add.text(this.dummy.pos.x * M - 24, this.dummy.pos.y * M - 24, "的（仮）", {
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
    // ヒットストップ：短い間、ルールの時間を止める
    if (this.hitStopLeft > 0) {
      this.hitStopLeft -= delta / 1000;
      this.updateView(delta);
      return;
    }
    for (let i = 0; i < ticks; i++) {
      this.updateAttack(actions.has("skill1"));
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
    this.updateView(delta);
  }

  /** 左クリックの通常攻撃（仮実装: U-08 feature/warrior の技の仕組みで置き換える） */
  private updateAttack(held: boolean): void {
    const weapon = WEAPONS["greatsword"];
    if (!weapon) return;
    if (!this.attack && held && !isDodging(this.player)) {
      this.attack = new AttackRunner(basicAttackTiming(weapon.speed));
      this.attackAngle = this.player.aimAngle;
    }
    if (!this.attack) return;
    const fired = this.attack.step(TICK_SECONDS).length;
    for (let n = 0; n < fired; n++) {
      const spec: HitSpec = {
        shape: { kind: "cone", range: 1.6, arcDegrees: 90 },
        damage: {
          base: { physical: this.rng.int(weapon.min * 100, weapon.max * 100) / 100 },
          skillMultiplier: 1,
        },
        weaponCrit: weapon.crit,
        accuracy: 100,
      };
      for (const { target, result } of strike(
        this.player.pos,
        this.attackAngle,
        [this.dummy],
        spec,
        this.rng,
      )) {
        this.hitStopLeft = result.feedback.hitStopSeconds;
        this.cameras.main.shake(60, result.feedback.shake * 0.0008);
        this.showDamage(target.pos.x, target.pos.y, result.damage, result.crit, result.back);
        if (target.hp <= 0) target.hp = target.maxHp;
      }
      this.swing.clear();
      this.swing.fillStyle(0xffffff, 0.35);
      const cx = this.player.pos.x * M;
      const cy = this.player.pos.y * M;
      this.swing.slice(
        cx,
        cy,
        1.6 * M,
        this.attackAngle - Math.PI / 4,
        this.attackAngle + Math.PI / 4,
      );
      this.swing.fillPath();
      this.time.delayedCall(80, () => this.swing.clear());
    }
    if (this.attack.done) this.attack = undefined;
  }

  private showDamage(x: number, y: number, amount: number, crit: boolean, back: boolean): void {
    const label = this.add
      .text(x * M, y * M - 14, `${amount.toFixed(1)}${back ? "（背面）" : ""}`, {
        fontFamily: "monospace",
        fontSize: crit ? "12px" : "9px",
        color: crit ? "#ffd86b" : "#ffffff",
      })
      .setOrigin(0.5)
      .setDepth(8);
    this.tweens.add({
      targets: label,
      y: label.y - 18,
      alpha: 0,
      duration: 600,
      onComplete: () => {
        label.destroy();
      },
    });
  }

  private updateView(delta: number): void {
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
    this.dummy.breakGauge.tick(delta / 1000);
    this.dummyBody.setFillStyle(this.dummy.breakGauge.broken ? 0xd8c36f : 0x8a4f4f);
    this.hud.setText(
      `HP ${String(this.hp)}/${String(this.hp)}  MP ${String(this.mp)}/${String(this.mp)}  気力 ${String(Math.floor(this.player.stamina))}/${String(PLAYER.staminaMax)}\n人形の崩し ${String(Math.floor(this.dummy.breakGauge.gauge))}/${String(Math.floor(this.dummy.breakGauge.currentMax))}\nWASD 移動 / マウス 照準 / 左クリック 攻撃 / Space 回避`,
    );
  }
}
