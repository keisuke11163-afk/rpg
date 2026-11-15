/**
 * 薬瓶（補助仕様書 6章）。HP瓶・MP瓶：最大3回、1.5秒かけて回復、敵を倒すと「充填」がたまる。
 */
import type { EnemyRank } from "../enemy/def.ts";

export const FLASK_CHARGES = 3;
export const FLASK_SECONDS = 1.5;
/** 充填が40たまるごとに1回分戻る */
export const FILL_PER_CHARGE = 40;

/** 敵を倒したときの充填：通常1・魔法3・精鋭10・中ボス30・章ボス40 */
export const FILL_VALUE: Readonly<Record<EnemyRank | "midBoss" | "chapterBoss", number>> = {
  normal: 1,
  magic: 3,
  elite: 10,
  midBoss: 30,
  chapterBoss: 40,
};

export class Flask {
  readonly kind: "hp" | "mp";
  /** 回復の割合（HP瓶40%・MP瓶50%） */
  readonly ratio: number;
  charges = FLASK_CHARGES;
  private fill = 0;
  /** 回復している残り時間（この間は同じ瓶をもう一度使えない） */
  private left = 0;
  private perSecond = 0;

  constructor(kind: "hp" | "mp") {
    this.kind = kind;
    this.ratio = kind === "hp" ? 0.4 : 0.5;
  }

  get using(): boolean {
    return this.left > 0;
  }

  /** 使う。回復量の補正（革の帯：+15% → bonus 0.15）。最大値は呼び出し側が渡す */
  use(max: number, bonus = 0): boolean {
    if (this.charges <= 0 || this.using) return false;
    this.charges--;
    this.left = FLASK_SECONDS;
    this.perSecond = (max * this.ratio * (1 + bonus)) / FLASK_SECONDS;
    return true;
  }

  /** dt秒進める。この刻みで回復する量を返す */
  tick(dt: number): number {
    if (this.left <= 0) return 0;
    const step = Math.min(dt, this.left);
    this.left -= step;
    return this.perSecond * step;
  }

  /** 敵を倒して充填がたまる。40たまるごとに1回分戻る（最大3回） */
  addFill(value: number): void {
    this.fill += value;
    while (this.fill >= FILL_PER_CHARGE) {
      this.fill -= FILL_PER_CHARGE;
      if (this.charges < FLASK_CHARGES) this.charges++;
      else this.fill = 0;
    }
  }

  /** 町に入ったとき・死亡して町に戻ったとき：全回復 */
  refill(): void {
    this.charges = FLASK_CHARGES;
    this.fill = 0;
    this.left = 0;
  }
}
