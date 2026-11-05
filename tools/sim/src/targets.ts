import type { Target } from "./build.ts";
import { chapterBossHp, normalEnemyHp } from "./standards.ts";

/** DPSを測る的（倒れない）。 */
export function dummy(level: number): Target {
  return { name: `訓練用の人形（Lv${String(level)}）`, level };
}

/** 通常の敵（補助仕様書 0.1）。HPは 30×1.06^(Lv-1)。 */
export function normalEnemy(level: number): Target {
  return { name: `通常の敵（Lv${String(level)}）`, level, maxHp: normalEnemyHp(level) };
}

/**
 * 章ボス（仕様書v0.2 2.8・補助仕様書11章）。HP＝標準DPS×90秒。
 * 攻撃は「予兆のある大技（標準HPの30%）を5秒ごと」で近似する（補助仕様書11.1 の根の叩きつけ）。
 */
export function chapterBoss(level: number, hpLevel = level): Target {
  return {
    name: `章ボス（Lv${String(level)}）`,
    level,
    maxHp: chapterBossHp(hpLevel),
    isBoss: true,
    attack: { ratioOfStandardHp: 0.3, interval: 5, element: "physical" },
  };
}

/** 名前で的を選ぶ（例：dummy-1、enemy-14、boss-14、boss-14@15）。 */
export function targetByName(name: string): Target {
  const m = /^(dummy|enemy|boss)-(\d+)(?:@(\d+))?$/.exec(name);
  if (m === null)
    throw new Error(`的の名前が正しくない：${name}（例：dummy-1、enemy-14、boss-14@15）`);
  const level = Number(m[2]);
  if (m[1] === "dummy") return dummy(level);
  if (m[1] === "enemy") return normalEnemy(level);
  return chapterBoss(level, m[3] === undefined ? level : Number(m[3]));
}
