/**
 * 技を使う者（プレイヤー）の状態と、技の実行の仕組み。ジョブに依らない汎用の部分。
 * コスト・クールダウン・形・倍率・武器による変化・激化・職能ゲージ・適性を扱う。
 */
import type { Rng } from "../rng.ts";
import type { Vec2 } from "../player/controller.ts";
import {
  resolveHit,
  strike,
  type Combatant,
  type HitResult,
  type HitSpec,
} from "../combat/combatant.ts";
import type { AilmentKind } from "../combat/ailments.ts";
import { armorReduction } from "../combat/damage.ts";
import type { HitShape } from "../combat/geometry.ts";
import type { GroundEffects } from "../combat/zones.ts";
import type { WeaponDef } from "../combat/weapons.ts";
import type { GearStats } from "../items/gear.ts";
import {
  evaluate,
  type ActiveEffect,
  type Evaluation,
  type HookCall,
} from "../effects/evaluate.ts";
import type { EvalContext } from "../effects/conditions.ts";
import { JobGauge, type GaugeDef } from "./gauge.ts";
import {
  APTITUDE_SPEED,
  type Aptitude,
  type SkillDef,
  type SkillPatch,
  type WeaponClass,
} from "./skills.ts";

/** タグID（TAG-AIL-BLEED など）→ 状態異常の種類 */
function tagToAilment(tag: unknown): AilmentKind | undefined {
  if (typeof tag !== "string") return undefined;
  const map: Record<string, AilmentKind> = {
    "TAG-AIL-BLEED": "bleed",
    "TAG-AIL-POISON": "poison",
    "TAG-AIL-BURN": "burn",
    "TAG-AIL-CHILL": "chill",
    "TAG-AIL-FREEZE": "freeze",
    "TAG-AIL-SHOCK": "shock",
    "TAG-AIL-WEAKEN": "weaken",
    "TAG-AIL-STIGMA": "stigma",
  };
  return map[tag];
}

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
  /** 背面判定の補正（盗賊の職能：会心率+10%（固定値）・付与率+25%。本仕様書 5.6） */
  backstab?: { critAdd: number; ailmentAdd: number };
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

export type UseDenied =
  "unknown" | "notLearned" | "mp" | "cooldown" | "gauge" | "stunned" | "noTarget";

/** 技を使うときの周囲の情報 */
export interface UseContext {
  /** 照準の点（ワールド座標）。地面に置く技・瞬間移動に使う */
  aim?: Vec2;
  /** 地面に置く効果の置き場 */
  ground?: GroundEffects;
}

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
    /** 状態異常の付与率の加算（毒塗り） */
    ailmentBonus: { value: {} as Partial<Record<string, number>>, left: 0 },
  };
  /** 外から与える補正（ツリー・装備の効果を集計した値） */
  damageAddPct = 0;
  damageMult = 1;
  attackSpeedBonus = 0;

  /** 装備から決まる能力値。装備が変わるたびに差し替える（保存しない） */
  private gearStats: GearStats | undefined;

  constructor(init: FighterInit) {
    this.init = init;
    this.hp = init.maxHp;
    this.mp = init.maxMp;
    this.gauge = new JobGauge(init.gauge);
  }

  /** 星辰盤・職紋盤などの効果の評価結果と、技ごとのタグを求める関数 */
  private effects:
    { ev: Evaluation; tagsFor: (skill: SkillDef) => ReadonlySet<string> } | undefined;

  /**
   * ツリーなどの効果の元（効果の一覧と、第1段階の文脈）。ヒットの瞬間の状態（崩れた敵・HP50%以下の敵など）で
   * 条件が変わる効果は、ヒットごとに評価し直す。
   */
  private source:
    | {
        entries: readonly ActiveEffect[];
        ctx: EvalContext;
        tagsFor: (skill: SkillDef) => ReadonlySet<string>;
        cache: Map<string, Evaluation>;
      }
    | undefined;
  /** 技を使っている間だけ有効な旗（戦闘外からの最初の一撃・連刃を使用中など） */
  private useFlags: ReadonlySet<string> = new Set();

  setEffectSource(
    entries: readonly ActiveEffect[] | undefined,
    ctx: EvalContext,
    tagsFor: (skill: SkillDef) => ReadonlySet<string> = () => new Set(),
  ): void {
    this.source = entries ? { entries, ctx, tagsFor, cache: new Map() } : undefined;
    this.effects = undefined;
  }

  private evalWith(dyn: ReadonlySet<string>): Evaluation | undefined {
    const src = this.source;
    if (!src) return this.effects?.ev;
    const key = [...dyn].sort().join("|");
    let ev = src.cache.get(key);
    if (!ev) {
      ev = evaluate(src.entries, { ...src.ctx, flags: new Set([...src.ctx.flags, ...dyn]) });
      src.cache.set(key, ev);
    }
    return ev;
  }

  /** ツリーなどの効果を反映する。tagsFor は、技が持つタグ（親タグ展開済みのID）を返す */
  setEffects(
    ev: Evaluation | undefined,
    tagsFor: (skill: SkillDef) => ReadonlySet<string> = () => new Set(),
  ): void {
    this.effects = ev ? { ev, tagsFor } : undefined;
  }

  /** ツリーの効果の合計（加算％）。stat は能力値の名前 */
  private fx(
    stat: string,
    skill?: SkillDef,
    dyn: ReadonlySet<string> = this.useFlags,
  ): { addPct: number; mult: number; flat: number } {
    const ev = this.evalWith(dyn);
    if (!ev) return { addPct: 0, mult: 1, flat: 0 };
    const tagsFor = this.source?.tagsFor ?? this.effects?.tagsFor;
    const r = ev.stat({ stat, ...(skill && tagsFor ? { tags: tagsFor(skill) } : {}) });
    return { addPct: r.addPct, mult: r.mult, flat: r.flat };
  }

  /** 効果が呼んでいるルールフック（ユニーク・職紋盤など）。同じ名前が複数あれば、後のもの（潜在効果）が優先 */
  private rule(name: string): HookCall | undefined {
    const hooks = this.evalWith(this.useFlags)?.hooks() ?? [];
    let found: HookCall | undefined;
    for (const h of hooks) if (h.hook === name) found = h;
    return found;
  }

  private ruleNum(name: string, key: string, fallback: number): number {
    const v = this.rule(name)?.params[key];
    return typeof v === "number" ? v : fallback;
  }

  /** 止まっている秒数（樹皮の盾：1秒ごとに防具値+10%）。動くと0に戻る */
  private stillSeconds = 0;
  private travelled = 0;
  private cdReducedThisSecond = 0;
  private cdWindow = 0;
  /** 移動の技の後、全てのヒットを背面扱いにする残り時間（背向けの外套） */
  private forceBackLeft = 0;
  private backGainCooldown = 0;

  /** 毎刻、プレイヤーが動いたか・動いた距離を伝える（静止の判定・旅人の古靴の短縮） */
  noteMovement(moving: boolean, distance: number, dt: number): void {
    this.stillSeconds = moving ? 0 : this.stillSeconds + dt;
    if (distance <= 0) return;
    this.travelled += distance;
    const every = this.ruleNum("移動距離ごとのCD短縮", "distance", 0);
    const seconds = this.ruleNum("移動距離ごとのCD短縮", "seconds", 0);
    const max = this.ruleNum("移動距離ごとのCD短縮", "maxPerSecond", Infinity);
    while (every > 0 && this.travelled >= every) {
      this.travelled -= every;
      // 1秒あたりの短縮には上限がある
      if (this.cdReducedThisSecond + seconds <= max) {
        this.cdReducedThisSecond += seconds;
        for (const [id, left] of this.cooldowns) {
          this.cooldowns.set(id, Math.max(0, left - seconds));
        }
      }
    }
  }

  /** 移動速度の倍率（装備・ツリーの移動速度の加算）。-12%などは 0.88 */
  get moveSpeedMultiplier(): number {
    return Math.max(0.1, 1 + this.gearTotal("移動速度") + this.fx("移動速度").addPct);
  }

  /** 止まっているあいだの防具値の倍率（樹皮の盾） */
  get armorMultiplier(): number {
    const per = this.ruleNum("静止で防具値上昇", "perSecond", 0);
    const max = this.ruleNum("静止で防具値上昇", "max", 0);
    return 1 + Math.min(max, per * Math.floor(this.stillSeconds));
  }

  /** 対象の状態から決まる旗 */
  private targetFlags(t: Combatant): Set<string> {
    const f = new Set(this.useFlags);
    if (t.breakGauge.broken) f.add("崩れた敵");
    if (t.hp <= t.maxHp * 0.5) f.add("HPが50%以下の敵");
    if (t.ailments.slow > 0) f.add("冷却状態の敵");
    if (t.ailments.stackCount("bleed") > 0) f.add("出血している敵");
    if (t.ailments.stackCount("poison") > 0) f.add("毒を受けている敵");
    return f;
  }

  /** 装備の能力値を反映する。最大HPが変わったら、HPは範囲内に収める */
  setGear(gear: GearStats | undefined): void {
    this.gearStats = gear;
    this.hp = Math.min(this.hp, this.maxHp);
  }

  private gearTotal(stat: string): number {
    return this.gearStats?.totals[stat] ?? 0;
  }

  get maxHp(): number {
    return Math.round(
      (this.init.maxHp + this.gearTotal("最大HP") + this.fx("最大HP").flat) *
        (1 + this.gearTotal("最大HP増加%")),
    );
  }

  /** 実際に使う武器の値（装備があれば装備の値） */
  get weapon(): WeaponDef {
    const w = this.gearStats?.weapon;
    return w
      ? { name: this.init.weapon.name, min: w.min, max: w.max, speed: w.speed, crit: w.crit }
      : this.init.weapon;
  }

  /** 武器のダメージの幅（局所の追加ダメージを含む）。ヒットの抽選と、能力値の表示の両方が使う */
  weaponDamageRange(): {
    physical: { min: number; max: number };
    fire: { min: number; max: number };
  } {
    const w = this.weapon;
    const ap = this.gearStats?.weapon?.addedPhysical ?? { min: 0, max: 0 };
    const af = this.gearStats?.weapon?.addedFire ?? { min: 0, max: 0 };
    return { physical: { min: w.min + ap.min, max: w.max + ap.max }, fire: af };
  }

  get critIncrease(): number {
    return this.gearTotal("会心率増加%");
  }

  get attackSpeed(): number {
    return (
      this.weapon.speed *
      (1 +
        APTITUDE_SPEED[this.init.aptitude] +
        this.attackSpeedBonus +
        this.gearTotal("攻撃速度") +
        this.fx("攻撃速度").addPct)
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
      if (p.hits !== undefined) eff.hits = p.hits;
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
    if (skill.finisher && this.gauge.value < 1) return { ok: false, reason: "gauge" };
    if (this.mp < skill.mpCost) return { ok: false, reason: "mp" };
    return { ok: true };
  }

  /** ヒットの内容を作る（武器のダメージを振り、補正を載せる） */
  hitSpec(eff: EffectiveSkill, rng: Rng): HitSpec {
    const weapon = this.weapon;
    const range = this.weaponDamageRange();
    const strength = this.init.stats?.["剛"] ?? 0;
    const treeDamage = this.fx("ダメージ", eff.skill);
    const treeBreak = this.fx("崩し値", eff.skill);
    const addPct =
      this.damageAddPct +
      treeDamage.addPct +
      strength * 0.002 +
      (this.buffs.attackBonus.left > 0 ? this.buffs.attackBonus.value : 0);
    const ailmentBase: Partial<Record<string, number>> = { ...eff.ailments };
    const bleedAdd = this.gearTotal("出血付与率");
    if (bleedAdd > 0) ailmentBase["bleed"] = (ailmentBase["bleed"] ?? 0) + bleedAdd;
    if (this.buffs.ailmentBonus.left > 0) {
      for (const [k, v] of Object.entries(this.buffs.ailmentBonus.value)) {
        ailmentBase[k] = (ailmentBase[k] ?? 0) + (v ?? 0);
      }
    }
    const bs = this.init.backstab;
    const forcedBleed = this.rule("強制付与:出血") !== undefined;
    const alias = this.rule("別の異常として数える");
    const aliasFrom = alias ? tagToAilment(alias.params["from"]) : undefined;
    const aliasTo = alias ? tagToAilment(alias.params["to"]) : undefined;
    const bleedAdd2 = this.fx("出血の最大スタック").flat;
    const poisonRule = this.rule("毒スタックによる被ダメージ倍率");
    const backRule = this.rule("背面ヒットでコンボ点");
    return {
      ...(this.rule("禁止:会心") !== undefined ? { noCrit: true } : {}),
      ...(this.rule("必中") !== undefined ? { alwaysHit: true } : {}),
      ...(this.forceBackLeft > 0 && backRule === undefined ? { forceBack: true } : {}),
      ...(forcedBleed ? { forcedAilments: ["bleed"] } : {}),
      ...(bleedAdd2 > 0 ? { bleedMaxStacks: 8 + bleedAdd2 } : {}),
      ...(aliasFrom && aliasTo ? { ailmentAliases: [[aliasFrom, aliasTo] as const] } : {}),
      shape: eff.shape,
      damage: {
        base: {
          physical: rng.int(range.physical.min * 100, range.physical.max * 100) / 100,
          ...(range.fire.max > 0
            ? { fire: rng.int(range.fire.min * 100, range.fire.max * 100) / 100 }
            : {}),
        },
        skillMultiplier: eff.multiplier,
        generic: { addPct, mult: this.damageMult * treeDamage.mult },
        byElement: {
          physical: { addPct: this.gearTotal("物理ダメージ増加%") },
          fire: { addPct: this.gearTotal("火ダメージ増加") },
        },
      },
      weaponCrit: weapon.crit,
      critIncrease: this.critIncrease + this.fx("会心率増加%").addPct,
      accuracy: (this.init.accuracy ?? 2) + this.gearTotal("命中"),
      breakCoefficient: eff.skill.breakCoefficient,
      breakBonus: eff.breakBonus + this.gearTotal("崩し値") + treeBreak.addPct,
      ...(this.evalWith(new Set()) || poisonRule
        ? {
            targetBonus: (t: Combatant) => {
              const dyn = this.fx("ダメージ", eff.skill, this.targetFlags(t));
              const base = this.fx("ダメージ", eff.skill);
              // 母樹の根冠：敵の毒10スタックにつき ×1.04（最大 ×1.20。毒蛇座で ×1.30）
              let poison = 1;
              if (poisonRule) {
                const per =
                  typeof poisonRule.params["perStacks"] === "number"
                    ? poisonRule.params["perStacks"]
                    : 10;
                const m =
                  typeof poisonRule.params["mult"] === "number" ? poisonRule.params["mult"] : 1;
                const max =
                  typeof poisonRule.params["max"] === "number"
                    ? poisonRule.params["max"]
                    : Infinity;
                poison = Math.min(max, m ** Math.floor(t.ailments.countedStacks("poison") / per));
              }
              return {
                addPct: dyn.addPct - base.addPct,
                mult: (base.mult === 0 ? 1 : dyn.mult / base.mult) * poison,
              };
            },
          }
        : {}),
      ailmentBase: ailmentBase,
      ailmentBonus: this.gearTotal("状態異常付与率"),
      ...(bs || this.gearTotal("背面会心率") > 0
        ? {
            backCritAdd: (bs?.critAdd ?? 0) + this.gearTotal("背面会心率"),
            backAilmentBonus: bs?.ailmentAdd ?? 0,
          }
        : {}),
    };
  }

  /** 技を使う。コストを払い、ヒットを全て解決する（動作の時間は呼び出し側が管理してよい） */
  use(
    id: string,
    origin: Vec2,
    angle: number,
    targets: readonly Combatant[],
    rng: Rng,
    ctx: UseContext = {},
  ): UseOutcome {
    const check = this.canUse(id);
    if (!check.ok)
      return { ok: false, ...(check.reason ? { reason: check.reason } : {}), hits: [] };
    const skill = this.init.skills.find((s) => s.id === id) as SkillDef;
    const eff = this.effective(skill);

    // 対象が必要な技は、対象がいなければ使えない（コストも払わない）
    let teleportTarget: Combatant | undefined;
    if (skill.teleportBehind) {
      const aim = ctx.aim ?? { x: origin.x + Math.cos(angle), y: origin.y + Math.sin(angle) };
      let best = Infinity;
      for (const t of targets) {
        if (t.hp <= 0) continue;
        const d = Math.hypot(t.pos.x - aim.x, t.pos.y - aim.y);
        if (d <= skill.teleportBehind.range && d < best) {
          best = d;
          teleportTarget = t;
        }
      }
      if (!teleportTarget) return { ok: false, reason: "noTarget", hits: [] };
    }

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
      if (skill.buff.ailmentBonus) {
        this.buffs.ailmentBonus = { value: skill.buff.ailmentBonus, left: skill.buff.seconds };
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
    const flags = new Set<string>();
    if (this.gauge.outOfCombat) flags.add("戦闘外からの最初の一撃");
    if (skill.id === "SKL-ROG-FLURRY") flags.add("連刃を使用中");
    if (this.gauge.forceIntensified) flags.add("鬼神中");
    this.useFlags = flags;

    // 敵の背後へ瞬間移動する（背面は、向きの反対側）
    if (teleportTarget) {
      const behind = teleportTarget.noFacing === true ? 0 : teleportTarget.facing + Math.PI;
      out.movedTo = {
        x: teleportTarget.pos.x + Math.cos(behind) * (teleportTarget.radius + 0.8),
        y: teleportTarget.pos.y + Math.sin(behind) * (teleportTarget.radius + 0.8),
      };
      if (this.rule("移動の技の後の背面扱い") && !this.rule("背面ヒットでコンボ点")) {
        this.forceBackLeft = this.ruleNum("移動の技の後の背面扱い", "seconds", 0);
      }
      return out;
    }

    // 地面に置く技（煙玉・罠）
    if (skill.ground) {
      const aim = ctx.aim ?? { x: origin.x + Math.cos(angle), y: origin.y + Math.sin(angle) };
      const dx = aim.x - origin.x;
      const dy = aim.y - origin.y;
      const d = Math.hypot(dx, dy);
      const k = d > skill.ground.placeRange ? skill.ground.placeRange / d : 1;
      const pos = { x: origin.x + dx * k, y: origin.y + dy * k };
      if (ctx.ground) {
        if (skill.ground.zone === "smoke") {
          ctx.ground.placeSmoke({
            pos,
            left: skill.ground.seconds,
            radius: skill.ground.radius,
            accuracyPenalty: 0.3,
          });
        } else {
          ctx.ground.placeTrap(
            {
              pos,
              left: skill.ground.seconds,
              radius: skill.ground.radius,
              makeSpec: () => ({
                ...this.hitSpec({ ...eff, shape: { kind: "circle", radius: 1 } }, rng),
                forcedAilments: ["bleed"],
              }),
            },
            skill.ground.max ?? 3,
          );
        }
      }
      return out;
    }

    if (skill.multiplier === 0 && eff.multiplier === 0) return out;

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

    // 終結技：コンボ点に応じて倍率が上がり、使うと全て使う。最大点なら必ず会心
    let forceCrit = false;
    if (skill.finisher) {
      const points = this.gauge.value;
      eff.multiplier += skill.finisher.bonusPerPoint * points;
      forceCrit = points >= skill.finisher.guaranteedCritAt;
      this.gauge.consume();
    }

    const heavy = skill.tags.includes("重撃");
    const hitCount = Math.max(1, eff.hits);
    let landed = false;
    const furyHit = this.rule("崩れた敵へのヒットで闘志");
    const spread = this.rule("崩しの拡散");
    const fork = this.rule("分岐ヒット");
    const backCombo = this.rule("背面ヒットでコンボ点");
    for (let i = 0; i < hitCount; i++) {
      const spec = {
        ...this.hitSpec({ ...eff, shape }, rng),
        ...(forceCrit ? { forceCrit: true } : {}),
      };
      // 打ち鳴らしの籠手：ヒットの前に崩れていた敵を覚えておく
      const brokenBefore = new Set(targets.filter((t) => t.breakGauge.broken));
      const results = strike(origin, angle, targets, spec, rng);
      const hitTargets = new Set(results.map((r) => r.target));
      for (const r of results) {
        if (r.result.hit) {
          landed = true;
          this.gauge.onHit(heavy);
          if (furyHit && this.gauge.def.id === "GAUGE-FURY" && brokenBefore.has(r.target)) {
            const g = this.ruleNum("崩れた敵へのヒットで闘志", "gain", 0);
            const h = this.ruleNum("崩れた敵へのヒットで闘志", "heavyGain", g);
            this.gauge.add(heavy ? h : g);
          }
          if (backCombo && r.result.back && this.backGainCooldown <= 0) {
            this.gauge.add(this.ruleNum("背面ヒットでコンボ点", "gain", 1));
            this.backGainCooldown = this.ruleNum("背面ヒットでコンボ点", "intervalSeconds", 1);
          }
        }
        if (eff.breaksAll) r.target.breakGauge.add(r.target.breakGauge.currentMax);
        // 敵の崩しゲージを満タンにすると、周囲の敵の崩しゲージを増やす
        if (spread && r.result.broke) {
          const radius = this.ruleNum("崩しの拡散", "radius", 0);
          const ratio = this.ruleNum("崩しの拡散", "ratio", 0);
          for (const other of targets) {
            if (other === r.target || other.hp <= 0) continue;
            if (Math.hypot(other.pos.x - r.target.pos.x, other.pos.y - r.target.pos.y) <= radius) {
              other.breakGauge.add(other.breakGauge.currentMax * ratio);
            }
          }
        }
        // 二股の枝：近くの別の敵1体にも、そのヒットの50%が当たる
        if (fork && r.result.hit) {
          const radius = this.ruleNum("分岐ヒット", "radius", 0);
          const ratio = this.ruleNum("分岐ヒット", "ratio", 0.5);
          let near: Combatant | undefined;
          let nearDist = radius;
          for (const other of targets) {
            if (other.hp <= 0 || other === r.target || hitTargets.has(other)) continue;
            const d = Math.hypot(other.pos.x - r.target.pos.x, other.pos.y - r.target.pos.y);
            if (d <= nearDist) {
              nearDist = d;
              near = other;
            }
          }
          if (near) {
            const withAilments = fork.params["ailments"] === true;
            const forkSpec: HitSpec = {
              ...spec,
              damage: {
                ...spec.damage,
                generic: {
                  addPct: spec.damage.generic?.addPct ?? 0,
                  mult: (spec.damage.generic?.mult ?? 1) * ratio,
                },
              },
              ...(withAilments
                ? {}
                : { ailmentBase: {}, ailmentBonus: 0, backAilmentBonus: 0, forcedAilments: [] }),
            };
            out.hits.push({ target: near, result: resolveHit(origin, near, forkSpec, rng) });
          }
        }
      }
      out.hits.push(...results);
    }
    // ヒットを当てると、1回の使用につきゲージ+N（連刃：コンボ点+1）
    if (landed && skill.gaugeOnHit) this.gauge.add(skill.gaugeOnHit);
    // 移動の技の後、全てのヒットを背面扱いにする（背向けの外套。影法師では代わりにコンボ点）
    if (skill.kind === "dash" && this.rule("移動の技の後の背面扱い") && !backCombo) {
      this.forceBackLeft = this.ruleNum("移動の技の後の背面扱い", "seconds", 0);
    }
    return out;
  }

  /** 敵を倒した。出血が残っていれば、最も近い敵1体に移す（狼牙の首飾り） */
  onEnemyKilled(dead: Combatant, others: readonly Combatant[]): void {
    const rule = this.rule("出血の移転");
    if (!rule) return;
    const stacks = dead.ailments.exportStacks("bleed");
    if (stacks.length === 0) return;
    let near: Combatant | undefined;
    let best = Infinity;
    for (const o of others) {
      if (o === dead || o.hp <= 0) continue;
      const d = Math.hypot(o.pos.x - dead.pos.x, o.pos.y - dead.pos.y);
      if (d < best) {
        best = d;
        near = o;
      }
    }
    if (!near) return;
    const keep = rule.params["keepStacks"] === true;
    // 移ると1スタックになる。傷口を抉る（輝星）があればスタック数を保つ
    const moved = keep ? stacks : [stacks.reduce((a, b) => (b.total > a.total ? b : a))];
    near.ailments.importStacks("bleed", moved);
    dead.ailments.clear("bleed");
  }

  /** 攻撃を受けたときの反撃（樹皮の盾：攻撃してきた敵に毒を付与する。基準値は受けたダメージの30%） */
  retaliate(attacker: Combatant, taken: number, others: readonly Combatant[]): void {
    const rule = this.rule("被弾時の毒付与");
    if (!rule) return;
    const ratio = this.ruleNum("被弾時の毒付与", "ratio", 0.3);
    const radius = this.ruleNum("被弾時の毒付与", "radius", 0);
    const victims =
      radius > 0
        ? [attacker, ...others].filter(
            (o) =>
              o.hp > 0 && Math.hypot(o.pos.x - attacker.pos.x, o.pos.y - attacker.pos.y) <= radius,
          )
        : [attacker];
    for (const v of new Set(victims))
      v.ailments.apply("poison", { reference: { physical: taken * ratio } });
  }

  /**
   * 攻撃を受けた。無敵でなければ呼ぶ。防具値（止まっている間は樹皮の盾で上がる）・被ダメージ軽減を反映してHPを減らす。
   * playerBehindAttacker：自分が攻撃してきた敵の背後にいる（背向けの外套で被ダメージ-15%）。
   */
  takeDamage(raw: number, ctx: { playerBehindAttacker?: boolean } = {}): number {
    const armor = (this.gearStats?.armor ?? 0) * this.armorMultiplier;
    let dmg = raw * (1 - armorReduction(armor, raw));
    dmg *= this.buffs.damageTaken.left > 0 ? this.buffs.damageTaken.value : 1;
    if (ctx.playerBehindAttacker === true) {
      dmg *= 1 - this.ruleNum("背後にいる間の被ダメージ軽減", "ratio", 0);
    }
    this.hp = Math.max(0, this.hp - dmg);
    this.gauge.onDamaged(dmg, this.maxHp);
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
    this.buffs.ailmentBonus.left = Math.max(0, this.buffs.ailmentBonus.left - dt);
    this.stunLeft = Math.max(0, this.stunLeft - dt);
    this.forceBackLeft = Math.max(0, this.forceBackLeft - dt);
    this.backGainCooldown = Math.max(0, this.backGainCooldown - dt);
    this.cdWindow += dt;
    if (this.cdWindow >= 1) {
      this.cdWindow -= 1;
      this.cdReducedThisSecond = 0;
    }
    // MPは毎秒、最大MPの6%回復する（本仕様書 2.3）
    this.mp = Math.min(this.init.maxMp, this.mp + this.init.maxMp * 0.06 * dt);
    this.gauge.tick(dt);
  }
}
