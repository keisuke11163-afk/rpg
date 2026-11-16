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
  TouchControls,
  type TouchButtonDef,
  type TouchFrame,
  type TouchMenuItem,
  TouchModeSwitch,
  type TouchSetting,
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

/** 操作部の深さ（HUD〔905〕より上、画面〔1000〕より下）。閉じる・メニューは画面より上。 */
const CONTROLS_DEPTH = 920;
const UI_DEPTH = 1010;

/** 盤の「−」「＋」で掛ける拡大率。 */
const ZOOM_STEP = 1.25;

let modeSwitch: TouchModeSwitch | undefined;

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
      () => {
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
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly ui: Phaser.GameObjects.Graphics;
  private readonly buttonLabels = new Map<string, Phaser.GameObjects.Text>();
  private readonly buttonCds = new Map<string, Phaser.GameObjects.Text>();
  private readonly uiLabels = new Map<TouchUiId, Phaser.GameObjects.Text>();
  private readonly attackLabel: Phaser.GameObjects.Text;
  /** 画面の操作のボタンを押している指（離したときに、まだ上にあれば働く）。 */
  private readonly uiFingers = new Map<number, TouchUiId>();
  /** 画面の操作のボタンで押した行動（次の frame() で pressed にする）。 */
  private readonly uiPressed = new Set<Action>();
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
    this.g = scene.add.graphics().setScrollFactor(0).setDepth(CONTROLS_DEPTH);
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
      touchMode().noteTouch(performance.now());
      if (this.active) this.onDown(p);
    });
    scene.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!p.wasTouch || !this.active) return;
      if (!this.uiFingers.has(p.id)) this.controls.move(p.id, p.x, p.y);
    });
    const up = (p: Phaser.Input.Pointer): void => {
      if (!p.wasTouch) return;
      this.onUp(p);
    };
    scene.input.on("pointerup", up);
    scene.input.on("pointerupoutside", up);
    // 縦持ちで止めた・再開した：押していた指を全て離す（押しっぱなしにしない）
    const onPause = (): void => {
      this.releaseAll();
    };
    window.addEventListener("stella-pause", onPause);
    const onFullscreen = (): void => {
      this.fullscreen = document.fullscreenElement !== null;
    };
    document.addEventListener("fullscreenchange", onFullscreen);
    scene.events.once("shutdown", () => {
      window.removeEventListener("stella-pause", onPause);
      document.removeEventListener("fullscreenchange", onFullscreen);
    });
  }

  /** タッチの表示か。 */
  get active(): boolean {
    return touchMode().active;
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

  private onDown(p: Phaser.Input.Pointer): void {
    const at = { x: p.x, y: p.y };
    const ui = this.uiButtons().find((b) => rectContains(b.rect, at));
    if (ui !== undefined) {
      this.uiFingers.set(p.id, ui.id);
      return;
    }
    // メニューの外に触れたら、メニューを閉じる（その指は操作部に渡す）
    this.menuOpen = false;
    // 画面を開いている間は、操作部に渡さない（画面の操作に使う）
    if (this.context.panelOpen) return;
    this.controls.down(p.id, p.x, p.y, this.scene.time.now);
  }

  private onUp(p: Phaser.Input.Pointer): void {
    const ui = this.uiFingers.get(p.id);
    if (ui !== undefined) {
      this.uiFingers.delete(p.id);
      const rect = this.uiButtons().find((b) => b.id === ui)?.rect;
      if (!p.wasCanceled && rect !== undefined && rectContains(rect, { x: p.x, y: p.y }))
        this.activate(ui);
      return;
    }
    if (p.wasCanceled) this.controls.cancel(p.id);
    else this.controls.up(p.id);
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
    if (c.bigMap && !this.context.bigMap) this.menuOpen = false;
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
      return undefined;
    }
    this.wasActive = true;
    // 離れたのに知らせが来なかった指を離す（押しっぱなしで固まらないように）
    const down = new Set<number>();
    for (const p of this.scene.input.manager.pointers) if (p.wasTouch && p.isDown) down.add(p.id);
    this.controls.retain(down);
    for (const id of [...this.uiFingers.keys()]) if (!down.has(id)) this.uiFingers.delete(id);
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

  /** 開発用の確認（pnpm e2e）：表示・配置・押している状態・最後の入力。 */
  snapshot(): {
    active: boolean;
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
      ui: this.active ? this.uiButtons().map((b) => ({ id: b.id, ...b.rect })) : [],
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
    const c = this.context;
    const showControls = active && !c.panelOpen;
    for (const t of this.buttonLabels.values()) t.setVisible(false);
    for (const t of this.buttonCds.values()) t.setVisible(false);
    for (const t of this.uiLabels.values()) t.setVisible(false);
    this.attackLabel.setVisible(false);
    if (!active) return;
    if (showControls) {
      this.renderAim(g);
      this.renderSticks(g);
      this.renderButtons(g, model);
    }
    this.renderUi(ui);
  }

  /** 照準の線（指で狙っている間だけ。プレイヤーから照準の点へ）。 */
  private renderAim(g: Phaser.GameObjects.Graphics): void {
    const f = this.lastFrame;
    if (f === undefined || !f.aiming) return;
    const p = this.context.player;
    const len = f.aimDistance * 16;
    const x = p.x + f.aim.x * len;
    const y = p.y + f.aim.y * len;
    g.lineStyle(1, 0xffffff, 0.35).lineBetween(p.x, p.y, x, y);
    g.lineStyle(1, 0xffd166, 0.8).strokeCircle(x, y, 4);
  }

  private renderSticks(g: Phaser.GameObjects.Graphics): void {
    const s = this.controls.state();
    const layout = this.controls.layout;
    const draw = (st: typeof s.left, def: typeof layout.leftStick, color: number): void => {
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
      g.fillStyle(color, st.engaged ? 0.75 : st.active ? 0.5 : 0.3).fillCircle(
        st.knob.x,
        st.knob.y,
        def.knob,
      );
    };
    draw(s.left, layout.leftStick, 0xc9c6d6);
    draw(s.right, layout.rightStick, 0xff9a8a);
    if (!s.right.active)
      this.attackLabel
        .setPosition(layout.rightStick.rest.x, layout.rightStick.rest.y)
        .setVisible(true);
  }

  private renderButtons(g: Phaser.GameObjects.Graphics, model: HudModel): void {
    const s = this.controls.state();
    for (const def of this.controls.layout.buttons) {
      const st = s.buttons.find((b) => b.id === def.id);
      if (st === undefined || !st.visible) continue;
      const t = this.buttonLabels.get(def.id);
      if (isSkillSlot(def.id)) {
        const slot = model.skills.find((x) => x.action === def.id);
        this.renderSkillButton(g, def, st.down, slot, t, this.buttonCds.get(def.id));
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
      this.base(g, def, st.down, 0x8c88a0);
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
    down: boolean,
    slot: HudSkillSlot | undefined,
    name: Phaser.GameObjects.Text | undefined,
    cd: Phaser.GameObjects.Text | undefined,
  ): void {
    const state = slot?.state ?? "empty";
    this.base(g, def, down, slot?.executing === true ? 0xffffff : SLOT_BORDER[state]);
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
