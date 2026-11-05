/**
 * 攻撃の時間の流れ（補助仕様書 10.1：予兆・当たり判定が出ている時間・硬直を、攻撃ごとにデータで持つ）。
 * プレイヤーの攻撃にも使う（動作の時間 ＝ 予兆＋当たり判定＋硬直）。
 */
export interface TimelineSpec {
  /** 予兆（溜め）の秒数。 */
  readonly windup: number;
  /** 当たり判定が出ている秒数。 */
  readonly active: number;
  /** 硬直の秒数。 */
  readonly recovery: number;
}

export type TimelinePhase = "windup" | "active" | "recovery" | "done";

/** その刻みで起きたこと。 */
export interface TimelineEvents {
  /** 当たり判定が出始めた（ヒットの判定をする）。 */
  readonly activeStarted: boolean;
  /** 動作が終わった。 */
  readonly finished: boolean;
}

export class ActionTimeline {
  readonly spec: TimelineSpec;
  private elapsed = 0;
  private activeFired = false;
  private finishedFired = false;

  constructor(spec: TimelineSpec) {
    for (const key of ["windup", "active", "recovery"] as const) {
      const v = spec[key];
      if (!Number.isFinite(v) || v < 0)
        throw new RangeError(`${key} の時間は0以上の有限の数：${String(v)}`);
    }
    // 各フェーズが有限でも、合計が無限大に溢れると終わらない動作になるため拒否する
    if (!Number.isFinite(spec.windup + spec.active + spec.recovery))
      throw new RangeError("動作の時間の合計は有限の数");
    // 後から書き換えられても検証済みの値を保つため、写しを持つ
    this.spec = { windup: spec.windup, active: spec.active, recovery: spec.recovery };
  }

  get total(): number {
    return this.spec.windup + this.spec.active + this.spec.recovery;
  }

  get phase(): TimelinePhase {
    const { windup, active } = this.spec;
    if (this.elapsed < windup) return "windup";
    if (this.elapsed < windup + active) return "active";
    if (this.elapsed < this.total) return "recovery";
    return "done";
  }

  /** 経過した割合（0〜1）。 */
  get progress(): number {
    return this.total <= 0 ? 1 : Math.min(1, this.elapsed / this.total);
  }

  /** 時間を進める。当たり判定の始まりと動作の終わりは、それぞれ1回だけ知らせる。 */
  update(dt: number): TimelineEvents {
    // elapsed・イベントの状態を変える前に検証する（NaN・負の数・無限大を受け付けない）
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError("経過時間は0以上の有限の数");
    this.elapsed += dt;
    // 1/60秒を足し合わせたときの浮動小数点の誤差で、1刻み遅れないように少しだけ余裕を持たせる
    const activeStarted = !this.activeFired && this.elapsed >= this.spec.windup - 1e-9;
    if (activeStarted) this.activeFired = true;
    const finished = !this.finishedFired && this.elapsed >= this.total - 1e-9;
    if (finished) this.finishedFired = true;
    return { activeStarted, finished };
  }
}

/**
 * プレイヤーの攻撃の時間（動作の時間を、予兆・当たり判定・硬直に分ける割合）。
 * 仮値: 予兆30%・当たり判定10%・硬直60%。仕様書・補助仕様書に割合の記載がないため（docs/progress D-U07-1）
 */
export const PLAYER_ATTACK_SPLIT = { windup: 0.3, active: 0.1, recovery: 0.6 } as const;

/** 動作の時間（秒）から、プレイヤーの攻撃の時間の流れを作る。 */
export function playerAttackTimeline(actionSeconds: number): TimelineSpec {
  return {
    windup: actionSeconds * PLAYER_ATTACK_SPLIT.windup,
    active: actionSeconds * PLAYER_ATTACK_SPLIT.active,
    recovery: actionSeconds * PLAYER_ATTACK_SPLIT.recovery,
  };
}
