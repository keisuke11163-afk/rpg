/**
 * 仮実装・仮値の一覧を出す（MVP実装単位 2.1、開発計画書 T17）。
 * - コードの「仮実装」の印（コロンを付けたもの）のコメント
 * - データの "provisional": true の項目（ID・ファイル・理由）
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { listProvisional } from "../../packages/core/src/index.ts";
import { loadContent } from "../../packages/content/src/index.ts";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const MARKER = "仮実装" + ":"; // このファイル自体が一覧に載らないように分けて書く

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
for (const file of codeDirs.flatMap((d) => files(d, [".ts"]))) {
  readFileSync(file, "utf-8")
    .split("\n")
    .forEach((line, index) => {
      const at = line.indexOf(MARKER);
      if (at >= 0)
        entries.push(`${relative(repoRoot, file)}:${String(index + 1)}  ${line.slice(at).trim()}`);
    });
}

const provisional = listProvisional(loadContent());

console.log(`仮実装：${String(entries.length)}件`);
for (const entry of entries) console.log(`  ${entry}`);
console.log(`仮値（"provisional": true）：${String(provisional.length)}件`);
for (const p of provisional) {
  console.log(`  ${p.file}  ${p.id}${p.note === undefined ? "" : `  ${p.note}`}`);
}
