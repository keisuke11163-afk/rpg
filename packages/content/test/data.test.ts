/** 実際のデータの検証（開発計画書 T17）。 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_SCHEMA_VERSION } from "@stella/core";
import { describe, expect, it } from "vitest";
import { DATA_FILES, loadContent, nameOf, validateContentFiles } from "../src/index.ts";

const dataRoot = fileURLToPath(new URL("../data", import.meta.url));

function jsonFilesOnDisk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return jsonFilesOnDisk(path);
    return name.endsWith(".json") ? [relative(dataRoot, path).split(sep).join("/")] : [];
  });
}

describe("コンテンツのデータ", () => {
  it("全てのデータが検証を通る", () => {
    const result = validateContentFiles(DATA_FILES);
    expect(result.errors).toEqual([]);
  });

  it("data/ の全ての JSON が、読み込む一覧（src/files.ts）に載っている", () => {
    expect(DATA_FILES.map((f) => f.path).sort()).toEqual(jsonFilesOnDisk(dataRoot).sort());
  });

  it("一覧の内容は、ディスクのファイルと同じ", () => {
    for (const file of DATA_FILES) {
      expect(file.content).toEqual(JSON.parse(readFileSync(join(dataRoot, file.path), "utf-8")));
    }
  });

  it("本仕様書 1.5 の星紋タグが揃っていて、武器は系統の親タグを持つ", () => {
    const data = loadContent();
    expect(data.schemaVersion).toBe(DATA_SCHEMA_VERSION);
    const byCategory = new Map<string, number>();
    for (const tag of data.tags.values()) {
      byCategory.set(tag.category, (byCategory.get(tag.category) ?? 0) + 1);
    }
    expect(Object.fromEntries(byCategory)).toEqual({
      form: 14,
      element: 6,
      ailment: 9,
      weapon: 21,
      weapon_group: 4,
      job: 6,
      region: 9,
      enemy_family: 6,
    });
    expect(data.tags.get("TAG-WPN-GREATSWORD")?.parents).toEqual(["TAG-WPNGRP-SWORD"]);
    expect(data.tags.get("TAG-WPN-CROSSBOW")?.parents).toEqual(["TAG-WPNGRP-BOW"]);
    expect(data.tags.get("TAG-WPN-DAGGER")?.parents).toBeUndefined();
    expect(nameOf("TAG-WPNGRP-SWORD")).toBe("剣系");
  });

  it("変換の順番は 物理 → 雷 → 氷 → 火 → 闇 で、聖は順番を持たない（本仕様書 2.5）", () => {
    const tags = loadContent().tags;
    const order = [...tags.values()]
      .filter((t) => t.conversionRank !== undefined)
      .sort((a, b) => (a.conversionRank ?? 0) - (b.conversionRank ?? 0))
      .map((t) => t.id);
    expect(order).toEqual([
      "TAG-ELM-PHYSICAL",
      "TAG-ELM-LIGHTNING",
      "TAG-ELM-COLD",
      "TAG-ELM-FIRE",
      "TAG-ELM-CHAOS",
    ]);
    expect(tags.get("TAG-ELM-HOLY")?.conversionRank).toBeUndefined();
  });

  it("表示名がないIDを検出する", () => {
    const result = validateContentFiles([
      ...DATA_FILES,
      {
        path: "stats/extra.json",
        content: {
          schemaVersion: DATA_SCHEMA_VERSION,
          kind: "stats",
          entries: [{ id: "STAT-NO-NAME", unit: "number" }],
        },
      },
    ]);
    expect(result.errors.map((e) => [e.code, e.path])).toEqual([
      ["unknown_reference", "STAT-NO-NAME"],
    ]);
  });
});
