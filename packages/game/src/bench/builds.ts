import type { BenchBuild } from "./boss-bench.ts";

/**
 * U-21 で測る、まったく違う3つのビルド（MVP実装単位 1.1 の完成の条件3「深淵の母樹に3つ以上のビルドで勝てる」）。
 * 装備は Lv20 で拾える範囲（下級のベース・T6 の詞・MVPのユニーク）。値は詞の T6 の中央。
 */
export const BENCH_BUILDS: readonly BenchBuild[] = [
  {
    id: "rogue-bleed-myriad",
    name: "盗賊・千の小傷＋毒血同源＋千変（出血と毒で臨界）",
    job: "JOB-ROGUE",
    equipment: [
      { slot: "mainHand", base: "BASE-UNQ-U03" },
      {
        slot: "offHand",
        base: "BASE-WPN-DAGGER-T1",
        affixes: ["AFX-PRE-ADDED-PHYSICAL-WPN", "AFX-SUF-AILMENT-CHANCE", "AFX-SUF-ATTACK-SPEED"],
      },
      { slot: "head", base: "BASE-UNQ-U18" },
      {
        slot: "body",
        base: "BASE-ARM-LEATHER-BODY-T1",
        affixes: ["AFX-PRE-HP-MAX", "AFX-SUF-ATTR-JIN"],
      },
      {
        slot: "hands",
        base: "BASE-ARM-LEATHER-HANDS-T1",
        affixes: ["AFX-SUF-ATTACK-SPEED", "AFX-SUF-AILMENT-CHANCE"],
      },
      {
        slot: "feet",
        base: "BASE-ARM-LEATHER-FEET-T1",
        affixes: ["AFX-PRE-HP-MAX", "AFX-SUF-MOVE-SPEED"],
      },
      { slot: "belt", base: "BASE-ARM-LEATHER-BELT-T1", affixes: ["AFX-PRE-HP-MAX"] },
      {
        slot: "neck",
        base: "BASE-ACC-AMBER-NECK-T1",
        affixes: ["AFX-SUF-AILMENT-DAMAGE", "AFX-SUF-AILMENT-CHANCE"],
      },
      { slot: "ring1", base: "BASE-ACC-SILVER-RING-T1", affixes: ["AFX-SUF-ATTACK-SPEED"] },
      { slot: "ring2", base: "BASE-ACC-RUBY-RING-T1", affixes: ["AFX-SUF-AILMENT-DAMAGE"] },
    ],
    stars: ["STAR-VIPER-09", "STAR-KEY-MYRIAD", "STAR-NOTABLE-REOPEN", "STAR-NT-FOCUS"],
    jobNodes: [
      "JBN-ROGUE-POISON-BLOOD",
      "JBN-ROGUE-QUICK",
      "JBN-ROGUE-VITALS",
      "JBN-ROGUE-M-SHADOW",
    ],
  },
  {
    id: "warrior-heavy-greataxe",
    name: "戦士・大斧＋重装5部位＋重荷の誇り＋鬼神化",
    job: "JOB-WARRIOR",
    equipment: [
      {
        slot: "mainHand",
        base: "BASE-WPN-GREATAXE-T1",
        affixes: [
          "AFX-PRE-ADDED-PHYSICAL-WPN",
          "AFX-PRE-INC-PHYSICAL-WPN",
          "AFX-SUF-ATTACK-SPEED",
          "AFX-SUF-CRIT-CHANCE",
        ],
        enhance: 5,
      },
      {
        slot: "head",
        base: "BASE-ARM-IRON-HEAD-T1",
        affixes: ["AFX-PRE-HP-MAX", "AFX-SUF-ATTR-GO"],
      },
      { slot: "body", base: "BASE-ARM-IRON-BODY-T1", affixes: ["AFX-PRE-HP-MAX", "AFX-PRE-ARMOR"] },
      { slot: "hands", base: "BASE-UNQ-U15" },
      { slot: "feet", base: "BASE-ARM-IRON-FEET-T1", affixes: ["AFX-PRE-HP-MAX"] },
      { slot: "belt", base: "BASE-ARM-IRON-BELT-T1", affixes: ["AFX-PRE-HP-MAX"] },
      {
        slot: "neck",
        base: "BASE-ACC-AMBER-NECK-T1",
        affixes: ["AFX-SUF-CRIT-CHANCE", "AFX-SUF-CRIT-MULTIPLIER"],
      },
      { slot: "ring1", base: "BASE-ACC-SILVER-RING-T1", affixes: ["AFX-SUF-ATTACK-SPEED"] },
      { slot: "ring2", base: "BASE-ACC-RUBY-RING-T1", affixes: ["AFX-SUF-ACCURACY"] },
    ],
    stars: ["STAR-KEY-BURDEN", "STAR-SMITH-08", "STAR-NT-SEVERING", "STAR-MUT-HEAVY"],
    jobNodes: [
      "JBN-WARRIOR-FORGE",
      "JBN-WARRIOR-TWOHAND",
      "JBN-WARRIOR-BREAKER",
      "JBN-WARRIOR-M-DEMON",
    ],
  },
  {
    id: "warrior-bare-hands-bark",
    name: "戦士・徒手の極意＋樹皮の盾（素手と盾の2倍・反撃の毒）",
    job: "JOB-WARRIOR",
    equipment: [
      { slot: "offHand", base: "BASE-UNQ-U13" },
      {
        slot: "head",
        base: "BASE-ARM-IRON-HEAD-T1",
        affixes: ["AFX-PRE-HP-MAX", "AFX-SUF-ATTR-GO"],
      },
      { slot: "body", base: "BASE-ARM-IRON-BODY-T1", affixes: ["AFX-PRE-HP-MAX", "AFX-PRE-ARMOR"] },
      {
        slot: "hands",
        base: "BASE-ARM-IRON-HANDS-T1",
        affixes: ["AFX-SUF-ATTACK-SPEED", "AFX-SUF-STAGGER"],
      },
      { slot: "feet", base: "BASE-ARM-IRON-FEET-T1", affixes: ["AFX-PRE-HP-MAX"] },
      { slot: "belt", base: "BASE-ARM-IRON-BELT-T1", affixes: ["AFX-PRE-HP-MAX"] },
      {
        slot: "neck",
        base: "BASE-ACC-AMBER-NECK-T1",
        affixes: ["AFX-SUF-CRIT-CHANCE", "AFX-SUF-CRIT-MULTIPLIER"],
      },
      { slot: "ring1", base: "BASE-ACC-SILVER-RING-T1", affixes: ["AFX-SUF-ATTACK-SPEED"] },
      { slot: "ring2", base: "BASE-ACC-RUBY-RING-T1", affixes: ["AFX-SUF-ACCURACY"] },
    ],
    stars: ["STAR-KEY-BARE-HANDS", "STAR-KEY-BURDEN", "STAR-SMITH-08", "STAR-NT-SEVERING"],
    jobNodes: ["JBN-WARRIOR-BLOOD", "JBN-WARRIOR-BREAKER", "JBN-WARRIOR-M-UNYIELDING"],
  },
];
