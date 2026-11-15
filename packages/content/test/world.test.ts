import {
  FACILITIES,
  FILL_VALUE,
  Flask,
  ItemBag,
  Purse,
  TOWN_ID,
  World,
  createRng,
  createStandardJobs,
  facilityUnlocked,
  fromSave,
  generateRegion,
  insideWall,
  layoutSignature,
  newGameState,
  resolveWalls,
  toSave,
  type ItemInstance,
} from "@stella/core";
import { describe, expect, it } from "vitest";
import {
  ALL_MAPS,
  GEAR_DATA,
  REGION_MAPS,
  TOWN_FACILITY_POS,
  TOWN_MAP,
  enemyDef,
  mapDef,
} from "../src/index.ts";

const newWorld = (): World => new World(ALL_MAPS, enemyDef, "MAP-A1");
const A1 = mapDef("MAP-A1");

describe("固定のマップ（補助仕様書 8・9章）", () => {
  it("A1：区画3・敵のLv1〜3・群れの出現地点20〜30・精鋭2〜3・木箱候補8・宝箱候補3", () => {
    expect(A1.sections).toHaveLength(3);
    expect(A1.sections[0]?.levelMin).toBe(1);
    expect(A1.sections[2]?.levelMax).toBe(3);
    expect(A1.packSpawns.length).toBeGreaterThanOrEqual(20);
    expect(A1.packSpawns.length).toBeLessThanOrEqual(30);
    expect(A1.eliteSpotCount).toEqual([2, 3]);
    expect(A1.crateSpots).toHaveLength(8);
    expect(A1.chestSpots).toHaveLength(3);
    expect(A1.sections.flatMap((s) => s.enemies).sort()).toEqual(
      [...new Set(A1.sections.flatMap((s) => s.enemies))].flatMap((e) => [e, e, e]).sort(),
    );
  });
  it("A1〜A5：区画数・Lv・敵・精鋭数が補助仕様書 9.2 のとおり", () => {
    expect(REGION_MAPS.map((m) => m.id)).toEqual([
      "MAP-A1",
      "MAP-A2",
      "MAP-A3",
      "MAP-A4",
      "MAP-A5",
    ]);
    expect(REGION_MAPS.map((m) => m.sections.length)).toEqual([3, 3, 3, 2, 3]);
    const lv = REGION_MAPS.map((m) => [
      m.sections[0]?.levelMin,
      m.sections[m.sections.length - 1]?.levelMax,
    ]);
    expect(lv).toEqual([
      [1, 3],
      [4, 7],
      [8, 11],
      [12, 14],
      [16, 19],
    ]);
    expect(mapDef("MAP-A5").magicChance).toBe(0.15);
    expect(mapDef("MAP-A5").eliteSpotCount).toEqual([4, 6]);
    expect(mapDef("MAP-A2").sections[0]?.enemies).toContain("ENM-SPIT-LIZARD");
    expect(mapDef("MAP-A4").sections[0]?.enemies).toContain("ENM-ROT-SPROUT");
    expect(mapDef("MAP-A5").sections[0]?.enemies).toHaveLength(6);
  });
  it("出現地点・転移の石・出口は壁の中にない。入口の近くに敵は出ない", () => {
    for (const m of REGION_MAPS) {
      for (const p of [...m.packSpawns, ...m.eliteSpawns, ...m.crateSpots, ...m.chestSpots]) {
        expect(insideWall(p, m.walls)).toBe(false);
        expect(Math.hypot(p.x - m.entrance.x, p.y - m.entrance.y)).toBeGreaterThan(9);
      }
      expect(m.teleportStone).toBeDefined();
      expect(m.exits.length).toBeGreaterThanOrEqual(1);
    }
  });
  it("町：安全地帯（敵の出現地点がない）。施設8つに位置がある。A1への門がある", () => {
    expect(TOWN_MAP.packSpawns).toHaveLength(0);
    expect(TOWN_MAP.eliteSpawns).toHaveLength(0);
    expect(FACILITIES).toHaveLength(8);
    for (const f of FACILITIES) expect(TOWN_FACILITY_POS[f.id]).toBeDefined();
    expect(TOWN_MAP.exits[0]?.to).toBe("MAP-A1");
  });
  it("壁との衝突：押し戻される", () => {
    const wall = { x: 10, y: 0, w: 2, h: 10 };
    const p = resolveWalls({ x: 9.8, y: 5 }, 0.5, [wall]);
    expect(p.x).toBeCloseTo(9.5);
    expect(resolveWalls({ x: 3, y: 3 }, 0.5, [wall], { width: 20, height: 20 })).toEqual({
      x: 3,
      y: 3,
    });
    expect(resolveWalls({ x: -5, y: 30 }, 0.5, [], { width: 20, height: 20 })).toEqual({
      x: 0.5,
      y: 19.5,
    });
  });
});

describe("配置のランダム化（補助仕様書 9.3）", () => {
  it("入るたびに配置が変わる。同じ乱数なら同じ配置", () => {
    const a = layoutSignature(generateRegion(A1, enemyDef, createRng(1)));
    const b = layoutSignature(generateRegion(A1, enemyDef, createRng(2)));
    const c = layoutSignature(generateRegion(A1, enemyDef, createRng(1)));
    expect(a).not.toBe(b);
    expect(a).toBe(c);
    const w = newWorld();
    const rng = createRng(9);
    const first = layoutSignature(w.enter("MAP-A1", rng));
    const second = layoutSignature(w.enter("MAP-A1", rng));
    expect(first).not.toBe(second);
  });
  it("群れの出現地点の70%が有効。中身は区画の敵の一覧から。Lvは区画の範囲", () => {
    let packs = 0;
    let total = 0;
    const rng = createRng("packs");
    for (let i = 0; i < 300; i++) {
      const r = generateRegion(A1, enemyDef, rng, i);
      const ids = new Set(r.enemies.filter((e) => e.rank !== "elite").map((e) => e.packId));
      packs += ids.size;
      total += A1.packSpawns.length;
      for (const e of r.enemies) {
        expect(["ENM-FOREST-WOLF", "ENM-THORN-RAT"]).toContain(e.def.id);
        expect(e.level).toBeGreaterThanOrEqual(1);
        expect(e.level).toBeLessThanOrEqual(3);
      }
    }
    expect(packs / total).toBeGreaterThan(0.66);
    expect(packs / total).toBeLessThan(0.74);
  });
  it("魔法の敵：群れごとに10%で1体（A5は15%）。精鋭：出現地点ごとに50%", () => {
    const rate = (map: typeof A1): { magic: number; elite: number } => {
      let packs = 0;
      let magic = 0;
      let elite = 0;
      let spots = 0;
      const rng = createRng(`m-${map.id}`);
      for (let i = 0; i < 400; i++) {
        const r = generateRegion(map, enemyDef, rng, i);
        const groups = new Set(r.enemies.filter((e) => e.rank !== "elite").map((e) => e.packId));
        packs += groups.size;
        magic += r.enemies.filter((e) => e.rank === "magic").length;
        elite += r.enemies.filter((e) => e.rank === "elite").length;
        spots += (map.eliteSpotCount[0] + map.eliteSpotCount[1]) / 2;
      }
      return { magic: magic / packs, elite: elite / spots };
    };
    const a1 = rate(A1);
    expect(a1.magic).toBeGreaterThan(0.08);
    expect(a1.magic).toBeLessThan(0.12);
    expect(a1.elite).toBeGreaterThan(0.44);
    expect(a1.elite).toBeLessThan(0.56);
    expect(rate(mapDef("MAP-A5")).magic).toBeGreaterThan(0.13);
  });
  it("木箱は候補8か所から3か所。古びた宝箱は候補3か所から50%で1か所", () => {
    let chests = 0;
    const rng = createRng("c");
    for (let i = 0; i < 600; i++) {
      const r = generateRegion(A1, enemyDef, rng, i);
      const crates = r.containers.filter((c) => c.kind === "crate");
      expect(crates).toHaveLength(3);
      expect(new Set(crates.map((c) => `${String(c.pos.x)},${String(c.pos.y)}`)).size).toBe(3);
      for (const c of crates)
        expect(A1.crateSpots.some((s) => s.x === c.pos.x && s.y === c.pos.y)).toBe(true);
      const ch = r.containers.filter((c) => c.kind === "chest");
      expect(ch.length).toBeLessThanOrEqual(1);
      chests += ch.length;
    }
    expect(chests / 600).toBeGreaterThan(0.44);
    expect(chests / 600).toBeLessThan(0.56);
  });
});

describe("町と地域の行き来・転移の石・死亡（補助仕様書 7・9.4章）", () => {
  it("町から転移の石でA1の入口へ。解放していない地域へは行けない。町に戻ると地域は消える", () => {
    const w = newWorld();
    expect(w.inTown).toBe(true);
    expect(w.teleportTo("MAP-A2", createRng(1))).toEqual({ ok: false, reason: "locked" });
    expect(w.teleportTo("MAP-A1", createRng(1)).ok).toBe(true);
    expect(w.location).toBe("MAP-A1");
    expect(w.region?.enemies.length).toBeGreaterThan(0);
    expect(w.teleportTo("MAP-A1", createRng(1))).toEqual({ ok: false, reason: "notInTown" });
    w.returnToTown();
    expect(w.inTown).toBe(true);
    expect(w.region).toBeUndefined();
  });
  it("入口の転移の石に触れると解放され、町から行ける。別の地域へ移ると作り直される", () => {
    const w = newWorld();
    w.teleportTo("MAP-A1", createRng(1));
    const before = layoutSignature(w.region as never);
    w.move("MAP-A2", createRng(2));
    expect(w.location).toBe("MAP-A2");
    expect(w.touchTeleportStone("MAP-A2")).toBe(true);
    expect(w.touchTeleportStone("MAP-A2")).toBe(false);
    w.returnToTown();
    expect(w.teleportTo("MAP-A2", createRng(3)).ok).toBe(true);
    expect(layoutSignature(w.region as never)).not.toBe(before);
  });
  it("死亡：町に戻り、アイテム・素材・金貨・経験値は失わない。地域は作り直される。転移の石の解放は残る。死因を記録する", () => {
    const registry = createStandardJobs();
    const state = newGameState(registry, "T", "JOB-WARRIOR");
    const item: ItemInstance = {
      uid: "i1",
      baseId: "BASE-WPN-GREATSWORD-T1",
      rarity: "rare",
      ilvl: 5,
      affixes: [],
      enhance: 3,
    };
    state.bag.add(item);
    state.purse.gold = 500;
    state.purse.addMaterial("MAT-MAGIC-DUST", 7);
    state.progression.gainExp(1000);
    const exp = { ...state.progression.character };
    const w = newWorld();
    w.teleportTo("MAP-A1", createRng(1));
    w.touchTeleportStone("MAP-A2");
    const record = w.die("森狼の噛みつき");
    expect(w.inTown).toBe(true);
    expect(w.region).toBeUndefined();
    expect(record).toEqual({ regionId: "MAP-A1", cause: "森狼の噛みつき" });
    expect(w.deaths).toBe(1);
    expect(w.unlockedTeleports.has("MAP-A2")).toBe(true);
    expect(state.bag.get("i1")).toEqual(item);
    expect(state.purse.gold).toBe(500);
    expect(state.purse.material("MAT-MAGIC-DUST")).toBe(7);
    expect(state.progression.character).toEqual(exp);
    expect(w.teleportTo("MAP-A1", createRng(2)).ok).toBe(true);
  });
  it("施設の開放：転職神殿はキャラLv15、討伐の祭壇は母樹の初回撃破の後。他は最初から", () => {
    const base = { charLevel: 1, firstKills: new Set<string>() };
    expect(facilityUnlocked("SMITH", base)).toBe(true);
    expect(facilityUnlocked("TEMPLE", base)).toBe(false);
    expect(facilityUnlocked("TEMPLE", { ...base, charLevel: 15 })).toBe(true);
    expect(facilityUnlocked("ALTAR", base)).toBe(false);
    expect(facilityUnlocked("ALTAR", { ...base, firstKills: new Set(["BOSS-CH1"]) })).toBe(true);
  });
  it("セーブ：解放した転移の石・初回討伐・死亡の記録が残り、読み込むと町から再開する", () => {
    const registry = createStandardJobs();
    const state = newGameState(registry, "T", "JOB-WARRIOR");
    const w = newWorld();
    w.touchTeleportStone("MAP-A3");
    w.firstKills.add("BOSS-CH1");
    w.teleportTo("MAP-A1", createRng(1));
    w.die("牙猪の突進");
    state.world = w.snapshot();
    const loaded = fromSave(toSave(state), registry, GEAR_DATA);
    const w2 = newWorld();
    w2.restore(loaded.world);
    expect(w2.unlockedTeleports.has("MAP-A3")).toBe(true);
    expect(w2.firstKills.has("BOSS-CH1")).toBe(true);
    expect(w2.deaths).toBe(1);
    expect(loaded.world.lastDeathCause).toBe("牙猪の突進");
    expect(w2.location).toBe(TOWN_ID);
  });
});

describe("薬瓶（補助仕様書 6章）", () => {
  it("HP瓶：最大HPの40%を1.5秒かけて回復。回復中は同じ瓶を使えない。最大3回", () => {
    const f = new Flask("hp");
    expect(f.use(100)).toBe(true);
    expect(f.use(100)).toBe(false);
    let healed = 0;
    for (let i = 0; i < 100; i++) healed += f.tick(0.02);
    expect(healed).toBeCloseTo(40);
    expect(f.charges).toBe(2);
    expect(f.use(100)).toBe(true);
    for (let i = 0; i < 100; i++) f.tick(0.02);
    f.use(100);
    for (let i = 0; i < 100; i++) f.tick(0.02);
    expect(f.charges).toBe(0);
    expect(f.use(100)).toBe(false);
  });
  it("MP瓶は最大MPの50%。腰の装備の補正（革の帯+15%）が効く", () => {
    const f = new Flask("mp");
    f.use(60, 0.15);
    let healed = 0;
    for (let i = 0; i < 100; i++) healed += f.tick(0.02);
    expect(healed).toBeCloseTo(60 * 0.5 * 1.15);
  });
  it("充填：敵を倒すとたまり、40たまるごとに1回分戻る（通常1・魔法3・精鋭10・中ボス30・章ボス40）。HP瓶とMP瓶は別", () => {
    const hp = new Flask("hp");
    const mp = new Flask("mp");
    hp.charges = 0;
    for (let i = 0; i < 39; i++) hp.addFill(FILL_VALUE.normal);
    expect(hp.charges).toBe(0);
    hp.addFill(FILL_VALUE.normal);
    expect(hp.charges).toBe(1);
    hp.addFill(FILL_VALUE.chapterBoss);
    expect(hp.charges).toBe(2);
    expect(mp.charges).toBe(3);
    expect(FILL_VALUE).toEqual({ normal: 1, magic: 3, elite: 10, midBoss: 30, chapterBoss: 40 });
    hp.addFill(1000);
    expect(hp.charges).toBe(3);
  });
  it("町に入ったとき・死亡して町に戻ったとき全回復", () => {
    const f = new Flask("hp");
    f.charges = 0;
    f.refill();
    expect(f.charges).toBe(3);
  });
});

describe("持ち物と死亡（地面のアイテム）", () => {
  it("地面に落ちていて拾っていないアイテムは失われる（地域が作り直される）", () => {
    const bag = new ItemBag();
    const purse = new Purse();
    expect(bag.count).toBe(0);
    expect(purse.gold).toBe(0);
    const w = newWorld();
    w.teleportTo("MAP-A1", createRng(1));
    w.die("x");
    expect(w.region).toBeUndefined();
  });
});
