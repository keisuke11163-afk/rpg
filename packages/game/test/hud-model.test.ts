/** 戦闘画面の HUD のビューモデル（ui/hud-model.ts。Phaser に依存しない純粋な関数群）。 */
import { describe, expect, it } from "vitest";
import { FLASK_RULES } from "@stella/core";
import { text, type TextKey } from "@stella/content";
import { DEFAULT_SETTINGS, effectiveBindings, rebind } from "../src/settings/settings.ts";
import { ArenaSimulation, SKILL_SLOTS } from "../src/scenes/arena-simulation.ts";
import {
  buildHudModel,
  CooldownTracker,
  fill,
  HudEventTracker,
  type HudModel,
  type HudSource,
  LOW_HP_RATIO,
  promptOf,
  shortBindingName,
  shortName,
  vitalText,
} from "../src/ui/hud-model.ts";
import { loadGameContent } from "@stella/content";

const bindings = effectiveBindings(DEFAULT_SETTINGS);
const build = (src: HudSource, extra: { saveStatus?: string; cooldowns?: CooldownTracker } = {}) =>
  buildHudModel(src, { bindings, ...extra });

/** 本物の ArenaSimulation の一部の値だけを作り物に替える（それ以外は本物のまま読める）。 */
function withOverrides(sim: ArenaSimulation, over: Record<string, unknown>): HudSource {
  const out = Object.create(sim) as Record<string, unknown>;
  for (const [k, v] of Object.entries(over))
    Object.defineProperty(out, k, { value: v, enumerable: true });
  return out as unknown as HudSource;
}

/** 母樹の間（ボスのいる地域）の本物の ArenaSimulation。 */
function bossSim(): ArenaSimulation {
  const db = loadGameContent();
  const room = db.regions.get("REGION-A4-BOSS");
  if (room === undefined) throw new Error("母樹の間が無い");
  return new ArenaSimulation(undefined, { db, region: room, layoutSeed: "room" });
}

const skillOf = (m: HudModel, skill: string) => {
  const s = m.skills.find((x) => x.skill === skill);
  if (s === undefined) throw new Error(`枠に ${skill} が無い`);
  return s;
};

describe("文章の穴埋め fill", () => {
  it("{名前} を値で置き換える", () => {
    expect(fill("{a}と{b}", { a: "x", b: 2 })).toBe("xと2");
  });

  it("同じ穴が2回あれば、両方とも置き換える", () => {
    expect(fill("{n}／{n}", { n: 3 })).toBe("3／3");
  });

  it("値の無い穴は、そのまま残す（仕様として固定）", () => {
    expect(fill("{a}{b}", { a: "x" })).toBe("x{b}");
    expect(fill("{a}", {})).toBe("{a}");
  });

  it("数値の 0 も数として埋める（undefined とは区別する）", () => {
    expect(fill("{n}段階", { n: 0 })).toBe("0段階");
    expect(fill("残り{s}秒", { s: 1.5 })).toBe("残り1.5秒");
  });
});

describe("数値の表示 vitalText", () => {
  it("整数はそのまま。例：268／268", () => {
    expect(vitalText(268, 268)).toBe("268／268");
  });

  it("小数は四捨五入する", () => {
    expect(vitalText(267.6, 268)).toBe("268／268");
    expect(vitalText(267.4, 268)).toBe("267／268");
    expect(vitalText(2.5, 10)).toBe("3／10");
  });

  it("0 は 0 と表示する", () => {
    expect(vitalText(0, 100)).toBe("0／100");
  });

  it("現在値が最大より大きくても、数値は表示どおり（割合のほうがクランプされる）", () => {
    expect(vitalText(120, 100)).toBe("120／100");
  });
});

describe("名前を枠に収める shortName", () => {
  it("max 文字以下はそのまま", () => {
    expect(shortName("火炎", 4)).toBe("火炎");
    expect(shortName("ドラゴン", 4)).toBe("ドラゴン");
  });

  it("max を超えたら切る（日本語は1文字として数える）", () => {
    expect(shortName("闘気の一閃", 4)).toBe("闘気の一");
  });

  it("空文字は空文字", () => {
    expect(shortName("", 4)).toBe("");
  });

  it("既定値は4文字", () => {
    expect(shortName("ABCDEFG")).toBe("ABCD");
    expect(shortName("ABCD")).toBe("ABCD");
  });

  it("見た目の1文字（書記素）で数える：家族の絵文字は1文字", () => {
    expect(shortName("👨‍👩‍👧ab", 2)).toBe("👨‍👩‍👧a");
  });
});

describe("割り当ての短い名前 shortBindingName", () => {
  it("マウスは左・右", () => {
    expect(shortBindingName({ mouse: "left" })).toBe("左");
    expect(shortBindingName({ mouse: "right" })).toBe("右");
  });

  it("キーは表示の名前（数字は1〜、スペースは日本語）", () => {
    expect(shortBindingName({ key: "ONE" })).toBe("1");
    expect(shortBindingName({ key: "Q" })).toBe("Q");
    expect(shortBindingName({ key: "SPACE" })).toBe("スペース");
  });

  it("割り当てが無い（undefined）は空文字", () => {
    expect(shortBindingName(undefined)).toBe("");
  });
});

describe("技のCDの総時間 CooldownTracker", () => {
  it("CDが始まった刻みの残りを総時間として覚え、残りが減っても総時間は変わらない", () => {
    const t = new CooldownTracker();
    t.endFrame();
    expect(t.observe("A", 2)).toBe(2);
    expect(t.observe("A", 1.5)).toBe(2);
    expect(t.observe("A", 0.5)).toBe(2);
  });

  it("残りが0になったら忘れ、次のCDでは新しい総時間になる", () => {
    const t = new CooldownTracker();
    t.endFrame();
    expect(t.observe("A", 2)).toBe(2);
    expect(t.observe("A", 0)).toBeUndefined();
    expect(t.observe("A", 3)).toBe(3);
  });

  it("観測の途中で残りが増えたら、掛け直し（新しいCD）として総時間を更新する", () => {
    const t = new CooldownTracker();
    t.endFrame();
    expect(t.observe("A", 2)).toBe(2);
    expect(t.observe("A", 1)).toBe(2);
    expect(t.observe("A", 3)).toBe(3);
    expect(t.observe("A", 2.5)).toBe(3);
  });

  it("最初の観測がCDの途中（総時間が分からない）なら undefined。減っていっても undefined のまま", () => {
    const t = new CooldownTracker();
    expect(t.observe("A", 1.5)).toBeUndefined();
    t.endFrame();
    expect(t.observe("A", 1.0)).toBeUndefined();
    expect(t.observe("A", 0.2)).toBeUndefined();
    // CDが終わると忘れ、次に始まったCDは総時間が分かる
    expect(t.observe("A", 0)).toBeUndefined();
    expect(t.observe("A", 2)).toBe(2);
  });

  it("途中から見た技を掛け直すと、その時点から総時間が分かる", () => {
    const t = new CooldownTracker();
    expect(t.observe("A", 1.5)).toBeUndefined();
    t.endFrame();
    expect(t.observe("A", 4)).toBe(4);
  });

  it("endFrame は、1回目の刻みを終えるだけ。観測されなかった技の総時間は消さない", () => {
    const t = new CooldownTracker();
    t.endFrame();
    expect(t.observe("A", 2)).toBe(2);
    // A は次の刻みでは見ない（枠から外されていた想定）
    t.endFrame();
    expect(t.observe("A", 1)).toBe(2);
  });

  it("技ごとに別々に覚える", () => {
    const t = new CooldownTracker();
    t.endFrame();
    expect(t.observe("A", 2)).toBe(2);
    expect(t.observe("B", 5)).toBe(5);
    expect(t.observe("A", 1)).toBe(2);
  });

  it("見ていない間に終わったCDの後の、短い掛け直しの総時間（既知の穴）", () => {
    // 2秒のCDを見た後、その枠を外していて終わりを見なかった。掛け直した1.5秒は 2 ではなく 1.5 として出るべき
    const t = new CooldownTracker();
    t.endFrame();
    expect(t.observe("A", 2)).toBe(2);
    t.endFrame();
    const total = t.observe("A", 1.5);
    expect(total === undefined || Math.abs(total - 1.5) < 1e-9).toBe(true);
  });
});

describe("HUD の手応えのきっかけ HudEventTracker", () => {
  const base = { hitsTaken: 0, level: 5, jobId: "JOB-WARRIOR", jobLevel: 3 };

  it("最初の observe では何も出さない（開始時に Lv UP・被弾が出ない）", () => {
    const t = new HudEventTracker();
    expect(t.observe({ ...base, hitsTaken: 9, level: 20, jobLevel: 20 })).toEqual({
      hurt: false,
      levelUp: undefined,
      jobLevelUp: undefined,
    });
  });

  it("被弾の回数が増えたら hurt、同じなら false", () => {
    const t = new HudEventTracker();
    t.observe(base);
    expect(t.observe({ ...base, hitsTaken: 1 }).hurt).toBe(true);
    expect(t.observe({ ...base, hitsTaken: 1 }).hurt).toBe(false);
  });

  it("キャラLvが上がったら、上がった後のLvを出す", () => {
    const t = new HudEventTracker();
    t.observe(base);
    expect(t.observe({ ...base, level: 6 }).levelUp).toBe(6);
    expect(t.observe({ ...base, level: 6 }).levelUp).toBeUndefined();
  });

  it("ジョブLvが上がったら、上がった後のジョブLvを出す", () => {
    const t = new HudEventTracker();
    t.observe(base);
    expect(t.observe({ ...base, jobLevel: 4 }).jobLevelUp).toBe(4);
    expect(t.observe({ ...base, jobLevel: 4 }).jobLevelUp).toBeUndefined();
  });

  it("転職したときは、ジョブLvが違っても jobLevelUp を出さない（別のジョブのLvは上がったことにならない）", () => {
    const t = new HudEventTracker();
    t.observe(base);
    // 戦士Lv3 → 魔法使いLv1 へ。Lv が上の数字に見えても出さない
    expect(t.observe({ ...base, jobId: "JOB-MAGE", jobLevel: 1 }).jobLevelUp).toBeUndefined();
    expect(t.observe({ ...base, jobId: "JOB-MAGE", jobLevel: 2 }).jobLevelUp).toBe(2);
  });

  it("転職の後、前より数字が大きくても jobLevelUp を出さない（戦士Lv3 → 魔法使いLv9）", () => {
    const t = new HudEventTracker();
    t.observe(base);
    expect(t.observe({ ...base, jobId: "JOB-MAGE", jobLevel: 9 }).jobLevelUp).toBeUndefined();
  });

  it("値が減ったとき（場面の作り直し）に出さない", () => {
    const t = new HudEventTracker();
    t.observe({ ...base, hitsTaken: 10, level: 9, jobLevel: 9 });
    const e = t.observe(base);
    expect(e).toEqual({ hurt: false, levelUp: undefined, jobLevelUp: undefined });
  });
});

describe("buildHudModel：本物の ArenaSimulation から作る", () => {
  it("技の枠は常に6つ（SKILL_SLOTS の順）", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    const m = build(sim);
    expect(m.skills.map((s) => s.action)).toEqual([...SKILL_SLOTS]);
  });

  describe("バイタル", () => {
    it("ラベルと数値の表示。HP・MP は今の値と最大", () => {
      const sim = new ArenaSimulation(undefined, { enemies: false });
      const m = build(sim);
      expect(m.vitals.hp).toMatchObject({ id: "hp", label: text("hud.hp"), ratio: 1 });
      expect(m.vitals.hp.text).toBe(vitalText(sim.playerHealth.hp, sim.playerHealth.maxHp));
      expect(m.vitals.mp).toMatchObject({
        id: "mp",
        label: text("hud.mp"),
        value: sim.mp,
        max: sim.maxMp,
      });
      expect(m.vitals.stamina.label).toBe(text("hud.stamina"));
      expect(m.vitals.gauge.id).toBe("gauge");
    });

    it("HPの割合は 0〜1 にクランプされる（最大を超えても1、0でも0）", () => {
      const sim = new ArenaSimulation(undefined, { enemies: false });
      const over = withOverrides(sim, {
        playerHealth: { hp: 500, maxHp: 268 },
      });
      expect(build(over).vitals.hp.ratio).toBe(1);
      const under = withOverrides(sim, {
        playerHealth: { hp: -5, maxHp: 268 },
      });
      expect(build(under).vitals.hp.ratio).toBe(0);
    });

    it("最大が 0 のとき、割合は 0（NaN・Infinity にならない）", () => {
      const sim = new ArenaSimulation(undefined, { enemies: false });
      const src = withOverrides(sim, {
        playerHealth: { hp: 0, maxHp: 0 },
        maxMp: 0,
        mp: 5,
      });
      const m = build(src);
      expect(m.vitals.hp.ratio).toBe(0);
      expect(m.vitals.mp.ratio).toBe(0);
      expect(Number.isFinite(m.vitals.hp.ratio)).toBe(true);
      expect(m.lowHp).toBe(false);
    });

    it("HP が 0 のとき、割合は 0 で、低HPの点滅はしない（倒れた直後。実装の判断・要確認）", () => {
      const sim = new ArenaSimulation(undefined, { enemies: false });
      sim.playerHealth.takeDamage(sim.playerHealth.maxHp);
      const m = build(sim);
      expect(m.vitals.hp.ratio).toBe(0);
      expect(m.lowHp).toBe(false);
    });
  });

  describe("低HP", () => {
    const withHp = (hp: number, maxHp: number) => {
      const sim = new ArenaSimulation(undefined, { enemies: false });
      return build(withOverrides(sim, { playerHealth: { hp, maxHp } }));
    };

    it(`HPの割合が ${String(LOW_HP_RATIO)} 未満なら true`, () => {
      expect(withHp(29, 100).lowHp).toBe(true);
    });

    it(`ちょうど ${String(LOW_HP_RATIO)} は false`, () => {
      expect(withHp(30, 100).lowHp).toBe(false);
    });

    it("多いときは false", () => {
      expect(withHp(100, 100).lowHp).toBe(false);
    });
  });

  describe("技の枠", () => {
    it("初期の戦士は、基本攻撃などが使える（ready。CD・残り秒は0、総時間は分からない）", () => {
      const sim = new ArenaSimulation(undefined, { enemies: false });
      const basic = build(sim).skills[0];
      expect(basic).toMatchObject({
        skill: "SKL-BASIC-ATTACK",
        state: "ready",
        stateLabel: "",
        cooldownRemaining: 0,
        cooldownTotal: undefined,
        cooldownRatio: undefined,
        executing: false,
      });
    });

    it("技を入れていない枠は empty（空き）", () => {
      const sim = new ArenaSimulation(undefined, { enemies: false });
      expect(sim.setSlotSkill(2, undefined)).toBe(true);
      const slot = build(sim).skills[2];
      expect(slot).toMatchObject({
        action: "skill3",
        skill: undefined,
        name: "",
        shortName: "",
        state: "empty",
        stateLabel: text("hud.skill.empty"),
      });
    });

    it("CD中は cooldown。残り秒は0.1秒単位の表示。残りは cooldownRemaining", () => {
      const sim = new ArenaSimulation(undefined, { enemies: false });
      sim.cooldowns.start("SKL-WARRIOR-SWEEP", 4);
      const s = skillOf(build(sim), "SKL-WARRIOR-SWEEP");
      expect(s.state).toBe("cooldown");
      expect(s.cooldownRemaining).toBe(4);
      expect(s.stateLabel).toBe("4.0秒");
    });

    it("MP が足りないと mp（MP不足）", () => {
      const sim = new ArenaSimulation(undefined, { enemies: false, carry: { hp: 1, mp: 0 } });
      const s = skillOf(build(sim), "SKL-WARRIOR-SWEEP");
      expect(s.state).toBe("mp");
      expect(s.stateLabel).toBe(text("hud.skill.mp"));
    });

    it("CD中ならMPが足りなくても cooldown（CD が優先）", () => {
      const sim = new ArenaSimulation(undefined, { enemies: false, carry: { hp: 1, mp: 0 } });
      sim.cooldowns.start("SKL-WARRIOR-SWEEP", 2);
      expect(skillOf(build(sim), "SKL-WARRIOR-SWEEP").state).toBe("cooldown");
    });

    it("職能ゲージが足りないと gauge（例：怒涛は「闘志不足」）", () => {
      const sim = new ArenaSimulation(undefined, { enemies: false });
      expect(sim.setSlotSkill(5, "SKL-WARRIOR-ROUT")).toBe(true);
      const s = skillOf(build(sim), "SKL-WARRIOR-ROUT");
      expect(s.state).toBe("gauge");
      expect(s.stateLabel).toBe(`${text(sim.jobGauge.def.text as TextKey)}不足`);
    });

    it("CD中の残りの割合：始まった刻みの残りを総時間にし、減ると割合が 1→0 に向かう", () => {
      const sim = new ArenaSimulation(undefined, { enemies: false });
      const cd = new CooldownTracker();
      build(sim, { cooldowns: cd });
      sim.cooldowns.start("SKL-WARRIOR-SWEEP", 4);
      const a = skillOf(build(sim, { cooldowns: cd }), "SKL-WARRIOR-SWEEP");
      expect(a.cooldownTotal).toBe(4);
      expect(a.cooldownRatio).toBe(1);
      sim.cooldowns.update(1);
      const b = skillOf(build(sim, { cooldowns: cd }), "SKL-WARRIOR-SWEEP");
      expect(b.cooldownRemaining).toBeCloseTo(3);
      expect(b.cooldownRatio).toBeCloseTo(0.75);
      sim.cooldowns.update(3);
      const c = skillOf(build(sim, { cooldowns: cd }), "SKL-WARRIOR-SWEEP");
      expect(c.state).toBe("ready");
      expect(c.cooldownTotal).toBeUndefined();
    });

    it("途中から見た CD は、総時間が分からない（残り秒だけ出す）", () => {
      const sim = new ArenaSimulation(undefined, { enemies: false });
      sim.cooldowns.start("SKL-WARRIOR-SWEEP", 4);
      const cd = new CooldownTracker();
      const first = skillOf(build(sim, { cooldowns: cd }), "SKL-WARRIOR-SWEEP");
      expect(first.cooldownRemaining).toBe(4);
      expect(first.cooldownTotal).toBeUndefined();
      expect(first.cooldownRatio).toBeUndefined();
      sim.cooldowns.update(1);
      const next = skillOf(build(sim, { cooldowns: cd }), "SKL-WARRIOR-SWEEP");
      expect(next.cooldownTotal).toBeUndefined();
      expect(next.cooldownRatio).toBeUndefined();
    });

    it("キーの表示は、渡した割り当てを反映する（割り当てを変えたら表示も変わる）", () => {
      const sim = new ArenaSimulation(undefined, { enemies: false });
      const changed = effectiveBindings(rebind(DEFAULT_SETTINGS, "skill1", { key: "K" }));
      const m = buildHudModel(sim, { bindings: changed });
      expect(m.skills[0]?.keyLabel).toBe("K");
      expect(m.skills[0]?.keyLabel).not.toBe(shortBindingName(bindings.skill1[0]));
    });

    it("今使っている最中の枠は executing", () => {
      const sim = new ArenaSimulation(undefined, { enemies: false });
      expect(build(sim).skills.some((s) => s.executing)).toBe(false);
    });
  });

  describe("フラスコ（薬瓶）", () => {
    it("[HP, MP] の順。回数と最大", () => {
      const sim = new ArenaSimulation(undefined, {
        enemies: false,
        carry: {
          hp: 1,
          mp: 1,
          flasks: { hp: { charges: 2, fill: 0 }, mp: { charges: 1, fill: 0 } },
        },
      });
      const [hp, mp] = build(sim).flasks;
      expect(hp).toMatchObject({ id: "hp", charges: 2, max: FLASK_RULES.maxCharges });
      expect(mp).toMatchObject({ id: "mp", charges: 1, max: FLASK_RULES.maxCharges });
    });

    it("キーの表示は割り当てに従う", () => {
      const sim = new ArenaSimulation(undefined, { enemies: false });
      const m = buildHudModel(sim, {
        bindings: effectiveBindings(rebind(DEFAULT_SETTINGS, "flaskHp", { mouse: "left" })),
      });
      expect(m.flasks[0].keyLabel).toBe("左");
    });
  });

  describe("レベル", () => {
    it("キャラLv・ジョブ名・ジョブLv", () => {
      const sim = new ArenaSimulation(undefined, { enemies: false });
      const m = build(sim);
      expect(m.level.level).toBe(sim.character.level);
      expect(m.level.jobName).toBe(text(sim.job.text as TextKey));
      expect(m.level.jobLevel).toBe(sim.character.jobLevel(sim.job.id));
    });

    it("経験値の割合は 0〜1（今の経験値 ÷ 次のLvまで）", () => {
      const sim = new ArenaSimulation(undefined, { enemies: false });
      const need = sim.character.progress.toNext;
      sim.character.gainXp(need / 4);
      const m = build(sim);
      expect(m.level.xpRatio).toBeCloseTo(0.25);
      expect(m.level.xpRatio).toBeGreaterThanOrEqual(0);
      expect(m.level.xpRatio).toBeLessThanOrEqual(1);
      const job = sim.character.jobTrack(sim.job.id);
      expect(m.level.jobXpRatio).toBeCloseTo(job.xp / job.toNext);
    });

    it("上限のLvでは割合は 1", () => {
      const sim = new ArenaSimulation(undefined, { enemies: false });
      const fake = {
        mainJob: sim.character.mainJob,
        level: 50,
        progress: { toNext: 0, xp: 0 },
        jobLevel: () => 20,
        jobTrack: () => ({ toNext: 0, xp: 0 }),
        catchingUp: false,
      };
      const m = build(withOverrides(sim, { character: fake }));
      expect(m.level.xpRatio).toBe(1);
      expect(m.level.jobXpRatio).toBe(1);
    });
  });

  describe("ボス", () => {
    it("試験用の場（敵を出さない・ボスなし）にはボスがいない", () => {
      expect(build(new ArenaSimulation(undefined, { enemies: false })).boss).toBeUndefined();
    });

    it("ボスのいない場（敵はいるがボスはいない）でも undefined", () => {
      expect(build(new ArenaSimulation(undefined, {})).boss).toBeUndefined();
    });

    it("ボスのいる場（母樹の間）では、名前・HP100%・第1段階", () => {
      const sim = bossSim();
      const boss = sim.field?.enemies.find((e) => e.def.boss !== undefined);
      if (boss === undefined) throw new Error("母樹の間にボスがいない");
      const m = build(sim);
      expect(m.boss).toBeDefined();
      expect(m.boss?.name).toBe(text(boss.def.text as TextKey));
      expect(m.boss?.hpRatio).toBe(1);
      expect(m.boss?.maxHp).toBe(boss.combatant.health.maxHp);
      expect(m.boss?.level).toBe(14);
      expect(m.boss?.thresholds).toEqual([...(boss.def.boss?.phaseThresholds ?? [])]);
      expect(m.boss?.stageLabel.startsWith("第1段階／")).toBe(true);
      expect(m.boss?.phases).toBe((boss.def.boss?.phaseThresholds.length ?? 0) + 1);
    });

    it("作り物のボスで、段階・無敵・崩れ・倒れたボス（無視）を確かめる", () => {
      const sim = bossSim();
      const real = sim.field?.enemies.find((e) => e.def.boss !== undefined);
      if (real === undefined) throw new Error("ボスがいない");
      const alive = {
        def: real.def,
        state: "idle",
        level: 14,
        phase: 2,
        shielded: true,
        combatant: {
          health: { hp: 50, maxHp: 100 },
          stagger: { broken: false, current: 0, max: 100 },
        },
      };
      const field = { enemies: [alive] };
      const m = build(withOverrides(sim, { field }));
      expect(m.boss?.stageLabel).toBe(
        `第2段階／${String((real.def.boss?.phaseThresholds.length ?? 0) + 1)}（無敵）`,
      );
      expect(m.boss?.hpRatio).toBe(0.5);
      expect(m.boss?.staggerRatio).toBe(0);
      expect(m.boss?.shielded).toBe(true);
      expect(m.boss?.broken).toBe(false);

      const broken = {
        ...alive,
        shielded: false,
        combatant: { ...alive.combatant, stagger: { broken: true, current: 0, max: 100 } },
      };
      const b = build(withOverrides(sim, { field: { enemies: [broken] } }));
      expect(b.boss?.staggerRatio).toBe(1);
      expect(b.boss?.broken).toBe(true);
      expect(b.boss?.stageLabel.includes("（無敵）")).toBe(false);

      const dead = { ...alive, state: "dead" };
      const deadField = { enemies: [dead] };
      expect(build(withOverrides(sim, { field: deadField })).boss).toBeUndefined();
    });
  });

  describe("効果の札", () => {
    it("バフが無ければ空", () => {
      expect(build(new ArenaSimulation(undefined, { enemies: false })).effects).toEqual([]);
    });

    it("バフがあると kind buff の札（技以外の強化は文章のキー）", () => {
      const sim = new ArenaSimulation(undefined, { enemies: false });
      sim.buffs.add("EFF-BUFF-FOCUS", 5, "focus");
      expect(build(sim).effects).toEqual([
        { kind: "buff", label: text("hud.buff.focus"), remaining: 5, stacks: 1 },
      ]);
    });

    it("技から付いた効果は技の名前、知らない ref はそのまま出す", () => {
      const sim = new ArenaSimulation(undefined, { enemies: false });
      sim.buffs.add("EFF-X", 3, "SKL-WARRIOR-SWEEP");
      sim.buffs.add("EFF-Y", 2, "unknown-ref");
      const labels = build(sim).effects.map((e) => e.label);
      expect(labels).toEqual([
        text(sim.db.skills.get("SKL-WARRIOR-SWEEP")?.text as TextKey),
        "unknown-ref",
      ]);
    });
  });

  describe("近くの案内 prompt", () => {
    it("近くに調べられる物が無ければ undefined", () => {
      const sim = new ArenaSimulation(undefined, { enemies: false });
      expect(build(sim).prompt).toBeUndefined();
    });

    it("近くの宝箱・転移の石・施設の案内。キーは割り当ての名前", () => {
      const sim = new ArenaSimulation(undefined, { enemies: false });
      const key = shortBindingName(bindings.interact[0]);
      const chest = withOverrides(sim, {
        nearbyInteractable: () => ({ kind: "chest", chest: {} }),
      });
      expect(build(chest).prompt).toBe(`${key}：${text("hud.prompt.chest")}`);
      const stone = withOverrides(sim, { nearbyInteractable: () => ({ kind: "stone" }) });
      expect(build(stone).prompt).toBe(`${key}：${text("hud.prompt.stone")}`);
      const temple = withOverrides(sim, {
        nearbyInteractable: () => ({ kind: "facility", facility: "temple" }),
      });
      expect(build(temple).prompt).toBe(`${key}：${text("facility.temple")}`);
    });

    it("promptOf は、渡したキーの名前を使う", () => {
      const sim = new ArenaSimulation(undefined, { enemies: false });
      const src = withOverrides(sim, {
        nearbyInteractable: () => ({ kind: "secret", id: "s", points: 1 }),
      });
      expect(promptOf(src, "G")).toBe(`G：${text("hud.prompt.secret")}`);
    });
  });

  describe("その他", () => {
    it("地域の名前（試験用の場は開発用の名前）・保存の表示・試し打ち", () => {
      const sim = new ArenaSimulation(undefined, { enemies: false });
      const m = build(sim, { saveStatus: "保存した" });
      expect(m.regionName).toBe(text("hud.region.dev"));
      expect(m.saveStatus).toBe("保存した");
      expect(m.inTrial).toBe(sim.inTrial);
      expect(build(sim).saveStatus).toBe("");
    });

    it("同じ状態で2回呼ぶと結果が同じ（状態を変えない・CDの覚えも同じ）", () => {
      const sim = new ArenaSimulation(undefined, { enemies: false });
      const cd = new CooldownTracker();
      build(sim, { cooldowns: cd });
      sim.cooldowns.start("SKL-WARRIOR-SWEEP", 4);
      const hpBefore = sim.playerHealth.hp;
      const mpBefore = sim.mp;
      const remainingBefore = sim.cooldowns.remaining("SKL-WARRIOR-SWEEP");
      const first = build(sim, { cooldowns: cd });
      const second = build(sim, { cooldowns: cd });
      expect(second).toEqual(first);
      expect(sim.playerHealth.hp).toBe(hpBefore);
      expect(sim.mp).toBe(mpBefore);
      expect(sim.cooldowns.remaining("SKL-WARRIOR-SWEEP")).toBe(remainingBefore);
    });

    it("CDの覚えを使わない（undefined）でも、同じ状態なら同じ結果", () => {
      const sim = new ArenaSimulation(undefined, { enemies: false });
      expect(build(sim)).toEqual(build(sim));
    });
  });
});
