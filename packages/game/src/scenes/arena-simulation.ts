// 仮実装: U-18a feature/town-and-dungeon-base で、町とダンジョンの地図に置き換える（試験用の場の計算）
import { FixedStepClock, PlayerMotion, StepInputBuffer, length } from "@stella/core";
import type { Action } from "../input/actions.ts";
import type { InputFrame } from "../input/frame.ts";
import { toMeters } from "../world/units.ts";

/** 試験用の場の大きさ（m）。 */
export const ARENA = { width: 40, height: 24 } as const;

/**
 * 回避の無敵時間を確かめるための「試験用の危険地帯」。
 * 2秒ごとに0.6秒の予兆（枠だけ）を出し、その後0.2秒だけ当たり判定が出る。
 */
export const HAZARD = {
  x: 26,
  y: 12,
  radius: 2.5,
  period: 2,
  telegraph: 0.6,
  active: 0.2,
} as const;

/**
 * 計算の刻みで使う「押した瞬間」の行動。これ以外の押した瞬間の入力は保持しない
 * （まだ使わない行動を保持し続けて、後で古い入力が発動するのを防ぐ）。
 */
const STEP_ACTIONS = ["dodge"] as const satisfies readonly Action[];
type StepAction = (typeof STEP_ACTIONS)[number];

/**
 * 試験用の場の計算（Phaser に依存しない。ArenaScene が描画のフレームごとに呼ぶ）。
 *
 * 入力の流れ：
 * 1. 取得：ArenaScene が InputSystem でフレームの入力を読み、{@link frame} に渡す
 * 2. 保持：押した瞬間の入力（回避）は {@link StepInputBuffer} に入れ、刻みで使われるまで残す
 * 3. 消費：各刻みが取り出す。刻みが0のフレームでは取り出されず、次のフレームに持ち越す
 *
 * 押し続けの入力（移動・照準）は、そのフレームの値を、そのフレームの全ての刻みに渡す。
 */
export class ArenaSimulation {
  readonly motion: PlayerMotion;
  readonly clock: FixedStepClock;
  private readonly stepInput = new StepInputBuffer<StepAction>();
  private elapsed = 0;
  private hits = 0;
  private avoided = 0;
  private resolvedCycle = -1;

  constructor(clock: FixedStepClock = new FixedStepClock()) {
    this.clock = clock;
    this.motion = new PlayerMotion({ x: 12, y: 12 }, undefined, {
      minX: 0.5,
      minY: 0.75,
      maxX: ARENA.width - 0.5,
      maxY: ARENA.height - 0.25,
    });
  }

  /** 計算を進めた時間の合計（秒）。 */
  get time(): number {
    return this.elapsed;
  }
  get hazardHits(): number {
    return this.hits;
  }
  get hazardAvoided(): number {
    return this.avoided;
  }
  /** 回避の入力を保持していて、まだどの刻みにも渡していないか。 */
  get dodgePending(): boolean {
    return this.stepInput.has("dodge");
  }

  /**
   * 描画の1フレーム分を進める。
   * @param deltaSeconds 前のフレームからの経過時間（秒）
   * @returns この呼び出しで進めた刻みの数
   */
  frame(deltaSeconds: number, input: InputFrame): number {
    // 時間の検証を先に行う（例外のときに入力だけが残らないように）
    const { steps } = this.clock.advance(deltaSeconds);
    this.stepInput.press(STEP_ACTIONS.filter((a) => input.pressed.has(a)));
    for (let i = 0; i < steps; i++) this.step(input);
    return steps;
  }

  private step(input: InputFrame): void {
    const pos = this.motion.position;
    const aim = {
      x: toMeters(input.pointerWorld.x) - pos.x,
      y: toMeters(input.pointerWorld.y) - pos.y,
    };
    this.motion.update(this.clock.stepSeconds, {
      move: input.move,
      aim,
      // 保持している回避の入力は、最初の刻みで取り出され、以降の刻みには渡らない
      dodge: this.stepInput.take("dodge"),
    });
    this.elapsed += this.clock.stepSeconds;
    this.updateHazard();
  }

  private updateHazard(): void {
    const cycle = Math.floor(this.elapsed / HAZARD.period);
    const t = this.elapsed - cycle * HAZARD.period;
    const active = t >= HAZARD.telegraph && t < HAZARD.telegraph + HAZARD.active;
    if (!active || this.resolvedCycle === cycle) return;
    const p = this.motion.position;
    const inside = length({ x: p.x - HAZARD.x, y: p.y - HAZARD.y }) <= HAZARD.radius;
    if (!inside) return;
    // 当たり判定が出ている間に1回だけ判定する。回避の無敵時間なら無効
    this.resolvedCycle = cycle;
    if (this.motion.invulnerable) this.avoided += 1;
    else this.hits += 1;
  }
}
