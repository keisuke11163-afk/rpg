// 仮実装: U-18a feature/town-and-dungeon-base で、町とダンジョンの地図に置き換える（試験用の場の計算）
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
  StepInputBuffer,
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
import type { Action } from "../input/actions.ts";
import type { InputFrame } from "../input/frame.ts";
import { toMeters } from "../world/units.ts";

/** 試験用の場の大きさ（m）。 */
export const ARENA = { width: 40, height: 24 } as const;

/**
 * 回避の無敵時間を確かめるための「試験用の危険地帯」。
 * 2秒ごとに0.6秒の予兆（枠だけ）を出し、その後0.2秒だけ当たり判定が出る。
 */
export const HAZARD = {
  x: 30,
  y: 5,
  radius: 2.5,
  period: 2,
  telegraph: 0.6,
  active: 0.2,
} as const;

/** 訓練用の人形の位置（m）。 */
export const DUMMY_POSITION = { x: 20, y: 12 } as const;

// 仮実装: U-08 feature/warrior で、ジョブ・初期装備・技のデータに置き換える（試験用の武器と技）
export const TEST_WEAPON = {
  uid: "test-longsword",
  tags: ["TAG-WPN-SWORD"],
  base: { physical: { min: 6, max: 11 } },
  critChance: 0.05,
  attackSpeed: 1.4,
};
const BASIC_ATTACK: DamageSkill = { tags: ["TAG-FORM-MELEE"], kind: "weapon", pct: 1.0 };
/** 通常攻撃の当たり判定（補助仕様書3.6：扇形90°・1.6m）。 */
export const BASIC_SHAPE: HitShape = { type: "sector", radius: 1.6, angleDeg: 90 };
const TEST_PROJECTILE_SKILL: DamageSkill = {
  tags: ["TAG-FORM-PROJECTILE"],
  kind: "weapon",
  pct: 1.0,
};

/** ヒットの手応え：止まる時間（秒）と、白く光る時間。 */
const HIT_STOP = 0.05;
const FLASH = 0.08;

/**
 * 計算の刻みで使う「押した瞬間」の行動。これ以外の押した瞬間の入力は保持しない
 * （まだ使わない行動を保持し続けて、後で古い入力が発動するのを防ぐ）。
 * 回避（U-06）に加えて、通常攻撃（skill1）と試験用の投射物（skill2）を保持する（U-07）。
 */
const STEP_ACTIONS = ["dodge", "skill1", "skill2"] as const satisfies readonly Action[];
type StepAction = (typeof STEP_ACTIONS)[number];

export interface ArenaSimulationOptions {
  /** ゲームのデータ（既定は loadGameContent()）。 */
  db?: ContentDb;
  /** 人形へのヒットを解決したときに呼ぶ（表示の手応え用。回避されたヒットは呼ばない）。 */
  onHit?: (report: HitReport) => void;
}

/**
 * 試験用の場の計算（Phaser に依存しない。ArenaScene が描画のフレームごとに呼ぶ）。
 *
 * 入力の流れ：
 * 1. 取得：ArenaScene が InputSystem でフレームの入力を読み、{@link frame} に渡す
 * 2. 保持：押した瞬間の入力（回避・通常攻撃・試験用の投射物）は {@link StepInputBuffer} に入れ、
 *    刻みで使われるまで残す
 * 3. 消費：各刻みが取り出す。刻みが0のフレームやヒットの手応えで止まっている刻みでは取り出されず、
 *    次に進む刻みに持ち越す
 *
 * 押し続けの入力（移動・照準・通常攻撃の押し続け）は、そのフレームの値を、そのフレームの全ての刻みに渡す。
 */
export class ArenaSimulation {
  readonly motion: PlayerMotion;
  readonly clock: FixedStepClock;
  readonly db: ContentDb;
  readonly dummy: Combatant;
  readonly playerHealth: Health;
  readonly maxMp = 60;
  readonly projectiles = new ProjectilePool<{
    skill: DamageSkill;
    origin: { x: number; y: number };
  }>(64);
  private readonly stepInput = new StepInputBuffer<StepAction>();
  private readonly rng = Rng.fromSeed("arena");
  private readonly attacker: DamageAttacker;
  private readonly onHit: ((report: HitReport) => void) | undefined;
  private attackTimeline: ActionTimeline | undefined;
  private mpValue = 60;
  private hitStopLeft = 0;
  private flashLeft = 0;
  private elapsed = 0;
  private hits = 0;
  private avoided = 0;
  private resolvedCycle = -1;
  private lastReport: HitReport | undefined;
  private dummyHits = 0;
  private shots = 0;
  private readonly recentDamage: { t: number; amount: number }[] = [];

  constructor(clock: FixedStepClock = new FixedStepClock(), options: ArenaSimulationOptions = {}) {
    this.clock = clock;
    this.db = options.db ?? loadGameContent();
    this.onHit = options.onHit;
    const { view } = evaluateEffects(this.db, new TagIndex(this.db.tags), [], {
      baseStats: { "STAT-ACCURACY": baseAccuracy(1, 10) },
    });
    this.attacker = { db: this.db, view, characterLevel: 1, weapon: TEST_WEAPON };
    this.playerHealth = new Health({ maxHp: 60 });
    this.motion = new PlayerMotion({ x: 12, y: 12 }, undefined, {
      minX: 0.5,
      minY: 0.75,
      maxX: ARENA.width - 0.5,
      maxY: ARENA.height - 0.25,
    });
    this.dummy = new Combatant(this.db, {
      id: "dummy",
      team: "enemy",
      position: { ...DUMMY_POSITION },
      radius: 0.5,
      facing: Math.PI, // 左（プレイヤーの方）を向く
      maxHp: 5000,
      staggerProfile: staggerProfiles(this.db).enemy,
    });
  }

  /** 計算を進めた時間の合計（秒）。ヒットの手応えで止まっている間は進まない。 */
  get time(): number {
    return this.elapsed;
  }
  get hazardHits(): number {
    return this.hits;
  }
  get hazardAvoided(): number {
    return this.avoided;
  }
  /** 回避の入力を保持していて、まだどの刻みにも渡していないか。 */
  get dodgePending(): boolean {
    return this.stepInput.has("dodge");
  }
  /** 通常攻撃の押した瞬間の入力を保持していて、まだどの刻みにも渡していないか。 */
  get attackPending(): boolean {
    return this.stepInput.has("skill1");
  }
  /** 試験用の投射物の押した瞬間の入力を保持していて、まだどの刻みにも渡していないか。 */
  get shotPending(): boolean {
    return this.stepInput.has("skill2");
  }
  /** 進行中の通常攻撃（なければ undefined）。 */
  get attack(): ActionTimeline | undefined {
    return this.attackTimeline;
  }
  get mp(): number {
    return this.mpValue;
  }
  /** 白く光らせる残りの時間（秒）。 */
  get flash(): number {
    return this.flashLeft;
  }
  get lastHit(): HitReport | undefined {
    return this.lastReport;
  }
  /** 人形に当たったヒットの数（回避されたものを除く）。 */
  get hitCount(): number {
    return this.dummyHits;
  }
  get shotsFired(): number {
    return this.shots;
  }

  /**
   * 描画の1フレーム分を進める。
   * @param deltaSeconds 前のフレームからの経過時間（秒）
   * @returns この呼び出しで進めた刻みの数
   */
  frame(deltaSeconds: number, input: InputFrame): number {
    // 時間の検証を先に行う（例外のときに入力だけが残らないように）
    const { steps } = this.clock.advance(deltaSeconds);
    this.stepInput.press(STEP_ACTIONS.filter((a) => input.pressed.has(a)));
    for (let i = 0; i < steps; i++) this.step(input);
    return steps;
  }

  /** 直近5秒のDPS（表示用）。 */
  dps(): number {
    while ((this.recentDamage[0]?.t ?? Infinity) < this.elapsed - 5) this.recentDamage.shift();
    return this.recentDamage.reduce((s, d) => s + d.amount, 0) / 5;
  }

  private step(input: InputFrame): void {
    const dt = this.clock.stepSeconds;
    this.flashLeft = Math.max(0, this.flashLeft - dt);
    // ヒットの手応え：ヒットの瞬間に、ほんの少しだけ止める（押した瞬間の入力は保持したまま）
    if (this.hitStopLeft > 0) {
      this.hitStopLeft -= dt;
      return;
    }
    const pos = this.motion.position;
    const aim = {
      x: toMeters(input.pointerWorld.x) - pos.x,
      y: toMeters(input.pointerWorld.y) - pos.y,
    };
    // 保持している押した瞬間の入力は、最初に進んだ刻みで取り出され、以降の刻みには渡らない
    const dodge = this.stepInput.take("dodge");
    const attackPressed = this.stepInput.take("skill1");
    const shotPressed = this.stepInput.take("skill2");
    if (dodge) this.attackTimeline = undefined; // 回避で攻撃を取り消せる

    // 攻撃の間は、その場に止まる（docs/progress D-U07-2）
    const attacking = this.attackTimeline !== undefined;
    this.motion.update(dt, { move: attacking ? { x: 0, y: 0 } : input.move, aim, dodge });

    // 押し続けている間は繰り返し使う（補助仕様書1.1）。素早いクリックも取りこぼさない
    const wantsAttack = input.held.has("skill1") || attackPressed;
    if (!attacking && !this.motion.dodging && wantsAttack) {
      this.attackTimeline = new ActionTimeline(playerAttackTimeline(1 / TEST_WEAPON.attackSpeed));
    }
    if (this.attackTimeline !== undefined) {
      const e = this.attackTimeline.update(dt);
      if (e.activeStarted) this.swing();
      if (e.finished) this.attackTimeline = undefined;
    }
    if (shotPressed && !this.motion.dodging) this.fireTestProjectile();

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
    if (dot > 0) this.recentDamage.push({ t: this.elapsed, amount: dot });
    this.playerHealth.update(dt);
    this.mpValue = Math.min(this.maxMp, this.mpValue + this.maxMp * 0.06 * dt);
    this.elapsed += dt;
    this.updateHazard();
    if (this.dummy.health.hp < this.dummy.health.maxHp * 0.2) this.dummy.health.restoreFull();
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
    this.shots += 1;
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
    this.lastReport = report;
    if (report.hit.evaded) return;
    this.dummyHits += 1;
    this.recentDamage.push({ t: this.elapsed, amount: report.hit.total });
    this.hitStopLeft = HIT_STOP;
    this.flashLeft = FLASH;
    this.onHit?.(report);
  }

  private updateHazard(): void {
    const cycle = Math.floor(this.elapsed / HAZARD.period);
    const t = this.elapsed - cycle * HAZARD.period;
    const active = t >= HAZARD.telegraph && t < HAZARD.telegraph + HAZARD.active;
    if (!active || this.resolvedCycle === cycle) return;
    const p = this.motion.position;
    const inside = length({ x: p.x - HAZARD.x, y: p.y - HAZARD.y }) <= HAZARD.radius;
    if (!inside) return;
    // 当たり判定が出ている間に1回だけ判定する。回避の無敵時間なら無効
    this.resolvedCycle = cycle;
    if (this.motion.invulnerable) this.avoided += 1;
    else {
      this.hits += 1;
      this.playerHealth.takeDamage(5);
      if (this.playerHealth.dead) this.playerHealth.restoreFull();
    }
  }
}
