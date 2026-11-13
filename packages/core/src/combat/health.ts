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
  private maxHpValue: number;
  private maxWardValue: number;
  private rechargeDelay: number;
  private hpValue: number;
  private wardValue: number;
  private sinceHit = Infinity;
  /**
   * ダメージを受けない（ボスの段階の切り替えの2秒・根渡りで地中にいる間。補助仕様書11.1、仕様書8.4）。
   * 受けるダメージは0として扱う（被弾からの時間も戻さない）。
   */
  invulnerable = false;
  private floorValue = 0;

  constructor(config: HealthConfig) {
    const maxWard = config.maxWard ?? 0;
    const rechargeDelay = config.wardRechargeDelay ?? 2;
    if (!Number.isFinite(config.maxHp) || !(config.maxHp > 0))
      throw new RangeError(`最大HPは0より大きい有限の数：${String(config.maxHp)}`);
    requireNonNegativeFinite(maxWard, "最大魔障");
    requireNonNegativeFinite(rechargeDelay, "魔障が回復し始めるまでの秒数");
    this.maxHpValue = config.maxHp;
    this.maxWardValue = maxWard;
    this.rechargeDelay = rechargeDelay;
    this.hpValue = this.maxHp;
    this.wardValue = this.maxWard;
  }

  /** 最大HP（能力値が変わると resize で変わる）。 */
  get maxHp(): number {
    return this.maxHpValue;
  }
  /** 最大魔障（能力値が変わると resize で変わる）。 */
  get maxWard(): number {
    return this.maxWardValue;
  }
  /** 魔障が回復し始めるまでの秒数（能力値が変わると resize で変わる）。 */
  get wardRechargeDelay(): number {
    return this.rechargeDelay;
  }

  /**
   * 最大HP・最大魔障・魔障が回復し始めるまでの秒数を、その場で変える（装備・星辰盤などで能力値が変わったとき）。
   * HP・魔障は最大値に対する割合を保つ（最大値が増えても、割合より多くは回復しない）。倒れていれば倒れたまま。
   * 最大魔障が0から増えたときは、魔障は0から（被弾からの時間に応じて、ふだんどおり回復する。
   * 一度も被弾していなければ、すぐに回復し始める）。外して着け直して魔障を満たすことはできない。
   * 被弾からの時間（回復の待ち時間）・ダメージを受けないか・HPの下限は変えない。
   * 値が不正（HealthConfig と同じ範囲の外）、またはHPの下限が新しい最大HP以上なら、何も変えずに RangeError。
   */
  resize(config: HealthConfig): void {
    this.commitResize(this.planResize(config));
  }

  /** resize の計算と検証だけを行い、計画を返す（状態は変えない）。反映は commitResize。 */
  planResize(config: HealthConfig): HealthResizePlan {
    const maxWard = config.maxWard ?? 0;
    const rechargeDelay = config.wardRechargeDelay ?? 2;
    if (!Number.isFinite(config.maxHp) || !(config.maxHp > 0))
      throw new RangeError(`最大HPは0より大きい有限の数：${String(config.maxHp)}`);
    requireNonNegativeFinite(maxWard, "最大魔障");
    requireNonNegativeFinite(rechargeDelay, "魔障が回復し始めるまでの秒数");
    if (this.floorValue >= config.maxHp)
      throw new RangeError(`HPの下限（${String(this.floorValue)}）が最大HP以上になる`);
    // 割合（0〜1）× 有限の最大値なので、どちらも有限で最大値以下
    const hp = Math.min(config.maxHp, (this.hpValue / this.maxHpValue) * config.maxHp);
    const ward =
      this.maxWardValue > 0 ? Math.min(maxWard, (this.wardValue / this.maxWardValue) * maxWard) : 0;
    return { maxHp: config.maxHp, maxWard, rechargeDelay, hp, ward };
  }

  /** planResize の計画を反映する。検証済みの値の代入だけで、例外は起きない。 */
  commitResize(plan: HealthResizePlan): void {
    this.maxHpValue = plan.maxHp;
    this.maxWardValue = plan.maxWard;
    this.rechargeDelay = plan.rechargeDelay;
    this.hpValue = plan.hp;
    this.wardValue = plan.ward;
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

  /** ダメージでこれより下がらないHP（ボスの段階の境目。0は制限なし）。 */
  get floor(): number {
    return this.floorValue;
  }

  /**
   * ダメージでこれより下がらないHPを決める（ボスの段階の境目で止め、段階を飛ばさないため）。
   * 0以上・最大HP未満の有限の数。回復・全回復には関係しない。
   */
  setFloor(hp: number): void {
    if (!(Number.isFinite(hp) && hp >= 0 && hp < this.maxHp))
      throw new RangeError(`HPの下限は0以上・最大HP未満の有限の数：${String(hp)}`);
    this.floorValue = hp;
  }

  /**
   * ダメージを受ける。魔障が先に吸収する。0、または死亡後は何もしない。
   * 0以上の有限の数でなければ、状態を変えずに RangeError。
   */
  takeDamage(amount: number): DamageApplied {
    requireNonNegativeFinite(amount, "ダメージ");
    const next = this.damageStep(this.snapshot(), amount, this.invulnerable);
    this.restore(next.state);
    return next.applied;
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

  /**
   * HPでコストを払う（天極「血の盟約」）。魔障は使わず、被弾にも数えない。
   * 払うと死ぬ（HPが amount 以下）なら、払わずに false。
   */
  payHp(amount: number): boolean {
    requireNonNegativeFinite(amount, "支払うHP");
    if (this.dead || this.hpValue <= amount) return false;
    this.hpValue -= amount;
    return true;
  }

  /** 全回復（町に入ったとき・死亡して戻ったとき。補助仕様書6・7章）。 */
  restoreFull(): void {
    this.hpValue = this.maxHp;
    this.wardValue = this.maxWard;
    this.sinceHit = Infinity;
  }

  /** 時間を進め、魔障を回復する。不正な値・時間の溢れは、状態を変えずに RangeError（planUpdate を参照）。 */
  update(dt: number): void {
    requireNonNegativeFinite(dt, "経過時間");
    this.restore(this.updateStep(this.snapshot(), dt));
  }

  /**
   * 「damage のダメージを受け（0なら受けない）、dt 秒進める」計算と検証だけを行い、
   * 次の状態を計画として返す（状態は変えない）。結果は takeDamage(damage) → update(dt) と同じ。
   * - damage・dt が0以上の有限の数でなければ RangeError
   * - 被弾からの時間（累計）が有限の数で表せなくなる（Number.MAX_VALUE 秒を超える）場合は RangeError。
   *   ただし、一度も被弾していない状態（Infinity）はそのまま
   * invulnerable は、ダメージを受けないかをこの計画だけ決める（省略で今の invulnerable。
   * 反映の前に invulnerable を変える呼び出し元が、変えた後の値で計算するため。Enemy.planUpdate）。
   * 計画は commitUpdate で反映する。
   */
  planUpdate(dt: number, damage = 0, invulnerable = this.invulnerable): HealthUpdatePlan {
    requireNonNegativeFinite(damage, "ダメージ");
    requireNonNegativeFinite(dt, "経過時間");
    const hit = this.damageStep(this.snapshot(), damage, invulnerable);
    const state = this.updateStep(hit.state, dt);
    return { ...state, applied: hit.applied };
  }

  /**
   * planUpdate の計画を反映する。検証済みの値の代入だけで、例外は起きない。
   * 計画を作ってから反映するまでの間に、HP・魔障を変えてはならない（takeDamage・heal など）。
   */
  commitUpdate(plan: HealthUpdatePlan): void {
    this.restore(plan);
  }

  private snapshot(): HealthState {
    return { hp: this.hpValue, ward: this.wardValue, sinceHit: this.sinceHit };
  }

  private restore(state: HealthState): void {
    this.hpValue = state.hp;
    this.wardValue = state.ward;
    this.sinceHit = state.sinceHit;
  }

  /** ダメージを受けた後の状態（amount は検証済み）。状態は変えない。 */
  private damageStep(
    state: HealthState,
    amount: number,
    invulnerable: boolean,
  ): { state: HealthState; applied: DamageApplied } {
    if (amount === 0 || state.hp <= 0 || invulnerable)
      return { state, applied: { toWard: 0, toHp: 0, died: false } };
    const toWard = Math.min(state.ward, amount);
    const ward = state.ward - toWard;
    const toHp = Math.max(0, Math.min(state.hp - this.floorValue, amount - toWard));
    const hp = state.hp - toHp;
    return { state: { hp, ward, sinceHit: 0 }, applied: { toWard, toHp, died: hp <= 0 } };
  }

  /** dt 秒進めた後の状態（dt は検証済み）。状態は変えない。溢れは RangeError。 */
  private updateStep(state: HealthState, dt: number): HealthState {
    const before = state.sinceHit;
    const sinceHit = before + dt;
    // 一度も被弾していない状態（Infinity）以外で、累計が有限でなくなるのは溢れ
    if (Number.isFinite(before) && !Number.isFinite(sinceHit))
      throw new RangeError(`被弾からの時間が有限の値にならない（${String(sinceHit)}）`);
    if (state.hp <= 0 || this.maxWard <= 0) return { ...state, sinceHit };
    // 一度も被弾していない（Infinity）なら、ずっと回復できる状態（最大魔障が0から増えたときだけ、満タンでない）
    const rechargeTime = Number.isFinite(before)
      ? Math.max(0, sinceHit - Math.max(before, this.rechargeDelay))
      : dt;
    let ward = state.ward;
    if (rechargeTime > 0) {
      // 回復量が最大魔障までの残りを超えた分は意味を持たない（最大魔障で止まる）。各項は有限・0以上で
      // 積は NaN にならず、Infinity に溢れても min により正しく最大魔障になる（丸めではない）
      ward = Math.min(this.maxWard, state.ward + this.maxWard * 0.2 * rechargeTime);
    }
    if (!Number.isFinite(ward)) throw new RangeError(`魔障が有限の値にならない（${String(ward)}）`);
    return { hp: state.hp, ward, sinceHit };
  }
}

interface HealthState {
  readonly hp: number;
  readonly ward: number;
  /** 被弾からの時間（一度も被弾していなければ Infinity）。 */
  readonly sinceHit: number;
}

/** Health.planUpdate の計画（検証済みの次の状態。commitUpdate で反映する）。 */
export interface HealthUpdatePlan extends HealthState {
  /** この計画で受けたダメージの内訳。 */
  readonly applied: DamageApplied;
}

/** Health.planResize の計画（検証済みの次の値。commitResize で反映する）。 */
export interface HealthResizePlan {
  readonly maxHp: number;
  readonly maxWard: number;
  readonly rechargeDelay: number;
  readonly hp: number;
  readonly ward: number;
}
