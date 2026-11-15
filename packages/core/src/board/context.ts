/**
 * 星辰盤の評価の文脈を、装備から作る（本仕様書 4.9.1 の第1段階の値）。
 */
import type { EvalContext } from "../effects/conditions.ts";
import { TagRegistry } from "../effects/tags.ts";
import { withGearStats, type Equipment, type GearData } from "../items/gear.ts";
import { computeGear } from "../items/gear.ts";
import type { BoardContext } from "./star.ts";

/** 武器種 → タグID（本仕様書 1.5）。長剣は「剣」 */
export const WEAPON_TAG_ID: Readonly<Record<string, string>> = {
  longsword: "TAG-WPN-SWORD",
  greatsword: "TAG-WPN-GREATSWORD",
  axe: "TAG-WPN-AXE",
  greataxe: "TAG-WPN-GREATAXE",
  hammer: "TAG-WPN-HAMMER",
  greathammer: "TAG-WPN-GREATHAMMER",
  spear: "TAG-WPN-SPEAR",
  dagger: "TAG-WPN-DAGGER",
  claw: "TAG-WPN-CLAW",
  bow: "TAG-WPN-BOW",
  staff: "TAG-WPN-STAFF",
  shield: "TAG-WPN-SHIELD",
  unarmed: "TAG-WPN-UNARMED",
};

const ARMOR_NAME = { heavy: "重装", light: "軽装", robe: "法衣" } as const;

export interface ContextOptions {
  tags: TagRegistry;
  /** 能力値（剛・迅・理・魂）。装備の加算を含めない値を渡す（含めるのは内部） */
  characterStats: Readonly<Record<string, number>>;
  /** サブジョブを設定しているか */
  subJob?: boolean;
  /** 二刀流か */
  dualWield?: boolean;
  /** 追加の旗 */
  flags?: readonly string[];
}

/** 装備から評価の文脈を作る。タグは主手の武器のタグ（親タグを含む） */
export function buildBoardContext(
  equipment: Equipment,
  data: GearData,
  opts: ContextOptions,
): BoardContext {
  const gear = computeGear(equipment, data, opts.characterStats);
  const stats = withGearStats(opts.characterStats, gear);
  const main = equipment.get("主手");
  const mainBase = main ? data.bases.get(main.baseId) : undefined;
  const weaponTag = mainBase?.weaponClass ? WEAPON_TAG_ID[mainBase.weaponClass] : undefined;
  const tags = opts.tags.expand(weaponTag ? [weaponTag] : []);

  const counts: Record<string, number> = {};
  const resonance: Record<string, number> = {};
  for (const [, item] of equipment.all()) {
    const base = data.bases.get(item.baseId);
    if (base?.kind === "armor" && base.armorType) {
      const name = ARMOR_NAME[base.armorType];
      counts[`装備中の防具種:${name}`] = (counts[`装備中の防具種:${name}`] ?? 0) + 1;
      counts[`装備数:${name}`] = (counts[`装備数:${name}`] ?? 0) + 1;
    }
    for (const a of item.affixes) {
      const region = a.params?.["region"];
      if (region) resonance[region] = (resonance[region] ?? 0) + 1;
    }
    counts["装備の強化値の合計"] = (counts["装備の強化値の合計"] ?? 0) + item.enhance;
  }
  const flags = new Set<string>(opts.flags ?? []);
  if (!main) flags.add("主手が空");
  if (opts.subJob === true) flags.add("サブジョブ設定");
  if (opts.dualWield === true) flags.add("二刀流");
  const ctx: EvalContext = { tags, stats, counts, flags };
  return { ctx, resonance };
}
