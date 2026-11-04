/**
 * HPと魔障（仕様書2.6：魔障はHPより先にダメージを吸収する。被弾がない状態が2秒続くと毎秒20%ずつ回復）。
 */
export interface HealthConfig {
  readonly maxHp: number;
  readonly maxWard?: number;
  /** 魔障が回復し始めるまでの秒数（法衣の統一ボーナスで-1秒。仕様書3.3）。 */
  readonly wardRechargeDelay?: number;
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
    if (!(config.maxHp > 0)) throw new RangeError("最大HPは正の数");
    this.maxHp = config.maxHp;
    this.maxWard = Math.max(0, config.maxWard ?? 0);
    this.rechargeDelay = config.wardRechargeDelay ?? 2;
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

  /** ダメージを受ける。魔障が先に吸収する。 */
  takeDamage(amount: number): DamageApplied {
    if (!(amount > 0) || this.dead) return { toWard: 0, toHp: 0, died: false };
    this.sinceHit = 0;
    const toWard = Math.min(this.wardValue, amount);
    this.wardValue -= toWard;
    const toHp = Math.min(this.hpValue, amount - toWard);
    this.hpValue -= toHp;
    return { toWard, toHp, died: this.hpValue <= 0 };
  }

  heal(amount: number): number {
    if (!(amount > 0) || this.dead) return 0;
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

  update(dt: number): void {
    if (!(dt >= 0)) throw new RangeError("経過時間は0以上");
    const before = this.sinceHit;
    this.sinceHit += dt;
    if (this.dead || this.maxWard <= 0) return;
    const rechargeTime = Math.max(0, this.sinceHit - Math.max(before, this.rechargeDelay));
    if (rechargeTime > 0)
      this.wardValue = Math.min(this.maxWard, this.wardValue + this.maxWard * 0.2 * rechargeTime);
  }
}
