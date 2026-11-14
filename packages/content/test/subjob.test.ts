/**
 * サブジョブ（仕様書v0.2 5.1・MVP後の機能の提案 2章。docs/progress D-SUB-1〜D-SUB-8）を、実際のデータで確かめる：
 * ジョブのサブジョブの技・副職紋（職紋盤の読み替え）・能力値の計算（武器適性・副職紋の効果・パッシブ）・セーブ。
 */
import {
  Character,
  type ContentDb,
  Equipment,
  Inventory,
  type ItemInstance,
  JobBoardAllocation,
  type JobDef,
  type PlayerProfile,
  type RawContent,
  STASH_SLOTS,
  SUB_JOB_BLOCK_TEXT,
  type SaveData,
  SaveDataError,
  TagIndex,
  buildCharacterSheet,
  emptyKeptFields,
  emptyLoadout,
  fromSaveData,
  loadContent,
  sheetRows,
  subJobBoardPoints,
  toSaveData,
  unlockedSkills,
  unlockedSubSkills,
  usableAsSubSkill,
} from "@stella/core";
import { describe, expect, it } from "vitest";
import { type TextKey, loadGameContent, rawContent, text } from "../src/index.ts";

const db: ContentDb = loadGameContent();
const tags = new TagIndex(db.tags);
const job = (id: string): JobDef => {
  const j = db.jobs.get(id);
  if (j === undefined) throw new Error(`${id} がない`);
  return j;
};
const WARRIOR = "JOB-WARRIOR";
/** 戦士の盤の、副職紋で取れるノード（小ノードと輝星）を、データの順（どれも前のノードの隣）に。 */
const warriorSubNodes = (): string[] =>
  [...db.jobNodes.values()]
    .filter((n) => n.job === WARRIOR && (n.kind === "minor" || n.kind === "notable"))
    .map((n) => n.id);

describe("ジョブのサブジョブの技（D-SUB-4）", () => {
  it("6つのジョブ全てが、そのジョブの技から2つ持つ。通常攻撃・職能ゲージを前提にする技・解放技は含めない", () => {
    const picked: Record<string, readonly string[]> = {};
    for (const j of db.jobs.values()) {
      const sub = j.subSkills?.skills;
      expect(sub, j.id).toBeDefined();
      if (sub === undefined) continue;
      picked[j.id] = sub;
      expect(new Set(sub).size).toBe(2);
      const own = unlockedSkills(j, 99);
      for (const id of sub) {
        expect(own).toContain(id);
        expect(id).not.toBe("SKL-BASIC-ATTACK");
        const def = db.skills.get(id);
        expect(def?.gauge?.requires, id).toBeUndefined();
        expect(def?.finisher, id).toBeUndefined();
        expect(def !== undefined && usableAsSubSkill(def)).toBe(true);
      }
      expect(j.subSkills?.provisional).toBe(true);
    }
    expect(picked).toEqual({
      "JOB-WARRIOR": ["SKL-WARRIOR-CHARGE", "SKL-WARRIOR-WARCRY"],
      "JOB-ROGUE": ["SKL-ROGUE-SHADOWSTEP", "SKL-ROGUE-POISON"],
      "JOB-ARCHER": ["SKL-ARCHER-LEAP", "SKL-ARCHER-RAIN"],
      "JOB-MAGE": ["SKL-MAGE-FIREBALL", "SKL-MAGE-BLINK"],
      "JOB-KNIGHT": ["SKL-KNIGHT-TAUNT", "SKL-KNIGHT-SANCTUARY"],
      // 召喚士：契約枠6（サブジョブの固定）で呼べる骸兵（2）と魔狼（4）
      "JOB-SUMMONER": ["SKL-SUMMONER-SKELETON", "SKL-SUMMONER-DIRE-WOLF"],
    });
  });

  it("戦士の解放技（破軍・闘志100）は、サブジョブの技として使えない（データの subJobRule）", () => {
    const rout = db.skills.get("SKL-WARRIOR-ROUT");
    expect(rout?.subJobRule).toBe("unavailable");
    expect(rout !== undefined && usableAsSubSkill(rout)).toBe(false);
    // ほかの技は印を持たない（今までの技の挙動は変えない）
    const marked = [...db.skills.values()].filter((s) => s.subJobRule !== undefined);
    expect(marked.map((s) => s.id)).toEqual(["SKL-WARRIOR-ROUT"]);
  });

  it("使えるのは、サブジョブのジョブLvでその技を覚えているもの", () => {
    const w = job(WARRIOR);
    // 突進はジョブLv3、戦吼はジョブLv5
    expect(unlockedSubSkills(w, 2)).toEqual([]);
    expect(unlockedSubSkills(w, 3)).toEqual(["SKL-WARRIOR-CHARGE"]);
    expect(unlockedSubSkills(w, 5)).toEqual(["SKL-WARRIOR-CHARGE", "SKL-WARRIOR-WARCRY"]);
  });

  /** 戦士のデータを書き換えた写し。 */
  function withJob(
    patch: (warrior: Record<string, unknown>) => Record<string, unknown>,
  ): RawContent {
    const c = rawContent.collections;
    return {
      ...rawContent,
      collections: {
        ...c,
        jobs: (c.jobs ?? []).map((f) => ({
          ...f,
          entries: (f.entries as Record<string, unknown>[]).map((e) =>
            e.id === WARRIOR ? patch(e) : e,
          ),
        })),
      },
    };
  }
  const errorsOf = (raw: RawContent): string[] => {
    const r = loadContent(raw);
    return r.ok ? [] : r.errors.map((e) => `${e.id ?? ""} ${e.path ?? ""} ${e.message}`);
  };

  it("データの検証：解放技・ほかのジョブの技・同じ技を2つ選ぶと誤り。上位職はサブジョブの技を持てない", () => {
    expect(errorsOf(rawContent)).toEqual([]);
    const sub = (skills: string[]) => withJob((w) => ({ ...w, subSkills: { skills } }));
    expect(errorsOf(sub(["SKL-WARRIOR-CHARGE", "SKL-WARRIOR-ROUT"])).join("\n")).toContain(
      "subJobRule",
    );
    expect(errorsOf(sub(["SKL-WARRIOR-CHARGE", "SKL-ROGUE-POISON"])).join("\n")).toContain(
      "このジョブの技",
    );
    expect(errorsOf(sub(["SKL-WARRIOR-CHARGE", "SKL-WARRIOR-CHARGE"])).join("\n")).toContain(
      "重なっている",
    );
    expect(
      errorsOf(
        withJob((w) => ({
          ...w,
          advancedFrom: ["JOB-ROGUE"],
          trial: { text: "job.warrior", jobLevel: 30 },
        })),
      ).join("\n"),
    ).toContain("上位職・混成職はサブジョブにできない");
  });
});

describe("副職紋（D-SUB-2・D-SUB-3）", () => {
  it("小ノードと輝星は取れる。職奥義・接続ノードは取れない（subOnlyMinor）", () => {
    const nodes = warriorSubNodes();
    const b = new JobBoardAllocation(db, WARRIOR, [], "sub");
    expect(b.role).toBe("sub");
    for (const id of nodes) expect(b.allocate(id, 20), id).toBe(true);
    expect(b.allocateBlock("JBN-WARRIOR-C1", 20)).toBe("subOnlyMinor");
    expect(b.allocateBlock("JBN-WARRIOR-M-DEMON", 20)).toBe("subOnlyMinor");
    expect(b.allocate("JBN-WARRIOR-M-DEMON", 20)).toBe(false);
    expect(b.mastery).toBeUndefined();
    expect(b.connectors(20)).toBe(0);
    // セーブデータの取得に職奥義・接続ノードがあれば RangeError
    for (const bad of ["JBN-WARRIOR-M-DEMON", "JBN-WARRIOR-C1"])
      expect(() => new JobBoardAllocation(db, WARRIOR, [...nodes.slice(0, 7), bad], "sub")).toThrow(
        RangeError,
      );
    // メインの盤（既定）は今までどおり取れる
    const main = new JobBoardAllocation(db, WARRIOR, [...nodes.slice(0, 5), "JBN-WARRIOR-C1"]);
    expect(main.role).toBe("main");
    expect(main.connectors(19)).toBe(1);
  });

  it("副職紋の効果は職紋盤の効果のデータをそのまま使い、出どころを subJob・source を subJobNode にする", () => {
    const sub = new JobBoardAllocation(db, WARRIOR, ["JBN-WARRIOR-T1"], "sub");
    const main = new JobBoardAllocation(db, WARRIOR, ["JBN-WARRIOR-T1"]);
    expect(sub.effects(1)).toEqual([
      {
        effectId: "EFF-JBN-WAR-STAGGER",
        source: { kind: "subJobNode", ref: "JBN-WARRIOR-T1" },
        origin: "subJob",
      },
    ]);
    expect(main.effects(1)).toEqual([
      { effectId: "EFF-JBN-WAR-STAGGER", source: { kind: "jobNode", ref: "JBN-WARRIOR-T1" } },
    ]);
  });
});

/** キャラLv25・メイン魔法使い・ジョブLvのキャラクター。 */
function char(sub: string | undefined, jobLevels: Record<string, number> = {}): Character {
  return new Character({
    jobs: db.jobs,
    origin: job("JOB-MAGE"),
    level: 25,
    jobLevels: { "JOB-MAGE": 20, [WARRIOR]: 20, "JOB-ROGUE": 20, "JOB-KNIGHT": 20, ...jobLevels },
    ...(sub === undefined ? {} : { subJob: sub }),
  });
}
const sword = (uid: string, base: string): ItemInstance => ({
  uid,
  base,
  rarity: "normal",
  itemLevel: 5,
  affixes: [],
});
const rowsOf = (s: ReturnType<typeof buildCharacterSheet>) =>
  JSON.stringify([sheetRows(db, s), s.affinity, s.attackSpeed, s.maxHp, s.maxMp, s.defense]);

describe("能力値の計算（D-SUB-7）", () => {
  const greatsword = (): Equipment => {
    const e = new Equipment(db);
    e.equip(sword("itm_g", "BASE-WPN-GREATSWORD-T1"), "mainHand", false);
    return e;
  };

  it("サブジョブを渡さなければ、今までと完全に同じ（副職紋だけを渡しても無視する）", () => {
    const c = char(WARRIOR);
    const before = buildCharacterSheet(db, tags, {
      character: c,
      job: job("JOB-MAGE"),
      equipment: greatsword(),
    });
    const withBoard = buildCharacterSheet(db, tags, {
      character: c,
      job: job("JOB-MAGE"),
      equipment: greatsword(),
      subJobBoard: new JobBoardAllocation(db, WARRIOR, warriorSubNodes(), "sub"),
    });
    expect(rowsOf(withBoard)).toBe(rowsOf(before));
    expect(before.affinity).toBe("C");
    expect(before.subJobNodes.size).toBe(0);
  });

  it("武器適性は、メインとサブ（1段階下げる）の高い方。攻撃速度も変わる", () => {
    const sheet = (sub: string) =>
      buildCharacterSheet(db, tags, {
        character: char(sub),
        job: job("JOB-MAGE"),
        subJob: job(sub),
        equipment: greatsword(),
      });
    // 大剣：魔法使いC・戦士S → A
    expect(sheet(WARRIOR).affinity).toBe("A");
    // 大剣：騎士B → C（魔法使いのCと同じ）
    expect(sheet("JOB-KNIGHT").affinity).toBe("C");
    const none = buildCharacterSheet(db, tags, {
      character: char(undefined),
      job: job("JOB-MAGE"),
      equipment: greatsword(),
    });
    expect(sheet(WARRIOR).attackSpeed).toBeGreaterThan(none.attackSpeed);
  });

  it("キャラクターのサブジョブと違うジョブを渡すと RangeError", () => {
    expect(() =>
      buildCharacterSheet(db, tags, {
        character: char(WARRIOR),
        job: job("JOB-MAGE"),
        subJob: job("JOB-ROGUE"),
      }),
    ).toThrow(RangeError);
    expect(() =>
      buildCharacterSheet(db, tags, {
        character: char(undefined),
        job: job("JOB-MAGE"),
        subJob: job(WARRIOR),
      }),
    ).toThrow(RangeError);
  });

  it("副職紋の効果が出どころ subJob で効く。メインの職紋盤とは別に数える", () => {
    const nodes = ["JBN-WARRIOR-T1", "JBN-WARRIOR-T2", "JBN-WARRIOR-T3"];
    const s = buildCharacterSheet(db, tags, {
      character: char(WARRIOR),
      job: job("JOB-MAGE"),
      subJob: job(WARRIOR),
      subJobBoard: new JobBoardAllocation(db, WARRIOR, nodes, "sub"),
    });
    const none = buildCharacterSheet(db, tags, {
      character: char(WARRIOR),
      job: job("JOB-MAGE"),
      subJob: job(WARRIOR),
    });
    // T3 は最大HP+10
    expect(s.maxHp - none.maxHp).toBe(10);
    const hp = s.evaluated.view
      .stat("STAT-HP-MAX")
      .contributions.filter((c) => c.source.kind === "subJobNode");
    expect(hp.map((c) => [c.origin, c.source.ref])).toEqual([["subJob", "JBN-WARRIOR-T3"]]);
    expect([...s.subJobNodes]).toEqual(nodes);
    expect(s.jobNodes.size).toBe(0);
  });

  it("副職紋のポイント：サブジョブのジョブLv20で19、21で20（全19ノードが効く）、19で18", () => {
    const all = warriorSubNodes();
    expect(all).toHaveLength(19);
    const active = (lv: number) =>
      buildCharacterSheet(db, tags, {
        character: char(WARRIOR, { [WARRIOR]: lv }),
        job: job("JOB-MAGE"),
        subJob: job(WARRIOR),
        subJobBoard: new JobBoardAllocation(db, WARRIOR, all, "sub"),
      }).subJobNodes.size;
    expect([19, 20, 21, 25].map((lv) => [subJobBoardPoints(lv), active(lv)])).toEqual([
      [18, 18],
      [19, 19],
      [20, 19],
      [20, 19],
    ]);
  });

  it("パッシブ（騎士の誓い）はメインジョブだけ。サブジョブの騎士では効かない", () => {
    const knight = job("JOB-KNIGHT");
    expect(knight.passiveEffects?.length ?? 0).toBeGreaterThan(0);
    const s = buildCharacterSheet(db, tags, {
      character: char("JOB-KNIGHT"),
      job: job("JOB-MAGE"),
      subJob: knight,
    });
    const none = buildCharacterSheet(db, tags, {
      character: char(undefined),
      job: job("JOB-MAGE"),
    });
    expect(rowsOf(s)).toBe(rowsOf(none));
  });
});

/** メイン盗賊・サブ戦士（キャラLv25）で、副職紋を持つキャラクター。 */
function subProfile(): PlayerProfile {
  const character = new Character({
    jobs: db.jobs,
    origin: job(WARRIOR),
    level: 25,
    jobLevels: { [WARRIOR]: 20, "JOB-ROGUE": 21, "JOB-MAGE": 6 },
    mainJob: "JOB-ROGUE",
    subJob: WARRIOR,
  });
  return {
    name: "サブ",
    character,
    equipment: new Equipment(db),
    inventory: new Inventory(),
    stash: new Inventory(STASH_SLOTS),
    skillSlots: new Map([
      [
        "JOB-ROGUE",
        [
          "SKL-BASIC-ATTACK",
          "SKL-ROGUE-FLURRY",
          "SKL-WARRIOR-CHARGE",
          "SKL-WARRIOR-WARCRY",
          undefined,
          undefined,
        ],
      ],
    ]),
    starAllocation: [],
    loadouts: [emptyLoadout(1, "JOB-ROGUE")],
    activeLoadout: 1,
    unlockedRegions: [],
    deathLog: { count: 0, lastCause: null },
    questStages: [],
    secretsFound: [],
    bossKills: {},
    kept: {
      ...emptyKeptFields(),
      boards: { [WARRIOR]: { board: ["JBN-WARRIOR-T1"], mastery: null } },
      // 戦士の副職紋（サブ）と、前にサブにしていた魔法使いの副職紋（残す）
      subBoards: {
        [WARRIOR]: warriorSubNodes().slice(0, 19),
        "JOB-MAGE": ["JBN-MAGE-T1", "JBN-MAGE-T2"],
      },
    },
  };
}
const load = (data: unknown): PlayerProfile => fromSaveData(db, data as SaveData);
const expectBroken = (data: unknown, text: string): void => {
  let caught: unknown;
  try {
    load(data);
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(SaveDataError);
  expect((caught as SaveDataError).kind).toBe("reference");
  expect((caught as Error).message).toContain(text);
};

describe("表示の文章", () => {
  it("サブジョブを設定できない理由・副職紋・サブジョブの技の文章が ja.json にある", () => {
    const keys = [
      ...Object.values(SUB_JOB_BLOCK_TEXT),
      "subjob.title",
      "subjob.board",
      "subjob.none",
      "subjob.board.block.sub-only-minor",
      "subjob.skill.unavailable",
      "subjob.skill.slot-limit",
    ];
    for (const k of keys) expect(text(k as TextKey), k).toBeTruthy();
  });
});

describe("セーブ（D-SUB-8）", () => {
  it("サブジョブと副職紋（ジョブごと）が、保存して読み込んでも同じ。メインの職紋盤とは別", () => {
    const data = toSaveData(db, subProfile());
    expect(data.save_version).toBe(6);
    expect(data.character.sub_job).toBe(WARRIOR);
    expect(data.sub_job_boards?.[WARRIOR]).toHaveLength(19);
    expect(data.sub_job_boards?.["JOB-MAGE"]).toEqual(["JBN-MAGE-T1", "JBN-MAGE-T2"]);
    expect(data.jobs[WARRIOR]?.board_allocation).toEqual(["JBN-WARRIOR-T1"]);
    const p = load(data);
    expect(p.character.subJob).toBe(WARRIOR);
    expect(p.kept.subBoards[WARRIOR]).toEqual(warriorSubNodes());
    expect(p.kept.boards[WARRIOR]?.board).toEqual(["JBN-WARRIOR-T1"]);
    expect(p.skillSlots.get("JOB-ROGUE")?.[2]).toBe("SKL-WARRIOR-CHARGE");
    expect(toSaveData(db, p)).toEqual(data);
  });

  it("サブジョブの無い（古い）セーブは、任意の項目が無いまま読めて、同じ形で保存し直す", () => {
    const p = subProfile();
    p.character.clearSubJob();
    const data = toSaveData(db, { ...p, kept: { ...p.kept, subBoards: {} } });
    expect(data.character.sub_job).toBeNull();
    expect("sub_job_boards" in data).toBe(false);
    const back = load(data);
    expect(back.character.subJob).toBeUndefined();
    expect(back.kept.subBoards).toEqual({});
    expect(toSaveData(db, back)).toEqual(data);
    // 空の副職紋だけのジョブは、項目ごと省く
    const empty = toSaveData(db, { ...p, kept: { ...p.kept, subBoards: { [WARRIOR]: [] } } });
    expect("sub_job_boards" in empty).toBe(false);
  });

  it("壊れたサブジョブを拒否する：キャラLv24・メインと同じ・存在しないジョブ", () => {
    const data = toSaveData(db, subProfile());
    expectBroken(
      { ...data, character: { ...data.character, level: 24, xp: 0 }, sub_job_boards: undefined },
      "サブジョブ JOB-WARRIOR は設定できない（level）",
    );
    expectBroken(
      { ...data, character: { ...data.character, sub_job: "JOB-ROGUE" } },
      "サブジョブ JOB-ROGUE は設定できない（sameAsMain）",
    );
    expectBroken(
      { ...data, character: { ...data.character, sub_job: "JOB-NOPE" } },
      "サブジョブ JOB-NOPE がデータに無い",
    );
    // キャラLv25ちょうどなら読める
    expect(load(data).character.level).toBe(25);
  });

  it("壊れた副職紋を拒否する：ポイント超過・職奥義・接続ノード・ほかのジョブのノード・無いジョブ・Lv25未満", () => {
    const data = toSaveData(db, subProfile());
    const nodes = warriorSubNodes();
    const withBoards = (boards: Record<string, string[]>, extra: Record<string, unknown> = {}) => ({
      ...data,
      ...extra,
      sub_job_boards: boards,
    });
    // ジョブLv20 → 19ポイント：19ノードは読める。ジョブLv19 → 18ポイントで19ノードは超過
    expect(load(withBoards({ [WARRIOR]: nodes })).kept.subBoards[WARRIOR]).toHaveLength(19);
    expectBroken(
      withBoards(
        { [WARRIOR]: nodes },
        { jobs: { ...data.jobs, [WARRIOR]: { ...data.jobs[WARRIOR], level: 19, xp: 0 } } },
      ),
      "ポイント（18）を超える",
    );
    // 魔法使いのジョブLv6 → 5ポイント
    const mage = [...db.jobNodes.values()]
      .filter((n) => n.job === "JOB-MAGE" && (n.kind === "minor" || n.kind === "notable"))
      .map((n) => n.id);
    expect(
      load(withBoards({ "JOB-MAGE": mage.slice(0, 5) })).kept.subBoards["JOB-MAGE"],
    ).toHaveLength(5);
    expectBroken(withBoards({ "JOB-MAGE": mage.slice(0, 6) }), "ポイント（5）を超える");
    // 一度も就いていないジョブ（ジョブLv1 → 0ポイント）
    expectBroken(withBoards({ "JOB-ARCHER": ["JBN-ARCHER-T1"] }), "ポイント（0）を超える");
    expectBroken(
      withBoards({ [WARRIOR]: [...nodes.slice(0, 7), "JBN-WARRIOR-M-DEMON"] }),
      "副職紋では mastery",
    );
    expectBroken(withBoards({ [WARRIOR]: [...nodes.slice(0, 5), "JBN-WARRIOR-C1"] }), "connector");
    expectBroken(withBoards({ [WARRIOR]: ["JBN-ROGUE-T1"] }), "ジョブ JOB-WARRIOR の盤ではない");
    expectBroken(withBoards({ "JOB-NOPE": ["JBN-WARRIOR-T1"] }), "副職紋のジョブ JOB-NOPE");
    expectBroken(
      withBoards(
        { "JOB-MAGE": ["JBN-MAGE-T1"] },
        { character: { ...data.character, level: 24, xp: 0, sub_job: null } },
      ),
      "キャラLvが 24 なのに、副職紋",
    );
  });

  it("二刀流はサブジョブからも受け継ぐ：メイン魔法使い・サブ盗賊なら、短剣と爪の二刀流のセーブを読める", () => {
    const character = char("JOB-ROGUE");
    const equipment = new Equipment(db);
    equipment.equip(sword("itm_d", "BASE-WPN-DAGGER-T1"), "mainHand", true);
    equipment.equip(sword("itm_c", "BASE-WPN-CLAW-T1"), "offHand", true);
    const p: PlayerProfile = { ...subProfile(), character, equipment, kept: emptyKeptFields() };
    const data = toSaveData(db, { ...p, loadouts: [emptyLoadout(1, "JOB-MAGE")] });
    expect(load(data).equipment.get("offHand")?.uid).toBe("itm_c");
    // サブジョブが無ければ、魔法使いは二刀流できない（今までどおり拒否）
    expectBroken(
      { ...data, character: { ...data.character, sub_job: null } },
      "部位 offHand に装備できない",
    );
  });
});
