/**
 * 起動の確認：ビルドしたゲームをブラウザで開き、起動の画面が描画されることと、
 * コンソールにエラーが出ないことを確かめ、画面を撮影する。
 *
 * Playwright は、この開発環境に入っているものを使う（開発環境構築計画 2章）。
 * GitHub Actions では Playwright を入れていないので、このスクリプトは CI では実行しない。
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { preview } from "vite";

interface Page {
  on(event: "console", listener: (message: { type(): string; text(): string }) => void): void;
  on(event: "pageerror", listener: (error: Error) => void): void;
  goto(url: string): Promise<unknown>;
  waitForFunction(
    fn: () => boolean,
    arg: undefined,
    options: { timeout: number },
  ): Promise<unknown>;
  evaluate<T>(fn: () => T): Promise<T>;
  screenshot(options: { path: string }): Promise<unknown>;
}
interface Browser {
  newPage(options: {
    viewport: { width: number; height: number };
    deviceScaleFactor: number;
  }): Promise<Page>;
  close(): Promise<void>;
}
interface Playwright {
  chromium: { launch(): Promise<Browser> };
}

const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as Playwright;

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = fileURLToPath(new URL("../../../artifacts/smoke/", import.meta.url));
mkdirSync(outDir, { recursive: true });

const server = await preview({ root, preview: { port: 4173, strictPort: true }, logLevel: "warn" });
const browser = await chromium.launch();
const errors: string[] = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://localhost:4173/");
  await page.waitForFunction(() => document.body.dataset["stellaReady"] === "true", undefined, {
    timeout: 15000,
  });
  const renderer = await page.evaluate(() =>
    document.querySelector("canvas") ? "canvas あり" : "canvas なし",
  );
  const shot = `${outDir}boot.png`;
  await page.screenshot({ path: shot });
  console.log(`起動の確認：描画済み（${renderer}）。撮影：${shot}`);
} finally {
  await browser.close();
  await server.close();
}

if (errors.length > 0) {
  console.error(`コンソールのエラー（${String(errors.length)}件）:\n${errors.join("\n")}`);
  process.exit(1);
}
console.log("コンソールのエラー：なし");
