/**
 * 魔法使い（仕様書v0.2 5.4）：出自・初期装備・位相・合成魔法（蒸爆）・呪文の動き（瞬移・雷鎖・隕星・魔法障壁）・職詞。
 */
import { describe, expect, it } from "vitest";
import { FIXED_STEP_SECONDS, type Combatant } from "@stella/core";
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

function mage(options: { enemies?: boolean } = {}): ArenaSimulation {
  const sim = new ArenaSimulation(undefined, {
    db,
    enemies: options.enemies ?? false,
    profile: newCharacterProfile(db, "JOB-MAGE", "試験"),
  });
  sim.gainXp(1e9);
  return sim;
}

/** 人形を狙う入力。 */
function aim(opts: { held?: Action[]; pressed?: Action[] } = {}): InputFrame {
  return {
    held: new Set<Action>(opts.held ?? []),
    pressed: new Set<Action>(opts.pressed ?? []),
    move: { x: 0, y: 0 },
    pointerWorld: { x: toPixels(DUMMY_POSITION.x), y: toPixels(DUMMY_POSITION.y) },
  };
}

function run(sim: ArenaSimulation, seconds: number, frame: InputFrame): void {
  for (let i = 0; i < Math.round(seconds / STEP); i++) sim.frame(STEP, frame);
}

/** 枠の呪文を1回使い、動作が終わるまで進める。 */
function cast(sim: ArenaSimulation, slot: Action): void {
  run(sim, STEP, aim({ pressed: [slot] }));
  for (let i = 0; i < 200 && sim.executing !== undefined; i++) sim.frame(STEP, aim());
}

// 枠：1＝通常攻撃・2＝火球・3＝氷槍・4＝雷鎖・5＝瞬移・6＝隕星
const FIRE: Action = "skill2";
const ICE: Action = "skill3";
const CHAIN: Action = "skill4";
const BLINK: Action = "skill5";
const METEOR: Action = "skill6";

describe("魔法使い：出自・初期装備・技の枠", () => {
  it("出自にすると下級の杖を持ち、技の枠はデータの初期の並び。能力値は 剛5・迅5・理20・魂10", () => {
    const profile = newCharacterProfile(db, "JOB-MAGE", "試験");
    expect(profile.equipment.get("mainHand")?.base).toBe("BASE-WPN-STAFF-T1");
    const sim = mage();
    expect(sim.job.id).toBe("JOB-MAGE");
    expect(sim.affinity).toBe("S");
    expect(sim.loadout.map((l) => l.skill)).toEqual([
      "SKL-BASIC-ATTACK",
      "SKL-MAGE-FIREBALL",
      "SKL-MAGE-ICELANCE",
      "SKL-MAGE-CHAIN",
      "SKL-MAGE-BLINK",
      "SKL-MAGE-METEOR",
    ]);
    const a = sim.character.attributes;
    expect([a.go, a.jin, a.ri, a.kon]).toEqual([5, 5, 20, 10]);
    expect(db.jobs.get("JOB-MAGE")?.gauge).toBe("GAU-PHASE");
  });

  it("杖の通常攻撃は近接のまま（弓と違い、投射物にならない）。杖の呪文ダメージ+15%が効く", () => {
    const sim = mage();
    const inc = (tags: string[]): number =>
      sim.sheet.evaluated.view.stat("STAT-DAMAGE", tags).increased;
    expect(inc(["TAG-FORM-SPELL"])).toBeGreaterThanOrEqual(0.15 - 1e-9);
    expect(inc(["TAG-FORM-MELEE"])).toBeLessThan(0.15);
    run(sim, 1, aim({ pressed: ["skill1"] }));
    expect(sim.lastSkill?.id).toBe("SKL-BASIC-ATTACK");
    expect(sim.arrows.active).toBe(0);
  });
});

describe("魔法使い：位相と合成魔法（蒸爆）", () => {
  it("違う属性の呪文で位相+1、同じ属性を続けても増えない。最初の呪文も+1", () => {
    const sim = mage();
    expect(sim.jobGauge.value).toBe(0);
    cast(sim, FIRE);
    expect(sim.jobGauge.value).toBe(1);
    cast(sim, FIRE);
    expect(sim.jobGauge.value).toBe(1);
    cast(sim, ICE);
    expect(sim.jobGauge.value).toBe(2);
  });

  it("火・氷・火で位相3。次の火球か氷槍が蒸爆（×1.8の範囲爆発）になり、位相は0に戻る", () => {
    const sim = mage();
    cast(sim, FIRE);
    cast(sim, ICE);
    cast(sim, FIRE);
    expect(sim.jobGauge.value).toBe(3);
    expect(sim.jobGauge.stages).toEqual(["steam"]);
    expect(sim.lastSkill?.variants).not.toContain("fusion:steam");
    const mp = sim.mp;
    run(sim, STEP, aim({ pressed: [FIRE] }));
    expect(sim.lastSkill?.variants).toContain("fusion:steam");
    expect(sim.jobGauge.value).toBe(0);
    expect(sim.jobGauge.stages).toEqual([]);
    // 合成魔法のMPは、元の呪文（火球6）のまま（使った刻みでは、自然回復はほとんど無い）
    expect(mp - sim.mp).toBeGreaterThan(5.5);
    expect(mp - sim.mp).toBeLessThan(6.5);
    for (let i = 0; i < 200 && sim.executing !== undefined; i++) sim.frame(STEP, aim());
    // 続けて火球を使うと、また最初の呪文（+1）
    cast(sim, FIRE);
    expect(sim.jobGauge.value).toBe(1);
    expect(sim.lastSkill?.variants).not.toContain("fusion:steam");
  });

  it("蒸爆の火球は人形に燃焼を付ける（元の呪文が火のとき。付与率100%は仮）。通常の火球は付けない", () => {
    const sim = mage();
    const dummy = sim.dummy as Combatant;
    cast(sim, FIRE);
    run(sim, 0.5, aim());
    expect(dummy.ailments.activeTags()).not.toContain("TAG-AIL-BURN");
    cast(sim, ICE);
    cast(sim, FIRE);
    cast(sim, FIRE); // 蒸爆
    run(sim, 0.5, aim());
    expect(sim.lastSkill?.variants).toContain("fusion:steam");
    expect(dummy.ailments.activeTags()).toContain("TAG-AIL-BURN");
  });

  it("蒸爆の技倍率は元の呪文の×1.8、範囲は着弾の爆発（データの変化の当てはめ）", () => {
    const row = db.gauges.get("GAU-PHASE")?.phase?.fusion.table.find((r) => r.id === "steam");
    expect(row?.mods.pctMultiplier).toBe(1.8);
    expect(row?.elements).toEqual(["fire", "cold"]);
    const fire = db.skills.get("SKL-MAGE-FIREBALL");
    expect(fire?.action.type === "projectile" && fire.action.burst).toBeGreaterThan(0);
  });

  it("雷が混ざった組み合わせ（氷＋雷など）は合成魔法が無く、位相は3のまま。隕星は合成魔法に変わらない", () => {
    const sim = mage();
    cast(sim, FIRE);
    cast(sim, ICE);
    cast(sim, CHAIN);
    expect(sim.jobGauge.value).toBe(3);
    expect(sim.jobGauge.stages).toEqual([]); // 直前の2つは 氷・雷（灼雷・晶雷は未実装）
    cast(sim, ICE);
    cast(sim, FIRE); // 氷・火
    expect(sim.jobGauge.stages).toEqual(["steam"]);
    sim.cooldowns.start("SKL-MAGE-METEOR", 0);
    cast(sim, METEOR);
    expect(sim.lastSkill?.variants).not.toContain("fusion:steam");
    expect(sim.jobGauge.value).toBe(3); // 火→火。隕星は属性を持つが同じ属性なので増えず、合成魔法にも変わらない
    expect(sim.jobGauge.stages).toEqual(["steam"]);
  });

  it("戦闘外（5秒間、攻撃も被弾も無い）になると、位相は0に戻る（町で溜められない）", () => {
    const sim = mage();
    cast(sim, FIRE);
    cast(sim, ICE);
    expect(sim.jobGauge.value).toBe(2);
    run(sim, 6, aim());
    expect(sim.jobGauge.value).toBe(0);
  });

  it("瞬移・魔法障壁（属性を持たない呪文）は、位相を変えない", () => {
    const sim = mage();
    cast(sim, FIRE);
    sim.cooldowns.start("SKL-MAGE-BLINK", 0);
    cast(sim, BLINK);
    expect(sim.jobGauge.value).toBe(1);
    expect(sim.uses.get("SKL-MAGE-BLINK")).toBe(1);
    cast(sim, FIRE);
    expect(sim.jobGauge.value).toBe(1); // 直前はまだ火
  });
});

describe("魔法使い：職詞「位相を1から開始する」", () => {
  it("職詞を付けた装備を着ると、戦闘外の位相は1。戦闘外になると1に戻る。魔法使い以外では効かない", () => {
    const sim = mage();
    sim.inventory.addItem({
      uid: "itm_980001",
      base: "BASE-ARM-LEATHER-HEAD-T1",
      rarity: "magic",
      itemLevel: 21,
      affixes: [{ id: "AFX-PRE-JOB-MAGE", tier: 7, rolls: [1] }],
    });
    expect(sim.equipFromInventory("itm_980001", "head")).toBe(true);
    expect(sim.jobGauge.value).toBe(1);
    cast(sim, FIRE); // 位相1から、最初の呪文で2
    expect(sim.jobGauge.value).toBe(2);
    cast(sim, ICE);
    expect(sim.jobGauge.value).toBe(3); // 2回で位相3（職詞が無いと3回）
    run(sim, 6, aim());
    expect(sim.jobGauge.value).toBe(1);
    sim.changeJob(); // 戦士
    expect(sim.job.id).toBe("JOB-WARRIOR");
    expect(sim.jobGauge.value).toBe(0);
  });
});

describe("魔法使い：呪文の動き", () => {
  it("火球・氷槍はMPを使い、離れた人形に当たる", () => {
    const sim = mage();
    const mp = sim.mp;
    const hits = sim.hitCount;
    run(sim, STEP, aim({ pressed: [FIRE] }));
    expect(mp - sim.mp).toBeGreaterThan(5.5);
    run(sim, 1.5, aim());
    expect(sim.hitCount).toBeGreaterThan(hits);
  });

  it("瞬移は照準の方向へ8m（照準が近ければそこまで）移る", () => {
    const sim = mage();
    const x = sim.motion.position.x;
    cast(sim, BLINK);
    expect(sim.motion.position.x - x).toBeCloseTo(Math.min(8, DUMMY_POSITION.x - x), 1);
  });

  it("隕星は1.0秒後に落ち、人形に1回だけ当たる（MP30・CD10秒）", () => {
    const sim = mage();
    const hits = sim.hitCount;
    const mp = sim.mp;
    run(sim, STEP, aim({ pressed: [METEOR] }));
    expect(mp - sim.mp).toBeGreaterThan(29);
    run(sim, 0.5, aim());
    expect(sim.hitCount).toBe(hits);
    run(sim, 2, aim());
    expect(sim.hitCount).toBe(hits + 1);
    expect(sim.blockOf("SKL-MAGE-METEOR")).toBe("cooldown");
  });

  it("雷鎖は最初の敵から近くの別の敵へ連鎖し、同じ敵には1回しか当たらない", () => {
    const sim = mage({ enemies: true });
    // 同じ種類の敵は同じ印で出るので、違う種類の敵を3体
    const ids = ["ENM-THORN-RAT", "ENM-FOREST-WOLF", "ENM-SPINE-LIZARD"].map((e) =>
      sim.spawnEnemy(e),
    );
    // 倒れると地域から消えるので、先に戦う者を持っておく
    const rats = ids.map(
      (id) => sim.field?.enemies.find((e) => e.id === id)?.combatant as Combatant,
    );
    for (const r of rats) expect(r.health.hp).toBe(r.health.maxHp);
    cast(sim, CHAIN);
    // 3体とも、ダメージを受けた（連鎖が最初の1体で止まっていない）
    for (const r of rats) expect(r.health.hp).toBeLessThan(r.health.maxHp);
    expect(sim.lastSkill?.id).toBe("SKL-MAGE-CHAIN");
  });

  it("魔法障壁は6秒間、最大魔障+30%（最大魔障が増える。法衣など魔障のある装備で意味を持つ）", () => {
    const sim = mage();
    const inc = (): number => sim.sheet.evaluated.view.stat("STAT-WARD-MAX").increased;
    const before = inc();
    // 魔法障壁は初期の枠に無いので、入れ替えて使う
    expect(sim.setSlotSkill(4, "SKL-MAGE-BARRIER")).toBe(true);
    cast(sim, BLINK);
    expect(inc() - before).toBeCloseTo(0.3, 5);
    run(sim, 7, aim());
    expect(inc() - before).toBeCloseTo(0, 5);
  });
});

describe("魔法使い：データの整合", () => {
  it("呪文の基礎値は仕様書5.4のとおり", () => {
    const base = (id: string) => db.skills.get(id)?.base;
    expect(base("SKL-MAGE-FIREBALL")).toEqual({ fire: { min: 12, max: 20 } });
    expect(base("SKL-MAGE-ICELANCE")).toEqual({ cold: { min: 10, max: 16 } });
    expect(base("SKL-MAGE-CHAIN")).toEqual({ lightning: { min: 4, max: 28 } });
    expect(base("SKL-MAGE-METEOR")).toEqual({ fire: { min: 80, max: 120 } });
    const mp = (id: string) => [db.skills.get(id)?.mpCost, db.skills.get(id)?.cooldown];
    expect(mp("SKL-MAGE-FIREBALL")).toEqual([6, 0]);
    expect(mp("SKL-MAGE-ICELANCE")).toEqual([7, 0]);
    expect(mp("SKL-MAGE-CHAIN")).toEqual([8, 0]);
    expect(mp("SKL-MAGE-BLINK")).toEqual([10, 4]);
    expect(mp("SKL-MAGE-BARRIER")).toEqual([15, 12]);
    expect(mp("SKL-MAGE-METEOR")).toEqual([30, 10]);
    const chain = db.skills.get("SKL-MAGE-CHAIN")?.action;
    expect(chain?.type === "chain" && chain.chains).toBe(4);
    const lance = db.skills.get("SKL-MAGE-ICELANCE")?.action;
    expect(lance?.type === "projectile" && lance.pierce).toBe(1);
  });

  it("魔法使いの技・ゲージ・始点・杖は、仮値の印を持つ（仕様に無い値を決めたもの）", () => {
    for (const id of ["SKL-MAGE-FIREBALL", "SKL-MAGE-METEOR", "SKL-MAGE-BLINK"])
      expect(db.skills.get(id)?.provisional).toBe(true);
    expect(db.gauges.get("GAU-PHASE")?.provisional).toBe(true);
    expect(db.starNodes.get("STAR-RI-START")?.startFor).toEqual(["JOB-MAGE"]);
    expect(db.starNodes.get("STAR-RI-START")?.region).toBe("ri");
    expect(db.itemBases.get("BASE-WPN-STAFF-T1")?.weapon?.damage.physical).toEqual({
      min: 5,
      max: 9,
    });
  });

  it("魔法使いの職紋盤：始点1つ・職奥義3つ・星辰盤への接続ノード3つ（弓使いと同じ形）", () => {
    const nodes = [...db.jobNodes.values()].filter((n) => n.job === "JOB-MAGE");
    expect(nodes.filter((n) => n.kind === "start")).toHaveLength(1);
    expect(nodes.filter((n) => n.kind === "mastery")).toHaveLength(3);
    expect(nodes.filter((n) => n.kind === "connector")).toHaveLength(3);
    expect(nodes).toHaveLength(
      [...db.jobNodes.values()].filter((n) => n.job === "JOB-ARCHER").length,
    );
  });

  it("出自を魔法使いにすると、星辰盤の始点は理域", () => {
    const sim = mage();
    expect(sim.starRoot).toBe("STAR-RI-START");
  });
});
