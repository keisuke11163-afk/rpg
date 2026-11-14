/**
 * サブジョブ（仕様書v0.2 5.1・MVP後の機能の提案 2章。docs/progress D-SUB-1〜D-SUB-8）の core の規則：
 * Lvの上限・サブジョブの選択・副職紋のポイント・サブジョブの技・効果の出どころの読み替え・契約枠。
 * 実際のデータを使う確認（能力値・セーブ）は packages/content/test/subjob.test.ts。
 */
import { describe, expect, it } from "vitest";
import {
  Character,
  EFFECT_ORIGINS,
  JOB_LEVEL_CAP,
  type JobDef,
  LEVEL_CAP,
  MORE_ALLOWED_ORIGINS,
  SUB_JOB_BOARD_MAX_POINTS,
  SUB_JOB_LEVEL,
  SUB_SKILL_SLOT_LIMIT,
  canSlotSubSkill,
  contractCapacity,
  contractSource,
  dualWieldAffinity,
  evaluateEffects,
  jobBoardPoints,
  jobBoardRespecCost,
  jobContractCapacity,
  jobSchema,
  skillSchema,
  subJobBoardPoints,
  subJobBoardRespecCost,
  subSkillsInSlots,
  unlockedSkills,
  unlockedSubSkills,
  usableAsSubSkill,
  xpToNext,
} from "../src/index.ts";
import { TagIndex } from "../src/effects/tag-index.ts";
import { effect, fullCombatDb } from "./helpers/content.ts";

const job = (id: string, extra: Partial<JobDef> = {}): JobDef => ({
  id,
  tag: `TAG-${id}`,
  text: "j.x",
  skills: [
    { skill: `SKL-${id}-A`, level: 1 },
    { skill: `SKL-${id}-B`, level: 5 },
    { skill: `SKL-${id}-C`, level: 12 },
  ],
  affinity: {},
  subSkills: { skills: [`SKL-${id}-A`, `SKL-${id}-C`] },
  ...extra,
});
const W = job("JOB-W", { dualWield: "B" });
const R = job("JOB-R", { dualWield: "A" });
const M = job("JOB-M");
const ADV = job("JOB-ADV", { advancedFrom: ["JOB-W"] });
const JOBS: ReadonlyMap<string, JobDef> = new Map([W, R, M, ADV].map((j) => [j.id, j]));

const at = (level: number, extra: Partial<ConstructorParameters<typeof Character>[0]> = {}) =>
  new Character({
    jobs: JOBS,
    origin: W,
    level,
    jobLevels: { "JOB-W": 20, "JOB-R": 10 },
    ...extra,
  });

describe("Lvの上限（D-SUB-1）", () => {
  it("キャラLv・ジョブLvの上限は25。サブジョブはキャラLv25で開く", () => {
    expect([LEVEL_CAP, JOB_LEVEL_CAP, SUB_JOB_LEVEL]).toEqual([25, 25, 25]);
    const c = new Character({ jobs: JOBS, origin: W });
    c.gainXp(Number.MAX_VALUE / 4);
    expect([c.level, c.jobLevel("JOB-W"), c.progress.toNext]).toEqual([25, 25, 0]);
  });

  it("Lv20にちょうど届く経験値で、Lv20・ジョブLv20に止まる（撃破時間の計測の固定）", () => {
    const c = new Character({ jobs: JOBS, origin: W });
    const xp = Array.from({ length: 19 }, (_, i) => xpToNext(i + 1)).reduce((a, b) => a + b, 0);
    c.gainXp(xp);
    expect([c.level, c.progress.xp, c.jobLevel("JOB-W"), c.jobTrack("JOB-W").xp]).toEqual([
      20, 0, 20, 0,
    ]);
    expect(c.progress.toNext).toBe(xpToNext(20));
  });
});

describe("サブジョブの選択（D-SUB-5）", () => {
  it("サブジョブを設定しなければ、今までどおり（undefined。knownJobs も変わらない）", () => {
    const c = at(25);
    expect(c.subJob).toBeUndefined();
    expect(c.knownJobs.sort()).toEqual(["JOB-R", "JOB-W"]);
    expect(c.clearSubJob()).toBe(false);
  });

  it("キャラLv24では設定できない（level）。Lv25でできる", () => {
    const low = at(24);
    expect(low.canSetSubJob).toBe(false);
    expect(low.subJobBlock("JOB-R")).toBe("level");
    expect(low.setSubJob("JOB-R")).toBe(false);
    expect(low.subJob).toBeUndefined();
    const c = at(25);
    expect(c.canSetSubJob).toBe(true);
    expect(c.subJobBlock("JOB-R")).toBeUndefined();
    expect(c.setSubJob("JOB-R")).toBe(true);
    expect(c.subJob).toBe("JOB-R");
    // サブジョブのジョブLvは、ジョブごとのジョブLvをそのまま使う
    expect(c.jobLevel("JOB-R")).toBe(10);
  });

  it("メインと同じジョブ（sameAsMain）・上位職（advanced）は設定できない。存在しないジョブは RangeError", () => {
    const c = at(25);
    expect(c.subJobBlock("JOB-W")).toBe("sameAsMain");
    expect(c.setSubJob("JOB-W")).toBe(false);
    expect(c.subJobBlock("JOB-ADV")).toBe("advanced");
    expect(c.setSubJob("JOB-ADV")).toBe(false);
    expect(() => c.setSubJob("JOB-NOPE")).toThrow(RangeError);
    expect(() => c.subJobBlock("JOB-NOPE")).toThrow(RangeError);
    expect(c.subJob).toBeUndefined();
  });

  it("変える・外す。同じジョブを設定し直すと false", () => {
    const c = at(25);
    expect(c.setSubJob("JOB-R")).toBe(true);
    expect(c.setSubJob("JOB-R")).toBe(false);
    expect(c.setSubJob("JOB-M")).toBe(true);
    expect(c.subJob).toBe("JOB-M");
    // 新しくサブにしたジョブも、ジョブLvの記録を持つ（セーブに残る）
    expect(c.knownJobs).toContain("JOB-M");
    expect(c.jobLevel("JOB-M")).toBe(1);
    expect(c.clearSubJob()).toBe(true);
    expect(c.subJob).toBeUndefined();
  });

  it("サブジョブと同じジョブに転職すると、サブジョブを外す。違うジョブなら残す", () => {
    const c = at(25);
    c.setSubJob("JOB-R");
    expect(c.changeJob("JOB-M")).toBe(true);
    expect(c.subJob).toBe("JOB-R");
    expect(c.changeJob("JOB-R")).toBe(true);
    expect([c.mainJob, c.subJob]).toEqual(["JOB-R", undefined]);
  });

  it("経験値はメインジョブだけに入る（サブジョブのジョブLvは上がらない。D-SUB-9）", () => {
    const c = at(25);
    c.setSubJob("JOB-R");
    const before = c.jobTrack("JOB-R").xp;
    c.gainXp(500);
    expect([c.jobLevel("JOB-R"), c.jobTrack("JOB-R").xp]).toEqual([10, before]);
  });

  it("作るときのサブジョブ（セーブから戻す）：設定できなければ RangeError", () => {
    expect(at(25, { subJob: "JOB-R" }).subJob).toBe("JOB-R");
    for (const [level, sub] of [
      [24, "JOB-R"],
      [25, "JOB-W"],
      [25, "JOB-ADV"],
      [25, "JOB-NOPE"],
    ] as const)
      expect(() => at(level, { subJob: sub })).toThrow(RangeError);
  });
});

describe("副職紋のポイント（D-SUB-2）", () => {
  it("min(20, ジョブLv−1)。ジョブLv20で19、21で20、25でも20", () => {
    expect(SUB_JOB_BOARD_MAX_POINTS).toBe(20);
    expect([1, 2, 20, 21, 22, 25].map(subJobBoardPoints)).toEqual([0, 1, 19, 20, 20, 20]);
    // メインの職紋盤は上限なし（ジョブLv−1）
    expect(jobBoardPoints(25)).toBe(24);
    expect(() => subJobBoardPoints(0)).toThrow(RangeError);
  });

  it("振り直しの金貨はメインの職紋盤と同じ（20 × ジョブLv）", () => {
    expect(subJobBoardRespecCost(12)).toBe(jobBoardRespecCost(12));
    expect(subJobBoardRespecCost(25)).toBe(500);
  });
});

describe("サブジョブの技（D-SUB-4・D-SUB-6）", () => {
  it("subSkills のうち、サブジョブのジョブLvで覚えているものだけ（unlockedSkills と同じ規則）", () => {
    expect(unlockedSubSkills(W, 1)).toEqual(["SKL-JOB-W-A"]);
    expect(unlockedSubSkills(W, 11)).toEqual(["SKL-JOB-W-A"]);
    expect(unlockedSubSkills(W, 12)).toEqual(["SKL-JOB-W-A", "SKL-JOB-W-C"]);
    const none: JobDef = { ...W, subSkills: undefined };
    expect(unlockedSubSkills(none, 25)).toEqual([]);
    // メインの技の覚え方は変わらない
    expect(unlockedSkills(W, 12)).toEqual(["SKL-JOB-W-A", "SKL-JOB-W-B", "SKL-JOB-W-C"]);
  });

  it("技の枠6つのうち、サブジョブの技は2つまで", () => {
    expect(SUB_SKILL_SLOT_LIMIT).toBe(2);
    const sub = ["SKL-S1", "SKL-S2", "SKL-S3"];
    const slots = ["SKL-BASIC", "SKL-S1", undefined, "SKL-MAIN", undefined, undefined];
    expect(subSkillsInSlots(slots, sub)).toBe(1);
    expect(canSlotSubSkill(slots, 2, "SKL-S2", sub)).toBe(true);
    const full = ["SKL-BASIC", "SKL-S1", "SKL-S2", undefined, undefined, undefined];
    expect(canSlotSubSkill(full, 3, "SKL-S3", sub)).toBe(false);
    // サブジョブの技を置き換えるなら入れられる
    expect(canSlotSubSkill(full, 2, "SKL-S3", sub)).toBe(true);
    // サブジョブの技でないものは、この関数では入れられない
    expect(canSlotSubSkill(slots, 2, "SKL-MAIN", sub)).toBe(false);
  });

  it("subJobRule が unavailable の技（戦士の解放技）は、サブジョブの技として使えない", () => {
    const base = {
      id: "SKL-X",
      text: "s.x",
      tags: [],
      kind: "weapon",
      pct: 1,
      mpCost: 0,
      cooldown: 0,
      action: { type: "selfBuff", effects: ["EFF-X"], duration: 1 },
    };
    expect(usableAsSubSkill(skillSchema.parse(base))).toBe(true);
    const rout = skillSchema.parse({ ...base, subJobRule: "unavailable" });
    expect(usableAsSubSkill(rout)).toBe(false);
    expect(skillSchema.safeParse({ ...base, subJobRule: "simplified" }).success).toBe(false);
  });

  it("ジョブ定義の検証：subSkills はそのジョブの技から、重ならない2つ", () => {
    const raw = {
      id: "JOB-X",
      tag: "TAG-JOB-X",
      text: "j.x",
      skills: [
        { skill: "SKL-X-A", level: 1 },
        { skill: "SKL-X-B", level: 3 },
      ],
      affinity: {},
    };
    expect(jobSchema.safeParse(raw).success).toBe(true);
    expect(
      jobSchema.safeParse({ ...raw, subSkills: { skills: ["SKL-X-A", "SKL-X-B"] } }).success,
    ).toBe(true);
    expect(
      jobSchema.safeParse({
        ...raw,
        subSkills: { skills: ["SKL-X-A", "SKL-X-B"], provisional: true, provisionalNote: "仮" },
      }).success,
    ).toBe(true);
    for (const skills of [
      ["SKL-X-A", "SKL-OTHER"],
      ["SKL-X-A", "SKL-X-A"],
      ["SKL-X-A"],
      ["SKL-X-A", "SKL-X-B", "SKL-X-B"],
    ])
      expect(jobSchema.safeParse({ ...raw, subSkills: { skills } }).success).toBe(false);
  });
});

describe("武器適性・二刀流（D-SUB-7）", () => {
  it("サブジョブを渡さなければ、メインだけの結果と同じ。渡すと1段階下げて高い方", () => {
    expect(dualWieldAffinity(M)).toBeUndefined();
    expect(dualWieldAffinity(M, undefined)).toBeUndefined();
    expect(dualWieldAffinity(M, R)).toBe("B");
    expect(dualWieldAffinity(W, R)).toBe("B");
    expect(dualWieldAffinity(R, W)).toBe("A");
  });
});

describe("効果の出どころ：サブジョブ（D-SUB-3）", () => {
  it("subJob は出どころの一覧にあり、乗算は持てない（職紋盤のノードと同じ）", () => {
    expect(EFFECT_ORIGINS).toContain("subJob");
    expect(MORE_ALLOWED_ORIGINS.has("subJob")).toBe(MORE_ALLOWED_ORIGINS.has("jobNode"));
    expect(MORE_ALLOWED_ORIGINS.has("subJob")).toBe(false);
  });

  it("効果の出どころを読み替えると、内訳の origin が変わる。値は同じ。読み替えなければ今までどおり", () => {
    const db = fullCombatDb([
      effect("EFF-NODE-DMG", "jobNode", [{ kind: "increased", stat: "STAT-DAMAGE", value: 0.1 }]),
    ]);
    const tags = new TagIndex(db.tags);
    const plain = evaluateEffects(db, tags, [
      { effectId: "EFF-NODE-DMG", source: { kind: "jobNode", ref: "N1" } },
    ]).view.stat("STAT-DAMAGE");
    const sub = evaluateEffects(db, tags, [
      { effectId: "EFF-NODE-DMG", source: { kind: "subJobNode", ref: "N1" }, origin: "subJob" },
    ]).view.stat("STAT-DAMAGE");
    expect(sub.value).toBe(plain.value);
    expect(plain.contributions.map((c) => c.origin)).toEqual(["jobNode"]);
    expect(sub.contributions.map((c) => [c.origin, c.source.kind])).toEqual([
      ["subJob", "subJobNode"],
    ]);
  });
});

describe("契約枠（D-SUB-6）", () => {
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
  const db = fullCombatDb([], { gauges: [CONTRACT, FOCUS] });
  const summoner = job("JOB-S", { gauge: "GAU-CONTRACT" });
  const archer = job("JOB-A", { gauge: "GAU-FOCUS" });

  it("メインが召喚士ならメイン（加算が効く）。サブだけが召喚士なら6に固定。どちらでもなければ0", () => {
    expect(contractSource(db, summoner)?.as).toBe("main");
    expect(jobContractCapacity(db, summoner, undefined, 1)).toBe(11);
    // メインが召喚士なら、サブが何でもメインの枠
    expect(jobContractCapacity(db, summoner, archer, 4)).toBe(14);
    expect(contractSource(db, archer, summoner)?.as).toBe("sub");
    expect(jobContractCapacity(db, archer, summoner, 4)).toBe(6);
    expect(jobContractCapacity(db, archer, summoner)).toBe(
      contractCapacity(db.gauges.get("GAU-CONTRACT") ?? (CONTRACT as never), "sub"),
    );
    expect(contractSource(db, archer)).toBeUndefined();
    expect(jobContractCapacity(db, archer)).toBe(0);
    expect(jobContractCapacity(db, archer, job("JOB-N"))).toBe(0);
  });
});
