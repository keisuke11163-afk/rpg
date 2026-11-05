import type { ItemInstance } from "./generate.ts";

/** インベントリの枠の数（補助仕様書13章：60枠。装備は1つで1枠）。 */
export const INVENTORY_SLOTS = 60;

/**
 * 持ち物（補助仕様書13章）：装備のインベントリ（枠の数まで）、金貨、素材袋（枠を使わず、数の上限なし）。
 * 不正な数（負・小数・NaN・Infinity・安全な整数を超える合計）は、状態を変えずに RangeError。
 */
export class Inventory {
  readonly capacity: number;
  private readonly itemList: ItemInstance[] = [];
  private goldValue = 0;
  private readonly materialCounts = new Map<string, number>();

  constructor(capacity: number = INVENTORY_SLOTS) {
    if (!(Number.isInteger(capacity) && capacity >= 0))
      throw new RangeError(`インベントリの枠の数は0以上の整数（${String(capacity)}）`);
    this.capacity = capacity;
  }

  get items(): readonly ItemInstance[] {
    return this.itemList;
  }
  get gold(): number {
    return this.goldValue;
  }
  get full(): boolean {
    return this.itemList.length >= this.capacity;
  }
  /** 素材の数（持っていなければ0）。 */
  material(id: string): number {
    return this.materialCounts.get(id) ?? 0;
  }
  get materials(): ReadonlyMap<string, number> {
    return this.materialCounts;
  }

  /** 装備を入れる。いっぱいなら入れずに false（補助仕様書13章「インベントリがいっぱいなら拾えない」）。 */
  addItem(item: ItemInstance): boolean {
    if (this.full) return false;
    if (this.itemList.some((i) => i.uid === item.uid))
      throw new RangeError(`同じ uid の装備がすでにある（${item.uid}）`);
    this.itemList.push(item);
    return true;
  }

  /** 装備を取り出す。無ければ undefined。 */
  removeItem(uid: string): ItemInstance | undefined {
    const i = this.itemList.findIndex((x) => x.uid === uid);
    if (i < 0) return undefined;
    return this.itemList.splice(i, 1)[0];
  }

  addGold(amount: number): void {
    requireCount(amount, "金貨");
    this.goldValue = requireSafeTotal(this.goldValue + amount, "金貨の合計");
  }

  /** 金貨を使う。足りなければ、何も変えずに false。 */
  spendGold(amount: number): boolean {
    requireCount(amount, "金貨");
    if (this.goldValue < amount) return false;
    this.goldValue -= amount;
    return true;
  }

  addMaterial(id: string, count: number): void {
    requireCount(count, `素材 ${id} の数`);
    this.materialCounts.set(id, requireSafeTotal(this.material(id) + count, `素材 ${id} の合計`));
  }
}

function requireCount(value: number, what: string): void {
  if (!(Number.isSafeInteger(value) && value >= 0))
    throw new RangeError(`${what}は0以上の整数（${String(value)}）`);
}

function requireSafeTotal(value: number, what: string): number {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${what}が安全な整数の範囲を超える`);
  return value;
}
