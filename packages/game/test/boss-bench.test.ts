/**
 * ボスの撃破時間の計測（U-21 の土台）が、実際のビルドを組み立てて回せること。
 * 数値の目標（60〜120秒）は U-21 の調整で確かめる（ここでは土台が壊れていないことだけ）。
 */
import { describe, expect, it } from "vitest";
import { loadGameContent } from "@stella/content";
import { prepareBench, runBossBench } from "../src/bench/boss-bench.ts";
import { BENCH_BUILDS } from "../src/bench/builds.ts";

const db = loadGameContent();

describe("ボスの撃破時間の計測", () => {
  it("3つのビルドを、MVPのポイント（星辰盤25・職紋盤19）以内で組み立てられる", () => {
    for (const build of BENCH_BUILDS) {
      const sim = prepareBench(db, build);
      expect(sim.character.level).toBe(20);
      expect(sim.stars.spent).toBeLessThanOrEqual(25);
      expect(sim.jobBoard.spent).toBeLessThanOrEqual(19);
      for (const e of build.equipment) expect(sim.equipment.get(e.slot)?.base, e.base).toBe(e.base);
      expect(sim.field?.enemies.some((e) => e.def.id === "ENM-ABYSS-MOTHER-TREE")).toBe(true);
    }
  });

  it("大斧のビルドは、腐根の母樹を（攻撃面だけで）120秒以内に倒せる", () => {
    const build = BENCH_BUILDS.find((b) => b.id === "warrior-heavy-greataxe");
    if (build === undefined) throw new Error("ビルドが無い");
    const r = runBossBench(db, build, { region: "REGION-A4-BOSS", seconds: 120 });
    expect(r.boss).toBe("ENM-MOTHER-TREE");
    expect(r.killTime).toBeDefined();
    expect(r.dps).toBeGreaterThan(0);
  });
});
