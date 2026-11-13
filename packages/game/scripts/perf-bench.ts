/**
 * 性能の計測（pnpm perf。開発計画書 T16）：投射物・敵・状態異常が多い場面で、ゲームの計算の1刻みにかかる時間を測る。
 * 描画の時間は含まない。目標（src/bench/perf-targets.json。暫定で60fps。D-FIN-6）に対する合否も出し、不合格なら終了コード1。
 *
 *   pnpm perf                     … 敵30体を足して60秒
 *   pnpm perf -- --enemies 60     … 足す敵の数
 *   pnpm perf -- --seconds 120    … 測る秒数
 */
import { loadGameContent } from "@stella/content";
import { BENCH_BUILDS } from "../src/bench/builds.ts";
import { PERF_TARGETS, logicVerdict, runPerfBench } from "../src/bench/perf-bench.ts";

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : fallback;
  if (!Number.isFinite(v) || v < 0) throw new RangeError(`--${name} は0以上の数にする`);
  return v;
}

const db = loadGameContent();
const build = BENCH_BUILDS.find((b) => b.id === "rogue-bleed-myriad");
if (build === undefined) throw new Error("ビルド rogue-bleed-myriad が無い");
const extraEnemies = arg("enemies", 30);
const seconds = arg("seconds", 60);
const r = runPerfBench(db, build, { extraEnemies, seconds });
const FRAME_MS = 1000 / PERF_TARGETS.targetFps;
const f = (n: number): string => n.toFixed(3);
console.log(
  `■ 性能（深淵の母樹の間＋敵${String(extraEnemies)}体・${String(seconds)}秒・${build.name}）`,
);
console.log(
  `  1刻みの計算：平均 ${f(r.meanMs)}ms・中央 ${f(r.p50Ms)}ms・95% ${f(r.p95Ms)}ms・99% ${f(r.p99Ms)}ms・最大 ${f(r.maxMs)}ms（${String(r.steps)}刻み）`,
);
console.log(
  `  60fps の1フレーム（${FRAME_MS.toFixed(1)}ms）に対する割合：平均 ${((r.meanMs / FRAME_MS) * 100).toFixed(1)}%・99% ${((r.p99Ms / FRAME_MS) * 100).toFixed(1)}%`,
);
console.log(
  `  場面の重さ（最大）：敵 ${String(r.peakEnemies)}体・敵の投射物 ${String(r.peakProjectiles)}個・状態異常の種類の合計 ${String(r.peakAilmentTypes)}・胞子の雲 ${String(r.peakClouds)}個`,
);
const verdict = logicVerdict(r.p99Ms);
console.log(
  `  合否（目標 ${String(PERF_TARGETS.targetFps)}fps・計算は1フレームの${String(PERF_TARGETS.logicShareOfFrame * 100)}%＝${verdict.budgetMs.toFixed(2)}ms 以内〔99%の刻み〕）：${verdict.ok ? "合格" : "不合格"}`,
);
if (!verdict.ok) process.exitCode = 1;
