import { COMBAT_STATS, ELEMENTS, formatContentError, loadContent } from "@stella/core";
import { describe, expect, it } from "vitest";
import { loadGameContent, rawContent } from "../src/index.ts";

describe("ゲームのデータ", () => {
  it("誤りなく読み込める", () => {
    const r = loadContent(rawContent);
    expect(r.ok ? [] : r.errors.map(formatContentError)).toEqual([]);
  });

  it("星紋タグが仕様書1.5の分類で揃っている", () => {
    const db = loadGameContent();
    const byCategory = new Map<string, number>();
    for (const tag of db.tags.values())
      byCategory.set(tag.category, (byCategory.get(tag.category) ?? 0) + 1);
    expect(Object.fromEntries(byCategory)).toEqual({
      form: 14, // 仕様書1.5の13種類＋重撃（v0.2）
      element: 6,
      ailment: 9,
      weapon: 21, // 仕様書1.5の20種類＋素手（v0.2）
      weaponGroup: 4, // 剣系・斧系・槌系・弓系（v0.2）
      job: 6,
      region: 9,
      enemyFamily: 6,
    });
  });

  it("武器の系統の親タグが仕様書v0.2 1.5のとおり", () => {
    const db = loadGameContent();
    const parentOf = (id: string): string[] | undefined => db.tags.get(id)?.parents;
    expect(parentOf("TAG-WPN-SWORD")).toEqual(["TAG-WPNGRP-SWORD"]);
    expect(parentOf("TAG-WPN-GREATSWORD")).toEqual(["TAG-WPNGRP-SWORD"]);
    expect(parentOf("TAG-WPN-GREATAXE")).toEqual(["TAG-WPNGRP-AXE"]);
    expect(parentOf("TAG-WPN-GREATMACE")).toEqual(["TAG-WPNGRP-MACE"]);
    expect(parentOf("TAG-WPN-CROSSBOW")).toEqual(["TAG-WPNGRP-BOW"]);
    expect(parentOf("TAG-WPN-DAGGER")).toBeUndefined();
  });
});

describe("ダメージの計算に使う能力値", () => {
  it("core が使う能力値のIDが、全てデータにある", () => {
    const db = loadGameContent();
    const ids = [
      COMBAT_STATS.damage,
      COMBAT_STATS.critChance,
      COMBAT_STATS.critMultiplier,
      COMBAT_STATS.accuracy,
      COMBAT_STATS.skillLevel,
      ...Object.values(COMBAT_STATS.added),
    ];
    expect(ids.filter((id) => !db.stats.has(id))).toEqual([]);
  });

  it("耐性は75%が上限で、効果で90%まで上げられる（仕様書2.6）", () => {
    const db = loadGameContent();
    for (const element of ELEMENTS) {
      const s = db.stats.get(`STAT-RESIST-${element.toUpperCase()}`);
      expect(s?.baseCap).toBe(0.75);
      expect(s?.capLimit).toBe(0.9);
    }
  });
});
