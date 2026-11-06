/**
 * データの検証（pnpm validate:data）。
 * - スキーマ・ID参照・値の範囲・乗算の出どころ・上書きの優先度などを、core の loadContent で検証する
 * - data/ にあるのに raw.ts に登録されていない JSON のファイル（登録し忘れ）を誤りにする
 * - 仮値の一覧を出す
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { formatContentError, loadContent } from "../../packages/core/src/index.ts";
import { rawContent, registeredDataFiles } from "../../packages/content/src/index.ts";

const contentRoot = fileURLToPath(new URL("../../packages/content", import.meta.url));

function jsonFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return jsonFiles(path);
    return name.endsWith(".json") ? [path] : [];
  });
}

const problems: string[] = [];

const registered = new Set(registeredDataFiles());
for (const file of jsonFiles(join(contentRoot, "data"))) {
  const rel = relative(contentRoot, file).split("\\").join("/");
  if (!registered.has(rel))
    problems.push(`[unregistered] ${rel}: packages/content/src/raw.ts に登録されていない`);
}

const result = loadContent(rawContent);
if (!result.ok) problems.push(...result.errors.map(formatContentError));

if (problems.length > 0) {
  console.error(`データの検証：失敗（${String(problems.length)}件）\n${problems.join("\n")}`);
  process.exit(1);
}

const c = result.ok ? result.content : undefined;
console.log(
  `データの検証：問題なし（タグ${String(c?.tags.size ?? 0)}・能力値${String(c?.stats.size ?? 0)}・効果${String(c?.effects.size ?? 0)}・状態異常${String(c?.ailments.size ?? 0)}・技${String(c?.skills.size ?? 0)}・職能ゲージ${String(c?.gauges.size ?? 0)}・ジョブ${String(c?.jobs.size ?? 0)}・敵${String(c?.enemies.size ?? 0)}・格${String(c?.enemyRanks.size ?? 0)}、データの形の版 ${String(c?.manifest.schemaVersion)}、コンテンツの版 ${c?.manifest.contentVersion ?? "?"}）`,
);
if (result.ok) {
  console.log(`仮値：${String(result.provisional.length)}件`);
  for (const p of result.provisional) {
    console.log(
      `  ${p.collection} ${p.id}（${p.file}）${p.note === undefined ? "" : `：${p.note}`}`,
    );
  }
}
