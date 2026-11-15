/**
 * 固定の時間刻み。ルールは実時間ではなく「刻み（tick）」で進める（開発環境構築計画 5章）。
 * 1秒＝60刻み。描画のフレーム間隔がばらついても、ルールの結果は変わらない。
 */

export const TICKS_PER_SECOND = 60;
/** 1刻みの秒数 */
export const TICK_SECONDS = 1 / TICKS_PER_SECOND;
/** 1回の更新で進める刻みの上限（長い停止の後に、まとめて進みすぎないため） */
export const MAX_TICKS_PER_UPDATE = 10;

export function secondsToTicks(seconds: number): number {
  return Math.round(seconds * TICKS_PER_SECOND);
}

export function ticksToSeconds(ticks: number): number {
  return ticks / TICKS_PER_SECOND;
}

/** 実時間の経過（ミリ秒）を受け取り、進めるべき刻みの数を返す。余りは次回に持ち越す */
export class FixedStepper {
  private accumulatorMs = 0;
  private readonly stepMs = 1000 / TICKS_PER_SECOND;

  advance(elapsedMs: number): number {
    if (!(elapsedMs > 0)) return 0;
    this.accumulatorMs += elapsedMs;
    let ticks = Math.floor(this.accumulatorMs / this.stepMs + 1e-9);
    this.accumulatorMs -= ticks * this.stepMs;
    if (ticks > MAX_TICKS_PER_UPDATE) {
      ticks = MAX_TICKS_PER_UPDATE;
      this.accumulatorMs = 0;
    }
    return ticks;
  }

  /** 次の刻みまでの進み具合（0〜1）。描画の補間用 */
  get alpha(): number {
    return this.accumulatorMs / this.stepMs;
  }

  reset(): void {
    this.accumulatorMs = 0;
  }
}
