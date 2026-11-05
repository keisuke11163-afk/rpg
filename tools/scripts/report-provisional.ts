/**
 * 仮実装・仮値の一覧を出す（MVP実装単位 2.1）。
 * - コードの「仮実装」の印（コロンを付けたもの）のコメント
 * - データの "provisional": true の数
 * - コードの「仮値」の印（コロンを付けたもの）のコメント（データにまだ移していない仮の数値）
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const MARKER = "仮実装" + ":"; // このファイル自体が一覧に載らないように分けて書く
const VALUE_MARKER = "仮値" + ":";

function files(dir: string, ext: string[]): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === "dist") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, ext);
    return ext.some((e) => name.endsWith(e)) ? [path] : [];
  });
}

const codeDirs = ["packages", "tools"].map((d) => join(repoRoot, d));
const entries: string[] = [];
const valueEntries: string[] = [];
for (const file of codeDirs.flatMap((d) => files(d, [".ts"]))) {
  readFileSync(file, "utf-8")
    .split("\n")
    .forEach((line, index) => {
      const where = `${relative(repoRoot, file)}:${String(index + 1)}`;
      const at = line.indexOf(MARKER);
      if (at >= 0) entries.push(`${where}  ${line.slice(at).trim()}`);
      const valueAt = line.indexOf(VALUE_MARKER);
      if (valueAt >= 0) valueEntries.push(`${where}  ${line.slice(valueAt).trim()}`);
    });
}

let provisionalValues = 0;
for (const file of files(join(repoRoot, "packages", "content", "data"), [".json"])) {
  provisionalValues += (readFileSync(file, "utf-8").match(/"provisional"\s*:\s*true/g) ?? [])
    .length;
}

console.log(`仮実装：${String(entries.length)}件`);
for (const entry of entries) console.log(`  ${entry}`);
console.log(`仮値（データの "provisional": true）：${String(provisionalValues)}件`);
console.log(`仮値（コードの「仮値」の印）：${String(valueEntries.length)}件`);
for (const entry of valueEntries) console.log(`  ${entry}`);
