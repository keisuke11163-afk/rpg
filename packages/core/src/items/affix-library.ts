/**
 * 詞片の書庫（仕様書v0.2 3.10・3.11.2。MVPの後の機能。docs/progress A-5）。
 * - 抽詞の針：装備を壊して、選んだ詞を1つ「詞片」として取り出す（tierは1段階下がる）。負荷は無い
 * - 書庫：同じ詞片（詞と tier が同じ）は20個まで
 * - 刻詞の筆：詞片の詞を、空いている枠に付ける（負荷+25。1つの装備に筆で付けられる詞は2つまで）
 */
import type { AffixTier } from "../content/item.ts";
import { AFFIX_SLOTS } from "../content/item.ts";
import type { ContentDb } from "../content/load.ts";
import type { Rng } from "../random/rng.ts";
import { CRAFT_MATERIALS, type CraftResult, MAX_FORGE_LOAD, applyInstability } from "./crafting.ts";
import { type ItemInstance, rollAffixValue } from "./generate.ts";
import type { Inventory } from "./inventory.ts";
import { affixTierValues } from "./tiers.ts";

/** 同じ詞片を書庫に貯められる数（仕様書v0.2 3.11.2）。 */
export const LIBRARY_STACK = 20;
/** 刻詞の筆の負荷（仕様書v0.2 3.10）。 */
export const BRUSH_LOAD = 25;
/** 1つの装備に刻詞の筆で付けられる詞の数（仕様書v0.2 3.11.2）。 */
export const BRUSH_LIMIT = 2;

/** 詞片（詞と tier）。 */
export interface AffixShard {
  readonly affix: string;
  readonly tier: AffixTier;
}

const keyOf = (s: AffixShard): string => `${s.affix}@T${String(s.tier)}`;

/** 鍵（`詞のID@T数`）を詞片に戻す。形が正しくなければ undefined。 */
export function shardOfKey(key: string): AffixShard | undefined {
  const m = /^(.+)@T([0-7])$/.exec(key);
  if (m === null || m[1] === undefined || m[2] === undefined) return undefined;
  return { affix: m[1], tier: Number(m[2]) as AffixTier };
}

/** 詞片の書庫。 */
export class AffixLibrary {
  private readonly counts = new Map<string, number>();

  /** セーブデータの形（鍵 → 数）から作る。数・鍵が正しくなければ RangeError。 */
  static fromRecord(db: ContentDb, record: Readonly<Record<string, number>>): AffixLibrary {
    const lib = new AffixLibrary();
    for (const [key, n] of Object.entries(record)) {
      const shard = shardOfKey(key);
      if (shard === undefined) throw new RangeError(`詞片の鍵 ${key} が正しくない`);
      const def = db.affixes.get(shard.affix);
      if (def === undefined) throw new RangeError(`詞片の詞 ${shard.affix} がデータに無い`);
      if (!affixTierValues(def).has(shard.tier))
        throw new RangeError(`詞片の詞 ${shard.affix} に T${String(shard.tier)} が無い`);
      if (!(Number.isInteger(n) && n >= 1 && n <= LIBRARY_STACK))
        throw new RangeError(`詞片 ${key} の数は1〜${String(LIBRARY_STACK)}（${String(n)}）`);
      lib.counts.set(key, n);
    }
    return lib;
  }

  count(shard: AffixShard): number {
    return this.counts.get(keyOf(shard)) ?? 0;
  }
  /** 貯められるか（同じ詞片が20個未満）。 */
  canAdd(shard: AffixShard): boolean {
    return this.count(shard) < LIBRARY_STACK;
  }
  /** 1つ足す。いっぱいなら何も変えずに false。 */
  add(shard: AffixShard): boolean {
    if (!this.canAdd(shard)) return false;
    this.counts.set(keyOf(shard), this.count(shard) + 1);
    return true;
  }
  /** 1つ使う。無ければ何も変えずに false。 */
  take(shard: AffixShard): boolean {
    const n = this.count(shard);
    if (n === 0) return false;
    if (n === 1) this.counts.delete(keyOf(shard));
    else this.counts.set(keyOf(shard), n - 1);
    return true;
  }
  /** 中身（詞片と数）。鍵の順。 */
  entries(): { shard: AffixShard; count: number }[] {
    return [...this.counts.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .flatMap(([key, count]) => {
        const shard = shardOfKey(key);
        return shard === undefined ? [] : [{ shard, count }];
      });
  }
  /** セーブデータの形。 */
  toRecord(): Record<string, number> {
    return Object.fromEntries(this.entries().map((e) => [keyOf(e.shard), e.count]));
  }
}

export type ExtractBlock =
  | "unique" // ユニーク・セットは取り出せない（詞を持たない扱い）
  | "noAffix" // 選んだ詞がその装備に無い
  | "full" // 書庫のその詞片がいっぱい
  | "material"; // 抽詞の針が無い

/**
 * 取り出したときの詞片：tier は1段階下がる（数字が1つ大きい）。その詞に1段階下の tier が無ければ、
 * 今の tier のまま（docs/progress D-LIB-2）。
 */
export function extractedShard(
  db: ContentDb,
  item: ItemInstance,
  affixId: string,
): AffixShard | undefined {
  const a = item.affixes.find((x) => x.id === affixId);
  const def = db.affixes.get(affixId);
  if (a === undefined || def === undefined) return undefined;
  const lower = (a.tier + 1) as AffixTier;
  return { affix: affixId, tier: a.tier < 7 && affixTierValues(def).has(lower) ? lower : a.tier };
}

/**
 * 抽詞の針：インベントリの装備を壊し、選んだ詞を詞片として書庫に入れる（針を1つ使う）。
 * できなければ、何も変えずに理由を返す。できたら詞片を返す（装備はなくなる）。
 */
export function extractFromInventory(
  db: ContentDb,
  inv: Inventory,
  library: AffixLibrary,
  uid: string,
  affixId: string,
): AffixShard | ExtractBlock {
  const item = inv.items.find((i) => i.uid === uid);
  if (item === undefined) throw new RangeError(`インベントリに ${uid} が無い`);
  if (item.rarity === "unique" || item.rarity === "set") return "unique";
  const shard = extractedShard(db, item, affixId);
  if (shard === undefined) return "noAffix";
  if (!library.canAdd(shard)) return "full";
  if (inv.material(CRAFT_MATERIALS.affixNeedle) < 1) return "material";
  inv.spendMaterial(CRAFT_MATERIALS.affixNeedle, 1);
  inv.removeItem(uid);
  library.add(shard);
  return shard;
}

export type BrushBlock =
  | "unique" // ユニーク・セットには付けられない
  | "settled" // 負荷が100を超える
  | "brushLimit" // 筆で付けた詞がもう2つある
  | "noSlot" // 空いている枠が無い（レアリティの数・前詞と後詞の枠）
  | "category" // その部位に付かない詞
  | "duplicate" // 同じ詞がもう付いている
  | "noShard" // 書庫に無い
  | "material"; // 刻詞の筆が無い

/** 刻詞の筆で付けられない理由（素材・書庫を除く。付けられるなら undefined）。 */
export function brushBlock(
  db: ContentDb,
  item: ItemInstance,
  shard: AffixShard,
): Exclude<BrushBlock, "noShard" | "material"> | undefined {
  if (item.rarity === "unique" || item.rarity === "set") return "unique";
  if ((item.forgeLoad ?? 0) + BRUSH_LOAD > MAX_FORGE_LOAD) return "settled";
  if ((item.brushed ?? 0) >= BRUSH_LIMIT) return "brushLimit";
  const base = db.itemBases.get(item.base);
  const def = db.affixes.get(shard.affix);
  if (base === undefined || def === undefined) return "category";
  if (!def.categories.includes(base.category)) return "category";
  if (item.affixes.some((a) => a.id === shard.affix)) return "duplicate";
  // 空いている枠：レアリティの詞の数の上限と、前詞・後詞の枠（共鳴紋の確定は枠-1）
  const rarityMax = db.rarities.get(item.rarity)?.affixes.max ?? 0;
  const slots = AFFIX_SLOTS[base.category];
  const capacity = slots.prefix + slots.suffix - (base.guaranteedResonance === true ? 1 : 0);
  const used = item.affixes.filter((a) => db.affixes.get(a.id)?.position === def.position).length;
  if (item.affixes.length >= Math.min(rarityMax, capacity) || used >= slots[def.position])
    return "noSlot";
  return undefined;
}

/**
 * 刻詞の筆：書庫の詞片を、インベントリの装備の空いている枠に付ける（値は詞片の tier の範囲で抽選。
 * docs/progress D-LIB-1）。負荷+25、筆で付けた数+1。操作の前の負荷が60以上なら、亀裂・霊感が起きうる。
 * 封詞は、ほかの操作と同じく外れる。できなければ、何も変えずに理由を返す。
 */
export function brushFromLibrary(
  db: ContentDb,
  rng: Rng,
  inv: Inventory,
  library: AffixLibrary,
  uid: string,
  shard: AffixShard,
): CraftResult | BrushBlock {
  const item = inv.items.find((i) => i.uid === uid);
  if (item === undefined) throw new RangeError(`インベントリに ${uid} が無い`);
  const block = brushBlock(db, item, shard);
  if (block !== undefined) return block;
  if (library.count(shard) < 1) return "noShard";
  if (inv.material(CRAFT_MATERIALS.affixBrush) < 1) return "material";
  const def = db.affixes.get(shard.affix);
  if (def === undefined) return "category";
  const loadBefore = item.forgeLoad ?? 0;
  const out: { -readonly [K in keyof ItemInstance]: ItemInstance[K] } = {
    ...item,
    forgeLoad: loadBefore + BRUSH_LOAD,
    brushed: (item.brushed ?? 0) + 1,
    affixes: [
      ...item.affixes,
      { id: shard.affix, tier: shard.tier, rolls: rollAffixValue(rng, def, shard.tier) },
    ],
  };
  delete out.sealed;
  const r = applyInstability(db, rng, loadBefore, out);
  inv.spendMaterial(CRAFT_MATERIALS.affixBrush, 1);
  library.take(shard);
  inv.replaceItem(r.item);
  return r;
}
