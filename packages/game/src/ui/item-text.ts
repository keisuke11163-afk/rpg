import type { ContentDb, ItemInstance } from "@stella/core";
import { text, type TextKey } from "@stella/content";

/** 装備の名前（ベースの名前。詞による名前は、まだ作らない）。 */
export function itemName(db: ContentDb, item: ItemInstance | undefined): string {
  if (item === undefined) return "素手";
  const base = db.itemBases.get(item.base);
  return base === undefined ? item.base : text(base.text as TextKey);
}
