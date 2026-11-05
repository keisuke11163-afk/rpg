/**
 * 技レベル（仕様書v0.2 5.1.1）。
 */

/** 基本の技レベルの上限。 */
export const MAX_BASE_SKILL_LEVEL = 20;

/** 基本の技レベル ＝ 1 ＋ ⌊（キャラLv － 1）÷ 5⌋（キャラLv96以上で20）。 */
export function baseSkillLevel(characterLevel: number): number {
  if (!Number.isInteger(characterLevel) || characterLevel < 1) {
    throw new RangeError(`キャラLvは1以上の整数：${String(characterLevel)}`);
  }
  return Math.min(MAX_BASE_SKILL_LEVEL, 1 + Math.floor((characterLevel - 1) / 5));
}

/**
 * 呪文・召喚物の基礎値の倍率（技レベル1〜20）。
 * 仮値: 仕様書v0.2 5.1.1 の表（武器の基礎値の伸びをなめらかにした値）。BL-2で調整する
 */
export const SPELL_BASE_MULTIPLIER: readonly number[] = [
  1.0, 1.17, 1.53, 1.87, 2.46, 3.09, 3.88, 4.61, 4.81, 5.01, 6.17, 7.54, 9.64, 10.24, 10.87, 12.43,
  14.14, 16.64, 17.23, 17.84,
];

/** 呪文・召喚物の基礎値の倍率（基本の技レベルで決まる）。 */
export function spellBaseMultiplier(baseLevel: number): number {
  const value = SPELL_BASE_MULTIPLIER[Math.min(MAX_BASE_SKILL_LEVEL, Math.max(1, baseLevel)) - 1];
  if (value === undefined) throw new RangeError(`技レベルが正しくない：${String(baseLevel)}`);
  return value;
}

/** 仮値: 武器の技の技倍率は、基本の技レベル1につき+1%（加算）。仕様書v0.2 5.1.1 */
export const WEAPON_SKILL_PCT_PER_LEVEL = 0.01;

/** 武器の技の技倍率（技レベル1の倍率に、基本の技レベルによる加算を足す）。 */
export function weaponSkillPct(pctAtLevel1: number, baseLevel: number): number {
  return pctAtLevel1 + WEAPON_SKILL_PCT_PER_LEVEL * (Math.max(1, baseLevel) - 1);
}

/** 仮値: 「職技レベル」の詞は、1につきその技のダメージ+8%（加算）。仕様書v0.2 5.1.1 */
export const AFFIX_SKILL_LEVEL_INCREASED = 0.08;
