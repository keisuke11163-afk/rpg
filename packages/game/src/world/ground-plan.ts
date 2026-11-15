/**
 * 地面の絵の設計（四角と円の描く命令の列）。Phaser に依存しない（テストできる）。
 * GroundView が、この命令を Canvas に1回だけ描いてテクスチャにする（毎フレーム描き直さない）。
 * 模様の配置は座標からのハッシュ（hash.ts）だけで決める。同じ地域はいつも同じ絵。
 *
 * 模様は控えめにする：地の色との差は小さく、細かい点は少なく。赤い予兆・敵・ドロップを埋もれさせない。
 */
import { hash2, valueNoise } from "./hash.ts";
import { type GroundTheme, lerpColor } from "./ground-theme.ts";
import { PIXELS_PER_METER } from "./units.ts";

/** 描く命令（ピクセル。地域の左上が原点）。 */
export type GroundOp =
  | {
      readonly t: "rect";
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
      readonly color: number;
      readonly alpha: number;
    }
  | {
      readonly t: "disc";
      readonly x: number;
      readonly y: number;
      readonly r: number;
      readonly color: number;
      readonly alpha: number;
    };

interface Point {
  readonly x: number;
  readonly y: number;
}
interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 地面の設計に使う、地域の配置（m）。 */
export interface GroundLayout {
  /** 広さ（m）。 */
  readonly width: number;
  readonly height: number;
  readonly entrance?: Point;
  readonly facilities?: readonly Point[];
  readonly exits?: readonly Rect[];
  /**
   * 歩ける範囲の内側への幅（m）。sim はプレイヤーを地域の端から 0.5m 内側に留める
   * （arena-simulation.ts の bounds）。この幅を「端の外」として暗くする。
   */
  readonly inset?: number;
}

/** 歩ける範囲の内側への幅の初期値（m。sim の bounds と同じ）。 */
export const DEFAULT_INSET = 0.5;
/** まだら（色の違うかたまり）を塗る小さな升の1辺（ピクセル）。 */
const SUB = 4;
/** 町の石畳の石の1辺（ピクセル）。 */
const STONE = 8;
const CELL = PIXELS_PER_METER;

/** 命令を集める入れ物（地域の外に出る命令は捨てる）。 */
class Ops {
  readonly list: GroundOp[] = [];
  private readonly width: number;
  private readonly height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
  rect(x: number, y: number, w: number, h: number, color: number, alpha = 1): void {
    const rx = Math.round(x);
    const ry = Math.round(y);
    if (w <= 0 || h <= 0) return;
    if (rx + w <= 0 || ry + h <= 0 || rx >= this.width || ry >= this.height) return;
    this.list.push({ t: "rect", x: rx, y: ry, w, h, color, alpha });
  }
  disc(x: number, y: number, r: number, color: number, alpha = 1): void {
    const rx = Math.round(x);
    const ry = Math.round(y);
    if (r <= 0) return;
    if (rx + r <= 0 || ry + r <= 0 || rx - r >= this.width || ry - r >= this.height) return;
    this.list.push({ t: "disc", x: rx, y: ry, r, color, alpha });
  }
}

/** 点（ピクセル）が、出口の四角（m）を margin ピクセル広げた範囲に入るか。 */
function nearExit(x: number, y: number, exits: readonly Rect[], margin: number): boolean {
  return exits.some(
    (e) =>
      x >= e.x * CELL - margin &&
      x <= (e.x + e.width) * CELL + margin &&
      y >= e.y * CELL - margin &&
      y <= (e.y + e.height) * CELL + margin,
  );
}

/**
 * 地面の絵の設計。主題（町・森・ボスの間・試験用の場）ごとに、地の色・まだら・細かい模様・端を描く。
 * 試験用の場（dev）は、下に元の格子のタイル（tile/floor）を敷く前提で、地の色を塗らない。
 */
export function planGround(theme: GroundTheme, layout: GroundLayout): GroundOp[] {
  const w = Math.round(layout.width * CELL);
  const h = Math.round(layout.height * CELL);
  const ops = new Ops(w, h);
  switch (theme.kind) {
    case "dev":
      planDev(ops, theme, w, h);
      break;
    case "town":
      planTown(ops, theme, layout, w, h);
      break;
    case "forest":
      planForest(ops, theme, layout, w, h);
      break;
    case "boss":
      planBoss(ops, theme, w, h);
      break;
  }
  planEdge(ops, theme, layout, w, h);
  return ops.list;
}

/** 試験用の場：元の格子（下のタイル）に、5mごとの少し明るい線を足す（開発用と分かる見た目）。 */
function planDev(ops: Ops, theme: GroundTheme, w: number, h: number): void {
  const step = CELL * 5;
  for (let x = step; x < w; x += step) ops.rect(x, 0, 1, h, theme.palette.soil);
  for (let y = step; y < h; y += step) ops.rect(0, y, w, 1, theme.palette.soil);
}

/**
 * まだら：小さな升ごとに、なめらかなノイズで暗い・明るい・土を選ぶ（地の色のままの升は描かない）。
 * soilBias を上げると土が増える（腐った森）。
 */
function planPatches(
  ops: Ops,
  theme: GroundTheme,
  w: number,
  h: number,
  soilBias: number,
  skip?: (x: number, y: number) => boolean,
): void {
  const p = theme.palette;
  const s = theme.seed;
  for (let y = 0; y < h; y += SUB)
    for (let x = 0; x < w; x += SUB) {
      if (skip?.(x + SUB / 2, y + SUB / 2) === true) continue;
      // 升の縁を少しぎざぎざにする（同じ値の升が四角く並ばないように）
      const jitter = (hash2(x, y, s ^ 0x5bd1) - 0.5) * 0.04;
      // 大きなかたまり（80px）に、中くらいのゆらぎ（24px）を足して縁を自然に
      const n = 0.65 * valueNoise(x, y, 80, s) + 0.35 * valueNoise(x, y, 24, s ^ 0x3c6e) + jitter;
      const m =
        0.65 * valueNoise(x, y, 56, s ^ 0x9e37) + 0.35 * valueNoise(x, y, 20, s ^ 0x1f) + jitter;
      if (n < 0.33) ops.rect(x, y, SUB, SUB, p.dark);
      else if (n > 0.67 - soilBias) ops.rect(x, y, SUB, SUB, p.soil);
      else if (m > 0.7) ops.rect(x, y, SUB, SUB, p.light);
    }
}

/** 草の房（細い3本の線）。 */
function tuft(ops: Ops, x: number, y: number, color: number): void {
  ops.rect(x, y + 1, 1, 2, color);
  ops.rect(x + 2, y, 1, 3, color);
  ops.rect(x + 4, y + 1, 1, 2, color);
}

/** 曲がりくねった根（1〜2ピクセルの線）。長さ len ピクセル・向き dir（ラジアン）。 */
function root(
  ops: Ops,
  x0: number,
  y0: number,
  dir: number,
  len: number,
  thick: number,
  color: number,
  shade: number,
  seed: number,
  taper = false,
): void {
  let x = x0;
  let y = y0;
  let a = dir;
  for (let i = 0; i < len; i += 2) {
    a += (hash2(i, Math.round(x0 * 7 + y0), seed) - 0.5) * 0.5;
    x += Math.cos(a) * 2;
    y += Math.sin(a) * 2;
    const t = taper ? Math.max(1, Math.round(thick * (1 - i / len))) : thick;
    // 下側に1ピクセルの影（立体に見せる）
    ops.rect(x, y + t, t, 1, shade);
    ops.rect(x, y, t, t, color);
  }
}

/** 森：草・土・根・落ち葉。腐るほど土・根・茸が増え、草が減る。 */
function planForest(
  ops: Ops,
  theme: GroundTheme,
  layout: GroundLayout,
  w: number,
  h: number,
): void {
  const p = theme.palette;
  const rot = theme.rot;
  ops.rect(0, 0, w, h, p.base);
  planPatches(ops, theme, w, h, 0.1 * rot);
  // 出口へ続く土の道（出口の内側 3m）
  for (const e of layout.exits ?? []) {
    const ex = e.x * CELL;
    const ey = e.y * CELL;
    const ew = e.width * CELL;
    const eh = e.height * CELL;
    const along = 3 * CELL;
    if (e.x <= 0.01) ops.rect(0, ey + 8, ew + along, eh - 16, p.soil);
    else if (e.x + e.width >= layout.width - 0.01)
      ops.rect(ex - along, ey + 8, ew + along, eh - 16, p.soil);
    else ops.rect(ex, ey, ew, eh, p.soil);
  }
  const s = theme.seed;
  const tuftP = 0.1 * (1 - 0.6 * rot);
  const pebbleP = 0.025;
  const leafP = 0.05;
  const mushP = 0.03 * rot;
  const rootP = 0.012 + 0.03 * rot;
  for (let cy = 0; cy < h / CELL; cy++)
    for (let cx = 0; cx < w / CELL; cx++) {
      const r = hash2(cx, cy, s ^ 0x1234);
      const ox = cx * CELL + Math.floor(hash2(cx, cy, s ^ 0x77) * 10);
      const oy = cy * CELL + Math.floor(hash2(cx, cy, s ^ 0x99) * 11);
      let acc = tuftP;
      if (r < acc) {
        tuft(ops, ox, oy, p.detail);
        continue;
      }
      acc += pebbleP;
      if (r < acc) {
        ops.rect(ox, oy, 2, 1, p.detail2);
        ops.rect(ox + 3, oy + 2, 1, 1, p.detail2);
        continue;
      }
      acc += leafP;
      if (r < acc) {
        ops.rect(ox, oy, 1, 1, p.detail2);
        ops.rect(ox + 4, oy + 3, 1, 1, p.detail2);
        ops.rect(ox + 2, oy + 5, 1, 1, p.detail);
        continue;
      }
      acc += mushP;
      if (r < acc) {
        // 茸（腐った森）：笠と軸
        ops.rect(ox + 1, oy + 2, 1, 2, p.detail2);
        ops.rect(ox, oy + 1, 3, 1, p.accent, 0.8);
        continue;
      }
      acc += rootP;
      if (r < acc) {
        const dir = hash2(cx, cy, s ^ 0x4242) * Math.PI * 2;
        root(ops, ox, oy, dir, 18 + (Math.floor(r * 400) % 22), 1, p.root, p.dark, s);
      }
    }
}

/** 町の石畳の範囲（ピクセルの点が、広場・道・施設の前の台に入るか）。 */
function townStone(layout: GroundLayout): (x: number, y: number) => boolean {
  const e = layout.entrance ?? { x: layout.width / 2, y: layout.height / 2 };
  const ex = e.x * CELL;
  const ey = e.y * CELL;
  const plaza = 4.5 * CELL;
  const road = 1 * CELL;
  const pad = 1.4 * CELL;
  const lane = 0.75 * CELL;
  const facilities = (layout.facilities ?? []).map((f) => ({ x: f.x * CELL, y: f.y * CELL }));
  return (x, y) => {
    if (Math.hypot(x - ex, y - ey) <= plaza) return true;
    // 入口の高さを横切る大通り
    if (Math.abs(y - ey) <= road) return true;
    for (const f of facilities) {
      if (Math.abs(x - f.x) <= pad && Math.abs(y - f.y) <= pad) return true;
      // 大通りから施設へ縦の小道
      if (Math.abs(x - f.x) <= lane && (y - ey) * (y - f.y) <= 0) return true;
    }
    return false;
  };
}

/** 町：土と草の地に、広場・大通り・施設の前の石畳。 */
function planTown(ops: Ops, theme: GroundTheme, layout: GroundLayout, w: number, h: number): void {
  const p = theme.palette;
  const s = theme.seed;
  ops.rect(0, 0, w, h, p.base);
  const stone = townStone(layout);
  planPatches(ops, theme, w, h, 0, stone);
  // 石畳：目地の色を敷き、8×8 の升ごとに石を置く（1段おきに半分ずらす）
  for (let y = 0; y < h; y += STONE) {
    const shift = (y / STONE) % 2 === 0 ? 0 : STONE / 2;
    for (let x = -shift; x < w; x += STONE) {
      const cx = x + STONE / 2;
      const cy = y + STONE / 2;
      if (!stone(cx, cy)) continue;
      ops.rect(Math.max(0, x), y, x < 0 ? STONE + x : STONE, STONE, p.detail2);
      const v = hash2(x, y, s ^ 0x51);
      const color =
        v < 0.2
          ? lerpColor(p.detail, p.detail2, 0.35)
          : v > 0.85
            ? lerpColor(p.detail, 0xffffff, 0.05)
            : p.detail;
      const sx = Math.max(0, x);
      ops.rect(sx, y, (x < 0 ? STONE + x : STONE) - 1, STONE - 1, color);
      // 石の左上の明るい角（ごく一部）
      if (v > 0.6 && v < 0.7) ops.rect(sx, y, 2, 1, p.accent, 0.35);
    }
  }
  // 石畳の外の草の房・小石
  for (let cy = 0; cy < h / CELL; cy++)
    for (let cx = 0; cx < w / CELL; cx++) {
      const ox = cx * CELL + Math.floor(hash2(cx, cy, s ^ 0x77) * 10);
      const oy = cy * CELL + Math.floor(hash2(cx, cy, s ^ 0x99) * 11);
      if (stone(ox + 2, oy + 2)) continue;
      const r = hash2(cx, cy, s ^ 0x1234);
      if (r < 0.1) tuft(ops, ox, oy, p.root);
      else if (r < 0.13) ops.rect(ox, oy, 2, 1, p.detail2);
    }
}

/** ボスの間：暗い土に、真ん中の開けた広場と、外から広場へ這う太い根。 */
function planBoss(ops: Ops, theme: GroundTheme, w: number, h: number): void {
  const p = theme.palette;
  const s = theme.seed;
  ops.rect(0, 0, w, h, p.base);
  const cx = w / 2;
  const cy = h / 2;
  // 補助仕様書11.1：半径10mの円形の広場（地域が狭ければ収まる大きさ。壁は無い：見た目だけ）
  const radius = Math.min(10 * CELL, Math.min(w, h) / 2 - CELL * 0.5);
  planPatches(ops, theme, w, h, 0.05);
  // 広場：縁をぎざぎざに、少し明るい土
  for (let y = 0; y < h; y += SUB)
    for (let x = 0; x < w; x += SUB) {
      const d = Math.hypot(x + SUB / 2 - cx, y + SUB / 2 - cy);
      const edge = radius + (hash2(x, y, s ^ 0xbeef) - 0.5) * 12;
      if (d < edge) ops.rect(x, y, SUB, SUB, d < edge - 10 ? p.light : p.soil);
    }
  // 根：外から広場の縁の少し内側まで
  const n = 22;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + hash2(i, 0, s) * 0.25;
    // 地域の縁から始める（縁までの距離）
    const ca = Math.abs(Math.cos(a));
    const sa = Math.abs(Math.sin(a));
    const far = Math.min(ca > 1e-6 ? w / 2 / ca : Infinity, sa > 1e-6 ? h / 2 / sa : Infinity);
    const x0 = cx + Math.cos(a) * far;
    const y0 = cy + Math.sin(a) * far;
    const len = far - radius * (0.82 + hash2(i, 1, s) * 0.1);
    const thick = i % 3 === 0 ? 5 : i % 3 === 1 ? 4 : 3;
    root(ops, x0, y0, a + Math.PI, len, thick, p.root, p.dark, s ^ i, true);
  }
  // 細かい模様：小石と、腐った胞子（差し色。少しだけ）
  for (let gy = 0; gy < h / CELL; gy++)
    for (let gx = 0; gx < w / CELL; gx++) {
      const r = hash2(gx, gy, s ^ 0x1234);
      const ox = gx * CELL + Math.floor(hash2(gx, gy, s ^ 0x77) * 12);
      const oy = gy * CELL + Math.floor(hash2(gx, gy, s ^ 0x99) * 12);
      if (r < 0.05) ops.rect(ox, oy, 2, 1, p.detail);
      else if (r < 0.08) ops.rect(ox, oy, 1, 1, p.accent, 0.45);
    }
}

/**
 * 地域の端：歩ける範囲の外（内側への幅 inset）を暗くし、その内側にだんだん薄くなる帯。
 * 森は端に木立（暗い円）、町は柵（杭と横木）。出口の前は空ける。
 */
function planEdge(ops: Ops, theme: GroundTheme, layout: GroundLayout, w: number, h: number): void {
  const p = theme.palette;
  const s = theme.seed;
  const inset = Math.round((layout.inset ?? DEFAULT_INSET) * CELL);
  const exits = layout.exits ?? [];
  // 木立（森）：歩ける範囲の外に中心を置く暗い円。下の端だけ少し明るい縁（上から光）
  if (theme.kind === "forest" || theme.kind === "boss") {
    const step = 11;
    const crown = lerpColor(p.edge, p.dark, 0.6);
    const along = (len: number, place: (t: number, k: number) => [number, number]): void => {
      for (let t = -6, k = 0; t < len + 6; t += step, k++) {
        const [x, y] = place(t, k);
        if (nearExit(x, y, exits, 18)) continue;
        const r = 9 + Math.floor(hash2(k, Math.round(x + y), s ^ 0x7a11) * 7);
        // 木の冠：暗い円に、左上から光の当たった少し明るい円
        ops.disc(x, y, r, p.edge);
        ops.disc(x - 2, y - 2, r - 4, crown);
      }
    };
    const jit = (k: number, salt: number): number => Math.round((hash2(k, salt, s) - 0.5) * 6);
    along(w, (t, k) => [t, -4 + jit(k, 1)]);
    along(w, (t, k) => [t, h + 4 + jit(k, 2)]);
    along(h, (t, k) => [-4 + jit(k, 3), t]);
    along(h, (t, k) => [w + 4 + jit(k, 4), t]);
  }
  // 歩ける範囲の外（地域の縁の inset ピクセル）を暗く。出口の前は薄く
  const band = (x: number, y: number, bw: number, bh: number, alpha: number): void => {
    ops.rect(x, y, bw, bh, p.edge, alpha);
  };
  const fade = [0.55, 0.35, 0.2, 0.1];
  band(0, 0, w, inset, 0.7);
  band(0, h - inset, w, inset, 0.7);
  band(0, inset, inset, h - 2 * inset, 0.7);
  band(w - inset, inset, inset, h - 2 * inset, 0.7);
  for (let i = 0; i < fade.length; i++) {
    const a = fade[i] ?? 0;
    const d = inset + i * 3;
    band(d, d, w - 2 * d, 3, a);
    band(d, h - d - 3, w - 2 * d, 3, a);
    band(d, d + 3, 3, h - 2 * d - 6, a);
    band(w - d - 3, d + 3, 3, h - 2 * d - 6, a);
  }
  // 町：柵（歩ける範囲の縁に杭、横木）。出口の前は柵を切る
  if (theme.kind === "town") {
    const post = (x: number, y: number): void => {
      if (nearExit(x, y, exits, 6)) return;
      ops.rect(x - 1, y - 3, 3, 5, p.edge);
      ops.rect(x - 1, y - 3, 3, 1, p.accent, 0.6);
    };
    for (let x = inset; x <= w - inset; x += CELL) {
      post(x, inset - 1);
      post(x, h - inset + 1);
    }
    for (let y = inset + CELL; y < h - inset; y += CELL) {
      post(inset - 1, y);
      post(w - inset + 1, y);
    }
  }
  // 縁の線（歩ける範囲の境目）
  const line = theme.kind === "town" ? p.edge : p.root;
  const seg = (x: number, y: number, lw: number, lh: number): void => {
    if (!nearExit(x + lw / 2, y + lh / 2, exits, 4)) ops.rect(x, y, lw, lh, line, 0.9);
  };
  for (let x = inset; x < w - inset; x += 4) {
    seg(x, inset - 1, 4, 1);
    seg(x, h - inset, 4, 1);
  }
  for (let y = inset; y < h - inset; y += 4) {
    seg(inset - 1, y, 1, 4);
    seg(w - inset, y, 1, 4);
  }
}
