import type { Attributes } from "../character/progression.ts";
import type { DamageWeapon } from "../combat/damage.ts";
import type { ItemBaseDef } from "../content/item.ts";
import type { ContentDb } from "../content/load.ts";
import type { EquipSlot } from "../content/registries.ts";
import type { EffectInstance } from "../effects/evaluate.ts";
import { type ItemInstance, itemEffectInstances } from "./generate.ts";
import type { Inventory } from "./inventory.ts";

/** MVPで使う装備の部位（遺物を除く10部位。MVP実装単位1章）。 */
export const MVP_EQUIP_SLOTS = [
  "mainHand",
  "offHand",
  "head",
  "body",
  "hands",
  "feet",
  "belt",
  "neck",
  "ring1",
  "ring2",
] as const satisfies readonly EquipSlot[];
export type MvpEquipSlot = (typeof MVP_EQUIP_SLOTS)[number];

/** 要求値を満たさないときの基礎性能の倍率（仕様書v0.2 2.2：基礎性能が-40%）。 */
export const UNMET_REQUIREMENT_MULTIPLIER = 0.6;

/**
 * そのベースを装備できる部位（仕様書v0.2 3.1）。
 * - 武器：主手。片手武器は、二刀流ができるなら副手にも（仕様書v0.2 3.2：戦士・盗賊だけ）
 * - 盾：副手。指輪：2つの指輪の部位のどちらか。その他：分類と同じ名前の部位
 */
export function slotsFor(base: ItemBaseDef, canDualWield: boolean): MvpEquipSlot[] {
  switch (base.category) {
    case "weapon":
      return base.weapon?.hands === 1 && canDualWield ? ["mainHand", "offHand"] : ["mainHand"];
    case "shield":
      return ["offHand"];
    case "ring":
      return ["ring1", "ring2"];
    default:
      return [base.category];
  }
}

/** 要求値を満たしているか（要求値の無いベースは常に満たす）。 */
export function requirementMet(base: ItemBaseDef, attributes: Attributes): boolean {
  const r = base.requirement;
  return r === undefined || attributes[r.attribute] >= r.value;
}

/** 基礎性能の倍率（要求値を満たさなければ0.6。仕様書v0.2 2.2・3.9 の基礎性能の定義）。 */
export function basePerformanceMultiplier(base: ItemBaseDef, attributes: Attributes): number {
  return requirementMet(base, attributes) ? 1 : UNMET_REQUIREMENT_MULTIPLIER;
}

function isTwoHanded(base: ItemBaseDef | undefined): boolean {
  return base?.category === "weapon" && base.weapon?.hands === 2;
}

/**
 * 装備している物（部位 → 装備の実体）。部位の規則：
 * - 両手武器を主手に持つと、副手は空になる
 * - 主手が両手武器のときに副手に装備すると、主手は空になる
 * 外れた物は、呼び出す側に返す（インベントリに戻す）。
 */
export class Equipment {
  private readonly db: ContentDb;
  private readonly slots = new Map<MvpEquipSlot, ItemInstance>();

  constructor(db: ContentDb) {
    this.db = db;
  }

  get(slot: MvpEquipSlot): ItemInstance | undefined {
    return this.slots.get(slot);
  }

  /** 装備している物（部位の順）。 */
  entries(): [MvpEquipSlot, ItemInstance][] {
    return MVP_EQUIP_SLOTS.flatMap((s) => {
      const item = this.slots.get(s);
      return item === undefined ? [] : [[s, item] as [MvpEquipSlot, ItemInstance]];
    });
  }

  private baseOf(item: ItemInstance): ItemBaseDef {
    const base = this.db.itemBases.get(item.base);
    if (base === undefined) throw new RangeError(`ベース ${item.base} が無い`);
    return base;
  }

  /**
   * 装備したときに外れる物（状態は変えない）。部位に装備できない物なら RangeError。
   */
  displaced(item: ItemInstance, slot: MvpEquipSlot, canDualWield: boolean): ItemInstance[] {
    const base = this.baseOf(item);
    if (!slotsFor(base, canDualWield).includes(slot))
      throw new RangeError(`${item.base} は ${slot} に装備できない`);
    if ([...this.slots.values()].some((i) => i.uid === item.uid))
      throw new RangeError(`${item.uid} はすでに装備している`);
    const out: ItemInstance[] = [];
    const current = this.slots.get(slot);
    if (current !== undefined) out.push(current);
    if (slot === "mainHand" && isTwoHanded(base)) {
      const off = this.slots.get("offHand");
      if (off !== undefined) out.push(off);
    }
    if (slot === "offHand") {
      const main = this.slots.get("mainHand");
      if (main !== undefined && isTwoHanded(this.baseOf(main))) out.push(main);
    }
    return out;
  }

  /** 装備する。外れた物を返す（{@link displaced} と同じ）。 */
  equip(item: ItemInstance, slot: MvpEquipSlot, canDualWield: boolean): ItemInstance[] {
    const out = this.displaced(item, slot, canDualWield);
    for (const [s, i] of this.slots) if (out.includes(i)) this.slots.delete(s);
    this.slots.set(slot, item);
    return out;
  }

  /** 外す。外した物を返す。 */
  unequip(slot: MvpEquipSlot): ItemInstance | undefined {
    const item = this.slots.get(slot);
    this.slots.delete(slot);
    return item;
  }

  /** 装備の効果（基本刻印と詞）。効果の評価に渡す。 */
  effects(): EffectInstance[] {
    return this.entries().flatMap(([, item]) => itemEffectInstances(this.db, item));
  }

  /** 部位ごとの装備のタグ（条件「主手に剣系」などの判定に使う）。 */
  equippedTags(): Partial<Record<EquipSlot, readonly string[]>> {
    const out: Partial<Record<EquipSlot, readonly string[]>> = {};
    for (const [slot, item] of this.entries()) out[slot] = this.baseOf(item).tags;
    return out;
  }

  /**
   * 主手の武器（ダメージの計算に渡す形）と攻撃速度（回/秒。武器の基礎の値）。主手が空なら undefined。
   * 要求値を満たさなければ、基礎ダメージ（基礎性能）だけ -40%。会心率・攻撃速度は変わらない（仕様書v0.2 3.9）。
   */
  mainWeapon(
    attributes: Attributes,
  ): { readonly weapon: DamageWeapon; readonly attackSpeed: number } | undefined {
    const item = this.slots.get("mainHand");
    if (item === undefined) return undefined;
    const base = this.baseOf(item);
    const w = base.weapon;
    if (w === undefined) return undefined;
    const m = basePerformanceMultiplier(base, attributes);
    return {
      weapon: {
        uid: item.uid,
        tags: base.tags,
        base: { physical: { min: w.damage.physical.min * m, max: w.damage.physical.max * m } },
        critChance: w.critChance,
      },
      attackSpeed: w.attackSpeed,
    };
  }
}

/**
 * インベントリの装備を装備する（外れた物はインベントリに戻す）。
 * 外れた物がインベントリに入りきらないときは、何も変えずに false（両手武器で主手と副手が外れる場合など）。
 */
export function equipFromInventory(
  inventory: Inventory,
  equipment: Equipment,
  uid: string,
  slot: MvpEquipSlot,
  canDualWield: boolean,
): boolean {
  const item = inventory.items.find((i) => i.uid === uid);
  if (item === undefined) throw new RangeError(`インベントリに ${uid} が無い`);
  const out = equipment.displaced(item, slot, canDualWield);
  // 装備する物が1枠空け、外れた物が枠を使う
  if (inventory.items.length - 1 + out.length > inventory.capacity) return false;
  inventory.removeItem(uid);
  equipment.equip(item, slot, canDualWield);
  for (const i of out) inventory.addItem(i);
  return true;
}

/** 装備を外して、インベントリに戻す。インベントリがいっぱいなら、何も変えずに false。 */
export function unequipToInventory(
  inventory: Inventory,
  equipment: Equipment,
  slot: MvpEquipSlot,
): boolean {
  if (equipment.get(slot) === undefined) return true;
  if (inventory.full) return false;
  const item = equipment.unequip(slot);
  if (item !== undefined) inventory.addItem(item);
  return true;
}
