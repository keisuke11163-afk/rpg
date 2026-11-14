/**
 * 弓使い（仕様書v0.2 5.7・MVP後の機能の提案 3章）：投射物・集中・適正間合い・職紋盤・U06 の心眼。
 */
import { describe, expect, it } from "vitest";
import { FIXED_STEP_SECONDS } from "@stella/core";
import { loadGameContent } from "@stella/content";
import type { Action } from "../src/input/actions.ts";
import type { InputFrame } from "../src/input/frame.ts";
import {
  ArenaSimulation,
  DUMMY_POSITION,
  newCharacterProfile,
} from "../src/scenes/arena-simulation.ts";
import { toPixels } from "../src/world/units.ts";

const STEP = FIXED_STEP_SECONDS;
const db = loadGameContent();
const A = "JBN-ARCHER-";

function archer(): ArenaSimulation {
  const sim = new ArenaSimulation(undefined, {
    db,
    enemies: false,
    profile: newCharacterProfile(db, "JOB-ARCHER", "試験"),
  });
  sim.gainXp(1e9);
  return sim;
}

/** 人形を狙う入力。 */
function aim(
  opts: { held?: Action[]; pressed?: Action[]; move?: { x: number; y: number } } = {},
): InputFrame {
  return {
    held: new Set<Action>(opts.held ?? []),
    pressed: new Set<Action>(opts.pressed ?? []),
    move: opts.move ?? { x: 0, y: 0 },
    pointerWorld: { x: toPixels(DUMMY_POSITION.x), y: toPixels(DUMMY_POSITION.y) },
  };
}

function run(sim: ArenaSimulation, seconds: number, frame: InputFrame): void {
  for (let i = 0; i < Math.round(seconds / STEP); i++) sim.frame(STEP, frame);
}

describe("弓使い：出自・初期装備・技の枠", () => {
  it("出自にすると下級の弓を持ち、技の枠はデータの初期の並び。能力値は 剛5・迅15・理15・魂5", () => {
    const profile = newCharacterProfile(db, "JOB-ARCHER", "試験");
    expect(profile.equipment.get("mainHand")?.base).toBe("BASE-WPN-BOW-T1");
    const sim = archer();
    expect(sim.job.id).toBe("JOB-ARCHER");
    expect(sim.affinity).toBe("S");
    expect(sim.loadout.map((l) => l.skill)).toEqual([
      "SKL-BASIC-ATTACK",
      "SKL-ARCHER-QUICKSHOT",
      "SKL-ARCHER-SPREAD",
      "SKL-ARCHER-PIERCING",
      "SKL-ARCHER-LEAP",
      "SKL-ARCHER-RAIN",
    ]);
  });

  it("転職の順番は 戦士 → 盗賊 → 弓使い → 魔法使い → 戦士（魔法使いはデータの末尾）", () => {
    const sim = new ArenaSimulation(undefined, { db, enemies: false });
    expect(sim.job.id).toBe("JOB-WARRIOR");
    expect(sim.changeJob()).toBe("ok");
    expect(sim.changeJob()).toBe("ok");
    expect(sim.job.id).toBe("JOB-ARCHER");
    expect(sim.weapon?.base).toBe("BASE-WPN-BOW-T1");
    expect(sim.changeJob()).toBe("ok");
    expect(sim.job.id).toBe("JOB-MAGE");
    expect(sim.weapon?.base).toBe("BASE-WPN-STAFF-T1");
    expect(sim.changeJob()).toBe("ok");
    expect(sim.job.id).toBe("JOB-WARRIOR");
  });
});

describe("弓使い：投射物", () => {
  it("弓の通常攻撃は矢を放ち、8m先の人形に当たる（近接の届かない距離）", () => {
    const sim = archer();
    run(sim, 1.5, aim({ held: ["skill1"] }));
    expect(sim.lastSkill?.variants).toContain("weapon:TAG-WPNGRP-BOW");
    expect(sim.hitCount).toBeGreaterThan(0);
  });

  it("散弾矢は5本を扇状に放つ（人形には1本以上当たる）", () => {
    const sim = archer();
    run(sim, 0.3, aim({ pressed: ["skill3"] }));
    expect(sim.arrows.active).toBe(5);
    run(sim, 1, aim());
    expect(sim.hitCount).toBeGreaterThan(0);
  });

  it("跳躍後退は、照準と反対へ6m跳ぶ", () => {
    const sim = archer();
    const x = sim.motion.position.x;
    run(sim, 1, aim({ pressed: ["skill5"] }));
    expect(sim.motion.position.x).toBeCloseTo(x - 6, 1);
  });

  it("矢の雨は照準の位置に降り、3秒で6回当たる", () => {
    const sim = archer();
    const before = sim.hitCount;
    run(sim, 4, aim({ pressed: ["skill6"] }));
    expect(sim.hitCount - before).toBe(6);
  });
});

describe("弓使い：集中（M-23 の仮値）", () => {
  it("戦闘中、止まっている間は毎秒20増え、動くと増えない", () => {
    const sim = archer();
    sim.setFervor(0); // 戦闘中にする
    run(sim, 1, aim());
    expect(sim.jobGauge.value).toBeCloseTo(20, 0);
    run(sim, 1, aim({ move: { x: 0, y: 1 } }));
    expect(sim.jobGauge.value).toBeCloseTo(20, 0);
  });

  it("戦闘外では、止まっていても増えず、溜まっていた集中は減る", () => {
    const sim = archer();
    run(sim, 2, aim());
    expect(sim.jobGauge.value).toBe(0);
    sim.setFervor(100);
    // 最後の攻撃・被弾から5秒で戦闘外になり、毎秒20減る
    run(sim, 7.5, aim());
    expect(sim.jobGauge.value).toBeCloseTo(50, 0);
    run(sim, 3, aim());
    expect(sim.jobGauge.value).toBe(0);
  });

  it("集中1につき会心率+1%（増加）", () => {
    const sim = archer();
    const inc = (): number => sim.sheet.evaluated.view.stat("STAT-CRIT-CHANCE").increased;
    const base = inc();
    sim.setFervor(100);
    run(sim, STEP, aim({ move: { x: 0, y: 1 } }));
    expect(inc() - base).toBeCloseTo(1, 5);
  });

  it("狙撃は集中100で使え、集中を全て使う。職奥義「連弩の嵐」では使えない", () => {
    const sim = archer();
    expect(sim.setSlotSkill(5, "SKL-ARCHER-SNIPE")).toBe(true);
    sim.setFervor(50);
    expect(sim.blockOf("SKL-ARCHER-SNIPE")).toBe("gauge");
    sim.setFervor(100);
    expect(sim.blockOf("SKL-ARCHER-SNIPE")).toBeUndefined();
    run(sim, 0.1, aim({ pressed: ["skill6"] }));
    expect(sim.uses.get("SKL-ARCHER-SNIPE")).toBe(1);
    expect(sim.jobGauge.value).toBeLessThan(5);
    for (const id of ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "M-REPEATER"])
      expect(sim.allocateJobNode(`${A}${id}`), id).toBe(true);
    sim.setFervor(100);
    expect(sim.blockOf("SKL-ARCHER-SNIPE")).toBe("locked");
  });

  it("狙撃は集中を全て使っても、使う前の集中の会心率で当たる", () => {
    const sim = archer();
    expect(sim.setSlotSkill(5, "SKL-ARCHER-SNIPE")).toBe(true);
    const inc0 = sim.sheet.evaluated.view.stat("STAT-CRIT-CHANCE").increased;
    // 集中0の通常攻撃の会心率（動きながら撃って集中を溜めない）
    run(sim, 1.5, aim({ pressed: ["skill1"], move: { x: 0, y: 0.0001 } }));
    const basic = sim.lastHit?.hit.critChance ?? 0;
    expect(basic).toBeGreaterThan(0);
    sim.setFervor(100);
    run(sim, 1.5, aim({ pressed: ["skill6"], move: { x: 0, y: 0.0001 } }));
    expect(sim.uses.get("SKL-ARCHER-SNIPE")).toBe(1);
    // 集中は使い切っている（当たった後の「同じ敵」の+5だけ）
    expect(sim.jobGauge.value).toBeLessThanOrEqual(5);
    // 集中100で会心率+100%（増加）
    expect(sim.lastHit?.hit.critChance).toBeCloseTo((basic * (1 + inc0 + 1)) / (1 + inc0), 5);
  });

  it("同じ敵に当てるたび+5（1回の使用で1回）", () => {
    const sim = archer();
    // 動きながら撃つ（止まっている分を混ぜない）
    run(sim, 3, aim({ held: ["skill1"], move: { x: 0, y: 0.0001 } }));
    const uses = sim.uses.get("SKL-BASIC-ATTACK") ?? 0;
    expect(uses).toBeGreaterThan(2);
    // 最初の1回は覚えるだけ。当たった数−1 回ぶん +5（飛んでいる矢の分だけ少なくてよい）
    expect(sim.jobGauge.value).toBeGreaterThanOrEqual(5);
    expect(sim.jobGauge.value % 5).toBeCloseTo(0, 5);
  });
});

describe("弓使い：適正間合い（仕様書v0.2 5.7）", () => {
  it("6〜10mなら+20%、3m以内なら-20%、その間と外は0。鷹の目で上限+6m", () => {
    const sim = archer();
    const at = (d: number): number =>
      sim.rangeBonus({
        position: { x: sim.motion.position.x + d, y: sim.motion.position.y },
        radius: sim.player.radius,
      });
    const edge = sim.player.radius * 2;
    expect(at(8 + edge)).toBeCloseTo(0.2);
    expect(at(2 + edge)).toBeCloseTo(-0.2);
    expect(at(4.5 + edge)).toBe(0);
    expect(at(14 + edge)).toBe(0);
    for (const id of ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "M-HAWK"])
      expect(sim.allocateJobNode(`${A}${id}`), id).toBe(true);
    expect(at(14 + edge)).toBeCloseTo(0.2);
  });

  it("戦士・盗賊には適正間合いが無い", () => {
    const sim = new ArenaSimulation(undefined, { db, enemies: false });
    expect(sim.rangeBonus(sim.player)).toBe(0);
  });
});

describe("U06 盲目の賢者の目隠し：潜在効果「心眼」（pending の解消）", () => {
  it("弓使いの職紋盤の「心眼」を取ると目覚め、集中の最大値+50", () => {
    const sim = archer();
    sim.inventory.addItem({
      uid: "itm_970101",
      base: "BASE-UNQ-U06",
      rarity: "unique",
      itemLevel: 20,
      affixes: [],
    });
    expect(sim.equipFromInventory("itm_970101", "head")).toBe(true);
    const latent = () => sim.sheet.latents.find((l) => l.base === "BASE-UNQ-U06");
    expect(latent()?.active).toBe(false);
    expect(sim.jobGauge.max).toBe(100);
    for (const id of ["T1", "B1A", "B1B", "MIND-EYE"])
      expect(sim.allocateJobNode(`${A}${id}`), id).toBe(true);
    expect(latent()?.active).toBe(true);
    expect(sim.jobGauge.max).toBe(150);
  });
});
