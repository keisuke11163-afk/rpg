/** 設定の保存（ブラウザの localStorage。使えないときは保存しない）。 */
import { type Settings, parseSettings } from "./settings.ts";

const KEY = "stella-sigil.settings";

export function loadSettings(): Settings {
  try {
    return parseSettings(globalThis.localStorage.getItem(KEY));
  } catch {
    return parseSettings(null);
  }
}

export function saveSettings(s: Settings): void {
  try {
    globalThis.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // 保存できない環境（プライベートブラウズなど）では、この起動の間だけ効く
  }
}
