/** 設定（補助仕様書16章・docs/progress D-UI-2）。 */
import { describe, expect, it } from "vitest";
import { DEFAULT_BINDINGS } from "../src/input/actions.ts";
import {
  DEFAULT_SETTINGS,
  bindingName,
  effectiveBindings,
  parseSettings,
  rebind,
} from "../src/settings/settings.ts";

describe("設定", () => {
  it("保存が無い・壊れているときは初期値。範囲の外の値は収める", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("{壊れ")).toEqual(DEFAULT_SETTINGS);
    const s = parseSettings(
      JSON.stringify({
        volume: 5,
        scale: 7,
        bindings: { dodge: [{ key: "SHIFT" }, 3], menu: [{ key: "P" }] },
      }),
    );
    expect(s.volume).toBe(1);
    expect(s.scale).toBe("fit");
    expect(s.bindings.dodge).toEqual([{ key: "SHIFT" }]);
    expect(s.bindings.menu).toBeUndefined(); // Esc は変えられない
  });

  it("割り当てを変えると、使う割り当てに入り、保存して読み直しても同じ", () => {
    const s = rebind(DEFAULT_SETTINGS, "dodge", { key: "SHIFT" });
    expect(effectiveBindings(s).dodge).toEqual([{ key: "SHIFT" }]);
    expect(effectiveBindings(s).moveUp).toEqual(DEFAULT_BINDINGS.moveUp);
    expect(parseSettings(JSON.stringify(s))).toEqual(s);
  });

  it("別の行動が使っているキーにすると、入れ替える（どの行動も割り当てが無くならない）", () => {
    const s = rebind(DEFAULT_SETTINGS, "dodge", { key: "Q" });
    const b = effectiveBindings(s);
    expect(b.dodge).toEqual([{ key: "Q" }]);
    expect(b.flaskHp).toEqual([{ key: "SPACE" }]);
  });

  it("Esc（画面を閉じる・設定を開く）は変えられず、奪うこともできない", () => {
    expect(rebind(DEFAULT_SETTINGS, "menu", { key: "P" })).toBe(DEFAULT_SETTINGS);
    expect(rebind(DEFAULT_SETTINGS, "dodge", { key: "ESC" })).toBe(DEFAULT_SETTINGS);
  });

  it("表示の名前", () => {
    expect(bindingName({ key: "SPACE" })).toBe("スペース");
    expect(bindingName({ key: "ONE" })).toBe("1");
    expect(bindingName({ mouse: "right" })).toBe("右クリック");
    expect(bindingName({ key: "W" })).toBe("W");
  });
});

describe("キーの位置 → キーの名前", () => {
  it("英字・数字・F キー・特別なキー。知らないキーは undefined", async () => {
    const { keyNameFromCode } = await import("../src/settings/settings.ts");
    expect(keyNameFromCode("KeyK")).toBe("K");
    expect(keyNameFromCode("Digit1")).toBe("ONE");
    expect(keyNameFromCode("Numpad0")).toBe("ZERO");
    expect(keyNameFromCode("F5")).toBe("F5");
    expect(keyNameFromCode("ShiftLeft")).toBe("SHIFT");
    expect(keyNameFromCode("IntlRo")).toBeUndefined();
  });
});

describe("割り当てとセーブデータの keybinds（開発計画書6.9）", () => {
  it("行き来しても同じ。知らない行動・Esc は読まない", async () => {
    const { bindingsToKeybinds, keybindsToBindings } = await import("../src/settings/settings.ts");
    const s = rebind(rebind(DEFAULT_SETTINGS, "dodge", { key: "K" }), "skill3", { mouse: "right" });
    const kb = bindingsToKeybinds(s.bindings);
    expect(kb["dodge"]).toBe("K");
    expect(kb["skill3"]).toBe("MOUSE_RIGHT");
    expect(keybindsToBindings(kb)).toEqual(s.bindings);
    expect(keybindsToBindings({ nope: "X", menu: "P", dodge: "" })).toEqual({});
  });
});
