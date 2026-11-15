/**
 * 章ボスのドロップ・討伐証・討伐の祭壇（本仕様書 3.12、補助仕様書 11章）。
 */
import type { Rng } from "../rng.ts";
import { MATERIAL } from "./drops.ts";
import { generateItem, type GenerationData } from "./generate.ts";
import type { ItemInstance } from "./types.ts";

export interface BossDropConfig {
  /** ボスのID（討伐証の種類にもなる）。腐根の母樹と深淵の母樹は、討伐証が共通（BOSS-CH1） */
  bossId: string;
  tokenId: string;
  itemCount: readonly [number, number];
  ilvl: number;
  /** 専用ユニークの抽選元（ユニークのID）。初回は1つ確定 */
  uniquePool: readonly string[];
  repeatUniqueChance: number;
  /** 得る討伐証の数 */
  tokens: number;
  /** 追加の素材（母樹の樹液＝章ボスの核・開眼の結晶・封詞の蝋） */
  coreCount: number;
  crystalCount: number;
  sealWaxChance: number;
}

/** 腐根の母樹（A4・Lv14）：アイテム6〜10個、初回は専用ユニーク確定、2回目以降は15%、討伐証1個 */
export const MOTHER_TREE_DROP: BossDropConfig = {
  bossId: "BOSS-CH1",
  tokenId: "BOSS-CH1",
  itemCount: [6, 10],
  ilvl: 18,
  uniquePool: ["UNQ-U03", "UNQ-U13", "UNQ-U18"],
  repeatUniqueChance: 0.15,
  tokens: 1,
  coreCount: 1,
  crystalCount: 2,
  sealWaxChance: 0.5,
};

/** 深淵の母樹（A5・Lv21）：アイテム8〜12個（iLv25＝T5の詞が出る唯一の入手先）、再討伐の専用ユニークは25%、討伐証2個 */
export const ABYSS_TREE_DROP: BossDropConfig = {
  bossId: "BOSS-ABYSS",
  tokenId: "BOSS-CH1",
  itemCount: [8, 12],
  ilvl: 25,
  uniquePool: ["UNQ-U03", "UNQ-U13", "UNQ-U18"],
  repeatUniqueChance: 0.25,
  tokens: 2,
  coreCount: 1,
  crystalCount: 2,
  sealWaxChance: 0.5,
};

export interface BossDropResult {
  items: ItemInstance[];
  materials: Record<string, number>;
  /** 得た討伐証（種類 → 数） */
  tokens: Record<string, number>;
  /** 専用ユニークが落ちた（初回確定・再討伐の抽選） */
  uniqueDropped: boolean;
}

function makeUnique(
  data: GenerationData,
  id: string,
  ilvl: number,
  uid: () => string,
): ItemInstance | undefined {
  const u = data.uniques.find((x) => x.id === id);
  if (!u) return undefined;
  return {
    uid: uid(),
    baseId: u.baseId,
    rarity: "unique",
    ilvl,
    affixes: [],
    enhance: 0,
    uniqueId: id,
  };
}

export function rollBossDrops(
  data: GenerationData,
  cfg: BossDropConfig,
  opts: { firstKill: boolean; uid: () => string; rng: Rng; tierFloor?: number },
): BossDropResult {
  const { rng } = opts;
  const count = rng.int(cfg.itemCount[0], cfg.itemCount[1]);
  const items: ItemInstance[] = [];
  let uniqueDropped = false;
  // 専用ユニーク：初回は1つ確定、2回目以降は抽選
  if (opts.firstKill || rng.chance(cfg.repeatUniqueChance)) {
    const u = makeUnique(data, rng.pick(cfg.uniquePool), cfg.ilvl, opts.uid);
    if (u) {
      items.push(u);
      uniqueDropped = true;
    }
  }
  while (items.length < count) {
    items.push(
      generateItem(
        data,
        {
          ilvl: cfg.ilvl,
          uid: opts.uid,
          // 章ボスは、希少以上の率が高い（希少以上を確定させない）
          rarityContext: { rank: "elite" },
          ...(opts.tierFloor !== undefined ? { tierFloor: opts.tierFloor } : {}),
        },
        rng,
      ),
    );
  }
  const materials: Record<string, number> = {
    [MATERIAL.bossCoreCh1]: cfg.coreCount,
    [MATERIAL.eyeOpeningCrystal]: cfg.crystalCount,
  };
  if (rng.chance(cfg.sealWaxChance)) materials[MATERIAL.sealWax] = 1;
  return { items, materials, tokens: { [cfg.tokenId]: cfg.tokens }, uniqueDropped };
}

/** 討伐の祭壇：討伐証10個で、専用ユニークを1つ選んで交換できる（本仕様書 3.12） */
export const TOKEN_EXCHANGE_COST = 10;

export function exchangeTokens(
  tokens: Record<string, number>,
  tokenId: string,
  uniqueId: string,
  pool: readonly string[],
  data: GenerationData,
  ilvl: number,
  uid: () => string,
): { ok: boolean; item?: ItemInstance; reason?: "tokens" | "notInPool" | "unknown" } {
  if (!pool.includes(uniqueId)) return { ok: false, reason: "notInPool" };
  if ((tokens[tokenId] ?? 0) < TOKEN_EXCHANGE_COST) return { ok: false, reason: "tokens" };
  const item = makeUnique(data, uniqueId, ilvl, uid);
  if (!item) return { ok: false, reason: "unknown" };
  tokens[tokenId] = (tokens[tokenId] ?? 0) - TOKEN_EXCHANGE_COST;
  return { ok: true, item };
}
