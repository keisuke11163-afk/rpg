import type { Element } from "../content/effect.ts";
import { ELEMENTS } from "../content/effect.ts";
import { CONVERSION_ORDER, ELEMENT_TAG } from "../content/elements.ts";
import type { ContentDb } from "../content/load.ts";
import type { HitScope, ModifierView, Range, StatResult } from "../effects/evaluate.ts";
import { requireFinite } from "../effects/evaluate.ts";
import type { Rng } from "../random/rng.ts";
import { armorReduction, hitChance } from "./defense.ts";
import {
  AFFIX_SKILL_LEVEL_INCREASED,
  baseSkillLevel,
  spellBaseMultiplier,
  weaponSkillPct,
} from "./skill-level.ts";

/** ダメージの計算で使う能力値のID（データの stats/combat.json）。 */
export const COMBAT_STATS = {
  damage: "STAT-DAMAGE",
  added: {
    physical: "STAT-ADDED-PHYSICAL",
    lightning: "STAT-ADDED-LIGHTNING",
    cold: "STAT-ADDED-COLD",
    fire: "STAT-ADDED-FIRE",
    dark: "STAT-ADDED-DARK",
    holy: "STAT-ADDED-HOLY",
  } satisfies Record<Element, string>,
  critChance: "STAT-CRIT-CHANCE",
  critMultiplier: "STAT-CRIT-MULTIPLIER",
  accuracy: "STAT-ACCURACY",
  skillLevel: "STAT-SKILL-LEVEL",
} as const;

/** 会心倍率の初期値（仕様書 2.4）。 */
export const BASE_CRIT_MULTIPLIER = 1.5;

export interface DamageSkill {
  /** 技のタグ（形態・終結など）。 */
  readonly tags: readonly string[];
  /** weapon＝武器の技（武器の基礎値を使う）、spell＝呪文（技の基礎値を使い、回避されない）。 */
  readonly kind: "weapon" | "spell";
  /** 技倍率（技レベル1のとき。例：薙ぎ払いは1.3）。 */
  readonly pct: number;
  /** 呪文の基礎値（技レベル1のとき）。 */
  readonly base?: Partial<Record<Element, Range>>;
  /**
   * 技そのものの属性の変換（断罪の刃：武器ダメージの50%を聖に変換）。装備・効果の変換と合わせて処理する。
   * 省略すると技自身の変換は無い。
   */
  readonly convert?: readonly {
    readonly from: Element;
    readonly to: Element;
    readonly value: number;
  }[];
  /**
   * 技倍率を受けない固定の物理ダメージの追加（盾打ち：盾の防具値の10%）。呼び出す側が量を決めて渡す。
   * 省略すると0。変換・加算・乗算は、ほかの物理ダメージと同じに受ける。
   */
  readonly flatPhysical?: number;
}

export interface DamageWeapon {
  /** 装備の実体のID。局所の効果（仕様書v0.2 3.7 の原則5）を、この武器のヒットだけに効かせるために使う。 */
  readonly uid: string;
  /** 武器のタグ（武器の種類）。 */
  readonly tags: readonly string[];
  /** 武器の基礎ダメージ（基礎性能。通常は物理）。 */
  readonly base: Partial<Record<Element, Range>>;
  /** 武器の基本の会心率。 */
  readonly critChance: number;
}

export interface DamageAttacker {
  readonly db: ContentDb;
  /** 評価済みの効果（evaluateEffects の view）。 */
  readonly view: ModifierView;
  readonly characterLevel: number;
  /** 使う武器（呪文で武器がない場合は省略）。 */
  readonly weapon?: DamageWeapon;
}

export interface DamageDefender {
  /** 属性ごとの耐性（上限の処理を終えた値。負の値もありうる）。 */
  readonly resist?: Partial<Record<Element, number>>;
  readonly armor?: number;
  readonly evasion?: number;
  /** 敵が受けるダメージの倍率（感電・崩しなど。仕様書v0.2 2.4）。 */
  readonly takenMultiplier?: number;
  /** ガードで減らす割合（0〜1）。 */
  readonly guard?: number;
}

export interface HitOptions {
  readonly rng: Rng;
  /** random＝最小〜最大で抽選する、average＝平均の値を使う（シミュレーション・表示用）。 */
  readonly roll?: "random" | "average";
  /** 会心率に足す固定値（例：盗賊の背面判定の+10%。仕様書5.6）。増加の前に足す。 */
  readonly extraCritChance?: number;
  /** 必ず会心にする（例：急所穿ちの「5点なら必ず会心」）。会心の禁止の印があれば、禁止が勝つ。 */
  readonly forceCrit?: boolean;
  /** このヒットだけのダメージの加算（例：弓使いの適正間合い+20%・近すぎると-20%。仕様書v0.2 5.7）。 */
  readonly extraIncreased?: number;
}

export interface DamagePortion {
  readonly element: Element;
  readonly amount: number;
  /** このダメージが通ってきた属性（変換の元と先。補正の対象を決める。仕様書 2.5）。 */
  readonly lineage: readonly Element[];
}

export interface HitResult {
  /** 回避された（ダメージも状態異常も与えない）。 */
  readonly evaded: boolean;
  readonly crit: boolean;
  /** 属性ごとの最終の打撃値。 */
  readonly damage: Readonly<Partial<Record<Element, number>>>;
  readonly total: number;
  /**
   * 会心をかけた後、敵が受けるダメージの倍率・耐性・防御をかける前の打撃値の合計。
   * 崩し値の元にする（仕様書v0.2 2.7「打撃値（全属性の合計・防御の前）」）。
   */
  readonly preMitigationTotal: number;
  /**
   * このヒットに使った武器の uid（呪文など、武器のヒットでなければ undefined）。
   * 状態異常・崩しの計算で、局所の効果の範囲（HitScope）がこのヒットと食い違わないことを確かめるために使う。
   */
  readonly weaponUid: string | undefined;
  /** 属性ごとの基準値（状態異常の強さの元。会心・倍率・耐性・防御を含まない。仕様書v0.2 2.7）。 */
  readonly ailmentBase: Readonly<Partial<Record<Element, number>>>;
  readonly hitChance: number;
  readonly critChance: number;
  readonly critMultiplier: number;
  /** 計算の途中の値（デバッグ・修正値の内訳の表示用）。 */
  readonly trace: {
    readonly skillLevel: number;
    readonly skillPct: number;
    readonly beforeConversion: readonly DamagePortion[];
    readonly afterConversion: readonly DamagePortion[];
  };
}

type Pipeline = "hit" | "ailmentBase";

interface Parts {
  added: { min: number; max: number };
  fixed: { min: number; max: number };
  increased: number;
  more: number;
}

/**
 * 修正値の内訳から、計算の系統（打撃値か基準値か）に合うものだけを集める。
 * 効く範囲（局所か）の絞り込みは、問い合わせのときに HitScope で済ませてある（仕様書v0.2 3.7 の原則5）。
 */
function collectParts(db: ContentDb, result: StatResult, pipeline: Pipeline): Parts {
  const parts: Parts = {
    added: { min: 0, max: 0 },
    fixed: { min: 0, max: 0 },
    increased: 0,
    more: 1,
  };
  for (const c of result.contributions) {
    const effect = db.effects.get(c.effectId);
    if (effect === undefined) continue;
    if (pipeline === "hit" ? !effect.affects.hit : !effect.affects.ailmentBase) continue;
    const range = typeof c.value === "number" ? { min: c.value, max: c.value } : c.value;
    switch (c.kind) {
      case "added":
        parts.added.min += range.min;
        parts.added.max += range.max;
        break;
      case "fixedAdded":
        parts.fixed.min += range.min;
        parts.fixed.max += range.max;
        break;
      case "increased":
        parts.increased += range.min;
        break;
      case "more":
        parts.more *= range.min;
        break;
      default:
        break;
    }
  }
  return parts;
}

const lerp = (r: Range, t: number): number => r.min + (r.max - r.min) * t;

/**
 * ダメージの計算の途中の値が有限であることを確かめる（NaN・Infinity は RangeError）。
 * 有限の値どうしの積・和でも Infinity になることがあり（例：1e300 × 1e10、1e308 ＋ 1e308）、
 * NaN は「> 0」などの比較で黙って捨てられてしまうので、比較・合計に使う前の段階の境目で検証する。
 * 異常な値を 0 などに置き換えることはしない。
 */
const finite = (value: number, what: string): number =>
  requireFinite(value, () => `ダメージの計算の${what}`);

/**
 * 属性の変換（仕様書 2.5）。上流から順に処理し、変換された分は元と先の両方の属性を「通ってきた属性」に持つ。
 * 1つの属性からの変換の合計が100%を超える場合は、比例して100%に縮める。
 */
export function applyConversions(
  portions: readonly DamagePortion[],
  conversions: readonly { readonly from: Element; readonly to: Element; readonly value: number }[],
): DamagePortion[] {
  let current = [...portions];
  for (const element of [...CONVERSION_ORDER, "holy" as const]) {
    const rules = conversions.filter((c) => c.from === element);
    const total = rules.reduce((sum, c) => sum + c.value, 0);
    if (total <= 0) continue;
    const scale = total > 1 ? 1 / total : 1;
    const next: DamagePortion[] = [];
    for (const p of current) {
      if (p.element !== element) {
        next.push(p);
        continue;
      }
      const remaining = p.amount * (1 - Math.min(1, total));
      if (remaining > 0) next.push({ element: p.element, amount: remaining, lineage: p.lineage });
      for (const rule of rules) {
        const moved = p.amount * rule.value * scale;
        if (moved <= 0) continue;
        const lineage = p.lineage.includes(rule.to) ? p.lineage : [...p.lineage, rule.to];
        next.push({ element: rule.to, amount: moved, lineage });
      }
    }
    current = next;
  }
  return current;
}

/**
 * 1回のヒットのダメージを計算する（仕様書v0.2 2.4・開発計画書 6.12 の段階の順）。
 *
 * 1. 基礎値（武器・呪文）＋追加値 → ×技倍率 → ＋固定の追加
 * 2. 変換 → 付け替え
 * 3. ×（1＋加算）×乗算 → ここで基準値を記録する（状態異常の強さの元）
 * 4. 命中 → 会心 → 敵が受けるダメージの倍率 → 耐性 → 防御（防具値・ガード）
 *
 * 打撃値と基準値は、効果の「打撃値・基準値への影響」（affects）に従って別々に計算する。
 */
export function computeHit(
  attacker: DamageAttacker,
  skill: DamageSkill,
  defender: DamageDefender,
  options: HitOptions,
): HitResult {
  const { db, view } = attacker;
  const weapon = skill.kind === "weapon" ? attacker.weapon : undefined;
  // 局所の効果は、そのヒットに使う武器から来たものだけが効く（仕様書v0.2 3.7 の原則5）。
  // 呪文は武器のヒットではないので、武器を持っていても局所の効果は効かない。
  const scope: HitScope = { weaponUid: weapon?.uid };
  const contextTags = [...skill.tags, ...(weapon?.tags ?? [])];
  const rng = options.rng;
  const average = options.roll === "average";

  // 命中（呪文は回避されない。必中の印があれば回避を無視する）
  const alwaysHit = view.flag("alwaysHit", undefined, contextTags, scope).resolution === "force";
  const accuracy = view.stat(COMBAT_STATS.accuracy, contextTags, scope).value;
  const chanceToHit = finite(
    skill.kind === "spell" || alwaysHit ? 1 : hitChance(defender.evasion ?? 0, accuracy),
    "命中率",
  );
  const hitRoll = average ? 0 : rng.next();

  // 会心
  // 基本の会心率：武器の技は、そのヒットに使う武器の会心率（仕様書v0.2 2.4「基本の会心率は武器による」）。
  // 呪文も、持っている武器（attacker.weapon）の会心率を使い、武器がなければ0にしている。
  // 呪文の基本の会心率は仕様書に書かれていない未確定事項（D-U04a-7）で、これは仮の扱い。
  // 決定が出るまで変えない（局所の効果の範囲 scope とは別で、呪文では scope の武器は undefined）。
  const critParts = collectParts(db, view.stat(COMBAT_STATS.critChance, contextTags, scope), "hit");
  // 基本の会心率・追加値・加算率の計算は、強制会心・会心禁止の印の有無にかかわらず検証する
  // （印があると計算の結果は使われないが、NaN・Infinity の混入を印で見逃さないため）。
  const critBase = finite(
    (attacker.weapon?.critChance ?? 0) + (critParts.added.min + critParts.added.max) / 2,
    "会心率（基本の会心率＋追加値）",
  );
  const critIncreased = finite(critParts.increased, "会心率の加算");
  // extraCritChance：会心率の固定値の加算（盗賊の背面判定の補正。基本の会心率に足す。U-10）
  const critRate = finite(
    (critBase + finite(options.extraCritChance ?? 0, "会心率の固定値の加算")) * (1 + critIncreased),
    "会心率",
  );
  const flagged = view.flag("crit", undefined, contextTags, scope).resolution;
  // 会心しない（禁止）は、必ず会心（急所穿ちの5点）に勝つ（仕様書v0.2 2.4.1 の規則1）
  const critFlag = flagged === "forbid" ? "forbid" : options.forceCrit === true ? "force" : flagged;
  const critChance =
    critFlag === "forbid" ? 0 : critFlag === "force" ? 1 : Math.min(1, Math.max(0, critRate));
  const critRoll = average ? 1 : rng.next();
  const multParts = collectParts(
    db,
    view.stat(COMBAT_STATS.critMultiplier, contextTags, scope),
    "hit",
  );
  const critMultiplier = finite(
    BASE_CRIT_MULTIPLIER + (multParts.added.min + multParts.added.max) / 2 + multParts.increased,
    "会心倍率",
  );

  // 技レベル（基本の技レベルと、詞による上乗せ）
  const level = baseSkillLevel(attacker.characterLevel);
  const affixLevels = Math.max(
    0,
    Math.floor(view.stat(COMBAT_STATS.skillLevel, contextTags, scope).value),
  );
  const skillPct = skill.kind === "weapon" ? weaponSkillPct(skill.pct, level) : skill.pct;
  const spellMult = skill.kind === "spell" ? spellBaseMultiplier(level) : 1;

  // 属性ごとの抽選の位置（打撃値と基準値で同じ位置を使う）
  const rollAt: Partial<Record<Element, number>> = {};
  for (const element of ELEMENTS) rollAt[element] = average ? 0.5 : rng.next();

  const conversions = [...view.conversions(contextTags, scope), ...(skill.convert ?? [])];
  const flatPhysical = finite(skill.flatPhysical ?? 0, "技の固定の物理ダメージ");
  const retags = [...view.retagging(contextTags, scope)].sort((a, b) =>
    a.effectId < b.effectId ? -1 : a.effectId > b.effectId ? 1 : 0,
  );

  const extraIncreased = finite(options.extraIncreased ?? 0, "このヒットだけのダメージの加算");
  const run = (
    pipeline: Pipeline,
  ): {
    before: DamagePortion[];
    after: DamagePortion[];
    amounts: Partial<Record<Element, number>>;
  } => {
    // 1. 基礎値＋追加値 → ×技倍率 → ＋固定の追加
    const before: DamagePortion[] = [];
    for (const element of ELEMENTS) {
      const parts = collectParts(
        db,
        view.stat(COMBAT_STATS.added[element], [...contextTags, ELEMENT_TAG[element]], scope),
        pipeline,
      );
      const baseRange = skill.kind === "weapon" ? weapon?.base[element] : skill.base?.[element];
      const base =
        baseRange === undefined ? 0 : lerp(baseRange, rollAt[element] ?? 0.5) * spellMult;
      const added = lerp(parts.added, rollAt[element] ?? 0.5);
      const fixed = lerp(parts.fixed, rollAt[element] ?? 0.5);
      const flat = element === "physical" ? flatPhysical : 0;
      const amount = finite((base + added) * skillPct + fixed + flat, `基礎値（${element}）`);
      if (amount > 0) before.push({ element, amount, lineage: [element] });
    }
    // 2. 変換 → 付け替え（付け替えた後は、その属性の補正だけを受ける）
    const converted = applyConversions(before, conversions);
    const after = converted.map((p) => {
      const rule = retags.find((r) => r.from.includes(p.element));
      return rule === undefined ? p : { element: rule.to, amount: p.amount, lineage: [rule.to] };
    });
    // 3. ×（1＋加算）×乗算（変換・付け替えの後の値も、ここで合わせて検証する）
    const amounts: Partial<Record<Element, number>> = {};
    for (const p of after) {
      const tags = [...contextTags, ...p.lineage.map((e) => ELEMENT_TAG[e])];
      const parts = collectParts(db, view.stat(COMBAT_STATS.damage, tags, scope), pipeline);
      const increased =
        parts.increased + AFFIX_SKILL_LEVEL_INCREASED * affixLevels + extraIncreased;
      amounts[p.element] = finite(
        (amounts[p.element] ?? 0) + p.amount * (1 + increased) * parts.more,
        `${pipeline === "hit" ? "打撃値" : "基準値"}（${p.element}・加算と乗算の後）`,
      );
    }
    return { before, after, amounts };
  };

  const hit = run("hit");
  const base = run("ailmentBase");
  const ailmentBase: Partial<Record<Element, number>> = {};
  for (const element of ELEMENTS) {
    const v = base.amounts[element];
    if (v !== undefined && v > 0) ailmentBase[element] = v;
  }

  const evaded = !(hitRoll < chanceToHit);
  const crit = !evaded && (average ? false : critRoll < critChance);
  const damage: Partial<Record<Element, number>> = {};
  let total = 0;
  let preMitigationTotal = 0;
  if (!evaded) {
    const taken = defender.takenMultiplier ?? 1;
    const guard = Math.min(1, Math.max(0, defender.guard ?? 0));
    const armor = defender.armor ?? 0;
    for (const element of ELEMENTS) {
      const amount = hit.amounts[element];
      if (amount === undefined || amount <= 0) continue;
      // 4. 会心 → 敵が受けるダメージの倍率 → 耐性 → 防御
      // 崩し値の元（U-04b）。有限であることは、使う側（staggerValue）で検証する
      const afterCrit = amount * (crit ? critMultiplier : 1);
      preMitigationTotal += afterCrit;
      let value = afterCrit * taken * (1 - (defender.resist?.[element] ?? 0));
      // 防具値0では軽減しない（armorReduction も0を返す）。0でなければ（NaN・Infinity を含む）
      // armorReduction が防具値と受けるダメージを検証する。
      if (element === "physical" && armor !== 0) value *= 1 - armorReduction(armor, value);
      value *= 1 - guard;
      value = Math.max(0, finite(value, `最終の打撃値（${element}）`));
      damage[element] = value;
      total = finite(total + value, "最終の打撃値の合計");
    }
  }

  return {
    evaded,
    crit,
    damage,
    total,
    preMitigationTotal,
    weaponUid: weapon?.uid,
    ailmentBase: evaded ? {} : ailmentBase,
    hitChance: chanceToHit,
    critChance,
    critMultiplier,
    trace: {
      skillLevel: level + affixLevels,
      skillPct,
      beforeConversion: hit.before,
      afterConversion: hit.after,
    },
  };
}

/**
 * 期待値のダメージ（会心の期待値・命中率を含む）。シミュレーションと表示に使う。
 * 乱数を使わずに、平均の値で計算する。
 */
export function expectedHitDamage(
  attacker: DamageAttacker,
  skill: DamageSkill,
  defender: DamageDefender,
  rng: Rng,
): number {
  const r = computeHit(attacker, skill, defender, { rng, roll: "average" });
  const critFactor = 1 + r.critChance * (r.critMultiplier - 1);
  return finite(r.total * critFactor * r.hitChance, "期待値");
}
