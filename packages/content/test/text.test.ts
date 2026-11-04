import { describe, expect, it } from "vitest";
import { text } from "../src/index.ts";

describe("text", () => {
  it("キーに対応する文章を返す", () => {
    expect(text("game.title")).toBe("ステラシジル（仮題）");
  });
});
