/**
 * DPSシミュレーターのコマンド（pnpm sim）。
 *
 * 例：
 *   pnpm sim                                   … builds/ の全てのビルドを、ビルドのLvの人形で60秒
 *   pnpm sim -- --target boss-14@15            … 第1章のボス（Lv14、HPはLv15の値）
 *   pnpm sim -- --build lv1-warrior-longsword --seconds 120 --seed 7
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGameContent } from "@stella/content";
import { buildSchema } from "./build.ts";
import { argValue, parseSeconds } from "./options.ts";
import { simulate } from "./simulate.ts";
import { standardDps } from "./standards.ts";
import { dummy, targetByName } from "./targets.ts";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function arg(name: string): string | undefined {
  try {
    return argValue(process.argv, name);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

const buildsDir = fileURLToPath(new URL("../builds", import.meta.url));
const only = arg("build");
let seconds: number;
try {
  seconds = parseSeconds(arg("seconds"));
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
const seed = arg("seed") ?? "sim";
const targetName = arg("target");

const db = loadGameContent();
const files = readdirSync(buildsDir).filter(
  (f) => f.endsWith(".json") && (only === undefined || f === `${only}.json`),
);
if (files.length === 0) {
  console.error(`ビルドが見つからない：${only ?? "(builds/ が空)"}`);
  process.exit(1);
}

console.log(`DPSシミュレーター（${String(seconds)}秒・シード ${seed}）`);
for (const file of files.sort()) {
  const build = buildSchema.parse(JSON.parse(readFileSync(join(buildsDir, file), "utf-8")));
  const target = targetName === undefined ? dummy(build.characterLevel) : targetByName(targetName);
  const r = simulate(db, build, target, { seconds, seed });
  const std = standardDps(build.characterLevel);
  console.log(`\n■ ${build.name}（${build.id}）→ ${r.targetName}`);
  console.log(
    `  DPS ${r.dps.toFixed(1)}（打撃 ${(r.hitDamage / r.seconds).toFixed(1)}・持続 ${(r.dotDamage / r.seconds).toFixed(1)}）／標準DPS ${std.toFixed(1)} の ${(r.dps / std).toFixed(2)}倍`,
  );
  if (r.killTime !== undefined) console.log(`  撃破 ${r.killTime.toFixed(1)}秒`);
  else if (target.maxHp !== undefined)
    console.log(
      `  ${String(seconds)}秒で倒せなかった（与えたダメージ ${r.totalDamage.toFixed(0)}／${target.maxHp.toFixed(0)}）`,
    );
  for (const s of r.skills) {
    console.log(
      `  - ${s.name}：${String(s.uses)}回・ヒット${String(s.hits)}・会心${String(s.crits)}・ダメージ${s.damage.toFixed(0)}`,
    );
  }
  const ail = Object.entries(r.ailmentsApplied)
    .map(([t, n]) => `${t} ${String(n)}`)
    .join("、");
  if (ail !== "") console.log(`  状態異常：${ail}`);
  if (r.staggerBreaks > 0) console.log(`  崩し：${String(r.staggerBreaks)}回`);
  console.log(`  MP：${r.mpSpent.toFixed(0)}使用`);
  if (r.damageTaken > 0)
    console.log(
      `  受けたダメージ：${r.damageTaken.toFixed(0)}（毎秒 ${r.damageTakenPerSecond.toFixed(1)}）`,
    );
}
