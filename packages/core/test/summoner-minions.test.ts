import { describe, expect, it } from "vitest";
import {
  type ContentDb,
  Combatant,
  FIXED_STEP_SECONDS,
  JobGauge,
  MINION_TEAM,
  MinionSquad,
  Rng,
  SkillExecution,
  contractCapacity,
  minionMaxHp,
  resolveMinionHit,
  resolveSkill,
  spellBaseMultiplier,
  staggerProfiles,
  standardHp,
} from "../src/index.ts";
import { effect, fullCombatDb, stat, tag } from "./helpers/content.ts";

/** 召喚物の定義（試験用。数値は試験のための値）。 */
const minion = (id: string, slots: number, extra: Record<string, unknown> = {}) => ({
  id,
  text: `m.${id.toLowerCase()}`,
  slots,
  hpRatio: 0.5,
  radius: 0.35,
  moveSpeed: 4,
  sightRange: 8,
  attack: {
    tags: ["TAG-FORM-SUMMON", "TAG-ELEM-PHYSICAL"],
    base: { physical: { min: 10, max: 10 } },
    interval: 1,
    range: 1,
  },
  sacrifice: {},
  possessEffects: ["EFF-POSSESS"],
  ...extra,
});
const summonSkill = (id: string, m: Record<string, unknown>) => ({
  id,
  text: `s.${id.toLowerCase()}`,
  tags: ["TAG-FORM-SUMMON"],
  kind: "weapon",
  pct: 0,
  mpCost: 8,
  cooldown: 0,
  action: { type: "summon", minion: m },
});
const SKILLS = [
  summonSkill("SKL-SKELETON", minion("MIN-SKELETON", 2)),
  summonSkill("SKL-SPIRIT", minion("MIN-SPIRIT", 3)),
  summonSkill("SKL-WOLF", minion("MIN-WOLF", 4)),
  {
    id: "SKL-COMMAND",
    text: "s.command",
    tags: ["TAG-FORM-SUMMON"],
    kind: "weapon",
    pct: 0,
    mpCost: 6,
    cooldown: 3,
    action: { type: "command", range: 12, duration: 8, damageBonus: 0.2 },
  },
];
const CONTRACT = {
  id: "GAU-CONTRACT",
  text: "g.contract",
  max: 10,
  gains: [],
  decayOutOfCombat: 0,
  stages: [],
  contract: { subJobFixed: 6 },
};
const FOCUS = {
  id: "GAU-FOCUS",
  text: "g.focus",
  max: 100,
  gains: [],
  decayOutOfCombat: 0,
  stages: [],
};

const db: ContentDb = fullCombatDb(
  [effect("EFF-POSSESS", "jobSkill", [{ kind: "increased", stat: "STAT-DAMAGE", value: 0.1 }])],
  {
    tags: [tag("TAG-FORM-SUMMON", "form")],
    stats: [stat("STAT-MINION-HP", { unit: "ratio" })],
    skills: SKILLS,
    gauges: [CONTRACT, FOCUS],
  },
);
const minionDef = (skillId: string) => {
  const a = db.skills.get(skillId)?.action;
  if (a?.type !== "summon") throw new Error(skillId);
  return a.minion;
};
const contract = db.gauges.get("GAU-CONTRACT");
if (contract === undefined) throw new Error("gauge");
const enemy = (hp = 1000): Combatant =>
  new Combatant(db, {
    id: "enemy",
    team: "enemy",
    position: { x: 1, y: 0 },
    radius: 0.4,
    maxHp: hp,
    staggerProfile: staggerProfiles(db).enemy,
  });

describe("契約枠（仕様書v0.2 5.5・5.1・H-03）", () => {
  it("メインジョブは最大値10＋最大値の加算（職詞の契約枠+1）。サブジョブは6に固定（職詞・装備で増えない）", () => {
    expect(contractCapacity(contract, "main")).toBe(10);
    expect(contractCapacity(contract, "main", 1)).toBe(11);
    expect(contractCapacity(contract, "sub")).toBe(6);
    expect(contractCapacity(contract, "sub", 4)).toBe(6);
  });

  it("契約枠の仕組みを持たないゲージでは0（召喚できない）", () => {
    const focus = db.gauges.get("GAU-FOCUS");
    if (focus === undefined) throw new Error("gauge");
    expect(contractCapacity(focus, "main", 5)).toBe(0);
  });

  it("枠が足りなければ呼べない。倒された召喚物の枠は戻る", () => {
    const squad = new MinionSquad(10);
    const at = { x: 0, y: 0 };
    const opts = { characterLevel: 1, position: at };
    expect(squad.summon(db, minionDef("SKL-SKELETON"), opts)).toBeDefined();
    expect(squad.summon(db, minionDef("SKL-SPIRIT"), opts)).toBeDefined();
    const wolf = squad.summon(db, minionDef("SKL-WOLF"), opts);
    expect(wolf).toBeDefined();
    expect(squad.used).toBe(9);
    expect(squad.free).toBe(1);
    // 骸兵（2）はもう入らない
    expect(squad.blockOf(minionDef("SKL-SKELETON"))).toBe("slots");
    expect(squad.summon(db, minionDef("SKL-SKELETON"), opts)).toBeUndefined();
    expect(squad.minions).toHaveLength(3);
    // 魔狼が倒されると4枠戻り、骸兵を呼べる
    wolf?.combatant.health.takeDamage(1e9);
    expect(squad.removeDead().map((m) => m.def.id)).toEqual(["MIN-WOLF"]);
    expect(squad.used).toBe(5);
    expect(squad.summon(db, minionDef("SKL-SKELETON"), opts)).toBeDefined();
    expect(squad.used).toBe(7);
  });

  it("サブジョブの6枠では、魔狼（4）＋骸兵（2）でいっぱい", () => {
    const squad = new MinionSquad(contractCapacity(contract, "sub", 3));
    const opts = { characterLevel: 1, position: { x: 0, y: 0 } };
    squad.summon(db, minionDef("SKL-WOLF"), opts);
    squad.summon(db, minionDef("SKL-SKELETON"), opts);
    expect(squad.free).toBe(0);
    expect(squad.blockOf(minionDef("SKL-SKELETON"))).toBe("slots");
  });

  it("犠牲にした召喚物の枠はすぐ戻る。召喚物を生む禁止の印があれば呼べない", () => {
    const squad = new MinionSquad(10);
    const m = squad.summon(db, minionDef("SKL-WOLF"), {
      characterLevel: 1,
      position: { x: 0, y: 0 },
    });
    if (m === undefined) throw new Error("summon");
    expect(squad.remove(m)).toBe(true);
    expect(squad.used).toBe(0);
    expect(squad.remove(m)).toBe(false);
    expect(squad.blockOf(minionDef("SKL-WOLF"), true)).toBe("forbidden");
    expect(
      squad.summon(db, minionDef("SKL-WOLF"), {
        characterLevel: 1,
        position: { x: 0, y: 0 },
        forbidden: true,
      }),
    ).toBeUndefined();
  });

  it("ゲージの量は使っている枠（表示用）。契約枠でないゲージは変わらない", () => {
    const g = new JobGauge(contract);
    g.setContractUsed(9);
    expect(g.value).toBe(9);
    expect(g.max).toBe(10);
    g.setContractUsed(0);
    expect(g.value).toBe(0);
    expect(() => {
      g.setContractUsed(Number.NaN);
    }).toThrow(RangeError);
    const focus = db.gauges.get("GAU-FOCUS");
    if (focus === undefined) throw new Error("gauge");
    const f = new JobGauge(focus);
    f.setContractUsed(5);
    expect(f.value).toBe(0);
  });

  it("位置に最も近い召喚物（霊体憑依・魂の供儀の対象の選び方）", () => {
    const squad = new MinionSquad(10);
    squad.summon(db, minionDef("SKL-SKELETON"), { characterLevel: 1, position: { x: 5, y: 0 } });
    squad.summon(db, minionDef("SKL-SPIRIT"), { characterLevel: 1, position: { x: -2, y: 0 } });
    expect(squad.nearest({ x: 0, y: 0 })?.def.id).toBe("MIN-SPIRIT");
    expect(squad.nearest({ x: 4, y: 0 })?.def.id).toBe("MIN-SKELETON");
    expect(new MinionSquad(10).nearest({ x: 0, y: 0 })).toBeUndefined();
  });
});

describe("召喚物のHP・陣営・ダメージ（仕様書v0.2 5.1.1）", () => {
  it("HPは、基本の技レベルに対応するキャラLvの標準HP × 割合。召喚物HP+%で増える", () => {
    const d = minionDef("SKL-SKELETON");
    expect(minionMaxHp(d, 1)).toBeCloseTo(60 * 0.5);
    // キャラLv15 → 技レベル3 → キャラLv11 の標準HP
    expect(minionMaxHp(d, 15)).toBeCloseTo(standardHp(11) * 0.5);
    expect(minionMaxHp(d, 15, 0.1)).toBeCloseTo(standardHp(11) * 0.5 * 1.1);
    // 技レベル20 → キャラLv96
    expect(minionMaxHp(d, 100)).toBeCloseTo(standardHp(96) * 0.5);
    expect(() => minionMaxHp(d, 1, Number.NaN)).toThrow(RangeError);
  });

  it("召喚物はプレイヤーの陣営の戦う者で、最大HPを持つ", () => {
    const squad = new MinionSquad(10);
    const m = squad.summon(db, minionDef("SKL-SKELETON"), {
      characterLevel: 15,
      position: { x: 2, y: 3 },
    });
    if (m === undefined) throw new Error("summon");
    expect(MINION_TEAM).toBe("player");
    expect(m.combatant.team).toBe("player");
    expect(m.combatant.health.maxHp).toBeCloseTo(standardHp(11) * 0.5);
    expect(m.position).toEqual({ x: 2, y: 3 });
  });

  it("召喚物の攻撃は、基礎値 × 技レベルの倍率（呪文と同じ表）。持ち主の補正・指揮はヒットごとの加算", () => {
    const squad = new MinionSquad(10);
    const m = squad.summon(db, minionDef("SKL-SKELETON"), {
      characterLevel: 15,
      position: { x: 0, y: 0 },
    });
    if (m === undefined) throw new Error("summon");
    const plain = resolveMinionHit({
      db,
      minion: m,
      target: enemy(),
      rng: Rng.fromSeed("m"),
      characterLevel: 15,
      roll: "average",
    });
    expect(plain.hit.evaded).toBe(false);
    expect(plain.hit.total).toBeCloseTo(10 * spellBaseMultiplier(3));
    const target = enemy();
    const boosted = resolveMinionHit({
      db,
      minion: m,
      target,
      rng: Rng.fromSeed("m"),
      characterLevel: 15,
      roll: "average",
      extraIncreased: 0.12 + 0.2,
    });
    expect(boosted.hit.total).toBeCloseTo(10 * spellBaseMultiplier(3) * 1.32);
    expect(target.health.hp).toBeCloseTo(1000 - boosted.hit.total);
    // 爆発などの倍率
    const burst = resolveMinionHit({
      db,
      minion: m,
      target: enemy(),
      rng: Rng.fromSeed("m"),
      characterLevel: 1,
      roll: "average",
      pct: 3,
    });
    expect(burst.hit.total).toBeCloseTo(30);
  });

  it("召喚物は敵の攻撃でダメージを受け、倒れる（その後 removeDead で枠が戻る）", () => {
    const squad = new MinionSquad(10);
    const m = squad.summon(db, minionDef("SKL-SKELETON"), {
      characterLevel: 1,
      position: { x: 0, y: 0 },
    });
    if (m === undefined) throw new Error("summon");
    const e = squad.summon(db, minionDef("SKL-WOLF"), {
      characterLevel: 1,
      position: { x: 1, y: 0 },
    });
    if (e === undefined) throw new Error("summon");
    // 敵の攻撃の代わりに、別の召喚物の攻撃者で当てる（resolveHit は陣営を問わない）
    for (let i = 0; i < 10 && !m.dead; i++)
      resolveMinionHit({
        db,
        minion: e,
        target: m.combatant,
        rng: Rng.fromSeed(`h${String(i)}`),
        characterLevel: 1,
        roll: "average",
      });
    expect(m.dead).toBe(true);
    expect(squad.removeDead()).toHaveLength(1);
    expect(squad.used).toBe(4);
  });
});

describe("召喚士の技の動き方", () => {
  it("召喚・指揮の技は、当たり判定が出始めたときに命令を1回だけ知らせる", () => {
    for (const id of ["SKL-SKELETON", "SKL-COMMAND"]) {
      const def = db.skills.get(id);
      if (def === undefined) throw new Error(id);
      const exec = new SkillExecution(
        resolveSkill(db, def, { stages: [], weaponTags: new Set() }),
        0,
        1,
      );
      const orders = [];
      for (let i = 0; i < 120 && !exec.finished; i++) {
        const t = exec.update(FIXED_STEP_SECONDS, {
          position: { x: 0, y: 0 },
          held: false,
          mp: 100,
        });
        if (t.order !== undefined) orders.push(t.order);
      }
      expect(exec.finished).toBe(true);
      expect(orders).toHaveLength(1);
      expect(orders[0]?.type).toBe(id === "SKL-COMMAND" ? "command" : "summon");
    }
  });
});
