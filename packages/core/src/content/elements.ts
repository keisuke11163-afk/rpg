import type { Element } from "./effect.ts";

/** 変換の順序（仕様書 2.5）：物理 → 雷 → 氷 → 火 → 闇。聖はこの列に入らない。 */
export const CONVERSION_ORDER: readonly Element[] = [
  "physical",
  "lightning",
  "cold",
  "fire",
  "dark",
];

/** 属性のタグのID。 */
export const ELEMENT_TAG: Readonly<Record<Element, string>> = {
  physical: "TAG-ELEM-PHYSICAL",
  lightning: "TAG-ELEM-LIGHTNING",
  cold: "TAG-ELEM-COLD",
  fire: "TAG-ELEM-FIRE",
  dark: "TAG-ELEM-DARK",
  holy: "TAG-ELEM-HOLY",
};

/**
 * 変換してよいか（仕様書 2.5）。
 * - 上流から下流へだけ（物理 → 雷 → 氷 → 火 → 闇）
 * - 聖への変換は、どの属性からでもよい（「特定の効果に限る」は、効果を作るときに守る）
 * - 聖から他の属性への変換はできない
 */
export function conversionAllowed(from: Element, to: Element): boolean {
  if (from === to || from === "holy") return false;
  if (to === "holy") return true;
  return CONVERSION_ORDER.indexOf(to) > CONVERSION_ORDER.indexOf(from);
}
