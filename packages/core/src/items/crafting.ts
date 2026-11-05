import type { ItemRarity } from "../content/item.ts";
import type { ContentDb } from "../content/load.ts";
import type { Rng } from "../random/rng.ts";
import { MAX_ENHANCE } from "./equipment.ts";
import { type ItemInstance, type RolledAffix, addAffixes, rollAffixValue } from "./generate.ts";
import type { Inventory } from "./inventory.ts";
import { eligibleTiers } from "./tiers.ts";

/** 素材の ID。 */
export const CRAFT_MATERIALS = {
  magicDust: "MAT-MAGIC-DUST",
  starSand: "MAT-STAR-SAND",
  glowStone: "MAT-GLOW-STONE",
  bossCore: "MAT-BOSS-CORE-CH1",
  awakeningDust: "MAT-AWAKENING-DUST",
  insightCrystal: "MAT-INSIGHT-CRYSTAL",
  transmuteStone: "MAT-TRANSMUTE-STONE",
  tuningFork: "MAT-TUNING-FORK",
  eraseBlade: "MAT-ERASE-BLADE",
  sealWax: "MAT-SEAL-WAX",
} as const;

/** 鍛造負荷の上限（仕様書v0.2 3.11.1：100を超える操作はできない＝定着）。 */
export const MAX_FORGE_LOAD = 100;
/** 亀裂・霊感が起きる負荷（操作の前の負荷がこれ以上）と確率（仕様書v0.2 3.11.1）。 */
export const UNSTABLE_LOAD = 60;
export const CRACK_CHANCE = 0.2;
export const INSPIRATION_CHANCE = 0.1;

/** 強化のコスト（仕様書v0.2 3.9。index は強化した後の値−1）。 */
export const ENHANCE_COSTS: readonly Readonly<Record<string, number>>[] = [
  { [CRAFT_MATERIALS.magicDust]: 10 },
  { [CRAFT_MATERIALS.magicDust]: 20 },
  { [CRAFT_MATERIALS.magicDust]: 30 },
  { [CRAFT_MATERIALS.magicDust]: 40, [CRAFT_MATERIALS.starSand]: 2 },
  { [CRAFT_MATERIALS.magicDust]: 40, [CRAFT_MATERIALS.starSand]: 4 },
  { [CRAFT_MATERIALS.magicDust]: 40, [CRAFT_MATERIALS.starSand]: 6 },
  { [CRAFT_MATERIALS.starSand]: 10 },
  { [CRAFT_MATERIALS.starSand]: 14 },
  { [CRAFT_MATERIALS.starSand]: 18 },
  { [CRAFT_MATERIALS.starSand]: 30, [CRAFT_MATERIALS.bossCore]: 1 },
];

/** 銘の候補（仕様書v0.2 3.9 の例の3つ。+10 で1つを選ぶ）。 */
export const INSCRIPTIONS = [
  "EFF-INSCR-HP-3",
  "EFF-INSCR-AILMENT-DURATION-8",
  "EFF-INSCR-STAGGER-10",
] as const;

/** 亀裂（小さなマイナスの詞）の候補。仮値: 仕様書v0.2 3.11.1 の例だけ（docs/progress Q-U17-2）。 */
export const CRACKS = ["EFF-CRACK-MOVE-SPEED-3"] as const;

/** クラフトの操作（MVPの範囲。開発計画書4.3）。 */
export type CraftOp =
  | { readonly kind: "awaken" }
  | { readonly kind: "insight" }
  | { readonly kind: "transmute" }
  | { readonly kind: "tune"; readonly affix: string }
  | { readonly kind: "erase" }
  | { readonly kind: "seal"; readonly affix: string };

/** 操作ごとの素材と、鍛造負荷（仕様書v0.2 3.10）。封詞の2個目以降は +15。 */
export const CRAFT_OPS: Readonly<
  Record<CraftOp["kind"], { readonly material: string; readonly load: number }>
> = {
  awaken: { material: CRAFT_MATERIALS.awakeningDust, load: 5 },
  insight: { material: CRAFT_MATERIALS.insightCrystal, load: 10 },
  transmute: { material: CRAFT_MATERIALS.transmuteStone, load: 15 },
  tune: { material: CRAFT_MATERIALS.tuningFork, load: 5 },
  erase: { material: CRAFT_MATERIALS.eraseBlade, load: 10 },
  seal: { material: CRAFT_MATERIALS.sealWax, load: 5 },
};
export const SEAL_LOAD_AFTER_FIRST = 15;

export type CraftBlock =
  | "settled" // 負荷が100を超える（定着）
  | "rarity" // レアリティが合わない
  | "noAffix" // 選んだ詞が無い・消せる詞が無い
  | "sealed" // その詞は封詞されている（調律の音叉で守られる）
  | "unique" // ユニーク・セットはクラフトできない（強化だけ）
  | "material"; // 素材が足りない

/** 操作の鍛造負荷（封詞の2個目以降は重い）。 */
export function opLoad(item: ItemInstance, op: CraftOp): number {
  if (op.kind === "seal" && (item.sealsUsed ?? 0) >= 1) return SEAL_LOAD_AFTER_FIRST;
  return CRAFT_OPS[op.kind].load;
}

/** 操作できない理由（素材を除く。できるなら undefined）。 */
export function craftBlock(
  item: ItemInstance,
  op: CraftOp,
): Exclude<CraftBlock, "material"> | undefined {
  if (item.rarity === "unique" || item.rarity === "set") return "unique";
  if ((item.forgeLoad ?? 0) + opLoad(item, op) > MAX_FORGE_LOAD) return "settled";
  const unsealed = item.affixes.filter((a) => a.id !== item.sealed);
  switch (op.kind) {
    case "awaken":
      return item.rarity === "normal" ? undefined : "rarity";
    case "insight":
      return item.rarity === "magic" ? undefined : "rarity";
    case "transmute":
      return item.rarity === "rare" ? undefined : "rarity";
    case "tune":
      if (!item.affixes.some((a) => a.id === op.affix)) return "noAffix";
      return op.affix === item.sealed ? "sealed" : undefined;
    case "erase":
      return unsealed.length > 0 ? undefined : "noAffix";
    case "seal":
      return item.affixes.some((a) => a.id === op.affix) && item.sealed !== op.affix
        ? undefined
        : "noAffix";
  }
}

export interface CraftResult {
  readonly item: ItemInstance;
  /** 起きたこと（表示用）。 */
  readonly cracked: string | undefined;
  readonly inspired: string | undefined;
}

function rarityCount(db: ContentDb, rng: Rng, rarity: ItemRarity): number {
  const r = db.rarities.get(rarity);
  if (r === undefined) throw new RangeError(`レアリティ ${rarity} の定義が無い`);
  return rng.int(r.affixes.min, r.affixes.max);
}

/**
 * クラフトの操作を行う（素材は呼び出す側が使う。{@link craftWithInventory}）。
 * - 鍛造負荷を足す。100を超える操作はできない（定着）。装備は壊れない
 * - 操作の前の負荷が60以上なら、20%で亀裂（マイナスの効果）、10%で霊感（ランダムな詞のtierが1段階上がる。
 *   アイテムLvで出現できるtierまで）
 * - 封詞は、次の1回の操作から守る（転詞・削詞で残る。調律はできない）。操作の後に封詞は外れる（封詞そのものを除く）
 * できない操作なら、何も変えずに RangeError。
 */
export function craft(db: ContentDb, rng: Rng, item: ItemInstance, op: CraftOp): CraftResult {
  const block = craftBlock(item, op);
  if (block !== undefined) throw new RangeError(`${op.kind} はできない（${block}）`);
  const base = db.itemBases.get(item.base);
  if (base === undefined) throw new RangeError(`ベース ${item.base} が無い`);
  const loadBefore = item.forgeLoad ?? 0;
  let next: ItemInstance = { ...item, forgeLoad: loadBefore + opLoad(item, op) };
  const sealedAffix = item.affixes.find((a) => a.id === item.sealed);
  switch (op.kind) {
    case "awaken":
      next = {
        ...next,
        rarity: "magic",
        affixes: addAffixes(db, rng, base, item.itemLevel, [], rarityCount(db, rng, "magic")),
      };
      break;
    case "insight": {
      // 魔法の詞を残し、希少の詞の数まで足す（docs/progress D-U17-2）
      const wanted = Math.max(item.affixes.length, rarityCount(db, rng, "rare"));
      next = {
        ...next,
        rarity: "rare",
        affixes: addAffixes(db, rng, base, item.itemLevel, item.affixes, wanted),
      };
      break;
    }
    case "transmute": {
      const kept = sealedAffix === undefined ? [] : [sealedAffix];
      next = {
        ...next,
        affixes: addAffixes(db, rng, base, item.itemLevel, kept, rarityCount(db, rng, "rare")),
      };
      break;
    }
    case "tune": {
      const target = item.affixes.find((a) => a.id === op.affix);
      const def = db.affixes.get(op.affix);
      if (target === undefined || def === undefined) throw new RangeError(`詞 ${op.affix} が無い`);
      next = {
        ...next,
        affixes: item.affixes.map((a) =>
          a.id === op.affix ? { ...a, rolls: rollAffixValue(rng, def, a.tier) } : a,
        ),
      };
      break;
    }
    case "erase": {
      const candidates = item.affixes.filter((a) => a.id !== item.sealed);
      const removed = candidates[rng.int(0, candidates.length - 1)];
      next = { ...next, affixes: item.affixes.filter((a) => a !== removed) };
      break;
    }
    case "seal":
      next = { ...next, sealed: op.affix, sealsUsed: (item.sealsUsed ?? 0) + 1 };
      break;
  }
  // 封詞は、次の1回の操作から守ったら外れる
  if (op.kind !== "seal" && item.sealed !== undefined) next = withoutSeal(next);
  let cracked: string | undefined;
  let inspired: string | undefined;
  if (loadBefore >= UNSTABLE_LOAD) {
    if (rng.next() < CRACK_CHANCE) {
      cracked = CRACKS[rng.int(0, CRACKS.length - 1)];
      if (cracked !== undefined) next = { ...next, cracks: [...(next.cracks ?? []), cracked] };
    }
    if (rng.next() < INSPIRATION_CHANCE) {
      const r = inspire(db, rng, next);
      next = r.item;
      inspired = r.affix;
    }
  }
  return { item: next, cracked, inspired };
}

function withoutSeal(item: ItemInstance): ItemInstance {
  const out: { -readonly [K in keyof ItemInstance]: ItemInstance[K] } = { ...item };
  delete out.sealed;
  return out;
}

/** 霊感：ランダムな詞のtierを1段階上げる（アイテムLvで出現できるtierだけ。上げられる詞が無ければ何もしない）。 */
function inspire(
  db: ContentDb,
  rng: Rng,
  item: ItemInstance,
): { item: ItemInstance; affix: string | undefined } {
  const options: { a: RolledAffix; tier: RolledAffix["tier"] }[] = [];
  for (const a of item.affixes) {
    const def = db.affixes.get(a.id);
    if (def === undefined) continue;
    const better = eligibleTiers(def, item.itemLevel)
      .filter((t) => t < a.tier)
      .sort((x, y) => y - x)[0];
    if (better !== undefined) options.push({ a, tier: better });
  }
  const pick = options[rng.int(0, Math.max(0, options.length - 1))];
  if (pick === undefined || options.length === 0) return { item, affix: undefined };
  const def = db.affixes.get(pick.a.id);
  if (def === undefined) return { item, affix: undefined };
  return {
    item: {
      ...item,
      affixes: item.affixes.map((a) =>
        a === pick.a ? { ...a, tier: pick.tier, rolls: rollAffixValue(rng, def, pick.tier) } : a,
      ),
    },
    affix: pick.a.id,
  };
}

/** 強化のコスト（強化できなければ undefined）。 */
export function enhanceCost(item: ItemInstance): Readonly<Record<string, number>> | undefined {
  const e = item.enhance ?? 0;
  return e >= MAX_ENHANCE ? undefined : ENHANCE_COSTS[e];
}

/** 強化する（+1。失敗しない。負荷は増えない。定着した装備・ユニークもできる）。 */
export function enhance(item: ItemInstance): ItemInstance {
  const e = item.enhance ?? 0;
  if (e >= MAX_ENHANCE) throw new RangeError("強化値の上限");
  return { ...item, enhance: e + 1 };
}

/** 銘を刻む（+10 で、候補から1つ。刻んだ銘は替えない。docs/progress D-U17-4）。 */
export function inscribe(item: ItemInstance, effectId: string): ItemInstance {
  if ((item.enhance ?? 0) < MAX_ENHANCE) throw new RangeError("銘は +10 で刻める");
  if (item.inscription !== undefined) throw new RangeError("銘はもう刻んである");
  if (!(INSCRIPTIONS as readonly string[]).includes(effectId))
    throw new RangeError(`銘の候補に ${effectId} が無い`);
  return { ...item, inscription: effectId };
}

/**
 * 分解で得る素材（仕様書v0.2 3.10：白・青→魔塵、黄→星砂、ユニーク→輝石）。
 * 仮値: 数は記載が無いため、1＋⌊アイテムLv÷4⌋ 個（docs/progress Q-U17-1）。
 */
export function disassemblyYield(item: ItemInstance): Readonly<Record<string, number>> {
  const n = 1 + Math.floor(item.itemLevel / 4);
  switch (item.rarity) {
    case "normal":
    case "magic":
      return { [CRAFT_MATERIALS.magicDust]: n };
    case "rare":
      return { [CRAFT_MATERIALS.starSand]: n };
    case "unique":
    case "set":
      return { [CRAFT_MATERIALS.glowStone]: n };
  }
}

function hasAll(inv: Inventory, cost: Readonly<Record<string, number>>): boolean {
  return Object.entries(cost).every(([m, n]) => inv.material(m) >= n);
}
function spendAll(inv: Inventory, cost: Readonly<Record<string, number>>): void {
  for (const [m, n] of Object.entries(cost)) inv.spendMaterial(m, n);
}

/**
 * インベントリの装備にクラフトの操作を行い、素材を1つ使う。できない・素材が足りないなら、何も変えずに理由を返す。
 * 装備は同じ uid のまま入れ替える（壊れない）。
 */
export function craftWithInventory(
  db: ContentDb,
  rng: Rng,
  inv: Inventory,
  uid: string,
  op: CraftOp,
): CraftResult | CraftBlock {
  const item = inv.items.find((i) => i.uid === uid);
  if (item === undefined) throw new RangeError(`インベントリに ${uid} が無い`);
  const block = craftBlock(item, op);
  if (block !== undefined) return block;
  const material = CRAFT_OPS[op.kind].material;
  if (inv.material(material) < 1) return "material";
  const r = craft(db, rng, item, op);
  inv.spendMaterial(material, 1);
  inv.replaceItem(r.item);
  return r;
}

/** インベントリの装備を強化する（素材を使う）。上限・素材不足なら、何も変えずに false。 */
export function enhanceWithInventory(inv: Inventory, uid: string): boolean {
  const item = inv.items.find((i) => i.uid === uid);
  if (item === undefined) throw new RangeError(`インベントリに ${uid} が無い`);
  const cost = enhanceCost(item);
  if (cost === undefined || !hasAll(inv, cost)) return false;
  spendAll(inv, cost);
  inv.replaceItem(enhance(item));
  return true;
}

/** インベントリの装備を分解し、素材を得る（装備はなくなる）。 */
export function disassembleFromInventory(
  inv: Inventory,
  uid: string,
): Readonly<Record<string, number>> {
  const item = inv.items.find((i) => i.uid === uid);
  if (item === undefined) throw new RangeError(`インベントリに ${uid} が無い`);
  const got = disassemblyYield(item);
  for (const [m, n] of Object.entries(got)) inv.addMaterial(m, n);
  inv.removeItem(uid);
  return got;
}
