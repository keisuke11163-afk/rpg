/**
 * 職能ゲージの汎用の仕組み（本仕様書 5.1・5.2）。戦士の闘志、盗賊のコンボ点などを、
 * ジョブごとの定義（データ）で動かす。ゲージごとのコードは書かない。
 */

export interface GaugeDef {
  id: string;
  name: string;
  max: number;
  /** ヒット1回で増える量 */
  hitGain: number;
  /** 重撃のヒットで増える量 */
  heavyHitGain: number;
  /** 攻撃を受けたとき、最大HPの1%につき増える量 */
  damagedGainPerPercentMaxHp: number;
  /** 戦闘していないときの毎秒の減少 */
  idleDecayPerSecond: number;
  /** 攻撃も被弾もない状態がこの秒数続くと「戦闘していない」 */
  idleAfterSeconds: number;
  /** この値以上で、職技が強化版（激化）になる。なければ undefined */
  intensifyAt?: number;
  /** この値で、解放技が使える */
  releaseAt?: number;
  provisional: true;
}

/** ゲージの状態に作用する効果（職紋盤・職奥義・装備が与える） */
export interface GaugeModifiers {
  /** 自然減少の倍率（闘志の炉：0.5） */
  decayMultiplier?: number;
  /** 被弾での獲得の倍率（血を燃やす：2） */
  damagedGainMultiplier?: number;
  /** この値より下がらない（不屈の闘志：30） */
  floor?: number;
  /** 解放技の後に残る値（不屈の闘志：30。なければ0） */
  keepAfterRelease?: number;
  /** 最大値の加算 */
  maxAdd?: number;
}

export class JobGauge {
  readonly def: GaugeDef;
  value = 0;
  mods: GaugeModifiers = {};
  /** 鬼神化などで、解放技を使えなくする・常に激化にする */
  forceIntensified = false;
  releaseDisabled = false;
  private sinceCombat = 0;

  constructor(def: GaugeDef) {
    this.def = def;
  }

  get max(): number {
    return this.def.max + (this.mods.maxAdd ?? 0);
  }

  private clamp(v: number): number {
    return Math.min(this.max, Math.max(this.mods.floor ?? 0, v));
  }

  /** 激化しているか（職技が強化版になる） */
  get intensified(): boolean {
    if (this.forceIntensified) return true;
    return this.def.intensifyAt !== undefined && this.value >= this.def.intensifyAt;
  }

  /** 戦闘していない（攻撃も被弾もない状態が続いている） */
  get outOfCombat(): boolean {
    return this.sinceCombat > this.def.idleAfterSeconds;
  }

  get canRelease(): boolean {
    return (
      !this.releaseDisabled && this.def.releaseAt !== undefined && this.value >= this.def.releaseAt
    );
  }

  /** ヒットを与えた */
  onHit(heavy: boolean): void {
    this.sinceCombat = 0;
    this.value = this.clamp(this.value + (heavy ? this.def.heavyHitGain : this.def.hitGain));
  }

  /** 攻撃を受けた。damage は受けたダメージ、maxHp は最大HP */
  onDamaged(damage: number, maxHp: number): void {
    this.sinceCombat = 0;
    const percent = (damage / maxHp) * 100;
    const gain =
      percent * this.def.damagedGainPerPercentMaxHp * (this.mods.damagedGainMultiplier ?? 1);
    this.value = this.clamp(this.value + gain);
  }

  /** 直接増減（戦吼の闘志+20など） */
  add(amount: number): void {
    this.value = this.clamp(this.value + amount);
  }

  /** 解放技を使った。ゲージを使い切る（不屈の闘志では30から） */
  consume(): void {
    this.value = this.clamp(this.mods.keepAfterRelease ?? 0);
  }

  tick(dt: number): void {
    this.sinceCombat += dt;
    if (this.sinceCombat > this.def.idleAfterSeconds && this.def.idleDecayPerSecond > 0) {
      this.value = this.clamp(
        this.value - this.def.idleDecayPerSecond * (this.mods.decayMultiplier ?? 1) * dt,
      );
    }
  }
}
