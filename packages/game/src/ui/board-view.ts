/**
 * 盤（星辰盤・職紋盤）の図の共通の部品：盤の座標と画面のピクセルの変換・ノードの当たり判定・全体が収まる視点・
 * ドラッグとホイールでの視点の動かし方・多角形の頂点。Phaser に依存しない純粋な関数（テストで確かめる）。
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** 盤を描く範囲（画面のピクセル）。 */
export interface BoardArea {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 盤の表示の視点（盤の座標の中心と、拡大率）。 */
export interface BoardCamera {
  readonly cx: number;
  readonly cy: number;
  readonly zoom: number;
}

/** 盤の座標 → 画面のピクセル（視点の中心が、範囲の中心に来る）。 */
export function boardToScreen(area: BoardArea, cam: BoardCamera, p: Point): Point {
  return {
    x: area.x + area.width / 2 + (p.x - cam.cx) * cam.zoom,
    y: area.y + area.height / 2 + (p.y - cam.cy) * cam.zoom,
  };
}

/** 画面のピクセル → 盤の座標。 */
export function screenToBoard(area: BoardArea, cam: BoardCamera, s: Point): Point {
  return {
    x: cam.cx + (s.x - area.x - area.width / 2) / cam.zoom,
    y: cam.cy + (s.y - area.y - area.height / 2) / cam.zoom,
  };
}

/** 画面の位置が範囲の中か（端を含む）。 */
export function insideArea(area: BoardArea, p: Point): boolean {
  return (
    p.x >= area.x && p.y >= area.y && p.x <= area.x + area.width && p.y <= area.y + area.height
  );
}

/**
 * 画面の位置にある、いちばん近いノード（範囲の外・どのノードの半径+2 の中にも無ければ undefined）。
 * radius はノードの画面の半径。
 */
export function nodeAtScreen<N extends { readonly position: Point }>(
  nodes: Iterable<N>,
  area: BoardArea,
  cam: BoardCamera,
  x: number,
  y: number,
  radius: (n: N) => number,
): N | undefined {
  if (x < area.x || y < area.y || x >= area.x + area.width || y >= area.y + area.height)
    return undefined;
  let best: N | undefined;
  let bestD = Infinity;
  for (const n of nodes) {
    const s = boardToScreen(area, cam, n.position);
    const d = Math.hypot(s.x - x, s.y - y);
    if (d <= radius(n) + 2 && d < bestD) {
      best = n;
      bestD = d;
    }
  }
  return best;
}

/**
 * 盤の全体が範囲に収まる視点（ノードの外接矩形の中心。上下左右に margin ピクセルの余白）。
 * 拡大率は min〜max に収める（小さい盤を大きくしすぎない）。点が無ければ原点・max。
 */
export function fitCamera(
  area: BoardArea,
  points: Iterable<Point>,
  margin: number,
  zoom: { readonly min: number; readonly max: number },
): BoardCamera {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  if (!Number.isFinite(x0)) return { cx: 0, cy: 0, zoom: zoom.max };
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const z = Math.min((area.width - 2 * margin) / w, (area.height - 2 * margin) / h);
  return {
    cx: (x0 + x1) / 2,
    cy: (y0 + y1) / 2,
    zoom: Math.min(zoom.max, Math.max(zoom.min, z)),
  };
}

/** ドラッグで視点を動かす（押した時の視点 start から、画面で dx・dy 動かした）。盤は指に付いて動く。 */
export function panCamera(start: BoardCamera, dx: number, dy: number): BoardCamera {
  return { ...start, cx: start.cx - dx / start.zoom, cy: start.cy - dy / start.zoom };
}

/** 拡大率を k 倍する（min〜max に収める）。中心は動かさない。 */
export function zoomCamera(
  cam: BoardCamera,
  k: number,
  range: { readonly min: number; readonly max: number },
): BoardCamera {
  return { ...cam, zoom: Math.min(range.max, Math.max(range.min, cam.zoom * k)) };
}

/** 正多角形の頂点（中心 c・外接円の半径 r・最初の頂点の角度 rotation〔ラジアン。0 は右〕）。 */
export function polygonPoints(sides: number, c: Point, r: number, rotation = 0): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i * 2 * Math.PI) / sides;
    out.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
  }
  return out;
}
