/**
 * サブジョブのセーブの追加の確認（実データ）：往復（JSON の文字列を通す）・サブジョブの無い古い形のセーブ・
 * 壊れたサブジョブ・壊れた副職紋の拒否・版（SAVE_VERSION は 6 のまま）。
 * 基本の確認は packages/content/test/subjob.test.ts。
 */
import {
  Character,
  Equipment,
  Inventory,
  type JobDef,
  type PlayerProfile,
  SAVE_VERSION,
  type SaveData,
  SaveDataError,
  STASH_SLOTS,
  emptyKeptFields,
  emptyLoadout,
  fromSaveData,
  toSaveData,
} from "@stella/core";
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../src/index.ts";

const db = loadGameContent();
const job = (id: string): JobDef => {
  const j = db.jobs.get(id);
  if (j === undefined) throw new Error(`${id} がない`);
  return j;
};
const MAGE = "JOB-MAGE";
const KNIGHT = "JOB-KNIGHT";
const ARCHER = "JOB-ARCHER";

/** ジョブの盤の、副職紋で取れるノード（小ノードと輝星）。 */
const subNodesOf = (jobId: string): string[] =>
  [...db.jobNodes.values()]
    .filter((n) => n.job === jobId && (n.kind === "minor" || n.kind === "notable"))
    .map((n) => n.id);
/** ジョブの盤の、職奥義・接続ノード（副職紋では取れない）。 */
const blockedNodesOf = (jobId: string): string[] =>
  [...db.jobNodes.values()]
    .filter((n) => n.job === jobId && (n.kind === "mastery" || n.kind === "connector"))
    .map((n) => n.id);

/**
 * メイン魔法使い（キャラLv25）・サブ騎士（サブジョブのジョブLv20）・副職紋を持つ魔法使いのプロフィール。
 * 副職紋（ジョブごと）は subBoards に入れる。
 */
function profileOf(opts: {
  level?: number;
  sub?: string | undefined;
  subBoards?: Record<string, readonly string[]>;
}): PlayerProfile {
  const character = new Character({
    jobs: db.jobs,
    origin: job(MAGE),
    level: opts.level ?? 25,
    jobLevels: { [MAGE]: 20, [KNIGHT]: 20, [ARCHER]: 9 },
    ...(opts.sub === undefined ? {} : { subJob: opts.sub }),
  });
  return {
    name: "セーブ試験",
    character,
    equipment: new Equipment(db),
    inventory: new Inventory(),
    stash: new Inventory(STASH_SLOTS),
    skillSlots: new Map(),
    starAllocation: [],
    loadouts: [emptyLoadout(1, MAGE)],
    activeLoadout: 1,
    unlockedRegions: [],
    deathLog: { count: 0, lastCause: null },
    questStages: [],
    secretsFound: [],
    bossKills: {},
    kept: { ...emptyKeptFields(), subBoards: opts.subBoards ?? {} },
  };
}

const load = (data: unknown): PlayerProfile => fromSaveData(db, data as SaveData);

/** 壊れたセーブを読むと、参照の誤り（reference）で、文章に text を含む SaveDataError になる。 */
function expectBroken(data: unknown, text: string): void {
  let caught: unknown;
  try {
    load(data);
  } catch (e) {
    caught = e;
  }
  expect(caught, text).toBeInstanceOf(SaveDataError);
  expect((caught as SaveDataError).kind, text).toBe("reference");
  expect((caught as Error).message, text).toContain(text);
}

describe("セーブの往復（JSON の文字列を通す）", () => {
  it("サブ騎士・副職紋（騎士と、前にサブだった弓の2つ）が、文字列にして戻しても同じ", () => {
    const knightNodes = subNodesOf(KNIGHT).slice(0, 8);
    const archerNodes = subNodesOf(ARCHER).slice(0, 3);
    const data = toSaveData(
      db,
      profileOf({ sub: KNIGHT, subBoards: { [KNIGHT]: knightNodes, [ARCHER]: archerNodes } }),
    );
    const text = JSON.stringify(data);
    const parsed = JSON.parse(text) as SaveData;
    const back = load(parsed);
    expect(back.character.subJob).toBe(KNIGHT);
    expect(back.kept.subBoards).toEqual({ [KNIGHT]: knightNodes, [ARCHER]: archerNodes });
    expect(toSaveData(db, back)).toEqual(data);
    expect(JSON.stringify(toSaveData(db, back))).toBe(text);
  });
});

describe("サブジョブの無い古い形のセーブ", () => {
  it("サブジョブが無ければ、sub_job は null で、sub_job_boards は文字列にも出ない。そのまま読める", () => {
    const data = toSaveData(db, profileOf({}));
    expect(data.character.sub_job).toBeNull();
    expect(JSON.stringify(data)).not.toContain("sub_job_boards");
    const back = load(JSON.parse(JSON.stringify(data)));
    expect(back.character.subJob).toBeUndefined();
    expect(back.kept.subBoards).toEqual({});
    expect(toSaveData(db, back)).toEqual(data);
  });

  it("副職紋の取得が空の配列だけなら、sub_job_boards は出ない（古い形と同じ）", () => {
    const data = toSaveData(
      db,
      profileOf({ sub: KNIGHT, subBoards: { [KNIGHT]: [], [ARCHER]: [] } }),
    );
    expect(data.character.sub_job).toBe(KNIGHT);
    expect("sub_job_boards" in data).toBe(false);
    expect(load(data).kept.subBoards).toEqual({});
  });
});

describe("壊れたサブジョブを拒否する", () => {
  it("キャラLv24なのに sub_job がある（level）", () => {
    const data = toSaveData(db, profileOf({ sub: KNIGHT }));
    expectBroken(
      { ...data, character: { ...data.character, level: 24, xp: 0 } },
      "サブジョブ JOB-KNIGHT は設定できない（level）",
    );
  });

  it("sub_job がメインの魔法使いと同じ（sameAsMain）", () => {
    const data = toSaveData(db, profileOf({ sub: KNIGHT }));
    expectBroken(
      { ...data, character: { ...data.character, sub_job: MAGE } },
      "サブジョブ JOB-MAGE は設定できない（sameAsMain）",
    );
  });

  it("sub_job がデータに無いジョブID", () => {
    const data = toSaveData(db, profileOf({ sub: KNIGHT }));
    expectBroken(
      { ...data, character: { ...data.character, sub_job: "JOB-GHOST" } },
      "サブジョブ JOB-GHOST がデータに無い",
    );
  });
});

describe("壊れた副職紋を拒否する", () => {
  const nodesOf = (jobId: string, n: number): string[] => subNodesOf(jobId).slice(0, n);

  it("ポイントを超える：騎士のジョブLv10（9ポイント）に、10ノードは入らない", () => {
    const data = toSaveData(db, profileOf({ sub: KNIGHT }));
    const tenNodes = nodesOf(KNIGHT, 10);
    expect(tenNodes).toHaveLength(10);
    const low = {
      ...data,
      jobs: { ...data.jobs, [KNIGHT]: { ...data.jobs[KNIGHT], level: 10, xp: 0 } },
      sub_job_boards: { [KNIGHT]: tenNodes },
    };
    expectBroken(low, "ポイント（9）を超える");
    // ちょうど9なら読める
    expect(
      load({ ...low, sub_job_boards: { [KNIGHT]: nodesOf(KNIGHT, 9) } }).kept.subBoards[KNIGHT],
    ).toHaveLength(9);
  });

  it("職奥義・接続ノードを含む（副職紋では mastery・connector は取れない）", () => {
    const data = toSaveData(db, profileOf({ sub: KNIGHT }));
    const withBoard = (nodes: string[]) => ({ ...data, sub_job_boards: { [KNIGHT]: nodes } });
    for (const bad of [...blockedNodesOf(KNIGHT)].slice(0, 2))
      expectBroken(withBoard([...nodesOf(KNIGHT, 3), bad]), "副職紋では");
  });

  it("存在しないノードID・ほかのジョブのノード", () => {
    const data = toSaveData(db, profileOf({ sub: KNIGHT }));
    const withBoard = (nodes: string[]) => ({ ...data, sub_job_boards: { [KNIGHT]: nodes } });
    expectBroken(withBoard([...nodesOf(KNIGHT, 2), "JBN-NOPE-X1"]), "職紋盤のノード JBN-NOPE-X1");
    const otherJob = subNodesOf(ARCHER)[0];
    expect(otherJob).toBeDefined();
    expectBroken(
      withBoard([...nodesOf(KNIGHT, 2), otherJob ?? ""]),
      "ジョブ JOB-KNIGHT の盤ではない",
    );
  });
});

describe("版", () => {
  it("セーブの版は 6 のまま。書き出す形も版 6", () => {
    expect(SAVE_VERSION).toBe(6);
    const data = toSaveData(
      db,
      profileOf({ sub: KNIGHT, subBoards: { [KNIGHT]: subNodesOf(KNIGHT).slice(0, 2) } }),
    );
    expect(data.save_version).toBe(6);
    expect(data.sub_job_boards?.[KNIGHT]).toHaveLength(2);
  });
});
