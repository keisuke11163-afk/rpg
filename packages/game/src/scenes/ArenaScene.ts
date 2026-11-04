// 仮実装: U-18a feature/town-and-dungeon-base で、町とダンジョンの地図に置き換える（試験用の場）
import Phaser from "phaser";
import {
  AFFINITY_ATTACK_SPEED,
  Character,
  type Affinity,
  Combatant,
  type ContentDb,
  Cooldowns,
  type DamageAttacker,
  type DamageSkill,
  FixedStepClock,
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
  enemyXp,
  levelGapMultiplier,
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
import { EnemyField } from "../world/EnemyField.ts";
import { TEXTURES } from "../world/placeholders.ts";
import { PIXELS_PER_METER, toMeters, toPixels } from "../world/units.ts";

/** 試験用の場の大きさ（m）。 */
const ARENA = { width: 80, height: 40 };

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
  {
    uid: "test-dagger",
    name: "下級の短剣",
    tags: ["TAG-WPN-DAGGER"],
    base: { physical: { min: 4, max: 9 } },
    critChance: 0.08,
    attackSpeed: 1.6,
  },
  {
    uid: "test-claw",
    name: "下級の爪",
    tags: ["TAG-WPN-CLAW"],
    base: { physical: { min: 5, max: 8 } },
    critChance: 0.06,
    attackSpeed: 1.7,
  },
];
/** ジョブの初期装備の武器（補助仕様書3.4。転職したときに持ち替える）。 */
const START_WEAPON: Readonly<Record<string, string>> = {
  "JOB-WARRIOR": "test-greatsword",
  "JOB-ROGUE": "test-dagger",
};

// 仮実装: U-12 feature/inventory-ui で、技の枠の設定に置き換える（試験用の技の並び。7つ目は R キー）
type Loadout = readonly { readonly action: Action | "rout"; readonly skill: string }[];
const LOADOUTS: Readonly<Record<string, Loadout>> = {
  "JOB-WARRIOR": [
    { action: "skill1", skill: "SKL-BASIC-ATTACK" },
    { action: "skill2", skill: "SKL-WARRIOR-SWEEP" },
    { action: "skill3", skill: "SKL-WARRIOR-CHARGE" },
    { action: "skill4", skill: "SKL-WARRIOR-WARCRY" },
    { action: "skill5", skill: "SKL-WARRIOR-EARTHSPLITTER" },
    { action: "skill6", skill: "SKL-WARRIOR-WHIRLWIND" },
    { action: "rout", skill: "SKL-WARRIOR-ROUT" },
  ],
  "JOB-ROGUE": [
    { action: "skill1", skill: "SKL-BASIC-ATTACK" },
    { action: "skill2", skill: "SKL-ROGUE-FLURRY" },
    { action: "skill3", skill: "SKL-ROGUE-PIERCE" },
    { action: "skill4", skill: "SKL-ROGUE-SHADOWSTEP" },
    { action: "skill5", skill: "SKL-ROGUE-POISON" },
    { action: "skill6", skill: "SKL-ROGUE-SMOKE" },
    { action: "rout", skill: "SKL-ROGUE-TRAP" },
  ],
};
const SLOT_LABEL: Readonly<Record<string, string>> = {
  skill1: "左",
  skill2: "右",
  skill3: "1",
  skill4: "2",
  skill5: "3",
  skill6: "4",
  rout: "R",
};
// 仮実装: U-13 feature/save-load で、セーブデータのキャラクターに置き換える（試験用に、戦士の出自・キャラLv15・戦士のジョブLv15から始める）
const TEST_START = { level: 15, jobLevel: 15 } as const;

/** ヒットの手応え：止まる時間（秒）と、白く光る時間。 */
const HIT_STOP = 0.05;
const FLASH = 0.08;
/** 当たり判定を見せる時間（秒）。 */
const SHOW_STRIKE = 0.12;
/** 吸い寄せたとき、これより近くには寄せない（m）。 */
const PULL_MIN_DISTANCE = 1;
/** 一定時間の効果を必ず付け直す間隔に、少しだけ余裕を持たせる（煙の中の敵の命中-30%）。 */
const ZONE_REFRESH = 0.1;

/** 技の実行と、当たった敵の記録（group ごと）。 */
interface Running {
  readonly exec: SkillExecution | LingeringZone;
  readonly hit: Map<string, Set<string>>;
  /** 1回の使用で1体以上に当たったときのゲージ（コンボ点）を、もう得たか。 */
  gained?: boolean;
}

/** 置いた煙玉。 */
interface SmokeZone {
  readonly skill: string;
  readonly center: Vec2;
  readonly radius: number;
  readonly interval: number;
  readonly enemyEffects: readonly string[];
  readonly ailment: string | undefined;
  remaining: number;
  untilNext: number;
}

/** 置いた罠。起爆したときの能力値で計算する（仕様書v0.2 5.6）。 */
interface Trap {
  readonly skill: ResolvedSkill;
  readonly center: Vec2;
  readonly radius: number;
  remaining: number;
}

export class ArenaScene extends Phaser.Scene {
  private db!: ContentDb;
  private tags!: TagIndex;
  private character!: Character;
  private motion!: PlayerMotion;
  private controls!: InputSystem;
  private readonly clock = new FixedStepClock();
  private readonly rng = Rng.fromSeed("arena");
  private weaponIndex = 0;
  private attacker!: DamageAttacker;
  private attackerVersion = "";
  private attackSpeed = 1;
  /** プレイヤーの戦う者（HP・状態異常・崩し。敵の攻撃を受ける）。 */
  private player!: Combatant;
  private field!: EnemyField;
  private hitsTaken = 0;
  private avoidedAttacks = 0;
  private deaths = 0;
  private enemyHits = 0;
  private mp = 60;
  private maxMp = 60;
  private effectDuration = 1;
  private smokes: SmokeZone[] = [];
  private traps: Trap[] = [];
  private keyJob!: Phaser.Input.Keyboard.Key;
  private jobPressed = false;
  private levelUps = 0;
  private jobGauge!: JobGauge;
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

  private get job(): JobDef {
    const j = this.db.jobs.get(this.character.mainJob);
    if (j === undefined) throw new Error(`ジョブ ${this.character.mainJob} がない`);
    return j;
  }

  private get loadout(): Loadout {
    return LOADOUTS[this.job.id] ?? [];
  }

  private get affinity(): Affinity {
    return weaponAffinity(this.tags, this.job, this.weapon.tags);
  }

  create(): void {
    this.db = loadGameContent();
    this.tags = new TagIndex(this.db.tags);
    const origin = this.db.jobs.get("JOB-WARRIOR");
    if (origin === undefined) throw new Error("戦士のデータがない");
    this.character = new Character({
      origin,
      level: TEST_START.level,
      jobLevels: { [origin.id]: TEST_START.jobLevel },
    });
    this.jobGauge = this.newGauge();

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
    this.refreshAttacker();
    this.player = this.newPlayer();
    this.mp = this.maxMp;
    this.field = new EnemyField(this, this.db, this.rng.fork("enemies"), {
      minX: 0.5,
      minY: 0.5,
      maxX: ARENA.width - 0.5,
      maxY: ARENA.height - 0.5,
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
    // 仮実装: U-18a feature/town-and-dungeon-base で、町の転職神殿に置き換える（G で転職。キャラLv15から）
    this.keyJob = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.G, true);
    this.keyJob.on("down", () => (this.jobPressed = true));

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
      setFervor: (value?: number | string) => {
        this.jobGauge.spend("all");
        this.jobGauge.add(Number(value ?? 0));
        this.jobGauge.markCombat();
        return this.jobGauge.value;
      },
      enemies: () => this.field.debug(),
      // 確認用：経験値を得る（開発版だけ）
      grantXp: (value?: number | string) => {
        this.gainXp(Number(value ?? 0));
        return this.character.level;
      },
      playerState: () => ({
        hp: this.player.health.hp,
        maxHp: this.player.health.maxHp,
        hitsTaken: this.hitsTaken,
        avoided: this.avoidedAttacks,
        deaths: this.deaths,
        staggered: this.player.stagger.broken,
        poison: this.player.ailments.stacks("AIL-POISON"),
        enemyHits: this.enemyHits,
        kills: this.field.kills,
      }),
      // 確認用：プレイヤーの右3mに敵を出す（開発版だけ）
      spawnEnemy: (id?: number | string) => {
        const p = this.motion.position;
        return this.field.spawn(
          String(id),
          "normal",
          5,
          { x: p.x + 3, y: p.y },
          `debug-${String(id)}`,
        ).id;
      },
      skills: () => ({
        weapon: this.weapon.uid,
        affinity: this.affinity,
        attackSpeed: this.attackSpeed,
        mp: this.mp,
        fervor: this.jobGauge.value,
        stages: this.jobGauge.stages,
        executing: this.current?.slot ?? null,
        lastSkill: this.lastSkill?.id ?? null,
        lastVariants: this.lastSkill?.variants ?? [],
        uses: Object.fromEntries(this.uses),
        buffs: this.buffs.active.map((b) => b.effectId),
        cooldowns: Object.fromEntries(
          this.loadout.map((l) => [l.skill, this.cooldowns.remaining(l.skill)]),
        ),
        job: this.job.id,
        jobLevel: this.character.jobLevel(this.job.id),
        jobLevels: Object.fromEntries(
          [...this.db.jobs.keys()].map((j) => [j, this.character.jobLevel(j)]),
        ),
        level: this.character.level,
        xp: this.character.progress.xp,
        traps: this.traps.length,
        smokes: this.smokes.length,
      }),
    });
    document.body.dataset["stellaReady"] = "true";
  }

  /** プレイヤーの戦う者（最大HPは、能力値の評価の値）。 */
  private newPlayer(): Combatant {
    return new Combatant(this.db, {
      id: "player",
      team: "player",
      position: this.motion.position,
      radius: 0.35,
      maxHp: this.attacker.view.stat("STAT-HP-MAX").value,
      staggerProfile: staggerProfiles(this.db).player,
    });
  }

  /** メインジョブの職能ゲージ（メインジョブのものだけが有効。仕様書5章）。 */
  private newGauge(): JobGauge {
    const g = this.db.gauges.get(this.job.gauge ?? "");
    if (g === undefined) throw new Error(`ジョブ ${this.job.id} の職能ゲージがない`);
    return new JobGauge(g);
  }

  /** 経験値を得る。Lvが上がったら、HPを全回復する（最大HPが変わるため）。 */
  private gainXp(amount: number): void {
    const before = this.character.level;
    const r = this.character.gainXp(amount);
    if (r.characterLevels > 0 || r.jobLevels > 0) {
      this.levelUps += r.characterLevels + r.jobLevels;
      this.attackerVersion = "";
      this.refreshAttacker();
      if (this.character.level !== before) this.player = this.newPlayer();
      this.popText(
        `${r.characterLevels > 0 ? `Lv${String(this.character.level)}` : ""}${r.jobLevels > 0 ? ` ジョブLv${String(this.character.jobLevel(this.job.id))}` : ""}`,
        this.motion.position,
        "#7bd389",
      );
    }
  }

  /** 転職する（戦士と盗賊を順に替える）。武器はジョブの初期装備に持ち替える。 */
  private changeJob(): void {
    if (this.current !== undefined || !this.character.canChangeJob) return;
    const jobs = [...this.db.jobs.keys()];
    const next = jobs[(jobs.indexOf(this.job.id) + 1) % jobs.length];
    if (next === undefined || !this.character.changeJob(next)) return;
    const w = TEST_WEAPONS.findIndex((x) => x.uid === START_WEAPON[next]);
    if (w >= 0) this.weaponIndex = w;
    this.jobGauge = this.newGauge();
    this.attackerVersion = "";
    this.refreshAttacker();
  }

  /** 効果（戦吼の強化など）が変わったら、攻撃する側の能力値を計算し直す。 */
  private refreshAttacker(): void {
    const version = `${String(this.buffs.version)}|${String(this.character.level)}|${this.job.id}|${this.weapon.uid}`;
    if (this.attackerVersion === version) return;
    this.attackerVersion = version;
    const { view } = evaluateEffects(
      this.db,
      this.tags,
      [...this.buffs.instances(), ...this.character.attributeEffects()],
      {
        baseStats: this.character.baseStats(),
        equippedTags: { mainHand: this.weapon.tags },
        mainJob: this.job.tag,
      },
    );
    const w = this.weapon;
    this.maxMp = view.stat("STAT-MP-MAX").value;
    this.mp = Math.min(this.mp, this.maxMp);
    this.effectDuration = 1 + view.stat("STAT-EFFECT-DURATION").increased;
    this.attacker = {
      db: this.db,
      view,
      characterLevel: this.character.level,
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
    this.refreshAttacker();
  }

  /** 技の枠を押しているか（押し続けで繰り返し使う。補助仕様書1.1）。 */
  private wants(slot: string, held: ReadonlySet<Action>, pressed: ReadonlySet<Action>): boolean {
    if (slot === "rout") return this.routPressed || this.keyRout.isDown;
    return held.has(slot as Action) || pressed.has(slot as Action);
  }

  private blockOf(skillId: string): SkillBlock | "locked" | "target" | undefined {
    if (
      skillId !== "SKL-BASIC-ATTACK" &&
      !unlockedSkills(this.job, this.character.jobLevel(this.job.id)).includes(skillId)
    )
      return "locked";
    const def = this.db.skills.get(skillId);
    if (def === undefined) return "locked";
    // 影走りは、対象（照準の近くの敵）がいなければ使えない（補助仕様書3.6）
    if (def.action.type === "teleport" && this.stepTarget(def.action.range) === undefined)
      return "target";
    return skillBlock(def, {
      cooldown: this.cooldowns.remaining(skillId),
      mp: this.mp,
      gauge: this.jobGauge.value,
      affinity: this.affinity,
    });
  }

  /** 影走りの対象：自分から range 以内の敵のうち、照準の位置に最も近いもの。 */
  private stepTarget(range: number): Combatant | undefined {
    const p = this.motion.position;
    const aim = this.aimPoint;
    let best: Combatant | undefined;
    let bestD = Infinity;
    for (const t of this.targets()) {
      if (length({ x: t.position.x - p.x, y: t.position.y - p.y }) > range + t.radius) continue;
      const d = length({ x: t.position.x - aim.x, y: t.position.y - aim.y });
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  /** 敵の背後の位置（向きを持たない敵は、自分から見て反対側）。 */
  private behind(t: Combatant, gap: number): Vec2 {
    const p = this.motion.position;
    const away =
      t.facing === undefined
        ? Math.atan2(t.position.y - p.y, t.position.x - p.x)
        : t.facing + Math.PI;
    const d = t.radius + this.player.radius + gap;
    return { x: t.position.x + Math.cos(away) * d, y: t.position.y + Math.sin(away) * d };
  }

  private aimPoint: Vec2 = { x: 0, y: 0 };

  private startSkill(slot: string, skillId: string): void {
    const def = this.db.skills.get(skillId);
    if (def === undefined) return;
    // 終結技は、使う前のゲージの量で強さが決まる
    const cost = def.gauge?.cost;
    const spent = cost === "all" ? this.jobGauge.value : (cost ?? 0);
    const resolved: ResolvedSkill = resolveSkill(this.db, def, {
      stages: this.jobGauge.stages,
      weaponTags: this.tags.closure(this.weapon.tags),
      gaugeSpent: spent,
    });
    let teleportTo: Vec2 | undefined;
    if (def.action.type === "teleport") {
      const t = this.stepTarget(def.action.range);
      if (t === undefined) return;
      teleportTo = this.behind(t, def.action.behind);
    }
    this.mp -= def.mpCost;
    this.cooldowns.start(def.id, def.cooldown);
    if (def.gauge?.cost !== undefined) this.jobGauge.spend(def.gauge.cost);
    if (def.gauge?.gainOnUse !== undefined) this.jobGauge.add(def.gauge.gainOnUse);
    this.jobGauge.markCombat();
    for (const e of def.selfEffects ?? [])
      this.buffs.add(e.effect, e.duration * this.effectDuration, def.id);
    this.lastSkill = { id: def.id, variants: resolved.variants };
    this.uses.set(def.id, (this.uses.get(def.id) ?? 0) + 1);
    this.current = {
      slot,
      run: {
        exec: new SkillExecution(resolved, this.motion.facing, this.attackSpeed, {
          aimPoint: this.aimPoint,
          ...(teleportTo === undefined ? {} : { teleportTo }),
        }),
        hit: new Map(),
      },
    };
  }

  override update(_time: number, deltaMs: number): void {
    const frame = this.controls.read();
    if (this.tabPressed) this.switchWeapon();
    this.tabPressed = false;
    if (this.jobPressed) this.changeJob();
    this.jobPressed = false;
    this.aimPoint = { x: toMeters(frame.pointerWorld.x), y: toMeters(frame.pointerWorld.y) };
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
      // よろめいている間は、移動・技・回避ができない（補助仕様書3.3）
      const staggered = this.player.stagger.broken;
      if (staggered) this.current = undefined;
      const dodge = pressed.has("dodge") && !staggered;
      if (dodge) this.current = undefined; // 回避で技を取り消せる

      // 技を使い始める（照準の方向へ）。枠の順に、使えるものを1つ
      if (this.current === undefined && !this.motion.dodging && !dodge && !staggered) {
        this.motion.update(0, { move: ZERO, aim, dodge: false }); // 向きだけ照準に合わせる
        for (const l of this.loadout) {
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
          for (const e of w.allyEffects)
            this.buffs.add(e, w.duration * this.effectDuration, exec.skill.def.id);
          for (const t of this.targets()) {
            if (
              length({ x: t.position.x - w.origin.x, y: t.position.y - w.origin.y }) >
              w.radius + t.radius
            )
              continue;
            for (const e of w.enemyEffects) t.statuses.add(e, w.duration, exec.skill.def.id);
          }
          this.showShape({ type: "circle", radius: w.radius }, w.origin, 0);
        }
        if (tick.pull !== undefined) {
          const p = tick.pull;
          for (const t of this.targets()) {
            const d = t.position;
            const movable = this.field.byCombatant(t)?.def.moveSpeed !== 0;
            if (
              !t.isBoss &&
              movable &&
              length({ x: d.x - p.origin.x, y: d.y - p.origin.y }) <= p.radius
            )
              t.position = pullTowards(d, p.origin, p.speed * dt, PULL_MIN_DISTANCE);
          }
        }
        for (const z of tick.zones) this.zones.push({ exec: z, hit: new Map() });
        if (tick.selfBuff !== undefined) {
          for (const e of tick.selfBuff.effects)
            this.buffs.add(e, tick.selfBuff.duration * this.effectDuration, exec.skill.def.id);
        }
        if (tick.zone !== undefined) {
          const z = tick.zone;
          this.smokes.push({
            skill: exec.skill.def.id,
            center: z.center,
            radius: z.radius,
            interval: z.interval,
            enemyEffects: z.enemyEffects,
            ailment: z.ailment,
            remaining: z.duration,
            untilNext: 0,
          });
        }
        if (tick.trap !== undefined) {
          const t = tick.trap;
          this.traps.push({
            skill: exec.skill,
            center: t.center,
            radius: t.radius,
            remaining: t.duration,
          });
          // 同時に置ける数を超えたら、古いものから消える
          while (this.traps.length > t.max) this.traps.shift();
        }
        moveMultiplier = tick.moveMultiplier;
        if (tick.finished) this.current = undefined;
      }
      for (const z of this.zones) this.resolveStrikes(z, (z.exec as LingeringZone).update(dt));
      this.updateSmokes(dt);
      this.updateTraps(dt);
      this.zones = this.zones.filter((z) => !(z.exec as LingeringZone).done);

      this.motion.update(dt, {
        move: staggered ? ZERO : frame.move,
        aim: this.current === undefined && !staggered ? aim : ZERO,
        dodge,
        speedMultiplier: moveMultiplier,
      });
      this.player.position = this.motion.position;
      this.player.moving = length(frame.move) > 0 && !staggered;

      // 敵の行動と攻撃
      this.field.update(dt, this.player, this.motion.invulnerable, this.motion.facing, {
        onPlayerHit: (report) => {
          if (report.hit.evaded) return;
          this.hitsTaken += 1;
          this.jobGauge.onDamageTaken(
            report.applied.toHp + report.applied.toWard,
            this.player.health.maxHp,
          );
        },
        onAvoided: () => {
          this.avoidedAttacks += 1;
        },
        onEnemyKilled: (enemy) => {
          // 経験値（補助仕様書4.2）：5＋2×敵のLv、格の倍率、Lvの差の補正
          this.gainXp(
            enemyXp(enemy.level, enemy.rank.xpMultiplier) *
              levelGapMultiplier(this.character.level, enemy.level),
          );
        },
      });

      const dot = this.dummy.update(dt);
      if (dot > 0) this.recentDamage.push({ t: this.time0, amount: dot });
      const playerDot = this.player.update(dt);
      if (playerDot > 0) this.jobGauge.onDamageTaken(playerDot, this.player.health.maxHp);
      // 仮実装: U-18b feature/death-and-return で、死亡の扱い（町に戻る）に置き換える（試験用の場では、その場で全回復する）
      if (this.player.health.dead) {
        this.deaths += 1;
        this.player = this.newPlayer();
      }
      this.mp = Math.min(this.maxMp, this.mp + this.maxMp * 0.06 * dt);
      this.cooldowns.update(dt);
      this.buffs.update(dt);
      this.jobGauge.update(dt);
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
      for (const t of this.targets()) {
        if (!overlapsShape(s.shape, s.origin, s.facing, t.position, t.radius)) continue;
        if (s.group !== undefined) {
          const set = run.hit.get(s.group) ?? new Set<string>();
          if (set.has(t.id)) continue;
          set.add(t.id);
          run.hit.set(s.group, set);
        }
        if (this.hitTarget(t, s.skill, s.damage, s.origin, s.fullStagger, s.forceCrit === true))
          landed = true;
      }
    }
    const first = strikes[0];
    if (!landed || first === undefined) return;
    // 闘志：1回の当たり判定の発生で、当たれば1回増える（docs/progress D-U08-3）
    this.jobGauge.onHitDealt(this.tags.closure(first.skill.damage.tags));
    // コンボ点：1回の使用で、1体以上に当たれば1回だけ増える（docs/progress D-U10-1）
    const gain = first.skill.def.gauge?.gainOnHit;
    if (gain !== undefined && run.gained !== true) {
      run.gained = true;
      this.jobGauge.add(gain);
    }
  }

  /** 1体にヒットを解決する。当たれば true。 */
  private hitTarget(
    t: Combatant,
    skill: ResolvedSkill,
    damage: DamageSkill,
    origin: Vec2,
    fullStagger: boolean,
    forceCrit: boolean,
  ): boolean {
    const bonus = this.job.backstabBonus;
    const report = resolveHit({
      db: this.db,
      attacker: this.attacker,
      attackerPosition: origin,
      skill: damage,
      skillChance: skill.ailmentChance,
      staggerCoefficient: skill.staggerCoefficient,
      target: t,
      rng: this.rng,
      fullStagger,
      forceCrit,
      ...(bonus === undefined ? {} : { backstabBonus: bonus }),
    });
    if (t !== this.dummy) this.field.onEnemyHit(t);
    if (t === this.dummy) this.lastHit = report;
    if (report.hit.evaded) return false;
    this.hitStop = HIT_STOP;
    if (t === this.dummy) {
      this.hitCount += 1;
      this.recentDamage.push({ t: this.time0, amount: report.hit.total });
      this.flash = FLASH;
    } else this.enemyHits += 1;
    if (report.hit.crit || report.staggerBroke) this.cameras.main.shake(80, 0.004);
    this.popDamage(report, t.position);
    return true;
  }

  /** 煙玉：中の敵に命中-30%をかけ続け、間隔ごとに衰弱を必ず付ける（仕様書v0.2 5.6）。 */
  private updateSmokes(dt: number): void {
    for (const z of this.smokes) {
      z.remaining -= dt;
      z.untilNext -= dt;
      const pulse = z.untilNext <= 1e-9;
      if (pulse) z.untilNext += z.interval;
      const def = z.ailment === undefined ? undefined : this.db.ailmentsByTag.get(z.ailment);
      for (const t of this.targets()) {
        if (
          length({ x: t.position.x - z.center.x, y: t.position.y - z.center.y }) >
          z.radius + t.radius
        )
          continue;
        for (const e of z.enemyEffects) t.statuses.add(e, dt + ZONE_REFRESH, z.skill);
        if (pulse && def !== undefined && (def.kind === "debuff" || def.kind === "dot")) {
          t.ailments.apply({
            ailmentId: def.id,
            tag: def.tag,
            total: 0,
            duration: def.duration,
            maxStacks: 1,
          });
          if (t !== this.dummy) this.field.onEnemyHit(t);
        }
      }
    }
    this.smokes = this.smokes.filter((z) => z.remaining > 1e-9);
  }

  /** 罠：敵が踏むと起爆する（起爆したときの能力値で計算する。主手の武器のヒット）。 */
  private updateTraps(dt: number): void {
    const left: Trap[] = [];
    for (const trap of this.traps) {
      trap.remaining -= dt;
      const victim = this.targets().find(
        (t) =>
          length({ x: t.position.x - trap.center.x, y: t.position.y - trap.center.y }) <=
          trap.radius + t.radius,
      );
      if (victim !== undefined) {
        this.showShape({ type: "circle", radius: trap.radius }, trap.center, 0);
        this.hitTarget(victim, trap.skill, trap.skill.damage, trap.center, false, false);
        continue;
      }
      if (trap.remaining > 1e-9) left.push(trap);
    }
    this.traps = left;
  }

  private popText(label: string, at: Vec2, color: string): void {
    const t = this.add
      .text(toPixels(at.x), toPixels(at.y) - 24, label, {
        fontFamily: "sans-serif",
        fontSize: "11px",
        color,
      })
      .setOrigin(0.5, 1);
    this.tweens.add({
      targets: t,
      y: t.y - 20,
      alpha: 0,
      duration: 1200,
      onComplete: () => {
        t.destroy();
      },
    });
  }

  private skillName(id: string): string {
    const def = this.db.skills.get(id);
    return def === undefined ? id : text(def.text as TextKey);
  }

  private showShape(shape: HitShape, origin: Vec2, facing: number): void {
    this.shownStrikes.push({ shape, origin, facing, t: this.time0 });
  }

  /** プレイヤーの技の対象（訓練用の人形と、生きている敵）。 */
  private targets(): Combatant[] {
    return [this.dummy, ...this.field.targets()];
  }

  private popDamage(report: HitReport, at: Vec2): void {
    const color = report.hit.crit ? "#ffd166" : report.backstab ? "#c3a6ff" : "#ffffff";
    const label = `${report.hit.total.toFixed(0)}${report.hit.crit ? "!" : ""}${report.backstab ? "（背面）" : ""}${report.staggerBroke ? "（崩し）" : ""}`;
    const t = this.add
      .text(toPixels(at.x), toPixels(at.y) - 18, label, {
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
      const taken = this.player.health.takeDamage(5);
      this.jobGauge.onDamageTaken(taken.toHp + taken.toWard, this.player.health.maxHp);
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
    // 敵：予兆・雲・体・HP
    this.field.render(g, (shape, origin, facing) => {
      this.drawShape(g, shape, origin, facing);
    });
    // 煙玉と罠
    for (const z of this.smokes)
      g.fillStyle(0x8c88a0, 0.25).fillCircle(
        toPixels(z.center.x),
        toPixels(z.center.y),
        z.radius * PIXELS_PER_METER,
      );
    for (const t of this.traps)
      g.lineStyle(1, 0xffd166, 0.9).strokeCircle(
        toPixels(t.center.x),
        toPixels(t.center.y),
        t.radius * PIXELS_PER_METER,
      );
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
    bar(0, this.player.health.hp / this.player.health.maxHp, 0xff6b6b);
    bar(1, this.mp / this.maxMp, 0x6fa8ff);
    bar(2, this.motion.currentStamina / this.motion.config.maxStamina, 0x7bd389);
    bar(
      3,
      this.jobGauge.value / this.jobGauge.max,
      this.jobGauge.hasStage("empowered") ? 0xff9f43 : 0xb5651d,
    );

    const last = this.lastHit;
    const stageText = this.jobGauge.def.stages
      .filter((s) => this.jobGauge.hasStage(s.id))
      .map((s) => text(s.text as TextKey))
      .join("・");
    const gaugeName = text(this.jobGauge.def.text as TextKey);
    const c = this.character;
    const slots = this.loadout
      .map((l) => {
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
                  ? `（${gaugeName}不足）`
                  : block === "target"
                    ? "（対象なし）"
                    : block === "locked"
                      ? "（未習得）"
                      : "（使えない）";
        return `${SLOT_LABEL[l.action] ?? l.action}:${name}${state}`;
      })
      .join(" ");
    this.hud.setText([
      "試験用の場（WASD移動・マウス照準・スペース回避・Tabで武器を替える・Gで転職）",
      `Lv${String(c.level)}（経験値 ${c.progress.xp.toFixed(0)}／${String(c.progress.toNext)}）・${text(this.job.text as TextKey)} ジョブLv${String(c.jobLevel(this.job.id))}（${c.jobTrack(this.job.id).xp.toFixed(0)}／${String(c.jobTrack(this.job.id).toNext)}）${c.catchingUp ? "・追いつき補正×2" : ""}`,
      slots,
      `武器：${this.weapon.name}（適性${this.affinity}・攻撃速度 ${this.attackSpeed.toFixed(2)}回/秒）${this.buffs.active.length > 0 ? `・効果：${this.buffs.active.map((b) => `${this.skillName(b.ref)}（${b.remaining.toFixed(1)}秒）`).join("・")}` : ""}`,
      `人形：HP ${this.dummy.health.hp.toFixed(0)}／${this.dummy.health.maxHp.toFixed(0)}・DPS ${this.dps().toFixed(1)}・ヒット ${String(this.hitCount)}${this.dummy.stagger.broken ? "・崩れ" : ""}${this.dummy.statuses.active.length > 0 ? "・威圧" : ""}`,
      last === undefined
        ? "最後のヒット：なし"
        : `最後のヒット：${last.hit.evaded ? "回避された" : `${last.hit.total.toFixed(1)}${last.hit.crit ? "・会心" : ""}${last.backstab ? "・背面" : ""}${last.ailments.length > 0 ? "・出血" : ""}`}${this.lastSkill === undefined ? "" : `（${this.lastSkill.variants.join("・") || "変化なし"}）`}`,
      `危険地帯：被弾 ${String(this.hazardHits)}／回避で無効 ${String(this.hazardAvoided)}`,
      `敵：倒した数 ${String(this.field.kills)}・被弾 ${String(this.hitsTaken)}・回避で無効 ${String(this.avoidedAttacks)}・倒れた回数 ${String(this.deaths)}${this.player.ailments.stacks("AIL-POISON") > 0 ? `・毒 ${String(this.player.ailments.stacks("AIL-POISON"))}` : ""}${this.player.stagger.broken ? "・よろめき" : ""}`,
      `HP ${this.player.health.hp.toFixed(0)}・MP ${this.mp.toFixed(0)}・気力 ${this.motion.currentStamina.toFixed(0)}・${gaugeName} ${this.jobGauge.value.toFixed(0)}${stageText === "" ? "" : `（${stageText}）`}`,
    ]);
  }
}
