/**
 * ボスの撃破時間の計測（pnpm bench）：実際のビルドで、深淵の母樹・腐根の母樹を倒す時間を測る。
 * 攻撃面だけ（毎フレーム全回復。受けたダメージは記録だけ）と、倒れるまで戦う場合の両方を出す。
 */
import { loadGameContent } from "@stella/content";
import { runBossBench } from "../src/bench/boss-bench.ts";
import { BENCH_BUILDS } from "../src/bench/builds.ts";

const db = loadGameContent();
const fmt = (n: number | undefined): string => (n === undefined ? "—" : n.toFixed(1));
for (const region of ["REGION-A4-BOSS", "REGION-A5-BOSS"]) {
  console.log(`\n■ ${region}`);
  for (const build of BENCH_BUILDS) {
    const atk = runBossBench(db, build, { region, invincible: true });
    const real = runBossBench(db, build, { region, invincible: false });
    const uses = Object.entries(atk.uses)
      .map(([k, n]) => `${k.replace(/^SKL-(WARRIOR|ROGUE|BASIC)-/, "")} ${String(n)}`)
      .join("・");
    console.log(
      `  ${build.name}\n    攻撃面：撃破 ${fmt(atk.killTime)}秒・DPS ${fmt(atk.dps)}・被ダメージ毎秒 ${fmt(atk.damageTakenPerSecond)}（最大HP ${fmt(atk.maxHp)}）・臨界 ${String(atk.criticals)}・星 ${String(atk.starsSpent)}・職紋 ${String(atk.jobNodesSpent)}\n    技：${uses}\n    通しで：撃破 ${fmt(real.killTime)}秒・倒れた ${String(real.deaths)}`,
    );
  }
}
