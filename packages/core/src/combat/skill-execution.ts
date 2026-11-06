import { type Vec2, ZERO, add, scale } from "../actor/vector.ts";
import type { DamageSkill } from "./damage.ts";
import type { HitShape } from "./shapes.ts";
import type { ResolvedSkill, SkillBehavior } from "./skills.ts";
import { skillUseSeconds } from "./skills.ts";
import { ActionTimeline, playerAttackTimeline } from "./timeline.ts";

/** 当たり判定1つ分。呼び出す側が、形に入った敵にヒットを解決する。 */
export interface Strike {
  readonly skill: ResolvedSkill;
  /** ダメージの計算に渡す形（衝撃波・亀裂は技倍率が違う）。 */
  readonly damage: DamageSkill;
  readonly shape: HitShape;
  readonly origin: Vec2;
  readonly facing: number;
  /**
   * 同じ group の当たり判定は、1回の技の中で、1体に1回だけ当たる（突進の通り道・十字の亀裂）。
   * 呼び出す側は、技の実行（SkillExecution・LingeringZone）ごとに、当たった敵を group ごとに覚える。
   */
  readonly group?: string;
  /** 当てた敵の崩しゲージを満タンにする（激化した突進）。 */
  readonly fullStagger: boolean;
}

/** 戦吼（自分の周りの味方を強め、敵を弱める）。 */
export interface WarcryPulse {
  readonly origin: Vec2;
  readonly radius: number;
  readonly duration: number;
  readonly allyEffects: readonly string[];
  readonly enemyEffects: readonly string[];
}

/** 周りの敵を引き寄せる（激化した旋風）。 */
export interface PullPulse {
  readonly origin: Vec2;
  readonly radius: number;
  /** 引き寄せる速さ（m/秒）。 */
  readonly speed: number;
}

export interface ExecutionInput {
  /** 今の自分の位置。 */
  readonly position: Vec2;
  /** 技の枠のキー・ボタンを押し続けているか（持続する技）。 */
  readonly held: boolean;
  /** 今のMP（持続する技のMPの支払いに使う）。 */
  readonly mp: number;
}

/** 1刻みで起きたこと。 */
export interface ExecutionTick {
  readonly strikes: readonly Strike[];
  readonly warcry?: WarcryPulse;
  readonly pull?: PullPulse;
  /** 自分を動かす量（突進）。 */
  readonly displacement: Vec2;
  /** この刻みで払うMP（持続する技）。 */
  readonly mpCost: number;
  /** 残る当たり判定（激化した地割りの亀裂）。 */
  readonly zones: readonly LingeringZone[];
  /** 移動の速さの倍率（0なら動けない）。 */
  readonly moveMultiplier: number;
  readonly finished: boolean;
}

const behavior = (skill: ResolvedSkill, hook: string): SkillBehavior | undefined =>
  skill.behaviors.find((b) => b.hook === hook);
const param = (b: SkillBehavior, name: string): number => {
  const v = b.params[name];
  if (v === undefined) throw new Error(`ルールフック ${b.hook} のパラメータ ${name} がない`);
  return v;
};
const withPct = (skill: ResolvedSkill, ratio: number): DamageSkill => ({
  ...skill.damage,
  pct: skill.damage.pct * ratio,
});
const dir = (angle: number): Vec2 => ({ x: Math.cos(angle), y: Math.sin(angle) });

/**
 * 残る当たり判定（激化した地割りの亀裂）。間隔ごとに、同じ形で再びダメージを与える。
 * 1回の発動（同じ刻み）の中では、十字の両方に入った敵にも1回だけ当たる（group が発動ごとに違う）。
 */
export class LingeringZone {
  readonly skill: ResolvedSkill;
  readonly parts: readonly { shape: HitShape; origin: Vec2; facing: number }[];
  private readonly damage: DamageSkill;
  private readonly interval: number;
  private readonly duration: number;
  private readonly total: number;
  private elapsed = 0;
  private fired = 0;

  constructor(
    skill: ResolvedSkill,
    parts: readonly { shape: HitShape; origin: Vec2; facing: number }[],
    b: SkillBehavior,
  ) {
    this.skill = skill;
    this.parts = parts;
    this.damage = withPct(skill, param(b, "ratio"));
    this.interval = param(b, "interval");
    this.duration = param(b, "duration");
    if (!(this.interval > 0) || !(this.duration > 0)) throw new RangeError("亀裂の時間は正の数");
    this.total = Math.floor(this.duration / this.interval + 1e-9);
  }

  get done(): boolean {
    return this.fired >= this.total || this.elapsed >= this.duration - 1e-9;
  }
  /** 残りの時間（秒）。 */
  get remaining(): number {
    return Math.max(0, this.duration - this.elapsed);
  }

  /** 時間を進め、この間に発動した当たり判定を返す。経過時間が0以上の有限の数でなければ、状態を変えずに RangeError。 */
  update(dt: number): Strike[] {
    // 状態を変える前に検証する（NaN・負の数・無限大を受け付けない。ActionTimeline.update と同じ）
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError("経過時間は0以上の有限の数");
    const out: Strike[] = [];
    this.elapsed += dt;
    while (this.fired < this.total && this.elapsed >= (this.fired + 1) * this.interval - 1e-9) {
      this.fired += 1;
      const group = `pulse${String(this.fired)}`;
      for (const p of this.parts) {
        out.push({ skill: this.skill, damage: this.damage, ...p, group, fullStagger: false });
      }
    }
    return out;
  }
}

/**
 * 技の1回の実行（仕様書5章・補助仕様書3.6）。時間を進めると、当たり判定・戦吼・移動などを知らせる。
 * 向きは使い始めたときに決まる（照準の方向に技を使う。補助仕様書1.1）。
 */
export class SkillExecution {
  readonly skill: ResolvedSkill;
  readonly facing: number;
  private readonly timeline: ActionTimeline | undefined;
  private elapsed = 0;
  private hitTimer = 0;
  private mpTimer = 0;
  private finishedFlag = false;

  constructor(skill: ResolvedSkill, facing: number, attackSpeed: number) {
    this.skill = skill;
    this.facing = facing;
    const t = skill.action.type;
    this.timeline =
      t === "strike" || t === "warcry"
        ? new ActionTimeline(playerAttackTimeline(skillUseSeconds(skill, attackSpeed)))
        : undefined;
  }

  get finished(): boolean {
    return this.finishedFlag;
  }

  /** 当たり判定が出ている間か（表示用）。 */
  get activePhase(): boolean {
    if (this.timeline !== undefined) return this.timeline.phase === "active";
    return !this.finishedFlag;
  }

  /**
   * 時間を進める。経過時間が0以上の有限の数でなければ、状態を変えずに RangeError
   * （終わった後・離した瞬間・突進・旋風を含む、全ての種類で同じ）。
   */
  update(dt: number, input: ExecutionInput): ExecutionTick {
    // 状態を変える前に検証する（NaN・負の数・無限大を受け付けない。ActionTimeline.update と同じ）
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError("経過時間は0以上の有限の数");
    const empty = {
      strikes: [] as Strike[],
      displacement: ZERO,
      mpCost: 0,
      zones: [] as LingeringZone[],
      moveMultiplier: 0,
    };
    if (this.finishedFlag) return { ...empty, finished: true };
    const a = this.skill.action;
    switch (a.type) {
      case "strike": {
        const e = (this.timeline as ActionTimeline).update(dt);
        const strikes: Strike[] = [];
        const zones: LingeringZone[] = [];
        if (e.activeStarted) {
          const parts = this.strikeParts(a.shape, input.position);
          const group = parts.length > 1 ? "main" : undefined;
          for (const p of parts) {
            strikes.push({
              skill: this.skill,
              damage: this.skill.damage,
              ...p,
              ...(group === undefined ? {} : { group }),
              fullStagger: false,
            });
          }
          const wave = behavior(this.skill, "shockwave");
          if (wave !== undefined) {
            strikes.push({
              skill: this.skill,
              damage: withPct(this.skill, param(wave, "ratio")),
              shape: { type: "line", length: param(wave, "length"), width: param(wave, "width") },
              origin: input.position,
              facing: this.facing,
              fullStagger: false,
            });
          }
          const linger = behavior(this.skill, "lingeringFissure");
          if (linger !== undefined) zones.push(new LingeringZone(this.skill, parts, linger));
        }
        this.finishedFlag = e.finished;
        return { ...empty, strikes, zones, finished: e.finished };
      }
      case "warcry": {
        const e = (this.timeline as ActionTimeline).update(dt);
        this.finishedFlag = e.finished;
        return {
          ...empty,
          ...(e.activeStarted
            ? {
                warcry: {
                  origin: input.position,
                  radius: a.radius,
                  duration: a.duration,
                  allyEffects: a.allyEffects,
                  enemyEffects: a.enemyEffects ?? [],
                },
              }
            : {}),
          finished: e.finished,
        };
      }
      case "dash": {
        const step = Math.min(dt, a.duration - this.elapsed);
        this.elapsed += dt;
        const distance = (a.distance / a.duration) * Math.max(0, step);
        const finished = this.elapsed >= a.duration - 1e-9;
        this.finishedFlag = finished;
        const strikes: Strike[] =
          distance > 0
            ? [
                {
                  skill: this.skill,
                  damage: this.skill.damage,
                  shape: { type: "line", length: distance, width: a.width },
                  origin: input.position,
                  facing: this.facing,
                  group: "dash",
                  fullStagger: behavior(this.skill, "fullStagger") !== undefined,
                },
              ]
            : [];
        return {
          ...empty,
          strikes,
          displacement: scale(dir(this.facing), distance),
          finished,
        };
      }
      case "channel": {
        if (!input.held) {
          this.finishedFlag = true;
          return { ...empty, finished: true };
        }
        // MPは始めた瞬間と、決まった間隔ごとに払う。足りなければ終わる。当たり判定も始めた瞬間から出す
        let mpCost = 0;
        let available = input.mp;
        while (this.mpTimer <= 1e-9) {
          if (available < a.mpPerInterval) {
            this.finishedFlag = true;
            return { ...empty, mpCost, finished: true };
          }
          available -= a.mpPerInterval;
          mpCost += a.mpPerInterval;
          this.mpTimer += a.mpInterval;
        }
        this.mpTimer -= dt;
        const strikes: Strike[] = [];
        while (this.hitTimer <= 1e-9) {
          this.hitTimer += 1 / a.hitsPerSecond;
          strikes.push({
            skill: this.skill,
            damage: this.skill.damage,
            shape: a.shape,
            origin: input.position,
            facing: this.facing,
            fullStagger: false,
          });
        }
        this.hitTimer -= dt;
        const pull = behavior(this.skill, "pullIn");
        return {
          ...empty,
          strikes,
          mpCost,
          moveMultiplier: a.moveSpeedMultiplier,
          ...(pull === undefined
            ? {}
            : {
                pull: {
                  origin: input.position,
                  radius: param(pull, "radius"),
                  speed: param(pull, "speed"),
                },
              }),
          finished: false,
        };
      }
    }
  }

  /** 当たり判定を1回出す技の形（大槌の地割りは十字になる）。 */
  private strikeParts(
    shape: HitShape,
    position: Vec2,
  ): { shape: HitShape; origin: Vec2; facing: number }[] {
    const parts = [{ shape, origin: position, facing: this.facing }];
    const cross = behavior(this.skill, "crossFissure");
    if (cross !== undefined && shape.type === "line") {
      // 直線の中ほどで、垂直に交わる直線を加える
      const len = param(cross, "length");
      const mid = add(position, scale(dir(this.facing), shape.length / 2));
      const perp = this.facing + Math.PI / 2;
      parts.push({
        shape: { type: "line", length: len, width: shape.width },
        origin: add(mid, scale(dir(perp), -len / 2)),
        facing: perp,
      });
    }
    return parts;
  }
}

/** 引き寄せ：中心へ、決まった速さで近づける（中心から minDistance より内には入れない）。 */
export function pullTowards(
  position: Vec2,
  center: Vec2,
  distance: number,
  minDistance: number,
): Vec2 {
  const dx = center.x - position.x;
  const dy = center.y - position.y;
  const d = Math.hypot(dx, dy);
  if (d <= minDistance + 1e-9) return position;
  const move = Math.min(distance, d - minDistance);
  return { x: position.x + (dx / d) * move, y: position.y + (dy / d) * move };
}
