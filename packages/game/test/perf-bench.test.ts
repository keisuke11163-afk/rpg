import { describe, expect, it } from "vitest";
import { loadGameContent } from "@stella/content";
import { BENCH_BUILDS } from "../src/bench/builds.ts";
import {
  PERF_TARGETS,
  browserVerdict,
  logicVerdict,
  runPerfBench,
} from "../src/bench/perf-bench.ts";

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

describe("性能の目標（D-FIN-6：暫定で60fps）", () => {
  it("目標はデータ（perf-targets.json）にあり、60fps", () => {
    expect(PERF_TARGETS.targetFps).toBe(60);
  });
  it("計算：99%の刻みが 1フレーム（16.7ms）の25%＝約4.17ms 以内なら合格", () => {
    expect(logicVerdict(4.1).ok).toBe(true);
    expect(logicVerdict(4.2).ok).toBe(false);
    expect(logicVerdict(1).budgetMs).toBeCloseTo(1000 / 60 / 4, 9);
  });
  it("描画：平均が57fps以上で、30fps 未満のフレームが1%以下なら合格", () => {
    const smooth = Array.from({ length: 200 }, () => 1000 / 60);
    expect(browserVerdict(smooth).ok).toBe(true);
    expect(browserVerdict([...smooth.slice(0, 197), 50, 50, 50]).ok).toBe(false); // 1.5% が遅い
    expect(browserVerdict(Array.from({ length: 100 }, () => 1000 / 50)).ok).toBe(false); // 50fps
  });
});
