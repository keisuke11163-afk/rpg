import {
  parseFiles,
  validateData,
  type DataKind,
  type LoadResult,
  type RawFile,
} from "@stella/core";
import ja from "../text/ja.json" with { type: "json" };
import effectsSamples from "../data/effects/samples.json" with { type: "json" };
import tagsAilment from "../data/tags/ailment.json" with { type: "json" };
import tagsElement from "../data/tags/element.json" with { type: "json" };
import tagsEnemy from "../data/tags/enemy.json" with { type: "json" };
import tagsForm from "../data/tags/form.json" with { type: "json" };
import tagsJob from "../data/tags/job.json" with { type: "json" };
import tagsRegion from "../data/tags/region.json" with { type: "json" };
import tagsWeapon from "../data/tags/weapon.json" with { type: "json" };
import tagsWeaponGroup from "../data/tags/weaponGroup.json" with { type: "json" };

/** 表示の文章のキー。文章はコードに直接書かず、text/ja.json に置く（開発環境構築計画 5章）。 */
export type TextKey = keyof typeof ja;

/** キーに対応する日本語の文章を返す。 */
export function text(key: TextKey): string {
  return ja[key];
}

/** 全てのデータファイル。ファイルを追加したら、ここにも足す */
export const RAW_FILES: readonly RawFile[] = (
  [
    ["tags/ailment.json", "tags", tagsAilment],
    ["tags/element.json", "tags", tagsElement],
    ["tags/enemy.json", "tags", tagsEnemy],
    ["tags/form.json", "tags", tagsForm],
    ["tags/job.json", "tags", tagsJob],
    ["tags/region.json", "tags", tagsRegion],
    ["tags/weapon.json", "tags", tagsWeapon],
    ["tags/weaponGroup.json", "tags", tagsWeaponGroup],
    ["effects/samples.json", "effects", effectsSamples],
  ] as [string, DataKind, unknown][]
).map(([file, kind, json]) => ({ file, kind, json }));

/** データを読み込んで検証する。誤りがあれば issues に入る */
export function loadContent(files: readonly RawFile[] = RAW_FILES): LoadResult {
  const loaded = parseFiles(files);
  return { data: loaded.data, issues: [...loaded.issues, ...validateData(loaded.data)] };
}

export * from "./enemies.ts";
export * from "./items.ts";
