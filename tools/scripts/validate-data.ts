/**
 * データの検証。
 * 仮実装: U-02 feature/data-foundation で、スキーマ・ID参照・値の範囲・乗算の出どころの検証に置き換える。
 * 今は、packages/content の data と text にある JSON が読めることだけを確かめる。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const contentRoot = join(repoRoot, "packages", "content");

function jsonFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return jsonFiles(path);
    return name.endsWith(".json") ? [path] : [];
  });
}

const files = ["data", "text"].flatMap((dir) => jsonFiles(join(contentRoot, dir)));
const failures: string[] = [];
for (const file of files) {
  try {
    JSON.parse(readFileSync(file, "utf-8"));
  } catch (error) {
    failures.push(
      `${relative(repoRoot, file)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

if (failures.length > 0) {
  console.error(`データの検証：失敗（${String(failures.length)}件）\n${failures.join("\n")}`);
  process.exit(1);
}
console.log(`データの検証：${String(files.length)}ファイル、問題なし`);
