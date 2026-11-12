/**
 * DPSシミュレーター（開発計画書 工程BL-1）。
 *
 * 描画なしで、固定の時間刻み（1/60秒）で戦闘を早送りする。指定の時間が1/60秒の整数倍でなければ、
 * 最後の時間刻みだけを残りの時間に縮める（指定の時間を超えて計算しない）。的が移動している時間は、
 * 刻みの回数ではなく実際の経過時間に移動の割合をかけて割り振る（端数の刻みでも同じ）。ダメージ・状態異常・崩しの計算は、
 * ゲーム本体と同じ core の関数を使う。位置・移動・敵の行動は扱わない（標準の的を殴り続ける）。
 */
import {
  type ContentDb,
  type DamageAttacker,
  type DamageSkill,
  type EffectInstance,
  type Element,
  type HitScope,
  type AilmentTickTarget,
  AilmentState,
  EQUIPMENT_SOURCE_KIND,
  FIXED_STEP_SECONDS,
  Rng,
  StaggerGauge,
  TagIndex,
  armorReduction,
  enemyAccuracy,
  evadeChance,
  evaluateEffects,
  computeHit,
  rollAilments,
  staggerProfiles,
  staggerValue,
} from "@stella/core";
import type { Build, SimSkill, Target } from "./build.ts";
import { standardHp } from "./standards.ts";

/** 基礎MP（仕様書v0.2 2.3：60で固定）と、理1ポイントあたりの最大MP（2.2）。 */
const BASE_MP = 60;
const MP_PER_RI = 1.5;
/** 毎秒、最大MPの6%を回復する（仕様書v0.2 2.3。仮値）。 */
const MP_REGEN_RATIO = 0.06;

export interface SimOptions {
  /** 戦う時間の上限（秒。有限の正の数）。的のHPが有限なら、倒した時点で終わる。 */
  readonly seconds: number;
  readonly seed: number | string;
}

/**
 * シミュレーションの時間（秒）を確かめる。0以下・NaN・±Infinity は、0 や既定値に置き換えずに RangeError にする。
 * 固定の時間刻みの回数が安全な整数に収まらない（大きすぎる）値も拒否する。
 */
export function validateSeconds(seconds: number): number {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    throw new RangeError(`シミュレーションの時間（seconds）は有限かつ正の数（${String(seconds)}）`);
  }
  if (!Number.isSafeInteger(Math.ceil(seconds / FIXED_STEP_SECONDS))) {
    throw new RangeError(`シミュレーションの時間（seconds）が大きすぎる（${String(seconds)}）`);
  }
  return seconds;
}

/** 時間刻みの回数が整数かどうかを判定するときの許容誤差（刻みの回数に対する相対値）。 */
const STEP_EPSILON = 1e-9;

/**
 * 指定の時間を、固定の時間刻み（dt）の回数と、最後の端数の刻み（dt 未満。なければ 0）に分ける。
 * 浮動小数点の誤差で整数倍が僅かにずれた値（例：0.1 ＝ 6×(1/60) 付近）は整数倍として扱う。
 */
export function splitSteps(seconds: number, dt: number): { fullSteps: number; remainder: number } {
  const ratio = seconds / dt;
  const nearest = Math.round(ratio);
  if (nearest >= 1 && Math.abs(ratio - nearest) <= STEP_EPSILON * Math.max(1, nearest)) {
    return { fullSteps: nearest, remainder: 0 };
  }
  const fullSteps = Math.floor(ratio);
  return { fullSteps, remainder: seconds - fullSteps * dt };
}

export interface SkillStats {
  readonly name: string;
  uses: number;
  hits: number;
  crits: number;
  damage: number;
}

export interface SimResult {
  readonly buildId: string;
  readonly targetName: string;
  /** 戦った時間（秒）。 */
  readonly seconds: number;
  /** 的を倒した時間（倒していなければ undefined）。 */
  readonly killTime: number | undefined;
  /** 実際に的のHPを減らしたダメージ（オーバーキル分を含まない）。 */
  readonly totalDamage: number;
  readonly hitDamage: number;
  readonly dotDamage: number;
  /**
   * 倒したヒット・持続ダメージのうち、的の残りHPを超えた分と、ボスの段階の境目で止まって減らなかった分
   * （集計に含めない。参考の値）。
   */
  readonly overkillDamage: number;
  /** ダメージを受けなかった時間（ボスの段階の切り替え・根渡り。秒）。 */
  readonly invulnerableSeconds: number;
  /** totalDamage ÷ seconds。 */
  readonly dps: number;
  readonly skills: readonly SkillStats[];
  /** 付与した状態異常の回数（タグ → 回数）。 */
  readonly ailmentsApplied: Readonly<Record<string, number>>;
  readonly staggerBreaks: number;
  /** 的の攻撃で受けたダメージ（防御の後）。 */
  readonly damageTaken: number;
  readonly damageTakenPerSecond: number;
  readonly mpSpent: number;
  /** 戦闘の終わりのMP。 */
  readonly finalMp: number;
  /** 持続ダメージの計算で、的が移動していたとして扱った時間（秒。経過時間 × 移動の割合）。 */
  readonly movingSeconds: number;
}

interface PreparedBuild {
  readonly attacker: DamageAttacker;
  readonly maxMp: number;
  readonly mpRegen: number;
  /** 技ごとの動作の時間（秒。rotation と同じ順）。 */
  readonly useTimes: readonly number[];
  readonly defense: { armor: number; evasion: number; resist: Partial<Record<Element, number>> };
}

/** 速度・回復の値が有限かつ正であることを確かめる（大きな負の加算などで0以下になったら RangeError）。 */
function positive(value: number, what: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${what}は有限かつ正の数（${String(value)}）`);
  }
  return value;
}

/** その技のヒットのタグ（技のタグ＋武器の技なら武器のタグ）。 */
function hitTags(skill: SimSkill, build: Build): string[] {
  return [...skill.tags, ...(skill.kind === "weapon" ? (build.weapon?.tags ?? []) : [])];
}

/** 装備の効果の出どころ（uid）。省略したら、ビルドの武器の uid。 */
function equipmentRef(source: string | undefined, build: Build): string {
  const ref = source ?? build.weapon?.uid;
  if (ref === undefined)
    throw new Error("装備の効果の出どころ（source）がなく、ビルドに武器もない");
  return ref;
}

function prepare(db: ContentDb, build: Build): PreparedBuild {
  const instances: EffectInstance[] = (build.effects ?? []).map((e) =>
    typeof e === "string"
      ? { effectId: e, source: { kind: "build", ref: e } }
      : {
          effectId: e.id,
          // 装備（武器）から来た効果は、出どころの種類を装備にする（局所の効果はその武器のヒットだけに効く）
          source:
            e.sourceKind === "equipment"
              ? { kind: EQUIPMENT_SOURCE_KIND, ref: equipmentRef(e.source, build) }
              : { kind: "build", ref: e.source ?? e.id },
          ...(e.stacks === undefined ? {} : { stacks: e.stacks }),
        },
  );
  const { view } = evaluateEffects(db, new TagIndex(db.tags), instances, {
    // 速度・回復の基礎の値も ModifierView に渡し、（基礎＋追加）×（1＋加算）×乗算 の規則で集計する
    baseStats: {
      "STAT-MP-MAX": BASE_MP + MP_PER_RI * (build.ri ?? 0),
      "STAT-MP-REGEN": MP_REGEN_RATIO,
      "STAT-ATTACK-SPEED": build.weapon?.attackSpeed ?? 1,
      "STAT-CAST-SPEED": 1,
      ...(build.baseStats ?? {}),
    },
    equippedTags: build.weapon === undefined ? {} : { mainHand: build.weapon.tags },
  });
  const maxMp = view.stat("STAT-MP-MAX").value;
  // 毎秒の回復 ＝ 最大MP × 回復の割合（基礎6% ×（1＋加算）× 乗算）
  const mpRegen = maxMp * view.stat("STAT-MP-REGEN").value;
  if (!Number.isFinite(mpRegen) || mpRegen < 0) {
    throw new RangeError(`MPの回復は有限かつ0以上（${String(mpRegen)}）`);
  }
  // 動作の時間：呪文の詠唱は詠唱速度、それ以外は攻撃速度（武器の速度 ×（1＋加算）× 乗算）で割る。
  // 武器の技の攻撃速度には、その武器の局所の効果も効く（呪文には効かない。仕様書v0.2 3.7 の原則5）
  const weaponScope: HitScope = { weaponUid: build.weapon?.uid };
  const useTimes = build.rotation.map((skill) => {
    const tags = hitTags(skill, build);
    if (skill.castTime !== undefined) {
      return skill.castTime / positive(view.stat("STAT-CAST-SPEED", tags).value, "詠唱速度");
    }
    const speed = view.stat(
      "STAT-ATTACK-SPEED",
      tags,
      skill.kind === "weapon" ? weaponScope : undefined,
    ).value;
    return (skill.useTimeMultiplier ?? 1) / positive(speed, "攻撃速度");
  });
  const resist: Partial<Record<Element, number>> = {};
  for (const e of ["physical", "lightning", "cold", "fire", "dark", "holy"] as const) {
    resist[e] = view.stat(`STAT-RESIST-${e.toUpperCase()}`).value;
  }
  return {
    attacker: {
      db,
      view,
      characterLevel: build.characterLevel,
      ...(build.weapon === undefined
        ? {}
        : {
            weapon: {
              uid: build.weapon.uid,
              tags: build.weapon.tags,
              base: build.weapon.base,
              critChance: build.weapon.critChance,
            },
          }),
    },
    maxMp,
    mpRegen,
    useTimes,
    defense: {
      armor: view.stat("STAT-ARMOR").value,
      evasion: view.stat("STAT-EVASION").value,
      resist,
    },
  };
}

function toDamageSkill(skill: SimSkill): DamageSkill {
  return {
    tags: skill.tags,
    kind: skill.kind,
    pct: skill.pct,
    ...(skill.base === undefined ? {} : { base: skill.base }),
  };
}

/**
 * 1つの時間刻み（幅 h のうち movingPart 秒が移動中）の持続ダメージを進め、その合計を返す。
 *
 * 移動と停止が混ざるときは、それぞれの時間で AilmentState.tick() を呼ぶ（tick の持続ダメージは経過時間に比例する）。
 * ただし tick は各持続ダメージを残り時間までしか進めないので、移動・停止の順に呼ぶだけでは、刻みの途中で切れる
 * 持続ダメージの有効な時間が、先に呼んだ側（移動）に偏る。そこで、持続ダメージが切れる時刻で刻みを区間に分け、
 * 各区間に同じ割合（movingPart ÷ h）で移動と停止を割り振る。刻みの途中で切れるものがなければ、区間は1つで従来と同じ。
 * 刻み全体が1つの状態（movingPart が 0 または h）なら、区間を分けずに1回だけ tick を呼ぶ（従来の結果を維持する）。
 */
export function tickDots(
  ailments: AilmentState,
  h: number,
  movingPart: number,
  target: Omit<AilmentTickTarget, "moving">,
): number {
  let total = 0;
  const tickSpan = (span: number, moving: boolean): void => {
    if (span <= 0) return;
    const dot = ailments.tick(span, { ...target, moving });
    for (const v of Object.values(dot)) total += v;
  };
  if (movingPart <= 0 || movingPart >= h) {
    tickSpan(h, movingPart > 0);
    return total;
  }
  const movingShare = movingPart / h;
  let left = h;
  let movingLeft = movingPart;
  // 区間ごとに少なくとも1つの持続ダメージが切れて取り除かれるので、繰り返しは有限
  for (;;) {
    const span = Math.min(left, ailments.nextDotExpiry());
    // 最後の区間は残りを全て使い、刻みの移動の時間の合計をちょうど movingPart にする
    const last = span >= left;
    const moving = last ? movingLeft : Math.min(movingLeft, span * movingShare);
    tickSpan(moving, true);
    tickSpan((last ? left : span) - moving, false);
    if (last) return total;
    movingLeft -= moving;
    left -= span;
  }
}

/** ビルドで的を攻撃し続けたときの結果を求める。同じ入力・同じシードなら、結果は同じ。 */
export function simulate(
  db: ContentDb,
  build: Build,
  target: Target,
  options: SimOptions,
): SimResult {
  const seconds = validateSeconds(options.seconds);
  const p = prepare(db, build);
  const root = Rng.fromSeed(options.seed);
  const combatRng = root.fork("combat");
  const ailmentRng = root.fork("ailment");
  const enemyRng = root.fork("enemy");
  const dt = FIXED_STEP_SECONDS;
  // 通常の刻みは dt。指定の時間が dt の整数倍でなければ、最後に残りの時間（dt 未満）の刻みを1回足す
  const { fullSteps, remainder } = splitSteps(seconds, dt);
  const steps = fullSteps + (remainder > 0 ? 1 : 0);

  const ailments = new AilmentState(db);
  const profiles = staggerProfiles(db);
  const stagger = new StaggerGauge(
    target.isBoss === true ? profiles.boss : profiles.enemy,
    target.maxHp ?? 1e9,
  );
  const resist = target.resist ?? {};
  const defender = { resist, armor: target.armor ?? 0, evasion: target.evasion ?? 0 };

  let mp = p.maxMp;
  let mpSpent = 0;
  let busy = 0;
  const cooldowns = new Map<string, number>();
  const skills: SkillStats[] = build.rotation.map((s) => ({
    name: s.name,
    uses: 0,
    hits: 0,
    crits: 0,
    damage: 0,
  }));
  const applied: Record<string, number> = {};
  let hitDamage = 0;
  let dotDamage = 0;
  let overkillDamage = 0;
  // 的の残りHP（HPのない的は倒れない）。実際にHPを減らした分だけを与えたダメージとして集計する
  let remainingHp = target.maxHp ?? Infinity;
  // ボスの段階：境目より下には減らず、境目に届くと invulnerable 秒の間ダメージを受けない
  const thresholds = target.phases?.thresholds ?? [];
  let phase = 1;
  let invulnerableUntil = 0;
  let phaseStartedAt = 0;
  let invulnerableSeconds = 0;
  const floorHp = (): number => {
    const t = thresholds[phase - 1];
    return t === undefined || target.maxHp === undefined ? 0 : target.maxHp * t;
  };
  /** 根渡りで地中にいるか（その刻みの始まりの時刻で判定する）。 */
  const burrowed = (t: number): boolean => {
    const b = target.burrow;
    if (b === undefined || phase < b.phase) return false;
    const since = t - (phaseStartedAt + (target.phases?.invulnerable ?? 0));
    return since >= 0 && since % b.period < b.duration;
  };
  /** ダメージを受けない時刻か（段階の切り替え・根渡り）。 */
  const invulnerableAt = (t: number): boolean => t < invulnerableUntil || burrowed(t);
  /** ダメージを的のHPに与え、実際に減らした分を返す（残りHPを超えた分はオーバーキルとして分ける）。 */
  const dealDamage = (amount: number, at: number): number => {
    if (invulnerableAt(at)) return 0;
    const floor = floorHp();
    const dealt = Math.min(amount, remainingHp - floor);
    overkillDamage += amount - dealt;
    remainingHp -= dealt;
    if (floor > 0 && remainingHp <= floor + 1e-9) {
      phase += 1;
      phaseStartedAt = at;
      invulnerableUntil = at + (target.phases?.invulnerable ?? 0);
    }
    return dealt;
  };
  let damageTaken = 0;
  let nextEnemyAttack = target.attack?.interval ?? Infinity;
  let killTime: number | undefined;
  let time = 0;
  // 移動している時間の割合（0〜1）。経過時間に対して均等に割り振る
  const ratio = target.movingRatio ?? 0;
  let movingSeconds = 0;
  const skillTags = build.rotation.map((s) => hitTags(s, build));

  for (let step = 0; step < steps; step++) {
    // この刻みの幅（最後の端数の刻みだけ dt 未満）。時間に依存する計算には、全てこの幅を渡す
    const partial = step >= fullSteps;
    const h = partial ? remainder : dt;
    // この刻みの始まりの時間（前の刻みの終わり）
    const stepStart = time;
    // 整数倍の刻みは従来どおり (step+1)×dt。端数の刻みの終わりは、ちょうど指定の時間
    time = partial ? seconds : (step + 1) * dt;
    mp = Math.min(p.maxMp, mp + p.mpRegen * h);
    for (const [name, left] of cooldowns) cooldowns.set(name, Math.max(0, left - h));
    // 動作の時間の端数は次の動作に持ち越す（1/60秒に丸めて、攻撃の回数がずれないように）
    busy -= h;

    // 技を使う（優先順位の高い順に、使えるものを1つ）
    if (busy <= 0) {
      const index = build.rotation.findIndex(
        (s) => (cooldowns.get(s.name) ?? 0) <= 0 && mp >= s.mpCost,
      );
      const skill = build.rotation[index];
      const stats = skills[index];
      const useTime = p.useTimes[index];
      const tags = skillTags[index];
      if (
        skill !== undefined &&
        stats !== undefined &&
        useTime !== undefined &&
        tags !== undefined
      ) {
        mp -= skill.mpCost;
        mpSpent += skill.mpCost;
        if (skill.cooldown > 0) cooldowns.set(skill.name, skill.cooldown);
        busy = Math.max(busy, -h) + useTime;
        stats.uses += 1;
        const damageSkill = toDamageSkill(skill);
        for (let h = 0; h < (skill.hits ?? 1); h++) {
          const hit = computeHit(
            p.attacker,
            damageSkill,
            { ...defender, takenMultiplier: stagger.takenMultiplier },
            { rng: combatRng },
          );
          stats.hits += hit.evaded ? 0 : 1;
          stats.crits += hit.crit ? 1 : 0;
          const dealt = dealDamage(hit.total, stepStart);
          stats.damage += dealt;
          hitDamage += dealt;
          // 残りHPが0になった時点で倒したとする。倒したヒットでは状態異常・崩しを新たに与えず、残りのヒットも計算しない
          if (remainingHp <= 0) {
            killTime = time;
            break;
          }
          // 局所の効果の範囲は、そのヒットに使った武器（core の computeHit が決める）に合わせる。
          // 呪文のヒットには武器の uid を渡さないので、武器の局所の効果は呪文に効かない
          const scope = hit.weaponUid === undefined ? {} : { weaponUid: hit.weaponUid };
          for (const a of rollAilments({
            db,
            view: p.attacker.view,
            hit,
            tags,
            ...(skill.ailmentChance === undefined ? {} : { skillChance: skill.ailmentChance }),
            ...scope,
            rng: ailmentRng,
          })) {
            ailments.apply(a);
            applied[a.tag] = (applied[a.tag] ?? 0) + 1;
          }
          stagger.add(
            staggerValue({
              db,
              view: p.attacker.view,
              hit,
              tags,
              ...(skill.staggerCoefficient === undefined
                ? {}
                : { coefficient: skill.staggerCoefficient }),
              ...scope,
            }),
          );
        }
      }
    }
    // ヒットで倒したら、その時点で戦闘を終える（持続ダメージ・的の攻撃は進めない）
    if (killTime !== undefined) break;

    if (busy < -h) busy = -h; // 使える技がない間は、端数を溜めない

    // 持続ダメージ・崩しの時間
    // 移動している時間は、刻みの回数ではなく経過時間で決める：時刻 t までの移動の時間 ＝ t × 割合。
    // この刻みの移動の時間は、その差（端数の刻みでも、実際の幅に応じた分だけ）。割合0・1は刻み全体を1つの状態で扱う
    const movingPart = burrowed(stepStart)
      ? h
      : ratio <= 0
        ? 0
        : ratio >= 1
          ? h
          : Math.min(h, Math.max(0, ratio * time - ratio * stepStart));
    if (invulnerableAt(stepStart)) invulnerableSeconds += h;
    movingSeconds += movingPart;
    const dotThisStep = tickDots(ailments, h, movingPart, {
      resist,
      takenMultiplier: stagger.takenMultiplier,
    });
    // 持続ダメージも、的の残りHPを超えた分は集計しない
    dotDamage += dealDamage(dotThisStep, stepStart);
    if (remainingHp <= 0) {
      killTime = time;
      break;
    }
    stagger.update(h);

    // 的の攻撃
    if (target.attack !== undefined && time >= nextEnemyAttack) {
      nextEnemyAttack += target.attack.interval;
      const raw =
        standardHp(target.level) *
        target.attack.ratioOfStandardHp *
        ailments.dealtMultiplier(target.isBoss === true);
      // 回避値は攻撃だけを避ける（仕様書2.6）。敵の命中は 40＋12×Lv（補助仕様書10.1）
      const evade =
        target.attack.spell === true
          ? 0
          : evadeChance(p.defense.evasion, target.attack.accuracy ?? enemyAccuracy(target.level));
      if (!enemyRng.chance(evade)) {
        let taken = raw * (1 - (p.defense.resist[target.attack.element] ?? 0));
        if (target.attack.element === "physical")
          taken *= 1 - armorReduction(p.defense.armor, taken);
        damageTaken += taken;
      }
    }
  }

  // DPSの分母は、実際に戦った時間（倒したらその時点、倒さなければ最後の時間刻みの終わり）
  const elapsed = killTime ?? time;
  const totalDamage = hitDamage + dotDamage;
  return {
    buildId: build.id,
    targetName: target.name,
    seconds: elapsed,
    killTime,
    invulnerableSeconds,
    totalDamage,
    hitDamage,
    dotDamage,
    overkillDamage,
    dps: totalDamage / elapsed,
    skills,
    ailmentsApplied: applied,
    staggerBreaks: stagger.breaks,
    damageTaken,
    damageTakenPerSecond: damageTaken / elapsed,
    mpSpent,
    finalMp: mp,
    movingSeconds,
  };
}
