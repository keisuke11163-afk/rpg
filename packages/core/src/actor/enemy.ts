import type { EnemyAttackDef, EnemyDef, EnemyRankDef, EnemyResidue } from "../content/enemy.ts";
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
  | {
      readonly type: "summon";
      readonly attack: EnemyAttackDef;
      readonly enemy: string;
      readonly count: number;
      readonly origin: Vec2;
      readonly radius: number;
      readonly haste:
        | { readonly increase: number; readonly duration: number; readonly radius: number }
        | undefined;
    }
  | { readonly type: "returned" }
  /** ボスが次の段階に移った（phase は1から）。切り替えの間はダメージを受けない。 */
  | { readonly type: "phase"; readonly phase: number }
  /** 根渡りで地中に潜った（to に現れる）。 */
  | { readonly type: "burrow"; readonly from: Vec2; readonly to: Vec2 }
  /** 根渡りで地上に現れた。 */
  | { readonly type: "surface"; readonly at: Vec2 };

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
  /** 根渡りで現れる地点（ボスの間。補助仕様書11.1）。 */
  readonly anchors?: readonly Vec2[];
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
  /** 連続の当たり判定のうち、出した数（予兆の後の1回目を含む）。 */
  private repeatsFired = 0;
  /** 攻撃速度の強化（増加の割合と、残りの秒数）。 */
  private hasteIncrease = 0;
  private hasteLeft = 0;
  private attack: EnemyAttackDef | undefined;
  /** 雲を出す場所（予兆の始めに決める）。 */
  private attackPoint: Vec2 = ZERO;
  private dashTravelled = 0;
  private wanderTarget: Vec2 | undefined;
  private wanderPause = 0;
  private facingAngle: number;
  private readonly db: ContentDb;
  /** 根渡りで現れる地点。 */
  private readonly anchors: readonly Vec2[];
  /** ボスの段階（1から。ボスでなければ1のまま）。 */
  private phaseValue = 1;
  /** 段階の切り替えの、ダメージを受けない残りの秒数。 */
  private shieldLeft = 0;
  /** 根渡り：地中にいるか・潜った地点・現れる地点。 */
  private burrowed = false;
  private burrowFrom: Vec2 = ZERO;
  private burrowTo: Vec2 = ZERO;
  /**
   * 雲（雲の攻撃・叩きつけの後の毒だまり）で付ける状態異常（雲の定義 → 付けるもの）。
   * 作るときに計算し、検証しておく（update の途中で例外を起こさないため）。
   */
  private readonly cloudApplications = new Map<EnemyResidue, AilmentApplication>();
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
    this.anchors = init.anchors ?? [];
    const def = init.def;
    const profiles = staggerProfiles(db);
    const boss = def.boss !== undefined;
    this.combatant = new Combatant(db, {
      id: init.id,
      team: "enemy",
      position: init.position,
      radius: def.radius * init.rank.scale,
      ...(def.turnRate === null ? {} : { facing: this.facingAngle }),
      maxHp: enemyMaxHp(def, init.rank, init.level),
      isBoss: boss,
      resist: def.defense.resist ?? {},
      armor: (def.defense.armorPerLevel ?? 0) * init.level,
      evasion: (def.defense.evasionPerLevel ?? 0) * init.level,
      staggerProfile: boss ? profiles.boss : profiles.enemy,
    });
    // 雲の状態異常は、データが正しくなければここで Error（update の途中で例外を起こさないため）
    for (const a of def.attacks) {
      const d = a.delivery;
      if (d.type === "cloud") this.cloudApplications.set(d, this.cloudApplication(d));
      if (d.type === "strike" && d.residue !== undefined)
        this.cloudApplications.set(d.residue, this.cloudApplication(d.residue));
    }
    this.maxSpeed = Math.max(
      def.moveSpeed,
      ...def.attacks.map((a) => (a.delivery.type === "dash" ? a.delivery.speed : 0)),
    );
    this.resetPhases();
  }

  /** ボスの段階（1から）。ボスでなければ1。 */
  get phase(): number {
    return this.phaseValue;
  }
  /** 段階の切り替えの最中（ダメージを受けない）か。 */
  get shielded(): boolean {
    return this.shieldLeft > 0;
  }
  /** 根渡りで地中にいる（ダメージを受けず、狙われない）か。 */
  get underground(): boolean {
    return this.burrowed;
  }
  /** 根渡りで現れる地点（地中にいる間。表示用）。 */
  get burrowDestination(): Vec2 | undefined {
    return this.burrowed ? this.burrowTo : undefined;
  }
  /** プレイヤーの技の対象にできるか（倒れている・地中にいるときは false）。 */
  get targetable(): boolean {
    return this.stateValue !== "dead" && !this.burrowed;
  }

  /** 段階を最初に戻す（出現したとき・帰還して全回復したとき）。 */
  private resetPhases(): void {
    this.phaseValue = 1;
    this.shieldLeft = 0;
    this.burrowed = false;
    const health = this.combatant.health;
    health.invulnerable = false;
    const first = this.def.boss?.phaseThresholds[0];
    health.setFloor(first === undefined ? 0 : health.maxHp * first);
  }

  /** HPが段階の境目まで減っていたら、次の段階に移る（補助仕様書11.1。境目より下には減らない）。 */
  private checkPhase(): EnemyEvent[] {
    const boss = this.def.boss;
    if (boss === undefined) return [];
    const health = this.combatant.health;
    const events: EnemyEvent[] = [];
    for (;;) {
      const threshold = boss.phaseThresholds[this.phaseValue - 1];
      if (threshold === undefined || health.hp > health.maxHp * threshold + 1e-9) break;
      this.phaseValue += 1;
      const next = boss.phaseThresholds[this.phaseValue - 1];
      health.setFloor(next === undefined ? 0 : health.maxHp * next);
      this.shieldLeft = boss.transitionInvulnerable;
      events.push({ type: "phase", phase: this.phaseValue });
    }
    if (events.length > 0) {
      // 切り替えでは、今の攻撃を取り消す（地中にいれば、その場に現れる）
      this.cancelAttack();
      if (this.stateValue !== "down") this.setState("chase");
    }
    health.invulnerable = this.shieldLeft > 0 || this.burrowed;
    return events;
  }

  /** 今の攻撃を取り消す。根渡りの途中なら、その場で地上に戻る。 */
  private cancelAttack(): void {
    this.attack = undefined;
    if (this.burrowed) {
      this.burrowed = false;
      this.combatant.health.invulnerable = this.shieldLeft > 0;
    }
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
    // ボスは周り全てを見て、気づく距離はデータで決める
    if (this.def.boss !== undefined) return dist <= this.def.boss.aggroRange;
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

  /** 攻撃速度を一定時間だけ上げる（重ねがけはせず、大きい方・長い方にする）。 */
  hasten(increase: number, duration: number): void {
    if (!(Number.isFinite(increase) && increase > 0 && Number.isFinite(duration) && duration > 0))
      throw new RangeError("攻撃速度の強化は正の有限の数");
    this.hasteIncrease = Math.max(this.hasteIncrease, increase);
    this.hasteLeft = Math.max(this.hasteLeft, duration);
  }

  /** 攻撃速度の強化の割合（効いていなければ0）。 */
  get haste(): number {
    return this.hasteIncrease;
  }

  private turnTo(angle: number, dt: number): void {
    if (this.def.turnRate === null) return;
    this.setFacing(turnTowards(this.facingAngle, angle, toRad(this.def.turnRate) * dt));
  }

  /**
   * 1刻み進める。
   *
   * 例外安全：次の場合は RangeError で、敵の状態（行動の状態・その経過時間・攻撃・位置・向き・
   * クールダウン・HP・魔障・崩しゲージ・状態異常・うろつき・突進の距離・攻撃速度の強化・段階の切り替えの
   * 残りの時間・ダメージを受けないか）も乱数の状態も何も変わらない。
   * - 経過時間が0以上の有限の数でない（NaN・負の数・Infinity）
   * - 今の状態の経過時間に（攻撃速度の強化の分を含めて）足すと有限でなくなる
   * - その経過時間で最も速く動いたときに、位置が有限でなくなりうる
   * - 戦う者の更新（持続ダメージ・魔障・崩しゲージの計算）が失敗する
   *
   * 順番：1. 計画（planUpdate：検証と、この刻みの後の無敵の状態での戦う者の更新の計算。状態は変えない）→
   * 2. 反映（commitUpdate：段階の切り替えの残りの時間・無敵・戦う者・経過時間・攻撃速度の強化・
   * クールダウンの代入で、例外は起きない）→ 3. 行動の流れ。
   * 振る舞いは従来（経過時間・攻撃速度の強化・段階の切り替えと無敵 → クールダウン → 戦う者 → 行動の流れ）と同じ。
   * 行動の流れは、検証済みの dt と、作るときに検証した攻撃のデータ（雲の状態異常）だけを使い、例外を起こさない。
   */
  update(dt: number, target: EnemyTarget, rng: Rng, bounds?: Bounds): EnemyEvent[] {
    return this.commitUpdate(this.planUpdate(dt), target, rng, bounds);
  }

  /**
   * update の、状態を変えない前半：経過時間・状態の経過時間の累計・移動後の位置・戦う者の更新を
   * 全て計算して検証し、計画を返す（失敗すれば RangeError で、何も変わらない）。
   * 複数の敵を「全て検証してから全て反映する」ために使う（EnemyField.update）。
   * commitUpdate(plan, ...) は update(dt, ...) と同じ結果になる。
   *
   * 持続ダメージは、この刻みの後のダメージを受けない状態（段階の切り替えの残りの時間を dt だけ減らした後・
   * 地中にいるか）で計算する（従来の「無敵の更新 → 戦う者の更新」と同じ）。
   *
   * 計画を作ってから反映するまでの間に変わってよいのは、notice()（行動の状態が待機から追跡になり、
   * 状態の経過時間が0に戻る）だけ。位置・戦う者（HP・状態異常・崩しゲージなど）・段階は変えないこと。
   */
  planUpdate(dt: number): EnemyUpdatePlan {
    this.checkUpdate(dt);
    // 刻みの積み重ねの誤差で、ちょうど2秒の後に残らないようにする
    const shieldLeft = this.shieldLeft - dt <= 1e-9 ? 0 : this.shieldLeft - dt;
    const invulnerable = shieldLeft > 0 || this.burrowed;
    return {
      owner: this,
      dt,
      shieldLeft,
      invulnerable,
      combatant: this.combatant.planUpdate(dt, { invulnerable }),
    };
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
    const stateTime = this.nextStateTime(plan.dt);
    this.shieldLeft = plan.shieldLeft;
    this.combatant.health.invulnerable = plan.invulnerable;
    const dotTaken = this.combatant.commitUpdate(plan.combatant);
    return this.proceed(plan.dt, stateTime, dotTaken, target, rng, bounds);
  }

  /** 攻撃の間（予兆・当たり判定・硬直）の時間は、攻撃速度の強化の分だけ速く進む。 */
  private nextStateTime(dt: number): number {
    const attacking =
      this.stateValue === "windup" ||
      this.stateValue === "active" ||
      this.stateValue === "recovery";
    return this.stateTime + (attacking ? dt * (1 + this.hasteIncrease) : dt);
  }

  /** 経過時間・状態の経過時間の累計・移動後の位置を検証する（状態は変えない）。 */
  private checkUpdate(dt: number): void {
    if (!(Number.isFinite(dt) && dt >= 0))
      throw new RangeError(`経過時間は有限かつ0以上（${String(dt)}）`);
    // 攻撃速度の強化の分を含めた、最も大きい累計で確かめる
    const stateTime = this.stateTime + dt * (1 + this.hasteIncrease);
    if (!Number.isFinite(stateTime))
      throw new RangeError(`状態の経過時間の累計が有限の数でない（${String(stateTime)}）`);
    const reach = this.maxSpeed * dt;
    if (
      !Number.isFinite(Math.abs(this.position.x) + reach) ||
      !Number.isFinite(Math.abs(this.position.y) + reach)
    )
      throw new RangeError(`経過時間 ${String(dt)} で動くと、位置が有限の数でなくなる`);
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
    this.hasteLeft = Math.max(0, this.hasteLeft - dt);
    if (this.hasteLeft === 0) this.hasteIncrease = 0;
    this.cooldowns.update(dt);
    this.dotTaken = dotTaken;
    this.combatant.moving = false;
    if (this.combatant.health.dead) {
      if (this.stateValue !== "dead") this.setState("dead");
      this.cancelAttack();
      return [];
    }
    // ボスの段階（前の刻みの間に受けたダメージも含めて判定する）
    const phaseEvents = this.checkPhase();
    // 崩しゲージが満タンになるとダウン。攻撃は取り消す（補助仕様書10.2）
    if (this.combatant.stagger.broken) {
      if (this.stateValue !== "down") {
        this.setState("down");
        this.cancelAttack();
      }
      return phaseEvents;
    }
    if (this.stateValue === "down") this.setState("chase");
    // 段階の切り替えの間は、相手の方を向くだけで攻撃しない
    if (this.shieldLeft > 0 && this.alerted) {
      this.turnTo(
        Math.atan2(target.position.y - this.position.y, target.position.x - this.position.x),
        dt,
      );
      return phaseEvents;
    }

    switch (this.stateValue) {
      case "idle":
        return [...phaseEvents, ...this.updateIdle(dt, target, rng, bounds)];
      case "chase":
        return [...phaseEvents, ...this.updateChase(dt, target, rng, bounds)];
      case "windup":
      case "active":
      case "recovery":
        return [...phaseEvents, ...this.updateAttack(dt, target, bounds)];
      case "return":
        return [...phaseEvents, ...this.updateReturn(dt, bounds)];
      case "down":
      case "dead":
        return phaseEvents;
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
      (a) =>
        this.cooldowns.remaining(a.id) <= 0 &&
        gap <= a.range &&
        gap >= (a.minRange ?? 0) &&
        (a.phases === undefined || a.phases.includes(this.phaseValue)) &&
        (a.delivery.type !== "burrow" || this.anchors.length >= 2),
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

  private updateAttack(dt: number, target: EnemyTarget, bounds?: Bounds): EnemyEvent[] {
    const attack = this.attack;
    if (attack === undefined) {
      this.setState("chase");
      return [];
    }
    const d = attack.delivery;
    const events: EnemyEvent[] = [];
    // 予兆・攻撃・硬直の間は、向きを変えない（補助仕様書10.1）。ボスは攻撃中も相手の方を向く（11.1）。
    // 地中にいる間は向きを変えない
    if (this.def.boss !== undefined && !this.burrowed)
      this.turnTo(
        Math.atan2(target.position.y - this.position.y, target.position.x - this.position.x),
        dt,
      );
    if (this.stateValue === "windup") {
      if (this.stateTime < attack.windup - 1e-9) return [];
      this.setState("active");
      this.repeatsFired = 1;
      events.push(...this.fire(attack, 0, target));
    }
    if (this.stateValue === "active") {
      // 連続の当たり判定・雲：間隔ごとに続けて出す（当たり判定は別の group なので、1回ずつ当たる）
      const repeat = d.type === "strike" || d.type === "cloud" ? d.repeat : undefined;
      if (repeat !== undefined)
        while (
          this.repeatsFired < repeat.count &&
          this.stateTime >= repeat.interval * this.repeatsFired - 1e-9
        ) {
          events.push(...this.fire(attack, this.repeatsFired, target));
          this.repeatsFired += 1;
        }
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
      } else if (d.type === "burrow" && this.burrowed) {
        // 地中を、潜った地点から現れる地点へ進む（移動しているので、出血の2倍が働く）
        const total = Math.max(attack.active, 1e-9);
        const t = Math.min(1, this.stateTime / total);
        const goal = {
          x: this.burrowFrom.x + (this.burrowTo.x - this.burrowFrom.x) * t,
          y: this.burrowFrom.y + (this.burrowTo.y - this.burrowFrom.y) * t,
        };
        const delta = { x: goal.x - this.position.x, y: goal.y - this.position.y };
        if (dt > 0) this.move(scale(delta, 1 / dt), dt, undefined);
        else this.combatant.position = goal;
        if (t >= 1 - 1e-9) {
          this.combatant.position = this.burrowTo;
          this.burrowed = false;
          this.combatant.health.invulnerable = this.shieldLeft > 0;
          events.push({ type: "surface", at: this.burrowTo });
          this.setState("recovery");
        }
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

  /** 根渡りで現れる地点：今いる地点（最も近い地点）の、次の地点。 */
  private nextAnchor(): Vec2 {
    let nearest = 0;
    let best = Infinity;
    this.anchors.forEach((a, i) => {
      const dist = Math.hypot(a.x - this.position.x, a.y - this.position.y);
      if (dist < best) {
        best = dist;
        nearest = i;
      }
    });
    return this.anchors[(nearest + 1) % this.anchors.length] ?? this.position;
  }

  /** 当たり判定が出る瞬間の出来事（index は連続の当たり判定の何回目か）。 */
  private fire(attack: EnemyAttackDef, index: number, target: EnemyTarget): EnemyEvent[] {
    const d = attack.delivery;
    const dir = { x: Math.cos(this.facingAngle), y: Math.sin(this.facingAngle) };
    switch (d.type) {
      case "strike": {
        // 相手の位置を狙う攻撃は、予兆で示した位置に出す。次の1回は、今の相手の位置を狙う
        const origin = d.aim === "target" ? this.attackPoint : this.position;
        if (d.aim === "target") this.attackPoint = target.position;
        const events: EnemyEvent[] = [
          {
            type: "strike",
            attack,
            shape: d.shape,
            origin,
            facing: this.facingAngle,
            ...(d.repeat === undefined ? {} : { group: `repeat-${String(index)}` }),
          },
        ];
        if (d.residue !== undefined)
          events.push({
            type: "cloud",
            attack,
            center: origin,
            radius: d.residue.radius,
            duration: d.residue.duration,
            interval: d.residue.interval,
            application: this.cloudApplicationOf(d.residue),
          });
        return events;
      }
      case "summon":
        return [
          {
            type: "summon",
            attack,
            enemy: d.enemy,
            count: d.count,
            origin: this.position,
            radius: d.radius,
            haste: d.haste,
          },
        ];
      case "dash":
        return [];
      case "burrow": {
        this.burrowFrom = this.position;
        this.burrowTo = this.nextAnchor();
        this.burrowed = true;
        this.combatant.health.invulnerable = true;
        return [{ type: "burrow", from: this.burrowFrom, to: this.burrowTo }];
      }
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
      case "cloud": {
        // 2回目からは、その瞬間の相手の位置に出す
        const center = index === 0 ? this.attackPoint : target.position;
        const application = this.cloudApplicationOf(d);
        return cloudCenters(d, center, this.position).map((c) => ({
          type: "cloud" as const,
          attack,
          center: c,
          radius: d.radius,
          duration: d.duration,
          interval: d.interval,
          application,
        }));
      }
    }
  }

  /** 作るときに計算した、雲の状態異常（呼び出す側が書き換えても影響しないよう、写しを返す）。 */
  private cloudApplicationOf(cloud: EnemyResidue): AilmentApplication {
    const app = this.cloudApplications.get(cloud);
    // 雲は全て作るときに計算しているので、ここには来ない
    if (app === undefined) throw new Error(`雲の状態異常 ${cloud.ailment} が計算されていない`);
    return { ...app };
  }

  /** 雲の中で受ける状態異常（胞子・毒だまり）。 */
  private cloudApplication(cloud: EnemyResidue): AilmentApplication {
    const def = this.db.ailmentsByTag.get(cloud.ailment);
    if (def?.kind !== "dot" && def?.kind !== "debuff")
      throw new Error(`雲の状態異常 ${cloud.ailment} は、持続ダメージか弱体化の定義が必要`);
    const base = standardHp(this.level) * cloud.baseRatio * this.rank.damageMultiplier;
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
      // 帰ったら、HPを全回復して待機へ（補助仕様書10.2）。ボスは段階も最初に戻る
      this.combatant.health.restoreFull();
      this.resetPhases();
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

/**
 * 雲を複数出すときの中心（予兆の表示と同じ計算を使う）。1つ目は相手の位置。残りは、相手の位置から
 * 出した敵と反対側へ spread m 離し、その向きの ±fanDeg の間に等しい角度で並べる（docs/progress D-U21-3）。
 */
export function cloudCenters(
  d: {
    readonly count?: number | undefined;
    readonly spread?: number | undefined;
    readonly fanDeg?: number | undefined;
  },
  center: Vec2,
  from: Vec2,
): Vec2[] {
  const count = d.count ?? 1;
  const spread = d.spread ?? 0;
  const base = Math.atan2(center.y - from.y, center.x - from.x);
  const fan = ((d.fanDeg ?? 0) * Math.PI) / 180;
  const out: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const a = count <= 2 ? base : base + fan * ((2 * (i - 1)) / Math.max(1, count - 2) - 1);
    out.push(
      i === 0 ? center : { x: center.x + Math.cos(a) * spread, y: center.y + Math.sin(a) * spread },
    );
  }
  return out;
}

/** Enemy.planUpdate の計画（検証済み。Enemy.commitUpdate で反映する）。 */
export interface EnemyUpdatePlan {
  readonly owner: Enemy;
  readonly dt: number;
  /** この刻みの後の、段階の切り替えのダメージを受けない残りの秒数。 */
  readonly shieldLeft: number;
  /** この刻みの後に、ダメージを受けないか（持続ダメージの計算に使った値）。 */
  readonly invulnerable: boolean;
  readonly combatant: CombatantUpdatePlan;
}

/**
 * 敵の最大HP（補助仕様書10.1）：通常の敵のHP × 種類の倍率 × 格の倍率。
 * ボスは、データの最大HP（標準DPS×90秒。補助仕様書11章）。
 */
export function enemyMaxHp(def: EnemyDef, rank: EnemyRankDef, level: number): number {
  if (def.boss !== undefined) return def.boss.hp;
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
