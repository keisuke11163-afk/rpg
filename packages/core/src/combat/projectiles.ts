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

function requireFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name}は有限の数：${String(value)}`);
}

function requireNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0)
    throw new RangeError(`${name}は0以上の有限の数：${String(value)}`);
}

/** 投射物を出す情報を検証する（不正な値で入れ物の状態を壊さないため）。 */
function validateSpawn(spec: ProjectileSpawn<unknown>): void {
  requireFinite(spec.position.x, "位置のx");
  requireFinite(spec.position.y, "位置のy");
  requireFinite(spec.direction.x, "向きのx");
  requireFinite(spec.direction.y, "向きのy");
  requireNonNegativeFinite(spec.speed, "速さ");
  requireNonNegativeFinite(spec.range, "射程");
  requireNonNegativeFinite(spec.radius, "半径");
  if (!Number.isInteger(spec.pierce) || spec.pierce < 0)
    throw new RangeError(`貫通する数は0以上の整数：${String(spec.pierce)}`);
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

  /**
   * 投射物を出す。空きがなければ出さずに -1 を返す。向きの長さが0の場合も出さずに -1 を返す。
   * 位置・向きが有限の数でない、速さ・射程・半径が有限の0以上の数でない、
   * 貫通する数が0以上の整数でない場合は RangeError（入れ物の状態は変えない）。
   */
  spawn(spec: ProjectileSpawn<P>): number {
    validateSpawn(spec);
    const index = this.slots.findIndex((s) => !s.active);
    const slot = this.slots[index];
    if (slot === undefined) return -1;
    // 大きな成分でも長さが無限大に溢れないように、先に最大の成分で割ってから長さを求める
    const scale = Math.max(Math.abs(spec.direction.x), Math.abs(spec.direction.y));
    if (!(scale > 0)) return -1;
    const sx = spec.direction.x / scale;
    const sy = spec.direction.y / scale;
    const len = Math.hypot(sx, sy);
    slot.active = true;
    slot.x = spec.position.x;
    slot.y = spec.position.y;
    slot.dx = sx / len;
    slot.dy = sy / len;
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

  /** 全ての投射物を消す（召喚物を全て消したときの火球など）。 */
  clear(): void {
    for (const s of this.slots) if (s.active) this.release(s);
  }

  private release(slot: Slot<P>): void {
    slot.active = false;
    slot.payload = undefined;
    this.activeCount--;
  }

  /**
   * 時間を進め、この間に当たったものを返す。同じ投射物は、同じ相手に1回だけ当たる。
   * 1刻みの移動の前後を結ぶ線分と、相手の円（相手の半径＋投射物の半径）の交差で判定するため、
   * 半径0・極小の半径・非常に速い投射物でもすり抜けない。1刻みの間に複数の相手に当たるときは、
   * 線分の上で先に触れる相手から順に当てる（同じ距離なら targets の順）。
   * 経過時間が0以上の有限の数でない場合、相手の位置が有限の数でない場合、
   * 相手の半径が0以上の有限の数でない場合、判定する相手の半径と投射物の半径の合計が有限でない場合は、
   * 状態を変える前に RangeError。
   */
  update(dt: number, targets: readonly ProjectileTarget[]): ProjectileHit<P>[] {
    // 投射物の状態を変える前に検証する（NaN・負の数・無限大は位置や射程を壊すため）
    this.checkUpdate(dt, targets);
    return this.advance(dt, targets);
  }

  /**
   * update が RangeError になる入力かを、状態を変えずに確かめる（なる場合は同じ RangeError）。
   * 他の状態と合わせて「全て検証してから全て反映する」ために使う（EnemyField.update）。
   */
  checkUpdate(dt: number, targets: readonly ProjectileTarget[]): void {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError("経過時間は0以上の有限の数");
    for (const t of targets) validateTarget(t);
    // 判定に使う「相手の半径＋投射物の半径」が有限であることも先に確かめる
    // （それぞれが有限でも、合計は Infinity に溢れうる。溢れると離れた相手にも当たってしまう）
    for (const slot of this.slots) {
      if (!slot.active) continue;
      for (const t of targets) {
        if (t.team === slot.team || slot.hitIds.has(t.id)) continue;
        requireFinite(t.radius + slot.radius, `相手「${t.id}」の半径と投射物の半径の合計`);
      }
    }
  }

  private advance(dt: number, targets: readonly ProjectileTarget[]): ProjectileHit<P>[] {
    const hits: ProjectileHit<P>[] = [];
    const contacts: Contact[] = [];
    this.slots.forEach((slot, index) => {
      if (!slot.active) return;
      const distance = Math.min(slot.remaining, slot.speed * dt);
      // 線分の上で相手の円に入る位置（始点からの距離）を集める
      contacts.length = 0;
      targets.forEach((t, order) => {
        if (t.team === slot.team || slot.hitIds.has(t.id)) return;
        const s = sweepCircle(slot, distance, t.position, t.radius + slot.radius);
        if (s !== undefined) contacts.push({ s, order, target: t });
      });
      contacts.sort((a, b) => a.s - b.s || a.order - b.order);
      for (const c of contacts) {
        const x = slot.x + slot.dx * c.s;
        const y = slot.y + slot.dy * c.s;
        slot.hitIds.add(c.target.id);
        hits.push({
          projectileIndex: index,
          targetId: c.target.id,
          position: { x, y },
          payload: slot.payload as P,
        });
        if (slot.pierceLeft <= 0) {
          // 貫通し切った：当たった位置で消える
          slot.x = x;
          slot.y = y;
          slot.remaining -= c.s;
          this.release(slot);
          return;
        }
        slot.pierceLeft--;
      }
      slot.x += slot.dx * distance;
      slot.y += slot.dy * distance;
      slot.remaining = distance >= slot.remaining ? 0 : slot.remaining - distance;
      // 射程の終わり。極端に大きな座標で位置が有限でなくなった場合も、判定に混ぜないように消す
      if (slot.remaining <= 1e-9 || !Number.isFinite(slot.x) || !Number.isFinite(slot.y))
        this.release(slot);
    });
    return hits;
  }
}

interface Contact {
  /** 始点から、相手の円に入る位置までの距離。 */
  readonly s: number;
  /** targets の中の順番（同じ距離のときの並び）。 */
  readonly order: number;
  readonly target: ProjectileTarget;
}

/** 相手の情報を検証する（NaN・無限大が判定に混ざらないようにするため）。 */
function validateTarget(t: ProjectileTarget): void {
  requireFinite(t.position.x, "相手の位置のx");
  requireFinite(t.position.y, "相手の位置のy");
  requireNonNegativeFinite(t.radius, "相手の半径");
}

/**
 * 始点 (slot.x, slot.y) から長さ1の向き (slot.dx, slot.dy) に distance だけ進む線分が、
 * 中心 center・半径 reach の円に触れるとき、最初に触れる位置の始点からの距離（0〜distance）を返す。
 * 触れなければ undefined。始点が円の中にあれば0。円の縁にちょうど触れる場合も当たりとする。
 * 二乗を使わない形で計算する（大きな座標で溢れて無限大・NaN にならないように）。
 * 途中の値が NaN になった場合は、比較が全て偽になるので当たらない扱いになる。
 */
function sweepCircle(
  slot: { readonly x: number; readonly y: number; readonly dx: number; readonly dy: number },
  distance: number,
  center: Vec2,
  reach: number,
): number | undefined {
  const fx = center.x - slot.x;
  const fy = center.y - slot.y;
  // 進む向きに沿った中心までの距離と、線（無限に伸ばしたもの）から中心までの距離
  const along = fx * slot.dx + fy * slot.dy;
  const perp = Math.abs(fx * slot.dy - fy * slot.dx);
  // 向きを長さ1に揃えたときの丸めの誤差（距離に比例するごく小さな量）だけ余裕を持たせる。
  // 半径0どうしで、線の上にちょうど乗っている相手を誤差で外さないため
  const tolerance = (Math.abs(fx) + Math.abs(fy)) * 1e-12;
  if (!(perp <= reach + tolerance)) return undefined;
  const r = Math.max(reach, perp);
  const halfChord = Math.sqrt((r - perp) * (r + perp));
  const enter = along - halfChord;
  const exit = along + halfChord;
  if (!(enter <= distance && exit >= 0)) return undefined;
  const s = Math.max(0, enter);
  return Number.isFinite(s) ? s : undefined;
}
