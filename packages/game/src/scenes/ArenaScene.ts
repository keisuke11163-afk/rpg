// 仮実装: U-18a feature/town-and-dungeon-base で、町とダンジョンの地図に置き換える（試験用の場）
import Phaser from "phaser";
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
import { loadGameContent, text, type TextKey } from "@stella/content";
import { SCREEN } from "../config.ts";
import { exposeDebug } from "../debug.ts";
import type { Action } from "../input/actions.ts";
import { InputSystem } from "../input/InputSystem.ts";
import { TEXTURES } from "../world/placeholders.ts";
import { PIXELS_PER_METER, toMeters, toPixels } from "../world/units.ts";

/** 試験用の場の大きさ（m）。 */
const ARENA = { width: 40, height: 24 };

/**
 * 回避の無敵時間を確かめるための「試験用の危険地帯」。
 * 2秒ごとに0.6秒の予兆（枠だけ）を出し、その後0.2秒だけ当たり判定が出る。
 */
const HAZARD = { x: 30, y: 5, radius: 2.5, period: 2, telegraph: 0.6, active: 0.2 };

// 仮実装: U-11 feature/item-generation で、アイテムのベースのデータに置き換える（試験用の武器。仕様書v0.2 3.2 の下級の値。基本刻印はまだ付けない）
interface TestWeapon {
  readonly uid: string;
  readonly name: string;
  readonly tags: readonly string[];
  readonly base: { readonly physical: { readonly min: number; readonly max: number } };
  readonly critChance: number;
  readonly attackSpeed: number;
}
const TEST_WEAPONS: readonly TestWeapon[] = [
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

// 仮実装: U-12 feature/inventory-ui で、技の枠の設定に置き換える（試験用の技の並び。破軍は R キー）
const LOADOUT: readonly { readonly action: Action | "rout"; readonly skill: string }[] = [
  { action: "skill1", skill: "SKL-BASIC-ATTACK" },
  { action: "skill2", skill: "SKL-WARRIOR-SWEEP" },
  { action: "skill3", skill: "SKL-WARRIOR-CHARGE" },
  { action: "skill4", skill: "SKL-WARRIOR-WARCRY" },
  { action: "skill5", skill: "SKL-WARRIOR-EARTHSPLITTER" },
  { action: "skill6", skill: "SKL-WARRIOR-WHIRLWIND" },
  { action: "rout", skill: "SKL-WARRIOR-ROUT" },
];
const SLOT_LABEL: Readonly<Record<string, string>> = {
  skill1: "左",
  skill2: "右",
  skill3: "1",
  skill4: "2",
  skill5: "3",
  skill6: "4",
  rout: "R",
};
// 仮実装: U-10 feature/rogue-and-job-change で、キャラクターのジョブLvに置き換える（試験用に全ての技を覚えている）
const TEST_JOB_LEVEL = 12;

/** ヒットの手応え：止まる時間（秒）と、白く光る時間。 */
const HIT_STOP = 0.05;
const FLASH = 0.08;
/** 当たり判定を見せる時間（秒）。 */
const SHOW_STRIKE = 0.12;
/** 吸い寄せたとき、これより近くには寄せない（m）。 */
const PULL_MIN_DISTANCE = 1;
/** 一番低いMP（仕様書v0.2 2.3：基礎MP60）。 */
const MAX_MP = 60;

/** 技の実行と、当たった敵の記録（group ごと）。 */
interface Running {
  readonly exec: SkillExecution | LingeringZone;
  readonly hit: Map<string, Set<string>>;
}

export class ArenaScene extends Phaser.Scene {
  private db!: ContentDb;
  private tags!: TagIndex;
  private job!: JobDef;
  private motion!: PlayerMotion;
  private controls!: InputSystem;
  private readonly clock = new FixedStepClock();
  private readonly rng = Rng.fromSeed("arena");
  private weaponIndex = 0;
  private attacker!: DamageAttacker;
  private attackerVersion = -1;
  private attackSpeed = 1;
  private playerHealth!: Health;
  private mp = MAX_MP;
  private fervor!: JobGauge;
  private readonly cooldowns = new Cooldowns();
  private readonly buffs = new TimedEffects();
  private dummy!: Combatant;
  private current: { slot: string; run: Running } | undefined;
  private zones: Running[] = [];
  private readonly shownStrikes: { shape: HitShape; origin: Vec2; facing: number; t: number }[] =
    [];
  private hitStop = 0;
  private flash = 0;
  private time0 = 0;
  private hazardHits = 0;
  private hazardAvoided = 0;
  private hazardResolved = -1;
  private lastHit: HitReport | undefined;
  private lastSkill: { id: string; variants: readonly string[] } | undefined;
  private hitCount = 0;
  private readonly uses = new Map<string, number>();
  private readonly recentDamage: { t: number; amount: number }[] = [];
  private keyTab!: Phaser.Input.Keyboard.Key;
  private keyRout!: Phaser.Input.Keyboard.Key;
  private routPressed = false;
  private tabPressed = false;

  private body!: Phaser.GameObjects.Image;
  private facing!: Phaser.GameObjects.Image;
  private dummyImage!: Phaser.GameObjects.Image;
  private dummyFacing!: Phaser.GameObjects.Image;
  private fx!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Text;
  private bars!: Phaser.GameObjects.Graphics;

  constructor() {
    super("arena");
  }

  private get weapon(): TestWeapon {
    return TEST_WEAPONS[this.weaponIndex] ?? (TEST_WEAPONS[0] as TestWeapon);
  }

  private get affinity(): Affinity {
    return weaponAffinity(this.tags, this.job, this.weapon.tags);
  }

  create(): void {
    this.db = loadGameContent();
    this.tags = new TagIndex(this.db.tags);
    const job = this.db.jobs.get("JOB-WARRIOR");
    const gauge = this.db.gauges.get(job?.gauge ?? "");
    if (job === undefined || gauge === undefined) throw new Error("戦士のデータがない");
    this.job = job;
    this.fervor = new JobGauge(gauge);
    this.playerHealth = new Health({ maxHp: 60 });
    this.refreshAttacker();

    this.add
      .tileSprite(0, 0, toPixels(ARENA.width), toPixels(ARENA.height), TEXTURES.floor)
      .setOrigin(0, 0);
    this.fx = this.add.graphics();
    this.motion = new PlayerMotion({ x: 12, y: 12 }, undefined, {
      minX: 0.5,
      minY: 0.75,
      maxX: ARENA.width - 0.5,
      maxY: ARENA.height - 0.25,
    });
    this.dummy = new Combatant(this.db, {
      id: "dummy",
      team: "enemy",
      position: { x: 20, y: 12 },
      radius: 0.5,
      facing: Math.PI, // 左（プレイヤーの方）を向く
      maxHp: 5000,
      staggerProfile: staggerProfiles(this.db).enemy,
    });
    // 位置は体の中心（照準を合わせた所に当たるように。docs/progress D-U07-4）
    this.dummyImage = this.add
      .image(toPixels(20), toPixels(12), TEXTURES.dummy)
      .setOrigin(0.5, 0.5);
    this.dummyFacing = this.add
      .image(toPixels(20), toPixels(12), TEXTURES.facing)
      .setOrigin(-0.6, 0.5)
      .setRotation(Math.PI)
      .setTint(0xa07850);
    this.body = this.add.image(0, 0, TEXTURES.player).setOrigin(0.5, 0.5);
    this.facing = this.add.image(0, 0, TEXTURES.facing).setOrigin(-0.6, 0.5);
    this.controls = new InputSystem(this);
    // 仮実装: U-12 feature/inventory-ui で、装備の画面・技の枠の設定に置き換える（Tab で武器を替える・R で破軍）
    const keyboard = this.input.keyboard;
    if (keyboard === null) throw new Error("キーボードの入力が使えない");
    this.keyTab = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TAB, true);
    this.keyRout = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R, true);
    this.keyTab.on("down", () => (this.tabPressed = true));
    this.keyRout.on("down", () => (this.routPressed = true));

    const camera = this.cameras.main;
    camera.setBounds(0, 0, toPixels(ARENA.width), toPixels(ARENA.height));
    camera.startFollow(this.body, true, 0.2, 0.2);
    camera.setRoundPixels(true);

    this.bars = this.add.graphics().setScrollFactor(0);
    this.hud = this.add
      .text(8, 8, "", {
        fontFamily: "sans-serif",
        fontSize: "10px",
        color: "#e8e6f0",
        lineSpacing: 2,
      })
      .setScrollFactor(0);

    exposeDebug({
      player: () => ({
        x: this.motion.position.x,
        y: this.motion.position.y,
        direction8: this.motion.direction8,
        stamina: this.motion.currentStamina,
        dodging: this.motion.dodging,
        invulnerable: this.motion.invulnerable,
        // 画面の上の位置（ゲームのピクセル。カメラの位置を引いたもの）
        screenX: this.body.x - this.cameras.main.scrollX,
        screenY: this.body.y - this.cameras.main.scrollY,
      }),
      hazard: () => ({
        hits: this.hazardHits,
        avoided: this.hazardAvoided,
        phase: this.time0 % HAZARD.period,
        x: HAZARD.x,
        y: HAZARD.y,
      }),
      dummy: () => ({
        x: this.dummy.position.x,
        y: this.dummy.position.y,
        hp: this.dummy.health.hp,
        maxHp: this.dummy.health.maxHp,
        hits: this.hitCount,
        lastDamage: this.lastHit?.hit.total ?? 0,
        lastCrit: this.lastHit?.hit.crit ?? false,
        lastBackstab: this.lastHit?.backstab ?? false,
        lastAilments: this.lastHit?.ailments.map((a) => a.tag) ?? [],
        broken: this.dummy.stagger.broken,
        statuses: this.dummy.statuses.active.map((s) => s.effectId),
        screenX: this.dummyImage.x - this.cameras.main.scrollX,
        screenY: this.dummyImage.y - this.cameras.main.scrollY,
      }),
      // 確認用：闘志の量を決める（開発版だけ。自動の確認で、激化・解放を短い時間で試すため）
      setFervor: (value?: number) => {
        this.fervor.spend("all");
        this.fervor.add(value ?? 0);
        this.fervor.markCombat();
        return this.fervor.value;
      },
      skills: () => ({
        weapon: this.weapon.uid,
        affinity: this.affinity,
        attackSpeed: this.attackSpeed,
        mp: this.mp,
        fervor: this.fervor.value,
        stages: this.fervor.stages,
        executing: this.current?.slot ?? null,
        lastSkill: this.lastSkill?.id ?? null,
        lastVariants: this.lastSkill?.variants ?? [],
        uses: Object.fromEntries(this.uses),
        buffs: this.buffs.active.map((b) => b.effectId),
        cooldowns: Object.fromEntries(
          LOADOUT.map((l) => [l.skill, this.cooldowns.remaining(l.skill)]),
        ),
      }),
    });
    document.body.dataset["stellaReady"] = "true";
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
    this.attacker = {
      db: this.db,
      view,
      characterLevel: 1,
      weapon: { uid: w.uid, tags: w.tags, base: w.base, critChance: w.critChance },
    };
    // 武器適性の攻撃速度（仕様書5.1）は、加算の増加として足す
    this.attackSpeed =
      w.attackSpeed *
      Math.max(
        0.1,
        1 + view.stat("STAT-ATTACK-SPEED").increased + AFFINITY_ATTACK_SPEED[this.affinity],
      );
  }

  private switchWeapon(): void {
    if (this.current !== undefined) return;
    this.weaponIndex = (this.weaponIndex + 1) % TEST_WEAPONS.length;
    this.attackerVersion = -1;
    this.refreshAttacker();
  }

  /** 技の枠を押しているか（押し続けで繰り返し使う。補助仕様書1.1）。 */
  private wants(slot: string, held: ReadonlySet<Action>, pressed: ReadonlySet<Action>): boolean {
    if (slot === "rout") return this.routPressed || this.keyRout.isDown;
    return held.has(slot as Action) || pressed.has(slot as Action);
  }

  private blockOf(skillId: string): SkillBlock | "locked" | undefined {
    if (
      skillId !== "SKL-BASIC-ATTACK" &&
      !unlockedSkills(this.job, TEST_JOB_LEVEL).includes(skillId)
    )
      return "locked";
    const def = this.db.skills.get(skillId);
    if (def === undefined) return "locked";
    return skillBlock(def, {
      cooldown: this.cooldowns.remaining(skillId),
      mp: this.mp,
      gauge: this.fervor.value,
      affinity: this.affinity,
    });
  }

  private startSkill(slot: string, skillId: string): void {
    const def = this.db.skills.get(skillId);
    if (def === undefined) return;
    const resolved: ResolvedSkill = resolveSkill(this.db, def, {
      stages: this.fervor.stages,
      weaponTags: this.tags.closure(this.weapon.tags),
    });
    this.mp -= def.mpCost;
    this.cooldowns.start(def.id, def.cooldown);
    if (def.gauge?.cost !== undefined) this.fervor.spend(def.gauge.cost);
    if (def.gauge?.gainOnUse !== undefined) this.fervor.add(def.gauge.gainOnUse);
    this.fervor.markCombat();
    for (const e of def.selfEffects ?? []) this.buffs.add(e.effect, e.duration, def.id);
    this.lastSkill = { id: def.id, variants: resolved.variants };
    this.uses.set(def.id, (this.uses.get(def.id) ?? 0) + 1);
    this.current = {
      slot,
      run: {
        exec: new SkillExecution(resolved, this.motion.facing, this.attackSpeed),
        hit: new Map(),
      },
    };
  }

  override update(_time: number, deltaMs: number): void {
    const frame = this.controls.read();
    if (this.tabPressed) this.switchWeapon();
    this.tabPressed = false;
    const { steps } = this.clock.advance(deltaMs / 1000);
    for (let i = 0; i < steps; i++) {
      const dt = this.clock.stepSeconds;
      this.flash = Math.max(0, this.flash - dt);
      // ヒットの手応え：ヒットの瞬間に、ほんの少しだけ止める
      if (this.hitStop > 0) {
        this.hitStop -= dt;
        continue;
      }
      const first = i === 0;
      const pressed = first ? frame.pressed : new Set<Action>();
      const pos = this.motion.position;
      const aim = {
        x: toMeters(frame.pointerWorld.x) - pos.x,
        y: toMeters(frame.pointerWorld.y) - pos.y,
      };
      const dodge = pressed.has("dodge");
      if (dodge) this.current = undefined; // 回避で技を取り消せる

      // 技を使い始める（照準の方向へ）。枠の順に、使えるものを1つ
      if (this.current === undefined && !this.motion.dodging && !dodge) {
        this.motion.update(0, { move: ZERO, aim, dodge: false }); // 向きだけ照準に合わせる
        for (const l of LOADOUT) {
          if (this.wants(l.action, frame.held, pressed) && this.blockOf(l.skill) === undefined) {
            this.startSkill(l.action, l.skill);
            break;
          }
        }
      }
      if (first) this.routPressed = false;

      // 技の実行
      let moveMultiplier = 1;
      if (this.current !== undefined) {
        const run = this.current.run;
        const exec = run.exec as SkillExecution;
        const tick = exec.update(dt, {
          position: this.motion.position,
          held: this.wants(this.current.slot, frame.held, new Set()),
          mp: this.mp,
        });
        this.mp = Math.max(0, this.mp - tick.mpCost);
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
            for (const e of w.enemyEffects)
              this.dummy.statuses.add(e, w.duration, exec.skill.def.id);
          this.showShape({ type: "circle", radius: w.radius }, w.origin, 0);
        }
        if (tick.pull !== undefined) {
          const p = tick.pull;
          const d = this.dummy.position;
          if (
            !this.dummy.isBoss &&
            length({ x: d.x - p.origin.x, y: d.y - p.origin.y }) <= p.radius
          )
            this.dummy.position = pullTowards(d, p.origin, p.speed * dt, PULL_MIN_DISTANCE);
        }
        for (const z of tick.zones) this.zones.push({ exec: z, hit: new Map() });
        moveMultiplier = tick.moveMultiplier;
        if (tick.finished) this.current = undefined;
      }
      for (const z of this.zones) this.resolveStrikes(z, (z.exec as LingeringZone).update(dt));
      this.zones = this.zones.filter((z) => !(z.exec as LingeringZone).done);

      this.motion.update(dt, {
        move: frame.move,
        aim: this.current === undefined ? aim : ZERO,
        dodge,
        speedMultiplier: moveMultiplier,
      });

      const dot = this.dummy.update(dt);
      if (dot > 0) this.recentDamage.push({ t: this.time0, amount: dot });
      this.playerHealth.update(dt);
      this.mp = Math.min(MAX_MP, this.mp + MAX_MP * 0.06 * dt);
      this.cooldowns.update(dt);
      this.buffs.update(dt);
      this.fervor.update(dt);
      this.refreshAttacker();
      this.time0 += dt;
      this.updateHazard();
      if (this.dummy.health.hp < this.dummy.health.maxHp * 0.2) this.dummy.health.restoreFull();
    }
    this.render();
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
        attacker: this.attacker,
        attackerPosition: s.origin,
        skill: s.damage,
        skillChance: s.skill.ailmentChance,
        staggerCoefficient: s.skill.staggerCoefficient,
        target: t,
        rng: this.rng,
        fullStagger: s.fullStagger,
      });
      this.lastHit = report;
      if (report.hit.evaded) continue;
      landed = true;
      this.hitCount += 1;
      this.recentDamage.push({ t: this.time0, amount: report.hit.total });
      this.hitStop = HIT_STOP;
      this.flash = FLASH;
      if (report.hit.crit || report.staggerBroke) this.cameras.main.shake(80, 0.004);
      this.popDamage(report);
    }
    // 闘志：1回の当たり判定の発生で、当たれば1回増える（docs/progress D-U08-3）
    const first = strikes[0];
    if (landed && first !== undefined)
      this.fervor.onHitDealt(this.tags.closure(first.skill.damage.tags));
  }

  private skillName(id: string): string {
    const def = this.db.skills.get(id);
    return def === undefined ? id : text(def.text as TextKey);
  }

  private showShape(shape: HitShape, origin: Vec2, facing: number): void {
    this.shownStrikes.push({ shape, origin, facing, t: this.time0 });
  }

  private popDamage(report: HitReport): void {
    const color = report.hit.crit ? "#ffd166" : report.backstab ? "#c3a6ff" : "#ffffff";
    const label = `${report.hit.total.toFixed(0)}${report.hit.crit ? "!" : ""}${report.backstab ? "（背面）" : ""}${report.staggerBroke ? "（崩し）" : ""}`;
    const t = this.add
      .text(this.dummyImage.x, this.dummyImage.y - 18, label, {
        fontFamily: "sans-serif",
        fontSize: report.hit.crit ? "12px" : "10px",
        color,
      })
      .setOrigin(0.5, 1);
    this.tweens.add({
      targets: t,
      y: t.y - 16,
      alpha: 0,
      duration: 700,
      onComplete: () => {
        t.destroy();
      },
    });
  }

  private updateHazard(): void {
    const cycle = Math.floor(this.time0 / HAZARD.period);
    const t = this.time0 - cycle * HAZARD.period;
    const active = t >= HAZARD.telegraph && t < HAZARD.telegraph + HAZARD.active;
    if (!active || this.hazardResolved === cycle) return;
    const p = this.motion.position;
    if (length({ x: p.x - HAZARD.x, y: p.y - HAZARD.y }) > HAZARD.radius) return;
    // 当たり判定が出ている間に1回だけ判定する。回避の無敵時間なら無効
    this.hazardResolved = cycle;
    if (this.motion.invulnerable) this.hazardAvoided += 1;
    else {
      this.hazardHits += 1;
      const taken = this.playerHealth.takeDamage(5);
      this.fervor.onDamageTaken(taken.toHp + taken.toWard, this.playerHealth.maxHp);
      if (this.playerHealth.dead) this.playerHealth.restoreFull();
    }
  }

  private dps(): number {
    while ((this.recentDamage[0]?.t ?? Infinity) < this.time0 - 5) this.recentDamage.shift();
    return this.recentDamage.reduce((s, d) => s + d.amount, 0) / 5;
  }

  private drawShape(
    g: Phaser.GameObjects.Graphics,
    shape: HitShape,
    origin: Vec2,
    facing: number,
  ): void {
    const ox = toPixels(origin.x);
    const oy = toPixels(origin.y);
    switch (shape.type) {
      case "circle":
        g.fillCircle(ox, oy, shape.radius * PIXELS_PER_METER);
        break;
      case "sector": {
        const half = (shape.angleDeg * Math.PI) / 360;
        g.slice(ox, oy, shape.radius * PIXELS_PER_METER, facing - half, facing + half).fillPath();
        break;
      }
      case "line": {
        const cos = Math.cos(facing);
        const sin = Math.sin(facing);
        const w = shape.width / 2;
        const l = shape.length;
        const pts = [
          { x: -w * -sin, y: -w * cos },
          { x: l * cos - w * -sin, y: l * sin - w * cos },
          { x: l * cos + w * -sin, y: l * sin + w * cos },
          { x: w * -sin, y: w * cos },
        ].map(
          (p) => new Phaser.Math.Vector2(ox + p.x * PIXELS_PER_METER, oy + p.y * PIXELS_PER_METER),
        );
        g.fillPoints(pts, true);
        break;
      }
    }
  }

  private render(): void {
    const p = this.motion.position;
    const x = Math.round(toPixels(p.x));
    const y = Math.round(toPixels(p.y));
    this.body.setPosition(x, y).setAlpha(this.motion.invulnerable ? 0.5 : 1);
    this.facing.setPosition(x, y).setRotation((this.motion.direction8 * Math.PI) / 4);
    const dx0 = Math.round(toPixels(this.dummy.position.x));
    const dy0 = Math.round(toPixels(this.dummy.position.y));
    this.dummyImage.setPosition(dx0, dy0);
    this.dummyFacing.setPosition(dx0, dy0);
    // Phaser 4 では setTintFill が無くなり、setTint ＋ setTintMode で白く光らせる
    if (this.flash > 0) this.dummyImage.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    else if (this.dummy.stagger.broken)
      this.dummyImage.setTint(0xffd166).setTintMode(Phaser.TintModes.MULTIPLY);
    else this.dummyImage.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);

    const g = this.fx.clear();
    const t = this.time0 % HAZARD.period;
    const hx = toPixels(HAZARD.x);
    const hy = toPixels(HAZARD.y);
    const r = HAZARD.radius * PIXELS_PER_METER;
    if (t < HAZARD.telegraph) g.lineStyle(1, 0xff6b6b, 0.4 + t).strokeCircle(hx, hy, r);
    else if (t < HAZARD.telegraph + HAZARD.active) g.fillStyle(0xff6b6b, 0.5).fillCircle(hx, hy, r);
    // 残っている亀裂
    for (const z of this.zones) {
      g.fillStyle(0xff9f43, 0.18);
      for (const part of (z.exec as LingeringZone).parts)
        this.drawShape(g, part.shape, part.origin, part.facing);
    }
    // 技の当たり判定（出た直後の少しの間だけ）
    while ((this.shownStrikes[0]?.t ?? Infinity) < this.time0 - SHOW_STRIKE)
      this.shownStrikes.shift();
    g.fillStyle(0xffffff, 0.22);
    for (const s of this.shownStrikes) this.drawShape(g, s.shape, s.origin, s.facing);
    // 人形のHPと崩しゲージ
    const dx = this.dummyImage.x - 12;
    const dy = this.dummyImage.y - 18;
    g.fillStyle(0x2a2934, 1)
      .fillRect(dx, dy, 24, 3)
      .fillStyle(0xff6b6b, 1)
      .fillRect(dx, dy, Math.round((24 * this.dummy.health.hp) / this.dummy.health.maxHp), 3)
      .fillStyle(0x2a2934, 1)
      .fillRect(dx, dy + 4, 24, 2)
      .fillStyle(0xffd166, 1)
      .fillRect(
        dx,
        dy + 4,
        this.dummy.stagger.broken
          ? 24
          : Math.round((24 * this.dummy.stagger.current) / this.dummy.stagger.max),
        2,
      );

    const bar = (row: number, ratio: number, color: number): void => {
      const by = SCREEN.height - 38 + row * 8;
      this.bars
        .fillStyle(0x2a2934, 1)
        .fillRect(8, by, 100, 5)
        .fillStyle(color, 1)
        .fillRect(8, by, Math.round(100 * Math.max(0, Math.min(1, ratio))), 5);
    };
    this.bars.clear();
    bar(0, this.playerHealth.hp / this.playerHealth.maxHp, 0xff6b6b);
    bar(1, this.mp / MAX_MP, 0x6fa8ff);
    bar(2, this.motion.currentStamina / this.motion.config.maxStamina, 0x7bd389);
    bar(
      3,
      this.fervor.value / this.fervor.max,
      this.fervor.hasStage("empowered") ? 0xff9f43 : 0xb5651d,
    );

    const last = this.lastHit;
    const stageText = this.fervor.def.stages
      .filter((s) => this.fervor.hasStage(s.id))
      .map((s) => text(s.text as TextKey))
      .join("・");
    const slots = LOADOUT.map((l) => {
      const name = this.skillName(l.skill);
      const block = this.blockOf(l.skill);
      const cd = this.cooldowns.remaining(l.skill);
      const state =
        block === undefined
          ? ""
          : block === "cooldown"
            ? `（${cd.toFixed(1)}秒）`
            : block === "mp"
              ? "（MP不足）"
              : block === "gauge"
                ? "（闘志不足）"
                : "（使えない）";
      return `${SLOT_LABEL[l.action] ?? l.action}:${name}${state}`;
    }).join(" ");
    this.hud.setText([
      "試験用の場（WASD移動・マウス照準・スペース回避・Tabで武器を替える）",
      slots,
      `武器：${this.weapon.name}（適性${this.affinity}・攻撃速度 ${this.attackSpeed.toFixed(2)}回/秒）${this.buffs.active.length > 0 ? `・効果：${this.buffs.active.map((b) => `${this.skillName(b.ref)}（${b.remaining.toFixed(1)}秒）`).join("・")}` : ""}`,
      `人形：HP ${this.dummy.health.hp.toFixed(0)}／${this.dummy.health.maxHp.toFixed(0)}・DPS ${this.dps().toFixed(1)}・ヒット ${String(this.hitCount)}${this.dummy.stagger.broken ? "・崩れ" : ""}${this.dummy.statuses.active.length > 0 ? "・威圧" : ""}`,
      last === undefined
        ? "最後のヒット：なし"
        : `最後のヒット：${last.hit.evaded ? "回避された" : `${last.hit.total.toFixed(1)}${last.hit.crit ? "・会心" : ""}${last.backstab ? "・背面" : ""}${last.ailments.length > 0 ? "・出血" : ""}`}${this.lastSkill === undefined ? "" : `（${this.lastSkill.variants.join("・") || "変化なし"}）`}`,
      `危険地帯：被弾 ${String(this.hazardHits)}／回避で無効 ${String(this.hazardAvoided)}`,
      `HP ${this.playerHealth.hp.toFixed(0)}・MP ${this.mp.toFixed(0)}・気力 ${this.motion.currentStamina.toFixed(0)}・闘志 ${this.fervor.value.toFixed(0)}${stageText === "" ? "" : `（${stageText}）`}`,
    ]);
  }
}
