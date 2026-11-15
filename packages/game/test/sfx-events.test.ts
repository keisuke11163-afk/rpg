/** 効果音のきっかけ（audio/sfx-events.ts。Phaser・WebAudio に依存しない純粋なコード）。 */
import { describe, expect, it } from "vitest";
import { loadGameContent } from "@stella/content";
import {
  hitSfx,
  SFX_KEYS,
  SFX_MAX_PER_FRAME,
  SFX_RULES,
  SfxEventTracker,
  type SfxKey,
  SfxLimiter,
  type SfxObservation,
  skillSfx,
} from "../src/audio/sfx-events.ts";

/** 既定の規則のリミッター。 */
const limiter = (maxPerFrame?: number): SfxLimiter =>
  maxPerFrame === undefined ? new SfxLimiter() : new SfxLimiter(SFX_RULES, maxPerFrame);

/** 比べる値の既定（毎回新しい Map を作る）。 */
const baseObs = (): SfxObservation => ({
  hitsTaken: 0,
  hp: 100,
  kills: 0,
  guards: 0,
  dodging: false,
  skillUses: new Map<string, number>(),
  flaskCharges: 5,
  groundItems: 0,
  carried: 0,
  level: 1,
  jobId: "knight",
  jobLevel: 1,
  deaths: 0,
  chestsOpened: 0,
  panel: undefined,
  equipment: "sword:1",
  nodes: 0,
});
const obs = (over: Partial<SfxObservation> = {}): SfxObservation => ({ ...baseObs(), ...over });

/** 技の音の決め方の作り物（ID "SKILL-SPELL" は魔法、それ以外は近接）。 */
const skillKey = (id: string): SfxKey => (id === "SKILL-SPELL" ? "skillSpell" : "skillMelee");
/** 最初の observe を済ませたトラッカー。 */
const tracker = (start: SfxObservation = obs()): SfxEventTracker => {
  const t = new SfxEventTracker(skillKey);
  t.observe(start);
  return t;
};

describe("SFX_KEYS と SFX_RULES", () => {
  it("全てのキーに規則がある", () => {
    for (const k of SFX_KEYS) expect(SFX_RULES[k]).toBeDefined();
  });
});

describe("SfxLimiter", () => {
  it("同じフレームに同じ音を何回頼んでも1つだけ鳴る", () => {
    const l = limiter();
    l.request("hit");
    l.request("hit");
    l.request("hit");
    expect(l.flush(0)).toEqual(["hit"]);
  });

  it("前に鳴らした同じ音の間隔がちょうど最小の間隔なら鳴る", () => {
    const l = limiter();
    const min = SFX_RULES.hit.minIntervalMs;
    l.request("hit");
    expect(l.flush(0)).toEqual(["hit"]);
    l.request("hit");
    expect(l.flush(min)).toEqual(["hit"]);
  });

  it("最小の間隔より1ms短いと捨てる", () => {
    const l = limiter();
    const min = SFX_RULES.hit.minIntervalMs;
    l.request("hit");
    l.flush(0);
    l.request("hit");
    expect(l.flush(min - 1)).toEqual([]);
  });

  it("捨てた音は前に鳴らした時刻を更新しない（捨てられ続けても、間隔が過ぎたら鳴る）", () => {
    const l = limiter();
    const min = SFX_RULES.hit.minIntervalMs;
    l.request("hit");
    l.flush(0);
    for (const t of [min / 3, min - 5]) {
      l.request("hit");
      expect(l.flush(t)).toEqual([]);
    }
    l.request("hit");
    expect(l.flush(min)).toEqual(["hit"]);
  });

  it("上限（SFX_MAX_PER_FRAME）を超えたら、優先度の低い方から捨てる", () => {
    const l = limiter();
    expect(SFX_MAX_PER_FRAME).toBe(4);
    for (const k of ["ui", "hit", "dodge", "death", "hurt"] as const) l.request(k);
    // 優先度：death 100, hurt 80, dodge 25, hit 20, ui 10
    expect(l.flush(0)).toEqual(["death", "hurt", "dodge", "hit"]);
  });

  it("同じ優先度なら SFX_KEYS の順に残る", () => {
    const l = limiter(2);
    l.request("skillProjectile");
    l.request("skillBuff");
    l.request("skillMelee");
    // 3つとも優先度30。SFX_KEYS の順は skillMelee → skillProjectile → skillBuff
    expect(l.flush(0)).toEqual(["skillMelee", "skillProjectile"]);
  });

  it("鳴らす音は優先度の高い順に返す", () => {
    const l = limiter();
    l.request("pickup");
    l.request("levelUp");
    l.request("flask");
    expect(l.flush(0)).toEqual(["levelUp", "flask", "pickup"]);
  });

  it("maxPerFrame が 0 なら、頼んでも何も鳴らない", () => {
    const l = limiter(0);
    l.request("hit");
    l.request("death");
    expect(l.flush(0)).toEqual([]);
  });

  it("request(undefined) は無視する", () => {
    const l = limiter();
    l.request(undefined);
    expect(l.flush(0)).toEqual([]);
  });

  it("flush の後は頼んだ音が空になり、次の flush で同じ音は出ない", () => {
    const l = limiter();
    expect(l.flush(0)).toEqual([]);
    l.request("hit");
    expect(l.flush(0)).toEqual(["hit"]);
    expect(l.flush(1000)).toEqual([]);
  });

  it("上限で捨てられた音は、鳴っていないので次のフレームに頼み直せば鳴る", () => {
    const l = limiter(1);
    l.request("hit");
    l.request("death");
    expect(l.flush(0)).toEqual(["death"]);
    l.request("hit");
    expect(l.flush(10)).toEqual(["hit"]);
  });

  it("時刻が戻ると、戻った分だけ同じ音が鳴らない（仕様の確認。表示の時計は単調に増える前提）", () => {
    const l = limiter();
    l.request("kill");
    expect(l.flush(10000)).toEqual(["kill"]);
    // 時計が 0 に戻った：前に鳴らした 10000 から最小の間隔が過ぎるまで鳴らない
    l.request("kill");
    expect(l.flush(0)).toEqual([]);
    expect(l.flush(5000)).toEqual([]);
    l.request("kill");
    expect(l.flush(10000 + SFX_RULES.kill.minIntervalMs)).toEqual(["kill"]);
  });
});

describe("hitSfx", () => {
  const hit = (crit: boolean, evaded: boolean, staggerBroke: boolean) => ({
    hit: { crit, evaded },
    staggerBroke,
  });

  it("通常のヒットは hit", () => {
    expect(hitSfx(hit(false, false, false))).toBe("hit");
  });

  it("会心は crit", () => {
    expect(hitSfx(hit(true, false, false))).toBe("crit");
  });

  it("崩しは break。会心と重なっても崩しが優先", () => {
    expect(hitSfx(hit(false, false, true))).toBe("break");
    expect(hitSfx(hit(true, false, true))).toBe("break");
  });

  it("回避されたヒットは、崩しでも会心でも鳴らさない（undefined）", () => {
    expect(hitSfx(hit(false, true, false))).toBeUndefined();
    expect(hitSfx(hit(true, true, false))).toBeUndefined();
    expect(hitSfx(hit(true, true, true))).toBeUndefined();
  });
});

describe("skillSfx", () => {
  it("召喚のタグか召喚の動きなら skillSummon", () => {
    expect(skillSfx(["TAG-FORM-SUMMON"])).toBe("skillSummon");
    expect(skillSfx([], "summon")).toBe("skillSummon");
  });

  it("魔法のタグなら skillSpell", () => {
    expect(skillSfx(["TAG-FORM-SPELL"])).toBe("skillSpell");
  });

  it("投射のタグか投射の動きなら skillProjectile", () => {
    expect(skillSfx(["TAG-FORM-PROJECTILE"])).toBe("skillProjectile");
    expect(skillSfx([], "projectile")).toBe("skillProjectile");
  });

  it("戦吼・強化（タグか動き）は skillBuff", () => {
    expect(skillSfx(["TAG-FORM-WARCRY"])).toBe("skillBuff");
    expect(skillSfx([], "warcry")).toBe("skillBuff");
    expect(skillSfx([], "selfBuff")).toBe("skillBuff");
    expect(skillSfx([], "command")).toBe("skillBuff");
  });

  it("どれにも当たらない・タグが空なら skillMelee", () => {
    expect(skillSfx([])).toBe("skillMelee");
    expect(skillSfx(["TAG-FORM-MELEE"], "strike")).toBe("skillMelee");
    expect(skillSfx([], undefined)).toBe("skillMelee");
    expect(skillSfx([], "trap")).toBe("skillMelee");
  });

  it("優先：召喚 > 魔法 > 投射 > 強化・戦吼 > 近接", () => {
    expect(
      skillSfx(["TAG-FORM-WARCRY", "TAG-FORM-PROJECTILE", "TAG-FORM-SPELL", "TAG-FORM-SUMMON"]),
    ).toBe("skillSummon");
    expect(skillSfx(["TAG-FORM-WARCRY", "TAG-FORM-PROJECTILE", "TAG-FORM-SPELL"])).toBe(
      "skillSpell",
    );
    expect(skillSfx(["TAG-FORM-WARCRY", "TAG-FORM-PROJECTILE"])).toBe("skillProjectile");
    expect(skillSfx(["TAG-FORM-WARCRY"], "strike")).toBe("skillBuff");
    // 魔法のタグは、投射の動きより優先
    expect(skillSfx(["TAG-FORM-SPELL"], "projectile")).toBe("skillSpell");
    // 動きが投射でもタグが近接なら投射
    expect(skillSfx(["TAG-FORM-MELEE"], "projectile")).toBe("skillProjectile");
  });

  it("実際の技の定義（content）は、全部いずれかの音になり、召喚の技は召喚の音になる", () => {
    const db = loadGameContent();
    const valid = new Set<string>(SFX_KEYS);
    let count = 0;
    for (const def of db.skills.values()) {
      const key = skillSfx(def.tags, def.action.type);
      expect(valid.has(key)).toBe(true);
      if (def.tags.includes("TAG-FORM-SUMMON")) expect(key).toBe("skillSummon");
      count++;
    }
    expect(count).toBeGreaterThan(0);
  });
});

describe("SfxEventTracker", () => {
  it("最初の observe は比べる相手が無いので空", () => {
    const t = new SfxEventTracker(skillKey);
    expect(t.observe(obs({ deaths: 1, kills: 3, guards: 2, chestsOpened: 1, level: 5 }))).toEqual(
      [],
    );
  });

  it("被弾：回数が増え、HP が減ったら hurt", () => {
    const t = tracker();
    expect(t.observe(obs({ hitsTaken: 1, hp: 100 }))).toEqual([]);
    expect(t.observe(obs({ hitsTaken: 2, hp: 90 }))).toEqual(["hurt"]);
  });

  it("回数が増えても HP が減らなければ hurt なし（盾で防いだ・吸収した）", () => {
    const t = tracker();
    expect(t.observe(obs({ hitsTaken: 1, hp: 100 }))).toEqual([]);
  });

  it("HP が減っても回数が増えなければ hurt なし", () => {
    const t = tracker();
    expect(t.observe(obs({ hp: 80 }))).toEqual([]);
  });

  it("倒れた（deaths が増えた）フレームは death だけ（hurt は鳴らさない）", () => {
    const t = tracker();
    expect(t.observe(obs({ deaths: 1, hitsTaken: 4, hp: 0 }))).toEqual(["death"]);
  });

  it("kills が増えたら kill", () => {
    const t = tracker();
    expect(t.observe(obs({ kills: 1 }))).toEqual(["kill"]);
  });

  it("guards が増えたら guard", () => {
    const t = tracker();
    expect(t.observe(obs({ guards: 1 }))).toEqual(["guard"]);
  });

  it("dodging が false→true のときだけ dodge。true のままでは鳴らない", () => {
    const t = tracker();
    expect(t.observe(obs({ dodging: true }))).toEqual(["dodge"]);
    expect(t.observe(obs({ dodging: true }))).toEqual([]);
  });

  it("技の使った回数が増えたら、constructor の skillKey の音を鳴らす（技のIDを渡す）", () => {
    const t = tracker();
    expect(t.observe(obs({ skillUses: new Map([["SKILL-SPELL", 1]]) }))).toEqual(["skillSpell"]);
    expect(t.observe(obs({ skillUses: new Map([["SKILL-SPELL", 1]]) }))).toEqual([]);
    expect(t.observe(obs({ skillUses: new Map([["SKILL-SPELL", 2]]) }))).toEqual(["skillSpell"]);
    expect(t.observe(obs({ skillUses: new Map([["SKILL-MELEE", 1]]) }))).toEqual(["skillMelee"]);
  });

  it("同じ Map を渡し続けて中身だけ増やしても、技の音が鳴る（実装が写しを取っているか）", () => {
    const uses = new Map<string, number>();
    const t = new SfxEventTracker(skillKey);
    t.observe(obs({ skillUses: uses }));
    uses.set("SKILL-SPELL", 1);
    expect(t.observe(obs({ skillUses: uses }))).toEqual(["skillSpell"]);
  });

  it("薬瓶の残りが減ったら flask。増えた（補充）ときは鳴らない", () => {
    const t = tracker();
    expect(t.observe(obs({ flaskCharges: 4 }))).toEqual(["flask"]);
    expect(t.observe(obs({ flaskCharges: 9 }))).toEqual([]);
  });

  it("地面の物が減り、かつ持ち物が増えたら pickup", () => {
    const t = tracker(obs({ groundItems: 2, carried: 0 }));
    expect(t.observe(obs({ groundItems: 1, carried: 1 }))).toEqual(["pickup"]);
  });

  it("地面の物だけ減った・持ち物だけ増えたときは pickup なし", () => {
    const a = tracker(obs({ groundItems: 2, carried: 0 }));
    expect(a.observe(obs({ groundItems: 1, carried: 0 }))).toEqual([]);
    const b = tracker(obs({ groundItems: 2, carried: 0 }));
    expect(b.observe(obs({ groundItems: 2, carried: 3 }))).toEqual([]);
  });

  it("level が上がったら levelUp", () => {
    const t = tracker();
    expect(t.observe(obs({ level: 2 }))).toEqual(["levelUp"]);
  });

  it("同じ職のまま jobLevel が上がったら levelUp", () => {
    const t = tracker();
    expect(t.observe(obs({ jobLevel: 2 }))).toEqual(["levelUp"]);
  });

  it("level と jobLevel が同時に上がっても levelUp は1回", () => {
    const t = tracker();
    expect(t.observe(obs({ level: 2, jobLevel: 2 }))).toEqual(["levelUp"]);
  });

  it("jobId が変わったフレームの jobLevel の変化は数えない", () => {
    const t = tracker(obs({ jobId: "knight", jobLevel: 3 }));
    expect(t.observe(obs({ jobId: "mage", jobLevel: 1 }))).toEqual([]);
    const u = tracker(obs({ jobId: "knight", jobLevel: 3 }));
    expect(u.observe(obs({ jobId: "mage", jobLevel: 9 }))).toEqual([]);
  });

  it("宝箱の数が増えたら chest", () => {
    const t = tracker();
    expect(t.observe(obs({ chestsOpened: 1 }))).toEqual(["chest"]);
  });

  it("画面を開いた・切り替えたら ui。閉じた（undefined になった）ときは鳴らさない", () => {
    const t = tracker();
    expect(t.observe(obs({ panel: "inventory" }))).toEqual(["ui"]);
    expect(t.observe(obs({ panel: "inventory" }))).toEqual([]);
    expect(t.observe(obs({ panel: "map" }))).toEqual(["ui"]);
    expect(t.observe(obs({ panel: undefined }))).toEqual([]);
  });

  it("装備の文字が変わったら ui", () => {
    const t = tracker();
    expect(t.observe(obs({ equipment: "sword:2" }))).toEqual(["ui"]);
  });

  it("取ったノードが増えたら ui。減ったら鳴らさない", () => {
    const t = tracker();
    expect(t.observe(obs({ nodes: 1 }))).toEqual(["ui"]);
    expect(t.observe(obs({ nodes: 0 }))).toEqual([]);
  });

  it("1回の observe の結果に同じ音は重ならない（同じ音になる技が2つ増えても1つ）", () => {
    const t = tracker();
    const out = t.observe(
      obs({
        skillUses: new Map([
          ["SKILL-A", 1],
          ["SKILL-B", 1],
        ]),
      }),
    );
    expect(out).toEqual(["skillMelee"]);
  });

  it("1回の observe で複数の出来事があれば、それぞれ1回ずつ", () => {
    const t = tracker();
    const out = t.observe(obs({ kills: 1, guards: 1, dodging: true, level: 2, chestsOpened: 1 }));
    expect([...out].sort()).toEqual(["chest", "dodge", "guard", "kill", "levelUp"].sort());
  });

  it("場面の作り直しで値が 0 に戻っても、鳴らさない（hitsTaken・kills・deaths・level）", () => {
    const t = tracker(
      obs({ hitsTaken: 5, hp: 40, kills: 3, deaths: 2, level: 4, jobLevel: 4, guards: 2 }),
    );
    expect(
      t.observe(
        obs({ hitsTaken: 0, hp: 100, kills: 0, deaths: 0, level: 1, jobLevel: 1, guards: 0 }),
      ),
    ).toEqual([]);
  });
});
