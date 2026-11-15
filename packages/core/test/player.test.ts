import { describe, expect, it } from "vitest";
import {
  DEFAULT_BINDINGS,
  PLAYER,
  TICK_SECONDS,
  canBeHit,
  createPlayer,
  facing8,
  isDodging,
  moveVector,
  pressedActions,
  stepPlayer,
  type PlayerInput,
} from "../src/index.ts";

const idle: PlayerInput = { move: { x: 0, y: 0 }, aimPoint: { x: 10, y: 0 }, dodgePressed: false };
const run = (seconds: number, fn: () => PlayerInput, p = createPlayer()) => {
  for (let i = 0; i < Math.round(seconds / TICK_SECONDS); i++) stepPlayer(p, fn(), TICK_SECONDS);
  return p;
};

describe("入力の抽象化", () => {
  it("WASDを行動にし、斜めは正規化する", () => {
    const a = pressedActions(new Set(["KeyW", "KeyD"]));
    const v = moveVector(a);
    expect(v.x).toBeCloseTo(Math.SQRT1_2);
    expect(v.y).toBeCloseTo(-Math.SQRT1_2);
    expect(moveVector(pressedActions(new Set(["KeyA", "KeyD"])))).toEqual({ x: 0, y: 0 });
  });
  it("割り当てを差し替えられる", () => {
    const a = pressedActions(new Set(["ArrowUp"]), { ...DEFAULT_BINDINGS, moveUp: ["ArrowUp"] });
    expect(a.has("moveUp")).toBe(true);
  });
  it("向きは8方向に丸める", () => {
    expect(facing8(0)).toBe(0);
    expect(facing8(Math.PI / 2)).toBe(2);
    expect(facing8(-Math.PI / 2)).toBe(6);
    expect(facing8(0.2)).toBe(0);
    expect(facing8(Math.PI / 4 + 0.01)).toBe(1);
  });
});

describe("移動と回避", () => {
  it("毎秒5mで移動する", () => {
    const p = run(1, () => ({ ...idle, move: { x: 1, y: 0 } }));
    expect(p.pos.x).toBeCloseTo(5, 1);
  });
  it("照準はマウスの位置の方向", () => {
    const p = createPlayer();
    stepPlayer(p, { ...idle, aimPoint: { x: 0, y: 5 } }, TICK_SECONDS);
    expect(p.aimAngle).toBeCloseTo(Math.PI / 2);
  });
  it("回避：0.35秒で4m、気力25、最初の0.3秒は無敵", () => {
    const p = createPlayer();
    stepPlayer(p, { ...idle, move: { x: 0, y: 1 }, dodgePressed: true }, TICK_SECONDS);
    expect(isDodging(p)).toBe(true);
    expect(p.stamina).toBeCloseTo(75);
    expect(canBeHit(p)).toBe(false);
    let invulnerableTicks = 1;
    let t = TICK_SECONDS;
    while (isDodging(p)) {
      stepPlayer(p, idle, TICK_SECONDS);
      t += TICK_SECONDS;
      if (!canBeHit(p)) invulnerableTicks++;
    }
    expect(t).toBeCloseTo(0.35, 1);
    expect(invulnerableTicks * TICK_SECONDS).toBeCloseTo(0.3, 1);
    expect(p.pos.y).toBeCloseTo(4, 1);
    expect(canBeHit(p)).toBe(true);
  });
  it("移動していなければ照準の方向へ回避する", () => {
    const p = createPlayer();
    stepPlayer(p, { ...idle, aimPoint: { x: -9, y: 0 }, dodgePressed: true }, TICK_SECONDS);
    expect(p.dodgeDir.x).toBeCloseTo(-1);
  });
  it("気力が足りないと回避できず、毎秒20回復する", () => {
    const p = createPlayer();
    p.stamina = 10;
    stepPlayer(p, { ...idle, dodgePressed: true }, TICK_SECONDS);
    expect(isDodging(p)).toBe(false);
    run(1, () => idle, p);
    expect(p.stamina).toBeCloseTo(30, 0);
    expect(PLAYER.staminaMax).toBe(100);
  });
  it("回避中は連続で回避できない。無敵の間に攻撃（テストの的）を受けない", () => {
    const p = createPlayer();
    stepPlayer(p, { ...idle, dodgePressed: true }, TICK_SECONDS);
    stepPlayer(p, { ...idle, dodgePressed: true }, TICK_SECONDS);
    expect(p.stamina).toBeCloseTo(75);
  });
  it("よろめき中は動けない", () => {
    const p = createPlayer();
    p.stunLeft = 0.6;
    stepPlayer(p, { ...idle, move: { x: 1, y: 0 } }, 0.1);
    expect(p.pos.x).toBe(0);
  });
});
