import Phaser from "phaser";
import { ACTIONS, type Action, type Binding, DEFAULT_BINDINGS } from "./actions.ts";
import type { InputFrame } from "./frame.ts";
import { type TouchFrame, aimWorldPoint } from "./touch-controls.ts";

export type { InputFrame } from "./frame.ts";

/** タッチの入力を出すもの（TouchControlsView）。タッチの表示でないときは undefined を返す。 */
export interface TouchSource {
  frame(): TouchFrame | undefined;
}

/**
 * タッチの直後に、ブラウザが真似て出すマウスの出来事を無視する時間（ミリ秒。指で触れたのに左クリックに
 * ならないように）。
 */
const TOUCH_MOUSE_GUARD_MS = 800;

/** キーボード・マウス（とタッチ）を読み、行動に変える。 */
export class InputSystem {
  private readonly scene: Phaser.Scene;
  private readonly keys = new Map<string, Phaser.Input.Keyboard.Key>();
  private readonly listeners = new Map<string, () => void>();
  private bindings: Readonly<Record<Action, readonly Binding[]>>;
  private previous = new Set<Action>();
  /** 前回の read() の後に押されたキー・ボタン（同じフレームの間に押して離した入力も取りこぼさない）。 */
  private readonly latched = new Set<string>();
  /** カメラのスクロールに足している揺れのずれ（表示だけ。照準の計算では差し引く。D-HUD-12）。 */
  private readonly viewOffset = { x: 0, y: 0 };
  /** タッチの入力（無ければキーボード・マウスだけ）。 */
  private touch: TouchSource | undefined;
  /** 前の read() のタッチの入力（タッチの表示の間だけ。照準の点に使う）。 */
  private lastTouch: TouchFrame | undefined;
  /** 照準の点の基準（プレイヤーの位置。世界の座標・ピクセル）。 */
  private readonly aimOrigin = { x: 0, y: 0 };
  /** 最後に指で触れた時刻（performance.now。ミリ秒）。 */
  private lastTouchAt = -Infinity;
  /** 1メートルのピクセル数（タッチの照準の点の距離に使う）。 */
  private readonly pixelsPerMeter: number;

  constructor(
    scene: Phaser.Scene,
    bindings: Readonly<Record<Action, readonly Binding[]>> = DEFAULT_BINDINGS,
    pixelsPerMeter = 16,
  ) {
    this.scene = scene;
    this.pixelsPerMeter = pixelsPerMeter;
    this.bindings = bindings;
    this.registerKeys();
    // 右クリックはスキルの枠なので、ブラウザのメニューを出さない
    scene.input.mouse?.disableContextMenu();
    // 押したボタンは pointer.button で見る（0＝左、2＝右）。押した瞬間には、ボタンの状態がまだ更新されていないことがあるため
    // 指（タッチ）はマウスのボタンとして扱わない（触れただけで通常攻撃が出ないように。タッチの操作は
    // TouchControlsView が行動にする）。タッチの直後にブラウザが真似て出すマウスの出来事も無視する
    scene.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.wasTouch) {
        this.lastTouchAt = performance.now();
        return;
      }
      if (performance.now() - this.lastTouchAt < TOUCH_MOUSE_GUARD_MS) return;
      if (pointer.button === 0) this.latched.add("mouse:left");
      if (pointer.button === 2) this.latched.add("mouse:right");
    });
  }

  /** 割り当てを変える（設定の画面。docs/progress D-UI-2）。使わなくなったキーは外す。 */
  setBindings(bindings: Readonly<Record<Action, readonly Binding[]>>): void {
    // Phaser は同じキーの Key を共有する（開発用の B・G など）ので、自分の受け取りだけを外す
    for (const [name, key] of this.keys) {
      const listener = this.listeners.get(name);
      if (listener !== undefined) key.off("down", listener);
      this.keys.delete(name);
      this.listeners.delete(name);
    }
    this.bindings = bindings;
    this.previous = new Set();
    this.latched.clear();
    this.registerKeys();
  }

  private registerKeys(): void {
    const keyboard = this.scene.input.keyboard;
    if (keyboard === null) throw new Error("キーボードの入力が使えない");
    for (const list of Object.values(this.bindings)) {
      for (const b of list) {
        if ("key" in b && !this.keys.has(b.key)) {
          const code = (Phaser.Input.Keyboard.KeyCodes as Record<string, number | undefined>)[
            b.key
          ];
          if (code === undefined) throw new Error(`キーの名前が正しくない：${b.key}`);
          // ブラウザの操作（スクロールなど）に使われないようにする
          const key = keyboard.addKey(code, true);
          const listener = (): void => {
            this.latched.add(`key:${b.key}`);
          };
          key.on("down", listener);
          this.keys.set(b.key, key);
          this.listeners.set(b.key, listener);
        }
      }
    }
  }

  private latchKey(b: Binding): string {
    return "key" in b ? `key:${b.key}` : `mouse:${b.mouse}`;
  }

  private isDown(b: Binding): boolean {
    if ("key" in b) return this.keys.get(b.key)?.isDown === true;
    const pointer = this.scene.input.activePointer;
    // 指で触れている間も、マウスのボタンを押したことにはしない
    if (pointer.wasTouch) return false;
    return b.mouse === "left" ? pointer.leftButtonDown() : pointer.rightButtonDown();
  }

  /** タッチの入力を足す（undefined で外す）。 */
  setTouch(source: TouchSource | undefined): void {
    this.touch = source;
    this.lastTouch = undefined;
  }

  /** 照準の点の基準（プレイヤーの位置。世界の座標・ピクセル）。タッチの表示の間、read() の前に毎フレーム呼ぶ。 */
  setAimOrigin(x: number, y: number): void {
    this.aimOrigin.x = x;
    this.aimOrigin.y = y;
  }

  /** 今のフレームの入力を読む。1フレームに1回だけ呼ぶ。 */
  read(): InputFrame {
    const held = new Set<Action>();
    for (const action of ACTIONS)
      if (this.bindings[action].some((b) => this.isDown(b))) held.add(action);
    const pressed = new Set<Action>([...held].filter((a) => !this.previous.has(a)));
    for (const action of ACTIONS) {
      if (this.bindings[action].some((b) => this.latched.has(this.latchKey(b))))
        pressed.add(action);
    }
    this.latched.clear();
    this.previous = held;
    const keyMove = {
      x: (held.has("moveRight") ? 1 : 0) - (held.has("moveLeft") ? 1 : 0),
      y: (held.has("moveDown") ? 1 : 0) - (held.has("moveUp") ? 1 : 0),
    };
    // タッチの表示の間：タッチの行動を足し、移動はスティック（倒していなければキー）、照準はタッチの照準の点
    const touch = this.touch?.frame();
    this.lastTouch = touch;
    if (touch === undefined)
      return { held, pressed, move: keyMove, pointerWorld: this.pointerWorld() };
    // previous（キーボード・マウスの押した瞬間の判定に使う）は変えないよう、別の入れ物に合わせる
    const allHeld = new Set<Action>([...held, ...touch.held]);
    for (const a of touch.pressed) pressed.add(a);
    const move = touch.move.x !== 0 || touch.move.y !== 0 ? touch.move : keyMove;
    return { held: allHeld, pressed, move, pointerWorld: this.pointerWorld() };
  }

  /**
   * 今カメラのスクロールに足している揺れのずれを知らせる（ArenaScene が毎フレーム、スクロールを決めた後に呼ぶ）。
   * 照準の計算では差し引く（揺れは Math.random で決まる表示だけの値で、シミュレーションへの入力に入れないため）。
   */
  setViewOffset(x: number, y: number): void {
    // 毎フレーム呼ぶので、入れ物は作り直さず書き換える
    this.viewOffset.x = x;
    this.viewOffset.y = y;
  }

  /**
   * 照準の世界座標。カメラの scroll・zoom と、ポインターの画面座標から計算する。
   * 揺れはカメラのスクロールに足しているので（ArenaScene。docs/progress D-HUD-12）、worldView から
   * そのずれを差し引いて、揺れを含まない値にする。Phaser の pointer.worldX/Y は揺れを含むので使わない。
   * 回転は使っていない。
   */
  pointerWorld(): { x: number; y: number } {
    // タッチの表示の間：プレイヤーの位置＋照準の向き×距離（カメラにも揺れにも関わらない）
    const touch = this.lastTouch;
    if (touch !== undefined)
      return aimWorldPoint(this.aimOrigin, touch.aim, touch.aimDistance, this.pixelsPerMeter);
    const cam = this.scene.cameras.main;
    const pointer = this.scene.input.activePointer;
    return {
      x: cam.worldView.x - this.viewOffset.x + (pointer.x - cam.x) / cam.zoomX,
      y: cam.worldView.y - this.viewOffset.y + (pointer.y - cam.y) / cam.zoomY,
    };
  }
}
