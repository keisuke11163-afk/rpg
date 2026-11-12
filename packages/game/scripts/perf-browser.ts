/**
 * 描画を含めた性能の計測（pnpm perf:browser。開発計画書 T16 の描画の側）。
 * 開発サーバーでゲームを開き、開発用の試験用の場に敵をまとめて出して、フレームの間隔を測る。
 *
 * 注意：この環境のブラウザは画面の無い Chromium（GPU を使わないソフトウェアの描画）なので、
 * 実際の PC より遅めに出る。目標（src/bench/perf-targets.json。暫定で60fps。D-FIN-6）に対する合否も出す。
 * Playwright は、この開発環境に入っているものを使う。CI では実行しない。
 *
 *   pnpm perf:browser                  … 敵40体
 *   pnpm perf:browser -- --enemies 80
 */
import { createRequire } from "node:module";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { PERF_TARGETS, browserVerdict } from "../src/bench/perf-bench.ts";

interface Page {
  goto(url: string): Promise<unknown>;
  on(event: "pageerror", listener: (error: Error) => void): void;
  waitForFunction(
    fn: () => boolean,
    arg: undefined,
    options: { timeout: number },
  ): Promise<unknown>;
  evaluate<T>(fn: () => T): Promise<T>;
  evaluate<T, A>(fn: (arg: A) => T | Promise<T>, arg: A): Promise<T>;
}
interface Browser {
  newPage(options: {
    viewport: { width: number; height: number };
    deviceScaleFactor: number;
  }): Promise<Page>;
  close(): Promise<void>;
}
type Debug = {
  __STELLA_DEBUG__: {
    startSlot: (slot: number, how: string) => boolean;
    goRegion: (id: string) => boolean;
    spawnEnemy: (id: string) => string;
    grantXp: (value: number) => number;
    enemies: () => unknown[];
    region: () => { id: string };
  };
};

const i = process.argv.indexOf("--enemies");
const count = i >= 0 ? Number(process.argv[i + 1]) : 40;
if (!Number.isInteger(count) || count < 0) throw new RangeError("--enemies は0以上の整数にする");

const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as { chromium: { launch(): Promise<Browser> } };
const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root,
  server: { port: 5175, strictPort: true },
  logLevel: "warn",
});
await server.listen();
const browser = await chromium.launch();
const errors: string[] = [];
const ready = { timeout: 20000 };

/** ページの中でフレームの間隔（ms）を seconds 秒の間記録する。 */
const measure = (page: Page, seconds: number): Promise<number[]> =>
  page.evaluate(
    (s: number) =>
      new Promise<number[]>((resolve) => {
        const out: number[] = [];
        let last = performance.now();
        const end = last + s * 1000;
        const tick = (t: number): void => {
          out.push(t - last);
          last = t;
          if (t < end) requestAnimationFrame(tick);
          else resolve(out);
        };
        requestAnimationFrame(tick);
      }),
    seconds,
  );

function summary(label: string, frames: readonly number[]): void {
  const sorted = [...frames].sort((a, b) => a - b);
  const pick = (p: number): number =>
    sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0;
  const mean = frames.reduce((a, b) => a + b, 0) / Math.max(1, frames.length);
  const slow = frames.filter((f) => f > 1000 / 30).length;
  console.log(
    `  ${label}：平均 ${(1000 / mean).toFixed(1)}fps（${mean.toFixed(2)}ms）・中央 ${pick(0.5).toFixed(2)}ms・95% ${pick(0.95).toFixed(2)}ms・99% ${pick(0.99).toFixed(2)}ms・最大 ${(sorted.at(-1) ?? 0).toFixed(2)}ms・30fps を下回ったフレーム ${String(slow)}／${String(frames.length)}`,
  );
}

try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:5175/");
  await page.waitForFunction(
    () => document.body.dataset["stellaReady"] === "true",
    undefined,
    ready,
  );
  await page.evaluate(() => (window as unknown as Debug).__STELLA_DEBUG__.startSlot(1, "dev"));
  await page.waitForFunction(
    () => document.body.dataset["stellaScene"] === "arena",
    undefined,
    ready,
  );
  await page.evaluate(() => (window as unknown as Debug).__STELLA_DEBUG__.goRegion("DEV-ARENA"));
  await page.waitForFunction(
    () => document.body.dataset["stellaReady"] === "true",
    undefined,
    ready,
  );
  // 倒れにくくする（Lvを上げる）
  await page.evaluate(() => (window as unknown as Debug).__STELLA_DEBUG__.grantXp(1e9));

  console.log(`■ 描画を含めた性能（開発版・画面の無い Chromium・1280×720）`);
  summary("敵を足す前", await measure(page, 3));
  const kinds = ["ENM-SPINE-LIZARD", "ENM-THORN-RAT", "ENM-FOREST-WOLF", "ENM-ROT-SAPLING"];
  await page.evaluate(
    (args: { n: number; kinds: string[] }) => {
      const d = (window as unknown as Debug).__STELLA_DEBUG__;
      for (let k = 0; k < args.n; k++)
        d.spawnEnemy(args.kinds[k % args.kinds.length] ?? "ENM-THORN-RAT");
    },
    { n: count, kinds },
  );
  const frames = await measure(page, 6);
  const alive = await page.evaluate(
    () => (window as unknown as Debug).__STELLA_DEBUG__.enemies().length,
  );
  const region = await page.evaluate(
    () => (window as unknown as Debug).__STELLA_DEBUG__.region().id,
  );
  summary(`敵を${String(count)}体足した後（場の敵 ${String(alive)}体・地域 ${region}）`, frames);
  // 敵をまとめて出した直後の1秒は、出現の処理の重さなので合否に入れない
  let skipped = 0;
  const judged = frames.filter((f) => (skipped += f) > 1000);
  const v = browserVerdict(judged);
  console.log(
    `  合否（目標 ${String(PERF_TARGETS.targetFps)}fps の${String(PERF_TARGETS.browserMinFpsRatio * 100)}%以上・30fps 未満のフレーム ${String(PERF_TARGETS.browserMaxSlowFrameRatio * 100)}%以下。出した直後の1秒を除く）：${v.ok ? "合格" : "不合格"}（${v.fps.toFixed(1)}fps・${(v.slowRatio * 100).toFixed(1)}%）`,
  );
  if (!v.ok) process.exitCode = 1;
  if (errors.length > 0) {
    console.error(`ページのエラー：\n${errors.join("\n")}`);
    process.exitCode = 1;
  }
} finally {
  await browser.close();
  await server.close();
}
