import { readFileSync } from "node:fs";
import { loadContent } from "@stella/core";
import { loadGameContent, rawContent } from "@stella/content";
import { describe, expect, it } from "vitest";
import { type Build, buildSchema } from "../src/build.ts";
import { simulate } from "../src/simulate.ts";
import { chapterBossHp, normalEnemyHp, standardDps, standardHp } from "../src/standards.ts";
import { chapterBoss, dummy, normalEnemy, targetByName } from "../src/targets.ts";

const db = loadGameContent();
const load = (id: string): Build =>
  buildSchema.parse(
    JSON.parse(readFileSync(new URL(`../builds/${id}.json`, import.meta.url), "utf-8")),
  );

describe("標準の値（補助仕様書 0.1）", () => {
  it("標準HPは直線、標準DPSは比で補う", () => {
    expect(standardHp(1)).toBe(60);
    expect(standardHp(15)).toBe(300);
    expect(standardHp(20)).toBeCloseTo(416.7, 1);
    expect(standardDps(5)).toBeCloseTo(22.3, 1);
    expect(standardDps(14)).toBeCloseTo(54.3, 1);
    expect(standardDps(20)).toBeCloseTo(92.5, 1);
    expect(standardDps(21)).toBeCloseTo(100.9, 1);
  });

  it("通常の敵のHPと章ボスのHP（腐根の母樹5,400・深淵の母樹約9,100）", () => {
    expect(normalEnemyHp(1)).toBe(30);
    expect(normalEnemyHp(15)).toBeCloseTo(67.8, 1);
    expect(chapterBossHp(15)).toBeCloseTo(5400);
    expect(chapterBossHp(21)).toBeCloseTo(9080, 0);
  });

  it("的の名前", () => {
    expect(targetByName("dummy-3").maxHp).toBeUndefined();
    expect(targetByName("boss-14@15").maxHp).toBeCloseTo(5400);
    expect(() => targetByName("nope")).toThrow();
  });
});

describe("シミュレーター（開発計画書 工程BL-1）", () => {
  it("仕様書2.8「Lv1でDPS15」：下級の長剣の戦士（薙ぎ払い＋通常攻撃）が、標準DPSの±10%に入る", () => {
    const r = simulate(db, load("lv1-warrior-longsword"), dummy(1), { seconds: 60, seed: 1 });
    expect(r.dps).toBeGreaterThan(15 * 0.9);
    expect(r.dps).toBeLessThan(15 * 1.1);
  });

  it("通常攻撃だけなら、平均8.5×1.40回/秒（＋会心の期待値）に近い", () => {
    const r = simulate(db, load("lv1-basic-longsword"), dummy(1), { seconds: 600, seed: 2 });
    expect(r.dps).toBeCloseTo(8.5 * 1.4 * (1 + 0.05 * 0.5), 0);
    expect(r.skills[0]?.uses).toBe(841); // 0秒の1回目＋600秒×1.40回/秒
  });

  it("同じシードなら同じ結果、違うシードなら違う結果", () => {
    const b = load("lv1-warrior-longsword");
    const a1 = simulate(db, b, dummy(1), { seconds: 30, seed: "x" });
    const a2 = simulate(db, b, dummy(1), { seconds: 30, seed: "x" });
    const a3 = simulate(db, b, dummy(1), { seconds: 30, seed: "y" });
    expect(a1).toEqual(a2);
    expect(a1.totalDamage).not.toBe(a3.totalDamage);
  });

  it("MPが尽きると、MPを使わない技に切り替わる（MPの使用量は、回復を含めた量を超えない）", () => {
    const r = simulate(db, load("lv1-warrior-longsword"), dummy(1), { seconds: 60, seed: 3 });
    const maxSpend = 60 + 60 * 0.06 * 60; // 最初のMP＋60秒分の回復
    expect(r.mpSpent).toBeLessThanOrEqual(maxSpend + 1e-9);
    expect(r.skills.find((s) => s.name === "通常攻撃")?.uses).toBeGreaterThan(0);
  });

  it("HPのある的は、倒した時点で終わり、撃破時間を返す", () => {
    const r = simulate(db, load("lv1-warrior-longsword"), normalEnemy(1), { seconds: 60, seed: 4 });
    expect(r.killTime).toBeDefined();
    expect(r.totalDamage).toBeGreaterThanOrEqual(30);
    expect(r.killTime).toBeLessThan(5);
  });

  it("的の攻撃で受けたダメージを返す（防具値で減る）", () => {
    const base = load("lv1-warrior-longsword");
    const target = chapterBoss(14, 15);
    const plain = simulate(db, base, target, { seconds: 30, seed: 5 });
    const armored = simulate(db, { ...base, baseStats: { "STAT-ARMOR": 200 } }, target, {
      seconds: 30,
      seed: 5,
    });
    expect(plain.damageTaken).toBeGreaterThan(0);
    expect(armored.damageTaken).toBeLessThan(plain.damageTaken);
  });

  it("状態異常（出血）と崩しも計算に入る", () => {
    const raw = loadContent(rawContent);
    expect(raw.ok).toBe(true);
    const bleeder: Build = {
      ...load("lv1-rogue-dagger"),
      id: "test-bleed",
      rotation: [
        {
          name: "出血の技",
          tags: ["TAG-FORM-MELEE"],
          kind: "weapon",
          pct: 1,
          mpCost: 0,
          cooldown: 0,
          ailmentChance: { "TAG-AIL-BLEED": 1 },
          staggerCoefficient: 10,
        },
      ],
    };
    const r = simulate(db, bleeder, { ...dummy(1), maxHp: 5000 }, { seconds: 30, seed: 6 });
    expect(r.ailmentsApplied["TAG-AIL-BLEED"]).toBeGreaterThan(0);
    expect(r.dotDamage).toBeGreaterThan(0);
    expect(r.staggerBreaks).toBeGreaterThan(0);
    // 移動している敵には、出血のダメージが増える
    const moving = simulate(
      db,
      bleeder,
      { ...dummy(1), maxHp: 5000, movingRatio: 1 },
      { seconds: 30, seed: 6 },
    );
    expect(moving.dotDamage).toBeGreaterThan(r.dotDamage * 1.5);
  });

  it("builds/ の全てのビルドが、形の検証を通る", () => {
    for (const id of ["lv1-basic-longsword", "lv1-warrior-longsword", "lv1-rogue-dagger"]) {
      expect(() => load(id)).not.toThrow();
    }
  });
});
