import { describe, expect, it } from "vitest";
import {
  DEFAULT_MOTION,
  FIXED_STEP_SECONDS,
  type MotionInput,
  PlayerMotion,
  toDirection8,
} from "../src/index.ts";

const dt = FIXED_STEP_SECONDS;
const idle: MotionInput = { move: { x: 0, y: 0 }, aim: { x: 1, y: 0 }, dodge: false };
function run(m: PlayerMotion, seconds: number, input: MotionInput): void {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) m.update(dt, i === 0 ? input : { ...input, dodge: false });
}

describe("移動（補助仕様書 1.1・3.1）", () => {
  it("毎秒5m進む。斜めでも速さは同じ（長さ1に揃える）", () => {
    const a = new PlayerMotion({ x: 0, y: 0 });
    run(a, 1, { ...idle, move: { x: 1, y: 0 } });
    expect(a.position.x).toBeCloseTo(5);
    const b = new PlayerMotion({ x: 0, y: 0 });
    run(b, 1, { ...idle, move: { x: 1, y: 1 } });
    expect(Math.hypot(b.position.x, b.position.y)).toBeCloseTo(5);
  });

  it("移動できる範囲の外には出ない", () => {
    const m = new PlayerMotion({ x: 1, y: 1 }, DEFAULT_MOTION, {
      minX: 0,
      minY: 0,
      maxX: 10,
      maxY: 10,
    });
    run(m, 2, { ...idle, move: { x: -1, y: -1 } });
    expect(m.position).toEqual({ x: 0, y: 0 });
  });
});

describe("照準と見た目の向き（補助仕様書 1.1・2章）", () => {
  it("向きは照準の角度そのもの、見た目は8方向に丸める", () => {
    const m = new PlayerMotion({ x: 0, y: 0 });
    m.update(dt, { ...idle, aim: { x: 1, y: 1 } });
    expect(m.facing).toBeCloseTo(Math.PI / 4);
    expect(m.direction8).toBe(1);
    m.update(dt, { ...idle, aim: { x: 0, y: -1 } });
    expect(m.direction8).toBe(6);
  });

  it("照準がない（長さ0）ときは向きを変えない", () => {
    const m = new PlayerMotion({ x: 0, y: 0 });
    m.update(dt, { ...idle, aim: { x: -1, y: 0 } });
    m.update(dt, { ...idle, aim: { x: 0, y: 0 } });
    expect(m.direction8).toBe(4);
  });

  it("8方向の丸め", () => {
    expect(
      [0, Math.PI / 2, Math.PI, -Math.PI / 2, (Math.PI * 7) / 4, 0.3, -0.3].map(toDirection8),
    ).toEqual([0, 2, 4, 6, 7, 0, 0]);
  });
});

describe("回避（仕様書v0.2 2.1・補助仕様書 3.1）", () => {
  it("0.35秒で4m進む。移動の入力の方向へ", () => {
    const m = new PlayerMotion({ x: 0, y: 0 });
    run(m, 0.35, { ...idle, move: { x: 0, y: 1 }, dodge: true });
    expect(m.position.y).toBeCloseTo(4, 1);
    expect(m.dodging).toBe(false);
  });

  it("移動の入力がなければ、照準の方向へ", () => {
    const m = new PlayerMotion({ x: 0, y: 0 });
    run(m, 0.35, { ...idle, aim: { x: -1, y: 0 }, dodge: true });
    expect(m.position.x).toBeCloseTo(-4, 1);
  });

  it("最初の0.3秒だけ攻撃を受けない", () => {
    const m = new PlayerMotion({ x: 0, y: 0 });
    m.update(dt, { ...idle, dodge: true });
    let invulnerableSteps = 0;
    expect(m.invulnerable).toBe(true);
    for (let i = 0; i < 40; i++) {
      if (m.invulnerable) invulnerableSteps++;
      m.update(dt, idle);
    }
    expect(invulnerableSteps * dt).toBeCloseTo(0.3 - dt, 1);
    expect(m.invulnerable).toBe(false);
  });

  it("気力を25使う。足りなければ回避できない。毎秒20回復する", () => {
    const m = new PlayerMotion({ x: 0, y: 0 });
    for (let i = 0; i < 4; i++) run(m, 0.35, { ...idle, dodge: true });
    expect(m.currentStamina).toBeLessThan(25);
    m.update(dt, { ...idle, dodge: true });
    expect(m.dodging).toBe(false);
    run(m, 1, idle);
    expect(m.currentStamina).toBeGreaterThan(20);
  });

  it("回避の間は移動の入力を受け付けない", () => {
    const m = new PlayerMotion({ x: 0, y: 0 });
    m.update(dt, { ...idle, move: { x: 1, y: 0 }, dodge: true });
    for (let i = 0; i < 20; i++) m.update(dt, { ...idle, move: { x: -1, y: 0 } });
    expect(m.position.x).toBeGreaterThan(3);
  });
});
