import type { Vec2 } from "../actor/vector.ts";
import type { StaggerProfile } from "../content/ailment.ts";
import type { Element } from "../content/effect.ts";
import type { ContentDb } from "../content/load.ts";
import { evaluateEffects } from "../effects/evaluate.ts";
import { TagIndex } from "../effects/tag-index.ts";
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
import { TimedEffects } from "./timed-effects.ts";

/** 受ける側の能力値（データの stats/combat.json）。 */
export const RECEIVED_STATS = {
  /** 受けるダメージ（加算・乗算。例：破軍の後の「受けるダメージ-20%」）。 */
  damageTaken: "STAT-DAMAGE-TAKEN",
  /** 受ける崩し値（例：戦吼の威圧「崩されやすく+20%」）。 */
  staggerTaken: "STAT-STAGGER-TAKEN",
} as const;

/** 受ける側の倍率。 */
export interface ReceivedMultipliers {
  readonly damage: number;
  readonly stagger: number;
}

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
  /** 魔障が回復し始めるまでの秒数（省略で2秒）。 */
  readonly wardRechargeDelay?: number;
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
  /** 一定時間だけかかっている効果（戦吼の威圧など）。 */
  readonly statuses = new TimedEffects();
  private readonly db: ContentDb;
  private readonly tagIndex: TagIndex;
  private receivedVersion = -1;
  private received: ReceivedMultipliers = { damage: 1, stagger: 1 };

  constructor(db: ContentDb, init: CombatantInit) {
    this.db = db;
    this.tagIndex = new TagIndex(db.tags);
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
      ...(init.wardRechargeDelay === undefined
        ? {}
        : { wardRechargeDelay: init.wardRechargeDelay }),
    });
    this.ailments = new AilmentState(db);
    this.stagger = new StaggerGauge(init.staggerProfile, init.maxHp);
  }

  /**
   * 自分の能力値による、受けるダメージ・崩し値の倍率（プレイヤーの装備・自己強化。能力値の評価から渡す）。
   * 一定時間の効果（statuses）の倍率に掛ける。
   */
  ownReceived: ReceivedMultipliers = { damage: 1, stagger: 1 };

  /** 受けるダメージの倍率（崩れている間・一定時間の効果・自分の能力値）。 */
  get takenMultiplier(): number {
    return this.stagger.takenMultiplier * this.receivedMultipliers().damage;
  }

  /** 一定時間の効果と自分の能力値による、受けるダメージ・崩し値の倍率。 */
  receivedMultipliers(): ReceivedMultipliers {
    const t = this.timedReceived();
    return {
      damage: t.damage * this.ownReceived.damage,
      stagger: t.stagger * this.ownReceived.stagger,
    };
  }

  /** 一定時間の効果による、受けるダメージ・崩し値の倍率（効果が変わったときだけ計算し直す）。 */
  private timedReceived(): ReceivedMultipliers {
    if (this.receivedVersion !== this.statuses.version) {
      this.receivedVersion = this.statuses.version;
      const instances = this.statuses.instances();
      if (instances.length === 0) this.received = { damage: 1, stagger: 1 };
      else {
        const { view } = evaluateEffects(this.db, this.tagIndex, instances);
        const mult = (id: string): number => {
          const r = view.stat(id);
          return Math.max(0, (1 + r.increased) * r.more);
        };
        this.received = {
          damage: mult(RECEIVED_STATS.damageTaken),
          stagger: mult(RECEIVED_STATS.staggerTaken),
        };
      }
    }
    return this.received;
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
    // 一定時間の効果：dt は検証済みで、残りの時間を減らして切れたものを取り除くだけ（例外は起きない）
    this.statuses.update(dt);
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
  /** 当てたら、崩しゲージを満タンにする（激化した突進）。 */
  readonly fullStagger?: boolean;
  /** 必ず会心にする（急所穿ちの5点）。 */
  readonly forceCrit?: boolean;
  /** このヒットだけの受けるダメージの倍率（母樹の根冠の毒・背向けの外套など。省略で1）。 */
  readonly extraTakenMultiplier?: number;
  /** 背面からのヒットとして扱う（背向けの外套の移動の技の後）。 */
  readonly forceBackstab?: boolean;
  /** 背面からのヒットの補正（メインジョブの職能。盗賊は会心率+10%・付与率+25%。仕様書5.6）。 */
  readonly backstabBonus?: { readonly critChance: number; readonly ailmentChance: number };
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
    input.forceBackstab === true ||
    (target.facing !== undefined &&
      isBehind(input.attackerPosition, target.position, target.facing));
  const extra = input.extraTakenMultiplier ?? 1;
  if (!(Number.isFinite(extra) && extra >= 0))
    throw new RangeError(`このヒットの受けるダメージの倍率は0以上の有限の数（${String(extra)}）`);
  const hit = computeHit(
    attacker,
    skill,
    {
      resist: target.resist,
      armor: target.armor,
      evasion: target.evasion,
      takenMultiplier: target.takenMultiplier * extra,
    },
    {
      rng,
      ...(input.roll === undefined ? {} : { roll: input.roll }),
      ...(backstab && input.backstabBonus !== undefined
        ? { extraCritChance: input.backstabBonus.critChance }
        : {}),
      ...(input.forceCrit === true ? { forceCrit: true } : {}),
    },
  );
  // ダメージを受けない間（ボスの段階の切り替え・根渡り）のヒットは、ダメージ・状態異常・崩しを全て与えない
  // （プレイヤーの回避の無敵と同じく、ヒットそのものを無効にする。docs/progress Q-U19-2 の確定）
  const invulnerable = target.health.invulnerable;
  const applied = target.health.takeDamage(hit.total);
  if (invulnerable)
    return {
      targetId: target.id,
      hit,
      backstab,
      applied,
      ailments: [],
      staggerValue: 0,
      staggerBroke: false,
    };
  const tags = [...skill.tags, ...(skill.kind === "weapon" ? (attacker.weapon?.tags ?? []) : [])];
  const weaponUid = attacker.weapon?.uid;
  const ailments = rollAilments({
    db,
    view: attacker.view,
    hit,
    tags,
    ...(input.skillChance === undefined ? {} : { skillChance: input.skillChance }),
    ...(weaponUid === undefined ? {} : { weaponUid }),
    ...(backstab && input.backstabBonus !== undefined
      ? { extraChance: input.backstabBonus.ailmentChance }
      : {}),
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
  const scaled = value * target.receivedMultipliers().stagger;
  const staggerBroke =
    input.fullStagger === true && !hit.evaded
      ? target.stagger.breakNow()
      : target.stagger.add(scaled);
  return {
    targetId: target.id,
    hit,
    backstab,
    applied,
    ailments,
    staggerValue: scaled,
    staggerBroke,
  };
}
