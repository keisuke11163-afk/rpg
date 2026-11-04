import Phaser from "phaser";
import { CORE_API_VERSION } from "@stella/core";
import { text } from "@stella/content";
import { SCREEN } from "../config.ts";

/** 起動の画面。U-01 では、ゲームが起動することを確かめるための表示だけを行う。 */
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

    // 起動の確認（pnpm smoke）が、描画まで終わったことを知るための印
    document.body.dataset["stellaReady"] = "true";
  }
}
