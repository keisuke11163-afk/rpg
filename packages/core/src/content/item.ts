import { z } from "zod";
import { idSchema, provisionalFields, textKeySchema } from "./ids.ts";

/**
 * アイテムのデータの形（仕様書v0.2 3.1〜3.6、補助仕様書12・14章、開発計画書6.5）。
 * 生成の手順は core/src/items にある。
 */

/** レアリティ（仕様書v0.2 3.5）。星刻はアイテムLv60以上だけなので、MVP（アイテムLv25まで）では扱わない。 */
export const ITEM_RARITIES = ["normal", "magic", "rare", "unique", "set"] as const;
export type ItemRarity = (typeof ITEM_RARITIES)[number];

/** 希少以上（敵の格・回廊・発見率の補正がかかるレアリティ。仕様書v0.2 3.5 の手順2）。 */
export const RARE_OR_BETTER: ReadonlySet<ItemRarity> = new Set<ItemRarity>([
  "rare",
  "unique",
  "set",
]);

/** レアリティの定義。 */
export const raritySchema = z.strictObject({
  id: idSchema,
  rarity: z.enum(ITEM_RARITIES),
  text: textKeySchema,
  /** 基本の重み（仕様書v0.2 3.5 の手順1。通常66／魔法26／希少7／固有0.8／星座0.2）。 */
  weight: z.number().nonnegative(),
  /** 詞の数（両端を含む）。固有・星座は固定の効果なので0。 */
  affixes: z.strictObject({
    min: z.number().int().nonnegative(),
    max: z.number().int().nonnegative(),
  }),
  ...provisionalFields,
});
export type RarityDef = z.infer<typeof raritySchema>;

/**
 * ベースの分類（詞の付く部位の判定に使う。仕様書v0.2 3.6 の「付く部位」）。
 * weapon は主手・副手の片手武器、shield は盾。
 */
export const BASE_CATEGORIES = [
  "weapon",
  "shield",
  "head",
  "body",
  "hands",
  "feet",
  "belt",
  "neck",
  "ring",
] as const;
export type BaseCategory = (typeof BASE_CATEGORIES)[number];

/** 部位ごとの詞の枠（希少の場合の上限。仕様書v0.2 3.1）。前詞・後詞それぞれ。 */
export const AFFIX_SLOTS: Readonly<Record<BaseCategory, { prefix: number; suffix: number }>> = {
  weapon: { prefix: 3, suffix: 3 },
  shield: { prefix: 3, suffix: 3 },
  head: { prefix: 3, suffix: 3 },
  body: { prefix: 3, suffix: 3 },
  hands: { prefix: 3, suffix: 3 },
  feet: { prefix: 3, suffix: 3 },
  // 帯紋の1枠は別（薬瓶の効果を変える専用の詞。MVPの範囲では帯紋の詞のデータがない）
  belt: { prefix: 2, suffix: 2 },
  neck: { prefix: 3, suffix: 3 },
  ring: { prefix: 2, suffix: 2 },
};

/** 能力値（仕様書v0.2 2.2：剛・迅・理・魂）。 */
export const ATTRIBUTES = ["go", "jin", "ri", "kon"] as const;
export type Attribute = (typeof ATTRIBUTES)[number];

const rangeSchema = z
  .strictObject({ min: z.number().nonnegative(), max: z.number().nonnegative() })
  .refine((r) => r.min <= r.max, "最小値が最大値を超えている");

/** アイテムのベース（開発計画書6.5、仕様書v0.2 3.2〜3.4、補助仕様書14章）。 */
export const itemBaseSchema = z.strictObject({
  id: idSchema,
  text: textKeySchema,
  category: z.enum(BASE_CATEGORIES),
  /** 武器種・防具種のタグ（例：TAG-WPN-SWORD）。 */
  tags: z.array(idSchema),
  /** ベースのtier（1＝下級。仕様書v0.2 3.2）。 */
  tier: z.number().int().min(1).max(4),
  /** 必要Lv（下級は1）。ドロップはアイテムLv以上の必要Lvのベースからは選ばない。 */
  requiredLevel: z.number().int().min(1),
  /** 能力値の要求値（補助仕様書14章）。アクセサリーには無い。 */
  requirement: z
    .strictObject({ attribute: z.enum(ATTRIBUTES), value: z.number().int().positive() })
    .optional(),
  /** 武器の基礎性能（仕様書v0.2 3.2）。 */
  weapon: z
    .strictObject({
      hands: z.union([z.literal(1), z.literal(2)]),
      damage: z.strictObject({ physical: rangeSchema }),
      attackSpeed: z.number().positive(),
      critChance: z.number().min(0).max(1),
    })
    .optional(),
  /** 基本刻印・武器としての特性（効果のID。出どころは implicit）。 */
  implicitEffects: z.array(idSchema).optional(),
  ...provisionalFields,
});
export type ItemBaseDef = z.infer<typeof itemBaseSchema>;

/** 詞のtier（7が最も低い）。極T0は回廊の第12階層以上だけ。 */
export const AFFIX_TIERS = [7, 6, 5, 4, 3, 2, 1, 0] as const;
export type AffixTier = (typeof AFFIX_TIERS)[number];

/** tierごとの、出現できる最低のアイテムLv（仕様書v0.2 3.6）。 */
export const TIER_MIN_ILVL: Readonly<Record<AffixTier, number>> = {
  7: 1,
  6: 12,
  5: 25,
  4: 38,
  3: 52,
  2: 66,
  1: 80,
  0: 90,
};

/** 表示の単位の値（例：10–19% は min 10・max 19、scale 0.01）。 */
const tierValueSchema = z.strictObject({
  tier: z.number().int().min(0).max(7),
  min: z.number(),
  max: z.number(),
});

/**
 * 詞の定義（仕様書v0.2 3.6、開発計画書6.5）。
 * 値は表示の単位で持ち、効果に渡すときに scale を掛ける（例：% は 0.01）。
 * - roll: "range" … tierの範囲で1つの値を抽選する（増加%など）
 * - roll: "added" … 最小・最大の追加ダメージ。tierの中では抽選しない（仕様書v0.2 3.6）
 * - roll: "fixed" … tierごとに1つの値（「+3%」「10%」など）。min と max は同じ
 */
export const affixSchema = z.strictObject({
  id: idSchema,
  text: textKeySchema,
  position: z.enum(["prefix", "suffix"]),
  /** 付く部位（ベースの分類）。 */
  categories: z.array(z.enum(BASE_CATEGORIES)).min(1),
  /** 効果（出どころは affix。修正値は1つで、値を詞の値で差し替える）。 */
  effect: idSchema,
  roll: z.enum(["range", "added", "fixed"]),
  scale: z.number().positive(),
  /** 出現の重み（仕様書v0.2 3.6：一般100、攻撃速度・会心率・移動速度・付与率50 など）。 */
  weight: z.number().positive(),
  /** 表に載っているtierの値。載っていないtierは、隣の載っているtierの間を補う。 */
  tiers: z.array(tierValueSchema).min(1),
  ...provisionalFields,
});
export type AffixDef = z.infer<typeof affixSchema>;

/** 素材（仕様書v0.2 3.10、補助仕様書12.2）。 */
export const materialSchema = z.strictObject({
  id: idSchema,
  text: textKeySchema,
  ...provisionalFields,
});
export type MaterialDef = z.infer<typeof materialSchema>;

/** ドロップの出どころ（仕様書v0.2 3.5 の敵の格とドロップ数、補助仕様書12章）。 */
export const DROP_SOURCES = ["normal", "magic", "elite", "miniBoss", "chapterBoss"] as const;
export type DropSource = (typeof DROP_SOURCES)[number];

/** 素材のドロップ：確率で1個（chance）か、確定の数（count）。family は、その系統の敵だけ（獣牙）。 */
const materialDropSchema = z
  .strictObject({
    material: idSchema,
    chance: z.number().gt(0).max(1).optional(),
    count: z.number().int().positive().optional(),
    family: idSchema.optional(),
  })
  .refine(
    (m) => (m.chance === undefined) !== (m.count === undefined),
    "chance と count のどちらか1つ",
  );
export type MaterialDropDef = z.infer<typeof materialDropSchema>;

/** 敵の格ごとのドロップ（仕様書v0.2 3.5、補助仕様書5章・12章）。 */
export const dropProfileSchema = z.strictObject({
  id: idSchema,
  source: z.enum(DROP_SOURCES),
  /** アイテムを落とす確率（落とすときの数は count）。 */
  chance: z.number().gt(0).max(1),
  count: z.strictObject({ min: z.number().int().positive(), max: z.number().int().positive() }),
  /** 希少以上の重みに掛ける補正（魔法×1.5・精鋭×2.5）。 */
  rareMultiplier: z.number().positive(),
  /** 希少以上が確定する数（中ボス1）。 */
  guaranteedRareOrBetter: z.number().int().nonnegative(),
  /** アイテムLv ＝ 敵のLv ＋ この値（精鋭+2・ボス+4。仕様書v0.2 3.6）。 */
  itemLevelBonus: z.number().int().nonnegative(),
  /** 金貨（補助仕様書5章）：確率と、（1＋敵のLv）×（1〜2）に掛ける倍率。中ボス・章ボスは記載が無いので省略（落とさない）。 */
  gold: z
    .strictObject({ chance: z.number().gt(0).max(1), multiplier: z.number().positive() })
    .optional(),
  materials: z.array(materialDropSchema),
  ...provisionalFields,
});
export type DropProfileDef = z.infer<typeof dropProfileSchema>;
