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
  for (const op of ops) {
    ctx.globalAlpha = op.alpha;
    ctx.fillStyle = css(op.color);
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
  for (let oy = 0; oy < h; oy += CHUNK)
    for (let ox = 0; ox < w; ox += CHUNK) {
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
      paint(tex.context, ops, ox, oy);
      tex.refresh();
      scene.add.image(ox, oy, key).setOrigin(0, 0).setDepth(WORLD_DEPTH.ground);
    }
}
