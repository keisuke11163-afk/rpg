/**
 * ロードアウトのサブジョブ（仕様書v0.2 4.13「メインジョブ・サブジョブの選択も含む」。docs/progress D-LOAD-1〜4）：
 * 切り替えでの保存と復元・設定できないサブは外れる・枠のサブの技・副職紋は切り替えで変わらない・セーブの形。
 * セーブの検証は packages/content/test/loadout-subjob-save.test.ts。
 */
import { describe, expect, it } from "vitest";
import { Character, FIXED_STEP_SECONDS, type LoadoutRecord, fromSaveData } from "@stella/core";
import { loadGameContent } from "@stella/content";
import type { InputFrame } from "../src/input/frame.ts";
import {
  ArenaSimulation,
  DUMMY_POSITION,
  SKILL_SLOTS,
  newCharacterProfile,
} from "../src/scenes/arena-simulation.ts";
import { toPixels } from "../src/world/units.ts";

const STEP = FIXED_STEP_SECONDS;
const db = loadGameContent();
const WARRIOR = "JOB-WARRIOR";
const ROGUE = "JOB-ROGUE";
const MAGE = "JOB-MAGE";

const at = (x: number, y: number) => ({ x: toPixels(x), y: toPixels(y) });
const frame = (move = { x: 0, y: 0 }): InputFrame => ({
  held: new Set(),
  pressed: new Set(),
  move,
  pointerWorld: at(DUMMY_POSITION.x, DUMMY_POSITION.y),
});

/** 戦士・キャラLv level の、安全地帯（人形の近く）に立ったシミュレーション。loadouts を渡すとその一覧で始める。 */
function simOf(level = 25, loadouts?: LoadoutRecord[]): ArenaSimulation {
  const base = newCharacterProfile(db, WARRIOR, "試験");
  const origin = db.jobs.get(WARRIOR);
  if (origin === undefined) throw new Error(WARRIOR);
  const character = new Character({
    origin,
    jobs: db.jobs,
    level,
    jobLevels: { [WARRIOR]: 20, [ROGUE]: 12, [MAGE]: 10 },
  });
  const sim = new ArenaSimulation(undefined, {
    db,
    enemies: false,
    rngSeed: "loadout-sub",
    profile: { ...base, character, ...(loadouts === undefined ? {} : { loadouts }) },
  });
  for (let i = 0; i < 600 && !sim.inSafeZone; i++) sim.frame(STEP, frame({ x: 1, y: 0 }));
  expect(sim.inSafeZone).toBe(true);
  return sim;
}

const slotsOf = (sim: ArenaSimulation): (string | undefined)[] => {
  const m = new Map(sim.loadout.map((l) => [l.action, l.skill]));
  return SKILL_SLOTS.map((s) => m.get(s));
};

describe("切り替えでサブジョブを保存・復元する", () => {
  it("ロードアウトごとにサブジョブ（盗賊・魔法使い・なし）を持ち、切り替えると戻る", () => {
    const sim = simOf();
    expect(sim.setSubJob(ROGUE)).toBe("ok");
    // まだ無いロードアウトは今の写し（サブジョブも写す。D-U20-1）
    expect(sim.switchLoadout(2)).toBe("ok");
    expect(sim.subJob?.id).toBe(ROGUE);
    expect(sim.setSubJob(MAGE)).toBe("ok");
    expect(sim.switchLoadout(3)).toBe("ok");
    expect(sim.clearSubJob()).toBe("ok");
    expect(sim.switchLoadout(1)).toBe("ok");
    expect(sim.subJob?.id).toBe(ROGUE);
    expect(sim.switchLoadout(2)).toBe("ok");
    expect(sim.subJob?.id).toBe(MAGE);
    expect(sim.switchLoadout(3)).toBe("ok");
    expect(sim.subJob).toBeUndefined();
    expect(sim.loadouts.map((l) => l.subJob)).toEqual([ROGUE, MAGE, undefined]);
    expect(sim.loadouts.map((l) => "subJob" in l)).toEqual([true, true, false]);
  });

  it("セーブを通しても同じ（使っていないロードアウトは loadouts[].sub_job、使っている分は character.sub_job）", () => {
    const sim = simOf();
    expect(sim.setSubJob(ROGUE)).toBe("ok");
    expect(sim.switchLoadout(2)).toBe("ok");
    expect(sim.setSubJob(MAGE)).toBe("ok");
    expect(sim.switchLoadout(3)).toBe("ok");
    expect(sim.clearSubJob()).toBe("ok");
    expect(sim.switchLoadout(2)).toBe("ok");
    const data = sim.saveData();
    expect(data.character.sub_job).toBe(MAGE);
    expect(data.loadouts.map((l) => l.sub_job)).toEqual([ROGUE, undefined, undefined]);
    expect(data.loadouts.map((l) => "sub_job" in l)).toEqual([true, false, false]);
    const again = new ArenaSimulation(undefined, {
      db,
      enemies: false,
      profile: fromSaveData(db, JSON.parse(JSON.stringify(data)) as typeof data),
    });
    expect(again.saveData()).toEqual(data);
    for (let i = 0; i < 600 && !again.inSafeZone; i++) again.frame(STEP, frame({ x: 1, y: 0 }));
    expect(again.subJob?.id).toBe(MAGE);
    expect(again.switchLoadout(1)).toBe("ok");
    expect(again.subJob?.id).toBe(ROGUE);
    expect(again.switchLoadout(3)).toBe("ok");
    expect(again.subJob).toBeUndefined();
  });
});

describe("サブジョブが無いときは従来と同じ", () => {
  it("サブジョブを一度も設定しなければ、セーブのロードアウトに sub_job の項目は出ない（項目の並びも従来どおり）", () => {
    const sim = simOf();
    expect(sim.switchLoadout(2)).toBe("ok");
    expect(sim.switchLoadout(3)).toBe("ok");
    const data = sim.saveData();
    expect(JSON.stringify(data)).not.toContain('"sub_job":"');
    expect(Object.keys(data.loadouts[0] ?? {})).toEqual([
      "id",
      "name",
      "main_job",
      "equipment",
      "star_allocation",
      "extra_entries",
      "job_boards",
    ]);
    expect(Object.keys(data.loadouts[2] ?? {})).toEqual([
      "id",
      "name",
      "main_job",
      "equipment",
      "star_allocation",
      "extra_entries",
    ]);
  });

  it("サブジョブの無い（古い）ロードアウトに切り替えると、今のサブジョブは外れる", () => {
    const sim = simOf();
    expect(sim.switchLoadout(2)).toBe("ok");
    expect(sim.setSubJob(ROGUE)).toBe("ok");
    expect(sim.switchLoadout(1)).toBe("ok");
    expect(sim.subJob).toBeUndefined();
  });
});

describe("設定できないサブジョブは外す（切り替えは成功させる。D-LOAD-3）", () => {
  const record = (over: Partial<LoadoutRecord>): LoadoutRecord => ({
    id: 2,
    name: "ロードアウト2",
    mainJob: WARRIOR,
    equipment: {},
    starAllocation: [],
    extraEntries: [],
    ...over,
  });
  const first = record({ id: 1, name: "ロードアウト1" });

  it("切り替えた後のメインジョブと同じになるサブジョブは外れる", () => {
    const sim = simOf(25, [first, record({ mainJob: ROGUE, subJob: ROGUE })]);
    expect(sim.setSubJob(MAGE)).toBe("ok");
    expect(sim.switchLoadout(2)).toBe("ok");
    expect(sim.job.id).toBe(ROGUE);
    expect(sim.subJob).toBeUndefined();
  });

  it("今のメインと同じでも、切り替えた後のメインと違えば設定する（入れ替え）", () => {
    const sim = simOf(25, [first, record({ mainJob: ROGUE, subJob: WARRIOR })]);
    expect(sim.setSubJob(ROGUE)).toBe("ok");
    expect(sim.switchLoadout(2)).toBe("ok");
    expect(sim.job.id).toBe(ROGUE);
    expect(sim.subJob?.id).toBe(WARRIOR);
    expect(sim.switchLoadout(1)).toBe("ok");
    expect(sim.job.id).toBe(WARRIOR);
    expect(sim.subJob?.id).toBe(ROGUE);
  });

  it("キャラLv25未満・データに無いジョブIDのサブジョブは設定しない", () => {
    const low = simOf(24, [first, record({ subJob: ROGUE })]);
    expect(low.switchLoadout(2)).toBe("ok");
    expect(low.subJob).toBeUndefined();
    const ghost = simOf(25, [first, record({ subJob: "JOB-GHOST" })]);
    expect(ghost.setSubJob(ROGUE)).toBe("ok");
    expect(ghost.switchLoadout(2)).toBe("ok");
    expect(ghost.subJob).toBeUndefined();
  });

  it("技の実行中・試し打ちの場の規則は今までどおり（busy なら、サブジョブも変えない）", () => {
    const sim = simOf(25, [first, record({ subJob: MAGE })]);
    expect(sim.setSubJob(ROGUE)).toBe("ok");
    for (let i = 0; i < 600 && !sim.nearDummy; i++) sim.frame(STEP, frame({ x: 1, y: 0 }));
    expect(sim.startTrial()).toBe(true);
    expect(sim.switchLoadout(2)).toBe("busy");
    expect(sim.subJob?.id).toBe(ROGUE);
  });
});

describe("切り替えの後始末（applySubJob と同じ）", () => {
  it("サブの無いロードアウトに切り替えると、枠のサブジョブの技は初期の技か空きに戻り、戻すと入れ直さずに残る", () => {
    const sim = simOf();
    expect(sim.switchLoadout(2)).toBe("ok"); // ロードアウト2：サブなし
    expect(sim.switchLoadout(1)).toBe("ok");
    const before = slotsOf(sim);
    expect(sim.setSubJob(ROGUE)).toBe("ok");
    expect(sim.setSlotSkill(5, "SKL-ROGUE-POISON")).toBe(true);
    expect(sim.switchLoadout(2)).toBe("ok");
    expect(sim.subJob).toBeUndefined();
    expect(slotsOf(sim)).toEqual(before);
    expect(slotsOf(sim)).not.toContain("SKL-ROGUE-POISON");
  });

  it("別のロードアウトに切り替えて戻っても、副職紋の取得はサブにしたジョブごとに保たれる", () => {
    const sim = simOf();
    expect(sim.setSubJob(ROGUE)).toBe("ok");
    expect(sim.allocateSubJobNode("JBN-ROGUE-T1")).toBe(true);
    expect(sim.switchLoadout(2)).toBe("ok");
    expect(sim.setSubJob(MAGE)).toBe("ok");
    expect(sim.allocateSubJobNode("JBN-MAGE-T1")).toBe(true);
    expect(sim.switchLoadout(1)).toBe("ok");
    expect(sim.subJob?.id).toBe(ROGUE);
    expect(sim.subJobBoard?.nodes).toEqual(["JBN-ROGUE-T1"]);
    expect(sim.sheet.subJobNodes.size).toBeGreaterThan(0);
    expect(sim.switchLoadout(2)).toBe("ok");
    expect(sim.subJobBoard?.nodes).toEqual(["JBN-MAGE-T1"]);
    expect(sim.saveData().sub_job_boards).toEqual({
      [MAGE]: ["JBN-MAGE-T1"],
      [ROGUE]: ["JBN-ROGUE-T1"],
    });
  });
});
