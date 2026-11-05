/** 第1章の敵のデータが、補助仕様書10.3・10.4の表のとおりかを確かめる。 */
import type { EnemyAttackDef } from "@stella/core";
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../src/index.ts";

const db = loadGameContent();
const enemy = (id: string) => {
  const e = db.enemies.get(id);
  if (e === undefined) throw new Error(`${id} がない`);
  return e;
};
const atk = (a: EnemyAttackDef) => [a.windup, a.ratio, a.staggerCoefficient];

describe("第1章の敵（補助仕様書10.4）", () => {
  it("HPの倍率・速さ・旋回", () => {
    const rows = [
      ["ENM-FOREST-WOLF", 0.8, 6.0, 360],
      ["ENM-THORN-RAT", 0.4, 6.5, 540],
      ["ENM-SPINE-LIZARD", 0.7, 4.0, 270],
      ["ENM-TUSK-BOAR", 1.3, 4.5, 180],
      ["ENM-BARK-BEAR", 2.5, 3.5, 120],
      ["ENM-ROT-SAPLING", 0.6, 0, null],
    ] as const;
    for (const [id, hp, speed, turn] of rows) {
      const e = enemy(id);
      expect([e.hpMultiplier, e.moveSpeed, e.turnRate]).toEqual([hp, speed, turn]);
    }
  });

  it("攻撃（予兆の秒数・標準HPに対する割合・崩し係数）と付与率", () => {
    const attacks = (id: string) => enemy(id).attacks;
    expect(attacks("ENM-FOREST-WOLF").map(atk)).toEqual([[0.35, 0.08, 0.2]]);
    expect(attacks("ENM-THORN-RAT").map(atk)).toEqual([[0.3, 0.05, 0.1]]);
    expect(attacks("ENM-THORN-RAT")[0]?.ailmentChance).toEqual({ "TAG-AIL-POISON": 0.3 });
    expect(attacks("ENM-SPINE-LIZARD").map(atk)).toEqual([[0.5, 0.1, 0.1]]);
    expect(attacks("ENM-SPINE-LIZARD")[0]?.ailmentChance).toEqual({ "TAG-AIL-POISON": 0.5 });
    expect(attacks("ENM-SPINE-LIZARD")[0]?.delivery).toMatchObject({
      type: "projectile",
      speed: 8,
    });
    expect(attacks("ENM-TUSK-BOAR").map(atk)).toEqual([
      [0.8, 0.18, 1.0],
      [0.4, 0.1, 0.3],
    ]);
    expect(attacks("ENM-TUSK-BOAR")[0]?.delivery).toMatchObject({ distance: 8, speed: 12 });
    expect(attacks("ENM-BARK-BEAR").map(atk)).toEqual([
      [0.5, 0.12, 0.4],
      [1.0, 0.3, 1.5],
    ]);
    expect(attacks("ENM-BARK-BEAR")[1]?.delivery).toMatchObject({ shape: { radius: 3 } });
    expect(attacks("ENM-ROT-SAPLING")[0]).toMatchObject({
      windup: 0.8,
      delivery: { type: "cloud", radius: 2.5, duration: 5, interval: 1, baseRatio: 0.03 },
    });
  });

  it("動き方・群れ・防御", () => {
    expect(enemy("ENM-FOREST-WOLF").behavior.type).toBe("flank");
    expect(enemy("ENM-FOREST-WOLF").pack).toEqual({ min: 3, max: 5 });
    expect(enemy("ENM-FOREST-WOLF").defense).toEqual({ evasionPerLevel: 3 });
    expect(enemy("ENM-THORN-RAT").pack).toEqual({ min: 4, max: 8 });
    expect(enemy("ENM-SPINE-LIZARD").behavior).toEqual({ type: "kite", min: 6, max: 8 });
    expect(enemy("ENM-TUSK-BOAR").defense).toEqual({ armorPerLevel: 4 });
    expect(enemy("ENM-BARK-BEAR").defense).toEqual({ armorPerLevel: 8, resist: { fire: -0.2 } });
    expect(enemy("ENM-BARK-BEAR").pack).toEqual({ min: 1, max: 1 });
    expect(enemy("ENM-ROT-SAPLING").behavior.type).toBe("stationary");
    expect(enemy("ENM-ROT-SAPLING").defense).toEqual({ resist: { fire: -0.3 } });
    expect(enemy("ENM-ROT-SAPLING").family).toBeUndefined();
  });

  it("格（補助仕様書10.3）", () => {
    const r = (k: "normal" | "magic" | "elite") => {
      const d = db.enemyRanks.get(k);
      return [d?.hpMultiplier, d?.damageMultiplier, d?.xpMultiplier, d?.scale];
    };
    expect(r("normal")).toEqual([1, 1, 1, 1]);
    expect(r("magic")).toEqual([2.5, 1.15, 3, 1]);
    expect(r("elite")).toEqual([6, 1.3, 10, 1.25]);
  });
});
