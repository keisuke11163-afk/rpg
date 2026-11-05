import type Phaser from "phaser";

/**
 * 仮素材（補助仕様書 2章）：実行時に図形からテクスチャを作る。
 * キーは本素材と共通にする（本素材に替えても、使う側は変わらない）。
 */
export const TEXTURES = {
  player: "chr/player/body",
  facing: "chr/player/facing",
  floor: "tile/floor",
} as const;

export function createPlaceholderTextures(scene: Phaser.Scene): void {
  const g = scene.add.graphics();
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
  g.destroy();
}
