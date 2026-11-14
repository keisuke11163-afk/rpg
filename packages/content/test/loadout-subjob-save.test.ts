/**
 * ロードアウトのサブジョブのセーブ（仕様書v0.2 4.13・docs/progress D-LOAD-1）：使っていないロードアウトの
 * loadouts[].sub_job（省略できる・版は上げない）の往復・古い形・壊れたセーブの拒否（実データ）。
 * 切り替えの挙動は packages/game/test/loadout-subjob.test.ts。
 */
import {
  Character,
  Equipment,
  Inventory,
  type JobDef,
  type LoadoutRecord,
  type PlayerProfile,
  SAVE_VERSION,
  type SaveData,
  SaveDataError,
  STASH_SLOTS,
  emptyKeptFields,
  emptyLoadout,
  fromSaveData,
  saveDataSchema,
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

/** メイン魔法使い（キャラLv25）。ロードアウト1を使い、ロードアウト2（弓使い）のサブジョブは sub2。 */
function profileOf(opts: { sub?: string; sub2?: string; level?: number }): PlayerProfile {
  const character = new Character({
    jobs: db.jobs,
    origin: job(MAGE),
    level: opts.level ?? 25,
    jobLevels: { [MAGE]: 20, [KNIGHT]: 20, [ARCHER]: 9 },
    ...(opts.sub === undefined ? {} : { subJob: opts.sub }),
  });
  const second: LoadoutRecord = {
    ...emptyLoadout(2, ARCHER),
    ...(opts.sub2 === undefined ? {} : { subJob: opts.sub2 }),
  };
  return {
    name: "セーブ試験",
    character,
    equipment: new Equipment(db),
    inventory: new Inventory(),
    stash: new Inventory(STASH_SLOTS),
    skillSlots: new Map(),
    starAllocation: [],
    loadouts: [emptyLoadout(1, MAGE), second],
    activeLoadout: 1,
    unlockedRegions: [],
    deathLog: { count: 0, lastCause: null },
    questStages: [],
    secretsFound: [],
    bossKills: {},
    kept: emptyKeptFields(),
  };
}

const load = (data: unknown): PlayerProfile => fromSaveData(db, data as SaveData);
const second = (p: PlayerProfile): LoadoutRecord | undefined => p.loadouts.find((l) => l.id === 2);

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

describe("ロードアウトのサブジョブの往復", () => {
  it("使っていないロードアウトのサブジョブが loadouts[].sub_job に入り、文字列を通しても同じに戻る", () => {
    const data = toSaveData(db, profileOf({ sub: ARCHER, sub2: KNIGHT }));
    expect(data.save_version).toBe(SAVE_VERSION);
    expect(data.loadouts.find((l) => l.id === 2)?.sub_job).toBe(KNIGHT);
    // 使っているロードアウトの分は character.sub_job が正（ロードアウトには書かない）
    expect(data.character.sub_job).toBe(ARCHER);
    expect("sub_job" in (data.loadouts.find((l) => l.id === 1) ?? {})).toBe(false);
    const text = JSON.stringify(data);
    const back = load(JSON.parse(text));
    expect(second(back)?.subJob).toBe(KNIGHT);
    expect(back.character.subJob).toBe(ARCHER);
    expect(JSON.stringify(toSaveData(db, back))).toBe(text);
  });

  it("サブジョブの無いロードアウトは sub_job の項目ごと出ない（従来と同じ形）。読むとサブジョブなし", () => {
    const data = toSaveData(db, profileOf({}));
    for (const l of data.loadouts) expect(Object.keys(l)).not.toContain("sub_job");
    expect(JSON.stringify(data)).not.toContain('"sub_job":"');
    const back = load(data);
    expect(back.loadouts.every((l) => !("subJob" in l))).toBe(true);
    expect(toSaveData(db, back)).toEqual(data);
  });

  it("古いロードアウト（sub_job の無い形）はそのまま読める。キャラLv25未満でも同じ", () => {
    const data = toSaveData(db, profileOf({ level: 20 }));
    expect(second(load(data))?.subJob).toBeUndefined();
  });

  it("使っているロードアウトに sub_job があっても使わない（character.sub_job が正。job_boards と同じ）", () => {
    const data = toSaveData(db, profileOf({ sub: ARCHER }));
    const withActive = {
      ...data,
      loadouts: data.loadouts.map((l) => (l.id === 1 ? { ...l, sub_job: KNIGHT } : l)),
    };
    const back = load(withActive);
    expect(back.character.subJob).toBe(ARCHER);
    expect(toSaveData(db, back)).toEqual(data);
  });
});

describe("壊れたロードアウトのサブジョブを拒否する", () => {
  const withSub2 = (sub: string, level = 25): unknown => {
    const data = toSaveData(db, profileOf({ level }));
    return {
      ...data,
      loadouts: data.loadouts.map((l) => (l.id === 2 ? { ...l, sub_job: sub } : l)),
    };
  };

  it("データに無いジョブID", () => {
    expectBroken(withSub2("JOB-GHOST"), "ロードアウト 2 のサブジョブ JOB-GHOST がデータに無い");
  });

  it("キャラLv24なのにサブジョブがある", () => {
    expectBroken(
      withSub2(KNIGHT, 24),
      "キャラLvが 24 なのに、ロードアウト 2 のサブジョブ JOB-KNIGHT がある",
    );
  });

  it("そのロードアウトのメインジョブ（弓使い）と同じ", () => {
    expectBroken(
      withSub2(ARCHER),
      "ロードアウト 2 のサブジョブ JOB-ARCHER が、そのロードアウトのメインジョブと同じ",
    );
  });

  it("空の文字列・文字列でない値は、セーブの形（saveDataSchema）に合わない", () => {
    expect(saveDataSchema.safeParse(withSub2("")).success).toBe(false);
    expect(saveDataSchema.safeParse(withSub2(null as unknown as string)).success).toBe(false);
    expect(saveDataSchema.safeParse(withSub2(KNIGHT)).success).toBe(true);
  });
});
