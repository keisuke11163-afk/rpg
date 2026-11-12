/**
 * ボスの撃破時間の計測（pnpm bench）：実際のビルドで、深淵の母樹・腐根の母樹を倒す時間を測る。
 * 攻撃面だけ（毎フレーム全回復。受けたダメージは記録だけ）と、倒れるまで戦う場合の両方を出す。
 */
import { loadGameContent } from "@stella/content";
import { runBossBench, withoutPart } from "../src/bench/boss-bench.ts";
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
    const breakdown = (r: typeof atk): string =>
      Object.entries(r.takenBySource)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k.replace(/ENM-/g, "")} ${v.toFixed(1)}`)
        .join("・");
    const taken = breakdown(atk);
    console.log(
      `  ${build.name}\n    攻撃面：撃破 ${fmt(atk.killTime)}秒・DPS ${fmt(atk.dps)}・被ダメージ毎秒 ${fmt(atk.damageTakenPerSecond)}（最大HP ${fmt(atk.maxHp)}）・臨界 ${String(atk.criticals)}・星 ${String(atk.starsSpent)}・職紋 ${String(atk.jobNodesSpent)}\n    技：${uses}\n    受けた（毎秒）：${taken}・被弾 ${String(atk.hitsTaken)}\n    通しで：撃破 ${fmt(real.killTime)}秒${real.deathTime === undefined ? "" : `・${fmt(real.deathTime)}秒で倒れた（ボスの残りHP ${(real.bossHpLeft * 100).toFixed(0)}%）`}・被弾 ${String(real.hitsTaken)}・回避 ${String(real.attacksAvoided)}\n      受けた（毎秒）：${breakdown(real)}`,
    );
  }
}

// 寄与の表（pnpm bench -- --contrib）：深淵の母樹で、職紋盤・星辰盤・詞を外したときの攻撃面のDPS（120秒まで）
// と、仕様書v0.2 1.4 の測り方（装備・ツリー・ジョブを1つずつ外したときの低下の割合。開発計画書 T15）
if (process.argv.includes("--contrib")) {
  const run = (b: (typeof BENCH_BUILDS)[number], extra = {}): number =>
    runBossBench(db, b, { region: "REGION-A5-BOSS", invincible: true, seconds: 120, ...extra }).dps;
  console.log("\n■ 寄与（REGION-A5-BOSS・攻撃面のDPS）：全部／職紋盤なし／星辰盤なし／詞なし");
  for (const b of BENCH_BUILDS) {
    const variants = [
      b,
      { ...b, jobNodes: [] },
      { ...b, stars: [] },
      { ...b, equipment: b.equipment.map((e) => ({ ...e, affixes: [] })) },
    ];
    console.log(`  ${b.name}：${variants.map((v) => run(v).toFixed(1)).join("／")}`);
  }
  console.log(
    "\n■ 力の配分（仕様書v0.2 1.4・T15）：外したときのDPSの低下の割合 → 低下の合計に対する割合（目安 装備40／ツリー35／ジョブ25）",
  );
  for (const b of BENCH_BUILDS) {
    const full = run(b);
    const drops = (["equipment", "tree", "job"] as const).map((part) => {
      const v = withoutPart(db, b, part);
      return Math.max(0, 1 - run(v.build, v.options) / full);
    });
    const [eq = 0, tree = 0, job = 0] = drops;
    const sum = eq + tree + job;
    const share = drops.map((d) => (sum > 0 ? Math.round((d / sum) * 100) : 0));
    console.log(
      `  ${b.name}：全部 ${full.toFixed(1)}／低下 装備 ${(eq * 100).toFixed(0)}%・ツリー ${(tree * 100).toFixed(0)}%・ジョブ ${(job * 100).toFixed(0)}% → 配分 ${share.join("／")}`,
    );
  }
}
