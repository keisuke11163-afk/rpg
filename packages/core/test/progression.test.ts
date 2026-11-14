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
const ROGUE = job("JOB-R");
const JOBS: ReadonlyMap<string, JobDef> = new Map([WARRIOR, ROGUE].map((j) => [j.id, j]));

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
    const c = new Character({ jobs: JOBS, origin: WARRIOR });
    const g = c.gainXp(290);
    expect([g.characterLevels, g.jobLevels, g.jobXp]).toEqual([1, 1, 290]);
    expect([c.level, c.jobLevel("JOB-W")]).toEqual([2, 2]);
  });

  it("転職はキャラLv15から。転職してもジョブLvは混ざらない", () => {
    const c = new Character({ jobs: JOBS, origin: WARRIOR, level: 14, jobLevels: { "JOB-W": 14 } });
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
    const c = new Character({ jobs: JOBS, origin: WARRIOR, level: 15, jobLevels: { "JOB-W": 15 } });
    c.changeJob("JOB-R");
    expect(c.catchingUp).toBe(true);
    expect(c.gainXp(100).jobXp).toBe(200);
    const d = new Character({
      jobs: JOBS,
      origin: WARRIOR,
      level: 15,
      jobLevels: { "JOB-W": 15, "JOB-R": 5 },
    });
    d.changeJob("JOB-R");
    expect(d.catchingUp).toBe(false);
    expect(d.gainXp(100).jobXp).toBe(100);
  });

  it("基礎の値：HP＝48＋12×Lv、MP＝60、命中＝2×Lv。能力値は効果として重ねる", () => {
    const c = new Character({ jobs: JOBS, origin: WARRIOR, level: 3 });
    expect(c.baseStats()).toEqual({ "STAT-HP-MAX": 84, "STAT-MP-MAX": 60, "STAT-ACCURACY": 6 });
    expect(c.attributeEffects().map((e) => [e.effectId, e.stacks])).toEqual([
      ["EFF-ATTR-GO", 20],
      ["EFF-ATTR-JIN", 10],
      ["EFF-ATTR-RI", 5],
      ["EFF-ATTR-KON", 5],
    ]);
  });
});

describe("Lv・経験値の入力の検証（PR #13 のレビュー指摘1。PR #11 の方針）", () => {
  const BAD_AMOUNTS = [NaN, -1, -Infinity, Infinity];

  it.each(BAD_AMOUNTS)("LevelTrack.add(%s) は、状態を変えずに RangeError", (bad) => {
    const t = new LevelTrack(20, 3);
    t.add(100);
    expect(() => t.add(bad)).toThrow(RangeError);
    expect([t.level, t.xp]).toEqual([3, 100]);
    // 例外の後も、従来どおり足せる
    expect(t.add(xpToNext(3) - 100)).toBe(1);
  });

  it("LevelTrack.add は、有限の大きな値と 0 は受け付ける", () => {
    const t = new LevelTrack(20);
    expect(t.add(0)).toBe(0);
    expect(t.add(Number.MAX_VALUE)).toBe(19);
    expect([t.level, t.xp]).toEqual([20, 0]);
  });

  it.each([NaN, -1, 0, Infinity, -Infinity, 1.5, 21])(
    "LevelTrack のLv %s は RangeError（1〜上限の整数だけ）",
    (bad) => {
      expect(() => new LevelTrack(20, bad)).toThrow(RangeError);
    },
  );

  it.each([NaN, -1, 0, Infinity, 2.5])("LevelTrack の上限 %s は RangeError", (bad) => {
    expect(() => new LevelTrack(bad)).toThrow(RangeError);
  });

  it("LevelTrack は、1〜上限の整数のLvを受け付ける", () => {
    expect(new LevelTrack(20, 1).level).toBe(1);
    expect(new LevelTrack(20, 20).level).toBe(20);
  });

  it.each([NaN, -1, 0, Infinity, 1.5, 26])(
    "Character のキャラLv %s は RangeError（上限25）",
    (bad) => {
      expect(() => new Character({ jobs: JOBS, origin: WARRIOR, level: bad })).toThrow(RangeError);
    },
  );

  it.each([NaN, -1, 0, Infinity, 1.5, 26])(
    "Character のジョブLv %s は RangeError（上限25）",
    (bad) => {
      expect(
        () => new Character({ jobs: JOBS, origin: WARRIOR, jobLevels: { "JOB-W": bad } }),
      ).toThrow(RangeError);
    },
  );

  it.each(BAD_AMOUNTS)(
    "Character.gainXp(%s) は、キャラLv・ジョブLvを変えずに RangeError",
    (bad) => {
      const c = new Character({ jobs: JOBS, origin: WARRIOR, level: 5 });
      expect(() => c.gainXp(bad)).toThrow(RangeError);
      expect([c.level, c.progress.xp, c.jobLevel("JOB-W"), c.jobTrack("JOB-W").xp]).toEqual([
        5, 0, 1, 0,
      ]);
    },
  );

  it("追いつき補正でジョブ経験値が溢れる場合も、キャラLvだけ上がることはない", () => {
    const c = new Character({ jobs: JOBS, origin: WARRIOR, level: 15, jobLevels: { "JOB-W": 15 } });
    expect(c.changeJob("JOB-R")).toBe(true);
    expect(c.catchingUp).toBe(true);
    // MAX_VALUE × 2 は Infinity
    expect(() => c.gainXp(Number.MAX_VALUE)).toThrow(RangeError);
    expect([c.level, c.progress.xp, c.jobLevel("JOB-R")]).toEqual([15, 0, 1]);
  });
});

describe("転職先の検証（PR #13 のレビュー指摘2）", () => {
  it("存在しないジョブIDは、状態を変えずに RangeError（Lvが足りなくても同じ）", () => {
    const c = new Character({ jobs: JOBS, origin: WARRIOR, level: 15, jobLevels: { "JOB-W": 15 } });
    expect(() => c.changeJob("JOB-NOPE")).toThrow(RangeError);
    expect(c.mainJob).toBe("JOB-W");
    // 存在しないジョブのジョブLvの記録も作らない（最も高いジョブLv・追いつき補正に影響しない）
    expect(c.jobTrack("JOB-W").level).toBe(15);
    const low = new Character({ jobs: JOBS, origin: WARRIOR, level: 1 });
    expect(() => low.changeJob("JOB-NOPE")).toThrow(RangeError);
  });

  it("今のメインジョブと同じジョブへの転職は false で、何も変えない", () => {
    const c = new Character({ jobs: JOBS, origin: WARRIOR, level: 15, jobLevels: { "JOB-W": 15 } });
    expect(c.changeJob("JOB-W")).toBe(false);
    expect([c.mainJob, c.jobLevel("JOB-W")]).toEqual(["JOB-W", 15]);
    expect(c.changeJob("JOB-R")).toBe(true);
    c.gainXp(1000);
    const rogueXp = c.jobTrack("JOB-R").xp;
    expect(c.changeJob("JOB-R")).toBe(false);
    expect([c.mainJob, c.jobLevel("JOB-R"), c.jobTrack("JOB-R").xp]).toEqual([
      "JOB-R",
      c.jobLevel("JOB-R"),
      rogueXp,
    ]);
    // 別のジョブへは、従来どおり転職できる
    expect(c.changeJob("JOB-W")).toBe(true);
    expect(c.mainJob).toBe("JOB-W");
  });
});
