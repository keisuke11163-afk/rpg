/**
 * 画面の揺れ（表示だけ。被弾・会心・崩し）。Phaser に依存しない。
 * 揺れのずれは、カメラのスクロールに足す（ArenaScene）。scrollFactor 0 の HUD はスクロールの影響を
 * 受けないので揺れない（docs/progress D-HUD-12）。照準の計算からは、このずれを差し引く（InputSystem）。
 * 乱数は引数で渡す（表示の乱数。シミュレーションへの入力には使わない。テストでは決まった値を渡す）。
 */

/** 揺れのずれ（ゲームのピクセル）。 */
export interface ShakeOffset {
  readonly x: number;
  readonly y: number;
}

/** 揺れていないときのずれ。 */
export const NO_SHAKE: ShakeOffset = { x: 0, y: 0 };

/**
 * 減衰する揺れ。trigger で始め、毎フレーム update で進めて、ずれを受け取る。
 * 揺れの大きさは、始めた強さから時間とともに直線で0まで減る。
 */
export class ScreenShake {
  private readonly random: () => number;
  private strength = 0;
  private duration = 0;
  private elapsed = 0;

  /** @param random 0以上1未満の乱数（表示の側の乱数。省略すると Math.random）。 */
  constructor(random: () => number = Math.random) {
    this.random = random;
  }

  /** 揺れているか。 */
  get active(): boolean {
    return this.elapsed < this.duration;
  }

  /** 今の揺れの大きさ（ピクセル。揺れていなければ0）。 */
  get amplitude(): number {
    if (!this.active) return 0;
    return this.strength * (1 - this.elapsed / this.duration);
  }

  /**
   * 揺れを始める。
   * 今の揺れ（減った後の大きさ）より強いか同じなら、新しい揺れに置き換える。弱ければ無視する
   * （小さな揺れが続いても、大きな揺れを打ち消さないように）。
   * 強さ・時間が正の有限の数でなければ何もしない。
   * @param strength 始めの大きさ（ピクセル）
   * @param durationMs 0まで減るまでの時間（ミリ秒）
   */
  trigger(strength: number, durationMs: number): void {
    if (!(Number.isFinite(strength) && strength > 0)) return;
    if (!(Number.isFinite(durationMs) && durationMs > 0)) return;
    if (strength < this.amplitude) return;
    this.strength = strength;
    this.duration = durationMs;
    this.elapsed = 0;
  }

  /** 揺れを止める（地域の移動など）。 */
  reset(): void {
    this.strength = 0;
    this.duration = 0;
    this.elapsed = 0;
  }

  /**
   * 時間を進め、今のずれを返す（x・y とも -大きさ〜+大きさ）。揺れ終わっていれば {0, 0}。
   * 負・有限でない経過時間は0として扱う。
   */
  update(deltaMs: number): ShakeOffset {
    if (!this.active) return NO_SHAKE;
    this.elapsed += Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs : 0;
    const amp = this.amplitude;
    if (amp <= 0) return NO_SHAKE;
    return { x: (this.random() * 2 - 1) * amp, y: (this.random() * 2 - 1) * amp };
  }
}

/**
 * 揺れのずれを、カメラの動ける範囲（スクロールの最小〜最大）に収めて足す。
 * 端に当たってずれが削られるときは、反対の向きに揺らす（端でも揺れが見えるように）。
 * 反対にも動けない（地図が画面より小さいなど）ときは、その向きは揺らさない。
 * @returns 実際に足したずれを足した後のスクロールの値
 */
export function shakeWithinBounds(base: number, offset: number, min: number, max: number): number {
  const clamp = (v: number): number => Math.min(max, Math.max(min, v));
  if (offset === 0 || max < min) return base;
  const forward = clamp(base + offset);
  if (forward === base + offset) return forward;
  const backward = clamp(base - offset);
  // 動ける量の多い方を使う
  return Math.abs(backward - base) > Math.abs(forward - base) ? backward : forward;
}
