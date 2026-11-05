/**
 * データのファイルの一覧。
 *
 * ブラウザ（Vite）でも Node.js でも同じように読めるように、ファイルを静的に読み込む。
 * データのファイルを追加したら、ここにも追加する。登録し忘れたファイルは、
 * データの検証（pnpm validate:data）が誤りとして知らせる。
 */
import type { RawContent } from "@stella/core";
import manifest from "../data/manifest.json" with { type: "json" };
import ailments from "../data/tags/ailments.json" with { type: "json" };
import elements from "../data/tags/elements.json" with { type: "json" };
import enemyFamilies from "../data/tags/enemy-families.json" with { type: "json" };
import forms from "../data/tags/forms.json" with { type: "json" };
import jobs from "../data/tags/jobs.json" with { type: "json" };
import regions from "../data/tags/regions.json" with { type: "json" };
import weapons from "../data/tags/weapons.json" with { type: "json" };
import ja from "../text/ja.json" with { type: "json" };

export const rawContent: RawContent = {
  manifest: { file: "data/manifest.json", value: manifest },
  texts: ja,
  collections: {
    tags: [
      { file: "data/tags/forms.json", entries: forms },
      { file: "data/tags/elements.json", entries: elements },
      { file: "data/tags/ailments.json", entries: ailments },
      { file: "data/tags/weapons.json", entries: weapons },
      { file: "data/tags/jobs.json", entries: jobs },
      { file: "data/tags/regions.json", entries: regions },
      { file: "data/tags/enemy-families.json", entries: enemyFamilies },
    ],
    stats: [],
    effects: [],
  },
};

/** 登録されているデータのファイル（data/ からの場所）。 */
export function registeredDataFiles(): string[] {
  const c = rawContent.collections;
  return [rawContent.manifest.file, ...[...c.tags, ...c.stats, ...c.effects].map((s) => s.file)];
}
