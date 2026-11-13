import type { JobDef } from "../content/job.ts";
import type { EffectInstance } from "../effects/evaluate.ts";

/** MVPのキャラLv・ジョブLvの上限（補助仕様書4.1・4.3）。 */
export const LEVEL_CAP = 20;
export const JOB_LEVEL_CAP = 20;
/** 転職神殿が開くキャラLv（仕様書5.1）。 */
export const JOB_CHANGE_LEVEL = 15;
/** 追いつき補正（仕様書5.1）：最も高いジョブLv－10 未満のジョブは、ジョブ経験値×2。 */
export const CATCH_UP = { gap: 10, multiplier: 2 } as const;

/** Lv L から L＋1 に必要な経験値 ＝ 290 × L^1.2（四捨五入。補助仕様書4.1。仮値: 補助仕様書4.1） */
export function xpToNext(level: number): number {
  if (!(level >= 1)) throw new RangeError("Lvは1以上");
  return Math.round(290 * level ** 1.2);
}

/** 通常の敵の経験値 ＝ 5 ＋ 2 × 敵のLv。格の倍率をかける（補助仕様書4.2。仮値: 補助仕様書4.2） */
export function enemyXp(enemyLevel: number, multiplier = 1): number {
  return (5 + 2 * enemyLevel) * multiplier;
}

/**
 * Lvの差による経験値の倍率（補助仕様書4.2）：プレイヤーのLvが敵より4以上高いと、1Lvごとに-20%（最低10%）。
 * 4高いと80%、5高いと60%、…、8高い以上は10%。
 */
export function levelGapMultiplier(playerLevel: number, enemyLevel: number): number {
  const gap = playerLevel - enemyLevel;
  if (gap < 4) return 1;
  return Math.max(0.1, 1 - 0.2 * (gap - 3));
}

/**
 * Lvと、そのLvの中で貯まった経験値。上限に達すると、それ以上は貯まらない。
 * 不正な入力（NaN・負の数・無限大・整数でないLv）は、状態を変えずに RangeError（PR #11 の方針）。
 */
export class LevelTrack {
  readonly cap: number;
  private lv: number;
  private stored = 0;

  /**
   * @param xp 今のLvの中で貯まった経験値（セーブデータから戻すとき）。0以上で、次のLvまでに必要な量より少ない有限の数。
   *   上限のLvでは0だけ。
   */
  constructor(cap: number, level = 1, xp = 0) {
    if (!(Number.isSafeInteger(cap) && cap >= 1))
      throw new RangeError(`Lvの上限は1以上の整数（${String(cap)}）`);
    if (!(Number.isSafeInteger(level) && level >= 1 && level <= cap))
      throw new RangeError(`Lvは1〜${String(cap)}の整数（${String(level)}）`);
    const limit = level >= cap ? 0 : xpToNext(level);
    if (!(Number.isFinite(xp) && xp >= 0 && (xp < limit || xp === 0)))
      throw new RangeError(
        `経験値は0以上、次のLvまでの量（${String(limit)}）より少ない数（${String(xp)}）`,
      );
    this.cap = cap;
    this.lv = level;
    this.stored = xp;
  }

  get level(): number {
    return this.lv;
  }
  /** 今のLvの中で貯まった経験値。 */
  get xp(): number {
    return this.stored;
  }
  /** 次のLvまでに必要な経験値（上限なら0）。 */
  get toNext(): number {
    return this.lv >= this.cap ? 0 : xpToNext(this.lv);
  }

  /** 経験値を足す。上がったLvの数を返す。0以上の有限の数でなければ、状態を変えずに RangeError。 */
  add(amount: number): number {
    if (!(Number.isFinite(amount) && amount >= 0))
      throw new RangeError(`経験値は0以上の有限の数（${String(amount)}）`);
    if (this.lv >= this.cap) return 0;
    this.stored += amount;
    let gained = 0;
    while (this.lv < this.cap && this.stored >= xpToNext(this.lv)) {
      this.stored -= xpToNext(this.lv);
      this.lv += 1;
      gained += 1;
    }
    if (this.lv >= this.cap) this.stored = 0;
    return gained;
  }
}

/** 能力値（仕様書2.2）。 */
export interface Attributes {
  readonly go: number;
  readonly jin: number;
  readonly ri: number;
  readonly kon: number;
}

/** 能力値の効果（データの effects/attributes.json。能力値1ポイントにつき1つ重ねる）。 */
export const ATTRIBUTE_EFFECTS: Readonly<Record<keyof Attributes, string>> = {
  go: "EFF-ATTR-GO",
  jin: "EFF-ATTR-JIN",
  ri: "EFF-ATTR-RI",
  kon: "EFF-ATTR-KON",
};

export interface XpGain {
  readonly characterLevels: number;
  readonly jobLevels: number;
  /** メインジョブが得たジョブ経験値（追いつき補正の後）。 */
  readonly jobXp: number;
}

export interface CharacterInit {
  /** 出自（キャラクターを作るときに選ぶ基本職。後から変えられない）。 */
  readonly origin: JobDef;
  /** 存在するジョブ（ContentDb.jobs）。転職先の確認に使う。 */
  readonly jobs: ReadonlyMap<string, JobDef>;
  readonly level?: number;
  /** ジョブごとのジョブLv（省略したジョブは1）。 */
  readonly jobLevels?: Readonly<Record<string, number>>;
  /** キャラLvの中で貯まった経験値（省略で0。セーブデータから戻すとき）。 */
  readonly xp?: number;
  /** ジョブごとの、ジョブLvの中で貯まった経験値（省略で0）。 */
  readonly jobXp?: Readonly<Record<string, number>>;
  /** メインジョブ（省略で出自。セーブデータから戻すとき）。 */
  readonly mainJob?: string;
}

/**
 * キャラクターの成長（仕様書5.1・補助仕様書4章）：キャラLv、ジョブごとのジョブLv、メインジョブ、転職。
 * ジョブLvはジョブごとに別々に持つ（転職しても混ざらない）。
 */
export class Character {
  readonly origin: JobDef;
  readonly progress: LevelTrack;
  private readonly jobDefs: ReadonlyMap<string, JobDef>;
  private readonly jobs = new Map<string, LevelTrack>();
  private main: string;

  /** Lv・ジョブLvは LevelTrack と同じ検証（1〜上限の整数。NaN・負の数・無限大は RangeError）。 */
  constructor(init: CharacterInit) {
    this.origin = init.origin;
    this.jobDefs = init.jobs;
    this.progress = new LevelTrack(LEVEL_CAP, init.level ?? 1, init.xp ?? 0);
    const jobIds = new Set([
      ...Object.keys(init.jobLevels ?? {}),
      ...Object.keys(init.jobXp ?? {}),
    ]);
    for (const job of jobIds)
      this.jobs.set(
        job,
        new LevelTrack(JOB_LEVEL_CAP, init.jobLevels?.[job] ?? 1, init.jobXp?.[job] ?? 0),
      );
    const main = init.mainJob ?? init.origin.id;
    // メインジョブは転職と同じく、存在するジョブだけ（セーブデータの誤り）
    if (!this.jobDefs.has(main)) throw new RangeError(`ジョブ ${main} は存在しない`);
    this.main = main;
    this.track(this.main);
  }

  get level(): number {
    return this.progress.level;
  }
  get mainJob(): string {
    return this.main;
  }

  private track(jobId: string): LevelTrack {
    let t = this.jobs.get(jobId);
    if (t === undefined) {
      t = new LevelTrack(JOB_LEVEL_CAP);
      this.jobs.set(jobId, t);
    }
    return t;
  }

  jobLevel(jobId: string): number {
    return this.jobs.get(jobId)?.level ?? 1;
  }
  /** ジョブLvを持っているジョブ（一度でもメインにした・Lvを持つジョブ）。 */
  get knownJobs(): string[] {
    return [...this.jobs.keys()];
  }
  jobTrack(jobId: string): LevelTrack {
    return this.track(jobId);
  }

  /** 全てのジョブの中で最も高いジョブLv。 */
  get highestJobLevel(): number {
    let best = 1;
    for (const t of this.jobs.values()) best = Math.max(best, t.level);
    return best;
  }

  /** メインジョブが追いつき補正を受けているか。 */
  get catchingUp(): boolean {
    return this.jobLevel(this.main) < this.highestJobLevel - CATCH_UP.gap;
  }

  /** 敵を倒して得た経験値を、キャラLvとメインジョブのジョブLvに足す（補助仕様書4.3）。 */
  gainXp(amount: number): XpGain {
    const jobXp = amount * (this.catchingUp ? CATCH_UP.multiplier : 1);
    // キャラLvだけ上がってジョブLvで失敗することのないよう、足す前に両方を検証する
    for (const v of [amount, jobXp])
      if (!(Number.isFinite(v) && v >= 0))
        throw new RangeError(`経験値は0以上の有限の数（${String(v)}）`);
    const characterLevels = this.progress.add(amount);
    const jobLevels = this.track(this.main).add(jobXp);
    return { characterLevels, jobLevels, jobXp };
  }

  /** 転職できるか（キャラLv15で転職神殿が開く）。 */
  get canChangeJob(): boolean {
    return this.level >= JOB_CHANGE_LEVEL;
  }

  /**
   * 転職する。転職したら true。
   * - 存在しないジョブID（ContentDb のジョブにない）は、状態を変えずに RangeError（呼ぶ側の誤り）
   * - キャラLvが足りない、または今のメインジョブと同じジョブなら false（何も変えない）
   */
  changeJob(jobId: string): boolean {
    if (!this.jobDefs.has(jobId)) throw new RangeError(`ジョブ ${jobId} は存在しない`);
    if (!this.canChangeJob || jobId === this.main) return false;
    this.main = jobId;
    this.track(jobId);
    return true;
  }

  /** 能力値（出自の初期能力値。星辰盤・装備の分は、それぞれの単位で足す）。 */
  get attributes(): Attributes {
    return this.origin.originAttributes ?? { go: 0, jin: 0, ri: 0, kon: 0 };
  }

  /**
   * 能力値の基礎の値（仕様書v0.2 2.3）：基礎HP ＝ 48 ＋ 12 × キャラLv、基礎MP ＝ 60、命中 ＝ 2 × キャラLv。
   * 能力値の分（剛のHP・理のMP・迅の命中など）は、能力値の効果（attributeEffects）で足す。
   */
  baseStats(): Record<string, number> {
    return {
      "STAT-HP-MAX": 48 + 12 * this.level,
      "STAT-MP-MAX": 60,
      "STAT-ACCURACY": 2 * this.level,
    };
  }

  /** 能力値の効果（能力値の数だけ重ねる）。 */
  attributeEffects(): EffectInstance[] {
    const a = this.attributes;
    return (Object.keys(ATTRIBUTE_EFFECTS) as (keyof Attributes)[])
      .filter((k) => a[k] > 0)
      .map((k) => ({
        effectId: ATTRIBUTE_EFFECTS[k],
        source: { kind: "attribute", ref: k },
        stacks: a[k],
      }));
  }
}
