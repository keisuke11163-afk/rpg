import Phaser from "phaser";
import {
  AttackRunner,
  FURY,
  FixedStepper,
  Fighter,
  PLAYER,
  ProjectilePool,
  TICK_SECONDS,
  WARRIOR_SKILLS,
  WEAPONS,
  alertPack,
  basicAttackTiming,
  canBeHit,
  createPlayer,
  createRng,
  enemyAccuracy,
  facing8,
  isDodging,
  moveVector,
  pressedActions,
  spawnPack,
  stepEnemies,
  stepPlayer,
  strike,
  type Enemy,
  type EnemyEvent,
  type HitShape,
  type HitSpec,
} from "@stella/core";
import { enemyDef } from "@stella/content";
import { SCREEN } from "../config.ts";

/** 1m = 16ピクセル */
const M = SCREEN.tileSize;

const ENEMY_COLORS: Record<string, number> = {
  "ENM-FOREST-WOLF": 0x8a8f99,
  "ENM-THORN-RAT": 0x9b7a55,
  "ENM-SPIT-LIZARD": 0x6f9b55,
  "ENM-FANG-BOAR": 0x8a4f4f,
  "ENM-BARK-BEAR": 0x6b4a33,
  "ENM-ROT-SPROUT": 0x7b5a8a,
};

interface EnemyView {
  enemy: Enemy;
  body: Phaser.GameObjects.Rectangle;
  facing: Phaser.GameObjects.Rectangle;
  hp: Phaser.GameObjects.Rectangle;
}

interface Cloud {
  x: number;
  y: number;
  radius: number;
  left: number;
  damage: number;
  gfx: Phaser.GameObjects.Arc;
  tick: number;
}

/**
 * 試験用の小さな地図（U-09）。仮素材（図形）の戦士で、第1章の敵と戦う。
 * 仮実装: U-18a feature/town-and-dungeon-base の固定マップとランダムな配置で置き換える。
 */
export class PlayScene extends Phaser.Scene {
  private readonly pressed = new Set<string>();
  /** このフレームに押された入力。短く押して離しても、1回は処理に届くようにする */
  private readonly justPressed = new Set<string>();
  private readonly stepper = new FixedStepper();
  private readonly player = createPlayer({ x: 0, y: 0 });
  private body!: Phaser.GameObjects.Rectangle;
  private arrow!: Phaser.GameObjects.Triangle;
  private hud!: Phaser.GameObjects.Text;
  private dodgePressedOnce = false;
  private readonly rng = createRng("play-scene");
  private attack: AttackRunner | undefined;
  private attackAngle = 0;
  private swing!: Phaser.GameObjects.Graphics;
  private warn!: Phaser.GameObjects.Graphics;
  private hitStopLeft = 0;
  /** 技の使用の動作が終わる時刻（ミリ秒）。動作中は次の技を出せない */
  private busyUntil = 0;
  private readonly enemies: Enemy[] = [];
  private readonly views: EnemyView[] = [];
  private readonly clouds: Cloud[] = [];
  private readonly projectiles = new ProjectilePool();
  private readonly projectileGfx = new Map<object, Phaser.GameObjects.Arc>();
  private readonly telegraphs = new Map<Enemy, { shape: HitShape; angle: number }>();
  /** 戦士。HP・MPはLv1の基礎値（U-10 の経験値とLvで置き換える）。大剣・適性S・ジョブLv12（全技を使える試験用） */
  private readonly fighter = new Fighter({
    maxHp: 60,
    maxMp: 60,
    weapon: WEAPONS["greatsword"] ?? { name: "", min: 1, max: 1, speed: 1, crit: 0 },
    weaponClass: "greatsword",
    aptitude: "S",
    jobLevel: 12,
    skills: WARRIOR_SKILLS,
    gauge: FURY,
    stats: { 剛: 20 },
  });
  /** 技の枠と行動の対応（補助仕様書 1.1）。破軍は枠が足りないので、試験用に R に置く */
  private static readonly SLOTS: readonly [string, string][] = [
    ["skill2", "SKL-WAR-SWEEP"],
    ["skill3", "SKL-WAR-RIFT"],
    ["skill4", "SKL-WAR-SHOUT"],
    ["skill5", "SKL-WAR-CHARGE"],
    ["skill6", "SKL-WAR-WHIRL"],
  ];

  constructor() {
    super("play");
  }

  create(): void {
    this.add.grid(0, 0, 80 * M, 60 * M, M, M, 0x1d1c26, 1, 0x26253a, 1).setDepth(-10);
    this.swing = this.add.graphics().setDepth(4);
    this.warn = this.add.graphics().setDepth(0);
    this.body = this.add.rectangle(0, 0, 12, 18, 0x6fb1d8).setDepth(2);
    this.arrow = this.add.triangle(0, 0, 0, -3, 0, 3, 7, 0, 0xffffff).setDepth(3);
    this.hud = this.add
      .text(8, 8, "", { fontFamily: "monospace", fontSize: "9px", color: "#cfcde0" })
      .setScrollFactor(0)
      .setDepth(10);
    this.cameras.main.startFollow(this.body, true, 0.15, 0.15);

    // 試験用の配置：森狼の群れ・牙猪・棘吐き蜥蜴・樹皮熊・腐根の苗
    const place = (id: string, x: number, y: number, packId: string, level = 3): void => {
      for (const e of spawnPack({
        def: enemyDef(id),
        level,
        center: { x, y },
        rng: this.rng,
        packId,
      })) {
        this.addEnemy(e);
      }
    };
    place("ENM-FOREST-WOLF", 16, -4, "W1");
    place("ENM-FANG-BOAR", 14, 10, "B1");
    place("ENM-SPIT-LIZARD", 24, 2, "L1");
    place("ENM-BARK-BEAR", 30, -10, "R1");
    place("ENM-ROT-SPROUT", 12, 0, "S1");

    const keyboard = this.input.keyboard;
    if (keyboard) {
      keyboard.on("keydown", (e: KeyboardEvent) => {
        this.pressed.add(e.code);
        this.justPressed.add(e.code);
        if (e.code === "Space") this.dodgePressedOnce = true;
        e.preventDefault();
      });
      keyboard.on("keyup", (e: KeyboardEvent) => this.pressed.delete(e.code));
    }
    this.input.mouse?.disableContextMenu();
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      this.pressed.add(`Mouse${String(p.button)}`);
      this.justPressed.add(`Mouse${String(p.button)}`);
    });
    this.input.on("pointerup", (p: Phaser.Input.Pointer) =>
      this.pressed.delete(`Mouse${String(p.button)}`),
    );
    this.game.events.on(Phaser.Core.Events.BLUR, () => {
      this.pressed.clear();
    });

    document.body.dataset["stellaReady"] = "true";
  }

  private addEnemy(enemy: Enemy): void {
    const r = enemy.body.radius * M * 2;
    const color = ENEMY_COLORS[enemy.def.id] ?? 0x888888;
    const body = this.add.rectangle(0, 0, r, r * 1.3, color).setDepth(1);
    const facing = this.add.rectangle(0, 0, 4, 4, 0xffffff).setDepth(1);
    const hp = this.add.rectangle(0, 0, 16, 2, 0xd85a5a).setDepth(5);
    this.enemies.push(enemy);
    this.views.push({ enemy, body, facing, hp });
  }

  override update(_time: number, delta: number): void {
    const ticks = this.stepper.advance(delta);
    const actions = pressedActions(new Set([...this.pressed, ...this.justPressed]));
    const pointer = this.input.activePointer;
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    // ヒットストップ：短い間、ルールの時間を止める
    if (this.hitStopLeft > 0) {
      this.hitStopLeft -= delta / 1000;
      this.updateView();
      return;
    }
    for (let i = 0; i < ticks; i++) {
      this.fighter.tick(TICK_SECONDS);
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
      this.updateSkills(actions);
      this.updateAttack(actions.has("skill1"));
      this.updateEnemies();
      this.updateClouds();
      this.updateProjectiles();
    }
    if (ticks > 0) this.justPressed.clear();
    this.updateView();
  }

  private updateEnemies(): void {
    const target = {
      pos: this.player.pos,
      radius: 0.4,
      invulnerable: !canBeHit(this.player),
    };
    const events = stepEnemies(this.enemies, target, TICK_SECONDS, this.rng);
    for (const e of events) this.handleEnemyEvent(e);
    for (const enemy of this.enemies) {
      if (enemy.state !== "windup" || !enemy.attack) this.telegraphs.delete(enemy);
    }
  }

  private handleEnemyEvent(e: EnemyEvent): void {
    switch (e.type) {
      case "windup":
        this.telegraphs.set(e.enemy, { shape: e.attack.shape, angle: e.angle });
        break;
      case "hit":
        this.hurtPlayer(e.damage);
        break;
      case "projectile": {
        const p = this.projectiles.spawn({
          pos: e.pos,
          angle: e.angle,
          speed: e.attack.projectile?.speed ?? 8,
          radius: e.attack.projectile?.radius ?? 0.25,
          range: e.attack.projectile?.range ?? 10,
          payload: e.damage,
        });
        this.projectileGfx.set(p, this.add.circle(0, 0, 3, 0xb0e07a).setDepth(3));
        break;
      }
      case "cloud": {
        const radius = e.attack.cloud?.radius ?? 2.5;
        this.clouds.push({
          x: e.pos.x,
          y: e.pos.y,
          radius,
          left: e.attack.cloud?.seconds ?? 5,
          damage: e.damage,
          gfx: this.add.circle(e.pos.x * M, e.pos.y * M, radius * M, 0x7bd35a, 0.25).setDepth(0),
          tick: 0,
        });
        break;
      }
      default:
        break;
    }
  }

  private hurtPlayer(rawDamage: number): void {
    // 敵の命中に対するプレイヤーの回避値は今は0（装備の画面 U-12 で扱う）
    if (!canBeHit(this.player)) return;
    const dealt = this.fighter.takeDamage(rawDamage);
    this.cameras.main.shake(80, 0.002);
    this.showText(this.player.pos.x, this.player.pos.y, `-${dealt.toFixed(1)}`, "#ff8a8a", 9);
    if (this.fighter.hp <= 0) {
      // 仮実装: U-18a で、死亡時は町に戻る処理に置き換える
      this.fighter.hp = this.fighter.init.maxHp;
      this.player.pos.x = 0;
      this.player.pos.y = 0;
    }
  }

  private updateClouds(): void {
    for (const c of this.clouds) {
      c.left -= TICK_SECONDS;
      c.tick += TICK_SECONDS;
      const inside = Math.hypot(this.player.pos.x - c.x, this.player.pos.y - c.y) <= c.radius;
      if (inside && c.tick >= 1) {
        c.tick = 0;
        this.hurtPlayer(c.damage);
      }
      if (c.left <= 0) c.gfx.destroy();
    }
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      if ((this.clouds[i]?.left ?? 0) <= 0) this.clouds.splice(i, 1);
    }
  }

  private updateProjectiles(): void {
    const hits = this.projectiles.step(TICK_SECONDS, [
      { id: "PLAYER", pos: this.player.pos, radius: 0.4, hp: 1 },
    ]);
    for (const h of hits) this.hurtPlayer(Number(h.projectile.payload));
    for (const [p, gfx] of this.projectileGfx) {
      const proj = p as { active: boolean; pos: { x: number; y: number } };
      if (!proj.active) {
        gfx.destroy();
        this.projectileGfx.delete(p);
      } else {
        gfx.setPosition(proj.pos.x * M, proj.pos.y * M);
      }
    }
  }

  /** 技の枠のキーを押している間、使える状態になるたびに使う（補助仕様書 1.1） */
  private updateSkills(actions: ReadonlySet<string>): void {
    if (this.time.now < this.busyUntil || this.attack || isDodging(this.player)) return;
    const slots: [boolean, string][] = [
      ...PlayScene.SLOTS.map(([action, id]): [boolean, string] => [actions.has(action), id]),
      [this.pressed.has("KeyR") || this.justPressed.has("KeyR"), "SKL-WAR-RUIN"],
    ];
    for (const [held, id] of slots) {
      if (!held) continue;
      const out = this.fighter.use(
        id,
        this.player.pos,
        this.player.aimAngle,
        this.enemies.map((e) => e.body),
        this.rng,
      );
      if (!out.ok || !out.effective) continue;
      this.busyUntil = this.time.now + out.effective.skill.totalSeconds * 1000;
      if (out.movedTo) {
        this.player.pos.x = out.movedTo.x;
        this.player.pos.y = out.movedTo.y;
      }
      for (const { target, result } of out.hits) {
        this.onPlayerHit(target.id, result.damage, result.crit, result.back, result.feedback);
      }
      this.flashArea(out.effective.shape, this.player.aimAngle);
      break;
    }
  }

  private onPlayerHit(
    targetId: string,
    damage: number,
    crit: boolean,
    back: boolean,
    feedback: { hitStopSeconds: number; shake: number },
  ): void {
    this.hitStopLeft = Math.max(this.hitStopLeft, feedback.hitStopSeconds);
    this.cameras.main.shake(60, feedback.shake * 0.0008);
    const enemy = this.enemies.find((e) => e.body.id === targetId);
    if (!enemy) return;
    this.showText(
      enemy.body.pos.x,
      enemy.body.pos.y - 0.8,
      `${damage.toFixed(1)}${back ? "（背面）" : ""}`,
      crit ? "#ffd86b" : "#ffffff",
      crit ? 12 : 9,
    );
    alertPack(this.enemies, enemy);
  }

  private flashArea(shape: HitShape, angle: number): void {
    const cx = this.player.pos.x * M;
    const cy = this.player.pos.y * M;
    this.swing.clear();
    this.swing.fillStyle(0xffffff, 0.3);
    this.drawShape(this.swing, shape, cx, cy, angle);
    this.time.delayedCall(120, () => this.swing.clear());
  }

  private drawShape(
    g: Phaser.GameObjects.Graphics,
    shape: HitShape,
    cx: number,
    cy: number,
    angle: number,
  ): void {
    if (shape.kind === "cone") {
      const half = (shape.arcDegrees * Math.PI) / 360;
      g.slice(cx, cy, shape.range * M, angle - half, angle + half);
      g.fillPath();
    } else if (shape.kind === "circle") {
      g.fillCircle(cx, cy, shape.radius * M);
    } else {
      const w = shape.width * M;
      g.save();
      g.translateCanvas(cx, cy);
      g.rotateCanvas(angle);
      g.fillRect(0, -w / 2, shape.length * M, w);
      g.restore();
    }
  }

  /** 左クリックの通常攻撃（仮実装: 通常攻撃は技として扱う単位が決まったら置き換える） */
  private updateAttack(held: boolean): void {
    const weapon = WEAPONS["greatsword"];
    if (!weapon) return;
    if (!this.attack && held && !isDodging(this.player) && this.time.now >= this.busyUntil) {
      this.attack = new AttackRunner(basicAttackTiming(this.fighter.attackSpeed));
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
          generic: { addPct: 0.004 * 20 },
        },
        weaponCrit: weapon.crit,
        accuracy: 100,
      };
      for (const { target, result } of strike(
        this.player.pos,
        this.attackAngle,
        this.enemies.map((e) => e.body),
        spec,
        this.rng,
      )) {
        if (result.hit) this.fighter.gauge.onHit(false);
        this.onPlayerHit(target.id, result.damage, result.crit, result.back, result.feedback);
      }
      this.flashArea(spec.shape, this.attackAngle);
    }
    if (this.attack.done) this.attack = undefined;
  }

  private showText(x: number, y: number, label: string, color: string, size: number): void {
    const t = this.add
      .text(x * M, y * M - 14, label, {
        fontFamily: "monospace",
        fontSize: `${String(size)}px`,
        color,
      })
      .setOrigin(0.5)
      .setDepth(8);
    this.tweens.add({
      targets: t,
      y: t.y - 18,
      alpha: 0,
      duration: 600,
      onComplete: () => {
        t.destroy();
      },
    });
  }

  private updateView(): void {
    this.body.setPosition(this.player.pos.x * M, this.player.pos.y * M);
    // 見た目の向きは8方向に丸める（照準自体は自由な角度）
    const angle = (facing8(this.player.aimAngle) * Math.PI) / 4;
    this.arrow.setPosition(this.body.x + Math.cos(angle) * 12, this.body.y + Math.sin(angle) * 12);
    this.arrow.setRotation(angle);
    this.body.setFillStyle(isDodging(this.player) && !canBeHit(this.player) ? 0xffffff : 0x6fb1d8);
    this.body.setAlpha(isDodging(this.player) ? 0.6 : 1);

    this.warn.clear();
    for (const v of this.views) {
      const e = v.enemy;
      const alive = e.body.hp > 0;
      v.body.setVisible(alive);
      v.facing.setVisible(alive && e.def.noFacing !== true);
      v.hp.setVisible(alive);
      if (!alive) continue;
      v.body.setPosition(e.body.pos.x * M, e.body.pos.y * M);
      v.body.setFillStyle(e.state === "down" ? 0xd8c36f : (ENEMY_COLORS[e.def.id] ?? 0x888888));
      v.facing.setPosition(
        e.body.pos.x * M + Math.cos(e.body.facing) * e.body.radius * M,
        e.body.pos.y * M + Math.sin(e.body.facing) * e.body.radius * M,
      );
      v.hp.setPosition(e.body.pos.x * M, e.body.pos.y * M - e.body.radius * M * 1.6);
      v.hp.setScale(Math.max(0, e.body.hp / e.body.maxHp), 1);
    }
    // 予兆：地面の範囲表示
    for (const [enemy, t] of this.telegraphs) {
      this.warn.fillStyle(0xff4a4a, 0.3);
      this.drawShape(this.warn, t.shape, enemy.body.pos.x * M, enemy.body.pos.y * M, t.angle);
    }

    this.hud.setText(
      `HP ${String(Math.ceil(this.fighter.hp))}/${String(this.fighter.init.maxHp)}  MP ${String(Math.floor(this.fighter.mp))}/${String(this.fighter.init.maxMp)}  闘志 ${String(Math.floor(this.fighter.gauge.value))}${this.fighter.gauge.intensified ? "（激化）" : ""}  気力 ${String(Math.floor(this.player.stamina))}/${String(PLAYER.staminaMax)}\nWASD 移動 / マウス 照準 / 左 通常攻撃・右 薙ぎ払い・1 地割り・2 戦吼・3 突進・4 旋風・R 破軍 / Space 回避\n敵の命中 ${String(enemyAccuracy(3))}（Lv3）`,
    );
  }
}
