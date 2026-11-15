import type Phaser from "phaser";
import type { Facility } from "@stella/core";
import {
  DEFAULT_JOB_LOOK,
  FACILITY_LOOKS,
  JOB_LOOKS,
  PLAYER_SPRITE,
  enemyBodySize,
  enemyLook,
} from "./look-tables.ts";
import {
  drawChest,
  drawDummy,
  drawEnemy,
  drawFacility,
  drawGlow,
  drawLootGold,
  drawLootItem,
  drawLootMaterial,
  drawPlayer,
  drawPlayerRing,
  drawSecret,
  drawShadow,
  drawStone,
} from "./sprites.ts";

/**
 * 仮素材（補助仕様書 2章）：実行時に図形からテクスチャを作る。
 * キーは本素材と共通にする（本素材に替えても、使う側は変わらない）。
 * 本素材に替えるときは、同じキーで画像を読み込み（BootScene の前に preload）、ここで作らないようにする
 * （textures.exists で、既にあるキーは作らない）。
 */
export const TEXTURES = {
  player: "chr/player/body",
  facing: "chr/player/facing",
  floor: "tile/floor",
  dummy: "enemy/dummy/body",
  projectile: "fx/projectile/test",
  /** 足元の影（体の幅に合わせて拡大する）。 */
  shadow: "fx/shadow",
  /** やわらかな光（色を掛けて加算で重ねる。F で使える物・転移の石・ドロップ）。 */
  glow: "fx/glow",
  /** プレイヤーの足元の輪。 */
  playerRing: "fx/player/ring",
  lootItem: "loot/item",
  lootGold: "loot/gold",
  lootMaterial: "loot/material",
  secret: "prop/secret",
} as const;

/** 敵の仮素材のキー（敵の種類のIDごと）。 */
export function enemyTexture(enemyId: string): string {
  return `enemy/${enemyId.toLowerCase()}/body`;
}

/** プレイヤーの仮素材のキー（ジョブごと。表に無いジョブは TEXTURES.player）。 */
export function playerTexture(jobId: string): string {
  // 素の `in` だと constructor など Object の継承プロパティを真と判定するので、自分のプロパティだけを見る
  return Object.hasOwn(JOB_LOOKS, jobId)
    ? `chr/player/${jobId.toLowerCase()}/body`
    : TEXTURES.player;
}

/** createPlaceholderTextures が図形から作ったキー（本素材として読み込まれたキーは入らない）。 */
const generatedKeys = new Set<string>();

/**
 * 実際に使うプレイヤーのキー（本素材への差し替えを保つ）。ジョブごとのキーが本素材なら、それを使う。
 * ジョブごとのキーが図形の仮素材で、`chr/player/body` だけが本素材（読み込んだ画像）なら、図形のジョブの姿ではなく
 * `chr/player/body` を使う（「同じキーで読み込めば差し替わる」を保つ）。
 */
export function playerTextureIn(textures: Phaser.Textures.TextureManager, jobId: string): string {
  const jobKey = playerTexture(jobId);
  if (jobKey === TEXTURES.player) return jobKey;
  if (!textures.exists(jobKey)) return TEXTURES.player;
  if (
    generatedKeys.has(jobKey) &&
    textures.exists(TEXTURES.player) &&
    !generatedKeys.has(TEXTURES.player)
  )
    return TEXTURES.player;
  return jobKey;
}

/** 町の施設の仮素材のキー。 */
export function facilityTexture(kind: Facility): string {
  return `prop/facility/${kind}`;
}

/** 宝箱の仮素材のキー（木の宝箱・古い宝箱、閉じた・開いた）。 */
export function chestTexture(kind: "woodChest" | "oldChest", opened: boolean): string {
  return `prop/chest/${kind === "oldChest" ? "old" : "wood"}/${opened ? "open" : "closed"}`;
}

/** 転移の石の仮素材のキー（解放済みか）。 */
export function stoneTexture(lit: boolean): string {
  return `prop/stone/${lit ? "lit" : "dim"}`;
}

/** 転移の石の絵の寸法。 */
export const STONE_SIZE = { width: 12, height: 20 } as const;
/** 宝箱の絵の寸法。 */
export const CHEST_SIZE = { width: 14, height: 12 } as const;

export function createPlaceholderTextures(
  scene: Phaser.Scene,
  enemies: readonly { readonly id: string; readonly radius: number }[] = [],
  jobs: readonly string[] = Object.keys(JOB_LOOKS),
): void {
  const g = scene.add.graphics();
  const make = (key: string, w: number, h: number, draw: () => void): void => {
    // 本素材を読み込んだキー（と、作り済みのキー）は作らない
    if (scene.textures.exists(key)) return;
    g.clear();
    draw();
    g.generateTexture(key, w, h);
    generatedKeys.add(key);
  };
  // 敵：当たり判定の直径の正方形に、種類ごとの姿（16ピクセル＝1m）
  for (const e of enemies) {
    const size = enemyBodySize(e.radius);
    make(enemyTexture(e.id), size, size, () => {
      drawEnemy(g, enemyLook(e.id), size);
    });
  }
  // プレイヤー：16×24 の姿（キー chr/player/body は表に無いジョブ用の元の青い体）
  const { width: pw, height: ph } = PLAYER_SPRITE;
  make(TEXTURES.player, pw, ph, () => {
    drawPlayer(g, DEFAULT_JOB_LOOK);
  });
  for (const job of jobs) {
    const look = JOB_LOOKS[job];
    if (look !== undefined)
      make(playerTexture(job), pw, ph, () => {
        drawPlayer(g, look);
      });
  }
  // 向きの印：右向きの三角形（回転して8方向を表す）
  make(TEXTURES.facing, 10, 8, () => {
    g.fillStyle(0xffd166, 1).fillTriangle(0, 0, 10, 4, 0, 8);
  });
  // 床のタイル：16×16 の格子（試験用の場の地面）
  make(TEXTURES.floor, 16, 16, () => {
    g.fillStyle(0x1e1d26, 1).fillRect(0, 0, 16, 16);
    g.lineStyle(1, 0x2a2934, 1).strokeRect(0, 0, 16, 16);
  });
  // 訓練用の人形：16×24
  make(TEXTURES.dummy, 16, 24, () => {
    drawDummy(g);
  });
  // 試験用の投射物：6×2 の線
  make(TEXTURES.projectile, 6, 2, () => {
    g.fillStyle(0xe8e6f0, 1).fillRect(0, 0, 6, 2);
  });
  make(TEXTURES.shadow, 16, 6, () => {
    drawShadow(g);
  });
  make(TEXTURES.glow, 32, 32, () => {
    drawGlow(g);
  });
  make(TEXTURES.playerRing, 18, 8, () => {
    drawPlayerRing(g);
  });
  make(TEXTURES.lootItem, 9, 9, () => {
    drawLootItem(g);
  });
  make(TEXTURES.lootGold, 9, 7, () => {
    drawLootGold(g);
  });
  make(TEXTURES.lootMaterial, 6, 9, () => {
    drawLootMaterial(g);
  });
  make(TEXTURES.secret, 16, 14, () => {
    drawSecret(g);
  });
  // 場の物：施設・宝箱・転移の石
  for (const [kind, look] of Object.entries(FACILITY_LOOKS) as [
    Facility,
    (typeof FACILITY_LOOKS)[Facility],
  ][])
    if (kind !== "dummy")
      make(facilityTexture(kind), look.width, look.height, () => {
        drawFacility(g, kind, look);
      });
  for (const kind of ["woodChest", "oldChest"] as const)
    for (const opened of [false, true])
      make(chestTexture(kind, opened), CHEST_SIZE.width, CHEST_SIZE.height, () => {
        drawChest(g, kind === "oldChest", opened);
      });
  for (const lit of [false, true])
    make(stoneTexture(lit), STONE_SIZE.width, STONE_SIZE.height, () => {
      drawStone(g, lit);
    });
  g.destroy();
}
