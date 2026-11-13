import {
  AFFIX_SLOTS,
  type AffixDef,
  type AffixTier,
  type ItemBaseDef,
  type ItemRarity,
} from "../content/item.ts";
import type { ContentDb } from "../content/load.ts";
import type { EffectInstance } from "../effects/evaluate.ts";
import type { Rng } from "../random/rng.ts";
import { affixTierValues, eligibleTiers, tierWeights } from "./tiers.ts";

/** 装備の効果の出どころの種類（局所の効果は、ref が武器の uid のときだけ効く）。 */
export const EQUIPMENT_SOURCE = "equipment";

/** アイテムに付いた詞（開発計画書6.5 の装備の実体の affixes）。 */
export interface RolledAffix {
  readonly id: string;
  readonly tier: AffixTier;
  /**
   * 抽選した値（表示の単位）。range・fixed は [値]、added は [最小, 最大]。
   */
  readonly rolls: readonly number[];
}

/** 装備の実体（開発計画書6.5。セーブデータに保存する形）。強化・クラフトの項目は省略すると初期の値。 */
export interface ItemInstance {
  readonly uid: string;
  readonly base: string;
  readonly rarity: ItemRarity;
  readonly itemLevel: number;
  readonly affixes: readonly RolledAffix[];
  /** 強化値 0〜10（仕様書v0.2 3.9。省略で0）。 */
  readonly enhance?: number;
  /** 鍛造負荷 0〜100（仕様書v0.2 3.11.1。省略で0）。 */
  readonly forgeLoad?: number;
  /** 封詞した詞の ID（次の1回の操作から守る。省略で無し）。 */
  readonly sealed?: string;
  /** これまでに封詞した回数（2個目以降は負荷が重い。省略で0）。 */
  readonly sealsUsed?: number;
  /** 亀裂（小さなマイナスの効果の ID。省略で無し）。 */
  readonly cracks?: readonly string[];
  /** 銘（+10 で刻む効果の ID。省略で無し）。 */
  readonly inscription?: string;
  /** 刻詞の筆で付けた詞の数（1つの装備に2つまで。仕様書v0.2 3.11.2。省略で0）。 */
  readonly brushed?: number;
  /** 遺物で写し取る小星（プレイヤーが選ぶ。仕様書v0.2 3.11.6。省略で無し）。 */
  readonly relicNodes?: readonly string[];
}

/** 職詞の重みの倍率（ジョブに合わせたドロップのとき、そのジョブの職詞。docs/progress D-U11-23）。 */
export const JOB_AFFIX_BOOST = 4;

/** 詞の抽選の文脈（ドロップの元の敵の系統・ジョブに合わせたドロップ）。 */
export interface AffixContext {
  readonly allowT0?: boolean;
  /** ドロップの元の敵の系統のタグ（親タグを含む）。系統詞は、ここに含まれる系統だけ付く。 */
  readonly families?: ReadonlySet<string>;
  /** ジョブに合わせたドロップのジョブのタグ。そのジョブの職詞の重みを JOB_AFFIX_BOOST 倍にする。 */
  readonly targetJob?: string;
  /** 系統素材の偏り（仕様書v0.2 3.11.3）：この詞・この系統の系統詞の重みを multiplier 倍にする。 */
  readonly bias?: {
    readonly family?: string | undefined;
    readonly affixes?: readonly string[] | undefined;
    readonly multiplier: number;
  };
}

export interface GenerateItemInput {
  readonly uid: string;
  readonly base: ItemBaseDef;
  /** 通常・魔法・希少だけ（固有・星座は固定の効果なので、ここでは作らない）。 */
  readonly rarity: ItemRarity;
  readonly itemLevel: number;
  /** 極T0を出せるか（回廊の第12階層以上）。MVPでは false。 */
  readonly allowT0?: boolean;
  /** ドロップの元の敵の系統（系統詞）。 */
  readonly families?: ReadonlySet<string>;
  /** ジョブに合わせたドロップのジョブのタグ（職詞が出やすい）。 */
  readonly targetJob?: string;
}

function requireItemLevel(itemLevel: number): void {
  if (!(Number.isInteger(itemLevel) && itemLevel >= 1))
    throw new RangeError(`アイテムLvは1以上の整数（${String(itemLevel)}）`);
}

/** このベースに、このアイテムLvで付けられる詞と、出現できるtier。 */
export function candidateAffixes(
  db: ContentDb,
  base: ItemBaseDef,
  itemLevel: number,
  options: AffixContext = {},
): { affix: AffixDef; tiers: AffixTier[]; weight: number }[] {
  requireItemLevel(itemLevel);
  const out: { affix: AffixDef; tiers: AffixTier[]; weight: number }[] = [];
  for (const affix of db.affixes.values()) {
    if (!affix.categories.includes(base.category)) continue;
    if (affix.family !== undefined && options.families?.has(affix.family) !== true) continue;
    const tiers = eligibleTiers(affix, itemLevel, options);
    if (tiers.length === 0) continue;
    const b = options.bias;
    const biased =
      b !== undefined &&
      ((affix.family !== undefined && affix.family === b.family) ||
        (b.affixes?.includes(affix.id) ?? false));
    const weight =
      affix.weight *
      (affix.categoryWeights?.[base.category] ?? 1) *
      (affix.job !== undefined && affix.job === options.targetJob ? JOB_AFFIX_BOOST : 1) *
      (biased ? b.multiplier : 1);
    out.push({ affix, tiers, weight });
  }
  return out;
}

/**
 * 詞の値を抽選する（仕様書v0.2 3.6）。
 * - range：tierの範囲で、表示の単位の整数を1つ等しい確率で（docs/progress D-U11-6）
 * - added：最小・最大の追加ダメージ。抽選しない
 * - fixed：tierの値
 */
export function rollAffixValue(rng: Rng, affix: AffixDef, tier: AffixTier): number[] {
  const value = affixTierValues(affix).get(tier);
  if (value === undefined) throw new RangeError(`詞 ${affix.id} に T${String(tier)} が無い`);
  switch (affix.roll) {
    case "added":
      return [value.min, value.max];
    case "fixed":
      return [value.min];
    case "range": {
      const lo = Math.ceil(value.min);
      const hi = Math.floor(value.max);
      if (hi < lo) throw new RangeError(`詞 ${affix.id} の T${String(tier)} の範囲に整数が無い`);
      return [rng.int(lo, hi)];
    }
  }
}

/**
 * アイテムを1つ作る（通常・魔法・希少）。
 * - 詞の数：レアリティの範囲から等しい確率で（docs/progress D-U11-5）。部位の枠（前詞・後詞）を超えない。
 *   付けられる詞が足りないときは、付けられる数まで
 * - 詞：前詞・後詞の空いている枠の詞から、出現の重みで抽選する。同じ詞は1つのアイテムに1つまで
 *   （docs/progress D-U11-7）
 * - tier：出現できるtierのうち最も高いものを40、残りを60として等分（仕様書v0.2 3.6）
 */
export function generateItem(db: ContentDb, rng: Rng, input: GenerateItemInput): ItemInstance {
  const { base, rarity, itemLevel, uid } = input;
  requireItemLevel(itemLevel);
  const rarityDef = db.rarities.get(rarity);
  if (rarityDef === undefined) throw new RangeError(`レアリティ ${rarity} の定義が無い`);
  if (rarity === "unique" || rarity === "set")
    throw new RangeError(`${rarity} は固定の効果を持つので、generateItem では作らない`);
  const wanted = rng.int(rarityDef.affixes.min, rarityDef.affixes.max);
  // 星鉄の首飾り：共鳴紋が確定で付く。その代わり詞の枠-1（共鳴紋は枠を1つ使い、合計は枠−1まで）
  const forced: RolledAffix[] = [];
  if (base.guaranteedResonance === true) {
    const marks = candidateAffixes(db, base, itemLevel).filter(
      (c) => c.affix.resonance !== undefined,
    );
    if (marks.length > 0) {
      const c = rng.pick(marks);
      const tier = c.tiers[0] as AffixTier;
      forced.push({ id: c.affix.id, tier, rolls: rollAffixValue(rng, c.affix, tier) });
    }
  }
  const affixes = addAffixes(db, rng, base, itemLevel, forced, wanted + forced.length, {
    ...(input.allowT0 === undefined ? {} : { allowT0: input.allowT0 }),
    ...(input.families === undefined ? {} : { families: input.families }),
    ...(input.targetJob === undefined ? {} : { targetJob: input.targetJob }),
  });
  return { uid, base: base.id, rarity, itemLevel, affixes };
}

/**
 * 詞を足す（生成とクラフトで共通）。今ある詞（existing）は残し、合計が wanted になるまで、
 * 前詞・後詞の空いている枠の詞から出現の重みで抽選する。同じ詞は1つまで。付けられる詞が無くなったら、そこまで。
 */
export function addAffixes(
  db: ContentDb,
  rng: Rng,
  base: ItemBaseDef,
  itemLevel: number,
  existing: readonly RolledAffix[],
  wanted: number,
  options: AffixContext = {},
): RolledAffix[] {
  const slots = AFFIX_SLOTS[base.category];
  const capacity = slots.prefix + slots.suffix - (base.guaranteedResonance === true ? 1 : 0);
  const pool = candidateAffixes(db, base, itemLevel, options);
  const used = { prefix: 0, suffix: 0 };
  const taken = new Set<string>();
  const affixes: RolledAffix[] = [...existing];
  for (const a of existing) {
    const def = db.affixes.get(a.id);
    if (def !== undefined) used[def.position] += 1;
    taken.add(a.id);
  }
  while (affixes.length < Math.min(wanted, capacity)) {
    const open = pool.filter(
      (c) => !taken.has(c.affix.id) && used[c.affix.position] < slots[c.affix.position],
    );
    if (open.length === 0) break;
    const chosen = rng.weighted(open.map((c) => ({ item: c, weight: c.weight })));
    const tier = rng.weighted(
      tierWeights(chosen.tiers).map((t) => ({ item: t.tier, weight: t.weight })),
    );
    affixes.push({ id: chosen.affix.id, tier, rolls: rollAffixValue(rng, chosen.affix, tier) });
    taken.add(chosen.affix.id);
    used[chosen.affix.position] += 1;
  }
  return affixes;
}

/**
 * 装備の効果（効果の評価に渡す形）：ベースの基本刻印と、詞（値を詞の値で差し替える）。
 * 出どころは { kind: "equipment", ref: uid }（局所の効果は、この武器のヒットだけに効く）。
 */
export function itemEffectInstances(db: ContentDb, item: ItemInstance): EffectInstance[] {
  const base = db.itemBases.get(item.base);
  if (base === undefined) throw new RangeError(`ベース ${item.base} が無い`);
  const source = { kind: EQUIPMENT_SOURCE, ref: item.uid };
  const out: EffectInstance[] = [
    ...(base.implicitEffects ?? []),
    ...(base.unique?.effects ?? []),
  ].map((effectId) => ({ effectId, source }));
  for (const rolled of item.affixes) {
    const affix = db.affixes.get(rolled.id);
    if (affix === undefined) throw new RangeError(`詞 ${rolled.id} が無い`);
    const s = affix.scale;
    const value =
      affix.roll === "added"
        ? { min: (rolled.rolls[0] ?? 0) * s, max: (rolled.rolls[1] ?? 0) * s }
        : (rolled.rolls[0] ?? 0) * s;
    out.push({ effectId: affix.effect, source, values: [value] });
  }
  // 亀裂（マイナスの効果）と銘（仕様書v0.2 3.9・3.11.1）
  for (const effectId of item.cracks ?? []) out.push({ effectId, source });
  if (item.inscription !== undefined) out.push({ effectId: item.inscription, source });
  return out;
}
