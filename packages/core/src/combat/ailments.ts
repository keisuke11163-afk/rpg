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
import type { ModifierView, StatResult } from "../effects/evaluate.ts";
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

/** 修正値の合計（局所の効果は、その武器のヒットだけ）。 */
function sums(
  result: StatResult,
  db: ContentDb,
  weaponUid: string | undefined,
): { added: number; increased: number; more: number } {
  let added = 0;
  let increased = 0;
  let more = 1;
  for (const c of result.contributions) {
    const effect = db.effects.get(c.effectId);
    if (effect?.locality === "local" && (weaponUid === undefined || c.source.ref !== weaponUid))
      continue;
    const v = typeof c.value === "number" ? c.value : (c.value.min + c.value.max) / 2;
    if (c.kind === "added") added += v;
    else if (c.kind === "increased") increased += v;
    else if (c.kind === "more") more *= v;
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
  /** 重ねられる上限（重ねる状態異常のみ。undefined は上限なし）。 */
  readonly maxStacks: number | undefined;
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
  return def.sourceElements.reduce((sum, e) => sum + (hit.ailmentBase[e] ?? 0), 0);
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
  const out: AilmentCandidate[] = [];
  // ヒットが持つ属性のタグも条件に含める（例：「[物理] 必ず出血」）
  const hitTags = [
    ...tags,
    ...ELEMENTS.filter((e) => (hit.ailmentBase[e] ?? 0) > 0).map((e) => ELEMENT_TAG[e]),
  ];
  for (const def of [...db.ailments.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (def.kind !== "dot" && def.kind !== "debuff") continue;
    const base = sourceBase(def, hit);
    if (!(base > 0)) continue;
    const context = [...hitTags, def.tag];
    const chanceSums = sums(view.stat(AILMENT_STATS.chance, context), db, weaponUid);
    const flag = view.flag("ailmentApply", def.tag, hitTags).resolution;
    const rawChance = (skillChance?.[def.tag] ?? 0) + chanceSums.added;
    const chance =
      flag === "forbid" ? 0 : flag === "force" ? 1 : Math.min(1, Math.max(0, rawChance));

    const durationSums = sums(view.stat(AILMENT_STATS.duration, context), db, weaponUid);
    const duration = Math.max(
      0.1,
      (def.duration + durationSums.added) * (1 + durationSums.increased),
    );
    let total = 0;
    let maxStacks: number | undefined;
    if (def.kind === "dot") {
      const dmg = sums(view.stat(AILMENT_STATS.damage, context), db, weaponUid);
      total = base * def.totalRatio * (1 + dmg.increased) * dmg.more;
      if (def.stacking.mode === "stack" && def.stacking.maxStacks !== undefined) {
        const extra = sums(view.stat(AILMENT_STATS.maxStacks, context), db, weaponUid).added;
        maxStacks = Math.max(1, Math.floor(def.stacking.maxStacks + extra));
      }
    }
    out.push({
      application: { ailmentId: def.id, tag: def.tag, total, duration, maxStacks },
      chance,
    });
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

  /** 状態異常を付与する。重ね掛けの規則は、状態異常の定義に従う。 */
  apply(app: AilmentApplication): void {
    const def = this.defs.get(app.ailmentId);
    if (def === undefined) throw new Error(`状態異常 ${app.ailmentId} はデータにない`);
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
    const max = app.maxStacks;
    if (max !== undefined && list.length >= max) {
      // 上限に達しているときは、残り時間が最も短いものと入れ替える
      let shortest = 0;
      for (let i = 1; i < list.length; i++) {
        if ((list[i]?.remainingTime ?? Infinity) < (list[shortest]?.remainingTime ?? Infinity))
          shortest = i;
      }
      list.splice(shortest, 1);
      while (list.length >= max) list.shift();
    }
    list.push(instance);
    this.dots.set(def.id, list);
  }

  /** 時間を進め、この間の持続ダメージを属性ごとに返す。切れた状態異常は取り除く。 */
  tick(dt: number, target: AilmentTickTarget = {}): Partial<Record<Element, number>> {
    if (!(dt >= 0)) throw new RangeError("経過時間は0以上");
    const out: Partial<Record<Element, number>> = {};
    for (const [id, list] of this.dots) {
      const next: DotInstance[] = [];
      for (const inst of list) {
        const step = Math.min(dt, inst.remainingTime);
        const portion = Math.min(inst.remaining, (inst.total * step) / inst.duration);
        inst.remaining -= portion;
        inst.remainingTime -= step;
        const moving = target.moving === true ? (inst.def.movingMultiplier ?? 1) : 1;
        const resist = target.resist?.[inst.def.dotElement] ?? 0;
        const dmg = portion * moving * (target.takenMultiplier ?? 1) * (1 - resist);
        out[inst.def.dotElement] = (out[inst.def.dotElement] ?? 0) + Math.max(0, dmg);
        if (inst.remainingTime > 1e-9 && inst.remaining > 1e-12) next.push(inst);
      }
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

  /** 持続ダメージの残りの総量（補正の前）。千変（K12）の計算に使う。 */
  remainingDotTotal(): number {
    let sum = 0;
    for (const list of this.dots.values()) for (const inst of list) sum += inst.remaining;
    return sum;
  }

  /**
   * 持続ダメージの残りの ratio 倍を、属性ごとに返し、持続ダメージを全て取り除く（千変「残りの60%を即座に与え、消える」）。
   * 耐性・受けるダメージの倍率は、呼び出す側でかける。
   */
  consumeDots(ratio: number): Partial<Record<Element, number>> {
    const out: Partial<Record<Element, number>> = {};
    for (const list of this.dots.values()) {
      for (const inst of list)
        out[inst.def.dotElement] = (out[inst.def.dotElement] ?? 0) + inst.remaining * ratio;
    }
    this.dots.clear();
    return out;
  }

  /** この敵が与えるダメージの倍率（衰弱など。仕様書v0.2 2.7）。 */
  dealtMultiplier(isBoss: boolean): number {
    let m = 1;
    for (const d of this.debuffs.values())
      m *= isBoss ? d.def.bossDealtMultiplier : d.def.dealtMultiplier;
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
    if (!(maxHp > 0)) throw new RangeError("最大HPは正の数");
    this.profile = profile;
    this.maxHp = maxHp;
  }

  /** ゲージの最大値（崩れるたびに growthPerBreak 倍になる）。 */
  get max(): number {
    return this.maxHp * this.profile.gaugeRatio * this.profile.growthPerBreak ** this.breakCount;
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
    if (!(amount > 0) || this.broken) return false;
    this.sinceLast = 0;
    this.value += amount;
    if (this.value < this.max) return false;
    this.value = 0;
    this.brokenFor = this.profile.breakDuration;
    this.breakCount += 1;
    return true;
  }

  /** すぐに崩す（激化した突進「通った敵を全て崩す」。補助仕様書3.6）。崩れている間は何もしない。 */
  breakNow(): boolean {
    if (this.broken) return false;
    return this.add(Math.max(this.max - this.value, 1e-9));
  }

  /** 時間を進める（崩れている時間の経過・ゲージの減少）。 */
  update(dt: number): void {
    if (!(dt >= 0)) throw new RangeError("経過時間は0以上");
    if (this.brokenFor > 0) this.brokenFor = Math.max(0, this.brokenFor - dt);
    const before = this.sinceLast;
    this.sinceLast += dt;
    const decayTime = Math.max(0, this.sinceLast - Math.max(before, this.profile.decayDelay));
    if (decayTime > 0)
      this.value = Math.max(0, this.value - this.max * this.profile.decayPerSecond * decayTime);
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
  const def = input.db.ailmentsByTag.get("TAG-AIL-STAGGER");
  const coefficient = input.coefficient ?? (def?.kind === "stagger" ? def.defaultCoefficient : 0);
  const inc = sums(
    input.view.stat(AILMENT_STATS.stagger, input.tags),
    input.db,
    input.weaponUid,
  ).increased;
  const resist = Math.min(1, Math.max(0, input.targetResist ?? 0));
  return Math.max(0, input.hit.preMitigationTotal * coefficient * (1 + inc) * (1 - resist));
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
