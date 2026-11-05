import type {
  AilmentDef,
  DebuffAilmentDef,
  DotAilmentDef,
  StaggerProfile,
} from "../content/ailment.ts";
import type { Element } from "../content/effect.ts";
import { ELEMENTS } from "../content/effect.ts";
import { ELEMENT_TAG } from "../content/elements.ts";
import type { ContentDb } from "../content/load.ts";
import type { HitScope, ModifierView, StatResult } from "../effects/evaluate.ts";
import { requireFinite } from "../effects/evaluate.ts";
import type { Rng } from "../random/rng.ts";
import type { HitResult } from "./damage.ts";

/** 状態異常の計算で使う能力値のID（データの stats/combat.json）。 */
export const AILMENT_STATS = {
  chance: "STAT-AILMENT-CHANCE",
  damage: "STAT-AILMENT-DAMAGE",
  duration: "STAT-AILMENT-DURATION",
  maxStacks: "STAT-AILMENT-MAX-STACKS",
  stagger: "STAT-STAGGER",
  staggerResist: "STAT-STAGGER-RESIST",
} as const;

/** 種類を数えるときに、同じ1種類として扱うタグ（仕様書v0.2 2.7：冷却・凍結は合わせて1種類）。 */
const SAME_TYPE_AS: Readonly<Record<string, string>> = { "TAG-AIL-FREEZE": "TAG-AIL-CHILL" };
/** 種類に数えないタグ（仕様書v0.2 2.7：崩しは数えない）。 */
const NOT_COUNTED = new Set(["TAG-AIL-STAGGER"]);

/** 状態異常の種類の数（千変など。仕様書v0.2 2.7）。冷却・凍結は1種類、崩しは数えない。 */
export function countAilmentTypes(tagIds: Iterable<string>): number {
  const kinds = new Set<string>();
  for (const id of tagIds) {
    if (NOT_COUNTED.has(id)) continue;
    kinds.add(SAME_TYPE_AS[id] ?? id);
  }
  return kinds.size;
}

/**
 * 状態異常の計算の途中の値・入力の値が有限であることを確かめる（NaN・Infinity は RangeError）。
 * U-04a のダメージの計算と同じく、異常な値を 0 などに置き換えずに、原因の分かる例外にする。
 * 有限の値どうしの積・和でも Infinity になることがあるので、比較・合計に使う前の境目で検証する。
 */
const finite = (value: number, what: string): number =>
  requireFinite(value, () => `状態異常の計算の${what}`);

/**
 * 1回のヒットとして問い合わせる範囲（局所の効果の絞り込み。仕様書v0.2 3.7 の原則5）。
 * 絞り込みは U-04a と同じく、ModifierView の問い合わせに HitScope を渡して行う
 * （出どころの種類が装備で、ref が weaponUid と一致する局所の効果だけが効く。weaponUid が undefined なら局所の効果は効かない）。
 * weaponUid を指定したのに、ヒットがその武器のヒットでない（呪文・別の武器）場合は、局所の効果が漏れるので例外にする。
 */
function hitScope(hit: HitResult, weaponUid: string | undefined): HitScope {
  if (weaponUid !== undefined && weaponUid !== hit.weaponUid) {
    throw new RangeError(
      `状態異常の計算の武器（${weaponUid}）が、ヒットに使った武器（${hit.weaponUid ?? "なし（呪文など）"}）と一致しない`,
    );
  }
  return { weaponUid };
}

/**
 * 修正値の合計。局所の効果の絞り込みは、問い合わせのときに HitScope で済ませてある。
 * 範囲の値は平均を使う。合計・積が有限であることを検証する。
 */
function sums(
  result: StatResult,
  what: string,
): { added: number; increased: number; more: number } {
  let added = 0;
  let increased = 0;
  let more = 1;
  for (const c of result.contributions) {
    const v = finite(
      typeof c.value === "number" ? c.value : (c.value.min + c.value.max) / 2,
      `${what}の修正値（${c.effectId}）`,
    );
    if (c.kind === "added") added = finite(added + v, `${what}の追加値の合計`);
    else if (c.kind === "increased") increased = finite(increased + v, `${what}の加算の合計`);
    else if (c.kind === "more") more = finite(more * v, `${what}の乗算の積`);
  }
  return { added, increased, more };
}

/** ヒットから付与する状態異常1つ分。 */
export interface AilmentApplication {
  readonly ailmentId: string;
  readonly tag: string;
  /** 持続ダメージの総量（状態異常のダメージの補正を含む。付与した時点の値で固定する）。弱体化では0。 */
  readonly total: number;
  /** 持続（秒）。 */
  readonly duration: number;
  /**
   * 定義データの最大スタック（ailments.json の stacking.maxStacks と同じ値でなければならない）。
   * 定義に上限がない状態異常（毒・燃焼・衰弱など）では undefined。
   * 定義に上限がある状態異常で undefined にすると、無制限とは扱わずに例外にする。
   */
  readonly maxStacks: number | undefined;
  /**
   * 最大スタックの補正（STAT-AILMENT-MAX-STACKS の合計。例：千の小傷で +4 → 出血 8 → 12）。
   * 整数。定義に上限がある状態異常のみ指定でき、省略は 0。実際の上限 ＝ maxStacks ＋ extraStacks（1以上）。
   */
  readonly extraStacks?: number;
}

/**
 * 付与する状態異常の入力の検証（AilmentState.apply の入口）。
 * - total：有限かつ0以上
 * - duration：有限かつ正の数
 * - maxStacks：指定するなら正の安全な整数（0・負の数・小数・NaN・Infinity は不可）
 * 不正な値は黙って補正せずに RangeError にする。
 */
export function validateAilmentApplication(app: AilmentApplication): void {
  const where = `状態異常 ${app.ailmentId} の付与`;
  if (!(Number.isFinite(app.total) && app.total >= 0))
    throw new RangeError(`${where}の総量は有限かつ0以上（${String(app.total)}）`);
  if (!(Number.isFinite(app.duration) && app.duration > 0))
    throw new RangeError(`${where}の持続は有限かつ正の数（${String(app.duration)}）`);
  if (app.maxStacks !== undefined && !(Number.isSafeInteger(app.maxStacks) && app.maxStacks > 0))
    throw new RangeError(`${where}の最大スタックは正の安全な整数（${String(app.maxStacks)}）`);
  if (app.extraStacks !== undefined && !Number.isSafeInteger(app.extraStacks))
    throw new RangeError(`${where}の最大スタックの補正は安全な整数（${String(app.extraStacks)}）`);
}

/**
 * 付与する状態異常を、状態異常の定義データと突き合わせ、実際の最大スタックを返す（AilmentState.apply の入口）。
 * - ailmentId・tag は定義と一致しなければならない
 * - 定義の最大スタックを正とし、app.maxStacks が定義と異なれば例外（定義に上限があるのに未指定も例外。無制限にしない）
 * - 定義に上限がない（または重ねない）状態異常に、最大スタック・補正を指定すると例外
 * - 実際の上限 ＝ 定義の最大スタック ＋ 補正。1以上の安全な整数でなければ例外
 * 戻り値：実際の最大スタック。上限がないときは undefined（定義が上限なしの場合だけ）。
 */
export function resolveMaxStacks(def: AilmentDef, app: AilmentApplication): number | undefined {
  validateAilmentApplication(app);
  const where = `状態異常 ${app.ailmentId} の付与`;
  if (app.ailmentId !== def.id)
    throw new RangeError(`${where}の ID が定義（${def.id}）と一致しない`);
  if (app.tag !== def.tag)
    throw new RangeError(`${where}のタグ（${app.tag}）が定義（${def.tag}）と一致しない`);
  const defined =
    def.kind === "dot" && def.stacking.mode === "stack" ? def.stacking.maxStacks : undefined;
  const extra = app.extraStacks ?? 0;
  if (defined === undefined) {
    if (app.maxStacks !== undefined)
      throw new RangeError(
        `${where}の最大スタック（${String(app.maxStacks)}）は、定義に上限がないので指定できない`,
      );
    if (extra !== 0)
      throw new RangeError(
        `${where}の最大スタックの補正（${String(extra)}）は、定義に上限がないので指定できない`,
      );
    return undefined;
  }
  if (app.maxStacks === undefined)
    throw new RangeError(
      `${where}の最大スタックが未指定（定義は ${String(defined)}。無制限としては扱わない）`,
    );
  if (app.maxStacks !== defined)
    throw new RangeError(
      `${where}の最大スタック（${String(app.maxStacks)}）が定義（${String(defined)}）と一致しない`,
    );
  const max = defined + extra;
  if (!(Number.isSafeInteger(max) && max > 0))
    throw new RangeError(
      `${where}の実際の最大スタック（${String(defined)} ＋ ${String(extra)}）は正の安全な整数でなければならない`,
    );
  return max;
}

export interface AilmentRollInput {
  readonly db: ContentDb;
  readonly view: ModifierView;
  readonly hit: HitResult;
  /** ヒットのタグ（技・武器）。 */
  readonly tags: readonly string[];
  /** 技の基本付与率（状態異常のタグのID → 0〜1）。書かれていない種類は0（仕様書v0.2 2.7）。 */
  readonly skillChance?: Readonly<Partial<Record<string, number>>>;
  readonly weaponUid?: string;
  readonly rng: Rng;
}

/** 付与を判定する前の情報（付与率・総量など）。 */
export interface AilmentCandidate {
  readonly application: AilmentApplication;
  /** 付与率（0〜1）。強制なら1、禁止なら0。 */
  readonly chance: number;
}

function sourceBase(def: DotAilmentDef | DebuffAilmentDef, hit: HitResult): number {
  return def.sourceElements.reduce(
    (sum, e) =>
      finite(sum + finite(hit.ailmentBase[e] ?? 0, `基準値（${e}）`), `${def.id} の基準値の合計`),
    0,
  );
}

/**
 * ヒットで付与しうる状態異常と、その付与率・総量を求める（仕様書v0.2 2.7「付与率」）。
 * - そのヒットが、状態異常の元の属性のダメージ（基準値）を持つ種類だけが対象
 * - 付与率 ＝ 技の基本付与率 ＋ 付与率の補正（汎用＋その種類）。上限100%
 * - 「必ず付与」は100%、「付与しない」は0%（禁止が勝つ）
 */
export function ailmentCandidates(input: Omit<AilmentRollInput, "rng">): AilmentCandidate[] {
  const { db, view, hit, tags, skillChance, weaponUid } = input;
  if (hit.evaded) return [];
  const scope = hitScope(hit, weaponUid);
  const out: AilmentCandidate[] = [];
  // ヒットが持つ属性のタグも条件に含める（例：「[物理] 必ず出血」）
  const hitTags = [
    ...tags,
    ...ELEMENTS.filter((e) => finite(hit.ailmentBase[e] ?? 0, `基準値（${e}）`) > 0).map(
      (e) => ELEMENT_TAG[e],
    ),
  ];
  for (const def of [...db.ailments.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (def.kind !== "dot" && def.kind !== "debuff") continue;
    const base = sourceBase(def, hit);
    if (!(base > 0)) continue;
    const context = [...hitTags, def.tag];
    const chanceSums = sums(view.stat(AILMENT_STATS.chance, context, scope), `${def.id} の付与率`);
    const flag = view.flag("ailmentApply", def.tag, hitTags, scope).resolution;
    // 付与率は、強制・禁止の印の有無にかかわらず検証する（印で NaN・Infinity を見逃さないため。U-04a の会心率と同じ）
    const rawChance = finite(
      finite(skillChance?.[def.tag] ?? 0, `${def.id} の技の基本付与率`) + chanceSums.added,
      `${def.id} の付与率`,
    );
    const chance =
      flag === "forbid" ? 0 : flag === "force" ? 1 : Math.min(1, Math.max(0, rawChance));

    const durationSums = sums(
      view.stat(AILMENT_STATS.duration, context, scope),
      `${def.id} の持続`,
    );
    const duration = Math.max(
      0.1,
      finite(
        (def.duration + durationSums.added) * (1 + durationSums.increased),
        `${def.id} の持続`,
      ),
    );
    let total = 0;
    let maxStacks: number | undefined;
    let extraStacks: number | undefined;
    if (def.kind === "dot") {
      const dmg = sums(view.stat(AILMENT_STATS.damage, context, scope), `${def.id} のダメージ`);
      total = finite(
        base * def.totalRatio * (1 + dmg.increased) * dmg.more,
        `${def.id} の持続ダメージの総量`,
      );
      if (def.stacking.mode === "stack" && def.stacking.maxStacks !== undefined) {
        const extra = sums(
          view.stat(AILMENT_STATS.maxStacks, context, scope),
          `${def.id} の最大スタック`,
        ).added;
        // 実際の上限は従来どおり（補正の後に小数を切り捨て、1未満は1。Q-U04b-2）。
        // 定義の値は maxStacks に、補正は extraStacks に分けて渡し、apply() で定義と突き合わせる。
        maxStacks = def.stacking.maxStacks;
        extraStacks =
          Math.max(
            1,
            Math.floor(finite(def.stacking.maxStacks + extra, `${def.id} の最大スタック`)),
          ) - def.stacking.maxStacks;
      }
    }
    const application: AilmentApplication = {
      ailmentId: def.id,
      tag: def.tag,
      total,
      duration,
      maxStacks,
      ...(extraStacks === undefined ? {} : { extraStacks }),
    };
    resolveMaxStacks(def, application);
    out.push({ application, chance });
  }
  return out;
}

/** ヒットで付与する状態異常を、乱数で決める。種類ごとに1回だけ判定する（仕様書v0.2 2.7）。 */
export function rollAilments(input: AilmentRollInput): AilmentApplication[] {
  return ailmentCandidates(input)
    .filter((c) => c.chance >= 1 || (c.chance > 0 && input.rng.chance(c.chance)))
    .map((c) => c.application);
}

interface DotInstance {
  readonly def: DotAilmentDef;
  readonly total: number;
  readonly duration: number;
  remainingTime: number;
  /** 残りの総量（補正の前の、付与した時点の値）。 */
  remaining: number;
}

interface DebuffInstance {
  readonly def: DebuffAilmentDef;
  remainingTime: number;
}

/** 持続ダメージを受ける側の、その瞬間の状態。 */
export interface AilmentTickTarget {
  /** 属性ごとの耐性。持続ダメージには1回だけかける（防具値・ガードはかけない。仕様書v0.2 2.7）。 */
  readonly resist?: Partial<Record<Element, number>>;
  /** 敵が受けるダメージの倍率（感電・崩しなど）。 */
  readonly takenMultiplier?: number;
  /** 移動しているか（出血のダメージ2倍）。 */
  readonly moving?: boolean;
}

/** 1体が受けている状態異常（崩しを除く）。 */
export class AilmentState {
  private readonly dots = new Map<string, DotInstance[]>();
  private readonly debuffs = new Map<string, DebuffInstance>();
  private readonly defs: ReadonlyMap<string, AilmentDef>;

  constructor(db: ContentDb) {
    this.defs = db.ailments;
  }

  /**
   * 状態異常を付与する。重ね掛けの規則・最大スタックは、状態異常の定義データに従う。
   * 入力は resolveMaxStacks で定義と突き合わせ、不正なら状態を変えずに例外にする。
   */
  apply(app: AilmentApplication): void {
    const def = this.defs.get(app.ailmentId);
    if (def === undefined) throw new Error(`状態異常 ${app.ailmentId} はデータにない`);
    const max = resolveMaxStacks(def, app);
    if (def.kind === "debuff") {
      // 重ね掛けはせず、持続を新しくする
      const current = this.debuffs.get(def.id);
      const time = Math.max(current?.remainingTime ?? 0, app.duration);
      this.debuffs.set(def.id, { def, remainingTime: time });
      return;
    }
    if (def.kind !== "dot")
      throw new Error(`状態異常 ${def.id}（${def.kind}）はヒットでは付与できない`);
    const list = this.dots.get(def.id) ?? [];
    const instance: DotInstance = {
      def,
      total: app.total,
      duration: app.duration,
      remainingTime: app.duration,
      remaining: app.total,
    };
    if (def.stacking.mode === "strongest") {
      // 最も強いもの1つ：残りの総量が多いほうを残す
      const current = list[0];
      if (current === undefined || instance.remaining >= current.remaining)
        this.dots.set(def.id, [instance]);
      return;
    }
    if (max !== undefined && list.length >= max) {
      // 上限に達しているときは、残り時間が最も短いものと入れ替える
      let shortest = 0;
      for (let i = 1; i < list.length; i++) {
        if ((list[i]?.remainingTime ?? Infinity) < (list[shortest]?.remainingTime ?? Infinity))
          shortest = i;
      }
      list.splice(shortest, 1);
      // 上限が前の付与より小さい場合は、さらに古いものから取り除き、新しいものの分を空ける。
      // max は1以上（resolveMaxStacks で検証済み）なので、取り除く数は有限で、繰り返しはない。
      const excess = list.length - (max - 1);
      if (excess > 0) list.splice(0, excess);
    }
    list.push(instance);
    this.dots.set(def.id, list);
  }

  /** 時間を進め、この間の持続ダメージを属性ごとに返す。切れた状態異常は取り除く。 */
  tick(dt: number, target: AilmentTickTarget = {}): Partial<Record<Element, number>> {
    if (!(Number.isFinite(dt) && dt >= 0))
      throw new RangeError(`経過時間は有限かつ0以上（${String(dt)}）`);
    const taken = finite(target.takenMultiplier ?? 1, "受けるダメージの倍率");
    // 先に全ての計算を済ませて検証し、例外のときに状態を中途半端に変えないようにする
    const out: Partial<Record<Element, number>> = {};
    const updates: { inst: DotInstance; portion: number; step: number }[] = [];
    for (const list of this.dots.values()) {
      for (const inst of list) {
        const step = Math.min(dt, inst.remainingTime);
        const portion = Math.min(
          inst.remaining,
          finite((inst.total * step) / inst.duration, `${inst.def.id} のこの間の持続ダメージ`),
        );
        const moving = target.moving === true ? (inst.def.movingMultiplier ?? 1) : 1;
        const resist = finite(
          target.resist?.[inst.def.dotElement] ?? 0,
          `耐性（${inst.def.dotElement}）`,
        );
        const dmg = finite(
          portion * moving * taken * (1 - resist),
          `${inst.def.id} の受けるダメージ`,
        );
        out[inst.def.dotElement] = finite(
          (out[inst.def.dotElement] ?? 0) + Math.max(0, dmg),
          `持続ダメージの合計（${inst.def.dotElement}）`,
        );
        updates.push({ inst, portion, step });
      }
    }
    for (const { inst, portion, step } of updates) {
      inst.remaining -= portion;
      inst.remainingTime -= step;
    }
    for (const [id, list] of this.dots) {
      const next = list.filter((inst) => inst.remainingTime > 1e-9 && inst.remaining > 1e-12);
      if (next.length > 0) this.dots.set(id, next);
      else this.dots.delete(id);
    }
    for (const [id, debuff] of this.debuffs) {
      debuff.remainingTime -= dt;
      if (debuff.remainingTime <= 1e-9) this.debuffs.delete(id);
    }
    return out;
  }

  /** 重ねている数。 */
  stacks(ailmentId: string): number {
    return this.dots.get(ailmentId)?.length ?? (this.debuffs.has(ailmentId) ? 1 : 0);
  }

  /** 受けている状態異常のタグ。 */
  activeTags(): string[] {
    const tags: string[] = [];
    for (const list of this.dots.values()) if (list[0] !== undefined) tags.push(list[0].def.tag);
    for (const d of this.debuffs.values()) tags.push(d.def.tag);
    return tags.sort();
  }

  /** 受けている状態異常の種類の数（仕様書v0.2 2.7）。 */
  typeCount(): number {
    return countAilmentTypes(this.activeTags());
  }

  /**
   * 持続ダメージのうち、最も早く切れるものの残り時間（秒。なければ Infinity）。状態は変えない。
   * 1回の時間刻みの途中で切れる持続ダメージの区間を分けるのに使う（DPSシミュレーターの移動の割合）。
   */
  nextDotExpiry(): number {
    let next = Infinity;
    for (const list of this.dots.values())
      for (const inst of list) if (inst.remainingTime < next) next = inst.remainingTime;
    return next;
  }

  /** 持続ダメージの残りの総量（補正の前）。千変（K12）の計算に使う。 */
  remainingDotTotal(): number {
    let sum = 0;
    for (const list of this.dots.values())
      for (const inst of list) sum = finite(sum + inst.remaining, "持続ダメージの残りの合計");
    return sum;
  }

  /**
   * 持続ダメージの残りの ratio 倍を、属性ごとに返し、持続ダメージを全て取り除く（千変「残りの60%を即座に与え、消える」）。
   * 耐性・受けるダメージの倍率は、呼び出す側でかける。
   */
  consumeDots(ratio: number): Partial<Record<Element, number>> {
    if (!(Number.isFinite(ratio) && ratio >= 0))
      throw new RangeError(`取り出す割合は有限かつ0以上（${String(ratio)}）`);
    // 検証が全て済んでから持続ダメージを消す（例外のときは状態を変えない）
    const out: Partial<Record<Element, number>> = {};
    for (const list of this.dots.values()) {
      for (const inst of list)
        out[inst.def.dotElement] = finite(
          (out[inst.def.dotElement] ?? 0) +
            finite(inst.remaining * ratio, `${inst.def.id} の取り出す量`),
          `取り出す持続ダメージの合計（${inst.def.dotElement}）`,
        );
    }
    this.dots.clear();
    return out;
  }

  /**
   * この敵が与えるダメージの倍率（衰弱など。仕様書v0.2 2.7）。
   * 各倍率と、掛け合わせた途中の積・結果が有限であることを確かめる（NaN・Infinity は RangeError。0 などに丸めない）。
   */
  dealtMultiplier(isBoss: boolean): number {
    let m = 1;
    for (const d of this.debuffs.values()) {
      const factor = isBoss
        ? finite(d.def.bossDealtMultiplier, `${d.def.id} の与えるダメージの倍率（ボス）`)
        : finite(d.def.dealtMultiplier, `${d.def.id} の与えるダメージの倍率`);
      m = finite(m * factor, `与えるダメージの倍率の積${isBoss ? "（ボス）" : ""}`);
    }
    return m;
  }
}

/**
 * 崩しゲージ（仕様書v0.2 2.7・補助仕様書 3.3）。
 * 崩し値が最大値に達すると「崩れ」、一定時間、受けるダメージの倍率がかかる。崩れた後はゲージが0に戻る。
 */
export class StaggerGauge {
  private readonly profile: StaggerProfile;
  private readonly maxHp: number;
  private value = 0;
  private sinceLast = 0;
  private brokenFor = 0;
  private breakCount = 0;

  constructor(profile: StaggerProfile, maxHp: number) {
    if (!(Number.isFinite(maxHp) && maxHp > 0))
      throw new RangeError(`最大HPは有限かつ正の数（${String(maxHp)}）`);
    for (const key of ["gaugeRatio", "breakDuration", "takenMultiplier", "growthPerBreak"] as const)
      if (!(Number.isFinite(profile[key]) && profile[key] > 0))
        throw new RangeError(`崩しの設定の ${key} は有限かつ正の数（${String(profile[key])}）`);
    for (const key of ["decayDelay", "decayPerSecond"] as const)
      if (!(Number.isFinite(profile[key]) && profile[key] >= 0))
        throw new RangeError(`崩しの設定の ${key} は有限かつ0以上（${String(profile[key])}）`);
    this.profile = profile;
    this.maxHp = maxHp;
    // 最初の最大値が有限・正であることを確かめる（最大HP × 割合の溢れ・0への丸め）
    if (!(this.max > 0)) throw new RangeError(`崩しゲージの最大値は正の数（${String(this.max)}）`);
  }

  /** ゲージの最大値（崩れるたびに growthPerBreak 倍になる）。有限でなくなったら RangeError。 */
  get max(): number {
    return this.maxAt(this.breakCount);
  }
  private maxAt(breaks: number): number {
    return requireFinite(
      this.maxHp * this.profile.gaugeRatio * this.profile.growthPerBreak ** breaks,
      () => `崩しゲージの最大値（崩れた回数 ${String(breaks)}）`,
    );
  }
  get current(): number {
    return this.value;
  }
  get breaks(): number {
    return this.breakCount;
  }
  /** 崩れている（ダウン・怯み・よろめき）か。 */
  get broken(): boolean {
    return this.brokenFor > 0;
  }
  /** 受けるダメージの倍率（崩れている間だけ）。 */
  get takenMultiplier(): number {
    return this.broken ? this.profile.takenMultiplier : 1;
  }

  /** 崩し値を加える。崩れた場合は true を返す。崩れている間は溜まらない。 */
  add(amount: number): boolean {
    if (!(Number.isFinite(amount) && amount >= 0))
      throw new RangeError(`崩し値は有限かつ0以上（${String(amount)}）`);
    if (amount === 0 || this.broken) return false;
    const value = requireFinite(this.value + amount, () => "崩しゲージの値");
    const breaking = value >= this.max;
    // 崩れる場合は、次の最大値も有限であることを、状態を変える前に確かめる
    if (breaking) this.maxAt(this.breakCount + 1);
    this.sinceLast = 0;
    this.value = value;
    if (!breaking) return false;
    this.value = 0;
    this.brokenFor = this.profile.breakDuration;
    this.breakCount += 1;
    return true;
  }

  /** 時間を進める（崩れている時間の経過・ゲージの減少）。 */
  update(dt: number): void {
    if (!(Number.isFinite(dt) && dt >= 0))
      throw new RangeError(`経過時間は有限かつ0以上（${String(dt)}）`);
    const before = this.sinceLast;
    const sinceLast = requireFinite(before + dt, () => "崩しを受けていない時間");
    const decayTime = Math.max(0, sinceLast - Math.max(before, this.profile.decayDelay));
    const decay =
      decayTime > 0
        ? requireFinite(
            this.max * this.profile.decayPerSecond * decayTime,
            () => "崩しゲージの減る量",
          )
        : 0;
    if (this.brokenFor > 0) this.brokenFor = Math.max(0, this.brokenFor - dt);
    this.sinceLast = sinceLast;
    if (decayTime > 0) this.value = Math.max(0, this.value - decay);
  }
}

/**
 * ヒットの崩し値（仕様書v0.2 2.7）：打撃値（会心の後・防御の前）× 技の崩し係数 ×（1＋崩し値の補正）。
 * 受ける側の崩されにくさ（0〜1）で減らす（補助仕様書 3.3）。
 */
export function staggerValue(input: {
  readonly db: ContentDb;
  readonly view: ModifierView;
  readonly hit: HitResult;
  readonly tags: readonly string[];
  /** 技の崩し係数（省略すると、崩しの定義の既定値）。 */
  readonly coefficient?: number;
  /** 受ける側の崩されにくさ（0〜1）。 */
  readonly targetResist?: number;
  /** 受ける側が「崩されない」（重荷の誇りの4部位など。印 beStaggered の禁止）。 */
  readonly targetImmune?: boolean;
  readonly weaponUid?: string;
}): number {
  if (input.hit.evaded || input.targetImmune === true) return 0;
  const scope = hitScope(input.hit, input.weaponUid);
  const def = input.db.ailmentsByTag.get("TAG-AIL-STAGGER");
  const coefficient = finite(
    input.coefficient ?? (def?.kind === "stagger" ? def.defaultCoefficient : 0),
    "崩し係数",
  );
  const inc = sums(input.view.stat(AILMENT_STATS.stagger, input.tags, scope), "崩し値").increased;
  const resist = Math.min(1, Math.max(0, finite(input.targetResist ?? 0, "崩されにくさ")));
  return Math.max(
    0,
    finite(
      finite(input.hit.preMitigationTotal, "打撃値の合計（会心の後・防御の前）") *
        coefficient *
        (1 + inc) *
        (1 - resist),
      "崩し値",
    ),
  );
}

/** 崩しの定義（データの AIL-STAGGER）を取り出す。 */
export function staggerProfiles(db: ContentDb): {
  enemy: StaggerProfile;
  boss: StaggerProfile;
  player: StaggerProfile;
} {
  const def = db.ailmentsByTag.get("TAG-AIL-STAGGER");
  if (def?.kind !== "stagger") throw new Error("崩しの定義（TAG-AIL-STAGGER）がデータにない");
  return { enemy: def.enemy, boss: def.boss, player: def.player };
}
