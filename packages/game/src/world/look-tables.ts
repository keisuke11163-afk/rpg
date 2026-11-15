/**
 * 世界の見た目の表（仮素材の色・形・寸法。docs/progress D-WORLD-1）。
 * 色と寸法はここだけで変える。Phaser に依存しない（テストできる）。
 *
 * 本素材（ドット絵）に替えるときは、テクスチャのキー（placeholders.ts の TEXTURES・enemyTexture・
 * playerTexture・propTexture など）は変えずに、同じキーで画像を読み込めばよい。
 * この表は、仮素材を図形から作るとき（sprites.ts・ground-plan.ts）だけに使う。
 */
import type { Facility } from "@stella/core";

/** 敵の形（図形の組み方）。 */
export type EnemyShape =
  "wolf" | "leader" | "rat" | "lizard" | "boar" | "bear" | "sapling" | "tentacle" | "tree" | "blob";

/** 敵の見た目。 */
export interface EnemyLook {
  readonly shape: EnemyShape;
  /** 体の色（明るめ。溜め・崩しの色は掛け算で重ねるので、暗すぎない色にする）。 */
  readonly body: number;
  /** 影の側・輪郭の色。 */
  readonly dark: number;
  /** 目・牙・とげ・腐った芯などの差し色。 */
  readonly accent: number;
  /**
   * 体を向きに合わせて回すか（真上から見た獣。頭が右＝向き0 で描く）。
   * 木・苗は回さない（向きは別の三角の印で示す）。
   */
  readonly rotates: boolean;
}

/**
 * 敵の見た目（種類ごと。packages/content/data/enemies/chapter1.json の全ての敵）。
 * 体の大きさは当たり判定の半径から決める（直径＝半径×2×16ピクセル）。ここでは形と色だけ。
 */
export const ENEMY_LOOKS: Readonly<Record<string, EnemyLook>> = {
  "ENM-FOREST-WOLF": {
    shape: "wolf",
    body: 0x9aa0aa,
    dark: 0x5a5f6a,
    accent: 0xffd166,
    rotates: true,
  },
  "ENM-THORN-RAT": {
    shape: "rat",
    body: 0x9a8270,
    dark: 0x5a4a3e,
    accent: 0xd8c08a,
    rotates: true,
  },
  "ENM-SPINE-LIZARD": {
    shape: "lizard",
    body: 0x78b86a,
    dark: 0x3f6f3a,
    accent: 0xe0e890,
    rotates: true,
  },
  "ENM-TUSK-BOAR": {
    shape: "boar",
    body: 0xa8704c,
    dark: 0x5e3a28,
    accent: 0xf2ead8,
    rotates: true,
  },
  "ENM-BARK-BEAR": {
    shape: "bear",
    body: 0x7e6448,
    dark: 0x463424,
    accent: 0xa89a70,
    rotates: true,
  },
  "ENM-ROT-SAPLING": {
    shape: "sapling",
    body: 0x8aa84a,
    dark: 0x4a5a26,
    accent: 0xb07ad0,
    rotates: false,
  },
  "ENM-PACK-LEADER": {
    shape: "leader",
    body: 0x868c98,
    dark: 0x40444e,
    accent: 0xff9f43,
    rotates: true,
  },
  "ENM-ROOT-TENTACLE": {
    shape: "tentacle",
    body: 0x7f8f44,
    dark: 0x3f4a1f,
    accent: 0xb07ad0,
    rotates: true,
  },
  "ENM-MOTHER-TREE": {
    shape: "tree",
    body: 0x7a6040,
    dark: 0x3a2a1c,
    accent: 0xa8e070,
    rotates: false,
  },
  "ENM-ABYSS-MOTHER-TREE": {
    shape: "tree",
    body: 0x5e4a70,
    dark: 0x2a1f36,
    accent: 0xd080ff,
    rotates: false,
  },
};

/** 表に無い敵（新しく足した敵など）の見た目：灰色の丸。 */
export const FALLBACK_ENEMY_LOOK: EnemyLook = {
  shape: "blob",
  body: 0x9a98a8,
  dark: 0x55536a,
  accent: 0xe8e6f0,
  rotates: true,
};

/** 敵の見た目（表に無ければ灰色の丸）。 */
export function enemyLook(enemyId: string): EnemyLook {
  return ENEMY_LOOKS[enemyId] ?? FALLBACK_ENEMY_LOOK;
}

/** 敵の体のテクスチャの1辺（ピクセル）：当たり判定の直径（16ピクセル＝1m）。小さすぎる敵は6ピクセル。 */
export function enemyBodySize(radius: number): number {
  return Math.max(6, Math.round(radius * 2 * 16));
}

/** プレイヤーの武器の形。 */
export type WeaponShape = "greatsword" | "daggers" | "bow" | "staff" | "swordShield" | "tome";

/** プレイヤーの見た目（ジョブごと）。 */
export interface JobLook {
  /** 服の色。 */
  readonly cloth: number;
  /** 縁・帯の色。 */
  readonly trim: number;
  /** 頭（髪・頭巾・兜）の色。 */
  readonly head: number;
  readonly weapon: WeaponShape;
  /** 長い衣（魔法使い・召喚士）。 */
  readonly robe: boolean;
}

/** プレイヤーの見た目（6つのジョブ。packages/content/data/jobs/jobs.json）。 */
export const JOB_LOOKS: Readonly<Record<string, JobLook>> = {
  "JOB-WARRIOR": {
    cloth: 0xc4574c,
    trim: 0xe0d2b0,
    head: 0x6a4a30,
    weapon: "greatsword",
    robe: false,
  },
  "JOB-ROGUE": { cloth: 0x4c6470, trim: 0x2a3036, head: 0x2e3a40, weapon: "daggers", robe: false },
  "JOB-ARCHER": { cloth: 0x5a9a50, trim: 0xa07850, head: 0x8a6a40, weapon: "bow", robe: false },
  "JOB-MAGE": { cloth: 0x5a62c0, trim: 0xd8c070, head: 0x3a3a80, weapon: "staff", robe: true },
  "JOB-KNIGHT": {
    cloth: 0xb4bccc,
    trim: 0x5a7ab0,
    head: 0xc8d0dc,
    weapon: "swordShield",
    robe: false,
  },
  "JOB-SUMMONER": { cloth: 0x8452a8, trim: 0xd8a0ff, head: 0x3a2850, weapon: "tome", robe: true },
};

/** 表に無いジョブ（と、キー chr/player/body の仮素材）の見た目：元の青い体。 */
export const DEFAULT_JOB_LOOK: JobLook = {
  cloth: 0x6fa8ff,
  trim: 0xe8e6f0,
  head: 0x4a5a80,
  weapon: "greatsword",
  robe: false,
};

/** プレイヤーの絵の寸法（ピクセル。当たり判定の半径 0.35m≒5.6ピクセルに体の幅を合わせる）。 */
export const PLAYER_SPRITE = { width: 16, height: 24, bodyWidth: 11 } as const;

/** 町の施設の見た目（建物・台）。寸法はピクセル。 */
export interface FacilityLook {
  readonly width: number;
  readonly height: number;
  readonly main: number;
  readonly dark: number;
  readonly accent: number;
}

/** 施設の見た目（全ての施設。人形は sim の人形を描くので、ここの値は使わない）。 */
export const FACILITY_LOOKS: Readonly<Record<Facility, FacilityLook>> = {
  // 転職神殿：白い柱と屋根の小さな祠
  temple: { width: 22, height: 22, main: 0xd8d4e0, dark: 0x6a6878, accent: 0xffd166 },
  // 星読み師：台の上の星
  starReader: { width: 16, height: 22, main: 0x4a4a80, dark: 0x262640, accent: 0xffe08a },
  // 討伐の祭壇：紫の印の石の台
  altar: { width: 20, height: 14, main: 0x6a6670, dark: 0x34323a, accent: 0xc3a6ff },
  // 鍛冶屋：金床と炉の火
  smith: { width: 20, height: 16, main: 0x5c5f6a, dark: 0x2a2c32, accent: 0xff8a3d },
  // 商人：縞の日よけの屋台
  merchant: { width: 24, height: 20, main: 0xa07850, dark: 0x4e3826, accent: 0xd85a4a },
  // 倉庫：金具の付いた大きな箱
  stash: { width: 18, height: 14, main: 0x8a6a44, dark: 0x3e2e1e, accent: 0xb8b0a0 },
  // 転移の石：光る石
  teleport: { width: 12, height: 20, main: 0x9a90c8, dark: 0x3a3450, accent: 0xc3a6ff },
  // 訓練用の人形（描かない。参考の値）
  dummy: { width: 16, height: 24, main: 0xa07850, dark: 0x6b4f33, accent: 0xd8c08a },
};

/** 宝箱・転移の石・隠し星・出口の色。 */
export const PROP_COLORS = {
  woodChest: { main: 0xa07850, dark: 0x4e3826, band: 0x6a6878 },
  oldChest: { main: 0xd8a840, dark: 0x6a4a18, band: 0xfff0b0 },
  openedChest: { main: 0x5a5060, dark: 0x2a2630, band: 0x4a4858 },
  /** 転移の石（解放済み＝緑の光、未解放＝灰色）。 */
  stoneLit: { main: 0x8fe0a0, dark: 0x2f5a3a, glow: 0x7bd389 },
  stoneDim: { main: 0x6a6878, dark: 0x34323e, glow: 0x6a6878 },
  /** 隠し星（怪しい茂み）。 */
  secret: { main: 0x3f6b3a, dark: 0x1f3a1e, sparkle: 0xe8f0a0 },
  exitOpen: 0x7bd389,
  exitClosed: 0xff6b6b,
  /** F で使えるときの光。 */
  glow: 0xffe08a,
} as const;

/** 地面の物の色（LootView の名前の色と同じ。レアリティの色は item-text.ts の RARITY_COLOR）。 */
export const LOOT_COLORS = { gold: 0xffd166, material: 0xc3a6ff } as const;

/** 地面の色の組（地域の種類ごと）。どれも暗く、彩度を抑える（赤い予兆・敵・ドロップが埋もれないように）。 */
export interface GroundPalette {
  /** 地の色。 */
  readonly base: number;
  /** 暗いまだら。 */
  readonly dark: number;
  /** 明るいまだら（苔・広場・格子の線）。 */
  readonly light: number;
  /** 土（道・むき出しの土・試験用の場の5mの線）。 */
  readonly soil: number;
  /** 草の房・石の明るい面。 */
  readonly detail: number;
  /** 小石・落ち葉・目地。 */
  readonly detail2: number;
  /** 根。 */
  readonly root: number;
  /** 差し色（茸・胞子・花）。 */
  readonly accent: number;
  /** 地域の端（森の木立・町の柵・暗い縁）。 */
  readonly edge: number;
  /** 地域の外（カメラの背景）。 */
  readonly outside: number;
}

/**
 * 地面の色の表。森とボスの間は「新しい（A1）」と「腐った（A5）」の2つを、腐り具合で混ぜる（ground-theme.ts）。
 * 明るさは地の色で RGB の各成分が 0x30 前後まで（予兆の赤 0xff6b6b を薄く重ねても見えるように）。
 */
export const GROUND_PALETTES = {
  dev: {
    base: 0x1e1d26,
    dark: 0x1b1a22,
    light: 0x2a2934,
    soil: 0x363544,
    detail: 0x2a2934,
    detail2: 0x2a2934,
    root: 0x2a2934,
    accent: 0x3a3950,
    edge: 0x0c0b10,
    outside: 0x101016,
  },
  town: {
    base: 0x2b2722,
    dark: 0x25221e,
    light: 0x24291f,
    soil: 0x302b25,
    detail: 0x36343c,
    detail2: 0x2a282e,
    root: 0x2f3a28,
    accent: 0x6a5a3a,
    edge: 0x5a4430,
    outside: 0x121115,
  },
  forestFresh: {
    base: 0x1e2a1e,
    dark: 0x192319,
    light: 0x223322,
    soil: 0x2b281e,
    detail: 0x31452c,
    detail2: 0x3a3828,
    root: 0x34281a,
    accent: 0x8a8a4a,
    edge: 0x0f1810,
    outside: 0x0b100c,
  },
  forestRotten: {
    base: 0x24202a,
    dark: 0x1d1a22,
    light: 0x2a2530,
    soil: 0x2c2226,
    detail: 0x3c3246,
    detail2: 0x3a2c34,
    root: 0x3e2834,
    accent: 0x9a60b8,
    edge: 0x150f18,
    outside: 0x0d0a10,
  },
  bossFresh: {
    base: 0x1f1915,
    dark: 0x181310,
    light: 0x241e18,
    soil: 0x261f17,
    detail: 0x3a3226,
    detail2: 0x332a20,
    root: 0x45321f,
    accent: 0xa8e070,
    edge: 0x0c0a08,
    outside: 0x0a0807,
  },
  bossRotten: {
    base: 0x1b1520,
    dark: 0x151019,
    light: 0x211b29,
    soil: 0x201822,
    detail: 0x342a3e,
    detail2: 0x2e2436,
    root: 0x40284a,
    accent: 0xd080ff,
    edge: 0x09070b,
    outside: 0x08060a,
  },
} as const satisfies Record<string, GroundPalette>;

/**
 * 腐り具合（0〜1）を決める敵のLvの幅：区画の敵のLvの平均がこの min なら0（A1）、max なら1（A5・深淵の母樹）。
 * 地域のデータ（区画のLv）から決めるので、地域を足しても表を書き足さなくてよい。
 */
export const ROT_LEVEL_RANGE = { min: 1, max: 20 } as const;
