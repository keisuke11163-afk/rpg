/** 小さな地図の印（補助仕様書16章）。 */
import { describe, expect, it } from "vitest";
import { MINIMAP, minimapMarks, minimapScale } from "../src/ui/minimap.ts";

const base = {
  size: { width: 80, height: 40 },
  player: { x: 40, y: 20 },
  enemies: [],
  chests: [],
  exits: [],
  facilities: [],
};

describe("小さな地図", () => {
  it("地域の縦横の比を保って枠に収め、真ん中の自分は枠の真ん中", () => {
    const { k } = minimapScale(base.size);
    expect(k).toBeCloseTo(Math.min(MINIMAP.width / 80, MINIMAP.height / 40));
    const [me] = minimapMarks(base);
    expect(me?.kind).toBe("player");
    expect(me?.x).toBeCloseTo(MINIMAP.x + MINIMAP.width / 2);
    expect(me?.y).toBeCloseTo(MINIMAP.y + MINIMAP.height / 2);
  });

  it("敵・精鋭・ボス・宝箱・出口（閉じた出口）・施設を印にし、自分を最後（一番上）に描く", () => {
    const marks = minimapMarks({
      ...base,
      enemies: [
        { x: 1, y: 1, boss: false, elite: false },
        { x: 2, y: 2, boss: false, elite: true },
        { x: 3, y: 3, boss: true, elite: false },
      ],
      chests: [{ x: 5, y: 5 }],
      exits: [
        { x: 79, y: 20, open: true },
        { x: 0, y: 20, open: false },
      ],
      stone: { x: 10, y: 10 },
      facilities: [{ x: 20, y: 20 }],
    });
    expect(marks.map((m) => m.kind)).toEqual([
      "facility",
      "exit",
      "exitClosed",
      "stone",
      "chest",
      "enemy",
      "elite",
      "boss",
      "player",
    ]);
  });

  it("地域の外の点は枠の中に収める", () => {
    const [me] = minimapMarks({ ...base, player: { x: -10, y: 999 } });
    expect(me?.x).toBeGreaterThanOrEqual(MINIMAP.x);
    expect(me?.y).toBeLessThanOrEqual(MINIMAP.y + MINIMAP.height);
  });
});
