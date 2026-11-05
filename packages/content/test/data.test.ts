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

describe("状態異常のデータ（仕様書v0.2 2.7・補助仕様書3.3）", () => {
  const byTag = (tag: string) => loadGameContent().ailmentsByTag.get(tag);

  it("9種類の状態異常の定義がある（MVPの範囲外の4種類は未実装の印）", () => {
    const db = loadGameContent();
    expect(db.ailments.size).toBe(9);
    const pending = [...db.ailments.values()]
      .filter((a) => a.kind === "pending")
      .map((a) => a.tag)
      .sort();
    expect(pending).toEqual(["TAG-AIL-CHILL", "TAG-AIL-FREEZE", "TAG-AIL-SHOCK", "TAG-AIL-STIGMA"]);
  });

  it("出血：総量150%・5秒・8スタック・移動中2倍／毒：総量60%・3秒・無制限／燃焼：総量50%・4秒・最も強いもの", () => {
    expect(byTag("TAG-AIL-BLEED")).toMatchObject({
      kind: "dot",
      totalRatio: 1.5,
      duration: 5,
      stacking: { mode: "stack", maxStacks: 8 },
      movingMultiplier: 2,
    });
    expect(byTag("TAG-AIL-POISON")).toMatchObject({
      kind: "dot",
      sourceElements: ["physical", "dark"],
      totalRatio: 0.6,
      duration: 3,
      stacking: { mode: "stack" },
    });
    expect(byTag("TAG-AIL-BURN")).toMatchObject({
      kind: "dot",
      totalRatio: 0.5,
      duration: 4,
      stacking: { mode: "strongest" },
    });
  });

  it("衰弱：-15%（ボス-8%）・4秒", () => {
    expect(byTag("TAG-AIL-WEAKEN")).toMatchObject({
      kind: "debuff",
      duration: 4,
      dealtMultiplier: 0.85,
      bossDealtMultiplier: 0.92,
    });
  });

  it("崩し：敵0.2・ダウン2秒・×1.25／ボス0.15・怯み1秒・×1.15・毎回1.5倍／プレイヤー0.5・0.6秒", () => {
    expect(byTag("TAG-AIL-STAGGER")).toMatchObject({
      kind: "stagger",
      defaultCoefficient: 0.3,
      enemy: {
        gaugeRatio: 0.2,
        decayDelay: 3,
        decayPerSecond: 0.1,
        breakDuration: 2,
        takenMultiplier: 1.25,
        growthPerBreak: 1,
      },
      boss: { gaugeRatio: 0.15, breakDuration: 1, takenMultiplier: 1.15, growthPerBreak: 1.5 },
      player: { gaugeRatio: 0.5, decayDelay: 2, decayPerSecond: 0.2, breakDuration: 0.6 },
    });
  });
});
