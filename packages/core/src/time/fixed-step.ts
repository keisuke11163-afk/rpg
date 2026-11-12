/**
 * 固定の時間刻み（補助仕様書 0.1：計算は1/60秒ごとに行う）。
 *
 * 描画のフレームの間隔は一定ではないので、経過した時間を貯めておき、
 * 1刻み分ずつ計算を進める。core は実時間を読まず、経過時間を受け取るだけにする。
 */

/** 1刻みの長さ（秒）。 */
export const FIXED_STEP_SECONDS = 1 / 60;

export interface AdvanceResult {
  /** この呼び出しで進める刻みの数。 */
  readonly steps: number;
  /** 次の刻みまでの進み具合（0以上1未満）。描画の補間に使う。 */
  readonly alpha: number;
  /** 処理が追いつかず、切り捨てた時間（秒）。 */
  readonly droppedSeconds: number;
}

export class FixedStepClock {
  readonly stepSeconds: number;
  readonly maxStepsPerAdvance: number;
  private accumulated = 0;
  private total = 0;

  /**
   * @param stepSeconds 1刻みの長さ（秒）
   * @param maxStepsPerAdvance 1回で進める刻みの上限。処理が重いときに、
   *   追いつこうとして更に重くなるのを防ぐ
   */
  constructor(stepSeconds: number = FIXED_STEP_SECONDS, maxStepsPerAdvance = 5) {
    // NaN・0以下・Infinity・-Infinity を拒否する（Infinity では刻みが進まなくなる）
    if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) {
      throw new RangeError(`刻みの長さは正の有限の数（${String(stepSeconds)}）`);
    }
    if (!Number.isInteger(maxStepsPerAdvance) || maxStepsPerAdvance < 1) {
      throw new RangeError("刻みの上限は1以上の整数");
    }
    this.stepSeconds = stepSeconds;
    this.maxStepsPerAdvance = maxStepsPerAdvance;
  }

  /** これまでに進めた刻みの合計。 */
  get totalSteps(): number {
    return this.total;
  }

  /** 経過した時間（秒）を受け取り、進める刻みの数を返す。 */
  advance(deltaSeconds: number): AdvanceResult {
    if (!(deltaSeconds >= 0) || !Number.isFinite(deltaSeconds)) {
      throw new RangeError("経過時間は0以上の有限の数");
    }
    this.accumulated += deltaSeconds;
    // 浮動小数点の誤差で、ちょうど1刻み分が足りなくならないように少しだけ余裕を持たせる
    let steps = Math.floor(this.accumulated / this.stepSeconds + 1e-9);
    let droppedSeconds = 0;
    if (steps > this.maxStepsPerAdvance) {
      droppedSeconds = (steps - this.maxStepsPerAdvance) * this.stepSeconds;
      steps = this.maxStepsPerAdvance;
    }
    this.accumulated = Math.max(0, this.accumulated - (steps * this.stepSeconds + droppedSeconds));
    this.total += steps;
    return {
      steps,
      alpha: Math.min(this.accumulated / this.stepSeconds, 0.999999),
      droppedSeconds,
    };
  }
}
