import type { Affinity, JobDef, SkillAction, SkillDef, SkillMods } from "../content/job.ts";
import { AFFINITIES } from "../content/job.ts";
import type { ContentDb } from "../content/load.ts";
import type { TagIndex } from "../effects/tag-index.ts";
import type { DamageSkill } from "./damage.ts";
import type { HitShape } from "./shapes.ts";

/** 武器適性による攻撃速度（仕様書5.1：S+10%・A標準・B-5%・C-10%。加算の増加として扱う）。 */
export const AFFINITY_ATTACK_SPEED: Readonly<Record<Affinity, number>> = {
  S: 0.1,
  A: 0,
  B: -0.05,
  C: -0.1,
};

/** 素手のタグ（仕様書v0.2 3.2：全ジョブの適性はA）。 */
const UNARMED_TAG = "TAG-WPN-UNARMED";

const rank = (a: Affinity): number => AFFINITIES.length - 1 - AFFINITIES.indexOf(a);
const fromRank = (r: number): Affinity =>
  AFFINITIES[AFFINITIES.length - 1 - Math.max(0, Math.min(AFFINITIES.length - 1, r))] ?? "C";

/** 適性を1段階下げる（サブジョブから受け継ぐとき。仕様書5.1）。 */
export function lowerAffinity(a: Affinity): Affinity {
  return fromRank(rank(a) - 1);
}

/** 2つの適性の高い方。 */
export function higherAffinity(a: Affinity, b: Affinity): Affinity {
  return rank(a) >= rank(b) ? a : b;
}

/** 適性が、必要な適性以上か。 */
export function affinityAtLeast(a: Affinity, required: Affinity): boolean {
  return rank(a) >= rank(required);
}

/**
 * 武器に対するジョブの適性（仕様書5章）。武器のタグ（親タグを含む）のうち、ジョブの表にある最も高い適性。
 * 表にない武器はC。素手は全ジョブA。サブジョブがあれば、1段階下げた適性と比べて高い方（仕様書5.1）。
 */
export function weaponAffinity(
  tags: TagIndex,
  main: JobDef,
  weaponTags: readonly string[],
  sub?: JobDef,
): Affinity {
  const closure = tags.closure(weaponTags);
  const of = (job: JobDef): Affinity => {
    if (closure.has(UNARMED_TAG)) return "A";
    let best: Affinity = "C";
    for (const [tag, a] of Object.entries(job.affinity)) {
      if (closure.has(tag)) best = higherAffinity(best, a);
    }
    return best;
  };
  const mainAffinity = of(main);
  return sub === undefined ? mainAffinity : higherAffinity(mainAffinity, lowerAffinity(of(sub)));
}

/** 二刀流の適性（できなければ undefined。仕様書v0.2 5.1：戦士B・盗賊A）。 */
export function dualWieldAffinity(main: JobDef, sub?: JobDef): Affinity | undefined {
  const own = main.dualWield;
  const inherited = sub?.dualWield === undefined ? undefined : lowerAffinity(sub.dualWield);
  if (own === undefined) return inherited;
  return inherited === undefined ? own : higherAffinity(own, inherited);
}

/** ジョブLvで覚えている技（補助仕様書3.5）。 */
export function unlockedSkills(job: JobDef, jobLevel: number): string[] {
  return job.skills.filter((s) => s.level <= jobLevel).map((s) => s.skill);
}

/** 技の変化を決める状況。 */
export interface SkillContext {
  /** 職能ゲージの達している段階（サブジョブの技では空。仕様書5.1「戦士の技：激化しない」）。 */
  readonly stages: readonly string[];
  /** 主手の武器のタグ（親タグを含む。TagIndex.closure を通したもの）。 */
  readonly weaponTags: ReadonlySet<string>;
  readonly dualWield?: boolean;
  /** 終結技で使うゲージの量（急所穿ちのコンボ点）。 */
  readonly gaugeSpent?: number;
  /** 呪文を変える合成魔法（位相。魔法使い）。段階の変化の後に当てはめる。label は表示・確認用（例：fusion:steam）。 */
  readonly fusion?: { readonly id: string; readonly mods: SkillMods };
}

export interface SkillBehavior {
  readonly hook: string;
  readonly params: Readonly<Record<string, number>>;
}

/** 変化を当てはめた後の技。 */
export interface ResolvedSkill {
  readonly def: SkillDef;
  /** ダメージの計算に渡す形（技倍率は変化の後）。 */
  readonly damage: DamageSkill;
  /** 動き方（形・距離・回数は変化の後）。 */
  readonly action: SkillAction;
  /** 崩し係数（変化による増加を含む）。 */
  readonly staggerCoefficient: number;
  /** 状態異常の基本付与率（変化による加算を含む）。 */
  readonly ailmentChance: Readonly<Record<string, number>>;
  readonly behaviors: readonly SkillBehavior[];
  /** 必ず会心になる（急所穿ちの5点）。 */
  readonly forceCrit: boolean;
  /** 当てはめた変化（表示・確認用。例：stage:empowered、weapon:TAG-WPN-GREATSWORD、dualWield）。 */
  readonly variants: readonly string[];
}

function scaleShape(shape: HitShape, k: number, angleDeg: number | undefined): HitShape {
  switch (shape.type) {
    case "circle":
      return { type: "circle", radius: shape.radius * k };
    case "sector":
      return { type: "sector", radius: shape.radius * k, angleDeg: angleDeg ?? shape.angleDeg };
    case "line":
      return { type: "line", length: shape.length * k, width: shape.width };
  }
}

/**
 * 技に、武器による変化・二刀流の変化・ゲージの段階による変化（激化）を、この順に当てはめる。
 * 技倍率・角度・1秒あたりの回数は後のもので置き換え、大きさの倍率はかけ合わせ、崩し値の増加と付与率は足し合わせる。
 * 適性Sの「強化版の変化」は仕様が決まっていないため、まだ扱わない（docs/progress D-U08-1）。
 */
export function resolveSkill(db: ContentDb, def: SkillDef, ctx: SkillContext): ResolvedSkill {
  const applied: { label: string; mods: SkillMods }[] = [];
  for (const v of def.weaponVariants ?? []) {
    if (ctx.weaponTags.has(v.weaponTag))
      applied.push({ label: `weapon:${v.weaponTag}`, mods: v.mods });
  }
  if (ctx.dualWield === true && def.dualWieldVariant !== undefined)
    applied.push({ label: "dualWield", mods: def.dualWieldVariant });
  for (const v of def.stageVariants ?? []) {
    if (ctx.stages.includes(v.stage)) applied.push({ label: `stage:${v.stage}`, mods: v.mods });
  }

  if (ctx.fusion !== undefined)
    applied.push({ label: `fusion:${ctx.fusion.id}`, mods: ctx.fusion.mods });

  let pct = def.pct;
  let pctMultiplier = 1;
  let area = 1;
  let angleDeg: number | undefined;
  let staggerInc = 0;
  let distanceAdd = 0;
  let hitsPerSecond: number | undefined;
  let radiusMultiplier = 1;
  let hits: number | undefined;
  let burst: number | undefined;
  let replacedAction: SkillAction | undefined;
  let tags: readonly string[] = def.tags;
  const chance: Record<string, number> = { ...(def.ailmentChance ?? {}) };
  const behaviors: SkillBehavior[] = [];
  for (const { mods } of applied) {
    if (mods.pct !== undefined) pct = mods.pct;
    if (mods.pctMultiplier !== undefined) pctMultiplier *= mods.pctMultiplier;
    if (mods.areaMultiplier !== undefined) area *= mods.areaMultiplier;
    if (mods.angleDeg !== undefined) angleDeg = mods.angleDeg;
    staggerInc += mods.staggerIncreased ?? 0;
    distanceAdd += mods.distanceAdd ?? 0;
    if (mods.hitsPerSecond !== undefined) hitsPerSecond = mods.hitsPerSecond;
    if (mods.radiusMultiplier !== undefined) radiusMultiplier *= mods.radiusMultiplier;
    if (mods.hits !== undefined) hits = mods.hits;
    if (mods.burst !== undefined) burst = mods.burst;
    if (mods.action !== undefined) replacedAction = mods.action;
    if (mods.tags !== undefined) tags = mods.tags;
    for (const [tag, c] of Object.entries(mods.ailmentChance ?? {}))
      chance[tag] = Math.min(1, (chance[tag] ?? 0) + c);
    for (const b of mods.behaviors ?? []) behaviors.push({ hook: b.hook, params: b.params ?? {} });
  }

  const a = replacedAction ?? def.action;
  let action: SkillAction;
  switch (a.type) {
    case "strike": {
      const n = hits ?? a.hits;
      action = {
        ...a,
        shape: scaleShape(a.shape, area, angleDeg),
        ...(n === undefined ? {} : { hits: n }),
      };
      break;
    }
    case "dash":
      action = { ...a, distance: a.distance + distanceAdd };
      break;
    case "warcry":
      action = { ...a, radius: a.radius * radiusMultiplier * area };
      break;
    case "channel":
      action = {
        ...a,
        shape: scaleShape(a.shape, area, angleDeg),
        hitsPerSecond: hitsPerSecond ?? a.hitsPerSecond,
      };
      break;
    case "zone":
    case "barrage":
      action = { ...a, radius: a.radius * radiusMultiplier * area };
      break;
    case "projectile":
      {
        const b = burst ?? a.burst;
        action = b === undefined ? a : { ...a, burst: b * area };
      }
      break;
    case "teleport":
    case "selfBuff":
    case "trap":
    case "blink":
    case "chain":
      action = a;
      break;
  }

  const staggerDef = db.ailmentsByTag.get("TAG-AIL-STAGGER");
  const baseCoefficient =
    def.staggerCoefficient ?? (staggerDef?.kind === "stagger" ? staggerDef.defaultCoefficient : 0);

  pct *= pctMultiplier;
  // 終結技：使ったゲージの量に応じて技倍率が上がり、決まった量なら必ず会心
  const spent = ctx.gaugeSpent ?? 0;
  if (def.finisher !== undefined) pct += def.finisher.pctPerPoint * spent;
  const forceCrit =
    def.finisher?.forceCritAt !== undefined && spent >= def.finisher.forceCritAt - 1e-9;

  return {
    def,
    forceCrit,
    damage: {
      tags,
      kind: def.kind,
      pct,
      ...(def.base === undefined ? {} : { base: def.base }),
    },
    action,
    staggerCoefficient: baseCoefficient * (1 + staggerInc),
    ailmentChance: chance,
    behaviors,
    variants: applied.map((x) => x.label),
  };
}

/** 技を使えない理由。 */
export type SkillBlock = "cooldown" | "mp" | "gauge" | "affinity";

export interface SkillUseState {
  readonly cooldown: number;
  readonly mp: number;
  /** 職能ゲージの今の量（ゲージがなければ undefined）。 */
  readonly gauge: number | undefined;
  readonly affinity: Affinity;
}

/** 技を使えるか。使えなければ理由を返す。 */
export function skillBlock(def: SkillDef, state: SkillUseState): SkillBlock | undefined {
  if (def.requiredAffinity !== undefined && !affinityAtLeast(state.affinity, def.requiredAffinity))
    return "affinity";
  if (state.cooldown > 1e-9) return "cooldown";
  if (state.mp < def.mpCost) return "mp";
  const need = def.gauge?.requires;
  const cost = def.gauge?.cost;
  if (need !== undefined || typeof cost === "number") {
    const value = state.gauge ?? -Infinity;
    if (value < Math.max(need ?? 0, typeof cost === "number" ? cost : 0)) return "gauge";
  }
  return undefined;
}

/** 技の再使用までの時間（クールダウン）。 */
export class Cooldowns {
  private readonly left = new Map<string, number>();

  start(id: string, seconds: number): void {
    if (seconds > 0) this.left.set(id, seconds);
  }

  remaining(id: string): number {
    return this.left.get(id) ?? 0;
  }

  /** 時間を進め、終わったCDを取り除く。経過時間が0以上の有限の数でなければ、状態を変えずに RangeError。 */
  update(dt: number): void {
    // 状態を変える前に検証する（NaN・負の数・無限大を受け付けない。ActionTimeline.update と同じ）
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError("経過時間は0以上の有限の数");
    for (const [id, s] of this.left) {
      const next = s - dt;
      if (next <= 1e-9) this.left.delete(id);
      else this.left.set(id, next);
    }
  }
}

/** 技の動作の時間（秒）：当たり判定を1回出す技・戦吼は「倍率 ÷ 攻撃速度」、突進は決まった時間。 */
export function skillUseSeconds(skill: ResolvedSkill, attackSpeed: number): number {
  if (skill.action.type === "dash") return skill.action.duration;
  return (skill.def.useTimeMultiplier ?? 1) / attackSpeed;
}
