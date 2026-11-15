import {
  QuestLog,
  TOWN_ID,
  World,
  createEnemy,
  createFighter,
  createRng,
  generateRegion,
  performSummon,
  rollDrops,
  standardEnemyHp,
  starPointTotal,
  stepEnemy,
  WARRIOR_JOB,
  type Enemy,
  type EnemyEvent,
  type Target,
} from "@stella/core";
import { describe, expect, it } from "vitest";
import { ALL_MAPS, GENERATION_DATA, QUESTS, enemyDef, mapDef } from "../src/index.ts";

const boss = (x = 0): Enemy =>
  createEnemy({
    def: enemyDef("ENM-PACK-LEADER"),
    level: 11,
    pos: { x, y: 0 },
    id: "BOSS",
    facing: 0,
  });
const player = (x: number, invulnerable = false): Target => ({
  pos: { x, y: 0 },
  radius: 0.4,
  invulnerable,
});
const run = (e: Enemy, t: Target, seconds: number, seed = 1): EnemyEvent[] => {
  const rng = createRng(seed);
  const out: EnemyEvent[] = [];
  for (let i = 0; i < Math.round(seconds * 60); i++) out.push(...stepEnemy(e, t, 1 / 60, rng));
  return out;
};

describe("中ボス「群れ長の大牙」（補助仕様書 10.5）", () => {
  const def = enemyDef("ENM-PACK-LEADER");
  it("HPは通常の敵の18倍（精鋭の3倍）。旋回は毎秒240°。Lv11", () => {
    const e = boss();
    expect(e.body.maxHp).toBeCloseTo(standardEnemyHp(11) * 18);
    const elite = createEnemy({
      def: enemyDef("ENM-FOREST-WOLF"),
      level: 11,
      pos: { x: 0, y: 0 },
      id: "x",
      rank: "elite",
    });
    expect(def.hpMultiplier).toBe(18);
    expect(def.turnDegreesPerSecond).toBe(240);
    expect(def.boss).toBe("midBoss");
    expect(elite.body.maxHp).toBeLessThan(e.body.maxHp);
  });
  it("攻撃：噛みつき3連（予兆0.4秒・各10%）・飛びかかり（予兆0.7秒・6m・22%・崩し1.0）・遠吠え（15秒ごと）", () => {
    const [bite, leap, howl] = def.attacks;
    expect(bite).toMatchObject({ telegraphSeconds: 0.4, damageRatio: 0.1, hitCount: 3 });
    expect(leap).toMatchObject({
      telegraphSeconds: 0.7,
      damageRatio: 0.22,
      breakCoefficient: 1.0,
      range: 6,
    });
    expect(howl).toMatchObject({ cooldownSeconds: 15 });
    expect(howl?.summon).toMatchObject({
      enemyId: "ENM-FOREST-WOLF",
      count: 2,
      attackSpeedBonus: 0.2,
      buffSeconds: 8,
    });
  });
  it("噛みつき3連は、1回の攻撃で3回当たる。回避（無敵）でかわせる", () => {
    const hits = (invulnerable: boolean): number => {
      const e = boss(0);
      e.cooldowns.set("leap", 99);
      e.cooldowns.set("howl", 99);
      e.state = "chase";
      return run(e, player(1.5, invulnerable), 1.4).filter(
        (x) => x.type === "hit" && x.attack.id === "bite3",
      ).length;
    };
    expect(hits(false)).toBeGreaterThanOrEqual(3);
    expect(hits(false) % 3).toBe(0);
    expect(hits(true)).toBe(0);
  });
  it("飛びかかり：予兆の後に突進して当たる。突進の間は曲がれない", () => {
    const e = boss(0);
    e.cooldowns.set("bite3", 99);
    e.cooldowns.set("howl", 99);
    e.state = "chase";
    const events = run(e, player(5), 2);
    expect(events.some((x) => x.type === "windup" && x.attack.id === "leap")).toBe(true);
    expect(events.some((x) => x.type === "hit" && x.attack.id === "leap")).toBe(true);
  });
  it("遠吠え：森狼を2体呼び、周囲の狼の攻撃速度を8秒間+20%にする。15秒ごと", () => {
    const e = boss(0);
    e.cooldowns.set("bite3", 99);
    e.cooldowns.set("leap", 99);
    e.state = "chase";
    const events = run(e, player(8), 3);
    const summon = events.find((x) => x.type === "summon");
    expect(summon).toBeDefined();
    if (summon?.type !== "summon") return;
    const nearbyWolf = createEnemy({
      def: enemyDef("ENM-FOREST-WOLF"),
      level: 10,
      pos: { x: 3, y: 0 },
      id: "w",
      facing: 0,
    });
    const farWolf = createEnemy({
      def: enemyDef("ENM-FOREST-WOLF"),
      level: 10,
      pos: { x: 40, y: 0 },
      id: "w2",
      facing: 0,
    });
    const called = performSummon(e, summon.attack, enemyDef, createRng(1), [nearbyWolf, farWolf]);
    expect(called).toHaveLength(2);
    expect(
      called.every(
        (c) => c.def.id === "ENM-FOREST-WOLF" && c.buff.bonus === 0.2 && c.buff.left === 8,
      ),
    ).toBe(true);
    expect(nearbyWolf.buff).toEqual({ bonus: 0.2, left: 8 });
    expect(farWolf.buff.left).toBe(0);
    // 15秒のクールダウン
    expect(e.cooldowns.get("howl")).toBeGreaterThan(12);
    expect(e.cooldowns.get("howl")).toBeLessThanOrEqual(15);
  });
  it("攻撃速度+20%の狼は、動作の時間が短い（予兆が約1/1.2）", () => {
    const timeToAttack = (buffed: boolean): number => {
      const w = createEnemy({
        def: enemyDef("ENM-FOREST-WOLF"),
        level: 3,
        pos: { x: 0, y: 0 },
        id: "w",
        facing: 0,
      });
      w.state = "chase";
      if (buffed) w.buff = { bonus: 0.2, left: 8 };
      const rng = createRng(1);
      let windupAt = -1;
      for (let i = 0; i < 300; i++) {
        const ev = stepEnemy(w, player(1.2), 1 / 60, rng);
        if (windupAt < 0 && ev.some((x) => x.type === "windup")) windupAt = i;
        if (windupAt >= 0 && (w.state as string) === "attack") return i - windupAt;
      }
      return -1;
    };
    const normal = timeToAttack(false);
    const buffed = timeToAttack(true);
    expect(normal).toBeGreaterThan(0);
    expect(buffed).toBeLessThan(normal);
  });
  it("ドロップ：中ボスは4〜6個・希少以上が1個確定・還星の灯1個・開眼の結晶50%など", () => {
    const rng = createRng("mid");
    let crystals = 0;
    for (let i = 0; i < 400; i++) {
      const d = rollDrops(
        GENERATION_DATA,
        { source: "midBoss", enemyLevel: 11, generate: {}, uid: () => `m${String(i)}` },
        rng,
      );
      expect(d.items.length).toBeGreaterThanOrEqual(4);
      expect(d.items.length).toBeLessThanOrEqual(6);
      expect(["rare", "unique", "set"]).toContain(d.items[0]?.rarity);
      expect(d.materials["MAT-RETURN-LAMP"]).toBe(1);
      if (d.materials["MAT-EYE-OPENING-CRYSTAL"]) crystals++;
    }
    expect(crystals / 400).toBeGreaterThan(0.42);
    expect(crystals / 400).toBeLessThan(0.58);
  });
  it("A1からA4まで通して歩け、戦士が中ボスを倒せる", () => {
    // 出口がA1→A2→A3→A4とつながっている
    const chain = ["MAP-A1", "MAP-A2", "MAP-A3", "MAP-A4"];
    for (let i = 0; i < chain.length - 1; i++) {
      expect(mapDef(chain[i] as string).exits.some((x) => x.to === chain[i + 1])).toBe(true);
      expect(mapDef(chain[i + 1] as string).exits.some((x) => x.to === chain[i])).toBe(true);
    }
    const f = createFighter(WARRIOR_JOB, {
      maxHp: 200,
      maxMp: 100000,
      weaponKey: "greatsword",
      weaponClass: "greatsword",
      jobLevel: 12,
    });
    f.setCharLevel(11);
    const b = boss(1.5);
    const rng = createRng(3);
    let t = 0;
    while (b.body.hp > 0 && t < 600) {
      f.tick(1 / 60);
      t += 1 / 60;
      // 薙ぎ払いを撃ち続ける（崩し・闘志も使う）
      if (f.gauge.canRelease) f.use("SKL-WAR-RUIN", { x: 0, y: 0 }, 0, [b.body], rng);
      else if (Math.floor(t * 60) % 20 === 0)
        f.use("SKL-WAR-SWEEP", { x: 0, y: 0 }, 0, [b.body], rng);
    }
    expect(b.body.hp).toBe(0);
    expect(t).toBeLessThan(300);
  });
});

describe("地域A3の中ボスと隠し部屋、A5の開放", () => {
  const A3 = mapDef("MAP-A3");
  it("A3には終点に中ボスが毎回出る（配置の抽選に左右されない）", () => {
    expect(A3.boss?.enemyId).toBe("ENM-PACK-LEADER");
    for (let i = 0; i < 20; i++) {
      const r = generateRegion(A3, enemyDef, createRng(i));
      expect(r.enemies.filter((e) => e.def.boss === "midBoss")).toHaveLength(1);
    }
    expect(
      generateRegion(mapDef("MAP-A2"), enemyDef, createRng(1)).enemies.some((e) => e.def.boss),
    ).toBe(false);
  });
  it("通常の群れに、ボスが混ざらない", () => {
    for (const m of ALL_MAPS)
      for (const s of m.sections) expect(s.enemies).not.toContain("ENM-PACK-LEADER");
  });
  it("A3の隠し部屋：茂みと、扉の壁と、中の宝箱がある。他の地域にはない", () => {
    expect(A3.secret).toBeDefined();
    expect(A3.walls).toContain(A3.secret?.door);
    expect(
      Math.hypot(
        (A3.secret?.bush.x ?? 0) - (A3.secret?.chest.x ?? 0),
        (A3.secret?.bush.y ?? 0) - (A3.secret?.chest.y ?? 0),
      ),
    ).toBeGreaterThan(5);
    expect(mapDef("MAP-A1").secret).toBeUndefined();
  });
  it("A5は母樹の初回撃破の後に開く（出口からも、転移の石からも入れない）", () => {
    const w = new World(ALL_MAPS, enemyDef, "MAP-A1");
    expect(mapDef("MAP-A5").requires).toBe("BOSS-CH1");
    w.enter("MAP-A4", createRng(1));
    expect(w.move("MAP-A5", createRng(1))).toBeUndefined();
    expect(w.location).toBe("MAP-A4");
    w.unlockedTeleports.add("MAP-A5");
    w.returnToTown();
    expect(w.teleportTo("MAP-A5", createRng(1))).toEqual({ ok: false, reason: "locked" });
    w.firstKills.add("BOSS-CH1");
    expect(w.teleportTo("MAP-A5", createRng(1)).ok).toBe(true);
    expect(w.location).toBe("MAP-A5");
  });
  it("見つけた隠し部屋は記録される（隠し星は一度だけ）。セーブに残る", () => {
    const w = new World(ALL_MAPS, enemyDef, "MAP-A1");
    w.foundSecrets.add("MAP-A3");
    const snap = w.snapshot();
    expect(snap.foundSecrets).toEqual(["MAP-A3"]);
    const w2 = new World(ALL_MAPS, enemyDef, "MAP-A1");
    w2.restore(snap);
    expect(w2.foundSecrets.has("MAP-A3")).toBe(true);
    expect(w2.location).toBe(TOWN_ID);
  });
});

describe("クエスト「森の異変」（補助仕様書 9.6）", () => {
  it("4段階：A2に到達・群れ長の大牙を倒す・A4に到達・母樹を倒す。各段階で星図の欠片1", () => {
    expect(QUESTS[0]?.stages.map((s) => s.condition)).toEqual([
      { type: "reach", region: "MAP-A2" },
      { type: "kill", target: "ENM-PACK-LEADER" },
      { type: "reach", region: "MAP-A4" },
      { type: "kill", target: "BOSS-CH1" },
    ]);
    const log = new QuestLog(QUESTS);
    expect(log.questPoints).toBe(0);
    expect(log.notify({ type: "reach", region: "MAP-A1" })).toEqual([]);
    expect(log.notify({ type: "reach", region: "MAP-A2" })).toHaveLength(1);
    expect(log.notify({ type: "reach", region: "MAP-A2" })).toEqual([]); // 同じ段階は一度だけ
    expect(log.questPoints).toBe(1);
    log.notify({ type: "kill", target: "ENM-PACK-LEADER" });
    log.notify({ type: "reach", region: "MAP-A4" });
    const last = log.notify({ type: "kill", target: "BOSS-CH1" });
    expect(last[0]?.completed).toBe(true);
    expect(log.questPoints).toBe(4);
  });
  it("順番に関係なく達成できる。保存して復元できる", () => {
    const log = new QuestLog(QUESTS);
    log.notify({ type: "kill", target: "ENM-PACK-LEADER" });
    const restored = new QuestLog(QUESTS, log.snapshot());
    expect(restored.isDone("QST-FOREST", "S2")).toBe(true);
    expect(restored.questPoints).toBe(1);
    expect(restored.notify({ type: "kill", target: "ENM-PACK-LEADER" })).toEqual([]);
  });
  it("星辰盤のポイント：キャラLv 2〜20で19＋星図の欠片4＋隠し星2＝25（補助仕様書 4.4）", () => {
    expect(starPointTotal(20, 4, 2)).toBe(25);
    expect(starPointTotal(1, 0, 0)).toBe(0);
    expect(starPointTotal(15, 2, 1)).toBe(17);
  });
});
