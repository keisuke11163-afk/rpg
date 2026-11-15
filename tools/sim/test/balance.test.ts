/**
 * バランスの回帰テスト（MVP実装単位 U-21、開発計画書 T14）。
 * 数値を調整したときに、MVPの完成の条件（1.1節）が崩れていないことを確かめる。
 * 測るのは、敵の攻撃を避け続ける理想的なプレイヤーの撃破時間。
 */
import { MATERIAL, createRng, generateItem, rollDrops, type DropSource } from "@stella/core";
import { GENERATION_DATA } from "@stella/content";
import { describe, expect, it } from "vitest";
import { buildFighter, fightBoss, type BuildSpec } from "../src/builds.ts";
import {
  DIFFERENT_BUILDS,
  ROGUE_LV15,
  ROGUE_LV20,
  WARRIOR_LV15,
  WARRIOR_LV20,
} from "../src/standard.ts";

const probe = (spec: BuildSpec, boss: string, level: number, seeds = 3): number => {
  let sum = 0;
  for (let i = 0; i < seeds; i++) {
    const r = fightBoss(buildFighter(spec).fighter, spec, boss, level, `p${String(i)}`);
    expect(r.killed).toBe(true);
    sum += r.seconds;
  }
  return sum / seeds;
};

describe("ボスの撃破時間（目標：標準のビルドで60〜120秒。補助仕様書 11章・本仕様書 8.4）", () => {
  it("腐根の母樹（Lv14）：Lv15の標準ビルド（戦士・盗賊）が60〜120秒で倒せる", () => {
    for (const spec of [WARRIOR_LV15, ROGUE_LV15]) {
      const t = probe(spec, "BOSS-CH1", 14);
      expect(t, spec.name).toBeGreaterThanOrEqual(60);
      expect(t, spec.name).toBeLessThanOrEqual(120);
    }
  });
  it("深淵の母樹（Lv21）：Lv20の標準ビルド（戦士・盗賊）が60〜120秒で倒せる", () => {
    for (const spec of [WARRIOR_LV20, ROGUE_LV20]) {
      const t = probe(spec, "BOSS-ABYSS", 21);
      expect(t, spec.name).toBeGreaterThanOrEqual(60);
      expect(t, spec.name).toBeLessThanOrEqual(120);
    }
  });
  it("深淵の母樹に、まったく違う3つ以上のビルドで勝てる（MVPの完成の条件3）", () => {
    // ジョブ・武器・ユニーク・ツリーの取り方が違う組み合わせが3つ以上ある
    const kinds = new Set(
      DIFFERENT_BUILDS.map(
        (b) =>
          `${b.job}|${b.gear
            .map((g) => g.uniqueId ?? g.baseId)
            .filter((x) => x.startsWith("BASE-WPN") || x.startsWith("UNQ"))
            .join("+")}|${b.star.join("/")}`,
      ),
    );
    expect(kinds.size).toBeGreaterThanOrEqual(3);
    for (const spec of DIFFERENT_BUILDS) {
      const t = probe(spec, "BOSS-ABYSS", 21, 2);
      // 違うビルドは効率が違ってよい。ただし、4分以内には倒せること
      expect(t, spec.name).toBeLessThanOrEqual(240);
    }
  });
});

describe("入手の頻度（本仕様書 3.5・補助仕様書 4.1・12.2）", () => {
  it("1時間に通常500・魔法60・精鋭15体を倒すと、アイテムは約150個・希少は約17個・ユニークは約2個・還星の灯は3〜5個", () => {
    const rng = createRng("hour");
    let items = 0;
    let rare = 0;
    let unique = 0;
    let lamps = 0;
    const kills: [DropSource, number][] = [
      ["normal", 500],
      ["magic", 60],
      ["elite", 15],
    ];
    const HOURS = 40;
    for (let h = 0; h < HOURS; h++) {
      for (const [source, n] of kills) {
        for (let i = 0; i < n; i++) {
          const d = rollDrops(
            GENERATION_DATA,
            { source, enemyLevel: 10, generate: {}, uid: () => "x" },
            rng,
          );
          items += d.items.length;
          for (const it of d.items) {
            if (it.rarity === "rare" || it.rarity === "astral") rare++;
            if (it.rarity === "unique" || it.rarity === "set") unique++;
          }
          lamps += d.materials[MATERIAL.returnLamp] ?? 0;
        }
      }
    }
    const perHour = (n: number): number => n / HOURS;
    expect(perHour(items)).toBeGreaterThan(130);
    expect(perHour(items)).toBeLessThan(170);
    expect(perHour(rare)).toBeGreaterThan(13);
    expect(perHour(rare)).toBeLessThan(30);
    expect(perHour(unique)).toBeGreaterThan(0.8);
    expect(perHour(unique)).toBeLessThan(4);
    expect(perHour(lamps)).toBeGreaterThan(2.5);
    expect(perHour(lamps)).toBeLessThan(5.5);
  });
  it("アイテムの生成は、同じシードで同じ結果（再現できる）", () => {
    const make = (): string =>
      JSON.stringify(
        generateItem(
          GENERATION_DATA,
          { ilvl: 12, rarity: "rare", uid: () => "u" },
          createRng("same"),
        ),
      );
    expect(make()).toBe(make());
  });
});

describe("装備・ツリー・ジョブの寄与（開発計画書 T15：測り方は仕様で未決のため、参考値を測る）", () => {
  it("装備を外すと撃破時間が大きく延びる。ツリーを外しても短くならない（誤差の範囲）", () => {
    const full = probe(WARRIOR_LV15, "BOSS-CH1", 14, 2);
    const noGear = probe(
      { ...WARRIOR_LV15, gear: [{ baseId: "BASE-WPN-GREATSWORD-T1" }] },
      "BOSS-CH1",
      14,
      2,
    );
    const noStar = probe({ ...WARRIOR_LV15, star: [] }, "BOSS-CH1", 14, 2);
    const noJob = probe({ ...WARRIOR_LV15, job_: [] }, "BOSS-CH1", 14, 2);
    expect(noGear).toBeGreaterThan(full * 1.1);
    // ツリーの寄与は、乱数のばらつき（数秒）と同じ程度に小さいので、誤差を許す
    expect(noStar).toBeGreaterThanOrEqual(full - 4);
    expect(noJob).toBeGreaterThanOrEqual(full - 4);
  });
});
