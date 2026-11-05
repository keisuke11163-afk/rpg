import type { GaugeDef } from "../content/job.ts";

/** 戦闘外になるまでの時間（補助仕様書3.1：5秒間、攻撃も被弾もない）。 */
export const OUT_OF_COMBAT_SECONDS = 5;

/**
 * 職能ゲージ（仕様書5章。例：戦士の闘志）。
 * ヒットを与える・攻撃を受ける・技を使うと増え、戦闘外になると毎秒減る。
 */
export class JobGauge {
  readonly def: GaugeDef;
  private v = 0;
  /** 最後に攻撃・被弾してからの秒数。 */
  private idle = OUT_OF_COMBAT_SECONDS;
  /** 自然減少の倍率（例：職紋盤「闘志の炉」で0.5）。 */
  decayMultiplier = 1;
  /** 下限（例：職奥義「不屈の闘志」で30）。 */
  floor = 0;

  constructor(def: GaugeDef) {
    this.def = def;
  }

  get value(): number {
    return Math.max(this.v, this.floor);
  }
  get max(): number {
    return this.def.max;
  }
  get inCombat(): boolean {
    return this.idle < OUT_OF_COMBAT_SECONDS;
  }

  /** 達している段階の名前（例：50以上なら empowered、100なら empowered と release）。 */
  get stages(): readonly string[] {
    const value = this.value;
    return this.def.stages.filter((s) => value >= s.min).map((s) => s.id);
  }

  hasStage(stage: string): boolean {
    return this.stages.includes(stage);
  }

  /** 戦闘中にする（攻撃した・被弾した）。 */
  markCombat(): void {
    this.idle = 0;
  }

  /** 量を足す（最大で止める）。足した量を返す。 */
  add(amount: number): number {
    const before = this.value;
    this.v = Math.min(this.def.max, Math.max(this.floor, this.value + amount));
    return this.value - before;
  }

  /** 量を使う。all は全て（下限までの分）。足りなければ使わずに false を返す。 */
  spend(cost: number | "all"): boolean {
    if (cost === "all") {
      this.v = this.floor;
      return true;
    }
    if (this.value < cost) return false;
    this.v = this.value - cost;
    return true;
  }

  /**
   * ヒットを与えたとき（1回の当たり判定で、1体以上に当たったとき1回。docs/progress D-U08-3）。
   * tags は技のタグ（親タグを含む）。決まったタグを持つ技は tagValue を使う（例：重撃は+6）。
   */
  onHitDealt(tags: ReadonlySet<string>): number {
    this.markCombat();
    let gained = 0;
    for (const g of this.def.gains) {
      if (g.on !== "hitDealt") continue;
      gained += g.tag !== undefined && tags.has(g.tag) ? (g.tagValue ?? g.value) : g.value;
    }
    return this.add(gained);
  }

  /** 攻撃を受けたとき（最大HPの1%につき、決まった量）。 */
  onDamageTaken(amount: number, maxHp: number): number {
    this.markCombat();
    if (!(amount > 0) || !(maxHp > 0)) return 0;
    let gained = 0;
    for (const g of this.def.gains) {
      if (g.on === "damageTaken") gained += (amount / maxHp) * 100 * g.valuePerPercentOfMaxHp;
    }
    return this.add(gained);
  }

  /** 時間を進める。戦闘外なら毎秒 decayOutOfCombat ずつ減る。 */
  update(dt: number): void {
    if (!(dt >= 0)) throw new RangeError("経過時間は0以上");
    const before = this.idle;
    this.idle += dt;
    const decayTime = Math.max(0, this.idle - Math.max(before, OUT_OF_COMBAT_SECONDS));
    if (decayTime > 0) {
      this.v = Math.max(
        this.floor,
        this.value - this.def.decayOutOfCombat * this.decayMultiplier * decayTime,
      );
    }
  }
}
