/**
 * 仮素材の姿（敵・プレイヤー・場の物・ドロップ）を図形で描く（placeholders.ts から、起動時に1回だけ）。
 * 色・寸法は look-tables.ts。描いた絵は生成テクスチャになり、毎フレームは描かない。
 *
 * 描き方：部品（楕円・円・四角・三角・線）を並べ、先に全ての部品を暗い色で1ピクセル太らせて描き（輪郭）、
 * その上に本来の色で描く。地面の上でも姿の輪郭が分かるように。
 */
import type Phaser from "phaser";
import type { EnemyLook, FacilityLook, JobLook } from "./look-tables.ts";
import { PROP_COLORS } from "./look-tables.ts";

/** 部品。 */
type Part =
  | { readonly k: "ellipse"; x: number; y: number; w: number; h: number; c: number; a?: number }
  | { readonly k: "circle"; x: number; y: number; r: number; c: number; a?: number }
  | { readonly k: "rect"; x: number; y: number; w: number; h: number; c: number; a?: number }
  | {
      readonly k: "tri";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      x3: number;
      y3: number;
      c: number;
      a?: number;
    }
  | {
      readonly k: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      w: number;
      c: number;
      a?: number;
    };

/** 部品を描く（outline なら暗い色で1ピクセル太らせる）。 */
function drawPart(g: Phaser.GameObjects.Graphics, p: Part, outline: number | undefined): void {
  const o = outline === undefined ? 0 : 1;
  const c = outline ?? p.c;
  const a = outline === undefined ? (p.a ?? 1) : 1;
  switch (p.k) {
    case "ellipse":
      g.fillStyle(c, a).fillEllipse(p.x, p.y, p.w + o * 2, p.h + o * 2);
      break;
    case "circle":
      g.fillStyle(c, a).fillCircle(p.x, p.y, p.r + o);
      break;
    case "rect":
      g.fillStyle(c, a).fillRect(p.x - o, p.y - o, p.w + o * 2, p.h + o * 2);
      break;
    case "tri":
      if (o === 0) g.fillStyle(c, a).fillTriangle(p.x1, p.y1, p.x2, p.y2, p.x3, p.y3);
      else {
        // 三角の輪郭は、同じ三角を少しずつずらして重ねる
        g.fillStyle(c, a);
        for (const [dx, dy] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ] as const)
          g.fillTriangle(p.x1 + dx, p.y1 + dy, p.x2 + dx, p.y2 + dy, p.x3 + dx, p.y3 + dy);
      }
      break;
    case "line":
      g.lineStyle(p.w + o * 2, c, a).lineBetween(p.x1, p.y1, p.x2, p.y2);
      break;
  }
}

/** 部品の列を、輪郭（outline の色）→ 本体の順に描く。outlined が false の部品は輪郭を付けない。 */
function drawParts(
  g: Phaser.GameObjects.Graphics,
  parts: readonly (Part & { readonly noOutline?: boolean })[],
  outline: number,
): void {
  for (const p of parts) if (p.noOutline !== true) drawPart(g, p, outline);
  for (const p of parts) drawPart(g, p, undefined);
}

/** 色を暗くする（成分ごとに k 倍）。 */
export function shade(color: number, k: number): number {
  const ch = (s: number): number => Math.min(255, Math.round(((color >> s) & 0xff) * k)) << s;
  return ch(16) | ch(8) | ch(0);
}

/** 輪郭の色（どの姿も同じ、ほぼ黒）。 */
const OUTLINE = 0x121018;

/**
 * 敵の姿（s×s ピクセル。真上から見て頭が右＝向き0）。木・苗は回さないので、斜め上から見た形。
 * 体は直径 s の円の中に収める（当たり判定の大きさと合わせる）。
 */
export function drawEnemy(g: Phaser.GameObjects.Graphics, look: EnemyLook, s: number): void {
  const c = s / 2;
  const { body: b, dark: d, accent: x } = look;
  const P: (Part & { noOutline?: boolean })[] = [];
  const el = (px: number, py: number, w: number, h: number, col: number, no = false): void => {
    P.push({
      k: "ellipse",
      x: c + px * s,
      y: c + py * s,
      w: w * s,
      h: h * s,
      c: col,
      noOutline: no,
    });
  };
  const ci = (px: number, py: number, r: number, col: number, no = false): void => {
    P.push({
      k: "circle",
      x: c + px * s,
      y: c + py * s,
      r: Math.max(0.6, r * s),
      c: col,
      noOutline: no,
    });
  };
  const px1 = (px: number, py: number, col: number): void => {
    P.push({
      k: "rect",
      x: Math.round(c + px * s),
      y: Math.round(c + py * s),
      w: 1,
      h: 1,
      c: col,
      noOutline: true,
    });
  };
  const ln = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    w: number,
    col: number,
    no = false,
  ): void => {
    P.push({
      k: "line",
      x1: c + x1 * s,
      y1: c + y1 * s,
      x2: c + x2 * s,
      y2: c + y2 * s,
      w,
      c: col,
      noOutline: no,
    });
  };
  switch (look.shape) {
    case "wolf":
    case "leader": {
      // 脚（体の下から少し見える）・しっぽ・体・頭・鼻先・耳
      for (const lx of [-0.24, 0.1]) for (const ly of [-0.19, 0.19]) el(lx, ly, 0.1, 0.08, d);
      el(-0.4, 0, 0.22, 0.09, d);
      el(-0.08, 0, 0.6, 0.34, b);
      el(-0.1, 0, 0.42, 0.12, d, true);
      if (look.shape === "leader") el(0.12, 0, 0.24, 0.42, shade(b, 0.8));
      ci(0.24, 0, 0.15, b);
      el(0.39, 0, 0.14, 0.1, d);
      P.push({
        k: "tri",
        x1: c + 0.16 * s,
        y1: c - 0.08 * s,
        x2: c + 0.22 * s,
        y2: c - 0.2 * s,
        x3: c + 0.26 * s,
        y3: c - 0.08 * s,
        c: d,
      });
      P.push({
        k: "tri",
        x1: c + 0.16 * s,
        y1: c + 0.08 * s,
        x2: c + 0.22 * s,
        y2: c + 0.2 * s,
        x3: c + 0.26 * s,
        y3: c + 0.08 * s,
        c: d,
      });
      px1(0.3, -0.06, x);
      px1(0.3, 0.05, x);
      if (look.shape === "leader") ln(-0.2, -0.1, 0.0, 0.08, 1, x, true);
      break;
    }
    case "rat": {
      // 小さく低い：細長い体・尖った頭・長いしっぽ・背のとげ
      ln(-0.2, 0, -0.48, 0.12, 1, d, true);
      el(-0.06, 0, 0.56, 0.4, b);
      P.push({
        k: "tri",
        x1: c + 0.12 * s,
        y1: c - 0.16 * s,
        x2: c + 0.12 * s,
        y2: c + 0.16 * s,
        x3: c + 0.46 * s,
        y3: c,
        c: b,
      });
      ci(0.14, -0.16, 0.07, d);
      ci(0.14, 0.16, 0.07, d);
      px1(0.44, 0, d);
      px1(0.26, -0.05, x);
      px1(0.26, 0.04, x);
      for (const t of [-0.22, -0.08, 0.05]) px1(t, -0.02, x);
      break;
    }
    case "lizard": {
      // 細長い体・長いしっぽ・広げた脚・背のとげ
      for (const lx of [-0.12, 0.12])
        for (const sy of [-1, 1]) ln(lx, 0, lx + 0.08 * sy * sy, 0.24 * sy, 2, d);
      P.push({
        k: "tri",
        x1: c - 0.12 * s,
        y1: c - 0.08 * s,
        x2: c - 0.12 * s,
        y2: c + 0.08 * s,
        x3: c - 0.5 * s,
        y3: c + 0.03 * s,
        c: b,
      });
      el(0.0, 0, 0.5, 0.26, b);
      el(0.3, 0, 0.22, 0.17, b);
      for (const t of [-0.16, -0.04, 0.08]) px1(t, 0, x);
      px1(0.34, -0.05, OUTLINE);
      px1(0.34, 0.04, OUTLINE);
      break;
    }
    case "boar": {
      // がっしりした体・背の毛・前の牙
      for (const lx of [-0.22, 0.14]) for (const ly of [-0.24, 0.24]) el(lx, ly, 0.12, 0.08, d);
      el(-0.06, 0, 0.7, 0.52, b);
      ln(-0.36, 0, 0.12, 0, 2, d, true);
      el(0.3, 0, 0.26, 0.3, b);
      el(0.42, 0, 0.1, 0.16, shade(b, 0.7));
      ln(0.38, -0.1, 0.48, -0.18, 1, x, true);
      ln(0.38, 0.1, 0.48, 0.18, 1, x, true);
      px1(0.32, -0.08, OUTLINE);
      px1(0.32, 0.07, OUTLINE);
      break;
    }
    case "bear": {
      // 大きく丸い体・丸い頭と耳・背の樹皮
      for (const lx of [-0.2, 0.12]) for (const ly of [-0.3, 0.3]) ci(lx, ly, 0.08, d);
      ci(-0.06, 0, 0.36, b);
      ci(0.26, 0, 0.17, b);
      ci(0.2, -0.15, 0.06, d);
      ci(0.2, 0.15, 0.06, d);
      el(0.38, 0, 0.09, 0.1, shade(b, 0.6));
      // 背の樹皮（差し色の板）
      P.push({
        k: "rect",
        x: c - 0.22 * s,
        y: c - 0.12 * s,
        w: 0.14 * s,
        h: 0.09 * s,
        c: x,
        noOutline: true,
      });
      P.push({
        k: "rect",
        x: c - 0.08 * s,
        y: c + 0.04 * s,
        w: 0.12 * s,
        h: 0.08 * s,
        c: x,
        noOutline: true,
      });
      P.push({
        k: "rect",
        x: c - 0.28 * s,
        y: c + 0.08 * s,
        w: 0.1 * s,
        h: 0.07 * s,
        c: x,
        noOutline: true,
      });
      px1(0.32, -0.06, OUTLINE);
      px1(0.32, 0.05, OUTLINE);
      break;
    }
    case "sapling": {
      // 植物（回さない）：根・細い幹・葉の房・腐った斑点
      ln(0, 0.34, -0.3, 0.44, 2, d);
      ln(0, 0.34, 0.3, 0.44, 2, d);
      ln(0, 0.34, 0, 0.46, 2, d);
      ln(0, 0.36, 0, -0.04, 3, d);
      ci(-0.17, -0.1, 0.17, b);
      ci(0.17, -0.1, 0.17, b);
      ci(0, -0.26, 0.19, b);
      ci(0, 0.02, 0.13, shade(b, 0.8));
      ci(-0.12, -0.18, 0.05, x, true);
      ci(0.14, -0.04, 0.04, x, true);
      ci(0.05, -0.32, 0.04, x, true);
      break;
    }
    case "tentacle": {
      // 地面から出た根の触手：根元の穴・太い根元から先へ細くなる・先の差し色
      el(-0.3, 0, 0.36, 0.3, OUTLINE, true);
      const pts = [
        [-0.3, 0, 0.14],
        [-0.14, -0.06, 0.12],
        [0.02, -0.04, 0.1],
        [0.16, 0.04, 0.08],
        [0.3, 0.06, 0.06],
        [0.42, 0.0, 0.045],
      ] as const;
      for (const [tx, ty, r] of pts) ci(tx, ty, r, b);
      ci(-0.3, 0, 0.08, d, true);
      ci(0.42, 0, 0.035, x, true);
      break;
    }
    case "tree": {
      // 母樹（回さない）：根が四方へ伸び、太い幹、腐った芯が光る
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + 0.3;
        ln(
          Math.cos(a) * 0.18,
          Math.sin(a) * 0.18,
          Math.cos(a) * 0.48,
          Math.sin(a) * 0.46,
          i % 2 === 0 ? 4 : 3,
          d,
        );
      }
      ci(0, 0, 0.3, b);
      // 樹皮の筋
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ln(
          Math.cos(a) * 0.12,
          Math.sin(a) * 0.12,
          Math.cos(a) * 0.28,
          Math.sin(a) * 0.28,
          1,
          shade(b, 0.7),
          true,
        );
      }
      ci(0, 0, 0.13, d, true);
      ci(0, 0, 0.08, x, true);
      ci(0, 0, 0.035, 0xffffff, true);
      // 枝先の葉（少し）
      for (const [lx, ly] of [
        [-0.2, -0.24],
        [0.22, -0.2],
        [-0.26, 0.16],
        [0.2, 0.24],
      ] as const)
        ci(lx, ly, 0.07, shade(x, 0.55));
      break;
    }
    case "blob": {
      ci(0, 0, 0.42, b);
      ci(0.15, -0.1, 0.06, x, true);
      ci(0.15, 0.1, 0.06, x, true);
      break;
    }
  }
  drawParts(g, P, OUTLINE);
}

/** 肌の色。 */
const SKIN = 0xe8c8a8;
/** 刃の色。 */
const STEEL = 0xd8dce8;
/** 木（柄・弓）の色。 */
const WOOD = 0x8a6a40;

/**
 * プレイヤーの姿（16×24。斜め上から見て右向き。左向きは左右を反転して使う）。
 * 中心（8, 12）が位置。体の幅は当たり判定の直径（約11ピクセル）に合わせる。
 */
export function drawPlayer(g: Phaser.GameObjects.Graphics, look: JobLook): void {
  const P: (Part & { noOutline?: boolean })[] = [];
  const legs = shade(look.trim, 0.45);
  // 後ろの手の武器（騎士の剣・盗賊の2本目）
  if (look.weapon === "swordShield")
    P.push({ k: "line", x1: 3, y1: 9, x2: 3, y2: 18, w: 1, c: STEEL });
  if (look.weapon === "daggers")
    P.push({ k: "line", x1: 2, y1: 13, x2: 2, y2: 18, w: 1, c: STEEL });
  // 脚
  P.push({ k: "rect", x: 5, y: 18, w: 2, h: 4, c: legs });
  P.push({ k: "rect", x: 9, y: 18, w: 2, h: 4, c: legs });
  // 体（長い衣は足元まで）
  if (look.robe) {
    P.push({ k: "tri", x1: 8, y1: 9, x2: 2.5, y2: 22, x3: 13.5, y3: 22, c: look.cloth });
    P.push({ k: "rect", x: 4, y: 10, w: 8, h: 8, c: look.cloth });
    P.push({ k: "rect", x: 3, y: 21, w: 10, h: 1, c: look.trim, noOutline: true });
  } else {
    P.push({ k: "rect", x: 3, y: 10, w: 10, h: 9, c: look.cloth });
    P.push({ k: "rect", x: 3, y: 18, w: 10, h: 1, c: shade(look.cloth, 0.7), noOutline: true });
  }
  P.push({ k: "rect", x: 3, y: 15, w: 10, h: 1, c: look.trim, noOutline: true });
  // 頭：髪・頭巾・兜の色の丸に、右向きの顔
  P.push({ k: "circle", x: 8, y: 6, r: 4, c: look.head });
  P.push({ k: "ellipse", x: 9.5, y: 7, w: 5, h: 5, c: SKIN, noOutline: true });
  P.push({ k: "rect", x: 10, y: 6, w: 1, h: 1, c: OUTLINE, noOutline: true });
  // 前の手の武器
  switch (look.weapon) {
    case "greatsword":
      P.push({ k: "rect", x: 13, y: 3, w: 2, h: 13, c: STEEL });
      P.push({ k: "rect", x: 12, y: 14, w: 4, h: 1, c: look.trim });
      P.push({ k: "rect", x: 13, y: 15, w: 2, h: 3, c: WOOD });
      break;
    case "daggers":
      P.push({ k: "rect", x: 13, y: 11, w: 1, h: 6, c: STEEL });
      P.push({ k: "rect", x: 12, y: 16, w: 3, h: 1, c: WOOD });
      break;
    case "bow":
      P.push({ k: "line", x1: 12, y1: 5, x2: 14.5, y2: 12, w: 1, c: WOOD });
      P.push({ k: "line", x1: 14.5, y1: 12, x2: 12, y2: 19, w: 1, c: WOOD });
      P.push({ k: "line", x1: 12, y1: 5, x2: 12, y2: 19, w: 1, c: 0xe8e6f0, noOutline: true });
      break;
    case "staff":
      P.push({ k: "line", x1: 14, y1: 3, x2: 14, y2: 22, w: 1, c: WOOD });
      P.push({ k: "circle", x: 14, y: 3, r: 2, c: 0x9ad1ff });
      break;
    case "swordShield":
      P.push({ k: "rect", x: 10, y: 10, w: 5, h: 8, c: look.trim });
      P.push({ k: "rect", x: 12, y: 11, w: 1, h: 6, c: STEEL, noOutline: true });
      break;
    case "tome":
      P.push({ k: "rect", x: 11, y: 13, w: 4, h: 4, c: look.trim });
      P.push({ k: "rect", x: 12, y: 14, w: 2, h: 2, c: 0xffffff, a: 0.8, noOutline: true });
      P.push({ k: "circle", x: 14, y: 6, r: 1.5, c: 0xd8a0ff });
      break;
  }
  drawParts(g, P, OUTLINE);
}

/** 施設の姿（look の寸法。下の辺の中ほどが地面）。 */
export function drawFacility(g: Phaser.GameObjects.Graphics, kind: string, f: FacilityLook): void {
  const { width: w, height: h, main: m, dark: d, accent: a } = f;
  const P: (Part & { noOutline?: boolean })[] = [];
  const cx = w / 2;
  switch (kind) {
    case "merchant":
      // 屋台：台・品物・柱・縞の日よけ
      P.push({ k: "rect", x: 2, y: 11, w: w - 4, h: h - 12, c: m });
      P.push({ k: "rect", x: 3, y: 9, w: 2, h: 3, c: 0x7bd389, noOutline: true });
      P.push({ k: "rect", x: 7, y: 9, w: 3, h: 3, c: 0xffd166, noOutline: true });
      P.push({ k: "rect", x: 12, y: 9, w: 2, h: 3, c: 0x6fa8ff, noOutline: true });
      P.push({ k: "rect", x: 16, y: 9, w: 3, h: 3, c: 0xe8e6f0, noOutline: true });
      P.push({ k: "rect", x: 2, y: 4, w: 1, h: 8, c: d });
      P.push({ k: "rect", x: w - 3, y: 4, w: 1, h: 8, c: d });
      P.push({ k: "rect", x: 1, y: 1, w: w - 2, h: 4, c: a });
      for (let x = 1 + 3; x < w - 1; x += 6)
        P.push({ k: "rect", x, y: 1, w: 3, h: 4, c: 0xf2ead8, noOutline: true });
      P.push({ k: "rect", x: 2, y: 13, w: w - 4, h: 1, c: d, noOutline: true });
      break;
    case "smith":
      // 金床と炉の火
      P.push({ k: "rect", x: 1, y: 4, w: 6, h: 10, c: shade(d, 1.3) });
      P.push({ k: "rect", x: 2, y: 6, w: 4, h: 3, c: a });
      P.push({ k: "rect", x: 3, y: 7, w: 2, h: 1, c: 0xffe08a, noOutline: true });
      P.push({ k: "rect", x: 9, y: 6, w: w - 10, h: 3, c: m });
      P.push({ k: "tri", x1: w - 1, y1: 6, x2: w + 2, y2: 6, x3: w - 1, y3: 8, c: m });
      P.push({ k: "rect", x: 12, y: 9, w: 4, h: 3, c: d });
      P.push({ k: "rect", x: 10, y: 12, w: 8, h: 2, c: d });
      P.push({ k: "rect", x: 9, y: 6, w: w - 10, h: 1, c: 0xb8bcc8, noOutline: true });
      break;
    case "starReader":
      // 台の上の星
      P.push({ k: "rect", x: 4, y: 13, w: w - 8, h: 8, c: m });
      P.push({ k: "rect", x: 3, y: 12, w: w - 6, h: 2, c: d });
      P.push({ k: "rect", x: 3, y: 20, w: w - 6, h: 1, c: d });
      for (const [x1, y1, x2, y2, x3, y3] of [
        [cx, 1, cx - 2, 6, cx + 2, 6],
        [cx - 5, 5, cx + 5, 5, cx, 8],
        [cx - 3, 11, cx, 7, cx - 1, 6],
        [cx + 3, 11, cx, 7, cx + 1, 6],
      ] as const)
        P.push({ k: "tri", x1, y1, x2, y2, x3, y3, c: a });
      break;
    case "temple":
      // 白い柱と屋根の祠
      P.push({ k: "rect", x: 2, y: h - 3, w: w - 4, h: 3, c: d });
      P.push({ k: "rect", x: 4, y: 8, w: 3, h: h - 11, c: m });
      P.push({ k: "rect", x: w - 7, y: 8, w: 3, h: h - 11, c: m });
      P.push({ k: "rect", x: 8, y: 10, w: w - 16, h: h - 13, c: shade(d, 0.7) });
      P.push({ k: "tri", x1: 1, y1: 8, x2: cx, y2: 1, x3: w - 1, y3: 8, c: m });
      P.push({ k: "circle", x: cx, y: 5, r: 1.5, c: a, noOutline: true });
      break;
    case "altar":
      // 石の台と紫の印
      P.push({ k: "rect", x: 1, y: 4, w: w - 2, h: h - 5, c: m });
      P.push({ k: "rect", x: 1, y: 4, w: w - 2, h: 2, c: shade(m, 1.3), noOutline: true });
      P.push({ k: "rect", x: 3, y: h - 3, w: w - 6, h: 2, c: d, noOutline: true });
      P.push({ k: "circle", x: cx, y: 9, r: 2.5, c: a, noOutline: true });
      P.push({ k: "rect", x: cx - 6, y: 8, w: 2, h: 2, c: a, noOutline: true });
      P.push({ k: "rect", x: cx + 4, y: 8, w: 2, h: 2, c: a, noOutline: true });
      break;
    case "stash":
      // 金具の付いた大きな箱
      P.push({ k: "rect", x: 1, y: 2, w: w - 2, h: h - 3, c: m });
      P.push({ k: "rect", x: 1, y: 6, w: w - 2, h: 1, c: d, noOutline: true });
      P.push({ k: "rect", x: 4, y: 2, w: 2, h: h - 3, c: a, noOutline: true });
      P.push({ k: "rect", x: w - 6, y: 2, w: 2, h: h - 3, c: a, noOutline: true });
      P.push({ k: "rect", x: cx - 1, y: 7, w: 2, h: 3, c: 0xffd166, noOutline: true });
      break;
    case "teleport":
      drawStoneParts(P, w, h, m, d, a);
      break;
    default:
      P.push({ k: "rect", x: 1, y: 1, w: w - 2, h: h - 2, c: m });
  }
  drawParts(g, P, OUTLINE);
}

/** 光る石（転移の石）の部品。 */
function drawStoneParts(
  P: (Part & { noOutline?: boolean })[],
  w: number,
  h: number,
  main: number,
  dark: number,
  glow: number,
): void {
  const cx = w / 2;
  P.push({ k: "rect", x: 1, y: h - 4, w: w - 2, h: 3, c: dark });
  P.push({ k: "tri", x1: cx, y1: 1, x2: 2, y2: h - 6, x3: w - 2, y3: h - 6, c: main });
  P.push({ k: "rect", x: 2, y: h - 7, w: w - 4, h: 4, c: main });
  P.push({ k: "line", x1: cx, y1: 4, x2: cx, y2: h - 6, w: 1, c: glow, noOutline: true });
  P.push({ k: "rect", x: cx - 2, y: 8, w: 1, h: 3, c: 0xffffff, a: 0.7, noOutline: true });
}

/** 転移の石（12×20）。lit なら解放済み（緑の光）。 */
export function drawStone(g: Phaser.GameObjects.Graphics, lit: boolean): void {
  const col = lit ? PROP_COLORS.stoneLit : PROP_COLORS.stoneDim;
  const P: (Part & { noOutline?: boolean })[] = [];
  drawStoneParts(P, 12, 20, col.main, col.dark, col.glow);
  drawParts(g, P, OUTLINE);
}

/** 宝箱（14×12）。古い宝箱は金、開けた宝箱はふたが開いて中が暗い。 */
export function drawChest(g: Phaser.GameObjects.Graphics, old: boolean, opened: boolean): void {
  const col = opened ? PROP_COLORS.openedChest : old ? PROP_COLORS.oldChest : PROP_COLORS.woodChest;
  const P: (Part & { noOutline?: boolean })[] = [];
  if (opened) {
    // 開いたふた（奥に立つ）・中の暗さ
    P.push({ k: "rect", x: 1, y: 1, w: 12, h: 4, c: col.main });
    P.push({ k: "rect", x: 1, y: 5, w: 12, h: 6, c: col.main });
    P.push({ k: "rect", x: 2, y: 5, w: 10, h: 2, c: OUTLINE, noOutline: true });
  } else {
    P.push({ k: "rect", x: 1, y: 2, w: 12, h: 9, c: col.main });
    P.push({ k: "rect", x: 1, y: 2, w: 12, h: 3, c: shade(col.main, 1.2), noOutline: true });
    P.push({ k: "rect", x: 1, y: 5, w: 12, h: 1, c: col.dark, noOutline: true });
    P.push({ k: "rect", x: 3, y: 2, w: 1, h: 9, c: col.band, noOutline: true });
    P.push({ k: "rect", x: 10, y: 2, w: 1, h: 9, c: col.band, noOutline: true });
    P.push({ k: "rect", x: 6, y: 5, w: 2, h: 3, c: old ? 0xffffff : 0xffd166, noOutline: true });
  }
  drawParts(g, P, OUTLINE);
}

/** 隠し星（怪しい茂み。16×14）：濃い茂みに、小さなきらめき。 */
export function drawSecret(g: Phaser.GameObjects.Graphics): void {
  const c = PROP_COLORS.secret;
  const P: (Part & { noOutline?: boolean })[] = [];
  P.push({ k: "circle", x: 5, y: 8, r: 4, c: c.main });
  P.push({ k: "circle", x: 11, y: 8, r: 4, c: c.main });
  P.push({ k: "circle", x: 8, y: 5, r: 4, c: shade(c.main, 1.15) });
  P.push({ k: "circle", x: 6, y: 9, r: 1.5, c: c.dark, noOutline: true });
  P.push({ k: "circle", x: 11, y: 10, r: 1.5, c: c.dark, noOutline: true });
  P.push({ k: "rect", x: 9, y: 3, w: 1, h: 3, c: c.sparkle, noOutline: true });
  P.push({ k: "rect", x: 8, y: 4, w: 3, h: 1, c: c.sparkle, noOutline: true });
  drawParts(g, P, OUTLINE);
}

/** 地面の装備（白。レアリティの色を掛け算で重ねる。9×9）：小さな宝石形の包み。 */
export function drawLootItem(g: Phaser.GameObjects.Graphics): void {
  const P: (Part & { noOutline?: boolean })[] = [];
  P.push({ k: "tri", x1: 4.5, y1: 0.5, x2: 0.5, y2: 4.5, x3: 8.5, y3: 4.5, c: 0xffffff });
  P.push({ k: "tri", x1: 0.5, y1: 4.5, x2: 8.5, y2: 4.5, x3: 4.5, y3: 8.5, c: 0xc8c8c8 });
  P.push({ k: "rect", x: 3, y: 2, w: 1, h: 2, c: 0xffffff, noOutline: true });
  drawParts(g, P, OUTLINE);
}

/** 地面の金貨（8×7）：重なった硬貨。 */
export function drawLootGold(g: Phaser.GameObjects.Graphics): void {
  const P: (Part & { noOutline?: boolean })[] = [];
  P.push({ k: "ellipse", x: 3, y: 4.5, w: 5, h: 3, c: 0xc89a30 });
  P.push({ k: "ellipse", x: 5, y: 3.5, w: 5, h: 3, c: 0xffd166 });
  P.push({ k: "rect", x: 4, y: 3, w: 2, h: 1, c: 0xfff0b0, noOutline: true });
  drawParts(g, P, OUTLINE);
}

/** 地面の素材（6×9）：紫の結晶のかけら。 */
export function drawLootMaterial(g: Phaser.GameObjects.Graphics): void {
  const P: (Part & { noOutline?: boolean })[] = [];
  P.push({ k: "tri", x1: 3, y1: 0.5, x2: 0.5, y2: 5, x3: 5.5, y3: 5, c: 0xd8c4ff });
  P.push({ k: "tri", x1: 0.5, y1: 5, x2: 5.5, y2: 5, x3: 3, y3: 8.5, c: 0x9070d0 });
  drawParts(g, P, OUTLINE);
}

/** 訓練用の人形（16×24。キーは元のまま）：杭に藁の体と腕の横木、的の印。 */
export function drawDummy(g: Phaser.GameObjects.Graphics): void {
  const P: (Part & { noOutline?: boolean })[] = [];
  P.push({ k: "rect", x: 7, y: 14, w: 2, h: 10, c: 0x6b4f33 });
  P.push({ k: "rect", x: 1, y: 8, w: 14, h: 3, c: 0x6b4f33 });
  P.push({ k: "ellipse", x: 8, y: 13, w: 9, h: 10, c: 0xc8a868 });
  P.push({ k: "circle", x: 8, y: 4, r: 3.5, c: 0xd8c08a });
  P.push({ k: "rect", x: 4, y: 11, w: 8, h: 1, c: 0x8a6a40, noOutline: true });
  P.push({ k: "circle", x: 8, y: 14, r: 2, c: 0xd85a4a, noOutline: true });
  P.push({ k: "circle", x: 8, y: 14, r: 0.8, c: 0xf2ead8, noOutline: true });
  drawParts(g, P, OUTLINE);
}

/** 足元の影（16×6。黒の半透明。体の幅に合わせて拡大する）。 */
export function drawShadow(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(0x000000, 0.25).fillEllipse(8, 3, 16, 6);
  g.fillStyle(0x000000, 0.2).fillEllipse(8, 3, 12, 4);
}

/** やわらかな光（32×32。白。色を掛けて加算で重ねる）。 */
export function drawGlow(g: Phaser.GameObjects.Graphics): void {
  for (let r = 16; r >= 2; r -= 2) g.fillStyle(0xffffff, 0.07).fillCircle(16, 16, r);
}

/** プレイヤーの足元の輪（18×8。群れの中で自分を見つけやすく）。 */
export function drawPlayerRing(g: Phaser.GameObjects.Graphics): void {
  g.lineStyle(1, 0x9ad1ff, 0.55).strokeEllipse(9, 4, 16, 6);
}

/**
 * 足元の影を Graphics に描く（敵・地面の物・プレイヤー。毎フレーム。影の Graphics は地面・場の物の後、
 * 予兆の Graphics と体より前に作るので、作る順で必ず体の下になる）。w×h の楕円。
 */
export function fillShadow(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  alpha = 1,
): void {
  g.fillStyle(0x000000, 0.22 * alpha).fillEllipse(x, y, w, h, 12);
  g.fillStyle(0x000000, 0.18 * alpha).fillEllipse(x, y, w * 0.72, h * 0.66, 10);
}
