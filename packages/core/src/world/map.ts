/**
 * 固定のマップ（補助仕様書 9.1）。地形は手作りで固定し、群れ・精鋭・宝箱の「出現地点の候補」を置く。
 * 入るたびに、候補から配置を抽選する（region.ts）。
 */
import type { Vec2 } from "../player/controller.ts";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 区画：敵のLvと、群れの中身（敵の一覧）が決まっている（補助仕様書 9.1・9.2） */
export interface Section {
  id: string;
  /** 区画の範囲（x方向。マップは左から右へ進む） */
  xMin: number;
  xMax: number;
  levelMin: number;
  levelMax: number;
  /** 群れの中身は、この一覧から抽選する（敵の定義のID） */
  enemies: readonly string[];
}

export interface Exit {
  pos: Vec2;
  radius: number;
  /** 行き先：町のID、または次の地域のID */
  to: string;
}

export interface MapDef {
  id: string;
  name: string;
  width: number;
  height: number;
  walls: readonly Rect[];
  /** 地域に入ったときの出現位置 */
  entrance: Vec2;
  /** 転移の石（入口にある。触れると解放される） */
  teleportStone: Vec2 | undefined;
  exits: readonly Exit[];
  sections: readonly Section[];
  packSpawns: readonly Vec2[];
  eliteSpawns: readonly Vec2[];
  crateSpots: readonly Vec2[];
  chestSpots: readonly Vec2[];
  /** 中ボス・章ボス（地域の終点）。毎回その場所に出る（抽選しない） */
  boss?: { enemyId: string; pos: Vec2; level: number };
  /** 隠し部屋：壁の「怪しい茂み」を調べる（F）と、扉の壁が消えて中の宝箱を取れる。隠し星も得る（補助仕様書 9.5） */
  secret?: { bush: Vec2; door: Rect; chest: Vec2 };
  /** この地域に入る条件：この初回討伐を済ませていること（A5は母樹の初回撃破の後） */
  requires?: string;
  /** 魔法の敵になる確率（群れごと。A5は15%） */
  magicChance: number;
  /** 精鋭の出現数の範囲（出現地点のうち有効になる数ではなく、出現地点の数。A5は4〜6） */
  eliteSpotCount: readonly [number, number];
}

/** 円と壁（矩形）の衝突。押し戻した位置を返す */
export function resolveWalls(
  pos: Vec2,
  radius: number,
  walls: readonly Rect[],
  size?: { width: number; height: number },
): Vec2 {
  let { x, y } = pos;
  for (const w of walls) {
    const cx = Math.max(w.x, Math.min(x, w.x + w.w));
    const cy = Math.max(w.y, Math.min(y, w.y + w.h));
    const dx = x - cx;
    const dy = y - cy;
    const d = Math.hypot(dx, dy);
    if (d >= radius) continue;
    if (d > 1e-9) {
      x = cx + (dx / d) * radius;
      y = cy + (dy / d) * radius;
    } else {
      // 壁の中心にいる：最も近い辺の外へ出す
      const left = x - w.x;
      const right = w.x + w.w - x;
      const top = y - w.y;
      const bottom = w.y + w.h - y;
      const m = Math.min(left, right, top, bottom);
      if (m === left) x = w.x - radius;
      else if (m === right) x = w.x + w.w + radius;
      else if (m === top) y = w.y - radius;
      else y = w.y + w.h + radius;
    }
  }
  if (size) {
    x = Math.max(radius, Math.min(size.width - radius, x));
    y = Math.max(radius, Math.min(size.height - radius, y));
  }
  return { x, y };
}

/** 点が壁の中か */
export function insideWall(p: Vec2, walls: readonly Rect[], margin = 0): boolean {
  return walls.some(
    (w) =>
      p.x > w.x - margin &&
      p.x < w.x + w.w + margin &&
      p.y > w.y - margin &&
      p.y < w.y + w.h + margin,
  );
}

export function sectionAt(map: MapDef, x: number): Section | undefined {
  return (
    map.sections.find((s) => x >= s.xMin && x < s.xMax) ?? map.sections[map.sections.length - 1]
  );
}
