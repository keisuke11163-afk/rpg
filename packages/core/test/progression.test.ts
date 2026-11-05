import { describe, expect, it } from "vitest";
import {
  Character,
  type JobDef,
  LevelTrack,
  enemyXp,
  levelGapMultiplier,
  xpToNext,
} from "../src/index.ts";

const job = (id: string, attrs?: JobDef["originAttributes"]): JobDef => ({
  id,
  tag: `TAG-${id}`,
  text: "j.x",
  skills: [],
  affinity: {},
  ...(attrs === undefined ? {} : { originAttributes: attrs }),
});
const WARRIOR = job("JOB-W", { go: 20, jin: 10, ri: 5, kon: 5 });

describe("経験値の表（補助仕様書4.1）", () => {
  it("290 × L^1.2 を四捨五入した値", () => {
    const table = [290, 666, 1084, 1531, 2001, 2490, 2996, 3516, 4050, 4596];
    const table2 = [5153, 5720, 6297, 6883, 7477, 8079, 8688, 9305, 9929];
    expect(table.map((_, i) => xpToNext(i + 1))).toEqual(table);
    expect(table2.map((_, i) => xpToNext(i + 11))).toEqual(table2);
  });

  it("表のとおりにLvが上がり、上限（20）でそれ以上は貯まらない", () => {
    const t = new LevelTrack(20);
    expect(t.add(289)).toBe(0);
    expect(t.add(1)).toBe(1);
    expect(t.level).toBe(2);
    expect(t.add(666 + 1084 + 10)).toBe(2);
    expect([t.level, t.xp]).toEqual([4, 10]);
    expect(t.add(1e7)).toBe(16);
    expect([t.level, t.xp, t.toNext]).toEqual([20, 0, 0]);
    expect(t.add(100)).toBe(0);
  });
});

describe("敵の経験値（補助仕様書4.2）", () => {
  it("5 ＋ 2 × 敵のLv、格の倍率", () => {
    expect(enemyXp(1)).toBe(7);
    expect(enemyXp(10, 3)).toBe(75);
    expect(enemyXp(10, 10)).toBe(250);
  });

  it("プレイヤーが4以上高いと、1Lvごとに-20%（最低10%）", () => {
    expect([0, 3, 4, 5, 7, 8, 15].map((g) => levelGapMultiplier(5 + g, 5))).toEqual([
      1,
      1,
      0.8,
      0.6,
      expect.closeTo(0.2) as unknown as number,
      0.1,
      0.1,
    ]);
    expect(levelGapMultiplier(1, 10)).toBe(1);
  });
});

describe("キャラクターとジョブLv（仕様書5.1・補助仕様書4.3）", () => {
  it("経験値は、キャラLvとメインジョブのジョブLvに同じ量が入る", () => {
    const c = new Character({ origin: WARRIOR });
    const g = c.gainXp(290);
    expect([g.characterLevels, g.jobLevels, g.jobXp]).toEqual([1, 1, 290]);
    expect([c.level, c.jobLevel("JOB-W")]).toEqual([2, 2]);
  });

  it("転職はキャラLv15から。転職してもジョブLvは混ざらない", () => {
    const c = new Character({ origin: WARRIOR, level: 14, jobLevels: { "JOB-W": 14 } });
    expect(c.changeJob("JOB-R")).toBe(false);
    c.gainXp(xpToNext(14));
    expect(c.level).toBe(15);
    expect(c.changeJob("JOB-R")).toBe(true);
    expect([c.mainJob, c.jobLevel("JOB-R"), c.jobLevel("JOB-W")]).toEqual(["JOB-R", 1, 15]);
    c.gainXp(1000);
    expect(c.jobLevel("JOB-W")).toBe(15);
    expect(c.jobLevel("JOB-R")).toBeGreaterThan(1);
  });

  it("追いつき補正：最も高いジョブLv－10未満のあいだは、ジョブ経験値×2", () => {
    const c = new Character({ origin: WARRIOR, level: 15, jobLevels: { "JOB-W": 15 } });
    c.changeJob("JOB-R");
    expect(c.catchingUp).toBe(true);
    expect(c.gainXp(100).jobXp).toBe(200);
    const d = new Character({
      origin: WARRIOR,
      level: 15,
      jobLevels: { "JOB-W": 15, "JOB-R": 5 },
    });
    d.changeJob("JOB-R");
    expect(d.catchingUp).toBe(false);
    expect(d.gainXp(100).jobXp).toBe(100);
  });

  it("基礎の値：HP＝48＋12×Lv、MP＝60、命中＝2×Lv。能力値は効果として重ねる", () => {
    const c = new Character({ origin: WARRIOR, level: 3 });
    expect(c.baseStats()).toEqual({ "STAT-HP-MAX": 84, "STAT-MP-MAX": 60, "STAT-ACCURACY": 6 });
    expect(c.attributeEffects().map((e) => [e.effectId, e.stacks])).toEqual([
      ["EFF-ATTR-GO", 20],
      ["EFF-ATTR-JIN", 10],
      ["EFF-ATTR-RI", 5],
      ["EFF-ATTR-KON", 5],
    ]);
  });
});
