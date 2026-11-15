/**
 * 地面に置く効果（煙玉・罠）。時間で消え、範囲内の敵に作用する（本仕様書 5.6）。
 */
import type { Rng } from "../rng.ts";
import type { Vec2 } from "../player/controller.ts";
import { resolveHit, type Combatant, type HitResult, type HitSpec } from "./combatant.ts";

export interface Trap {
  pos: Vec2;
  left: number;
  /** 踏まれる半径 */
  radius: number;
  /** 起爆したときの能力値で計算する（本仕様書 5.6）ため、ヒットの内容は起爆時に作る */
  makeSpec: () => HitSpec;
}

export interface Smoke {
  pos: Vec2;
  left: number;
  radius: number;
  /** 敵の命中の低下（0.3） */
  accuracyPenalty: number;
  tick: number;
}

export type ZoneEvent =
  | { type: "trap"; trap: Trap; target: Combatant; result: HitResult }
  | { type: "smoke"; smoke: Smoke; target: Combatant };

export class GroundEffects {
  readonly traps: Trap[] = [];
  readonly smokes: Smoke[] = [];

  placeTrap(trap: Trap, max: number): void {
    this.traps.push(trap);
    // 上限を超えたら、最も古いものから消える
    while (this.traps.length > max) this.traps.shift();
  }

  placeSmoke(smoke: Omit<Smoke, "tick">): void {
    this.smokes.push({ ...smoke, tick: 0 });
  }

  step(dt: number, enemies: readonly Combatant[], rng: Rng): ZoneEvent[] {
    const events: ZoneEvent[] = [];
    for (const trap of [...this.traps]) {
      trap.left -= dt;
      const stepped = enemies.find(
        (e) =>
          e.hp > 0 &&
          Math.hypot(e.pos.x - trap.pos.x, e.pos.y - trap.pos.y) <= trap.radius + e.radius,
      );
      if (stepped) {
        const result = resolveHit(trap.pos, stepped, trap.makeSpec(), rng);
        events.push({ type: "trap", trap, target: stepped, result });
        trap.left = 0;
      }
    }
    for (const smoke of this.smokes) {
      smoke.left -= dt;
      smoke.tick += dt;
      const inside = enemies.filter(
        (e) =>
          e.hp > 0 &&
          Math.hypot(e.pos.x - smoke.pos.x, e.pos.y - smoke.pos.y) <= smoke.radius + e.radius,
      );
      for (const e of inside) {
        e.accuracyPenalty = { value: smoke.accuracyPenalty, left: 0.5 };
      }
      // 中の敵に毎秒、衰弱を必ず付与する
      if (smoke.tick >= 1) {
        smoke.tick -= 1;
        for (const e of inside) {
          e.ailments.apply("weaken", { reference: {} });
          events.push({ type: "smoke", smoke, target: e });
        }
      }
    }
    const alive = (list: { left: number }[]): void => {
      for (let i = list.length - 1; i >= 0; i--) if ((list[i]?.left ?? 0) <= 0) list.splice(i, 1);
    };
    alive(this.traps);
    alive(this.smokes);
    return events;
  }
}
