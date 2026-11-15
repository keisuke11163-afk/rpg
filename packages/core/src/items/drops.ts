/**
 * ドロップの抽選の手順（本仕様書 3.5、補助仕様書 5・12章）。
 * 敵の格ごとのドロップ数、iLv、金貨、素材。
 */
import type { Rng } from "../rng.ts";
import type { EnemyRank } from "../enemy/def.ts";
import { generateItem, type GenerateContext, type GenerationData } from "./generate.ts";
import type { ItemInstance } from "./types.ts";

export type DropSource = EnemyRank | "midBoss" | "chapterBoss" | "crate" | "chest";

/** 素材のID（補助仕様書 12.2）。魔塵・星砂・輝石は分解で得る */
export const MATERIAL = {
  awakeningDust: "MAT-AWAKENING-DUST",
  eyeOpeningCrystal: "MAT-EYE-OPENING-CRYSTAL",
  turnStone: "MAT-TURN-STONE",
  carvingBlade: "MAT-CARVING-BLADE",
  tuningFork: "MAT-TUNING-FORK",
  sealWax: "MAT-SEAL-WAX",
  returnLamp: "MAT-RETURN-LAMP",
  beastFang: "MAT-BEAST-FANG",
} as const;

/** 素材の入手率（補助仕様書 12.2）。数値は確率、"1" は確定1個 */
const MATERIAL_TABLE: Readonly<Record<string, Partial<Record<DropSource, number>>>> = {
  [MATERIAL.awakeningDust]: {
    normal: 0.01,
    magic: 0.05,
    elite: 0.2,
    midBoss: 1,
    crate: 0.05,
    chest: 0.2,
  },
  [MATERIAL.eyeOpeningCrystal]: { elite: 0.1, midBoss: 0.5, chest: 0.1 },
  [MATERIAL.turnStone]: { elite: 0.05, chest: 0.1 },
  [MATERIAL.carvingBlade]: { elite: 0.05, chest: 0.05 },
  [MATERIAL.tuningFork]: { midBoss: 0.3 },
  [MATERIAL.sealWax]: { midBoss: 0.2 },
  [MATERIAL.returnLamp]: { normal: 0.002, magic: 0.01, elite: 0.1, midBoss: 1, chest: 0.05 },
};

export interface DropContext {
  source: DropSource;
  enemyLevel: number;
  /** 敵の系統（タグID）。獣系は獣牙を3%で落とす */
  family?: string;
  generate: Omit<GenerateContext, "ilvl" | "uid" | "rarityContext" | "rarity">;
  uid: () => string;
  itemFind?: number;
  floorBonus?: number;
}

export interface DropResult {
  items: ItemInstance[];
  gold: number;
  materials: Record<string, number>;
}

/** iLvは敵のLv（精鋭は+2、ボスは+4） */
export function dropItemLevel(source: DropSource, enemyLevel: number): number {
  if (source === "elite") return enemyLevel + 2;
  if (source === "midBoss" || source === "chapterBoss") return enemyLevel + 4;
  return enemyLevel;
}

/** ドロップするアイテムの数（本仕様書 3.5） */
export function rollItemCount(source: DropSource, rng: Rng): number {
  switch (source) {
    case "normal":
      return rng.chance(0.1) ? 1 : 0;
    case "magic":
      return rng.chance(0.6) ? rng.int(1, 2) : 0;
    case "elite":
      return rng.int(2, 4);
    case "midBoss":
      return rng.int(4, 6);
    case "chapterBoss":
      return rng.int(6, 10);
    case "crate":
      return rng.chance(0.3) ? 1 : 0;
    case "chest":
      return rng.int(1, 2);
  }
}

/** 金貨（補助仕様書 5章）：通常は25%で（1＋Lv）×（1〜2）。魔法は60%で2倍、精鋭は必ず5倍 */
export function rollGold(source: DropSource, level: number, rng: Rng): number {
  const unit = (): number => (1 + level) * rng.int(1, 2);
  switch (source) {
    case "normal":
      return rng.chance(0.25) ? unit() : 0;
    case "magic":
      return rng.chance(0.6) ? unit() * 2 : 0;
    case "elite":
      return unit() * 5;
    case "crate":
      return rng.chance(0.3) ? unit() * 3 : 0;
    case "chest":
      return unit() * 8;
    case "midBoss":
    case "chapterBoss":
      return unit() * 10;
  }
}

export function rollMaterials(
  source: DropSource,
  family: string | undefined,
  rng: Rng,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, table] of Object.entries(MATERIAL_TABLE)) {
    const p = table[source];
    if (p === undefined) continue;
    if (p >= 1 || rng.chance(p)) out[id] = (out[id] ?? 0) + 1;
  }
  if (
    family === "TAG-ENEMY-BEAST" &&
    (source === "normal" || source === "magic" || source === "elite")
  ) {
    if (rng.chance(0.03)) out[MATERIAL.beastFang] = 1;
  }
  return out;
}

/** 敵を倒したときのドロップ全体 */
export function rollDrops(data: GenerationData, ctx: DropContext, rng: Rng): DropResult {
  const count = rollItemCount(ctx.source, rng);
  const ilvl = dropItemLevel(ctx.source, ctx.enemyLevel);
  const rank: EnemyRank =
    ctx.source === "magic" ? "magic" : ctx.source === "elite" ? "elite" : "normal";
  const items: ItemInstance[] = [];
  for (let i = 0; i < count; i++) {
    // 中ボスは、希少以上が1個確定
    const guaranteed = ctx.source === "midBoss" && i === 0;
    items.push(
      generateItem(
        data,
        {
          ...ctx.generate,
          ilvl,
          uid: ctx.uid,
          ...(ctx.family ? { enemyFamily: ctx.family } : {}),
          rarityContext: {
            rank,
            ...(ctx.floorBonus !== undefined ? { floorBonus: ctx.floorBonus } : {}),
            ...(ctx.itemFind !== undefined ? { itemFind: ctx.itemFind } : {}),
            ...(guaranteed ? { rareOrBetterGuaranteed: true } : {}),
          },
        },
        rng,
      ),
    );
  }
  return {
    items,
    gold: rollGold(ctx.source, ctx.enemyLevel, rng),
    materials: rollMaterials(ctx.source, ctx.family, rng),
  };
}
