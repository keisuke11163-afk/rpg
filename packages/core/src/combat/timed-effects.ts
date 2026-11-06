import type { EffectInstance } from "../effects/evaluate.ts";

interface TimedEntry {
  readonly effectId: string;
  /** どこから来たか（例：SKL-WARRIOR-WARCRY）。 */
  readonly ref: string;
  remaining: number;
}

/**
 * 一定時間だけ働く効果（戦吼の強化・威圧・破軍の後の守りなど）。
 * 同じ効果をもう一度受けたときは、重ねずに、残りの時間の長い方にする（仮値: 仕様書に記載がないため。docs/progress D-U08-4）。
 */
export class TimedEffects {
  private readonly entries: TimedEntry[] = [];
  private changes = 0;

  /** 効果が増えた・切れたときに増える数（評価のやり直しの判定に使う）。 */
  get version(): number {
    return this.changes;
  }

  add(effectId: string, duration: number, ref: string): void {
    if (!(duration > 0)) throw new RangeError("時間は正の数");
    const current = this.entries.find((e) => e.effectId === effectId);
    if (current !== undefined) {
      current.remaining = Math.max(current.remaining, duration);
      return;
    }
    this.entries.push({ effectId, ref, remaining: duration });
    this.changes += 1;
  }

  has(effectId: string): boolean {
    return this.entries.some((e) => e.effectId === effectId);
  }

  /** 残りの時間（かかっていなければ0）。 */
  remaining(effectId: string): number {
    return this.entries.find((e) => e.effectId === effectId)?.remaining ?? 0;
  }

  get active(): readonly {
    readonly effectId: string;
    readonly ref: string;
    readonly remaining: number;
  }[] {
    return this.entries;
  }

  /** 時間を進め、切れた効果を取り除く。経過時間が0以上の有限の数でなければ、状態を変えずに RangeError。 */
  update(dt: number): void {
    // 状態を変える前に検証する（NaN・負の数・無限大を受け付けない。ActionTimeline.update と同じ）
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError("経過時間は0以上の有限の数");
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      if (e === undefined) continue;
      e.remaining -= dt;
      if (e.remaining <= 1e-9) {
        this.entries.splice(i, 1);
        this.changes += 1;
      }
    }
  }

  clear(): void {
    if (this.entries.length === 0) return;
    this.entries.length = 0;
    this.changes += 1;
  }

  /** 効果の評価（evaluateEffects）に渡す形。 */
  instances(): EffectInstance[] {
    return this.entries.map((e) => ({
      effectId: e.effectId,
      source: { kind: "buff", ref: e.ref },
    }));
  }
}
