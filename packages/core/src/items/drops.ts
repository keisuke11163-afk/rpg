import type { DropSource, ItemBaseDef, ItemRarity } from "../content/item.ts";
import type { JobDef } from "../content/job.ts";
import type { ContentDb } from "../content/load.ts";
import type { TagIndex } from "../effects/tag-index.ts";
import type { Rng } from "../random/rng.ts";
import { weaponAffinity } from "../combat/skills.ts";
import { type ItemInstance, generateItem } from "./generate.ts";
import { rollRarity } from "./rarity.ts";

/** ジョブに合わせたドロップの割合（仕様書v0.2 3.5）。 */
export const JOB_TARGETED_SHARE = 0.35;

/**
 * 仮実装: U-16 feature/unique-items で、ユニークの抽選に置き換える。
 * ユニーク・星座のデータが無いので、落とせないレアリティとして扱う（重みは手順4で通常に回る）。
 */
const NOT_YET_GENERATED: ReadonlySet<ItemRarity> = new Set<ItemRarity>(["unique", "set"]);

export interface DropInput {
  readonly source: DropSource;
  /** 倒した敵のLv（1以上の整数）。 */
  readonly enemyLevel: number;
  /** 倒した敵の系統のタグ（獣牙は獣系だけ）。 */
  readonly enemyFamily?: string;
  /** 今のメインジョブ（ジョブに合わせたドロップ）。省略すると、全て完全にランダム。 */
  readonly mainJob?: JobDef;
  readonly tags: TagIndex;
  /** 発見率（1 ＝ +100%）。 */
  readonly findRate?: number;
  /** 回廊の階層ボーナス（MVPでは0）。 */
  readonly corridorBonus?: number;
  /** 装備の uid を作る（セーブデータの一意のID）。 */
  readonly nextUid: () => string;
}

export interface DropResult {
  readonly itemLevel: number;
  readonly items: readonly ItemInstance[];
  /** ジョブに合わせて選んだベースか（items と同じ順）。 */
  readonly jobTargeted: readonly boolean[];
  readonly gold: number;
  readonly materials: readonly { readonly material: string; readonly count: number }[];
}

/** アイテムLv ＝ 敵のLv ＋ 格の補正（精鋭+2・ボス+4。仕様書v0.2 3.6）。 */
export function dropItemLevel(db: ContentDb, source: DropSource, enemyLevel: number): number {
  if (!(Number.isInteger(enemyLevel) && enemyLevel >= 1))
    throw new RangeError(`敵のLvは1以上の整数（${String(enemyLevel)}）`);
  const profile = db.dropProfiles.get(source);
  if (profile === undefined) throw new RangeError(`ドロップの出どころ ${source} の定義が無い`);
  return enemyLevel + profile.itemLevelBonus;
}

/** アイテムLvで落とせるベース（必要LvがアイテムLv以下）。 */
export function droppableBases(db: ContentDb, itemLevel: number): ItemBaseDef[] {
  return [...db.itemBases.values()].filter((b) => b.requiredLevel <= itemLevel);
}

/** メインジョブの適性がA以上の武器のベース（仕様書v0.2 3.5 のジョブに合わせたドロップ）。 */
export function jobTargetedBases(
  bases: readonly ItemBaseDef[],
  tags: TagIndex,
  job: JobDef,
): ItemBaseDef[] {
  return bases.filter((b) => {
    if (b.category !== "weapon") return false;
    const a = weaponAffinity(tags, job, b.tags);
    return a === "S" || a === "A";
  });
}

/**
 * 1体を倒したときのドロップ（仕様書v0.2 3.5、補助仕様書5章・12章）。
 * - アイテム：確率 chance で、count の範囲（等しい確率）の数。希少以上の確定の数だけ、希少以上から抽選
 * - ベース：35%はメインジョブの適性がA以上の武器、残りは落とせる全てのベースから等しい確率で
 * - 金貨：確率 gold.chance で、（1＋敵のLv）〜 2×（1＋敵のLv）の整数 × 倍率
 * - 素材：確率で1個、または確定の数
 */
export function rollDrops(db: ContentDb, rng: Rng, input: DropInput): DropResult {
  const profile = db.dropProfiles.get(input.source);
  if (profile === undefined)
    throw new RangeError(`ドロップの出どころ ${input.source} の定義が無い`);
  const itemLevel = dropItemLevel(db, input.source, input.enemyLevel);
  const bases = droppableBases(db, itemLevel);
  const targeted =
    input.mainJob === undefined ? [] : jobTargetedBases(bases, input.tags, input.mainJob);

  const items: ItemInstance[] = [];
  const jobTargeted: boolean[] = [];
  if (rng.chance(profile.chance)) {
    if (bases.length === 0)
      throw new RangeError(`アイテムLv ${String(itemLevel)} で落とせるベースが無い`);
    const count = rng.int(profile.count.min, profile.count.max);
    for (let i = 0; i < count; i++) {
      const rarity = rollRarity(rng, {
        rarities: db.rarities,
        rareMultiplier: profile.rareMultiplier,
        ...(input.corridorBonus === undefined ? {} : { corridorBonus: input.corridorBonus }),
        ...(input.findRate === undefined ? {} : { findRate: input.findRate }),
        unavailable: NOT_YET_GENERATED,
        rareOrBetterOnly: i < profile.guaranteedRareOrBetter,
      });
      const useJob = targeted.length > 0 && rng.chance(JOB_TARGETED_SHARE);
      const base = rng.pick(useJob ? targeted : bases);
      items.push(generateItem(db, rng, { uid: input.nextUid(), base, rarity, itemLevel }));
      jobTargeted.push(useJob);
    }
  }

  let gold = 0;
  if (profile.gold !== undefined && rng.chance(profile.gold.chance)) {
    const unit = 1 + input.enemyLevel;
    gold = rng.int(unit, 2 * unit) * profile.gold.multiplier;
  }

  const materials: { material: string; count: number }[] = [];
  for (const m of profile.materials) {
    if (
      m.family !== undefined &&
      (input.enemyFamily === undefined || !input.tags.closure([input.enemyFamily]).has(m.family))
    )
      continue;
    const count = m.count ?? (rng.chance(m.chance ?? 0) ? 1 : 0);
    if (count > 0) materials.push({ material: m.material, count });
  }
  return { itemLevel, items, jobTargeted, gold, materials };
}
