import { describe, expect, it } from "vitest";
import { DATA_VERSION, listProvisional, type RawFile } from "@stella/core";
import { RAW_FILES, loadContent } from "../src/index.ts";

const tag = (id: string, extra: object = {}): object => ({
  id,
  category: "試験",
  name: id,
  ...extra,
});
const file = (kind: RawFile["kind"], items: object[], name = `${kind}/t.json`): RawFile => ({
  file: name,
  kind,
  json: { dataVersion: DATA_VERSION, items },
});
const effect = (id: string, source: string, modifiers: object[], extra: object = {}): object => ({
  id,
  source,
  modifiers,
  affects: { 打撃値: false, 基準値: false },
  scope: "自分",
  ...extra,
});
const messages = (files: RawFile[]): string =>
  loadContent(files)
    .issues.map((i) => i.message)
    .join("\n");

describe("実際のデータ", () => {
  it("検証を全て通る", () => {
    expect(loadContent().issues).toEqual([]);
  });
  it("仕様書1.5のタグを持つ（武器は親タグを持つ）", () => {
    const { data } = loadContent();
    const great = data.tags.find((t) => t.id === "TAG-WPN-GREATSWORD");
    expect(great?.parents).toEqual(["TAG-WPNGRP-SWORD"]);
    expect(RAW_FILES.length).toBeGreaterThan(5);
  });
  it("仮値を一覧にできる", () => {
    expect(listProvisional(loadContent().data).length).toBeGreaterThan(0);
  });
});

describe("壊したデータを検出する（開発計画書 T17）", () => {
  const base = file("tags", [tag("TAG-A-ONE"), tag("TAG-A-TWO")]);

  it("IDの重複", () => {
    expect(messages([base, file("tags", [tag("TAG-A-ONE")], "tags/dup.json")])).toMatch(/重複/);
  });
  it("存在しないタグの参照（効果・親）", () => {
    const bad = effect("EFF-X-1", "天極", [{ kind: "加算％", stat: "ダメージ", value: 0.1 }], {
      target_skill_tags: { all_of: ["TAG-NONE-X"] },
    });
    expect(messages([base, file("effects", [bad])])).toMatch(/存在しないタグ TAG-NONE-X/);
    expect(messages([file("tags", [tag("TAG-A-ONE", { parents: ["TAG-NONE-Y"] })])])).toMatch(
      /存在しない親タグ/,
    );
  });
  it("親子関係の循環", () => {
    const loop = file("tags", [
      tag("TAG-L-A", { parents: ["TAG-L-B"] }),
      tag("TAG-L-B", { parents: ["TAG-L-A"] }),
    ]);
    expect(messages([loop])).toMatch(/循環/);
  });
  it("範囲外の値", () => {
    const bad = effect("EFF-X-2", "天極", [{ kind: "乗算", stat: "ダメージ", value: 99 }]);
    expect(messages([base, file("effects", [bad])])).toMatch(/10/);
    const bad2 = effect("EFF-X-3", "詞", [{ kind: "加算％", stat: "ダメージ", value: Number.NaN }]);
    expect(loadContent([base, file("effects", [bad2])]).issues.length).toBeGreaterThan(0);
  });
  it("持てない出どころの乗算（詞・基本ノード）", () => {
    for (const source of ["詞", "基本ノード", "セット"]) {
      const bad = effect("EFF-X-4", source, [{ kind: "乗算", stat: "ダメージ", value: 1.2 }]);
      expect(messages([base, file("effects", [bad])])).toMatch(/乗算を持てない/);
    }
    const ok = effect("EFF-X-5", "天極", [{ kind: "乗算", stat: "ダメージ", value: 1.5 }]);
    expect(loadContent([base, file("effects", [ok])]).issues).toEqual([]);
  });
  it("転変は減らす方向の乗算だけ", () => {
    const bad = effect("MUT-X-1", "転変", [{ kind: "乗算", stat: "ダメージ", value: 1.2 }]);
    expect(messages([base, file("effects", [bad])])).toMatch(/減らす方向/);
  });
  it("打撃値・基準値への影響の省略", () => {
    const bad = {
      id: "EFF-X-6",
      source: "天極",
      scope: "自分",
      modifiers: [{ kind: "固定の追加", stat: "x", value: 1 }],
    };
    expect(loadContent([base, file("effects", [bad])]).issues.length).toBeGreaterThan(0);
  });
  it("知らない項目・IDの形・データの版", () => {
    expect(loadContent([file("tags", [tag("bad id")])]).issues.length).toBeGreaterThan(0);
    expect(
      loadContent([file("tags", [tag("TAG-A-ONE", { extra: 1 })])]).issues.length,
    ).toBeGreaterThan(0);
    const wrongVersion: RawFile = {
      file: "tags/v.json",
      kind: "tags",
      json: { dataVersion: 99, items: [] },
    };
    expect(loadContent([wrongVersion]).issues.length).toBeGreaterThan(0);
  });
});

describe("同じ優先度の上書き（本仕様書 2.4.1 規則4）", () => {
  it("検出する", () => {
    const ov = (id: string, priority: number): object =>
      effect(id, "天極", [{ kind: "挙動", hook: "上書き:移動速度", params: { priority } }]);
    const base = file("tags", [tag("TAG-A-ONE")]);
    expect(messages([base, file("effects", [ov("EFF-O-1", 3), ov("EFF-O-2", 3)])])).toMatch(
      /同じ優先度/,
    );
    expect(
      loadContent([base, file("effects", [ov("EFF-O-1", 3), ov("EFF-O-2", 4)])]).issues,
    ).toEqual([]);
  });
});
