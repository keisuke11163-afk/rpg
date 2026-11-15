/**
 * ゲームの状態とセーブデータの相互変換。能力値などの計算結果は保存せず、読み込み後に計算し直す。
 */
import { Equipment, EQUIP_SLOTS, type GearData } from "../items/gear.ts";
import { ItemBag, Purse } from "../items/loot.ts";
import type { ItemInstance } from "../items/types.ts";
import { Progression, type JobRegistry } from "../progress/jobs.ts";
import { INVENTORY_SLOTS, STASH_SLOTS } from "../items/loot.ts";
import { newSave, type SaveData } from "./schema.ts";

/** 保存の対象になるゲームの状態 */
export interface GameState {
  name: string;
  progression: Progression;
  equipment: Equipment;
  bag: ItemBag;
  stash: ItemBag;
  purse: Purse;
  bossTokens: Record<string, number>;
  questPoints: number;
  explorationPoints: number;
  /** 世界の進行（転移の石・初回討伐・死亡の記録） */
  world: {
    unlockedRegions: string[];
    firstKills: string[];
    deaths: number;
    lastDeathCause: string | null;
    foundSecrets: string[];
  };
  /** クエストの進行（クエストID → 達成した段階） */
  quests: Record<string, string[]>;
  /** 星辰盤の取得したノードと追加の入口（今のロードアウト） */
  starAllocation: string[];
  extraEntries: string[];
  /** 職紋盤の配置（ジョブごと）。ジョブを切り替えても残る */
  jobBoards: Record<string, { allocation: string[]; mastery: string | null }>;
  /** 経由した状態（職紋盤の配置・職奥義・ロードアウトなど、他の単位が足す部分）を保つための元のデータ */
  base: SaveData;
}

export function newGameState(registry: JobRegistry, name: string, originJob: string): GameState {
  return {
    name,
    progression: new Progression(registry, originJob),
    equipment: new Equipment(),
    bag: new ItemBag(INVENTORY_SLOTS),
    stash: new ItemBag(STASH_SLOTS),
    purse: new Purse(),
    bossTokens: {},
    questPoints: 0,
    explorationPoints: 0,
    world: {
      unlockedRegions: [],
      firstKills: [],
      deaths: 0,
      lastDeathCause: null,
      foundSecrets: [],
    },
    quests: {},
    starAllocation: [],
    extraEntries: [],
    jobBoards: {},
    base: newSave({ name, originJob }),
  };
}

/** 状態 → セーブデータ。装備の実体は「抽選の結果」だけを保存する */
export function toSave(state: GameState): SaveData {
  const items: Record<string, ItemInstance> = {};
  const keep = (item: ItemInstance): void => {
    items[item.uid] = item;
  };
  for (const item of state.bag.items()) keep(item);
  for (const item of state.stash.items()) keep(item);
  const equipment: Record<string, string | null> = {};
  for (const slot of EQUIP_SLOTS) {
    const item = state.equipment.get(slot);
    if (item) {
      keep(item);
      equipment[slot] = item.uid;
    }
  }
  const p = state.progression;
  const jobs: SaveData["jobs"] = {};
  for (const [id, st] of p.jobEntries()) {
    const prev = state.base.jobs[id];
    const board = state.jobBoards[id];
    jobs[id] = {
      level: st.level,
      exp: st.exp,
      boardAllocation: board?.allocation ?? prev?.boardAllocation ?? [],
      masteryChoice: board ? board.mastery : (prev?.masteryChoice ?? null),
    };
  }
  const active = state.base.activeLoadout;
  const loadouts = state.base.loadouts.map((l) =>
    l.id === active
      ? {
          ...l,
          mainJob: p.mainJob,
          equipment: equipment,
          starAllocation: [...state.starAllocation],
          extraEntries: [...state.extraEntries],
          jobBoards: Object.fromEntries(
            Object.entries(state.jobBoards).map(([job, b]) => [
              job,
              { allocation: [...b.allocation], mastery: b.mastery },
            ]),
          ),
        }
      : l,
  );
  return {
    ...state.base,
    character: {
      name: state.name,
      originJob: p.origin,
      level: p.character.level,
      exp: p.character.exp,
      mainJob: p.mainJob,
      subJob: state.base.character.subJob,
    },
    jobs,
    items: items,
    inventory: state.bag.items().map((i) => i.uid),
    stash: state.stash.items().map((i) => i.uid),
    loadouts,
    gold: state.purse.gold,
    materials: Object.fromEntries(state.purse.materials),
    bossTokens: { ...state.bossTokens },
    questPoints: state.questPoints,
    explorationPoints: state.explorationPoints,
    world: state.world,
    quests: state.quests,
  };
}

/** セーブデータ → 状態 */
export function fromSave(save: SaveData, registry: JobRegistry, gear: GearData): GameState {
  const state = newGameState(registry, save.character.name, save.character.originJob);
  state.base = save;
  state.progression.restore({
    character: { level: save.character.level, exp: save.character.exp },
    mainJob: save.character.mainJob,
    jobs: Object.entries(save.jobs).map(([id, j]) => [id, { level: j.level, exp: j.exp }] as const),
  });
  const item = (uid: string): ItemInstance | undefined =>
    save.items[uid] as ItemInstance | undefined;
  for (const uid of save.inventory) {
    const it = item(uid);
    if (it) state.bag.add(it);
  }
  for (const uid of save.stash) {
    const it = item(uid);
    if (it) state.stash.add(it);
  }
  const loadout = save.loadouts.find((l) => l.id === save.activeLoadout);
  if (loadout) {
    for (const slot of EQUIP_SLOTS) {
      const uid = loadout.equipment[slot];
      const it = uid ? item(uid) : undefined;
      if (it) state.equipment.equip(it, gear, { slot: slot, canDualWield: true });
    }
  }
  state.purse.gold = save.gold;
  for (const [id, n] of Object.entries(save.materials)) state.purse.addMaterial(id, n);
  state.bossTokens = { ...save.bossTokens };
  state.jobBoards = Object.fromEntries(
    Object.entries(save.jobs).map(([id, j]) => [
      id,
      { allocation: [...j.boardAllocation], mastery: j.masteryChoice },
    ]),
  );
  // 今のロードアウトの、星辰盤・職紋盤の配置
  if (loadout) {
    state.starAllocation = [...loadout.starAllocation];
    state.extraEntries = [...loadout.extraEntries];
    if (loadout.jobBoards) {
      state.jobBoards = Object.fromEntries(
        Object.entries(loadout.jobBoards).map(([job, b]) => [
          job,
          { allocation: [...b.allocation], mastery: b.mastery },
        ]),
      );
    }
  }
  if (save.world) state.world = { ...save.world };
  if (save.quests) state.quests = { ...save.quests };
  state.questPoints = save.questPoints;
  state.explorationPoints = save.explorationPoints;
  return state;
}
