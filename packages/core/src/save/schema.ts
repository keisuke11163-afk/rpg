/**
 * セーブデータの形（開発計画書 6.9、補助仕様書 15章）。
 * 保存するのは「抽選の結果」と進行だけ。能力値・有効なノードなどは、読み込むたびに計算し直す。
 */
import { z } from "zod";

/** セーブの版。形を変えたら上げ、migrations に移行を足す */
export const SAVE_VERSION = 2;
/** データ（コンテンツ）の版。使っているデータの版の記録 */
export const CONTENT_VERSION = "0.1.0";

const levelState = z.strictObject({ level: z.number().int().min(1), exp: z.number().min(0) });

const rolledAffix = z.strictObject({
  id: z.string(),
  tier: z.number().int(),
  rolls: z.array(z.number()),
  params: z.record(z.string(), z.string()).optional(),
});

export const savedItemSchema = z.strictObject({
  uid: z.string(),
  baseId: z.string(),
  rarity: z.enum(["normal", "magic", "rare", "unique", "set", "astral"]),
  ilvl: z.number().int().min(1),
  affixes: z.array(rolledAffix),
  enhance: z.number().int().min(0),
  uniqueId: z.string().optional(),
});

const equipSlot = z.enum(["主手", "副手", "頭", "胴", "手", "足", "腰", "首", "指輪1", "指輪2"]);

export const loadoutSchema = z.strictObject({
  id: z.number().int().min(1),
  name: z.string(),
  mainJob: z.string(),
  /** 部位 → アイテムのuid。存在しないuidは、読み込み時に空きにする（開発計画書 M-15） */
  equipment: z.partialRecord(equipSlot, z.string().nullable()),
  starAllocation: z.array(z.string()),
  extraEntries: z.array(z.string()),
});

export const saveSchema = z.strictObject({
  saveVersion: z.literal(SAVE_VERSION),
  contentVersion: z.string(),
  character: z.strictObject({
    name: z.string(),
    originJob: z.string(),
    level: z.number().int().min(1),
    exp: z.number().min(0),
    mainJob: z.string(),
    subJob: z.string().nullable(),
  }),
  jobs: z.record(
    z.string(),
    levelState.extend({
      boardAllocation: z.array(z.string()),
      masteryChoice: z.string().nullable(),
    }),
  ),
  items: z.record(z.string(), savedItemSchema),
  inventory: z.array(z.string()),
  stash: z.array(z.string()),
  loadouts: z.array(loadoutSchema),
  activeLoadout: z.number().int().min(1),
  gold: z.number().int().min(0),
  materials: z.record(z.string(), z.number().int().min(0)),
  bossTokens: z.record(z.string(), z.number().int().min(0)),
  discoveries: z.strictObject({
    latentRevealed: z.array(z.string()),
    bondsRevealed: z.array(z.string()),
    interactionsSeen: z.array(z.string()),
  }),
  questPoints: z.number().int().min(0),
  explorationPoints: z.number().int().min(0),
  settings: z.strictObject({ keybinds: z.record(z.string(), z.array(z.string())) }),
});

export type SaveData = z.infer<typeof saveSchema>;
export type SavedItem = z.infer<typeof savedItemSchema>;
export type Loadout = z.infer<typeof loadoutSchema>;

/** 新しいキャラクターの、空のセーブ */
export function newSave(init: { name: string; originJob: string }): SaveData {
  return {
    saveVersion: SAVE_VERSION,
    contentVersion: CONTENT_VERSION,
    character: {
      name: init.name,
      originJob: init.originJob,
      level: 1,
      exp: 0,
      mainJob: init.originJob,
      subJob: null,
    },
    jobs: {
      [init.originJob]: { level: 1, exp: 0, boardAllocation: [], masteryChoice: null },
    },
    items: {},
    inventory: [],
    stash: [],
    loadouts: [
      {
        id: 1,
        name: "ロードアウト1",
        mainJob: init.originJob,
        equipment: {},
        starAllocation: [],
        extraEntries: [],
      },
    ],
    activeLoadout: 1,
    gold: 0,
    materials: {},
    bossTokens: {},
    discoveries: { latentRevealed: [], bondsRevealed: [], interactionsSeen: [] },
    questPoints: 0,
    explorationPoints: 0,
    settings: { keybinds: {} },
  };
}
