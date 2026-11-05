import type { Vec2 } from "@stella/core";
import type { Action } from "./actions.ts";

/** 1フレーム分の入力（Phaser に依存しない形。InputSystem が作る）。 */
export interface InputFrame {
  /** 押している行動。 */
  readonly held: ReadonlySet<Action>;
  /** このフレームで押し始めた行動。 */
  readonly pressed: ReadonlySet<Action>;
  /** 移動の入力（WASD。長さは揃えていない）。 */
  readonly move: Vec2;
  /** マウスの位置（世界の座標・ピクセル）。 */
  readonly pointerWorld: Vec2;
}
