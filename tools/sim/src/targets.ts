import type { ContentDb } from "@stella/core";
import { text, type TextKey } from "@stella/content";
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

/**
 * データのボス（補助仕様書11章）：最大HP・耐性・段階の境目と切り替えの無敵・根渡り（地中にいる間は無敵で、
 * 移動している）。攻撃は、データで最も強い攻撃を5秒ごとで近似する。
 */
export function bossFromData(db: ContentDb, enemyId: string, level: number): Target {
  const def = db.enemies.get(enemyId);
  const boss = def?.boss;
  if (def === undefined || boss === undefined) throw new Error(`ボス ${enemyId} がデータに無い`);
  const burrow = def.attacks.find((a) => a.delivery.type === "burrow");
  const strongest = Math.max(...def.attacks.map((a) => a.ratio));
  return {
    name: `${text(def.text as TextKey)}（Lv${String(level)}）`,
    level,
    maxHp: boss.hp,
    isBoss: true,
    resist: { ...(def.defense.resist ?? {}) },
    phases: { thresholds: [...boss.phaseThresholds], invulnerable: boss.transitionInvulnerable },
    ...(burrow === undefined
      ? {}
      : {
          burrow: {
            phase: Math.min(...(burrow.phases ?? [1])),
            // 根渡りを使ってから次に使うまで：予兆・地中・硬直＋待ち時間
            period: burrow.windup + burrow.active + burrow.recovery + burrow.cooldown,
            duration: burrow.active,
          },
        }),
    ...(strongest > 0
      ? { attack: { ratioOfStandardHp: strongest, interval: 5, element: "physical" as const } }
      : {}),
  };
}

/** 名前で的を選ぶ（例：dummy-1、enemy-14、boss-14、boss-14@15、ENM-MOTHER-TREE@14）。 */
export function targetByName(name: string, db?: ContentDb): Target {
  const data = /^(ENM-[A-Z0-9-]+)@(\d+)$/.exec(name);
  if (data !== null) {
    if (db === undefined) throw new Error("データのボスには、データが必要");
    return bossFromData(db, data[1] as string, Number(data[2]));
  }
  const m = /^(dummy|enemy|boss)-(\d+)(?:@(\d+))?$/.exec(name);
  if (m === null)
    throw new Error(`的の名前が正しくない：${name}（例：dummy-1、enemy-14、boss-14@15）`);
  const level = Number(m[2]);
  if (m[1] === "dummy") return dummy(level);
  if (m[1] === "enemy") return normalEnemy(level);
  return chapterBoss(level, m[3] === undefined ? level : Number(m[3]));
}
