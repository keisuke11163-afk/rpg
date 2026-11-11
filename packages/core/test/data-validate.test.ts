/**
 * データの検証（開発計画書 F-2・T17、MVP実装単位 U-02）。
 * 正しい小さなデータを用意し、1か所ずつ壊して、全ての壊れ方を検出できることを確かめる。
 */
import { describe, expect, it } from "vitest";
import {
  DATA_SCHEMA_VERSION,
  listProvisional,
  validateContent,
  type DataErrorCode,
  type RawDataFile,
} from "../src/index.ts";

type Json = Record<string, unknown>;

function baseFixture() {
  const tags: Json[] = [
    { id: "TAG-FORM-PROJECTILE", category: "form" },
    { id: "TAG-ELM-PHYSICAL", category: "element", conversionRank: 0 },
    { id: "TAG-ELM-LIGHTNING", category: "element", conversionRank: 1 },
    { id: "TAG-ELM-FIRE", category: "element", conversionRank: 3 },
    { id: "TAG-ELM-HOLY", category: "element" },
    { id: "TAG-AIL-BLEED", category: "ailment" },
    { id: "TAG-WPNGRP-SWORD", category: "weapon_group" },
    { id: "TAG-WPN-GREATSWORD", category: "weapon", parents: ["TAG-WPNGRP-SWORD"] },
  ];
  const stats: Json[] = [
    { id: "STAT-DAMAGE", unit: "ratio" },
    { id: "STAT-AILMENT-DURATION", unit: "seconds" },
    { id: "STAT-INTELLECT", unit: "number" },
  ];
  const hooks: Json[] = [
    { id: "HOOK-EXTRA-PROJECTILES", params: { count: "integer", spreadDeg: "number" } },
  ];
  const effects: Json[] = [
    {
      id: "MUT-PRJ-001",
      source: "mutation",
      targetTags: { allOf: ["TAG-FORM-PROJECTILE"] },
      modifiers: [
        { kind: "behavior", hook: "HOOK-EXTRA-PROJECTILES", params: { count: 2, spreadDeg: 40 } },
        { kind: "more", stat: "STAT-DAMAGE", value: 0.8 },
      ],
      scope: "self_skills",
      affects: { hit: true, base: true },
    },
    {
      id: "EFF-TEST-NODE",
      source: "star_minor",
      conditions: [{ type: "stat_at_least", stat: "STAT-INTELLECT", value: 200 }],
      modifiers: [
        {
          kind: "increased",
          stat: "STAT-DAMAGE",
          filter: { anyOf: ["TAG-AIL-BLEED"] },
          value: 0.06,
        },
        { kind: "added", stat: "STAT-AILMENT-DURATION", value: 0.3 },
        { kind: "conversion", from: "TAG-ELM-PHYSICAL", to: "TAG-ELM-FIRE", value: 0.5 },
      ],
      scope: "self",
      affects: { hit: false, base: false },
      provisional: true,
      provisionalNote: "BL-2で調整",
    },
  ];
  return { tags, stats, hooks, effects };
}

type Fixture = ReturnType<typeof baseFixture>;

function files(fixture: Fixture, version = DATA_SCHEMA_VERSION): RawDataFile[] {
  return (Object.keys(fixture) as (keyof Fixture)[]).map((kind) => ({
    path: `${kind}/${kind}.json`,
    content: { schemaVersion: version, kind, entries: fixture[kind] },
  }));
}

function codesAfter(mutate: (f: Fixture) => void): DataErrorCode[] {
  const fixture = structuredClone(baseFixture());
  mutate(fixture);
  return validateContent(files(fixture)).errors.map((e) => e.code);
}

function effect(f: Fixture, index: number): Json {
  return f.effects[index] as Json;
}
function modifiers(f: Fixture, index: number): Json[] {
  return effect(f, index)["modifiers"] as Json[];
}

describe("validateContent", () => {
  it("正しいデータは通り、IDで引ける", () => {
    const result = validateContent(files(baseFixture()));
    expect(result.errors).toEqual([]);
    if (!result.ok) throw new Error("通るはず");
    expect(result.data.tags.get("TAG-WPN-GREATSWORD")?.parents).toEqual(["TAG-WPNGRP-SWORD"]);
    expect(result.data.effects.get("EFF-TEST-NODE")?.conditions).toHaveLength(1);
    // conditions を省略すると空の配列になる
    expect(result.data.effects.get("MUT-PRJ-001")?.conditions).toEqual([]);
    expect(result.data.origins.get("MUT-PRJ-001")).toBe("effects/effects.json");
  });

  describe("壊したデータを検出する", () => {
    it("存在しないタグ（効果の対象・修正値の絞り込み・タグの親）", () => {
      expect(
        codesAfter((f) => {
          effect(f, 0)["targetTags"] = { allOf: ["TAG-FORM-NOPE"] };
          (modifiers(f, 1)[0] as Json)["filter"] = { anyOf: ["TAG-AIL-NOPE"] };
          (f.tags[7] as Json)["parents"] = ["TAG-WPNGRP-NOPE"];
        }),
      ).toEqual(["unknown_reference", "unknown_reference", "unknown_reference"]);
    });

    it("存在しない能力値・ルールフック", () => {
      expect(
        codesAfter((f) => {
          (modifiers(f, 0)[1] as Json)["stat"] = "STAT-NOPE";
          (modifiers(f, 0)[0] as Json)["hook"] = "HOOK-NOPE";
        }),
      ).toEqual(["unknown_reference", "unknown_reference"]);
    });

    it("参照先の種類の取り違え（タグの場所に能力値）", () => {
      expect(
        codesAfter((f) => {
          effect(f, 0)["targetTags"] = { allOf: ["STAT-DAMAGE"] };
        }),
      ).toContain("schema"); // TAG- で始まらないので、形の検査で見つかる
      expect(
        codesAfter((f) => {
          (modifiers(f, 1)[2] as Json)["to"] = "TAG-AIL-BLEED";
        }),
      ).toEqual(["wrong_reference_kind"]); // 属性でないタグへの変換
    });

    it("範囲外の値", () => {
      expect(
        codesAfter((f) => {
          (modifiers(f, 1)[0] as Json)["value"] = 6; // 0.06 の書き間違い（+600%）は通す範囲だが…
        }),
      ).toEqual([]);
      expect(
        codesAfter((f) => {
          (modifiers(f, 1)[0] as Json)["value"] = 60; // +6000% は範囲外
          (modifiers(f, 0)[1] as Json)["value"] = 0; // 乗算×0
          (modifiers(f, 1)[2] as Json)["value"] = 1.5; // 変換150%
        }),
      ).toEqual(["schema", "schema", "schema"]);
    });

    it("必須の項目がない・知らない項目がある", () => {
      expect(
        codesAfter((f) => {
          delete effect(f, 0)["affects"];
          (f.tags[0] as Json)["nmae"] = "誤字";
        }),
      ).toEqual(["schema", "schema"]);
    });

    it("重複したID（同じ種類の中・種類をまたいで）", () => {
      expect(
        codesAfter((f) => {
          f.tags.push({ id: "TAG-FORM-PROJECTILE", category: "form" });
          f.stats.push({ id: "MUT-PRJ-001", unit: "number" });
        }),
      ).toEqual(["schema", "duplicate_id"]); // 能力値のIDは STAT- で始める
      const result = validateContent([
        ...files(baseFixture()),
        {
          path: "effects/more.json",
          content: {
            schemaVersion: DATA_SCHEMA_VERSION,
            kind: "effects",
            entries: [baseFixture().effects[0]],
          },
        },
      ]);
      expect(result.errors.map((e) => [e.code, e.file])).toEqual([
        ["duplicate_id", "effects/more.json"],
      ]);
    });

    it("持てない出どころの乗算（本仕様書 2.4）", () => {
      expect(
        codesAfter((f) => {
          modifiers(f, 1).push({ kind: "more", stat: "STAT-DAMAGE", value: 1.2 }); // 小星の乗算
        }),
      ).toEqual(["multiplier_source"]);
      expect(
        codesAfter((f) => {
          (modifiers(f, 0)[1] as Json)["value"] = 1.1; // 転変の増やす方向の乗算
        }),
      ).toEqual(["multiplier_source"]);
      expect(
        codesAfter((f) => {
          effect(f, 0)["source"] = "keystone"; // 天極は持てる
          (modifiers(f, 0)[1] as Json)["value"] = 1.4;
        }),
      ).toEqual([]);
    });

    it("変換の向き・合計（本仕様書 2.5）", () => {
      expect(
        codesAfter((f) => {
          Object.assign(modifiers(f, 1)[2] as Json, {
            from: "TAG-ELM-FIRE",
            to: "TAG-ELM-PHYSICAL",
          });
        }),
      ).toEqual(["conversion_direction"]); // 下流から上流
      expect(
        codesAfter((f) => {
          Object.assign(modifiers(f, 1)[2] as Json, { from: "TAG-ELM-HOLY", to: "TAG-ELM-FIRE" });
        }),
      ).toEqual(["conversion_direction"]); // 聖から
      expect(
        codesAfter((f) => {
          modifiers(f, 1).push({
            kind: "conversion",
            from: "TAG-ELM-PHYSICAL",
            to: "TAG-ELM-LIGHTNING",
            value: 0.6,
          });
        }),
      ).toEqual(["conversion_total"]); // 50% ＋ 60%
      expect(
        codesAfter((f) => {
          // 付け替えは向きの制限を受けない（変換とは別の仕組み）
          modifiers(f, 1).push({
            kind: "reattribution",
            from: "TAG-ELM-FIRE",
            to: "TAG-ELM-PHYSICAL",
          });
        }),
      ).toEqual([]);
    });

    it("同じ能力値・同じ優先度の上書き（本仕様書 2.4.1-4）", () => {
      expect(
        codesAfter((f) => {
          modifiers(f, 0).push({ kind: "override", stat: "STAT-DAMAGE", value: 0, priority: 10 });
          modifiers(f, 1).push({ kind: "override", stat: "STAT-DAMAGE", value: 1, priority: 10 });
        }),
      ).toEqual(["override_priority"]);
      expect(
        codesAfter((f) => {
          modifiers(f, 0).push({ kind: "override", stat: "STAT-DAMAGE", value: 0, priority: 10 });
          modifiers(f, 1).push({ kind: "override", stat: "STAT-DAMAGE", value: 1, priority: 20 });
        }),
      ).toEqual([]);
    });

    it("ルールフックのパラメータの過不足・型", () => {
      expect(
        codesAfter((f) => {
          (modifiers(f, 0)[0] as Json)["params"] = { count: 2.5, extra: true };
        }),
      ).toEqual(["hook_params", "hook_params", "hook_params"]); // spreadDeg がない・count が整数でない・extra はない
    });

    it("タグの親子の循環", () => {
      expect(
        codesAfter((f) => {
          (f.tags[6] as Json)["parents"] = ["TAG-WPN-GREATSWORD"];
        }),
      ).toEqual(["tag_cycle", "tag_cycle"]);
    });

    it("属性でないタグの conversionRank", () => {
      expect(
        codesAfter((f) => {
          (f.tags[0] as Json)["conversionRank"] = 2;
        }),
      ).toEqual(["schema"]);
    });

    it("データの版が合わない・外枠が壊れている", () => {
      const fixture = baseFixture();
      expect(
        validateContent(files(fixture, DATA_SCHEMA_VERSION + 1)).errors.map((e) => e.code),
      ).toEqual(Array(4).fill("schema_version"));
      expect(
        validateContent([
          { path: "x.json", content: { schemaVersion: 1, kind: "spells", entries: [] } },
        ]).errors[0]?.code,
      ).toBe("schema");
    });

    it("複数の誤りを、最初の1つで止めずに全て返す（場所付き）", () => {
      const fixture = structuredClone(baseFixture());
      (modifiers(fixture, 0)[1] as Json)["stat"] = "STAT-NOPE";
      (fixture.tags[7] as Json)["parents"] = ["TAG-NOPE"];
      const result = validateContent(files(fixture));
      expect(result.ok).toBe(false);
      expect(result.errors.map((e) => `${e.file} ${e.path}`).sort()).toEqual([
        "effects/effects.json entries[0].modifiers[1].stat",
        "tags/tags.json entries[7].parents[0]",
      ]);
    });
  });

  it("仮値の一覧を出せる（開発計画書 T17）", () => {
    const result = validateContent(files(baseFixture()));
    if (!result.ok) throw new Error("通るはず");
    expect(listProvisional(result.data)).toEqual([
      { id: "EFF-TEST-NODE", file: "effects/effects.json", note: "BL-2で調整" },
    ]);
  });
});
