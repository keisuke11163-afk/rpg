/**
 * 経験値とレベル（補助仕様書 4章）。数値は仮値。
 */
import type { EnemyRank } from "../enemy/def.ts";
import { RANK_MULTIPLIERS } from "../enemy/def.ts";

export const MVP_LEVEL_CAP = 20;
/** 転職が開くキャラLv（本仕様書 5.1） */
export const JOB_CHANGE_LEVEL = 15;
/** 追いつき補正：最も高いジョブLvより10以上低いあいだ、ジョブ経験値×2 */
export const CATCH_UP_GAP = 10;
export const CATCH_UP_MULTIPLIER = 2;

/** Lv L から L＋1 に必要な経験値 ＝ 290 × L^1.2（四捨五入） */
export function expToNext(level: number): number {
  return Math.round(290 * level ** 1.2);
}

export type ExpSource = EnemyRank | "midBoss" | "chapterBoss";

/** 敵の経験値：通常 ＝ 5 ＋ 2 × 敵のLv。格で 魔法×3・精鋭×10・中ボス×30・章ボス×100 */
export function enemyExp(enemyLevel: number, source: ExpSource = "normal"): number {
  const base = 5 + 2 * enemyLevel;
  if (source === "midBoss") return base * 30;
  if (source === "chapterBoss") return base * 100;
  return base * RANK_MULTIPLIERS[source].exp;
}

/** Lvの差：プレイヤーのLvが敵のLvより4以上高いと、1Lvごとに-20%（最低10%） */
export function levelDifferenceFactor(playerLevel: number, enemyLevel: number): number {
  const diff = playerLevel - enemyLevel;
  if (diff < 4) return 1;
  return Math.max(0.1, 1 - 0.2 * (diff - 3));
}

/** 経験値の入れ物（キャラ・ジョブで共通）。上限に達すると貯まらない */
export interface LevelState {
  level: number;
  exp: number;
}

/** 経験値を加え、上がったLvの数を返す */
export function addExp(state: LevelState, amount: number, cap = MVP_LEVEL_CAP): number {
  if (amount <= 0 || state.level >= cap) return 0;
  state.exp += amount;
  let gained = 0;
  while (state.level < cap && state.exp >= expToNext(state.level)) {
    state.exp -= expToNext(state.level);
    state.level++;
    gained++;
  }
  if (state.level >= cap) state.exp = 0;
  return gained;
}
