/**
 * 星辰盤の「8星域の環」（仕様書v0.2 4.2。docs/progress D-RING-1〜8）：
 * 8つの星域と星核があること・環の隣り合う星域がつながっていること・6つの始点から他の始点へ行けること・
 * ポイントの上限が40であること・前からあったノードの ID が1つも減っていないこと（セーブの互換）を確かめる。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  STAR_POINT_CAP,
  STAR_REGIONS,
  StarAllocation,
  type StarRegion,
  startNodeOf,
  starPoints,
} from "@stella/core";
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../src/index.ts";

const db = loadGameContent();
const nodes = [...db.starNodes.values()];
const isStart = (id: string): boolean => db.starNodes.get(id)?.kind === "start";
const regionOf = (id: string): StarRegion | undefined => db.starNodes.get(id)?.region;

/** 環の並び（仕様書v0.2 4.2）。最後の次は最初に戻る。 */
const RING: readonly StarRegion[] = [
  "gou",
  "goukon",
  "kon",
  "rikon",
  "ri",
  "jinri",
  "jin",
  "goujin",
];

/** 始点を通らずに（始点は取れないので）、from からたどれるノード。 */
function walk(from: string): Set<string> {
  const seen = new Set<string>();
  const queue = [from];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    for (const next of db.starLinks.get(cur) ?? []) {
      if (seen.has(next) || isStart(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

describe("8星域の環（仕様書v0.2 4.2）", () => {
  it("8つの星域と星核に、それぞれ取れるノードがある", () => {
    expect([...RING, "core"].sort()).toEqual([...STAR_REGIONS].sort());
    for (const r of STAR_REGIONS)
      expect(
        nodes.filter((n) => n.region === r && n.kind !== "start").length,
        r,
      ).toBeGreaterThanOrEqual(3);
  });

  it("環の隣り合う8組の星域が、始点でないノードどうしで直接つながっている", () => {
    const pairs = new Set<string>();
    for (const [id, near] of db.starLinks) {
      if (isStart(id)) continue;
      for (const other of near) {
        if (isStart(other)) continue;
        pairs.add(`${String(regionOf(id))}-${String(regionOf(other))}`);
      }
    }
    RING.forEach((r, i) => {
      const next = RING[(i + 1) % RING.length] as StarRegion;
      expect(pairs.has(`${r}-${next}`), `${r} と ${next}`).toBe(true);
    });
  });

  it("星域をまたぐつながりは、環の隣どうしか星核だけ（近道が無い）", () => {
    const allowed = new Set<string>();
    RING.forEach((r, i) => {
      const next = RING[(i + 1) % RING.length] as StarRegion;
      allowed.add(`${r}-${next}`);
      allowed.add(`${next}-${r}`);
    });
    for (const [id, near] of db.starLinks) {
      if (isStart(id)) continue;
      const a = regionOf(id);
      for (const other of near) {
        const b = regionOf(other);
        if (isStart(other) || a === undefined || b === undefined || a === b) continue;
        if (a === "core" || b === "core") continue;
        expect(allowed.has(`${a}-${b}`), `${id}(${a}) と ${other}(${b})`).toBe(true);
      }
    }
  });

  it("環は始点を通らずに一周できる（どの星域からでも、ほかの全ての星域と星核に行ける）", () => {
    for (const r of STAR_REGIONS) {
      const from = nodes.find((n) => n.region === r && n.kind !== "start");
      if (from === undefined) throw new Error(`${r} にノードが無い`);
      const reached = new Set([...walk(from.id)].map(regionOf));
      for (const other of STAR_REGIONS) expect(reached.has(other), `${r} → ${other}`).toBe(true);
    }
  });

  it("星核は、環の4つ以上の星域から直接つながっている（星核の天極が1つある）", () => {
    const from = new Set<StarRegion>();
    for (const n of nodes) {
      if (n.region !== "core") continue;
      for (const l of db.starLinks.get(n.id) ?? []) {
        const r = regionOf(l);
        if (r !== undefined && r !== "core") from.add(r);
      }
    }
    expect(from.size).toBeGreaterThanOrEqual(4);
    expect(nodes.filter((n) => n.region === "core" && n.kind === "keystone")).toHaveLength(1);
    expect(nodes.filter((n) => n.region === "kon" && n.kind === "keystone")).toHaveLength(1);
  });

  it("6つのジョブの始点は仕様書の星域にあり、どの始点からもほかの全ての始点の隣まで取って行ける", () => {
    const expected: Record<string, StarRegion> = {
      "JOB-WARRIOR": "gou",
      "JOB-KNIGHT": "goukon",
      "JOB-ROGUE": "jin",
      "JOB-ARCHER": "jinri",
      "JOB-MAGE": "ri",
      "JOB-SUMMONER": "rikon",
    };
    const starts = Object.entries(expected).map(([job, region]) => {
      const id = startNodeOf(db, job);
      expect(id, job).toBeDefined();
      expect(regionOf(id as string), job).toBe(region);
      return id as string;
    });
    // 魂域・剛迅域の始点は予約枠（仕様書v0.2 4.2）なので、始点のノードを置いていない
    expect(nodes.filter((n) => n.kind === "start").map((n) => n.region)).not.toContain("kon");
    for (const a of starts) {
      const reached = walk(a);
      for (const b of starts) {
        if (a === b) continue;
        const near = [...(db.starLinks.get(b) ?? [])];
        expect(
          near.some((x) => reached.has(x)),
          `${a} から ${b} の隣へ`,
        ).toBe(true);
      }
    }
  });

  it("魔法使い・召喚士の始点は、迅域の STAR-JIN-0202 に直接つながっていない（自分の星域と、隣の星域につながる）", () => {
    for (const id of ["STAR-RI-START", "STAR-RIKON-START"]) {
      const near = [...(db.starLinks.get(id) ?? [])];
      expect(near).not.toContain("STAR-JIN-0202");
      const own = regionOf(id);
      expect(near.some((x) => regionOf(x) === own)).toBe(true);
    }
  });
});

describe("魂域・星核の天極（仕様書v0.2 4.7。docs/progress D-RING-5）", () => {
  it("腐敗の聖杯（K05）：状態異常のダメージ×1.5、代償は打撃値-50%（状態異常の基準値には効かない）", () => {
    const n = db.starNodes.get("STAR-KEY-CORRUPT");
    expect(n?.region).toBe("kon");
    expect(n?.effects).toEqual(["EFF-KEY-CORRUPT", "EFF-KEY-CORRUPT-COST"]);
    expect(db.effects.get("EFF-KEY-CORRUPT")?.modifiers).toEqual([
      { kind: "more", stat: "STAT-AILMENT-DAMAGE", value: 1.5 },
    ]);
    const cost = db.effects.get("EFF-KEY-CORRUPT-COST");
    expect(cost?.modifiers).toEqual([
      { kind: "more", stat: "STAT-DAMAGE", value: 0.5, drawback: true },
    ]);
    expect(cost?.affects).toEqual({ hit: true, ailmentBase: false });
  });

  it("均衡の天秤（K11）：付与率+50%、代償は会心しなくなる", () => {
    const n = db.starNodes.get("STAR-KEY-BALANCE");
    expect(n?.region).toBe("core");
    expect(db.effects.get("EFF-KEY-BALANCE")?.modifiers).toEqual([
      { kind: "flag", flag: "crit", mode: "forbid", drawback: true },
      { kind: "increased", stat: "STAT-AILMENT-CHANCE", value: 0.5 },
    ]);
  });
});

describe("ポイントの上限（docs/progress D-RING-7）", () => {
  it("上限は40。キャラLv・クエスト・探索の合計が40を超えても40", () => {
    expect(STAR_POINT_CAP).toBe(40);
    expect(starPoints(20, 4, 2)).toBe(25);
    expect(starPoints(41)).toBe(40);
    expect(starPoints(25, 20, 10)).toBe(40);
    expect(starPoints(100, 20, 10)).toBe(40);
  });

  it("40ポイントなら40個まで取れ、41個目はポイントが足りない", () => {
    const root = startNodeOf(db, "JOB-WARRIOR");
    const alloc = new StarAllocation(db);
    const points = starPoints(100);
    // 始点からの近い順（幅優先）に取る
    const order: string[] = [];
    const seen = new Set<string>();
    const frontier = [root as string];
    while (frontier.length > 0) {
      const cur = frontier.shift() as string;
      for (const next of db.starLinks.get(cur) ?? []) {
        if (seen.has(next) || isStart(next)) continue;
        seen.add(next);
        order.push(next);
        frontier.push(next);
      }
    }
    for (const id of order.slice(0, 40)) expect(alloc.allocate(id, root, points), id).toBe(true);
    expect(alloc.spent).toBe(40);
    expect(alloc.allocateBlock(order[40] as string, root, points)).toBe("points");
  });
});

describe("セーブの互換（docs/progress D-RING-2）", () => {
  const before = JSON.parse(
    readFileSync(
      fileURLToPath(new URL("./fixtures/star-board-before-ring8.json", import.meta.url)),
      "utf-8",
    ),
  ) as {
    ids: string[];
    links: [string, string][];
    nodes: Record<string, { kind: string; region: string; effects: string[] }>;
    effects: Record<string, unknown>;
  };

  it("前からあったノード（star.json と star-mvp.json の旧ID）は、1つも減っていない", () => {
    expect(before.ids.length).toBe(146);
    for (const id of before.ids) expect(db.starNodes.has(id), id).toBe(true);
  });

  it("前からあったつながりで外したのは、魔法使い・召喚士の始点から STAR-JIN-0202 への2本だけ", () => {
    const removed = before.links
      .filter(([a, b]) => db.starLinks.get(a)?.has(b) !== true)
      .map(([a, b]) => `${a}-${b}`)
      .sort();
    expect(removed).toEqual(["STAR-JIN-0202-STAR-RI-START", "STAR-JIN-0202-STAR-RIKON-START"]);
  });

  it("前からあったノードの種類・星域・効果の ID は、変わっていない", () => {
    for (const [id, old] of Object.entries(before.nodes)) {
      const now = db.starNodes.get(id);
      expect(now?.kind, id).toBe(old.kind);
      expect(now?.region, id).toBe(old.region);
    }
  });

  it("前からあった星辰盤の効果（星の値）は、1つも変わっていない", () => {
    const read = (file: string): { id: string }[] =>
      JSON.parse(
        readFileSync(fileURLToPath(new URL(`../data/effects/${file}`, import.meta.url)), "utf-8"),
      ) as { id: string }[];
    const now = new Map([...read("star.json"), ...read("star-mvp.json")].map((e) => [e.id, e]));
    for (const [id, old] of Object.entries(before.effects)) expect(now.get(id), id).toEqual(old);
  });
});
