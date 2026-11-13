/**
 * 相互作用の回帰テスト（U-16 の完了の条件。仕様書v0.2 6章 I-09・I-30、9章 V-08、3.7 の U13〜U18 の潜在効果）。
 */
import { describe, expect, it } from "vitest";
import { type Combatant, FIXED_STEP_SECONDS } from "@stella/core";
import type { Action } from "../src/input/actions.ts";
import type { InputFrame } from "../src/input/frame.ts";
import { ArenaSimulation, poisonAmplifier } from "../src/scenes/arena-simulation.ts";

const STEP = FIXED_STEP_SECONDS;
const input = (held: Action[] = []): InputFrame => ({
  move: { x: 0, y: 0 },
  pointerWorld: { x: 1e6, y: 0 },
  held: new Set<Action>(held),
  pressed: new Set<Action>(),
});
const R = "JBN-ROGUE-";

/** 盗賊（ジョブLv20）にして、装備と職紋盤を用意する。 */
function rogue(options: { u03?: boolean; poisonBlood?: boolean; enemies?: boolean } = {}) {
  const sim = new ArenaSimulation(undefined, { enemies: options.enemies ?? false });
  sim.changeJob();
  sim.gainXp(1e7);
  if (options.u03 === true) {
    sim.inventory.addItem({
      uid: "itm_970001",
      base: "BASE-UNQ-U03",
      rarity: "unique",
      itemLevel: 18,
      affixes: [],
    });
    expect(sim.equipFromInventory("itm_970001", "mainHand")).toBe(true);
  }
  if (options.poisonBlood === true)
    for (const id of [`${R}T1`, `${R}B1A`, `${R}B1B`, `${R}POISON-BLOOD`])
      expect(sim.allocateJobNode(id), id).toBe(true);
  return sim;
}

function bleed(sim: ArenaSimulation, c: Combatant, stacks: number, extraStacks = 0): void {
  const def = sim.db.ailments.get("AIL-BLEED");
  if (def?.kind !== "dot" || def.stacking.mode !== "stack") throw new Error("出血が無い");
  for (let i = 0; i < stacks; i++)
    c.ailments.apply({
      ailmentId: def.id,
      tag: def.tag,
      total: 40,
      duration: def.duration,
      maxStacks: def.stacking.maxStacks,
      ...(extraStacks > 0 ? { extraStacks } : {}),
    });
}

describe("I-09：ユニークの潜在効果は、ノード・星座・ジョブを条件に目覚める", () => {
  it("千の小傷 × 毒血同源：職紋盤で毒血同源を取った瞬間に、潜在効果が明かされる", () => {
    const sim = rogue({ u03: true });
    expect(sim.sheet.latents).toEqual([{ uid: "itm_970001", base: "BASE-UNQ-U03", active: false }]);
    expect(sim.revealedLatents.has("BASE-UNQ-U03")).toBe(false);
    for (const id of [`${R}T1`, `${R}B1A`, `${R}B1B`]) expect(sim.allocateJobNode(id)).toBe(true);
    expect(sim.revealedLatents.has("BASE-UNQ-U03")).toBe(false);
    expect(sim.allocateJobNode(`${R}POISON-BLOOD`)).toBe(true);
    expect(sim.sheet.latents[0]?.active).toBe(true);
    expect(sim.revealedLatents.has("BASE-UNQ-U03")).toBe(true);
    // 見つけたことはセーブデータに残り、外しても「？？？」に戻らない
    expect(sim.saveData().discoveries.latent_revealed).toEqual(["BASE-UNQ-U03"]);
    expect(sim.unequip("mainHand")).toBe(true);
    expect(sim.revealedLatents.has("BASE-UNQ-U03")).toBe(true);
  });

  it("弓使いに転職すると、盗賊の職紋盤の条件は満たされない（潜在効果は眠る）", () => {
    const sim = rogue({ u03: true, poisonBlood: true });
    expect(sim.sheet.latents[0]?.active).toBe(true);
    sim.changeJob(); // 転職の順番：戦士 → 盗賊 → 弓使い → 魔法使い → 戦士
    expect(sim.job.id).toBe("JOB-ARCHER");
    const latent = sim.sheet.latents.find((l) => l.base === "BASE-UNQ-U03");
    // 転職で主手が初期装備に替わっていれば、千の小傷は装備していない
    expect(latent?.active ?? false).toBe(false);
  });
});

describe("I-30・V-08：出血が毒としても数えられる（千の小傷＋毒血同源）", () => {
  it("出血だけの敵が、毒も受けているものとして数えられる（種類の数・毒の数）", () => {
    const plain = rogue({ u03: true });
    const awake = rogue({ u03: true, poisonBlood: true });
    for (const sim of [plain, awake]) {
      const d = sim.dummy;
      if (d === undefined) throw new Error("人形がいない");
      bleed(sim, d, 6);
    }
    const dp = plain.dummy as Combatant;
    const da = awake.dummy as Combatant;
    expect(plain.ailmentTypeCount(dp)).toBe(1);
    expect(plain.poisonCount(dp)).toBe(0);
    expect(awake.ailmentTypeCount(da)).toBe(2);
    expect(awake.poisonCount(da)).toBe(6);
    // 実際の毒は付いていない（数えるだけ）
    expect(da.ailments.stacks("AIL-POISON")).toBe(0);
  });

  it("V-08：ダメージは二重にならない（出血の持続ダメージは、潜在効果の有無で変わらない）", () => {
    const run = (poisonBlood: boolean): number => {
      const sim = rogue({ u03: true, poisonBlood });
      const d = sim.dummy as Combatant;
      bleed(sim, d, 6);
      const before = d.health.hp;
      for (let i = 0; i < 60; i++) sim.frame(STEP, input());
      return before - d.health.hp;
    };
    const a = run(false);
    const b = run(true);
    expect(a).toBeGreaterThan(0);
    // 毒血同源のノード自身の「出血と毒のダメージ+5%」は、付与した後の出血には効かない（総量は付与の時点で固定）
    expect(b).toBeCloseTo(a, 6);
  });

  it("毒の数を数える効果（母樹の根冠）が、出血のスタックで働く", () => {
    const sim = rogue({ u03: true, poisonBlood: true });
    sim.inventory.addItem({
      uid: "itm_970002",
      base: "BASE-UNQ-U18",
      rarity: "unique",
      itemLevel: 18,
      affixes: [],
    });
    expect(sim.equipFromInventory("itm_970002")).toBe(true);
    const d = sim.dummy as Combatant;
    const view = sim.sheet.evaluated.view;
    // 千の小傷：出血の最大スタック+4（ヒットで付けるときと同じく、補正を上限に足す）
    const extra = view.stat("STAT-AILMENT-MAX-STACKS", ["TAG-AIL-BLEED"]).value;
    expect(extra).toBe(4);
    bleed(sim, d, 12, extra);
    // 千の小傷で出血の最大スタックは12。10スタックで×1.04
    expect(d.ailments.stacks("AIL-BLEED")).toBe(12);
    expect(
      poisonAmplifier(
        sim.poisonCount(d),
        view.stat("STAT-UNQ-POISON-AMP").value,
        view.stat("STAT-UNQ-POISON-AMP-CAP").value,
      ),
    ).toBeCloseTo(1.04);
  });
});

describe("千の小傷の固有効果（戦闘で）", () => {
  it("物理ヒットは必ず出血を付与する。打撃値は-40%", () => {
    const sim = rogue({ u03: true });
    const p = sim.motion.position;
    sim.motion.displace({ x: 19 - p.x, y: 12 - p.y });
    const d = sim.dummy as Combatant;
    for (let i = 0; i < 300 && sim.hitCount < 3; i++) sim.frame(STEP, input(["skill1"]));
    expect(sim.hitCount).toBeGreaterThanOrEqual(3);
    expect(d.ailments.stacks("AIL-BLEED")).toBeGreaterThanOrEqual(3);
  });
});

describe("天極・輝星のルールフック（仕様書v0.2 4.5・4.7）", () => {
  /** 始点から、そのノードまでの最短の取り方。 */
  const pathTo = (sim: ArenaSimulation, goal: string): string[] => {
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
  };
  const take = (sim: ArenaSimulation, goal: string): void => {
    for (const id of pathTo(sim, goal))
      if (!sim.stars.has(id)) expect(sim.allocateStar(id), id).toBe(true);
  };
  const weaken = (sim: ArenaSimulation, c: Combatant): void => {
    const def = sim.db.ailments.get("AIL-WEAKEN");
    if (def === undefined) throw new Error("衰弱が無い");
    c.ailments.apply({
      ailmentId: def.id,
      tag: def.tag,
      total: 0,
      duration: 10,
      maxStacks: undefined,
    });
  };
  const hitDummy = (sim: ArenaSimulation, n = 1): void => {
    const p = sim.motion.position;
    sim.motion.displace({ x: 19 - p.x, y: 12 - p.y });
    const start = sim.hitCount;
    for (let i = 0; i < 400 && sim.hitCount < start + n; i++) sim.frame(STEP, input(["skill1"]));
  };

  it("I-30：千変の臨界は、出血＋衰弱だけでは起きず、毒血同源（出血を毒としても数える）のときだけ起きる", () => {
    const run = (poisonBlood: boolean): { crit: number; dots: number } => {
      const sim = rogue({ u03: true, poisonBlood });
      take(sim, "STAR-KEY-MYRIAD");
      const d = sim.dummy as Combatant;
      bleed(sim, d, 3);
      weaken(sim, d);
      hitDummy(sim);
      return { crit: sim.criticals, dots: d.ailments.remainingDotTotal() };
    };
    const plain = run(false);
    expect(plain.crit).toBe(0);
    const awake = run(true);
    expect(awake.crit).toBe(1);
    // 臨界で持続ダメージは消える（このヒットで付いた出血は、消えた後に付くので残りうる）
    expect(awake.dots).toBeLessThan(plain.dots);
  });

  it("ダメージを受けない相手（ボスの段階の切り替えなど）へのヒットでは、臨界が起きず、持続ダメージも消えない", () => {
    const sim = rogue({ u03: true, poisonBlood: true });
    take(sim, "STAR-KEY-MYRIAD");
    const d = sim.dummy as Combatant;
    bleed(sim, d, 3);
    weaken(sim, d);
    const before = d.ailments.remainingDotTotal();
    d.health.invulnerable = true;
    const p = sim.motion.position;
    sim.motion.displace({ x: 19 - p.x, y: 12 - p.y });
    for (let i = 0; i < 120; i++) sim.frame(STEP, input(["skill1"]));
    expect(sim.criticals).toBe(0);
    expect(d.ailments.remainingDotTotal()).toBeGreaterThan(0);
    expect(d.ailments.remainingDotTotal()).toBeLessThanOrEqual(before);
    // ヒット以外の付与（毒だまり・反撃など）も、無敵の相手には付かない
    const poison = sim.db.ailments.get("AIL-POISON");
    if (poison?.kind !== "dot") throw new Error("毒が無い");
    expect(
      d.applyAilment({
        ailmentId: poison.id,
        tag: poison.tag,
        total: 10,
        duration: 3,
        maxStacks: undefined,
      }),
    ).toBe(false);
    expect(d.ailments.stacks("AIL-POISON")).toBe(0);
  });

  it("千変：同じ敵への臨界は2秒に1回まで", () => {
    const sim = rogue({ u03: true, poisonBlood: true });
    take(sim, "STAR-KEY-MYRIAD");
    const d = sim.dummy as Combatant;
    bleed(sim, d, 3);
    weaken(sim, d);
    hitDummy(sim);
    expect(sim.criticals).toBe(1);
    weaken(sim, d);
    hitDummy(sim); // 千の小傷で出血が付くので、3種類（出血・毒・衰弱）のまま
    expect(sim.criticals).toBe(1);
  });

  it("傷口を抉る：出血している敵へのヒットで、出血の持続が1秒延びる（毎秒の量は変わらない）", () => {
    const sim = rogue();
    take(sim, "STAR-NOTABLE-REOPEN");
    const d = sim.dummy as Combatant;
    bleed(sim, d, 1);
    const before = d.ailments.remainingDotTotal();
    hitDummy(sim);
    // 1秒分（総量40÷持続5秒＝毎秒8）だけ残りが増える（ヒットまでに減った分を除いて）
    expect(d.ailments.remainingDotTotal()).toBeGreaterThan(before);
  });

  it("影写し：受けるダメージの35%は4秒かけて遅れて受ける", () => {
    const sim = rogue({ enemies: true });
    take(sim, "STAR-KEY-SHADOW-COPY");
    const id = sim.spawnEnemy("ENM-BARK-BEAR");
    const bear = sim.field?.enemies.find((e) => e.id === id);
    bear?.notice();
    let delayed = 0;
    for (let i = 0; i < 600 && delayed === 0; i++) {
      sim.frame(STEP, input());
      delayed = sim.shadowDelayed;
    }
    expect(delayed).toBeGreaterThan(0);
    const hp = sim.player.health.hp;
    // 熊から離して、遅れた分だけを受ける
    if (bear !== undefined) bear.combatant.health.takeDamage(bear.combatant.health.hp);
    for (let i = 0; i < Math.ceil(4.5 / STEP); i++) sim.frame(STEP, input());
    expect(sim.shadowDelayed).toBe(0);
    expect(sim.player.health.hp).toBeLessThan(hp);
  });

  it("血の盟約：技のコストをHPで払う（MPは減らない）", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    take(sim, "STAR-KEY-BLOOD-PACT");
    const charge = sim.db.skills.get("SKL-WARRIOR-CHARGE");
    const hp = sim.player.health.hp;
    const mp = sim.mp;
    sim.frame(STEP, { ...input(), pressed: new Set<Action>(["skill3"]) });
    expect(sim.lastSkill?.id).toBe("SKL-WARRIOR-CHARGE");
    expect(hp - sim.player.health.hp).toBeCloseTo((charge?.mpCost ?? 0) * 1.5, 5);
    expect(sim.mp).toBeGreaterThanOrEqual(mp);
  });

  it("狼牙の首飾りの潜在効果（傷口を抉る）：出血が移るとき、スタック数を保つ", () => {
    const run = (latent: boolean): number => {
      const sim = rogue({ enemies: true });
      if (latent) take(sim, "STAR-NOTABLE-REOPEN");
      sim.inventory.addItem({
        uid: "itm_970010",
        base: "BASE-UNQ-U14",
        rarity: "unique",
        itemLevel: 10,
        affixes: [],
      });
      expect(sim.equipFromInventory("itm_970010")).toBe(true);
      const spawn = (id: string, dx: number) => {
        const eid = sim.spawnEnemy(id);
        const e = sim.field?.enemies.find((x) => x.id === eid);
        if (e === undefined) throw new Error("敵がいない");
        e.combatant.position = { x: sim.motion.position.x + dx, y: sim.motion.position.y };
        return e.combatant;
      };
      const dying = spawn("ENM-THORN-RAT", 6);
      const other = spawn("ENM-BARK-BEAR", 9);
      bleed(sim, dying, 3);
      dying.health.takeDamage(dying.health.hp);
      sim.frame(STEP, input());
      return other.ailments.stacks("AIL-BLEED");
    };
    expect(run(false)).toBe(1);
    expect(run(true)).toBe(3);
  });

  it("樹皮の盾の潜在効果（徒手の極意）：反撃の毒が、攻撃してきた敵の周囲3mの全ての敵に付く", () => {
    const sim = new ArenaSimulation();
    sim.gainXp(1e7);
    take(sim, "STAR-KEY-BARE-HANDS");
    expect(sim.unequip("mainHand")).toBe(true);
    sim.inventory.addItem({
      uid: "itm_970011",
      base: "BASE-UNQ-U13",
      rarity: "unique",
      itemLevel: 18,
      affixes: [],
    });
    expect(sim.equipFromInventory("itm_970011", "offHand")).toBe(true);
    expect(sim.sheet.latents.find((l) => l.base === "BASE-UNQ-U13")?.active).toBe(true);
    const p = sim.motion.position;
    const spawn = (id: string, dx: number, dy: number) => {
      const eid = sim.spawnEnemy(id);
      const e = sim.field?.enemies.find((x) => x.id === eid);
      if (e === undefined) throw new Error("敵がいない");
      e.combatant.position = { x: p.x + dx, y: p.y + dy };
      return e;
    };
    const wolf = spawn("ENM-FOREST-WOLF", 1.2, 0);
    const near = spawn("ENM-ROT-SAPLING", 2.5, 1.5);
    wolf.notice();
    for (let i = 0; i < 600 && near.combatant.ailments.stacks("AIL-POISON") === 0; i++)
      sim.frame(STEP, input());
    expect(near.combatant.ailments.stacks("AIL-POISON")).toBeGreaterThanOrEqual(1);
  });

  it("重荷の誇り：重装4部位で崩されない", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    take(sim, "STAR-KEY-BURDEN");
    ["HEAD", "BODY", "HANDS", "FEET"].forEach((p, i) => {
      sim.inventory.addItem({
        uid: `itm_98000${String(i)}`,
        base: `BASE-ARM-IRON-${p}-T1`,
        rarity: "normal",
        itemLevel: 1,
        affixes: [],
      });
      expect(sim.equipFromInventory(`itm_98000${String(i)}`)).toBe(true);
    });
    expect(sim.player.staggerImmune).toBe(true);
  });
});

describe("煙玉（仕様書v0.2 5.6）", () => {
  it("中の敵に、間隔ごとに衰弱を付ける（付与の検証で例外にならない）", () => {
    const sim = rogue();
    const p = sim.motion.position;
    sim.motion.displace({ x: 19 - p.x, y: 12 - p.y });
    const slot = sim.loadout.find((l) => l.skill === "SKL-ROGUE-SMOKE")?.action;
    if (slot === undefined) throw new Error("煙玉が枠に無い");
    const d = sim.dummy as Combatant;
    // 煙は照準の位置に置く（人形を狙う。16ピクセル＝1m）
    const aim = { x: d.position.x * 16, y: d.position.y * 16 };
    sim.frame(STEP, { ...input(), pointerWorld: aim, pressed: new Set<Action>([slot]) });
    for (let i = 0; i < 120; i++) sim.frame(STEP, { ...input(), pointerWorld: aim });
    expect(d.ailments.activeTags()).toContain("TAG-AIL-WEAKEN");
  });
});

describe("武具連携（仕様書v0.2 3.13）", () => {
  const pair = (main: string, off: string): ArenaSimulation => {
    const sim = rogue();
    for (const [uid, base, slot] of [
      ["itm_993001", main, "mainHand"],
      ["itm_993002", off, "offHand"],
    ] as const) {
      sim.inventory.addItem({ uid, base, rarity: "normal", itemLevel: 1, affixes: [] });
      expect(sim.equipFromInventory(uid, slot)).toBe(true);
    }
    return sim;
  };

  it("短剣＋短剣は「双牙」、片手斧＋片手斧は「双斧」、ほかの組み合わせは無し", () => {
    expect(pair("BASE-WPN-DAGGER-T1", "BASE-WPN-DAGGER-T1").weaponPairing()).toBe("twinFangs");
    expect(pair("BASE-UNQ-U03", "BASE-WPN-DAGGER-T1").weaponPairing()).toBe("twinFangs");
    expect(pair("BASE-WPN-AXE-T1", "BASE-WPN-AXE-T1").weaponPairing()).toBe("twinAxes");
    expect(pair("BASE-WPN-DAGGER-T1", "BASE-WPN-CLAW-T1").weaponPairing()).toBeUndefined();
  });

  it("双斧：出血を付けるヒットで、出血のスタックが2つずつ溜まる", () => {
    const sim = pair("BASE-WPN-AXE-T1", "BASE-WPN-AXE-T1");
    const p = sim.motion.position;
    sim.motion.displace({ x: 19 - p.x, y: 12 - p.y });
    const d = sim.dummy as Combatant;
    // 片手斧の基本刻印（出血の付与率+10%）で、出血が付くまで叩く
    for (let i = 0; i < 1200 && d.ailments.stacks("AIL-BLEED") === 0; i++)
      sim.frame(STEP, input(["skill1"]));
    expect(d.ailments.stacks("AIL-BLEED")).toBe(2);
  });
});

describe("星読みの記録の簡易版（仕様書v0.2 6.7・D-UI-3）", () => {
  it("武具連携を初めて組むと「新しい星の巡り」を1回だけ知らせ、セーブに残る", () => {
    const texts: string[] = [];
    const sim = new ArenaSimulation(undefined, {
      enemies: false,
      onText: (label) => texts.push(label),
    });
    sim.changeJob();
    sim.gainXp(1e7);
    for (const [uid, slot] of [
      ["itm_994001", "mainHand"],
      ["itm_994002", "offHand"],
    ] as const) {
      sim.inventory.addItem({
        uid,
        base: "BASE-WPN-DAGGER-T1",
        rarity: "normal",
        itemLevel: 1,
        affixes: [],
      });
      expect(sim.equipFromInventory(uid, slot)).toBe(true);
    }
    sim.frame(STEP, input([]));
    sim.frame(STEP, input([]));
    expect(sim.interactionsSeen.has("I-21")).toBe(true);
    expect(texts.filter((t) => t === "新しい星の巡り：武具連携")).toHaveLength(1);
    expect(sim.saveData().discoveries.interactions_seen).toContain("I-21");
  });

  it("武器による技の変化（I-15）は、変化のある技を使ったときに記録する", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    // 試験用の初期の状態は戦士・大剣。薙ぎ払いは大剣で範囲が広がる（変化あり）
    for (let i = 0; i < 30; i++) sim.frame(STEP, input(["skill2"]));
    expect(sim.lastSkill?.variants.length ?? 0).toBeGreaterThan(0);
    expect(sim.interactionsSeen.has("I-15")).toBe(true);
  });
});
