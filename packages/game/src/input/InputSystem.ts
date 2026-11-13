import Phaser from "phaser";
import { ACTIONS, type Action, type Binding, DEFAULT_BINDINGS } from "./actions.ts";
import type { InputFrame } from "./frame.ts";

export type { InputFrame } from "./frame.ts";

/** キーボード・マウスを読み、行動に変える。 */
export class InputSystem {
  private readonly scene: Phaser.Scene;
  private readonly keys = new Map<string, Phaser.Input.Keyboard.Key>();
  private readonly listeners = new Map<string, () => void>();
  private bindings: Readonly<Record<Action, readonly Binding[]>>;
  private previous = new Set<Action>();
  /** 前回の read() の後に押されたキー・ボタン（同じフレームの間に押して離した入力も取りこぼさない）。 */
  private readonly latched = new Set<string>();

  constructor(
    scene: Phaser.Scene,
    bindings: Readonly<Record<Action, readonly Binding[]>> = DEFAULT_BINDINGS,
  ) {
    this.scene = scene;
    this.bindings = bindings;
    this.registerKeys();
    // 右クリックはスキルの枠なので、ブラウザのメニューを出さない
    scene.input.mouse?.disableContextMenu();
    // 押したボタンは pointer.button で見る（0＝左、2＝右）。押した瞬間には、ボタンの状態がまだ更新されていないことがあるため
    scene.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
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
    return b.mouse === "left" ? pointer.leftButtonDown() : pointer.rightButtonDown();
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
    const move = {
      x: (held.has("moveRight") ? 1 : 0) - (held.has("moveLeft") ? 1 : 0),
      y: (held.has("moveDown") ? 1 : 0) - (held.has("moveUp") ? 1 : 0),
    };
    const pointer = this.scene.input.activePointer;
    return { held, pressed, move, pointerWorld: { x: pointer.worldX, y: pointer.worldY } };
  }
}
