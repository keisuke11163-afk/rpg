/**
 * 星辰盤の MVP の追加分（tools/scripts/gen-star-mvp.ts）：盤の形と、名前つきのノードのルールフック。
 */
import { describe, expect, it } from "vitest";
import { type Combatant, FIXED_STEP_SECONDS } from "@stella/core";
import type { Action } from "../src/input/actions.ts";
import type { InputFrame } from "../src/input/frame.ts";
import { ArenaSimulation } from "../src/scenes/arena-simulation.ts";

const STEP = FIXED_STEP_SECONDS;
const input = (held: Action[] = [], move = { x: 0, y: 0 }): InputFrame => ({
  move,
  pointerWorld: { x: 1e6, y: 0 },
  held: new Set<Action>(held),
  pressed: new Set<Action>(),
});

function pathTo(sim: ArenaSimulation, goal: string): string[] {
  const db = sim.db;
  const root = sim.starRoot as string;
  const prev = new Map<string, string>();
  const queue = [root];
  const seen = new Set([root]);
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    for (const n of db.starLinks.get(cur) ?? []) {
      if (seen.has(n) || db.starNodes.get(n)?.kind === "start") continue;
      seen.add(n);
      prev.set(n, cur);
      queue.push(n);
    }
  }
  const out: string[] = [];
  for (let c = goal; c !== root; c = prev.get(c) as string) out.unshift(c);
  return out;
}

/** Lv20・星辰盤のポイント 100（距離の制約を外して、フックだけを確かめる）。 */
function simWith(job: "JOB-WARRIOR" | "JOB-ROGUE", goals: string[]): ArenaSimulation {
  const sim = new ArenaSimulation(undefined, { enemies: false });
  if (job === "JOB-ROGUE") sim.changeJob();
  sim.gainXp(1e9);
  // ポイントを足す（テストのため。隠し星・クエストのポイントの代わり）
  (sim as unknown as { questPoints: number }).questPoints = 100;
  for (const g of goals)
    for (const id of pathTo(sim, g))
      if (!sim.stars.has(id)) expect(sim.allocateStar(id), id).toBe(true);
  return sim;
}

const toDummy = (sim: ArenaSimulation): void => {
  const p = sim.motion.position;
  sim.motion.displace({ x: 19 - p.x, y: 12 - p.y });
};
const hitOnce = (sim: ArenaSimulation): void => {
  const start = sim.hitCount;
  for (let i = 0; i < 400 && sim.hitCount === start; i++) sim.frame(STEP, input(["skill1"]));
};

describe("星辰盤の形（MVPの範囲）", () => {
  const sim = new ArenaSimulation(undefined, { enemies: false });
  const db = sim.db;

  it("約150ノード（剛域・剛迅域・迅域。風見座だけ迅理域）。ノードどうしが画面で重ならない", () => {
    const nodes = [...db.starNodes.values()];
    expect(nodes.length).toBeGreaterThanOrEqual(130);
    for (const n of nodes)
      if (!n.id.startsWith("STAR-VANE-"))
        expect(["gou", "goujin", "jin"], n.id).toContain(n.region);
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        if (a === undefined || b === undefined) continue;
        const d = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
        expect(d, `${a.id} と ${b.id}`).toBeGreaterThanOrEqual(30);
      }
  });

  it("小星は必ずタグの条件か副次効果を持つ（仕様書v0.2 4.3。能力値の小星と、4.4 に内容がある星座の小星を除く。D-FIN-3）", () => {
    const inConstellation = new Set([...db.constellations.values()].flatMap((c) => c.nodes));
    for (const n of db.starNodes.values()) {
      if (n.kind !== "minor" || inConstellation.has(n.id)) continue;
      for (const id of n.effects ?? []) {
        const e = db.effects.get(id);
        if (e === undefined) throw new Error(`${id} が無い`);
        const attributeOnly = e.modifiers.every(
          (m) => "stat" in m && m.stat.startsWith("STAT-ATTR-"),
        );
        const tagged = e.modifiers.some((m) => "filter" in m && m.filter !== undefined);
        const conditional = (e.conditions ?? []).length > 0;
        const side = e.modifiers.length >= 2;
        expect(attributeOnly || tagged || conditional || side, `${n.id}（${id}）`).toBe(true);
      }
    }
  });

  it("影法師座（仕様書v0.2 4.4）：迅域・小星7つ・背面からの会心率+1%（固定値）", () => {
    const c = db.constellations.get("CONST-SHADOW");
    expect(c?.nodes).toHaveLength(7);
    for (const id of c?.nodes ?? []) {
      const n = db.starNodes.get(id);
      expect(n?.region).toBe("jin");
      expect(n?.effects).toEqual(["EFF-STAR-SHADOW-BACKSTAB"]);
    }
    expect(db.effects.get("EFF-STAR-SHADOW-BACKSTAB")?.modifiers).toEqual([
      { kind: "added", stat: "STAT-BACKSTAB-CRIT", value: 0.01 },
    ]);
  });

  it("名前つきのノードは仕様書にあるものだけ（星門の先2・輝星9・転変2）", () => {
    const named = [...db.starNodes.values()].filter(
      (n) => n.kind === "notable" || n.kind === "mutation",
    );
    expect(named.map((n) => n.id).sort()).toEqual(
      [
        "STAR-MUT-BLOOD-BLADE",
        "STAR-MUT-HEAVY",
        "STAR-NOTABLE-REOPEN",
        "STAR-NT-CORRODE",
        "STAR-NT-CYCLE",
        "STAR-NT-FOCUS",
        "STAR-NT-GALE",
        "STAR-NT-HUNT",
        "STAR-NT-IRON-SKIN",
        "STAR-NT-LAYERS",
        "STAR-NT-SEVERING",
        "STAR-NT-SHADOW-STEP",
        "STAR-NT-SWORD-AURA",
        "STAR-NT-VESSEL-JIN",
      ].sort(),
    );
  });

  it("星門の先：剣気は刃の門、狩りの本能は獣の門の先にある（門が閉じると休眠）", () => {
    const w = simWith("JOB-WARRIOR", ["STAR-NT-SWORD-AURA"]);
    // 初期の武器は大剣（剣系）なので、刃の門は開いている
    expect(w.sheet.board?.active).toContain("STAR-NT-SWORD-AURA");
    w.inventory.addItem({
      uid: "itm_991001",
      base: "BASE-WPN-AXE-T1",
      rarity: "normal",
      itemLevel: 1,
      affixes: [],
    });
    expect(w.equipFromInventory("itm_991001")).toBe(true);
    expect(w.sheet.board?.active).not.toContain("STAR-NT-SWORD-AURA");
  });
});

describe("名前つきのノードのルールフック", () => {
  it("狩りの本能：HPが50%以下の敵へのダメージ+25%", () => {
    const totals = (low: boolean) => {
      const sim = simWith("JOB-ROGUE", ["STAR-NT-HUNT"]);
      sim.inventory.addItem({
        uid: "itm_991002",
        base: "BASE-WPN-CLAW-T1",
        rarity: "normal",
        itemLevel: 1,
        affixes: [],
      });
      expect(sim.equipFromInventory("itm_991002")).toBe(true);
      expect(sim.sheet.board?.active).toContain("STAR-NT-HUNT");
      const d = sim.dummy as Combatant;
      if (low) d.health.takeDamage(d.health.maxHp * 0.6);
      toDummy(sim);
      hitOnce(sim);
      return sim.lastHit?.hit.total ?? 0;
    };
    expect(totals(true) / totals(false)).toBeCloseTo(1.25);
  });

  it("血の刃：出血している敵へのヒットで、出血を1スタック消費して残りを即座に与える", () => {
    const sim = simWith("JOB-ROGUE", ["STAR-MUT-BLOOD-BLADE"]);
    const d = sim.dummy as Combatant;
    const bleed = sim.db.ailments.get("AIL-BLEED");
    if (bleed?.kind !== "dot" || bleed.stacking.mode !== "stack") throw new Error("出血が無い");
    d.ailments.apply({
      ailmentId: bleed.id,
      tag: bleed.tag,
      total: 100,
      duration: 5,
      maxStacks: bleed.stacking.maxStacks,
    });
    toDummy(sim);
    const hp = d.health.hp;
    hitOnce(sim);
    const hitDamage = sim.lastHit?.applied.toHp ?? 0;
    // 消費した出血の残り（ほぼ100）が、ヒットのダメージに加わる
    expect(hp - d.health.hp - hitDamage).toBeGreaterThan(90);
  });

  it("腐食の手：状態異常を受けている敵は、物理耐性-10%（ヒットの後は元に戻る）", () => {
    // 同じ操作・同じ乱数で、衰弱のある人形と無い人形への1撃目を比べる
    const first = (weakened: boolean): { total: number; resist: number } => {
      const sim = simWith("JOB-ROGUE", ["STAR-NT-CORRODE"]);
      const d = sim.dummy as Combatant;
      const weaken = sim.db.ailments.get("AIL-WEAKEN");
      if (weaken === undefined) throw new Error("衰弱が無い");
      if (weakened)
        d.ailments.apply({
          ailmentId: weaken.id,
          tag: weaken.tag,
          total: 0,
          duration: 30,
          maxStacks: undefined,
        });
      toDummy(sim);
      hitOnce(sim);
      return { total: sim.lastHit?.hit.total ?? 0, resist: d.resist.physical ?? 0 };
    };
    const a = first(false);
    const b = first(true);
    expect(b.total / a.total).toBeCloseTo(1.1);
    expect(b.resist).toBe(0);
  });

  it("影踏み：回避に成功すると1秒間、受けるダメージ-25%", () => {
    const sim = simWith("JOB-ROGUE", ["STAR-NT-SHADOW-STEP"]);
    const before = sim.sheet.defense.damageTaken;
    // 敵の攻撃を回避した（無敵時間に攻撃を受けた）ときの知らせを、直接起こす
    (sim as unknown as { buffs: { add: (e: string, d: number, r: string) => void } }).buffs.add(
      "EFF-BUFF-SHADOW-STEP",
      1,
      "shadow-step",
    );
    sim.frame(STEP, input());
    expect(sim.sheet.defense.damageTaken).toBeCloseTo(before * 0.75);
  });

  it("疾風の脚：移動速度+8%、移動中は回避値+20%", () => {
    const sim = simWith("JOB-WARRIOR", ["STAR-NT-GALE"]);
    sim.frame(STEP, input());
    const still = sim.player.evasion;
    sim.frame(STEP, input([], { x: 1, y: 0 }));
    expect(sim.player.evasion).toBeCloseTo(still * 1.2);
  });

  it("重ね着の妙：重装・軽装・法衣を全て着ていると全防御+15%（加算）", () => {
    const sim = simWith("JOB-WARRIOR", ["STAR-NT-LAYERS"]);
    const inc = (): number => sim.sheet.evaluated.view.stat("STAT-ARMOR").increased;
    for (const [uid, base] of [
      ["itm_991010", "BASE-ARM-IRON-HEAD-T1"],
      ["itm_991011", "BASE-ARM-LEATHER-BODY-T1"],
    ] as const) {
      sim.inventory.addItem({ uid, base, rarity: "normal", itemLevel: 1, affixes: [] });
      expect(sim.equipFromInventory(uid)).toBe(true);
    }
    const two = inc();
    sim.inventory.addItem({
      uid: "itm_991012",
      base: "BASE-ARM-LINEN-HANDS-T1",
      rarity: "normal",
      itemLevel: 1,
      affixes: [],
    });
    expect(sim.equipFromInventory("itm_991012")).toBe(true);
    expect(inc() - two).toBeCloseTo(0.15);
  });

  it("重撃化：近接の技は重撃のタグを得る（闘志の獲得が重撃の値になる）", () => {
    const gain = (mutation: boolean): number => {
      const sim = simWith("JOB-WARRIOR", mutation ? ["STAR-MUT-HEAVY"] : []);
      toDummy(sim);
      const before = sim.jobGauge.value;
      hitOnce(sim);
      return sim.jobGauge.value - before;
    };
    expect(gain(false)).toBe(2);
    expect(gain(true)).toBe(6);
  });

  it("狙い澄まし：同じ敵に3秒当て続けると、会心率の増加+40%", () => {
    const sim = simWith("JOB-ROGUE", ["STAR-NT-FOCUS"]);
    toDummy(sim);
    const inc = (): number => sim.sheet.evaluated.view.stat("STAT-CRIT-CHANCE").increased;
    const before = inc();
    for (let i = 0; i < Math.ceil(4 / STEP); i++) sim.frame(STEP, input(["skill1"]));
    expect(inc() - before).toBeCloseTo(0.4);
  });

  it("剣気：剣で攻撃すると、ときどき衝撃波が出る", () => {
    const sim = simWith("JOB-WARRIOR", ["STAR-NT-SWORD-AURA"]);
    toDummy(sim);
    for (let i = 0; i < 1800 && sim.swordWaveCount === 0; i++) sim.frame(STEP, input(["skill1"]));
    expect(sim.swordWaveCount).toBeGreaterThan(0);
  });

  it("循環の泉：MPを100使うごとに、職能ゲージが最大値の5%増える", () => {
    const sim = simWith("JOB-WARRIOR", ["STAR-NT-CYCLE"]);
    expect(sim.sheet.evaluated.view.stat("STAT-NT-CYCLE").value).toBeCloseTo(0.05);
  });

  it("星の器：迅域の共鳴紋の上限が+40% から+50% になる", () => {
    const sim = simWith("JOB-ROGUE", ["STAR-NOTABLE-REOPEN", "STAR-NT-VESSEL-JIN"]);
    const slots = ["head", "body", "hands", "feet", "belt"] as const;
    const bases = ["HEAD", "BODY", "HANDS", "FEET", "BELT"];
    slots.forEach((slot, i) => {
      const uid = `itm_99102${String(i)}`;
      sim.inventory.addItem({
        uid,
        base: `BASE-ARM-LEATHER-${bases[i] ?? ""}-T1`,
        rarity: "magic",
        itemLevel: 20,
        affixes: [{ id: "AFX-SUF-RESONANCE-JIN", tier: 7, rolls: [1] }],
      });
      expect(sim.equipFromInventory(uid, slot)).toBe(true);
    });
    expect(sim.sheet.evaluated.view.stat("STAT-NOTABLE-REOPEN").value).toBeCloseTo(1.5);
  });
});
