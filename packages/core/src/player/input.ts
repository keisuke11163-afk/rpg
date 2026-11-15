/**
 * 入力の抽象化（補助仕様書 1章）。キーやボタンではなく「行動」で扱う。
 * 割り当ては差し替えられる（ゲームパッドは将来、割り当てを足すだけ）。
 */

export const ACTIONS = [
  "moveUp",
  "moveDown",
  "moveLeft",
  "moveRight",
  "skill1",
  "skill2",
  "skill3",
  "skill4",
  "skill5",
  "skill6",
  "dodge",
  "potionHp",
  "potionMp",
  "interact",
  "inventory",
  "character",
  "starBoard",
  "jobBoard",
  "map",
  "showItemNames",
  "menu",
] as const;
export type Action = (typeof ACTIONS)[number];

/** 初期の割り当て（キーの名前は KeyboardEvent.code・マウスは Mouse0/Mouse2） */
export const DEFAULT_BINDINGS: Readonly<Record<Action, readonly string[]>> = {
  moveUp: ["KeyW"],
  moveDown: ["KeyS"],
  moveLeft: ["KeyA"],
  moveRight: ["KeyD"],
  skill1: ["Mouse0"],
  skill2: ["Mouse2"],
  skill3: ["Digit1"],
  skill4: ["Digit2"],
  skill5: ["Digit3"],
  skill6: ["Digit4"],
  dodge: ["Space"],
  potionHp: ["KeyQ"],
  potionMp: ["KeyE"],
  interact: ["KeyF"],
  inventory: ["KeyI"],
  character: ["KeyC"],
  starBoard: ["KeyT"],
  jobBoard: ["KeyJ"],
  map: ["KeyM"],
  showItemNames: ["AltLeft", "AltRight"],
  menu: ["Escape"],
};

export type Bindings = Readonly<Record<Action, readonly string[]>>;

/** 押されている入力（キー・ボタン）の集合から、押されている行動の集合を求める */
export function pressedActions(
  pressed: ReadonlySet<string>,
  bindings: Bindings = DEFAULT_BINDINGS,
): Set<Action> {
  const out = new Set<Action>();
  for (const action of ACTIONS) {
    if (bindings[action].some((key) => pressed.has(key))) out.add(action);
  }
  return out;
}

/** 移動の入力を、長さ0か1の方向ベクトルにする（斜めは正規化。8方向） */
export function moveVector(actions: ReadonlySet<Action>): { x: number; y: number } {
  const x = (actions.has("moveRight") ? 1 : 0) - (actions.has("moveLeft") ? 1 : 0);
  const y = (actions.has("moveDown") ? 1 : 0) - (actions.has("moveUp") ? 1 : 0);
  if (x === 0 && y === 0) return { x: 0, y: 0 };
  const len = Math.hypot(x, y);
  return { x: x / len, y: y / len };
}

/** 角度（ラジアン、x軸が0・yは下向き）を8方向（0=右、時計回りに1=右下…）に丸める */
export function facing8(angle: number): number {
  const turn = (angle / (Math.PI * 2) + 1) % 1;
  return Math.round(turn * 8) % 8;
}
