/**
 * ロードアウト（本仕様書 4.13）：装備と全てのツリーの配置（と、メインジョブ）をセットで3つまで保存する。
 * 切り替えは町か安全地帯だけ。装備は実体を参照するので、同じ装備を複数のロードアウトに登録できる。
 * 分解などで装備がなくなったときは、それを登録していた全てのロードアウトで、その部位が空きになる。
 */
import type { Equipment, EquipSlot, GearData } from "../items/gear.ts";
import { EQUIP_SLOTS } from "../items/gear.ts";
import type { ItemBag } from "../items/loot.ts";
import type { ItemInstance } from "../items/types.ts";
import type { Loadout } from "../save/schema.ts";

export const MAX_LOADOUTS = 3;

/** ロードアウトの保存・適用の対象になる、ゲームの今の状態 */
export interface LoadoutHost {
  equipment: Equipment;
  bag: ItemBag;
  stash: ItemBag;
  mainJob: string;
  /** 星辰盤の取得したノード（取った順）と、追加の入口 */
  starAllocation: string[];
  extraEntries: string[];
  /** 職紋盤の配置（ジョブごと） */
  jobBoards: Record<string, { allocation: string[]; mastery: string | null }>;
}

/** 今の状態をロードアウトにする（装備は実体のuidで参照する） */
export function captureLoadout(host: LoadoutHost, id: number, name: string): Loadout {
  const equipment: Record<string, string | null> = {};
  for (const [slot, item] of host.equipment.all()) equipment[slot] = item.uid;
  return {
    id,
    name,
    mainJob: host.mainJob,
    equipment: equipment,
    starAllocation: [...host.starAllocation],
    extraEntries: [...host.extraEntries],
    jobBoards: Object.fromEntries(
      Object.entries(host.jobBoards).map(([job, b]) => [
        job,
        { allocation: [...b.allocation], mastery: b.mastery },
      ]),
    ),
  };
}

export type LoadoutDenied = "notInTown" | "job" | "full" | "unknown";

export interface ApplyResult {
  ok: boolean;
  reason?: LoadoutDenied;
  /** 持ち主が見つからず、空きにした部位（装備が分解などでなくなっていた） */
  emptied: EquipSlot[];
}

/**
 * ロードアウトを適用する。町（安全地帯）だけでできる。
 * 装備は、今の装備・持ち物・倉庫の中から、uid で探して着る。入れ替えで外れた装備は持ち物（いっぱいなら倉庫）へ。
 */
export function applyLoadout(
  host: LoadoutHost,
  loadout: Loadout,
  gear: GearData,
  opts: { inTown: boolean; canUseJob: (jobId: string) => boolean },
): ApplyResult {
  if (!opts.inTown) return { ok: false, reason: "notInTown", emptied: [] };
  if (!opts.canUseJob(loadout.mainJob)) return { ok: false, reason: "job", emptied: [] };

  // 装備の候補：今の装備・持ち物・倉庫
  const pool = new Map<string, ItemInstance>();
  for (const [, item] of host.equipment.all()) pool.set(item.uid, item);
  for (const item of host.bag.items()) pool.set(item.uid, item);
  for (const item of host.stash.items()) pool.set(item.uid, item);

  const wanted: [EquipSlot, ItemInstance][] = [];
  const emptied: EquipSlot[] = [];
  for (const slot of EQUIP_SLOTS) {
    const uid = loadout.equipment[slot];
    if (uid === undefined || uid === null) continue;
    const item = pool.get(uid);
    if (item) wanted.push([slot, item]);
    else emptied.push(slot);
  }
  const wantedUids = new Set(wanted.map(([, i]) => i.uid));

  // 外れる装備を入れる場所があるか（変更の前に確かめる）
  const leftovers = host.equipment
    .all()
    .map(([, i]) => i)
    .filter((i) => !wantedUids.has(i.uid));
  const bagFreed = host.bag.items().filter((i) => wantedUids.has(i.uid)).length;
  const stashFreed = host.stash.items().filter((i) => wantedUids.has(i.uid)).length;
  const room =
    host.bag.capacity -
    host.bag.count +
    bagFreed +
    (host.stash.capacity - host.stash.count + stashFreed);
  if (leftovers.length > room) return { ok: false, reason: "full", emptied: [] };

  // 実行
  for (const [slot] of host.equipment.all()) host.equipment.unequip(slot);
  for (const uid of wantedUids) {
    host.bag.remove(uid);
    host.stash.remove(uid);
  }
  for (const [slot, item] of wanted) {
    host.equipment.equip(item, gear, { slot, canDualWield: true });
  }
  for (const item of leftovers) if (!host.bag.add(item)) host.stash.add(item);

  host.mainJob = loadout.mainJob;
  host.starAllocation = [...loadout.starAllocation];
  host.extraEntries = [...loadout.extraEntries];
  host.jobBoards = Object.fromEntries(
    Object.entries(loadout.jobBoards ?? {}).map(([job, b]) => [
      job,
      { allocation: [...b.allocation], mastery: b.mastery },
    ]),
  );
  return { ok: true, emptied };
}

/** 装備を登録している全てのロードアウト（なくす前の確認の表示に使う） */
export function loadoutsReferencing(loadouts: readonly Loadout[], uid: string): number[] {
  return loadouts.filter((l) => Object.values(l.equipment).some((u) => u === uid)).map((l) => l.id);
}

/** 装備がなくなった（分解・抽詞・残響化）：それを登録していた全てのロードアウトで、その部位が空きになる */
export function removeFromLoadouts(loadouts: Loadout[], uid: string): number[] {
  const affected: number[] = [];
  for (const l of loadouts) {
    let hit = false;
    for (const slot of EQUIP_SLOTS) {
      if (l.equipment[slot] === uid) {
        l.equipment[slot] = null;
        hit = true;
      }
    }
    if (hit) affected.push(l.id);
  }
  return affected;
}

/** ロードアウトを置く（1〜3番）。3つまで。既存の番号なら上書き */
export function putLoadout(loadouts: Loadout[], loadout: Loadout): boolean {
  if (loadout.id < 1 || loadout.id > MAX_LOADOUTS) return false;
  const i = loadouts.findIndex((l) => l.id === loadout.id);
  if (i >= 0) loadouts[i] = loadout;
  else loadouts.push(loadout);
  loadouts.sort((a, b) => a.id - b.id);
  return true;
}

/** 星辰盤の全体の振り直し：町の星読み師。金貨＝キャラLvの2乗×20。キャラLv30までは無料（MVPでは常に無料） */
export function starRespecCost(charLevel: number): number {
  return charLevel <= 30 ? 0 : charLevel * charLevel * 20;
}

/** 還星の灯：星辰盤の1ノードを返却する（1個） */
export const LAMP_COST = 1;
