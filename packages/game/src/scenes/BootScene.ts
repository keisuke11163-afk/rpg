import Phaser from "phaser";
import { CORE_API_VERSION } from "@stella/core";
import { loadGameContent, text } from "@stella/content";
import { SCREEN } from "../config.ts";
import { createPlaceholderTextures } from "../world/placeholders.ts";

/** 起動の画面：データを読み込み・検証し、仮素材を作ってから、次の場面へ進む。 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super("boot");
  }

  create(): void {
    const centerX = SCREEN.width / 2;
    this.add
      .text(centerX, 140, text("game.title"), {
        fontFamily: "sans-serif",
        fontSize: "24px",
        color: "#e8e6f0",
      })
      .setOrigin(0.5);
    this.add
      .text(centerX, 176, text("game.subtitle"), {
        fontFamily: "sans-serif",
        fontSize: "12px",
        color: "#8c88a0",
      })
      .setOrigin(0.5);
    this.add.text(
      8,
      SCREEN.height - 18,
      `Phaser ${Phaser.VERSION} / core API v${String(CORE_API_VERSION)}`,
      {
        fontFamily: "monospace",
        fontSize: "10px",
        color: "#5c5870",
      },
    );

    // データを読み込み、検証する（誤りがあれば例外になり、起動の確認で検出される）
    const content = loadGameContent();
    this.add
      .text(
        SCREEN.width - 8,
        SCREEN.height - 18,
        `データ v${content.manifest.contentVersion}・タグ${String(content.tags.size)}`,
        { fontFamily: "monospace", fontSize: "10px", color: "#5c5870" },
      )
      .setOrigin(1, 0);

    createPlaceholderTextures(this);
    // 少しだけ表題を見せてから、試験用の場へ進む（起動の確認は、試験用の場の描画が終わった時点で行う）
    this.time.delayedCall(800, () => {
      this.scene.start("arena");
    });
  }
}
