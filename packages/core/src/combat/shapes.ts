import type { Vec2 } from "../actor/vector.ts";

/**
 * 攻撃の当たり判定の形（補助仕様書 3.6：扇形・直線・周囲）。単位はm。
 * 形は、攻撃する側の位置を原点に、向きに合わせて置く。受ける側は円（半径 radius）として判定する。
 */
export type HitShape =
  | { readonly type: "circle"; readonly radius: number }
  | { readonly type: "sector"; readonly radius: number; readonly angleDeg: number }
  | { readonly type: "line"; readonly length: number; readonly width: number };

/** 形の中に、中心 point・半径 targetRadius の円が入るか（少しでも重なれば当たり）。 */
export function overlapsShape(
  shape: HitShape,
  origin: Vec2,
  facing: number,
  point: Vec2,
  targetRadius: number,
): boolean {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const dist = Math.hypot(dx, dy);
  switch (shape.type) {
    case "circle":
      return dist <= shape.radius + targetRadius;
    case "sector": {
      if (dist > shape.radius + targetRadius) return false;
      if (dist <= targetRadius) return true; // 重なっている
      const angle = Math.atan2(dy, dx);
      let diff = Math.abs(angle - facing) % (2 * Math.PI);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      // 受ける側の大きさの分だけ、角度に余裕を持たせる
      const allowance = Math.asin(Math.min(1, targetRadius / dist));
      return diff <= (shape.angleDeg * Math.PI) / 360 + allowance;
    }
    case "line": {
      const cos = Math.cos(facing);
      const sin = Math.sin(facing);
      const along = dx * cos + dy * sin;
      const across = -dx * sin + dy * cos;
      return (
        along >= -targetRadius &&
        along <= shape.length + targetRadius &&
        Math.abs(across) <= shape.width / 2 + targetRadius
      );
    }
  }
}

/**
 * 背面からの攻撃か（仕様書5.6・v0.2 5.1：敵の後方90°からのヒット）。
 * 受ける側の向きの真後ろから、左右45°以内に攻撃する側がいれば背面。
 */
export function isBehind(attacker: Vec2, target: Vec2, targetFacing: number): boolean {
  const dx = attacker.x - target.x;
  const dy = attacker.y - target.y;
  if (Math.hypot(dx, dy) < 1e-9) return false;
  const toAttacker = Math.atan2(dy, dx);
  let diff = Math.abs(toAttacker - targetFacing) % (2 * Math.PI);
  if (diff > Math.PI) diff = 2 * Math.PI - diff;
  return diff >= (Math.PI * 3) / 4 - 1e-9;
}
