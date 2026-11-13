import type { Element } from "../content/effect.ts";
import { ELEMENT_TAG } from "../content/elements.ts";
import type { GaugeDef, PhaseFusion } from "../content/job.ts";

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

  /** 獲得量の倍率（職詞「闘志の獲得量+15%」など。1 ＋ 獲得量の増加。0以上）。 */
  gainMultiplier = 1;
  /** 攻撃を受けたときの獲得量の倍率（職紋盤「血を燃やす」で2）。gainMultiplier に掛ける。 */
  takenGainMultiplier = 1;
  /** 最大値の加算（職奥義「無限連撃」でコンボ点+3）。 */
  maxBonus = 0;
  /** 全ての段階に達している扱いにする（職奥義「鬼神化」の間）。 */
  forceStages = false;
  /** 動いている間の「止まっている間」の獲得の倍率（職奥義「疾風」で0.5。既定は動くと増えない）。 */
  movingStationaryMultiplier = 0;
  /** 直前に当てた敵（同じ敵に当て続けたときの獲得。集中）。 */
  private lastTarget: string | undefined;
  /** 位相の開始の量（職詞「位相を1から開始する」で1。位相の仕組みを持つゲージだけに効く）。 */
  private start = 0;
  /** 位相：直前の属性と、その前の（違う）属性。合成魔法は、この2つで決まる（仕様書v0.2 5.4）。 */
  private lastElement: Element | undefined;
  private prevElement: Element | undefined;

  constructor(def: GaugeDef) {
    this.def = def;
  }

  /** 位相の開始の量。戦闘外のあいだは、位相はいつも開始の量なので、すぐに反映する。 */
  get startValue(): number {
    return this.start;
  }
  set startValue(n: number) {
    if (this.def.phase === undefined) return;
    this.start = Math.max(0, Math.min(this.max, n));
    if (!this.inCombat) this.v = this.start;
  }

  get value(): number {
    return Math.max(this.v, this.floor);
  }
  get max(): number {
    return this.def.max + this.maxBonus;
  }
  get inCombat(): boolean {
    return this.idle < OUT_OF_COMBAT_SECONDS;
  }

  /**
   * 達している段階の名前（例：50以上なら empowered、100なら empowered と release）。
   * 位相のゲージは、変わる合成魔法の名前（例：steam）だけ。
   */
  get stages(): readonly string[] {
    if (this.def.phase !== undefined) {
      const f = this.fusion;
      return f === undefined ? [] : [f.id];
    }
    const value = this.value;
    return this.def.stages.filter((s) => this.forceStages || value >= s.min).map((s) => s.id);
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
    this.v = Math.min(this.max, Math.max(this.floor, this.value + amount));
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

  /** 呪文の属性（呪文のタグのうち、位相に数える属性。無ければ undefined）。 */
  phaseElementOf(tags: readonly string[]): Element | undefined {
    return this.def.phase?.elements.find((e) => tags.includes(ELEMENT_TAG[e]));
  }

  /**
   * 呪文を使ったとき（位相。仕様書v0.2 5.4）。element は呪文の属性（属性を持たない呪文は undefined）。
   * 直前が無い・同じ属性・違う属性のそれぞれで、遷移表の分だけ位相が変わる。違う属性（と最初の属性）は、
   * 直前の2つの属性として覚える（同じ属性を続けても、覚えるものは変わらない）。位相のゲージでなければ何もしない。
   * 位相が変わった量を返す。
   */
  onSpellCast(element: Element | undefined): number {
    const phase = this.def.phase;
    if (phase === undefined) return 0;
    this.markCombat();
    if (element === undefined || !phase.elements.includes(element)) {
      if (phase.neutral !== "reset") return 0;
      return this.reset();
    }
    const last = this.lastElement;
    const input = last === undefined ? "first" : last === element ? "same" : "different";
    if (input !== "same") {
      this.prevElement = last;
      this.lastElement = element;
    }
    const add = phase.transitions.find((t) => t.input === input)?.add ?? 0;
    return add === 0 ? 0 : this.add(add);
  }

  /** 次の呪文を変える合成魔法（位相が足りていて、直前の2つの属性の組み合わせが表にあるとき）。 */
  get fusion(): PhaseFusion | undefined {
    const f = this.def.phase?.fusion;
    const a = this.prevElement;
    const b = this.lastElement;
    if (f === undefined || a === undefined || b === undefined || this.value < f.at - 1e-9)
      return undefined;
    return f.table.find(
      (r) =>
        (r.elements[0] === a && r.elements[1] === b) ||
        (r.elements[0] === b && r.elements[1] === a),
    );
  }

  /**
   * この呪文（のタグ）が、合成魔法に変わるか。変わるのは、合成魔法を作った2つの属性のどちらかの呪文
   * （蒸爆なら火・氷。その呪文のダメージ×倍率になるので、組み合わせと関係のない属性の呪文は変えない。D-MAG-4）。
   * 属性を持たない呪文・除く印のある呪文（隕星）も変わらない。
   */
  fusionFor(tags: readonly string[]): PhaseFusion | undefined {
    const f = this.def.phase?.fusion;
    const element = this.phaseElementOf(tags);
    if (f === undefined || element === undefined) return undefined;
    if (f.excludeTags.some((t) => tags.includes(t))) return undefined;
    const row = this.fusion;
    return row !== undefined && row.elements.includes(element) ? row : undefined;
  }

  /** 直前に使った呪文の属性（位相。次に違う属性を選ぶ目安。無ければ undefined）。 */
  get lastSpellElement(): Element | undefined {
    return this.lastElement;
  }

  /** 合成魔法を使った。位相を決まった量に戻し、直前の属性を忘れる。 */
  useFusion(): void {
    const f = this.def.phase?.fusion;
    if (f === undefined) return;
    this.markCombat();
    this.v = Math.max(this.floor, f.after);
    this.lastElement = undefined;
    this.prevElement = undefined;
  }

  /** 位相を開始の量に戻し、直前の属性を忘れる。変わった量を返す。 */
  private reset(): number {
    const before = this.value;
    this.v = Math.max(this.floor, this.start);
    this.lastElement = undefined;
    this.prevElement = undefined;
    return this.value - before;
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
    return this.add(gained * this.gainMultiplier);
  }

  /** 攻撃を受けたとき（最大HPの1%につき、決まった量）。 */
  onDamageTaken(amount: number, maxHp: number): number {
    this.markCombat();
    if (!(amount > 0) || !(maxHp > 0)) return 0;
    let gained = 0;
    for (const g of this.def.gains) {
      if (g.on === "damageTaken") gained += (amount / maxHp) * 100 * g.valuePerPercentOfMaxHp;
    }
    return this.add(gained * this.gainMultiplier * this.takenGainMultiplier);
  }

  /** 攻撃を受けたとき（回避されなかったヒット1回。集中は-20）。獲得量の倍率は掛けない。 */
  onHitTaken(): number {
    let delta = 0;
    for (const g of this.def.gains) if (g.on === "hitTaken") delta += g.value;
    return delta === 0 ? 0 : this.add(delta);
  }

  /**
   * 技の1回の使用で、敵に当たったとき（使用ごとに1回。docs/progress D-ARC-3）。
   * 直前に当てた敵と同じなら決まった量が増える（集中+5）。違えば、その敵を覚えるだけ。
   */
  onHitTarget(targetId: string): number {
    const same = this.lastTarget === targetId;
    this.lastTarget = targetId;
    if (!same) return 0;
    let gained = 0;
    for (const g of this.def.gains) if (g.on === "hitSameTarget") gained += g.value;
    return gained === 0 ? 0 : this.add(gained * this.gainMultiplier);
  }

  /**
   * 止まっている間の獲得（集中：毎秒20）。動いている間は movingStationaryMultiplier を掛ける。
   * 戦闘中（inCombat）だけ増える（町や戦闘の合間に溜めて、満タンで戦い始められないように）。
   * 経過時間が0以上の有限の数でなければ RangeError。
   */
  onStill(dt: number, moving: boolean): number {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError("経過時間は0以上の有限の数");
    if (!this.inCombat) return 0;
    const k = moving ? this.movingStationaryMultiplier : 1;
    if (!(k > 0)) return 0;
    let gained = 0;
    for (const g of this.def.gains) if (g.on === "stationary") gained += g.perSecond * dt;
    return gained === 0 ? 0 : this.add(gained * k * this.gainMultiplier);
  }

  /**
   * 時間を進める。戦闘外なら毎秒 decayOutOfCombat ずつ減る。
   * 経過時間が0以上の有限の数でなければ、状態を変えずに RangeError。
   */
  update(dt: number): void {
    // 状態を変える前に検証する（NaN・負の数・無限大を受け付けない。ActionTimeline.update と同じ）
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError("経過時間は0以上の有限の数");
    const before = this.idle;
    this.idle += dt;
    // 位相は、戦闘外になったら開始の量に戻る（町で溜めて、満タンで戦い始められないように。D-MAG-3）
    if (
      this.def.phase !== undefined &&
      before < OUT_OF_COMBAT_SECONDS &&
      this.idle >= OUT_OF_COMBAT_SECONDS
    )
      this.reset();
    const decayTime = Math.max(0, this.idle - Math.max(before, OUT_OF_COMBAT_SECONDS));
    if (decayTime > 0) {
      this.v = Math.max(
        this.floor,
        this.value - this.def.decayOutOfCombat * this.decayMultiplier * decayTime,
      );
    }
  }
}
