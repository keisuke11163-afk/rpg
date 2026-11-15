/**
 * 地域の生成（補助仕様書 9.3）。入るたびに、敵の群れ・精鋭・宝箱の配置を抽選する。
 */
import type { Rng } from "../rng.ts";
import type { Vec2 } from "../player/controller.ts";
import { createEnemy, spawnPack, type Enemy } from "../enemy/ai.ts";
import type { EnemyDef } from "../enemy/def.ts";
import { sectionAt, type MapDef } from "./map.ts";

/** 群れの出現地点のうち有効になる割合（70%） */
export const PACK_ACTIVE_RATE = 0.7;
/** 精鋭の出現地点が有効になる割合（50%） */
export const ELITE_ACTIVE_RATE = 0.5;
export const CRATE_PICK = { from: 8, count: 3 } as const;
export const CHEST_CHANCE = 0.5;

export interface Container {
  id: string;
  kind: "crate" | "chest";
  pos: Vec2;
  opened: boolean;
}

export interface RegionInstance {
  map: MapDef;
  enemies: Enemy[];
  containers: Container[];
  /** 何回目の生成か（作り直しのたびに増える） */
  generation: number;
}

export type EnemyLookup = (id: string) => EnemyDef;

function pickSome<T>(items: readonly T[], count: number, rng: Rng): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < count && pool.length > 0)
    out.push(pool.splice(rng.int(0, pool.length - 1), 1)[0] as T);
  return out;
}

/** 地域を新しく作る。同じ地図でも、乱数が違えば配置が変わる */
export function generateRegion(
  map: MapDef,
  lookup: EnemyLookup,
  rng: Rng,
  generation = 1,
): RegionInstance {
  const enemies: Enemy[] = [];
  let serial = 0;

  // 群れ：出現地点のうち70%が有効。中身は、その区画の敵の一覧から抽選。10%（A5は15%）で1体が魔法の敵
  for (const spot of map.packSpawns) {
    if (!rng.chance(PACK_ACTIVE_RATE)) continue;
    const section = sectionAt(map, spot.x);
    if (!section) continue;
    const def = lookup(rng.pick(section.enemies));
    const level = rng.int(section.levelMin, section.levelMax);
    const pack = spawnPack({
      def,
      level,
      center: spot,
      rng,
      packId: `${map.id}-G${String(generation)}-P${String(serial++)}`,
    });
    if (pack.length > 0 && rng.chance(map.magicChance)) {
      const i = rng.int(0, pack.length - 1);
      const original = pack[i] as Enemy;
      pack[i] = createEnemy({
        def,
        level,
        pos: original.body.pos,
        rank: "magic",
        ...(original.packId ? { packId: original.packId } : {}),
        id: original.body.id,
        rng,
      });
    }
    enemies.push(...pack);
  }

  // 精鋭：出現地点を地域ごとに置き（2〜3か所、A5は4〜6か所）、それぞれ50%で出現する
  const eliteSpots = pickSome(
    map.eliteSpawns,
    rng.int(map.eliteSpotCount[0], map.eliteSpotCount[1]),
    rng,
  );
  for (const spot of eliteSpots) {
    if (!rng.chance(ELITE_ACTIVE_RATE)) continue;
    const section = sectionAt(map, spot.x);
    if (!section) continue;
    enemies.push(
      createEnemy({
        def: lookup(rng.pick(section.enemies)),
        level: rng.int(section.levelMin, section.levelMax),
        pos: spot,
        rank: "elite",
        id: `${map.id}-G${String(generation)}-E${String(serial++)}`,
        rng,
      }),
    );
  }

  // 木箱：候補8か所から3か所。古びた宝箱：候補3か所から、50%で1か所
  const containers: Container[] = pickSome(map.crateSpots, CRATE_PICK.count, rng).map((pos, i) => ({
    id: `${map.id}-C${String(i)}`,
    kind: "crate",
    pos,
    opened: false,
  }));
  if (map.chestSpots.length > 0 && rng.chance(CHEST_CHANCE)) {
    containers.push({
      id: `${map.id}-CH0`,
      kind: "chest",
      pos: rng.pick(map.chestSpots),
      opened: false,
    });
  }
  return { map, enemies, containers, generation };
}

/** 配置を、位置と種類の一覧にする（配置が変わったかの比較・確認用） */
export function layoutSignature(r: RegionInstance): string {
  const e = r.enemies.map(
    (x) => `${x.def.id}@${x.body.pos.x.toFixed(1)},${x.body.pos.y.toFixed(1)}:${x.rank}`,
  );
  const c = r.containers.map((x) => `${x.kind}@${String(x.pos.x)},${String(x.pos.y)}`);
  return [...e, ...c].join("|");
}
