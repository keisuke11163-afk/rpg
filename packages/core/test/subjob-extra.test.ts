/**
 * サブジョブの追加の確認（core）：副職紋のポイントの境界（表）・振り直しの金貨・キャラLv25の境界と理由・
 * メイン6×サブ5の全組み合わせと転職で外れる条件・職紋盤（副職紋）の取得の拒否理由（subOnlyMinor）。
 * 基本の規則は subjob.test.ts。実データ（全ジョブ・全ノード）の確認は packages/game/test/subjob-extra.test.ts。
 */
import { describe, expect, it } from "vitest";
import {
  Character,
  type ContentDb,
  JobBoardAllocation,
  type JobDef,
  type JobNodeDef,
  subJobBoardPoints,
  subJobBoardRespecCost,
} from "../src/index.ts";
import { buildDb } from "./helpers/content.ts";

const job = (id: string, extra: Partial<JobDef> = {}): JobDef => ({
  id,
  tag: `TAG-${id}`,
  text: "j.x",
  skills: [{ skill: `SKL-${id}-A`, level: 1 }],
  affinity: {},
  ...extra,
});

/** 基本職6つ（メイン6×サブ5の組み合わせに使う）と、上位職1つ。 */
const P1 = job("JOB-P1");
const P2 = job("JOB-P2");
const SIX: readonly JobDef[] = [P1, P2, job("JOB-P3"), job("JOB-P4"), job("JOB-P5"), job("JOB-P6")];
const ADV = job("JOB-ADV6", { advancedFrom: ["JOB-P1"] });
const JOBS: ReadonlyMap<string, JobDef> = new Map([...SIX, ADV].map((j) => [j.id, j]));

/** ジョブ6つを、全てジョブLv25で持つキャラクター（origin がメイン）。 */
const of = (origin: JobDef, level = 25): Character =>
  new Character({
    jobs: JOBS,
    origin,
    level,
    jobLevels: Object.fromEntries(SIX.map((j) => [j.id, 25])),
  });

describe("副職紋のポイントの境界（表）", () => {
  it.each([
    [1, 0],
    [2, 1],
    [19, 18],
    [20, 19],
    [21, 20],
    [22, 20],
    [25, 20],
  ] as const)("サブジョブのジョブLv %i → 副職紋のポイント %i", (lv, points) => {
    expect(subJobBoardPoints(lv)).toBe(points);
  });
});

describe("振り直しの金貨（サブジョブのジョブLvで決まる）", () => {
  it.each([
    [1, 20],
    [10, 200],
    [25, 500],
  ] as const)("サブジョブのジョブLv %i → %i 金貨（20 × ジョブLv）", (lv, cost) => {
    expect(subJobBoardRespecCost(lv)).toBe(cost);
    expect(cost).toBe(20 * lv);
  });
});

describe("キャラLv25の境界と、設定できない理由", () => {
  it("キャラLv24ではどのジョブも設定できず、理由は level。Lv25では全てのサブが設定できる", () => {
    const low = of(P1, 24);
    for (const sub of SIX.slice(1)) {
      expect(low.subJobBlock(sub.id), sub.id).toBe("level");
      expect(low.setSubJob(sub.id), sub.id).toBe(false);
    }
    expect(low.subJob).toBeUndefined();

    const hi = of(P1, 25);
    for (const sub of SIX.slice(1)) {
      expect(hi.setSubJob(sub.id), sub.id).toBe(true);
      expect(hi.subJob, sub.id).toBe(sub.id);
    }
  });

  it("理由：メインと同じ（sameAsMain）・上位職（advanced）は失敗し、存在しないIDは RangeError。状態は変わらない", () => {
    const c = of(P1);
    expect(c.setSubJob(P2.id)).toBe(true);
    expect(c.subJobBlock(P1.id)).toBe("sameAsMain");
    expect(c.setSubJob(P1.id)).toBe(false);
    expect(c.subJobBlock(ADV.id)).toBe("advanced");
    expect(c.setSubJob(ADV.id)).toBe(false);
    expect(() => c.setSubJob("JOB-NOPE")).toThrow(RangeError);
    expect(() => c.subJobBlock("JOB-NOPE")).toThrow(RangeError);
    expect(c.subJob).toBe(P2.id);
  });
});

describe("メイン6×サブ5＝30通り", () => {
  it("どの組み合わせも設定でき、転職で新しいメインがサブと同じときだけサブが外れる", () => {
    let pairs = 0;
    for (const main of SIX)
      for (const sub of SIX) {
        if (main.id === sub.id) continue;
        pairs += 1;
        for (const target of SIX) {
          if (target.id === main.id) continue;
          const c = of(main);
          expect(c.setSubJob(sub.id), `${main.id}＋${sub.id}`).toBe(true);
          expect(c.changeJob(target.id), `${main.id}→${target.id}`).toBe(true);
          expect(c.mainJob).toBe(target.id);
          expect(c.subJob, `${main.id}＋${sub.id} を ${target.id} に転職`).toBe(
            target.id === sub.id ? undefined : sub.id,
          );
        }
      }
    expect(pairs).toBe(30);
  });
});

/**
 * 職紋盤の合成データ（JobBoardAllocation が読むつながりだけ）。
 * JOB-A：始点・小ノード4（A-1〜A-4）・大ノード（A-3 は notable）・接続（A-C）・職奥義（A-M）。
 * JOB-B：始点・小ノード・大ノード・接続・職奥義。
 */
const node = (
  id: string,
  jobId: string,
  kind: JobNodeDef["kind"],
  links: string[],
): JobNodeDef => ({
  id,
  job: jobId,
  kind,
  links,
  position: { x: 0, y: 0 },
});
const NODES: JobNodeDef[] = [
  node("S-A", "JOB-A", "start", ["A-1"]),
  node("A-1", "JOB-A", "minor", ["S-A", "A-2"]),
  node("A-2", "JOB-A", "minor", ["A-1", "A-3", "A-M"]),
  node("A-3", "JOB-A", "notable", ["A-2", "A-4"]),
  node("A-4", "JOB-A", "minor", ["A-3", "A-C"]),
  node("A-C", "JOB-A", "connector", ["A-4"]),
  node("A-M", "JOB-A", "mastery", ["A-2"]),
  node("S-B", "JOB-B", "start", ["B-1"]),
  node("B-1", "JOB-B", "minor", ["S-B", "B-2"]),
  node("B-2", "JOB-B", "notable", ["B-1", "B-C", "B-M"]),
  node("B-C", "JOB-B", "connector", ["B-2"]),
  node("B-M", "JOB-B", "mastery", ["B-1"]),
];

/** 合成の職紋盤を載せたデータ（つながりは両向きにする。ほかの項目は空のまま）。 */
function boardDb(nodes: readonly JobNodeDef[]): ContentDb {
  const links = new Map<string, Set<string>>(nodes.map((n) => [n.id, new Set<string>()]));
  for (const n of nodes)
    for (const l of n.links) {
      links.get(n.id)?.add(l);
      links.get(l)?.add(n.id);
    }
  return {
    ...buildDb({}),
    jobNodes: new Map(nodes.map((n) => [n.id, n])),
    jobLinks: links,
    jobBoardStarts: new Map(nodes.filter((n) => n.kind === "start").map((n) => [n.job, n.id])),
  };
}
const DB = boardDb(NODES);

describe("職紋盤（副職紋）の取得：職奥義・接続ノードの拒否理由", () => {
  it("小ノード・大ノードは、始点からつながる順に、ポイントの中で取れる。ポイントが0なら points", () => {
    const b = new JobBoardAllocation(DB, "JOB-A", [], "sub");
    expect(b.allocateBlock("A-1", 0)).toBe("points");
    for (const id of ["A-1", "A-2", "A-3", "A-4"]) expect(b.allocate(id, 4), id).toBe(true);
    expect(b.spent).toBe(4);
    expect(b.allocateBlock("A-C", 10)).toBe("subOnlyMinor");
  });

  it("職奥義・接続ノードは、つながっていてもポイントが残っていても、副職紋では subOnlyMinor", () => {
    const b = new JobBoardAllocation(DB, "JOB-A", ["A-1", "A-2"], "sub");
    expect(b.allocateBlock("A-M", 10)).toBe("subOnlyMinor");
    expect(b.allocate("A-M", 10)).toBe(false);
    expect(b.allocate("A-C", 10)).toBe(false);
    expect(b.nodes).toEqual(["A-1", "A-2"]);
    // メインの盤なら、同じ位置の職奥義は取れる（規則は変わらない）
    const main = new JobBoardAllocation(DB, "JOB-A", ["A-1", "A-2"]);
    expect(main.allocateBlock("A-M", 10)).toBeUndefined();
  });

  it("作るとき：副職紋に職奥義・接続ノードを入れると RangeError。メインの盤なら入る", () => {
    for (const bad of ["A-M", "A-C"])
      expect(() => new JobBoardAllocation(DB, "JOB-A", ["A-1", bad], "sub"), bad).toThrow(
        RangeError,
      );
    expect(() => new JobBoardAllocation(DB, "JOB-A", ["A-1", "A-2", "A-M"])).not.toThrow();
  });

  it("全ノードの走査：副職紋では、職奥義・接続だけが subOnlyMinor。始点は start。それ以外は取れ得る", () => {
    for (const n of NODES) {
      const r = new JobBoardAllocation(DB, n.job, [], "sub").allocateBlock(n.id, 10);
      if (n.kind === "start") expect(r, n.id).toBe("start");
      else if (n.kind === "mastery" || n.kind === "connector") expect(r, n.id).toBe("subOnlyMinor");
      else expect(r, n.id).not.toBe("subOnlyMinor");
    }
  });
});
