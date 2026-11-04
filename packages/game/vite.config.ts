import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "es2023",
    rolldownOptions: {
      output: {
        // Phaser をゲームのコードとは別のファイルに出力する（開発環境構築計画 5章）
        codeSplitting: {
          groups: [{ name: "phaser", test: /node_modules[\\/]phaser/ }],
        },
      },
    },
    // Phaser 本体だけで約1.4MBあり、分けても警告の基準（500kB）を超えるため
    chunkSizeWarningLimit: 1500,
  },
});
