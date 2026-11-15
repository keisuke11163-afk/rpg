/**
 * 町（星見の村）と第1章「腐根の森」の地域A1〜A5の固定マップ（補助仕様書 8・9章）。
 * 地形・出現地点の候補は固定（固定の種から生成した、手作り扱いのデータ）。配置の抽選は入るたびに行う（core の generateRegion）。
 * 数値・大きさは仮値。
 */
import {
  TOWN_ID,
  createRng,
  insideWall,
  type FacilityId,
  type MapDef,
  type Rect,
  type Section,
} from "@stella/core";
import { ENEMIES, enemyDef } from "./enemies.ts";

interface RegionSpec {
  id: string;
  name: string;
  seed: string;
  width: number;
  height: number;
  /** 区画ごとの敵のLvの範囲と、敵の一覧（敵の定義のID） */
  sections: readonly { levels: readonly [number, number]; enemies: readonly string[] }[];
  packSpots: number;
  eliteSpots: readonly [number, number];
  magicChance: number;
  /** 行き先（東端の出口）。最後の地域は undefined */
  next: string | undefined;
  /** 入口にある戻り先 */
  prev: string;
}

const WOLF = "ENM-FOREST-WOLF";
const RAT = "ENM-THORN-RAT";
const LIZARD = "ENM-SPIT-LIZARD";
const BOAR = "ENM-FANG-BOAR";
const BEAR = "ENM-BARK-BEAR";
const SPROUT = "ENM-ROT-SPROUT";

const SPECS: readonly RegionSpec[] = [
  {
    id: "MAP-A1",
    name: "A1 森の入口",
    seed: "a1",
    width: 150,
    height: 50,
    sections: [
      { levels: [1, 1], enemies: [WOLF, RAT] },
      { levels: [2, 2], enemies: [WOLF, RAT] },
      { levels: [3, 3], enemies: [WOLF, RAT] },
    ],
    packSpots: 22,
    eliteSpots: [2, 3],
    magicChance: 0.1,
    next: "MAP-A2",
    prev: TOWN_ID,
  },
  {
    id: "MAP-A2",
    name: "A2 苔むす小道",
    seed: "a2",
    width: 150,
    height: 50,
    sections: [
      { levels: [4, 5], enemies: [WOLF, RAT, LIZARD] },
      { levels: [5, 6], enemies: [WOLF, RAT, LIZARD] },
      { levels: [6, 7], enemies: [WOLF, RAT, LIZARD] },
    ],
    packSpots: 24,
    eliteSpots: [2, 3],
    magicChance: 0.1,
    next: "MAP-A3",
    prev: "MAP-A1",
  },
  {
    id: "MAP-A3",
    name: "A3 獣の巣穴",
    seed: "a3",
    width: 150,
    height: 50,
    sections: [
      { levels: [8, 9], enemies: [WOLF, BOAR, LIZARD] },
      { levels: [9, 10], enemies: [WOLF, BOAR, LIZARD] },
      { levels: [10, 11], enemies: [WOLF, BOAR, LIZARD] },
    ],
    packSpots: 26,
    eliteSpots: [2, 3],
    magicChance: 0.1,
    next: "MAP-A4",
    prev: "MAP-A2",
  },
  {
    id: "MAP-A4",
    name: "A4 腐根の奥地",
    seed: "a4",
    width: 130,
    height: 50,
    sections: [
      { levels: [12, 13], enemies: [BOAR, BEAR, SPROUT] },
      { levels: [13, 14], enemies: [BOAR, BEAR, SPROUT] },
    ],
    packSpots: 22,
    eliteSpots: [2, 3],
    magicChance: 0.1,
    next: "MAP-A5",
    prev: "MAP-A3",
  },
  {
    id: "MAP-A5",
    name: "A5 母樹の深淵",
    seed: "a5",
    width: 170,
    height: 56,
    sections: [
      { levels: [16, 17], enemies: ENEMIES.map((e) => e.id) },
      { levels: [17, 18], enemies: ENEMIES.map((e) => e.id) },
      { levels: [18, 19], enemies: ENEMIES.map((e) => e.id) },
    ],
    packSpots: 30,
    eliteSpots: [4, 6],
    magicChance: 0.15,
    next: undefined,
    prev: "MAP-A4",
  },
];

function buildRegion(spec: RegionSpec): MapDef {
  const rng = createRng(`map-${spec.seed}`);
  const { width, height } = spec;
  // 外周の壁と、木の塊（障害物）
  const walls: Rect[] = [
    { x: -2, y: -2, w: width + 4, h: 2 },
    { x: -2, y: height, w: width + 4, h: 2 },
    { x: -2, y: -2, w: 2, h: height + 4 },
    { x: width, y: -2, w: 2, h: height + 4 },
  ];
  const entrance = { x: 6, y: height / 2 };
  const exitPos = { x: width - 6, y: height / 2 };
  for (let i = 0; i < Math.round(width / 5); i++) {
    const w = rng.int(2, 6);
    const h = rng.int(2, 6);
    const rect = { x: rng.int(14, width - 14), y: rng.int(2, height - h - 2), w, h };
    const nearPath = Math.abs(rect.y + h / 2 - height / 2) < 4; // 道（中央）は空けておく
    if (!nearPath) walls.push(rect);
  }
  const free = (margin: number, minX = 10, maxX = width - 10): { x: number; y: number } => {
    for (let t = 0; t < 200; t++) {
      const p = { x: rng.int(minX, maxX), y: rng.int(4, height - 4) };
      if (!insideWall(p, walls, margin) && Math.hypot(p.x - entrance.x, p.y - entrance.y) > 10)
        return p;
    }
    return { x: width / 2, y: height / 2 };
  };
  const sections: Section[] = spec.sections.map((s, i) => ({
    id: `${spec.id}-S${String(i + 1)}`,
    xMin: (width * i) / spec.sections.length,
    xMax: (width * (i + 1)) / spec.sections.length,
    levelMin: s.levels[0],
    levelMax: s.levels[1],
    enemies: s.enemies,
  }));
  for (const s of sections) for (const id of s.enemies) enemyDef(id); // 敵の定義の存在を確かめる
  return {
    id: spec.id,
    name: spec.name,
    width,
    height,
    walls,
    entrance,
    teleportStone: { x: entrance.x + 3, y: entrance.y - 3 },
    exits: [
      { pos: { x: 2, y: height / 2 }, radius: 2, to: spec.prev },
      ...(spec.next ? [{ pos: exitPos, radius: 2.5, to: spec.next }] : []),
    ],
    sections,
    packSpawns: Array.from({ length: spec.packSpots }, () => free(2)),
    eliteSpawns: Array.from({ length: spec.eliteSpots[1] + 2 }, () => free(2)),
    crateSpots: Array.from({ length: 8 }, () => free(1.5)),
    chestSpots: Array.from({ length: 3 }, () => free(2, 40)),
    magicChance: spec.magicChance,
    eliteSpotCount: spec.eliteSpots,
  };
}

/** 町（星見の村）：安全地帯。敵は出ない。東の門から A1 の入口へ */
export const TOWN_FACILITY_POS: Readonly<Record<FacilityId, { x: number; y: number }>> = {
  TEMPLE: { x: 10, y: 8 },
  STAR_READER: { x: 20, y: 6 },
  ALTAR: { x: 30, y: 8 },
  SMITH: { x: 10, y: 22 },
  MERCHANT: { x: 20, y: 24 },
  STASH: { x: 30, y: 22 },
  TELEPORT: { x: 40, y: 15 },
  DUMMY: { x: 24, y: 15 },
};

export const TOWN_MAP: MapDef = {
  id: TOWN_ID,
  name: "星見の村",
  width: 50,
  height: 30,
  walls: [
    { x: -2, y: -2, w: 54, h: 2 },
    { x: -2, y: 30, w: 54, h: 2 },
    { x: -2, y: -2, w: 2, h: 34 },
    { x: 50, y: -2, w: 2, h: 34 },
  ],
  entrance: { x: 4, y: 15 },
  teleportStone: undefined,
  exits: [{ pos: { x: 47.5, y: 15 }, radius: 2, to: "MAP-A1" }],
  sections: [],
  packSpawns: [],
  eliteSpawns: [],
  crateSpots: [],
  chestSpots: [],
  magicChance: 0,
  eliteSpotCount: [0, 0],
};

export const REGION_MAPS: readonly MapDef[] = SPECS.map(buildRegion);
export const ALL_MAPS: readonly MapDef[] = [TOWN_MAP, ...REGION_MAPS];

export function mapDef(id: string): MapDef {
  const m = ALL_MAPS.find((x) => x.id === id);
  if (!m) throw new Error(`地図がない: ${id}`);
  return m;
}
