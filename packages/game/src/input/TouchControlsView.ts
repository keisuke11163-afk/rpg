/**
 * スマホ（タッチ）の操作部を描き、Phaser の指の出来事をタッチのモデル（touch-controls.ts）に渡す（docs/progress TOUCH-1・2）。
 * - 画面に固定（scrollFactor 0）。半透明で、押している間は明るく。技のボタンには短い名前・CD の覆いと残り秒・
 *   使えない理由の色（HUD の HudSkillSlot をそのまま使う。下中央の技の枠の代わり）
 * - 右上の「≡」でメニュー（インベントリ・キャラクター・星辰盤・職紋盤・地図・設定・名前を全て表示・全画面）
 * - 画面（インベントリなど）・大きな地図を開いている間は「閉じる」（盤は「−」「＋」も）
 * タッチの表示でないとき（PC）は何も描かず、何も受け取らない（frame() は undefined）。
 */
import Phaser from "phaser";
import { text } from "@stella/content";
import type { Action } from "./actions.ts";
import type { TouchSource } from "./InputSystem.ts";
import {
  TOUCH_MENU_ITEMS,
  TOUCH_UI_LAYOUT,
  type Point,
  type Rect,
  type StickState,
  TouchControls,
  type TouchButtonDef,
  type TouchControlsState,
  type TouchFrame,
  type TouchMenuItem,
  TouchModeSwitch,
  type TouchSetting,
  type TouchButtonId,
  type TouchSkillSlot,
  type TouchUiId,
  isSkillSlot,
  menuItemRect,
  rectContains,
} from "./touch-controls.ts";
import { isTouchPrimaryDevice } from "../page-shell.ts";
import { SLOT_BORDER, SLOT_TINT } from "../ui/Hud.ts";
import type { HudModel, HudSkillSlot } from "../ui/hud-model.ts";
import { secondsText } from "../ui/hud-model.ts";
import { setTextColor } from "../ui/text-style.ts";
import { PIXELS_PER_METER } from "../world/units.ts";

/** 操作部の深さ（HUD〔905〕より上、画面〔1000〕より下）。閉じる・メニューは画面より上。 */
const CONTROLS_DEPTH = 920;
const UI_DEPTH = 1010;
/** 余白（キャンバスの外）から触れ始めた指の id の足し算（Phaser の pointer の id と重ならないように）。 */
const MARGIN_ID_BASE = 1000;

/** 盤の「−」「＋」で掛ける拡大率。 */
const ZOOM_STEP = 1.25;

let modeSwitch: TouchModeSwitch | undefined;

/** 文字を打つ場所（入力欄など）か（星辰盤の検索欄。ここでのキー入力は PC の操作に数えない）。 */
function isTextEntry(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

/**
 * タッチの表示に切り替えるかを決めるもの（ゲームに1つ。地域を移ってシーンを作り直しても同じ）。
 * 最初に呼んだときに、ページの指・マウス・キーの出来事を見始める。
 */
export function touchMode(): TouchModeSwitch {
  if (modeSwitch !== undefined) return modeSwitch;
  const m = new TouchModeSwitch(isTouchPrimaryDevice());
  modeSwitch = m;
  if (typeof window !== "undefined") {
    const now = (): number => performance.now();
    window.addEventListener(
      "touchstart",
      () => {
        m.noteTouch(now());
      },
      { capture: true, passive: true },
    );
    // マウスが動いた・押された（指で触れたときに出る pointer の出来事は pointerType が touch なので数えない）
    const onMouse = (e: PointerEvent): void => {
      if (e.pointerType === "mouse") m.noteDesktopInput(now());
    };
    window.addEventListener("pointermove", onMouse, { capture: true, passive: true });
    window.addEventListener("pointerdown", onMouse, { capture: true, passive: true });
    window.addEventListener(
      "keydown",
      (e) => {
        // 入力欄に文字を打っているときは、PC の操作とはみなさない（ソフトキーボードの文字入力で表示が替わらないように）
        if (isTextEntry(e.target)) return;
        m.noteDesktopInput(now());
      },
      { capture: true, passive: true },
    );
  }
  return m;
}

/** 毎フレームの描画に渡す、ゲームの状態。 */
export interface TouchViewContext {
  /** インベントリなどの画面を開いている（操作部は隠し、閉じるを出す）。 */
  readonly panelOpen: boolean;
  /** 盤（星辰盤・職紋盤）の画面（「−」「＋」を出す）。 */
  readonly boardOpen: boolean;
  /** 大きな地図を開いている（閉じるを出す）。 */
  readonly bigMap: boolean;
  /** 調べるボタンの文字（近くに対象が無ければ undefined。ボタンを隠す）。 */
  readonly interact: string | undefined;
  /** プレイヤーの画面の位置（照準の線を描く）。 */
  readonly player: Point;
}

export interface TouchViewOptions {
  /** 盤の拡大率を変える（「−」「＋」）。 */
  readonly onZoom: (k: number) => void;
  /** 技の枠の射程（メートル。技のボタンのドラッグの距離の上限）。 */
  readonly skillRange: (slot: TouchSkillSlot) => number | undefined;
}

/** 文字の作り方（小さな文字は縁取りでにじむので、暗い下地の上に置く）。 */
function label(
  scene: Phaser.Scene,
  size: number,
  depth: number,
  color = "#e8e6f0",
): Phaser.GameObjects.Text {
  return scene.add
    .text(0, 0, "", { fontFamily: "sans-serif", fontSize: `${String(size)}px`, color })
    .setOrigin(0.5, 0.5)
    .setScrollFactor(0)
    .setDepth(depth)
    .setVisible(false);
}

/** スマホの操作部。 */
export class TouchControlsView implements TouchSource {
  readonly controls = new TouchControls();
  private readonly scene: Phaser.Scene;
  private readonly options: TouchViewOptions;
  /** 動かない部分（スティックの外の輪・ボタンの枠）。変わったときだけ描き直す。 */
  private readonly gBase: Phaser.GameObjects.Graphics;
  /** 動く部分（つまみ・照準の線・技の色・CD の覆い）。毎フレーム描き直す。 */
  private readonly g: Phaser.GameObjects.Graphics;
  private baseKey = "";
  private readonly ui: Phaser.GameObjects.Graphics;
  private readonly buttonLabels = new Map<string, Phaser.GameObjects.Text>();
  private readonly buttonCds = new Map<string, Phaser.GameObjects.Text>();
  private readonly uiLabels = new Map<TouchUiId, Phaser.GameObjects.Text>();
  private readonly attackLabel: Phaser.GameObjects.Text;
  /** 画面の操作のボタンを押している指（離したときに、まだ上にあれば働く）。 */
  private readonly uiFingers = new Map<number, TouchUiId>();
  /** 画面の操作のボタンで押した行動（次の frame() で pressed にする）。 */
  private readonly uiPressed = new Set<Action>();
  /** 余白から触れ始めて、まだ離れていない指（touchstart の identifier + MARGIN_ID_BASE）。 */
  private readonly marginFingers = new Set<number>();
  private menuOpen = false;
  /** 「名前を全て表示」（Alt）を入れているか（切り替え式）。 */
  private showLoot = false;
  private context: TouchViewContext = {
    panelOpen: false,
    boardOpen: false,
    bigMap: false,
    interact: undefined,
    player: { x: 320, y: 180 },
  };
  private wasActive = false;
  private lastFrame: TouchFrame | undefined;
  /** 全画面か（メニューの文字を替える）。 */
  private fullscreen = false;

  constructor(scene: Phaser.Scene, options: TouchViewOptions) {
    this.scene = scene;
    this.options = options;
    this.gBase = scene.add.graphics().setScrollFactor(0).setDepth(CONTROLS_DEPTH);
    this.g = scene.add
      .graphics()
      .setScrollFactor(0)
      .setDepth(CONTROLS_DEPTH + 0.5);
    this.ui = scene.add.graphics().setScrollFactor(0).setDepth(UI_DEPTH);
    for (const b of this.controls.layout.buttons) {
      this.buttonLabels.set(b.id, label(scene, 8, CONTROLS_DEPTH + 1));
      if (isSkillSlot(b.id))
        this.buttonCds.set(b.id, label(scene, 10, CONTROLS_DEPTH + 1, "#ffffff"));
    }
    this.attackLabel = label(scene, 8, CONTROLS_DEPTH + 1, "#ffd9d0").setText(text("touch.attack"));
    for (const id of ["menu", "close", "zoomIn", "zoomOut", ...TOUCH_MENU_ITEMS] as const)
      this.uiLabels.set(id, label(scene, id === "close" ? 11 : 10, UI_DEPTH + 1));
    touchMode();

    scene.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (!p.wasTouch) return;
      this.fingerDown(p.id, p.x, p.y);
    });
    scene.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!p.wasTouch) return;
      this.fingerMove(p.id, p.x, p.y);
    });
    const up = (p: Phaser.Input.Pointer): void => {
      if (!p.wasTouch) return;
      this.onUp(p.id, p.x, p.y, p.wasCanceled);
    };
    scene.input.on("pointerup", up);
    scene.input.on("pointerupoutside", up);
    // 縦持ちで止めた・再開した、タブを切り替えた・アプリが裏に回った：押していた指を全て離す（押しっぱなしにしない。
    // 指が離れた知らせは、着信などでは届かないことがある）
    const onPause = (): void => {
      this.releaseAll();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") this.releaseAll();
    };
    window.addEventListener("stella-pause", onPause);
    window.addEventListener("blur", onPause);
    window.addEventListener("pagehide", onPause);
    document.addEventListener("visibilitychange", onVisibility);
    const onFullscreen = (): void => {
      this.fullscreen = document.fullscreenElement !== null;
    };
    document.addEventListener("fullscreenchange", onFullscreen);
    // 画面の左右・上下の余白（FIT のため、キャンバスの外にできる）から触れ始めた指も受け取る。Phaser はキャンバスの
    // 外の touchstart を受け取らないので、window で拾い、位置をキャンバスの端に寄せて操作部に渡す（D-TOUCH-13）
    const onMarginStart = (e: TouchEvent): void => {
      if (!this.isMarginTarget(e.target)) return;
      for (const t of Array.from(e.changedTouches)) {
        const id = MARGIN_ID_BASE + t.identifier;
        this.marginFingers.add(id);
        const at = this.toGame(t.clientX, t.clientY);
        this.fingerDown(id, at.x, at.y);
      }
    };
    const onMarginMove = (e: TouchEvent): void => {
      for (const t of Array.from(e.changedTouches)) {
        const id = MARGIN_ID_BASE + t.identifier;
        if (!this.marginFingers.has(id)) continue;
        const at = this.toGame(t.clientX, t.clientY);
        this.fingerMove(id, at.x, at.y);
      }
    };
    const onMarginEnd = (e: TouchEvent): void => {
      for (const t of Array.from(e.changedTouches)) {
        const id = MARGIN_ID_BASE + t.identifier;
        if (!this.marginFingers.delete(id)) continue;
        const at = this.toGame(t.clientX, t.clientY);
        this.onUp(id, at.x, at.y, e.type === "touchcancel");
      }
      // 離れた知らせが来なかった余白の指（e.touches に残っていないもの）は取り消す
      const alive = new Set(Array.from(e.touches, (t) => MARGIN_ID_BASE + t.identifier));
      for (const id of [...this.marginFingers])
        if (!alive.has(id)) {
          this.marginFingers.delete(id);
          this.controls.cancel(id);
          this.uiFingers.delete(id);
        }
    };
    const passive = { capture: true, passive: true } as const;
    window.addEventListener("touchstart", onMarginStart, passive);
    window.addEventListener("touchmove", onMarginMove, passive);
    window.addEventListener("touchend", onMarginEnd, passive);
    window.addEventListener("touchcancel", onMarginEnd, passive);
    scene.events.once("shutdown", () => {
      window.removeEventListener("stella-pause", onPause);
      window.removeEventListener("blur", onPause);
      window.removeEventListener("pagehide", onPause);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("fullscreenchange", onFullscreen);
      window.removeEventListener("touchstart", onMarginStart, passive);
      window.removeEventListener("touchmove", onMarginMove, passive);
      window.removeEventListener("touchend", onMarginEnd, passive);
      window.removeEventListener("touchcancel", onMarginEnd, passive);
    });
  }

  /** 余白（ゲームの入れ物・ページ）に触れたか。キャンバス・入力欄・縦持ちの画面の上は Phaser や別の部品が受ける。 */
  private isMarginTarget(target: EventTarget | null): boolean {
    if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
    return target === document.body || target === document.documentElement || target.id === "game";
  }

  /** 画面（CSS ピクセル）の位置 → ゲームの座標（キャンバスの外は、端に寄せる）。 */
  private toGame(clientX: number, clientY: number): Point {
    const rect = this.scene.game.canvas.getBoundingClientRect();
    const k = rect.width / this.scene.scale.width;
    if (!(k > 0)) return { x: 0, y: 0 };
    const clamp = (v: number, max: number): number => Math.min(max, Math.max(0, v));
    return {
      x: clamp((clientX - rect.left) / k, this.scene.scale.width),
      y: clamp((clientY - rect.top) / k, this.scene.scale.height),
    };
  }

  /** 指が触れた（Phaser の指も余白の指も、ここへ）。 */
  private fingerDown(id: number, x: number, y: number): void {
    touchMode().noteTouch(performance.now());
    if (this.active || this.uiOnly) this.onDown(id, x, y);
  }

  private fingerMove(id: number, x: number, y: number): void {
    if (!this.active) return;
    if (!this.uiFingers.has(id)) this.controls.move(id, x, y);
  }

  /** タッチの表示か。 */
  get active(): boolean {
    return touchMode().active;
  }

  /** 「≡」のメニューを開いているか（開いている間、タッチではゲームを止める。docs/progress D-TOUCH-15）。 */
  get menuIsOpen(): boolean {
    return this.menuOpen;
  }

  /**
   * タッチの表示の設定が off（出さない）で、指で触れている間：操作部は出さず、「≡」「閉じる」だけ出す
   * （設定を開いて元に戻せるように。D-TOUCH-10）。
   */
  private get uiOnly(): boolean {
    return !this.active && touchMode().menuOnly;
  }

  /** タッチの表示の設定（設定の画面）を効かせる。 */
  setSetting(s: TouchSetting): void {
    touchMode().setSetting(s);
  }

  /** 全ての指を離し、途中の操作をやめる。 */
  private releaseAll(): void {
    this.controls.cancelAll();
    this.uiFingers.clear();
    this.uiPressed.clear();
    this.marginFingers.clear();
  }

  /** 今出している画面の操作のボタン（枠）。 */
  private uiButtons(): readonly { readonly id: TouchUiId; readonly rect: Rect }[] {
    const c = this.context;
    const out: { id: TouchUiId; rect: Rect }[] = [];
    if (c.panelOpen || c.bigMap) {
      out.push({ id: "close", rect: TOUCH_UI_LAYOUT.close });
      if (c.panelOpen && c.boardOpen)
        out.push(
          { id: "zoomOut", rect: TOUCH_UI_LAYOUT.zoomOut },
          { id: "zoomIn", rect: TOUCH_UI_LAYOUT.zoomIn },
        );
      return out;
    }
    out.push({ id: "menu", rect: TOUCH_UI_LAYOUT.menu });
    if (this.menuOpen) this.menuItems().forEach((id, i) => out.push({ id, rect: menuItemRect(i) }));
    return out;
  }

  /** メニューの項目（全画面は、使えるブラウザのときだけ。iOS の Safari では使えない）。 */
  private menuItems(): readonly TouchMenuItem[] {
    const canFullscreen = typeof document !== "undefined" && document.fullscreenEnabled;
    return TOUCH_MENU_ITEMS.filter((id) => id !== "fullscreen" || canFullscreen);
  }

  private onDown(id: number, x: number, y: number): void {
    const at = { x, y };
    const ui = this.uiButtons().find((b) => rectContains(b.rect, at));
    if (ui !== undefined) {
      this.uiFingers.set(id, ui.id);
      return;
    }
    // メニューの外に触れたら、メニューを閉じる（その指は操作部に渡す）
    this.menuOpen = false;
    // 画面・大きな地図を開いている間は、操作部に渡さない（画面の操作に使う）。設定が off のときも渡さない
    if (this.context.panelOpen || this.context.bigMap || this.uiOnly) return;
    this.controls.down(id, x, y, this.scene.time.now);
  }

  private onUp(id: number, x: number, y: number, canceled: boolean): void {
    const ui = this.uiFingers.get(id);
    if (ui !== undefined) {
      this.uiFingers.delete(id);
      const rect = this.uiButtons().find((b) => b.id === ui)?.rect;
      if (!canceled && rect !== undefined && rectContains(rect, { x, y })) this.activate(ui);
      return;
    }
    if (canceled) this.controls.cancel(id);
    else this.controls.up(id);
  }

  /** 画面の操作のボタンが働く（指を離した瞬間。全画面はこの中で頼む：ブラウザが操作の中でだけ許すため）。 */
  private activate(id: TouchUiId): void {
    switch (id) {
      case "menu":
        this.menuOpen = !this.menuOpen;
        return;
      case "close":
        this.uiPressed.add("menu");
        return;
      case "zoomIn":
        this.options.onZoom(ZOOM_STEP);
        return;
      case "zoomOut":
        this.options.onZoom(1 / ZOOM_STEP);
        return;
      case "showLoot":
        this.showLoot = !this.showLoot;
        this.menuOpen = false;
        return;
      case "fullscreen":
        this.menuOpen = false;
        this.toggleFullscreen();
        return;
      case "settings":
        // Esc と同じ（何も開いていなければ設定を開く）
        this.menuOpen = false;
        this.uiPressed.add("menu");
        return;
      case "inventory":
      case "character":
      case "starBoard":
      case "jobBoard":
      case "map":
        this.menuOpen = false;
        this.uiPressed.add(id);
        return;
    }
  }

  /** 全画面にする・やめる。全画面にしたら、横向きに固定するのも試す（できなくても例外を出さない）。 */
  private toggleFullscreen(): void {
    try {
      if (document.fullscreenElement !== null) {
        document.exitFullscreen().catch(() => undefined);
        return;
      }
      document.documentElement
        .requestFullscreen({ navigationUI: "hide" })
        .then(() => {
          // lock は使えないブラウザがある（iOS の Safari など）ので、無いものとして扱う
          const o = screen.orientation as unknown as {
            lock?: (o: string) => Promise<void>;
          };
          return o.lock?.("landscape");
        })
        .catch(() => undefined);
    } catch {
      // 全画面にできない環境では何もしない
    }
  }

  /** 毎フレーム、描く前に今の状態を知らせる（画面を開いた瞬間に、押していた指を離す）。 */
  setContext(c: TouchViewContext): void {
    if (c.panelOpen && !this.context.panelOpen) {
      this.controls.cancelAll();
      this.menuOpen = false;
    }
    if (c.bigMap && !this.context.bigMap) {
      // 大きな地図を開いた瞬間も、押していた指を離す（操作部は隠れる）
      this.controls.cancelAll();
      this.menuOpen = false;
    }
    this.context = c;
    this.controls.setVisible("interact", c.interact !== undefined);
  }

  /** このフレームのタッチの入力（タッチの表示でなければ undefined）。InputSystem.read() が呼ぶ。 */
  frame(): TouchFrame | undefined {
    const active = this.active;
    if (!active) {
      if (this.wasActive) {
        this.releaseAll();
        this.menuOpen = false;
        this.showLoot = false;
      }
      this.wasActive = false;
      this.lastFrame = undefined;
      // 設定が off のときの「≡」「閉じる」を押している指も、離れた知らせが来なければ離す
      if (this.uiOnly) this.dropStaleFingers();
      return undefined;
    }
    this.wasActive = true;
    this.dropStaleFingers();
    const f = this.controls.frame(this.scene.time.now, this.options.skillRange);
    const held = new Set(f.held);
    const pressed = new Set(f.pressed);
    for (const a of this.uiPressed) pressed.add(a);
    this.uiPressed.clear();
    if (this.showLoot) held.add("showLoot");
    const out: TouchFrame = { ...f, held, pressed };
    this.lastFrame = out;
    return out;
  }

  /** 設定が off のときの「≡」「閉じる」で押した行動（操作部の frame() が無いときの分。TouchSource）。 */
  takeMenuPressed(): ReadonlySet<Action> {
    const out = new Set<Action>(this.uiOnly ? this.uiPressed : []);
    this.uiPressed.clear();
    return out;
  }

  /** 離れたのに知らせが来なかった指を離す（押しっぱなしで固まらないように）。 */
  private dropStaleFingers(): void {
    const down = new Set<number>(this.marginFingers);
    for (const p of this.scene.input.manager.pointers) if (p.wasTouch && p.isDown) down.add(p.id);
    this.controls.retain(down);
    for (const id of [...this.uiFingers.keys()]) if (!down.has(id)) this.uiFingers.delete(id);
  }

  /** 開発用の確認（pnpm e2e）：表示・配置・押している状態・最後の入力。 */
  snapshot(): {
    active: boolean;
    menuOnly: boolean;
    setting: TouchSetting;
    menuOpen: boolean;
    showLoot: boolean;
    buttons: readonly (TouchButtonDef & { visible: boolean; down: boolean })[];
    sticks: {
      left: { rest: Point; zone: Rect; active: boolean };
      right: { rest: Point; zone: Rect; active: boolean };
    };
    ui: readonly { id: TouchUiId; x: number; y: number; width: number; height: number }[];
    frame: { held: string[]; aim: Point; aimDistance: number; move: Point } | null;
    fingers: number;
  } {
    const s = this.controls.state();
    const layout = this.controls.layout;
    const f = this.lastFrame;
    return {
      active: this.active,
      menuOnly: this.uiOnly,
      setting: touchMode().currentSetting,
      menuOpen: this.menuOpen,
      showLoot: this.showLoot,
      buttons: layout.buttons.map((b) => ({
        ...b,
        visible: this.controls.isVisible(b.id),
        down: s.buttons.find((x) => x.id === b.id)?.down ?? false,
      })),
      sticks: {
        left: { rest: layout.leftStick.rest, zone: layout.leftStick.zone, active: s.left.active },
        right: {
          rest: layout.rightStick.rest,
          zone: layout.rightStick.zone,
          active: s.right.active,
        },
      },
      ui: this.active || this.uiOnly ? this.uiButtons().map((b) => ({ id: b.id, ...b.rect })) : [],
      frame:
        f === undefined
          ? null
          : { held: [...f.held], aim: f.aim, aimDistance: f.aimDistance, move: f.move },
      fingers: s.fingers,
    };
  }

  /** 描く（ArenaScene が HUD を描いた後に、毎フレーム）。 */
  render(model: HudModel): void {
    const g = this.g.clear();
    const ui = this.ui.clear();
    const active = this.active;
    const uiOnly = this.uiOnly;
    const c = this.context;
    // 画面・大きな地図を開いている間は、操作部を隠す（閉じるだけ残す。D-TOUCH-9）。設定が off のときも出さない
    const showControls = active && !c.panelOpen && !c.bigMap;
    for (const t of this.buttonLabels.values()) t.setVisible(false);
    for (const t of this.buttonCds.values()) t.setVisible(false);
    for (const t of this.uiLabels.values()) t.setVisible(false);
    this.attackLabel.setVisible(false);
    if (!showControls && this.baseKey !== "") {
      this.gBase.clear();
      this.baseKey = "";
    }
    if (!active && !uiOnly) return;
    if (showControls) {
      // 状態は1フレームに1回だけ読む
      const s = this.controls.state();
      this.renderAim(g);
      this.renderBase(model, s);
      this.renderSticks(g, s);
      this.renderButtons(g, model, s);
    }
    this.renderUi(ui);
  }

  /** 照準の線（指で狙っている間だけ。プレイヤーから照準の点へ）。 */
  private renderAim(g: Phaser.GameObjects.Graphics): void {
    const f = this.lastFrame;
    if (f === undefined || !f.aiming) return;
    const p = this.context.player;
    const len = f.aimDistance * PIXELS_PER_METER;
    const x = p.x + f.aim.x * len;
    const y = p.y + f.aim.y * len;
    g.lineStyle(1, 0xffffff, 0.35).lineBetween(p.x, p.y, x, y);
    g.lineStyle(1, 0xffd166, 0.8).strokeCircle(x, y, 4);
  }

  /** ボタンの縁の色（技は使えない理由の色。実行中は白）。 */
  private borderOf(id: TouchButtonId, model: HudModel): number {
    if (!isSkillSlot(id)) return 0x8c88a0;
    const slot = model.skills.find((x) => x.action === id);
    return slot?.executing === true ? 0xffffff : SLOT_BORDER[slot?.state ?? "empty"];
  }

  /**
   * 動かない部分（スティックの外の輪・ボタンの下地と縁）。押した・離した・触れた位置・技の状態が変わったときだけ
   * 描き直す（毎フレームは描き直さない。D-TOUCH-14）。
   */
  private renderBase(model: HudModel, s: TouchControlsState): void {
    const layout = this.controls.layout;
    const shown = s.buttons.filter((b) => b.visible);
    const stickKey = (st: StickState): string =>
      st.active ? `a${String(st.center.x)},${String(st.center.y)}` : "r";
    const key = [
      stickKey(s.left),
      stickKey(s.right),
      ...shown.map((b) => `${b.id}${b.down ? "1" : "0"}${String(this.borderOf(b.id, model))}`),
    ].join("|");
    if (key === this.baseKey) return;
    this.baseKey = key;
    const g = this.gBase.clear();
    const ring = (st: StickState, def: typeof layout.leftStick, color: number): void => {
      g.fillStyle(0x16151c, st.active ? 0.32 : 0.18).fillCircle(
        st.center.x,
        st.center.y,
        def.radius,
      );
      g.lineStyle(2, color, st.active ? 0.7 : 0.35).strokeCircle(
        st.center.x,
        st.center.y,
        def.radius,
      );
    };
    ring(s.left, layout.leftStick, 0xc9c6d6);
    ring(s.right, layout.rightStick, 0xff9a8a);
    for (const st of shown) {
      const def = layout.buttons.find((x) => x.id === st.id);
      if (def !== undefined) this.base(g, def, st.down, this.borderOf(st.id, model));
    }
  }

  private renderSticks(g: Phaser.GameObjects.Graphics, s: TouchControlsState): void {
    const layout = this.controls.layout;
    const knob = (st: StickState, def: typeof layout.leftStick, color: number): void => {
      g.fillStyle(color, st.engaged ? 0.75 : st.active ? 0.5 : 0.3).fillCircle(
        st.knob.x,
        st.knob.y,
        def.knob,
      );
    };
    knob(s.left, layout.leftStick, 0xc9c6d6);
    knob(s.right, layout.rightStick, 0xff9a8a);
    if (!s.right.active)
      this.attackLabel
        .setPosition(layout.rightStick.rest.x, layout.rightStick.rest.y)
        .setVisible(true);
  }

  private renderButtons(
    g: Phaser.GameObjects.Graphics,
    model: HudModel,
    s: TouchControlsState,
  ): void {
    for (const def of this.controls.layout.buttons) {
      const st = s.buttons.find((b) => b.id === def.id);
      if (st === undefined || !st.visible) continue;
      const t = this.buttonLabels.get(def.id);
      if (isSkillSlot(def.id)) {
        const slot = model.skills.find((x) => x.action === def.id);
        this.renderSkillButton(g, def, slot, t, this.buttonCds.get(def.id));
        if (st.drag !== undefined) {
          // ドラッグで狙っている向き（ボタンの縁に小さな印）
          g.fillStyle(0xffd166, 0.9).fillCircle(
            def.x + st.drag.x * (def.r + 4),
            def.y + st.drag.y * (def.r + 4),
            3,
          );
        }
        continue;
      }
      if (t === undefined) continue;
      if (def.id === "flaskHp" || def.id === "flaskMp") {
        const f = model.flasks[def.id === "flaskHp" ? 0 : 1];
        const empty = f.charges <= 0;
        g.fillStyle(def.id === "flaskHp" ? 0xe04848 : 0x4f8ff0, empty ? 0.25 : 0.85).fillCircle(
          def.x,
          def.y - 5,
          7,
        );
        setTextColor(
          t.setText(
            `${text(def.id === "flaskHp" ? "touch.flaskHp" : "touch.flaskMp")} ${String(f.charges)}`,
          ),
          empty ? "#ff6b6b" : "#ffffff",
        )
          .setPosition(def.x, def.y + 9)
          .setVisible(true);
      } else {
        const name: string =
          def.id === "dodge"
            ? text("touch.dodge")
            : (this.context.interact ?? text("touch.interact"));
        setTextColor(t.setText(name), "#e8e6f0").setPosition(def.x, def.y).setVisible(true);
      }
    }
  }

  /** ボタンの下地と縁（押している間は明るく）。 */
  private base(
    g: Phaser.GameObjects.Graphics,
    def: TouchButtonDef,
    down: boolean,
    border: number,
  ): void {
    g.fillStyle(0x16151c, down ? 0.75 : 0.45).fillCircle(def.x, def.y, def.r);
    if (down) g.fillStyle(0xffffff, 0.18).fillCircle(def.x, def.y, def.r);
    g.lineStyle(2, down ? 0xffffff : border, down ? 1 : 0.8).strokeCircle(def.x, def.y, def.r);
  }

  /** 技のボタン：短い名前・CD の覆い（残りの割合の扇）と残り秒・使えない理由の色。 */
  private renderSkillButton(
    g: Phaser.GameObjects.Graphics,
    def: TouchButtonDef,
    slot: HudSkillSlot | undefined,
    name: Phaser.GameObjects.Text | undefined,
    cd: Phaser.GameObjects.Text | undefined,
  ): void {
    const state = slot?.state ?? "empty";
    const tint = SLOT_TINT[state];
    if (tint !== undefined)
      g.fillStyle(tint, state === "locked" ? 0.55 : 0.45).fillCircle(def.x, def.y, def.r - 1);
    if (slot?.onCooldown === true) {
      const r = slot.cooldownRatio ?? 1;
      const start = -Math.PI / 2;
      g.fillStyle(0x000000, 0.55);
      if (r >= 0.999) g.fillCircle(def.x, def.y, def.r - 1);
      else g.slice(def.x, def.y, def.r - 1, start, start + Math.PI * 2 * r, false).fillPath();
    }
    const dim = state === "locked" || state === "empty";
    if (name !== undefined)
      setTextColor(
        name.setText(slot?.shortName ?? ""),
        state === "mp" ? "#9cc4ff" : state === "gauge" ? "#ffc489" : "#e8e6f0",
      )
        .setPosition(def.x, slot?.onCooldown === true ? def.y + 9 : def.y)
        .setAlpha(dim ? 0.5 : state === "ready" || state === "cooldown" ? 1 : 0.7)
        .setVisible(true);
    if (cd !== undefined && slot?.onCooldown === true)
      cd.setText(secondsText(slot.cooldownRemaining))
        .setPosition(def.x, def.y - 4)
        .setVisible(true);
  }

  /** 画面の操作のボタン（≡・メニュー・閉じる・−＋）。 */
  private renderUi(g: Phaser.GameObjects.Graphics): void {
    for (const b of this.uiButtons()) {
      const r = b.rect;
      const down = [...this.uiFingers.values()].includes(b.id);
      const on = (b.id === "showLoot" && this.showLoot) || (b.id === "menu" && this.menuOpen);
      g.fillStyle(0x16151c, down ? 0.95 : 0.82).fillRect(r.x, r.y, r.width, r.height);
      if (down || on)
        g.fillStyle(0xc3a6ff, down ? 0.3 : 0.18).fillRect(r.x, r.y, r.width, r.height);
      g.lineStyle(1, b.id === "close" ? 0xc3a6ff : 0x8c88a0, 1).strokeRect(
        r.x + 0.5,
        r.y + 0.5,
        r.width - 1,
        r.height - 1,
      );
      const t = this.uiLabels.get(b.id);
      if (b.id === "menu") {
        // ≡（3本の線）
        const cx = r.x + r.width / 2;
        const cy = r.y + r.height / 2;
        g.fillStyle(0xe8e6f0, 1);
        for (const dy of [-7, 0, 7]) g.fillRect(cx - 9, cy + dy - 1, 18, 2);
        continue;
      }
      if (t === undefined) continue;
      t.setText(this.uiText(b.id))
        .setPosition(r.x + r.width / 2, r.y + r.height / 2)
        .setVisible(true);
    }
  }

  private uiText(id: TouchUiId): string {
    switch (id) {
      case "close":
        return `✕ ${text("touch.close")}`;
      case "zoomIn":
        return "＋";
      case "zoomOut":
        return "−";
      case "showLoot":
        return text(this.showLoot ? "touch.menu.showLoot.on" : "touch.menu.showLoot");
      case "fullscreen":
        return text(this.fullscreen ? "touch.menu.fullscreenExit" : "touch.menu.fullscreen");
      case "menu":
        return "≡";
      default:
        return text(`touch.menu.${id}`);
    }
  }
}
