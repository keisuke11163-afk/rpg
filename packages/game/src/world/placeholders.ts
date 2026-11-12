import type Phaser from "phaser";

/**
 * 仮素材（補助仕様書 2章）：実行時に図形からテクスチャを作る。
 * キーは本素材と共通にする（本素材に替えても、使う側は変わらない）。
 */
export const TEXTURES = {
  player: "chr/player/body",
  facing: "chr/player/facing",
  floor: "tile/floor",
  dummy: "enemy/dummy/body",
  projectile: "fx/projectile/test",
} as const;

/** 敵の仮素材のキー（敵の種類のIDごと）。 */
export function enemyTexture(enemyId: string): string {
  return `enemy/${enemyId.toLowerCase()}/body`;
}

/** 敵の仮素材の色（種類ごと。書かれていない種類は灰色）。 */
const ENEMY_COLORS: Readonly<Record<string, number>> = {
  "ENM-FOREST-WOLF": 0x8a8f99,
  "ENM-THORN-RAT": 0x7a6a5a,
  "ENM-SPINE-LIZARD": 0x5f9f5a,
  "ENM-TUSK-BOAR": 0x8b5a3c,
  "ENM-BARK-BEAR": 0x5c4632,
  "ENM-ROT-SAPLING": 0x6b7f3a,
};

export function createPlaceholderTextures(
  scene: Phaser.Scene,
  enemies: readonly { readonly id: string; readonly radius: number }[] = [],
): void {
  const g = scene.add.graphics();
  // 敵：体の半径に合わせた四角（16ピクセル＝1m）
  for (const e of enemies) {
    const size = Math.max(6, Math.round(e.radius * 2 * 16));
    g.clear();
    g.fillStyle(ENEMY_COLORS[e.id] ?? 0x888888, 1).fillRect(0, 0, size, size);
    g.fillStyle(0x1e1d26, 1).fillRect(Math.round(size * 0.6), Math.round(size * 0.25), 2, 2);
    g.generateTexture(enemyTexture(e.id), size, size);
  }
  // プレイヤー：16×24 の体
  g.clear();
  g.fillStyle(0x6fa8ff, 1).fillRect(2, 0, 12, 24);
  g.fillStyle(0xe8e6f0, 1).fillRect(5, 3, 6, 6);
  g.generateTexture(TEXTURES.player, 16, 24);
  // 向きの印：右向きの三角形（回転して8方向を表す）
  g.clear();
  g.fillStyle(0xffd166, 1).fillTriangle(0, 0, 10, 4, 0, 8);
  g.generateTexture(TEXTURES.facing, 10, 8);
  // 床のタイル：16×16 の格子
  g.clear();
  g.fillStyle(0x1e1d26, 1).fillRect(0, 0, 16, 16);
  g.lineStyle(1, 0x2a2934, 1).strokeRect(0, 0, 16, 16);
  g.generateTexture(TEXTURES.floor, 16, 16);
  // 訓練用の人形：16×24 の木の色
  g.clear();
  g.fillStyle(0xa07850, 1).fillRect(3, 0, 10, 24);
  g.fillStyle(0x6b4f33, 1).fillRect(0, 8, 16, 3);
  g.generateTexture(TEXTURES.dummy, 16, 24);
  // 試験用の投射物：6×2 の線
  g.clear();
  g.fillStyle(0xe8e6f0, 1).fillRect(0, 0, 6, 2);
  g.generateTexture(TEXTURES.projectile, 6, 2);
  g.destroy();
}
