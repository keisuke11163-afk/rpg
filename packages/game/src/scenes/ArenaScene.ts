// 仮実装: U-18a feature/town-and-dungeon-base で、町とダンジョンの地図に置き換える（試験用の場）
import Phaser from "phaser";
import {
  ActionTimeline,
  Combatant,
  type ContentDb,
  type DamageAttacker,
  type DamageSkill,
  FixedStepClock,
  Health,
  type HitReport,
  type HitShape,
  PlayerMotion,
  ProjectilePool,
  Rng,
  TagIndex,
  baseAccuracy,
  evaluateEffects,
  length,
  overlapsShape,
  playerAttackTimeline,
  resolveHit,
  staggerProfiles,
} from "@stella/core";
import { loadGameContent } from "@stella/content";
import { SCREEN } from "../config.ts";
import { exposeDebug } from "../debug.ts";
import { InputSystem } from "../input/InputSystem.ts";
import { TEXTURES } from "../world/placeholders.ts";
import { PIXELS_PER_METER, toMeters, toPixels } from "../world/units.ts";

/** 試験用の場の大きさ（m）。 */
const ARENA = { width: 40, height: 24 };

/**
 * 回避の無敵時間を確かめるための「試験用の危険地帯」。
 * 2秒ごとに0.6秒の予兆（枠だけ）を出し、その後0.2秒だけ当たり判定が出る。
 */
const HAZARD = { x: 30, y: 5, radius: 2.5, period: 2, telegraph: 0.6, active: 0.2 };

// 仮実装: U-08 feature/warrior で、ジョブ・初期装備・技のデータに置き換える（試験用の武器と技）
const TEST_WEAPON = {
  uid: "test-longsword",
  tags: ["TAG-WPN-SWORD"],
  base: { physical: { min: 6, max: 11 } },
  critChance: 0.05,
  attackSpeed: 1.4,
};
const BASIC_ATTACK: DamageSkill = { tags: ["TAG-FORM-MELEE"], kind: "weapon", pct: 1.0 };
/** 通常攻撃の当たり判定（補助仕様書3.6：扇形90°・1.6m）。 */
const BASIC_SHAPE: HitShape = { type: "sector", radius: 1.6, angleDeg: 90 };
const TEST_PROJECTILE_SKILL: DamageSkill = {
  tags: ["TAG-FORM-PROJECTILE"],
  kind: "weapon",
  pct: 1.0,
};

/** ヒットの手応え：止まる時間（秒）と、白く光る時間。 */
const HIT_STOP = 0.05;
const FLASH = 0.08;

export class ArenaScene extends Phaser.Scene {
  private db!: ContentDb;
  private motion!: PlayerMotion;
  private controls!: InputSystem;
  private readonly clock = new FixedStepClock();
  private readonly rng = Rng.fromSeed("arena");
  private attacker!: DamageAttacker;
  private playerHealth!: Health;
  private mp = 60;
  private readonly maxMp = 60;
  private dummy!: Combatant;
  private attack: ActionTimeline | undefined;
  private readonly projectiles = new ProjectilePool<{
    skill: DamageSkill;
    origin: { x: number; y: number };
  }>(64);
  private hitStop = 0;
  private flash = 0;
  private time0 = 0;
  private hazardHits = 0;
  private hazardAvoided = 0;
  private hazardResolved = -1;
  private lastHit: HitReport | undefined;
  private hitCount = 0;
  private shotsFired = 0;
  private readonly recentDamage: { t: number; amount: number }[] = [];

  private body!: Phaser.GameObjects.Image;
  private facing!: Phaser.GameObjects.Image;
  private dummyImage!: Phaser.GameObjects.Image;
  private dummyFacing!: Phaser.GameObjects.Image;
  private fx!: Phaser.GameObjects.Graphics;
  private projectileImages: Phaser.GameObjects.Image[] = [];
  private hud!: Phaser.GameObjects.Text;
  private bars!: Phaser.GameObjects.Graphics;

  constructor() {
    super("arena");
  }

  create(): void {
    this.db = loadGameContent();
    const { view } = evaluateEffects(this.db, new TagIndex(this.db.tags), [], {
      baseStats: { "STAT-ACCURACY": baseAccuracy(1, 10) },
    });
    this.attacker = { db: this.db, view, characterLevel: 1, weapon: TEST_WEAPON };
    this.playerHealth = new Health({ maxHp: 60 });

    this.add
      .tileSprite(0, 0, toPixels(ARENA.width), toPixels(ARENA.height), TEXTURES.floor)
      .setOrigin(0, 0);
    this.fx = this.add.graphics();
    this.motion = new PlayerMotion({ x: 12, y: 12 }, undefined, {
      minX: 0.5,
      minY: 0.75,
      maxX: ARENA.width - 0.5,
      maxY: ARENA.height - 0.25,
    });
    this.dummy = new Combatant(this.db, {
      id: "dummy",
      team: "enemy",
      position: { x: 20, y: 12 },
      radius: 0.5,
      facing: Math.PI, // 左（プレイヤーの方）を向く
      maxHp: 5000,
      staggerProfile: staggerProfiles(this.db).enemy,
    });
    // 位置は体の中心（照準を合わせた所に当たるように。docs/progress D-U07-4）
    this.dummyImage = this.add
      .image(toPixels(20), toPixels(12), TEXTURES.dummy)
      .setOrigin(0.5, 0.5);
    this.dummyFacing = this.add
      .image(toPixels(20), toPixels(12), TEXTURES.facing)
      .setOrigin(-0.6, 0.5)
      .setRotation(Math.PI)
      .setTint(0xa07850);
    this.body = this.add.image(0, 0, TEXTURES.player).setOrigin(0.5, 0.5);
    this.facing = this.add.image(0, 0, TEXTURES.facing).setOrigin(-0.6, 0.5);
    for (let i = 0; i < this.projectiles.capacity; i++) {
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
        x: this.motion.position.x,
        y: this.motion.position.y,
        direction8: this.motion.direction8,
        stamina: this.motion.currentStamina,
        dodging: this.motion.dodging,
        invulnerable: this.motion.invulnerable,
        // 画面の上の位置（ゲームのピクセル。カメラの位置を引いたもの）
        screenX: this.body.x - this.cameras.main.scrollX,
        screenY: this.body.y - this.cameras.main.scrollY,
      }),
      hazard: () => ({
        hits: this.hazardHits,
        avoided: this.hazardAvoided,
        phase: this.time0 % HAZARD.period,
        x: HAZARD.x,
        y: HAZARD.y,
      }),
      dummy: () => ({
        x: this.dummy.position.x,
        y: this.dummy.position.y,
        hp: this.dummy.health.hp,
        maxHp: this.dummy.health.maxHp,
        hits: this.hitCount,
        lastDamage: this.lastHit?.hit.total ?? 0,
        lastCrit: this.lastHit?.hit.crit ?? false,
        lastBackstab: this.lastHit?.backstab ?? false,
        shotsFired: this.shotsFired,
        projectilesActive: this.projectiles.active,
        projectilePositions: this.projectiles
          .positions()
          .map((p) => [p.position.x, p.position.y, p.direction.x, p.direction.y]),
        screenX: this.dummyImage.x - this.cameras.main.scrollX,
        screenY: this.dummyImage.y - this.cameras.main.scrollY,
      }),
    });
    document.body.dataset["stellaReady"] = "true";
  }

  override update(_time: number, deltaMs: number): void {
    const frame = this.controls.read();
    const { steps } = this.clock.advance(deltaMs / 1000);
    for (let i = 0; i < steps; i++) {
      const dt = this.clock.stepSeconds;
      this.flash = Math.max(0, this.flash - dt);
      // ヒットの手応え：ヒットの瞬間に、ほんの少しだけ止める
      if (this.hitStop > 0) {
        this.hitStop -= dt;
        continue;
      }
      const pos = this.motion.position;
      const aim = {
        x: toMeters(frame.pointerWorld.x) - pos.x,
        y: toMeters(frame.pointerWorld.y) - pos.y,
      };
      const first = i === 0;
      const dodge = first && frame.pressed.has("dodge");
      if (dodge) this.attack = undefined; // 回避で攻撃を取り消せる

      // 攻撃の間は、その場に止まる（docs/progress D-U07-2）
      const attacking = this.attack !== undefined;
      this.motion.update(dt, { move: attacking ? { x: 0, y: 0 } : frame.move, aim, dodge });

      // 押し続けている間は繰り返し使う（補助仕様書1.1）。素早いクリックも取りこぼさない
      const wantsAttack = frame.held.has("skill1") || (first && frame.pressed.has("skill1"));
      if (!attacking && !this.motion.dodging && wantsAttack) {
        this.attack = new ActionTimeline(playerAttackTimeline(1 / TEST_WEAPON.attackSpeed));
      }
      if (this.attack !== undefined) {
        const e = this.attack.update(dt);
        if (e.activeStarted) this.swing();
        if (e.finished) this.attack = undefined;
      }
      if (first && frame.pressed.has("skill2") && !this.motion.dodging) this.fireTestProjectile();

      for (const hit of this.projectiles.update(dt, [
        {
          id: this.dummy.id,
          team: this.dummy.team,
          position: this.dummy.position,
          radius: this.dummy.radius,
        },
      ])) {
        this.applyHit(hit.payload.skill, hit.payload.origin);
      }

      const dot = this.dummy.update(dt);
      if (dot > 0) this.recentDamage.push({ t: this.time0, amount: dot });
      this.playerHealth.update(dt);
      this.mp = Math.min(this.maxMp, this.mp + this.maxMp * 0.06 * dt);
      this.time0 += dt;
      this.updateHazard();
      if (this.dummy.health.hp < this.dummy.health.maxHp * 0.2) this.dummy.health.restoreFull();
    }
    this.render();
  }

  private swing(): void {
    if (
      overlapsShape(
        BASIC_SHAPE,
        this.motion.position,
        this.motion.facing,
        this.dummy.position,
        this.dummy.radius,
      )
    ) {
      this.applyHit(BASIC_ATTACK, this.motion.position);
    }
  }

  private fireTestProjectile(): void {
    this.shotsFired += 1;
    const origin = this.motion.position;
    this.projectiles.spawn({
      position: origin,
      direction: { x: Math.cos(this.motion.facing), y: Math.sin(this.motion.facing) },
      speed: 12,
      range: 12,
      radius: 0.15,
      pierce: 0,
      team: "player",
      payload: { skill: TEST_PROJECTILE_SKILL, origin },
    });
  }

  private applyHit(skill: DamageSkill, from: { x: number; y: number }): void {
    const report = resolveHit({
      db: this.db,
      attacker: this.attacker,
      attackerPosition: from,
      skill,
      target: this.dummy,
      rng: this.rng,
    });
    this.lastHit = report;
    if (report.hit.evaded) return;
    this.hitCount += 1;
    this.recentDamage.push({ t: this.time0, amount: report.hit.total });
    this.hitStop = HIT_STOP;
    this.flash = FLASH;
    if (report.hit.crit) this.cameras.main.shake(80, 0.004);
    this.popDamage(report);
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

  private updateHazard(): void {
    const cycle = Math.floor(this.time0 / HAZARD.period);
    const t = this.time0 - cycle * HAZARD.period;
    const active = t >= HAZARD.telegraph && t < HAZARD.telegraph + HAZARD.active;
    if (!active || this.hazardResolved === cycle) return;
    const p = this.motion.position;
    if (length({ x: p.x - HAZARD.x, y: p.y - HAZARD.y }) > HAZARD.radius) return;
    // 当たり判定が出ている間に1回だけ判定する。回避の無敵時間なら無効
    this.hazardResolved = cycle;
    if (this.motion.invulnerable) this.hazardAvoided += 1;
    else {
      this.hazardHits += 1;
      this.playerHealth.takeDamage(5);
      if (this.playerHealth.dead) this.playerHealth.restoreFull();
    }
  }

  private dps(): number {
    while ((this.recentDamage[0]?.t ?? Infinity) < this.time0 - 5) this.recentDamage.shift();
    return this.recentDamage.reduce((s, d) => s + d.amount, 0) / 5;
  }

  private render(): void {
    const p = this.motion.position;
    const x = Math.round(toPixels(p.x));
    const y = Math.round(toPixels(p.y));
    this.body.setPosition(x, y).setAlpha(this.motion.invulnerable ? 0.5 : 1);
    this.facing.setPosition(x, y).setRotation((this.motion.direction8 * Math.PI) / 4);
    // Phaser 4 では setTintFill が無くなり、setTint ＋ setTintMode で白く光らせる
    if (this.flash > 0) this.dummyImage.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    else this.dummyImage.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
    this.dummyFacing.setVisible(true);

    const g = this.fx.clear();
    const t = this.time0 % HAZARD.period;
    const hx = toPixels(HAZARD.x);
    const hy = toPixels(HAZARD.y);
    const r = HAZARD.radius * PIXELS_PER_METER;
    if (t < HAZARD.telegraph) g.lineStyle(1, 0xff6b6b, 0.4 + t).strokeCircle(hx, hy, r);
    else if (t < HAZARD.telegraph + HAZARD.active) g.fillStyle(0xff6b6b, 0.5).fillCircle(hx, hy, r);
    // 攻撃の当たり判定（当たり判定が出ている間だけ）
    if (this.attack?.phase === "active") {
      const half = (BASIC_SHAPE.type === "sector" ? BASIC_SHAPE.angleDeg : 90) / 2;
      const rad = (BASIC_SHAPE.type === "sector" ? BASIC_SHAPE.radius : 1) * PIXELS_PER_METER;
      g.fillStyle(0xffffff, 0.25)
        .slice(
          x,
          y,
          rad,
          this.motion.facing - (half * Math.PI) / 180,
          this.motion.facing + (half * Math.PI) / 180,
        )
        .fillPath();
    }
    // 人形のHP
    const dx = this.dummyImage.x - 12;
    const dy = this.dummyImage.y - 18;
    g.fillStyle(0x2a2934, 1)
      .fillRect(dx, dy, 24, 3)
      .fillStyle(0xff6b6b, 1)
      .fillRect(dx, dy, Math.round((24 * this.dummy.health.hp) / this.dummy.health.maxHp), 3);

    this.projectileImages.forEach((img) => img.setVisible(false));
    for (const pr of this.projectiles.positions()) {
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
    bar(0, this.playerHealth.hp / this.playerHealth.maxHp, 0xff6b6b);
    bar(1, this.mp / this.maxMp, 0x6fa8ff);
    bar(2, this.motion.currentStamina / this.motion.config.maxStamina, 0x7bd389);

    const last = this.lastHit;
    this.hud.setText([
      "試験用の場（WASD移動・マウス照準・左クリック通常攻撃・右クリック試験用の投射物・スペース回避）",
      `人形：HP ${this.dummy.health.hp.toFixed(0)}／${this.dummy.health.maxHp.toFixed(0)}・DPS ${this.dps().toFixed(1)}・ヒット ${String(this.hitCount)}`,
      last === undefined
        ? "最後のヒット：なし"
        : `最後のヒット：${last.hit.evaded ? "回避された" : `${last.hit.total.toFixed(1)}${last.hit.crit ? "・会心" : ""}${last.backstab ? "・背面" : ""}`}`,
      `危険地帯：被弾 ${String(this.hazardHits)}／回避で無効 ${String(this.hazardAvoided)}`,
      `HP ${this.playerHealth.hp.toFixed(0)}・MP ${this.mp.toFixed(0)}・気力 ${this.motion.currentStamina.toFixed(0)}`,
    ]);
  }
}
