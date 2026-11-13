import {
  type DropResult,
  type Inventory,
  type ItemInstance,
  type Rng,
  type Vec2,
  length,
} from "@stella/core";

/** 金貨・素材を自動で拾う距離（m。補助仕様書13章：半径1.5m以内）。 */
export const AUTO_PICKUP_RADIUS = 1.5;
/** 装備を F で拾える距離（m。仮値：自動で拾う距離と同じ。docs/progress D-U11-12）。 */
export const ITEM_PICKUP_RADIUS = 1.5;
/** 落とした物を散らばらせる距離（m。表示用）。 */
const SCATTER = 1.2;

/** 地面に落ちている物。 */
export type GroundLoot =
  | {
      readonly id: number;
      readonly position: Vec2;
      readonly kind: "item";
      readonly item: ItemInstance;
    }
  | { readonly id: number; readonly position: Vec2; readonly kind: "gold"; readonly amount: number }
  | {
      readonly id: number;
      readonly position: Vec2;
      readonly kind: "material";
      readonly material: string;
      readonly count: number;
    };

/** 拾った結果（表示用）。 */
export type PickupResult =
  | { readonly kind: "picked"; readonly loot: GroundLoot }
  | { readonly kind: "full"; readonly loot: GroundLoot }
  | { readonly kind: "none" };

/**
 * 試験用の場の地面の物（Phaser に依存しない。表示は LootView）。
 * 金貨・素材は近づくと自動で拾い、装備は F で拾う（補助仕様書13章）。
 */
export class LootField {
  private readonly rng: Rng;
  private list: GroundLoot[] = [];
  private serial = 0;

  constructor(rng: Rng) {
    this.rng = rng;
  }

  get drops(): readonly GroundLoot[] {
    return this.list;
  }

  /** ドロップを、at の周りに散らばらせて置く。 */
  place(result: DropResult, at: Vec2): void {
    const spot = (): Vec2 => {
      const a = this.rng.float(0, 2 * Math.PI);
      const r = this.rng.float(0, SCATTER);
      return { x: at.x + Math.cos(a) * r, y: at.y + Math.sin(a) * r };
    };
    for (const item of result.items)
      this.list.push({ id: ++this.serial, position: spot(), kind: "item", item });
    if (result.gold > 0)
      this.list.push({ id: ++this.serial, position: spot(), kind: "gold", amount: result.gold });
    for (const m of result.materials)
      this.list.push({
        id: ++this.serial,
        position: spot(),
        kind: "material",
        material: m.material,
        count: m.count,
      });
  }

  /**
   * 金貨・素材のうち、半径1.5m以内のものを全て拾う。拾ったものを返す。
   * 拾う物を全て決めてから、持ち物にまとめて足す（Inventory.addAll）。金貨・素材ごとの合計が
   * 安全な整数に収まらないなど1つでも不正なら、持ち物も地面も何も変えずに RangeError。
   */
  autoPickup(position: Vec2, inventory: Inventory): GroundLoot[] {
    const picked: GroundLoot[] = [];
    const left: GroundLoot[] = [];
    const gold: number[] = [];
    const materials: { material: string; count: number }[] = [];
    for (const d of this.list) {
      if (d.kind !== "item" && distance(position, d.position) <= AUTO_PICKUP_RADIUS) {
        if (d.kind === "gold") gold.push(d.amount);
        else materials.push({ material: d.material, count: d.count });
        picked.push(d);
      } else left.push(d);
    }
    if (picked.length === 0) return picked;
    inventory.addAll(gold, materials);
    this.list = left;
    return picked;
  }

  /**
   * 拾える距離の装備のうち、最も近いものを拾う。インベントリがいっぱいなら拾わない
   * （地面に残る。補助仕様書13章）。
   */
  pickNearestItem(position: Vec2, inventory: Inventory): PickupResult {
    let best: GroundLoot | undefined;
    let bestD = Infinity;
    for (const d of this.list) {
      if (d.kind !== "item") continue;
      const dist = distance(position, d.position);
      if (dist <= ITEM_PICKUP_RADIUS && dist < bestD) {
        best = d;
        bestD = dist;
      }
    }
    if (best === undefined || best.kind !== "item") return { kind: "none" };
    if (!inventory.addItem(best.item)) return { kind: "full", loot: best };
    const picked = best;
    this.list = this.list.filter((d) => d !== picked);
    return { kind: "picked", loot: picked };
  }
}

function distance(a: Vec2, b: Vec2): number {
  return length({ x: a.x - b.x, y: a.y - b.y });
}
