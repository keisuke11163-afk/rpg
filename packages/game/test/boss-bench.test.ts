/**
 * ボスの撃破時間の計測（U-21 の土台）が、実際のビルドを組み立てて回せること。
 * 数値の目標（60〜120秒）は U-21 の調整で確かめる（ここでは土台が壊れていないことだけ）。
 */
import { describe, expect, it } from "vitest";
import { loadGameContent } from "@stella/content";
import { plainBase, prepareBench, runBossBench, withoutPart } from "../src/bench/boss-bench.ts";
import { BENCH_BUILDS } from "../src/bench/builds.ts";

const db = loadGameContent();

describe("ボスの撃破時間の計測", () => {
  it("全てのビルドを、MVPのポイント（星辰盤25・職紋盤19）以内で組み立てられる", () => {
    for (const build of BENCH_BUILDS) {
      const sim = prepareBench(db, build);
      expect(sim.character.level).toBe(20);
      expect(sim.stars.spent).toBeLessThanOrEqual(25);
      expect(sim.jobBoard.spent).toBeLessThanOrEqual(19);
      for (const e of build.equipment) expect(sim.equipment.get(e.slot)?.base, e.base).toBe(e.base);
      expect(sim.field?.enemies.some((e) => e.def.id === "ENM-ABYSS-MOTHER-TREE")).toBe(true);
    }
  });

  it("大斧のビルドは、腐根の母樹を（攻撃面だけで）120秒以内に倒せる", () => {
    const build = BENCH_BUILDS.find((b) => b.id === "warrior-heavy-greataxe");
    if (build === undefined) throw new Error("ビルドが無い");
    const r = runBossBench(db, build, { region: "REGION-A4-BOSS", seconds: 120 });
    expect(r.boss).toBe("ENM-MOTHER-TREE");
    expect(r.killTime).toBeDefined();
    expect(r.dps).toBeGreaterThan(0);
  });

  it("盗賊（短剣の二刀流＋影法師）は、深淵の母樹を倒れずに60〜120秒で倒せる（完成の条件3。ボットでの代わりの確認）", () => {
    const build = BENCH_BUILDS.find((b) => b.id === "rogue-dual-shadow");
    if (build === undefined) throw new Error("ビルドが無い");
    const r = runBossBench(db, build, {
      region: "REGION-A5-BOSS",
      invincible: false,
      seconds: 150,
    });
    expect(r.boss).toBe("ENM-ABYSS-MOTHER-TREE");
    expect(r.deaths).toBe(0);
    expect(r.killTime).toBeGreaterThanOrEqual(60);
    expect(r.killTime).toBeLessThanOrEqual(120);
  }, 60_000);
});

describe("力の配分の計測（仕様書v0.2 1.4・T15）", () => {
  const build = BENCH_BUILDS.find((b) => b.id === "rogue-bleed-myriad");
  if (build === undefined) throw new Error("ビルドが無い");

  it("ユニークのベースを、同じ分類・同じタグの下級の通常のベースにする", () => {
    const unique = db.itemBases.get("BASE-UNQ-U03");
    const plain = db.itemBases.get(plainBase(db, "BASE-UNQ-U03"));
    expect(unique?.unique).toBeDefined();
    expect(plain?.unique).toBeUndefined();
    expect(plain?.category).toBe(unique?.category);
    expect([...(plain?.tags ?? [])].sort()).toEqual([...(unique?.tags ?? [])].sort());
    expect(plain?.tier).toBe(1);
    // 通常のベースはそのまま
    expect(plainBase(db, plain?.id ?? "")).toBe(plain?.id);
  });

  it("装備・ツリー・ジョブを1つずつ外す", () => {
    const eq = withoutPart(db, build, "equipment").build;
    expect(eq.equipment.every((e) => e.affixes === undefined && e.enhance === undefined)).toBe(
      true,
    );
    expect(eq.equipment.some((e) => db.itemBases.get(e.base)?.unique !== undefined)).toBe(false);
    expect(eq.stars).toEqual(build.stars);
    expect(withoutPart(db, build, "tree").build.stars).toEqual([]);
    const job = withoutPart(db, build, "job");
    expect(job.build.jobNodes).toEqual([]);
    expect(job.build.skills?.filter((s) => s !== undefined)).toEqual(["SKL-BASIC-ATTACK"]);
    expect(job.options.noGauge).toBe(true);
  });

  it("ジョブを外すと、職能ゲージは溜まらず、DPSが下がる", () => {
    const opts = { region: "REGION-A5-BOSS", invincible: true, seconds: 20 } as const;
    const full = runBossBench(db, build, opts);
    const job = withoutPart(db, build, "job");
    const noJob = runBossBench(db, job.build, { ...opts, ...job.options });
    expect(Object.keys(noJob.uses)).toEqual(["SKL-BASIC-ATTACK"]);
    expect(noJob.dps).toBeLessThan(full.dps);
  });
});
