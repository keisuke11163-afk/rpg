/**
 * 戦う者（敵・訓練用の人形）の状態と、ヒットの解決（本仕様書 2.4・2.7、補助仕様書 10.1）。
 */
import type { Rng } from "../rng.ts";
import type { Vec2 } from "../player/controller.ts";
import {
  AilmentSet,
  BreakGauge,
  applyChance,
  ailmentsForElements,
  breakValue,
  enemyBreakParams,
  rollApply,
  type AilmentKind,
} from "./ailments.ts";
import {
  computeDamage,
  critChance,
  critMultiplier,
  hitChance,
  type DamageInput,
  type Element,
} from "./damage.ts";
import { isBackHit, shapeHits, type HitShape } from "./geometry.ts";

export interface Combatant {
  id: string;
  pos: Vec2;
  radius: number;
  /** 向き（ラジアン）。背面判定に使う */
  facing: number;
  hp: number;
  maxHp: number;
  armor: number;
  evasion: number;
  isBoss: boolean;
  resistance: Partial<Record<Element, number>>;
  ailments: AilmentSet;
  breakGauge: BreakGauge;
  /** 向きを持たない（罠・召喚物など）。常に背面として扱う（本仕様書 7章） */
  noFacing?: boolean;
}

export function createCombatant(init: {
  id: string;
  pos: Vec2;
  maxHp: number;
  radius?: number;
  facing?: number;
  armor?: number;
  evasion?: number;
  isBoss?: boolean;
  resistance?: Partial<Record<Element, number>>;
}): Combatant {
  const isBoss = init.isBoss ?? false;
  return {
    id: init.id,
    pos: { ...init.pos },
    radius: init.radius ?? 0.5,
    facing: init.facing ?? Math.PI,
    hp: init.maxHp,
    maxHp: init.maxHp,
    armor: init.armor ?? 0,
    evasion: init.evasion ?? 0,
    isBoss,
    resistance: init.resistance ?? {},
    ailments: new AilmentSet({ maxHp: init.maxHp, isBoss }),
    breakGauge: new BreakGauge(enemyBreakParams(init.maxHp, isBoss)),
  };
}

/** 訓練用の人形：動かず、倒れず（HPが尽きたら全回復）、向きを指定できる */
export function createTrainingDummy(pos: Vec2, facing = Math.PI): Combatant {
  return createCombatant({ id: "DUMMY", pos, maxHp: 100_000, facing });
}

/** 攻撃1回のヒットの内容 */
export interface HitSpec {
  shape: HitShape;
  /** ダメージの入力（会心は resolve で決める。crit は無視される） */
  damage: DamageInput;
  weaponCrit: number;
  critIncrease?: number;
  critMultiplierAdd?: number;
  /** 背面からの会心率の加算（短剣の基本刻印など。固定値） */
  backCritAdd?: number;
  accuracy: number;
  isSpell?: boolean;
  breakCoefficient?: number;
  breakBonus?: number;
  ailmentBase?: Partial<Record<AilmentKind, number>>;
  ailmentBonus?: number;
  forcedAilments?: readonly AilmentKind[];
  /** 状態異常の持続ダメージの補正 */
  ailmentAddPct?: number;
}

export interface HitResult {
  hit: boolean;
  damage: number;
  crit: boolean;
  back: boolean;
  broke: boolean;
  appliedAilments: AilmentKind[];
  /** 手応えの演出（ヒットストップ秒・画面の揺れ） */
  feedback: { hitStopSeconds: number; shake: number };
  killed: boolean;
}

const MISS: HitResult = {
  hit: false,
  damage: 0,
  crit: false,
  back: false,
  broke: false,
  appliedAilments: [],
  feedback: { hitStopSeconds: 0, shake: 0 },
  killed: false,
};

/** 1体へのヒットを解決する。HP・崩し・状態異常を更新する */
export function resolveHit(attacker: Vec2, target: Combatant, spec: HitSpec, rng: Rng): HitResult {
  if (!rng.chance(hitChance(target.evasion, spec.accuracy, spec.isSpell === true))) return MISS;
  const back = target.noFacing === true || isBackHit(attacker, target.pos, target.facing);
  const chance = critChance(
    spec.weaponCrit,
    back ? (spec.backCritAdd ?? 0) : 0,
    spec.critIncrease ?? 0,
  );
  const crit = rng.chance(chance);
  const result = computeDamage({
    ...spec.damage,
    crit,
    critMultiplier: critMultiplier(spec.critMultiplierAdd ?? 0),
    enemyDamageTaken:
      (spec.damage.enemyDamageTaken ?? 1) *
      target.ailments.enemyDamageTakenMultiplier *
      target.breakGauge.damageTakenMultiplier,
    resistance: target.resistance,
    armor: target.armor,
  });
  target.hp = Math.max(0, target.hp - result.total);

  // 崩し：打撃値（防御の前）× 技の崩し係数
  const preDefense = computeDamage({ ...spec.damage, crit }).total;
  const broke = target.breakGauge.add(
    breakValue(preDefense, spec.breakCoefficient ?? 0.3, spec.breakBonus ?? 0),
  );

  // 状態異常：種類ごとにヒット1回につき1回だけ判定する
  const applied: AilmentKind[] = [];
  const elements = Object.keys(result.reference) as Element[];
  const kinds = new Set<AilmentKind>([
    ...ailmentsForElements(elements),
    ...(spec.forcedAilments ?? []),
  ]);
  for (const kind of kinds) {
    const forced = spec.forcedAilments?.includes(kind) === true;
    const p = applyChance(spec.ailmentBase?.[kind] ?? 0, spec.ailmentBonus ?? 0, forced);
    if (p > 0 && rollApply(rng, p)) {
      const burst = target.ailments.apply(kind, { reference: result.reference });
      target.hp = Math.max(0, target.hp - burst);
      applied.push(kind);
    }
  }

  const killed = target.hp <= 0;
  return {
    hit: true,
    damage: result.total,
    crit,
    back,
    broke,
    appliedAilments: applied,
    feedback: {
      hitStopSeconds: broke ? 0.12 : crit ? 0.07 : 0.03,
      shake: broke ? 3 : crit ? 2 : 1,
    },
    killed,
  };
}

/** 技の形に入っている全ての対象にヒットを解決する */
export function strike(
  origin: Vec2,
  angle: number,
  targets: readonly Combatant[],
  spec: HitSpec,
  rng: Rng,
): { target: Combatant; result: HitResult }[] {
  const out: { target: Combatant; result: HitResult }[] = [];
  for (const target of targets) {
    if (target.hp <= 0) continue;
    if (!shapeHits(spec.shape, origin, angle, target)) continue;
    out.push({ target, result: resolveHit(origin, target, spec, rng) });
  }
  return out;
}

/** 攻撃が当たる時刻のデータ（動作の開始からの秒）。アニメーションに依らず判定の時刻を決める */
export interface AttackTiming {
  /** 動作の全体の長さ（秒） */
  totalSeconds: number;
  /** ヒットが発生する時刻（秒）。多段は複数 */
  hitTimes: readonly number[];
}

/** 通常攻撃の動作の時間は「1 ÷ 攻撃速度」秒。ヒットは動作の40%の時点（仮値） */
export function basicAttackTiming(attackSpeed: number): AttackTiming {
  const total = 1 / attackSpeed;
  return { totalSeconds: total, hitTimes: [total * 0.4] };
}

/** 動作を進めて、この刻みで発生するヒットの数を返す */
export class AttackRunner {
  private elapsed = 0;
  private fired = 0;
  private readonly timing: AttackTiming;

  constructor(timing: AttackTiming) {
    this.timing = timing;
  }

  get done(): boolean {
    return this.elapsed >= this.timing.totalSeconds;
  }

  /** dt秒進め、発生したヒットの添字を返す */
  step(dt: number): number[] {
    this.elapsed += dt;
    const out: number[] = [];
    while (
      this.fired < this.timing.hitTimes.length &&
      (this.timing.hitTimes[this.fired] ?? Infinity) <= this.elapsed
    ) {
      out.push(this.fired);
      this.fired++;
    }
    return out;
  }
}
