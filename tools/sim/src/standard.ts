/**
 * バランス調整に使う「標準的なビルド」（Lv15・Lv20）と、まったく違うビルド（深淵の母樹の完成条件3）。
 * 装備は希少の詞（T6）・強化+5程度、ツリーは使えるポイントを星辰盤と職紋盤に配る。
 */
import { affix, type BuildSpec, type GearPiece } from "./builds.ts";

const greatsword = (tier: number, enhance: number): GearPiece => ({
  baseId: "BASE-WPN-GREATSWORD-T1",
  enhance,
  affixes: [
    affix("AFX-PRE-ADDED-PHYS-WPN", tier, tier === 5 ? 4 : 3, tier === 5 ? 8 : 6),
    affix("AFX-PRE-PHYS-INC-WPN", tier, tier === 5 ? 33 : 25),
    affix("AFX-SUF-ATKSPD", tier, tier === 5 ? 6 : 5),
    affix("AFX-SUF-CRIT", tier, tier === 5 ? 18 : 16),
  ],
});
const dagger = (tier: number, enhance: number): GearPiece => ({
  baseId: "BASE-WPN-DAGGER-T1",
  enhance,
  affixes: [
    affix("AFX-PRE-ADDED-PHYS-WPN", tier, tier === 5 ? 4 : 3, tier === 5 ? 8 : 6),
    affix("AFX-PRE-PHYS-INC-WPN", tier, tier === 5 ? 33 : 25),
    affix("AFX-SUF-ATKSPD", tier, tier === 5 ? 6 : 5),
    affix("AFX-SUF-CRIT", tier, tier === 5 ? 18 : 16),
  ],
});

/** 標準的なビルドの装備（頭・胴・手・足）。防具は強化だけ */
const heavy = (enhance: number): GearPiece[] =>
  ["BODY", "HEAD", "HANDS", "FEET"].map((s) => ({ baseId: `BASE-ARM-HEAVY-${s}-T1`, enhance }));
const light = (enhance: number): GearPiece[] =>
  ["BODY", "HEAD", "HANDS", "FEET"].map((s) => ({ baseId: `BASE-ARM-LIGHT-${s}-T1`, enhance }));

export const WARRIOR_LV15: BuildSpec = {
  name: "戦士Lv15（大剣・標準）",
  job: "warrior",
  charLevel: 15,
  jobLevel: 14,
  gear: [greatsword(6, 3), ...heavy(2)],
  star: ["断ち切る刃"],
  job_: ["怒りの呼吸", "両手の誇り"],
};
export const ROGUE_LV15: BuildSpec = {
  name: "盗賊Lv15（短剣・標準）",
  job: "rogue",
  charLevel: 15,
  jobLevel: 14,
  gear: [dagger(6, 3), ...light(2)],
  star: ["鋭い目", "毒の滴"],
  job_: ["急所の知識", "狙いの目", "素早い手"],
};
export const WARRIOR_LV20: BuildSpec = {
  ...WARRIOR_LV15,
  name: "戦士Lv20（大剣・標準）",
  charLevel: 20,
  jobLevel: 20,
  gear: [greatsword(5, 3), ...heavy(4)],
  star: ["断ち切る刃", "重撃化"],
  job_: [
    "怒りの呼吸",
    "鬼気",
    "薙ぎの鍛錬",
    "重みの理解",
    "両手の誇り",
    "崩しの達人",
    "旋風の呼吸",
  ],
};
export const ROGUE_LV20: BuildSpec = {
  ...ROGUE_LV15,
  name: "盗賊Lv20（短剣・標準）",
  charLevel: 20,
  jobLevel: 20,
  gear: [dagger(5, 6), ...light(5)],
  star: ["鋭い目", "毒の滴", "軽い足", "傷口を抉る", "血の刃"],
  job_: ["急所の知識", "狙いの目", "素早い手", "終結の構え", "連刃の冴え", "毒血同源", "無限連撃"],
};

/** まったく違う3つ以上のビルド（深淵の母樹に勝てること） */
export const DIFFERENT_BUILDS: readonly BuildSpec[] = [
  WARRIOR_LV20,
  ROGUE_LV20,
  {
    ...ROGUE_LV20,
    name: "盗賊Lv20（千の小傷・出血と毒）",
    gear: [
      {
        baseId: "BASE-WPN-DAGGER-T1",
        uniqueId: "UNQ-U03",
        enhance: 8,
        affixes: dagger(5, 8).affixes ?? [],
      },
      ...light(6),
    ],
    job_: ["毒血同源", "毒の巡り", "血の滲み", "急所の知識", "終結の構え", "無限連撃"],
    star: ["傷口を抉る", "血の刃"],
  },
  {
    ...WARRIOR_LV20,
    name: "戦士Lv20（二股の枝・片手斧と盾）",
    gear: [
      { baseId: "BASE-WPN-AXE-T1", uniqueId: "UNQ-U17", enhance: 8, affixes: [] },
      { baseId: "BASE-SHD-LARGE-T1", enhance: 6 },
      ...heavy(6),
    ],
    star: ["断ち切る刃", "刃の門"],
    job_: ["闘志の炉", "血を燃やす", "怒りの呼吸", "鬼気", "戦吼の響き", "鬼神化"],
  },
];
