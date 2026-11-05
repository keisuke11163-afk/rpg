/**
 * 操作の自動の確認（pnpm e2e）：開発サーバーでゲームを開き、実際のキー・マウスの入力で動きを確かめる。
 * 開発版のビルドでだけ使える状態の確認用の関数（src/debug.ts）を使う。
 * Playwright は、この開発環境に入っているものを使う。CI では実行しない。
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { PANEL, cellPosition } from "../src/ui/panel-layout.ts";

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
  waitForFunction<A>(
    fn: (arg: A) => boolean,
    arg: A,
    options: { timeout: number },
  ): Promise<unknown>;
  evaluate<T>(fn: () => T): Promise<T>;
  evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<T>;
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
  dodgePending: boolean;
  totalSteps: number;
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
  lastAilments: string[];
  broken: boolean;
  statuses: string[];
  screenX: number;
  screenY: number;
}
interface SkillState {
  weapon: string | null;
  affinity: string;
  attackSpeed: number;
  mp: number;
  fervor: number;
  stages: string[];
  executing: string | null;
  lastSkill: string | null;
  lastVariants: string[];
  uses: Record<string, number>;
  buffs: string[];
  cooldowns: Record<string, number>;
  job: string;
  jobLevel: number;
  jobLevels: Record<string, number>;
  level: number;
  xp: number;
  traps: number;
  smokes: number;
}
interface EnemyInfo {
  id: string;
  def: string;
  group: string;
  rank: string;
  state: string;
  attack: string | null;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
}
interface LootInfo {
  id: number;
  kind: string;
  x: number;
  y: number;
  rarity: string | null;
  label: string;
}
interface InventoryInfo {
  items: { uid: string; base: string; rarity: string }[];
  gold: number;
  materials: Record<string, number>;
}
interface PlayerCombat {
  hp: number;
  maxHp: number;
  hitsTaken: number;
  avoided: number;
  deaths: number;
  staggered: boolean;
  poison: number;
  enemyHits: number;
  kills: number;
}
type DebugWindow = {
  __STELLA_DEBUG__: {
    player: () => PlayerState;
    hazard: () => HazardState;
    dummy: () => DummyState;
    skills: () => SkillState;
    setFervor: (value: number) => number;
    enemies: () => EnemyInfo[];
    playerState: () => PlayerCombat;
    spawnEnemy: (id: string) => string;
    grantXp: (value: number) => number;
    loot: () => LootInfo[];
    inventory: () => InventoryInfo;
    dropLoot: () => number;
    setFrameDeltaMs: (ms: number | null) => void;
    panel: () => PanelInfo;
    assignSkill: (index: number, skill: string) => boolean;
    saveNow: () => boolean;
    stars: () => StarsInfo;
    grantMaterial: (id: string, n: number) => number;
    itemDetail: (
      uid: string,
    ) => { rarity: string; affixes: number; enhance: number; forgeLoad: number } | null;
    starNodeScreen: (id: string) => { x: number; y: number } | null;
    saves: () => SavesInfo;
  };
};
interface StarsInfo {
  allocated: string[];
  active: string[];
  dormant: Record<string, string>;
  points: number;
  attributes: { go: number; jin: number; ri: number; kon: number };
  lamps: number;
}
interface SavesInfo {
  status: string;
  slots: { slot: number; state: string; name: string | null; level: number | null }[];
  keys: string[];
}
interface PanelInfo {
  open: string | null;
  lines: string[];
  sheet: { hp: number; mp: number; attackSpeed: number };
}

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

  // 3b. 刻みが0の描画のフレームで押した回避を取りこぼさない（実際の ArenaScene.update とキーの入力）
  //     描画のフレームの経過時間を0に固定し、その間にスペースを押して離す
  const setFrameDelta = (ms: number | null): Promise<void> =>
    page.evaluate((v: number | null) => {
      (window as unknown as DebugWindow).__STELLA_DEBUG__.setFrameDeltaMs(v);
    }, ms);
  await page.waitForTimeout(500); // 回避が終わり、気力が少し回復するのを待つ
  await setFrameDelta(0);
  await page.waitForTimeout(100);
  const zeroBefore = await player();
  await page.keyboard.press("Space");
  await page.waitForTimeout(300); // 刻みが0のフレームが何回も続く
  const zeroHeld = await player();
  check(
    "刻みが0のフレームで押した回避を保持する",
    zeroHeld.dodgePending &&
      !zeroHeld.dodging &&
      zeroHeld.totalSteps === zeroBefore.totalSteps &&
      zeroHeld.stamina === zeroBefore.stamina &&
      zeroHeld.x === zeroBefore.x,
    `保持 ${String(zeroHeld.dodgePending)}、刻み ${String(zeroHeld.totalSteps - zeroBefore.totalSteps)}`,
  );
  // 1刻み（1/60秒）ちょうどのフレームにすると、次の刻みで1回だけ発動する
  await setFrameDelta(1000 / 60);
  await page.waitForTimeout(1000);
  await setFrameDelta(null);
  const zeroAfter = await player();
  const zeroDodged = zeroAfter.x - zeroHeld.x;
  check(
    "保持した回避が次の刻みで1回だけ発動する",
    !zeroAfter.dodgePending && zeroDodged > 3.9 && zeroDodged < 4.1,
    `右へ ${zeroDodged.toFixed(2)}m`,
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
    "通常攻撃で人形のHPが減る（下級の大剣 14–24、技レベル3・剛20、会心で×1.5）",
    d1.hits === d0.hits + 1 && d1.lastDamage >= 14 && d1.lastDamage <= 39 && d1.hp < d0.hp,
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

  // 9〜15. 戦士の技（仕様書v0.2 5.2）
  const skills = (): Promise<SkillState> =>
    page.evaluate(() => (window as unknown as DebugWindow).__STELLA_DEBUG__.skills());
  const setFervor = (value: number): Promise<number> =>
    page.evaluate(
      (v: number) => (window as unknown as DebugWindow).__STELLA_DEBUG__.setFervor(v),
      value,
    );
  /** 人形に照準を合わせて、キーで技を使い、動作が終わるまで待つ。 */
  const waitIdle = (): Promise<unknown> =>
    page.waitForFunction(
      () => (window as unknown as DebugWindow).__STELLA_DEBUG__.skills().executing === null,
      undefined,
      { timeout: 5000 },
    );
  const keyAtDummy = async (key: string, wait = 1000): Promise<void> => {
    await waitIdle();
    const d = await dummy();
    await page.mouse.move(d.screenX * 2, d.screenY * 2);
    await page.waitForTimeout(50);
    await page.keyboard.press(key);
    await page.waitForTimeout(wait);
  };

  const s0 = await skills();
  const d4a = await dummy();
  await waitIdle();
  await clickDummy("right");
  const s1 = await skills();
  const d4 = await dummy();
  check(
    "右クリックで薙ぎ払い（MP4・大剣は範囲+20%・適性S）",
    (s1.uses["SKL-WARRIOR-SWEEP"] ?? 0) === 1 &&
      d4.hits === d4a.hits + 1 &&
      s1.lastVariants.includes("weapon:TAG-WPN-GREATSWORD") &&
      s1.affinity === "S",
    `使った回数 ${String(s1.uses["SKL-WARRIOR-SWEEP"] ?? 0)}・ヒット ${String(d4.hits - d4a.hits)}・変化 ${s1.lastVariants.join(",")}・適性 ${s1.affinity}・MP ${s0.mp.toFixed(1)} → ${s1.mp.toFixed(1)}`,
  );
  check(
    "ヒットで闘志が増える",
    s1.fervor > s0.fervor,
    `闘志 ${s0.fervor.toFixed(0)} → ${s1.fervor.toFixed(0)}`,
  );

  await keyAtDummy("Digit2");
  const s2 = await skills();
  const d5 = await dummy();
  check(
    "2キーで戦吼：自分の攻撃+15%・人形に威圧・闘志+20",
    s2.buffs.includes("EFF-WARRIOR-WARCRY-ATTACK") &&
      d5.statuses.includes("EFF-WARRIOR-INTIMIDATE") &&
      s2.fervor >= s1.fervor + 19,
    `効果 ${s2.buffs.join(",")}・人形 ${d5.statuses.join(",")}・闘志 ${s1.fervor.toFixed(0)} → ${s2.fervor.toFixed(0)}`,
  );

  // T6：インベントリの画面（I）で大斧をクリックして持ち替えると、薙ぎ払いが斧の変化（出血の付与率+30%）になる
  const panel = (): Promise<PanelInfo> =>
    page.evaluate(() => (window as unknown as DebugWindow).__STELLA_DEBUG__.panel());
  /** インベントリの枠の中央（ゲームの画面のピクセル）。 */
  const cellCenter = (index: number): { x: number; y: number } => {
    const c = cellPosition(index);
    return { x: c.x + PANEL.grid.cell / 2, y: c.y + PANEL.grid.cell / 2 };
  };
  await waitIdle();
  await page.keyboard.press("KeyI");
  await page.waitForTimeout(100);
  const axeIndex = (
    await page.evaluate(() => (window as unknown as DebugWindow).__STELLA_DEBUG__.inventory())
  ).items.findIndex((i) => i.uid === "test-greataxe");
  const axeCell = cellCenter(axeIndex);
  await page.mouse.move(axeCell.x * 2, axeCell.y * 2);
  await page.waitForTimeout(100);
  const tip = await panel();
  check(
    "I でインベントリの画面を開き、装備を指すとツールチップと比較が出る（U-12）",
    tip.open === "inventory" &&
      tip.lines.includes("下級の大斧") &&
      tip.lines.some((l) => l.includes("装備したときの変化")) &&
      tip.lines.some((l) => l.startsWith("通常攻撃の毎秒ダメージ")),
    `画面 ${String(tip.open)}・行 ${String(tip.lines.length)}・${tip.lines.filter((l) => l.includes("大斧") || l.startsWith("通常攻撃")).join("／")}`,
  );
  const hitsBeforeClick = (await dummy()).hits;
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(150);
  const swapped = await skills();
  check(
    "画面のクリックで大斧に持ち替え、クリックで技は出ない（U-12）",
    swapped.weapon === "test-greataxe" && (await dummy()).hits === hitsBeforeClick,
    `武器 ${String(swapped.weapon)}`,
  );
  await page.keyboard.press("KeyI");
  await page.waitForTimeout(100);
  const closed = await panel();
  check("I でインベントリの画面を閉じる", closed.open === null, `画面 ${String(closed.open)}`);
  await setFervor(0);
  await waitIdle();
  await clickDummy("right");
  const s3 = await skills();
  check(
    "大斧の薙ぎ払いは、斧の変化になる（T6）",
    s3.weapon === "test-greataxe" && s3.lastVariants.includes("weapon:TAG-WPNGRP-AXE"),
    `武器 ${String(s3.weapon)}・変化 ${s3.lastVariants.join(",")}`,
  );

  // T7：闘志50以上で激化、100で破軍
  await setFervor(60);
  await waitIdle();
  await clickDummy("right");
  const s4 = await skills();
  check(
    "闘志50以上で、薙ぎ払いが激化する（T7）",
    s4.lastVariants.includes("stage:empowered"),
    `闘志 ${s4.fervor.toFixed(0)}・変化 ${s4.lastVariants.join(",")}`,
  );
  // 技の枠（U-12）：キャラクターの画面で4キーの枠をクリックすると技が替わる。破軍を4キーの枠に入れる
  await waitIdle();
  await page.keyboard.press("KeyC");
  await page.waitForTimeout(100);
  const slotY = PANEL.skillSlots.y + 5 * PANEL.skillSlots.row + 4;
  const before4 = (await panel()).lines.find((l) => l.startsWith("4："));
  await page.mouse.move((PANEL.skillSlots.x + 20) * 2, slotY * 2);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(100);
  const after4 = (await panel()).lines.find((l) => l.startsWith("4："));
  check(
    "キャラクターの画面で技の枠をクリックすると、技が替わる（U-12）",
    before4 !== undefined && after4 !== undefined && before4 !== after4,
    `${String(before4)} → ${String(after4)}`,
  );
  await page.evaluate(() =>
    (window as unknown as DebugWindow).__STELLA_DEBUG__.assignSkill(5, "SKL-WARRIOR-ROUT"),
  );
  await page.keyboard.press("KeyC");
  await page.waitForTimeout(100);
  await setFervor(100);
  const d6a = await dummy();
  await keyAtDummy("Digit4", 1400);
  const s5 = await skills();
  const d6 = await dummy();
  check(
    "闘志100で、技の枠（4キー）に入れた破軍：闘志を全て使い、受けるダメージ-20%の効果を得る（T7）",
    (s5.uses["SKL-WARRIOR-ROUT"] ?? 0) === 1 &&
      s5.fervor <= 6 &&
      s5.buffs.includes("EFF-WARRIOR-ROUT-GUARD") &&
      d6.hits === d6a.hits + 1,
    `使った回数 ${String(s5.uses["SKL-WARRIOR-ROUT"] ?? 0)}・闘志 ${s5.fervor.toFixed(0)}・効果 ${s5.buffs.join(",")}・ダメージ ${d6.lastDamage.toFixed(0)}`,
  );

  // 突進：照準の方向（右）へ8m
  await waitIdle();
  const beforeCharge = await player();
  const ps = await player();
  await page.mouse.move((ps.screenX + 80) * 2, ps.screenY * 2);
  await page.waitForTimeout(80);
  await page.keyboard.press("Digit1");
  await page.waitForTimeout(700);
  const afterCharge = await player();
  const charged = afterCharge.x - beforeCharge.x;
  check("1キーで突進（右へ約8m）", charged > 7 && charged < 8.6, `右へ ${charged.toFixed(2)}m`);

  // 転職と盗賊（仕様書5.1・5.6）
  await waitIdle();
  const sw = await skills();
  await page.keyboard.press("KeyG");
  await page.waitForTimeout(100);
  const sr = await skills();
  check(
    "Gで転職：盗賊になり、ジョブLvは混ざらない（戦士はLv15のまま、盗賊はLv1から）",
    sr.job === "JOB-ROGUE" &&
      sr.jobLevel === 1 &&
      sr.jobLevels["JOB-WARRIOR"] === sw.jobLevel &&
      sr.weapon === "test-dagger",
    `ジョブ ${sw.job} → ${sr.job}・ジョブLv ${JSON.stringify(sr.jobLevels)}・武器 ${String(sr.weapon)}`,
  );
  await page.evaluate(
    (v: number) => (window as unknown as DebugWindow).__STELLA_DEBUG__.grantXp(v),
    30000,
  );
  const sg = await skills();
  check(
    "経験値は、キャラLvとメインジョブだけに入る（追いつき補正で盗賊は×2）",
    sg.level > sr.level &&
      sg.jobLevels["JOB-WARRIOR"] === sw.jobLevel &&
      sg.jobLevel > sg.level - 5,
    `キャラLv ${String(sr.level)} → ${String(sg.level)}・ジョブLv ${JSON.stringify(sg.jobLevels)}`,
  );
  await walkTo(d0.x - 1.2, d0.y);
  await waitIdle();
  const r0 = await dummy();
  await clickDummy("right");
  await waitIdle();
  const r1 = await dummy();
  const sc = await skills();
  check(
    "右クリックで連刃：短剣は3連撃、コンボ点+1",
    r1.hits === r0.hits + 3 && sc.fervor === 1,
    `ヒット ${String(r1.hits - r0.hits)}回・コンボ点 ${String(sc.fervor)}`,
  );
  await keyAtDummy("Digit1");
  await waitIdle();
  const r2 = await dummy();
  const sp = await skills();
  check(
    "1キーで急所穿ち：コンボ点を全て使う",
    r2.hits === r1.hits + 1 && sp.fervor === 0 && sp.lastSkill === "SKL-ROGUE-PIERCE",
    `ヒット ${String(r2.hits - r1.hits)}回・コンボ点 ${String(sp.fervor)}・ダメージ ${r2.lastDamage.toFixed(1)}`,
  );
  await keyAtDummy("Digit2", 600);
  const pt = await player();
  const dd = await dummy();
  check(
    "2キーで影走り：人形の背後（右側）へ瞬間移動",
    pt.x > dd.x + 0.5 && Math.abs(pt.y - dd.y) < 0.5,
    `プレイヤー (${pt.x.toFixed(2)}, ${pt.y.toFixed(2)})・人形 (${dd.x.toFixed(1)}, ${dd.y.toFixed(1)})`,
  );

  // 16〜19. 敵（補助仕様書10章）
  const enemies = (): Promise<EnemyInfo[]> =>
    page.evaluate(() => (window as unknown as DebugWindow).__STELLA_DEBUG__.enemies());
  const combat = (): Promise<PlayerCombat> =>
    page.evaluate(() => (window as unknown as DebugWindow).__STELLA_DEBUG__.playerState());
  const spawn = (id: string): Promise<string> =>
    page.evaluate(
      (v: string) => (window as unknown as DebugWindow).__STELLA_DEBUG__.spawnEnemy(v),
      id,
    );
  const enemy = async (id: string): Promise<EnemyInfo | undefined> =>
    (await enemies()).find((e) => e.id === id);
  /** 敵に照準を合わせる（画面の位置は、プレイヤーの画面の位置からの差で求める）。 */
  const aimAtEnemy = async (e: EnemyInfo): Promise<void> => {
    const p = await player();
    await page.mouse.move((p.screenX + (e.x - p.x) * 16) * 2, (p.screenY + (e.y - p.y) * 16) * 2);
  };

  const before = await combat();
  const groups = new Set((await enemies()).map((e) => e.group));
  check(
    "試験用の場に、第1章の敵6種類の群れがいる",
    ["wolves", "rats", "lizards", "boar", "bear", "saplings"].every((g) => groups.has(g)),
    `群れ ${[...groups].join(",")}`,
  );

  // 棘鼠：気づいて近づいてくる → 通常攻撃で倒す
  await waitIdle();
  const xpBeforeRat = (await skills()).xp;
  const levelBeforeRat = (await skills()).level;
  const ratId = await spawn("ENM-THORN-RAT");
  await page.waitForTimeout(500);
  const rat0 = await enemy(ratId);
  for (let i = 0; i < 6; i++) {
    const r = await enemy(ratId);
    if (r === undefined || r.state === "dead") break;
    await aimAtEnemy(r);
    await page.mouse.down();
    await page.waitForTimeout(30);
    await page.mouse.up();
    await page.waitForTimeout(950);
  }
  await page.waitForTimeout(700);
  const afterRat = await combat();
  check(
    "敵は視界に入ると気づいて追い、攻撃を受けると倒れる（経験値を得る）",
    rat0 !== undefined &&
      rat0.state !== "idle" &&
      afterRat.kills > before.kills &&
      ((await skills()).xp > xpBeforeRat || (await skills()).level > levelBeforeRat),
    `気づいた後の状態 ${rat0?.state ?? "なし"}・倒した数 ${String(before.kills)} → ${String(afterRat.kills)}・プレイヤーのヒット ${String(afterRat.enemyHits - before.enemyHits)}`,
  );

  // 樹皮熊：予兆を見て回避すると、攻撃を受けない
  const bearId = await spawn("ENM-BARK-BEAR");
  let dodgedClean = false;
  let detail = "";
  for (let attempt = 0; attempt < 4 && !dodgedClean; attempt++) {
    await page.waitForFunction(
      (id: string) =>
        (window as unknown as DebugWindow).__STELLA_DEBUG__
          .enemies()
          .some((e) => e.id === id && e.state === "windup"),
      bearId,
      { timeout: 8000 },
    );
    const b = await enemy(bearId);
    const c0 = await combat();
    // 照準を熊と反対に向けて、予兆の終わりの少し前に回避する
    const p = await player();
    if (b !== undefined) {
      await page.mouse.move((p.screenX - (b.x - p.x) * 16) * 2, (p.screenY - (b.y - p.y) * 16) * 2);
    }
    await page.waitForTimeout(b?.attack === "slam" ? 650 : 250);
    await page.keyboard.press("Space");
    await page.waitForTimeout(900);
    const c1 = await combat();
    dodgedClean = c1.hitsTaken === c0.hitsTaken;
    detail = `攻撃 ${b?.attack ?? "?"}・被弾 ${String(c0.hitsTaken)} → ${String(c1.hitsTaken)}・回避で無効 ${String(c1.avoided)}`;
  }
  check("予兆のある攻撃は、回避できる（補助仕様書10.1）", dodgedClean, detail);

  // 回避しなければ当たる
  const c2 = await combat();
  await page
    .waitForFunction(
      (n: number) =>
        (window as unknown as DebugWindow).__STELLA_DEBUG__.playerState().hitsTaken > n,
      c2.hitsTaken,
      { timeout: 10000 },
    )
    .catch(() => undefined);
  const c3 = await combat();
  check(
    "回避しなければ、敵の攻撃を受ける",
    c3.hitsTaken > c2.hitsTaken,
    `被弾 ${String(c2.hitsTaken)} → ${String(c3.hitsTaken)}・HP ${c2.hp.toFixed(0)} → ${c3.hp.toFixed(0)}`,
  );

  // 地面の物と拾得（U-11、補助仕様書13章）
  const lootState = (): Promise<LootInfo[]> =>
    page.evaluate(() => (window as unknown as DebugWindow).__STELLA_DEBUG__.loot());
  const inv = (): Promise<InventoryInfo> =>
    page.evaluate(() => (window as unknown as DebugWindow).__STELLA_DEBUG__.inventory());
  // 拾った物が混ざらないように、今ある物を数えてから置く
  const inv0 = await inv();
  const placed = await page.evaluate(() =>
    (window as unknown as DebugWindow).__STELLA_DEBUG__.dropLoot(),
  );
  const near = (await lootState()).filter((d) => d.kind === "item");
  // プレイヤーの右1mに置いた（散らばりは1.2m以内）。近づいて、金貨は自動で拾う
  const pl = await player();
  await walkTo(pl.x + 1, pl.y);
  await page.waitForTimeout(200);
  const inv1 = await inv();
  check(
    "精鋭のドロップが地面に出て、金貨は近づくと自動で拾う",
    placed > 0 && near.length >= 2 && inv1.gold > inv0.gold,
    `置いた数 ${String(placed)}・装備 ${String(near.length)}・金貨 ${String(inv0.gold)} → ${String(inv1.gold)}`,
  );
  for (let i = 0; i < near.length; i++) {
    await page.keyboard.press("KeyF");
    await page.waitForTimeout(120);
  }
  const inv2 = await inv();
  check(
    "F で装備を拾い、インベントリに入る",
    inv2.items.length - inv0.items.length >= 1 &&
      inv2.items.length - inv0.items.length <= near.length,
    `インベントリ ${String(inv0.items.length)} → ${String(inv2.items.length)}（近くの装備 ${String(near.length)}）`,
  );

  // キャラクターの画面（C）：表示の数値と、戦闘の数値が一致する（U-12 の完了の条件）
  await page.keyboard.press("KeyC");
  await page.waitForTimeout(100);
  // 最大HPの行（能力値の一覧の1行目）を指す
  await page.mouse.move((PANEL.stats.x + 20) * 2, (PANEL.stats.y + 4) * 2);
  await page.waitForTimeout(100);
  const ch = await panel();
  const ps2 = await combat();
  const hpLine = ch.lines.find((l) => l.startsWith("最大HP"));
  check(
    "C でキャラクターの画面を開き、最大HPの表示が戦闘の最大HPと一致し、内訳が出る（U-12）",
    ch.open === "character" &&
      hpLine === `最大HP  ${String(ps2.maxHp)}` &&
      ch.sheet.hp === ps2.maxHp &&
      ch.lines.some((l) => l.startsWith("基礎 ")),
    `${String(hpLine)}・戦闘の最大HP ${String(ps2.maxHp)}`,
  );
  await page.screenshot({ path: `${outDir}character.png` });
  await page.keyboard.press("KeyI");
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${outDir}inventory.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  check(
    "Esc で画面を閉じる",
    (await panel()).open === null,
    `画面 ${String((await panel()).open)}`,
  );

  await page.screenshot({ path: `${outDir}arena.png` });

  // 星辰盤（U-14）：T で開き、始点の隣のノードをクリックで取る。能力値の小星で能力値が増える
  const stars = (): Promise<StarsInfo> =>
    page.evaluate(() => (window as unknown as DebugWindow).__STELLA_DEBUG__.stars());
  const st0 = await stars();
  await page.keyboard.press("KeyT");
  await page.waitForTimeout(150);
  const target = st0.allocated.length === 0 ? "STAR-JIN-0001" : null;
  const pos = await page.evaluate(
    (id: string) => (window as unknown as DebugWindow).__STELLA_DEBUG__.starNodeScreen(id),
    target ?? "STAR-JIN-0001",
  );
  if (pos !== null) {
    await page.mouse.move(pos.x * 2, pos.y * 2);
    await page.waitForTimeout(100);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(150);
  }
  const st1 = await stars();
  const boardPanel = await panel();
  check(
    "T で星辰盤を開き、始点の隣のノードをクリックで取ると、能力値の小星で迅が増える（U-14）",
    boardPanel.open === "starBoard" &&
      st1.allocated.includes("STAR-JIN-0001") &&
      st1.active.includes("STAR-JIN-0001") &&
      st1.attributes.jin === st0.attributes.jin + 10 &&
      boardPanel.lines.some((l) => l.startsWith("取得済み")),
    `取得 ${st1.allocated.join(",")}・迅 ${String(st0.attributes.jin)} → ${String(st1.attributes.jin)}・ポイント ${String(st1.allocated.length)}／${String(st1.points)}`,
  );
  await page.screenshot({ path: `${outDir}star-board.png` });
  await page.keyboard.press("KeyT");
  await page.waitForTimeout(100);

  // 鍛冶屋（U-17）：B で開き、装備を選んで強化する
  await page.evaluate(() =>
    (window as unknown as DebugWindow).__STELLA_DEBUG__.grantMaterial("MAT-MAGIC-DUST", 10),
  );
  await page.keyboard.press("KeyB");
  await page.waitForTimeout(100);
  const invNow = await inv();
  const pickIndex = invNow.items.findIndex((i) => i.uid === "test-axe");
  const pickCell = cellCenter(pickIndex);
  await page.mouse.move(pickCell.x * 2, pickCell.y * 2);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(100);
  // 操作の1行目（強化）をクリックする
  await page.mouse.move((PANEL.detail.x + 20) * 2, (PANEL.detail.y + 5) * 2);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(150);
  const axeAfter = await page.evaluate(() =>
    (window as unknown as DebugWindow).__STELLA_DEBUG__.itemDetail("test-axe"),
  );
  const smithPanel = await panel();
  check(
    "B で鍛冶屋を開き、装備を選んで強化すると +1 になる（U-17）",
    smithPanel.open === "smith" &&
      axeAfter?.enhance === 1 &&
      smithPanel.lines.some((l) => l.startsWith("下級の片手斧 +1")),
    `強化値 ${String(axeAfter?.enhance)}・${smithPanel.lines.find((l) => l.startsWith("下級の片手斧")) ?? "名前なし"}`,
  );
  await page.screenshot({ path: `${outDir}smith.png` });
  await page.keyboard.press("KeyB");
  await page.waitForTimeout(100);

  // セーブ・ロード（U-13）：保存してページを読み込み直すと、同じ状態から始まる
  const saves = (): Promise<SavesInfo> =>
    page.evaluate(() => (window as unknown as DebugWindow).__STELLA_DEBUG__.saves());
  const reload = async (): Promise<void> => {
    await page.goto("http://localhost:5174/");
    await page.waitForFunction(() => document.body.dataset["stellaReady"] === "true", undefined, {
      timeout: 20000,
    });
  };
  const saved = await page.evaluate(() =>
    (window as unknown as DebugWindow).__STELLA_DEBUG__.saveNow(),
  );
  const sv0 = await saves();
  const beforeReload = {
    skills: await skills(),
    inv: await inv(),
    hp: (await combat()).maxHp,
    stars: await stars(),
  };
  check(
    "セーブすると、スロット1に保存される（U-13）",
    saved && sv0.slots[0]?.state === "ok" && sv0.slots[1]?.state === "empty",
    `${sv0.status}・スロット ${sv0.slots.map((x) => `${String(x.slot)}:${x.state}`).join(",")}`,
  );
  await reload();
  const afterReload = {
    skills: await skills(),
    inv: await inv(),
    hp: (await combat()).maxHp,
    stars: await stars(),
  };
  check(
    "ページを読み込み直すと、セーブデータから同じ状態で始まる（Lv・ジョブ・武器・持ち物・金貨・最大HP・星辰盤）（U-13）",
    afterReload.skills.level === beforeReload.skills.level &&
      afterReload.skills.job === beforeReload.skills.job &&
      afterReload.skills.weapon === beforeReload.skills.weapon &&
      JSON.stringify(afterReload.skills.jobLevels) ===
        JSON.stringify(beforeReload.skills.jobLevels) &&
      afterReload.inv.gold === beforeReload.inv.gold &&
      afterReload.inv.items.length === beforeReload.inv.items.length &&
      afterReload.hp === beforeReload.hp &&
      JSON.stringify(afterReload.stars.allocated) ===
        JSON.stringify(beforeReload.stars.allocated) &&
      JSON.stringify(afterReload.stars.attributes) ===
        JSON.stringify(beforeReload.stars.attributes),
    `Lv ${String(beforeReload.skills.level)} → ${String(afterReload.skills.level)}・ジョブ ${afterReload.skills.job}・武器 ${String(afterReload.skills.weapon)}・金貨 ${String(beforeReload.inv.gold)} → ${String(afterReload.inv.gold)}・持ち物 ${String(afterReload.inv.items.length)}・最大HP ${String(afterReload.hp)}`,
  );
  // 壊れたデータ：読み込みでは上書きせず、新しく始める。保存するときに .corrupt に退避する
  await page.evaluate(() => {
    window.localStorage.setItem("stella-sigil/slot1", "壊れたデータ");
  });
  await reload();
  const sv1 = await saves();
  const started = await skills();
  await page.evaluate(() => (window as unknown as DebugWindow).__STELLA_DEBUG__.saveNow());
  const sv2 = await saves();
  const corrupt = await page.evaluate(() =>
    window.localStorage.getItem("stella-sigil/slot1.corrupt"),
  );
  check(
    "壊れたセーブデータは検出して新しく始め、元のデータは .corrupt に退避してから保存する（U-13）",
    sv1.status.includes("壊れている") &&
      sv1.slots[0]?.state === "corrupt" &&
      started.level === 15 &&
      sv2.slots[0]?.state === "ok" &&
      corrupt === "壊れたデータ",
    `${sv1.status}・保存の後 ${String(sv2.slots[0]?.state)}・退避 ${String(corrupt)}`,
  );
} finally {
  await browser.close();
  await server.close();
}

for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.name}（${r.detail}）`);
if (errors.length > 0) console.error(`ページのエラー：\n${errors.join("\n")}`);
const failed = results.filter((r) => !r.ok).length + errors.length;
console.log(failed === 0 ? "操作の確認：全て合格" : `操作の確認：${String(failed)}件の失敗`);
process.exit(failed === 0 ? 0 : 1);
