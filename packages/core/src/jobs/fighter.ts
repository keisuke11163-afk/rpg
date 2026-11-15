/**
 * 技を使う者（プレイヤー）の状態と、技の実行の仕組み。ジョブに依らない汎用の部分。
 * コスト・クールダウン・形・倍率・武器による変化・激化・職能ゲージ・適性を扱う。
 */
import type { Rng } from "../rng.ts";
import type { Vec2 } from "../player/controller.ts";
import { strike, type Combatant, type HitResult, type HitSpec } from "../combat/combatant.ts";
import type { HitShape } from "../combat/geometry.ts";
import type { WeaponDef } from "../combat/weapons.ts";
import { JobGauge, type GaugeDef } from "./gauge.ts";
import {
  APTITUDE_SPEED,
  type Aptitude,
  type SkillDef,
  type SkillPatch,
  type WeaponClass,
} from "./skills.ts";

export interface FighterInit {
  maxHp: number;
  maxMp: number;
  weapon: WeaponDef;
  weaponClass: WeaponClass;
  /** 技の変化のキーにする武器。二刀流のとき "dualWield" を渡すと、二刀流の変化も重ねる */
  dualWield?: boolean;
  aptitude: Aptitude;
  jobLevel: number;
  skills: readonly SkillDef[];
  gauge: GaugeDef;
  stats?: Readonly<Record<string, number>>;
  accuracy?: number;
}

/** 実際に使うときの技の値（激化・武器による変化を反映した後） */
export interface EffectiveSkill {
  skill: SkillDef;
  shape: HitShape;
  multiplier: number;
  breakBonus: number;
  ailments: Partial<Record<string, number>>;
  hits: number;
  hooks: string[];
  breaksAll: boolean;
  dashDistance: number;
  intensified: boolean;
}

function scaleShape(shape: HitShape, scale: number): HitShape {
  if (scale === 1) return shape;
  switch (shape.kind) {
    case "circle":
      return { ...shape, radius: shape.radius * scale };
    case "cone":
      return { ...shape, range: shape.range * scale };
    case "line":
      return { ...shape, length: shape.length * scale };
  }
}

export type UseDenied = "unknown" | "notLearned" | "mp" | "cooldown" | "gauge" | "stunned";

export interface UseOutcome {
  ok: boolean;
  reason?: UseDenied;
  effective?: EffectiveSkill;
  /** 衝突の結果（ヒットごと） */
  hits: { target: Combatant; result: HitResult }[];
  /** 突進で移動した後の位置 */
  movedTo?: Vec2;
}

export class Fighter {
  readonly init: FighterInit;
  hp: number;
  mp: number;
  readonly gauge: JobGauge;
  stunLeft = 0;
  /** 技ごとの残りクールダウン */
  private readonly cooldowns = new Map<string, number>();
  /** 与ダメージ・被ダメージなどの一時効果 */
  buffs = {
    attackBonus: { value: 0, left: 0 },
    damageTaken: { value: 1, left: 0 },
  };
  /** 外から与える補正（ツリー・装備の効果を集計した値） */
  damageAddPct = 0;
  damageMult = 1;
  attackSpeedBonus = 0;

  constructor(init: FighterInit) {
    this.init = init;
    this.hp = init.maxHp;
    this.mp = init.maxMp;
    this.gauge = new JobGauge(init.gauge);
  }

  get attackSpeed(): number {
    return (
      this.init.weapon.speed * (1 + APTITUDE_SPEED[this.init.aptitude] + this.attackSpeedBonus)
    );
  }

  knownSkills(): SkillDef[] {
    return this.init.skills.filter((s) => s.learnLevel <= this.init.jobLevel);
  }

  cooldownLeft(id: string): number {
    return this.cooldowns.get(id) ?? 0;
  }

  /** 技の実際の値：ベース → 激化 → 武器による変化（適性Sは強化版）の順に重ねる */
  effective(skill: SkillDef): EffectiveSkill {
    const eff: EffectiveSkill = {
      skill,
      shape: skill.shape,
      multiplier: skill.multiplier,
      breakBonus: 0,
      ailments: {},
      hits: skill.hitTimes.length,
      hooks: [],
      breaksAll: false,
      dashDistance: skill.shape.kind === "line" ? skill.shape.length : 0,
      intensified: false,
    };
    const apply = (p: SkillPatch | undefined): void => {
      if (!p) return;
      if (p.shape) {
        eff.shape = p.shape;
        if (p.shape.kind === "line") eff.dashDistance = p.shape.length;
      }
      if (p.rangeScale) eff.shape = scaleShape(eff.shape, p.rangeScale);
      if (p.multiplier !== undefined) eff.multiplier = p.multiplier;
      if (p.breakBonus) eff.breakBonus += p.breakBonus;
      for (const [k, v] of Object.entries(p.ailments ?? {})) {
        eff.ailments[k] = (eff.ailments[k] ?? 0) + v;
      }
      if (p.hitsPerSecond !== undefined)
        eff.hits = Math.round(p.hitsPerSecond * skill.totalSeconds);
      if (p.hooks) eff.hooks.push(...p.hooks);
      if (p.breaksAll) eff.breaksAll = true;
      if (p.dashDistanceAdd) eff.dashDistance += p.dashDistanceAdd;
    };
    if (!skill.release && this.gauge.intensified) {
      eff.intensified = true;
      apply(skill.intensified);
    }
    const key: WeaponClass = this.init.weaponClass;
    apply(skill.weaponVariants?.[key]);
    if (this.init.dualWield === true) apply(skill.weaponVariants?.dualWield);
    // 適性Sは「強化版」：変化の効果が1段強まる（数値は仮。強化の内容は仕様の疑問として報告）
    if (this.init.aptitude === "S" && skill.weaponVariants?.[key]) eff.hooks.push("enhanced");
    return eff;
  }

  canUse(id: string): { ok: boolean; reason?: UseDenied } {
    const skill = this.init.skills.find((s) => s.id === id);
    if (!skill) return { ok: false, reason: "unknown" };
    if (skill.learnLevel > this.init.jobLevel) return { ok: false, reason: "notLearned" };
    if (this.stunLeft > 0) return { ok: false, reason: "stunned" };
    if (this.cooldownLeft(id) > 0) return { ok: false, reason: "cooldown" };
    if (skill.release && !this.gauge.canRelease) return { ok: false, reason: "gauge" };
    if (this.mp < skill.mpCost) return { ok: false, reason: "mp" };
    return { ok: true };
  }

  /** ヒットの内容を作る（武器のダメージを振り、補正を載せる） */
  hitSpec(eff: EffectiveSkill, rng: Rng): HitSpec {
    const { weapon } = this.init;
    const strength = this.init.stats?.["剛"] ?? 0;
    const addPct =
      this.damageAddPct +
      strength * 0.002 +
      (this.buffs.attackBonus.left > 0 ? this.buffs.attackBonus.value : 0);
    const ailmentBase: HitSpec["ailmentBase"] = eff.ailments;
    return {
      shape: eff.shape,
      damage: {
        base: { physical: rng.int(weapon.min * 100, weapon.max * 100) / 100 },
        skillMultiplier: eff.multiplier,
        generic: { addPct, mult: this.damageMult },
      },
      weaponCrit: weapon.crit,
      accuracy: this.init.accuracy ?? 2,
      breakCoefficient: eff.skill.breakCoefficient,
      breakBonus: eff.breakBonus,
      ailmentBase,
    };
  }

  /** 技を使う。コストを払い、ヒットを全て解決する（動作の時間は呼び出し側が管理してよい） */
  use(
    id: string,
    origin: Vec2,
    angle: number,
    targets: readonly Combatant[],
    rng: Rng,
  ): UseOutcome {
    const check = this.canUse(id);
    if (!check.ok)
      return { ok: false, ...(check.reason ? { reason: check.reason } : {}), hits: [] };
    const skill = this.init.skills.find((s) => s.id === id) as SkillDef;
    const eff = this.effective(skill);

    this.mp -= skill.mpCost;
    this.cooldowns.set(id, skill.cooldownSeconds);
    if (skill.release) this.gauge.consume();
    if (skill.gaugeGain) this.gauge.add(skill.gaugeGain);
    if (skill.buff) {
      if (skill.buff.attackBonus)
        this.buffs.attackBonus = { value: skill.buff.attackBonus, left: skill.buff.seconds };
      if (skill.buff.damageTakenMultiplier) {
        this.buffs.damageTaken = {
          value: skill.buff.damageTakenMultiplier,
          left: skill.buff.seconds,
        };
      }
      if (skill.buff.enemyBreakBonus) {
        const area = eff.shape;
        for (const t of targets) {
          const dist = Math.hypot(t.pos.x - origin.x, t.pos.y - origin.y);
          if (area.kind === "circle" && dist <= area.radius) {
            t.breakTaken = { bonus: skill.buff.enemyBreakBonus, left: skill.buff.seconds };
          }
        }
      }
    }

    const out: UseOutcome = { ok: true, effective: eff, hits: [] };
    if (skill.multiplier === 0 && eff.multiplier === 0) return out;

    let from = origin;
    let shape = eff.shape;
    if (skill.kind === "dash") {
      shape = {
        kind: "line",
        length: eff.dashDistance,
        width: skill.shape.kind === "line" ? skill.shape.width : 1.2,
      };
      out.movedTo = {
        x: origin.x + Math.cos(angle) * eff.dashDistance,
        y: origin.y + Math.sin(angle) * eff.dashDistance,
      };
    }
    const heavy = skill.tags.includes("重撃");
    const hitCount = Math.max(1, eff.hits);
    for (let i = 0; i < hitCount; i++) {
      const spec = { ...this.hitSpec({ ...eff, shape }, rng) };
      const results = strike(from, angle, targets, spec, rng);
      for (const r of results) {
        if (r.result.hit) this.gauge.onHit(heavy);
        if (eff.breaksAll) r.target.breakGauge.add(r.target.breakGauge.currentMax);
      }
      out.hits.push(...results);
    }
    from = origin;
    return out;
  }

  /** 攻撃を受けた。無敵でなければ呼ぶ。被ダメージ軽減を反映してHPを減らす */
  takeDamage(raw: number): number {
    const dmg = raw * (this.buffs.damageTaken.left > 0 ? this.buffs.damageTaken.value : 1);
    this.hp = Math.max(0, this.hp - dmg);
    this.gauge.onDamaged(dmg, this.init.maxHp);
    return dmg;
  }

  tick(dt: number): void {
    for (const [id, left] of this.cooldowns) {
      const next = Math.max(0, left - dt);
      if (next === 0) this.cooldowns.delete(id);
      else this.cooldowns.set(id, next);
    }
    this.buffs.attackBonus.left = Math.max(0, this.buffs.attackBonus.left - dt);
    this.buffs.damageTaken.left = Math.max(0, this.buffs.damageTaken.left - dt);
    this.stunLeft = Math.max(0, this.stunLeft - dt);
    // MPは毎秒、最大MPの6%回復する（本仕様書 2.3）
    this.mp = Math.min(this.init.maxMp, this.mp + this.init.maxMp * 0.06 * dt);
    this.gauge.tick(dt);
  }
}
