/**
 * アイテムの型（本仕様書 3章、開発計画書 6.5）。
 * 装備の実体は「抽選の結果」だけを持ち、能力値は読み込むたびに計算し直す（開発計画書 6.1 原則3）。
 */
import type { WeaponClass } from "../jobs/skills.ts";

export const SLOTS = ["主手", "副手", "頭", "胴", "手", "足", "腰", "首", "指輪"] as const;
export type Slot = (typeof SLOTS)[number];

export const RARITIES = ["normal", "magic", "rare", "unique", "set", "astral"] as const;
export type Rarity = (typeof RARITIES)[number];

/** 部位ごとの詞の数の上限（希少の場合。本仕様書 3.1）。腰は前2／後2＋帯紋1 */
export const AFFIX_LIMITS: Readonly<
  Record<Slot, { prefix: number; suffix: number; belt: number }>
> = {
  主手: { prefix: 3, suffix: 3, belt: 0 },
  副手: { prefix: 3, suffix: 3, belt: 0 },
  頭: { prefix: 3, suffix: 3, belt: 0 },
  胴: { prefix: 3, suffix: 3, belt: 0 },
  手: { prefix: 3, suffix: 3, belt: 0 },
  足: { prefix: 3, suffix: 3, belt: 0 },
  腰: { prefix: 2, suffix: 2, belt: 1 },
  首: { prefix: 3, suffix: 3, belt: 0 },
  指輪: { prefix: 2, suffix: 2, belt: 0 },
};

export type ArmorType = "heavy" | "light" | "robe";
export type DefenseKind = "armor" | "evasion" | "barrier";

export interface ItemBase {
  id: string;
  name: string;
  slot: Slot;
  kind: "weapon" | "shield" | "armor" | "accessory";
  /** 武器・盾の種類 */
  weaponClass?: WeaponClass;
  hands?: 1 | 2;
  armorType?: ArmorType;
  /** 武器のベース値（下級） */
  weapon?: { min: number; max: number; speed: number; crit: number };
  /** 防具・盾の基礎性能（下級） */
  defense?: { kind: DefenseKind; value: number };
  /** 要求される能力値（下級。補助仕様書 14章） */
  requirement?: { stat: string; value: number };
  requiredLevel: number;
  /** 基本刻印の説明キー（効果の定義は U-12 で能力値の計算に使う） */
  implicit?: string;
  /** 共鳴紋が確定で付く（星鉄の首飾り。詞の枠-1） */
  guaranteedResonance?: boolean;
  /** 薬瓶など、この部位のベース専用の注記 */
  note?: string;
}

/** 詞の値の幅（1つの値を抽選する）、または最小・最大の追加ダメージ（抽選しない） */
export interface TierRange {
  min: number;
  max: number;
}

export interface AffixDef {
  id: string;
  name: string;
  position: "prefix" | "suffix";
  /** 付く部位。「主手」を含めれば武器、防具・アクセサリーは部位を列挙する */
  slots: readonly Slot[];
  /** 出現の重み（本仕様書 3.6：一般100、攻撃速度・会心率・移動速度・付与率50、職詞・共鳴紋25） */
  weight: number;
  /** T7・T4 の値（表に載っているもの）。他のtierは補間で求める */
  t7: TierRange;
  t4: TierRange;
  /** 「物理ダメージ追加 1–3」のような追加ダメージ。tierの中では抽選しない */
  added?: boolean;
  /** 効果の対象となる能力値の名前（能力値の計算で使う） */
  stat: string;
  /** 職詞：このジョブのときだけ効果を発揮する。どのジョブでも拾える */
  job?: string;
  /** 系統詞：この系統の敵からだけ落ちる（タグID） */
  family?: string;
  /** 共鳴紋：後詞の枠を1つ使う */
  resonance?: boolean;
  /** 帯紋（腰だけの専用の詞） */
  beltSlot?: boolean;
}

export interface RolledAffix {
  id: string;
  tier: number;
  /** 封印している（次の1回のクラフト操作から守られる。本仕様書 3.10 封詞の蝋） */
  sealed?: boolean;
  /** 抽選の結果。追加ダメージは [最小, 最大]、他は [値] */
  rolls: number[];
  /** 共鳴紋の星域など */
  params?: Record<string, string>;
}

/** 装備の実体（セーブデータに保存する形）。能力値は保存しない */
export interface ItemInstance {
  uid: string;
  baseId: string;
  rarity: Rarity;
  ilvl: number;
  affixes: RolledAffix[];
  enhance: number;
  /** ユニーク・セットの固有効果のID（U-16） */
  uniqueId?: string;
  /** 鍛造負荷 0〜100（本仕様書 3.11.1）。なければ0 */
  strain?: number;
  /** 亀裂（小さなマイナスの詞）。繕いの糸で消せる */
  fractures?: RolledAffix[];
  /** 銘（+10で刻める小さな追加効果）のID */
  inscription?: string;
  /** これまでに封詞の蝋を使った回数（2個目以降は負荷+15） */
  sealsUsed?: number;
}

/** 詞のtier：T7（iLv1）、T6（12）、T5（25）、T4（38）、… */
export const TIER_MIN_ILVL: Readonly<Record<number, number>> = {
  7: 1,
  6: 12,
  5: 25,
  4: 38,
  3: 52,
  2: 66,
  1: 80,
  0: 90,
};

/** 銘（+10で刻める、3つの候補から選ぶ小さな追加効果。本仕様書 3.9） */
export interface Inscription {
  id: string;
  name: string;
  /** 効果の対象（能力値の名前）と値（比） */
  stat: string;
  value: number;
}
