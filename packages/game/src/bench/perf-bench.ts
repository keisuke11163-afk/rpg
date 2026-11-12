/**
 * 性能の計測（開発計画書 T16：投射物・敵・状態異常が最も多い場面で、目標のフレームレートを保てるか）。
 *
 * 描画を除いた、ゲームの計算（ArenaSimulation.frame の1刻み＝1/60秒分）の時間を測る。
 * 場面：深淵の母樹の間（ボス・触手・胞子の雲）に、通常の敵の群れ（投射物を吐く棘蜥蜴を含む）を足し、
 * 倒されても数を保つように出し直す。プレイヤーは出血と毒を重ねるビルドで、一番近い敵を叩き続ける（毎刻み全回復）。
 *
 * 目標のフレームレートは仕様書9章に無い（開発計画書 T16）。ここでは数値を出すだけで、合否は決めない。
 * 参考として、60fps の1フレーム（16.7ms）のうち計算に使ってよい割合を、呼び出す側が渡して判定に使える。
 */
import { type ContentDb, type Enemy, FIXED_STEP_SECONDS, Rng } from "@stella/core";
import type { Action } from "../input/actions.ts";
import type { InputFrame } from "../input/frame.ts";
import type { ArenaSimulation } from "../scenes/arena-simulation.ts";
import { toPixels } from "../world/units.ts";
import { type BenchBuild, chooseSkill, prepareBench } from "./boss-bench.ts";

export interface PerfOptions {
  /** 測る秒数（ゲームの中の時間）。 */
  readonly seconds?: number;
  /** ボス以外に保つ敵の数。 */
  readonly extraEnemies?: number;
  /** 測る前に回す秒数（JIT の暖機）。 */
  readonly warmupSeconds?: number;
  readonly seed?: string;
  /** 時計（省略すると performance.now）。テストで差し替える。 */
  readonly now?: () => number;
}

export interface PerfResult {
  readonly steps: number;
  /** 1刻みの計算時間（ミリ秒）。 */
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
  /** 場面の重さ（測った間の最大）。 */
  readonly peakEnemies: number;
  readonly peakProjectiles: number;
  /** 状態異常を受けている敵の、種類の数の合計。 */
  readonly peakAilmentTypes: number;
  readonly peakClouds: number;
}

/** 足す敵（補助仕様書10.4 の第1章の敵。棘蜥蜴は投射物を吐く）。 */
const EXTRA_ENEMIES = [
  "ENM-SPINE-LIZARD",
  "ENM-THORN-RAT",
  "ENM-FOREST-WOLF",
  "ENM-ROT-SAPLING",
  "ENM-SPINE-LIZARD",
  "ENM-TUSK-BOAR",
] as const;

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i] ?? 0;
}

function aliveEnemies(sim: ArenaSimulation): Enemy[] {
  return (sim.field?.enemies ?? []).filter((e) => e.state !== "dead");
}

/** 足した敵の数を保つ（倒された分を、プレイヤーの周り8〜14mに出し直す）。 */
function topUp(sim: ArenaSimulation, rng: Rng, target: number, serial: { n: number }): void {
  const field = sim.field;
  if (field === undefined) return;
  const extras = aliveEnemies(sim).filter((e) => e.def.boss === undefined).length;
  const me = sim.motion.position;
  for (let i = extras; i < target; i++) {
    const angle = rng.float(0, Math.PI * 2);
    const r = rng.float(8, 14);
    const at = {
      x: Math.min(Math.max(me.x + Math.cos(angle) * r, 2), sim.size.width - 2),
      y: Math.min(Math.max(me.y + Math.sin(angle) * r, 2), sim.size.height - 2),
    };
    serial.n += 1;
    const enemy = field.spawn(
      EXTRA_ENEMIES[serial.n % EXTRA_ENEMIES.length] ?? "ENM-THORN-RAT",
      serial.n % 7 === 0 ? "magic" : "normal",
      20,
      at,
      `perf-${String(serial.n)}`,
    );
    field.alertPack(enemy);
  }
}

/** 一番近い、狙える敵へ寄って、技を使う入力。 */
function botInput(sim: ArenaSimulation, db: ContentDb): InputFrame {
  const me = sim.motion.position;
  let foe: Enemy | undefined;
  let best = Infinity;
  for (const e of aliveEnemies(sim)) {
    const d = Math.hypot(e.position.x - me.x, e.position.y - me.y);
    if (d < best) {
      best = d;
      foe = e;
    }
  }
  const dest = foe?.position ?? me;
  const gap = best - (foe?.combatant.radius ?? 0) - sim.player.radius;
  const special = chooseSkill(sim, db);
  return {
    held: new Set<Action>(gap <= 0.8 ? [special?.action ?? "skill1"] : []),
    pressed: new Set<Action>(),
    move: gap > 0.6 ? { x: dest.x - me.x, y: dest.y - me.y } : { x: 0, y: 0 },
    pointerWorld: { x: toPixels(dest.x), y: toPixels(dest.y) },
  };
}

export function runPerfBench(
  db: ContentDb,
  build: BenchBuild,
  options: PerfOptions = {},
): PerfResult {
  const now = options.now ?? (() => performance.now());
  const seconds = options.seconds ?? 60;
  const warmup = options.warmupSeconds ?? 5;
  const target = options.extraEnemies ?? 30;
  const sim = prepareBench(db, build, {
    region: "REGION-A5-BOSS",
    invincible: true,
    seed: options.seed ?? "perf",
  });
  const rng = Rng.fromSeed(`perf-spawn:${options.seed ?? "perf"}`);
  const serial = { n: 0 };
  const times: number[] = [];
  let peakEnemies = 0;
  let peakProjectiles = 0;
  let peakAilmentTypes = 0;
  let peakClouds = 0;
  const total = Math.round((seconds + warmup) / FIXED_STEP_SECONDS);
  const warmSteps = Math.round(warmup / FIXED_STEP_SECONDS);
  for (let step = 0; step < total; step++) {
    if (step % 30 === 0) topUp(sim, rng, target, serial);
    const input = botInput(sim, db);
    const start = now();
    sim.frame(FIXED_STEP_SECONDS, input);
    const elapsed = now() - start;
    sim.player.health.restoreFull();
    if (step < warmSteps) continue;
    times.push(elapsed);
    const alive = aliveEnemies(sim);
    peakEnemies = Math.max(peakEnemies, alive.length);
    peakProjectiles = Math.max(peakProjectiles, sim.field?.projectiles.active ?? 0);
    peakAilmentTypes = Math.max(
      peakAilmentTypes,
      alive.reduce((n, e) => n + e.combatant.ailments.typeCount(), 0),
    );
    peakClouds = Math.max(peakClouds, sim.field?.clouds.length ?? 0);
  }
  const sorted = [...times].sort((a, b) => a - b);
  const sum = times.reduce((a, b) => a + b, 0);
  return {
    steps: times.length,
    meanMs: times.length === 0 ? 0 : sum / times.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    maxMs: sorted.at(-1) ?? 0,
    peakEnemies,
    peakProjectiles,
    peakAilmentTypes,
    peakClouds,
  };
}
