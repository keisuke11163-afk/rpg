/**
 * データから参照できる名前の一覧（コードで決める）。データの検証では、ここにない名前を誤りにする。
 * 新しい仕組みを追加するときは、ここに名前を加え、その名前を扱う処理を実装する。
 */

/** 装備の部位（仕様書 3.1）。 */
export const EQUIP_SLOTS = [
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
  "relic",
] as const;
export type EquipSlot = (typeof EQUIP_SLOTS)[number];

/**
 * 「必ず〜する／〜しない」を表す印（仕様書v0.2 2.4.1 の規則1・3）。
 * - crit：会心（例：急所穿ち「5点なら必ず会心」、盲目の賢者の目隠し「会心しない」）
 * - ailmentApply：状態異常の付与（対象の状態異常のタグが必要。例：千の小傷「必ず出血を付与」）
 * - beStaggered：崩される（例：重荷の誇り「崩されなくなる」）
 * - spawnMinion：召喚物を生む（例：一騎当千「召喚物を維持できない」）。
 *   U-03 が持つのは印の評価と問い合わせ（`ModifierView.flag("spawnMinion", …)`）まで。
 *   召喚物を実際に生む処理はまだなく、それを実装する単位が、生む前にこの印を問い合わせ、
 *   `forbid` なら生まないようにする（規則3。docs/progress/開発進捗.md の U-03 を参照）。
 * - alwaysHit：必中（敵の回避を無視する。例：盲目の賢者の目隠し）
 */
export const FLAGS = ["crit", "ailmentApply", "beStaggered", "spawnMinion", "alwaysHit"] as const;
export type FlagId = (typeof FLAGS)[number];

/** 対象のタグが必要な印と、そのタグの分類。 */
export const FLAG_TARGET_CATEGORY: Partial<Record<FlagId, "ailment">> = { ailmentApply: "ailment" };

/** 置き換えられる入力・枠（仕様書v0.2 2.4.1 の規則2）。例：回避の入力（不動の誓い・影縫いの装束）。 */
export const REPLACE_SLOTS = ["dodge"] as const;
export type ReplaceSlot = (typeof REPLACE_SLOTS)[number];

/**
 * 条件・数に使える「事実」（装備などから、呼び出す側が数える値）。
 * - armor.heavy.count など：その種類の防具を装備している部位の数（重荷の誇り）
 * - mainHand.empty：主手が空なら1（徒手の極意）
 */
export const FACTS = [
  "armor.heavy.count",
  "armor.light.count",
  "armor.robe.count",
  "mainHand.empty",
] as const;
export type FactId = (typeof FACTS)[number];
