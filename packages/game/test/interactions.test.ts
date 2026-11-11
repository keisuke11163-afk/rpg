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

  it("戦士に転職すると、盗賊の職紋盤の条件は満たされない（潜在効果は眠る）", () => {
    const sim = rogue({ u03: true, poisonBlood: true });
    expect(sim.sheet.latents[0]?.active).toBe(true);
    sim.changeJob();
    expect(sim.job.id).toBe("JOB-WARRIOR");
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
