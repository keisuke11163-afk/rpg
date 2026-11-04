import type { Vec2 } from "../actor/vector.ts";

/**
 * 投射物（開発計画書 工程BT-2：投射物の使い回し）。
 * 決まった数の入れ物を先に作っておき、使い終わったものを再利用する（投射物が多い場面で、ゴミを出さないため）。
 */
export interface ProjectileSpawn<P> {
  readonly position: Vec2;
  /** 進む向き（長さ1でなくてよい）。 */
  readonly direction: Vec2;
  /** 速さ（m/秒）。 */
  readonly speed: number;
  /** 射程（m）。 */
  readonly range: number;
  /** 投射物の半径（m）。 */
  readonly radius: number;
  /** 貫通する数（0なら最初の1体で消える）。 */
  readonly pierce: number;
  /** 撃った側の陣営（同じ陣営には当たらない）。 */
  readonly team: string;
  /** 当たったときに使う情報（技・撃った者など）。 */
  readonly payload: P;
}

export interface ProjectileTarget {
  readonly id: string;
  readonly team: string;
  readonly position: Vec2;
  readonly radius: number;
}

export interface ProjectileHit<P> {
  readonly projectileIndex: number;
  readonly targetId: string;
  readonly position: Vec2;
  readonly payload: P;
}

interface Slot<P> {
  active: boolean;
  x: number;
  y: number;
  dx: number;
  dy: number;
  speed: number;
  remaining: number;
  radius: number;
  pierceLeft: number;
  team: string;
  payload: P | undefined;
  hitIds: Set<string>;
}

export class ProjectilePool<P> {
  private readonly slots: Slot<P>[];
  private activeCount = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1)
      throw new RangeError("入れ物の数は1以上の整数");
    this.slots = Array.from({ length: capacity }, () => ({
      active: false,
      x: 0,
      y: 0,
      dx: 0,
      dy: 0,
      speed: 0,
      remaining: 0,
      radius: 0,
      pierceLeft: 0,
      team: "",
      payload: undefined,
      hitIds: new Set<string>(),
    }));
  }

  get capacity(): number {
    return this.slots.length;
  }
  get active(): number {
    return this.activeCount;
  }

  /** 投射物を出す。空きがなければ出さずに -1 を返す。 */
  spawn(spec: ProjectileSpawn<P>): number {
    const index = this.slots.findIndex((s) => !s.active);
    const slot = this.slots[index];
    if (slot === undefined) return -1;
    const len = Math.hypot(spec.direction.x, spec.direction.y);
    if (!(len > 0)) return -1;
    slot.active = true;
    slot.x = spec.position.x;
    slot.y = spec.position.y;
    slot.dx = spec.direction.x / len;
    slot.dy = spec.direction.y / len;
    slot.speed = spec.speed;
    slot.remaining = spec.range;
    slot.radius = spec.radius;
    slot.pierceLeft = spec.pierce;
    slot.team = spec.team;
    slot.payload = spec.payload;
    slot.hitIds.clear();
    this.activeCount++;
    return index;
  }

  /** 位置（描画用）。使っていない入れ物は undefined。 */
  positionOf(index: number): Vec2 | undefined {
    const slot = this.slots[index];
    return slot?.active === true ? { x: slot.x, y: slot.y } : undefined;
  }

  /** 使っている投射物の位置の一覧（描画用）。 */
  positions(): { index: number; position: Vec2; direction: Vec2 }[] {
    const out: { index: number; position: Vec2; direction: Vec2 }[] = [];
    this.slots.forEach((s, index) => {
      if (s.active)
        out.push({ index, position: { x: s.x, y: s.y }, direction: { x: s.dx, y: s.dy } });
    });
    return out;
  }

  private release(slot: Slot<P>): void {
    slot.active = false;
    slot.payload = undefined;
    this.activeCount--;
  }

  /** 時間を進め、この間に当たったものを返す。同じ投射物は、同じ相手に1回だけ当たる。 */
  update(dt: number, targets: readonly ProjectileTarget[]): ProjectileHit<P>[] {
    const hits: ProjectileHit<P>[] = [];
    this.slots.forEach((slot, index) => {
      if (!slot.active) return;
      // すり抜けを防ぐため、1刻みの移動を、半径より短い区間に分けて判定する
      const distance = Math.min(slot.remaining, slot.speed * dt);
      const parts = Math.max(1, Math.ceil(distance / Math.max(0.05, slot.radius)));
      let alive = true;
      for (let k = 0; k < parts && alive; k++) {
        const stepLen = distance / parts;
        slot.x += slot.dx * stepLen;
        slot.y += slot.dy * stepLen;
        slot.remaining -= stepLen;
        for (const t of targets) {
          if (t.team === slot.team || slot.hitIds.has(t.id)) continue;
          if (Math.hypot(t.position.x - slot.x, t.position.y - slot.y) > t.radius + slot.radius)
            continue;
          slot.hitIds.add(t.id);
          hits.push({
            projectileIndex: index,
            targetId: t.id,
            position: { x: slot.x, y: slot.y },
            payload: slot.payload as P,
          });
          if (slot.pierceLeft <= 0) {
            this.release(slot);
            alive = false;
            break;
          }
          slot.pierceLeft--;
        }
      }
      if (alive && slot.remaining <= 1e-9) this.release(slot);
    });
    return hits;
  }
}
