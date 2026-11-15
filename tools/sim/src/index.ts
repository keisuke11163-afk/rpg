/**
 * DPSシミュレーターの実行（pnpm sim）。標準のビルドで、ボスの撃破時間を測って表にする。
 * 測るのは、敵の攻撃を避け続ける理想的なプレイヤーの撃破時間（目標：標準のビルドで60〜120秒）。
 */
import { buildFighter, fightBoss, type BuildSpec } from "./builds.ts";
import {
  DIFFERENT_BUILDS,
  ROGUE_LV15,
  ROGUE_LV20,
  WARRIOR_LV15,
  WARRIOR_LV20,
} from "./standard.ts";

export * from "./sim.ts";
export * from "./builds.ts";
export * from "./standard.ts";

const average = (spec: BuildSpec, boss: string, level: number, seeds = 5): number => {
  let sum = 0;
  for (let i = 0; i < seeds; i++) {
    sum += fightBoss(buildFighter(spec).fighter, spec, boss, level, `cli${String(i)}`).seconds;
  }
  return sum / seeds;
};

if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  console.log("ボスの撃破時間（秒）。目標：標準のビルドで60〜120");
  const rows: [BuildSpec, string, number, string][] = [
    [WARRIOR_LV15, "BOSS-CH1", 14, "腐根の母樹"],
    [ROGUE_LV15, "BOSS-CH1", 14, "腐根の母樹"],
    [WARRIOR_LV20, "BOSS-ABYSS", 21, "深淵の母樹"],
    [ROGUE_LV20, "BOSS-ABYSS", 21, "深淵の母樹"],
    ...DIFFERENT_BUILDS.slice(2).map((b): [BuildSpec, string, number, string] => [
      b,
      "BOSS-ABYSS",
      21,
      "深淵の母樹",
    ]),
  ];
  for (const [spec, boss, level, label] of rows) {
    console.log(`  ${spec.name.padEnd(28)} ${label}: ${average(spec, boss, level).toFixed(1)}秒`);
  }
}
