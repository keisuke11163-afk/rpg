/**
 * 入力の「行動」と、初期のキーの割り当て（補助仕様書 1.1）。
 * ゲームの処理は行動だけを見て、キーやボタンを直接は見ない（開発計画書 3.1 の方針4）。
 * ゲームパッドの割り当て（補助仕様書 1.2）は、この表に追加すれば足せる形にしている。
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
  "flaskHp",
  "flaskMp",
  "interact",
  "inventory",
  "character",
  "starBoard",
  "jobBoard",
  "map",
  "showLoot",
  "menu",
] as const;
export type Action = (typeof ACTIONS)[number];

/** キー（Phaser のキーの名前）か、マウスのボタン。 */
export type Binding = { readonly key: string } | { readonly mouse: "left" | "right" };

/** 初期のキーボード・マウスの割り当て（補助仕様書 1.1）。設定で変えられるようにする（U-12 以降）。 */
export const DEFAULT_BINDINGS: Readonly<Record<Action, readonly Binding[]>> = {
  moveUp: [{ key: "W" }],
  moveDown: [{ key: "S" }],
  moveLeft: [{ key: "A" }],
  moveRight: [{ key: "D" }],
  skill1: [{ mouse: "left" }],
  skill2: [{ mouse: "right" }],
  skill3: [{ key: "ONE" }],
  skill4: [{ key: "TWO" }],
  skill5: [{ key: "THREE" }],
  skill6: [{ key: "FOUR" }],
  dodge: [{ key: "SPACE" }],
  flaskHp: [{ key: "Q" }],
  flaskMp: [{ key: "E" }],
  interact: [{ key: "F" }],
  inventory: [{ key: "I" }],
  character: [{ key: "C" }],
  starBoard: [{ key: "T" }],
  jobBoard: [{ key: "J" }],
  map: [{ key: "M" }],
  showLoot: [{ key: "ALT" }],
  menu: [{ key: "ESC" }],
};
