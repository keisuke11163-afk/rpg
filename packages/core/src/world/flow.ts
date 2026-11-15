/**
 * 町と地域の行き来・転移の石・死亡の処理（補助仕様書 7・9.4章）。
 */
import type { Rng } from "../rng.ts";
import { generateRegion, type EnemyLookup, type RegionInstance } from "./region.ts";
import type { MapDef } from "./map.ts";

export const TOWN_ID = "TOWN-STELLAVIEW";

export interface DeathRecord {
  /** 死亡した地域 */
  regionId: string;
  /** 最後に受けた攻撃（原因）。バランス調整の指標 */
  cause: string;
}

/** 町（星見の村）の施設と、開放の条件（補助仕様書 8章） */
export const FACILITIES = [
  { id: "TEMPLE", name: "転職神殿", unlock: { charLevel: 15 } },
  { id: "STAR_READER", name: "星読み師", unlock: {} },
  { id: "ALTAR", name: "討伐の祭壇", unlock: { firstKill: "BOSS-CH1" } },
  { id: "SMITH", name: "鍛冶屋", unlock: {} },
  { id: "MERCHANT", name: "商人", unlock: {} },
  { id: "STASH", name: "倉庫", unlock: {} },
  { id: "TELEPORT", name: "転移の石", unlock: {} },
  { id: "DUMMY", name: "訓練用の人形", unlock: {} },
] as const;
export type FacilityId = (typeof FACILITIES)[number]["id"];

export function facilityUnlocked(
  id: FacilityId,
  state: { charLevel: number; firstKills: ReadonlySet<string> },
): boolean {
  const f = FACILITIES.find((x) => x.id === id);
  if (!f) return false;
  const u = f.unlock as { charLevel?: number; firstKill?: string };
  if (u.charLevel !== undefined && state.charLevel < u.charLevel) return false;
  if (u.firstKill !== undefined && !state.firstKills.has(u.firstKill)) return false;
  return true;
}

export class World {
  /** 今いる場所：町または地域のID */
  location: string = TOWN_ID;
  /** 解放した転移の石（地域のID）。A1は最初から解放（最初の地域） */
  readonly unlockedTeleports = new Set<string>();
  /** 初回討伐の記録（ボスなど） */
  readonly firstKills = new Set<string>();
  deaths = 0;
  readonly deathLog: DeathRecord[] = [];
  region: RegionInstance | undefined;
  private generation = 0;
  private readonly maps: ReadonlyMap<string, MapDef>;
  private readonly lookup: EnemyLookup;

  constructor(maps: readonly MapDef[], lookup: EnemyLookup, firstRegion: string) {
    this.maps = new Map(maps.map((m) => [m.id, m]));
    this.lookup = lookup;
    this.unlockedTeleports.add(firstRegion);
  }

  get inTown(): boolean {
    return this.location === TOWN_ID;
  }

  map(id: string): MapDef {
    const m = this.maps.get(id);
    if (!m) throw new Error(`地図がない: ${id}`);
    return m;
  }

  /** 町から転移の石で地域の入口へ移動する。解放していない地域へは行けない */
  teleportTo(regionId: string, rng: Rng): { ok: boolean; reason?: "locked" | "notInTown" } {
    if (!this.inTown) return { ok: false, reason: "notInTown" };
    if (!this.unlockedTeleports.has(regionId)) return { ok: false, reason: "locked" };
    this.enter(regionId, rng);
    return { ok: true };
  }

  /** 地域に入る（作り直す）。入るたびに配置が変わる */
  enter(regionId: string, rng: Rng): RegionInstance {
    this.location = regionId;
    this.generation++;
    this.region = generateRegion(this.map(regionId), this.lookup, rng, this.generation);
    return this.region;
  }

  /** 別の地域へ移る：今の地域は捨てられ、行き先が作られる */
  move(regionId: string, rng: Rng): RegionInstance {
    return this.enter(regionId, rng);
  }

  /** 入口の転移の石に触れて解放する */
  touchTeleportStone(regionId: string): boolean {
    const fresh = !this.unlockedTeleports.has(regionId);
    this.unlockedTeleports.add(regionId);
    return fresh;
  }

  /** 町に戻る：地域は作り直される（地面のアイテムは失われる） */
  returnToTown(): void {
    this.location = TOWN_ID;
    this.region = undefined;
  }

  /** 死亡：町に戻る。アイテム・経験値・素材・金貨は失わない。記録を残す。転移の石の解放は残る */
  die(cause: string): DeathRecord {
    const record: DeathRecord = { regionId: this.location, cause };
    this.deaths++;
    this.deathLog.push(record);
    this.returnToTown();
    return record;
  }

  /** セーブ用：保存する内容 */
  snapshot(): {
    unlockedRegions: string[];
    firstKills: string[];
    deaths: number;
    lastDeathCause: string | null;
  } {
    return {
      unlockedRegions: [...this.unlockedTeleports].sort(),
      firstKills: [...this.firstKills].sort(),
      deaths: this.deaths,
      lastDeathCause: this.deathLog[this.deathLog.length - 1]?.cause ?? null,
    };
  }

  restore(data: {
    unlockedRegions: readonly string[];
    firstKills: readonly string[];
    deaths: number;
  }): void {
    for (const id of data.unlockedRegions) this.unlockedTeleports.add(id);
    for (const id of data.firstKills) this.firstKills.add(id);
    this.deaths = data.deaths;
    // ダンジョンの途中でゲームを終えた場合、次に始めると町から再開する
    this.location = TOWN_ID;
    this.region = undefined;
  }
}
