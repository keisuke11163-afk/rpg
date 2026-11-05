/**
 * HPと魔障（仕様書2.6：魔障はHPより先にダメージを吸収する。被弾がない状態が2秒続くと毎秒20%ずつ回復）。
 *
 * 入力の許容範囲（範囲の外・NaN・±Infinity は RangeError。検証は状態を変える前に行う）：
 * - maxHp：0より大きい有限の数
 * - maxWard：0以上の有限の数（省略で0）
 * - wardRechargeDelay：0以上の有限の数（省略で2秒）
 * - update(dt)・takeDamage(amount)・heal(amount)：0以上の有限の数（0は何もしない）
 */
export interface HealthConfig {
  /** 最大HP（0より大きい有限の数）。 */
  readonly maxHp: number;
  /** 最大魔障（0以上の有限の数。省略で0）。 */
  readonly maxWard?: number;
  /** 魔障が回復し始めるまでの秒数（0以上の有限の数。省略で2。法衣の統一ボーナスで-1秒。仕様書3.3）。 */
  readonly wardRechargeDelay?: number;
}

function requireNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0)
    throw new RangeError(`${name}は0以上の有限の数：${String(value)}`);
}

export interface DamageApplied {
  readonly toWard: number;
  readonly toHp: number;
  /** この攻撃でHPが0になった。 */
  readonly died: boolean;
}

export class Health {
  readonly maxHp: number;
  readonly maxWard: number;
  private readonly rechargeDelay: number;
  private hpValue: number;
  private wardValue: number;
  private sinceHit = Infinity;

  constructor(config: HealthConfig) {
    const maxWard = config.maxWard ?? 0;
    const rechargeDelay = config.wardRechargeDelay ?? 2;
    if (!Number.isFinite(config.maxHp) || !(config.maxHp > 0))
      throw new RangeError(`最大HPは0より大きい有限の数：${String(config.maxHp)}`);
    requireNonNegativeFinite(maxWard, "最大魔障");
    requireNonNegativeFinite(rechargeDelay, "魔障が回復し始めるまでの秒数");
    this.maxHp = config.maxHp;
    this.maxWard = maxWard;
    this.rechargeDelay = rechargeDelay;
    this.hpValue = this.maxHp;
    this.wardValue = this.maxWard;
  }

  get hp(): number {
    return this.hpValue;
  }
  get ward(): number {
    return this.wardValue;
  }
  get dead(): boolean {
    return this.hpValue <= 0;
  }

  /**
   * ダメージを受ける。魔障が先に吸収する。0、または死亡後は何もしない。
   * 0以上の有限の数でなければ、状態を変えずに RangeError。
   */
  takeDamage(amount: number): DamageApplied {
    requireNonNegativeFinite(amount, "ダメージ");
    if (amount === 0 || this.dead) return { toWard: 0, toHp: 0, died: false };
    this.sinceHit = 0;
    const toWard = Math.min(this.wardValue, amount);
    this.wardValue -= toWard;
    const toHp = Math.min(this.hpValue, amount - toWard);
    this.hpValue -= toHp;
    return { toWard, toHp, died: this.hpValue <= 0 };
  }

  /**
   * HPを回復し、実際に回復した量を返す（最大HPまで）。0、または死亡後は何もしない。
   * 0以上の有限の数でなければ、状態を変えずに RangeError。
   */
  heal(amount: number): number {
    requireNonNegativeFinite(amount, "回復量");
    if (amount === 0 || this.dead) return 0;
    const healed = Math.min(this.maxHp - this.hpValue, amount);
    this.hpValue += healed;
    return healed;
  }

  /** 全回復（町に入ったとき・死亡して戻ったとき。補助仕様書6・7章）。 */
  restoreFull(): void {
    this.hpValue = this.maxHp;
    this.wardValue = this.maxWard;
    this.sinceHit = Infinity;
  }

  /** 時間を進め、魔障を回復する。0以上の有限の数でなければ、状態を変えずに RangeError。 */
  update(dt: number): void {
    requireNonNegativeFinite(dt, "経過時間");
    const before = this.sinceHit;
    this.sinceHit += dt;
    if (this.dead || this.maxWard <= 0) return;
    const rechargeTime = Math.max(0, this.sinceHit - Math.max(before, this.rechargeDelay));
    if (rechargeTime > 0)
      this.wardValue = Math.min(this.maxWard, this.wardValue + this.maxWard * 0.2 * rechargeTime);
  }
}
