/**
 * データのスキーマ（開発計画書 6.1〜6.4、本仕様書 10.1）。
 * データの形は core が決め、content のデータをこのスキーマで検証する（開発環境構築計画 3.1）。
 */
import { z } from "zod";

/** データの版。スキーマに互換性のない変更をしたときに上げる（開発計画書 6.1） */
export const DATA_VERSION = 1;

/** IDは英大文字・数字とハイフン（例：TAG-WPN-GREATSWORD）。一度決めたら変えない（本仕様書 10.2） */
export const idSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$/, "IDは英大文字・数字とハイフン");

const finite = z.number();

/** 仮値の印。付いたデータは一覧に出る（開発計画書 T17） */
const provisional = z.boolean().optional();

export const tagSchema = z.strictObject({
  id: idSchema,
  category: z.string().min(1),
  name: z.string().min(1),
  parents: z.array(idSchema).optional(),
  note: z.string().optional(),
  provisional,
});
export type TagDef = z.infer<typeof tagSchema>;

/** 効果の出どころ（本仕様書 10.1）。乗算を持てるかは、ここで決まる（2.4） */
export const SOURCES = [
  "詞",
  "基本ノード",
  "輝星",
  "天極",
  "転変",
  "ユニーク",
  "職技",
  "職奥義",
  "セット",
  "セット最大段階",
  "状態異常",
  "基礎",
] as const;
export const sourceSchema = z.enum(SOURCES);
export type Source = z.infer<typeof sourceSchema>;

/** 乗算を持てる出どころ（本仕様書 2.4・8.3）。転変は減らす方向（値が1未満）だけ持てる */
export const MULTIPLIER_SOURCES: readonly Source[] = [
  "天極",
  "転変",
  "ユニーク",
  "職技",
  "職奥義",
  "セット最大段階",
  "状態異常",
];

export const SCOPES = ["自分", "自分の技", "召喚物", "敵", "味方"] as const;
export const scopeSchema = z.enum(SCOPES);

/** タグによる絞り込み。タグはIDで参照する */
export const tagFilterSchema = z.strictObject({
  all_of: z.array(idSchema).optional(),
  any_of: z.array(idSchema).optional(),
  none_of: z.array(idSchema).optional(),
});
export type TagFilter = z.infer<typeof tagFilterSchema>;

/** 修正値の絞り込み（例：出血に対する修正） */
const modifierFilterSchema = z.strictObject({
  tags: tagFilterSchema.optional(),
  ailment: idSchema.optional(),
  element: idSchema.optional(),
});

/** 発動の条件 */
export const conditionSchema = z.looseObject({
  type: z.string().min(1),
  tags: tagFilterSchema.optional(),
  tag: idSchema.optional(),
});
export type Condition = z.infer<typeof conditionSchema>;

const perSchema = z.strictObject({
  count: z.string().min(1),
  value: z.string().optional(),
  tag: idSchema.optional(),
});

const modifierBase = {
  stat: z.string().min(1),
  filter: modifierFilterSchema.optional(),
  per: perSchema.optional(),
  conditions: z.array(conditionSchema).optional(),
  /** 積み重ねたときの上限（絶対値） */
  cap: finite.optional(),
};

export const modifierSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("固定の追加"), ...modifierBase, value: finite }),
  z.strictObject({ kind: z.literal("加算％"), ...modifierBase, value: finite.min(-1).max(20) }),
  z.strictObject({ kind: z.literal("乗算"), ...modifierBase, value: finite.min(0.05).max(10) }),
  z.strictObject({
    kind: z.literal("変換"),
    stat: z.string().min(1),
    from: idSchema,
    to: idSchema,
    /** 変換の割合（0〜1）。一方向のみ（本仕様書 2.5） */
    ratio: finite.min(0).max(1),
    conditions: z.array(conditionSchema).optional(),
  }),
  z.strictObject({
    kind: z.literal("付け替え"),
    stat: z.string().min(1),
    from: z.array(idSchema).min(1),
    to: z.array(idSchema).min(1),
    conditions: z.array(conditionSchema).optional(),
  }),
  z.strictObject({ kind: z.literal("上限"), ...modifierBase, value: finite }),
  z.strictObject({
    kind: z.literal("挙動"),
    hook: z.string().min(1),
    params: z.record(z.string(), z.unknown()).optional(),
    conditions: z.array(conditionSchema).optional(),
  }),
]);
export type Modifier = z.infer<typeof modifierSchema>;
export type ModifierKind = Modifier["kind"];

/** 打撃値・基準値への影響。必須（V-07・H-08・C-03）。決定待ちは "仮" */
const affectFlag = z.union([z.boolean(), z.literal("仮")]);
export const affectsSchema = z.strictObject({
  打撃値: affectFlag,
  基準値: affectFlag,
});

/** 共鳴変化（本仕様書 6.1）：その星域の共鳴紋が min_resonance 個以上のとき、修正値を差し替える・足す */
export const resonanceVariantSchema = z.strictObject({
  region: idSchema,
  min_resonance: z.number().int().min(1),
  /** 種類と能力値が同じ修正値を、これで置き換える */
  replace: z.array(modifierSchema).optional(),
  add: z.array(modifierSchema).optional(),
});

export const effectSchema = z.strictObject({
  id: idSchema,
  source: sourceSchema,
  target_skill_tags: tagFilterSchema.optional(),
  conditions: z.array(conditionSchema).default([]),
  modifiers: z.array(modifierSchema).min(1),
  affects: affectsSchema,
  scope: scopeSchema,
  /** 積み重ねの上限 */
  stack_cap: z.number().int().positive().optional(),
  resonance_variant: resonanceVariantSchema.optional(),
  note: z.string().optional(),
  provisional,
});
export type EffectDef = z.infer<typeof effectSchema>;

export const NODE_TYPES = [
  "始点",
  "小星",
  "輝星",
  "転変",
  "天極",
  "星門",
  "共鳴座",
  /** 職紋盤：職奥義（3つから1つだけ選べる） */
  "職奥義",
  /** 職紋盤：星辰盤への接続ノード */
  "接続",
] as const;

/** 星辰盤のノード（開発計画書 6.8）。つながりは双方向で、両側に書く */
export const starNodeSchema = z.strictObject({
  id: idSchema,
  region: idSchema,
  type: z.enum(NODE_TYPES),
  name: z.string().min(1),
  links: z.array(idSchema),
  effects: z.array(idSchema),
  constellation: idSchema.optional(),
  /** 星門：条件を満たしたときだけ、この先が有効になる */
  gate: z.strictObject({ condition: conditionSchema, label: z.string() }).optional(),
  /** 始点：job が null なら予約枠（通過も取得もできるが、出自の始点ではない） */
  start: z.strictObject({ job: z.string().nullable() }).optional(),
  /** 画面上の座標（0〜640 × 0〜360） */
  x: z.number(),
  y: z.number(),
  provisional,
});
export type StarNodeDef = z.infer<typeof starNodeSchema>;

export const constellationSchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1),
  region: idSchema,
  nodes: z.array(idSchema).min(2),
  completionEffect: idSchema,
  provisional,
});
export type ConstellationDef = z.infer<typeof constellationSchema>;

/** ユニーク装備（本仕様書 3.7）：固有効果（ルール）と、他のシステムを条件にする潜在効果を1つ持つ */
export const uniqueSchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1),
  baseId: z.string().min(1),
  requiredLevel: z.number().int().min(1),
  /** 入手：any＝どこでも／boss-ch1＝第1章ボス専用／elite-beast＝獣系の精鋭から出やすい など */
  obtain: z.string().min(1),
  /** 抽選の重み（同じ条件の中での出やすさ） */
  weight: z.number().positive().default(1),
  fixed: z.array(idSchema).min(1),
  latent: z.strictObject({
    effect: idSchema,
    /** 発動前に出すヒント（発動するまで中身は「？？？」） */
    hint: z.string().min(1),
  }),
  provisional,
});
export type UniqueDef = z.infer<typeof uniqueSchema>;

/** 1つのデータファイルの形 */
export const dataFileSchema = z.strictObject({
  dataVersion: z.literal(DATA_VERSION),
  items: z.array(z.unknown()),
});

/** データの種類。フォルダ名と対応する */
export const DATA_KINDS = ["tags", "effects", "starNodes", "constellations", "uniques"] as const;
export type DataKind = (typeof DATA_KINDS)[number];

export const kindSchemas = {
  tags: tagSchema,
  effects: effectSchema,
  starNodes: starNodeSchema,
  constellations: constellationSchema,
  uniques: uniqueSchema,
} as const;

export interface DataSet {
  tags: TagDef[];
  effects: EffectDef[];
  starNodes: StarNodeDef[];
  constellations: ConstellationDef[];
  uniques: UniqueDef[];
}
