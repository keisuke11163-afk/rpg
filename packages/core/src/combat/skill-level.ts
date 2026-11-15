/**
 * 技レベル（本仕様書 5.1.1）。
 */

/** 基本の技レベル ＝ 1 ＋ ⌊（キャラLv － 1）÷ 5⌋。キャラLv1で1、Lv96以上で20 */
export function baseSkillLevel(charLevel: number): number {
  const lv = Math.max(1, Math.floor(charLevel));
  return Math.min(20, 1 + Math.floor((lv - 1) / 5));
}

/** 武器の技：1レベルごとに技倍率+1%（加算）。薙ぎ払い130%は技レベル20で149% */
export function weaponSkillMultiplier(baseMultiplier: number, skillLevel: number): number {
  return baseMultiplier + 0.01 * (skillLevel - 1);
}

/** 呪文・召喚物の基礎値の倍率（仮値） */
export const SPELL_BASE_MULTIPLIER: readonly number[] = [
  1.0, 1.17, 1.53, 1.87, 2.46, 3.09, 3.88, 4.61, 4.81, 5.01, 6.17, 7.54, 9.64, 10.24, 10.87, 12.43,
  14.14, 16.64, 17.23, 17.84,
];

export function spellBaseMultiplier(skillLevel: number): number {
  const index = Math.min(20, Math.max(1, Math.floor(skillLevel))) - 1;
  return SPELL_BASE_MULTIPLIER[index] as number;
}

/** 「職技レベル」の詞：1につきその技のダメージ+8%（加算）。基礎値の倍率には使わない */
export const SKILL_LEVEL_AFFIX_ADD_PCT = 0.08;
