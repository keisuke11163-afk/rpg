import Phaser from "phaser";
import { SCREEN } from "./config.ts";
import { ArenaScene } from "./scenes/ArenaScene.ts";
import { BootScene } from "./scenes/BootScene.ts";

new Phaser.Game({
  type: Phaser.AUTO,
  width: SCREEN.width,
  height: SCREEN.height,
  backgroundColor: "#16151c",
  // ドット絵の設定。Phaser 4 では roundPixels の初期値が false になったため明示する（開発環境構築計画 5章）
  pixelArt: true,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  input: {
    // 将来のゲームパッド対応のために有効にしておく（補助仕様書 1.2）
    gamepad: true,
  },
  scene: [BootScene, ArenaScene],
});
