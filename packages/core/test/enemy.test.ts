import { describe, expect, it } from "vitest";
import {
  cloudCenters,
  Combatant,
  type ContentDb,
  Enemy,
  EnemyAttackers,
  type EnemyEvent,
  type EnemyTarget,
  FIXED_STEP_SECONDS,
  Rng,
  angleDiff,
  enemyAttackDamage,
  enemyMaxHp,
  normalEnemyHp,
  resolveHit,
  separate,
  standardHp,
  staggerProfiles,
  turnTowards,
} from "../src/index.ts";
import { fullCombatDb, tag } from "./helpers/content.ts";

const dt = FIXED_STEP_SECONDS;
const sector = (radius: number, angleDeg: number) => ({ type: "sector", radius, angleDeg });
const attack = (id: string, extra: Record<string, unknown>) => ({
  id,
  text: `a.${id}`,
  windup: 0.5,
  active: 0.15,
  recovery: 0.6,
  ratio: 0.1,
  staggerCoefficient: 0.2,
  element: "physical",
  range: 1,
  cooldown: 1,
  delivery: { type: "strike", shape: sector(1.2, 90) },
  ...extra,
});
const enemy = (id: string, extra: Record<string, unknown>) => ({
  id,
  text: `e.${id.toLowerCase()}`,
  family: "TAG-FAMILY-BEAST",
  hpMultiplier: 1,
  moveSpeed: 5,
  turnRate: 360,
  radius: 0.4,
  defense: {},
  attacks: [attack("bite", {})],
  behavior: { type: "chase" },
  pack: { min: 1, max: 1 },
  ...extra,
});
const ENEMIES = [
  enemy("ENM-CHASER", {}),
  enemy("ENM-FLANKER", { behavior: { type: "flank", distance: 1 } }),
  enemy("ENM-KITER", {
    attacks: [
      attack("spit", {
        range: 9,
        cooldown: 100,
        delivery: { type: "projectile", speed: 8, range: 10, radius: 0.15 },
      }),
    ],
    behavior: { type: "kite", min: 6, max: 8 },
  }),
  enemy("ENM-CHARGER", {
    turnRate: 180,
    attacks: [
      attack("charge", {
        windup: 0.8,
        ratio: 0.18,
        range: 8,
        minRange: 3,
        delivery: { type: "dash", distance: 8, speed: 12, width: 1.2 },
      }),
    ],
  }),
  enemy("ENM-SPORE", {
    turnRate: null,
    moveSpeed: 0,
    attacks: [
      attack("spores", {
        windup: 0.8,
        ratio: 0,
        range: 7,
        delivery: {
          type: "cloud",
          radius: 2.5,
          duration: 5,
          interval: 1,
          ailment: "TAG-AIL-POISON",
          baseRatio: 0.03,
        },
      }),
    ],
    behavior: { type: "stationary" },
  }),
];
const RANKS = [
  {
    id: "RANK-NORMAL",
    rank: "normal",
    text: "r.n",
    hpMultiplier: 1,
    damageMultiplier: 1,
    xpMultiplier: 1,
    scale: 1,
  },
  {
    id: "RANK-ELITE",
    rank: "elite",
    text: "r.e",
    hpMultiplier: 6,
    damageMultiplier: 1.3,
    xpMultiplier: 10,
    scale: 1.25,
  },
];

function enemyDb(enemies: unknown[] = ENEMIES, ranks: unknown[] = RANKS): ContentDb {
  return fullCombatDb([], {
    tags: [tag("TAG-FAMILY-BEAST", "enemyFamily")],
    enemies,
    enemyRanks: ranks,
  });
}

function errorCodes(enemies: unknown[]): string[] {
  try {
    enemyDb(enemies);
    return [];
  } catch (e) {
    return [...String(e).matchAll(/\[([a-z-]+)\]/g)].map((m) => m[1] ?? "");
  }
}

const db = enemyDb();
const def = (id: string) => {
  const d = db.enemies.get(id);
  if (d === undefined) throw new Error(id);
  return d;
};
const rank = (r: "normal" | "elite") => {
  const d = db.enemyRanks.get(r);
  if (d === undefined) throw new Error(r);
  return d;
};
const make = (id: string, at = { x: 0, y: 0 }, facing = 0, level = 1, packIndex = 0) =>
  new Enemy(db, {
    id: `${id}-1`,
    def: def(id),
    rank: rank("normal"),
    level,
    position: at,
    packId: "p",
    packIndex,
    facing,
  });
const target = (x: number, y: number, facing = Math.PI): EnemyTarget => ({
  position: { x, y },
  radius: 0.35,
  facing,
  targetable: true,
});
function run(
  e: Enemy,
  seconds: number,
  t: EnemyTarget | (() => EnemyTarget),
  rng = Rng.fromSeed(1),
) {
  const events: EnemyEvent[] = [];
  const states: string[] = [];
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    events.push(...e.update(dt, typeof t === "function" ? t() : t, rng));
    if (states[states.length - 1] !== e.state) states.push(e.state);
  }
  return { events, states };
}

describe("敵のデータの検証", () => {
  it("正しいデータは読める", () => {
    expect(db.enemies.size).toBe(5);
    expect(db.enemyRanks.get("elite")?.scale).toBe(1.25);
  });

  it("標準HPの25%を超える攻撃に、0.6秒未満の予兆は誤り（補助仕様書10.1）", () => {
    expect(
      errorCodes([enemy("ENM-X", { attacks: [attack("bite", { ratio: 0.3, windup: 0.5 })] })]),
    ).toEqual(["telegraph"]);
    expect(
      errorCodes([enemy("ENM-X", { attacks: [attack("bite", { ratio: 0.3, windup: 0.6 })] })]),
    ).toEqual([]);
  });

  it("系統は敵の系統のタグ、攻撃のIDは重複しない、群れの数は最小≦最大", () => {
    expect(errorCodes([enemy("ENM-X", { family: "TAG-FORM-MELEE" })])).toEqual(["schema"]);
    expect(
      errorCodes([enemy("ENM-X", { attacks: [attack("bite", {}), attack("bite", {})] })]),
    ).toEqual(["duplicate-id"]);
    expect(errorCodes([enemy("ENM-X", { pack: { min: 3, max: 2 } })])).toEqual(["schema"]);
  });
});

describe("敵の強さ（補助仕様書10.1・10.3）", () => {
  it("HP＝通常の敵のHP×種類×格、攻撃＝標準HP×割合×格", () => {
    expect(enemyMaxHp(def("ENM-CHASER"), rank("elite"), 5)).toBeCloseTo(normalEnemyHp(5) * 6);
    const bite = def("ENM-CHASER").attacks[0];
    if (bite === undefined) throw new Error("bite");
    expect(enemyAttackDamage(bite, rank("elite"), 10)).toBeCloseTo(standardHp(10) * 0.1 * 1.3);
    const elite = new Enemy(db, {
      id: "e",
      def: def("ENM-CHASER"),
      rank: rank("elite"),
      level: 1,
      position: { x: 0, y: 0 },
      packId: "p",
      packIndex: 0,
    });
    expect(elite.combatant.radius).toBeCloseTo(0.5);
  });

  it("敵の攻撃は、防御・耐性・回避の計算を通る（防御なしなら、標準HP×割合）", () => {
    const e = make("ENM-CHASER");
    const bite = e.def.attacks[0];
    if (bite === undefined) throw new Error("bite");
    const player = new Combatant(db, {
      id: "player",
      team: "player",
      position: { x: 1, y: 0 },
      radius: 0.35,
      maxHp: 60,
      staggerProfile: staggerProfiles(db).player,
    });
    const r = resolveHit({
      db,
      attacker: new EnemyAttackers(db).attacker(e, bite),
      attackerPosition: e.position,
      skill: { tags: [], kind: "weapon", pct: 1 },
      staggerCoefficient: bite.staggerCoefficient,
      target: player,
      rng: Rng.fromSeed(3),
      roll: "average",
    });
    expect(r.hit.total).toBeCloseTo(standardHp(1) * 0.1);
    expect(r.hit.crit).toBe(false);
    expect(player.health.hp).toBeCloseTo(54);
  });
});

describe("行動の流れ（補助仕様書10.2）", () => {
  it("視界は前方180°・8m。後ろや遠くの相手には気づかない。向きを持たない敵は周り全て", () => {
    const e = make("ENM-CHASER", { x: 0, y: 0 }, 0);
    expect(e.canSee(target(7, 0))).toBe(true);
    expect(e.canSee(target(9, 0))).toBe(false);
    expect(e.canSee(target(-3, 0))).toBe(false);
    expect(e.canSee(target(0, 5))).toBe(true); // 真横（90°）
    expect(make("ENM-SPORE").canSee(target(-3, 0))).toBe(true);
    expect(run(e, 0.1, target(-3, 0)).states).toEqual(["idle"]);
    expect(run(e, 0.1, target(5, 0)).events).toContainEqual({ type: "noticed" });
    expect(e.state).toBe("chase");
  });

  it("攻撃を受けると気づく", () => {
    const e = make("ENM-CHASER", { x: 0, y: 0 }, 0);
    expect(e.notice()).toBe(true);
    expect(e.state).toBe("chase");
    expect(e.notice()).toBe(false);
  });

  it("近づいて、予兆 → 攻撃（当たり判定は1回）→ 硬直 → 追跡。予兆の間は向きを変えない", () => {
    const e = make("ENM-CHASER", { x: 0, y: 0 }, 0);
    e.notice();
    let tx = 3;
    const r = run(e, 0.6, () => target(tx, 0));
    expect(e.state).toBe("windup");
    expect(r.states).toEqual(["chase", "windup"]);
    // 予兆の間に相手が横へ動いても、向きは変わらない
    tx = 0;
    const f = e.facing;
    const r2 = run(e, 0.45, () => target(e.position.x, 3));
    expect(e.facing).toBe(f);
    expect(r2.events.filter((x) => x.type === "strike")).toHaveLength(1);
    const r3 = run(e, 1, () => target(e.position.x, 3));
    expect(r3.states).toContain("chase");
  });

  it("出現地点から20m離れると帰り、帰ったらHPを全回復して待機に戻る", () => {
    const e = make("ENM-CHASER", { x: 0, y: 0 }, 0);
    e.combatant.health.takeDamage(10);
    e.notice();
    const far = () => target(e.position.x + 5, 0);
    const r = run(e, 6, far);
    expect(r.states).toContain("return");
    const back = run(e, 6, target(100, 100));
    expect(back.events).toContainEqual({ type: "returned" });
    expect(e.state).toBe("idle");
    expect(e.combatant.health.hp).toBe(e.combatant.health.maxHp);
  });

  it("崩しゲージが満タンになるとダウンし、攻撃は取り消す", () => {
    const e = make("ENM-CHASER", { x: 0, y: 0 }, 0);
    e.notice();
    run(e, 0.3, target(1.2, 0));
    expect(e.state).toBe("windup");
    e.combatant.stagger.breakNow();
    run(e, 0.1, target(1.2, 0));
    expect(e.state).toBe("down");
    expect(e.currentAttack).toBeUndefined();
    run(e, 3, target(1.2, 0));
    expect(e.state).not.toBe("down");
  });

  it("距離を保つ敵は6〜8mに留まり、間合いに入ると投射物を撃つ", () => {
    const e = make("ENM-KITER", { x: 0, y: 0 }, 0);
    e.notice();
    const r = run(e, 3, target(3, 0));
    const d = 3 - e.position.x;
    expect(d - 0.35).toBeGreaterThanOrEqual(5.9);
    expect(r.events.some((x) => x.type === "projectile")).toBe(true);
  });

  it("回り込む敵は、相手の背後へ回る", () => {
    // 相手は左（-x）を向いている → 背後は右側
    const e = make("ENM-FLANKER", { x: -4, y: 0.1 }, 0);
    e.notice();
    run(e, 2, target(0, 0, Math.PI));
    expect(e.position.x).toBeGreaterThan(0);
  });

  it("突進：8mをまっすぐ進み、通り道の当たり判定は同じ group", () => {
    const e = make("ENM-CHARGER", { x: 0, y: 0 }, 0);
    e.notice();
    const r = run(e, 2, target(5, 0));
    const strikes = r.events.filter((x) => x.type === "strike");
    expect(strikes.length).toBeGreaterThan(5);
    expect(strikes.every((s) => s.group === "dash")).toBe(true);
    expect(e.position.x).toBeGreaterThan(7.9);
    expect(Math.abs(e.position.y)).toBeLessThan(1e-9);
  });

  it("胞子：予兆の始めの相手の位置に、毒の雲（基準値は標準HPの3%）", () => {
    const e = make("ENM-SPORE", { x: 0, y: 0 }, 0, 4);
    const r = run(e, 1, target(4, 1));
    const cloud = r.events.find((x) => x.type === "cloud");
    expect(cloud?.type === "cloud" && cloud.center).toEqual({ x: 4, y: 1 });
    expect(cloud?.type === "cloud" && cloud.application.total).toBeCloseTo(
      standardHp(4) * 0.03 * 0.6,
    );
    expect(e.position).toEqual({ x: 0, y: 0 });
    expect(e.combatant.facing).toBeUndefined();
  });

  it("旋回の速さ：毎秒180°なら、真後ろを向くのに1秒", () => {
    expect(turnTowards(0, Math.PI / 2, 0.1)).toBeCloseTo(0.1);
    expect(turnTowards(0, -0.05, 0.1)).toBeCloseTo(-0.05);
    expect(angleDiff(3, -3)).toBeCloseTo(2 * Math.PI - 6);
    const e = make("ENM-CHARGER", { x: 0, y: 0 }, 0);
    e.notice();
    run(e, 0.5, target(-20, 0.001));
    expect(Math.abs(angleDiff(e.facing, Math.PI))).toBeCloseTo(Math.PI / 2, 1);
  });

  it("重なった体を押し離す（動かない敵は動かない）", () => {
    const a = make("ENM-CHASER", { x: 0, y: 0 });
    const b = make("ENM-CHASER", { x: 0.2, y: 0 });
    const s = make("ENM-SPORE", { x: 0.3, y: 0 });
    separate([a, b, s]);
    expect(s.position).toEqual({ x: 0.3, y: 0 });
    expect(b.position.x - a.position.x).toBeGreaterThan(0.2);
  });
});

describe("雲の置き方（cloudCenters。docs/progress D-U21-3）", () => {
  it("1つ目は相手の位置、残りは出した敵と反対側へ離して ±fanDeg に並べる", () => {
    const [a, b, c] = cloudCenters(
      { count: 3, spread: 2, fanDeg: 90 },
      { x: 0, y: 0 },
      { x: -5, y: 0 },
    );
    expect(a).toEqual({ x: 0, y: 0 });
    // 反対側（+x）の向きから ±90°：真上と真下
    expect(b?.x).toBeCloseTo(0);
    expect(b?.y).toBeCloseTo(-2);
    expect(c?.x).toBeCloseTo(0);
    expect(c?.y).toBeCloseTo(2);
  });

  it("2つなら反対側の真後ろ、1つなら相手の位置だけ", () => {
    const two = cloudCenters({ count: 2, spread: 3 }, { x: 1, y: 1 }, { x: 1, y: -4 });
    expect(two[1]?.x).toBeCloseTo(1);
    expect(two[1]?.y).toBeCloseTo(4);
    expect(cloudCenters({}, { x: 2, y: 3 }, { x: 0, y: 0 })).toEqual([{ x: 2, y: 3 }]);
  });
});
