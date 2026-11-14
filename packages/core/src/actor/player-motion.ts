import { type Vec2, ZERO, add, length, normalize, scale, toDirection8 } from "./vector.ts";

/**
 * プレイヤーの移動・回避・照準（補助仕様書 1.1・3.1、仕様書v0.2 2.1）。
 * 入力は「行動」として受け取り、キーやボタンを直接は知らない（開発計画書 3.1 の方針4）。
 */

/** 移動・回避の設定。 */
export interface MotionConfig {
  /** 移動速度（m/秒）。 */
  readonly moveSpeed: number;
  /** 回避の時間（秒）と距離（m）。 */
  readonly dodgeDuration: number;
  readonly dodgeDistance: number;
  /** 回避の最初の、攻撃を受けない時間（秒）。 */
  readonly dodgeInvulnerable: number;
  /** 回避に使う気力。 */
  readonly dodgeStaminaCost: number;
  readonly maxStamina: number;
  /** 気力の回復（毎秒）。 */
  readonly staminaRegen: number;
}

/**
 * 仮値: 補助仕様書3.1（移動速度5m/秒、回避0.35秒で4m・最初の0.3秒は無敵）と仕様書2.1（気力100・回避25・毎秒20回復）
 */
export const DEFAULT_MOTION: MotionConfig = {
  moveSpeed: 5,
  dodgeDuration: 0.35,
  dodgeDistance: 4,
  dodgeInvulnerable: 0.3,
  dodgeStaminaCost: 25,
  maxStamina: 100,
  staminaRegen: 20,
};

/** 1刻み分の入力（行動）。 */
export interface MotionInput {
  /** 移動の入力（WASD など。長さ1を超えてもよい。斜めは長さ1に揃える）。 */
  readonly move: Vec2;
  /** 照準の方向（プレイヤーからマウスの位置へ向かう向き）。長さ0なら向きを変えない。 */
  readonly aim: Vec2;
  /** 回避の入力（押した瞬間だけ true）。 */
  readonly dodge: boolean;
  /** 移動の速さの倍率（技を使っている間など。省略すると1）。 */
  readonly speedMultiplier?: number;
}

/** 移動できる範囲（壁との当たり判定は U-18 で作る）。 */
export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export class PlayerMotion {
  readonly config: MotionConfig;
  private pos: Vec2;
  private facingAngle = 0;
  private stamina: number;
  /** 回避の経過時間（回避していなければ undefined）。 */
  private dodgeElapsed: number | undefined;
  private dodgeDir: Vec2 = ZERO;
  private bounds: Bounds | undefined;

  constructor(position: Vec2, config: MotionConfig = DEFAULT_MOTION, bounds?: Bounds) {
    this.config = config;
    this.pos = position;
    this.stamina = config.maxStamina;
    this.bounds = bounds;
  }

  get position(): Vec2 {
    return this.pos;
  }
  /** 向き（ラジアン。照準の角度そのもの）。 */
  get facing(): number {
    return this.facingAngle;
  }
  /** 見た目の向き（8方向の番号）。 */
  get direction8(): number {
    return toDirection8(this.facingAngle);
  }
  get currentStamina(): number {
    return this.stamina;
  }
  get dodging(): boolean {
    return this.dodgeElapsed !== undefined;
  }
  /** 攻撃を受けない（回避の最初の0.3秒）。 */
  get invulnerable(): boolean {
    return this.dodgeElapsed !== undefined && this.dodgeElapsed < this.config.dodgeInvulnerable;
  }

  /** 気力を使えるか（ガードで攻撃を防ぐときなど。回避以外の使い道）。 */
  canSpendStamina(cost: number): boolean {
    return this.stamina >= cost - 1e-9;
  }

  /** 気力を使う（足りなければ使わずに false）。 */
  spendStamina(cost: number): boolean {
    if (!(cost >= 0) || !Number.isFinite(cost)) throw new RangeError("気力は0以上の有限の数");
    if (!this.canSpendStamina(cost)) return false;
    this.stamina = Math.max(0, this.stamina - cost);
    return true;
  }

  setBounds(bounds: Bounds | undefined): void {
    this.bounds = bounds;
  }

  /** 外から動かす（突進など）。動ける範囲に収める。 */
  displace(delta: Vec2): void {
    this.pos = this.clamp(add(this.pos, delta));
  }

  private clamp(p: Vec2): Vec2 {
    if (this.bounds === undefined) return p;
    return {
      x: Math.min(this.bounds.maxX, Math.max(this.bounds.minX, p.x)),
      y: Math.min(this.bounds.maxY, Math.max(this.bounds.minY, p.y)),
    };
  }

  /** 1刻み進める。 */
  update(dt: number, input: MotionInput): void {
    // FixedStepClock.advance と同じく、NaN・負の数・無限大を受け付けない（無限大は位置を NaN にする）
    if (!(dt >= 0) || !Number.isFinite(dt)) throw new RangeError("経過時間は0以上の有限の数");
    // 回避の間は向きも固定する（回避を押した刻みの照準までは受け付ける。実装判断 D-U06-2）
    if (!this.dodging && length(input.aim) > 1e-9) {
      this.facingAngle = Math.atan2(input.aim.y, input.aim.x);
    }
    const moveDir = normalize(input.move);

    // 回避を始める：移動の入力の方向へ。入力がなければ照準の方向へ（補助仕様書 1.1）
    if (!this.dodging && input.dodge && this.stamina >= this.config.dodgeStaminaCost) {
      this.stamina -= this.config.dodgeStaminaCost;
      this.dodgeElapsed = 0;
      this.dodgeDir =
        length(moveDir) > 0
          ? moveDir
          : { x: Math.cos(this.facingAngle), y: Math.sin(this.facingAngle) };
    }

    let velocity: Vec2;
    if (this.dodgeElapsed !== undefined) {
      // 回避の間は操作を受け付けず、決まった速さで進む
      const step = Math.min(dt, this.config.dodgeDuration - this.dodgeElapsed);
      velocity = scale(this.dodgeDir, this.config.dodgeDistance / this.config.dodgeDuration);
      this.pos = add(this.pos, scale(velocity, step));
      this.dodgeElapsed += dt;
      if (this.dodgeElapsed >= this.config.dodgeDuration - 1e-9) this.dodgeElapsed = undefined;
    } else {
      velocity = scale(moveDir, this.config.moveSpeed * (input.speedMultiplier ?? 1));
      this.pos = add(this.pos, scale(velocity, dt));
      this.stamina = Math.min(this.config.maxStamina, this.stamina + this.config.staminaRegen * dt);
    }

    this.pos = this.clamp(this.pos);
  }
}
