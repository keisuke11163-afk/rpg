import type { Attributes } from "../character/progression.ts";
import { ELEMENTS } from "../content/effect.ts";
import { ELEMENT_TAG } from "../content/elements.ts";
import type { AffixDef, ArmorType, ItemBaseDef, ItemRarity } from "../content/item.ts";
import type { ContentDb } from "../content/load.ts";
import { TagIndex } from "../effects/tag-index.ts";
import { UNMET_REQUIREMENT_MULTIPLIER, enhanceMultiplier, requirementMet } from "./equipment.ts";
import type { ItemInstance, RolledAffix } from "./generate.ts";

/** ツールチップの効果の行1つ（基本刻印か詞）。 */
export interface TooltipEffectLine {
  readonly kind: "implicit" | "affix";
  readonly effectId: string;
  /** 詞のデータ（基本刻印なら undefined）。 */
  readonly affix: AffixDef | undefined;
  /** 詞の抽選の値（表示の単位）。基本刻印なら undefined。 */
  readonly rolled: RolledAffix | undefined;
  /** 局所の効果（この武器のヒットだけ）か。 */
  readonly local: boolean;
  /**
   * 今の技に効くか（仕様書v0.2 11章「タグが一致すると光る」）。タグの条件を持つ修正値が、
   * 今の技の文脈（技のタグ・武器のタグ・属性のタグ）の1つ以上に一致すると true。
   * タグの条件の無い修正値（最大HPなど）は、常に効くので光らせない（docs/progress D-U12-7）。
   */
  readonly matchesSkills: boolean;
}

/** 装備のツールチップの中身（文章を含まない。表示の層が文章にする）。 */
export interface ItemTooltip {
  readonly item: ItemInstance;
  readonly base: ItemBaseDef;
  readonly rarity: ItemRarity;
  readonly itemLevel: number;
  /** 必要Lvを満たしているか（今のキャラLvで）。 */
  readonly levelMet: boolean;
  /** 能力値の要求値（無ければ undefined）と、満たしているか。満たさなければ基礎性能-40%（仕様書v0.2 2.2）。 */
  readonly requirement:
    | { readonly attribute: keyof Attributes; readonly value: number; readonly met: boolean }
    | undefined;
  /** 武器の基礎性能（要求値の補正の後）。武器でなければ undefined。 */
  readonly weapon:
    | {
        readonly hands: 1 | 2;
        readonly physical: { readonly min: number; readonly max: number };
        readonly critChance: number;
        readonly attackSpeed: number;
      }
    | undefined;
  /** 防具・盾の基礎性能（強化・要求値の補正の後）と防具種・ガード率。防具・盾でなければ undefined。 */
  readonly defense:
    | {
        readonly type: ArmorType | undefined;
        readonly armor: number;
        readonly evasion: number;
        readonly ward: number;
        readonly guard: number | undefined;
      }
    | undefined;
  readonly effects: readonly TooltipEffectLine[];
}

/**
 * 今の技の文脈：技のタグ＋武器のタグ＋属性のタグ（親タグを含む）と、その技のヒットで付く状態異常の文脈
 * （技・武器・物理のタグ＋状態異常のタグ）。
 * 属性は、全ての属性の文脈を作る（技が今どの属性のダメージを出すかは、詞を付ければ変わるため）。
 * 状態異常は、データの全ての状態異常の文脈を作る（付与率は詞・基本刻印で0から増やせるため）。
 */
export function skillContexts(
  db: ContentDb,
  tags: TagIndex,
  skillTags: readonly (readonly string[])[],
  weaponTags: readonly string[],
): ReadonlySet<string>[] {
  const out: ReadonlySet<string>[] = [];
  const ailmentTags = [...db.ailments.values()].map((a) => a.tag);
  for (const s of skillTags) {
    for (const element of ELEMENTS)
      out.push(tags.closure([...s, ...weaponTags, ELEMENT_TAG[element]]));
    for (const ailment of ailmentTags)
      out.push(tags.closure([...s, ...weaponTags, ELEMENT_TAG.physical, ailment]));
  }
  return out;
}

/** 効果のタグの条件が、文脈のどれかに一致するか（条件の無い修正値は数えない）。 */
export function effectMatchesContexts(
  db: ContentDb,
  effectId: string,
  contexts: readonly ReadonlySet<string>[],
): boolean {
  const effect = db.effects.get(effectId);
  if (effect === undefined) return false;
  return effect.modifiers.some(
    (m) =>
      "filter" in m &&
      m.filter !== undefined &&
      contexts.some((c) => TagIndex.matches(m.filter, c)),
  );
}

export interface TooltipContext {
  readonly attributes: Attributes;
  readonly characterLevel: number;
  /** 今の技の文脈（{@link skillContexts}）。省略すると、どの行も光らせない。 */
  readonly contexts?: readonly ReadonlySet<string>[];
}

/** 装備のツールチップの中身を作る。 */
export function itemTooltip(
  db: ContentDb,
  item: ItemInstance,
  context: TooltipContext,
): ItemTooltip {
  const base = db.itemBases.get(item.base);
  if (base === undefined) throw new RangeError(`ベース ${item.base} が無い`);
  const met = requirementMet(base, context.attributes);
  const m = (met ? 1 : UNMET_REQUIREMENT_MULTIPLIER) * enhanceMultiplier(item);
  const contexts = context.contexts ?? [];
  const line = (
    kind: TooltipEffectLine["kind"],
    effectId: string,
    affix?: AffixDef,
    rolled?: RolledAffix,
  ): TooltipEffectLine => ({
    kind,
    effectId,
    affix,
    rolled,
    local: db.effects.get(effectId)?.locality === "local",
    matchesSkills: effectMatchesContexts(db, effectId, contexts),
  });
  const effects: TooltipEffectLine[] = (base.implicitEffects ?? []).map((id) =>
    line("implicit", id),
  );
  for (const rolled of item.affixes) {
    const affix = db.affixes.get(rolled.id);
    if (affix === undefined) throw new RangeError(`詞 ${rolled.id} が無い`);
    effects.push(line("affix", affix.effect, affix, rolled));
  }
  const w = base.weapon;
  return {
    item,
    base,
    rarity: item.rarity,
    itemLevel: item.itemLevel,
    levelMet: context.characterLevel >= base.requiredLevel,
    requirement:
      base.requirement === undefined
        ? undefined
        : {
            attribute: base.requirement.attribute,
            value: base.requirement.value,
            met,
          },
    weapon:
      w === undefined
        ? undefined
        : {
            hands: w.hands,
            physical: { min: w.damage.physical.min * m, max: w.damage.physical.max * m },
            critChance: w.critChance,
            attackSpeed: w.attackSpeed,
          },
    defense:
      base.defense === undefined
        ? undefined
        : {
            type: base.defense.type,
            armor: (base.defense.armor ?? 0) * m,
            evasion: (base.defense.evasion ?? 0) * m,
            ward: (base.defense.ward ?? 0) * m,
            guard: base.shield?.guard,
          },
    effects,
  };
}
