/**
 * 毒だまり（毒蛇座の完成ボーナス）：毒が10スタック以上の敵が移動すると、通った場所に毒だまりができる
 * （毒の基準値の20%／秒）。出血が毒として数えられるとき（毒血同源）は、出血も毒のスタックに数える。
 */
import type { Vec2 } from "../player/controller.ts";
import type { Combatant } from "./combatant.ts";

export interface PoisonPool {
  pos: Vec2;
  radius: number;
  left: number;
  /** 毎秒のダメージ（毒の基準値の20%） */
  dps: number;
}

export const POOL_RADIUS = 1.5;
export const POOL_SECONDS = 3;
/** 前のだまりからこの距離だけ動くと、次のだまりを置く */
export const POOL_SPACING = 1.2;

export class PoisonTrail {
  readonly pools: PoisonPool[] = [];
  private readonly lastDrop = new Map<Combatant, Vec2>();

  /** dt秒進める。rule は毒だまりのパラメータ（なければ何もしない）。ダメージを受けた敵の数を返す */
  step(
    dt: number,
    enemies: readonly Combatant[],
    rule: Readonly<Record<string, unknown>> | undefined,
  ): number {
    let damaged = 0;
    if (rule) {
      const min = typeof rule["minStacks"] === "number" ? rule["minStacks"] : 10;
      const ratio = typeof rule["ratioPerSecond"] === "number" ? rule["ratioPerSecond"] : 0.2;
      for (const e of enemies) {
        if (e.hp <= 0) continue;
        const stacks = e.ailments.countedStacks("poison");
        if (stacks < min) {
          this.lastDrop.set(e, { ...e.pos });
          continue;
        }
        const last = this.lastDrop.get(e);
        if (!last) {
          // 最初に見たときの位置を覚える
          this.lastDrop.set(e, { ...e.pos });
          continue;
        }
        if (Math.hypot(e.pos.x - last.x, e.pos.y - last.y) >= POOL_SPACING) {
          // 毒の基準値：スタックの総量から逆算する（毒は基準値×0.6、出血は×1.5）
          const poisonRef =
            e.ailments.exportStacks("poison").reduce((a, s) => a + s.total, 0) / 0.6;
          const bleedRef = e.ailments.exportStacks("bleed").reduce((a, s) => a + s.total, 0) / 1.5;
          this.pools.push({
            pos: { ...e.pos },
            radius: POOL_RADIUS,
            left: POOL_SECONDS,
            dps: ratio * (poisonRef + (stacks > e.ailments.stackCount("poison") ? bleedRef : 0)),
          });
          this.lastDrop.set(e, { ...e.pos });
        }
      }
    }
    for (const pool of this.pools) {
      pool.left -= dt;
      for (const e of enemies) {
        if (e.hp <= 0) continue;
        if (Math.hypot(e.pos.x - pool.pos.x, e.pos.y - pool.pos.y) <= pool.radius + e.radius) {
          e.hp = Math.max(0, e.hp - pool.dps * dt * (1 - (e.resistance.dark ?? 0)));
          damaged++;
        }
      }
    }
    for (let i = this.pools.length - 1; i >= 0; i--) {
      if ((this.pools[i]?.left ?? 0) <= 0) this.pools.splice(i, 1);
    }
    return damaged;
  }
}
