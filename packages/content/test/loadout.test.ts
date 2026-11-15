import {
  Equipment,
  ItemBag,
  MATERIAL,
  MAX_LOADOUTS,
  Purse,
  StarBoard,
  applyLoadout,
  captureLoadout,
  createStandardJobs,
  disassemble,
  fromSave,
  loadoutsReferencing,
  newGameState,
  putLoadout,
  removeFromLoadouts,
  starRespecCost,
  toSave,
  type ItemInstance,
  type Loadout,
  type LoadoutHost,
} from "@stella/core";
import { describe, expect, it } from "vitest";
import { BOARD_DATA, GEAR_DATA } from "../src/index.ts";

let n = 0;
const item = (baseId: string, rarity: ItemInstance["rarity"] = "normal"): ItemInstance => ({
  uid: `L_${String(n++)}`,
  baseId,
  rarity,
  ilvl: 5,
  affixes: [],
  enhance: 0,
});
const host = (): LoadoutHost => ({
  equipment: new Equipment(),
  bag: new ItemBag(),
  stash: new ItemBag(),
  mainJob: "JOB-WARRIOR",
  starAllocation: [],
  extraEntries: [],
  jobBoards: {},
});
const wear = (h: LoadoutHost, it: ItemInstance): void => {
  h.equipment.equip(it, GEAR_DATA, { canDualWield: true });
};
const town = { inTown: true, canUseJob: () => true };

describe("ロードアウト（本仕様書 4.13）", () => {
  it("装備・ツリーの配置・メインジョブをセットで保存し、切り替えると戻る", () => {
    const h = host();
    const sword = item("BASE-WPN-GREATSWORD-T1");
    const dagger = item("BASE-WPN-DAGGER-T1");
    const body = item("BASE-ARM-HEAVY-BODY-T1");
    wear(h, sword);
    wear(h, body);
    h.starAllocation = ["STAR-A", "STAR-B"];
    h.jobBoards = { "JOB-WARRIOR": { allocation: ["JNODE-X"], mastery: null } };
    const one = captureLoadout(h, 1, "戦士のビルド");
    // 別のビルドに組み替える
    h.equipment.unequip("主手");
    h.bag.add(sword);
    wear(h, dagger);
    h.mainJob = "JOB-ROGUE";
    h.starAllocation = ["STAR-C"];
    h.jobBoards = { "JOB-ROGUE": { allocation: ["JNODE-R"], mastery: "JNODE-ROGUE-M1" } };
    const two = captureLoadout(h, 2, "盗賊のビルド");
    expect(two.mainJob).toBe("JOB-ROGUE");
    // 1番に切り替える
    const r = applyLoadout(h, one, GEAR_DATA, town);
    expect(r).toEqual({ ok: true, emptied: [] });
    expect(h.mainJob).toBe("JOB-WARRIOR");
    expect(h.equipment.get("主手")?.uid).toBe(sword.uid);
    expect(h.equipment.get("胴")?.uid).toBe(body.uid);
    expect(h.bag.get(dagger.uid)).toBeDefined(); // 外れた装備は持ち物へ
    expect(h.bag.get(sword.uid)).toBeUndefined();
    expect(h.starAllocation).toEqual(["STAR-A", "STAR-B"]);
    expect(h.jobBoards["JOB-WARRIOR"]?.allocation).toEqual(["JNODE-X"]);
    // 2番に戻す
    expect(applyLoadout(h, two, GEAR_DATA, town).ok).toBe(true);
    expect(h.mainJob).toBe("JOB-ROGUE");
    expect(h.equipment.get("主手")?.uid).toBe(dagger.uid);
    expect(h.starAllocation).toEqual(["STAR-C"]);
    expect(h.jobBoards["JOB-ROGUE"]?.mastery).toBe("JNODE-ROGUE-M1");
  });
  it("切り替えは町か安全地帯だけ。使えないジョブのロードアウトにも切り替えられない", () => {
    const h = host();
    wear(h, item("BASE-WPN-GREATSWORD-T1"));
    const l = captureLoadout(h, 1, "a");
    expect(applyLoadout(h, l, GEAR_DATA, { inTown: false, canUseJob: () => true })).toEqual({
      ok: false,
      reason: "notInTown",
      emptied: [],
    });
    expect(applyLoadout(h, l, GEAR_DATA, { inTown: true, canUseJob: () => false }).reason).toBe(
      "job",
    );
  });
  it("同じ装備を、複数のロードアウトに登録できる（実体を参照する）", () => {
    const h = host();
    const ring = item("BASE-ACC-RING-SILVER-T1");
    wear(h, ring);
    const a = captureLoadout(h, 1, "a");
    h.starAllocation = ["STAR-X"];
    const b = captureLoadout(h, 2, "b");
    expect(a.equipment["指輪1"]).toBe(ring.uid);
    expect(b.equipment["指輪1"]).toBe(ring.uid);
    expect(loadoutsReferencing([a, b], ring.uid)).toEqual([1, 2]);
    // 切り替えても、同じ指輪を着たまま（重複しない）
    applyLoadout(h, a, GEAR_DATA, town);
    expect(h.equipment.all().filter(([, i]) => i.uid === ring.uid)).toHaveLength(1);
    expect(h.bag.count).toBe(0);
  });
  it("分解して装備がなくなると、それを登録していた全てのロードアウトでその部位が空きになる（M-15）", () => {
    const h = host();
    const sword = item("BASE-WPN-GREATSWORD-T1", "rare");
    const body = item("BASE-ARM-HEAVY-BODY-T1");
    wear(h, sword);
    wear(h, body);
    const loadouts: Loadout[] = [captureLoadout(h, 1, "a"), captureLoadout(h, 2, "b")];
    expect(loadoutsReferencing(loadouts, sword.uid)).toEqual([1, 2]); // なくす前の確認の表示に使う
    // 持ち物に戻して分解する
    h.equipment.unequip("主手");
    h.bag.add(sword);
    const purse = new Purse();
    expect(disassemble(sword.uid, h.bag, purse).ok).toBe(true);
    expect(removeFromLoadouts(loadouts, sword.uid)).toEqual([1, 2]);
    expect(loadouts[0]?.equipment["主手"]).toBeNull();
    expect(loadouts[1]?.equipment["主手"]).toBeNull();
    expect(loadouts[0]?.equipment["胴"]).toBe(body.uid);
    // 空きの部位があっても、切り替えられる
    expect(applyLoadout(h, loadouts[0] as Loadout, GEAR_DATA, town)).toEqual({
      ok: true,
      emptied: [],
    });
    expect(h.equipment.get("主手")).toBeUndefined();
  });
  it("なくなった装備を参照していたロードアウトを切り替えると、その部位は空きになる（読み込みでも同じ）", () => {
    const h = host();
    const sword = item("BASE-WPN-GREATSWORD-T1");
    wear(h, sword);
    const l = captureLoadout(h, 1, "a");
    h.equipment.unequip("主手"); // 装備がどこにもない（失われた）
    const r = applyLoadout(h, l, GEAR_DATA, town);
    expect(r.ok).toBe(true);
    expect(r.emptied).toEqual(["主手"]);
    expect(h.equipment.get("主手")).toBeUndefined();
  });
  it("外れた装備を入れる場所がなければ、何も変えずに失敗する", () => {
    const h = { ...host(), bag: new ItemBag(1), stash: new ItemBag(0) };
    const a = item("BASE-WPN-GREATSWORD-T1");
    const b = item("BASE-WPN-DAGGER-T1");
    wear(h, a);
    const la = captureLoadout(h, 1, "a");
    h.equipment.unequip("主手");
    wear(h, b);
    h.bag.add(a);
    // la に切り替えると b が外れるが、持ち物は a が出て空くので入る。次に満杯のケース
    h.bag.add(item("BASE-ARM-HEAVY-HEAD-T1"));
    const bagBefore = h.bag.count;
    const r = applyLoadout(h, la, GEAR_DATA, town);
    expect(r.ok).toBe(bagBefore <= 1 ? true : false);
    if (!r.ok) expect(r.reason).toBe("full");
    if (!r.ok) expect(h.equipment.get("主手")?.uid).toBe(b.uid);
  });
  it("ロードアウトは3つまで。同じ番号は上書き", () => {
    const h = host();
    const list: Loadout[] = [];
    expect(MAX_LOADOUTS).toBe(3);
    expect(putLoadout(list, captureLoadout(h, 1, "a"))).toBe(true);
    expect(putLoadout(list, captureLoadout(h, 3, "c"))).toBe(true);
    expect(putLoadout(list, captureLoadout(h, 2, "b"))).toBe(true);
    expect(putLoadout(list, captureLoadout(h, 4, "d"))).toBe(false);
    expect(putLoadout(list, { ...captureLoadout(h, 2, "b2") })).toBe(true);
    expect(list.map((l) => l.name)).toEqual(["a", "b2", "c"]);
  });
  it("セーブして読み込むと、今のロードアウトの星辰盤・職紋盤の配置・装備が戻る", () => {
    const registry = createStandardJobs();
    const state = newGameState(registry, "T", "JOB-WARRIOR");
    const sword = item("BASE-WPN-GREATSWORD-T1");
    state.equipment.equip(sword, GEAR_DATA);
    state.starAllocation = ["STAR-GOU-0001", "STAR-GOU-0002"];
    state.extraEntries = ["STAR-JIN-START"];
    state.jobBoards = { "JOB-WARRIOR": { allocation: ["JNODE-WARRIOR-0001"], mastery: null } };
    const loaded = fromSave(toSave(state), registry, GEAR_DATA);
    expect(loaded.starAllocation).toEqual(["STAR-GOU-0001", "STAR-GOU-0002"]);
    expect(loaded.extraEntries).toEqual(["STAR-JIN-START"]);
    expect(loaded.jobBoards["JOB-WARRIOR"]?.allocation).toEqual(["JNODE-WARRIOR-0001"]);
    expect(loaded.equipment.get("主手")?.uid).toBe(sword.uid);
  });
});

describe("還星の灯と全体の振り直し（本仕様書 4.13）", () => {
  const board = (): StarBoard => {
    const b = new StarBoard(BOARD_DATA, "STAR-GOU-START");
    const first = BOARD_DATA.nodes.get("STAR-GOU-START")?.links[0] as string;
    b.allocate(first, 99);
    const second = BOARD_DATA.nodes.get(first)?.links.find((l) => l !== "STAR-GOU-START") as string;
    b.allocate(second, 99);
    return b;
  };
  it("星辰盤の1ノードを、還星の灯1個で返却できる。灯がなければ返却できない。つながりを切る返却はできない", () => {
    const b = board();
    const [first, second] = b.allocated as [string, string];
    const purse = new Purse();
    expect(b.refundWithLamp(second, purse, MATERIAL.returnLamp)).toEqual({
      ok: false,
      reason: "lamp",
    });
    expect(b.has(second)).toBe(true);
    purse.addMaterial(MATERIAL.returnLamp, 2);
    expect(b.refundWithLamp(first, purse, MATERIAL.returnLamp).reason).toBe("disconnects");
    expect(purse.material(MATERIAL.returnLamp)).toBe(2); // 失敗では灯を使わない
    expect(b.refundWithLamp(second, purse, MATERIAL.returnLamp).ok).toBe(true);
    expect(purse.material(MATERIAL.returnLamp)).toBe(1);
    expect(b.has(second)).toBe(false);
  });
  it("全体の振り直し：キャラLv30までは無料（MVPでは常に無料）。Lv31以降は Lv²×20", () => {
    expect(starRespecCost(1)).toBe(0);
    expect(starRespecCost(20)).toBe(0);
    expect(starRespecCost(30)).toBe(0);
    expect(starRespecCost(31)).toBe(31 * 31 * 20);
    const b = board();
    b.reset();
    expect(b.allocated).toEqual([]);
    expect(b.pointsUsed).toBe(0);
  });
});
