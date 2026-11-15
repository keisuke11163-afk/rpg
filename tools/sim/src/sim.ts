/**
 * DPSシミュレーター（開発計画書 BL-1）。描画なしで戦闘を固定の時間刻みで早送りする。
 * ビルドをデータで定義し、DPS・撃破時間・受けたダメージを出す。同じシードなら同じ結果。
 */
import {
  AilmentSet,
  TICKS_PER_SECOND,
  TICK_SECONDS,
  computeDamage,
  createRng,
  critChance,
  critMultiplier,
  evaluate,
  hitChance,
  rollApply,
  applyChance,
  ailmentsForElements,
  type ActiveEffect,
  type AilmentKind,
  type Element,
  type EvalContext,
} from "@stella/core";

export interface WeaponDef {
  name: string;
  min: number;
  max: number;
  /** 回/秒 */
  speed: number;
  /** 基本の会心率 */
  crit: number;
}

/** 武器種（下級ベース。本仕様書 3.2） */
export const WEAPONS: Readonly<Record<string, WeaponDef>> = {
  longsword: { name: "長剣", min: 6, max: 11, speed: 1.4, crit: 0.05 },
  greatsword: { name: "大剣", min: 14, max: 24, speed: 1.05, crit: 0.05 },
  dagger: { name: "短剣", min: 4, max: 9, speed: 1.6, crit: 0.08 },
};

export interface SkillDef {
  name: string;
  /** 技倍率（1.0 = 武器ダメージ100%） */
  multiplier: number;
  /** クールダウン（秒）。0なら通常攻撃（武器の速度で連続して出す） */
  cooldown: number;
  /** 動作時間（秒）。通常攻撃は 1÷攻撃速度 */
  castSeconds?: number;
  breakCoefficient?: number;
  /** 状態異常の基本付与率 */
  ailments?: Partial<Record<AilmentKind, number>>;
}

export interface BuildDef {
  name: string;
  charLevel: number;
  weapon: WeaponDef;
  /** 先に書いた技を優先して使う */
  skills: readonly SkillDef[];
  /** ダメージの補正の効果（ツリー・装備）。出どころつき */
  effects?: readonly ActiveEffect[];
  stats?: Readonly<Record<string, number>>;
  /** 攻撃速度の補正（0.1 = +10%） */
  attackSpeedBonus?: number;
}

export interface TargetDef {
  maxHp: number;
  armor?: number;
  evasion?: number;
  isBoss?: boolean;
  resistance?: Partial<Record<Element, number>>;
}

/** 標準の的。HPはLvに応じた値（本仕様書 2.8）を呼び出し側が渡す */
export const STANDARD_DUMMY: TargetDef = { maxHp: 1_000_000 };

export interface SimResult {
  seconds: number;
  totalDamage: number;
  dps: number;
  hits: number;
  crits: number;
  /** 的が倒れた時刻（倒れなければ undefined） */
  timeToKill: number | undefined;
  /** 受けたダメージ（今のモデルでは敵の攻撃を持たないので常に0。U-09以降で拡張） */
  damageTaken: number;
}

/** 的を倒すか、duration 秒たつまで戦う */
export function simulate(
  build: BuildDef,
  target: TargetDef,
  options: { seed: number | string; maxSeconds?: number },
): SimResult {
  const rng = createRng(options.seed);
  const maxTicks = Math.round((options.maxSeconds ?? 60) * TICKS_PER_SECOND);
  const ctx: EvalContext = {
    tags: new Set(),
    stats: { ...build.stats },
    counts: {},
    flags: new Set(),
  };
  const ev = evaluate(build.effects ?? [], ctx);
  const dmgMods = ev.stat({ stat: "ダメージ" }, 0);
  const physMods = ev.stat({ stat: "ダメージ", element: "physical", onlyFiltered: true }, 0);
  const critIncrease = ev.stat({ stat: "会心率" }, 0).addPct;
  const speedBonus = (build.attackSpeedBonus ?? 0) + ev.stat({ stat: "攻撃速度" }, 0).addPct;
  const attackSpeed = build.weapon.speed * (1 + speedBonus);

  const ailments = new AilmentSet({ maxHp: target.maxHp, isBoss: target.isBoss === true });
  const cooldowns = new Map<string, number>();
  let busyUntil = 0;
  let total = 0;
  let hits = 0;
  let crits = 0;
  let ttk: number | undefined;
  let tick = 0;

  for (; tick < maxTicks && ttk === undefined; tick++) {
    const now = tick * TICK_SECONDS;
    // 持続ダメージ
    const dots = ailments.tick(TICK_SECONDS, {
      addPct: ev.stat({ stat: "状態異常ダメージ" }, 0).addPct,
      mult: 1,
      enemyDamageTaken: ailments.enemyDamageTakenMultiplier,
      resistance: target.resistance ?? {},
    });
    for (const d of dots) total += d.damage;

    if (now >= busyUntil) {
      const skill = build.skills.find((s) => now >= (cooldowns.get(s.name) ?? 0));
      if (skill) {
        const cast = skill.castSeconds ?? 1 / attackSpeed;
        busyUntil = now + cast;
        if (skill.cooldown > 0) cooldowns.set(skill.name, now + skill.cooldown);
        if (
          rng.chance(
            hitChance(target.evasion ?? 0, 2 * build.charLevel + (build.stats?.["迅"] ?? 0) * 3),
          )
        ) {
          const isCrit = rng.chance(critChance(build.weapon.crit, 0, critIncrease));
          const base = rng.int(build.weapon.min * 100, build.weapon.max * 100) / 100;
          const strength = build.stats?.["剛"] ?? 0;
          const result = computeDamage({
            base: { physical: base },
            skillMultiplier: skill.multiplier,
            generic: { addPct: dmgMods.addPct + strength * 0.002, mult: dmgMods.mult },
            byElement: { physical: { addPct: physMods.addPct, mult: physMods.mult } },
            crit: isCrit,
            critMultiplier: critMultiplier(ev.stat({ stat: "会心倍率" }, 0).flat),
            enemyDamageTaken: ailments.enemyDamageTakenMultiplier,
            resistance: target.resistance ?? {},
            ...(target.armor !== undefined ? { armor: target.armor } : {}),
          });
          hits++;
          if (isCrit) crits++;
          total += result.total;
          for (const kind of ailmentsForElements(Object.keys(result.reference) as Element[])) {
            const chance = applyChance(
              skill.ailments?.[kind] ?? 0,
              ev.stat({ stat: "付与率", ailment: kind }, 0).addPct,
            );
            if (chance > 0 && rollApply(rng, chance))
              ailments.apply(kind, { reference: result.reference });
          }
        }
      }
    }
    if (total >= target.maxHp) ttk = (tick + 1) * TICK_SECONDS;
  }
  const seconds = tick * TICK_SECONDS;
  return {
    seconds,
    totalDamage: total,
    dps: seconds > 0 ? total / seconds : 0,
    hits,
    crits,
    timeToKill: ttk,
    damageTaken: 0,
  };
}
