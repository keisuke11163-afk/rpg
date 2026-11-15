/** 武器種（下級ベースの数値。本仕様書 3.2）。仮値 */
export interface WeaponDef {
  name: string;
  min: number;
  max: number;
  /** 回/秒 */
  speed: number;
  /** 基本の会心率 */
  crit: number;
}

export const WEAPONS: Readonly<Record<string, WeaponDef>> = {
  longsword: { name: "長剣", min: 6, max: 11, speed: 1.4, crit: 0.05 },
  greatsword: { name: "大剣", min: 14, max: 24, speed: 1.05, crit: 0.05 },
  dagger: { name: "短剣", min: 4, max: 9, speed: 1.6, crit: 0.08 },
  claw: { name: "爪", min: 5, max: 8, speed: 1.7, crit: 0.06 },
  greataxe: { name: "大斧", min: 16, max: 28, speed: 0.95, crit: 0.05 },
  greathammer: { name: "大槌", min: 18, max: 27, speed: 0.9, crit: 0.04 },
};
