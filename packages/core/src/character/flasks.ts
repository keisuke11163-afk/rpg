import type { DropSource } from "../content/item.ts";

/**
 * 薬瓶の決まり（補助仕様書6章【正式。数値は仮値】）。
 * - HP瓶・MP瓶は、それぞれ最大3回
 * - HP瓶は最大HPの40%、MP瓶は最大MPの50%を、1.5秒かけて回復する（腰の装備の「薬瓶の回復量」が掛かる）
 * - 回復している1.5秒の間は、同じ瓶をもう一度使えない
 * - 敵を倒すと「充填」がたまり、40たまるごとに1回分戻る（HP瓶とMP瓶は別にたまる）
 * - 町に入ったとき・死亡して町に戻ったときに全回復
 */
export const FLASK_RULES = {
  maxCharges: 3,
  hpRatio: 0.4,
  mpRatio: 0.5,
  duration: 1.5,
  fillPerCharge: 40,
} as const;

/** 敵を倒したときの充填（補助仕様書6章：通常1・魔法3・精鋭10・中ボス30・章ボス40）。宝箱は0。 */
export const FLASK_FILL: Readonly<Record<DropSource, number>> = {
  normal: 1,
  magic: 3,
  elite: 10,
  miniBoss: 30,
  chapterBoss: 40,
  abyssBoss: 40,
  woodChest: 0,
  oldChest: 0,
};

/** 引き継ぐ状態（ダンジョンからダンジョンへ移るとき）。 */
export interface FlaskState {
  readonly charges: number;
  readonly fill: number;
}

/** 薬瓶1本（HP瓶かMP瓶）。 */
export class Flask {
  private chargesValue: number = FLASK_RULES.maxCharges;
  private fillValue = 0;
  /** 回復の残り（秒）と、1秒あたりの回復量。 */
  private remaining = 0;
  private perSecond = 0;

  constructor(state?: FlaskState) {
    if (state !== undefined) {
      if (
        !Number.isInteger(state.charges) ||
        state.charges < 0 ||
        state.charges > FLASK_RULES.maxCharges
      )
        throw new RangeError(`薬瓶の回数は0〜${String(FLASK_RULES.maxCharges)}の整数`);
      if (!(
        Number.isFinite(state.fill) &&
        state.fill >= 0 &&
        state.fill < FLASK_RULES.fillPerCharge
      ))
        throw new RangeError(`充填は0以上${String(FLASK_RULES.fillPerCharge)}未満`);
      this.chargesValue = state.charges;
      this.fillValue = state.fill;
    }
  }

  get charges(): number {
    return this.chargesValue;
  }
  get fill(): number {
    return this.fillValue;
  }
  /** 回復している最中か（その間は、もう一度使えない）。 */
  get active(): boolean {
    return this.remaining > 0;
  }
  get state(): FlaskState {
    return { charges: this.chargesValue, fill: this.fillValue };
  }

  /**
   * 使う。total は回復の総量（最大値 × 割合 × 回復量の倍率）。回数が無い・回復の最中なら使わずに false。
   */
  use(total: number): boolean {
    if (!(Number.isFinite(total) && total >= 0)) throw new RangeError("回復量は0以上の有限の数");
    if (this.chargesValue <= 0 || this.active) return false;
    this.chargesValue -= 1;
    this.remaining = FLASK_RULES.duration;
    this.perSecond = total / FLASK_RULES.duration;
    return true;
  }

  /** 時間を進め、この刻みの回復量を返す。 */
  update(dt: number): number {
    if (!(dt >= 0)) throw new RangeError("経過時間は0以上");
    if (this.remaining <= 0) return 0;
    const t = Math.min(dt, this.remaining);
    this.remaining = this.remaining - t <= 1e-9 ? 0 : this.remaining - t;
    return this.perSecond * t;
  }

  /** 敵を倒して充填する。40たまるごとに1回分戻る（最大の回数なら、充填は捨てる）。 */
  addFill(points: number): void {
    if (!(Number.isFinite(points) && points >= 0)) throw new RangeError("充填は0以上の有限の数");
    if (this.chargesValue >= FLASK_RULES.maxCharges) {
      this.fillValue = 0;
      return;
    }
    this.fillValue += points;
    while (
      this.fillValue >= FLASK_RULES.fillPerCharge &&
      this.chargesValue < FLASK_RULES.maxCharges
    ) {
      this.fillValue -= FLASK_RULES.fillPerCharge;
      this.chargesValue += 1;
    }
    if (this.chargesValue >= FLASK_RULES.maxCharges) this.fillValue = 0;
  }

  /** 全回復（町に入ったとき・死亡して町に戻ったとき）。回復の最中のものは取り消す。 */
  refill(): void {
    this.chargesValue = FLASK_RULES.maxCharges;
    this.fillValue = 0;
    this.remaining = 0;
  }
}
