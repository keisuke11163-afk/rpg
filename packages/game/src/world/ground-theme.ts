/**
 * 地面の主題（地域 → 地面の種類・腐り具合・色の組）。Phaser に依存しない（テストできる）。
 * 地域のデータ（region.kind・区画の敵のLv・決まった敵がボスか）だけから決め、IDの表は持たない。
 */
import { GROUND_PALETTES, type GroundPalette, ROT_LEVEL_RANGE } from "./look-tables.ts";
import { seedOf } from "./hash.ts";

/** 地面の種類：試験用の場・町・森（ダンジョン）・ボスの間。 */
export type GroundKind = "dev" | "town" | "forest" | "boss";

/** 地面の主題。 */
export interface GroundTheme {
  readonly kind: GroundKind;
  /** 腐り具合（0＝新しい森〔A1〕〜1＝深く腐った森〔A5・深淵〕）。町・試験用の場は0。 */
  readonly rot: number;
  readonly palette: GroundPalette;
  /** 模様の種（地域のIDから。同じ地域はいつも同じ模様）。 */
  readonly seed: number;
}

/** 主題を決めるのに使う、地域のデータの一部（core の RegionDef の部分集合）。 */
export interface ThemeRegion {
  readonly id: string;
  readonly kind: "town" | "dungeon";
  readonly sections?:
    readonly { readonly levels: { readonly min: number; readonly max: number } }[] | undefined;
  readonly fixedEnemies?: readonly { readonly enemy: string; readonly level: number }[] | undefined;
}

/** 2つの色（0xRRGGBB）を t（0〜1）で混ぜる。成分ごとに丸める。 */
export function lerpColor(a: number, b: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  const ch = (shift: number): number => {
    const x = (a >> shift) & 0xff;
    const y = (b >> shift) & 0xff;
    return Math.round(x + (y - x) * k) << shift;
  };
  return ch(16) | ch(8) | ch(0);
}

/** 色の組を t で混ぜる。 */
export function lerpPalette(a: GroundPalette, b: GroundPalette, t: number): GroundPalette {
  return {
    base: lerpColor(a.base, b.base, t),
    dark: lerpColor(a.dark, b.dark, t),
    light: lerpColor(a.light, b.light, t),
    soil: lerpColor(a.soil, b.soil, t),
    detail: lerpColor(a.detail, b.detail, t),
    detail2: lerpColor(a.detail2, b.detail2, t),
    root: lerpColor(a.root, b.root, t),
    accent: lerpColor(a.accent, b.accent, t),
    edge: lerpColor(a.edge, b.edge, t),
    outside: lerpColor(a.outside, b.outside, t),
  };
}

/**
 * 腐り具合（0〜1）：区画の敵のLv（min と max の平均）の平均と、決まった敵のLvから。
 * Lv が ROT_LEVEL_RANGE.min 以下なら0、max 以上なら1。Lv の情報が無ければ0。
 */
export function rotOf(region: ThemeRegion): number {
  const levels: number[] = [];
  for (const s of region.sections ?? []) levels.push((s.levels.min + s.levels.max) / 2);
  for (const f of region.fixedEnemies ?? []) levels.push(f.level);
  if (levels.length === 0) return 0;
  const avg = levels.reduce((a, b) => a + b, 0) / levels.length;
  const t = (avg - ROT_LEVEL_RANGE.min) / (ROT_LEVEL_RANGE.max - ROT_LEVEL_RANGE.min);
  return Math.min(1, Math.max(0, t));
}

/**
 * 地域の地面の主題。region が undefined なら試験用の場（開発用）。
 * ダンジョンのうち、決まった敵にボス（isBoss）がいる地域はボスの間、それ以外は森。
 */
export function groundThemeOf(
  region: ThemeRegion | undefined,
  isBoss: (enemyId: string) => boolean,
): GroundTheme {
  if (region === undefined)
    return { kind: "dev", rot: 0, palette: GROUND_PALETTES.dev, seed: seedOf("DEV-ARENA") };
  const seed = seedOf(region.id);
  if (region.kind === "town") return { kind: "town", rot: 0, palette: GROUND_PALETTES.town, seed };
  const rot = rotOf(region);
  const boss = (region.fixedEnemies ?? []).some((f) => isBoss(f.enemy));
  return boss
    ? {
        kind: "boss",
        rot,
        palette: lerpPalette(GROUND_PALETTES.bossFresh, GROUND_PALETTES.bossRotten, rot),
        seed,
      }
    : {
        kind: "forest",
        rot,
        palette: lerpPalette(GROUND_PALETTES.forestFresh, GROUND_PALETTES.forestRotten, rot),
        seed,
      };
}
