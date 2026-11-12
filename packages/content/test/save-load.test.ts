/**
 * U-13 セーブ・ロード（開発計画書 T11）：保存して読み込んだ後、計算し直した能力値・DPSが保存前と完全に一致する／
 * 1つ前の版のデータを移行できる／壊れたデータは検出し、元のデータを上書きしない。
 */
import fc from "fast-check";
import {
  AutoSaveTimer,
  Character,
  type ContentDb,
  DUNGEON_AUTOSAVE_SECONDS,
  Equipment,
  Inventory,
  type ItemInstance,
  MemoryBackend,
  type PlayerProfile,
  Rng,
  slotsFor,
  SAVE_VERSION,
  type SaveData,
  SaveDataError,
  SaveStore,
  STASH_SLOTS,
  TagIndex,
  buildCharacterSheet,
  checksum,
  damagePreview,
  decodeSave,
  emptyKeptFields,
  emptyLoadout,
  forgetItem,
  loadoutsUsing,
  encodeSave,
  fromSaveData,
  generateItem,
  sheetRows,
  toSaveData,
} from "@stella/core";
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../src/index.ts";

const db: ContentDb = loadGameContent();
const tags = new TagIndex(db.tags);
const job = (id: string) => {
  const j = db.jobs.get(id);
  if (j === undefined) throw new Error(`${id} がない`);
  return j;
};
const BASIC = { tags: ["TAG-FORM-MELEE"], kind: "weapon", pct: 1 } as const;

function item(uid: string, base: string, affixes: ItemInstance["affixes"] = []): ItemInstance {
  return { uid, base, rarity: affixes.length > 0 ? "magic" : "normal", itemLevel: 3, affixes };
}

/** 戦士の出自で盗賊に転職した、装備・持ち物・倉庫・技の枠のあるキャラクター。 */
function sampleProfile(): PlayerProfile {
  const character = new Character({
    origin: job("JOB-WARRIOR"),
    level: 16,
    xp: 123.5,
    jobLevels: { "JOB-WARRIOR": 15, "JOB-ROGUE": 3 },
    jobXp: { "JOB-WARRIOR": 10, "JOB-ROGUE": 7 },
    mainJob: "JOB-ROGUE",
  });
  const equipment = new Equipment(db);
  equipment.equip(
    item("itm_1", "BASE-WPN-DAGGER-T1", [
      { id: "AFX-PRE-ADDED-PHYSICAL-WPN", tier: 7, rolls: [2, 3] },
      { id: "AFX-SUF-CRIT-CHANCE", tier: 7, rolls: [12] },
    ]),
    "mainHand",
    true,
  );
  equipment.equip(item("itm_2", "BASE-WPN-CLAW-T1"), "offHand", true);
  const inventory = new Inventory();
  inventory.addItem(item("itm_3", "BASE-WPN-GREATSWORD-T1"));
  inventory.addGold(321);
  inventory.addMaterial("MAT-AWAKENING-DUST", 4);
  const stash = new Inventory(STASH_SLOTS);
  stash.addItem(
    item("itm_4", "BASE-WPN-AXE-T1", [{ id: "AFX-SUF-ATTACK-SPEED", tier: 7, rolls: [3] }]),
  );
  return {
    name: "テスト",
    character,
    equipment,
    inventory,
    stash,
    skillSlots: new Map([
      [
        "JOB-ROGUE",
        [
          "SKL-BASIC-ATTACK",
          "SKL-ROGUE-FLURRY",
          undefined,
          "SKL-ROGUE-SHADOWSTEP",
          undefined,
          undefined,
        ],
      ],
    ]),
    starAllocation: ["STAR-JIN-0001", "STAR-JIN-0002", "STAR-JIN-0201"],
    loadouts: [emptyLoadout(1, "JOB-ROGUE")],
    activeLoadout: 1,
    unlockedRegions: ["REGION-A1"],
    deathLog: { count: 2, lastCause: "ENM-FOREST-WOLF" },
    questStages: ["QUEST-FOREST-1"],
    secretsFound: ["SECRET-A3-BUSH", "SECRET-MOTHER-TREE"],
    bossKills: { "ENM-MOTHER-TREE": 2 },
    kept: {
      ...emptyKeptFields(),
      // 職紋盤（盗賊）：幹の最初の2つ
      boards: { "JOB-ROGUE": { board: ["JBN-ROGUE-T1", "JBN-ROGUE-T2"], mastery: null } },
    },
  };
}

/** 能力値・DPSの比較に使う値（計算し直したもの）。 */
function computed(p: PlayerProfile) {
  const j = job(p.character.mainJob);
  const sheet = buildCharacterSheet(db, tags, {
    character: p.character,
    job: j,
    equipment: p.equipment,
    starBoard: { allocation: p.starAllocation },
  });
  return {
    rows: sheetRows(db, sheet).map((r) => [
      r.stat,
      r.result.value,
      r.result.increased,
      r.result.more,
    ]),
    attackSpeed: sheet.attackSpeed,
    maxHp: sheet.maxHp,
    maxMp: sheet.maxMp,
    dps: damagePreview(sheet, BASIC, Rng.fromSeed("t11")).perSecond,
    level: p.character.level,
    xp: p.character.progress.xp,
    jobs: p.character.knownJobs.map((k) => [
      k,
      p.character.jobLevel(k),
      p.character.jobTrack(k).xp,
    ]),
  };
}

describe("T11：保存して読み込むと、計算し直した能力値・DPSが完全に一致する", () => {
  it("決まったキャラクター", () => {
    const store = new SaveStore(db, new MemoryBackend());
    const before = sampleProfile();
    const data = toSaveData(db, before);
    store.save(1, data);
    const r = store.load(1);
    if (!r.ok) throw new Error(r.error?.message ?? "空");
    expect(computed(r.profile)).toEqual(computed(before));
    // 持ち物・倉庫・技の枠・金貨・素材も戻る
    expect(r.profile.inventory.gold).toBe(321);
    expect(r.profile.inventory.material("MAT-AWAKENING-DUST")).toBe(4);
    expect(r.profile.stash.items.map((i) => i.uid)).toEqual(["itm_4"]);
    expect(r.profile.equipment.get("offHand")?.uid).toBe("itm_2");
    expect(r.profile.skillSlots.get("JOB-ROGUE")?.[1]).toBe("SKL-ROGUE-FLURRY");
    expect(r.profile.character.mainJob).toBe("JOB-ROGUE");
    expect(r.profile.starAllocation).toEqual(["STAR-JIN-0001", "STAR-JIN-0002", "STAR-JIN-0201"]);
    // もう一度セーブデータにすると、同じ内容になる
    expect(toSaveData(db, r.profile)).toEqual(data);
    // 保存しない値（能力値・修正値の集計）は入っていない
    expect(JSON.stringify(data)).not.toContain("STAT-");
  });

  it("ランダムに生成した装備・持ち物でも一致する（性質のテスト）", () => {
    const bases = [...db.itemBases.values()];
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 0, max: 8 }),
        (seed, level, owned) => {
          const rng = Rng.fromSeed(`t11-${String(seed)}`);
          let n = 0;
          const gen = (): ItemInstance => {
            const base = bases[Math.floor(rng.next() * bases.length)] ?? bases[0];
            if (base === undefined) throw new Error("ベースが無い");
            const rarity =
              (["normal", "magic", "rare"] as const)[Math.floor(rng.next() * 3)] ?? "normal";
            return generateItem(db, rng, {
              uid: `itm_${String(++n)}`,
              base,
              rarity,
              itemLevel: level,
            });
          };
          const character = new Character({ origin: job("JOB-ROGUE"), level });
          const equipment = new Equipment(db);
          // 武器・防具・盾・アクセサリーを、装備できる部位に装備する（防具の基礎性能・統一ボーナスも比べる）
          for (let k = 0; k < 6; k++) {
            const item = gen();
            const base = db.itemBases.get(item.base);
            const slot = base === undefined ? undefined : slotsFor(base, true)[0];
            if (slot !== undefined) equipment.equip(item, slot, true);
          }
          const inventory = new Inventory();
          for (let i = 0; i < owned; i++) inventory.addItem(gen());
          const p: PlayerProfile = {
            name: "性質",
            character,
            equipment,
            inventory,
            stash: new Inventory(STASH_SLOTS),
            skillSlots: new Map(),
            starAllocation: [],
            loadouts: [emptyLoadout(1, "JOB-ROGUE")],
            activeLoadout: 1,
            unlockedRegions: [],
            deathLog: { count: 0, lastCause: null },
            questStages: [],
            secretsFound: [],
            bossKills: {},
            kept: emptyKeptFields(),
          };
          const store = new SaveStore(db, new MemoryBackend());
          store.save(2, toSaveData(db, p));
          const r = store.load(2);
          if (!r.ok) return false;
          expect(computed(r.profile)).toEqual(computed(p));
          expect(r.profile.inventory.items).toEqual(p.inventory.items);
          return true;
        },
      ),
      { numRuns: 60 },
    );
  });
});

/** 版1（開発計画書6.9 の例の形）のデータ。 */
/** 版5（ボスを倒した回数が無い）のデータ。 */
function v5Sample(): Record<string, unknown> {
  const v6 = { ...(toSaveData(db, sampleProfile()) as Record<string, unknown>) };
  delete v6["boss_kills"];
  return { ...v6, save_version: 5 };
}

/** 版4（クエストの段階・隠し星が無い）のデータ。 */
function v4Sample(): Record<string, unknown> {
  const v5 = { ...v5Sample() };
  delete v5["quest_stages"];
  delete v5["secrets_found"];
  return { ...v5, save_version: 4 };
}

/** 版3（転移の石・死亡の記録が無い）のデータ。 */
function v3Sample(): Record<string, unknown> {
  const v4 = { ...v4Sample() };
  delete v4["unlocked_regions"];
  delete v4["death_log"];
  return { ...v4, save_version: 3 };
}

/** 版2（金貨・技の枠はあるが、装備に強化・クラフトの項目が無い）のデータ。 */
function v2Sample(): Record<string, unknown> {
  const v3 = v3Sample();
  const items = Object.fromEntries(
    Object.entries(v3["items"] as SaveData["items"]).map(([k, i]) => {
      const old: Partial<typeof i> = { ...i };
      delete old.enhance;
      delete old.forge_load;
      delete old.sealed;
      delete old.seals_used;
      delete old.cracks;
      delete old.inscription;
      return [k, old];
    }),
  );
  return { ...v3, save_version: 2, items };
}

/** 版1（開発計画書6.9 の例の形）のデータ。 */
function v1Sample(): Record<string, unknown> {
  const v2 = v2Sample();
  const rest = { ...v2 };
  delete rest["gold"];
  const jobs = Object.fromEntries(
    Object.entries(v2["jobs"] as SaveData["jobs"]).map(([k, j]) => {
      const old: Partial<typeof j> = { ...j };
      delete old.skill_slots;
      return [k, old];
    }),
  );
  return { ...rest, save_version: 1, jobs };
}

const wrap = (data: unknown): string => {
  const payload = JSON.stringify(data);
  return JSON.stringify({
    format: "stella-sigil-save",
    save_version: 1,
    checksum: checksum(payload),
    payload,
  });
};

describe("T11：1つ前の版のデータを移行できる", () => {
  it("版1 → 版4：金貨は0、技の枠は空（初期の並び）。その他は同じ", () => {
    const backend = new MemoryBackend();
    backend.write("stella-sigil/slot1", wrap(v1Sample()));
    const store = new SaveStore(db, backend);
    const r = store.load(1);
    if (!r.ok) throw new Error(r.error?.message ?? "空");
    expect(r.data.save_version).toBe(SAVE_VERSION);
    expect(r.data.gold).toBe(0);
    expect(Object.values(r.data.jobs).every((j) => j.skill_slots.length === 0)).toBe(true);
    expect(r.profile.skillSlots.size).toBe(0);
    expect(computed(r.profile)).toEqual(computed(sampleProfile()));
    // 読み込みでは、保存先を変えない（版1のまま）
    expect(backend.read("stella-sigil/slot1")).toBe(wrap(v1Sample()));
  });

  it("版2 → 版4：装備は強化+0・負荷0・封詞・亀裂・銘なし", () => {
    const data = decodeSave(wrap(v2Sample()));
    expect(data.save_version).toBe(SAVE_VERSION);
    expect(Object.values(data.items).every((i) => i.enhance === 0 && i.forge_load === 0)).toBe(
      true,
    );
    expect(Object.values(data.items).every((i) => i.sealed === null && i.cracks.length === 0)).toBe(
      true,
    );
    expect({
      ...data,
      unlocked_regions: ["REGION-A1"],
      death_log: { count: 2, last_cause: "ENM-FOREST-WOLF" },
      quest_stages: ["QUEST-FOREST-1"],
      secrets_found: ["SECRET-A3-BUSH", "SECRET-MOTHER-TREE"],
      boss_kills: { "ENM-MOTHER-TREE": 2 },
    }).toEqual(toSaveData(db, sampleProfile()));
  });

  it("職紋盤：取得と職奥義を保存して戻す。データに無い・別のジョブ・職奥義の不一致は参照の問題", () => {
    const data = toSaveData(db, sampleProfile());
    expect(data.jobs["JOB-ROGUE"]?.board_allocation).toEqual(["JBN-ROGUE-T1", "JBN-ROGUE-T2"]);
    expect(fromSaveData(db, data).kept.boards["JOB-ROGUE"]?.board).toEqual([
      "JBN-ROGUE-T1",
      "JBN-ROGUE-T2",
    ]);
    const withBoard = (board: string[], mastery: string | null): SaveData => {
      const rogue = data.jobs["JOB-ROGUE"];
      if (rogue === undefined) throw new Error("盗賊が無い");
      return {
        ...data,
        jobs: {
          ...data.jobs,
          "JOB-ROGUE": { ...rogue, board_allocation: board, mastery_choice: mastery },
        },
      };
    };
    expect(() => fromSaveData(db, withBoard(["JBN-NONE"], null))).toThrow(SaveDataError);
    expect(() => fromSaveData(db, withBoard(["JBN-WARRIOR-T1"], null))).toThrow(SaveDataError);
    expect(() => fromSaveData(db, withBoard(["JBN-ROGUE-T1"], "JBN-ROGUE-M-SHADOW"))).toThrow(
      SaveDataError,
    );
    expect(() =>
      fromSaveData(db, withBoard(["JBN-ROGUE-M-SHADOW", "JBN-ROGUE-M-SILENT"], null)),
    ).toThrow(SaveDataError);
  });

  it("版5 → 版6：ボスはまだ倒していない。ボスでない敵・データに無い敵は参照の問題", () => {
    const data = decodeSave(wrap(v5Sample()));
    expect(data.save_version).toBe(SAVE_VERSION);
    expect(data.boss_kills).toEqual({});
    expect({ ...data, boss_kills: { "ENM-MOTHER-TREE": 2 } }).toEqual(
      toSaveData(db, sampleProfile()),
    );
    expect(fromSaveData(db, toSaveData(db, sampleProfile())).bossKills).toEqual({
      "ENM-MOTHER-TREE": 2,
    });
    expect(() => fromSaveData(db, { ...data, boss_kills: { "ENM-FOREST-WOLF": 1 } })).toThrow(
      SaveDataError,
    );
    expect(() => fromSaveData(db, { ...data, boss_kills: { "ENM-NONE": 1 } })).toThrow(
      SaveDataError,
    );
  });

  it("版4 → 版5：クエストの段階・隠し星は無し。データに無い段階は参照の問題", () => {
    const data = decodeSave(wrap(v4Sample()));
    expect(data.quest_stages).toEqual([]);
    expect(data.secrets_found).toEqual([]);
    expect(() => fromSaveData(db, { ...data, quest_stages: ["QUEST-NONE"] })).toThrow(
      SaveDataError,
    );
    expect(() => fromSaveData(db, { ...data, secrets_found: ["SECRET-NONE"] })).toThrow(
      SaveDataError,
    );
  });

  it("版3 → 版4：転移の石は未解放・死亡の記録は0", () => {
    const data = decodeSave(wrap(v3Sample()));
    expect(data.unlocked_regions).toEqual([]);
    expect(data.death_log).toEqual({ count: 0, last_cause: null });
  });

  it("このゲームより新しい版・移行の手順の無い版は、版の問題として検出する", () => {
    const newer = { ...toSaveData(db, sampleProfile()), save_version: SAVE_VERSION + 1 };
    expect(() => decodeSave(wrap(newer))).toThrow(SaveDataError);
    expect(() => decodeSave(wrap({ ...v1Sample(), save_version: 0 }))).toThrow(
      expect.objectContaining({ kind: "version" }),
    );
    expect(() => decodeSave(wrap(v1Sample()), {})).toThrow(/移行の手順が無い/);
  });
});

describe("T11：壊れたデータは検出し、元のデータを上書きしない", () => {
  const good = (): string => encodeSave(toSaveData(db, sampleProfile()));
  const kindOf = (text: string): string => {
    try {
      decodeSave(text);
      return "ok";
    } catch (e) {
      return e instanceof SaveDataError ? e.kind : "other";
    }
  };

  it("壊れ方ごとに、種類を分けて検出する", () => {
    const text = good();
    expect(kindOf(text)).toBe("ok");
    expect(kindOf(text.slice(0, text.length / 2))).toBe("parse");
    expect(kindOf("{}")).toBe("parse");
    // 中身の1文字を変える（検査値が合わない）
    const env = JSON.parse(text) as { payload: string };
    const flipped = JSON.stringify({
      ...JSON.parse(text),
      payload: env.payload.replace("テスト", "テヌト"),
    });
    expect(kindOf(flipped)).toBe("checksum");
    // 形が違う（検査値は合っている）
    expect(kindOf(wrap({ ...toSaveData(db, sampleProfile()), gold: -1 }))).toBe("schema");
  });

  it("データに無いベース・2か所にある装備・入らない部位・どこにも無い装備は、参照の問題", () => {
    const base = toSaveData(db, sampleProfile());
    const load = (d: SaveData): string => {
      try {
        fromSaveData(db, d);
        return "ok";
      } catch (e) {
        return e instanceof SaveDataError ? e.kind : String(e);
      }
    };
    const itm3 = base.items["itm_3"];
    if (itm3 === undefined) throw new Error("itm_3 が無い");
    expect(load({ ...base, items: { ...base.items, itm_3: { ...itm3, base: "BASE-NONE" } } })).toBe(
      "reference",
    );
    expect(load({ ...base, stash: [...base.stash, "itm_3"] })).toBe("reference");
    expect(load({ ...base, inventory: [] })).toBe("reference");
    const lo = base.loadouts[0];
    if (lo === undefined) throw new Error("ロードアウトが無い");
    // 両手武器を主手に持ちながら副手にも装備している
    expect(
      load({
        ...base,
        inventory: [],
        loadouts: [{ ...lo, equipment: { ...lo.equipment, mainHand: "itm_3" } }],
        stash: [...base.stash, "itm_1"],
      }),
    ).toBe("reference");
    expect(load({ ...base, character: { ...base.character, xp: 1e9 } })).toBe("reference");
    expect(load({ ...base, materials: { "MAT-NONE": 1 } })).toBe("reference");
    const withStars = (ids: string[]): SaveData => ({
      ...base,
      loadouts: [{ ...lo, star_allocation: ids }],
    });
    expect(load(withStars(["STAR-NONE"]))).toBe("reference");
    expect(load(withStars(["STAR-GOU-START"]))).toBe("reference");
    expect(load(withStars(["STAR-JIN-0001", "STAR-JIN-0001"]))).toBe("reference");
    expect(load(withStars(["STAR-GOU-0101"]))).toBe("ok");
    // 使っていないロードアウト：持っていない装備・データに無いノードは参照の問題。持っている装備なら良い
    const other = (extra: Partial<SaveData["loadouts"][number]>): SaveData => ({
      ...base,
      loadouts: [
        lo,
        {
          id: 2,
          name: "2",
          main_job: "JOB-WARRIOR",
          equipment: {},
          star_allocation: [],
          extra_entries: [],
          ...extra,
        },
      ],
    });
    expect(load(other({ equipment: { mainHand: "itm_none" } }))).toBe("reference");
    expect(load(other({ star_allocation: ["STAR-NONE"] }))).toBe("reference");
    expect(load(other({ main_job: "JOB-NONE" }))).toBe("reference");
    expect(load(other({ equipment: { mainHand: "itm_3" } }))).toBe("ok");
  });

  it("壊れたデータを読み込んでも、保存先は変わらない", () => {
    const backend = new MemoryBackend();
    const broken = good().replace("テスト", "テヌト");
    backend.write("stella-sigil/slot1", broken);
    const store = new SaveStore(db, backend);
    const snapshot = new Map(backend.data);
    const r = store.load(1);
    expect(r.ok).toBe(false);
    expect(r.ok ? undefined : r.error?.kind).toBe("checksum");
    expect(backend.data).toEqual(snapshot);
  });

  it("壊れたデータの上に保存するときは、.corrupt に退避してから書く。正しいデータは .bak に残す", () => {
    const backend = new MemoryBackend();
    const store = new SaveStore(db, backend);
    const broken = good().replace("テスト", "テヌト");
    backend.write("stella-sigil/slot1", broken);
    const data = toSaveData(db, sampleProfile());
    store.save(1, data);
    expect(backend.read("stella-sigil/slot1.corrupt")).toBe(broken);
    expect(store.load(1).ok).toBe(true);
    // 2回目：1回目の正しいデータは .bak に
    const first = backend.read("stella-sigil/slot1");
    store.save(1, { ...data, gold: 999 });
    expect(backend.read("stella-sigil/slot1.bak")).toBe(first);
    const bak = store.loadBackup(1);
    expect(bak.ok && bak.data.gold).toBe(321);
    // .corrupt は最初に退避したものを残す
    expect(backend.read("stella-sigil/slot1.corrupt")).toBe(broken);
  });

  it("正しくないデータは保存しない（何も書かない）", () => {
    const backend = new MemoryBackend();
    const store = new SaveStore(db, backend);
    const data = toSaveData(db, sampleProfile());
    store.save(1, data);
    const snapshot = new Map(backend.data);
    expect(() => {
      store.save(1, { ...data, inventory: [...data.inventory, "itm_none"] });
    }).toThrow(SaveDataError);
    expect(backend.data).toEqual(snapshot);
  });
});

describe("ロードアウトの装備の参照（仕様書v0.2 4.13、M-15）", () => {
  it("なくした装備を登録していた全てのロードアウトで、その部位が空きになる", () => {
    const list = [
      { ...emptyLoadout(1, "JOB-WARRIOR"), equipment: { mainHand: "a", offHand: "b" } },
      { ...emptyLoadout(2, "JOB-WARRIOR"), equipment: { mainHand: "a" } },
      emptyLoadout(3, "JOB-ROGUE"),
    ];
    expect(loadoutsUsing(list, "a")).toEqual([1, 2]);
    const after = forgetItem(list, "a");
    expect(after[0]?.equipment).toEqual({ offHand: "b" });
    expect(after[1]?.equipment).toEqual({});
    expect(after[2]).toBe(list[2]);
    expect(list[0]?.equipment.mainHand).toBe("a");
    expect(() => emptyLoadout(4, "JOB-WARRIOR")).toThrow(RangeError);
  });
});

describe("スロットと自動セーブ（補助仕様書15章）", () => {
  it("3スロット：空き・正しい・壊れたを一覧に出す。範囲外は RangeError", () => {
    const backend = new MemoryBackend();
    const store = new SaveStore(db, backend);
    store.save(1, toSaveData(db, sampleProfile()));
    backend.write("stella-sigil/slot3", "壊れた");
    const list = store.list();
    expect(list.map((s) => s.state)).toEqual(["ok", "empty", "corrupt"]);
    expect(list[0]).toMatchObject({ name: "テスト", level: 16, mainJob: "JOB-ROGUE" });
    expect(() => store.load(0)).toThrow(RangeError);
    expect(() => store.load(4)).toThrow(RangeError);
  });

  it("自動セーブ：ダンジョンの中は60秒ごと、きっかけがあればすぐ。町では時間で保存しない", () => {
    const t = new AutoSaveTimer();
    t.tick(DUNGEON_AUTOSAVE_SECONDS - 1, true);
    expect(t.due()).toBe(false);
    t.tick(1, true);
    expect(t.due()).toBe(true);
    expect(t.due()).toBe(false);
    t.tick(1000, false);
    expect(t.due()).toBe(false);
    t.notify("trade");
    expect(t.reason).toBe("trade");
    expect(t.due()).toBe(true);
    expect(() => {
      t.tick(-1, true);
    }).toThrow(RangeError);
  });
});
