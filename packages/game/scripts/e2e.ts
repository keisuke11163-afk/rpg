/**
 * 操作の自動の確認（pnpm e2e）：開発サーバーでゲームを開き、実際のキー・マウスの入力で動きを確かめる。
 * 開発版のビルドでだけ使える状態の確認用の関数（src/debug.ts）を使う。
 * Playwright は、この開発環境に入っているものを使う。CI では実行しない。
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

interface Mouse {
  move(x: number, y: number): Promise<void>;
  down(options?: { button: "left" | "right" }): Promise<void>;
  up(options?: { button: "left" | "right" }): Promise<void>;
}
interface Keyboard {
  down(key: string): Promise<void>;
  up(key: string): Promise<void>;
  press(key: string): Promise<void>;
}
interface Page {
  mouse: Mouse;
  keyboard: Keyboard;
  on(event: "pageerror", listener: (error: Error) => void): void;
  goto(url: string): Promise<unknown>;
  waitForFunction(
    fn: () => boolean,
    arg: undefined,
    options: { timeout: number },
  ): Promise<unknown>;
  evaluate<T>(fn: () => T): Promise<T>;
  waitForTimeout(ms: number): Promise<void>;
  screenshot(options: { path: string }): Promise<unknown>;
}
interface Browser {
  newPage(options: {
    viewport: { width: number; height: number };
    deviceScaleFactor: number;
  }): Promise<Page>;
  close(): Promise<void>;
}

interface PlayerState {
  x: number;
  y: number;
  direction8: number;
  stamina: number;
  dodging: boolean;
  invulnerable: boolean;
  screenX: number;
  screenY: number;
}
interface HazardState {
  hits: number;
  avoided: number;
  phase: number;
  x: number;
  y: number;
}
interface DummyState {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  hits: number;
  lastDamage: number;
  lastCrit: boolean;
  lastBackstab: boolean;
  shotsFired: number;
  projectilesActive: number;
  projectilePositions: number[][];
  screenX: number;
  screenY: number;
}
type DebugWindow = {
  __STELLA_DEBUG__: {
    player: () => PlayerState;
    hazard: () => HazardState;
    dummy: () => DummyState;
  };
};

const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as { chromium: { launch(): Promise<Browser> } };
const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = fileURLToPath(new URL("../../../artifacts/e2e/", import.meta.url));
mkdirSync(outDir, { recursive: true });

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string): void => {
  results.push({ name, ok, detail });
};

const server = await createServer({
  root,
  server: { port: 5174, strictPort: true },
  logLevel: "warn",
});
await server.listen();
const browser = await chromium.launch();
const errors: string[] = [];
try {
  // 画面は 640×360 を2倍に拡大して表示する（1ゲームピクセル＝画面の2ピクセル）
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:5174/");
  await page.waitForFunction(() => document.body.dataset["stellaReady"] === "true", undefined, {
    timeout: 20000,
  });
  const player = (): Promise<PlayerState> =>
    page.evaluate(() => (window as unknown as DebugWindow).__STELLA_DEBUG__.player());
  const hazard = (): Promise<HazardState> =>
    page.evaluate(() => (window as unknown as DebugWindow).__STELLA_DEBUG__.hazard());

  // 1. W を1秒押すと、上に約5m進む
  const start = await player();
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(1000);
  await page.keyboard.up("KeyW");
  const afterW = await player();
  const movedUp = start.y - afterW.y;
  check("Wで上に移動（毎秒5m）", movedUp > 3.5 && movedUp < 6.5, `上へ ${movedUp.toFixed(2)}m`);

  // 2. マウスをプレイヤーの左に置くと、見た目の向きが左（4）になる（画面は 640×360 を2倍で表示）
  const aimAt = async (dx: number, dy: number): Promise<void> => {
    const p = await player();
    await page.mouse.move((p.screenX + dx) * 2, (p.screenY + dy) * 2);
    await page.waitForTimeout(100);
  };
  const dir = async (): Promise<number> => (await player()).direction8;
  await aimAt(-80, 0);
  const left = await dir();
  check("マウスで照準（左）", left === 4, `向き ${String(left)}`);
  await aimAt(0, -80);
  const up = await dir();
  check("マウスで照準（上）", up === 6, `向き ${String(up)}`);
  await aimAt(80, 0);
  const right = await dir();
  check("マウスで照準（右）", right === 0, `向き ${String(right)}`);
  // 3. スペースで回避：照準の方向（右）へ約4m、気力を25使う
  const beforeDodge = await player();
  await page.keyboard.press("Space");
  await page.waitForTimeout(500);
  const afterDodge = await player();
  const dodged = afterDodge.x - beforeDodge.x;
  check("スペースで回避（約4m）", dodged > 3 && dodged < 4.6, `右へ ${dodged.toFixed(2)}m`);
  check(
    "回避で気力を使う",
    afterDodge.stamina < beforeDodge.stamina,
    `気力 ${beforeDodge.stamina.toFixed(0)} → ${afterDodge.stamina.toFixed(0)}`,
  );

  // 4. 危険地帯の中に立っていると被弾する
  const h0 = await hazard();
  const here = await player();
  const holdKey = here.x < h0.x ? "KeyD" : "KeyA";
  await page.keyboard.down(holdKey);
  await page.waitForTimeout((Math.abs(h0.x - here.x) / 5) * 1000);
  await page.keyboard.up(holdKey);
  const vKey = (await player()).y < h0.y ? "KeyS" : "KeyW";
  await page.keyboard.down(vKey);
  await page.waitForTimeout((Math.abs(h0.y - (await player()).y) / 5) * 1000);
  await page.keyboard.up(vKey);
  await page.waitForTimeout(4500);
  const h1 = await hazard();
  check(
    "危険地帯の中に立つと被弾する",
    h1.hits > h0.hits,
    `被弾 ${String(h0.hits)} → ${String(h1.hits)}`,
  );

  // 5. 当たり判定が出る直前に回避すると、無敵時間で無効になる（最大5回試す）
  await aimAt(0, -80); // 上へ回避（当たり判定が出る時点では、まだ円の中にいる）
  let avoided = false;
  for (let attempt = 0; attempt < 5 && !avoided; attempt++) {
    await page.waitForFunction(
      () => {
        const p = (window as unknown as DebugWindow).__STELLA_DEBUG__.hazard().phase;
        return p > 0.5 && p < 0.56;
      },
      undefined,
      { timeout: 5000 },
    );
    const before = (await hazard()).avoided;
    await page.keyboard.press("Space");
    await page.waitForTimeout(600);
    avoided = (await hazard()).avoided > before;
    // 次の試行のために、危険地帯の中心に戻る
    await page.keyboard.down("KeyS");
    await page.waitForTimeout(800);
    await page.keyboard.up("KeyS");
  }
  check(
    "回避の無敵時間で、危険地帯の当たり判定が無効になる",
    avoided,
    `回避で無効：${String((await hazard()).avoided)}回`,
  );

  // 6〜8. 訓練用の人形を攻撃する
  const dummy = (): Promise<DummyState> =>
    page.evaluate(() => (window as unknown as DebugWindow).__STELLA_DEBUG__.dummy());
  /** WASD で目的の位置まで歩く（毎秒5m。少しずつ近づける）。 */
  const walkTo = async (tx: number, ty: number): Promise<void> => {
    for (let i = 0; i < 6; i++) {
      const p = await player();
      const dx = tx - p.x;
      const dy = ty - p.y;
      if (Math.abs(dx) < 0.15 && Math.abs(dy) < 0.15) return;
      if (Math.abs(dx) >= 0.15) {
        const key = dx > 0 ? "KeyD" : "KeyA";
        await page.keyboard.down(key);
        await page.waitForTimeout(Math.max(20, (Math.abs(dx) / 5) * 1000 - 20));
        await page.keyboard.up(key);
      }
      if (Math.abs(dy) >= 0.15) {
        const key = dy > 0 ? "KeyS" : "KeyW";
        await page.keyboard.down(key);
        await page.waitForTimeout(Math.max(20, (Math.abs(dy) / 5) * 1000 - 20));
        await page.keyboard.up(key);
      }
    }
  };
  /** 人形に照準を合わせて左クリックし、攻撃が終わるまで待つ。 */
  const clickDummy = async (button: "left" | "right" = "left"): Promise<void> => {
    const d = await dummy();
    await page.mouse.move(d.screenX * 2, d.screenY * 2);
    await page.waitForTimeout(50);
    await page.mouse.down({ button });
    await page.waitForTimeout(30);
    await page.mouse.up({ button });
    await page.waitForTimeout(900);
  };
  const d0 = await dummy();
  await walkTo(d0.x - 1.2, d0.y);
  await clickDummy();
  const d1 = await dummy();
  check(
    "通常攻撃で人形のHPが減る（下級の長剣 6–11、会心で×1.5）",
    d1.hits === d0.hits + 1 && d1.lastDamage >= 6 && d1.lastDamage <= 16.5 && d1.hp < d0.hp,
    `ヒット ${String(d1.hits - d0.hits)}回・ダメージ ${d1.lastDamage.toFixed(1)}・HP ${d0.hp.toFixed(0)} → ${d1.hp.toFixed(0)}`,
  );
  check("正面からのヒットは背面ではない", !d1.lastBackstab, `背面 ${String(d1.lastBackstab)}`);

  // 人形は左を向いているので、右側（背後）に回り込んで攻撃する
  await walkTo(d0.x, d0.y - 2);
  await walkTo(d0.x + 1.2, d0.y - 2);
  await walkTo(d0.x + 1.2, d0.y);
  await clickDummy();
  const d2 = await dummy();
  check(
    "背後からのヒットを背面と判定する",
    d2.hits === d1.hits + 1 && d2.lastBackstab,
    `ヒット ${String(d2.hits - d1.hits)}回・背面 ${String(d2.lastBackstab)}`,
  );

  // 離れた位置から、右クリックで試験用の投射物を撃つ
  await walkTo(d0.x - 6, d0.y);
  await clickDummy("right");
  const d3 = await dummy();
  const pp = await player();
  check(
    "投射物が人形に当たる",
    d3.hits === d2.hits + 1,
    `ヒット ${String(d3.hits - d2.hits)}回・撃った数 ${String(d3.shotsFired - d2.shotsFired)}・飛んでいる数 ${String(d3.projectilesActive)}・プレイヤー (${pp.x.toFixed(1)}, ${pp.y.toFixed(1)})・向き ${String(pp.direction8)}・投射物 ${JSON.stringify(d3.projectilePositions.map((v) => v.map((n) => Number(n.toFixed(2)))))}・人形 (${d3.x.toFixed(1)}, ${d3.y.toFixed(1)})`,
  );

  await page.screenshot({ path: `${outDir}arena.png` });
} finally {
  await browser.close();
  await server.close();
}

for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.name}（${r.detail}）`);
if (errors.length > 0) console.error(`ページのエラー：\n${errors.join("\n")}`);
const failed = results.filter((r) => !r.ok).length + errors.length;
console.log(failed === 0 ? "操作の確認：全て合格" : `操作の確認：${String(failed)}件の失敗`);
process.exit(failed === 0 ? 0 : 1);
