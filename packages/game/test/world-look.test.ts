/**
 * 世界の見た目（world/）の純粋な部分の試験：決定的な乱数・地面の主題と設計・表の色・仮素材のキー・
 * 場の物の計算・深さ。Phaser に依存しない。実データ（packages/content）の地域・敵・ジョブを使う。
 */
import { describe, expect, it } from "vitest";
import { FACILITIES, type RegionDef } from "@stella/core";
import { loadGameContent } from "@stella/content";
import { hash2, seedOf, valueNoise } from "../src/world/hash.ts";
import {
  type GroundTheme,
  groundThemeOf,
  lerpColor,
  lerpPalette,
  rotOf,
} from "../src/world/ground-theme.ts";
import { type GroundLayout, type GroundOp, planGround } from "../src/world/ground-plan.ts";
import { exitDirection, pulse } from "../src/world/prop-plan.ts";
import { WORLD_DEPTH } from "../src/world/depth.ts";
import {
  DEFAULT_JOB_LOOK,
  ENEMY_LOOKS,
  enemyBodySize,
  enemyLook,
  FACILITY_LOOKS,
  FALLBACK_ENEMY_LOOK,
  GROUND_PALETTES,
  JOB_LOOKS,
  LOOT_COLORS,
  PROP_COLORS,
} from "../src/world/look-tables.ts";
import {
  chestTexture,
  enemyTexture,
  facilityTexture,
  playerTexture,
  stoneTexture,
  TEXTURES,
} from "../src/world/placeholders.ts";
import { PIXELS_PER_METER } from "../src/world/units.ts";

const db = loadGameContent();
const isBoss = (id: string): boolean => db.enemies.get(id)?.boss !== undefined;

function regionOf(id: string): RegionDef {
  const r = db.regions.get(id);
  if (r === undefined) throw new Error(`地域が無い: ${id}`);
  return r;
}

/** ArenaScene と同じ作り方で、地面の設計に渡す地域の配置を作る。 */
function layoutOf(r: RegionDef): GroundLayout {
  return {
    width: r.size.width,
    height: r.size.height,
    entrance: r.entrance,
    facilities: (r.facilities ?? []).map((f) => f.at),
    exits: (r.exits ?? []).map((x) => x.rect),
  };
}

/** 決まった疑似乱数（試験の再現のため。Math.random は使わない）。 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 命令の値の検査。問題の一覧を返す（空なら問題なし）。地域（width×height m）の中に重なるかも見る。 */
function opViolations(ops: readonly GroundOp[], width: number, height: number): string[] {
  const W = Math.round(width * PIXELS_PER_METER);
  const H = Math.round(height * PIXELS_PER_METER);
  const bad: string[] = [];
  ops.forEach((op, i) => {
    const where = `#${String(i)} ${op.t}`;
    if (![op.x, op.y, op.alpha, op.color].every(Number.isFinite))
      bad.push(`${where}: 有限でない値`);
    if (op.alpha < 0 || op.alpha > 1) bad.push(`${where}: alpha ${String(op.alpha)}`);
    if (!Number.isInteger(op.color) || op.color < 0 || op.color > 0xffffff)
      bad.push(`${where}: 色 ${String(op.color)}`);
    if (op.t === "rect") {
      if (!(op.w > 0 && op.h > 0 && Number.isFinite(op.w) && Number.isFinite(op.h)))
        bad.push(`${where}: 大きさ ${String(op.w)}×${String(op.h)}`);
      else if (!(op.x < W && op.x + op.w > 0 && op.y < H && op.y + op.h > 0))
        bad.push(`${where}: 地域の外`);
    } else {
      if (!(op.r > 0 && Number.isFinite(op.r))) bad.push(`${where}: 半径 ${String(op.r)}`);
      else if (!(op.x - op.r < W && op.x + op.r > 0 && op.y - op.r < H && op.y + op.r > 0))
        bad.push(`${where}: 地域の外`);
    }
  });
  return bad;
}

/** オブジェクトの中の数（色の値など）を全部集める。 */
function numbersIn(v: unknown): number[] {
  if (typeof v === "number") return [v];
  if (typeof v === "object" && v !== null) return Object.values(v).flatMap(numbersIn);
  return [];
}

// ---- 試験の地面の主題・配置の組 ----

const DEV_THEME = groundThemeOf(undefined, isBoss);
const TOWN_THEME = groundThemeOf(regionOf("REGION-TOWN"), isBoss);
const A1_THEME = groundThemeOf(regionOf("REGION-A1"), isBoss);
const A5_THEME = groundThemeOf(regionOf("REGION-A5"), isBoss);
const A4_BOSS_THEME = groundThemeOf(regionOf("REGION-A4-BOSS"), isBoss);
const A5_BOSS_THEME = groundThemeOf(regionOf("REGION-A5-BOSS"), isBoss);

/** 主題と配置の組（実データの地域と、手で作った配置）。 */
const layoutCases: [string, GroundTheme, GroundLayout][] = [
  ["試験用の場（dev）", DEV_THEME, { width: 80, height: 40 }],
  ["町（実データ）", TOWN_THEME, layoutOf(regionOf("REGION-TOWN"))],
  ["森・新しい（A1、実データ）", A1_THEME, layoutOf(regionOf("REGION-A1"))],
  ["森・腐った（A5、実データ）", A5_THEME, layoutOf(regionOf("REGION-A5"))],
  ["ボスの間（A4-BOSS、実データ）", A4_BOSS_THEME, layoutOf(regionOf("REGION-A4-BOSS"))],
  ["ボスの間（A5-BOSS、実データ）", A5_BOSS_THEME, layoutOf(regionOf("REGION-A5-BOSS"))],
  [
    "森（手作り rot 0.5・出口なし）",
    { kind: "forest", rot: 0.5, palette: GROUND_PALETTES.forestFresh, seed: 11 },
    { width: 60, height: 30 },
  ],
  [
    "町（手作り・入口と施設なし）",
    { kind: "town", rot: 0, palette: GROUND_PALETTES.town, seed: 12 },
    { width: 48, height: 32 },
  ],
  [
    "ボス（手作り rot 1・小さい）",
    { kind: "boss", rot: 1, palette: GROUND_PALETTES.bossRotten, seed: 13 },
    { width: 32, height: 28 },
  ],
];

// =====================================================================
// hash.ts
// =====================================================================

describe("決定的な乱数 hash.ts", () => {
  describe("seedOf", () => {
    it("同じ文字列は同じ値、違う文字列は違う値", () => {
      expect(seedOf("REGION-A1")).toBe(seedOf("REGION-A1"));
      expect(seedOf("REGION-A1")).not.toBe(seedOf("REGION-A2"));
    });

    it("空文字でも、0以上の整数（32ビット）を返す", () => {
      const s = seedOf("");
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(2 ** 32);
      // FNV-1a の初期値（空文字の結果）
      expect(s).toBe(0x811c9dc5);
    });

    it("実データの全ての地域で、種が互いに違う", () => {
      const seeds = [...db.regions.keys()].map(seedOf);
      expect(new Set(seeds).size).toBe(seeds.length);
    });
  });

  describe("hash2", () => {
    it("同じ引数なら必ず同じ値", () => {
      for (const [x, y, s] of [
        [0, 0, 1],
        [3, -7, 99],
        [123456, -654321, 0xdeadbeef],
      ] as const)
        expect(hash2(x, y, s)).toBe(hash2(x, y, s));
    });

    it("値は 0 以上 1 未満で、NaN にならない（負・大きな座標・小数を含む）", () => {
      const xs = [
        -1000000,
        -17,
        -1,
        0,
        1,
        16,
        255,
        4096,
        1e9,
        -1e9,
        2 ** 31,
        -(2 ** 31) - 1,
        2 ** 40,
      ];
      let n = 0;
      for (const x of xs)
        for (const y of xs)
          for (const s of [0, 1, 0x5bd1, 0xffffffff]) {
            const v = hash2(x, y, s);
            n++;
            if (!(v >= 0 && v < 1))
              throw new Error(
                `範囲外: hash2(${String(x)}, ${String(y)}, ${String(s)}) = ${String(v)}`,
              );
          }
      expect(n).toBe(xs.length * xs.length * 4);
      expect(Number.isNaN(hash2(0.5, 0.25, 7))).toBe(false);
    });

    it("種が違えば値が変わる（100点のうち、ほとんどが違う）", () => {
      let differ = 0;
      for (let i = 0; i < 100; i++) if (hash2(i, 3 * i, 1) !== hash2(i, 3 * i, 2)) differ++;
      expect(differ).toBeGreaterThanOrEqual(95);
    });

    it("偏りが極端でない：100×100 の格子の平均が 0.4〜0.6", () => {
      const s = seedOf("REGION-A1");
      let sum = 0;
      for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) sum += hash2(x, y, s);
      const mean = sum / 10000;
      expect(mean).toBeGreaterThan(0.4);
      expect(mean).toBeLessThan(0.6);
    });
  });

  describe("valueNoise", () => {
    it("格子点（x・y が cell の整数倍）では hash2 と一致する", () => {
      const cell = 8;
      const s = 42;
      for (let gy = -3; gy <= 3; gy++)
        for (let gx = -3; gx <= 3; gx++)
          expect(valueNoise(gx * cell, gy * cell, cell, s)).toBe(hash2(gx, gy, s));
    });

    it("格子の辺の上では、両端の値の間に入る（補間）", () => {
      const cell = 8;
      const s = 42;
      for (let i = 0; i < 20; i++) {
        const gx = i - 10;
        const gy = 2 * i - 15;
        const a = hash2(gx, gy, s);
        const b = hash2(gx + 1, gy, s);
        for (const f of [0.1, 0.25, 0.5, 0.9]) {
          const v = valueNoise((gx + f) * cell, gy * cell, cell, s);
          expect(v).toBeGreaterThanOrEqual(Math.min(a, b) - 1e-12);
          expect(v).toBeLessThanOrEqual(Math.max(a, b) + 1e-12);
        }
      }
    });

    it("格子の内側でも、4つの格子点の値の間に入り、0 以上 1 未満", () => {
      const cell = 16;
      const s = 7;
      const rnd = lcg(5);
      for (let i = 0; i < 2000; i++) {
        const x = (rnd() - 0.5) * 1000;
        const y = (rnd() - 0.5) * 1000;
        const gx = Math.floor(x / cell);
        const gy = Math.floor(y / cell);
        const corners = [
          hash2(gx, gy, s),
          hash2(gx + 1, gy, s),
          hash2(gx, gy + 1, s),
          hash2(gx + 1, gy + 1, s),
        ];
        const v = valueNoise(x, y, cell, s);
        expect(v).toBeGreaterThanOrEqual(Math.min(...corners) - 1e-12);
        expect(v).toBeLessThanOrEqual(Math.max(...corners) + 1e-12);
        expect(v >= 0 && v < 1).toBe(true);
      }
    });

    it("負の座標・負の格子の間隔でも、0 以上 1 未満の有限の値", () => {
      for (const [x, y, cell] of [
        [-5, -9, 8],
        [-12345, 678, 24],
        [7, 7, -8],
        [-3.5, 2.25, -16],
      ] as const) {
        const v = valueNoise(x, y, cell, 3);
        expect(Number.isFinite(v)).toBe(true);
        expect(v >= 0 && v < 1).toBe(true);
      }
    });

    it("cell が 0 でも例外を投げない", () => {
      expect(() => valueNoise(5, 3, 0, 1)).not.toThrow();
    });

    // 仕様未定義の入力（前提違反）。現状は NaN を返す（src/world/hash.ts の valueNoise）。
    it("cell が 0 のとき、0 以上 1 未満の有限の値を返す（現状は NaN：報告対象）", () => {
      const v = valueNoise(5, 3, 0, 1);
      expect(Number.isFinite(v)).toBe(true);
      expect(v >= 0 && v < 1).toBe(true);
    });

    it("偏りが極端でない：大きな範囲の平均が 0.4〜0.6", () => {
      const s = seedOf("REGION-A5");
      let sum = 0;
      let n = 0;
      for (let y = 0; y < 200; y += 3)
        for (let x = 0; x < 200; x += 3) {
          sum += valueNoise(x, y, 56, s);
          n++;
        }
      const mean = sum / n;
      expect(mean).toBeGreaterThan(0.4);
      expect(mean).toBeLessThan(0.6);
    });
  });
});

// =====================================================================
// ground-theme.ts
// =====================================================================

describe("地面の主題 ground-theme.ts", () => {
  it("実データの全ての地域の主題：町は町、ボスのいる地域はボスの間、他のダンジョンは森", () => {
    const actual = Object.fromEntries(
      [...db.regions.values()].map((r) => [r.id, groundThemeOf(r, isBoss).kind]),
    );
    expect(actual).toEqual({
      "REGION-TOWN": "town",
      "REGION-A1": "forest",
      "REGION-A2": "forest",
      "REGION-A3": "forest",
      "REGION-A4": "forest",
      "REGION-A4-BOSS": "boss",
      "REGION-A5": "forest",
      "REGION-A5-BOSS": "boss",
    });
  });

  it("ボスかどうかは敵のデータ（isBoss）で決まる：ボスの敵を「ボスでない」と答えると森になる", () => {
    expect(groundThemeOf(regionOf("REGION-A5-BOSS"), () => false).kind).toBe("forest");
  });

  it("region が undefined（試験用の場）は開発用：腐り 0・開発用の色・種は DEV-ARENA から", () => {
    const t = groundThemeOf(undefined, isBoss);
    expect(t.kind).toBe("dev");
    expect(t.rot).toBe(0);
    expect(t.palette).toEqual(GROUND_PALETTES.dev);
    expect(t.seed).toBe(seedOf("DEV-ARENA"));
  });

  it("町の腐り具合は 0、色は町の色", () => {
    const t = groundThemeOf(regionOf("REGION-TOWN"), isBoss);
    expect(t.rot).toBe(0);
    expect(t.palette).toEqual(GROUND_PALETTES.town);
  });

  it("地域の種（seed）は地域のIDから決まり、同じ地域はいつも同じ", () => {
    const r = regionOf("REGION-A3");
    expect(groundThemeOf(r, isBoss).seed).toBe(seedOf("REGION-A3"));
    expect(groundThemeOf(r, isBoss).seed).toBe(groundThemeOf(r, isBoss).seed);
  });

  it("ダンジョンの腐り具合は 0〜1 で、A1 < A2 < A3 < A4 < A5 の順に増える", () => {
    const ids = ["REGION-A1", "REGION-A2", "REGION-A3", "REGION-A4", "REGION-A5"];
    const rots = ids.map((id) => rotOf(regionOf(id)));
    for (const v of rots) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    for (let i = 1; i < rots.length; i++) expect(rots[i - 1]).toBeLessThan(rots[i] ?? 0);
  });

  it("ボスの間・森の色は、腐り具合で新しい色と腐った色を混ぜたもの", () => {
    for (const t of [A5_BOSS_THEME, A5_THEME, A1_THEME]) {
      const fresh = t.kind === "boss" ? GROUND_PALETTES.bossFresh : GROUND_PALETTES.forestFresh;
      const rotten = t.kind === "boss" ? GROUND_PALETTES.bossRotten : GROUND_PALETTES.forestRotten;
      expect(t.palette).toEqual(lerpPalette(fresh, rotten, t.rot));
    }
  });

  describe("rotOf", () => {
    it("Lv の情報が無ければ 0", () => {
      expect(rotOf({ id: "X", kind: "dungeon" })).toBe(0);
    });

    it("区画の Lv（min と max の平均）で決まる：平均 10.5 は 0.5", () => {
      expect(
        rotOf({ id: "X", kind: "dungeon", sections: [{ levels: { min: 10, max: 11 } }] }),
      ).toBeCloseTo(0.5);
    });

    it("Lv が ROT_LEVEL_RANGE の下限（1）以下なら 0、上限（20）以上なら 1（範囲の外も 0〜1 に収める）", () => {
      expect(rotOf({ id: "X", kind: "dungeon", sections: [{ levels: { min: 1, max: 1 } }] })).toBe(
        0,
      );
      expect(
        rotOf({ id: "X", kind: "dungeon", sections: [{ levels: { min: 20, max: 20 } }] }),
      ).toBe(1);
      expect(rotOf({ id: "X", kind: "dungeon", fixedEnemies: [{ enemy: "E", level: 100 }] })).toBe(
        1,
      );
      expect(rotOf({ id: "X", kind: "dungeon", fixedEnemies: [{ enemy: "E", level: 0 }] })).toBe(0);
    });
  });

  describe("lerpColor", () => {
    it("t=0 で始めの色、t=1 で終わりの色", () => {
      expect(lerpColor(0x102030, 0xabcdef, 0)).toBe(0x102030);
      expect(lerpColor(0x102030, 0xabcdef, 1)).toBe(0xabcdef);
    });

    it("t=0.5 で各チャンネルの中間（成分ごとに丸める）", () => {
      expect(lerpColor(0x000000, 0xffffff, 0.5)).toBe(0x808080);
      expect(lerpColor(0x102030, 0x304050, 0.5)).toBe(0x203040);
    });

    it("t が範囲外（-1・2）なら、端の色に収まる", () => {
      expect(lerpColor(0x123456, 0xabcdef, -1)).toBe(0x123456);
      expect(lerpColor(0x123456, 0xabcdef, 2)).toBe(0xabcdef);
    });

    it("t が範囲外・NaN でも、0〜0xffffff の整数を返す", () => {
      for (const t of [-1, 2, NaN, Infinity, -Infinity, 0.3]) {
        const c = lerpColor(0x0a0b0c, 0xf0e0d0, t);
        expect(Number.isInteger(c)).toBe(true);
        expect(c >= 0 && c <= 0xffffff).toBe(true);
      }
    });
  });

  describe("lerpPalette", () => {
    it("全ての色のキーが残る", () => {
      const p = lerpPalette(GROUND_PALETTES.forestFresh, GROUND_PALETTES.forestRotten, 0.5);
      expect(Object.keys(p).sort()).toEqual(Object.keys(GROUND_PALETTES.forestFresh).sort());
    });

    it("t=0 は始めの組、t=1 は終わりの組、t=0.5 は各色の中間", () => {
      const a = GROUND_PALETTES.bossFresh;
      const b = GROUND_PALETTES.bossRotten;
      expect(lerpPalette(a, b, 0)).toEqual(a);
      expect(lerpPalette(a, b, 1)).toEqual(b);
      const mid = lerpPalette(a, b, 0.5);
      expect(mid.base).toBe(lerpColor(a.base, b.base, 0.5));
      expect(mid.accent).toBe(lerpColor(a.accent, b.accent, 0.5));
    });
  });
});

// =====================================================================
// ground-plan.ts
// =====================================================================

describe("地面の設計 ground-plan.ts", () => {
  it.each(layoutCases)(
    "%s：命令が空でなく、全ての値が正しく、地域の中に重なる",
    (_name, theme, layout) => {
      const ops = planGround(theme, layout);
      expect(ops.length).toBeGreaterThan(0);
      expect(opViolations(ops, layout.width, layout.height)).toEqual([]);
    },
  );

  it.each(layoutCases)("%s：同じ入力なら同じ出力", (_name, theme, layout) => {
    expect(planGround(theme, layout)).toEqual(planGround(theme, layout));
  });

  it.each(layoutCases)("%s：大きさ 0 の地域でも例外を投げず、配列を返す", (_name, theme) => {
    expect(() => planGround(theme, { width: 0, height: 0 })).not.toThrow();
    expect(Array.isArray(planGround(theme, { width: 0, height: 0 }))).toBe(true);
  });

  it("とても大きい地域（400m×200m）でも例外にならず、命令を返す", () => {
    const ops = planGround(A5_THEME, { width: 400, height: 200 });
    expect(ops.length).toBeGreaterThan(0);
    expect(opViolations(ops, 400, 200)).toEqual([]);
  });

  it("試験用の場は、5mごとの線を足す（格子の線の色は土の色）", () => {
    const ops = planGround(DEV_THEME, { width: 80, height: 40 });
    const lines = ops.filter((op) => op.t === "rect" && op.color === GROUND_PALETTES.dev.soil);
    expect(lines.length).toBeGreaterThan(0);
  });

  // 性能の目安：「数万」を超えると、描く命令の数（メモリ・初回の描画時間）が大きい。超えるなら報告。
  it("1地域の命令は 5万未満（数万の目安。超えるなら性能の懸念として報告）", () => {
    const counts = Object.fromEntries(
      [...db.regions.values()].map((r) => {
        const theme = groundThemeOf(r, isBoss);
        return [r.id, planGround(theme, layoutOf(r)).length];
      }),
    );
    const max = Math.max(...Object.values(counts));
    expect(max, JSON.stringify(counts)).toBeLessThan(50000);
  });
});

// =====================================================================
// look-tables.ts
// =====================================================================

describe("世界の見た目の表 look-tables.ts", () => {
  it("ENEMY_LOOKS がコンテンツの全ての敵を網羅し、表にだけ在る ID が無い", () => {
    expect(Object.keys(ENEMY_LOOKS).sort()).toEqual([...db.enemies.keys()].sort());
  });

  it("JOB_LOOKS が全てのジョブ（6つ）を網羅する", () => {
    expect(Object.keys(JOB_LOOKS).sort()).toEqual([...db.jobs.keys()].sort());
    expect(Object.keys(JOB_LOOKS)).toHaveLength(6);
  });

  it("FACILITY_LOOKS が core の FACILITIES を網羅する", () => {
    expect(Object.keys(FACILITY_LOOKS).sort()).toEqual([...FACILITIES].sort());
  });

  it("GROUND_PALETTES が全ての主題（dev・town・森と boss の新旧）を持つ", () => {
    expect(Object.keys(GROUND_PALETTES).sort()).toEqual(
      ["bossFresh", "bossRotten", "dev", "forestFresh", "forestRotten", "town"].sort(),
    );
  });

  it("enemyLook：表に在る敵はその姿、表に無い ID は既定の灰色の丸（例外を投げない）", () => {
    expect(enemyLook("ENM-FOREST-WOLF").shape).toBe("wolf");
    expect(enemyLook("ENM-NO-SUCH-ENEMY")).toBe(FALLBACK_ENEMY_LOOK);
    expect(FALLBACK_ENEMY_LOOK.shape).toBe("blob");
  });

  // 現状：ENEMY_LOOKS[id] が Object の継承プロパティ（constructor など）を拾う（src/world/look-tables.ts）。
  it("enemyLook：Object の継承プロパティ名（constructor）でも既定の姿（報告対象）", () => {
    expect(enemyLook("constructor")).toBe(FALLBACK_ENEMY_LOOK);
  });

  describe("enemyBodySize", () => {
    it("半径×32 を丸めた値（直径＝半径×2×16ピクセル）", () => {
      expect(enemyBodySize(0.4)).toBe(13);
      expect(enemyBodySize(0.8)).toBe(26);
      expect(enemyBodySize(1.5)).toBe(48);
    });

    it("最小は 6 ピクセル（半径 0・負のとき）", () => {
      expect(enemyBodySize(0)).toBe(6);
      expect(enemyBodySize(-1)).toBe(6);
      expect(enemyBodySize(0.05)).toBe(6);
    });

    // 現状：Math.max(6, NaN) が NaN を返す（src/world/look-tables.ts）。
    it("半径が NaN でも、6 以上の有限の値（報告対象）", () => {
      const v = enemyBodySize(NaN);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(6);
    });
  });

  it("色の値は全て 0〜0xffffff の整数（敵・ジョブ・施設・場の物・ドロップ・地面）", () => {
    const colors = [
      ...numbersIn(ENEMY_LOOKS),
      ...numbersIn(FALLBACK_ENEMY_LOOK),
      ...numbersIn(JOB_LOOKS),
      ...numbersIn(DEFAULT_JOB_LOOK),
      ...Object.values(FACILITY_LOOKS).flatMap((f) => [f.main, f.dark, f.accent]),
      ...numbersIn(PROP_COLORS),
      ...numbersIn(LOOT_COLORS),
      ...numbersIn(GROUND_PALETTES),
    ];
    expect(colors.length).toBeGreaterThan(100);
    const bad = colors.filter((c) => !Number.isInteger(c) || c < 0 || c > 0xffffff);
    expect(bad).toEqual([]);
  });
});

// =====================================================================
// placeholders.ts（キーを返す関数）
// =====================================================================

describe("仮素材のキー placeholders.ts", () => {
  const jobIds = [...db.jobs.keys()];
  const enemyIds = [...db.enemies.keys()];
  const facilityKinds = [...FACILITIES];

  it("ジョブごとのキーは、違うジョブで違い、同じジョブでは同じ", () => {
    const keys = jobIds.map(playerTexture);
    expect(new Set(keys).size).toBe(jobIds.length);
    expect(playerTexture("JOB-MAGE")).toBe(playerTexture("JOB-MAGE"));
    expect(playerTexture("JOB-WARRIOR")).toBe("chr/player/job-warrior/body");
  });

  it("表に無いジョブは既定のキー chr/player/body", () => {
    expect(playerTexture("JOB-NO-SUCH")).toBe("chr/player/body");
    expect(playerTexture("")).toBe("chr/player/body");
  });

  // 現状：`jobId in JOB_LOOKS` が継承プロパティ（constructor など）を真と判定する（src/world/placeholders.ts）。
  it("表に無いジョブ名が Object の継承プロパティ（constructor・toString）でも既定のキー（報告対象）", () => {
    expect(playerTexture("constructor")).toBe("chr/player/body");
    expect(playerTexture("toString")).toBe("chr/player/body");
  });

  it("敵のキーは、違う敵で違う", () => {
    const keys = enemyIds.map(enemyTexture);
    expect(new Set(keys).size).toBe(enemyIds.length);
    expect(enemyTexture("ENM-FOREST-WOLF")).toBe(enemyTexture("ENM-FOREST-WOLF"));
  });

  it("施設・宝箱・転移の石のキーは、違う入力で違う", () => {
    const facility = facilityKinds.map(facilityTexture);
    expect(new Set(facility).size).toBe(facilityKinds.length);
    const chests = [
      chestTexture("woodChest", false),
      chestTexture("woodChest", true),
      chestTexture("oldChest", false),
      chestTexture("oldChest", true),
    ];
    expect(new Set(chests).size).toBe(4);
    expect(chestTexture("oldChest", true)).toBe("prop/chest/old/open");
    expect(stoneTexture(true)).not.toBe(stoneTexture(false));
    expect(stoneTexture(true)).toBe("prop/stone/lit");
  });

  it("全てのキー（固定のキーと関数のキー）が重ならない", () => {
    const all = [
      ...Object.values(TEXTURES),
      ...jobIds.map(playerTexture),
      ...enemyIds.map(enemyTexture),
      ...facilityKinds.map(facilityTexture),
      chestTexture("woodChest", false),
      chestTexture("woodChest", true),
      chestTexture("oldChest", false),
      chestTexture("oldChest", true),
      stoneTexture(false),
      stoneTexture(true),
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it("既存のキー（HEAD~1 の版の文字列）が今も全て残っている", () => {
    expect(TEXTURES.player).toBe("chr/player/body");
    expect(TEXTURES.facing).toBe("chr/player/facing");
    expect(TEXTURES.floor).toBe("tile/floor");
    expect(TEXTURES.dummy).toBe("enemy/dummy/body");
    expect(TEXTURES.projectile).toBe("fx/projectile/test");
    expect(enemyTexture("ENM-FOREST-WOLF")).toBe("enemy/enm-forest-wolf/body");
  });
});

// =====================================================================
// prop-plan.ts（場の物の計算）
// =====================================================================

describe("場の物の計算 prop-plan.ts", () => {
  /** 地域の出口（行き先の ID で探す）。 */
  function exitOf(regionId: string, to: string) {
    const x = (regionOf(regionId).exits ?? []).find((e) => e.to === to);
    if (x === undefined) throw new Error(`出口が無い: ${regionId} → ${to}`);
    return x.rect;
  }

  describe("exitDirection", () => {
    it("実データ：町の出口は右、A1 の町側の出口は左、A1 の A2 側は右", () => {
      expect(exitDirection(exitOf("REGION-TOWN", "REGION-A1"), regionOf("REGION-TOWN").size)).toBe(
        "right",
      );
      expect(exitDirection(exitOf("REGION-A1", "REGION-TOWN"), regionOf("REGION-A1").size)).toBe(
        "left",
      );
      expect(exitDirection(exitOf("REGION-A1", "REGION-A2"), regionOf("REGION-A1").size)).toBe(
        "right",
      );
    });

    it("実データの全ての出口は、接している地域の端の向きになる（一つの端に接している）", () => {
      for (const r of db.regions.values())
        for (const e of r.exits ?? []) {
          const { x, y, width, height } = e.rect;
          const edge =
            x <= 0
              ? "left"
              : x + width >= r.size.width
                ? "right"
                : y <= 0
                  ? "up"
                  : y + height >= r.size.height
                    ? "down"
                    : undefined;
          expect(edge, `${r.id} → ${e.to}`).toBeDefined();
          expect(exitDirection(e.rect, r.size), `${r.id} → ${e.to}`).toBe(edge);
        }
    });

    it("地域の真ん中の小さな出口は、一番近い端の向き（上が20m・下が28m なら上）", () => {
      const size = { width: 100, height: 50 };
      expect(exitDirection({ x: 40, y: 20, width: 2, height: 2 }, size)).toBe("up");
      expect(exitDirection({ x: 10, y: 30, width: 2, height: 2 }, size)).toBe("left");
    });

    it("地域の真ん中で、どの端からも同じ距離なら、4つのどれか（仕様確認：現状は左を優先）", () => {
      expect(["left", "right", "up", "down"]).toContain(
        exitDirection({ x: 4, y: 4, width: 2, height: 2 }, { width: 10, height: 10 }),
      );
    });

    it("地域より大きい出口でも例外を投げず、4つのどれか", () => {
      const d = exitDirection(
        { x: -5, y: -5, width: 200, height: 200 },
        { width: 100, height: 50 },
      );
      expect(["left", "right", "up", "down"]).toContain(d);
    });
  });

  describe("pulse", () => {
    it("0〜1 の範囲に収まる（負の時刻・周期が負・位相付きでも）", () => {
      for (const period of [1000, 2200, -1000])
        for (let t = -5000; t <= 5000; t += 137)
          for (const phase of [0, 0.25, 0.5, 0.9]) {
            const v = pulse(t, period, phase);
            expect(Number.isFinite(v)).toBe(true);
            expect(v >= 0 && v <= 1).toBe(true);
          }
    });

    it("周期で繰り返す", () => {
      for (const t of [0, 123, 987, 4321])
        expect(pulse(t, 900)).toBeCloseTo(pulse(t + 900, 900), 9);
    });

    it("位相 0 で 0、半周期で 1、位相 0.5 では 1", () => {
      expect(pulse(0, 1000)).toBeCloseTo(0, 9);
      expect(pulse(500, 1000)).toBeCloseTo(1, 9);
      expect(pulse(0, 1000, 0.5)).toBeCloseTo(1, 9);
    });

    // 現状：周期が 0 だと (now/0 + phase) % 1 が NaN になり、NaN を返す（src/world/prop-plan.ts）。
    it("周期が 0 のとき、0〜1 の有限の値（報告対象）", () => {
      const v = pulse(100, 0);
      expect(Number.isFinite(v)).toBe(true);
      expect(v >= 0 && v <= 1).toBe(true);
    });

    // 現状：周期が NaN だと NaN を返す。
    it("周期が NaN のとき、0〜1 の有限の値（報告対象）", () => {
      const v = pulse(100, NaN);
      expect(Number.isFinite(v)).toBe(true);
      expect(v >= 0 && v <= 1).toBe(true);
    });
  });
});

// =====================================================================
// depth.ts
// =====================================================================

describe("深さ depth.ts", () => {
  it("地面 < 出口 < 場の物の下の光 < 場の物（コメントの重なりの順）", () => {
    expect(WORLD_DEPTH.floor).toBeLessThan(WORLD_DEPTH.ground);
    expect(WORLD_DEPTH.ground).toBeLessThan(WORLD_DEPTH.exit);
    expect(WORLD_DEPTH.exit).toBeLessThan(WORLD_DEPTH.propGlow);
    expect(WORLD_DEPTH.propGlow).toBeLessThan(WORLD_DEPTH.prop);
  });

  it("地面・場の物は、予兆・体（深さ0。ArenaScene の fx と敵・プレイヤー）より奥", () => {
    for (const d of Object.values(WORLD_DEPTH)) expect(d).toBeLessThan(0);
  });

  it("全ての深さは HUD（900 以上。ArenaScene）より手前", () => {
    const HUD_MIN = 900;
    for (const d of Object.values(WORLD_DEPTH)) expect(d).toBeLessThan(HUD_MIN);
  });
});
