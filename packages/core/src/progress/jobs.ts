/**
 * ジョブの定義と、キャラ・ジョブのLvの管理、転職（本仕様書 5.1、補助仕様書 4.3）。
 * 3つ目のジョブは、JobDef のデータを足すだけで追加できる（本体のコードは変えない）。
 */
import type { GaugeDef } from "../jobs/gauge.ts";
import type { Aptitude, SkillDef, WeaponClass } from "../jobs/skills.ts";
import {
  CATCH_UP_GAP,
  CATCH_UP_MULTIPLIER,
  JOB_CHANGE_LEVEL,
  MVP_LEVEL_CAP,
  addExp,
  enemyExp,
  levelDifferenceFactor,
  type ExpSource,
  type LevelState,
} from "./exp.ts";

export interface JobDef {
  id: string;
  name: string;
  /** 職能ゲージ。新しいジョブは固有のゲージを持つ（本仕様書 10.4） */
  gauge: GaugeDef;
  skills: readonly SkillDef[];
  aptitude: Readonly<Partial<Record<WeaponClass | "dualWield", Aptitude>>>;
  /** 主な能力値と、出自の初期能力値（補助仕様書 3.2） */
  startingStats: Readonly<Record<string, number>>;
  /** 背面判定の補正（盗賊） */
  backstab?: { critAdd: number; ailmentAdd: number };
  /** 初期装備の武器（補助仕様書 3.4） */
  startingWeapon: { weaponKey: string; weaponClass: WeaponClass };
}

export class JobRegistry {
  private readonly jobs = new Map<string, JobDef>();

  register(def: JobDef): void {
    if (this.jobs.has(def.id)) throw new Error(`ジョブ ${def.id} は登録済み`);
    // 新しいジョブの必須条件：固有のゲージと、技を持つ（本仕様書 10.4）
    if (def.skills.length === 0) throw new Error(`ジョブ ${def.id} に技がない`);
    this.jobs.set(def.id, def);
  }

  get(id: string): JobDef {
    const def = this.jobs.get(id);
    if (!def) throw new Error(`未登録のジョブ: ${id}`);
    return def;
  }

  has(id: string): boolean {
    return this.jobs.has(id);
  }

  ids(): string[] {
    return [...this.jobs.keys()];
  }
}

export type JobChangeDenied = "locked" | "unknown" | "same";

/** キャラとジョブの進行。ジョブLvはジョブごとに別々に管理する */
export class Progression {
  readonly character: LevelState = { level: 1, exp: 0 };
  /** 出自（星辰盤の始点が決まる。変えられない） */
  readonly origin: string;
  mainJob: string;
  private readonly jobLevels = new Map<string, LevelState>();
  private readonly registry: JobRegistry;

  constructor(registry: JobRegistry, origin: string) {
    this.registry = registry;
    registry.get(origin);
    this.origin = origin;
    this.mainJob = origin;
    this.jobLevels.set(origin, { level: 1, exp: 0 });
  }

  jobState(id: string): LevelState {
    let s = this.jobLevels.get(id);
    if (!s) {
      s = { level: 1, exp: 0 };
      this.jobLevels.set(id, s);
    }
    return s;
  }

  /** セーブ用：ジョブごとのLvと経験値 */
  jobEntries(): [string, LevelState][] {
    return [...this.jobLevels.entries()].map(([id, st]) => [id, { ...st }]);
  }

  /** セーブの復元用 */
  restore(data: {
    character: LevelState;
    mainJob: string;
    jobs: readonly (readonly [string, LevelState])[];
  }): void {
    this.character.level = data.character.level;
    this.character.exp = data.character.exp;
    this.mainJob = data.mainJob;
    this.jobLevels.clear();
    for (const [id, st] of data.jobs) this.jobLevels.set(id, { level: st.level, exp: st.exp });
    this.jobState(this.mainJob);
  }

  get jobLevel(): number {
    return this.jobState(this.mainJob).level;
  }

  /** 最も高いジョブLv */
  get highestJobLevel(): number {
    return Math.max(...[...this.jobLevels.values()].map((s) => s.level));
  }

  /** 転職の可否。キャラLv15で開く */
  canChangeJob(id: string): { ok: boolean; reason?: JobChangeDenied } {
    if (!this.registry.has(id)) return { ok: false, reason: "unknown" };
    if (id === this.mainJob) return { ok: false, reason: "same" };
    if (this.character.level < JOB_CHANGE_LEVEL) return { ok: false, reason: "locked" };
    return { ok: true };
  }

  changeJob(id: string): { ok: boolean; reason?: JobChangeDenied } {
    const check = this.canChangeJob(id);
    if (!check.ok) return check;
    this.mainJob = id;
    this.jobState(id);
    return { ok: true };
  }

  /** メインジョブを直接決める（ロードアウトの切り替え。転職の条件は、ロードアウトを作るときに満たしている） */
  setMainJob(id: string): void {
    this.registry.get(id);
    this.mainJob = id;
    this.jobState(id);
  }

  /** 追いつき補正が効いているか：メインジョブのLvが、最も高いジョブLv-10未満のあいだ */
  get catchUpActive(): boolean {
    return this.jobLevel < this.highestJobLevel - CATCH_UP_GAP;
  }

  /**
   * 敵を倒して経験値を得る。キャラと同じ量を、メインジョブのジョブ経験値として得る。
   * 戻り値は上がったキャラLvとジョブLv。
   */
  gainFromKill(enemyLevel: number, source: ExpSource = "normal"): { char: number; job: number } {
    const amount = Math.round(
      enemyExp(enemyLevel, source) * levelDifferenceFactor(this.character.level, enemyLevel),
    );
    return this.gainExp(amount);
  }

  gainExp(amount: number): { char: number; job: number } {
    const char = addExp(this.character, amount, MVP_LEVEL_CAP);
    const jobAmount = this.catchUpActive ? amount * CATCH_UP_MULTIPLIER : amount;
    const job = addExp(this.jobState(this.mainJob), jobAmount, MVP_LEVEL_CAP);
    return { char, job };
  }

  /** 星辰盤のポイント（キャラLv 2〜20で19）。クエスト・隠し星の分は別に加える（U-14） */
  get starPointsFromLevel(): number {
    return this.character.level - 1;
  }

  /** 職紋盤のポイント（ジョブLv 2〜20で19。ジョブごと） */
  jobPoints(id: string): number {
    return this.jobState(id).level - 1;
  }
}
