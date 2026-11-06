// 仮実装: U-18a feature/town-and-dungeon-base で、町とダンジョンの地図に置き換える（試験用の場の計算）
import {
  AFFINITY_ATTACK_SPEED,
  type Affinity,
  Combatant,
  type ContentDb,
  Cooldowns,
  type DamageAttacker,
  FixedStepClock,
  Health,
  type HitReport,
  type HitShape,
  JobGauge,
  type JobDef,
  LingeringZone,
  PlayerMotion,
  type ResolvedSkill,
  Rng,
  SkillExecution,
  type SkillBlock,
  StepInputBuffer,
  type Strike,
  TagIndex,
  TimedEffects,
  type Vec2,
  ZERO,
  baseAccuracy,
  evaluateEffects,
  length,
  overlapsShape,
  pullTowards,
  resolveHit,
  resolveSkill,
  skillBlock,
  staggerProfiles,
  unlockedSkills,
  weaponAffinity,
} from "@stella/core";
import { loadGameContent } from "@stella/content";
import type { Action } from "../input/actions.ts";
import type { InputFrame } from "../input/frame.ts";
import { toMeters } from "../world/units.ts";

/** 試験用の場の大きさ（m）。 */
export const ARENA = { width: 40, height: 24 } as const;

/**
 * 回避の無敵時間を確かめるための「試験用の危険地帯」。
 * 2秒ごとに0.6秒の予兆（枠だけ）を出し、その後0.2秒だけ当たり判定が出る。
 */
export const HAZARD = {
  x: 30,
  y: 5,
  radius: 2.5,
  period: 2,
  telegraph: 0.6,
  active: 0.2,
} as const;

/** 訓練用の人形の位置（m）。 */
export const DUMMY_POSITION = { x: 20, y: 12 } as const;

// 仮実装: U-11 feature/item-generation で、アイテムのベースのデータに置き換える（試験用の武器。仕様書v0.2 3.2 の下級の値。基本刻印はまだ付けない）
export interface TestWeapon {
  readonly uid: string;
  readonly name: string;
  readonly tags: readonly string[];
  readonly base: { readonly physical: { readonly min: number; readonly max: number } };
  readonly critChance: number;
  readonly attackSpeed: number;
}
export const TEST_WEAPONS: readonly TestWeapon[] = [
  {
    uid: "test-greatsword",
    name: "下級の大剣",
    tags: ["TAG-WPN-GREATSWORD"],
    base: { physical: { min: 14, max: 24 } },
    critChance: 0.05,
    attackSpeed: 1.05,
  },
  {
    uid: "test-greataxe",
    name: "下級の大斧",
    tags: ["TAG-WPN-GREATAXE"],
    base: { physical: { min: 16, max: 28 } },
    critChance: 0.05,
    attackSpeed: 0.95,
  },
  {
    uid: "test-greatmace",
    name: "下級の大槌",
    tags: ["TAG-WPN-GREATMACE"],
    base: { physical: { min: 18, max: 27 } },
    critChance: 0.04,
    attackSpeed: 0.9,
  },
  {
    uid: "test-spear",
    name: "下級の槍",
    tags: ["TAG-WPN-SPEAR"],
    base: { physical: { min: 11, max: 20 } },
    critChance: 0.05,
    attackSpeed: 1.15,
  },
  {
    uid: "test-longsword",
    name: "下級の長剣",
    tags: ["TAG-WPN-SWORD"],
    base: { physical: { min: 6, max: 11 } },
    critChance: 0.05,
    attackSpeed: 1.4,
  },
];

/** 技の枠（行動か、試験用の R キー）。 */
export type SkillSlot = Action | "rout";

// 仮実装: U-12 feature/inventory-ui で、技の枠の設定に置き換える（試験用の技の並び。破軍は R キー）
export const LOADOUT: readonly { readonly action: SkillSlot; readonly skill: string }[] = [
  { action: "skill1", skill: "SKL-BASIC-ATTACK" },
  { action: "skill2", skill: "SKL-WARRIOR-SWEEP" },
  { action: "skill3", skill: "SKL-WARRIOR-CHARGE" },
  { action: "skill4", skill: "SKL-WARRIOR-WARCRY" },
  { action: "skill5", skill: "SKL-WARRIOR-EARTHSPLITTER" },
  { action: "skill6", skill: "SKL-WARRIOR-WHIRLWIND" },
  { action: "rout", skill: "SKL-WARRIOR-ROUT" },
];
// 仮実装: U-10 feature/rogue-and-job-change で、キャラクターのジョブLvに置き換える（試験用に全ての技を覚えている）
const TEST_JOB_LEVEL = 12;

/** ヒットの手応え：止まる時間（秒）と、白く光る時間。 */
const HIT_STOP = 0.05;
const FLASH = 0.08;
/** 当たり判定を見せる時間（秒）。 */
export const SHOW_STRIKE = 0.12;
/** 吸い寄せたとき、これより近くには寄せない（m）。 */
const PULL_MIN_DISTANCE = 1;
/** 一番低いMP（仕様書v0.2 2.3：基礎MP60）。 */
const MAX_MP = 60;

/**
 * 計算の刻みで使う「押した瞬間」の行動。これ以外の押した瞬間の入力は保持しない
 * （まだ使わない行動を保持し続けて、後で古い入力が発動するのを防ぐ）。
 * 回避（U-06）と、技の枠（U-07 の通常攻撃を、U-08 で全ての技の枠に広げた。破軍の R を含む）。
 */
const STEP_ACTIONS = [
  "dodge",
  "skill1",
  "skill2",
  "skill3",
  "skill4",
  "skill5",
  "skill6",
  "rout",
] as const satisfies readonly SkillSlot[];
type StepAction = (typeof STEP_ACTIONS)[number];

/** 技の実行と、当たった敵の記録（group ごと）。 */
interface Running {
  readonly exec: SkillExecution | LingeringZone;
  readonly hit: Map<string, Set<string>>;
}

/** 表示用：出た当たり判定（出た時刻つき）。 */
export interface ShownStrike {
  readonly shape: HitShape;
  readonly origin: Vec2;
  readonly facing: number;
  readonly t: number;
}

/** 行動に無い、試験用のキー（R で破軍・Tab で武器を替える）の入力。 */
export interface ArenaExtraInput {
  /** R を押した瞬間か（このフレームで）。 */
  readonly routPressed?: boolean;
  /** R を押しているか。 */
  readonly routHeld?: boolean;
  /** Tab を押した瞬間か（武器を替える。技の実行中は替えない）。 */
  readonly switchWeapon?: boolean;
}

export interface ArenaSimulationOptions {
  /** ゲームのデータ（既定は loadGameContent()）。 */
  db?: ContentDb;
  /** 人形へのヒットを解決したときに呼ぶ（表示の手応え用。回避されたヒットは呼ばない）。 */
  onHit?: (report: HitReport) => void;
}

/**
 * 試験用の場の計算（Phaser に依存しない。ArenaScene が描画のフレームごとに呼ぶ）。
 *
 * 入力の流れ：
 * 1. 取得：ArenaScene が InputSystem でフレームの入力を読み、{@link frame} に渡す
 * 2. 保持：押した瞬間の入力（回避・技の枠）は {@link StepInputBuffer} に入れ、刻みで使われるまで残す
 * 3. 消費：各刻みが取り出す。刻みが0のフレームやヒットの手応えで止まっている刻みでは取り出されず、
 *    次に進む刻みに持ち越す
 *
 * 押し続けの入力（移動・照準・技の押し続け）は、そのフレームの値を、そのフレームの全ての刻みに渡す。
 */
export class ArenaSimulation {
  readonly motion: PlayerMotion;
  readonly clock: FixedStepClock;
  readonly db: ContentDb;
  readonly tags: TagIndex;
  readonly job: JobDef;
  readonly dummy: Combatant;
  readonly playerHealth: Health;
  readonly maxMp = MAX_MP;
  readonly fervor: JobGauge;
  readonly cooldowns = new Cooldowns();
  readonly buffs = new TimedEffects();
  private readonly stepInput = new StepInputBuffer<StepAction>();
  private readonly rng = Rng.fromSeed("arena");
  private readonly onHit: ((report: HitReport) => void) | undefined;
  private weaponIndex = 0;
  private attackerValue!: DamageAttacker;
  private attackerVersion = -1;
  private attackSpeedValue = 1;
  private current: { slot: SkillSlot; run: Running } | undefined;
  private zoneRuns: Running[] = [];
  private readonly strikes: ShownStrike[] = [];
  private mpValue = MAX_MP;
  private hitStopLeft = 0;
  private flashLeft = 0;
  private elapsed = 0;
  private hits = 0;
  private avoided = 0;
  private resolvedCycle = -1;
  private lastReport: HitReport | undefined;
  private lastSkillValue: { id: string; variants: readonly string[] } | undefined;
  private dummyHits = 0;
  private readonly useCounts = new Map<string, number>();
  private readonly recentDamage: { t: number; amount: number }[] = [];

  constructor(clock: FixedStepClock = new FixedStepClock(), options: ArenaSimulationOptions = {}) {
    this.clock = clock;
    this.db = options.db ?? loadGameContent();
    this.onHit = options.onHit;
    this.tags = new TagIndex(this.db.tags);
    const job = this.db.jobs.get("JOB-WARRIOR");
    const gauge = this.db.gauges.get(job?.gauge ?? "");
    if (job === undefined || gauge === undefined) throw new Error("戦士のデータがない");
    this.job = job;
    this.fervor = new JobGauge(gauge);
    this.playerHealth = new Health({ maxHp: 60 });
    this.refreshAttacker();
    this.motion = new PlayerMotion({ x: 12, y: 12 }, undefined, {
      minX: 0.5,
      minY: 0.75,
      maxX: ARENA.width - 0.5,
      maxY: ARENA.height - 0.25,
    });
    this.dummy = new Combatant(this.db, {
      id: "dummy",
      team: "enemy",
      position: { ...DUMMY_POSITION },
      radius: 0.5,
      facing: Math.PI, // 左（プレイヤーの方）を向く
      maxHp: 5000,
      staggerProfile: staggerProfiles(this.db).enemy,
    });
  }

  /** 計算を進めた時間の合計（秒）。ヒットの手応えで止まっている間は進まない。 */
  get time(): number {
    return this.elapsed;
  }
  get hazardHits(): number {
    return this.hits;
  }
  get hazardAvoided(): number {
    return this.avoided;
  }
  /** 回避の入力を保持していて、まだどの刻みにも渡していないか。 */
  get dodgePending(): boolean {
    return this.stepInput.has("dodge");
  }
  /** 通常攻撃（skill1）の押した瞬間の入力を保持していて、まだどの刻みにも渡していないか。 */
  get attackPending(): boolean {
    return this.stepInput.has("skill1");
  }
  /** その技の枠の押した瞬間の入力を保持していて、まだどの刻みにも渡していないか。 */
  pending(slot: StepAction): boolean {
    return this.stepInput.has(slot);
  }
  /** 実行中の技の枠（なければ undefined）。 */
  get executing(): SkillSlot | undefined {
    return this.current?.slot;
  }
  /** 実行中の技（なければ undefined）。 */
  get execution(): SkillExecution | undefined {
    return this.current?.run.exec as SkillExecution | undefined;
  }
  /** 残っている置く範囲（地割りの亀裂など）。 */
  get zones(): readonly LingeringZone[] {
    return this.zoneRuns.map((z) => z.exec as LingeringZone);
  }
  get weapon(): TestWeapon {
    return TEST_WEAPONS[this.weaponIndex] ?? (TEST_WEAPONS[0] as TestWeapon);
  }
  get affinity(): Affinity {
    return weaponAffinity(this.tags, this.job, this.weapon.tags);
  }
  get attackSpeed(): number {
    return this.attackSpeedValue;
  }
  get attacker(): DamageAttacker {
    return this.attackerValue;
  }
  get mp(): number {
    return this.mpValue;
  }
  /** 白く光らせる残りの時間（秒）。 */
  get flash(): number {
    return this.flashLeft;
  }
  get lastHit(): HitReport | undefined {
    return this.lastReport;
  }
  get lastSkill(): { id: string; variants: readonly string[] } | undefined {
    return this.lastSkillValue;
  }
  /** 人形に当たったヒットの数（回避されたものを除く）。 */
  get hitCount(): number {
    return this.dummyHits;
  }
  /** 技ごとの使った回数。 */
  get uses(): ReadonlyMap<string, number> {
    return this.useCounts;
  }
  /** 直近に出た当たり判定（表示用。SHOW_STRIKE 秒より古いものは除く）。 */
  visibleStrikes(): readonly ShownStrike[] {
    while ((this.strikes[0]?.t ?? Infinity) < this.elapsed - SHOW_STRIKE) this.strikes.shift();
    return this.strikes;
  }

  /**
   * 描画の1フレーム分を進める。
   * @param deltaSeconds 前のフレームからの経過時間（秒）
   * @returns この呼び出しで進めた刻みの数
   */
  frame(deltaSeconds: number, input: InputFrame, extra: ArenaExtraInput = {}): number {
    // 時間の検証を先に行う（例外のときに入力だけが残らないように）
    const { steps } = this.clock.advance(deltaSeconds);
    if (extra.switchWeapon === true) this.switchWeapon();
    const pressed: StepAction[] = STEP_ACTIONS.filter((a) => a !== "rout" && input.pressed.has(a));
    if (extra.routPressed === true) pressed.push("rout");
    this.stepInput.press(pressed);
    for (let i = 0; i < steps; i++) this.step(input, extra.routHeld === true);
    return steps;
  }

  /** 武器を次の試験用の武器に替える（技の実行中は替えない）。 */
  switchWeapon(): void {
    if (this.current !== undefined) return;
    this.weaponIndex = (this.weaponIndex + 1) % TEST_WEAPONS.length;
    this.attackerVersion = -1;
    this.refreshAttacker();
  }

  /** 確認用：闘志の量を決める（開発版の確認・テストで、激化・解放を短い時間で試すため）。 */
  setFervor(value: number): number {
    this.fervor.spend("all");
    this.fervor.add(value);
    this.fervor.markCombat();
    return this.fervor.value;
  }

  /** 技が使えない理由（使えるなら undefined）。 */
  blockOf(skillId: string): SkillBlock | "locked" | undefined {
    if (
      skillId !== "SKL-BASIC-ATTACK" &&
      !unlockedSkills(this.job, TEST_JOB_LEVEL).includes(skillId)
    )
      return "locked";
    const def = this.db.skills.get(skillId);
    if (def === undefined) return "locked";
    return skillBlock(def, {
      cooldown: this.cooldowns.remaining(skillId),
      mp: this.mpValue,
      gauge: this.fervor.value,
      affinity: this.affinity,
    });
  }

  /** 直近5秒のDPS（表示用）。 */
  dps(): number {
    while ((this.recentDamage[0]?.t ?? Infinity) < this.elapsed - 5) this.recentDamage.shift();
    return this.recentDamage.reduce((s, d) => s + d.amount, 0) / 5;
  }

  /** 効果（戦吼の強化など）が変わったら、攻撃する側の能力値を計算し直す。 */
  private refreshAttacker(): void {
    if (this.attackerVersion === this.buffs.version) return;
    this.attackerVersion = this.buffs.version;
    const { view } = evaluateEffects(this.db, this.tags, this.buffs.instances(), {
      baseStats: { "STAT-ACCURACY": baseAccuracy(1, 10) },
      equippedTags: { mainHand: this.weapon.tags },
      mainJob: this.job.tag,
    });
    const w = this.weapon;
    this.attackerValue = {
      db: this.db,
      view,
      characterLevel: 1,
      weapon: { uid: w.uid, tags: w.tags, base: w.base, critChance: w.critChance },
    };
    // 武器適性の攻撃速度（仕様書5.1）は、加算の増加として足す
    this.attackSpeedValue =
      w.attackSpeed *
      Math.max(
        0.1,
        1 + view.stat("STAT-ATTACK-SPEED").increased + AFFINITY_ATTACK_SPEED[this.affinity],
      );
  }

  private startSkill(slot: SkillSlot, skillId: string): void {
    const def = this.db.skills.get(skillId);
    if (def === undefined) return;
    const resolved: ResolvedSkill = resolveSkill(this.db, def, {
      stages: this.fervor.stages,
      weaponTags: this.tags.closure(this.weapon.tags),
    });
    this.mpValue -= def.mpCost;
    this.cooldowns.start(def.id, def.cooldown);
    if (def.gauge?.cost !== undefined) this.fervor.spend(def.gauge.cost);
    if (def.gauge?.gainOnUse !== undefined) this.fervor.add(def.gauge.gainOnUse);
    this.fervor.markCombat();
    for (const e of def.selfEffects ?? []) this.buffs.add(e.effect, e.duration, def.id);
    this.lastSkillValue = { id: def.id, variants: resolved.variants };
    this.useCounts.set(def.id, (this.useCounts.get(def.id) ?? 0) + 1);
    this.current = {
      slot,
      run: {
        exec: new SkillExecution(resolved, this.motion.facing, this.attackSpeedValue),
        hit: new Map(),
      },
    };
  }

  private step(input: InputFrame, routHeld: boolean): void {
    const dt = this.clock.stepSeconds;
    this.flashLeft = Math.max(0, this.flashLeft - dt);
    // ヒットの手応え：ヒットの瞬間に、ほんの少しだけ止める（押した瞬間の入力は保持したまま）
    if (this.hitStopLeft > 0) {
      this.hitStopLeft -= dt;
      return;
    }
    const pos = this.motion.position;
    const aim = {
      x: toMeters(input.pointerWorld.x) - pos.x,
      y: toMeters(input.pointerWorld.y) - pos.y,
    };
    // 保持している押した瞬間の入力は、最初に進んだ刻みで取り出され、以降の刻みには渡らない
    const dodge = this.stepInput.take("dodge");
    const pressed = new Set<SkillSlot>();
    for (const a of STEP_ACTIONS) if (a !== "dodge" && this.stepInput.take(a)) pressed.add(a);
    const held = (slot: SkillSlot): boolean => (slot === "rout" ? routHeld : input.held.has(slot));
    if (dodge) this.current = undefined; // 回避で技を取り消せる

    // 技を使い始める（照準の方向へ）。枠の順に、使えるものを1つ。押し続けている間は繰り返し使う（補助仕様書1.1）
    if (this.current === undefined && !this.motion.dodging && !dodge) {
      const use = LOADOUT.find(
        (l) => (held(l.action) || pressed.has(l.action)) && this.blockOf(l.skill) === undefined,
      );
      if (use !== undefined) {
        this.motion.update(0, { move: ZERO, aim, dodge: false }); // 向きだけ照準に合わせる
        this.startSkill(use.action, use.skill);
      }
    }

    // 技の実行
    let moveMultiplier = 1;
    if (this.current !== undefined) {
      const run = this.current.run;
      const exec = run.exec as SkillExecution;
      const tick = exec.update(dt, {
        position: this.motion.position,
        held: held(this.current.slot),
        mp: this.mpValue,
      });
      this.mpValue = Math.max(0, this.mpValue - tick.mpCost);
      this.resolveStrikes(run, tick.strikes);
      this.motion.displace(tick.displacement);
      if (tick.warcry !== undefined) {
        const w = tick.warcry;
        for (const e of w.allyEffects) this.buffs.add(e, w.duration, exec.skill.def.id);
        if (
          length({
            x: this.dummy.position.x - w.origin.x,
            y: this.dummy.position.y - w.origin.y,
          }) <=
          w.radius + this.dummy.radius
        )
          for (const e of w.enemyEffects) this.dummy.statuses.add(e, w.duration, exec.skill.def.id);
        this.showShape({ type: "circle", radius: w.radius }, w.origin, 0);
      }
      if (tick.pull !== undefined) {
        const p = tick.pull;
        const d = this.dummy.position;
        if (!this.dummy.isBoss && length({ x: d.x - p.origin.x, y: d.y - p.origin.y }) <= p.radius)
          this.dummy.position = pullTowards(d, p.origin, p.speed * dt, PULL_MIN_DISTANCE);
      }
      for (const z of tick.zones) this.zoneRuns.push({ exec: z, hit: new Map() });
      moveMultiplier = tick.moveMultiplier;
      if (tick.finished) this.current = undefined;
    }
    for (const z of this.zoneRuns) this.resolveStrikes(z, (z.exec as LingeringZone).update(dt));
    this.zoneRuns = this.zoneRuns.filter((z) => !(z.exec as LingeringZone).done);

    this.motion.update(dt, {
      move: input.move,
      aim: this.current === undefined ? aim : ZERO,
      dodge,
      speedMultiplier: moveMultiplier,
    });

    const dot = this.dummy.update(dt);
    if (dot > 0) this.recentDamage.push({ t: this.elapsed, amount: dot });
    this.playerHealth.update(dt);
    this.mpValue = Math.min(MAX_MP, this.mpValue + MAX_MP * 0.06 * dt);
    this.cooldowns.update(dt);
    this.buffs.update(dt);
    this.fervor.update(dt);
    this.refreshAttacker();
    this.elapsed += dt;
    this.updateHazard();
    if (this.dummy.health.hp < this.dummy.health.maxHp * 0.2) this.dummy.health.restoreFull();
  }

  /** 当たり判定を、形に入った敵に当てる。同じ group では、1体に1回だけ。 */
  private resolveStrikes(run: Running, strikes: readonly Strike[]): void {
    let landed = false;
    for (const s of strikes) {
      this.showShape(s.shape, s.origin, s.facing);
      const t = this.dummy;
      if (!overlapsShape(s.shape, s.origin, s.facing, t.position, t.radius)) continue;
      if (s.group !== undefined) {
        const set = run.hit.get(s.group) ?? new Set<string>();
        if (set.has(t.id)) continue;
        set.add(t.id);
        run.hit.set(s.group, set);
      }
      const report = resolveHit({
        db: this.db,
        attacker: this.attackerValue,
        attackerPosition: s.origin,
        skill: s.damage,
        skillChance: s.skill.ailmentChance,
        staggerCoefficient: s.skill.staggerCoefficient,
        target: t,
        rng: this.rng,
        fullStagger: s.fullStagger,
      });
      this.lastReport = report;
      if (report.hit.evaded) continue;
      landed = true;
      this.dummyHits += 1;
      this.recentDamage.push({ t: this.elapsed, amount: report.hit.total });
      this.hitStopLeft = HIT_STOP;
      this.flashLeft = FLASH;
      this.onHit?.(report);
    }
    // 闘志：1回の当たり判定の発生で、当たれば1回増える（docs/progress D-U08-3）
    const first = strikes[0];
    if (landed && first !== undefined)
      this.fervor.onHitDealt(this.tags.closure(first.skill.damage.tags));
  }

  private showShape(shape: HitShape, origin: Vec2, facing: number): void {
    this.strikes.push({ shape, origin, facing, t: this.elapsed });
  }

  private updateHazard(): void {
    const cycle = Math.floor(this.elapsed / HAZARD.period);
    const t = this.elapsed - cycle * HAZARD.period;
    const active = t >= HAZARD.telegraph && t < HAZARD.telegraph + HAZARD.active;
    if (!active || this.resolvedCycle === cycle) return;
    const p = this.motion.position;
    const inside = length({ x: p.x - HAZARD.x, y: p.y - HAZARD.y }) <= HAZARD.radius;
    if (!inside) return;
    // 当たり判定が出ている間に1回だけ判定する。回避の無敵時間なら無効
    this.resolvedCycle = cycle;
    if (this.motion.invulnerable) this.avoided += 1;
    else {
      this.hits += 1;
      const taken = this.playerHealth.takeDamage(5);
      this.fervor.onDamageTaken(taken.toHp + taken.toWard, this.playerHealth.maxHp);
      if (this.playerHealth.dead) this.playerHealth.restoreFull();
    }
  }
}
