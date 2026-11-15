/**
 * 敵の定義の型（補助仕様書 10章）。第1章の値は content に置く。
 */
import type { AilmentKind } from "../combat/ailments.ts";
import type { Element } from "../combat/damage.ts";
import type { HitShape } from "../combat/geometry.ts";

export type EnemyRank = "normal" | "magic" | "elite";

/** 格の倍率（補助仕様書 10.3。仮値） */
export const RANK_MULTIPLIERS: Readonly<
  Record<EnemyRank, { hp: number; damage: number; exp: number; scale: number }>
> = {
  normal: { hp: 1, damage: 1, exp: 1, scale: 1 },
  magic: { hp: 2.5, damage: 1.15, exp: 3, scale: 1 },
  elite: { hp: 6, damage: 1.3, exp: 10, scale: 1.25 },
};

export interface EnemyAttackDef {
  id: string;
  name: string;
  /** 予兆の秒数（地面の範囲表示と溜め） */
  telegraphSeconds: number;
  /** 当たり判定が出ている時間 */
  activeSeconds: number;
  /** 硬直の時間 */
  recoverySeconds: number;
  /** 標準HPに対する攻撃の割合 */
  damageRatio: number;
  breakCoefficient: number;
  /** 範囲（敵の位置から向きに向けて） */
  shape: HitShape;
  /** この距離以内で使う（m） */
  range: number;
  cooldownSeconds?: number;
  ailments?: Partial<Record<AilmentKind, number>>;
  /** 突進：活動中に前へ進む速さ（m/秒）。進む間は向きを変えられない */
  dashSpeed?: number;
  /** 投射物：速さ（m/秒）と射程 */
  projectile?: { speed: number; range: number; radius: number };
  /** 地面に残る雲（腐根の苗の胞子）。半径と持続 */
  cloud?: { radius: number; seconds: number };
  /** 周囲に仲間を呼ぶ・強化するなど、ルールフックの参照 */
  hooks?: readonly string[];
  element?: Element;
}

export interface EnemyDef {
  id: string;
  name: string;
  /** 系統の分類のタグID（獣・不死・…）。母樹の眷属は空 */
  familyTag?: string;
  hpMultiplier: number;
  /** 移動の速さ（m/秒）。0なら動かない */
  speed: number;
  /** 旋回（度/秒） */
  turnDegreesPerSecond: number;
  attacks: readonly EnemyAttackDef[];
  /** 群れの人数の範囲 */
  pack?: { min: number; max: number };
  /** 横や背後へ回り込む */
  flank?: boolean;
  /** 距離を保つ（棘吐き蜥蜴：6〜8m） */
  keepDistance?: { min: number; max: number };
  /** 向きを持たない（背面判定が起きない） */
  noFacing?: boolean;
  stationary?: boolean;
  /** 回避値・防具値のLvあたりの係数 */
  evasionPerLevel?: number;
  armorPerLevel?: number;
  resistance?: Partial<Record<Element, number>>;
  radius?: number;
  /** 素材などのドロップ（U-11 で使う）。獣系は「獣牙」を3% */
  provisional: true;
}

export const SIGHT_RANGE = 8;
export const SIGHT_ARC_DEGREES = 180;
export const PACK_ALERT_RANGE = 10;
export const LEASH_DISTANCE = 20;
/** 標準HPの25%を超える攻撃には、0.6秒以上の予兆を付ける（本仕様書 8.5） */
export const TELEGRAPH_THRESHOLD_RATIO = 0.25;
export const TELEGRAPH_MIN_SECONDS = 0.6;

/** 敵の命中 ＝ 40 ＋ 12 × 敵のLv（仮値） */
export function enemyAccuracy(level: number): number {
  return 40 + 12 * level;
}

/** 定義の検査：大きい攻撃に十分な予兆があるか。誤りの一覧を返す */
export function checkEnemyDef(def: EnemyDef): string[] {
  const problems: string[] = [];
  for (const a of def.attacks) {
    if (a.damageRatio > TELEGRAPH_THRESHOLD_RATIO && a.telegraphSeconds < TELEGRAPH_MIN_SECONDS) {
      problems.push(`${def.id}/${a.id}: 標準HPの25%を超える攻撃の予兆は0.6秒以上`);
    }
    if (a.telegraphSeconds <= 0 || a.activeSeconds <= 0 || a.recoverySeconds < 0) {
      problems.push(`${def.id}/${a.id}: 予兆・当たり判定・硬直の時間が正しくない`);
    }
  }
  if (!def.stationary && def.speed <= 0) problems.push(`${def.id}: 動く敵に速さがない`);
  return problems;
}
