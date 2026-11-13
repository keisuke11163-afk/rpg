import { readFileSync } from "node:fs";
import { loadGameContent } from "@stella/content";
import { describe, expect, it } from "vitest";
import { type Build, buildSchema } from "../src/build.ts";
import { simulate } from "../src/simulate.ts";
import { standardDps } from "../src/standards.ts";
import { bossFromData, dummy, targetByName } from "../src/targets.ts";

const db = loadGameContent();
const load = (id: string): Build =>
  buildSchema.parse(
    JSON.parse(readFileSync(new URL(`../builds/${id}.json`, import.meta.url), "utf-8")),
  );

describe("母樹の撃破時間（U-19 の完了の条件：標準的なビルドで60〜120秒）", () => {
  it("データのボスを的にする：HP・耐性・段階の境目・切り替えの無敵・根渡り", () => {
    const t = bossFromData(db, "ENM-MOTHER-TREE", 14);
    expect(t).toMatchObject({
      maxHp: 5400,
      isBoss: true,
      resist: { fire: -0.2, dark: 0.2 },
      phases: { thresholds: [0.66, 0.33], invulnerable: 2 },
      burrow: { phase: 3, duration: 1.5 },
    });
    expect(targetByName("ENM-ABYSS-MOTHER-TREE@21", db).maxHp).toBe(9100);
    expect(() => targetByName("ENM-FOREST-WOLF@3", db)).toThrow();
    expect(() => targetByName("ENM-MOTHER-TREE@14")).toThrow();
  });

  it("標準DPSのビルドは、その標準DPSに近い（人形に60秒）", () => {
    for (const [id, level] of [
      ["lv14-warrior-standard", 14],
      ["lv20-warrior-standard", 20],
    ] as const) {
      const r = simulate(db, load(id), dummy(level), { seconds: 60, seed: "std" });
      expect(r.dps / standardDps(level)).toBeGreaterThan(0.95);
      expect(r.dps / standardDps(level)).toBeLessThan(1.1);
    }
  });

  it("Lv14 の標準のビルドで腐根の母樹、Lv20 の標準のビルドで深淵の母樹を、60〜120秒で倒せる", () => {
    for (const [id, boss, level] of [
      ["lv14-warrior-standard", "ENM-MOTHER-TREE", 14],
      ["lv20-warrior-standard", "ENM-ABYSS-MOTHER-TREE", 21],
    ] as const) {
      for (const seed of ["a", "b", "c"]) {
        const r = simulate(db, load(id), bossFromData(db, boss, level), { seconds: 300, seed });
        expect(r.killTime).toBeDefined();
        expect(r.killTime ?? 0).toBeGreaterThanOrEqual(60);
        expect(r.killTime ?? 0).toBeLessThanOrEqual(120);
        // 段階の切り替え（2秒×2）と根渡りの分は、ダメージを受けない
        expect(r.invulnerableSeconds).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("段階の境目で止まる：一撃で大きなダメージを与えても、切り替えの間は減らない", () => {
    const strong: Build = {
      ...load("lv14-warrior-standard"),
      weapon: {
        uid: "huge",
        tags: ["TAG-WPN-SWORD"],
        base: { physical: { min: 100000, max: 100000 } },
        critChance: 0,
        attackSpeed: 1,
      },
    };
    const r = simulate(db, strong, bossFromData(db, "ENM-MOTHER-TREE", 14), {
      seconds: 60,
      seed: "x",
    });
    // 1撃目で66%、切り替えの2秒の後に33%、さらに2秒の後に倒す
    expect(r.killTime).toBeDefined();
    expect(r.killTime ?? 0).toBeGreaterThan(4);
    expect(r.invulnerableSeconds).toBeGreaterThanOrEqual(4 - 1e-9);
  });
});
