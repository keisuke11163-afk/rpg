/**
 * 戦闘画面の小さな地図（補助仕様書16章）。地域の全体を縮めて、自分・敵・ボス・宝箱・出口・転移の石・施設を点で示す。
 * Phaser に依存しない（印の計算をテストで確かめる。描くのは ArenaScene）。
 */

/** 小さな地図の位置（画面のピクセル。内部解像度 640×360 の右下。左上は文字の表示、左下はHPなどの棒）。 */
export const MINIMAP = { x: 640 - 8 - 96, y: 360 - 8 - 64, width: 96, height: 64 } as const;

export type MinimapMarkKind =
  "player" | "enemy" | "elite" | "boss" | "chest" | "exit" | "exitClosed" | "stone" | "facility";

export interface MinimapMark {
  readonly kind: MinimapMarkKind;
  /** 画面のピクセル（地図の枠の中）。 */
  readonly x: number;
  readonly y: number;
}

export interface MinimapInput {
  readonly size: { readonly width: number; readonly height: number };
  readonly player: { readonly x: number; readonly y: number };
  readonly enemies: readonly {
    readonly x: number;
    readonly y: number;
    readonly boss: boolean;
    readonly elite: boolean;
  }[];
  readonly chests: readonly { readonly x: number; readonly y: number }[];
  readonly exits: readonly { readonly x: number; readonly y: number; readonly open: boolean }[];
  readonly stone?: { readonly x: number; readonly y: number } | undefined;
  readonly facilities: readonly { readonly x: number; readonly y: number }[];
}

/** 地域の縦横の比を保ったまま枠に収める倍率と、枠の中の余白。 */
export function minimapScale(size: MinimapInput["size"]): { k: number; ox: number; oy: number } {
  const k = Math.min(MINIMAP.width / size.width, MINIMAP.height / size.height);
  return {
    k,
    ox: MINIMAP.x + (MINIMAP.width - size.width * k) / 2,
    oy: MINIMAP.y + (MINIMAP.height - size.height * k) / 2,
  };
}

/** 地図の印（描く順：施設・出口・宝箱・敵・ボス・自分）。地域の外の点は枠に収める。 */
export function minimapMarks(input: MinimapInput): MinimapMark[] {
  const { k, ox, oy } = minimapScale(input.size);
  const at = (kind: MinimapMarkKind, p: { x: number; y: number }): MinimapMark => ({
    kind,
    x: ox + Math.min(input.size.width, Math.max(0, p.x)) * k,
    y: oy + Math.min(input.size.height, Math.max(0, p.y)) * k,
  });
  const marks: MinimapMark[] = [];
  for (const f of input.facilities) marks.push(at("facility", f));
  for (const e of input.exits) marks.push(at(e.open ? "exit" : "exitClosed", e));
  if (input.stone !== undefined) marks.push(at("stone", input.stone));
  for (const c of input.chests) marks.push(at("chest", c));
  for (const e of input.enemies) if (!e.boss) marks.push(at(e.elite ? "elite" : "enemy", e));
  for (const e of input.enemies) if (e.boss) marks.push(at("boss", e));
  marks.push(at("player", input.player));
  return marks;
}
