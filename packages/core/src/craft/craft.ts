/**
 * クラフト（本仕様書 3.9〜3.11.1）：強化・銘・分解・素材による操作・鍛造負荷。
 * 装備は壊れない。リスクは「定着が早まる」「亀裂が付く」だけ。
 */
import type { Rng } from "../rng.ts";
import { MATERIAL } from "../items/drops.ts";
import { fillAffixes, type GenerationData } from "../items/generate.ts";
import { rollAffix } from "../items/affix.ts";
import type { Purse } from "../items/loot.ts";
import type { AffixDef, Inscription, ItemBase, ItemInstance, RolledAffix } from "../items/types.ts";

export const MAX_ENHANCE = 10;
export const MAX_STRAIN = 100;
/** 負荷がこの値以上のときの操作では、亀裂・霊感が起きうる */
export const RISK_STRAIN = 60;
export const CRACK_CHANCE = 0.2;
export const INSPIRATION_CHANCE = 0.1;
/** 基礎性能の強化：1段階ごとに+5%（本仕様書 3.9） */
export const ENHANCE_PER_STEP = 0.05;

/** 強化のコスト（本仕様書 3.9）。強化値 n-1 → n にするときの素材 */
export function enhanceCost(nextLevel: number): Record<string, number> {
  if (nextLevel < 1 || nextLevel > MAX_ENHANCE) throw new RangeError("強化は+1〜+10");
  if (nextLevel <= 3) return { [MATERIAL.magicDust]: 10 * nextLevel };
  if (nextLevel <= 6) {
    return { [MATERIAL.magicDust]: 40, [MATERIAL.starSand]: 2 * (nextLevel - 3) };
  }
  if (nextLevel <= 9) return { [MATERIAL.starSand]: [10, 14, 18][nextLevel - 7] as number };
  return { [MATERIAL.starSand]: 30, [MATERIAL.bossCoreCh1]: 1 };
}

/** 素材による操作の鍛造負荷（本仕様書 3.10） */
export const STRAIN_COST = {
  awaken: 5,
  eyeOpen: 10,
  reroll: 15,
  tune: 5,
  carve: 10,
  seal: 5,
  sealExtra: 15,
  mend: 10,
} as const;

export interface CraftData {
  generation: GenerationData;
  /** 亀裂（小さなマイナスの詞）。値は t7＝t4 の範囲で持つ（負の値） */
  cracks: readonly AffixDef[];
  /** 銘の候補 */
  inscriptions: readonly Inscription[];
}

export type CraftDenied =
  | "material"
  | "settled"
  | "rarity"
  | "noAffix"
  | "maxEnhance"
  | "notMax"
  | "noCrack"
  | "alreadySealed"
  | "unknown"
  | "alreadyInscribed";

export type CraftEvent =
  { type: "crack"; affixId: string } | { type: "inspiration"; affixId: string; tier: number };

export interface CraftResult {
  ok: boolean;
  reason?: CraftDenied;
  events: CraftEvent[];
}

const fail = (reason: CraftDenied): CraftResult => ({ ok: false, reason, events: [] });

function strainOf(item: ItemInstance): number {
  return item.strain ?? 0;
}

/** 素材を足りるときだけ使う。足りなければ何も減らさない */
function spend(purse: Purse, cost: Readonly<Record<string, number>>): boolean {
  for (const [id, n] of Object.entries(cost)) if (purse.material(id) < n) return false;
  for (const [id, n] of Object.entries(cost)) purse.spendMaterial(id, n);
  return true;
}

/** 強化：失敗しない。定着した装備でもできる。負荷は溜まらない */
export function enhance(item: ItemInstance, purse: Purse): CraftResult {
  if (item.enhance >= MAX_ENHANCE) return fail("maxEnhance");
  if (!spend(purse, enhanceCost(item.enhance + 1))) return fail("material");
  item.enhance++;
  return { ok: true, events: [] };
}

/** +10で銘を刻める：候補から3つを出す */
export function offerInscriptions(data: CraftData, rng: Rng): Inscription[] {
  const pool = [...data.inscriptions];
  const out: Inscription[] = [];
  while (out.length < 3 && pool.length > 0) {
    out.push(pool.splice(rng.int(0, pool.length - 1), 1)[0] as Inscription);
  }
  return out;
}

export function inscribe(item: ItemInstance, choice: Inscription): CraftResult {
  if (item.enhance < MAX_ENHANCE) return fail("notMax");
  if (item.inscription !== undefined) return fail("alreadyInscribed");
  item.inscription = choice.id;
  return { ok: true, events: [] };
}

/** 分解で得る素材：白・青→魔塵、黄→星砂、ユニーク→輝石（量は仮値） */
export function disassembleYield(item: ItemInstance): Record<string, number> {
  switch (item.rarity) {
    case "normal":
      return { [MATERIAL.magicDust]: 2 + Math.floor(item.ilvl / 2) };
    case "magic":
      return { [MATERIAL.magicDust]: 4 + Math.floor(item.ilvl) };
    case "rare":
    case "astral":
      return { [MATERIAL.starSand]: 2 + Math.floor(item.ilvl / 4) };
    case "unique":
    case "set":
      return { [MATERIAL.radiance]: 1 };
  }
}

/** 分解：装備を失う代わりに素材を得る。装備が壊れる唯一の操作（本仕様書 3.10 では抽詞の針と分解） */
export function disassemble(
  uid: string,
  bag: { remove(uid: string): ItemInstance | undefined },
  purse: Purse,
): { ok: boolean; gained: Record<string, number> } {
  const item = bag.remove(uid);
  if (!item) return { ok: false, gained: {} };
  const gained = disassembleYield(item);
  for (const [id, n] of Object.entries(gained)) purse.addMaterial(id, n);
  return { ok: true, gained };
}

/** 封印している詞（次の1回の操作から守られる） */
function protectedAffixes(item: ItemInstance): RolledAffix[] {
  return item.affixes.filter((a) => a.sealed === true);
}

/** 操作の後処理：封印は1回の操作で外れる */
function releaseSeals(item: ItemInstance): void {
  for (const a of item.affixes) delete a.sealed;
}

/**
 * 素材を使う操作の共通の流れ。負荷が100を超える操作はできない（定着）。
 * 負荷60以上のときの操作は、20%で亀裂、10%で霊感が起きうる。
 */
function operate(
  item: ItemInstance,
  data: CraftData,
  purse: Purse,
  rng: Rng,
  material: string,
  strain: number,
  apply: () => CraftDenied | undefined,
): CraftResult {
  if (strainOf(item) + strain > MAX_STRAIN) return fail("settled");
  if (purse.material(material) < 1) return fail("material");
  // 素材を使う前に、操作が成り立つか（対象の詞があるかなど）を確かめられるよう、apply は先に実行して結果を見る
  const snapshot = JSON.stringify(item);
  const denied = apply();
  if (denied) {
    Object.assign(item, JSON.parse(snapshot) as ItemInstance);
    return fail(denied);
  }
  purse.spendMaterial(material, 1);
  const before = strainOf(item);
  item.strain = before + strain;
  const events: CraftEvent[] = [];
  if (before >= RISK_STRAIN) {
    const roll = rng.next();
    if (roll < CRACK_CHANCE) {
      const crack = rollCrack(item, data, rng);
      if (crack) events.push({ type: "crack", affixId: crack.id });
    } else if (roll < CRACK_CHANCE + INSPIRATION_CHANCE) {
      const up = inspire(item, rng);
      if (up) events.push({ type: "inspiration", affixId: up.id, tier: up.tier });
    }
  }
  return { ok: true, events };
}

function rollCrack(item: ItemInstance, data: CraftData, rng: Rng): RolledAffix | undefined {
  const have = new Set((item.fractures ?? []).map((f) => f.id));
  const pool = data.cracks.filter((c) => !have.has(c.id));
  if (pool.length === 0) return undefined;
  const def = rng.pick(pool);
  const crack = rollAffix(def, item.ilvl, 7, rng);
  item.fractures = [...(item.fractures ?? []), crack];
  return crack;
}

/** 霊感：ランダムな詞のtierが1段階上がる（iLvで出せる上限まで） */
function inspire(item: ItemInstance, rng: Rng): RolledAffix | undefined {
  const upgradable = item.affixes.filter((a) => a.tier > 5);
  if (upgradable.length === 0) return undefined;
  const a = rng.pick(upgradable);
  a.tier -= 1;
  return a;
}

/** 目覚めの粉：白→青（詞1〜2個）。負荷+5 */
export function awaken(
  item: ItemInstance,
  base: ItemBase,
  data: CraftData,
  purse: Purse,
  rng: Rng,
): CraftResult {
  return operate(item, data, purse, rng, MATERIAL.awakeningDust, STRAIN_COST.awaken, () => {
    if (item.rarity !== "normal") return "rarity";
    item.rarity = "magic";
    item.affixes = fillAffixes(
      data.generation,
      base,
      "magic",
      item.ilvl,
      rng.int(1, 2),
      {},
      rng,
      [],
    );
    return undefined;
  });
}

/** 開眼の結晶：青→黄（詞3〜6個。もとの詞は残る）。負荷+10 */
export function eyeOpen(
  item: ItemInstance,
  base: ItemBase,
  data: CraftData,
  purse: Purse,
  rng: Rng,
): CraftResult {
  return operate(item, data, purse, rng, MATERIAL.eyeOpeningCrystal, STRAIN_COST.eyeOpen, () => {
    if (item.rarity !== "magic") return "rarity";
    item.rarity = "rare";
    item.affixes = fillAffixes(
      data.generation,
      base,
      "rare",
      item.ilvl,
      Math.max(3, rng.int(3, 6)),
      {},
      rng,
      item.affixes,
    );
    return undefined;
  });
}

/** 転詞の石：希少の詞を全て抽選し直す（封詞した詞は残る）。負荷+15 */
export function reroll(
  item: ItemInstance,
  base: ItemBase,
  data: CraftData,
  purse: Purse,
  rng: Rng,
): CraftResult {
  return operate(item, data, purse, rng, MATERIAL.turnStone, STRAIN_COST.reroll, () => {
    if (item.rarity !== "rare" && item.rarity !== "astral") return "rarity";
    const kept = protectedAffixes(item);
    const count = item.affixes.length;
    item.affixes = fillAffixes(data.generation, base, "rare", item.ilvl, count, {}, rng, kept);
    releaseSeals(item);
    return undefined;
  });
}

/** 調律の音叉：選んだ詞の数値を、同じtierの範囲内で抽選し直す。負荷+5 */
export function tune(
  item: ItemInstance,
  index: number,
  data: CraftData,
  purse: Purse,
  rng: Rng,
): CraftResult {
  return operate(item, data, purse, rng, MATERIAL.tuningFork, STRAIN_COST.tune, () => {
    const a = item.affixes[index];
    if (!a) return "noAffix";
    if (a.sealed === true) return "alreadySealed";
    const def = data.generation.affixes.find((d) => d.id === a.id);
    if (!def) return "unknown";
    // 追加ダメージは tier の中では抽選しない（本仕様書 3.6）
    if (def.added === true) return "noAffix";
    a.rolls = [rerollInTier(def, a.tier, rng)];
    releaseSeals(item);
    return undefined;
  });
}

function rerollInTier(def: AffixDef, tier: number, rng: Rng): number {
  // 同じtierの範囲：t7/t4 から補間した範囲で抽選する（affix.ts の tierRange と同じ）
  const lerp = (a: number, b: number, k: number): number => Math.ceil(a + ((b - a) * k) / 3 - 1e-9);
  const k = tier === 7 ? 0 : tier === 6 ? 1 : tier === 5 ? 2 : 3;
  return rng.int(lerp(def.t7.min, def.t4.min, k), lerp(def.t7.max, def.t4.max, k));
}

/** 削詞の刃：詞をランダムに1つ消す（封印した詞は消えない）。負荷+10 */
export function carve(item: ItemInstance, data: CraftData, purse: Purse, rng: Rng): CraftResult {
  return operate(item, data, purse, rng, MATERIAL.carvingBlade, STRAIN_COST.carve, () => {
    const candidates = item.affixes.filter((a) => a.sealed !== true);
    if (candidates.length === 0) return "noAffix";
    const target = rng.pick(candidates);
    item.affixes = item.affixes.filter((a) => a !== target);
    releaseSeals(item);
    return undefined;
  });
}

/** 封詞の蝋：詞を1つ封印し、次の1回の操作から守る。2個目以降は負荷+15。負荷+5 */
export function seal(
  item: ItemInstance,
  index: number,
  data: CraftData,
  purse: Purse,
  rng: Rng,
): CraftResult {
  const used = item.sealsUsed ?? 0;
  const strain = used === 0 ? STRAIN_COST.seal : STRAIN_COST.seal + STRAIN_COST.sealExtra;
  return operate(item, data, purse, rng, MATERIAL.sealWax, strain, () => {
    const a = item.affixes[index];
    if (!a) return "noAffix";
    if (a.sealed === true) return "alreadySealed";
    a.sealed = true;
    item.sealsUsed = used + 1;
    return undefined;
  });
}

/** 繕いの糸：亀裂を1つ消す。負荷+10 */
export function mend(item: ItemInstance, data: CraftData, purse: Purse, rng: Rng): CraftResult {
  return operate(item, data, purse, rng, MATERIAL.mendingThread, STRAIN_COST.mend, () => {
    if ((item.fractures ?? []).length === 0) return "noCrack";
    item.fractures = (item.fractures ?? []).slice(1);
    return undefined;
  });
}

/** 基礎性能にかかる強化の倍率（+10で1.5） */
export function enhanceMultiplier(item: ItemInstance): number {
  return 1 + ENHANCE_PER_STEP * Math.min(MAX_ENHANCE, Math.max(0, item.enhance));
}
