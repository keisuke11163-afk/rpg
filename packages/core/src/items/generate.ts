/**
 * アイテムの生成（本仕様書 3.1〜3.6）。ベース・レアリティ・詞・職詞・共鳴紋・系統詞。
 */
import type { Rng } from "../rng.ts";
import type { WeaponClass } from "../jobs/skills.ts";
import { rollAffix } from "./affix.ts";
import { rollRarity, type RarityContext } from "./rarity.ts";
import {
  AFFIX_LIMITS,
  type AffixDef,
  type ItemBase,
  type ItemInstance,
  type Rarity,
  type RolledAffix,
} from "./types.ts";

export interface UniqueEntry {
  id: string;
  baseId: string;
  requiredLevel: number;
  /** any＝どこでも／elite-beast＝どこでも（獣系の精鋭から出やすい）／boss-ch1 など＝その入手元だけ */
  obtain?: string;
  weight?: number;
}

export interface GenerationData {
  bases: readonly ItemBase[];
  affixes: readonly AffixDef[];
  /** ユニークの抽選元。必要LvがiLv以下のものから選ぶ（U-16 で9個を入れる） */
  uniques: readonly UniqueEntry[];
}

/** メインジョブの情報（ジョブに合わせたドロップに使う） */
export interface JobBias {
  jobId: string;
  /** 適性がA以上の武器種 */
  weaponClasses: readonly WeaponClass[];
}

export interface GenerateContext {
  ilvl: number;
  /** 指定すると、レアリティの抽選をしない */
  rarity?: Rarity;
  rarityContext?: RarityContext;
  job?: JobBias;
  /** 倒した敵の系統（タグID）。系統詞の抽選に使う */
  enemyFamily?: string;
  /** 出すtierの下限（数字が小さいほど高いtier）。MVPは5（T7〜T5） */
  tierFloor?: number;
  /** ユニークの入手元（boss-ch1・elite-beast など）。専用のユニークは、この入手元のときだけ出る */
  uniqueSource?: string;
  /** ジョブに合わせる確率（既定35%） */
  jobBiasChance?: number;
  uid: () => string;
}

/** 共鳴紋の星域（星核の共鳴紋はない。本仕様書 1.6） */
export const RESONANCE_REGIONS = [
  "TAG-REGION-GOU",
  "TAG-REGION-GOUKON",
  "TAG-REGION-KON",
  "TAG-REGION-RIKON",
  "TAG-REGION-RI",
  "TAG-REGION-JINRI",
  "TAG-REGION-JIN",
  "TAG-REGION-GOUJIN",
] as const;

export const DEFAULT_JOB_BIAS_CHANCE = 0.35;
/** ジョブに寄せるとき、そのジョブの職詞の重みにかける倍率（仮値） */
export const JOB_AFFIX_BIAS_MULTIPLIER = 8;

/** 詞の数（本仕様書 3.5）：通常0／魔法1〜2／希少3〜6 */
function affixCount(rarity: Rarity, rng: Rng): number {
  if (rarity === "normal") return 0;
  if (rarity === "magic") return rng.int(1, 2);
  return rng.int(3, 6);
}

function affixCapacity(
  base: ItemBase,
  rarity: Rarity,
): { prefix: number; suffix: number; belt: number } {
  const limit = AFFIX_LIMITS[base.slot];
  if (rarity === "magic")
    return { prefix: Math.min(1, limit.prefix), suffix: Math.min(1, limit.suffix), belt: 0 };
  // 星鉄の首飾りは、共鳴紋が確定で付く代わりに詞の枠が1つ減る
  const suffix = base.guaranteedResonance === true ? limit.suffix - 1 : limit.suffix;
  return { prefix: limit.prefix, suffix, belt: limit.belt };
}

/** 付けられる詞の候補（部位・職詞・系統詞・重複・位置の空きを見る） */
function candidates(
  data: GenerationData,
  base: ItemBase,
  used: ReadonlySet<string>,
  cap: { prefix: number; suffix: number; belt: number },
  count: { prefix: number; suffix: number; belt: number },
  ctx: GenerateContext,
  biasJob: boolean,
): { def: AffixDef; weight: number }[] {
  const out: { def: AffixDef; weight: number }[] = [];
  for (const def of data.affixes) {
    if (used.has(def.id)) continue;
    if (!def.slots.includes(base.slot)) continue;
    if (def.family !== undefined && def.family !== ctx.enemyFamily) continue;
    if (def.beltSlot === true) {
      if (count.belt >= cap.belt) continue;
    } else if (
      def.position === "prefix" ? count.prefix >= cap.prefix : count.suffix >= cap.suffix
    ) {
      continue;
    }
    let weight = def.weight;
    if (biasJob && def.job !== undefined && def.job === ctx.job?.jobId) {
      weight *= JOB_AFFIX_BIAS_MULTIPLIER;
    }
    out.push({ def, weight });
  }
  return out;
}

export function generateItem(data: GenerationData, ctx: GenerateContext, rng: Rng): ItemInstance {
  let rarity: Rarity =
    ctx.rarity ?? rollRarity(ctx.rarityContext ?? { rank: "normal" }, ctx.ilvl, rng);
  const biasJob = ctx.job !== undefined && rng.chance(ctx.jobBiasChance ?? DEFAULT_JOB_BIAS_CHANCE);

  // ユニーク・セット：必要LvがiLv以下のものから抽選する。なければ希少にする
  if (rarity === "unique" || rarity === "set") {
    const source = ctx.uniqueSource ?? "any";
    const pool = data.uniques.filter(
      (u) =>
        u.requiredLevel <= ctx.ilvl &&
        (u.obtain === undefined ||
          u.obtain === "any" ||
          u.obtain === "elite-beast" ||
          u.obtain === source),
    );
    if (pool.length > 0) {
      // 獣系の精鋭から出やすいユニークは、その入手元のとき重みを増やす
      const u = pool[
        rng.weightedIndex(
          pool.map(
            (e) =>
              (e.weight ?? 1) * (e.obtain === "elite-beast" && source === "elite-beast" ? 5 : 1),
          ),
        )
      ] as UniqueEntry;
      return {
        uid: ctx.uid(),
        baseId: u.baseId,
        rarity,
        ilvl: ctx.ilvl,
        affixes: [],
        enhance: 0,
        uniqueId: u.id,
      };
    }
    rarity = "rare";
  }

  // ベースの選択。ジョブに寄せるときは、適性がA以上の武器種から
  const eligible = data.bases.filter((b) => b.requiredLevel <= Math.max(1, ctx.ilvl));
  let pool = eligible;
  if (biasJob && ctx.job) {
    const weapons = eligible.filter(
      (b) =>
        b.kind === "weapon" &&
        b.weaponClass !== undefined &&
        ctx.job?.weaponClasses.includes(b.weaponClass),
    );
    if (weapons.length > 0) pool = weapons;
  }
  const base = rng.pick(pool);

  const target = affixCount(rarity === "astral" ? "rare" : rarity, rng);
  const affixes = fillAffixes(data, base, rarity, ctx.ilvl, target, ctx, rng, [], biasJob);
  return { uid: ctx.uid(), baseId: base.id, rarity, ilvl: ctx.ilvl, affixes, enhance: 0 };
}

function rollResonance(def: AffixDef, ilvl: number, tierFloor: number, rng: Rng): RolledAffix {
  const rolled = rollAffix(def, ilvl, tierFloor, rng);
  return { ...rolled, params: { region: rng.pick(RESONANCE_REGIONS) } };
}

/** 能力値の要求を満たしているか。満たさないと基礎性能が-40%（本仕様書 2.2） */
export function meetsRequirement(base: ItemBase, stats: Readonly<Record<string, number>>): boolean {
  if (!base.requirement) return true;
  return (stats[base.requirement.stat] ?? 0) >= base.requirement.value;
}

/**
 * 詞を、目標の数になるまで付け足す。existing は残す詞（封印した詞・すでにある詞）で、数に含める。
 * 部位の枠の上限・重複・職詞・系統詞の規則は、アイテムの生成と同じ。
 */
export function fillAffixes(
  data: GenerationData,
  base: ItemBase,
  rarity: Rarity,
  ilvl: number,
  target: number,
  ctx: Pick<GenerateContext, "tierFloor" | "job" | "enemyFamily">,
  rng: Rng,
  existing: readonly RolledAffix[],
  biasJob = false,
): RolledAffix[] {
  const tierFloor = ctx.tierFloor ?? 5;
  const affixes: RolledAffix[] = [...existing];
  if (target <= 0) return affixes;
  const cap = affixCapacity(base, rarity);
  const count = { prefix: 0, suffix: 0, belt: 0 };
  const used = new Set<string>();
  const countOf = (def: AffixDef): void => {
    if (def.beltSlot === true) count.belt++;
    else if (def.position === "prefix") count.prefix++;
    else count.suffix++;
  };
  for (const a of affixes) {
    used.add(a.id);
    const def = data.affixes.find((d) => d.id === a.id);
    if (def) countOf(def);
  }
  // 共鳴紋が確定のベース
  const forced =
    base.guaranteedResonance === true && !used.has("AFX-SUF-RESONANCE")
      ? data.affixes.find((a) => a.resonance === true)
      : undefined;
  if (forced) {
    affixes.push(rollResonance(forced, ilvl, tierFloor, rng));
    used.add(forced.id);
    count.suffix++;
  }
  const gctx = { ...ctx, ilvl, uid: () => "" } as GenerateContext;
  while (affixes.length < target) {
    const list = candidates(data, base, used, cap, count, gctx, biasJob);
    if (list.length === 0) break;
    const chosen = list[rng.weightedIndex(list.map((c) => c.weight))] as {
      def: AffixDef;
      weight: number;
    };
    const def = chosen.def;
    affixes.push(
      def.resonance === true
        ? rollResonance(def, ilvl, tierFloor, rng)
        : rollAffix(def, ilvl, tierFloor, rng),
    );
    used.add(def.id);
    countOf(def);
  }
  return affixes;
}
