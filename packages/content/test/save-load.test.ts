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
    kept: emptyKeptFields("JOB-ROGUE"),
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
          equipment.equip(gen(), "mainHand", true);
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
            kept: emptyKeptFields("JOB-ROGUE"),
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
function v1Sample(): Record<string, unknown> {
  const v2 = toSaveData(db, sampleProfile()) as Record<string, unknown>;
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
  it("版1 → 版2：金貨は0、技の枠は空（初期の並び）。その他は同じ", () => {
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
