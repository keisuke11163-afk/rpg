/**
 * 技の定義（データの形）と、武器適性（本仕様書 5.1・5.2、補助仕様書 3.5・3.6）。
 * 技の変化（激化・武器による変化）は、ベースの値に重ねる「差分」で表す。
 */
import type { HitShape } from "../combat/geometry.ts";
import type { AilmentKind } from "../combat/ailments.ts";

export type WeaponClass =
  | "greatsword"
  | "longsword"
  | "axe"
  | "greataxe"
  | "hammer"
  | "greathammer"
  | "spear"
  | "dagger"
  | "claw"
  | "bow"
  | "staff"
  | "shield"
  | "unarmed"
  /** 二刀流（片手武器を両手に持つ）。技の変化のキーとして使う */
  | "dualWield";

/** 技の値の差分。書いたものだけが、ベースを上書き・加算する */
export interface SkillPatch {
  shape?: HitShape;
  /** 範囲の倍率（大剣：1.2） */
  rangeScale?: number;
  multiplier?: number;
  breakBonus?: number;
  /** 状態異常の基本付与率に加える */
  ailments?: Partial<Record<AilmentKind, number>>;
  /** 1秒あたりのヒット数（旋風） */
  hitsPerSecond?: number;
  /** 追加の挙動の名前（ルールフックの参照。例：shockwave・pull・lingering・cross） */
  hooks?: readonly string[];
  /** 通った敵を全て崩す（突進の激化） */
  breaksAll?: boolean;
  /** 突進などの移動距離の加算（m） */
  dashDistanceAdd?: number;
  /** ヒット数（連刃：短剣3・爪4・片手剣2） */
  hits?: number;
}

export type SkillKind = "attack" | "buff" | "channel" | "dash" | "teleport" | "ground";

export interface SkillDef {
  id: string;
  name: string;
  tags: readonly string[];
  kind: SkillKind;
  mpCost: number;
  /** チャネル技は、1回ごとのMP（旋風：0.25秒ごとに3） */
  mpCostInterval?: number;
  cooldownSeconds: number;
  /** 解放技：ゲージが解放できる値のとき使える（使うとゲージを使い切る） */
  release?: boolean;
  shape: HitShape;
  multiplier: number;
  breakCoefficient: number;
  /** 動作の長さと、ヒットが発生する時刻（秒） */
  totalSeconds: number;
  hitTimes: readonly number[];
  /** 技を使った直後に得るゲージ */
  gaugeGain?: number;
  /** ヒットを当てると、1回の使用につきゲージ+N（連刃：コンボ点+1） */
  gaugeOnHit?: number;
  /** 終結技：ゲージの点数に応じて効果が上がり、使うと全て使う */
  finisher?: { bonusPerPoint: number; guaranteedCritAt: number };
  /** 敵の背後へ瞬間移動する。照準の近くrange(m)以内の敵が対象 */
  teleportBehind?: { range: number };
  /** 地面に置く技（照準の位置・射程内） */
  ground?: {
    placeRange: number;
    zone: "smoke" | "trap";
    seconds: number;
    radius: number;
    max?: number;
  };
  /** 使った後の効果（秒・値）。戦吼・破軍の被ダメージ軽減など */
  buff?: {
    seconds: number;
    attackBonus?: number;
    damageTakenMultiplier?: number;
    enemyBreakBonus?: number;
    /** 状態異常の付与率の加算（毒塗り：poison +0.4） */
    ailmentBonus?: Partial<Record<AilmentKind, number>>;
  };
  /** 激化したときの差分 */
  intensified?: SkillPatch;
  /** 武器による変化。適性Sでは強化版（enhanced）が適用される */
  weaponVariants?: Partial<Record<WeaponClass, SkillPatch>>;
  /** 技を覚えるジョブLv（補助仕様書 3.5） */
  learnLevel: number;
  provisional: true;
}

export type Aptitude = "S" | "A" | "B" | "C";

/** 適性の攻撃速度への影響（本仕様書 5.1） */
export const APTITUDE_SPEED: Readonly<Record<Aptitude, number>> = {
  S: 0.1,
  A: 0,
  B: -0.05,
  C: -0.1,
};

/** 戦士の武器適性（本仕様書 5.2）。二刀流（片手武器）は B */
export const WARRIOR_APTITUDE: Readonly<Partial<Record<WeaponClass | "dualWield", Aptitude>>> = {
  greatsword: "S",
  greataxe: "S",
  greathammer: "A",
  axe: "A",
  spear: "A",
  longsword: "A",
  shield: "B",
  bow: "C",
  staff: "C",
  dualWield: "B",
};

/**
 * 通常攻撃（本仕様書 2.1）：全ジョブ共通の技。MP0・CDなし・技倍率100%。近接：扇形90°・1.6m、崩し係数0.3。
 * 激化・武器による変化などの職技の強化は受けない。動作の時間は「1÷攻撃速度」秒（呼び出し側が決める）。
 */
export const BASIC_ATTACK: SkillDef = {
  id: "SKL-BASIC",
  name: "通常攻撃",
  tags: ["近接"],
  kind: "attack",
  mpCost: 0,
  cooldownSeconds: 0,
  shape: { kind: "cone", range: 1.6, arcDegrees: 90 },
  multiplier: 1,
  breakCoefficient: 0.3,
  totalSeconds: 0.6,
  hitTimes: [0.25],
  learnLevel: 1,
  provisional: true,
};
