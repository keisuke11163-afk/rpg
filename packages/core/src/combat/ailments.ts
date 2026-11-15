/**
 * 状態異常と崩し（本仕様書 2.7、補助仕様書 3.3）。数値は仮値。
 * 強さは基準値（会心・敵が受ける倍率・耐性・防御を含まない）から計算する。
 */
import type { Rng } from "../rng.ts";
import type { Element } from "./damage.ts";

export const AILMENT_KINDS = [
  "burn",
  "chill",
  "freeze",
  "shock",
  "bleed",
  "poison",
  "weaken",
  "stigma",
] as const;
export type AilmentKind = (typeof AILMENT_KINDS)[number];

/** 状態異常の定義（データの形）。MVPで動かすのは出血・毒・衰弱・燃焼＋崩し。残りも形を持つ */
export interface AilmentDef {
  kind: AilmentKind;
  /** この異常を起こせる属性 */
  elements: readonly Element[];
  durationSeconds: number;
  /** 重ね掛けの上限。1は重ならず、最も強いもの1つが残る */
  maxStacks: number;
  provisional: true;
}

export const AILMENT_DEFS: Readonly<Record<AilmentKind, AilmentDef>> = {
  burn: { kind: "burn", elements: ["fire"], durationSeconds: 4, maxStacks: 1, provisional: true },
  chill: { kind: "chill", elements: ["cold"], durationSeconds: 2, maxStacks: 1, provisional: true },
  freeze: {
    kind: "freeze",
    elements: ["cold"],
    durationSeconds: 1.2,
    maxStacks: 1,
    provisional: true,
  },
  shock: {
    kind: "shock",
    elements: ["lightning"],
    durationSeconds: 4,
    maxStacks: 1,
    provisional: true,
  },
  bleed: {
    kind: "bleed",
    elements: ["physical"],
    durationSeconds: 5,
    maxStacks: 8,
    provisional: true,
  },
  poison: {
    kind: "poison",
    elements: ["physical", "dark"],
    durationSeconds: 3,
    maxStacks: Infinity,
    provisional: true,
  },
  weaken: {
    kind: "weaken",
    elements: ["dark"],
    durationSeconds: 4,
    maxStacks: 1,
    provisional: true,
  },
  stigma: {
    kind: "stigma",
    elements: ["holy"],
    durationSeconds: 6,
    maxStacks: 5,
    provisional: true,
  },
};

/** ヒットが持つ属性で起こせる種類（本仕様書 2.7 付与率） */
export function ailmentsForElements(elements: Iterable<Element>): AilmentKind[] {
  const set = new Set(elements);
  return AILMENT_KINDS.filter((k) => AILMENT_DEFS[k].elements.some((e) => set.has(e)));
}

/** 付与率 ＝ 技の基本付与率 ＋ 補正の合計。上限100%。「必ず付与」は100% */
export function applyChance(base: number, bonus: number, forced = false): number {
  return forced ? 1 : Math.min(1, Math.max(0, base + bonus));
}

/** ヒット1回につき、種類ごとに1回だけ判定する */
export function rollApply(rng: Rng, chance: number): boolean {
  return chance >= 1 || rng.chance(chance);
}

/** 状態異常の「種類」の数え方（千変など）：冷却と凍結は合わせて1種類、崩しは数えない */
export function countAilmentKinds(active: Iterable<AilmentKind>): number {
  const names = new Set<string>();
  for (const k of active) names.add(k === "freeze" || k === "chill" ? "cold" : k);
  return names.size;
}

export interface TargetInfo {
  maxHp: number;
  isBoss: boolean;
  /** 不死・魔人系（聖痕の破裂が×1.5） */
  isUndeadOrDemon?: boolean;
}

/** 持続ダメージの補正（本仕様書 2.7）。防具値・ガードはかけない。耐性は1回だけ */
export interface DotContext {
  /** 状態異常系の加算％（状態異常を対象にした補正だけ） */
  addPct: number;
  mult: number;
  /** 敵が受けるダメージの倍率（感電・崩しなど） */
  enemyDamageTaken: number;
  /** 属性ごとの敵の耐性（適用済みの値） */
  resistance: Partial<Record<Element, number>>;
  /** 敵が移動中か（出血のダメージ2倍） */
  moving?: boolean;
}

export interface DotTick {
  kind: AilmentKind;
  element: Element;
  damage: number;
}

interface Stack {
  /** 総量（基準値×係数） */
  total: number;
  remaining: number;
  duration: number;
  element: Element;
}

export interface AilmentInput {
  /** 属性ごとの基準値（そのヒットの） */
  reference: Partial<Record<Element, number>>;
}

export const FREEZE_BOSS_SECONDS = 0.4;
export const FREEZE_BOSS_IMMUNE_SECONDS = 8;
export const FREEZE_NORMAL_SECONDS = 1.2;

/** 1体の対象に掛かっている状態異常 */
export class AilmentSet {
  private readonly stacks = new Map<AilmentKind, Stack[]>();
  private shockMult = 1;
  private chillSlow = 0;
  private chillGauge = 0;
  private freezeLeft = 0;
  private freezeImmune = 0;
  private weakenLeft = 0;
  private readonly maxStackOverride: Partial<Record<AilmentKind, number>> = {};
  /** 別の異常として数える（毒血同源：出血が毒としても数えられる）。ダメージは二重にならない */
  private readonly aliases = new Map<AilmentKind, AilmentKind>();

  private readonly target: TargetInfo;

  constructor(target: TargetInfo) {
    this.target = target;
  }

  /** 重ね掛けの上限を変える効果（千の小傷：出血12など） */
  setMaxStacks(kind: AilmentKind, max: number): void {
    this.maxStackOverride[kind] = max;
  }

  /** from の異常を、to としても数える。種類や数を数える効果にだけ計上される */
  setAlias(from: AilmentKind, to: AilmentKind): void {
    this.aliases.set(from, to);
  }

  /** 別の異常として数えるものを含めた、スタック数（例：出血+毒） */
  countedStacks(kind: AilmentKind): number {
    let total = this.stackCount(kind);
    for (const [from, to] of this.aliases) if (to === kind) total += this.stackCount(from);
    return total;
  }

  /** 掛かっている種類の数（別の異常として数えるものを含む。冷却・凍結は1種類） */
  countedKinds(): number {
    const kinds: AilmentKind[] = this.activeKinds();
    for (const [from, to] of this.aliases) if (kinds.includes(from)) kinds.push(to);
    return countAilmentKinds(kinds);
  }

  /** 掛かっているスタックの写し（出血の移転などで、別の敵に移すため） */
  exportStacks(
    kind: AilmentKind,
  ): { total: number; remaining: number; duration: number; element: Element }[] {
    return (this.stacks.get(kind) ?? []).map((s) => ({ ...s }));
  }

  /** スタックを加える（上限を超えない） */
  importStacks(
    kind: AilmentKind,
    stacks: readonly { total: number; remaining: number; duration: number; element: Element }[],
  ): void {
    for (const s of stacks) this.push(kind, { total: s.total, element: s.element });
  }

  /** 全ての掛かっているスタックを消す（移転元など） */
  clear(kind: AilmentKind): void {
    this.stacks.delete(kind);
  }

  stackCount(kind: AilmentKind): number {
    return this.stacks.get(kind)?.length ?? 0;
  }

  /** 掛かっている種類（冷却・凍結を含む） */
  activeKinds(): AilmentKind[] {
    const out: AilmentKind[] = [];
    for (const [k, v] of this.stacks) if (v.length > 0) out.push(k);
    if (this.chillSlow > 0) out.push("chill");
    if (this.freezeLeft > 0) out.push("freeze");
    if (this.shockMult > 1) out.push("shock");
    if (this.weakenLeft > 0) out.push("weaken");
    return AILMENT_KINDS.filter((k) => out.includes(k));
  }

  /** 感電による、敵が受けるダメージの倍率 */
  get enemyDamageTakenMultiplier(): number {
    return this.shockMult;
  }
  /** 冷却による行動速度の低下（0〜） */
  get slow(): number {
    return this.chillSlow;
  }
  get frozen(): boolean {
    return this.freezeLeft > 0;
  }
  /** 衰弱による、敵の与えるダメージの倍率 */
  get damageDealtMultiplier(): number {
    return this.weakenLeft > 0 ? 1 - (this.target.isBoss ? 0.08 : 0.15) : 1;
  }

  /** 付与する。戻り値は、聖痕が破裂したときの追加ダメージ（それ以外は0） */
  apply(kind: AilmentKind, input: AilmentInput): number {
    const def = AILMENT_DEFS[kind];
    const ref = (e: Element): number => input.reference[e] ?? 0;
    const { maxHp, isBoss } = this.target;
    switch (kind) {
      case "bleed":
        this.push(kind, { total: ref("physical") * 1.5, element: "physical" });
        return 0;
      case "poison":
        this.push(kind, { total: (ref("physical") + ref("dark")) * 0.6, element: "dark" });
        return 0;
      case "burn": {
        // 重ね掛けは不可：最も強い1つが残る（同じ強さなら持続を更新）
        const total = ref("fire") * 0.5;
        const current = this.stacks.get("burn")?.[0];
        if (!current || total >= current.total * (current.remaining / current.duration)) {
          this.stacks.set("burn", [
            {
              total,
              remaining: def.durationSeconds,
              duration: def.durationSeconds,
              element: "fire",
            },
          ]);
        }
        return 0;
      }
      case "shock": {
        const cap = isBoss ? 0.15 : 0.25;
        const mult = 1 + Math.min(cap, (2.5 * ref("lightning")) / maxHp);
        if (mult >= this.shockMult) {
          this.shockMult = mult;
          this.stacks.set("shock", [
            {
              total: 0,
              remaining: def.durationSeconds,
              duration: def.durationSeconds,
              element: "lightning",
            },
          ]);
        }
        return 0;
      }
      case "chill": {
        const cold = ref("cold");
        const cap = isBoss ? 0.15 : 0.3;
        const slow = Math.min(cap, (3 * cold) / maxHp);
        if (slow >= this.chillSlow) {
          this.chillSlow = slow;
          this.stacks.set("chill", [
            {
              total: 0,
              remaining: def.durationSeconds,
              duration: def.durationSeconds,
              element: "cold",
            },
          ]);
        }
        if (this.freezeImmune <= 0 && this.freezeLeft <= 0) {
          this.chillGauge += (200 * cold) / maxHp;
          if (this.chillGauge >= 100) {
            this.chillGauge = 0;
            this.freezeLeft = isBoss ? FREEZE_BOSS_SECONDS : FREEZE_NORMAL_SECONDS;
            if (isBoss) this.freezeImmune = FREEZE_BOSS_SECONDS + FREEZE_BOSS_IMMUNE_SECONDS;
          }
        }
        return 0;
      }
      case "freeze":
        return 0; // 凍結は冷却ゲージで起こる
      case "weaken":
        this.weakenLeft = def.durationSeconds;
        return 0;
      case "stigma": {
        const list = this.stacks.get("stigma") ?? [];
        list.push({
          total: ref("holy"),
          remaining: def.durationSeconds,
          duration: def.durationSeconds,
          element: "holy",
        });
        for (const s of list) s.remaining = def.durationSeconds; // 付与のたびに持続を更新
        this.stacks.set("stigma", list);
        if (list.length >= 5) {
          const sum = list.reduce((a, s) => a + s.total, 0);
          this.stacks.set("stigma", []);
          return sum * 1.5 * (this.target.isUndeadOrDemon === true ? 1.5 : 1);
        }
        return 0;
      }
    }
  }

  private push(kind: AilmentKind, s: { total: number; element: Element }): void {
    const def = AILMENT_DEFS[kind];
    const max = this.maxStackOverride[kind] ?? def.maxStacks;
    const list = this.stacks.get(kind) ?? [];
    const entry: Stack = { ...s, remaining: def.durationSeconds, duration: def.durationSeconds };
    if (list.length >= max) {
      // 上限では、最も残りの少ないスタックを新しいものに置き換える
      let idx = 0;
      list.forEach((x, i) => {
        if (x.remaining < (list[idx]?.remaining ?? Infinity)) idx = i;
      });
      list[idx] = entry;
    } else {
      list.push(entry);
    }
    this.stacks.set(kind, list);
  }

  /** dt秒進める。持続ダメージの一覧を返す */
  tick(dt: number, ctx: DotContext): DotTick[] {
    const out: DotTick[] = [];
    for (const kind of ["burn", "bleed", "poison"] as const) {
      const list = this.stacks.get(kind);
      if (!list) continue;
      for (const s of list) {
        const step = Math.min(dt, s.remaining);
        if (step <= 0) continue;
        let dmg =
          s.total * (step / s.duration) * (1 + ctx.addPct) * ctx.mult * ctx.enemyDamageTaken;
        if (kind === "bleed" && ctx.moving === true) dmg *= 2;
        dmg *= 1 - (ctx.resistance[s.element] ?? 0);
        out.push({ kind, element: s.element, damage: Math.max(0, dmg) });
      }
    }
    for (const [kind, list] of this.stacks) {
      for (const s of list) s.remaining -= dt;
      this.stacks.set(
        kind,
        list.filter((s) => s.remaining > 1e-9),
      );
    }
    if (this.stackCount("shock") === 0) this.shockMult = 1;
    if (this.stackCount("chill") === 0) this.chillSlow = 0;
    this.weakenLeft = Math.max(0, this.weakenLeft - dt);
    this.freezeLeft = Math.max(0, this.freezeLeft - dt);
    this.freezeImmune = Math.max(0, this.freezeImmune - dt);
    return out;
  }
}

/** 崩しゲージ（敵・プレイヤー共通の仕組み） */
export interface BreakParams {
  max: number;
  /** 崩しを受けない状態がこの秒数続くと減り始める */
  decayDelay: number;
  /** 毎秒、最大値のこの割合ずつ減る */
  decayRate: number;
  /** 崩れたときの状態の長さ（敵：ダウン2秒／ボス：怯み1秒／プレイヤー：よろめき0.6秒） */
  stateSeconds: number;
  /** 崩れている間の、受けるダメージの倍率（敵のみ） */
  damageTakenMultiplier: number;
  /** 崩れるたびに最大値が伸びる倍率（ボス1.5） */
  growth: number;
}

export function enemyBreakParams(maxHp: number, isBoss: boolean): BreakParams {
  return {
    max: maxHp * (isBoss ? 0.15 : 0.2),
    decayDelay: 3,
    decayRate: 0.1,
    stateSeconds: isBoss ? 1 : 2,
    damageTakenMultiplier: isBoss ? 1.15 : 1.25,
    growth: isBoss ? 1.5 : 1,
  };
}

export function playerBreakParams(maxHp: number): BreakParams {
  return {
    max: maxHp * 0.5,
    decayDelay: 2,
    decayRate: 0.2,
    stateSeconds: 0.6,
    damageTakenMultiplier: 1,
    growth: 1,
  };
}

/** 崩し値 ＝ 打撃値（全属性の合計・防御の前）× 技の崩し係数（既定0.3）×（1 ＋ 崩し値の補正） */
export function breakValue(hitTotal: number, coefficient = 0.3, bonus = 0): number {
  return hitTotal * coefficient * (1 + bonus);
}

export class BreakGauge {
  gauge = 0;
  private max: number;
  private sinceHit = 0;
  private stateLeft = 0;
  /** 「崩されない」効果があるときは溜まらない */
  immune = false;

  private readonly params: BreakParams;

  constructor(params: BreakParams) {
    this.params = params;
    this.max = params.max;
  }

  get currentMax(): number {
    return this.max;
  }
  /** 崩れている（ダウン・怯み・よろめき）間 */
  get broken(): boolean {
    return this.stateLeft > 0;
  }
  /** 崩れている間の、受けるダメージの倍率 */
  get damageTakenMultiplier(): number {
    return this.broken ? this.params.damageTakenMultiplier : 1;
  }

  /** 崩し値を加える。崩れたら true */
  add(value: number): boolean {
    if (this.immune || this.broken || value <= 0) return false;
    this.sinceHit = 0;
    this.gauge += value;
    if (this.gauge >= this.max) {
      this.gauge = 0;
      this.stateLeft = this.params.stateSeconds;
      this.max *= this.params.growth;
      return true;
    }
    return false;
  }

  tick(dt: number): void {
    if (this.stateLeft > 0) {
      this.stateLeft = Math.max(0, this.stateLeft - dt);
      return;
    }
    this.sinceHit += dt;
    if (this.sinceHit > this.params.decayDelay) {
      this.gauge = Math.max(0, this.gauge - this.max * this.params.decayRate * dt);
    }
  }
}
