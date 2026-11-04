import type { Vec2 } from "../actor/vector.ts";
import type { StaggerProfile } from "../content/ailment.ts";
import type { Element } from "../content/effect.ts";
import type { ContentDb } from "../content/load.ts";
import type { Rng } from "../random/rng.ts";
import {
  type AilmentApplication,
  AilmentState,
  StaggerGauge,
  rollAilments,
  staggerValue,
} from "./ailments.ts";
import { type DamageAttacker, type DamageSkill, type HitResult, computeHit } from "./damage.ts";
import { type DamageApplied, Health } from "./health.ts";
import { isBehind } from "./shapes.ts";

/** 戦う者（プレイヤー・敵・訓練用の人形）の、戦闘に関わる状態。 */
export interface CombatantInit {
  readonly id: string;
  readonly team: string;
  readonly position: Vec2;
  /** 当たり判定の半径（m）。 */
  readonly radius: number;
  /** 向き（ラジアン）。向きを持たない敵は undefined（背面判定が起きない。補助仕様書10.1）。 */
  readonly facing?: number;
  readonly maxHp: number;
  readonly maxWard?: number;
  readonly isBoss?: boolean;
  readonly resist?: Partial<Record<Element, number>>;
  readonly armor?: number;
  readonly evasion?: number;
  /** 崩しゲージの設定（データの AIL-STAGGER の enemy・boss・player）。 */
  readonly staggerProfile: StaggerProfile;
}

export class Combatant {
  readonly id: string;
  readonly team: string;
  readonly radius: number;
  readonly isBoss: boolean;
  readonly health: Health;
  readonly ailments: AilmentState;
  readonly stagger: StaggerGauge;
  position: Vec2;
  facing: number | undefined;
  resist: Partial<Record<Element, number>>;
  armor: number;
  evasion: number;
  /** 移動しているか（出血の2倍に使う）。 */
  moving = false;

  constructor(db: ContentDb, init: CombatantInit) {
    this.id = init.id;
    this.team = init.team;
    this.radius = init.radius;
    this.isBoss = init.isBoss === true;
    this.position = init.position;
    this.facing = init.facing;
    this.resist = init.resist ?? {};
    this.armor = init.armor ?? 0;
    this.evasion = init.evasion ?? 0;
    this.health = new Health({
      maxHp: init.maxHp,
      ...(init.maxWard === undefined ? {} : { maxWard: init.maxWard }),
    });
    this.ailments = new AilmentState(db);
    this.stagger = new StaggerGauge(init.staggerProfile, init.maxHp);
  }

  /** 受けるダメージの倍率（崩れている間など）。 */
  get takenMultiplier(): number {
    return this.stagger.takenMultiplier;
  }

  /** 時間を進める：持続ダメージを受け、崩しゲージ・魔障を更新する。受けた持続ダメージの合計を返す。 */
  update(dt: number): number {
    const dot = this.ailments.tick(dt, {
      resist: this.resist,
      takenMultiplier: this.takenMultiplier,
      moving: this.moving,
    });
    let total = 0;
    for (const v of Object.values(dot)) total += v;
    if (total > 0) this.health.takeDamage(total);
    this.stagger.update(dt);
    this.health.update(dt);
    return total;
  }
}

export interface HitInput {
  readonly db: ContentDb;
  readonly attacker: DamageAttacker;
  readonly attackerPosition: Vec2;
  readonly skill: DamageSkill;
  /** 技の基本付与率（状態異常のタグ → 0〜1）。 */
  readonly skillChance?: Readonly<Partial<Record<string, number>>>;
  /** 技の崩し係数。 */
  readonly staggerCoefficient?: number;
  readonly target: Combatant;
  readonly rng: Rng;
  /** 平均の値で計算する（表示・確認用）。 */
  readonly roll?: "random" | "average";
}

/** 1回のヒットの結果（表示・記録用）。 */
export interface HitReport {
  readonly targetId: string;
  readonly hit: HitResult;
  /** 背面からのヒットか（仕様書v0.2 5.1）。 */
  readonly backstab: boolean;
  readonly applied: DamageApplied;
  readonly ailments: readonly AilmentApplication[];
  readonly staggerValue: number;
  /** このヒットで崩れた。 */
  readonly staggerBroke: boolean;
}

/** ヒットを解決する：ダメージ → HP（魔障が先）→ 状態異常 → 崩し。 */
export function resolveHit(input: HitInput): HitReport {
  const { db, attacker, skill, target, rng } = input;
  const backstab =
    target.facing !== undefined && isBehind(input.attackerPosition, target.position, target.facing);
  const hit = computeHit(
    attacker,
    skill,
    {
      resist: target.resist,
      armor: target.armor,
      evasion: target.evasion,
      takenMultiplier: target.takenMultiplier,
    },
    { rng, ...(input.roll === undefined ? {} : { roll: input.roll }) },
  );
  const applied = target.health.takeDamage(hit.total);
  const tags = [...skill.tags, ...(skill.kind === "weapon" ? (attacker.weapon?.tags ?? []) : [])];
  const weaponUid = attacker.weapon?.uid;
  const ailments = rollAilments({
    db,
    view: attacker.view,
    hit,
    tags,
    ...(input.skillChance === undefined ? {} : { skillChance: input.skillChance }),
    ...(weaponUid === undefined ? {} : { weaponUid }),
    rng,
  });
  for (const a of ailments) target.ailments.apply(a);
  const value = staggerValue({
    db,
    view: attacker.view,
    hit,
    tags,
    ...(input.staggerCoefficient === undefined ? {} : { coefficient: input.staggerCoefficient }),
    ...(weaponUid === undefined ? {} : { weaponUid }),
  });
  const staggerBroke = target.stagger.add(value);
  return {
    targetId: target.id,
    hit,
    backstab,
    applied,
    ailments,
    staggerValue: value,
    staggerBroke,
  };
}
