import { z } from "zod";
import { Character } from "../character/progression.ts";
import { ITEM_RARITIES, AFFIX_TIERS } from "../content/item.ts";
import type { ContentDb } from "../content/load.ts";
import { dualWieldAffinity } from "../combat/skills.ts";
import { Equipment, MVP_EQUIP_SLOTS, type MvpEquipSlot, slotsFor } from "../items/equipment.ts";
import type { ItemInstance } from "../items/generate.ts";
import { INVENTORY_SLOTS, Inventory } from "../items/inventory.ts";
import { STASH_SLOTS } from "../items/merchant.ts";

/**
 * セーブデータの版（開発計画書6.9）。
 * - 版1：開発計画書6.9 の例の形
 * - 版2：金貨（gold）と、ジョブごとの技の枠（jobs[].skill_slots）を足した（U-13）
 */
export const SAVE_VERSION = 2;
/** 技の枠の数（補助仕様書1.1）。 */
export const SAVE_SKILL_SLOTS = 6;

const id = z.string().min(1);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const xp = z.number().nonnegative();

const affixSchema = z.strictObject({
  id,
  tier: z.union(
    AFFIX_TIERS.map((t) => z.literal(t)) as [z.ZodLiteral<7>, ...z.ZodLiteral<number>[]],
  ),
  rolls: z.array(z.number()).max(2),
});

/** 装備の実体（開発計画書6.5。セーブデータの形）。 */
const itemSchema = z.strictObject({
  uid: id,
  base: id,
  rarity: z.enum(ITEM_RARITIES),
  item_level: z.number().int().min(1),
  affixes: z.array(affixSchema),
});

const jobSchemaV2 = z.strictObject({
  level: z.number().int().min(1),
  xp,
  board_allocation: z.array(id),
  mastery_choice: id.nullable(),
  /** 技の枠（6つ。空きは null）。空の配列はジョブの初期の並びを使う。 */
  skill_slots: z.array(id.nullable()).max(SAVE_SKILL_SLOTS),
});

const loadoutSchema = z.strictObject({
  id: z.number().int().min(1),
  name: z.string(),
  main_job: id,
  /** 部位 → 装備の uid（空きは null か省略）。 */
  equipment: z.partialRecord(z.enum(MVP_EQUIP_SLOTS), id.nullable()),
  star_allocation: z.array(id),
  extra_entries: z.array(id),
});

const commonFields = {
  content_version: z.string(),
  items: z.record(id, itemSchema),
  inventory: z.array(id),
  stash: z.array(id),
  loadouts: z.array(loadoutSchema).min(1).max(3),
  active_loadout: z.number().int().min(1),
  materials: z.record(id, count),
  boss_tokens: z.record(id, count),
  discoveries: z.strictObject({
    latent_revealed: z.array(id),
    bonds_revealed: z.array(id),
    interactions_seen: z.array(id),
  }),
  quest_points: count,
  exploration_points: count,
  settings: z.strictObject({ keybinds: z.record(z.string(), z.string()) }),
};

const characterSchema = z.strictObject({
  name: z.string(),
  origin_job: id,
  level: z.number().int().min(1),
  xp,
  main_job: id,
  sub_job: id.nullable(),
});

/** 版2（今の版）のセーブデータ。 */
export const saveDataSchema = z.strictObject({
  save_version: z.literal(SAVE_VERSION),
  character: characterSchema,
  jobs: z.record(id, jobSchemaV2),
  gold: count,
  ...commonFields,
});
export type SaveData = z.infer<typeof saveDataSchema>;

/** 版1（開発計画書6.9 の例の形）。移行のためだけに使う。 */
export const saveDataV1Schema = z.strictObject({
  save_version: z.literal(1),
  character: characterSchema,
  jobs: z.record(id, jobSchemaV2.omit({ skill_slots: true })),
  ...commonFields,
});
export type SaveDataV1 = z.infer<typeof saveDataV1Schema>;

/** 版ごとの移行（from の版 → from＋1 の版）。 */
export type Migration = (data: unknown) => unknown;
export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  /** 版1 → 版2：金貨は0、技の枠は空（ジョブの初期の並びを使う）。 */
  1: (data) => {
    const v1 = saveDataV1Schema.parse(data);
    return {
      ...v1,
      save_version: 2,
      gold: 0,
      jobs: Object.fromEntries(
        Object.entries(v1.jobs).map(([k, j]) => [k, { ...j, skill_slots: [] }]),
      ),
    };
  },
};

/** セーブデータの問題（壊れたデータの検出）。 */
export class SaveDataError extends Error {
  readonly kind: "parse" | "checksum" | "version" | "schema" | "reference";
  constructor(kind: SaveDataError["kind"], message: string) {
    super(message);
    this.name = "SaveDataError";
    this.kind = kind;
  }
}

/**
 * 古い版のデータを、今の版まで順に移行する。新しすぎる版・移行の手順が無い版は SaveDataError。
 * 結果は今の版の形で検証する。
 */
export function migrateSaveData(
  data: unknown,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
): SaveData {
  let current = data;
  for (let guard = 0; guard <= SAVE_VERSION; guard++) {
    const version =
      typeof current === "object" && current !== null && "save_version" in current
        ? current.save_version
        : undefined;
    if (!(typeof version === "number" && Number.isInteger(version) && version >= 1))
      throw new SaveDataError("version", `セーブデータの版が正しくない（${String(version)}）`);
    if (version > SAVE_VERSION)
      throw new SaveDataError(
        "version",
        `セーブデータの版（${String(version)}）が、このゲームの版（${String(SAVE_VERSION)}）より新しい`,
      );
    if (version === SAVE_VERSION) {
      const r = saveDataSchema.safeParse(current);
      if (!r.success)
        throw new SaveDataError("schema", `セーブデータの形が正しくない：${r.error.message}`);
      return r.data;
    }
    const step = migrations[version];
    if (step === undefined)
      throw new SaveDataError("version", `版${String(version)}からの移行の手順が無い`);
    try {
      current = step(current);
    } catch (e) {
      throw new SaveDataError(
        "schema",
        `版${String(version)}のデータを移行できない：${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  throw new SaveDataError("version", "移行が終わらない");
}

/** プレイヤーの状態（セーブデータから戻したもの・セーブデータにするもの）。 */
export interface PlayerProfile {
  readonly name: string;
  readonly character: Character;
  readonly equipment: Equipment;
  readonly inventory: Inventory;
  readonly stash: Inventory;
  /** ジョブごとの技の枠（6つ。空きは undefined）。無いジョブは、初期の並びを使う。 */
  readonly skillSlots: ReadonlyMap<string, readonly (string | undefined)[]>;
  /** まだゲームで使っていない項目（星辰盤・討伐証など）。読み込んだ値をそのまま保存し直す。 */
  readonly kept: KeptSaveFields;
}

/** まだゲームで使っていない項目。 */
export interface KeptSaveFields {
  readonly subJob: string | null;
  readonly boards: Readonly<Record<string, { board: string[]; mastery: string | null }>>;
  readonly loadouts: SaveData["loadouts"];
  readonly activeLoadout: number;
  readonly bossTokens: Readonly<Record<string, number>>;
  readonly discoveries: SaveData["discoveries"];
  readonly questPoints: number;
  readonly explorationPoints: number;
  readonly settings: SaveData["settings"];
}

/** 新しいキャラクターの、まだゲームで使っていない項目の初期値。 */
export function emptyKeptFields(mainJob: string): KeptSaveFields {
  return {
    subJob: null,
    boards: {},
    loadouts: [
      {
        id: 1,
        name: "ロードアウト1",
        main_job: mainJob,
        equipment: {},
        star_allocation: [],
        extra_entries: [],
      },
    ],
    activeLoadout: 1,
    bossTokens: {},
    discoveries: { latent_revealed: [], bonds_revealed: [], interactions_seen: [] },
    questPoints: 0,
    explorationPoints: 0,
    settings: { keybinds: {} },
  };
}

const toSaveItem = (i: ItemInstance): SaveData["items"][string] => ({
  uid: i.uid,
  base: i.base,
  rarity: i.rarity,
  item_level: i.itemLevel,
  affixes: i.affixes.map((a) => ({ id: a.id, tier: a.tier, rolls: [...a.rolls] })),
});

/** プレイヤーの状態を、セーブデータにする（今の版）。保存しない値（能力値など）は入れない。 */
export function toSaveData(db: ContentDb, profile: PlayerProfile): SaveData {
  const items: SaveData["items"] = {};
  const add = (i: ItemInstance): string => {
    items[i.uid] = toSaveItem(i);
    return i.uid;
  };
  const equipment: Partial<Record<MvpEquipSlot, string | null>> = {};
  for (const [slot, item] of profile.equipment.entries()) equipment[slot] = add(item);
  const inventory = profile.inventory.items.map(add);
  const stash = profile.stash.items.map(add);
  const c = profile.character;
  const kept = profile.kept;
  const jobs: SaveData["jobs"] = {};
  for (const jobId of c.knownJobs) {
    const t = c.jobTrack(jobId);
    const slots = profile.skillSlots.get(jobId);
    jobs[jobId] = {
      level: t.level,
      xp: t.xp,
      board_allocation: [...(kept.boards[jobId]?.board ?? [])],
      mastery_choice: kept.boards[jobId]?.mastery ?? null,
      skill_slots: slots === undefined ? [] : slots.map((s) => s ?? null),
    };
  }
  // 今の装備とメインジョブは、使っているロードアウトに入れる（ロードアウトの切り替えは U-20）
  const loadouts = kept.loadouts.map((l) =>
    l.id === kept.activeLoadout ? { ...l, main_job: c.mainJob, equipment } : l,
  );
  return {
    save_version: SAVE_VERSION,
    content_version: db.manifest.contentVersion,
    character: {
      name: profile.name,
      origin_job: c.origin.id,
      level: c.level,
      xp: c.progress.xp,
      main_job: c.mainJob,
      sub_job: kept.subJob,
    },
    jobs,
    items,
    inventory,
    stash,
    loadouts,
    active_loadout: kept.activeLoadout,
    gold: profile.inventory.gold,
    materials: Object.fromEntries(profile.inventory.materials),
    boss_tokens: { ...kept.bossTokens },
    discoveries: kept.discoveries,
    quest_points: kept.questPoints,
    exploration_points: kept.explorationPoints,
    settings: kept.settings,
  };
}

function ref(ok: boolean, message: () => string): void {
  if (!ok) throw new SaveDataError("reference", message());
}

/**
 * セーブデータ（今の版の形に検証済み）から、プレイヤーの状態を戻す。
 * データの参照（ジョブ・ベース・詞・技・素材・装備の uid）と、持ち物の規則（枠の数・同じ装備は1か所だけ・
 * 装備できる部位）を検証し、合わなければ SaveDataError（壊れたデータ）。
 */
export function fromSaveData(db: ContentDb, data: SaveData): PlayerProfile {
  const c = data.character;
  const origin = db.jobs.get(c.origin_job);
  ref(origin !== undefined, () => `出自のジョブ ${c.origin_job} がデータに無い`);
  ref(db.jobs.has(c.main_job), () => `メインジョブ ${c.main_job} がデータに無い`);
  for (const jobId of Object.keys(data.jobs))
    ref(db.jobs.has(jobId), () => `ジョブ ${jobId} がデータに無い`);
  // 装備の実体
  const items = new Map<string, ItemInstance>();
  for (const [key, raw] of Object.entries(data.items)) {
    ref(key === raw.uid, () => `装備の鍵 ${key} と uid ${raw.uid} が違う`);
    const base = db.itemBases.get(raw.base);
    ref(base !== undefined, () => `装備 ${key} のベース ${raw.base} がデータに無い`);
    for (const a of raw.affixes) {
      const affix = db.affixes.get(a.id);
      ref(affix !== undefined, () => `装備 ${key} の詞 ${a.id} がデータに無い`);
      ref(
        a.rolls.length === (affix?.roll === "added" ? 2 : 1),
        () => `装備 ${key} の詞 ${a.id} の値の数が正しくない`,
      );
    }
    items.set(key, {
      uid: raw.uid,
      base: raw.base,
      rarity: raw.rarity,
      itemLevel: raw.item_level,
      affixes: raw.affixes.map((a) => ({
        id: a.id,
        tier: a.tier as ItemInstance["affixes"][number]["tier"],
        rolls: [...a.rolls],
      })),
    });
  }
  const used = new Set<string>();
  const take = (uid: string, where: string): ItemInstance => {
    const item = items.get(uid);
    ref(item !== undefined, () => `${where}の装備 ${uid} が items に無い`);
    ref(!used.has(uid), () => `装備 ${uid} が2か所にある`);
    used.add(uid);
    return item as ItemInstance;
  };
  let character: Character;
  try {
    character = new Character({
      origin: origin as NonNullable<typeof origin>,
      level: c.level,
      xp: c.xp,
      mainJob: c.main_job,
      jobLevels: Object.fromEntries(Object.entries(data.jobs).map(([k, j]) => [k, j.level])),
      jobXp: Object.fromEntries(Object.entries(data.jobs).map(([k, j]) => [k, j.xp])),
    });
  } catch (e) {
    throw new SaveDataError(
      "reference",
      `Lv・経験値が正しくない：${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const mainJob = db.jobs.get(c.main_job);
  const canDualWield = mainJob !== undefined && dualWieldAffinity(mainJob) !== undefined;
  // 装備（使っているロードアウト）
  const active = data.loadouts.find((l) => l.id === data.active_loadout);
  ref(active !== undefined, () => `使っているロードアウト ${String(data.active_loadout)} が無い`);
  ref(
    new Set(data.loadouts.map((l) => l.id)).size === data.loadouts.length,
    () => "ロードアウトの id が重なっている",
  );
  const equipment = new Equipment(db);
  for (const [slot, uid] of Object.entries(active?.equipment ?? {}) as [
    MvpEquipSlot,
    string | null,
  ][]) {
    if (uid === null) continue;
    const item = take(uid, `部位 ${slot} `);
    const base = db.itemBases.get(item.base);
    ref(
      base !== undefined && slotsFor(base, canDualWield).includes(slot),
      () => `装備 ${uid} は部位 ${slot} に装備できない`,
    );
    const out = equipment.equip(item, slot, canDualWield);
    ref(out.length === 0, () => `部位 ${slot} の装備が、ほかの部位の装備を外す（両手武器と副手）`);
  }
  const inventory = new Inventory(INVENTORY_SLOTS);
  ref(data.inventory.length <= INVENTORY_SLOTS, () => "インベントリの装備が枠の数を超える");
  for (const uid of data.inventory) inventory.addItem(take(uid, "インベントリ"));
  const stash = new Inventory(STASH_SLOTS);
  ref(data.stash.length <= STASH_SLOTS, () => "倉庫の装備が枠の数を超える");
  for (const uid of data.stash) stash.addItem(take(uid, "倉庫"));
  // ほかのロードアウトが参照する装備は、どこかに持っている物だけ（分解した装備の扱いは U-20）
  ref(used.size === items.size, () => "どこにも持っていない装備が items にある");
  inventory.addGold(data.gold);
  for (const [m, n] of Object.entries(data.materials)) {
    ref(db.materials.has(m), () => `素材 ${m} がデータに無い`);
    inventory.addMaterial(m, n);
  }
  const skillSlots = new Map<string, (string | undefined)[]>();
  for (const [jobId, j] of Object.entries(data.jobs)) {
    if (j.skill_slots.length === 0) continue;
    const slots: (string | undefined)[] = [];
    for (let i = 0; i < SAVE_SKILL_SLOTS; i++) {
      const s = j.skill_slots[i] ?? null;
      ref(
        s === null || db.skills.has(s),
        () => `ジョブ ${jobId} の技の枠の技 ${String(s)} がデータに無い`,
      );
      slots.push(s ?? undefined);
    }
    const named = slots.filter((s) => s !== undefined);
    ref(new Set(named).size === named.length, () => `ジョブ ${jobId} の技の枠に同じ技が2つある`);
    skillSlots.set(jobId, slots);
  }
  return {
    name: c.name,
    character,
    equipment,
    inventory,
    stash,
    skillSlots,
    kept: {
      subJob: c.sub_job,
      boards: Object.fromEntries(
        Object.entries(data.jobs).map(([k, j]) => [
          k,
          { board: [...j.board_allocation], mastery: j.mastery_choice },
        ]),
      ),
      loadouts: data.loadouts,
      activeLoadout: data.active_loadout,
      bossTokens: data.boss_tokens,
      discoveries: data.discoveries,
      questPoints: data.quest_points,
      explorationPoints: data.exploration_points,
      settings: data.settings,
    },
  };
}
