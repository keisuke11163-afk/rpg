import type { ItemRarity } from "../content/item.ts";
import type { ContentDb } from "../content/load.ts";
import type { Rng } from "../random/rng.ts";
import type { ItemInstance } from "./generate.ts";
import { droppableBases } from "./drops.ts";
import { Inventory } from "./inventory.ts";

/** 倉庫の枠の数（補助仕様書13章：120枠。町だけで使える）。 */
export const STASH_SLOTS = 120;

/** 倉庫（装備だけを入れる。金貨・素材は持ち物のまま）。 */
export function createStash(): Inventory {
  return new Inventory(STASH_SLOTS);
}

/**
 * 装備を、ある入れ物から別の入れ物へ移す（インベントリ ⇔ 倉庫）。
 * 移す先がいっぱいなら、何も変えずに false。移す元に無ければ RangeError。
 */
export function transferItem(from: Inventory, to: Inventory, uid: string): boolean {
  if (!from.items.some((i) => i.uid === uid)) throw new RangeError(`${uid} が無い`);
  if (to.full) return false;
  const item = from.removeItem(uid);
  if (item === undefined) return false;
  to.addItem(item);
  return true;
}

/**
 * 売却の倍率（補助仕様書5章：通常×1・魔法×3・希少×8・ユニーク×15）。
 * 仮値: 星座（セット）の売却の値は記載が無いため、ユニークと同じにした（docs/progress Q-U12-1）。
 */
export const SELL_MULTIPLIER: Readonly<Record<ItemRarity, number>> = {
  normal: 1,
  magic: 3,
  rare: 8,
  unique: 15,
  set: 15,
};

/** 売値（補助仕様書5章：（1 ＋ ⌊iLv÷2⌋）× レアリティの倍率）。 */
export function sellPrice(item: ItemInstance): number {
  return (1 + Math.floor(item.itemLevel / 2)) * SELL_MULTIPLIER[item.rarity];
}

/** 商人の通常のベースの価格（補助仕様書5章：10 ＋ 4 × iLv）。 */
export function basePrice(itemLevel: number): number {
  return 10 + 4 * itemLevel;
}

/** 商人の目覚めの粉の価格（補助仕様書5章）。 */
export const AWAKENING_DUST_PRICE = 30;
export const AWAKENING_DUST = "MAT-AWAKENING-DUST";

/**
 * 商人の品揃えの数。仮値: 補助仕様書5章に数の記載が無いため（docs/progress Q-U12-2）。
 */
export const MERCHANT_STOCK_SIZE = 8;

export interface StockInput {
  /** 品揃えのアイテムLv。仮値: 記載が無いため、キャラLvにする（docs/progress Q-U12-2）。 */
  readonly itemLevel: number;
  readonly nextUid: () => string;
}

/**
 * 商人の品揃え（町に戻るたびに入れ替える。補助仕様書5章）：通常のベースを、必要LvがアイテムLv以下の通常のベースから
 * 等しい確率で選ぶ（ドロップのベースの選び方 D-U11-8 と同じ）。
 */
export function rollMerchantStock(db: ContentDb, rng: Rng, input: StockInput): ItemInstance[] {
  if (!(Number.isInteger(input.itemLevel) && input.itemLevel >= 1))
    throw new RangeError(`アイテムLvは1以上の整数（${String(input.itemLevel)}）`);
  // ユニークの専用のベース・遺物は並べない（通常の抽選と同じ。docs/progress A-4）
  const bases = droppableBases(db, input.itemLevel);
  const out: ItemInstance[] = [];
  if (bases.length === 0) return out;
  for (let i = 0; i < MERCHANT_STOCK_SIZE; i++) {
    const base = bases[Math.min(bases.length - 1, Math.floor(rng.next() * bases.length))];
    if (base === undefined) continue;
    out.push({
      uid: input.nextUid(),
      base: base.id,
      rarity: "normal",
      itemLevel: input.itemLevel,
      affixes: [],
    });
  }
  return out;
}

/** 売る：インベントリから出し、金貨を足す。無ければ RangeError。 */
export function sellItem(inventory: Inventory, uid: string): number {
  const item = inventory.items.find((i) => i.uid === uid);
  if (item === undefined) throw new RangeError(`${uid} が無い`);
  const price = sellPrice(item);
  // 金貨の合計の検証（溢れ）を先に行い、失敗したら装備を出さない
  inventory.addGold(price);
  inventory.removeItem(uid);
  return price;
}

/**
 * 買う：金貨が足りて、インベントリに空きがあれば、品揃えから出してインベントリに入れる。
 * 足りなければ何も変えずに false。
 */
export function buyItem(inventory: Inventory, stock: ItemInstance[], uid: string): boolean {
  const i = stock.findIndex((s) => s.uid === uid);
  const item = stock[i];
  if (item === undefined) throw new RangeError(`品揃えに ${uid} が無い`);
  const price = basePrice(item.itemLevel);
  if (inventory.gold < price || inventory.full) return false;
  inventory.spendGold(price);
  inventory.addItem(item);
  stock.splice(i, 1);
  return true;
}

/**
 * 目覚めの粉を買う（数は1以上の整数）。金貨が足りなければ何も変えずに false。
 * 値段や持っている粉の合計が安全な整数に収まらなければ、金貨を払う前に（何も変えずに）RangeError。
 */
export function buyAwakeningDust(inventory: Inventory, count = 1): boolean {
  if (!(Number.isSafeInteger(count) && count >= 1))
    throw new RangeError(`数は1以上の整数（${String(count)}）`);
  const price = AWAKENING_DUST_PRICE * count;
  if (!Number.isSafeInteger(price))
    throw new RangeError(`値段が安全な整数に収まらない（${String(count)}個）`);
  if (inventory.gold < price) return false;
  // 素材を足せるか（合計が安全な整数に収まるか）を、金貨を払う前に確かめる
  if (!Number.isSafeInteger(inventory.material(AWAKENING_DUST) + count))
    throw new RangeError(`素材 ${AWAKENING_DUST} の合計が安全な整数の範囲を超える`);
  inventory.spendGold(price);
  inventory.addMaterial(AWAKENING_DUST, count);
  return true;
}
