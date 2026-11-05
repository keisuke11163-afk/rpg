/**
 * U-18a 地域（補助仕様書8・9章）：データの検証と、入るたびの配置の抽選（9.3）。
 */
import {
  type ContentDb,
  ELITE_CHANCE,
  MAGIC_PACK_CHANCE,
  OLD_CHEST_CHANCE,
  PACK_ACTIVE_CHANCE,
  type RawContent,
  Rng,
  TagIndex,
  WOOD_CHESTS,
  formatContentError,
  inRect,
  loadContent,
  rollDrops,
  rollRegionLayout,
} from "@stella/core";
import { describe, expect, it } from "vitest";
import { loadGameContent, rawContent } from "../src/index.ts";

const db: ContentDb = loadGameContent();

function region(id: string) {
  const r = db.regions.get(id);
  if (r === undefined) throw new Error(`${id} がない`);
  return r;
}

describe("地域のデータ", () => {
  it("町（施設・転移の石・A1への出口）と A1（3区画・敵は森狼と棘鼠）がある", () => {
    const town = region("REGION-TOWN");
    expect(town.kind).toBe("town");
    const kinds = new Set(town.facilities?.map((f) => f.kind));
    for (const k of ["temple", "starReader", "smith", "merchant", "stash", "teleport", "dummy"])
      expect(kinds.has(k as never)).toBe(true);
    const a1 = region("REGION-A1");
    expect(a1.sections).toHaveLength(3);
    expect(a1.sections?.flatMap((s) => s.enemies).every((e) => db.enemies.has(e))).toBe(true);
    expect(a1.exits?.some((x) => x.to === "REGION-TOWN")).toBe(true);
    expect(town.exits?.some((x) => x.to === "REGION-A1")).toBe(true);
  });

  it("壊れた地域のデータを検出する（広さの外・区画の外・町の区画・無い敵・無い出口）", () => {
    const bad = (patch: Record<string, unknown>): string => {
      const a1 = { ...region("REGION-A1"), ...patch };
      const raw: RawContent = {
        ...rawContent,
        collections: {
          ...rawContent.collections,
          regions: [
            {
              file: "test-regions.json",
              entries: [...db.regions.values()].map((r) => (r.id === "REGION-A1" ? a1 : r)),
            },
          ],
        },
      };
      const r = loadContent(raw);
      return r.ok ? "ok" : r.errors.map(formatContentError).join("\n");
    };
    expect(bad({})).toBe("ok");
    expect(bad({ packSpawns: [{ x: 999, y: 1 }] })).toContain("広さの外");
    expect(
      bad({
        sections: [
          {
            id: "S",
            rect: { x: 0, y: 0, width: 10, height: 10 },
            levels: { min: 1, max: 1 },
            enemies: ["ENM-THORN-RAT"],
          },
        ],
        packSpawns: [{ x: 50, y: 20 }],
      }),
    ).toContain("どの区画にも");
    expect(bad({ kind: "town" })).toContain("町には");
    expect(
      bad({
        sections: [
          {
            id: "S",
            rect: { x: 0, y: 0, width: 240, height: 48 },
            levels: { min: 1, max: 1 },
            enemies: ["ENM-NONE"],
          },
        ],
      }),
    ).toContain("unknown-ref");
    expect(
      bad({ exits: [{ to: "REGION-NONE", rect: { x: 0, y: 0, width: 1, height: 1 } }] }),
    ).toContain("REGION-NONE");
  });
});

describe("第1章の地域とクエスト（補助仕様書9.2・9.5・9.6）", () => {
  it("A1〜A4 の敵のLvは表のとおり（A1 1〜3・A2 4〜7・A3 8〜11・A4 12〜14）", () => {
    const range = (id: string): [number, number] => {
      const secs = region(id).sections ?? [];
      return [
        Math.min(...secs.map((s) => s.levels.min)),
        Math.max(...secs.map((s) => s.levels.max)),
      ];
    };
    expect(range("REGION-A1")).toEqual([1, 3]);
    expect(range("REGION-A2")).toEqual([4, 7]);
    expect(range("REGION-A3")).toEqual([8, 11]);
    expect(range("REGION-A4")).toEqual([12, 14]);
  });

  it("A3 に中ボス（Lv11）と隠し星。クエスト「森の異変」は A2 到達・中ボス・A4 到達で星図の欠片1つずつ", () => {
    expect(region("REGION-A3").fixedEnemies).toEqual([
      expect.objectContaining({ enemy: "ENM-PACK-LEADER", level: 11 }),
    ]);
    expect(region("REGION-A3").secrets?.[0]?.explorationPoints).toBe(1);
    const q = db.quests.get("QUEST-FOREST");
    expect(q?.stages.map((s) => s.trigger)).toEqual([
      { type: "enterRegion", region: "REGION-A2" },
      { type: "defeat", enemy: "ENM-PACK-LEADER" },
      { type: "enterRegion", region: "REGION-A4" },
    ]);
    expect(q?.stages.every((s) => s.questPoints === 1)).toBe(true);
  });
});

describe("入るたびの配置の抽選（補助仕様書9.3）", () => {
  const a1 = region("REGION-A1");

  it("同じシードなら同じ配置。シードが違えば、配置が変わる", () => {
    const a = rollRegionLayout(db, a1, Rng.fromSeed("enter-1"));
    const b = rollRegionLayout(db, a1, Rng.fromSeed("enter-1"));
    const c = rollRegionLayout(db, a1, Rng.fromSeed("enter-2"));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("群れ・魔法・精鋭・宝箱の割合が規則どおり（2000回）。群れの中身は区画の敵とLv", () => {
    const rng = Rng.fromSeed("layout-stats");
    const n = 2000;
    let packs = 0;
    let magic = 0;
    let elites = 0;
    let old = 0;
    const spawns = a1.packSpawns?.length ?? 0;
    const eliteSpawns = a1.eliteSpawns?.length ?? 0;
    for (let i = 0; i < n; i++) {
      const l = rollRegionLayout(db, a1, rng);
      const normal = l.packs.filter((p) => !p.ranks.includes("elite"));
      packs += normal.length;
      magic += normal.filter((p) => p.ranks.includes("magic")).length;
      elites += l.packs.filter((p) => p.ranks.includes("elite")).length;
      const wood = l.chests.filter((c) => c.kind === "woodChest");
      expect(wood).toHaveLength(WOOD_CHESTS);
      expect(new Set(wood.map((c) => `${String(c.at.x)},${String(c.at.y)}`)).size).toBe(
        WOOD_CHESTS,
      );
      old += l.chests.filter((c) => c.kind === "oldChest").length;
      for (const p of l.packs) {
        const s = a1.sections?.find((x) => inRect(p.at, x.rect));
        expect(s?.enemies).toContain(p.enemy);
        expect(p.level).toBeGreaterThanOrEqual(s?.levels.min ?? 0);
        expect(p.level).toBeLessThanOrEqual(s?.levels.max ?? 0);
        const def = db.enemies.get(p.enemy);
        if (!p.ranks.includes("elite")) {
          expect(p.count).toBeGreaterThanOrEqual(def?.pack.min ?? 0);
          expect(p.count).toBeLessThanOrEqual(def?.pack.max ?? 0);
        }
      }
    }
    const within = (got: number, trials: number, p: number): void => {
      const sd = Math.sqrt(trials * p * (1 - p));
      expect(Math.abs(got - trials * p)).toBeLessThan(5 * sd);
    };
    within(packs, n * spawns, PACK_ACTIVE_CHANCE);
    within(magic, packs, MAGIC_PACK_CHANCE);
    within(elites, n * eliteSpawns, ELITE_CHANCE);
    within(old, n, OLD_CHEST_CHANCE);
  });

  it("宝箱のドロップ：木箱・古びた宝箱の金貨と素材（補助仕様書5章・12.2）", () => {
    const tags = new TagIndex(db.tags);
    const job = db.jobs.get("JOB-WARRIOR");
    if (job === undefined) throw new Error("戦士が無い");
    let n = 0;
    const r = rollDrops(db, Rng.fromSeed("old"), {
      source: "oldChest",
      enemyLevel: 3,
      mainJob: job,
      tags,
      nextUid: () => `c${String(++n)}`,
    });
    // 古びた宝箱：金貨は必ず（1＋Lv）×（1〜2）×8
    expect(r.gold).toBeGreaterThanOrEqual(4 * 8);
    expect(r.gold).toBeLessThanOrEqual(8 * 8);
    expect(r.items.length).toBeGreaterThanOrEqual(1);
  });
});
