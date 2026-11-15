/**
 * プレイヤーの移動と回避（本仕様書 2.1、補助仕様書 3.1）。数値は仮値。
 * 時間は固定の刻み（秒）で進める。描画に依存しない。
 */

export const PLAYER = {
  /** 毎秒の移動（m） */
  moveSpeed: 5,
  /** 回避：0.35秒で4m進む */
  dodgeSeconds: 0.35,
  dodgeDistance: 4,
  /** 回避の最初の0.3秒は攻撃を受けない */
  dodgeInvulnerableSeconds: 0.3,
  staminaMax: 100,
  staminaCost: 25,
  staminaRegenPerSecond: 20,
} as const;

export interface Vec2 {
  x: number;
  y: number;
}

export interface PlayerState {
  pos: Vec2;
  /** 照準の方向（ラジアン）。自由な角度 */
  aimAngle: number;
  stamina: number;
  /** 回避の残り時間（0なら回避中でない） */
  dodgeLeft: number;
  /** 回避の経過時間 */
  dodgeElapsed: number;
  dodgeDir: Vec2;
  /** 技・移動ができない時間（よろめきなど） */
  stunLeft: number;
}

export function createPlayer(pos: Vec2 = { x: 0, y: 0 }): PlayerState {
  return {
    pos: { ...pos },
    aimAngle: 0,
    stamina: PLAYER.staminaMax,
    dodgeLeft: 0,
    dodgeElapsed: 0,
    dodgeDir: { x: 1, y: 0 },
    stunLeft: 0,
  };
}

export interface PlayerInput {
  /** 移動の方向（長さ0か1） */
  move: Vec2;
  /** 照準の点（ワールド座標） */
  aimPoint: Vec2;
  /** このフレームで回避が押された */
  dodgePressed: boolean;
}

export function isDodging(p: PlayerState): boolean {
  return p.dodgeLeft > 0;
}

/** 回避の最初の0.3秒は攻撃を受けない */
export function isInvulnerable(p: PlayerState): boolean {
  return isDodging(p) && p.dodgeElapsed < PLAYER.dodgeInvulnerableSeconds;
}

/** 攻撃を受けたときの扱い。無敵なら当たらない（false） */
export function canBeHit(p: PlayerState): boolean {
  return !isInvulnerable(p);
}

/** dt秒進める。状態を直接更新して返す */
export function stepPlayer(p: PlayerState, input: PlayerInput, dt: number): PlayerState {
  p.aimAngle = Math.atan2(input.aimPoint.y - p.pos.y, input.aimPoint.x - p.pos.x);
  p.stunLeft = Math.max(0, p.stunLeft - dt);

  if (isDodging(p)) {
    const step = Math.min(dt, p.dodgeLeft);
    const speed = PLAYER.dodgeDistance / PLAYER.dodgeSeconds;
    p.pos.x += p.dodgeDir.x * speed * step;
    p.pos.y += p.dodgeDir.y * speed * step;
    p.dodgeLeft -= step;
    p.dodgeElapsed += step;
    if (p.dodgeLeft < 1e-9) p.dodgeLeft = 0;
    return p;
  }

  p.stamina = Math.min(PLAYER.staminaMax, p.stamina + PLAYER.staminaRegenPerSecond * dt);
  if (p.stunLeft > 0) return p;

  if (input.dodgePressed && p.stamina >= PLAYER.staminaCost) {
    // 移動キーを押している方向へ。押していなければ照準の方向へ
    const moving = input.move.x !== 0 || input.move.y !== 0;
    p.dodgeDir = moving ? { ...input.move } : { x: Math.cos(p.aimAngle), y: Math.sin(p.aimAngle) };
    p.stamina -= PLAYER.staminaCost;
    p.dodgeLeft = PLAYER.dodgeSeconds;
    p.dodgeElapsed = 0;
    return stepPlayer(p, { ...input, dodgePressed: false }, dt);
  }

  p.pos.x += input.move.x * PLAYER.moveSpeed * dt;
  p.pos.y += input.move.y * PLAYER.moveSpeed * dt;
  return p;
}
