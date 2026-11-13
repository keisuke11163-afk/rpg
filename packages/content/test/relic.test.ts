/**
 * 遺物の調律（仕様書v0.2 3.11.6・9章 V-13。MVPの後の機能。docs/progress A-4）：
 * 星座の小星を取得済みとして扱う・完成ボーナスは50%・経路には使えない・強化で写せる数が増える。
 * MVP では入手できない（3.12）ので、抽選・商人には出ない。
 */
import {
  Character,
  type ContentDb,
  Equipment,
  type ItemInstance,
  TagIndex,
  buildCharacterSheet,
  droppableBases,
  relicCandidates,
  relicCopies,
  relicCopyLimit,
  relicSelectionProblem,
  slotsFor,
} from "@stella/core";
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../src/index.ts";

const db: ContentDb = loadGameContent();
const tags = new TagIndex(db.tags);
const ROGUE = (() => {
  const j = db.jobs.get("JOB-ROGUE");
  if (j === undefined) throw new Error("盗賊が無い");
  return j;
})();
const FLUTE = "BASE-RELIC-SNAKE-FLUTE";
const V = (n: number): string => `STAR-VIPER-0${String(n)}`;
const toViper = ["STAR-JIN-0001", "STAR-JIN-0201", "STAR-JIN-0202"];

const flute = (relicNodes: string[], enhance = 0): ItemInstance => ({
  uid: "flute",
  base: FLUTE,
  rarity: "normal",
  itemLevel: 20,
  affixes: [],
  ...(enhance === 0 ? {} : { enhance }),
  relicNodes,
});

function sheet(allocation: readonly string[], relic?: ItemInstance) {
  const equipment = new Equipment(db);
  if (relic !== undefined) equipment.equip(relic, "relic", true);
  return buildCharacterSheet(db, tags, {
    character: new Character({ jobs: db.jobs, origin: ROGUE, level: 20 }),
    job: ROGUE,
    equipment,
    starBoard: { allocation },
  });
}

describe("遺物のデータ", () => {
  it("蛇使いの骨笛：遺物の部位・毒蛇座の小星9つが候補・抽選と商人には出ない", () => {
    const base = db.itemBases.get(FLUTE);
    expect(base?.category).toBe("relic");
    if (base === undefined) throw new Error("骨笛が無い");
    expect(slotsFor(base, true)).toEqual(["relic"]);
    expect(base.relic?.constellation).toBe("CONST-VIPER");
    expect(relicCandidates(db, FLUTE)).toHaveLength(9);
    expect(droppableBases(db, 99).some((b) => b.id === FLUTE)).toBe(false);
  });

  it("写せる数：+0で3つ、+10で7つ（途中は⌊3＋0.4×強化値⌋）", () => {
    expect([0, 1, 2, 3, 5, 8, 10].map((e) => relicCopyLimit(db, FLUTE, e))).toEqual([
      3, 3, 3, 4, 5, 6, 7,
    ]);
    expect(relicCopyLimit(db, "BASE-ACC-SILVER-RING-T1", 10)).toBe(0);
  });

  it("選び方の検証：候補でない・重なる・上限を超える・遺物でないのに選ぶ", () => {
    expect(relicSelectionProblem(db, FLUTE, 0, [V(1), V(2), V(3)])).toBeUndefined();
    expect(relicSelectionProblem(db, FLUTE, 0, [V(1), V(2), V(3), V(4)])).toMatch(/3つまで/);
    expect(relicSelectionProblem(db, FLUTE, 10, [1, 2, 3, 4, 5, 6, 7].map(V))).toBeUndefined();
    expect(relicSelectionProblem(db, FLUTE, 0, ["STAR-JIN-0001"])).toBeDefined();
    expect(relicSelectionProblem(db, FLUTE, 0, [V(1), V(1)])).toBeDefined();
    expect(relicSelectionProblem(db, "BASE-ACC-SILVER-RING-T1", 0, [V(1)])).toBeDefined();
    expect(relicSelectionProblem(db, "BASE-ACC-SILVER-RING-T1", 0, [])).toBeUndefined();
    // 強化値を下げた（セーブの改ざんなど）ときの評価は、上限で切る
    expect(relicCopies(db, flute([1, 2, 3, 4].map(V)))?.nodes).toEqual([1, 2, 3].map(V));
  });
});

describe("遺物の写しの評価（仕様書v0.2 3.11.6）", () => {
  it("写した小星は取得済みとして効き、ポイントを使わない。写しで完成した星座の完成ボーナスは50%", () => {
    const path = [...toViper, ...[1, 2, 3, 4, 5, 6].map(V)];
    const s = sheet(path, flute([7, 8, 9].map(V)));
    expect(s.board?.relicNodes).toEqual([7, 8, 9].map(V));
    expect(s.board?.spent).toBe(path.length);
    expect(s.board?.constellations).toEqual(["CONST-VIPER"]);
    expect(s.board?.relicCompleted).toEqual(["CONST-VIPER"]);
    // 毒ダメージ+8%の小星（1・3・5・7・9）は5つとも効く
    expect(s.evaluated.view.stat("STAT-AILMENT-DAMAGE", ["TAG-AIL-POISON"]).increased).toBeCloseTo(
      0.4,
    );
    // 完成ボーナス（毒だまり20%）は半分
    expect(s.evaluated.view.stat("STAT-CONST-VIPER-PUDDLE").value).toBeCloseTo(0.1);
    // 全て自分で取れば、遺物があっても100%
    const all = sheet([...toViper, ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(V)], flute([7, 8, 9].map(V)));
    expect(all.board?.relicNodes).toEqual([]);
    expect(all.board?.relicCompleted).toEqual([]);
    expect(all.evaluated.view.stat("STAT-CONST-VIPER-PUDDLE").value).toBeCloseTo(0.2);
  });

  it("写した小星は、ほかのノードへの経路には使えない", () => {
    // 1〜3 を写し、4 だけ取る：4 は始点からつながらないので休眠
    const s = sheet([...toViper, V(4)], flute([1, 2, 3].map(V)));
    expect(s.board?.active).not.toContain(V(4));
    expect(s.board?.dormant.get(V(4))?.type).toBe("disconnected");
    expect(s.board?.relicNodes).toEqual([1, 2, 3].map(V));
  });

  it("遺物を外すと、写しの効果は消える", () => {
    const path = [...toViper, ...[1, 2, 3, 4, 5, 6].map(V)];
    const s = sheet(path);
    expect(s.board?.relicNodes).toEqual([]);
    expect(s.board?.constellations).toEqual([]);
    expect(s.evaluated.view.stat("STAT-CONST-VIPER-PUDDLE").value).toBe(0);
  });
});
