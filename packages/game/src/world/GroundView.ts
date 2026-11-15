import Phaser from "phaser";
import { type GroundLayout, type GroundOp, planGround } from "./ground-plan.ts";
import type { GroundTheme } from "./ground-theme.ts";
import { WORLD_DEPTH } from "./depth.ts";
import { PIXELS_PER_METER } from "./units.ts";

/** 1枚のテクスチャの最大の1辺（ピクセル。WebGL の最大の大きさより十分小さく）。 */
const CHUNK = 2048;

/** 色の数値を Canvas の色の文字列に（同じ色は使い回す）。 */
const cssCache = new Map<number, string>();
function css(color: number): string {
  let s = cssCache.get(color);
  if (s === undefined) {
    s = `#${color.toString(16).padStart(6, "0")}`;
    cssCache.set(color, s);
  }
  return s;
}

/** 命令を Canvas に描く（ox, oy は描く範囲の左上。円は1行ずつの四角で描き、ぼかさない）。 */
function paint(
  ctx: CanvasRenderingContext2D,
  ops: readonly GroundOp[],
  ox: number,
  oy: number,
): void {
  ctx.imageSmoothingEnabled = false;
  // 色・不透明度が前の命令と同じなら、設定し直さない（Canvas の色の設定は文字列の解析で、命令が多いと重い）
  let lastColor = -1;
  let lastAlpha = -1;
  for (const op of ops) {
    if (op.alpha !== lastAlpha) {
      ctx.globalAlpha = op.alpha;
      lastAlpha = op.alpha;
    }
    if (op.color !== lastColor) {
      ctx.fillStyle = css(op.color);
      lastColor = op.color;
    }
    if (op.t === "rect") ctx.fillRect(op.x - ox, op.y - oy, op.w, op.h);
    else
      for (let dy = -op.r; dy <= op.r; dy++) {
        const half = Math.floor(Math.sqrt(op.r * op.r - dy * dy));
        ctx.fillRect(op.x - half - ox, op.y + dy - oy, half * 2 + 1, 1);
      }
  }
  ctx.globalAlpha = 1;
}

/**
 * 命令を、重なる区切り（CHUNK ピクセルの正方形。左上から行ごとの順）ごとに振り分ける。
 * 各区切りには、その区切りに重なる命令だけを渡す（全ての命令を区切りの数だけ描かない）。
 */
function splitByChunk(ops: readonly GroundOp[], w: number, h: number): GroundOp[][] {
  const cols = Math.ceil(w / CHUNK);
  const rows = Math.ceil(h / CHUNK);
  const lists: GroundOp[][] = Array.from({ length: cols * rows }, () => []);
  for (const op of ops) {
    const x0 = op.t === "rect" ? op.x : op.x - op.r;
    const x1 = op.t === "rect" ? op.x + op.w : op.x + op.r + 1;
    const y0 = op.t === "rect" ? op.y : op.y - op.r;
    const y1 = op.t === "rect" ? op.y + op.h : op.y + op.r + 1;
    const c0 = Math.max(0, Math.floor(x0 / CHUNK));
    const c1 = Math.min(cols - 1, Math.floor((x1 - 1) / CHUNK));
    const r0 = Math.max(0, Math.floor(y0 / CHUNK));
    const r1 = Math.min(rows - 1, Math.floor((y1 - 1) / CHUNK));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) lists[r * cols + c]?.push(op);
  }
  return lists;
}

/**
 * 地面の表示：地域ごとの絵（ground-plan.ts の命令）を、地域に入ったときに1回だけ Canvas に描き、
 * テクスチャ（大きな地域は 2048 ピクセルごとに分ける）の画像として一番下に置く。毎フレームは描かない。
 *
 * テクスチャは区切りの位置ごとのキー（ground/0-0 など）を使い回し、地域を移るたびに描き直す
 * （捨てて作り直すと、地域を移った後に他の絵が乱れることがあったため。docs/progress D-WORLD-2）。
 * 使い回すので、メモリはいちばん大きな地域の分だけ。
 */
export function drawGround(scene: Phaser.Scene, theme: GroundTheme, layout: GroundLayout): void {
  const ops = planGround(theme, layout);
  const w = Math.round(layout.width * PIXELS_PER_METER);
  const h = Math.round(layout.height * PIXELS_PER_METER);
  const perChunk = splitByChunk(ops, w, h);
  const cols = Math.ceil(w / CHUNK);
  for (let oy = 0; oy < h; oy += CHUNK)
    for (let ox = 0; ox < w; ox += CHUNK) {
      const chunkOps = perChunk[(oy / CHUNK) * cols + ox / CHUNK] ?? [];
      const cw = Math.min(CHUNK, w - ox);
      const ch = Math.min(CHUNK, h - oy);
      const key = `ground/${String(ox)}-${String(oy)}`;
      let tex: Phaser.Textures.CanvasTexture | null;
      if (scene.textures.exists(key)) {
        const t = scene.textures.get(key);
        tex = t instanceof Phaser.Textures.CanvasTexture ? t : null;
        tex?.setSize(cw, ch);
        tex?.clear(0, 0, cw, ch, false);
      } else tex = scene.textures.createCanvas(key, cw, ch);
      if (tex === null) continue;
      paint(tex.context, chunkOps, ox, oy);
      tex.refresh();
      scene.add.image(ox, oy, key).setOrigin(0, 0).setDepth(WORLD_DEPTH.ground);
    }
}
