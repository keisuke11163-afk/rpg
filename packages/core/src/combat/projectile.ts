/**
 * 投射物（使い回す）。毎回 new せず、プールから借りて、終わったら返す（開発計画書 T16）。
 */
import type { Vec2 } from "../player/controller.ts";
import type { Circle } from "./geometry.ts";

export interface Projectile {
  active: boolean;
  pos: Vec2;
  vel: Vec2;
  radius: number;
  /** 残りの飛距離（m） */
  range: number;
  /** 貫通できる残りの数 */
  pierce: number;
  /** すでに当てた対象（同じ対象に何度も当てない） */
  hitIds: Set<string>;
  /** 発射した側が持たせる任意の値（技のID・ヒットの内容など） */
  payload: unknown;
}

export class ProjectilePool {
  private readonly items: Projectile[] = [];

  /** 借りる。空きがなければ増やす */
  spawn(init: {
    pos: Vec2;
    angle: number;
    speed: number;
    radius: number;
    range: number;
    pierce?: number;
    payload?: unknown;
  }): Projectile {
    let p = this.items.find((x) => !x.active);
    if (!p) {
      p = {
        active: false,
        pos: { x: 0, y: 0 },
        vel: { x: 0, y: 0 },
        radius: 0,
        range: 0,
        pierce: 0,
        hitIds: new Set(),
        payload: undefined,
      };
      this.items.push(p);
    }
    p.active = true;
    p.pos.x = init.pos.x;
    p.pos.y = init.pos.y;
    p.vel.x = Math.cos(init.angle) * init.speed;
    p.vel.y = Math.sin(init.angle) * init.speed;
    p.radius = init.radius;
    p.range = init.range;
    p.pierce = init.pierce ?? 0;
    p.hitIds.clear();
    p.payload = init.payload;
    return p;
  }

  get activeCount(): number {
    return this.items.filter((p) => p.active).length;
  }

  /** プールに作られた総数（使い回しの確認用） */
  get capacity(): number {
    return this.items.length;
  }

  /** dt秒進め、対象に当たった投射物と対象の組を返す。貫通がなくなった・射程が尽きた投射物は返す */
  step(
    dt: number,
    targets: readonly (Circle & { id: string; hp: number })[],
  ): {
    projectile: Projectile;
    target: Circle & { id: string };
  }[] {
    const hits: { projectile: Projectile; target: Circle & { id: string } }[] = [];
    for (const p of this.items) {
      if (!p.active) continue;
      const dist = Math.hypot(p.vel.x, p.vel.y) * dt;
      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;
      p.range -= dist;
      for (const t of targets) {
        if (t.hp <= 0 || p.hitIds.has(t.id)) continue;
        if (Math.hypot(t.pos.x - p.pos.x, t.pos.y - p.pos.y) <= t.radius + p.radius) {
          p.hitIds.add(t.id);
          hits.push({ projectile: p, target: t });
          if (p.pierce <= 0) {
            p.active = false;
            break;
          }
          p.pierce--;
        }
      }
      if (p.range <= 0) p.active = false;
    }
    return hits;
  }
}
