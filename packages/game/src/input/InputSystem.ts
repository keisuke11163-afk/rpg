import Phaser from "phaser";
import { ACTIONS, type Action, type Binding, DEFAULT_BINDINGS } from "./actions.ts";
import type { InputFrame } from "./frame.ts";

export type { InputFrame } from "./frame.ts";

/** キーボード・マウスを読み、行動に変える。 */
export class InputSystem {
  private readonly scene: Phaser.Scene;
  private readonly keys = new Map<string, Phaser.Input.Keyboard.Key>();
  private readonly bindings: Readonly<Record<Action, readonly Binding[]>>;
  private previous = new Set<Action>();
  /** 前回の read() の後に押されたキー・ボタン（同じフレームの間に押して離した入力も取りこぼさない）。 */
  private readonly latched = new Set<string>();

  constructor(
    scene: Phaser.Scene,
    bindings: Readonly<Record<Action, readonly Binding[]>> = DEFAULT_BINDINGS,
  ) {
    this.scene = scene;
    this.bindings = bindings;
    const keyboard = scene.input.keyboard;
    if (keyboard === null) throw new Error("キーボードの入力が使えない");
    for (const list of Object.values(bindings)) {
      for (const b of list) {
        if ("key" in b && !this.keys.has(b.key)) {
          const code = (Phaser.Input.Keyboard.KeyCodes as Record<string, number | undefined>)[
            b.key
          ];
          if (code === undefined) throw new Error(`キーの名前が正しくない：${b.key}`);
          // ブラウザの操作（スクロールなど）に使われないようにする
          const key = keyboard.addKey(code, true);
          key.on("down", () => this.latched.add(`key:${b.key}`));
          this.keys.set(b.key, key);
        }
      }
    }
    // 右クリックはスキルの枠なので、ブラウザのメニューを出さない
    scene.input.mouse?.disableContextMenu();
    scene.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown()) this.latched.add("mouse:left");
      if (pointer.rightButtonDown()) this.latched.add("mouse:right");
    });
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
