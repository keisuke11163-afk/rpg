/**
 * 固定の時間刻み（開発計画書 F-1、開発環境構築計画 5章）。
 *
 * ルールの中核は実時間を使わない。表示層が実際に経った秒数を渡し、
 * この時計が「何回、固定の刻みで計算を進めるか」と「描画の補間の割合」を返す。
 * 描画のフレームレートが変わっても、計算の結果は変わらない。
 */

/** 標準の時間刻み（秒）。60回／秒。 */
export const DEFAULT_STEP_SECONDS = 1 / 60;

/** 1回の advance で進める刻みの上限の標準。重い処理の後に計算が追いつかなくなる（死のらせん）のを防ぐ。 */
export const DEFAULT_MAX_STEPS_PER_ADVANCE = 5;

export interface FixedStepOptions {
  /** 1刻みの秒数（正の数）。 */
  readonly stepSeconds?: number;
  /** 1回の advance で進める刻みの上限（1以上の整数）。超えた分の時間は捨てる。 */
  readonly maxStepsPerAdvance?: number;
}

export interface FixedStepAdvance {
  /** この呼び出しで計算を進める回数。 */
  readonly steps: number;
  /** 描画の補間の割合（0以上1未満）。前の刻みと次の刻みの間のどこにいるか。 */
  readonly alpha: number;
  /** 上限を超えたために捨てた秒数。 */
  readonly droppedSeconds: number;
}

export class FixedStepClock {
  readonly stepSeconds: number;
  readonly maxStepsPerAdvance: number;
  private accumulator = 0;
  private ticks = 0;

  constructor(options: FixedStepOptions = {}) {
    const step = options.stepSeconds ?? DEFAULT_STEP_SECONDS;
    const maxSteps = options.maxStepsPerAdvance ?? DEFAULT_MAX_STEPS_PER_ADVANCE;
    if (!(Number.isFinite(step) && step > 0)) {
      throw new RangeError(`時間刻みは正の数にする: ${String(step)}`);
    }
    if (!(Number.isInteger(maxSteps) && maxSteps >= 1)) {
      throw new RangeError(`刻みの上限は1以上の整数にする: ${String(maxSteps)}`);
    }
    this.stepSeconds = step;
    this.maxStepsPerAdvance = maxSteps;
  }

  /** これまでに進めた刻みの数。 */
  get tick(): number {
    return this.ticks;
  }

  /** これまでに進めた刻みの合計の秒数（刻みの数 × 刻みの秒数。誤差がたまらない）。 */
  get elapsedSeconds(): number {
    return this.ticks * this.stepSeconds;
  }

  /**
   * 実際に経った秒数を渡し、計算を進める回数を受け取る。
   * 負の数・NaN・無限大は0として扱う（タブの切り替えなどで異常な値が来ても壊れない）。
   */
  advance(deltaSeconds: number): FixedStepAdvance {
    const delta = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;
    this.accumulator += delta;
    // 刻みちょうどの時間が浮動小数の誤差でわずかに足りなくならないように、小さな余裕を見る
    const epsilon = this.stepSeconds * 1e-9;
    let steps = Math.floor((this.accumulator + epsilon) / this.stepSeconds);
    let droppedSeconds = 0;
    if (steps > this.maxStepsPerAdvance) {
      droppedSeconds = (steps - this.maxStepsPerAdvance) * this.stepSeconds;
      steps = this.maxStepsPerAdvance;
    }
    this.accumulator = Math.max(0, this.accumulator - (steps * this.stepSeconds + droppedSeconds));
    this.ticks += steps;
    const alpha = Math.min(this.accumulator / this.stepSeconds, 1 - Number.EPSILON);
    return { steps, alpha, droppedSeconds };
  }

  /** 時計を最初の状態に戻す。 */
  reset(): void {
    this.accumulator = 0;
    this.ticks = 0;
  }
}
