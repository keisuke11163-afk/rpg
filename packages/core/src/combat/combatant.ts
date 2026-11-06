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

  /**
   * 時間を進める：持続ダメージを受け、崩しゲージ・魔障を更新する。受けた持続ダメージの合計を返す。
   *
   * 例外安全：全ての計算（状態異常の持続ダメージ・その合計・HPと魔障・崩しゲージ）を、
   * 状態を変えない計画（planTick・planUpdate）として先に行って検証し、全て成功してから反映する。
   * 反映（commitTick・commitUpdate）は検証済みの値の代入だけで、例外は起きない。
   * そのため、次のどれで RangeError になっても、HP・魔障・状態異常・崩しゲージ・時間は何も変わらない。
   * - 経過時間が0以上の有限の数でない
   * - 持続ダメージの計算・属性ごとの合計が有限でない（AilmentState.planTick）
   * - 属性ごとの持続ダメージの合計が有限でない（NaN・Infinity）
   * - HP・魔障・被弾からの時間の計算の溢れ（Health.planUpdate）
   * - 崩しゲージ・崩しを受けていない時間の計算の溢れ（StaggerGauge.planUpdate）
   */
  update(dt: number): number {
    if (!(Number.isFinite(dt) && dt >= 0))
      throw new RangeError(`経過時間は有限かつ0以上（${String(dt)}）`);
    const target = {
      resist: this.resist,
      takenMultiplier: this.takenMultiplier,
      moving: this.moving,
    };
    // 1. 計算と検証（状態は変えない）
    const dot = this.ailments.planTick(dt, target);
    // 各属性が有限でも、合計は溢れうる
    const total = sumDot(dot.damage);
    // 持続ダメージを受けてから時間を進める（従来の takeDamage(total) → update(dt) と同じ）
    const health = this.health.planUpdate(dt, total);
    const stagger = this.stagger.planUpdate(dt);
    // 2. 反映（代入だけで、例外は起きない）
    this.ailments.commitTick(dot);
    this.health.commitUpdate(health);
    this.stagger.commitUpdate(stagger);
    return total;
  }
}

/** 属性ごとの持続ダメージの合計。合計が有限でなければ RangeError。 */
function sumDot(dot: Partial<Record<Element, number>>): number {
  let total = 0;
  for (const v of Object.values(dot)) total += v;
  if (!Number.isFinite(total))
    throw new RangeError(`持続ダメージの合計は有限の数（${String(total)}）`);
  return total;
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

/**
 * ヒットを解決する：ダメージ → HP（魔障が先）→ 状態異常 → 崩し。
 *
 * 例外安全：全ての計算と検証（ダメージ・HPと魔障・状態異常の判定と付与の入力・崩し値・崩しゲージ）を、
 * 状態を変えない計画（Health.planUpdate・AilmentState.planApply・StaggerGauge.planAdd）として先に行い、
 * 全て成功してから反映する（Combatant.update と同じ形）。反映は検証済みの値による代入だけで、例外は起きない。
 * そのため、途中のどこで例外になっても、受ける側の HP・魔障・状態異常・崩しゲージは何も変わらない。
 * （乱数は、従来どおりダメージ → 状態異常の順に消費する。例外のときも消費した分は戻らない）
 */
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
  // 1. 計算と検証（受ける側の状態は変えない）
  // 経過時間0で進めるのは、takeDamage(hit.total) と同じ結果（Health.planUpdate を参照）
  const health = target.health.planUpdate(0, hit.total);
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
  const ailmentPlans = ailments.map((a) => target.ailments.planApply(a));
  const value = staggerValue({
    db,
    view: attacker.view,
    hit,
    tags,
    ...(input.staggerCoefficient === undefined ? {} : { coefficient: input.staggerCoefficient }),
    ...(weaponUid === undefined ? {} : { weaponUid }),
  });
  const stagger = target.stagger.planAdd(value);
  // 2. 反映（検証済みの値による代入だけで、例外は起きない）
  target.health.commitUpdate(health);
  for (const plan of ailmentPlans) target.ailments.commitApply(plan);
  target.stagger.commitAdd(stagger);
  return {
    targetId: target.id,
    hit,
    backstab,
    applied: health.applied,
    ailments,
    staggerValue: value,
    staggerBroke: stagger.broke,
  };
}
