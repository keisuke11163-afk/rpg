import { describe, expect, it } from "vitest";
import { Combatant, FIXED_STEP_SECONDS, Rng, staggerProfiles } from "@stella/core";
import { loadGameContent } from "@stella/content";
import { EnemyField } from "../src/world/EnemyField.ts";

const db = loadGameContent();
const STEP = FIXED_STEP_SECONDS;
const bounds = { minX: 0, minY: 0, maxX: 60, maxY: 40 };

function player(at: { x: number; y: number }): Combatant {
  return new Combatant(db, {
    id: "player",
    team: "player",
    position: at,
    radius: 0.35,
    maxHp: 1e9,
    staggerProfile: staggerProfiles(db).player,
  });
}

describe("中ボス：群れ長の大牙（補助仕様書10.5）", () => {
  it("遠吠えで森狼を2体呼び、周りの森狼の攻撃速度が上がる", () => {
    const field = new EnemyField(
      db,
      Rng.fromSeed("leader"),
      bounds,
      [{ id: "boss", enemy: "ENM-PACK-LEADER", level: 11, count: 1, at: { x: 20, y: 20 } }],
      false,
    );
    const p = player({ x: 28, y: 20 });
    const hooks = {
      onPlayerHit: () => undefined,
      onAvoided: () => undefined,
      onEnemyKilled: () => undefined,
    };
    let summoned = false;
    for (let i = 0; i < 600 && !summoned; i++) {
      field.update(STEP, p, false, 0, hooks);
      summoned = field.entries.some((v) => v.enemy.def.id === "ENM-FOREST-WOLF");
    }
    expect(summoned).toBe(true);
    const wolves = field.entries.filter((v) => v.enemy.def.id === "ENM-FOREST-WOLF");
    expect(wolves).toHaveLength(2);
    expect(wolves.every((w) => w.enemy.haste === 0.2 && w.enemy.level === 11)).toBe(true);
  });

  it("噛みつき3連は、1回の攻撃で3回当たる", () => {
    const field = new EnemyField(
      db,
      Rng.fromSeed("bite"),
      bounds,
      [{ id: "boss", enemy: "ENM-PACK-LEADER", level: 11, count: 1, at: { x: 20, y: 20 } }],
      false,
    );
    const p = player({ x: 21.6, y: 20 });
    const hits: string[] = [];
    const times: number[] = [];
    let t = 0;
    const hooks = {
      onPlayerHit: (_r: unknown, _e: unknown, a: { id: string }) => {
        hits.push(a.id);
        if (a.id === "bite3") times.push(t);
      },
      onAvoided: () => undefined,
      onEnemyKilled: () => undefined,
    };
    for (let i = 0; i < 600 && times.length < 3; i++) {
      field.update(STEP, p, false, Math.PI, hooks);
      t += STEP;
    }
    expect(times).toHaveLength(3);
    // 1回の攻撃の中（当たり判定の出ている0.6秒以内）で3回
    expect((times[2] ?? 99) - (times[0] ?? 0)).toBeLessThanOrEqual(0.6 + 1e-9);
  });

  it("中ボスのドロップの出どころは miniBoss", () => {
    expect(db.enemies.get("ENM-PACK-LEADER")?.dropSource).toBe("miniBoss");
  });
});
