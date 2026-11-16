/** スマホ（タッチ）操作のモデル（input/touch-controls.ts）と、盤のピンチの倍率（ui/board-view.ts）。 */
import { describe, expect, it } from "vitest";
import {
  TOUCH_BUTTON_IDS,
  TOUCH_LAYOUT,
  TOUCH_MENU_ITEMS,
  TOUCH_TUNING,
  TOUCH_UI_LAYOUT,
  TouchControls,
  TouchModeSwitch,
  aimWorldPoint,
  buttonAt,
  isSkillSlot,
  menuItemRect,
  pastDeadZone,
  rectContains,
  shouldBlockPortrait,
  stickVector,
  type Point,
  type Rect,
  type TouchButtonDef,
  type TouchButtonId,
} from "../src/input/touch-controls.ts";
import { pinchZoomFactor } from "../src/ui/board-view.ts";

const SCREEN = { width: 640, height: 360 };
const L = TOUCH_LAYOUT;
const T = TOUCH_TUNING;

const center = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const at = (c: Point, dir: Point, len: number): Point => ({
  x: c.x + dir.x * len,
  y: c.y + dir.y * len,
});
const btn = (id: TouchButtonId) => {
  const b = L.buttons.find((x) => x.id === id);
  if (b === undefined) throw new Error(`ボタン ${id} が無い`);
  return b;
};
const btnCenter = (id: TouchButtonId): Point => ({ x: btn(id).x, y: btn(id).y });

/** 左スティックを触れる位置（範囲の真ん中）。 */
const LEFT_TOUCH = center(L.leftStick.zone);
/** 右スティックを触れる位置（範囲の真ん中）。 */
const RIGHT_TOUCH = center(L.rightStick.zone);
const RIGHT = { x: 1, y: 0 };
const UP = { x: 0, y: -1 };
const LEFT = { x: -1, y: 0 };
const DOWN = { x: 0, y: 1 };
const DIAG = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
/** 遊びを超えた所（遊びと満タンの真ん中）の倒し量。 */
const PAST_MOVE = (T.moveDeadZone + 1) / 2;
const PAST_AIM = (T.aimDeadZone + 1) / 2;
/** ドラッグの長さ：遊びと射程いっぱいの真ん中（倍率 0.5）。 */
const DRAG_LEN = T.skillDrag.deadZone + (T.skillDrag.full - T.skillDrag.deadZone) / 2;
const GRACE = T.skillAimGraceMs;
const expectPoint = (p: Point, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x);
  expect(p.y).toBeCloseTo(y);
};

describe("小さな関数", () => {
  describe("pastDeadZone（遊びを超えた分を 0〜1 に直す）", () => {
    it("遊びちょうどは 0（「より大きい」）、わずかに上は 0 より大きい", () => {
      expect(pastDeadZone(0.5, 0.5)).toBe(0);
      expect(pastDeadZone(0.5 + 1e-6, 0.5)).toBeGreaterThan(0);
    });

    it("遊び以下・0・負・NaN は 0。満タンは 1", () => {
      expect(pastDeadZone(0.1, T.moveDeadZone)).toBe(0);
      expect(pastDeadZone(0, 0)).toBe(0);
      expect(pastDeadZone(-1, 0.2)).toBe(0);
      expect(pastDeadZone(Number.NaN, 0.2)).toBe(0);
      expect(pastDeadZone(1, 0.2)).toBeCloseTo(1);
    });

    it("遊びが 0 のときは量そのもの", () => {
      expect(pastDeadZone(0.3, 0)).toBeCloseTo(0.3);
    });
  });

  describe("stickVector（スティックの位置 → つまみ・倒した量・向き）", () => {
    it("中心と同じ位置は長さ 0：倒した量 0・向きは 0,0（NaN にならない）", () => {
      const v = stickVector({ x: 5, y: 5 }, { x: 5, y: 5 }, 10);
      expect(v.amount).toBe(0);
      expect(v.dir).toEqual({ x: 0, y: 0 });
      expect(Number.isNaN(v.dir.x) || Number.isNaN(v.dir.y)).toBe(false);
      expect(v.knob).toEqual({ x: 5, y: 5 });
    });

    it("半径の内側は、倒した量＝距離÷半径。つまみはその位置", () => {
      const v = stickVector({ x: 0, y: 0 }, { x: 3, y: 4 }, 10);
      expect(v.amount).toBeCloseTo(0.5);
      expect(v.knob.x).toBeCloseTo(3);
      expect(v.knob.y).toBeCloseTo(4);
    });

    it("半径を超えると倒した量は 1、つまみは輪の上に揃う", () => {
      const v = stickVector({ x: 0, y: 0 }, { x: 30, y: 40 }, 10);
      expect(v.amount).toBe(1);
      expect(v.knob.x).toBeCloseTo(6);
      expect(v.knob.y).toBeCloseTo(8);
    });

    it("向きは単位ベクトル", () => {
      for (const pos of [
        { x: 7, y: 0 },
        { x: -3, y: 9 },
        { x: 100, y: -100 },
      ]) {
        const { dir } = stickVector({ x: 1, y: 1 }, pos, 5);
        expect(Math.hypot(dir.x, dir.y)).toBeCloseTo(1);
      }
    });

    it("半径が 0・負のときは NaN や Infinity を出さず、倒した量 0", () => {
      for (const r of [0, -10]) {
        const v = stickVector({ x: 0, y: 0 }, { x: 3, y: 4 }, r);
        expect(v.amount).toBe(0);
        expect(Number.isFinite(v.knob.x) && Number.isFinite(v.knob.y)).toBe(true);
        expect(Number.isFinite(v.dir.x) && Number.isFinite(v.dir.y)).toBe(true);
      }
    });
  });

  describe("aimWorldPoint（照準の点の世界の座標）", () => {
    const origin = { x: 100, y: 50 };
    it("プレイヤー＋向き×距離×ピクセル", () => {
      expectPoint(aimWorldPoint(origin, RIGHT, 2, 10), 120, 50);
      expectPoint(aimWorldPoint(origin, DOWN, 3, 4), 100, 62);
    });

    it("向きが (0,0) のときは、プレイヤーの位置そのもの", () => {
      expectPoint(aimWorldPoint(origin, { x: 0, y: 0 }, 5, 16), 100, 50);
    });
  });

  describe("buttonAt（画面の位置に当たるボタン）", () => {
    const sample: readonly TouchButtonDef[] = [
      { id: "dodge", x: 0, y: 0, r: 10, hitR: 30, aimDrag: false },
      { id: "skill2", x: 40, y: 0, r: 10, hitR: 30, aimDrag: true },
    ];

    it("押せる範囲の中は当たり、外は当たらない", () => {
      expect(buttonAt(sample, { x: 0, y: 29 })?.id).toBe("dodge");
      expect(buttonAt(sample, { x: 0, y: 31 })).toBeUndefined();
      expect(buttonAt(sample, { x: 1000, y: 0 })).toBeUndefined();
    });

    it("押せる範囲が重なる所は、中心が近いボタン", () => {
      // dodge の中心から 5、skill2 の中心から 15（どちらも押せる範囲の内）
      expect(buttonAt(sample, { x: 5, y: 0 })?.id).toBe("dodge");
      expect(buttonAt(sample, { x: 25, y: 0 })?.id).toBe("skill2");
    });

    it("隠したボタンは返さない（隠れた方の中で当たるなら、次の候補）", () => {
      // (15,0) は dodge（距離 15）と skill2（距離 25）の両方の範囲の内。dodge を隠すと skill2
      expect(buttonAt(sample, { x: 15, y: 0 }, (id) => id !== "dodge")?.id).toBe("skill2");
      expect(buttonAt(sample, { x: 0, y: 0 }, () => false)).toBeUndefined();
    });

    it("実際の配置でも、各ボタンの中心はそのボタンに当たる", () => {
      for (const b of L.buttons) expect(buttonAt(L.buttons, { x: b.x, y: b.y })?.id).toBe(b.id);
    });
  });

  describe("rectContains・menuItemRect（画面の操作の枠）", () => {
    const r: Rect = { x: 10, y: 20, width: 30, height: 40 };

    it("中・角の内側は入る。左と上の辺は入り、右と下の辺は枠の外（半開区間）", () => {
      expect(rectContains(r, { x: 20, y: 40 })).toBe(true);
      expect(rectContains(r, { x: 10, y: 20 })).toBe(true); // 左上の角
      expect(rectContains(r, { x: 39, y: 59 })).toBe(true); // 右下の角の内側
      expect(rectContains(r, { x: 40, y: 40 })).toBe(false); // 右の辺
      expect(rectContains(r, { x: 20, y: 60 })).toBe(false); // 下の辺
    });

    it("外は入らない", () => {
      expect(rectContains(r, { x: 9, y: 30 })).toBe(false);
      expect(rectContains(r, { x: 20, y: 19 })).toBe(false);
      expect(rectContains(r, { x: 100, y: 100 })).toBe(false);
    });

    it("メニューの項目どうしは重ならず、画面の中に収まる", () => {
      const rects = TOUCH_MENU_ITEMS.map((_, i) => menuItemRect(i));
      rects.forEach((a, i) => {
        expect(a.x).toBeGreaterThanOrEqual(0);
        expect(a.y).toBeGreaterThanOrEqual(0);
        expect(a.x + a.width).toBeLessThanOrEqual(SCREEN.width);
        expect(a.y + a.height).toBeLessThanOrEqual(SCREEN.height);
        rects.forEach((b, j) => {
          if (i === j) return;
          const overlap =
            a.x < b.x + b.width &&
            b.x < a.x + a.width &&
            a.y < b.y + b.height &&
            b.y < a.y + a.height;
          expect(overlap).toBe(false);
        });
      });
    });

    it("画面の操作のボタン（≡・閉じる・盤の＋−・メニューの枠）は画面の中にある", () => {
      const ui: Rect[] = [
        TOUCH_UI_LAYOUT.menu,
        TOUCH_UI_LAYOUT.close,
        TOUCH_UI_LAYOUT.zoomOut,
        TOUCH_UI_LAYOUT.zoomIn,
        menuItemRect(TOUCH_MENU_ITEMS.length - 1),
      ];
      for (const r of ui) {
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.width).toBeLessThanOrEqual(SCREEN.width);
        expect(r.y + r.height).toBeLessThanOrEqual(SCREEN.height);
      }
    });

    it("メニューの各項目の中心は、その項目の枠に入る", () => {
      TOUCH_MENU_ITEMS.forEach((_, i) => {
        expect(rectContains(menuItemRect(i), center(menuItemRect(i)))).toBe(true);
      });
    });
  });

  describe("shouldBlockPortrait（縦持ちの画面で止める）", () => {
    it("タッチの端末で高さが幅より大きいときは止める", () => {
      expect(shouldBlockPortrait(true, 390, 844)).toBe(true);
    });

    it("横向き・正方形は止めない", () => {
      expect(shouldBlockPortrait(true, 844, 390)).toBe(false);
      expect(shouldBlockPortrait(true, 500, 500)).toBe(false);
    });

    it("タッチでない端末は、縦長でも止めない（PC の窓を縦長にしただけ）", () => {
      expect(shouldBlockPortrait(false, 390, 844)).toBe(false);
    });
  });

  describe("isSkillSlot（技の枠か）", () => {
    it("skill2〜skill6 は技の枠", () => {
      for (const id of ["skill2", "skill3", "skill4", "skill5", "skill6"] as const)
        expect(isSkillSlot(id)).toBe(true);
    });

    it("dodge・flaskHp・flaskMp・interact は技の枠ではない", () => {
      for (const id of ["dodge", "flaskHp", "flaskMp", "interact"] as const)
        expect(isSkillSlot(id)).toBe(false);
    });
  });

  describe("TOUCH_LAYOUT（配置。変えても重ならず、画面に収まる）", () => {
    it("ボタンの id は TOUCH_BUTTON_IDS と過不足なく一致する", () => {
      expect(L.buttons.map((b) => b.id).sort()).toEqual([...TOUCH_BUTTON_IDS].sort());
    });

    it("全てのボタンが画面の中にある", () => {
      for (const b of L.buttons) {
        expect(b.x - b.r).toBeGreaterThanOrEqual(0);
        expect(b.y - b.r).toBeGreaterThanOrEqual(0);
        expect(b.x + b.r).toBeLessThanOrEqual(SCREEN.width);
        expect(b.y + b.r).toBeLessThanOrEqual(SCREEN.height);
      }
    });

    it("スティックの輪と範囲が画面の中にある", () => {
      for (const s of [L.leftStick, L.rightStick]) {
        expect(s.rest.x - s.radius).toBeGreaterThanOrEqual(0);
        expect(s.rest.y - s.radius).toBeGreaterThanOrEqual(0);
        expect(s.rest.x + s.radius).toBeLessThanOrEqual(SCREEN.width);
        expect(s.rest.y + s.radius).toBeLessThanOrEqual(SCREEN.height);
        expect(s.zone.x).toBeGreaterThanOrEqual(0);
        expect(s.zone.y).toBeGreaterThanOrEqual(0);
        expect(s.zone.x + s.zone.width).toBeLessThanOrEqual(SCREEN.width);
        expect(s.zone.y + s.zone.height).toBeLessThanOrEqual(SCREEN.height);
      }
    });

    it("ボタンどうしの中心の距離は、見た目の半径の和以上（全ての組で重ならない）", () => {
      L.buttons.forEach((a, i) => {
        L.buttons.forEach((b, j) => {
          if (j <= i) return;
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.r + b.r);
        });
      });
    });

    it("ボタンがスティックの輪と重ならない", () => {
      for (const s of [L.leftStick, L.rightStick]) {
        for (const b of L.buttons)
          expect(Math.hypot(b.x - s.rest.x, b.y - s.rest.y)).toBeGreaterThanOrEqual(s.radius + b.r);
      }
    });

    it("押せる範囲は描く半径以上", () => {
      for (const b of L.buttons) expect(b.hitR).toBeGreaterThanOrEqual(b.r);
    });
  });
});

describe("TouchControls（スティック）", () => {
  it("何も触れていないとき、frame は held・pressed が空で、move は 0,0", () => {
    const tc = new TouchControls();
    const f = tc.frame(0);
    expect(f.held.size).toBe(0);
    expect(f.pressed.size).toBe(0);
    expect(f.move).toEqual({ x: 0, y: 0 });
    expect(f.aiming).toBe(false);
  });

  it("左スティックは浮動式：触れた位置が中心になり、触れただけでは動かない", () => {
    const tc = new TouchControls();
    expect(tc.down(1, LEFT_TOUCH.x, LEFT_TOUCH.y, 0)).toBe("left");
    expect(tc.state().left.active).toBe(true);
    expect(tc.state().left.center).toEqual(LEFT_TOUCH);
    expect(tc.frame(0).move).toEqual({ x: 0, y: 0 });
  });

  it("左の遊びの内側は動かず、遊びを超えると move が向く（上下左右・斜め。長さ1）", () => {
    const cases: [string, Point][] = [
      ["右", RIGHT],
      ["左", LEFT],
      ["上", UP],
      ["下", DOWN],
      ["斜め", DIAG],
    ];
    for (const [, dir] of cases) {
      const tc = new TouchControls();
      tc.down(1, LEFT_TOUCH.x, LEFT_TOUCH.y, 0);
      const inside = at(LEFT_TOUCH, dir, L.leftStick.radius * T.moveDeadZone * 0.5);
      tc.move(1, inside.x, inside.y);
      expect(tc.frame(0).move).toEqual({ x: 0, y: 0 });
      const past = at(LEFT_TOUCH, dir, L.leftStick.radius * PAST_MOVE);
      tc.move(1, past.x, past.y);
      const m = tc.frame(0).move;
      expectPoint(m, dir.x, dir.y);
      expect(Math.hypot(m.x, m.y)).toBeCloseTo(1);
    }
  });

  it("左スティックは、輪の外へ倒しても長さ1のまま", () => {
    const tc = new TouchControls();
    tc.down(1, LEFT_TOUCH.x, LEFT_TOUCH.y, 0);
    const far = at(LEFT_TOUCH, RIGHT, L.leftStick.radius * 5);
    tc.move(1, far.x, far.y);
    expectPoint(tc.frame(0).move, 1, 0);
  });

  it("右の遊びの内側では skill1 は入らず、照準も変わらない", () => {
    const tc = new TouchControls();
    tc.down(1, RIGHT_TOUCH.x, RIGHT_TOUCH.y, 0);
    const inside = at(RIGHT_TOUCH, UP, L.rightStick.radius * T.aimDeadZone * 0.5);
    tc.move(1, inside.x, inside.y);
    const f = tc.frame(0);
    expect(f.held.has("skill1")).toBe(false);
    expect(f.aiming).toBe(false);
  });

  it("右スティックを遊びを超えて倒すと held に skill1、aim がその向き、aiming は true", () => {
    const tc = new TouchControls();
    tc.down(1, RIGHT_TOUCH.x, RIGHT_TOUCH.y, 0);
    const p = at(RIGHT_TOUCH, UP, L.rightStick.radius * PAST_AIM);
    tc.move(1, p.x, p.y);
    const f = tc.frame(0);
    expect(f.held.has("skill1")).toBe(true);
    expect(f.aiming).toBe(true);
    expectPoint(f.aim, 0, -1);
  });

  it("照準の距離は TOUCH_TUNING の min〜max の範囲で、倒す量が大きいほど遠い", () => {
    const { min, max } = T.aimDistance;
    const distanceAt = (k: number): number => {
      const tc = new TouchControls();
      tc.down(1, RIGHT_TOUCH.x, RIGHT_TOUCH.y, 0);
      const p = at(RIGHT_TOUCH, RIGHT, L.rightStick.radius * k);
      tc.move(1, p.x, p.y);
      return tc.frame(0).aimDistance;
    };
    const justPast = distanceAt(T.aimDeadZone + 0.01);
    const half = distanceAt((T.aimDeadZone + 1) / 2);
    const full = distanceAt(1);
    const beyond = distanceAt(3);
    expect(justPast).toBeGreaterThanOrEqual(min);
    expect(justPast).toBeLessThan(half);
    expect(half).toBeLessThan(full);
    expect(full).toBeCloseTo(max);
    expect(beyond).toBeCloseTo(max);
  });

  it("右スティックを離すと skill1 が held から消え、aim の向きと aimDistance は残る", () => {
    const tc = new TouchControls();
    tc.down(1, RIGHT_TOUCH.x, RIGHT_TOUCH.y, 0);
    const p = at(RIGHT_TOUCH, DIAG, L.rightStick.radius);
    tc.move(1, p.x, p.y);
    const before = tc.frame(0);
    tc.up(1);
    const after = tc.frame(0);
    expect(after.held.has("skill1")).toBe(false);
    expect(after.aiming).toBe(false);
    expectPoint(after.aim, DIAG.x, DIAG.y);
    expect(after.aimDistance).toBeCloseTo(before.aimDistance);
  });

  it("左と右を別の指で同時に操作できる（移動しながら照準・攻撃）", () => {
    const tc = new TouchControls();
    tc.down(1, LEFT_TOUCH.x, LEFT_TOUCH.y, 0);
    tc.down(2, RIGHT_TOUCH.x, RIGHT_TOUCH.y, 0);
    const l = at(LEFT_TOUCH, RIGHT, L.leftStick.radius * PAST_MOVE);
    const r = at(RIGHT_TOUCH, UP, L.rightStick.radius * PAST_AIM);
    tc.move(1, l.x, l.y);
    tc.move(2, r.x, r.y);
    const f = tc.frame(0);
    expectPoint(f.move, 1, 0);
    expectPoint(f.aim, 0, -1);
    expect(f.held.has("skill1")).toBe(true);
    expect(tc.fingerCount).toBe(2);
  });

  it("同じスティックに2本目の指を置くと none。先の指の操作は変わらない", () => {
    const tc = new TouchControls();
    expect(tc.down(1, LEFT_TOUCH.x, LEFT_TOUCH.y, 0)).toBe("left");
    expect(tc.down(2, LEFT_TOUCH.x + 10, LEFT_TOUCH.y + 10, 0)).toBe("none");
    const p = at(LEFT_TOUCH, RIGHT, L.leftStick.radius * PAST_MOVE);
    tc.move(1, p.x, p.y);
    tc.move(2, LEFT_TOUCH.x - 200, LEFT_TOUCH.y);
    expectPoint(tc.frame(0).move, 1, 0);
    expectPoint(tc.state().left.center, LEFT_TOUCH.x, LEFT_TOUCH.y);
  });

  it("スティックからはみ出して指を動かしても、その指は追い続ける（別の操作部に移らない）", () => {
    const tc = new TouchControls();
    tc.down(1, LEFT_TOUCH.x, LEFT_TOUCH.y, 0);
    const d = btnCenter("dodge");
    tc.move(1, d.x, d.y);
    const f = tc.frame(0);
    expect(f.pressed.has("dodge")).toBe(false);
    expect(f.held.has("dodge")).toBe(false);
    expect(tc.state().left.active).toBe(true);
    // 移動の向きは、中心（触れた位置）から指の位置へ
    const dx = d.x - LEFT_TOUCH.x;
    const dy = d.y - LEFT_TOUCH.y;
    const len = Math.hypot(dx, dy);
    expectPoint(f.move, dx / len, dy / len);
  });

  it("右スティックを遊びを超えて倒しても、移動の向きは変わらない（左と独立）", () => {
    const tc = new TouchControls();
    tc.down(1, RIGHT_TOUCH.x, RIGHT_TOUCH.y, 0);
    const p = at(RIGHT_TOUCH, UP, L.rightStick.radius);
    tc.move(1, p.x, p.y);
    expect(tc.frame(0).move).toEqual({ x: 0, y: 0 });
  });
});

describe("TouchControls（ボタン）", () => {
  it("回避を押すと、次の frame で pressed と held。その次は pressed から消え held に残る", () => {
    const tc = new TouchControls();
    expect(tc.down(1, btn("dodge").x, btn("dodge").y, 0)).toBe("dodge");
    const f1 = tc.frame(0);
    expect(f1.pressed.has("dodge")).toBe(true);
    expect(f1.held.has("dodge")).toBe(true);
    const f2 = tc.frame(16);
    expect(f2.pressed.has("dodge")).toBe(false);
    expect(f2.held.has("dodge")).toBe(true);
    tc.up(1);
    const f3 = tc.frame(32);
    expect(f3.held.has("dodge")).toBe(false);
    expect(f3.pressed.has("dodge")).toBe(false);
  });

  it("frame の前に押して離した短いタップは、次の frame の pressed に残る（取りこぼさない）", () => {
    const tc = new TouchControls();
    tc.down(1, btn("dodge").x, btn("dodge").y, 0);
    tc.up(1);
    const f = tc.frame(0);
    expect(f.pressed.has("dodge")).toBe(true);
    expect(f.held.has("dodge")).toBe(false);
  });

  it("技のボタン：待つ時間の前に離すと、離した後の frame で pressed（1回だけ）", () => {
    const tc = new TouchControls();
    const c = btnCenter("skill2");
    tc.down(1, c.x, c.y, 0);
    tc.up(1);
    const f1 = tc.frame(GRACE / 2);
    expect(f1.pressed.has("skill2")).toBe(true);
    expect(f1.held.has("skill2")).toBe(false);
    expect(tc.frame(GRACE / 2 + 1).pressed.has("skill2")).toBe(false);
  });

  it("技のボタン：待つ時間が過ぎると pressed と held。押している間は held が続く", () => {
    const tc = new TouchControls();
    const c = btnCenter("skill2");
    tc.down(1, c.x, c.y, 0);
    const early = tc.frame(GRACE - 1);
    expect(early.pressed.has("skill2")).toBe(false);
    expect(early.held.has("skill2")).toBe(false);
    const f1 = tc.frame(GRACE);
    expect(f1.pressed.has("skill2")).toBe(true);
    expect(f1.held.has("skill2")).toBe(true);
    const f2 = tc.frame(GRACE + 50);
    expect(f2.pressed.has("skill2")).toBe(false);
    expect(f2.held.has("skill2")).toBe(true);
    tc.up(1);
    expect(tc.frame(GRACE + 60).held.has("skill2")).toBe(false);
  });

  it("技のボタン：待つ時間の内にドラッグが遊びを超えたら、その場で pressed・held になり aim がドラッグの向き", () => {
    const tc = new TouchControls();
    const c = btnCenter("skill2");
    tc.down(1, c.x, c.y, 0);
    const d = at(c, RIGHT, DRAG_LEN);
    tc.move(1, d.x, d.y);
    const f = tc.frame(1);
    expect(f.pressed.has("skill2")).toBe(true);
    expect(f.held.has("skill2")).toBe(true);
    expect(f.aiming).toBe(true);
    expectPoint(f.aim, 1, 0);
    expect(f.aimDistance).toBeGreaterThanOrEqual(T.aimDistance.min);
  });

  it("技のドラッグの遊びの内側では、狙いは変わらず pressed にもならない", () => {
    const tc = new TouchControls();
    const c = btnCenter("skill3");
    tc.down(1, c.x, c.y, 0);
    const d = at(c, RIGHT, T.skillDrag.deadZone * 0.5);
    tc.move(1, d.x, d.y);
    const f = tc.frame(1);
    expect(f.pressed.has("skill3")).toBe(false);
    expect(f.aiming).toBe(false);
  });

  it("技のドラッグで狙うのは技の枠だけ（回避は、ドラッグしても狙わない）", () => {
    const tc = new TouchControls();
    const c = btnCenter("dodge");
    tc.down(1, c.x, c.y, 0);
    const d = at(c, RIGHT, DRAG_LEN);
    tc.move(1, d.x, d.y);
    const f = tc.frame(1);
    expect(f.aiming).toBe(false);
    expect(f.held.has("dodge")).toBe(true);
  });

  it("照準の優先：一番新しいドラッグ ＞ 右スティック", () => {
    const tc = new TouchControls();
    tc.down(1, RIGHT_TOUCH.x, RIGHT_TOUCH.y, 0);
    const r = at(RIGHT_TOUCH, UP, L.rightStick.radius);
    tc.move(1, r.x, r.y);
    const c = btnCenter("skill2");
    tc.down(2, c.x, c.y, 10);
    const d = at(c, RIGHT, DRAG_LEN);
    tc.move(2, d.x, d.y);
    expectPoint(tc.frame(10).aim, 1, 0);
  });

  it("照準の優先：後から押した技のドラッグが、先のドラッグより優先される", () => {
    const tc = new TouchControls();
    const c2 = btnCenter("skill2");
    const c3 = btnCenter("skill3");
    tc.down(1, c2.x, c2.y, 0);
    const d2 = at(c2, RIGHT, DRAG_LEN);
    tc.move(1, d2.x, d2.y);
    tc.down(2, c3.x, c3.y, 10);
    const d3 = at(c3, UP, DRAG_LEN);
    tc.move(2, d3.x, d3.y);
    expectPoint(tc.frame(20).aim, 0, -1);
  });

  it("照準の優先：右スティック ＞ 覚えている向き。何も無ければ最後の向き", () => {
    const tc = new TouchControls();
    const c = btnCenter("skill4");
    tc.down(1, c.x, c.y, 0);
    const d = at(c, DOWN, DRAG_LEN);
    tc.move(1, d.x, d.y);
    tc.frame(1);
    tc.up(1);
    expectPoint(tc.frame(2).aim, 0, 1); // 覚えている向き
    tc.down(2, RIGHT_TOUCH.x, RIGHT_TOUCH.y, 3);
    const r = at(RIGHT_TOUCH, LEFT, L.rightStick.radius);
    tc.move(2, r.x, r.y);
    expectPoint(tc.frame(4).aim, -1, 0); // 右スティックが優先
    tc.up(2);
    expectPoint(tc.frame(5).aim, -1, 0); // 離しても覚えている
  });

  it("技の射程：frame に渡すと、ドラッグの距離は min〜射程に収まる（倍率は同じ）", () => {
    const { min } = T.aimDistance;
    const c = btnCenter("skill5");
    const dragWith = (range: number | undefined) => {
      const tc = new TouchControls();
      tc.down(1, c.x, c.y, 0);
      const d = at(c, RIGHT, DRAG_LEN);
      tc.move(1, d.x, d.y);
      return tc.frame(1, range === undefined ? undefined : () => range).aimDistance;
    };
    const ratio = 0.5;
    expect(dragWith(3)).toBeCloseTo(min + (3 - min) * ratio);
    expect(dragWith(undefined)).toBeCloseTo(min + (T.skillDefaultRange - min) * ratio);
    expect(dragWith(0.2)).toBeCloseTo(min);
  });

  it("技のドラッグで離したあとも、照準の距離は離す直前の frame の距離のまま", () => {
    const tc = new TouchControls();
    const c = btnCenter("skill2");
    tc.down(1, c.x, c.y, 0);
    const d = at(c, RIGHT, DRAG_LEN);
    tc.move(1, d.x, d.y);
    const shown = tc.frame(1, () => 3).aimDistance;
    tc.up(1);
    const after = tc.frame(2).aimDistance;
    expect(after).toBeCloseTo(shown);
  });

  it("技の射程：スロットごとに渡される（skill5 の射程だけが効く）", () => {
    const tc = new TouchControls();
    const c = btnCenter("skill5");
    tc.down(1, c.x, c.y, 0);
    const d = at(c, RIGHT, DRAG_LEN);
    tc.move(1, d.x, d.y);
    const f = tc.frame(1, (slot) => (slot === "skill5" ? 2 : 100));
    expect(f.aimDistance).toBeLessThanOrEqual(2);
  });

  it("同じ id で down が2回来たら、先の指が離れる（二重に結び付かない）", () => {
    const tc = new TouchControls();
    expect(tc.down(1, LEFT_TOUCH.x, LEFT_TOUCH.y, 0)).toBe("left");
    expect(tc.down(1, btn("dodge").x, btn("dodge").y, 0)).toBe("dodge");
    expect(tc.fingerCount).toBe(1);
    expect(tc.state().left.active).toBe(false);
    expect(tc.frame(0).pressed.has("dodge")).toBe(true);
  });

  it("cancel は押していたボタンを離し、出していない技を出さない（up との違い）", () => {
    const tc = new TouchControls();
    const c = btnCenter("skill2");
    tc.down(1, c.x, c.y, 0);
    const d = at(c, RIGHT, DRAG_LEN);
    tc.move(1, d.x, d.y);
    tc.cancel(1);
    const f = tc.frame(1);
    expect(f.pressed.has("skill2")).toBe(false);
    expect(f.held.has("skill2")).toBe(false);
    expect(f.aiming).toBe(false);
    expect(tc.fingerCount).toBe(0);
  });

  it("cancel：出した技は、離れたら held から消える（pressed は出し終わっている）", () => {
    const tc = new TouchControls();
    const c = btnCenter("skill2");
    tc.down(1, c.x, c.y, 0);
    expect(tc.frame(GRACE).held.has("skill2")).toBe(true);
    tc.cancel(1);
    expect(tc.frame(GRACE + 1).held.has("skill2")).toBe(false);
  });

  it("cancel：回避を押した直後（frame の前）に取り消したら、何も出さない", () => {
    const tc = new TouchControls();
    tc.down(1, btn("dodge").x, btn("dodge").y, 0);
    tc.cancel(1);
    const f = tc.frame(0);
    expect(f.pressed.has("dodge")).toBe(false);
    expect(f.held.has("dodge")).toBe(false);
  });

  it("cancelAll は全ての指を離し、取り消されていない入力も出さない", () => {
    const tc = new TouchControls();
    tc.down(1, btn("dodge").x, btn("dodge").y, 0);
    tc.up(1); // 離した（次の frame で pressed になる入力）
    tc.down(2, LEFT_TOUCH.x, LEFT_TOUCH.y, 0);
    tc.cancelAll();
    const f = tc.frame(0);
    expect(tc.fingerCount).toBe(0);
    expect(f.pressed.size).toBe(0);
    expect(f.held.size).toBe(0);
    expect(f.move).toEqual({ x: 0, y: 0 });
  });

  it("retain：一覧に無い指は離れ、一覧にある指は残る", () => {
    const tc = new TouchControls();
    tc.down(1, btn("dodge").x, btn("dodge").y, 0);
    tc.down(2, LEFT_TOUCH.x, LEFT_TOUCH.y, 0);
    tc.retain(new Set([2]));
    expect(tc.fingerCount).toBe(1);
    expect(tc.frame(0).held.has("dodge")).toBe(false);
    expect(tc.state().left.active).toBe(true);
    const p = at(LEFT_TOUCH, RIGHT, L.leftStick.radius * PAST_MOVE);
    tc.move(2, p.x, p.y);
    expectPoint(tc.frame(0).move, 1, 0);
  });

  it("存在しない id の move・up・cancel は例外を出さない", () => {
    const tc = new TouchControls();
    expect(() => {
      tc.move(99, 1, 1);
      tc.up(99);
      tc.cancel(99);
    }).not.toThrow();
    expect(tc.fingerCount).toBe(0);
  });

  it("setVisible(false) のボタンは押せない（その場所は none）。isVisible で分かる", () => {
    const tc = new TouchControls();
    tc.setVisible("dodge", false);
    expect(tc.isVisible("dodge")).toBe(false);
    expect(tc.down(1, btn("dodge").x, btn("dodge").y, 0)).toBe("none");
    expect(tc.frame(0).pressed.has("dodge")).toBe(false);
    tc.setVisible("dodge", true);
    expect(tc.isVisible("dodge")).toBe(true);
    expect(tc.down(2, btn("dodge").x, btn("dodge").y, 0)).toBe("dodge");
  });

  it("押している最中にボタンを隠すと、その指は離れる（押しっぱなしにしない）", () => {
    const tc = new TouchControls();
    tc.down(1, btn("dodge").x, btn("dodge").y, 0);
    expect(tc.frame(0).held.has("dodge")).toBe(true);
    tc.setVisible("dodge", false);
    const f = tc.frame(1);
    expect(f.held.has("dodge")).toBe(false);
    expect(tc.state().buttons.find((b) => b.id === "dodge")?.down).toBe(false);
    tc.up(1);
    expect(tc.frame(2).held.has("dodge")).toBe(false);
  });

  it("fingerCount は down/up で増減する", () => {
    const tc = new TouchControls();
    tc.down(1, btn("dodge").x, btn("dodge").y, 0);
    tc.down(2, LEFT_TOUCH.x, LEFT_TOUCH.y, 0);
    expect(tc.fingerCount).toBe(2);
    tc.up(1);
    expect(tc.fingerCount).toBe(1);
    tc.up(2);
    expect(tc.fingerCount).toBe(0);
  });

  it("操作部の無い場所（画面の中央の上など）に触れると none で、何も起きない", () => {
    const tc = new TouchControls();
    expect(tc.down(1, SCREEN.width / 2, 60, 0)).toBe("none");
    const f = tc.frame(0);
    expect(f.held.size).toBe(0);
    expect(f.pressed.size).toBe(0);
    expect(f.move).toEqual({ x: 0, y: 0 });
    expect(tc.state().left.active).toBe(false);
    expect(tc.state().right.active).toBe(false);
  });

  it("state() は、スティックの中心・つまみ・押しているボタンを返し、同じ状態なら deep equal", () => {
    const tc = new TouchControls();
    tc.down(1, LEFT_TOUCH.x, LEFT_TOUCH.y, 0);
    const p = at(LEFT_TOUCH, UP, L.leftStick.radius * 0.5);
    tc.move(1, p.x, p.y);
    tc.down(2, btn("skill6").x, btn("skill6").y, 0);
    const s = tc.state();
    expect(s.left.active).toBe(true);
    expect(s.left.center).toEqual(LEFT_TOUCH);
    expect(s.left.amount).toBeCloseTo(0.5);
    expect(s.left.engaged).toBe(true);
    expect(s.right.active).toBe(false);
    expect(s.right.knob).toEqual(L.rightStick.rest);
    expect(s.buttons.find((b) => b.id === "skill6")?.down).toBe(true);
    expect(s.buttons.find((b) => b.id === "dodge")?.down).toBe(false);
    expect(s.fingers).toBe(2);
    expect(tc.state()).toEqual(s);
  });

  it("state() の技のドラッグの向きは、ドラッグしている間だけ drag に入る", () => {
    const tc = new TouchControls();
    const c = btnCenter("skill2");
    tc.down(1, c.x, c.y, 0);
    const d = at(c, RIGHT, DRAG_LEN);
    tc.move(1, d.x, d.y);
    tc.frame(1);
    const drag = tc.state().buttons.find((b) => b.id === "skill2")?.drag;
    expect(drag).toBeDefined();
    expectPoint(drag ?? { x: NaN, y: NaN }, 1, 0);
    tc.up(1);
    expect(tc.state().buttons.find((b) => b.id === "skill2")?.drag).toBeUndefined();
  });

  it("座標に NaN・負・画面の外を渡しても、例外も NaN の出力も無い", () => {
    const tc = new TouchControls();
    expect(tc.down(1, Number.NaN, Number.NaN, 0)).toBe("none");
    expect(tc.down(2, -50, -50, 0)).toBe("none");
    expect(tc.down(3, SCREEN.width + 500, SCREEN.height + 500, 0)).toBe("none");
    expect(() => {
      tc.move(3, Number.NaN, Number.NaN);
      tc.move(2, -1e6, -1e6);
      tc.up(3);
    }).not.toThrow();

    // 左スティックに NaN を渡しても、移動は 0 のまま
    tc.down(4, LEFT_TOUCH.x, LEFT_TOUCH.y, 0);
    tc.move(4, Number.NaN, Number.NaN);
    const f = tc.frame(0);
    expect(Number.isFinite(f.move.x) && Number.isFinite(f.move.y)).toBe(true);
    expect(f.move).toEqual({ x: 0, y: 0 });
    const s = tc.state();
    expect(Number.isFinite(s.left.knob.x) && Number.isFinite(s.left.knob.y)).toBe(true);
    expect(Number.isFinite(s.left.amount)).toBe(true);

    // 技のボタンのドラッグに NaN を渡しても、照準は有限のまま
    const c = btnCenter("skill2");
    tc.down(5, c.x, c.y, 0);
    tc.move(5, Number.NaN, Number.NaN);
    const g = tc.frame(1);
    expect(Number.isFinite(g.aim.x) && Number.isFinite(g.aim.y)).toBe(true);
    expect(Number.isFinite(g.aimDistance)).toBe(true);
  });
});

describe("TouchModeSwitch（タッチの表示に切り替えるか）", () => {
  const SETTLE = 300;

  it("設定 on は常に active、off は常に非 active（触れても・マウスでも変わらない）", () => {
    const on = new TouchModeSwitch(false, SETTLE);
    on.setSetting("on");
    expect(on.active).toBe(true);
    on.noteDesktopInput(10 * SETTLE);
    expect(on.active).toBe(true);

    const off = new TouchModeSwitch(true, SETTLE);
    off.setSetting("off");
    expect(off.active).toBe(false);
    off.noteTouch(0);
    expect(off.active).toBe(false);
  });

  it("auto：touchPrimary=true で始めから active、false で始めは非 active。触れると active", () => {
    const primary = new TouchModeSwitch(true, SETTLE);
    expect(primary.currentSetting).toBe("auto");
    expect(primary.active).toBe(true);

    const pc = new TouchModeSwitch(false, SETTLE);
    expect(pc.active).toBe(false);
    pc.noteTouch(100);
    expect(pc.active).toBe(true);
  });

  it("始めからタッチの端末でも、マウス・キーの入力で PC の表示に戻る（触れた記録が無いので）", () => {
    const sw = new TouchModeSwitch(true, SETTLE);
    sw.noteDesktopInput(0);
    expect(sw.active).toBe(false);
  });

  it("触れた直後の settleMs の内のマウス・キーでは戻らない。settleMs を過ぎたら戻る（境目ちょうど）", () => {
    const sw = new TouchModeSwitch(false, SETTLE);
    const t0 = 1000;
    sw.noteTouch(t0);
    sw.noteDesktopInput(t0 + SETTLE - 1);
    expect(sw.active).toBe(true);
    sw.noteDesktopInput(t0 + SETTLE);
    expect(sw.active).toBe(false);
  });

  it("時刻が戻ったとき（now が小さくなった）も固まらず、戻った後 settleMs を過ぎれば PC の表示に戻る", () => {
    const sw = new TouchModeSwitch(false, SETTLE);
    sw.noteTouch(5000);
    sw.noteDesktopInput(0); // 時刻が戻った
    sw.noteDesktopInput(SETTLE); // 戻ってから settleMs 過ぎた
    expect(sw.active).toBe(false);
  });

  it("設定を auto に戻すと、触れた状態から判定し直す", () => {
    const sw = new TouchModeSwitch(false, SETTLE);
    sw.setSetting("off");
    sw.noteTouch(0);
    expect(sw.active).toBe(false);
    sw.setSetting("auto");
    expect(sw.active).toBe(true);
  });
});

describe("pinchZoomFactor（盤のピンチの倍率）", () => {
  it("今の距離 ÷ 前の距離", () => {
    expect(pinchZoomFactor(100, 150)).toBeCloseTo(1.5);
    expect(pinchZoomFactor(100, 50)).toBeCloseTo(0.5);
    expect(pinchZoomFactor(80, 80)).toBe(1);
  });

  it("1回に変える量は 0.5〜2 倍に収まる", () => {
    expect(pinchZoomFactor(100, 1000)).toBe(2);
    expect(pinchZoomFactor(100, 1)).toBe(0.5);
  });

  it("prev や cur が 0・負・NaN・Infinity のときは 1（変えない）", () => {
    const bad = [0, -5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const v of bad) {
      expect(pinchZoomFactor(v, 100)).toBe(1);
      expect(pinchZoomFactor(100, v)).toBe(1);
    }
  });
});
