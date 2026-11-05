import { describe, expect, it } from "vitest";
import { StepInputBuffer } from "../src/index.ts";

describe("StepInputBuffer（押した瞬間の入力を刻みまで保持する）", () => {
  it("記録した入力は、取り出すまで残る", () => {
    const b = new StepInputBuffer<"dodge" | "skill1">();
    b.press(["dodge"]);
    expect(b.has("dodge")).toBe(true);
    expect(b.has("skill1")).toBe(false);
    // 刻みがない（取り出されない）間は、何度記録しても1つのまま残る
    b.press(["dodge"]);
    expect(b.has("dodge")).toBe(true);
  });

  it("取り出すと true を1回だけ返す", () => {
    const b = new StepInputBuffer<"dodge">();
    b.press(["dodge"]);
    expect(b.take("dodge")).toBe(true);
    expect(b.take("dodge")).toBe(false);
    expect(b.has("dodge")).toBe(false);
  });

  it("記録していなければ取り出せない", () => {
    const b = new StepInputBuffer<"dodge">();
    b.press([]);
    expect(b.take("dodge")).toBe(false);
  });

  it("行動ごとに独立して保持し、clear で全て捨てる", () => {
    const b = new StepInputBuffer<"dodge" | "skill1">();
    b.press(["dodge", "skill1"]);
    expect(b.take("skill1")).toBe(true);
    expect(b.has("dodge")).toBe(true);
    b.clear();
    expect(b.take("dodge")).toBe(false);
  });
});
