import type { Vec2 } from "../actor/vector.ts";
import type { GuardRule } from "../content/job.ts";

/**
 * ガード・パリィ（騎士。仕様書v0.2 5.3、MVP後の機能の提案3章 H-05 ②）。
 *
 * 入力の「ガードを上げている」状態だけを持ち、攻撃が当たったときの結果（防ぐ・パリィ・防げない）を決める。
 * キー・マウスは知らない（技の枠2の押し続けを、呼ぶ側が held・pressed にして渡す）。
 * 数値（受付の秒数・正面の角度・気力・反撃権）は全て規則（GuardRule。ジョブのデータ）から来る。
 *
 * パリィの考え方：「攻撃が当たる0.18秒前以内にガードを始めた」は、当たった時刻から見れば
 * 「ガードを上げてから 0.18秒以内に攻撃が当たった」と同じ。なので、敵の予兆の時間を見なくても、
 * 「ガードを上げた時刻」と「当たった時刻」の差だけで決められる。押し続けのままのガードには、パリィは付かない。
 */

/** 攻撃を受けたときの結果。 */
export type GuardOutcome =
  /** ガードしていない・正面でない・気力が足りない：そのまま受ける。 */
  | { readonly kind: "none" }
  /** ガードで防ぐ：ガード率の分だけダメージが減る。 */
  | { readonly kind: "guard"; readonly rate: number }
  /** パリィ：ダメージを完全に無効にし、敵を崩し、反撃権を得る。 */
  | { readonly kind: "parry" };

/** 攻撃を受ける状況。 */
export interface IncomingAttack {
  /** 今の時刻（秒）。 */
  readonly now: number;
  /** 攻撃してきた敵の位置。 */
  readonly from: Vec2;
  /** 自分の位置・向き（ラジアン）。 */
  readonly position: Vec2;
  readonly facing: number;
  /** 盾のガード率（0〜1。盾の基礎値＋能力値）。盾が無ければ 0。 */
  readonly guardRate: number;
  /** 気力が足りているか（ガードで防ぐ分）。パリィには使わない。 */
  readonly canPay: boolean;
  /** パリィの受付への加算（秒。職詞・装備など）。 */
  readonly parryWindowBonus: number;
}

/** from が、position を中心に facing の向きへ angleDeg の扇の中にいるか（正面からの攻撃か）。 */
export function isInFront(from: Vec2, position: Vec2, facing: number, angleDeg: number): boolean {
  const dx = from.x - position.x;
  const dy = from.y - position.y;
  // 真上に重なっているときは、正面として扱う（防げる側に倒す）
  if (Math.hypot(dx, dy) < 1e-9) return true;
  let diff = Math.abs(Math.atan2(dy, dx) - facing) % (2 * Math.PI);
  if (diff > Math.PI) diff = 2 * Math.PI - diff;
  return diff <= (angleDeg * Math.PI) / 360 + 1e-9;
}

export class GuardState {
  readonly rule: GuardRule;
  /** ガードを上げた時刻（上げていなければ undefined）。上げ直すまで変わらない。 */
  private raisedAt: number | undefined;
  /** 短く押して離しても、ここまではガードを続ける時刻。 */
  private minUntil = -Infinity;
  private held = false;
  /** 反撃権（次の攻撃のダメージに足す）が切れる時刻。 */
  private counterUntil = -Infinity;

  constructor(rule: GuardRule) {
    this.rule = rule;
  }

  /**
   * 入力を渡す（1刻みに1回）。held＝押し続けている、pressed＝この刻みに押した（短く押して離した分も含む）。
   * 押していない状態から押した刻みが「ガードを上げた時刻」（パリィの受付はここから数える）。
   * 技の実行中・回避中・よろめいている間など、ガードできない間は canRaise を false にする（上げている状態もやめる）。
   * 押したままガードできるようになった（技が終わった）ときは、パリィの受付なしでガードが上がる。
   */
  input(now: number, held: boolean, pressed: boolean, canRaise: boolean): void {
    const down = held || pressed;
    const fresh = down && !this.held;
    this.held = down;
    if (!canRaise) {
      this.raisedAt = undefined;
      this.minUntil = -Infinity;
      return;
    }
    if (fresh) {
      this.raisedAt = now;
      this.minUntil = now + this.rule.minRaise;
    } else if (down && this.raisedAt === undefined) {
      this.raisedAt = -Infinity;
    } else if (!down && now >= this.minUntil - 1e-9) {
      this.raisedAt = undefined;
    }
  }

  /** ガードを下ろす（技を使った・回避した・よろめいた）。 */
  lower(): void {
    this.raisedAt = undefined;
    this.minUntil = -Infinity;
  }

  /** ガードを上げているか。 */
  get raised(): boolean {
    return this.raisedAt !== undefined;
  }

  /** ガードを上げてからの秒数（上げていなければ undefined）。 */
  raisedFor(now: number): number | undefined {
    return this.raisedAt === undefined ? undefined : now - this.raisedAt;
  }

  /**
   * 攻撃が当たったときの結果。パリィ＞ガード＞そのまま受ける。
   * - 上げていない・正面でない → none
   * - 上げてから（受付＋加算）の秒数以内 → parry（気力は使わない）
   * - それ以外 → 気力が足りていれば guard（ガード率）、足りなければ none
   */
  judge(a: IncomingAttack): GuardOutcome {
    const since = this.raisedFor(a.now);
    if (since === undefined) return { kind: "none" };
    if (!isInFront(a.from, a.position, a.facing, this.rule.frontAngleDeg)) return { kind: "none" };
    const window = this.rule.parryWindow + a.parryWindowBonus;
    // 浮動小数の誤差（0.18ちょうど）で外れないように、わずかに余裕を持たせる
    if (since <= window + 1e-9) return { kind: "parry" };
    if (!a.canPay || !(a.guardRate > 0)) return { kind: "none" };
    return { kind: "guard", rate: Math.min(1, a.guardRate) };
  }

  /** 反撃権を得る（パリィ成功）。 */
  grantCounter(now: number): void {
    this.counterUntil = now + this.rule.counterSeconds;
  }

  /** 反撃権を持っているか。 */
  hasCounter(now: number): boolean {
    return now < this.counterUntil - 1e-9;
  }

  /** 反撃権を使う：持っていれば、次の攻撃のダメージに足す割合を返して消す。無ければ 0。 */
  consumeCounter(now: number): number {
    if (!this.hasCounter(now)) return 0;
    this.counterUntil = -Infinity;
    return this.rule.counterBonus;
  }
}
