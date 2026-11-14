/**
 * EnemyField と味方の戦う者（召喚物。召喚士）：召喚物がいないときは今までと完全に同じこと（互換）と、
 * 敵の投射物・同じ group の当たり判定が召喚物に当たること。
 */
import { describe, expect, it } from "vitest";
import { Combatant, FIXED_STEP_SECONDS, Rng, staggerProfiles } from "@stella/core";
import { loadGameContent } from "@stella/content";
import { EnemyField } from "../src/world/EnemyField.ts";

const db = loadGameContent();
const STEP = FIXED_STEP_SECONDS;
const bounds = { minX: 0.5, minY: 0.5, maxX: 79.5, maxY: 39.5 };

function body(id: string, at: { x: number; y: number }, maxHp = 1e6): Combatant {
  return new Combatant(db, {
    id,
    team: "player",
    position: at,
    radius: 0.35,
    maxHp,
    staggerProfile: staggerProfiles(db).player,
  });
}

describe("召喚物がいないときは、今までと完全に同じ（互換）", () => {
  it("allies を省略した場と [] を渡した場は、同じシードで N 刻み進めても debug()・プレイヤーHP・乱数の次の値が一致する", () => {
    const run = (withEmpty: boolean) => {
      const rng = Rng.fromSeed("compat");
      // 開発用の試験用の場の群れ（狼・鼠・蜥蜴・猪・熊・苗）。プレイヤーは群れの近くを行き来する
      const field = new EnemyField(db, rng, bounds);
      const p = body("player", { x: 50, y: 20 });
      const log: string[] = [];
      const hooks = {
        onPlayerHit: (r: { applied: { toHp: number } }, _e: unknown, a: { id: string }) => {
          log.push(`${a.id}:${r.applied.toHp.toFixed(6)}`);
        },
        onAvoided: () => undefined,
        onEnemyKilled: () => undefined,
      };
      for (let i = 0; i < 1800; i++) {
        p.position = { x: 50 + 15 * Math.sin(i / 120), y: 20 + 10 * Math.cos(i / 90) };
        if (withEmpty) field.update(STEP, p, i % 97 < 18, 0, hooks, []);
        else field.update(STEP, p, i % 97 < 18, 0, hooks);
        p.update(STEP);
      }
      return {
        debug: JSON.stringify(field.debug()),
        hp: p.health.hp,
        next: rng.next(),
        log: log.join(","),
        kills: field.kills,
      };
    };
    const omitted = run(false);
    const empty = run(true);
    expect(omitted.log.length).toBeGreaterThan(0); // 実際に攻撃を受けている
    expect(empty).toEqual(omitted);
  });
});

describe("敵の攻撃が召喚物に当たる", () => {
  const hooks = (onAlly: () => void) => ({
    onPlayerHit: () => undefined,
    onAvoided: () => undefined,
    onEnemyKilled: () => undefined,
    onAllyHit: () => {
      onAlly();
    },
  });

  it("棘吐き蜥蜴の投射物（棘）は、プレイヤーより近い召喚物に当たる", () => {
    const field = new EnemyField(
      db,
      Rng.fromSeed("spit"),
      bounds,
      [{ id: "l", enemy: "ENM-SPINE-LIZARD", level: 3, count: 1, at: { x: 20, y: 20 } }],
      false,
    );
    const p = body("player", { x: 60, y: 20 });
    const ally = body("minion-1", { x: 14, y: 20 }); // 敵は左を向いて出る（視界は前方）
    let allyHits = 0;
    let projectiles = 0;
    for (let i = 0; i < 900 && allyHits === 0; i++) {
      field.update(
        STEP,
        p,
        false,
        0,
        hooks(() => (allyHits += 1)),
        [ally],
      );
      projectiles = Math.max(projectiles, field.projectiles.active);
    }
    expect(projectiles).toBeGreaterThan(0);
    expect(allyHits).toBeGreaterThan(0);
    expect(ally.health.hp).toBeLessThan(ally.health.maxHp);
    expect(p.health.hp).toBe(p.health.maxHp);
  });

  it("突進（同じ group の当たり判定）は、通り道の召喚物それぞれに1回ずつ当たる", () => {
    const field = new EnemyField(
      db,
      Rng.fromSeed("charge"),
      bounds,
      [
        {
          id: "b",
          enemy: "ENM-TUSK-BOAR",
          level: 4,
          count: 1,
          at: { x: 20, y: 20 },
          ranks: ["elite"],
        },
      ],
      false,
    );
    const p = body("player", { x: 70, y: 20 });
    const a1 = body("minion-1", { x: 15, y: 20 }); // 敵は左を向いて出る（視界は前方）
    const a2 = body("minion-2", { x: 14, y: 20 });
    const boar = field.enemies[0];
    if (boar === undefined) throw new Error("猪がいない");
    // 召喚物は動かないので、猪の突進の通り道に2体が並ぶ。最初の突進の間のヒットを数える
    const hits = new Map<string, number>();
    let charging = false;
    let done = false;
    for (let i = 0; i < 1200 && !done; i++) {
      field.update(
        STEP,
        p,
        false,
        0,
        {
          onPlayerHit: () => undefined,
          onAvoided: () => undefined,
          onEnemyKilled: () => undefined,
          onAllyHit: (_r, enemy, ally) => {
            if (enemy.currentAttack?.id === "charge")
              hits.set(ally.id, (hits.get(ally.id) ?? 0) + 1);
          },
        },
        [a1, a2],
      );
      const now = boar.currentAttack?.id === "charge" && boar.state === "active";
      if (charging && !now && hits.size > 0) done = true;
      charging = now;
    }
    expect(hits.get("minion-1")).toBe(1);
    expect(hits.get("minion-2")).toBe(1);
  });
});
