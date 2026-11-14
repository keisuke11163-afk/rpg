/**
 * 召喚士（仕様書v0.2 5.5）：契約枠・召喚物の行動（敵を攻撃する）・敵が召喚物を狙う・命令の技・転職・データだけで足せること。
 */
import { describe, expect, it } from "vitest";
import {
  type RawContent,
  Combatant,
  FIXED_STEP_SECONDS,
  Rng,
  loadContent,
  staggerProfiles,
} from "@stella/core";
import { loadGameContent, rawContent } from "@stella/content";
import type { Action } from "../src/input/actions.ts";
import type { InputFrame } from "../src/input/frame.ts";
import {
  ArenaSimulation,
  DUMMY_POSITION,
  newCharacterProfile,
} from "../src/scenes/arena-simulation.ts";
import { toPixels } from "../src/world/units.ts";
import { MinionField } from "../src/world/MinionField.ts";

const STEP = FIXED_STEP_SECONDS;
const db = loadGameContent();

function frame(
  held: Action[] = [],
  pressed: Action[] = [],
  at: { x: number; y: number } = { x: 1e5, y: toPixels(12) },
): InputFrame {
  return { held: new Set(held), pressed: new Set(pressed), move: { x: 0, y: 0 }, pointerWorld: at };
}

function simOf(job = "JOB-SUMMONER", enemies = false, useDb = db): ArenaSimulation {
  const sim = new ArenaSimulation(undefined, {
    db: useDb,
    enemies,
    rngSeed: "sum",
    profile: newCharacterProfile(useDb, job, "試験"),
  });
  sim.gainXp(1e9);
  return sim;
}

function slotOf(sim: ArenaSimulation, skill: string): Action {
  const a = sim.loadout.find((l) => l.skill === skill)?.action;
  if (a === undefined) throw new Error(`${skill} が枠に無い`);
  return a;
}

/** 技を1回使い、動作が終わるまで進める。 */
function use(sim: ArenaSimulation, skill: string, at?: { x: number; y: number }): void {
  const slot = slotOf(sim, skill);
  const pointer = at === undefined ? undefined : { x: toPixels(at.x), y: toPixels(at.y) };
  sim.frame(STEP, frame([slot], [slot], pointer));
  for (let i = 0; i < 90 && sim.executing !== undefined; i++)
    sim.frame(STEP, frame([], [], pointer));
}

/** 枠を「指揮・骸兵・炎霊・魔狼・供儀・憑依」にする（ジョブLvは上げてあるので、全て覚えている）。 */
function allSkills(sim: ArenaSimulation): void {
  [
    "SKL-SUMMONER-COMMAND",
    "SKL-SUMMONER-SKELETON",
    "SKL-SUMMONER-FIRE-SPIRIT",
    "SKL-SUMMONER-DIRE-WOLF",
    "SKL-SUMMONER-SACRIFICE",
    "SKL-SUMMONER-POSSESS",
  ].forEach((s, i) => {
    expect(sim.setSlotSkill(i, s)).toBe(true);
  });
}

describe("召喚士の初期の状態", () => {
  it("出自が召喚士なら、下級の笏を持ち、契約枠（最大10・使っている枠0）を持つ", () => {
    const sim = simOf();
    expect(sim.job.id).toBe("JOB-SUMMONER");
    expect(sim.weapon?.base).toBe("BASE-WPN-SCEPTER-T1");
    expect(sim.jobGauge.def.id).toBe("GAU-CONTRACT");
    expect(sim.jobGauge.max).toBe(10);
    expect(sim.jobGauge.value).toBe(0);
    expect(sim.minionField.squad.capacity).toBe(10);
    expect(sim.minions).toHaveLength(0);
  });

  it("召喚士以外のジョブは契約枠0で、召喚物はいない", () => {
    const sim = simOf("JOB-WARRIOR");
    expect(sim.minionField.squad.capacity).toBe(0);
  });
});

describe("契約枠と召喚", () => {
  it("骸兵召喚はMP8を使い、骸兵が1体現れて枠を2使う", () => {
    const sim = simOf();
    allSkills(sim);
    const mp = sim.mp;
    const slot = slotOf(sim, "SKL-SUMMONER-SKELETON");
    sim.frame(STEP, frame([slot], [slot]));
    expect(mp - sim.mp).toBeGreaterThan(7.5); // 使い始めた刻みに8（MPは時間で少し戻る）
    for (let i = 0; i < 90 && sim.executing !== undefined; i++) sim.frame(STEP, frame());
    expect(sim.minions.map((m) => m.def.id)).toEqual(["MIN-SKELETON"]);
    expect(sim.jobGauge.value).toBe(2);
    expect(sim.minions[0]?.combatant.team).toBe("player");
  });

  it("枠が足りなければ使えない（骸兵5体＝10枠で、6体目は「ゲージ不足」）", () => {
    const sim = simOf();
    allSkills(sim);
    for (let i = 0; i < 5; i++) {
      sim.frame(STEP, frame());
      for (let j = 0; j < 200 && sim.blockOf("SKL-SUMMONER-SKELETON") === "mp"; j++)
        sim.frame(STEP, frame());
      use(sim, "SKL-SUMMONER-SKELETON");
    }
    expect(sim.minions).toHaveLength(5);
    expect(sim.jobGauge.value).toBe(10);
    expect(sim.blockOf("SKL-SUMMONER-SKELETON")).toBe("gauge");
    expect(sim.blockOf("SKL-SUMMONER-DIRE-WOLF")).toBe("gauge");
  });

  it("倒された召喚物の枠は戻る", () => {
    const sim = simOf();
    allSkills(sim);
    use(sim, "SKL-SUMMONER-DIRE-WOLF");
    expect(sim.jobGauge.value).toBe(4);
    sim.minions[0]?.combatant.health.takeDamage(1e9);
    sim.frame(STEP, frame());
    expect(sim.minions).toHaveLength(0);
    expect(sim.jobGauge.value).toBe(0);
    expect(sim.blockOf("SKL-SUMMONER-DIRE-WOLF")).toBeUndefined();
  });

  it("召喚物は持ち主に付いて来る（敵がいないとき）", () => {
    const sim = simOf();
    allSkills(sim);
    // 木人（右）から十分に離れてから呼ぶ（木人も召喚物の標的になるため）
    for (let i = 0; i < 240; i++) sim.frame(STEP, { ...frame(), move: { x: -1, y: 0 } });
    use(sim, "SKL-SUMMONER-SKELETON");
    const m = sim.minions[0];
    if (m === undefined) throw new Error("骸兵がいない");
    for (let i = 0; i < 120; i++) sim.frame(STEP, { ...frame(), move: { x: 0, y: 1 } });
    const p = sim.motion.position;
    expect(Math.hypot(m.position.x - p.x, m.position.y - p.y)).toBeLessThan(3);
  });

  it("転職すると召喚物は消える（セーブもしない）", () => {
    const sim = simOf();
    allSkills(sim);
    use(sim, "SKL-SUMMONER-SKELETON");
    expect(sim.minions).toHaveLength(1);
    expect(sim.changeJob()).toBe("ok");
    expect(sim.minions).toHaveLength(0);
    expect(sim.minionField.squad.capacity).toBe(0);
    expect(JSON.stringify(sim.saveData())).not.toContain("MIN-SKELETON");
  });
});

/** 敵のいる場で、プレイヤーから離れた位置に敵を1体出す。 */
function withRat(dx: number, level = 5) {
  const sim = simOf("JOB-SUMMONER", true);
  allSkills(sim);
  const p = sim.motion.position;
  const rat = sim.field?.spawn("ENM-THORN-RAT", "normal", level, { x: p.x + dx, y: p.y }, "r");
  if (rat === undefined) throw new Error("敵を出せない");
  return { sim, rat };
}

describe("召喚物の戦い", () => {
  it("召喚物は近くの敵を見つけて攻撃し、ダメージを与える（魔狼）", () => {
    const { sim, rat } = withRat(5, 60);
    const hp = rat.combatant.health.hp;
    use(sim, "SKL-SUMMONER-DIRE-WOLF");
    for (let i = 0; i < 600 && sim.minionField.hits === 0; i++) sim.frame(STEP, frame());
    expect(sim.minionField.hits).toBeGreaterThan(0);
    expect(rat.combatant.health.hp).toBeLessThan(hp);
  });

  it("炎霊は火球を撃って離れた敵に当てる", () => {
    const { sim, rat } = withRat(6, 60);
    const slot = slotOf(sim, "SKL-SUMMONER-FIRE-SPIRIT");
    sim.frame(STEP, frame([slot], [slot]));
    let shot = false;
    for (let i = 0; i < 600 && sim.minionField.hits === 0; i++) {
      sim.frame(STEP, frame());
      if (sim.minionField.bolts.active > 0) shot = true;
    }
    expect(shot).toBe(true);
    expect(sim.minionField.hits).toBeGreaterThan(0);
    expect(rat.combatant.health.hp).toBeLessThan(rat.combatant.health.maxHp);
  });

  it("敵は、プレイヤーより近い召喚物を狙って攻撃する", () => {
    // 敵はプレイヤーから10m先。召喚物をその横へ置く（プレイヤーは届かない距離）
    const { sim, rat } = withRat(10);
    use(sim, "SKL-SUMMONER-SKELETON");
    const m = sim.minions[0];
    if (m === undefined) throw new Error("骸兵がいない");
    m.position = { x: rat.position.x - 1, y: rat.position.y };
    // 骸兵が先に倒してしまわないように、攻撃させない（敵の狙いだけを確かめる）
    m.attackCooldown = 1e9;
    rat.notice();
    const max = m.combatant.health.maxHp;
    for (let i = 0; i < 600 && m.combatant.health.hp >= max && !m.dead; i++)
      sim.frame(STEP, frame());
    expect(m.combatant.health.hp).toBeLessThan(max);
    expect(sim.hitsTaken).toBe(0);
  });

  it("召喚物がいなければ、敵は今までどおりプレイヤーを狙う", () => {
    const { sim } = withRat(1);
    for (let i = 0; i < 300 && sim.hitsTaken < 1; i++) sim.frame(STEP, frame());
    expect(sim.hitsTaken).toBe(1);
  });
});

describe("指揮・魂の供儀・霊体憑依", () => {
  it("指揮・集中：照準の近くの敵が、全ての召喚物の標的になる", () => {
    const { sim, rat } = withRat(6, 60);
    use(sim, "SKL-SUMMONER-COMMAND", rat.position);
    expect(sim.commandTarget).toBe(rat.combatant);
  });

  it("魂の供儀：召喚物がいなければ使えない。骸兵を犠牲にすると骨の盾（受けるダメージ-20%）、枠が戻る", () => {
    const sim = simOf();
    allSkills(sim);
    expect(sim.blockOf("SKL-SUMMONER-SACRIFICE")).toBe("target");
    use(sim, "SKL-SUMMONER-SKELETON");
    use(sim, "SKL-SUMMONER-SACRIFICE", sim.minions[0]?.position);
    expect(sim.minions).toHaveLength(0);
    expect(sim.jobGauge.value).toBe(0);
    expect(sim.buffs.active.map((b) => b.effectId)).toContain("EFF-SUMMONER-BONE-SHIELD");
  });

  it("魂の供儀：炎霊は爆発して周りの敵にダメージ", () => {
    const { sim, rat } = withRat(2, 60);
    use(sim, "SKL-SUMMONER-FIRE-SPIRIT");
    const m = sim.minions[0];
    if (m === undefined) throw new Error("炎霊がいない");
    m.position = { x: rat.position.x - 1, y: rat.position.y };
    const before = sim.minionField.hits;
    use(sim, "SKL-SUMMONER-SACRIFICE", m.position);
    expect(sim.minions).toHaveLength(0);
    expect(sim.minionField.hits).toBeGreaterThan(before);
  });

  it("霊体憑依：照準に最も近い召喚物の能力（魔狼）を10秒得る。召喚物は残る", () => {
    const sim = simOf();
    allSkills(sim);
    use(sim, "SKL-SUMMONER-DIRE-WOLF");
    use(sim, "SKL-SUMMONER-POSSESS", sim.minions[0]?.position);
    expect(sim.minions).toHaveLength(1);
    const buff = sim.buffs.active.find((b) => b.effectId === "EFF-SUMMONER-POSSESS-DIRE-WOLF");
    expect(buff).toBeDefined();
  });
});

describe("召喚物の細部（レビュー対応）", () => {
  it("プレイヤーが倒れると、召喚物は全て消える（D-SUM-8）", () => {
    const sim = simOf();
    allSkills(sim);
    use(sim, "SKL-SUMMONER-SKELETON");
    expect(sim.minions).toHaveLength(1);
    sim.player.health.takeDamage(1e12);
    sim.frame(STEP, frame());
    expect(sim.deaths).toBe(1);
    expect(sim.minions).toHaveLength(0);
    expect(sim.jobGauge.value).toBe(0);
  });

  it("契約枠が減っても、すでにいる召喚物は消さない。新しく呼べなくなるだけ（D-SUM-7）", () => {
    const sim = simOf();
    allSkills(sim);
    use(sim, "SKL-SUMMONER-DIRE-WOLF");
    use(sim, "SKL-SUMMONER-FIRE-SPIRIT");
    expect(sim.jobGauge.value).toBe(7);
    sim.minionField.squad.capacity = 4; // 職詞の装備を外したときなど
    for (let i = 0; i < 30; i++) sim.frame(STEP, frame());
    expect(sim.minions).toHaveLength(2);
    expect(sim.jobGauge.value).toBe(7);
    expect(sim.blockOf("SKL-SUMMONER-SKELETON")).toBe("gauge");
  });

  it("指揮・集中の後は、近い敵ではなく指揮した敵を狙う", () => {
    const { sim, rat: near } = withRat(3, 60);
    const p = sim.motion.position;
    const far = sim.field?.spawn("ENM-THORN-RAT", "normal", 60, { x: p.x + 8, y: p.y }, "r2");
    if (far === undefined) throw new Error("敵を出せない");
    use(sim, "SKL-SUMMONER-DIRE-WOLF");
    // 呼んだ直後に近い敵へ向かう前に、遠い敵を指揮する
    use(sim, "SKL-SUMMONER-COMMAND", far.position);
    expect(sim.commandTarget).toBe(far.combatant);
    const nearHp = near.combatant.health.hp;
    for (let i = 0; i < 600 && far.combatant.health.hp >= far.combatant.health.maxHp; i++)
      sim.frame(STEP, frame([], [], { x: toPixels(far.position.x), y: toPixels(far.position.y) }));
    expect(far.combatant.health.hp).toBeLessThan(far.combatant.health.maxHp);
    // 狼は遠い敵だけを噛む（近い敵の減りは、プレイヤーへの反撃などが無いので0）
    expect(near.combatant.health.hp).toBe(nearHp);
  });

  /** 召喚物の攻撃を、同じ乱数の並びで1回当てる（倍率だけを比べるため）。 */
  function strikeOnce(opts: { command: boolean; pct?: number }): number {
    const field = new MinionField(10);
    const def = db.skills.get("SKL-SUMMONER-FIRE-SPIRIT")?.action;
    if (def?.type !== "summon") throw new Error("炎霊の定義が無い");
    const m = field.squad.summon(db, def.minion, { characterLevel: 15, position: { x: 0, y: 0 } });
    if (m === undefined) throw new Error("呼べない");
    const target = new Combatant(db, {
      id: "t",
      team: "enemy",
      position: { x: 1, y: 0 },
      radius: 0.4,
      maxHp: 1e9,
      staggerProfile: staggerProfiles(db).enemy,
    });
    const ctx = {
      db,
      rng: Rng.fromSeed("same"),
      now: 0,
      characterLevel: 15,
      owner: { x: 0, y: 0 },
      enemies: [target],
      minionDamage: 0,
      command: undefined,
      onHit: () => undefined,
    };
    const command = opts.command ? { target, until: 10, damageBonus: 0.2 } : undefined;
    return field.strike(m, target, ctx, command, opts.pct ?? 1).hit.total;
  }

  it("指揮した敵への召喚物のダメージは+20%（加算）", () => {
    expect(strikeOnce({ command: true }) / strikeOnce({ command: false })).toBeCloseTo(1.2);
  });

  it("炎霊の爆発は攻撃の4倍で、半径3m（＋敵の半径）の中の敵だけに当たる", () => {
    expect(strikeOnce({ command: false, pct: 4 }) / strikeOnce({ command: false })).toBeCloseTo(4);
    const { sim, rat: inside } = withRat(2, 60);
    const p = sim.motion.position;
    const outside = sim.field?.spawn("ENM-THORN-RAT", "normal", 60, { x: p.x + 12, y: p.y }, "r2");
    if (outside === undefined) throw new Error("敵を出せない");
    use(sim, "SKL-SUMMONER-FIRE-SPIRIT");
    const m = sim.minions[0];
    if (m === undefined) throw new Error("炎霊がいない");
    m.position = { x: inside.position.x - 2.5, y: inside.position.y };
    const outHp = outside.combatant.health.hp;
    const inHp = inside.combatant.health.hp;
    use(sim, "SKL-SUMMONER-SACRIFICE", m.position);
    expect(inside.combatant.health.hp).toBeLessThan(inHp);
    expect(outside.combatant.health.hp).toBe(outHp);
  });
});

describe("試し打ちの木人", () => {
  it("指揮・集中で木人を狙うと、召喚物が木人を攻撃する（MPとCDだけ使って何も起きない、にならない）", () => {
    const sim = simOf();
    allSkills(sim);
    // 木人の近くまで歩く
    for (let i = 0; i < 600 && DUMMY_POSITION.x - sim.motion.position.x > 4; i++)
      sim.frame(STEP, { ...frame(), move: { x: 1, y: 0 } });
    use(sim, "SKL-SUMMONER-DIRE-WOLF");
    const hp = sim.dummy?.health.hp ?? 0;
    use(sim, "SKL-SUMMONER-COMMAND", DUMMY_POSITION);
    expect(sim.commandTarget).toBe(sim.dummy);
    for (let i = 0; i < 600 && sim.minionField.hits === 0; i++)
      sim.frame(
        STEP,
        frame([], [], { x: toPixels(DUMMY_POSITION.x), y: toPixels(DUMMY_POSITION.y) }),
      );
    expect(sim.minionField.hits).toBeGreaterThan(0);
    expect(sim.dummy?.health.hp ?? hp).toBeLessThan(hp);
    expect(sim.dps()).toBeGreaterThan(0);
  });
});

describe("転職の順番（召喚士はデータの末尾）", () => {
  it("戦士から 盗賊→弓使い→魔法使い→騎士→召喚士→戦士", () => {
    const sim = new ArenaSimulation(undefined, { db, enemies: false });
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      expect(sim.changeJob()).toBe("ok");
      seen.push(sim.job.id);
    }
    expect(seen).toEqual([
      "JOB-ROGUE",
      "JOB-ARCHER",
      "JOB-MAGE",
      "JOB-KNIGHT",
      "JOB-SUMMONER",
      "JOB-WARRIOR",
    ]);
  });
});

describe("召喚のジョブ・召喚物をデータだけで足す（extensibility）", () => {
  const JOB = "JOB-TEST-NECRO";

  function withNecro(): RawContent {
    const c = rawContent.collections;
    const summoner = (c.jobs ?? [])
      .flatMap((f) => f.entries as Record<string, unknown>[])
      .find((e) => e.id === "JOB-SUMMONER");
    const skeleton = (c.skills ?? [])
      .flatMap((f) => f.entries as Record<string, unknown>[])
      .find((e) => e.id === "SKL-SUMMONER-SKELETON");
    if (summoner === undefined || skeleton === undefined) throw new Error("召喚士のデータが無い");
    const action = skeleton.action as { minion: Record<string, unknown> };
    return {
      ...rawContent,
      texts: { ...rawContent.texts, "minion.test-bat": "試験の蝙蝠" },
      collections: {
        ...c,
        skills: [
          ...(c.skills ?? []),
          {
            file: "test/necro-skills.json",
            entries: [
              {
                ...skeleton,
                id: "SKL-TEST-BAT",
                job: JOB,
                action: {
                  type: "summon",
                  minion: {
                    ...action.minion,
                    id: "MIN-TEST-BAT",
                    text: "minion.test-bat",
                    slots: 1,
                  },
                },
              },
            ],
          },
        ],
        jobs: [
          ...(c.jobs ?? []),
          {
            file: "test/necro.json",
            entries: [
              {
                ...summoner,
                id: JOB,
                skills: [{ skill: "SKL-TEST-BAT", level: 1 }],
                // 技を置き換えたので、サブジョブの技（D-SUB-4。そのジョブの技から選ぶ）も持たせない
                subSkills: undefined,
                defaultSlots: ["SKL-BASIC-ATTACK", "SKL-TEST-BAT"],
              },
            ],
          },
        ],
      },
    };
  }

  it("1枠の召喚物を持つジョブを足すと、ゲームの本体を変えずに10体まで呼べる", () => {
    const loaded = loadContent(withNecro());
    if (!loaded.ok) throw new Error(loaded.errors.map((e) => e.message).join("\n"));
    const sim = simOf(JOB, false, loaded.content);
    for (let i = 0; i < 12; i++) {
      for (let j = 0; j < 300 && sim.blockOf("SKL-TEST-BAT") === "mp"; j++)
        sim.frame(STEP, frame());
      if (sim.blockOf("SKL-TEST-BAT") !== undefined) break;
      use(sim, "SKL-TEST-BAT");
    }
    expect(sim.minions).toHaveLength(10);
    expect(sim.blockOf("SKL-TEST-BAT")).toBe("gauge");
  });

  it("召喚物の効果の参照が無いデータは、読み込みの誤りになる", () => {
    const raw = withNecro();
    const bad: RawContent = {
      ...raw,
      collections: {
        ...raw.collections,
        skills: (raw.collections.skills ?? []).map((f) =>
          f.file !== "test/necro-skills.json"
            ? f
            : {
                ...f,
                entries: (f.entries as Record<string, unknown>[]).map((e) => {
                  const a = e.action as { minion: Record<string, unknown> };
                  return {
                    ...e,
                    action: {
                      type: "summon",
                      minion: { ...a.minion, possessEffects: ["EFF-NOPE"] },
                    },
                  };
                }),
              },
        ),
      },
    };
    const loaded = loadContent(bad);
    expect(loaded.ok).toBe(false);
  });
});
