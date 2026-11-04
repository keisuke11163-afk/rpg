/**
 * DPSシミュレーター（開発計画書 工程BL-1）。
 *
 * 描画なしで、固定の時間刻み（1/60秒）で戦闘を早送りする。ダメージ・状態異常・崩しの計算は、
 * ゲーム本体と同じ core の関数を使う。位置・移動・敵の行動は扱わない（標準の的を殴り続ける）。
 */
import {
  type ContentDb,
  type DamageAttacker,
  type DamageSkill,
  type EffectInstance,
  type Element,
  AilmentState,
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
  /** 戦う時間の上限（秒）。的のHPが有限なら、倒した時点で終わる。 */
  readonly seconds: number;
  readonly seed: number | string;
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
  readonly totalDamage: number;
  readonly hitDamage: number;
  readonly dotDamage: number;
  readonly dps: number;
  readonly skills: readonly SkillStats[];
  /** 付与した状態異常の回数（タグ → 回数）。 */
  readonly ailmentsApplied: Readonly<Record<string, number>>;
  readonly staggerBreaks: number;
  /** 的の攻撃で受けたダメージ（防御の後）。 */
  readonly damageTaken: number;
  readonly damageTakenPerSecond: number;
  readonly mpSpent: number;
}

interface PreparedBuild {
  readonly attacker: DamageAttacker;
  readonly maxMp: number;
  readonly mpRegen: number;
  readonly attackSpeed: number;
  readonly castSpeed: number;
  readonly defense: { armor: number; evasion: number; resist: Partial<Record<Element, number>> };
}

function prepare(db: ContentDb, build: Build): PreparedBuild {
  const instances: EffectInstance[] = (build.effects ?? []).map((e) =>
    typeof e === "string"
      ? { effectId: e, source: { kind: "build", ref: e } }
      : {
          effectId: e.id,
          source: { kind: "build", ref: e.source ?? e.id },
          ...(e.stacks === undefined ? {} : { stacks: e.stacks }),
        },
  );
  const { view } = evaluateEffects(db, new TagIndex(db.tags), instances, {
    baseStats: {
      "STAT-MP-MAX": BASE_MP + MP_PER_RI * (build.ri ?? 0),
      ...(build.baseStats ?? {}),
    },
    equippedTags: build.weapon === undefined ? {} : { mainHand: build.weapon.tags },
  });
  const maxMp = view.stat("STAT-MP-MAX").value;
  const regenInc = view.stat("STAT-MP-REGEN").increased;
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
    mpRegen: maxMp * MP_REGEN_RATIO * (1 + regenInc),
    attackSpeed: (build.weapon?.attackSpeed ?? 1) * (1 + view.stat("STAT-ATTACK-SPEED").increased),
    castSpeed: 1 + view.stat("STAT-CAST-SPEED").increased,
    defense: {
      armor: view.stat("STAT-ARMOR").value,
      evasion: view.stat("STAT-EVASION").value,
      resist,
    },
  };
}

function useTime(skill: SimSkill, p: PreparedBuild): number {
  if (skill.castTime !== undefined) return skill.castTime / p.castSpeed;
  return (skill.useTimeMultiplier ?? 1) / p.attackSpeed;
}

function toDamageSkill(skill: SimSkill): DamageSkill {
  return {
    tags: skill.tags,
    kind: skill.kind,
    pct: skill.pct,
    ...(skill.base === undefined ? {} : { base: skill.base }),
  };
}

/** ビルドで的を攻撃し続けたときの結果を求める。同じ入力・同じシードなら、結果は同じ。 */
export function simulate(
  db: ContentDb,
  build: Build,
  target: Target,
  options: SimOptions,
): SimResult {
  const p = prepare(db, build);
  const root = Rng.fromSeed(options.seed);
  const combatRng = root.fork("combat");
  const ailmentRng = root.fork("ailment");
  const enemyRng = root.fork("enemy");
  const dt = FIXED_STEP_SECONDS;
  const steps = Math.ceil(options.seconds / dt);

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
  let damageTaken = 0;
  let nextEnemyAttack = target.attack?.interval ?? Infinity;
  let killTime: number | undefined;
  let time = 0;

  for (let step = 0; step < steps; step++) {
    time = (step + 1) * dt;
    mp = Math.min(p.maxMp, mp + p.mpRegen * dt);
    for (const [name, left] of cooldowns) cooldowns.set(name, Math.max(0, left - dt));
    // 動作の時間の端数は次の動作に持ち越す（1/60秒に丸めて、攻撃の回数がずれないように）
    busy -= dt;

    // 技を使う（優先順位の高い順に、使えるものを1つ）
    if (busy <= 0) {
      const index = build.rotation.findIndex(
        (s) => (cooldowns.get(s.name) ?? 0) <= 0 && mp >= s.mpCost,
      );
      const skill = build.rotation[index];
      const stats = skills[index];
      if (skill !== undefined && stats !== undefined) {
        mp -= skill.mpCost;
        mpSpent += skill.mpCost;
        if (skill.cooldown > 0) cooldowns.set(skill.name, skill.cooldown);
        busy = Math.max(busy, -dt) + useTime(skill, p);
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
          stats.damage += hit.total;
          hitDamage += hit.total;
          const tags = [
            ...skill.tags,
            ...(skill.kind === "weapon" ? (build.weapon?.tags ?? []) : []),
          ];
          for (const a of rollAilments({
            db,
            view: p.attacker.view,
            hit,
            tags,
            ...(skill.ailmentChance === undefined ? {} : { skillChance: skill.ailmentChance }),
            ...(build.weapon === undefined ? {} : { weaponUid: build.weapon.uid }),
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
            }),
          );
        }
      }
    }

    if (busy < -dt) busy = -dt; // 使える技がない間は、端数を溜めない

    // 持続ダメージ・崩しの時間
    // 移動している時間の割合を、時間の上で均等に割り振る
    const ratio = target.movingRatio ?? 0;
    const moving = Math.floor((step + 1) * ratio) > Math.floor(step * ratio);
    const dot = ailments.tick(dt, { resist, takenMultiplier: stagger.takenMultiplier, moving });
    for (const v of Object.values(dot)) dotDamage += v;
    stagger.update(dt);

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

    if (target.maxHp !== undefined && hitDamage + dotDamage >= target.maxHp) {
      killTime = time;
      break;
    }
  }

  const seconds = killTime ?? time;
  const totalDamage = hitDamage + dotDamage;
  return {
    buildId: build.id,
    targetName: target.name,
    seconds,
    killTime,
    totalDamage,
    hitDamage,
    dotDamage,
    dps: totalDamage / seconds,
    skills,
    ailmentsApplied: applied,
    staggerBreaks: stagger.breaks,
    damageTaken,
    damageTakenPerSecond: damageTaken / seconds,
    mpSpent,
  };
}
