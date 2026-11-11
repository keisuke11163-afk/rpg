/**
 * 設定（補助仕様書16章：キーの割り当て・音量・画面の拡大率）。端末ごとの設定なので、セーブデータには入れない
 * （ブラウザの localStorage に保存する。docs/progress D-UI-2）。Phaser に依存しない。
 */
import { ACTIONS, type Action, type Binding, DEFAULT_BINDINGS } from "../input/actions.ts";

/** 画面の拡大率：fit＝画面に合わせる（整数倍とは限らない）・数＝その整数倍で表示する。 */
export const SCALES = ["fit", 1, 2, 3] as const;
export type ScaleSetting = (typeof SCALES)[number];

export interface Settings {
  readonly version: 1;
  /** 初期の割り当てから変えた行動だけ。 */
  readonly bindings: Readonly<Partial<Record<Action, readonly Binding[]>>>;
  /** 音量（0〜1）。 */
  readonly volume: number;
  readonly scale: ScaleSetting;
}

export const DEFAULT_SETTINGS: Settings = { version: 1, bindings: {}, volume: 0.8, scale: "fit" };

/** 設定の画面で変えられない行動（Esc：画面を閉じる・設定を開く。変えると戻せなくなるため）。 */
export const FIXED_ACTIONS: readonly Action[] = ["menu"];

const isBinding = (b: unknown): b is Binding => {
  if (typeof b !== "object" || b === null) return false;
  const o = b as Record<string, unknown>;
  if ("key" in o) return typeof o["key"] === "string" && o["key"] !== "";
  return o["mouse"] === "left" || o["mouse"] === "right";
};

/** 保存した文字列から設定を読む。壊れている所は初期値に戻す（例外を投げない）。 */
export function parseSettings(raw: string | null | undefined): Settings {
  if (raw === null || raw === undefined) return DEFAULT_SETTINGS;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return DEFAULT_SETTINGS;
  }
  if (typeof o !== "object" || o === null) return DEFAULT_SETTINGS;
  const r = o as Record<string, unknown>;
  const bindings: Partial<Record<Action, readonly Binding[]>> = {};
  const rb = r["bindings"];
  if (typeof rb === "object" && rb !== null)
    for (const a of ACTIONS) {
      const list = (rb as Record<string, unknown>)[a];
      if (FIXED_ACTIONS.includes(a) || !Array.isArray(list)) continue;
      const ok = list.filter(isBinding);
      if (ok.length > 0) bindings[a] = ok;
    }
  const v = r["volume"];
  const volume = typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.8;
  const s = r["scale"];
  const scale = SCALES.find((x) => x === s) ?? "fit";
  return { version: 1, bindings, volume, scale };
}

/** 実際に使う割り当て（初期の割り当てに、変えた分を重ねる）。 */
export function effectiveBindings(s: Settings): Record<Action, readonly Binding[]> {
  const out = { ...DEFAULT_BINDINGS } as Record<Action, readonly Binding[]>;
  for (const a of ACTIONS) {
    const b = s.bindings[a];
    if (b !== undefined) out[a] = b;
  }
  return out;
}

const same = (a: Binding, b: Binding): boolean =>
  "key" in a ? "key" in b && a.key === b.key : "mouse" in b && a.mouse === b.mouse;

/**
 * 行動の割り当てを1つのキー（ボタン）に変える。そのキーを別の行動が使っていれば、その行動には
 * この行動の元の割り当てを渡す（入れ替え。どの行動も割り当てが無くならないように）。
 */
export function rebind(s: Settings, action: Action, binding: Binding): Settings {
  if (FIXED_ACTIONS.includes(action)) return s;
  const current = effectiveBindings(s);
  const before = current[action];
  const next: Partial<Record<Action, readonly Binding[]>> = { ...s.bindings, [action]: [binding] };
  for (const other of ACTIONS) {
    if (other === action) continue;
    if (!current[other].some((b) => same(b, binding))) continue;
    if (FIXED_ACTIONS.includes(other)) return s; // Esc などは奪えない
    const rest = current[other].filter((b) => !same(b, binding));
    next[other] = rest.length > 0 ? rest : before;
  }
  return { ...s, bindings: next };
}

/** 割り当ての表示の名前（例：W・SPACE→スペース・左クリック）。 */
export function bindingName(b: Binding): string {
  if ("mouse" in b) return b.mouse === "left" ? "左クリック" : "右クリック";
  const NAMES: Readonly<Record<string, string>> = {
    SPACE: "スペース",
    ESC: "Esc",
    ALT: "Alt",
    SHIFT: "Shift",
    CTRL: "Ctrl",
    TAB: "Tab",
    ENTER: "Enter",
    ONE: "1",
    TWO: "2",
    THREE: "3",
    FOUR: "4",
    FIVE: "5",
    SIX: "6",
    SEVEN: "7",
    EIGHT: "8",
    NINE: "9",
    ZERO: "0",
  };
  return NAMES[b.key] ?? b.key;
}

/** 設定の画面での行動の名前。 */
export const ACTION_NAME: Readonly<Record<Action, string>> = {
  moveUp: "上へ移動",
  moveDown: "下へ移動",
  moveLeft: "左へ移動",
  moveRight: "右へ移動",
  skill1: "技の枠1",
  skill2: "技の枠2",
  skill3: "技の枠3",
  skill4: "技の枠4",
  skill5: "技の枠5",
  skill6: "技の枠6",
  dodge: "回避",
  flaskHp: "HP瓶",
  flaskMp: "MP瓶",
  interact: "拾う・調べる",
  inventory: "インベントリ",
  character: "キャラクター",
  starBoard: "星辰盤",
  jobBoard: "職紋盤",
  map: "地図",
  showLoot: "名前を全て表示",
  menu: "画面を閉じる・設定",
};

/** 設定を読み書きする側（ArenaScene）。set で保存し、割り当て・音量・拡大率をすぐに効かせる。 */
export interface SettingsHost {
  get(): Settings;
  set(s: Settings): void;
}

const DIGITS = ["ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE"];
const CODE_NAMES: Readonly<Record<string, string>> = {
  Space: "SPACE",
  ShiftLeft: "SHIFT",
  ShiftRight: "SHIFT",
  ControlLeft: "CTRL",
  ControlRight: "CTRL",
  AltLeft: "ALT",
  AltRight: "ALT",
  Tab: "TAB",
  Enter: "ENTER",
  Backspace: "BACKSPACE",
  ArrowUp: "UP",
  ArrowDown: "DOWN",
  ArrowLeft: "LEFT",
  ArrowRight: "RIGHT",
  Escape: "ESC",
};

/** ブラウザのキーの位置（KeyboardEvent.code。例：KeyW・Digit1）→ キーの名前（Phaser の KeyCodes の名前）。 */
export function keyNameFromCode(code: string): string | undefined {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter !== null) return letter[1];
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(code);
  if (digit !== null) return DIGITS[Number(digit[1])];
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  return CODE_NAMES[code];
}
