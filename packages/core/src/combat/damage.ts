import type { Element } from "../content/effect.ts";
import { ELEMENTS } from "../content/effect.ts";
import { CONVERSION_ORDER, ELEMENT_TAG } from "../content/elements.ts";
import type { ContentDb } from "../content/load.ts";
import type { ModifierView, Range, StatResult } from "../effects/evaluate.ts";
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

/** 修正値の内訳から、計算の系統（打撃値か基準値か）と効く範囲（局所か）に合うものだけを集める。 */
function collectParts(
  db: ContentDb,
  result: StatResult,
  pipeline: Pipeline,
  weaponUid: string | undefined,
): Parts {
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
    if (effect.locality === "local" && (weaponUid === undefined || c.source.ref !== weaponUid))
      continue;
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
  const weaponUid = attacker.weapon?.uid;
  const contextTags = [...skill.tags, ...(weapon?.tags ?? [])];
  const rng = options.rng;
  const average = options.roll === "average";

  // 命中（呪文は回避されない。必中の印があれば回避を無視する）
  const alwaysHit = view.flag("alwaysHit", undefined, contextTags).resolution === "force";
  const accuracy = view.stat(COMBAT_STATS.accuracy, contextTags).value;
  const chanceToHit =
    skill.kind === "spell" || alwaysHit ? 1 : hitChance(defender.evasion ?? 0, accuracy);
  const hitRoll = average ? 0 : rng.next();

  // 会心
  const critParts = collectParts(
    db,
    view.stat(COMBAT_STATS.critChance, contextTags),
    "hit",
    weaponUid,
  );
  const critBase =
    (attacker.weapon?.critChance ?? 0) + (critParts.added.min + critParts.added.max) / 2;
  const critFlag = view.flag("crit", undefined, contextTags).resolution;
  const critChance =
    critFlag === "forbid"
      ? 0
      : critFlag === "force"
        ? 1
        : Math.min(1, Math.max(0, critBase * (1 + critParts.increased)));
  const critRoll = average ? 1 : rng.next();
  const multParts = collectParts(
    db,
    view.stat(COMBAT_STATS.critMultiplier, contextTags),
    "hit",
    weaponUid,
  );
  const critMultiplier =
    BASE_CRIT_MULTIPLIER + (multParts.added.min + multParts.added.max) / 2 + multParts.increased;

  // 技レベル（基本の技レベルと、詞による上乗せ）
  const level = baseSkillLevel(attacker.characterLevel);
  const affixLevels = Math.max(
    0,
    Math.floor(view.stat(COMBAT_STATS.skillLevel, contextTags).value),
  );
  const skillPct = skill.kind === "weapon" ? weaponSkillPct(skill.pct, level) : skill.pct;
  const spellMult = skill.kind === "spell" ? spellBaseMultiplier(level) : 1;

  // 属性ごとの抽選の位置（打撃値と基準値で同じ位置を使う）
  const rollAt: Partial<Record<Element, number>> = {};
  for (const element of ELEMENTS) rollAt[element] = average ? 0.5 : rng.next();

  const conversions = view.conversions(contextTags);
  const retags = [...view.retagging(contextTags)].sort((a, b) =>
    a.effectId < b.effectId ? -1 : a.effectId > b.effectId ? 1 : 0,
  );

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
        view.stat(COMBAT_STATS.added[element], [...contextTags, ELEMENT_TAG[element]]),
        pipeline,
        weaponUid,
      );
      const baseRange = skill.kind === "weapon" ? weapon?.base[element] : skill.base?.[element];
      const base =
        baseRange === undefined ? 0 : lerp(baseRange, rollAt[element] ?? 0.5) * spellMult;
      const added = lerp(parts.added, rollAt[element] ?? 0.5);
      const fixed = lerp(parts.fixed, rollAt[element] ?? 0.5);
      const amount = (base + added) * skillPct + fixed;
      if (amount > 0) before.push({ element, amount, lineage: [element] });
    }
    // 2. 変換 → 付け替え（付け替えた後は、その属性の補正だけを受ける）
    const converted = applyConversions(before, conversions);
    const after = converted.map((p) => {
      const rule = retags.find((r) => r.from.includes(p.element));
      return rule === undefined ? p : { element: rule.to, amount: p.amount, lineage: [rule.to] };
    });
    // 3. ×（1＋加算）×乗算
    const amounts: Partial<Record<Element, number>> = {};
    for (const p of after) {
      const tags = [...contextTags, ...p.lineage.map((e) => ELEMENT_TAG[e])];
      const parts = collectParts(db, view.stat(COMBAT_STATS.damage, tags), pipeline, weaponUid);
      const increased = parts.increased + AFFIX_SKILL_LEVEL_INCREASED * affixLevels;
      amounts[p.element] = (amounts[p.element] ?? 0) + p.amount * (1 + increased) * parts.more;
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
  if (!evaded) {
    const taken = defender.takenMultiplier ?? 1;
    const guard = Math.min(1, Math.max(0, defender.guard ?? 0));
    for (const element of ELEMENTS) {
      const amount = hit.amounts[element];
      if (amount === undefined || amount <= 0) continue;
      // 4. 会心 → 敵が受けるダメージの倍率 → 耐性 → 防御
      let value =
        amount * (crit ? critMultiplier : 1) * taken * (1 - (defender.resist?.[element] ?? 0));
      if (element === "physical") value *= 1 - armorReduction(defender.armor ?? 0, value);
      value *= 1 - guard;
      value = Math.max(0, value);
      damage[element] = value;
      total += value;
    }
  }

  return {
    evaded,
    crit,
    damage,
    total,
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
  return r.total * critFactor * r.hitChance;
}
