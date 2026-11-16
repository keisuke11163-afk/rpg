import Phaser from "phaser";
import { SCREEN } from "./config.ts";
import { installPageShell } from "./page-shell.ts";
import { ArenaScene } from "./scenes/ArenaScene.ts";
import { BootScene } from "./scenes/BootScene.ts";
import { TitleScene } from "./scenes/TitleScene.ts";

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: SCREEN.width,
  height: SCREEN.height,
  // 画面の入れ物（index.html の #game。スマホのノッチ・丸い角の内側。PC では窓の全体）
  parent: "game",
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
    // スマホ（タッチ）：移動・照準・ボタンを同時に押せるよう、指を4本まで受け付ける（docs/progress TOUCH-1）
    activePointers: 4,
  },
  scene: [BootScene, TitleScene, ArenaScene],
});

// スマホ（タッチ）の端末だけ：横向き専用の画面・長押しのメニューの抑止（PC では何もしない）
installPageShell(game);
