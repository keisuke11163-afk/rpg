import {
  ABYSS_TREE_DROP,
  BASIC_ATTACK,
  MATERIAL,
  MOTHER_TREE_DROP,
  PHASE_INVULNERABLE_SECONDS,
  ROGUE_JOB,
  WARRIOR_JOB,
  createEnemy,
  createFighter,
  createRng,
  exchangeTokens,
  performSummon,
  resolveHit,
  rollBossDrops,
  standardEnemyHp,
  stepEnemy,
  type Enemy,
  type EnemyEvent,
  type Fighter,
  type Target,
} from "@stella/core";
import { describe, expect, it } from "vitest";
import { GENERATION_DATA, enemyDef } from "../src/index.ts";

const make = (id: "BOSS-CH1" | "BOSS-ABYSS"): Enemy =>
  createEnemy({
    def: enemyDef(id),
    level: id === "BOSS-CH1" ? 14 : 21,
    pos: { x: 0, y: 0 },
    id: `T-${id}`,
    facing: 0,
  });
const tgt = (x = 4, y = 0, invulnerable = false): Target => ({
  pos: { x, y },
  radius: 0.4,
  invulnerable,
});
const run = (e: Enemy, t: Target | (() => Target), seconds: number, seed = 1): EnemyEvent[] => {
  const rng = createRng(seed);
  const out: EnemyEvent[] = [];
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    out.push(...stepEnemy(e, typeof t === "function" ? t() : t, 1 / 60, rng));
  }
  return out;
};
const windups = (events: EnemyEvent[]): string[] =>
  events.flatMap((e) => (e.type === "windup" ? [e.attack.id] : []));
const setHpRatio = (e: Enemy, r: number): void => {
  e.body.hp = e.body.maxHp * r;
};

describe("母樹のデータ（補助仕様書 11章）", () => {
  it("腐根の母樹：HP5,400・崩しゲージは最大HPの0.15倍（810）・火-20%/闇+20%・Lv14", () => {
    const e = make("BOSS-CH1");
    expect(e.body.maxHp).toBe(5400);
    expect(e.body.breakGauge.currentMax).toBeCloseTo(810);
    expect(e.body.resistance).toEqual({ fire: -0.2, dark: 0.2 });
    expect(enemyDef("BOSS-CH1").turnDegreesPerSecond).toBe(90);
    expect(enemyDef("BOSS-CH1").script?.rootPoints).toHaveLength(3);
    expect(enemyDef("BOSS-CH1").script?.arenaRadius).toBe(10);
    expect(enemyDef("BOSS-CH1").boss).toBe("chapterBoss");
  });
  it("深淵の母樹：HP9,100・Lv21・攻撃の割合は腐根の母樹と同じ", () => {
    const e = make("BOSS-ABYSS");
    expect(e.body.maxHp).toBe(9100);
    expect(e.level).toBe(21);
    const a = enemyDef("BOSS-CH1").attacks.map((x) => [x.id, x.damageRatio, x.telegraphSeconds]);
    const b = enemyDef("BOSS-ABYSS").attacks.map((x) => [x.id, x.damageRatio, x.telegraphSeconds]);
    expect(b).toEqual(a);
    expect(enemyDef("BOSS-ABYSS").script?.abyss).toBe(true);
  });
  it("攻撃の予兆と割合：叩きつけ1.0秒・30%、薙ぎ0.7秒・15%、胞子0.8秒、暴走0.8秒・25%", () => {
    const d = enemyDef("BOSS-CH1").attacks;
    const by = (id: string) => d.find((x) => x.id === id);
    expect(by("slam")).toMatchObject({
      telegraphSeconds: 1.0,
      damageRatio: 0.3,
      breakCoefficient: 1.2,
    });
    expect(by("sweep")).toMatchObject({
      telegraphSeconds: 0.7,
      damageRatio: 0.15,
      breakCoefficient: 0.5,
    });
    expect(by("spores")?.telegraphSeconds).toBe(0.8);
    expect(by("rampage")).toMatchObject({ telegraphSeconds: 0.8, damageRatio: 0.25 });
  });
});

describe("段階と行動", () => {
  it("第1段階：根の叩きつけ・蔦の薙ぎ・毒の胞子だけ。胞子は雲3つ", () => {
    const e = make("BOSS-CH1");
    const events = run(e, tgt(4), 40);
    const kinds = new Set(windups(events));
    expect([...kinds].sort()).toEqual(["slam", "spores", "sweep"]);
    const spores = events.find((x) => x.type === "windup" && x.attack.id === "spores");
    expect(spores?.type === "windup" ? spores.at : []).toHaveLength(3);
    expect(events.filter((x) => x.type === "cloud").length % 3).toBe(0);
  });
  it("叩きつけは、予兆の間に出た地面の範囲（プレイヤーの位置・半径3m）に当たる。動けば当たらない", () => {
    const hit = (moves: boolean): number => {
      const e = make("BOSS-CH1");
      let x = 4;
      const events = run(
        e,
        () => {
          if (moves) x += 0.12;
          return tgt(x);
        },
        20,
        2,
      );
      return events.filter((ev) => ev.type === "hit" && ev.attack.id === "slam").length;
    };
    expect(hit(false)).toBeGreaterThan(0);
    // ひたすら遠ざかり続けるプレイヤーには、叩きつけは当たらない
    expect(hit(true)).toBeLessThan(hit(false));
    const e = make("BOSS-CH1");
    const damage = run(e, tgt(4), 30, 3).find((ev) => ev.type === "hit" && ev.attack.id === "slam");
    expect(damage?.type === "hit" ? damage.damage : 0).toBeCloseTo(standardEnemyHp(14) * 0.3);
  });
  it("回避（無敵）で叩きつけ・薙ぎをかわせる", () => {
    const e = make("BOSS-CH1");
    const events = run(e, tgt(2, 0, true), 40, 4);
    expect(events.some((x) => x.type === "hit")).toBe(false);
  });
  it("顔の向きは毎秒90°でプレイヤーの方を向く。攻撃中も向きを変える（通常の敵と違う）", () => {
    const e = make("BOSS-CH1");
    e.body.facing = 0;
    const rng = createRng(1);
    // プレイヤーが真後ろ（180°）にいる：90°/秒なので、約2秒で向き直る
    for (let i = 0; i < 60; i++) stepEnemy(e, tgt(-5, 0.01), 1 / 60, rng);
    expect(Math.abs(Math.abs(e.body.facing) - Math.PI / 2)).toBeLessThan(0.2);
    for (let i = 0; i < 120; i++) stepEnemy(e, tgt(-5, 0.01), 1 / 60, rng);
    expect(Math.abs(Math.abs(e.body.facing) - Math.PI)).toBeLessThan(0.2);
  });
  it("段階の切り替え：HP66%・33%で、2秒間ダメージを受けない", () => {
    const e = make("BOSS-CH1");
    const rng = createRng(1);
    stepEnemy(e, tgt(4), 1 / 60, rng); // 戦闘開始
    setHpRatio(e, 0.65);
    stepEnemy(e, tgt(4), 1 / 60, rng);
    expect(e.body.invulnerable).toBe(true);
    const before = e.body.hp;
    const spec = {
      shape: { kind: "circle", radius: 5 } as const,
      damage: { base: { physical: 100 }, skillMultiplier: 1 },
      weaponCrit: 0,
      accuracy: 100,
    };
    expect(resolveHit({ x: 4, y: 0 }, e.body, spec, createRng(2)).hit).toBe(false);
    expect(e.body.hp).toBe(before);
    for (let i = 0; i < Math.round(PHASE_INVULNERABLE_SECONDS * 60) + 2; i++)
      stepEnemy(e, tgt(4), 1 / 60, rng);
    expect(e.body.invulnerable).toBe(false);
    expect(resolveHit({ x: 4, y: 0 }, e.body, spec, createRng(2)).hit).toBe(true);
    // 33%でもう一度
    setHpRatio(e, 0.3);
    stepEnemy(e, tgt(4), 1 / 60, rng);
    expect(e.body.invulnerable).toBe(true);
  });
  it("第2段階：根の触手を20秒ごとに2本召喚（HPは通常の敵×1）。根の叩きつけが2連続になる", () => {
    const e = make("BOSS-CH1");
    run(e, tgt(4), 0.1);
    setHpRatio(e, 0.6);
    const events = run(e, tgt(4), 30, 5);
    const summon = events.find((x) => x.type === "summon");
    expect(summon).toBeDefined();
    if (summon?.type !== "summon") return;
    const tentacles = performSummon(e, summon.attack, enemyDef, createRng(1), []);
    expect(tentacles).toHaveLength(2);
    expect(tentacles[0]?.def.id).toBe("ENM-ROOT-TENTACLE");
    expect(tentacles[0]?.body.maxHp).toBeCloseTo(standardEnemyHp(14));
    // 叩きつけの連続：予兆が2回続く
    const ids = windups(events);
    const doubled = ids.some((id, i) => id === "slam" && ids[i + 1] === "slam");
    expect(doubled).toBe(true);
  });
  it("第3段階：根渡り（15秒ごと・1.5秒かけて地中を移動・別の地点に現れる）と腐根の暴走（3連続・毒だまり）", () => {
    const e = make("BOSS-CH1");
    run(e, tgt(4), 0.1);
    setHpRatio(e, 0.2);
    const positions: { x: number; y: number }[] = [];
    const rng = createRng(6);
    const events: EnemyEvent[] = [];
    for (let i = 0; i < 60 * 40; i++) {
      events.push(...stepEnemy(e, tgt(4), 1 / 60, rng));
      if (i % 60 === 0) positions.push({ ...e.body.pos });
    }
    const ids = windups(events);
    expect(ids).toContain("rootwalk");
    expect(ids).toContain("rampage");
    const first = ids.indexOf("rampage");
    expect(ids.slice(first, first + 3)).toEqual(["rampage", "rampage", "rampage"]);
    // 暴走の毒だまり
    expect(events.some((x) => x.type === "cloud" && x.attack.id === "rampage")).toBe(true);
    // 根の地点のどれかに移動している
    const moved = positions.some((p) => Math.hypot(p.x, p.y) > 3);
    expect(moved).toBe(true);
  });
  it("根渡りの間は地中にいて、攻撃を受けない", () => {
    const e = make("BOSS-CH1");
    run(e, tgt(4), 0.1);
    setHpRatio(e, 0.2);
    const rng = createRng(7);
    let underground = 0;
    for (let i = 0; i < 60 * 40; i++) {
      stepEnemy(e, tgt(4), 1 / 60, rng);
      if (e.body.invulnerable) underground++;
    }
    // 2秒の段階切替＋根渡り（約1.5秒×回数）
    expect(underground).toBeGreaterThan(60 * 2);
  });
  it("深淵の母樹：第2段階から胞子が2回連続。根渡りが10秒ごと", () => {
    const e = make("BOSS-ABYSS");
    run(e, tgt(4), 0.1);
    setHpRatio(e, 0.6);
    const ids = windups(run(e, tgt(4), 40, 8));
    expect(ids.some((id, i) => id === "spores" && ids[i + 1] === "spores")).toBe(true);
    const normal = make("BOSS-CH1");
    run(normal, tgt(4), 0.1);
    setHpRatio(normal, 0.6);
    const ids2 = windups(run(normal, tgt(4), 40, 8));
    expect(ids2.some((id, i) => id === "spores" && ids2[i + 1] === "spores")).toBe(false);
  });
});

describe("ドロップ・討伐証・祭壇（本仕様書 3.12）", () => {
  const uid = (): string => `b${String(Math.random())}`;
  it("腐根の母樹：6〜10個・初回は専用ユニーク確定（U03・U13・U18）・樹液1個・討伐証1個・開眼の結晶2個・封詞の蝋50%", () => {
    let wax = 0;
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const d = rollBossDrops(GENERATION_DATA, MOTHER_TREE_DROP, {
        firstKill: true,
        uid,
        rng: createRng(i),
      });
      expect(d.items.length).toBeGreaterThanOrEqual(6);
      expect(d.items.length).toBeLessThanOrEqual(10);
      expect(d.uniqueDropped).toBe(true);
      const u = d.items.filter((x) => x.rarity === "unique" && x.uniqueId);
      expect(u.length).toBeGreaterThanOrEqual(1);
      seen.add(u[0]?.uniqueId ?? "");
      expect(d.materials[MATERIAL.bossCoreCh1]).toBe(1);
      expect(d.materials[MATERIAL.eyeOpeningCrystal]).toBe(2);
      expect(d.tokens).toEqual({ "BOSS-CH1": 1 });
      if (d.materials[MATERIAL.sealWax]) wax++;
    }
    expect([...seen].sort()).toEqual(["UNQ-U03", "UNQ-U13", "UNQ-U18"]);
    expect(wax / 400).toBeGreaterThan(0.43);
    expect(wax / 400).toBeLessThan(0.57);
  });
  it("2回目以降の専用ユニークは15%（深淵は25%）。討伐証は深淵が2個。初回は深淵でも専用ユニーク確定", () => {
    const rate = (cfg: typeof MOTHER_TREE_DROP, first: boolean): number => {
      let n = 0;
      for (let i = 0; i < 2000; i++)
        if (
          rollBossDrops(GENERATION_DATA, cfg, {
            firstKill: first,
            uid,
            rng: createRng(`r${String(i)}`),
          }).uniqueDropped
        )
          n++;
      return n / 2000;
    };
    expect(rate(MOTHER_TREE_DROP, false)).toBeGreaterThan(0.12);
    expect(rate(MOTHER_TREE_DROP, false)).toBeLessThan(0.18);
    expect(rate(ABYSS_TREE_DROP, false)).toBeGreaterThan(0.22);
    expect(rate(ABYSS_TREE_DROP, false)).toBeLessThan(0.28);
    expect(rate(ABYSS_TREE_DROP, true)).toBe(1);
    const d = rollBossDrops(GENERATION_DATA, ABYSS_TREE_DROP, {
      firstKill: false,
      uid,
      rng: createRng(1),
    });
    expect(d.tokens).toEqual({ "BOSS-CH1": 2 });
    expect(d.items.length).toBeGreaterThanOrEqual(8);
    expect(d.items.length).toBeLessThanOrEqual(12);
  });
  it("T5の詞（iLv25）は、深淵の母樹のドロップだけに出る", () => {
    const t5 = (cfg: typeof MOTHER_TREE_DROP): number => {
      let n = 0;
      for (let i = 0; i < 300; i++) {
        const d = rollBossDrops(GENERATION_DATA, cfg, {
          firstKill: false,
          uid,
          rng: createRng(`t${String(i)}`),
        });
        for (const it of d.items) for (const a of it.affixes) if (a.tier === 5) n++;
      }
      return n;
    };
    expect(t5(MOTHER_TREE_DROP)).toBe(0);
    expect(t5(ABYSS_TREE_DROP)).toBeGreaterThan(0);
  });
  it("討伐の祭壇：討伐証10個で、専用ユニークを1つ選んで交換できる。足りなければ交換できない。候補外は選べない", () => {
    const tokens: Record<string, number> = { "BOSS-CH1": 9 };
    const pool = MOTHER_TREE_DROP.uniquePool;
    expect(exchangeTokens(tokens, "BOSS-CH1", "UNQ-U13", pool, GENERATION_DATA, 18, uid)).toEqual({
      ok: false,
      reason: "tokens",
    });
    tokens["BOSS-CH1"] = 10;
    expect(
      exchangeTokens(tokens, "BOSS-CH1", "UNQ-U02", pool, GENERATION_DATA, 18, uid).reason,
    ).toBe("notInPool");
    const r = exchangeTokens(tokens, "BOSS-CH1", "UNQ-U13", pool, GENERATION_DATA, 18, uid);
    expect(r.ok).toBe(true);
    expect(r.item?.uniqueId).toBe("UNQ-U13");
    expect(tokens["BOSS-CH1"]).toBe(0);
  });
});

/** 標準的なビルドでの、母樹の撃破時間（描画なしで、攻撃を避け続ける理想的なプレイヤーとして測る） */
function killTime(boss: Enemy, f: Fighter, seed: number): number {
  const rng = createRng(seed);
  const t0 = { pos: { x: 3, y: 0 }, radius: 0.4, invulnerable: true };
  let time = 0;
  let busy = 0;
  while (boss.body.hp > 0 && time < 600) {
    time += 1 / 60;
    f.tick(1 / 60);
    t0.pos = { x: boss.body.pos.x + 2.5, y: boss.body.pos.y };
    stepEnemy(boss, t0, 1 / 60, rng);
    boss.body.facing = Math.PI; // プレイヤーが近づく向き
    busy -= 1 / 60;
    if (busy > 0) continue;
    const order = f.init.skills.some((s) => s.id === "SKL-WAR-RUIN")
      ? ["SKL-WAR-RUIN", "SKL-WAR-RIFT", "SKL-WAR-SWEEP", BASIC_ATTACK.id]
      : ["SKL-ROG-FINISH", "SKL-ROG-FLURRY", BASIC_ATTACK.id];
    for (const id of order) {
      f.mp = Math.max(f.mp, 20);
      const out = f.use(
        id,
        { x: boss.body.pos.x + 2.5, y: boss.body.pos.y },
        Math.PI,
        [boss.body],
        rng,
      );
      if (!out.ok) continue;
      busy =
        id === BASIC_ATTACK.id ? 1 / f.attackSpeed : (out.effective?.skill.totalSeconds ?? 0.5);
      break;
    }
  }
  return time;
}

describe("撃破時間の測定（目標60〜120秒。数値は U-21 で調整する）", () => {
  it("戦士・盗賊（Lv15・基本の装備）で腐根の母樹を倒せる。撃破時間を測る", () => {
    const w = createFighter(WARRIOR_JOB, {
      maxHp: 228,
      maxMp: 60,
      weaponKey: "greatsword",
      weaponClass: "greatsword",
      jobLevel: 14,
    });
    w.setCharLevel(15);
    const r = createFighter(ROGUE_JOB, {
      maxHp: 228,
      maxMp: 60,
      weaponKey: "dagger",
      weaponClass: "dagger",
      jobLevel: 14,
    });
    r.setCharLevel(15);
    const tw = killTime(make("BOSS-CH1"), w, 1);
    const tr = killTime(make("BOSS-CH1"), r, 1);
    // この時点では、装備・ツリーによる強化が入っていない素の状態。撃破できること自体を確かめる
    expect(tw).toBeLessThan(600);
    expect(tr).toBeLessThan(600);
    expect(tw).toBeGreaterThan(20);
  });
});
