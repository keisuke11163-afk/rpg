/**
 * MVPのアイテムのデータ：下級のベース（補助仕様書 14章）と、詞（本仕様書 3.6）。数値は仮値。
 */
import type { AffixDef, ArmorType, ItemBase, Slot } from "@stella/core";

const w = (
  id: string,
  name: string,
  weaponClass: ItemBase["weaponClass"],
  hands: 1 | 2,
  stat: string,
  weaponKey: string,
  weapon: NonNullable<ItemBase["weapon"]>,
  implicit: string,
): ItemBase => ({
  id,
  name,
  slot: "主手",
  kind: "weapon",
  ...(weaponClass ? { weaponClass } : {}),
  hands,
  weapon,
  requirement: { stat, value: hands === 1 ? 12 : 18 },
  requiredLevel: 1,
  implicit,
  note: weaponKey,
});

/** 武器（下級。本仕様書 3.2） */
const WEAPON_BASES: ItemBase[] = [
  w(
    "BASE-WPN-GREATSWORD-T1",
    "大剣",
    "greatsword",
    2,
    "剛",
    "greatsword",
    { min: 14, max: 24, speed: 1.05, crit: 0.05 },
    "崩し値+15%",
  ),
  w(
    "BASE-WPN-GREATAXE-T1",
    "大斧",
    "greataxe",
    2,
    "剛",
    "greataxe",
    { min: 16, max: 28, speed: 0.95, crit: 0.05 },
    "出血ダメージ+15%",
  ),
  w(
    "BASE-WPN-AXE-T1",
    "片手斧",
    "axe",
    1,
    "剛",
    "axe",
    { min: 7, max: 13, speed: 1.3, crit: 0.05 },
    "出血の付与率+10%",
  ),
  w(
    "BASE-WPN-GREATHAMMER-T1",
    "大槌",
    "greathammer",
    2,
    "剛",
    "greathammer",
    { min: 18, max: 27, speed: 0.9, crit: 0.04 },
    "崩し値+30%",
  ),
  w(
    "BASE-WPN-LONGSWORD-T1",
    "長剣",
    "longsword",
    1,
    "剛",
    "longsword",
    { min: 6, max: 11, speed: 1.4, crit: 0.05 },
    "命中+40",
  ),
  w(
    "BASE-WPN-DAGGER-T1",
    "短剣",
    "dagger",
    1,
    "迅",
    "dagger",
    { min: 4, max: 9, speed: 1.6, crit: 0.08 },
    "背面からの会心率+5%",
  ),
  w(
    "BASE-WPN-CLAW-T1",
    "爪",
    "claw",
    1,
    "迅",
    "claw",
    { min: 5, max: 8, speed: 1.7, crit: 0.06 },
    "ヒットでHP吸収0.5%",
  ),
];

const SHIELD_BASES: ItemBase[] = [
  {
    id: "BASE-SHD-SMALL-T1",
    name: "小盾",
    slot: "副手",
    kind: "shield",
    weaponClass: "shield",
    hands: 1,
    defense: { kind: "armor", value: 20 },
    requirement: { stat: "剛", value: 12 },
    requiredLevel: 1,
    implicit: "ガード率50%",
  },
  {
    id: "BASE-SHD-LARGE-T1",
    name: "大盾",
    slot: "副手",
    kind: "shield",
    weaponClass: "shield",
    hands: 1,
    defense: { kind: "armor", value: 34 },
    requirement: { stat: "剛", value: 18 },
    requiredLevel: 1,
    implicit: "ガード率70%・移動-5%",
  },
];

/** 防具：胴を基準（重装40・軽装40・法衣15）に、部位ごとの割合（仮値）をかける */
const ARMOR_SLOTS: readonly (readonly [Slot, string, number])[] = [
  ["頭", "HEAD", 0.6],
  ["胴", "BODY", 1],
  ["手", "HANDS", 0.4],
  ["足", "FEET", 0.4],
  ["腰", "WAIST", 0.2],
];
const ARMOR_TYPES: readonly (readonly [
  ArmorType,
  string,
  string,
  "armor" | "evasion" | "barrier",
  number,
  string,
])[] = [
  ["heavy", "HEAVY", "重装", "armor", 40, "剛"],
  ["light", "LIGHT", "軽装", "evasion", 40, "迅"],
  ["robe", "ROBE", "法衣", "barrier", 15, "理"],
];
const ARMOR_BASES: ItemBase[] = ARMOR_TYPES.flatMap(([type, code, label, kind, value, stat]) =>
  ARMOR_SLOTS.map(([slot, slotCode, ratio]): ItemBase => ({
    id: `BASE-ARM-${code}-${slotCode}-T1`,
    name: `${label}の${slot}`,
    slot,
    kind: "armor",
    armorType: type,
    defense: { kind, value: Math.round(value * ratio) },
    requirement: { stat, value: 10 },
    requiredLevel: 1,
  })),
);

/** アクセサリー（本仕様書 3.4。骨の指輪を除く） */
const ACCESSORY_BASES: ItemBase[] = [
  {
    id: "BASE-ACC-RING-SILVER-T1",
    name: "銀の指輪",
    slot: "指輪",
    kind: "accessory",
    requiredLevel: 1,
    implicit: "全属性耐性+5%",
  },
  {
    id: "BASE-ACC-RING-RUBY-T1",
    name: "紅玉の指輪",
    slot: "指輪",
    kind: "accessory",
    requiredLevel: 1,
    implicit: "火ダメージ+10%",
  },
  {
    id: "BASE-ACC-NECK-AMBER-T1",
    name: "琥珀の首飾り",
    slot: "首",
    kind: "accessory",
    requiredLevel: 1,
    implicit: "全能力値+8",
  },
  {
    id: "BASE-ACC-NECK-STARIRON-T1",
    name: "星鉄の首飾り",
    slot: "首",
    kind: "accessory",
    requiredLevel: 1,
    implicit: "共鳴紋が確定で付く（詞の枠-1）",
    guaranteedResonance: true,
  },
  {
    id: "BASE-ACC-BELT-LEATHER-T1",
    name: "革の帯",
    slot: "腰",
    kind: "accessory",
    requiredLevel: 1,
    implicit: "薬瓶の回復量+15%",
  },
  {
    id: "BASE-ACC-BELT-CHAIN-T1",
    name: "重鎖の帯",
    slot: "腰",
    kind: "accessory",
    requiredLevel: 1,
    implicit: "防具値+15%・移動-2%",
  },
];

export const ITEM_BASES: readonly ItemBase[] = [
  ...WEAPON_BASES,
  ...SHIELD_BASES,
  ...ARMOR_BASES,
  ...ACCESSORY_BASES,
];

const ARMOR_AND_ACC: readonly Slot[] = ["頭", "胴", "手", "足", "腰", "首", "指輪"];

const range = (a: number, b: number): { min: number; max: number } => ({ min: a, max: b });

/** 詞（本仕様書 3.6 の表。T7・T4 の値。他のtierは補間） */
export const AFFIXES: readonly AffixDef[] = [
  {
    id: "AFX-PRE-ADDED-PHYS-WPN",
    name: "物理ダメージ追加",
    position: "prefix",
    slots: ["主手"],
    weight: 100,
    t7: range(1, 3),
    t4: range(6, 11),
    added: true,
    stat: "物理ダメージ追加",
  },
  {
    id: "AFX-PRE-ADDED-FIRE-WPN",
    name: "火ダメージ追加",
    position: "prefix",
    slots: ["主手"],
    weight: 100,
    t7: range(1, 4),
    t4: range(7, 13),
    added: true,
    stat: "火ダメージ追加",
  },
  {
    id: "AFX-PRE-PHYS-INC-WPN",
    name: "物理ダメージ増加%",
    position: "prefix",
    slots: ["主手"],
    weight: 100,
    t7: range(10, 19),
    t4: range(40, 54),
    stat: "物理ダメージ増加%",
  },
  {
    id: "AFX-PRE-MAXHP",
    name: "最大HP",
    position: "prefix",
    slots: ARMOR_AND_ACC,
    weight: 100,
    t7: range(10, 19),
    t4: range(50, 69),
    stat: "最大HP",
  },
  {
    id: "AFX-PRE-SUMMON-DMG",
    name: "召喚物ダメージ増加%",
    position: "prefix",
    slots: ["首"],
    weight: 100,
    t7: range(8, 12),
    t4: range(25, 34),
    stat: "召喚物ダメージ増加%",
  },
  {
    id: "AFX-SUF-ATKSPD",
    name: "攻撃速度",
    position: "suffix",
    slots: ["主手", "手", "指輪"],
    weight: 50,
    t7: range(3, 4),
    t4: range(7, 9),
    stat: "攻撃速度",
  },
  {
    id: "AFX-SUF-CRIT",
    name: "会心率増加%",
    position: "suffix",
    slots: ["主手", "首"],
    weight: 50,
    t7: range(10, 14),
    t4: range(20, 24),
    stat: "会心率増加%",
  },
  {
    id: "AFX-SUF-FIRE-RES",
    name: "火耐性",
    position: "suffix",
    slots: ARMOR_AND_ACC,
    weight: 100,
    t7: range(6, 11),
    t4: range(24, 29),
    stat: "火耐性",
  },
  {
    id: "AFX-SUF-AILMENT",
    name: "状態異常付与率",
    position: "suffix",
    slots: ["主手", "手", "首"],
    weight: 50,
    t7: range(3, 3),
    t4: range(8, 8),
    stat: "状態異常付与率",
  },
  {
    id: "AFX-SUF-MOVE",
    name: "移動速度",
    position: "suffix",
    slots: ["足"],
    weight: 50,
    t7: range(10, 10),
    t4: range(15, 15),
    stat: "移動速度",
  },
  {
    id: "AFX-SUF-CDR",
    name: "クールダウン短縮",
    position: "suffix",
    slots: ["頭", "首"],
    weight: 100,
    t7: range(3, 3),
    t4: range(6, 6),
    stat: "クールダウン短縮",
  },
  // 職詞（どのジョブでも拾えるが、効果を発揮するのはそのジョブ）。頭に出やすい（重みは仮値）
  {
    id: "AFX-JOB-WARRIOR-FURY",
    name: "闘志の獲得量+%",
    position: "prefix",
    slots: ["頭", "胴", "首", "指輪", "主手"],
    weight: 25,
    t7: range(10, 10),
    t4: range(15, 15),
    stat: "闘志の獲得量+%",
    job: "JOB-WARRIOR",
  },
  {
    id: "AFX-JOB-ROGUE-COMBO",
    name: "終結技のコンボ点+1として扱う",
    position: "prefix",
    slots: ["頭", "胴", "首", "指輪", "主手"],
    weight: 25,
    t7: range(1, 1),
    t4: range(1, 1),
    stat: "終結技のコンボ点",
    job: "JOB-ROGUE",
  },
  // 共鳴紋：後詞の枠を1つ使う。星域は抽選で決まる
  {
    id: "AFX-SUF-RESONANCE",
    name: "共鳴紋",
    position: "suffix",
    slots: ["主手", "副手", "頭", "胴", "手", "足", "腰", "首", "指輪"],
    weight: 25,
    t7: range(10, 10),
    t4: range(10, 10),
    stat: "共鳴",
    resonance: true,
  },
  // 系統詞（獣）：獣系の敵からだけ落ちる
  {
    id: "AFX-FAM-BEASTHUNTER",
    name: "獣狩りの",
    position: "prefix",
    slots: ["主手", "手", "足"],
    weight: 25,
    t7: range(15, 15),
    t4: range(15, 15),
    stat: "獣を倒すと3秒間移動速度+%",
    family: "TAG-ENEMY-BEAST",
  },
  // 帯紋：腰だけの専用の詞（薬瓶の効果を変える）
  {
    id: "AFX-BELT-FLASK",
    name: "帯紋：薬瓶の回復量+%",
    position: "prefix",
    slots: ["腰"],
    weight: 100,
    t7: range(5, 8),
    t4: range(15, 20),
    stat: "薬瓶の回復量+%",
    beltSlot: true,
  },
];

export function itemBase(id: string): ItemBase {
  const base = ITEM_BASES.find((b) => b.id === id);
  if (!base) throw new Error(`ベースがない: ${id}`);
  return base;
}

/** 基本刻印の数値（ベースID → 能力値の名前 → 値）。百分率は比で持つ（本仕様書 3.2・3.4） */
export const IMPLICIT_STATS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  "BASE-WPN-GREATSWORD-T1": { 崩し値: 0.15 },
  "BASE-WPN-GREATAXE-T1": { 出血ダメージ: 0.15 },
  "BASE-WPN-AXE-T1": { 出血付与率: 0.1 },
  "BASE-WPN-GREATHAMMER-T1": { 崩し値: 0.3 },
  "BASE-WPN-LONGSWORD-T1": { 命中: 40 },
  "BASE-WPN-DAGGER-T1": { 背面会心率: 0.05 },
  "BASE-WPN-CLAW-T1": { HP吸収: 0.005 },
  "BASE-SHD-SMALL-T1": { ガード率: 0.5 },
  "BASE-SHD-LARGE-T1": { ガード率: 0.7, 移動速度: -0.05 },
  "BASE-ACC-RING-SILVER-T1": { 全属性耐性: 0.05 },
  "BASE-ACC-RING-RUBY-T1": { 火ダメージ増加: 0.1 },
  "BASE-ACC-NECK-AMBER-T1": { 全能力値: 8 },
  "BASE-ACC-BELT-LEATHER-T1": { 薬瓶の回復量: 0.15 },
  "BASE-ACC-BELT-CHAIN-T1": { 防具値増加: 0.15, 移動速度: -0.02 },
};
