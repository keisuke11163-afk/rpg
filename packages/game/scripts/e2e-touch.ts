/**
 * スマホ（タッチ）操作の自動の確認（pnpm e2e の後半。docs/progress TOUCH-5）。
 * Playwright でタッチの端末を真似た文脈（hasTouch・isMobile・横長の画面）を作り、複数の指は CDP の
 * Input.dispatchTouchEvent で送る。座標はゲームの内部解像度（640×360）で考え、キャンバスの位置から画面の座標に直す。
 */
import { mkdirSync } from "node:fs";

interface CdpSession {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}
interface TouchPage {
  goto(url: string): Promise<unknown>;
  evaluate<T>(fn: () => T): Promise<T>;
  evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<T>;
  waitForFunction<A>(
    fn: (arg: A) => boolean,
    arg: A,
    options: { timeout: number },
  ): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  screenshot(options: { path: string }): Promise<unknown>;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  keyboard: { down(key: string): Promise<void>; up(key: string): Promise<void> };
  on(event: "pageerror", listener: (error: Error) => void): void;
  on(event: "console", listener: (message: { type(): string; text(): string }) => void): void;
}
interface TouchContext {
  newPage(): Promise<TouchPage>;
  newCDPSession(page: TouchPage): Promise<CdpSession>;
  close(): Promise<void>;
}
export interface TouchBrowser {
  newContext(options: {
    hasTouch?: boolean;
    isMobile?: boolean;
    viewport: { width: number; height: number };
    deviceScaleFactor: number;
  }): Promise<TouchContext>;
}

type Check = (name: string, ok: boolean, detail: string) => void;
interface Pt {
  x: number;
  y: number;
}
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface TouchInfo {
  active: boolean;
  setting: string;
  menuOpen: boolean;
  buttons: { id: string; x: number; y: number; r: number; visible: boolean; down: boolean }[];
  sticks: { left: { rest: Pt; active: boolean }; right: { rest: Pt; active: boolean } };
  ui: ({ id: string } & Rect)[];
  frame: { held: string[]; aim: Pt; aimDistance: number; move: Pt } | null;
  fingers: number;
  paused: boolean;
  layout: string;
}
interface PlayerInfo {
  x: number;
  y: number;
  direction8: number;
  stamina: number;
  dodging: boolean;
  totalSteps: number;
}

/** ページの開発用の確認の関数を呼ぶ。 */
type Debug = <T>(name: string, ...args: (string | number)[]) => Promise<T>;

function debugOf(page: TouchPage): Debug {
  return <T>(name: string, ...args: (string | number)[]): Promise<T> =>
    page.evaluate(
      ([n, a]: [string, (string | number)[]]) =>
        (
          window as unknown as {
            __STELLA_DEBUG__: Record<string, (...x: (string | number)[]) => unknown>;
          }
        ).__STELLA_DEBUG__[n]?.(...a) as T,
      [name, args] as [string, (string | number)[]],
    );
}

/** 指（CDP で送る。今触れている指を全て覚え、毎回まとめて送る）。 */
class Fingers {
  private readonly points = new Map<number, Pt>();
  private readonly cdp: CdpSession;
  private readonly page: TouchPage;
  /** キャンバスの位置（ゲームの座標 → 画面の座標）。 */
  private canvas = { left: 0, top: 0, k: 1 };

  constructor(cdp: CdpSession, page: TouchPage) {
    this.cdp = cdp;
    this.page = page;
  }

  async measure(): Promise<void> {
    this.canvas = await this.page.evaluate(() => {
      const r = document.querySelector("canvas")?.getBoundingClientRect();
      return r === undefined
        ? { left: 0, top: 0, k: 1 }
        : { left: r.left, top: r.top, k: r.width / 640 };
    });
  }

  /** ゲームの座標 → 画面（CSS ピクセル）の座標。 */
  client(p: Pt): Pt {
    return { x: this.canvas.left + p.x * this.canvas.k, y: this.canvas.top + p.y * this.canvas.k };
  }

  private list(): Record<string, number>[] {
    return [...this.points.entries()].map(([id, p]) => ({
      id,
      x: p.x,
      y: p.y,
      radiusX: 4,
      radiusY: 4,
      force: 1,
    }));
  }

  /** 指を置く（ゲームの座標。raw なら画面の座標のまま）。 */
  async start(id: number, p: Pt, raw = false): Promise<void> {
    this.points.set(id, raw ? p : this.client(p));
    await this.cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: this.list(),
    });
  }

  async move(id: number, p: Pt, raw = false): Promise<void> {
    this.points.set(id, raw ? p : this.client(p));
    await this.cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: this.list(),
    });
  }

  /** 1本の指を離す（残りの指は触れたまま）。 */
  async end(id: number): Promise<void> {
    this.points.delete(id);
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: this.list() });
  }

  /** 全ての指を取り消す（touchcancel）。 */
  async cancel(): Promise<void> {
    this.points.clear();
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  }

  /** 軽く触れて離す。 */
  async tap(p: Pt): Promise<void> {
    await this.start(90, p);
    await this.page.waitForTimeout(60);
    await this.end(90);
  }
}

const rectCenter = (r: Rect): Pt => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

/**
 * タッチの確認を全て行う。
 * @param url 開発サーバーの URL
 * @param outDir 撮影の置き場（artifacts/e2e-touch/）
 */
export async function runTouchChecks(
  browser: TouchBrowser,
  url: string,
  outDir: string,
  check: Check,
  errors: string[],
): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 1,
  });
  try {
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`（タッチ）${e.message}`));
    page.on("console", (m) => {
      // CDP の touchCancel は取り消せない出来事なので、Phaser の preventDefault に Chrome が出す警告は数えない
      if (m.type() === "error" && !/cancel a touchcancel event/.test(m.text()))
        errors.push(`（タッチ）[console] ${m.text()}`);
    });
    const cdp = await context.newCDPSession(page);
    const dbg = debugOf(page);
    const fingers = new Fingers(cdp, page);
    const ready = (scene: string): Promise<unknown> =>
      page.waitForFunction(
        (s: string) =>
          document.body.dataset["stellaReady"] === "true" &&
          document.body.dataset["stellaScene"] === s,
        scene,
        { timeout: 20000 },
      );
    await page.goto(url);
    await ready("title");
    await fingers.measure();
    await page.screenshot({ path: `${outDir}title.png` });
    // タイトルのスロットの行をタップで選べる（Phaser の pointerdown。指でも動く）
    await fingers.tap({ x: 320 - 150 + 40, y: 100 + 6 });
    await page.waitForTimeout(150);
    const title = await dbg<{ selected: number | null }>("title");
    check(
      "（タッチ）タイトル：スロットの行をタップで選べる",
      title.selected === 1,
      `選んだスロット ${String(title.selected)}`,
    );
    await dbg("startSlot", 1, "dev");
    await ready("arena");
    await page.waitForTimeout(300);
    const touch = (): Promise<TouchInfo> => dbg<TouchInfo>("touch");
    const player = (): Promise<PlayerInfo> => dbg<PlayerInfo>("player");
    const hud = (): Promise<{ view: { skillKeysVisible: number; layout: string } }> => dbg("hud");
    const t0 = await touch();
    const h0 = await hud();
    check(
      "（タッチ）タッチの端末で始めると、タッチの操作部が出て、PC の技の枠は出ない（HUD はタッチの配置）",
      t0.active &&
        t0.layout === "touch" &&
        h0.view.skillKeysVisible === 0 &&
        t0.buttons.length === 9,
      `タッチ ${String(t0.active)}・配置 ${t0.layout}・技の枠の文字 ${String(h0.view.skillKeysVisible)}・ボタン ${String(t0.buttons.length)}`,
    );
    await page.screenshot({ path: `${outDir}town.png` });

    // 試験用の場へ
    await dbg("goRegion", "DEV-ARENA");
    await ready("arena");
    await page.waitForTimeout(300);
    await fingers.measure();
    const left = t0.sticks.left.rest;
    const right = t0.sticks.right.rest;
    const button = (id: string): Pt => {
      const b = t0.buttons.find((x) => x.id === id);
      return b === undefined ? { x: 0, y: 0 } : { x: b.x, y: b.y };
    };
    const at = async (x: number, y: number): Promise<void> => {
      await dbg("teleportTo", x, y);
      await page.waitForTimeout(100);
    };

    // 1. 左スティックを右へ倒すと右へ動く。速さ（1刻みあたり）はキーボードの D と同じ
    // 速さは、動き始めてから少し後の区間で比べる（押し始めの遅れを入れない）
    await at(30, 30);
    await fingers.start(1, left);
    await fingers.move(1, { x: left.x + 30, y: left.y });
    await page.waitForTimeout(300);
    const m0 = await player();
    await fingers.move(1, { x: left.x + 60, y: left.y + 2 });
    await page.waitForTimeout(700);
    const m1 = await player();
    await fingers.end(1);
    await page.waitForTimeout(900);
    const touchSpeed = (m1.x - m0.x) / Math.max(1, m1.totalSteps - m0.totalSteps);
    await at(30, 30);
    await page.keyboard.down("KeyD");
    await page.waitForTimeout(300);
    const k0 = await player();
    await page.waitForTimeout(700);
    const k1 = await player();
    await page.keyboard.up("KeyD");
    const keySpeed = (k1.x - k0.x) / Math.max(1, k1.totalSteps - k0.totalSteps);
    check(
      "（タッチ）左スティックを右へ倒すと右へ動き、1刻みの速さはキーボードの D と同じ",
      m1.x - m0.x > 2.5 && Math.abs(m1.y - m0.y) < 0.6 && Math.abs(touchSpeed - keySpeed) < 0.002,
      `右へ ${(m1.x - m0.x).toFixed(2)}m・1刻み タッチ ${touchSpeed.toFixed(4)}m／D ${keySpeed.toFixed(4)}m`,
    );
    // キーを押すと PC の表示に戻る（auto）。1秒以上たってから触れると、タッチの表示に戻る
    await page.waitForTimeout(1100);
    const afterKey = await touch();
    await fingers.tap({ x: 320, y: 200 });
    await page.waitForTimeout(150);
    const backTouch = await touch();
    check(
      "（タッチ）自動の切り替え：キーを押すと PC の表示になり、触れるとタッチの表示に戻る",
      !afterKey.active && backTouch.active,
      `キーの後 ${String(afterKey.active)}・触れた後 ${String(backTouch.active)}`,
    );

    // 2. 右スティックを倒すと、その向きに照準が向き、通常攻撃が出る。離すと止まる
    await at(17, 12);
    const skills = (): Promise<{ uses: Record<string, number> }> => dbg("skills");
    const basic = async (): Promise<number> => (await skills()).uses["SKL-BASIC-ATTACK"] ?? 0;
    const a0 = await basic();
    await fingers.start(2, right);
    await fingers.move(2, { x: right.x + 20, y: right.y });
    await fingers.move(2, { x: right.x + 34, y: right.y });
    await page.waitForTimeout(700);
    const aim1 = await dbg<{ x: number; y: number }>("aim");
    const p1 = await player();
    const a1 = await basic();
    await page.screenshot({ path: `${outDir}battle-aim.png` });
    await fingers.end(2);
    await page.waitForTimeout(400);
    const a2 = await basic();
    await page.waitForTimeout(600);
    const a3 = await basic();
    check(
      "（タッチ）右スティックを右へ倒すと、照準が右を向き、通常攻撃が出る（使った回数が増える）。離すと止まる",
      aim1.x > p1.x * 16 + 8 && p1.direction8 === 0 && a1 > a0 && a3 === a2,
      `照準 ${(aim1.x / 16 - p1.x).toFixed(1)}m 右・向き ${String(p1.direction8)}・回数 ${String(a0)} → ${String(a1)}・離した後 ${String(a2)} → ${String(a3)}`,
    );

    // 3. 左で動きながら、右で狙って攻撃（2本の指を同時に）。通常攻撃の間は、技の移動の倍率で遅くなる（PC も同じ）
    await at(40, 30);
    const b0 = await basic();
    const q0 = await player();
    await fingers.start(3, left);
    await fingers.move(3, { x: left.x, y: left.y - 40 });
    await fingers.start(4, right);
    await fingers.move(4, { x: right.x - 34, y: right.y });
    await page.waitForTimeout(800);
    const q1 = await player();
    const b1 = await basic();
    const tm = await touch();
    await page.screenshot({ path: `${outDir}battle-twin.png` });
    await fingers.end(4);
    await fingers.end(3);
    await page.waitForTimeout(200);
    check(
      "（タッチ）左で上へ動きながら、右で左を狙って通常攻撃（2本の指を同時に）",
      q0.y - q1.y > 0.2 && b1 > b0 && q1.direction8 === 4 && tm.fingers === 2,
      `上へ ${(q0.y - q1.y).toFixed(2)}m・回数 ${String(b0)} → ${String(b1)}・向き ${String(q1.direction8)}・指 ${String(tm.fingers)}`,
    );

    // 4. タップしただけでは通常攻撃が出ない（指をマウスの左クリックとして扱わない）
    const c0 = await basic();
    await fingers.tap({ x: 320, y: 200 });
    await fingers.tap({ x: 330, y: 120 });
    await fingers.tap(right);
    await page.waitForTimeout(400);
    const c1 = await basic();
    check(
      "（タッチ）画面の何も無い所・右スティックを軽くタップしただけでは、通常攻撃が出ない",
      c1 === c0,
      `回数 ${String(c0)} → ${String(c1)}`,
    );

    // 5. 技のボタン：突進（戦士）を技の枠3に入れる。タップで今の照準（左）へ、ドラッグで狙った向き（右）へ出る
    await dbg("assignSkill", 2, "SKL-WARRIOR-CHARGE");
    await page.waitForTimeout(100);
    await at(40, 30);
    const d0 = await player();
    await fingers.tap(button("skill3"));
    await page.waitForTimeout(900);
    const d1 = await player();
    await at(40, 30);
    // 突進の CD が終わるのを待つ
    await page.waitForFunction(
      () =>
        (
          window as unknown as {
            __STELLA_DEBUG__: { skills: () => { cooldowns: Record<string, number> } };
          }
        ).__STELLA_DEBUG__.skills().cooldowns["SKL-WARRIOR-CHARGE"] === 0,
      undefined,
      { timeout: 15000 },
    );
    await page.waitForTimeout(100);
    const d2 = await player();
    const s3 = button("skill3");
    await fingers.start(5, s3);
    await page.waitForTimeout(20);
    await fingers.move(5, { x: s3.x + 15, y: s3.y });
    await fingers.move(5, { x: s3.x + 40, y: s3.y });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${outDir}battle-skill-drag.png` });
    await page.waitForTimeout(550);
    await fingers.end(5);
    const d3 = await player();
    check(
      "（タッチ）技のボタン：タップで覚えている照準（左）へ、押したまま右へドラッグすると右へ出る（突進 8m）",
      d0.x - d1.x > 5 && d3.x - d2.x > 5,
      `タップ：左へ ${(d0.x - d1.x).toFixed(2)}m・ドラッグ：右へ ${(d3.x - d2.x).toFixed(2)}m`,
    );

    // 6. 回避・薬瓶のボタン
    await page.waitForTimeout(800);
    await at(40, 30);
    const e0 = await player();
    await fingers.tap(button("dodge"));
    await page.waitForTimeout(80);
    const e1 = await player();
    const flasks = async (): Promise<number[]> =>
      (await dbg<{ model: { flasks: { charges: number }[] } }>("hud")).model.flasks.map(
        (f) => f.charges,
      );
    const f0 = await flasks();
    await fingers.tap(button("flaskHp"));
    await page.waitForTimeout(150);
    await fingers.tap(button("flaskMp"));
    await page.waitForTimeout(150);
    const f1 = await flasks();
    check(
      "（タッチ）回避のボタンで回避し（気力を使う）、薬瓶のボタンで HP・MP の瓶を使う",
      (e1.dodging || e1.stamina < e0.stamina) &&
        f1[0] === (f0[0] ?? 0) - 1 &&
        f1[1] === (f0[1] ?? 0) - 1,
      `回避 ${String(e1.dodging)}・気力 ${e0.stamina.toFixed(0)} → ${e1.stamina.toFixed(0)}・瓶 ${f0.join("/")} → ${f1.join("/")}`,
    );

    // 7. 指を離さずに取り消された（touchcancel）・画面の外で離した後、押しっぱなしにならない
    await at(40, 30);
    await fingers.start(6, left);
    await fingers.move(6, { x: left.x + 40, y: left.y });
    await page.waitForTimeout(200);
    await fingers.cancel();
    await page.waitForTimeout(200);
    const g0 = await player();
    await page.waitForTimeout(400);
    const g1 = await player();
    const gt = await touch();
    const h0b = await basic();
    await fingers.start(7, right);
    await fingers.move(7, { x: right.x + 34, y: right.y });
    await page.waitForTimeout(200);
    // 画面の左の外（キャンバスの外の余白）まで動かして離す
    await fingers.move(7, { x: 1, y: 200 }, true);
    await fingers.end(7);
    await page.waitForTimeout(400);
    const h1 = await basic();
    await page.waitForTimeout(500);
    const h2 = await basic();
    const gt2 = await touch();
    check(
      "（タッチ）指が取り消された・画面の外で離した後、移動・攻撃が押しっぱなしにならない",
      Math.abs(g1.x - g0.x) < 0.01 &&
        gt.fingers === 0 &&
        h2 === h1 &&
        h1 >= h0b &&
        gt2.fingers === 0,
      `取り消し後の移動 ${(g1.x - g0.x).toFixed(3)}m・指 ${String(gt.fingers)}／${String(gt2.fingers)}・攻撃 ${String(h1)} → ${String(h2)}`,
    );

    // 8. 町の施設の近くで、調べるのボタン（F）が出て、押すと施設の画面が開く
    await dbg("goRegion", "REGION-TOWN");
    await ready("arena");
    await page.waitForTimeout(300);
    const region = await dbg<{ facilities: { kind: string; x: number; y: number }[] }>("region");
    const smith = region.facilities.find((f) => f.kind === "smith");
    await at(smith?.x ?? 0, (smith?.y ?? 0) + 1.5);
    await page.waitForTimeout(200);
    const ti = await touch();
    const interact = ti.buttons.find((b) => b.id === "interact");
    await page.screenshot({ path: `${outDir}town-interact.png` });
    await fingers.tap(button("interact"));
    await page.waitForTimeout(200);
    const panel = (): Promise<{ open: string | null; zoom: number }> => dbg("panel");
    const pf = await panel();
    check(
      "（タッチ）町の鍛冶屋の近くで「調べる」のボタンが出て、押すと鍛冶屋の画面が開く",
      interact?.visible === true && pf.open === "smith",
      `ボタン ${String(interact?.visible)}・画面 ${String(pf.open)}`,
    );
    // 閉じるのボタン
    const closeRect = (await touch()).ui.find((u) => u.id === "close");
    if (closeRect !== undefined) await fingers.tap(rectCenter(closeRect));
    await page.waitForTimeout(200);
    const pc = await panel();
    check(
      "（タッチ）画面を開いている間は「閉じる」のボタンが出て、押すと閉じる",
      closeRect !== undefined && pc.open === null,
      `閉じる ${String(closeRect !== undefined)}・画面 ${String(pc.open)}`,
    );

    // 9. メニュー（≡）からインベントリを開き、2回のタップで装備する。閉じる
    const ui = async (id: string): Promise<Pt | undefined> => {
      const r = (await touch()).ui.find((u) => u.id === id);
      return r === undefined ? undefined : rectCenter(r);
    };
    const tapUi = async (id: string): Promise<boolean> => {
      const p = await ui(id);
      if (p === undefined) return false;
      await fingers.tap(p);
      await page.waitForTimeout(200);
      return true;
    };
    await tapUi("menu");
    const menu = await touch();
    await page.screenshot({ path: `${outDir}menu.png` });
    await tapUi("inventory");
    const pi = await panel();
    check(
      "（タッチ）「≡」でメニューが開き（インベントリ・キャラクター・星辰盤・職紋盤・地図・設定・名前を全て表示）、インベントリを開ける",
      menu.menuOpen &&
        ["inventory", "character", "starBoard", "jobBoard", "map", "settings", "showLoot"].every(
          (id) => menu.ui.some((u) => u.id === id),
        ) &&
        pi.open === "inventory",
      `メニュー ${menu.ui.map((u) => u.id).join(",")}・画面 ${String(pi.open)}`,
    );
    const inv = (): Promise<{ items: { uid: string }[] }> => dbg("inventory");
    const weapon = async (): Promise<string | null> =>
      (await dbg<{ weapon: string | null }>("skills")).weapon;
    const i0 = await inv();
    const w0 = await weapon();
    // インベントリの1つ目の升（panel-layout の grid）
    const cell = { x: 176 + 7, y: 52 + 7 };
    await fingers.tap(cell);
    await page.waitForTimeout(150);
    const w1 = await weapon();
    await page.screenshot({ path: `${outDir}inventory.png` });
    await fingers.tap(cell);
    await page.waitForTimeout(150);
    const w2 = await weapon();
    check(
      "（タッチ）インベントリ：1回目のタップでは説明だけ（装備しない）、同じ物をもう一度タップすると装備する",
      i0.items.length > 0 && w1 === w0 && w2 !== w0,
      `武器 ${String(w0)} → 1回目 ${String(w1)} → 2回目 ${String(w2)}`,
    );
    await tapUi("close");
    // 10. キャラクターの画面：技の枠を長押し（右クリック＝前の技）、タップ（左クリック＝次の技）で戻る
    await tapUi("menu");
    await tapUi("character");
    const slots = async (): Promise<string[]> => (await dbg<{ slots: string[] }>("subJob")).slots;
    const l0 = await slots();
    // 技の枠（PANEL.skillSlots）の3つ目の行
    const slotRow = { x: 340 + 40, y: 246 + 2 * 11 + 5 };
    await fingers.start(8, slotRow);
    await page.waitForTimeout(700);
    await fingers.end(8);
    await page.waitForTimeout(150);
    const l1 = await slots();
    await page.screenshot({ path: `${outDir}character-longpress.png` });
    await fingers.tap(slotRow);
    await page.waitForTimeout(150);
    const l2 = await slots();
    check(
      "（タッチ）長押し（0.45秒）＝右クリック：キャラクターの画面の技の枠が前の技になり、離したときに左クリックは出ない。タップで戻る",
      l1[2] !== l0[2] && l2[2] === l0[2],
      `枠3 ${String(l0[2])} → 長押し ${String(l1[2])} → タップ ${String(l2[2])}`,
    );
    await tapUi("close");

    // 11. 星辰盤：2本指のピンチで拡大率が変わる。「＋」「−」でも変わる
    await tapUi("menu");
    await tapUi("starBoard");
    const z0 = (await panel()).zoom;
    await fingers.start(10, { x: 140, y: 190 });
    await fingers.start(11, { x: 200, y: 190 });
    await page.waitForTimeout(50);
    for (let i = 1; i <= 5; i++) {
      await fingers.move(10, { x: 140 - i * 10, y: 190 });
      await fingers.move(11, { x: 200 + i * 10, y: 190 });
      await page.waitForTimeout(30);
    }
    await fingers.end(11);
    await fingers.end(10);
    await page.waitForTimeout(150);
    const z1 = (await panel()).zoom;
    await page.screenshot({ path: `${outDir}star-board.png` });
    await tapUi("zoomOut");
    const z2 = (await panel()).zoom;
    check(
      "（タッチ）星辰盤：2本指で広げると拡大し、「−」のボタンで縮小する",
      z1 > z0 * 1.2 && z2 < z1,
      `拡大率 ${z0.toFixed(2)} → ピンチ ${z1.toFixed(2)} → − ${z2.toFixed(2)}`,
    );
    await tapUi("close");

    // 12. 設定の画面（メニューの「設定」）に「スマホの操作部」の行がある
    await tapUi("menu");
    await tapUi("settings");
    const se = await dbg<{ rows: { label: string }[] }>("settings");
    await page.screenshot({ path: `${outDir}settings.png` });
    check(
      "（タッチ）メニューの「設定」で設定の画面が開き、「スマホの操作部」の行がある",
      (await panel()).open === "settings" &&
        se.rows.some((r) => r.label.startsWith("スマホの操作部")),
      `行 ${se.rows
        .map((r) => r.label)
        .slice(-5)
        .join("・")}`,
    );
    await tapUi("close");

    // 13. 縦持ち：「端末を横向きにしてください」が出て、シミュレーションの時間が進まない。横に戻すと再開
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    const v0 = await player();
    await page.waitForTimeout(600);
    const v1 = await player();
    const overlay = await page.evaluate(
      () => document.getElementById("stella-portrait")?.style.display ?? "none",
    );
    const vt = await touch();
    await page.screenshot({ path: `${outDir}portrait.png` });
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(400);
    const v2 = await player();
    await page.waitForTimeout(400);
    const v3 = await player();
    check(
      "（タッチ）縦持ちでは「端末を横向きにしてください」が出て、時間が進まない。横に戻すと再開する",
      overlay === "flex" &&
        vt.paused &&
        v1.totalSteps === v0.totalSteps &&
        v3.totalSteps > v2.totalSteps,
      `画面 ${overlay}・止める ${String(vt.paused)}・刻み ${String(v1.totalSteps - v0.totalSteps)}（縦）／${String(v3.totalSteps - v2.totalSteps)}（横）`,
    );

    // 14. 画面の比率が違う端末：操作部がキャンバス（＝画面）の中に収まる。戦闘中を撮る
    await dbg("goRegion", "DEV-ARENA");
    await ready("arena");
    for (const size of [
      { width: 844, height: 390 },
      { width: 667, height: 375 },
      { width: 1024, height: 768 },
    ]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(400);
      await fingers.measure();
      const info = await touch();
      const inside = info.buttons.every((b) => {
        const c = fingers.client(b);
        const r = b.r * (size.width / 640);
        return c.x - r >= 0 && c.y - r >= 0 && c.x + r <= size.width && c.y + r <= size.height;
      });
      await fingers.start(12, left);
      await fingers.move(12, { x: left.x + 20, y: left.y - 20 });
      await fingers.start(13, right);
      await fingers.move(13, { x: right.x - 25, y: right.y - 20 });
      await page.waitForTimeout(300);
      await page.screenshot({
        path: `${outDir}battle-${String(size.width)}x${String(size.height)}.png`,
      });
      await fingers.end(13);
      await fingers.end(12);
      check(
        `（タッチ）${String(size.width)}×${String(size.height)} の画面：全てのボタンが画面の中にある`,
        inside && info.active,
        `収まる ${String(inside)}`,
      );
    }
  } finally {
    await context.close();
  }
}

/** PC（タッチでない文脈）では、タッチの操作部が出ないことを確かめる。 */
export async function runPcTouchAbsentCheck(page: TouchPage, check: Check): Promise<void> {
  const dbg = debugOf(page);
  const t = await dbg<{ active: boolean; layout: string }>("touch");
  const h = await dbg<{ view: { skillKeysVisible: number; layout: string } }>("hud");
  check(
    "（PC）タッチでない端末では、タッチの操作部が出ず、HUD は PC の配置（技の枠6つ）",
    !t.active && t.layout === "pc" && h.view.skillKeysVisible === 6,
    `タッチ ${String(t.active)}・配置 ${t.layout}・技の枠の文字 ${String(h.view.skillKeysVisible)}`,
  );
}
