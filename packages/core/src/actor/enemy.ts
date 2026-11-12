import type { EnemyAttackDef, EnemyDef, EnemyRankDef } from "../content/enemy.ts";
import type { ContentDb } from "../content/load.ts";
import { type AilmentApplication, staggerProfiles } from "../combat/ailments.ts";
import { Combatant, type CombatantUpdatePlan } from "../combat/combatant.ts";
import type { DamageAttacker } from "../combat/damage.ts";
import { enemyAccuracy } from "../combat/defense.ts";
import type { HitShape } from "../combat/shapes.ts";
import { normalEnemyHp, standardHp } from "../combat/standards.ts";
import { Cooldowns } from "../combat/skills.ts";
import { evaluateEffects, type ModifierView } from "../effects/evaluate.ts";
import { TagIndex } from "../effects/tag-index.ts";
import type { Rng } from "../random/rng.ts";
import type { Bounds } from "./player-motion.ts";
import { type Vec2, ZERO, add, length, normalize, scale } from "./vector.ts";

/** 行動の流れの決まり（補助仕様書10.2【正式】）。 */
export const ENEMY_RULES = {
  /** 視界：前方180°・8m。 */
  sightAngleDeg: 180,
  sightRange: 8,
  /** 同じ群れの仲間が気づく距離。 */
  alertRadius: 10,
  /** 出現地点からこれ以上離れると帰る。 */
  leashDistance: 20,
} as const;

/**
 * 待機中にうろつく動き（仮値: 補助仕様書10.2「その場をうろつく」に数値がないため。docs/progress D-U09-2）。
 * 出現地点から半径2m以内の点へ、移動の速さの40%で歩き、1〜3秒止まる。
 */
export const WANDER = { radius: 2, speedRatio: 0.4, pauseMin: 1, pauseMax: 3 } as const;

/**
 * 回り込み（仮値: 補助仕様書10.4「横や背後へ回り込む」に数値がないため。docs/progress D-U09-3）。
 * 目指す角度から60°以内に回り込むか、追跡を始めて3秒たつまでは攻撃しない。1回に45°ずつ回る。
 */
export const FLANK = { attackWithinDeg: 60, giveUpSeconds: 3, stepDeg: 45 } as const;

/** 帰還したとみなす距離（m）。 */
const HOME_DISTANCE = 0.3;

export type EnemyState =
  | "idle" // 待機（うろつく）
  | "chase" // 追跡
  | "windup" // 攻撃の準備（予兆）
  | "active" // 攻撃（当たり判定）
  | "recovery" // 硬直
  | "return" // 帰還
  | "down" // ダウン（崩れ）
  | "dead";

/** 敵が見る、相手（プレイヤー）の状態。 */
export interface EnemyTarget {
  readonly position: Vec2;
  readonly radius: number;
  /** 相手の向き（回り込みに使う）。 */
  readonly facing: number;
  /** 狙える状態か（倒れている間などは false）。 */
  readonly targetable: boolean;
}

/** 敵の行動で起きたこと。呼び出す側が、当たり判定・投射物・雲を処理する。 */
export type EnemyEvent =
  | { readonly type: "noticed" }
  | {
      readonly type: "strike";
      readonly attack: EnemyAttackDef;
      readonly shape: HitShape;
      readonly origin: Vec2;
      readonly facing: number;
      /** 同じ group の当たり判定は、1回の攻撃で相手に1回だけ当たる（突進）。 */
      readonly group?: string;
    }
  | {
      readonly type: "projectile";
      readonly attack: EnemyAttackDef;
      readonly origin: Vec2;
      readonly direction: Vec2;
      readonly speed: number;
      readonly range: number;
      readonly radius: number;
    }
  | {
      readonly type: "cloud";
      readonly attack: EnemyAttackDef;
      readonly center: Vec2;
      readonly radius: number;
      readonly duration: number;
      readonly interval: number;
      /** 中にいる相手に、間隔ごとに付ける状態異常。 */
      readonly application: AilmentApplication;
    }
  | { readonly type: "returned" };

export interface EnemyInit {
  readonly id: string;
  readonly def: EnemyDef;
  readonly rank: EnemyRankDef;
  readonly level: number;
  readonly position: Vec2;
  /** 群れのID（同じ群れの仲間が気づくために使う）。 */
  readonly packId: string;
  /** 群れの中の順番（回り込む角度に使う）。 */
  readonly packIndex: number;
  /** 最初の向き（ラジアン）。 */
  readonly facing?: number;
}

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** 角度の差（-π〜π）。 */
export function angleDiff(from: number, to: number): number {
  let d = (to - from) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** 向きを、決まった速さで目標の向きへ回す。 */
export function turnTowards(current: number, target: number, maxDelta: number): number {
  const d = angleDiff(current, target);
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

/** 回り込む角度（相手の向きからの差）。群れの中の順番で、背後・左右の後ろ・横に分ける。 */
const FLANK_ANGLES = [180, 130, -130, 90, -90].map(toRad);

/**
 * 敵1体（補助仕様書10章）：戦う者（HP・状態異常・崩し）と、行動の流れ（10.2）。
 * 同じ入力・同じ乱数なら、同じ動きをする。
 */
export class Enemy {
  readonly id: string;
  readonly def: EnemyDef;
  readonly rank: EnemyRankDef;
  readonly level: number;
  readonly packId: string;
  readonly packIndex: number;
  readonly spawn: Vec2;
  readonly combatant: Combatant;
  readonly cooldowns = new Cooldowns();
  private stateValue: EnemyState = "idle";
  private stateTime = 0;
  private attack: EnemyAttackDef | undefined;
  /** 雲を出す場所（予兆の始めに決める）。 */
  private attackPoint: Vec2 = ZERO;
  private dashTravelled = 0;
  private wanderTarget: Vec2 | undefined;
  private wanderPause = 0;
  private facingAngle: number;
  private readonly db: ContentDb;
  /** 雲の攻撃で付ける状態異常（攻撃 → 付けるもの）。作るときに計算し、検証しておく。 */
  private readonly cloudApplications = new Map<EnemyAttackDef, AilmentApplication>();
  /** 1秒あたりに動く距離の上限（移動・うろつき・帰還・突進のうち最も速いもの）。 */
  private readonly maxSpeed: number;
  /** 最後の刻みで受けた持続ダメージ。 */
  dotTaken = 0;

  constructor(db: ContentDb, init: EnemyInit) {
    this.db = db;
    this.id = init.id;
    this.def = init.def;
    this.rank = init.rank;
    this.level = init.level;
    this.packId = init.packId;
    this.packIndex = init.packIndex;
    this.spawn = init.position;
    this.facingAngle = init.facing ?? Math.PI;
    const def = init.def;
    const profiles = staggerProfiles(db);
    this.combatant = new Combatant(db, {
      id: init.id,
      team: "enemy",
      position: init.position,
      radius: def.radius * init.rank.scale,
      ...(def.turnRate === null ? {} : { facing: this.facingAngle }),
      maxHp: enemyMaxHp(def, init.rank, init.level),
      resist: def.defense.resist ?? {},
      armor: (def.defense.armorPerLevel ?? 0) * init.level,
      evasion: (def.defense.evasionPerLevel ?? 0) * init.level,
      staggerProfile: profiles.enemy,
    });
    // 雲の状態異常は、データが正しくなければここで Error（update の途中で例外を起こさないため）
    for (const a of def.attacks)
      if (a.delivery.type === "cloud") this.cloudApplications.set(a, this.cloudApplication(a));
    this.maxSpeed = Math.max(
      def.moveSpeed,
      ...def.attacks.map((a) => (a.delivery.type === "dash" ? a.delivery.speed : 0)),
    );
  }

  get state(): EnemyState {
    return this.stateValue;
  }
  get position(): Vec2 {
    return this.combatant.position;
  }
  /** 今の攻撃（予兆・攻撃・硬直の間）。 */
  get currentAttack(): EnemyAttackDef | undefined {
    return this.attack;
  }
  /** 今の状態になってからの秒数。 */
  get timeInState(): number {
    return this.stateTime;
  }
  /** 雲の攻撃の場所（予兆の表示に使う）。 */
  get targetPoint(): Vec2 {
    return this.attackPoint;
  }
  get facing(): number {
    return this.facingAngle;
  }
  /** 気づいている（追跡・攻撃の流れの中にいる）か。 */
  get alerted(): boolean {
    return !["idle", "return", "dead"].includes(this.stateValue);
  }

  private setState(s: EnemyState): void {
    this.stateValue = s;
    this.stateTime = 0;
  }

  private setFacing(angle: number): void {
    this.facingAngle = angle;
    if (this.def.turnRate !== null) this.combatant.facing = angle;
  }

  /** 気づかせる（攻撃を受けた・仲間が気づいた）。待機中なら追跡を始める。気づいたら true。 */
  notice(): boolean {
    if (this.stateValue !== "idle") return false;
    this.setState("chase");
    return true;
  }

  /** 相手が視界（前方180°・8m）にいるか。向きを持たない敵は、周り全てが視界。 */
  canSee(target: EnemyTarget): boolean {
    const dx = target.position.x - this.position.x;
    const dy = target.position.y - this.position.y;
    const dist = Math.hypot(dx, dy) - target.radius;
    if (dist > ENEMY_RULES.sightRange) return false;
    if (this.def.turnRate === null) return true;
    return (
      Math.abs(angleDiff(this.facingAngle, Math.atan2(dy, dx))) <=
      toRad(ENEMY_RULES.sightAngleDeg) / 2 + 1e-9
    );
  }

  /** 体の端から端の距離。 */
  private gap(target: EnemyTarget): number {
    return (
      length({
        x: target.position.x - this.position.x,
        y: target.position.y - this.position.y,
      }) -
      target.radius -
      this.combatant.radius
    );
  }

  private move(velocity: Vec2, dt: number, bounds: Bounds | undefined): void {
    let p = add(this.position, scale(velocity, dt));
    if (bounds !== undefined)
      p = {
        x: Math.min(bounds.maxX, Math.max(bounds.minX, p.x)),
        y: Math.min(bounds.maxY, Math.max(bounds.minY, p.y)),
      };
    this.combatant.position = p;
    this.combatant.moving = length(velocity) > 1e-6;
  }

  private turnTo(angle: number, dt: number): void {
    if (this.def.turnRate === null) return;
    this.setFacing(turnTowards(this.facingAngle, angle, toRad(this.def.turnRate) * dt));
  }

  /**
   * 1刻み進める。
   *
   * 例外安全：次の場合は RangeError で、敵の状態（行動の状態・その経過時間・攻撃・位置・向き・
   * クールダウン・HP・魔障・崩しゲージ・状態異常・うろつき・突進の距離）も乱数の状態も何も変わらない。
   * - 経過時間が0以上の有限の数でない（NaN・負の数・Infinity）
   * - 今の状態の経過時間に足すと有限でなくなる
   * - その経過時間で最も速く動いたときに、位置が有限でなくなりうる
   * - 戦う者の更新（持続ダメージ・魔障・崩しゲージの計算）が失敗する（Combatant.update は自身で例外安全）
   *
   * 順番：1. 検証 → 2. 戦う者の更新（失敗すれば何も変わらない）→ 3. 経過時間・クールダウンの反映
   * （検証済みの dt での代入だけで、例外は起きない）→ 4. 行動の流れ。
   * 経過時間・クールダウンは戦う者の更新の結果に影響せず、行動の流れより前に反映するので、
   * 振る舞いは従来（経過時間 → クールダウン → 戦う者 → 行動の流れ）と同じ。
   * 行動の流れは、検証済みの dt と、作るときに検証した攻撃のデータ（雲の状態異常）だけを使い、例外を起こさない。
   */
  update(dt: number, target: EnemyTarget, rng: Rng, bounds?: Bounds): EnemyEvent[] {
    // 1. 検証（状態は変えない）
    const stateTime = this.checkUpdate(dt);
    // 2. 持続ダメージ・崩しゲージ・魔障・一定時間の効果（移動していたかは、前の刻みの値を使う）
    //    例外を起こしうるのはここまで。Combatant.update は失敗すれば何も変えない
    const dotTaken = this.combatant.update(dt);
    // 3〜4. 反映と行動の流れ（例外は起きない）
    return this.proceed(dt, stateTime, dotTaken, target, rng, bounds);
  }

  /**
   * update の、状態を変えない前半：経過時間・状態の経過時間の累計・移動後の位置・戦う者の更新を
   * 全て計算して検証し、計画を返す（失敗すれば RangeError で、何も変わらない）。
   * 複数の敵を「全て検証してから全て反映する」ために使う（EnemyField.update）。
   * commitUpdate(plan, ...) は update(dt, ...) と同じ結果になる。
   *
   * 計画を作ってから反映するまでの間に変わってよいのは、notice()（行動の状態が待機から追跡になり、
   * 状態の経過時間が0に戻る）だけ。位置・戦う者（HP・状態異常・崩しゲージなど）は変えないこと。
   */
  planUpdate(dt: number): EnemyUpdatePlan {
    this.checkUpdate(dt);
    return { owner: this, dt, combatant: this.combatant.planUpdate(dt) };
  }

  /**
   * planUpdate の計画を反映し、行動の流れを1刻み進める。検証済みの値だけを使い、例外は起きない
   * （別の敵の計画を渡したときだけ Error。その場合も何も変えない）。
   */
  commitUpdate(
    plan: EnemyUpdatePlan,
    target: EnemyTarget,
    rng: Rng,
    bounds?: Bounds,
  ): EnemyEvent[] {
    if (plan.owner !== this) throw new Error("別の敵の計画は反映できない");
    // 計画の後に notice() で状態の経過時間が0に戻っていても、累計は検証済みの値以下（有限）
    const stateTime = this.stateTime + plan.dt;
    const dotTaken = this.combatant.commitUpdate(plan.combatant);
    return this.proceed(plan.dt, stateTime, dotTaken, target, rng, bounds);
  }

  /** 経過時間・状態の経過時間の累計・移動後の位置を検証し、次の状態の経過時間を返す（状態は変えない）。 */
  private checkUpdate(dt: number): number {
    if (!(Number.isFinite(dt) && dt >= 0))
      throw new RangeError(`経過時間は有限かつ0以上（${String(dt)}）`);
    const stateTime = this.stateTime + dt;
    if (!Number.isFinite(stateTime))
      throw new RangeError(`状態の経過時間の累計が有限の数でない（${String(stateTime)}）`);
    const reach = this.maxSpeed * dt;
    if (
      !Number.isFinite(Math.abs(this.position.x) + reach) ||
      !Number.isFinite(Math.abs(this.position.y) + reach)
    )
      throw new RangeError(`経過時間 ${String(dt)} で動くと、位置が有限の数でなくなる`);
    return stateTime;
  }

  /** 戦う者の更新の後：経過時間・クールダウンの反映と行動の流れ（検証済みの値だけを使い、例外は起きない）。 */
  private proceed(
    dt: number,
    stateTime: number,
    dotTaken: number,
    target: EnemyTarget,
    rng: Rng,
    bounds: Bounds | undefined,
  ): EnemyEvent[] {
    this.stateTime = stateTime;
    this.cooldowns.update(dt);
    this.dotTaken = dotTaken;
    this.combatant.moving = false;
    if (this.combatant.health.dead) {
      if (this.stateValue !== "dead") this.setState("dead");
      this.attack = undefined;
      return [];
    }
    // 崩しゲージが満タンになるとダウン。攻撃は取り消す（補助仕様書10.2）
    if (this.combatant.stagger.broken) {
      if (this.stateValue !== "down") {
        this.setState("down");
        this.attack = undefined;
      }
      return [];
    }
    if (this.stateValue === "down") this.setState("chase");

    switch (this.stateValue) {
      case "idle":
        return this.updateIdle(dt, target, rng, bounds);
      case "chase":
        return this.updateChase(dt, target, rng, bounds);
      case "windup":
      case "active":
      case "recovery":
        return this.updateAttack(dt, bounds);
      case "return":
        return this.updateReturn(dt, bounds);
      case "down":
      case "dead":
        return [];
    }
  }

  private updateIdle(dt: number, target: EnemyTarget, rng: Rng, bounds?: Bounds): EnemyEvent[] {
    if (target.targetable && this.canSee(target)) {
      this.setState("chase");
      return [{ type: "noticed" }];
    }
    if (this.def.moveSpeed <= 0) return [];
    if (this.wanderPause > 0) {
      this.wanderPause -= dt;
      return [];
    }
    if (this.wanderTarget === undefined) {
      const a = rng.float(0, 2 * Math.PI);
      const r = rng.float(0, WANDER.radius);
      this.wanderTarget = { x: this.spawn.x + Math.cos(a) * r, y: this.spawn.y + Math.sin(a) * r };
    }
    const to = {
      x: this.wanderTarget.x - this.position.x,
      y: this.wanderTarget.y - this.position.y,
    };
    const d = length(to);
    const step = this.def.moveSpeed * WANDER.speedRatio * dt;
    if (d <= step) {
      this.move(scale(normalize(to), d / Math.max(dt, 1e-9)), dt, bounds);
      this.wanderTarget = undefined;
      this.wanderPause = rng.float(WANDER.pauseMin, WANDER.pauseMax);
    } else {
      this.turnTo(Math.atan2(to.y, to.x), dt);
      this.move(scale(normalize(to), this.def.moveSpeed * WANDER.speedRatio), dt, bounds);
    }
    return [];
  }

  private updateChase(dt: number, target: EnemyTarget, rng: Rng, bounds?: Bounds): EnemyEvent[] {
    const fromSpawn = length({
      x: this.position.x - this.spawn.x,
      y: this.position.y - this.spawn.y,
    });
    if (fromSpawn >= ENEMY_RULES.leashDistance || !target.targetable) {
      this.setState("return");
      return [];
    }
    const to = { x: target.position.x - this.position.x, y: target.position.y - this.position.y };
    const toAngle = Math.atan2(to.y, to.x);
    const gap = this.gap(target);
    this.turnTo(toAngle, dt);

    // 攻撃の間合いに入っていて、向きが相手の方を向いていれば、使える攻撃から重みで選ぶ
    const facingOk =
      this.def.turnRate === null || Math.abs(angleDiff(this.facingAngle, toAngle)) <= toRad(30);
    const b = this.def.behavior;
    const flankAngle =
      target.facing + (FLANK_ANGLES[this.packIndex % FLANK_ANGLES.length] ?? Math.PI);
    const around = Math.atan2(
      this.position.y - target.position.y,
      this.position.x - target.position.x,
    );
    const flankLeft = angleDiff(around, flankAngle);
    const flankReady =
      b.type !== "flank" ||
      Math.abs(flankLeft) <= toRad(FLANK.attackWithinDeg) ||
      this.stateTime >= FLANK.giveUpSeconds;
    const usable = this.def.attacks.filter(
      (a) => this.cooldowns.remaining(a.id) <= 0 && gap <= a.range && gap >= (a.minRange ?? 0),
    );
    if (facingOk && flankReady && usable.length > 0) {
      const attack = rng.weighted(usable.map((a) => ({ item: a, weight: a.weight ?? 1 })));
      this.attack = attack;
      this.attackPoint = target.position;
      this.dashTravelled = 0;
      this.setState("windup");
      return [];
    }

    // 動き方（補助仕様書10.4）
    const speed = this.def.moveSpeed;
    if (speed <= 0) return [];
    const closest = Math.min(...this.def.attacks.map((a) => a.range));
    let goal: Vec2 | undefined;
    switch (b.type) {
      case "chase":
        if (gap > closest * 0.8) goal = target.position;
        break;
      case "flank": {
        // 相手の向きを基準にした背後や横へ、相手の周りを回って近づく。回り込めたら、まっすぐ寄る
        if (flankReady && Math.abs(flankLeft) <= toRad(FLANK.attackWithinDeg)) {
          if (gap > closest * 0.8) goal = target.position;
          break;
        }
        const orbit = b.distance + target.radius + this.combatant.radius;
        const dist = length(to);
        const step = Math.sign(flankLeft) * Math.min(Math.abs(flankLeft), toRad(FLANK.stepDeg));
        const r = Math.max(orbit, Math.min(dist, orbit + 2));
        goal = {
          x: target.position.x + Math.cos(around + step) * r,
          y: target.position.y + Math.sin(around + step) * r,
        };
        break;
      }
      case "kite": {
        const dist = length(to) - target.radius;
        if (dist < b.min) goal = { x: this.position.x - to.x, y: this.position.y - to.y };
        else if (dist > b.max) goal = target.position;
        break;
      }
      case "stationary":
        break;
    }
    if (goal !== undefined) {
      const dir = normalize({ x: goal.x - this.position.x, y: goal.y - this.position.y });
      this.move(scale(dir, speed), dt, bounds);
    }
    return [];
  }

  private updateAttack(dt: number, bounds?: Bounds): EnemyEvent[] {
    const attack = this.attack;
    if (attack === undefined) {
      this.setState("chase");
      return [];
    }
    const d = attack.delivery;
    const events: EnemyEvent[] = [];
    // 予兆・攻撃・硬直の間は、向きを変えない（補助仕様書10.1。ボスを除く）
    if (this.stateValue === "windup") {
      if (this.stateTime < attack.windup - 1e-9) return [];
      this.setState("active");
      events.push(...this.fire(attack));
    }
    if (this.stateValue === "active") {
      if (d.type === "dash") {
        const step = Math.min(d.speed * dt, d.distance - this.dashTravelled);
        if (step > 0) {
          const origin = this.position;
          this.move(
            scale({ x: Math.cos(this.facingAngle), y: Math.sin(this.facingAngle) }, step / dt),
            dt,
            bounds,
          );
          this.dashTravelled += step;
          events.push({
            type: "strike",
            attack,
            shape: { type: "line", length: step, width: d.width },
            origin,
            facing: this.facingAngle,
            group: "dash",
          });
        }
        if (this.dashTravelled >= d.distance - 1e-9) this.setState("recovery");
      } else if (this.stateTime >= attack.active - 1e-9) {
        this.setState("recovery");
      }
      return events;
    }
    if (this.stateValue === "recovery" && this.stateTime >= attack.recovery - 1e-9) {
      this.cooldowns.start(attack.id, attack.cooldown);
      this.attack = undefined;
      this.setState("chase");
    }
    return events;
  }

  /** 当たり判定が出る瞬間の出来事。 */
  private fire(attack: EnemyAttackDef): EnemyEvent[] {
    const d = attack.delivery;
    const dir = { x: Math.cos(this.facingAngle), y: Math.sin(this.facingAngle) };
    switch (d.type) {
      case "strike":
        return [
          {
            type: "strike",
            attack,
            shape: d.shape,
            origin: this.position,
            facing: this.facingAngle,
          },
        ];
      case "dash":
        return [];
      case "projectile":
        return [
          {
            type: "projectile",
            attack,
            origin: this.position,
            direction: dir,
            speed: d.speed,
            range: d.range,
            radius: d.radius,
          },
        ];
      case "cloud":
        return [
          {
            type: "cloud",
            attack,
            center: this.attackPoint,
            radius: d.radius,
            duration: d.duration,
            interval: d.interval,
            application: this.cloudApplicationOf(attack),
          },
        ];
    }
  }

  /** 作るときに計算した、雲の状態異常（呼び出す側が書き換えても影響しないよう、写しを返す）。 */
  private cloudApplicationOf(attack: EnemyAttackDef): AilmentApplication {
    const app = this.cloudApplications.get(attack);
    // 雲の攻撃は全て作るときに計算しているので、ここには来ない
    if (app === undefined) throw new Error(`雲の攻撃 ${attack.id} の状態異常がない`);
    return { ...app };
  }

  private cloudApplication(attack: EnemyAttackDef): AilmentApplication {
    const d = attack.delivery;
    if (d.type !== "cloud") throw new Error("雲の攻撃ではない");
    const def = this.db.ailmentsByTag.get(d.ailment);
    if (def?.kind !== "dot" && def?.kind !== "debuff")
      throw new Error(`雲の状態異常 ${d.ailment} は、持続ダメージか弱体化の定義が必要`);
    const base = standardHp(this.level) * d.baseRatio * this.rank.damageMultiplier;
    return {
      ailmentId: def.id,
      tag: def.tag,
      total: def.kind === "dot" ? base * def.totalRatio : 0,
      duration: def.duration,
      maxStacks: def.kind === "dot" && def.stacking.mode === "stack" ? def.stacking.maxStacks : 1,
    };
  }

  private updateReturn(dt: number, bounds?: Bounds): EnemyEvent[] {
    const to = { x: this.spawn.x - this.position.x, y: this.spawn.y - this.position.y };
    const d = length(to);
    if (d <= HOME_DISTANCE || this.def.moveSpeed <= 0) {
      // 帰ったら、HPを全回復して待機へ（補助仕様書10.2）
      this.combatant.health.restoreFull();
      this.setState("idle");
      return [{ type: "returned" }];
    }
    this.turnTo(Math.atan2(to.y, to.x), dt);
    this.move(
      scale(normalize(to), Math.min(this.def.moveSpeed, d / Math.max(dt, 1e-9))),
      dt,
      bounds,
    );
    return [];
  }
}

/** Enemy.planUpdate の計画（検証済み。Enemy.commitUpdate で反映する）。 */
export interface EnemyUpdatePlan {
  readonly owner: Enemy;
  readonly dt: number;
  readonly combatant: CombatantUpdatePlan;
}

/** 敵の最大HP（補助仕様書10.1）：通常の敵のHP × 種類の倍率 × 格の倍率。 */
export function enemyMaxHp(def: EnemyDef, rank: EnemyRankDef, level: number): number {
  return normalEnemyHp(level) * def.hpMultiplier * rank.hpMultiplier;
}

/** 敵の攻撃の強さ（補助仕様書10.1）：標準HP × 攻撃の割合 × 格の倍率。 */
export function enemyAttackDamage(
  attack: EnemyAttackDef,
  rank: EnemyRankDef,
  level: number,
): number {
  return standardHp(level) * attack.ratio * rank.damageMultiplier;
}

/**
 * 敵の攻撃を、プレイヤーのヒットと同じ計算（仕様書2.4〜2.7）に通すための「攻撃する側」。
 * 攻撃の強さを武器の基礎値（最小＝最大）として持ち、技倍率1・会心なし・命中は 40＋12×Lv。
 */
export class EnemyAttackers {
  private readonly db: ContentDb;
  private readonly tags: TagIndex;
  private readonly views = new Map<number, ModifierView>();

  constructor(db: ContentDb) {
    this.db = db;
    this.tags = new TagIndex(db.tags);
  }

  /**
   * 一定時間の効果がかかっている敵ごとの評価（敵の ID → 効果の版と評価）。
   * 効果が切れた敵の分はその場で、倒れた・消えた敵の分は retain で消す（溜まり続けないように）。
   */
  private readonly statusViews = new Map<string, { version: number; view: ModifierView }>();

  /** 敵のLvの命中と、敵にかかっている一定時間の効果（煙玉の命中-30%など）を評価した値。 */
  private view(enemy: Enemy): ModifierView {
    const statuses = enemy.combatant.statuses;
    if (statuses.active.length === 0) {
      this.statusViews.delete(enemy.id);
      const cached = this.views.get(enemy.level);
      if (cached !== undefined) return cached;
      const { view } = evaluateEffects(this.db, this.tags, [], {
        baseStats: { "STAT-ACCURACY": enemyAccuracy(enemy.level) },
      });
      this.views.set(enemy.level, view);
      return view;
    }
    const hit = this.statusViews.get(enemy.id);
    if (hit?.version === statuses.version) return hit.view;
    const { view } = evaluateEffects(this.db, this.tags, statuses.instances(), {
      baseStats: { "STAT-ACCURACY": enemyAccuracy(enemy.level) },
    });
    this.statusViews.set(enemy.id, { version: statuses.version, view });
    return view;
  }

  /**
   * 一定時間の効果の評価を、渡した敵（場に出ていて倒れていない敵）の分だけ残し、他を消す。
   * Map の削除だけで、例外は起きない。
   */
  retain(enemies: Iterable<Enemy>): void {
    if (this.statusViews.size === 0) return;
    const keep = new Set<string>();
    for (const e of enemies) if (e.state !== "dead") keep.add(e.id);
    for (const id of this.statusViews.keys()) if (!keep.has(id)) this.statusViews.delete(id);
  }

  /** 一定時間の効果の評価を残している敵の ID（確認用）。 */
  cachedStatusViews(): readonly string[] {
    return [...this.statusViews.keys()];
  }

  /** 攻撃する側。攻撃の強さには、敵にかかっている衰弱（与えるダメージの低下）を含める。 */
  attacker(enemy: Enemy, attack: EnemyAttackDef): DamageAttacker {
    const amount =
      enemyAttackDamage(attack, enemy.rank, enemy.level) *
      enemy.combatant.ailments.dealtMultiplier(enemy.combatant.isBoss);
    return {
      db: this.db,
      view: this.view(enemy),
      characterLevel: 1,
      weapon: {
        uid: `${enemy.id}:${attack.id}`,
        tags: enemy.def.family === undefined ? [] : [enemy.def.family],
        base: { [attack.element]: { min: amount, max: amount } },
        critChance: 0,
      },
    };
  }
}

/** 重なった体を押し離す（敵どうしが同じ場所に重ならないように）。動かない敵は動かさない。 */
export function separate(enemies: readonly Enemy[]): void {
  for (let i = 0; i < enemies.length; i++) {
    const a = enemies[i];
    if (a === undefined || a.state === "dead") continue;
    for (let j = i + 1; j < enemies.length; j++) {
      const b = enemies[j];
      if (b === undefined || b.state === "dead") continue;
      const dx = b.position.x - a.position.x;
      const dy = b.position.y - a.position.y;
      const d = Math.hypot(dx, dy);
      const min = a.combatant.radius + b.combatant.radius;
      if (d >= min || d < 1e-9) continue;
      const push = (min - d) / 2;
      const n = { x: dx / d, y: dy / d };
      const aMoves = a.def.moveSpeed > 0;
      const bMoves = b.def.moveSpeed > 0;
      if (aMoves) a.combatant.position = add(a.position, scale(n, bMoves ? -push : -2 * push));
      if (bMoves) b.combatant.position = add(b.position, scale(n, aMoves ? push : 2 * push));
    }
  }
}
