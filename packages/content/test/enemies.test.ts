import {
  alertEnemy,
  alertPack,
  checkEnemyDef,
  canSee,
  createEnemy,
  createRng,
  spawnPack,
  stepEnemies,
  stepEnemy,
  standardEnemyHp,
  type Enemy,
  type EnemyEvent,
  type Target,
} from "@stella/core";
import { describe, expect, it } from "vitest";
import { ENEMIES, enemyDef, loadContent } from "../src/index.ts";

const player = (x: number, y = 0, invulnerable = false): Target => ({
  pos: { x, y },
  radius: 0.4,
  invulnerable,
});
const run = (enemies: Enemy[], target: Target, seconds: number, seed = 1): EnemyEvent[] => {
  const rng = createRng(seed);
  const out: EnemyEvent[] = [];
  for (let i = 0; i < Math.round(seconds * 60); i++)
    out.push(...stepEnemies(enemies, target, 1 / 60, rng));
  return out;
};
const make = (id: string, x: number, facing = 0, level = 5) =>
  createEnemy({ def: enemyDef(id), level, pos: { x, y: 0 }, id: `T-${id}`, facing, packId: "P1" });

describe("第1章の敵のデータ", () => {
  it("6種類。定義の規則（大きい攻撃の予兆は0.6秒以上）を満たす", () => {
    expect(ENEMIES.filter((e) => e.boss === undefined)).toHaveLength(6);
    expect(ENEMIES.filter((e) => e.boss === "midBoss")).toHaveLength(1);
    expect(ENEMIES.flatMap(checkEnemyDef)).toEqual([]);
  });
  it("系統のタグが存在する", () => {
    const tags = new Set(loadContent().data.tags.map((t) => t.id));
    for (const e of ENEMIES) if (e.familyTag) expect(tags.has(e.familyTag)).toBe(true);
  });
  it("大きな攻撃に予兆が足りない定義は検出される", () => {
    const bad = {
      ...enemyDef("ENM-BARK-BEAR"),
      attacks: [
        { ...(enemyDef("ENM-BARK-BEAR").attacks[1] as never as object), telegraphSeconds: 0.3 },
      ],
    };
    expect(checkEnemyDef(bad as never)).toHaveLength(1);
  });
  it("HP：標準HP × 種類の倍率 × 格の倍率（精鋭は×6・体が1.25倍）", () => {
    expect(standardEnemyHp(1)).toBeCloseTo(30);
    expect(standardEnemyHp(15)).toBeCloseTo(70);
    const normal = createEnemy({
      def: enemyDef("ENM-FOREST-WOLF"),
      level: 15,
      pos: { x: 0, y: 0 },
      id: "a",
    });
    const elite = createEnemy({
      def: enemyDef("ENM-FOREST-WOLF"),
      level: 15,
      pos: { x: 0, y: 0 },
      id: "b",
      rank: "elite",
    });
    expect(normal.body.maxHp).toBeCloseTo(70 * 0.8);
    expect(elite.body.maxHp).toBeCloseTo(70 * 0.8 * 6);
    expect(elite.body.radius).toBeCloseTo(normal.body.radius * 1.25);
    expect(elite.attackPower).toBeCloseTo(normal.attackPower * 1.3);
  });
  it("防御：森狼の回避値はLv×3、牙猪の防具値はLv×4、樹皮熊は火耐性-20%", () => {
    expect(make("ENM-FOREST-WOLF", 0, 0, 10).body.evasion).toBe(30);
    expect(make("ENM-FANG-BOAR", 0, 0, 10).body.armor).toBe(40);
    expect(make("ENM-BARK-BEAR", 0, 0, 10).body.resistance.fire).toBe(-0.2);
  });
});

describe("行動の流れ", () => {
  it("待機：視界（前方180°・8m）に入ると追跡。背後・遠くでは気づかない", () => {
    const wolf = make("ENM-FOREST-WOLF", 0, 0);
    expect(canSee(wolf, player(6))).toBe(true);
    expect(canSee(wolf, player(9))).toBe(false);
    expect(canSee(wolf, player(-3))).toBe(false);
    run([wolf], player(-3), 1);
    expect(wolf.state).toBe("idle");
    run([wolf], player(6), 0.1);
    expect(wolf.state).not.toBe("idle");
  });
  it("攻撃を受けると気づく。同じ群れの仲間（10m以内）も気づく", () => {
    const a = make("ENM-FOREST-WOLF", 0, 0);
    const b = make("ENM-FOREST-WOLF", 4, 0);
    const far = make("ENM-FOREST-WOLF", 30, 0);
    const outsider = createEnemy({
      def: enemyDef("ENM-FOREST-WOLF"),
      level: 5,
      pos: { x: 2, y: 0 },
      id: "o",
      packId: "OTHER",
      facing: Math.PI,
    });
    alertPack([a, b, far, outsider], a);
    // 見えない位置のプレイヤー（背後）でも、気づいた仲間が呼ぶ
    run([a, b, far, outsider], player(-9), 0.05);
    expect(a.state).not.toBe("idle");
    expect(b.state).not.toBe("idle");
    expect(far.state).toBe("idle");
    expect(outsider.state).toBe("idle");
  });
  it("追跡→予兆→攻撃→硬直→追跡。予兆の間は向きを変えない", () => {
    const wolf = make("ENM-FOREST-WOLF", 0, 0);
    wolf.flankSide = 1;
    const states = new Set<string>();
    const rng = createRng(1);
    const t = player(1.2);
    alertEnemy(wolf);
    let facingAtWindup: number | undefined;
    for (let i = 0; i < 240; i++) {
      stepEnemy(wolf, t, 1 / 60, rng);
      states.add(wolf.state);
      if (wolf.state !== "windup") facingAtWindup = undefined;
      if (wolf.state === "windup") {
        facingAtWindup ??= wolf.body.facing;
        t.pos.y = 2; // 予兆の間にプレイヤーが動いても、向きは変わらない
        expect(wolf.body.facing).toBe(facingAtWindup);
      }
    }
    expect([...states]).toEqual(expect.arrayContaining(["chase", "windup", "attack", "recovery"]));
  });
  it("予兆のある攻撃は、回避（無敵）でかわせる。当たる位置にいれば当たる", () => {
    const hits = (invulnerable: boolean): number => {
      const bear = make("ENM-BARK-BEAR", 0, 0);
      alertEnemy(bear);
      return run([bear], player(1.5, 0, invulnerable), 3).filter((e) => e.type === "hit").length;
    };
    expect(hits(false)).toBeGreaterThan(0);
    expect(hits(true)).toBe(0);
  });
  it("攻撃の強さは標準HP × 割合（森狼の噛みつき8%）", () => {
    const wolf = make("ENM-FOREST-WOLF", 0, 0, 5);
    alertEnemy(wolf);
    const hit = run([wolf], player(1.2), 3).find((e) => e.type === "hit");
    expect(hit?.type === "hit" ? hit.damage : 0).toBeCloseTo(standardEnemyHp(5) * 0.08);
  });
  it("崩しゲージが満タンでダウン。行動が止まり、終わると追跡へ", () => {
    const bear = make("ENM-BARK-BEAR", 0, 0);
    alertEnemy(bear);
    bear.body.breakGauge.add(1e9);
    run([bear], player(10), 0.05);
    expect(bear.state).toBe("down");
    run([bear], player(10), 2.2);
    expect(bear.state).not.toBe("down");
  });
  it("出現地点から20m以上離れると帰還し、HPを全回復して待機へ", () => {
    const wolf = make("ENM-FOREST-WOLF", 0, 0);
    alertEnemy(wolf);
    wolf.body.hp = 1;
    const t = player(100);
    const rng = createRng(1);
    let returned = false;
    for (let i = 0; i < 60 * 30; i++) {
      for (const e of stepEnemy(wolf, t, 1 / 60, rng)) if (e.type === "returned") returned = true;
    }
    expect(returned).toBe(true);
    expect(wolf.state).toBe("idle");
    expect(wolf.body.hp).toBe(wolf.body.maxHp);
  });
});

describe("敵ごとの特徴", () => {
  it("牙猪：突進の間は曲がれない（向きが変わらず、まっすぐ進む）", () => {
    const boar = make("ENM-FANG-BOAR", 0, 0);
    alertEnemy(boar);
    const rng = createRng(2);
    const t = player(6);
    let startY: number | undefined;
    let facing: number | undefined;
    for (let i = 0; i < 600; i++) {
      stepEnemy(boar, t, 1 / 60, rng);
      if (boar.state !== "attack") facing = undefined;
      if (boar.state === "attack" && boar.attack?.id === "charge") {
        startY ??= boar.body.pos.y;
        facing ??= boar.body.facing;
        t.pos.y = 5; // 避けても曲がらない
        expect(boar.body.facing).toBe(facing);
      }
    }
    expect(startY).toBeDefined();
  });
  it("牙猪の旋回は遅く、棘鼠は速い", () => {
    expect(enemyDef("ENM-FANG-BOAR").turnDegreesPerSecond).toBe(180);
    expect(enemyDef("ENM-THORN-RAT").turnDegreesPerSecond).toBe(540);
  });
  it("棘吐き蜥蜴：6〜8mの距離を保ち、投射物を撃つ", () => {
    const lizard = make("ENM-SPIT-LIZARD", 0, 0);
    alertEnemy(lizard);
    const t = player(3);
    const events = run([lizard], t, 4);
    const d = Math.hypot(lizard.body.pos.x - t.pos.x, lizard.body.pos.y - t.pos.y);
    expect(d).toBeGreaterThan(5.5);
    expect(events.some((e) => e.type === "projectile")).toBe(true);
  });
  it("森狼：プレイヤーの横や背後へ回り込む", () => {
    const wolf = make("ENM-FOREST-WOLF", 10, Math.PI);
    wolf.flankSide = 1;
    alertEnemy(wolf);
    const t = player(0);
    run([wolf], t, 0.6);
    expect(Math.abs(wolf.body.pos.y)).toBeGreaterThan(0.5);
  });
  it("腐根の苗：動かず、向きを持たない（背面判定が起きない）。胞子の雲を出す", () => {
    const sprout = make("ENM-ROT-SPROUT", 0, 0);
    expect(sprout.body.noFacing).toBe(true);
    const events = run([sprout], player(4), 3);
    expect(sprout.body.pos).toEqual({ x: 0, y: 0 });
    expect(events.some((e) => e.type === "cloud")).toBe(true);
  });
  it("群れの人数：森狼3〜5、棘鼠4〜8", () => {
    const rng = createRng(5);
    for (let i = 0; i < 20; i++) {
      const w = spawnPack({
        def: enemyDef("ENM-FOREST-WOLF"),
        level: 3,
        center: { x: 0, y: 0 },
        rng,
        packId: `W${String(i)}`,
      });
      expect(w.length).toBeGreaterThanOrEqual(3);
      expect(w.length).toBeLessThanOrEqual(5);
      const r = spawnPack({
        def: enemyDef("ENM-THORN-RAT"),
        level: 3,
        center: { x: 0, y: 0 },
        rng,
        packId: `R${String(i)}`,
      });
      expect(r.length).toBeGreaterThanOrEqual(4);
      expect(r.length).toBeLessThanOrEqual(8);
    }
  });
});
