/**
 * スマホ（タッチ）操作のモデル（docs/progress TOUCH-1）。Phaser に依存しない（テストで確かめる）。
 *
 * 指の状態（押した・動いた・離した。座標は内部解像度 640×360 の画面の座標）を受け取り、
 * スティック・ボタンの状態と「このフレームの行動（held・pressed）・移動の向き・照準の向きと距離」を出す。
 * - 左スティック（移動）：左側の範囲に触れた位置を中心に出る（浮動式）
 * - 右スティック（照準＋通常攻撃）：倒している間は skill1 を押し続け、照準の向きを変える。離しても最後の向きを覚える
 * - ボタン（技2〜6・回避・薬瓶・調べる）：押した瞬間 pressed、押している間 held。技のボタンはドラッグで狙える
 * 1本の指は、押し始めた操作部に結び付く（範囲からはみ出しても追い続ける）。
 */
import type { Action } from "./actions.ts";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** タッチのボタン（どれも InputFrame の行動と同じ名前）。 */
export const TOUCH_BUTTON_IDS = [
  "dodge",
  "skill2",
  "skill3",
  "skill4",
  "skill5",
  "skill6",
  "flaskHp",
  "flaskMp",
  "interact",
] as const;
export type TouchButtonId = (typeof TOUCH_BUTTON_IDS)[number];

/** 技の枠（ドラッグで狙えるボタン）。 */
export type TouchSkillSlot = "skill2" | "skill3" | "skill4" | "skill5" | "skill6";

export interface TouchButtonDef {
  readonly id: TouchButtonId;
  /** 中心（画面の座標）。 */
  readonly x: number;
  readonly y: number;
  /** 描く半径。 */
  readonly r: number;
  /** 押せる半径（描く半径より広い。隣のボタンと重なる所は、中心が近い方）。 */
  readonly hitR: number;
  /** 押したままドラッグすると、その向きへ狙えるか（技の枠）。 */
  readonly aimDrag: boolean;
}

export interface StickDef {
  /** 触れ始めるとスティックになる範囲（ボタンの上は除く）。 */
  readonly zone: Rect;
  /** 触れていないときに描く位置（輪の中心）。 */
  readonly rest: Point;
  /** 輪の半径（これ以上倒しても同じ。倒した量の上限）。 */
  readonly radius: number;
  /** 中の丸の半径（描くだけ）。 */
  readonly knob: number;
}

export interface TouchLayout {
  readonly leftStick: StickDef;
  readonly rightStick: StickDef;
  readonly buttons: readonly TouchButtonDef[];
}

/**
 * 操作部の配置（内部解像度 640×360 の座標・大きさ。docs/progress D-TOUCH-2）。仮値: 実機で親指の届きやすさを確かめる。
 * 右手：右下に照準のスティック、その左上に回避と技2〜5を弧（半径100px・30°おき）に並べ、外側に技6・薬瓶・調べる。
 * 左手：左下の広い範囲のどこに触れても、移動のスティックが出る。
 * ボタンの直径は 44px（640×360 を幅 11〜15cm に映すと 8〜10mm）、押せる範囲は半径 28px。
 */
export const TOUCH_LAYOUT: TouchLayout = {
  leftStick: {
    zone: { x: 0, y: 110, width: 300, height: 250 },
    rest: { x: 88, y: 282 },
    radius: 42,
    knob: 17,
  },
  rightStick: {
    zone: { x: 524, y: 238, width: 116, height: 122 },
    rest: { x: 584, y: 296 },
    radius: 38,
    knob: 16,
  },
  buttons: [
    { id: "dodge", x: 490, y: 330, r: 22, hitR: 28, aimDrag: false },
    { id: "skill2", x: 486, y: 279, r: 22, hitR: 28, aimDrag: true },
    { id: "skill3", x: 507, y: 232, r: 22, hitR: 28, aimDrag: true },
    { id: "skill4", x: 550, y: 202, r: 22, hitR: 28, aimDrag: true },
    { id: "skill5", x: 601, y: 198, r: 22, hitR: 28, aimDrag: true },
    { id: "skill6", x: 497, y: 172, r: 22, hitR: 28, aimDrag: true },
    { id: "flaskHp", x: 430, y: 330, r: 20, hitR: 26, aimDrag: false },
    { id: "flaskMp", x: 430, y: 278, r: 20, hitR: 26, aimDrag: false },
    { id: "interact", x: 438, y: 222, r: 22, hitR: 28, aimDrag: false },
  ],
};

/** 遊び・距離・時間（docs/progress D-TOUCH-3〜6）。仮値: 実機で確かめる。 */
export interface TouchTuning {
  /** 左スティックの遊び（輪の半径に対する割合。これ以下は動かない）。 */
  readonly moveDeadZone: number;
  /** 右スティックの遊び（これを超えている間だけ、照準を変えて通常攻撃を押し続ける）。 */
  readonly aimDeadZone: number;
  /** 照準の点の距離（メートル）：倒し具合（遊びを超えた分）で min〜max。 */
  readonly aimDistance: { readonly min: number; readonly max: number };
  /** 技のボタンのドラッグ：遊び（ピクセル）と、射程いっぱいになる長さ（ピクセル）。 */
  readonly skillDrag: { readonly deadZone: number; readonly full: number };
  /** 技のボタンの射程が分からないときの距離（メートル）。 */
  readonly skillDefaultRange: number;
  /**
   * 技のボタンを押してから、ドラッグを待つ時間（ミリ秒）。この間にドラッグが遊びを超えたらその向きに、
   * 超えなければ時間が来たときに今の照準で出す（離せばすぐ出す）。0 なら押した瞬間に出す。
   */
  readonly skillAimGraceMs: number;
  /**
   * 右スティックを倒しておらず、技のボタンもドラッグしていない間は、移動の向きを照準にするか（補助仕様書1.2のゲームパッドの案。
   * D-TOUCH-6。初期は true）。移動も照準もしていないときは最後の向きのまま。
   */
  readonly aimFollowsMove: boolean;
}

export const TOUCH_TUNING: TouchTuning = {
  moveDeadZone: 0.18,
  aimDeadZone: 0.25,
  aimDistance: { min: 1, max: 8 },
  skillDrag: { deadZone: 12, full: 48 },
  skillDefaultRange: 8,
  skillAimGraceMs: 120,
  aimFollowsMove: true,
};

/** 1フレーム分のタッチの入力。 */
export interface TouchFrame {
  readonly held: ReadonlySet<Action>;
  readonly pressed: ReadonlySet<Action>;
  /** 移動の向き（長さ1。止まっているときは 0,0）。sim は長さを揃えて使うので、速さはキーボードと同じ。 */
  readonly move: Point;
  /** 照準の向き（長さ1）。 */
  readonly aim: Point;
  /** 照準の点までの距離（メートル）。 */
  readonly aimDistance: number;
  /** 今、照準を指で動かしているか（右スティック・技のドラッグ）。 */
  readonly aiming: boolean;
}

/** スティックの描画用の状態。 */
export interface StickState {
  readonly active: boolean;
  /** 輪の中心（触れていなければ rest）。 */
  readonly center: Point;
  /** 中の丸の位置。 */
  readonly knob: Point;
  /** 倒した量（0〜1）。 */
  readonly amount: number;
  /** 遊びを超えているか。 */
  readonly engaged: boolean;
}

/** ボタンの描画用の状態。 */
export interface ButtonState {
  readonly id: TouchButtonId;
  readonly visible: boolean;
  readonly down: boolean;
  /** ドラッグで狙っている（遊びを超えた）ときの向き。 */
  readonly drag: Point | undefined;
}

export interface TouchControlsState {
  readonly left: StickState;
  readonly right: StickState;
  readonly buttons: readonly ButtonState[];
  /** 結び付いている指の数（どの操作部にも当たらなかった指 none も数える）。 */
  readonly fingers: number;
}

type Binding =
  | { readonly kind: "left" | "right"; readonly center: Point; pos: Point }
  | {
      readonly kind: "button";
      readonly id: TouchButtonId;
      readonly start: Point;
      pos: Point;
      readonly downAt: number;
      /** 技を出したか（ドラッグで狙うボタンは、遊びを超えるか待つ時間が過ぎるまで出さない）。 */
      fired: boolean;
      /** 最後に遊びを超えていたドラッグの向きと距離。 */
      drag: { readonly dir: Point; readonly distance: number } | undefined;
      /** 最後の frame() で渡された技の射程（メートル。離したときのドラッグの距離の計算に使う）。 */
      range: number | undefined;
    }
  /** どの操作部にも当たらなかった指（他の指の邪魔をしないよう、覚えておくだけ）。 */
  | { readonly kind: "none" };

const ZERO: Point = { x: 0, y: 0 };
const SKILL_SLOTS: readonly TouchButtonId[] = ["skill2", "skill3", "skill4", "skill5", "skill6"];
/** 技の枠のボタンか。 */
export const isSkillSlot = (id: TouchButtonId): id is TouchSkillSlot => SKILL_SLOTS.includes(id);
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const inRect = (r: Rect, p: Point): boolean =>
  p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;

/** 倒した量を、遊びを除いた 0〜1 に直す（遊び以下は 0）。 */
export function pastDeadZone(amount: number, deadZone: number): number {
  if (!(amount > deadZone)) return 0;
  return clamp01((amount - deadZone) / (1 - deadZone));
}

/** スティックの中心からの位置を、輪の中に収めた位置・倒した量（0〜1）・向き（長さ1。0 なら 0,0）にする。 */
export function stickVector(
  center: Point,
  pos: Point,
  radius: number,
): { readonly knob: Point; readonly amount: number; readonly dir: Point } {
  const dx = pos.x - center.x;
  const dy = pos.y - center.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 0) || !(radius > 0)) return { knob: center, amount: 0, dir: ZERO };
  const dir = { x: dx / len, y: dy / len };
  const k = Math.min(len, radius);
  return { knob: { x: center.x + dir.x * k, y: center.y + dir.y * k }, amount: k / radius, dir };
}

/**
 * 照準の点（世界の座標・ピクセル）：プレイヤーの位置＋照準の向き×距離。
 * @param origin プレイヤーの位置（ピクセル）
 * @param pixelsPerMeter 1メートルのピクセル数
 */
export function aimWorldPoint(
  origin: Point,
  aim: Point,
  distanceMeters: number,
  pixelsPerMeter: number,
): Point {
  return {
    x: origin.x + aim.x * distanceMeters * pixelsPerMeter,
    y: origin.y + aim.y * distanceMeters * pixelsPerMeter,
  };
}

/** 画面の位置に当たるボタン（見えているものだけ。重なる所は中心が近い方）。 */
export function buttonAt(
  buttons: readonly TouchButtonDef[],
  p: Point,
  visible: (id: TouchButtonId) => boolean = () => true,
): TouchButtonDef | undefined {
  let best: TouchButtonDef | undefined;
  let bestD = Infinity;
  for (const b of buttons) {
    if (!visible(b.id)) continue;
    const d = Math.hypot(p.x - b.x, p.y - b.y);
    if (d <= b.hitR && d < bestD) {
      best = b;
      bestD = d;
    }
  }
  return best;
}

/** タッチ操作のモデル。1フレームに1回 frame() を呼ぶ。指の出来事（down・move・up・cancel）はいつ呼んでもよい。 */
export class TouchControls {
  readonly layout: TouchLayout;
  readonly tuning: TouchTuning;
  private readonly fingers = new Map<number, Binding>();
  /** 見えていないボタン（調べるのボタンは、近くに対象があるときだけ）。 */
  private readonly hidden = new Set<TouchButtonId>();
  /** 前の frame() の後に押した行動（同じフレームの間に押して離した入力も取りこぼさない）。 */
  private readonly latched = new Set<Action>();
  /** 最後の照準の向き（長さ1）と距離（メートル）。離しても覚えておく。 */
  private aimDir: Point = { x: 1, y: 0 };
  private aimDist: number;
  /** ドラッグせずに離した（タップで出す）技の枠。次の frame() で、その技の射程の半分を照準の距離にする（D-TOUCH-4）。 */
  private readonly tapSlots: TouchSkillSlot[] = [];

  constructor(layout: TouchLayout = TOUCH_LAYOUT, tuning: TouchTuning = TOUCH_TUNING) {
    this.layout = layout;
    this.tuning = tuning;
    this.aimDist = tuning.aimDistance.min;
  }

  /** ボタンを出す・隠す。隠したボタンを押している指は離す（押しっぱなしにしない）。 */
  setVisible(id: TouchButtonId, visible: boolean): void {
    if (visible) {
      this.hidden.delete(id);
      return;
    }
    if (this.hidden.has(id)) return;
    this.hidden.add(id);
    for (const [finger, b] of this.fingers)
      if (b.kind === "button" && b.id === id) this.fingers.set(finger, { kind: "none" });
  }

  isVisible(id: TouchButtonId): boolean {
    return !this.hidden.has(id);
  }

  /** 照準の向きを決める（始めの向き。長さ0なら変えない）。 */
  setAim(dir: Point): void {
    const len = Math.hypot(dir.x, dir.y);
    if (len > 0) this.aimDir = { x: dir.x / len, y: dir.y / len };
  }

  /** 指が触れた。結び付いた操作部（何にも当たらなければ none）を返す。同じ id の指が残っていれば、先に離す。 */
  down(id: number, x: number, y: number, now: number): "left" | "right" | TouchButtonId | "none" {
    if (this.fingers.has(id)) this.up(id);
    const p = { x, y };
    const button = buttonAt(this.layout.buttons, p, (b) => this.isVisible(b));
    if (button !== undefined) {
      this.fingers.set(id, {
        kind: "button",
        id: button.id,
        start: p,
        pos: p,
        downAt: now,
        fired: !button.aimDrag || this.tuning.skillAimGraceMs <= 0,
        drag: undefined,
        range: undefined,
      });
      // ドラッグで狙わないボタン（回避・薬瓶・調べる）は、押した瞬間に押したことにする
      if (!button.aimDrag || this.tuning.skillAimGraceMs <= 0) this.latched.add(button.id);
      return button.id;
    }
    for (const kind of ["right", "left"] as const) {
      const stick = kind === "left" ? this.layout.leftStick : this.layout.rightStick;
      if (!inRect(stick.zone, p)) continue;
      // 同じスティックを別の指が使っていれば、この指は何もしない
      if ([...this.fingers.values()].some((b) => b.kind === kind)) break;
      this.fingers.set(id, { kind, center: p, pos: p });
      return kind;
    }
    this.fingers.set(id, { kind: "none" });
    return "none";
  }

  /** 指が動いた（結び付いていない指は無視する）。 */
  move(id: number, x: number, y: number): void {
    const b = this.fingers.get(id);
    if (b === undefined || b.kind === "none") return;
    b.pos = { x, y };
  }

  /** 指が離れた。ドラッグで狙うボタンをまだ出していなければ、ここで出す（タップ）。 */
  up(id: number): void {
    const b = this.fingers.get(id);
    this.fingers.delete(id);
    if (b === undefined) return;
    if (b.kind === "button") {
      const drag = this.dragOf(b);
      if (drag !== undefined) {
        this.aimDir = drag.dir;
        this.aimDist = drag.distance;
      }
      if (!b.fired) {
        this.latched.add(b.id);
        if (drag === undefined && isSkillSlot(b.id)) this.tapSlots.push(b.id);
      }
    } else if (b.kind === "right") {
      this.rememberStickAim(b);
    }
  }

  /** 指が取り消された（touchcancel など）：何も出さずに離す（押した瞬間に溜めた入力も消す）。 */
  cancel(id: number): void {
    const b = this.fingers.get(id);
    this.fingers.delete(id);
    if (b?.kind === "button") this.latched.delete(b.id);
  }

  /** 全ての指を離す（取り消し。画面を開いた・縦持ちにした・タッチの表示をやめた、など）。 */
  cancelAll(): void {
    this.fingers.clear();
    this.latched.clear();
    this.tapSlots.length = 0;
  }

  /** ids に無い指を離す（取り逃した離した出来事の後始末。押しっぱなしにしない）。 */
  retain(ids: ReadonlySet<number>): void {
    for (const id of [...this.fingers.keys()]) if (!ids.has(id)) this.cancel(id);
  }

  /** 結び付いている指の数（どの操作部にも当たらなかった指 none も数える）。 */
  get fingerCount(): number {
    return this.fingers.size;
  }

  private stickBinding(kind: "left" | "right"): (Binding & { kind: "left" | "right" }) | undefined {
    for (const b of this.fingers.values()) if (b.kind === kind) return b;
    return undefined;
  }

  private rememberStickAim(b: Binding & { kind: "left" | "right" }): void {
    const s = this.layout.rightStick;
    const v = stickVector(b.center, b.pos, s.radius);
    const m = pastDeadZone(v.amount, this.tuning.aimDeadZone);
    if (m <= 0) return;
    this.aimDir = v.dir;
    this.aimDist = this.distanceFor(m, this.tuning.aimDistance.max);
  }

  private distanceFor(ratio: number, max: number): number {
    const min = this.tuning.aimDistance.min;
    return min + (Math.max(min, max) - min) * clamp01(ratio);
  }

  /** 技のボタンのドラッグ（遊びを超えていれば、向きと距離）。 */
  private dragOf(
    b: Binding & { kind: "button" },
    range?: number,
  ): { readonly dir: Point; readonly distance: number } | undefined {
    const def = this.layout.buttons.find((x) => x.id === b.id);
    if (def?.aimDrag !== true) return undefined;
    const dx = b.pos.x - b.start.x;
    const dy = b.pos.y - b.start.y;
    const len = Math.hypot(dx, dy);
    const d = this.tuning.skillDrag;
    if (!(len > d.deadZone)) return b.drag;
    const ratio = (len - d.deadZone) / Math.max(1, d.full - d.deadZone);
    b.drag = {
      dir: { x: dx / len, y: dy / len },
      distance: this.distanceFor(ratio, range ?? b.range ?? this.tuning.skillDefaultRange),
    };
    return b.drag;
  }

  /**
   * このフレームの入力を作る（1フレームに1回）。
   * @param now 今の時刻（ミリ秒。技のボタンのドラッグを待つ時間に使う）
   * @param skillRange 技の枠の射程（メートル。ドラッグの距離の上限）。分からなければ undefined
   */
  frame(
    now: number,
    skillRange: (slot: TouchSkillSlot) => number | undefined = () => undefined,
  ): TouchFrame {
    const held = new Set<Action>();
    const pressed = new Set<Action>(this.latched);
    this.latched.clear();
    const t = this.tuning;

    // 左スティック：遊びを超えたら、その向きへ（長さ1）
    let move: Point = ZERO;
    const left = this.stickBinding("left");
    if (left !== undefined) {
      const v = stickVector(left.center, left.pos, this.layout.leftStick.radius);
      if (pastDeadZone(v.amount, t.moveDeadZone) > 0) move = v.dir;
    }

    // 照準：一番新しい技のドラッグ ＞ 右スティック ＞ 覚えている向き
    let aiming = false;
    let dragAim: { dir: Point; distance: number; at: number } | undefined;
    for (const b of this.fingers.values()) {
      if (b.kind !== "button" || !isSkillSlot(b.id)) continue;
      const range = skillRange(b.id) ?? t.skillDefaultRange;
      b.range = range;
      const drag = this.dragOf(b, range);
      if (drag !== undefined && (dragAim === undefined || b.downAt >= dragAim.at))
        dragAim = { ...drag, at: b.downAt };
    }
    const right = this.stickBinding("right");
    if (dragAim !== undefined) {
      this.aimDir = dragAim.dir;
      this.aimDist = dragAim.distance;
      aiming = true;
    } else if (right !== undefined) {
      const v = stickVector(right.center, right.pos, this.layout.rightStick.radius);
      const m = pastDeadZone(v.amount, t.aimDeadZone);
      if (m > 0) {
        this.aimDir = v.dir;
        this.aimDist = this.distanceFor(m, t.aimDistance.max);
        aiming = true;
      }
    }
    // 右スティックにも技のドラッグにも触れていない間は、移動の向きを照準にする（D-TOUCH-6）
    if (!aiming && t.aimFollowsMove && (move.x !== 0 || move.y !== 0)) this.aimDir = move;
    // ドラッグせずに技のボタンを押した（タップ・押しっぱなし）：距離はその技の射程の半分（射程が無ければ今の距離。D-TOUCH-4）
    if (!aiming) {
      let slot: TouchSkillSlot | undefined = this.tapSlots.at(-1);
      let latest = -Infinity;
      for (const b of this.fingers.values())
        if (
          b.kind === "button" &&
          isSkillSlot(b.id) &&
          b.drag === undefined &&
          (b.fired || now - b.downAt >= t.skillAimGraceMs) &&
          b.downAt >= latest
        ) {
          slot = b.id;
          latest = b.downAt;
        }
      const range = slot === undefined ? undefined : skillRange(slot);
      if (range !== undefined) this.aimDist = Math.max(t.aimDistance.min, range / 2);
    }
    this.tapSlots.length = 0;
    // 右スティックを遊びより倒している間は、通常攻撃（skill1）を押し続ける
    if (right !== undefined) {
      const v = stickVector(right.center, right.pos, this.layout.rightStick.radius);
      if (pastDeadZone(v.amount, t.aimDeadZone) > 0) held.add("skill1");
    }

    // ボタン：押している間 held。ドラッグで狙うボタンは、遊びを超えたか待つ時間が過ぎたら出す
    for (const b of this.fingers.values()) {
      if (b.kind !== "button") continue;
      if (!b.fired && (b.drag !== undefined || now - b.downAt >= t.skillAimGraceMs)) {
        b.fired = true;
        pressed.add(b.id);
      }
      if (b.fired) held.add(b.id);
    }
    return { held, pressed, move, aim: this.aimDir, aimDistance: this.aimDist, aiming };
  }

  /** 描画用の状態。 */
  state(): TouchControlsState {
    const stick = (kind: "left" | "right"): StickState => {
      const def = kind === "left" ? this.layout.leftStick : this.layout.rightStick;
      const b = this.stickBinding(kind);
      if (b === undefined)
        return { active: false, center: def.rest, knob: def.rest, amount: 0, engaged: false };
      const v = stickVector(b.center, b.pos, def.radius);
      const dead = kind === "left" ? this.tuning.moveDeadZone : this.tuning.aimDeadZone;
      return {
        active: true,
        center: b.center,
        knob: v.knob,
        amount: v.amount,
        engaged: pastDeadZone(v.amount, dead) > 0,
      };
    };
    const buttons = this.layout.buttons.map((def): ButtonState => {
      let down = false;
      let drag: Point | undefined;
      for (const b of this.fingers.values())
        if (b.kind === "button" && b.id === def.id) {
          down = true;
          if (b.drag !== undefined) drag = b.drag.dir;
        }
      return { id: def.id, visible: this.isVisible(def.id), down, drag };
    });
    return { left: stick("left"), right: stick("right"), buttons, fingers: this.fingers.size };
  }
}

/** タッチの表示の設定（端末ごと）：auto＝触れたらタッチの表示・マウス/キーで PC の表示、on・off＝固定。 */
export type TouchSetting = "auto" | "on" | "off";
export const TOUCH_SETTINGS: readonly TouchSetting[] = ["auto", "on", "off"];

/**
 * タッチの表示に切り替えるか（auto のとき）。タッチの直後に来るマウスの出来事（ブラウザが真似て出すもの）で
 * PC の表示に戻らないよう、最後のタッチから settleMs の間は、マウス・キーの入力では戻さない。
 */
export class TouchModeSwitch {
  private setting: TouchSetting = "auto";
  private touchActive: boolean;
  private lastTouchAt = -Infinity;
  private readonly settleMs: number;

  /**
   * @param touchPrimary 始めからタッチの表示にするか（主な入力がタッチの端末）
   * @param settleMs 最後のタッチから、マウス・キーで PC の表示に戻せるまでの時間（ミリ秒）。仮値: 1000
   */
  constructor(touchPrimary: boolean, settleMs = 1000) {
    this.touchActive = touchPrimary;
    this.settleMs = settleMs;
  }

  setSetting(s: TouchSetting): void {
    this.setting = s;
  }

  get currentSetting(): TouchSetting {
    return this.setting;
  }

  /** タッチの入力があった。 */
  noteTouch(now: number): void {
    this.lastTouchAt = now;
    this.touchActive = true;
  }

  /**
   * マウスが動いた・キーが押された。時刻が戻っていたら（now が最後のタッチより前。時計の調整など）、最後のタッチを
   * 今に合わせ直す（負の差のまま、いつまでも PC の表示に戻れなくならないように）。
   */
  noteDesktopInput(now: number): void {
    if (now < this.lastTouchAt) this.lastTouchAt = now;
    if (now - this.lastTouchAt >= this.settleMs) this.touchActive = false;
  }

  /** 今、タッチの表示にするか。 */
  get active(): boolean {
    return this.setting === "on" || (this.setting === "auto" && this.touchActive);
  }

  /**
   * 設定が off でも、指で触れている端末（触れた・主な入力がタッチ）では、「≡」「閉じる」だけは出す
   * （設定を開いて元に戻せなくならないように。D-TOUCH-10）。操作部（スティック・ボタン）は出さない。
   */
  get menuOnly(): boolean {
    return this.setting === "off" && this.touchActive;
  }
}

/**
 * 設定を、端末に合わせて直す：主な入力がタッチの端末では off を auto として扱う
 * （off にすると、指で操作する端末ではゲームを動かせなくなるため。D-TOUCH-10）。
 */
export function effectiveTouchSetting(s: TouchSetting, touchPrimary: boolean): TouchSetting {
  return touchPrimary && s === "off" ? "auto" : s;
}

/** タッチのメニュー（≡）の項目。fullscreen は、全画面にできるブラウザのときだけ出す。 */
export const TOUCH_MENU_ITEMS = [
  "inventory",
  "character",
  "starBoard",
  "jobBoard",
  "map",
  "settings",
  "showLoot",
  "fullscreen",
] as const;
export type TouchMenuItem = (typeof TOUCH_MENU_ITEMS)[number];

/** 画面の操作のボタン（離したときに、指がまだその上にあれば働く）。 */
export type TouchUiId = "menu" | "close" | "zoomIn" | "zoomOut" | TouchMenuItem;

/**
 * 画面の操作のボタンの配置（内部解像度 640×360。docs/progress D-TOUCH-2）。仮値: 実機で確かめる。
 * - menu：右上（小さな地図の左）の「≡」
 * - close：画面（インベントリなど）・大きな地図を開いている間の「閉じる」（右上。画面の枠の上の帯）
 * - zoomOut・zoomIn：盤（星辰盤・職紋盤）を開いている間の「−」「＋」（閉じるの左）
 * - menuGrid：≡ を押すと出る項目（3列。左上の位置と1つの大きさ・間隔）
 * menu と zoomOut・zoomIn は枠が重なるが、同時には出さない（menu は画面・大きな地図を閉じているときだけ、
 * zoomOut・zoomIn は盤を開いている間だけ）。
 */
export const TOUCH_UI_LAYOUT = {
  menu: { x: 494, y: 6, width: 36, height: 32 },
  close: { x: 566, y: 0, width: 70, height: 27 },
  zoomOut: { x: 488, y: 0, width: 34, height: 27 },
  zoomIn: { x: 526, y: 0, width: 34, height: 27 },
  menuGrid: { x: 226, y: 44, columns: 3, width: 98, height: 32, gap: 4 },
} as const;

/** メニューの i 番目の項目の枠。 */
export function menuItemRect(i: number): Rect {
  const g = TOUCH_UI_LAYOUT.menuGrid;
  return {
    x: g.x + (i % g.columns) * (g.width + g.gap),
    y: g.y + Math.floor(i / g.columns) * (g.height + g.gap),
    width: g.width,
    height: g.height,
  };
}

/** 枠の中か。 */
export function rectContains(r: Rect, p: Point): boolean {
  return inRect(r, p);
}

/**
 * 縦持ちの画面を出してゲームを止めるか（横向き専用。docs/progress TOUCH-4）。
 * タッチの端末で、高さが幅より大きいときだけ（PC のブラウザの窓を縦長にしただけのときは出さない）。
 */
export function shouldBlockPortrait(touchDevice: boolean, width: number, height: number): boolean {
  return touchDevice && height > width;
}
