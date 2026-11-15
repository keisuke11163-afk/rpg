import {
  parseFiles,
  validateData,
  type DataKind,
  type LoadResult,
  type RawFile,
} from "@stella/core";
import ja from "../text/ja.json" with { type: "json" };
import effectsSamples from "../data/effects/samples.json" with { type: "json" };
import starConstellations from "../data/star/constellations.json" with { type: "json" };
import starEffects from "../data/star/effects.json" with { type: "json" };
import starNodes from "../data/star/nodes.json" with { type: "json" };
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
    ["star/effects.json", "effects", starEffects],
    ["star/nodes.json", "starNodes", starNodes],
    ["star/constellations.json", "constellations", starConstellations],
  ] as [string, DataKind, unknown][]
).map(([file, kind, json]) => ({ file, kind, json }));

/** データを読み込んで検証する。誤りがあれば issues に入る */
export function loadContent(files: readonly RawFile[] = RAW_FILES): LoadResult {
  const loaded = parseFiles(files);
  return { data: loaded.data, issues: [...loaded.issues, ...validateData(loaded.data)] };
}

export * from "./enemies.ts";
export * from "./items.ts";

import { makeBoardData, type BoardData } from "@stella/core";
const loaded = loadContent();
/** 星辰盤のデータ（ノード・効果・星座）。読み込みの検証を通ったものだけ使う */
const isJobNode = (id: string): boolean => id.startsWith("JNODE-");
export const BOARD_DATA = makeBoardData(
  loaded.data.starNodes.filter((n) => !isJobNode(n.id)),
  loaded.data.effects,
  loaded.data.constellations,
);
/** 職紋盤のデータ（ジョブのID → 盤）と、その始点 */
const JOB_CODES: readonly (readonly [string, string])[] = [
  ["JOB-WARRIOR", "WARRIOR"],
  ["JOB-ROGUE", "ROGUE"],
];
export const JOB_BOARDS: Readonly<Record<string, { data: BoardData; start: string }>> =
  Object.fromEntries(
    JOB_CODES.map(([jobId, code]): [string, { data: BoardData; start: string }] => [
      jobId,
      {
        data: makeBoardData(
          loaded.data.starNodes.filter((n) => n.id.startsWith(`JNODE-${code}-`)),
          loaded.data.effects,
          [],
        ),
        start: `JNODE-${code}-START`,
      },
    ]),
  );
/** ジョブの始点に対応する、星辰盤の始点 */
export const STAR_START_OF_JOB: Readonly<Record<string, string>> = {
  "JOB-WARRIOR": "STAR-GOU-START",
  "JOB-ROGUE": "STAR-JIN-START",
};
/** 全タグの親子関係。装備・技のタグの展開に使う */
export const TAG_DATA = loaded.data.tags;
