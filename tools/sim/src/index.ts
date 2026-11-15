/**
 * DPSシミュレーターの実行（pnpm sim）。標準の的に、定義したビルドで戦って、DPSを出す。
 */
import { STANDARD_DUMMY, WEAPONS, simulate, type BuildDef } from "./sim.ts";

export * from "./sim.ts";

const builds: BuildDef[] = [
  {
    name: "Lv1 長剣の通常攻撃",
    charLevel: 1,
    weapon:
      WEAPONS["longsword"] ??
      (() => {
        throw new Error("long");
      })(),
    skills: [{ name: "通常攻撃", multiplier: 1, cooldown: 0 }],
    stats: { 剛: 20, 迅: 10 },
  },
];

if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  for (const build of builds) {
    const r = simulate(build, STANDARD_DUMMY, { seed: "sim", maxSeconds: 60 });
    console.log(
      `${build.name}: DPS ${r.dps.toFixed(2)}（${String(r.hits)}ヒット、会心${String(r.crits)}）`,
    );
  }
}
