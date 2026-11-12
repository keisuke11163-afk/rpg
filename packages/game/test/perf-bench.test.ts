import { describe, expect, it } from "vitest";
import { loadGameContent } from "@stella/content";
import { BENCH_BUILDS } from "../src/bench/builds.ts";
import { runPerfBench } from "../src/bench/perf-bench.ts";

describe("性能の計測（T16。pnpm perf）", () => {
  it("重い場面を作り、刻みごとの時間を集計する（時間は差し替えた時計で数える）", () => {
    const db = loadGameContent();
    const build = BENCH_BUILDS.find((b) => b.id === "rogue-bleed-myriad");
    if (build === undefined) throw new Error("ビルドが無い");
    let clock = 0;
    // 呼ぶたびに 1ms 進む時計：1刻みの計測は開始・終了の2回なので、どの刻みも 1ms
    const r = runPerfBench(db, build, {
      seconds: 3,
      warmupSeconds: 1,
      extraEnemies: 12,
      now: () => (clock += 1),
    });
    expect(r.steps).toBe(180);
    expect([r.meanMs, r.p50Ms, r.p95Ms, r.p99Ms, r.maxMs]).toEqual([1, 1, 1, 1, 1]);
    // ボス＋足した敵（倒されても出し直す）
    expect(r.peakEnemies).toBeGreaterThanOrEqual(12);
    // 盗賊のビルドは、出血・毒を重ねる
    expect(r.peakAilmentTypes).toBeGreaterThan(0);
  });
});
