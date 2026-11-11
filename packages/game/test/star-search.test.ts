/** 星辰盤の検索（補助仕様書16章・docs/progress D-UI-1）。 */
import { describe, expect, it } from "vitest";
import { loadGameContent } from "@stella/content";
import { nodeName, searchStarNodes } from "../src/ui/star-board-view.ts";

const db = loadGameContent();
const ids = (q: string): string[] => searchStarNodes(db, q).map((n) => n.id);

describe("星辰盤の検索", () => {
  it("名前で探せる（輝星・天極）", () => {
    expect(ids("断ち切る")).toContain("STAR-NT-SEVERING");
    expect(ids("徒手")).toContain("STAR-KEY-BARE-HANDS");
  });

  it("効果の説明で探せる（小星の会心率）", () => {
    const hits = searchStarNodes(db, "会心率");
    expect(hits.length).toBeGreaterThan(3);
    expect(hits.every((n) => nodeName(db, n).includes("会心率") || n.effects !== undefined)).toBe(
      true,
    );
  });

  it("空白で区切った語は全てを含むものだけ（かつ）。種類の名前でも探せる", () => {
    const notables = ids("輝星");
    expect(notables).toContain("STAR-NT-FOCUS");
    const both = ids("輝星 会心率");
    expect(both.length).toBeLessThan(notables.length);
    expect(both.every((id) => notables.includes(id))).toBe(true);
  });

  it("空の検索・見つからない語は何も返さない。全角の英数字も同じに扱う", () => {
    expect(ids("")).toEqual([]);
    expect(ids("　 ")).toEqual([]);
    expect(ids("存在しない語ですよ")).toEqual([]);
    expect(ids("ＨＰ")).toEqual(ids("hp"));
  });
});
