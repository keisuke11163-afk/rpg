/**
 * ダメージの計算（本仕様書 2.4〜2.7、開発計画書 6.12）。
 * 描画・乱数に依存しない純粋な関数。会心・命中の判定は resolveRolls で別に行う。
 */

export const ELEMENTS = ["physical", "lightning", "cold", "fire", "dark", "holy"] as const;
export type Element = (typeof ELEMENTS)[number];

/** 変換の順序（本仕様書 2.5）：物理 → 雷 → 氷 → 火 → 闇。聖は独立 */
export const CONVERSION_ORDER: readonly Element[] = [
  "physical",
  "lightning",
  "cold",
  "fire",
  "dark",
];

/** 計算の段階の順序。順序を変えるときは、テストの期待値も一緒に変える */
export const DAMAGE_STAGES = [
  "base",
  "added",
  "skillMultiplier",
  "flat",
  "conversion",
  "reassign",
  "additivePercent",
  "multiplier",
  "recordReference",
  "crit",
  "enemyDamageTaken",
  "resistance",
  "defense",
] as const;

export type ElementAmounts = Partial<Record<Element, number>>;

export interface Conversion {
  from: Element;
  to: Element;
  /** 0〜1 */
  ratio: number;
}

/** 付け替え：対象の属性を、別の属性として扱い直す（変換の後。付け替えた後の属性の補正だけを受ける） */
export interface Reassign {
  from: readonly Element[];
  to: Element;
}

export interface ElementModifier {
  addPct: number;
  mult: number;
}

export interface DamageInput {
  /** 基礎値（武器の基礎ダメージなど）。属性ごと */
  base: ElementAmounts;
  /** 追加値（詞の「物理ダメージ追加」など）。技倍率を受ける */
  added?: ElementAmounts;
  /** 技倍率（例：1.3） */
  skillMultiplier: number;
  /** 固定の追加。技倍率を受けない */
  flat?: ElementAmounts;
  conversions?: readonly Conversion[];
  reassign?: Reassign;
  /** 汎用の補正（属性を問わない） */
  generic?: Partial<ElementModifier>;
  /** 属性ごとの補正。変換されたダメージは、元の属性と変換後の属性の両方の補正を受ける */
  byElement?: Partial<Record<Element, Partial<ElementModifier>>>;
  crit?: boolean;
  /** 会心倍率（既定1.5） */
  critMultiplier?: number;
  /** 敵が受けるダメージの倍率（感電・崩しなど）。基準値には含めない */
  enemyDamageTaken?: number;
  /** 敵の耐性（属性ごと。上限は呼び出し側が適用済みでも、ここでも75%に丸める） */
  resistance?: Partial<Record<Element, number>>;
  /** 耐性の上限（既定0.75。効果で最大0.9） */
  resistanceCap?: number;
  /** 敵の防具値（物理にだけ効く） */
  armor?: number;
}

export interface DamagePart {
  /** 変換・付け替えの後の属性 */
  element: Element;
  /** 経由した属性（元の属性を含む）。補正を二重にかけないための記録 */
  chain: readonly Element[];
  /** 補正（加算％・乗算）を乗せた後の値＝基準値 */
  reference: number;
  /** 最終ダメージ */
  final: number;
}

export interface DamageResult {
  parts: DamagePart[];
  /** 基準値（属性ごとの合計）。会心・敵が受けるダメージの倍率・耐性・防御は含めない */
  reference: ElementAmounts;
  referenceTotal: number;
  total: number;
}

export const ARMOR_REDUCTION_CAP = 0.85;
export const RESISTANCE_CAP = 0.75;
export const RESISTANCE_CAP_MAX = 0.9;
export const DEFAULT_CRIT_MULTIPLIER = 1.5;

interface Part {
  element: Element;
  chain: Element[];
  amount: number;
}

/** 防具値による軽減率 ＝ 防具値 ÷（防具値 ＋ 10 × 受けるダメージ）。上限85% */
export function armorReduction(armor: number, incoming: number): number {
  if (armor <= 0 || incoming <= 0) return 0;
  return Math.min(ARMOR_REDUCTION_CAP, armor / (armor + 10 * incoming));
}

function validateConversions(conversions: readonly Conversion[]): void {
  for (const c of conversions) {
    if (c.from === "holy") throw new Error("聖から他の属性への変換はできない（本仕様書 2.5）");
    if (c.to !== "holy") {
      const from = CONVERSION_ORDER.indexOf(c.from);
      const to = CONVERSION_ORDER.indexOf(c.to);
      if (to <= from) throw new Error(`変換は上流から下流へだけ（${c.from}→${c.to}）`);
    }
    if (!(c.ratio >= 0 && c.ratio <= 1)) throw new Error("変換の割合は0〜1");
  }
}

function applyConversions(parts: Part[], conversions: readonly Conversion[]): Part[] {
  validateConversions(conversions);
  let current = parts;
  for (const source of CONVERSION_ORDER) {
    const rules = conversions.filter((c) => c.from === source && c.ratio > 0);
    if (rules.length === 0) continue;
    // 変換の合計は100%まで。超えたら比例して縮める
    const total = rules.reduce((sum, r) => sum + r.ratio, 0);
    const scale = total > 1 ? 1 / total : 1;
    const next: Part[] = [];
    for (const part of current) {
      if (part.element !== source) {
        next.push(part);
        continue;
      }
      let remaining = part.amount;
      for (const rule of rules) {
        const moved = part.amount * rule.ratio * scale;
        remaining -= moved;
        next.push({ element: rule.to, chain: [...part.chain, rule.to], amount: moved });
      }
      next.push({ ...part, amount: Math.max(0, remaining) });
    }
    current = next;
  }
  return current.filter((p) => p.amount > 1e-12);
}

/** 属性ごとの基礎の計算（段階1〜3＋固定） */
function initialParts(input: DamageInput): Part[] {
  const parts: Part[] = [];
  for (const element of ELEMENTS) {
    const raw =
      ((input.base[element] ?? 0) + (input.added?.[element] ?? 0)) * input.skillMultiplier;
    const amount = raw + (input.flat?.[element] ?? 0);
    if (amount !== 0) parts.push({ element, chain: [element], amount });
  }
  return parts;
}

export function computeDamage(input: DamageInput): DamageResult {
  let parts = initialParts(input);
  parts = applyConversions(parts, input.conversions ?? []);

  if (input.reassign) {
    const { from, to } = input.reassign;
    parts = parts.map((p) =>
      from.includes(p.element) ? { element: to, chain: [to], amount: p.amount } : p,
    );
  }

  const generic = { addPct: input.generic?.addPct ?? 0, mult: input.generic?.mult ?? 1 };
  const cap = Math.min(RESISTANCE_CAP_MAX, input.resistanceCap ?? RESISTANCE_CAP);
  const critMult = input.crit === true ? (input.critMultiplier ?? DEFAULT_CRIT_MULTIPLIER) : 1;
  const taken = input.enemyDamageTaken ?? 1;

  const out: DamagePart[] = [];
  const reference: ElementAmounts = {};
  // 基準値までは部分ごと、その後（耐性・防御）は属性ごとに計算する
  const finalByPart = parts.map((p) => {
    let addPct = generic.addPct;
    let mult = generic.mult;
    for (const e of new Set(p.chain)) {
      addPct += input.byElement?.[e]?.addPct ?? 0;
      mult *= input.byElement?.[e]?.mult ?? 1;
    }
    const ref = p.amount * (1 + addPct) * mult;
    const res = Math.min(cap, input.resistance?.[p.element] ?? 0);
    let dmg = ref * critMult * taken * (1 - res);
    if (p.element === "physical" && input.armor !== undefined) {
      dmg *= 1 - armorReduction(input.armor, dmg);
    }
    return { p, ref, dmg };
  });
  for (const { p, ref, dmg } of finalByPart) {
    out.push({ element: p.element, chain: p.chain, reference: ref, final: Math.max(0, dmg) });
    reference[p.element] = (reference[p.element] ?? 0) + ref;
  }
  const referenceTotal = out.reduce((s, p) => s + p.reference, 0);
  return { parts: out, reference, referenceTotal, total: out.reduce((s, p) => s + p.final, 0) };
}

/** 命中率 ＝ 1 － 回避率。回避率 ＝ 回避値 ÷（回避値 ＋ 命中 × 1.5）。上限75%。呪文は回避されない */
export function hitChance(evasion: number, accuracy: number, isSpell = false): number {
  if (isSpell) return 1;
  if (evasion <= 0) return 1;
  const dodge = Math.min(0.75, evasion / (evasion + accuracy * 1.5));
  return 1 - dodge;
}

/** 会心率 ＝（武器の基本会心率 ＋ 固定値の加算）×（1 ＋ 会心率の増加%の合計）。上限100% */
export function critChance(weaponBase: number, flatAdd: number, increasePct: number): number {
  return Math.min(1, Math.max(0, (weaponBase + flatAdd) * (1 + increasePct)));
}

/** 会心倍率 ＝ 150% ＋ 会心倍率の加算 */
export function critMultiplier(add: number): number {
  return DEFAULT_CRIT_MULTIPLIER + add;
}
