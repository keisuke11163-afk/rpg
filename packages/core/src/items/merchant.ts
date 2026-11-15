/**
 * 商人（補助仕様書 5・16章）。通常のベースを売り、目覚めの粉を売り、装備を買い取る。
 */
import type { Rng } from "../rng.ts";
import { generateItem, type GenerateContext, type GenerationData } from "./generate.ts";
import { MATERIAL } from "./drops.ts";
import { sellPrice } from "./loot.ts";
import type { ItemBag, Purse } from "./loot.ts";
import type { ItemInstance } from "./types.ts";

export const STOCK_SIZE = 8;
export const AWAKENING_DUST_PRICE = 30;

/** 商人：通常のベースの価格 ＝ 10 ＋ 4 × iLv */
export function buyPrice(item: ItemInstance): number {
  return 10 + 4 * item.ilvl;
}

export class Merchant {
  stock: ItemInstance[] = [];

  /** 品揃えは、町に戻るたびに入れ替わる（通常のレアリティの装備） */
  restock(
    data: GenerationData,
    ilvl: number,
    uid: () => string,
    rng: Rng,
    ctx: Partial<GenerateContext> = {},
  ): void {
    this.stock = Array.from({ length: STOCK_SIZE }, () =>
      generateItem(data, { ...ctx, ilvl, rarity: "normal", uid }, rng),
    );
  }

  buy(uid: string, bag: ItemBag, purse: Purse): { ok: boolean; reason?: "gold" | "full" | "none" } {
    const i = this.stock.findIndex((s) => s.uid === uid);
    const item = this.stock[i];
    if (!item) return { ok: false, reason: "none" };
    if (bag.full) return { ok: false, reason: "full" };
    if (!purse.spendGold(buyPrice(item))) return { ok: false, reason: "gold" };
    bag.add(item);
    this.stock.splice(i, 1);
    return { ok: true };
  }

  /** 目覚めの粉（30G）。他の素材は売らない */
  buyAwakeningDust(purse: Purse, count = 1): boolean {
    if (!purse.spendGold(AWAKENING_DUST_PRICE * count)) return false;
    purse.addMaterial(MATERIAL.awakeningDust, count);
    return true;
  }

  /** 装備を売る */
  sell(uid: string, bag: ItemBag, purse: Purse): { ok: boolean; gold: number } {
    const item = bag.remove(uid);
    if (!item) return { ok: false, gold: 0 };
    const gold = sellPrice(item);
    purse.gold += gold;
    return { ok: true, gold };
  }
}
