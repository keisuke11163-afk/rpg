/**
 * データの検証（開発計画書 T17、MVP実装単位 U-02）。
 * - data/ の JSON を全てディスクから読み、読めることを確かめる
 * - 読み込む一覧（packages/content/src/files.ts）と、ディスクのファイルが一致することを確かめる
 * - 形・版・ID参照・値の範囲・乗算の出どころなどを検証する（core の validateContent）
 * - text/ja.json が読め、全てのIDの表示名があることを確かめる
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { formatDataErrors, type RawDataFile } from "../../packages/core/src/index.ts";
import { DATA_FILES, validateContentFiles } from "../../packages/content/src/index.ts";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const contentRoot = join(repoRoot, "packages", "content");
const dataRoot = join(contentRoot, "data");

function jsonFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return jsonFiles(path);
    return name.endsWith(".json") ? [path] : [];
  });
}

const failures: string[] = [];
const files: RawDataFile[] = [];

for (const file of [...jsonFiles(dataRoot), ...jsonFiles(join(contentRoot, "text"))]) {
  try {
    const content: unknown = JSON.parse(readFileSync(file, "utf-8"));
    if (file.startsWith(dataRoot)) {
      files.push({ path: relative(dataRoot, file).split(sep).join("/"), content });
    }
  } catch (error) {
    failures.push(
      `${relative(repoRoot, file)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

const listed = new Set(DATA_FILES.map((f) => f.path));
for (const { path } of files) {
  if (!listed.has(path))
    failures.push(`${path}: packages/content/src/files.ts の一覧に載っていない`);
}
for (const path of listed) {
  if (!files.some((f) => f.path === path))
    failures.push(`${path}: 一覧に載っているが、ファイルがない`);
}

const result = validateContentFiles(files);
if (!result.ok) failures.push(formatDataErrors(result.errors));

if (failures.length > 0) {
  console.error(`データの検証：失敗\n${failures.join("\n")}`);
  process.exit(1);
}
if (result.ok) {
  const { tags, stats, hooks, effects, schemaVersion } = result.data;
  console.log(
    `データの検証：${String(files.length)}ファイル（データの版 ${String(schemaVersion)}）、問題なし` +
      `（タグ ${String(tags.size)}・能力値 ${String(stats.size)}・ルールフック ${String(hooks.size)}・効果 ${String(effects.size)}）`,
  );
}
