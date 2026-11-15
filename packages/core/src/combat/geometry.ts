/**
 * 当たり判定（補助仕様書 10.1）。円・扇形・直線（矩形）。単位はm。
 */
import type { Vec2 } from "../player/controller.ts";

export interface Circle {
  pos: Vec2;
  radius: number;
}

export type HitShape =
  | { kind: "circle"; radius: number }
  | { kind: "cone"; range: number; arcDegrees: number }
  | { kind: "line"; length: number; width: number };

const TWO_PI = Math.PI * 2;

/** 角度の差を -π〜π にする */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return d;
}

/** 技の形が、対象の円に当たるか。origin から angle の向きに出す */
export function shapeHits(shape: HitShape, origin: Vec2, angle: number, target: Circle): boolean {
  const dx = target.pos.x - origin.x;
  const dy = target.pos.y - origin.y;
  const dist = Math.hypot(dx, dy);
  switch (shape.kind) {
    case "circle":
      return dist <= shape.radius + target.radius;
    case "cone": {
      if (dist > shape.range + target.radius) return false;
      if (dist <= target.radius) return true;
      const half = (shape.arcDegrees * Math.PI) / 360;
      // 対象の大きさの分だけ、角度に余裕を持たせる
      const slack = Math.asin(Math.min(1, target.radius / dist));
      return Math.abs(angleDiff(Math.atan2(dy, dx), angle)) <= half + slack;
    }
    case "line": {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const along = dx * cos + dy * sin;
      const across = -dx * sin + dy * cos;
      return (
        along >= -target.radius &&
        along <= shape.length + target.radius &&
        Math.abs(across) <= shape.width / 2 + target.radius
      );
    }
  }
}

/** 背面からの攻撃か。対象の向きの反対側120°（仮値）に攻撃者がいる */
export const BACK_ARC_DEGREES = 120;
export function isBackHit(attacker: Vec2, target: Vec2, targetFacing: number): boolean {
  const toAttacker = Math.atan2(attacker.y - target.y, attacker.x - target.x);
  const behind = targetFacing + Math.PI;
  return Math.abs(angleDiff(toAttacker, behind)) <= (BACK_ARC_DEGREES * Math.PI) / 360;
}
