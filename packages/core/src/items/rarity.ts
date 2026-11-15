/**
 * レアリティの抽選の手順（本仕様書 3.5 【v0.2】）。
 */
import type { Rng } from "../rng.ts";
import type { EnemyRank } from "../enemy/def.ts";
import type { Rarity } from "./types.ts";

/** 基本の重み：通常66／魔法26／希少7／固有0.8／星座0.2 */
export const BASE_RARITY_WEIGHTS = {
  normal: 66,
  magic: 26,
  rare: 7,
  unique: 0.8,
  set: 0.2,
} as const;

/** 敵の格による、希少以上の補正 */
export const RANK_RARITY_BONUS: Readonly<Record<EnemyRank, number>> = {
  normal: 1,
  magic: 1.5,
  elite: 2.5,
};

export interface RarityContext {
  rank: EnemyRank;
  /** 回廊の階層ボーナス（1.5 = +150%）。MVPでは0 */
  floorBonus?: number;
  /** 発見率（IF。1.0 = 100%） */
  itemFind?: number;
  /** 中ボスなどが「希少以上確定」のとき true */
  rareOrBetterGuaranteed?: boolean;
}

/** 発見率の効き方：希少は ×(1＋IF)、固有・星座は ×(1＋IF×200÷(IF＋200))。IFは百分率の数（100 = 100%） */
export function itemFindMultipliers(itemFindPercent: number): { rare: number; unique: number } {
  const rare = 1 + itemFindPercent / 100;
  const unique = 1 + (itemFindPercent * 200) / (itemFindPercent + 200) / 100;
  return { rare, unique: itemFindPercent <= 0 ? 1 : unique };
}

/** 合計が100になる重み。通常の重みで調整し、負になるときは通常を0にして残りを比例で縮める */
export function rarityWeights(
  ctx: RarityContext,
): Record<"normal" | "magic" | "rare" | "unique" | "set", number> {
  const bonus = RANK_RARITY_BONUS[ctx.rank] * (1 + (ctx.floorBonus ?? 0));
  const find = itemFindMultipliers((ctx.itemFind ?? 0) * 100);
  let rare = BASE_RARITY_WEIGHTS.rare * bonus * find.rare;
  let unique = BASE_RARITY_WEIGHTS.unique * bonus * find.unique;
  let set = BASE_RARITY_WEIGHTS.set * bonus * find.unique;
  let magic: number = BASE_RARITY_WEIGHTS.magic;
  if (ctx.rareOrBetterGuaranteed === true) {
    // 希少以上を確定する：通常・魔法を除いて、希少以上の比で配分する
    const sum = rare + unique + set;
    return {
      normal: 0,
      magic: 0,
      rare: (rare / sum) * 100,
      unique: (unique / sum) * 100,
      set: (set / sum) * 100,
    };
  }
  let normal = 100 - magic - rare - unique - set;
  if (normal < 0) {
    normal = 0;
    const sum = magic + rare + unique + set;
    magic = (magic / sum) * 100;
    rare = (rare / sum) * 100;
    unique = (unique / sum) * 100;
    set = (set / sum) * 100;
  }
  return { normal, magic, rare, unique, set };
}

const ORDER: readonly ("normal" | "magic" | "rare" | "unique" | "set")[] = [
  "normal",
  "magic",
  "rare",
  "unique",
  "set",
];

export function rollRarity(ctx: RarityContext, ilvl: number, rng: Rng): Rarity {
  const w = rarityWeights(ctx);
  const picked = ORDER[rng.weightedIndex(ORDER.map((k) => w[k]))] as Rarity;
  // 希少に決まった場合、iLv60以上なら2%で星刻にする
  if (picked === "rare" && ilvl >= 60 && rng.chance(0.02)) return "astral";
  return picked;
}
