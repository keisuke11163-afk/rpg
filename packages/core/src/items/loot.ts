/**
 * 地面に落ちたアイテムと、インベントリ・倉庫・素材袋（補助仕様書 13章）。
 */
import type { Vec2 } from "../player/controller.ts";
import type { DropResult } from "./drops.ts";
import type { ItemInstance } from "./types.ts";

export const INVENTORY_SLOTS = 60;
export const STASH_SLOTS = 120;
/** 金貨・素材は、半径1.5m以内に入ると自動で拾う */
export const AUTO_PICKUP_RADIUS = 1.5;
/** 装備を拾うときの距離（クリックかFで拾う） */
export const ITEM_PICKUP_RADIUS = 2;

/** インベントリ（枠の数が決まっている。装備は1つで1枠） */
export class ItemBag {
  readonly capacity: number;
  private readonly slots: (ItemInstance | undefined)[];

  constructor(capacity = INVENTORY_SLOTS) {
    this.capacity = capacity;
    this.slots = new Array<ItemInstance | undefined>(capacity).fill(undefined);
  }

  get count(): number {
    return this.slots.filter((s) => s !== undefined).length;
  }

  get full(): boolean {
    return this.count >= this.capacity;
  }

  /** 空いている最初の枠に入れる。いっぱいなら入れず false */
  add(item: ItemInstance): boolean {
    const i = this.slots.indexOf(undefined);
    if (i < 0) return false;
    this.slots[i] = item;
    return true;
  }

  remove(uid: string): ItemInstance | undefined {
    const i = this.slots.findIndex((s) => s?.uid === uid);
    if (i < 0) return undefined;
    const item = this.slots[i];
    this.slots[i] = undefined;
    return item;
  }

  get(uid: string): ItemInstance | undefined {
    return this.slots.find((s) => s?.uid === uid);
  }

  items(): ItemInstance[] {
    return this.slots.filter((s): s is ItemInstance => s !== undefined);
  }
}

/** 金貨と素材袋（枠を使わず、数の上限はない） */
export class Purse {
  gold = 0;
  readonly materials = new Map<string, number>();

  addMaterial(id: string, n = 1): void {
    this.materials.set(id, (this.materials.get(id) ?? 0) + n);
  }

  material(id: string): number {
    return this.materials.get(id) ?? 0;
  }

  /** 素材を使う。足りなければ何も減らさず false */
  spendMaterial(id: string, n = 1): boolean {
    if (this.material(id) < n) return false;
    this.materials.set(id, this.material(id) - n);
    return true;
  }

  spendGold(n: number): boolean {
    if (this.gold < n) return false;
    this.gold -= n;
    return true;
  }
}

export type GroundEntry =
  | { kind: "item"; pos: Vec2; item: ItemInstance }
  | { kind: "gold"; pos: Vec2; amount: number }
  | { kind: "material"; pos: Vec2; id: string; amount: number };

/** 地面のドロップ */
export class GroundLoot {
  readonly entries: GroundEntry[] = [];

  /** 敵などの位置にドロップを出す。少しずつ散らす */
  spawn(pos: Vec2, drop: DropResult): void {
    const all: GroundEntry[] = [];
    for (const item of drop.items) all.push({ kind: "item", pos: { ...pos }, item });
    if (drop.gold > 0) all.push({ kind: "gold", pos: { ...pos }, amount: drop.gold });
    for (const [id, amount] of Object.entries(drop.materials)) {
      all.push({ kind: "material", pos: { ...pos }, id, amount });
    }
    all.forEach((e, i) => {
      const a = (i / Math.max(1, all.length)) * Math.PI * 2;
      const r = all.length > 1 ? 0.6 : 0;
      e.pos.x += Math.cos(a) * r;
      e.pos.y += Math.sin(a) * r;
      this.entries.push(e);
    });
  }

  /** 金貨・素材を自動で拾う。拾った内容を返す */
  autoPickup(player: Vec2, purse: Purse): GroundEntry[] {
    const picked: GroundEntry[] = [];
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i] as GroundEntry;
      if (e.kind === "item") continue;
      if (Math.hypot(e.pos.x - player.x, e.pos.y - player.y) > AUTO_PICKUP_RADIUS) continue;
      if (e.kind === "gold") purse.gold += e.amount;
      else purse.addMaterial(e.id, e.amount);
      picked.push(e);
      this.entries.splice(i, 1);
    }
    return picked;
  }

  /** 最も近い装備を拾う（F）。インベントリがいっぱいなら拾えない */
  pickupNearestItem(
    player: Vec2,
    bag: ItemBag,
  ): { ok: boolean; item?: ItemInstance; reason?: "full" | "none" } {
    let best = -1;
    let bestDist = ITEM_PICKUP_RADIUS;
    this.entries.forEach((e, i) => {
      if (e.kind !== "item") return;
      const d = Math.hypot(e.pos.x - player.x, e.pos.y - player.y);
      if (d <= bestDist) {
        bestDist = d;
        best = i;
      }
    });
    if (best < 0) return { ok: false, reason: "none" };
    const entry = this.entries[best] as GroundEntry & { kind: "item" };
    if (!bag.add(entry.item)) return { ok: false, reason: "full" };
    this.entries.splice(best, 1);
    return { ok: true, item: entry.item };
  }
}

/** 商人への売却額（補助仕様書 5章）：通常 ＝ 1 ＋ ⌊iLv÷2⌋。魔法×3、希少×8、ユニーク×15 */
export function sellPrice(item: ItemInstance): number {
  const base = 1 + Math.floor(item.ilvl / 2);
  switch (item.rarity) {
    case "normal":
      return base;
    case "magic":
      return base * 3;
    case "rare":
    case "astral":
      return base * 8;
    case "unique":
    case "set":
      return base * 15;
  }
}
