import {
  AutoSaver,
  MemoryStorage,
  SAVE_VERSION,
  SaveManager,
  computeGear,
  createStandardJobs,
  createFighter,
  fromSave,
  generateItem,
  createRng,
  migrate,
  newGameState,
  newSave,
  reconcile,
  saveSchema,
  toSave,
  WARRIOR_JOB,
  type GameState,
  type ItemInstance,
} from "@stella/core";
import { describe, expect, it } from "vitest";
import { GEAR_DATA, GENERATION_DATA } from "../src/index.ts";

const registry = createStandardJobs();
let n = 0;
const gen = (rarity: ItemInstance["rarity"], ilvl = 14, seed = n): ItemInstance =>
  generateItem(
    GENERATION_DATA,
    { ilvl, rarity, uid: () => `itm_${String(n++).padStart(6, "0")}` },
    createRng(seed),
  );

function sampleState(): GameState {
  const s = newGameState(registry, "テスト", "JOB-WARRIOR");
  s.progression.gainExp(5000);
  s.progression.character.level = 15;
  s.progression.changeJob("JOB-ROGUE");
  s.progression.gainExp(700);
  for (let i = 0; i < 5; i++) s.bag.add(gen("rare", 14, i));
  s.stash.add(gen("magic", 8, 99));
  for (const base of ["BASE-WPN-GREATSWORD-T1", "BASE-ARM-HEAVY-BODY-T1"]) {
    s.equipment.equip(
      {
        uid: `itm_eq_${base}`,
        baseId: base,
        rarity: "rare",
        ilvl: 14,
        enhance: 0,
        affixes: [{ id: "AFX-SUF-ATKSPD", tier: 6, rolls: [5] }],
      },
      GEAR_DATA,
    );
  }
  s.purse.gold = 1234;
  s.purse.addMaterial("MAT-AWAKENING-DUST", 3);
  s.bossTokens = { "BOSS-CH1": 7 };
  s.questPoints = 3;
  return s;
}

const stats = { 剛: 20, 迅: 10, 理: 5, 魂: 5 };
const summary = (s: GameState) => {
  const gear = computeGear(s.equipment, GEAR_DATA, stats);
  const f = createFighter(WARRIOR_JOB, {
    maxHp: 100,
    maxMp: 100,
    weaponKey: "greatsword",
    weaponClass: "greatsword",
    jobLevel: 1,
  });
  f.setGear(gear);
  return {
    totals: gear.totals,
    armor: gear.armor,
    range: f.weaponDamageRange(),
    speed: f.attackSpeed,
    maxHp: f.maxHp,
  };
};

describe("T11 セーブ・ロード", () => {
  it("保存して読み込むと、状態が完全に一致し、計算し直した能力値・戦闘の数値も一致する", async () => {
    const before = sampleState();
    const mgr = new SaveManager(new MemoryStorage());
    await mgr.save(1, toSave(before));
    const res = await mgr.load(1);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.repairs).toEqual([]);
    const after = fromSave(res.data, registry, GEAR_DATA);
    expect(toSave(after)).toEqual(toSave(before));
    expect(summary(after)).toEqual(summary(before));
    expect(after.progression.mainJob).toBe("JOB-ROGUE");
    expect(after.progression.jobState("JOB-WARRIOR").level).toBe(
      before.progression.jobState("JOB-WARRIOR").level,
    );
    expect(after.purse.gold).toBe(1234);
    expect(after.purse.material("MAT-AWAKENING-DUST")).toBe(3);
    expect(after.bag.count).toBe(5);
    expect(after.stash.count).toBe(1);
  });
  it("能力値・有効なノードなどの計算結果は保存しない", () => {
    const text = JSON.stringify(toSave(sampleState()));
    expect(text).not.toContain("totals");
    expect(text).not.toContain("armor");
  });
  it("3つのスロットは独立している。範囲外のスロットは誤り", async () => {
    const mgr = new SaveManager(new MemoryStorage());
    const a = toSave(sampleState());
    const b = { ...a, character: { ...a.character, name: "二人目" } };
    await mgr.save(1, a);
    await mgr.save(3, b);
    expect(await mgr.exists(2)).toBe(false);
    expect(await mgr.load(2)).toEqual({ ok: false, reason: "empty" });
    const r3 = await mgr.load(3);
    expect(r3.ok && r3.data.character.name).toBe("二人目");
    await expect(mgr.save(4, a)).rejects.toThrow();
    await expect(mgr.save(0, a)).rejects.toThrow();
  });
  it("スキーマに合わないデータは保存できない", async () => {
    const mgr = new SaveManager(new MemoryStorage());
    await expect(mgr.save(1, { ...toSave(sampleState()), gold: -5 })).rejects.toThrow();
    expect(saveSchema.safeParse({ saveVersion: SAVE_VERSION }).success).toBe(false);
  });
});

describe("版の移行", () => {
  const v1 = (): Record<string, unknown> => {
    const full = toSave(sampleState()) as unknown as Record<string, unknown>;
    const { gold, ...rest } = full;
    delete rest["bossTokens"];
    delete rest["discoveries"];
    return { ...rest, saveVersion: 1, materials: { ...(rest["materials"] as object), 金貨: gold } };
  };
  it("1つ前の版（v1）のデータを移行できる。金貨が独立した項目になる", async () => {
    const storage = new MemoryStorage();
    const mgr = new SaveManager(storage);
    // v1 のセーブを、保存先に直接置く
    const body = JSON.stringify(v1());
    const { hashString } = await import("@stella/core");
    storage.map.set(
      "stella:slot1",
      JSON.stringify({ format: "stella-save", checksum: hashString(body), body }),
    );
    const res = await mgr.load(1);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.migratedFrom).toBe(1);
    expect(res.data.saveVersion).toBe(SAVE_VERSION);
    expect(res.data.gold).toBe(1234);
    expect(res.data.materials["金貨"]).toBeUndefined();
    // 移行する前に、元のデータを残している
    expect(storage.map.has("stella:slot1:premigrate-v1")).toBe(true);
    expect(storage.map.get("stella:slot1:premigrate-v1")).toBe(storage.map.get("stella:slot1"));
  });
  it("新しすぎる版・版のないデータは読まない", () => {
    expect(migrate({ saveVersion: SAVE_VERSION + 1 })).toEqual({
      ok: false,
      reason: "tooNew",
      from: SAVE_VERSION + 1,
    });
    expect(migrate({})).toEqual({ ok: false, reason: "unknown" });
    expect(migrate(null).ok).toBe(false);
  });
});

describe("壊れたデータ", () => {
  it("検出し、元のデータを上書きしない。1つ前のセーブから復元する", async () => {
    const storage = new MemoryStorage();
    const mgr = new SaveManager(storage);
    const a = toSave(sampleState());
    await mgr.save(1, a);
    const b = { ...a, gold: 9999 };
    await mgr.save(1, b);
    // 本体を壊す
    const good = storage.map.get("stella:slot1") ?? "";
    const broken = good.replace("9999", "1111");
    storage.map.set("stella:slot1", broken);
    const res = await mgr.load(1);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.recoveredFromBackup).toBe(true);
    expect(res.data.gold).toBe(1234);
    // 壊れた元のデータは別に残っている
    expect(storage.map.get("stella:slot1:corrupt")).toBe(broken);
  });
  it("復元できるものがなければ失敗を返し、元のデータは消さない", async () => {
    const storage = new MemoryStorage();
    const mgr = new SaveManager(storage);
    storage.map.set("stella:slot1", "これはセーブではない");
    expect(await mgr.load(1)).toEqual({ ok: false, reason: "corrupt" });
    expect(storage.map.get("stella:slot1")).toBe("これはセーブではない");
    expect(storage.map.get("stella:slot1:corrupt")).toBe("これはセーブではない");
  });
  it("形が合わないデータ（チェックサムは正しい）を検出する", async () => {
    const storage = new MemoryStorage();
    const mgr = new SaveManager(storage);
    const { hashString } = await import("@stella/core");
    const body = JSON.stringify({ ...toSave(sampleState()), gold: "多い" });
    storage.map.set(
      "stella:slot1",
      JSON.stringify({ format: "stella-save", checksum: hashString(body), body }),
    );
    expect(await mgr.load(1)).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("参照の整合（開発計画書 M-15）", () => {
  it("分解などで消えた装備を参照する部位は空きになり、持ち物の存在しない参照は取り除かれる", () => {
    const s = toSave(sampleState());
    const lost = s.loadouts[0]?.equipment["主手"] ?? "";
    expect(lost).not.toBe("");
    const broken = {
      ...s,
      items: Object.fromEntries(Object.entries(s.items).filter(([uid]) => uid !== lost)),
      inventory: [...s.inventory, "itm_none"],
    };
    const { data, repairs } = reconcile(broken);
    expect(data.loadouts[0]?.equipment["主手"]).toBeNull();
    expect(data.loadouts[0]?.equipment["胴"]).not.toBeNull();
    expect(data.inventory).not.toContain("itm_none");
    expect(repairs.length).toBe(2);
    const state = fromSave(data, registry, GEAR_DATA);
    expect(state.equipment.get("主手")).toBeUndefined();
    expect(state.equipment.get("胴")).toBeDefined();
  });
});

describe("自動セーブ（補助仕様書 15章）", () => {
  it("町・地域の移動・クラフト・売買・振り直しでは出来事のたびに保存。ダンジョンの中は60秒ごと", () => {
    const a = new AutoSaver();
    for (const e of ["enterTown", "changeArea", "craft", "trade", "respec"] as const)
      expect(a.onEvent(e)).toBe(true);
    let saves = 0;
    for (let i = 0; i < 60 * 130; i++) if (a.tick(1 / 60, true)) saves++;
    expect(saves).toBe(2);
    let town = 0;
    for (let i = 0; i < 60 * 130; i++) if (a.tick(1 / 60, false)) town++;
    expect(town).toBe(0);
  });
  it("新しいキャラクターの空のセーブは、スキーマに合う", () => {
    expect(saveSchema.safeParse(newSave({ name: "A", originJob: "JOB-ROGUE" })).success).toBe(true);
  });
});
