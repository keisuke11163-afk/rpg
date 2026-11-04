import type { Condition, EffectDef, EffectOrigin, Element, Modifier } from "../content/effect.ts";
import type { ContentDb } from "../content/load.ts";
import type { EquipSlot, FactId, FlagId, ReplaceSlot } from "../content/registries.ts";
import { TagIndex } from "./tag-index.ts";

/** 効果の出どころの実体（どの装備・どのノードから来たか）。修正値の内訳の表示に使う。 */
export interface EffectSource {
  /** 例：equipment（装備）・starNode（星辰盤）・jobNode（職紋盤）・job（ジョブ）・skill（技）・buff（一時的な効果） */
  readonly kind: string;
  /** 例：装備の uid、ノードのID */
  readonly ref: string;
}

/** 有効にする効果1つ分。 */
export interface EffectInstance {
  readonly effectId: string;
  readonly source: EffectSource;
  /**
   * 重ねた数（省略すると1）。加算・追加・上限は値×数、乗算は値の数乗になる。
   * 例：重荷の誇りの「重装の防具1部位につき」は、重装の部位の数を入れる。
   */
  readonly stacks?: number;
  /**
   * 修正値ごとの値の差し替え（修正値の並びの番号 → 値）。詞の値はアイテムごとに抽選で決まるため、
   * データの効果は値の型だけを持ち、アイテムの値をここで渡す（U-11）。
   */
  readonly values?: readonly (number | Range | undefined)[];
}

/** 条件の判定に使う、効果の外の事実（装備・ジョブなど）。呼び出す側が数えて渡す。 */
export interface EvaluationFacts {
  readonly facts?: Partial<Record<FactId, number>>;
  /** 部位ごとに装備しているもののタグ（武器の種類など）。 */
  readonly equippedTags?: Partial<Record<EquipSlot, readonly string[]>>;
  /** メインジョブのタグのID。 */
  readonly mainJob?: string;
  /** 能力値の基礎の値（例：初期能力値・基礎HP）。 */
  readonly baseStats?: Readonly<Record<string, number>>;
}

/** 修正値の内訳1つ分（開発計画書 工程F-3「修正値の内訳」）。 */
export interface Contribution {
  readonly effectId: string;
  readonly origin: EffectOrigin;
  readonly source: EffectSource;
  readonly kind: Modifier["kind"];
  /** 重ねた数を反映した後の値。 */
  readonly value: number | { readonly min: number; readonly max: number };
}

export interface Range {
  readonly min: number;
  readonly max: number;
}

/** 能力値を、あるタグの条件で集計した結果。 */
export interface StatResult {
  readonly stat: string;
  readonly base: number;
  /** 追加値の合計（技倍率を受ける）。 */
  readonly added: Range;
  /** 固定の追加の合計（技倍率を受けない）。 */
  readonly fixedAdded: Range;
  /** 加算％の合計（0.5＝+50%）。 */
  readonly increased: number;
  /** 乗算の積（1.2＝×1.2）。 */
  readonly more: number;
  /** 上限（ない場合は undefined）。 */
  readonly cap: number | undefined;
  /** 上書き（最も優先度の高いもの）。 */
  readonly override:
    { readonly value: number; readonly priority: number; readonly effectId: string } | undefined;
  /**
   * まとめた値：上書きがあればその値。なければ（基礎＋追加の中央＋固定の追加の中央）×（1＋加算）×乗算を、
   * 下限と上限の間に収めたもの。ダメージの計算では、この値ではなく各部分を使う。
   */
  readonly value: number;
  readonly contributions: readonly Contribution[];
}

export type FlagResolution = "force" | "forbid" | undefined;

export interface FlagResult {
  /** 禁止があれば forbid、なければ強制があれば force、どちらもなければ undefined（仕様書v0.2 2.4.1 の規則1）。 */
  readonly resolution: FlagResolution;
  readonly forcedBy: readonly string[];
  readonly forbiddenBy: readonly string[];
}

export interface ReplacementResult {
  /** 有効な置き換え（なければ undefined）。 */
  readonly winner:
    { readonly hook: string; readonly effectId: string; readonly origin: EffectOrigin } | undefined;
  /** 優先度で負けて無効になった置き換え（ツールチップの「無効（〇〇が優先）」に使う）。 */
  readonly overridden: readonly {
    readonly hook: string;
    readonly effectId: string;
    readonly origin: EffectOrigin;
  }[];
}

export interface ActiveBehavior {
  readonly hook: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly effectId: string;
  readonly source: EffectSource;
  readonly stacks: number;
}

export interface ConversionEntry {
  readonly from: Element;
  readonly to: Element;
  readonly value: number;
  readonly effectId: string;
}

export interface RetagEntry {
  readonly from: readonly Element[];
  readonly to: Element;
  readonly effectId: string;
}

/** 条件を満たさず、休眠している効果（仕様書v0.2 4.9.1）。 */
export interface DormantEffect {
  readonly instance: EffectInstance;
  /** 満たしていない条件。 */
  readonly unmet: readonly Condition[];
}

/**
 * 置き換えの優先順位（仕様書v0.2 2.4.1 の規則2）：天極 ＞ ユニーク ＞ セット ＞ 輝星・転変 ＞ 職紋・職技。
 * 仕様書に書かれていない出どころは、同じ系統の順位に入れ、装備の詞などは最も低くした（docs/progress 参照）。
 */
const REPLACE_RANK: Record<EffectOrigin, number> = {
  keystone: 5,
  unique: 4,
  uniqueLatent: 4,
  set: 3,
  setMax: 3,
  bond: 3,
  notableStar: 2,
  mutation: 2,
  minorStar: 2,
  constellation: 2,
  schoolNode: 2,
  jobNode: 1,
  jobMastery: 1,
  jobSkill: 1,
  affix: 0,
  implicit: 0,
  inscription: 0,
  ailment: 0,
  attribute: 0,
};

interface Entry {
  readonly mod: Modifier;
  readonly effect: EffectDef;
  readonly instance: EffectInstance;
  readonly stacks: number;
}

function compareInstances(a: EffectInstance, b: EffectInstance): number {
  const key = (i: EffectInstance): string =>
    `${i.effectId}\u0000${i.source.kind}\u0000${i.source.ref}`;
  const ka = key(a);
  const kb = key(b);
  return ka < kb ? -1 : ka > kb ? 1 : (a.stacks ?? 1) - (b.stacks ?? 1);
}

function mid(r: Range): number {
  return (r.min + r.max) / 2;
}

/** 修正値の集まりに対する問い合わせ。 */
export class ModifierView {
  private readonly db: ContentDb;
  private readonly tags: TagIndex;
  private readonly baseStats: Readonly<Record<string, number>>;
  private readonly byStat = new Map<string, Entry[]>();
  private readonly flags: Entry[] = [];
  private readonly replaces = new Map<ReplaceSlot, Entry[]>();
  private readonly behaviors: Entry[] = [];
  private readonly converts: Entry[] = [];
  private readonly retags: Entry[] = [];

  constructor(
    db: ContentDb,
    tags: TagIndex,
    instances: readonly EffectInstance[],
    baseStats: Readonly<Record<string, number>>,
  ) {
    this.db = db;
    this.tags = tags;
    this.baseStats = baseStats;
    for (const instance of instances) {
      const effect = db.effects.get(instance.effectId);
      if (effect === undefined) throw new Error(`効果 ${instance.effectId} はデータにない`);
      const stacks = instance.stacks ?? 1;
      if (!(stacks >= 0) || !Number.isFinite(stacks))
        throw new RangeError(`重ねた数が正しくない：${String(stacks)}`);
      for (const [index, original] of effect.modifiers.entries()) {
        const override = instance.values?.[index];
        const mod =
          override === undefined || !("value" in original)
            ? original
            : ({ ...original, value: override } as Modifier);
        const entry: Entry = { mod, effect, instance, stacks };
        switch (mod.kind) {
          case "added":
          case "fixedAdded":
          case "increased":
          case "more":
          case "cap":
          case "override": {
            const list = this.byStat.get(mod.stat) ?? [];
            list.push(entry);
            this.byStat.set(mod.stat, list);
            break;
          }
          case "flag":
            this.flags.push(entry);
            break;
          case "replace": {
            const list = this.replaces.get(mod.slot) ?? [];
            list.push(entry);
            this.replaces.set(mod.slot, list);
            break;
          }
          case "behavior":
            this.behaviors.push(entry);
            break;
          case "convert":
            this.converts.push(entry);
            break;
          case "retag":
            this.retags.push(entry);
            break;
        }
      }
    }
  }

  /** タグの集まりを、照合に使える形（親タグを含む）にする。 */
  context(tagIds: Iterable<string> = []): ReadonlySet<string> {
    return this.tags.closure(tagIds);
  }

  private applicable(list: readonly Entry[], context: ReadonlySet<string>): Entry[] {
    return list.filter((e) => TagIndex.matches(e.mod.filter, context));
  }

  /** 能力値を、タグの条件（技・ヒットのタグ）で集計する。 */
  stat(statId: string, tagIds: Iterable<string> = []): StatResult {
    const def = this.db.stats.get(statId);
    if (def === undefined) throw new Error(`能力値 ${statId} はデータにない`);
    const context = this.context(tagIds);
    const base = this.baseStats[statId] ?? 0;
    const added = { min: 0, max: 0 };
    const fixedAdded = { min: 0, max: 0 };
    let increased = 0;
    let more = 1;
    let capDelta = 0;
    let hasCapModifier = false;
    let override: StatResult["override"];
    const contributions: Contribution[] = [];

    for (const { mod, effect, instance, stacks } of this.applicable(
      this.byStat.get(statId) ?? [],
      context,
    )) {
      const push = (value: Contribution["value"]): void => {
        contributions.push({
          effectId: effect.id,
          origin: effect.origin,
          source: instance.source,
          kind: mod.kind,
          value,
        });
      };
      switch (mod.kind) {
        case "added":
        case "fixedAdded": {
          const r = typeof mod.value === "number" ? { min: mod.value, max: mod.value } : mod.value;
          const scaled = { min: r.min * stacks, max: r.max * stacks };
          const target = mod.kind === "added" ? added : fixedAdded;
          target.min += scaled.min;
          target.max += scaled.max;
          push(scaled);
          break;
        }
        case "increased":
          increased += mod.value * stacks;
          push(mod.value * stacks);
          break;
        case "more": {
          const factor = mod.value ** stacks;
          more *= factor;
          push(factor);
          break;
        }
        case "cap":
          hasCapModifier = true;
          capDelta += mod.value * stacks;
          push(mod.value * stacks);
          break;
        case "override":
          // 優先度の高いものが勝つ（仕様書v0.2 2.4.1 の規則4。同じ優先度はデータの検証で禁止している）
          if (override === undefined || mod.priority > override.priority) {
            override = { value: mod.value, priority: mod.priority, effectId: effect.id };
          }
          push(mod.value);
          break;
        default:
          break;
      }
    }

    let cap =
      def.baseCap !== undefined || hasCapModifier ? (def.baseCap ?? 0) + capDelta : undefined;
    if (cap !== undefined && def.capLimit !== undefined) cap = Math.min(cap, def.capLimit);
    let value: number;
    if (override !== undefined) {
      value = override.value;
    } else {
      value = (base + mid(added) + mid(fixedAdded)) * (1 + increased) * more;
      if (def.min !== undefined) value = Math.max(def.min, value);
      if (cap !== undefined) value = Math.min(cap, value);
    }
    return {
      stat: statId,
      base,
      added,
      fixedAdded,
      increased,
      more,
      cap,
      override,
      value,
      contributions,
    };
  }

  /** 「必ず〜する／〜しない」の解決（仕様書v0.2 2.4.1 の規則1・3：禁止は強制に勝つ）。 */
  flag(flag: FlagId, target: string | undefined, tagIds: Iterable<string> = []): FlagResult {
    const context = this.context(tagIds);
    const forcedBy: string[] = [];
    const forbiddenBy: string[] = [];
    for (const { mod, effect } of this.applicable(this.flags, context)) {
      if (mod.kind !== "flag" || mod.flag !== flag || mod.target !== target) continue;
      (mod.mode === "forbid" ? forbiddenBy : forcedBy).push(effect.id);
    }
    const resolution: FlagResolution =
      forbiddenBy.length > 0 ? "forbid" : forcedBy.length > 0 ? "force" : undefined;
    return { resolution, forcedBy, forbiddenBy };
  }

  /** 入力・枠の置き換えの解決（仕様書v0.2 2.4.1 の規則2）。同じ順位どうしは、効果のIDの順で決める。 */
  replacement(slot: ReplaceSlot, tagIds: Iterable<string> = []): ReplacementResult {
    const context = this.context(tagIds);
    const candidates = this.applicable(this.replaces.get(slot) ?? [], context)
      .flatMap(({ mod, effect }) =>
        mod.kind === "replace"
          ? [{ hook: mod.hook, effectId: effect.id, origin: effect.origin }]
          : [],
      )
      .sort(
        (a, b) =>
          REPLACE_RANK[b.origin] - REPLACE_RANK[a.origin] ||
          (a.effectId < b.effectId ? -1 : a.effectId > b.effectId ? 1 : 0),
      );
    const [winner, ...overridden] = candidates;
    return { winner, overridden };
  }

  /** 有効なルールフック（挙動）の一覧。 */
  activeBehaviors(tagIds: Iterable<string> = []): ActiveBehavior[] {
    const context = this.context(tagIds);
    return this.applicable(this.behaviors, context).flatMap(({ mod, effect, instance, stacks }) =>
      mod.kind === "behavior"
        ? [
            {
              hook: mod.hook,
              params: mod.params ?? {},
              effectId: effect.id,
              source: instance.source,
              stacks,
            },
          ]
        : [],
    );
  }

  /** 属性の変換の一覧（計算はダメージの計算の側で行う。仕様書 2.5）。 */
  conversions(tagIds: Iterable<string> = []): ConversionEntry[] {
    const context = this.context(tagIds);
    return this.applicable(this.converts, context).flatMap(({ mod, effect, stacks }) =>
      mod.kind === "convert"
        ? [{ from: mod.from, to: mod.to, value: mod.value * stacks, effectId: effect.id }]
        : [],
    );
  }

  /** 属性の付け替えの一覧（仕様書v0.2 2.5）。 */
  retagging(tagIds: Iterable<string> = []): RetagEntry[] {
    const context = this.context(tagIds);
    return this.applicable(this.retags, context).flatMap(({ mod, effect }) =>
      mod.kind === "retag" ? [{ from: mod.from, to: mod.to, effectId: effect.id }] : [],
    );
  }
}

/** 効果の評価の結果。 */
export interface EvaluatedEffects {
  /** 有効な全ての効果による問い合わせ。 */
  readonly view: ModifierView;
  /** 有効になった効果（条件のないもの＋条件を満たしたもの）。 */
  readonly active: readonly EffectInstance[];
  /** 条件を満たさず休眠している効果と、その理由。 */
  readonly dormant: readonly DormantEffect[];
}

function conditionMet(
  cond: Condition,
  stage1: ModifierView,
  facts: EvaluationFacts,
  tags: TagIndex,
): boolean {
  switch (cond.type) {
    case "statAtLeast":
      return stage1.stat(cond.stat).value >= cond.value;
    case "factAtLeast":
      return (facts.facts?.[cond.fact] ?? 0) >= cond.value;
    case "equippedTag": {
      const slots =
        cond.slot === undefined
          ? Object.values(facts.equippedTags ?? {})
          : [facts.equippedTags?.[cond.slot] ?? []];
      return slots.some((ids) => tags.closure(ids).has(cond.tag));
    }
    case "mainJob":
      return facts.mainJob === cond.job;
  }
}

/**
 * 効果を3段階で評価する（仕様書v0.2 4.9.1）。
 * 1. 条件のない効果だけで、能力値を計算する（第1段階）
 * 2. 条件付きの効果の条件を、第1段階の値だけで判定する（条件付きの効果自身の値は、判定に含めない）
 * 3. 条件を満たした効果を加えて、最終の値を計算する
 *
 * 同じ入力なら、何度評価しても、入力の並び順が違っても、結果は同じになる。
 */
export function evaluateEffects(
  db: ContentDb,
  tags: TagIndex,
  instances: readonly EffectInstance[],
  facts: EvaluationFacts = {},
): EvaluatedEffects {
  const sorted = [...instances].sort(compareInstances);
  const baseStats = facts.baseStats ?? {};
  const unconditional: EffectInstance[] = [];
  const conditional: { instance: EffectInstance; conditions: readonly Condition[] }[] = [];
  for (const instance of sorted) {
    const effect = db.effects.get(instance.effectId);
    if (effect === undefined) throw new Error(`効果 ${instance.effectId} はデータにない`);
    const conditions = effect.conditions ?? [];
    if (conditions.length === 0) unconditional.push(instance);
    else conditional.push({ instance, conditions });
  }

  const stage1 = new ModifierView(db, tags, unconditional, baseStats);
  const active = [...unconditional];
  const dormant: DormantEffect[] = [];
  for (const { instance, conditions } of conditional) {
    const unmet = conditions.filter((c) => !conditionMet(c, stage1, facts, tags));
    if (unmet.length === 0) active.push(instance);
    else dormant.push({ instance, unmet });
  }
  active.sort(compareInstances);
  return { view: new ModifierView(db, tags, active, baseStats), active, dormant };
}
