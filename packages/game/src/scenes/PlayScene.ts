import Phaser from "phaser";
import { BrowserStorage } from "../save/browserStorage.ts";
import {
  AttackRunner,
  AutoSaver,
  ConditionRegistry,
  FACILITIES,
  applyLoadout,
  captureLoadout,
  loadoutsReferencing,
  putLoadout,
  removeFromLoadouts,
  type Loadout,
  type LoadoutHost,
  ABYSS_TREE_DROP,
  MOTHER_TREE_DROP,
  TOKEN_EXCHANGE_COST,
  exchangeTokens,
  rollBossDrops,
  QuestLog,
  performSummon,
  starPointTotal,
  type Rect,
  sellPrice,
  FILL_VALUE,
  Flask,
  Merchant,
  TOWN_ID,
  World,
  createCombatant,
  facilityUnlocked,
  resolveWalls,
  type Combatant,
  type FacilityId,
  type MapDef,
  MATERIAL,
  awaken,
  carve,
  disassemble,
  disassembleYield,
  enhance,
  eyeOpen,
  inscribe,
  offerInscriptions,
  reroll,
  seal,
  tune,
  type Inscription,
  DiscoveryTracker,
  activeLatents,
  boardFlags,
  equippedUniqueEffects,
  isBackHit,
  JobBoard,
  applyGaugeHooks,
  doubleNearStart,
  StarBoard,
  TagRegistry,
  buildBoardContext,
  evaluate,
  type BoardEvaluation,
  Equipment,
  Progression,
  SaveManager,
  createStandardJobs,
  fromSave,
  newGameState,
  toSave,
  GroundEffects,
  computeGear,
  type ItemInstance,
  GroundLoot,
  ItemBag,
  Purse,
  rollDrops,
  type DropSource,
  type GroundEntry,
  ROGUE_JOB,
  WARRIOR_JOB,
  createFighter,
  tickCombatant,
  type JobDef,
  FixedStepper,
  type Fighter,
  PLAYER,
  ProjectilePool,
  TICK_SECONDS,
  PoisonTrail,
  alertPack,
  basicAttackTiming,
  canBeHit,
  createPlayer,
  createRng,
  enemyAccuracy,
  facing8,
  isDodging,
  moveVector,
  pressedActions,
  stepEnemies,
  stepPlayer,
  strike,
  type Enemy,
  type EnemyEvent,
  type HitShape,
  type HitSpec,
} from "@stella/core";
import {
  ALL_MAPS,
  QUESTS,
  BOARD_DATA,
  TOWN_FACILITY_POS,
  CRAFT_DATA,
  UNIQUE_DATA,
  UNIQUES,
  JOB_BOARDS,
  STAR_START_OF_JOB,
  GEAR_DATA,
  GENERATION_DATA,
  TAG_DATA,
  enemyDef,
  itemBase,
} from "@stella/content";
import {
  characterText,
  describeStarNode,
  entryLabel,
  inventoryEntries,
  tooltipText,
} from "../ui/panels.ts";
import { SCREEN } from "../config.ts";

/** 1m = 16ピクセル */
const M = SCREEN.tileSize;

const ENEMY_COLORS: Record<string, number> = {
  "ENM-FOREST-WOLF": 0x8a8f99,
  "ENM-THORN-RAT": 0x9b7a55,
  "ENM-SPIT-LIZARD": 0x6f9b55,
  "ENM-FANG-BOAR": 0x8a4f4f,
  "ENM-BARK-BEAR": 0x6b4a33,
  "ENM-ROT-SPROUT": 0x7b5a8a,
};

interface EnemyView {
  enemy: Enemy;
  body: Phaser.GameObjects.Rectangle;
  facing: Phaser.GameObjects.Rectangle;
  hp: Phaser.GameObjects.Rectangle;
}

interface Cloud {
  x: number;
  y: number;
  radius: number;
  left: number;
  damage: number;
  gfx: Phaser.GameObjects.Arc;
  tick: number;
}

/**
 * 試験用の小さな地図（U-09）。仮素材（図形）の戦士で、第1章の敵と戦う。
 * 仮実装: U-18a feature/town-and-dungeon-base の固定マップとランダムな配置で置き換える。
 */
export class PlayScene extends Phaser.Scene {
  private readonly pressed = new Set<string>();
  /** このフレームに押された入力。短く押して離しても、1回は処理に届くようにする */
  private readonly justPressed = new Set<string>();
  private readonly stepper = new FixedStepper();
  private readonly player = createPlayer({ x: 0, y: 0 });
  private body!: Phaser.GameObjects.Rectangle;
  private arrow!: Phaser.GameObjects.Triangle;
  private hud!: Phaser.GameObjects.Text;
  private dodgePressedOnce = false;
  private readonly rng = createRng("play-scene");
  private attack: AttackRunner | undefined;
  private attackAngle = 0;
  private swing!: Phaser.GameObjects.Graphics;
  private warn!: Phaser.GameObjects.Graphics;
  private hitStopLeft = 0;
  /** 技の使用の動作が終わる時刻（ミリ秒）。動作中は次の技を出せない */
  private busyUntil = 0;
  private readonly enemies: Enemy[] = [];
  private readonly poisonTrail = new PoisonTrail();
  private trailGfx?: Phaser.GameObjects.Graphics;
  private readonly world = new World(ALL_MAPS, enemyDef, "MAP-A1");
  private mapDef: MapDef = ALL_MAPS[0] as MapDef;
  /** 今の地域の壁（隠し部屋の扉は、茂みを調べると消える） */
  private walls: Rect[] = [];
  private doorObj: Phaser.GameObjects.Rectangle | undefined;
  private readonly quests = new QuestLog(QUESTS);
  private explorationPoints = 0;
  /** 開発用に足したポイント（P キー） */
  private devPoints = 0;
  /** 今の場所の背景・壁・施設などの表示物。場所を移るたびに作り直す */
  private locationObjs: Phaser.GameObjects.GameObject[] = [];
  private readonly hpFlask = new Flask("hp");
  private readonly mpFlask = new Flask("mp");
  private readonly stash = new ItemBag(120);
  private readonly merchant = new Merchant();
  /** 町の訓練用の人形 */
  private townDummy: Combatant | undefined;
  private lastHitBy = "不明";
  private containerViews = new Map<string, Phaser.GameObjects.Rectangle>();
  private listMode: "buy" | "sell" = "buy";
  private readonly views: EnemyView[] = [];
  private readonly clouds: Cloud[] = [];
  private readonly projectiles = new ProjectilePool();
  private readonly projectileGfx = new Map<object, Phaser.GameObjects.Arc>();
  private readonly telegraphs = new Map<
    Enemy,
    { shape: HitShape; angle: number; at?: { pos: { x: number; y: number }; radius: number }[] }
  >();
  private bossTokens: Record<string, number> = {};
  private loadouts: Loadout[] = [];
  private activeLoadout = 1;
  private pendingDisassemble: string | undefined;
  private bossBar!: Phaser.GameObjects.Graphics;
  private bossLabel!: Phaser.GameObjects.Text;
  /** 今のジョブ。K キーで戦士と盗賊を切り替える（開発用。本番の転職は U-18a の転職神殿） */
  private job: JobDef = WARRIOR_JOB;
  private fighter: Fighter = PlayScene.makeFighter(WARRIOR_JOB);
  private readonly ground = new GroundEffects();
  private readonly loot = new GroundLoot();
  private readonly bag = new ItemBag();
  private readonly purse = new Purse();
  private readonly equipment = new Equipment();
  private board = new StarBoard(BOARD_DATA, "STAR-GOU-START");
  /** 職紋盤（ジョブごとに別。配置はジョブごとに残る） */
  private jobBoards = new Map<string, JobBoard>();
  private jobPoints = 0;
  /** 潜在効果の発見（「？？？」の解放）。セーブの discoveries に保存する */
  private readonly discoveries = new DiscoveryTracker();
  private smithLog = "";
  private inscriptionOffer: Inscription[] = [];
  private notice = "";
  private noticeLeft = 0;
  private lastPos = { x: 0, y: 0 };
  private uniqueCursor = 0;
  private jobBoardEval: BoardEvaluation = {
    active: [],
    dormant: [],
    effects: [],
    completedConstellations: [],
    regionCount: 0,
  };
  /** 星辰盤のポイント（キャラLv 2〜20で19。開発用に P キーで+5） */
  private starPoints = 0;
  private boardEval: BoardEvaluation = {
    active: [],
    dormant: [],
    effects: [],
    completedConstellations: [],
    regionCount: 0,
  };
  private readonly tagRegistry = new TagRegistry(TAG_DATA);
  private readonly tagName = new Map(TAG_DATA.map((t) => [t.id, t.name]));
  private readonly tagIdByName = new Map(TAG_DATA.map((t) => [t.name, t.id]));
  private boardGfx!: Phaser.GameObjects.Graphics;
  private readonly saves = new SaveManager(new BrowserStorage());
  private readonly autoSaver = new AutoSaver();
  private readonly jobRegistry = createStandardJobs();
  private savedNote = "";
  private progression = new Progression(createStandardJobs(), "JOB-WARRIOR");
  private slot = 1;
  /** 開いている画面（I：持ち物、C：キャラクター） */
  private panel:
    | "none"
    | "inventory"
    | "character"
    | "star"
    | "job"
    | "smith"
    | "merchant"
    | "stash"
    | "teleport"
    | "temple"
    | "altar"
    | "loadout" = "none";
  private panelCursor = 0;
  private panelText!: Phaser.GameObjects.Text;
  private panelTip!: Phaser.GameObjects.Text;
  private panelBg!: Phaser.GameObjects.Rectangle;
  private itemSerial = 0;
  private readonly dropped = new Set<Enemy>();
  private readonly lootLabels = new Map<GroundEntry, Phaser.GameObjects.Text>();
  private groundLayer!: Phaser.GameObjects.Graphics;
  /** 技の枠と行動の対応（補助仕様書 1.1）。6つ目の枠は、試験用に R に置く */
  private static readonly SLOT_ACTIONS = ["skill2", "skill3", "skill4", "skill5", "skill6", "KeyR"];

  /** HP・MPはLv1の基礎値（U-10 の経験値とLvで置き換える）。ジョブLv12（全技を使える試験用） */
  private static makeFighter(job: JobDef): Fighter {
    return createFighter(job, {
      maxHp: 60,
      maxMp: 60,
      weaponKey: job.startingWeapon.weaponKey,
      weaponClass: job.startingWeapon.weaponClass,
      jobLevel: 12,
    });
  }

  /** 初期装備（補助仕様書 3.4：戦士は大剣と重装の胴、盗賊は短剣と軽装の胴。通常・下級） */
  private equipStarting(): void {
    for (const slot of this.equipment.all()) this.equipment.unequip(slot[0]);
    const ids =
      this.job === WARRIOR_JOB
        ? ["BASE-WPN-GREATSWORD-T1", "BASE-ARM-HEAVY-BODY-T1"]
        : ["BASE-WPN-DAGGER-T1", "BASE-ARM-LIGHT-BODY-T1"];
    for (const baseId of ids) {
      const item: ItemInstance = {
        uid: `itm_${String(this.itemSerial++).padStart(6, "0")}`,
        baseId,
        rarity: "normal",
        ilvl: 1,
        affixes: [],
        enhance: 0,
      };
      this.equipment.equip(item, GEAR_DATA, { canDualWield: false });
    }
    this.applyGear();
  }

  /** 保存した状態を読み込む（あれば）。持ち物・装備・金貨・素材・Lvが戻る */
  private async restoreFromSave(): Promise<void> {
    const res = await this.saves.load(this.slot);
    if (!res.ok) return;
    const state = fromSave(res.data, this.jobRegistry, GEAR_DATA);
    for (const [slot] of this.equipment.all()) this.equipment.unequip(slot);
    for (const [slot, item] of state.equipment.all()) {
      this.equipment.equip(item, GEAR_DATA, { slot, canDualWield: true });
    }
    for (const item of this.bag.items()) this.bag.remove(item.uid);
    for (const item of state.bag.items()) this.bag.add(item);
    this.purse.gold = state.purse.gold;
    for (const [id, n] of state.purse.materials) this.purse.addMaterial(id, n);
    this.progression = state.progression;
    this.world.restore(state.world);
    for (const [id, stages] of Object.entries(state.quests)) {
      for (const st of stages) this.quests.restoreStage(id, st);
    }
    this.explorationPoints = state.explorationPoints;
    this.bossTokens = { ...state.bossTokens };
    this.loadouts = state.base.loadouts.map((l) => ({ ...l }));
    this.activeLoadout = state.base.activeLoadout;
    this.syncFromHost({
      equipment: this.equipment,
      bag: this.bag,
      stash: this.stash,
      mainJob: state.progression.mainJob,
      starAllocation: state.starAllocation,
      extraEntries: state.extraEntries,
      jobBoards: state.jobBoards,
    });
    for (const item of state.stash.items()) this.stash.add(item);
    this.fighter.setCharLevel(this.progression.character.level);
    this.refreshPoints();
    this.applyGear();
    this.savedNote = res.recoveredFromBackup ? "（1つ前のセーブから復元）" : "（セーブを読み込み）";
  }

  /** 今の状態を保存する（自動セーブだけ。手動セーブはない） */
  private async autoSave(): Promise<void> {
    const state = newGameState(this.jobRegistry, "試験", this.job.id);
    state.progression = this.progression;
    for (const [slot, item] of this.equipment.all())
      state.equipment.equip(item, GEAR_DATA, { slot, canDualWield: true });
    for (const item of this.bag.items()) state.bag.add(item);
    state.purse.gold = this.purse.gold;
    for (const [id, n] of this.purse.materials) state.purse.addMaterial(id, n);
    state.world = this.world.snapshot();
    state.quests = this.quests.snapshot();
    state.questPoints = this.quests.questPoints;
    state.explorationPoints = this.explorationPoints;
    state.bossTokens = { ...this.bossTokens };
    const host = this.liveHost();
    state.starAllocation = host.starAllocation;
    state.extraEntries = host.extraEntries;
    state.jobBoards = host.jobBoards;
    state.base = {
      ...state.base,
      loadouts: this.loadouts.length > 0 ? this.loadouts : state.base.loadouts,
      activeLoadout: this.activeLoadout,
    };
    for (const item of this.stash.items()) state.stash.add(item);
    try {
      await this.saves.save(this.slot, toSave(state));
      this.savedNote = "（自動セーブ）";
    } catch {
      this.savedNote = "（セーブに失敗）";
    }
  }

  /** 装備が変わるたびに、能力値を計算し直す */
  private applyGear(): void {
    const stats = this.job.startingStats;
    this.fighter.setGear(computeGear(this.equipment, GEAR_DATA, stats));
    this.applyBoard();
  }

  /** 星辰盤の評価をやり直し、効果を戦闘に反映する（装備・ポイントが変わるたびに計算し直す） */
  private applyBoard(): void {
    const bc = buildBoardContext(this.equipment, GEAR_DATA, {
      tags: this.tagRegistry,
      characterStats: this.job.startingStats,
      ...(this.job.aptitude.dualWield !== undefined && this.equipment.get("副手")
        ? { dualWield: true }
        : {}),
    });
    this.boardEval = this.board.evaluate(this.starPoints, bc);
    const jb = this.currentJobBoard();
    this.jobBoardEval = jb.evaluate(this.jobPoints, bc);
    // 職紋盤の接続ノード：星辰盤の始点の周りの小星の効果が×2
    const starEffects = jb.connectionActive(this.jobBoardEval)
      ? doubleNearStart(
          BOARD_DATA,
          this.boardEval,
          STAR_START_OF_JOB[this.job.id] ?? "STAR-GOU-START",
          3,
          2,
        )
      : this.boardEval.effects;
    // 潜在効果の発動条件に使う旗（ノード・星座・職奥義）。装備のユニークの効果を足して評価する
    const flags = boardFlags([
      { data: BOARD_DATA, evaluation: this.boardEval },
      { data: JOB_BOARDS[this.job.id]?.data ?? BOARD_DATA, evaluation: this.jobBoardEval },
    ]);
    if (this.fighter.gauge.forceIntensified) flags.add("鬼神中");
    const ctx = { ...bc.ctx, flags: new Set([...bc.ctx.flags, ...flags]) };
    const all = [
      ...starEffects,
      ...this.jobBoardEval.effects,
      ...equippedUniqueEffects(this.equipment, UNIQUE_DATA),
    ];
    const latent = activeLatents(evaluate(all, ctx, new ConditionRegistry()), UNIQUE_DATA);
    for (const id of this.discoveries.update(latent)) {
      this.notice = `潜在効果が目覚めた：${UNIQUE_DATA.uniques.get(id)?.name ?? id}`;
      this.noticeLeft = 4;
    }
    this.fighter.setEffectSource(all, ctx, (skill) =>
      this.tagRegistry.expand(
        skill.tags.map((t) => this.tagIdByName.get(t)).filter((x): x is string => x !== undefined),
      ),
    );
    // 職能ゲージに作用する効果（闘志の炉・不屈の闘志・無限連撃など）
    const hooks = evaluate(all, ctx, new ConditionRegistry()).hooks();
    applyGaugeHooks(this.fighter.gauge, hooks);
  }

  private currentJobBoard(): JobBoard {
    let jb = this.jobBoards.get(this.job.id);
    if (!jb) {
      const def = JOB_BOARDS[this.job.id];
      if (!def) throw new Error(`職紋盤がない: ${this.job.id}`);
      jb = new JobBoard(def.data, def.start, this.job.id);
      this.jobBoards.set(this.job.id, jb);
    }
    return jb;
  }

  constructor() {
    super("play");
  }

  create(): void {
    this.swing = this.add.graphics().setDepth(4);
    this.warn = this.add.graphics().setDepth(0);
    this.trailGfx = this.add.graphics().setDepth(0);
    this.groundLayer = this.add.graphics().setDepth(0);
    this.body = this.add.rectangle(0, 0, 12, 18, 0x6fb1d8).setDepth(2);
    this.arrow = this.add.triangle(0, 0, 0, -3, 0, 3, 7, 0, 0xffffff).setDepth(3);
    this.hud = this.add
      .text(8, 8, "", { fontFamily: "monospace", fontSize: "9px", color: "#cfcde0" })
      .setScrollFactor(0)
      .setDepth(10);
    this.cameras.main.startFollow(this.body, true, 0.15, 0.15);
    this.boardGfx = this.add.graphics().setScrollFactor(0).setDepth(22);
    this.bossBar = this.add.graphics().setScrollFactor(0).setDepth(12);
    this.bossLabel = this.add
      .text(320, 14, "", { fontFamily: "sans-serif", fontSize: "10px", color: "#ffd2d2" })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(12);
    this.panelBg = this.add
      .rectangle(320, 180, 600, 330, 0x0d0c14, 0.92)
      .setScrollFactor(0)
      .setDepth(20)
      .setVisible(false);
    this.panelText = this.add
      .text(30, 30, "", { fontFamily: "monospace", fontSize: "9px", color: "#e0def0" })
      .setScrollFactor(0)
      .setDepth(21);
    this.panelTip = this.add
      .text(330, 30, "", {
        fontFamily: "monospace",
        fontSize: "9px",
        color: "#cfd8ff",
        wordWrap: { width: 290 },
      })
      .setScrollFactor(0)
      .setDepth(21);
    this.equipStarting();
    void this.restoreFromSave();

    this.enterLocation(TOWN_ID);

    const keyboard = this.input.keyboard;
    if (keyboard) {
      keyboard.on("keydown", (e: KeyboardEvent) => {
        this.pressed.add(e.code);
        this.justPressed.add(e.code);
        if (e.code === "Space") this.dodgePressedOnce = true;
        e.preventDefault();
      });
      keyboard.on("keyup", (e: KeyboardEvent) => this.pressed.delete(e.code));
    }
    this.input.mouse?.disableContextMenu();
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      this.pressed.add(`Mouse${String(p.button)}`);
      this.justPressed.add(`Mouse${String(p.button)}`);
    });
    this.input.on("pointerup", (p: Phaser.Input.Pointer) =>
      this.pressed.delete(`Mouse${String(p.button)}`),
    );
    this.game.events.on(Phaser.Core.Events.BLUR, () => {
      this.pressed.clear();
    });

    document.body.dataset["stellaReady"] = "true";
  }

  private addEnemy(enemy: Enemy): void {
    const r = enemy.body.radius * M * 2;
    const color = ENEMY_COLORS[enemy.def.id] ?? 0x888888;
    const body = this.add.rectangle(0, 0, r, r * 1.3, color).setDepth(1);
    const facing = this.add.rectangle(0, 0, 4, 4, 0xffffff).setDepth(1);
    const hp = this.add.rectangle(0, 0, 16, 2, 0xd85a5a).setDepth(5);
    this.enemies.push(enemy);
    this.views.push({ enemy, body, facing, hp });
  }

  override update(_time: number, delta: number): void {
    if (this.updatePanel()) {
      this.justPressed.clear();
      return;
    }
    const ticks = this.stepper.advance(delta);
    const actions = pressedActions(new Set([...this.pressed, ...this.justPressed]));
    const pointer = this.input.activePointer;
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    // ヒットストップ：短い間、ルールの時間を止める
    if (this.hitStopLeft > 0) {
      this.hitStopLeft -= delta / 1000;
      this.updateView();
      return;
    }
    for (let i = 0; i < ticks; i++) {
      this.fighter.tick(TICK_SECONDS);
      stepPlayer(
        this.player,
        {
          move: moveVector(actions),
          aimPoint: { x: world.x / M, y: world.y / M },
          dodgePressed: this.dodgePressedOnce || actions.has("dodge"),
          speedMultiplier: this.fighter.moveSpeedMultiplier,
        },
        TICK_SECONDS,
      );
      const moved = Math.hypot(
        this.player.pos.x - this.lastPos.x,
        this.player.pos.y - this.lastPos.y,
      );
      this.fighter.noteMovement(moved > 1e-6, moved, TICK_SECONDS);
      this.lastPos = { x: this.player.pos.x, y: this.player.pos.y };
      this.noticeLeft = Math.max(0, this.noticeLeft - TICK_SECONDS);
      this.dodgePressedOnce = false;
      this.updateSkills(actions);
      this.updateAttack(actions.has("skill1"));
      this.updateEnemies();
      this.updateGround();
      this.updateLoot();
      this.updateWorld();
      if (this.autoSaver.tick(TICK_SECONDS, true)) void this.autoSave();
      this.updateClouds();
      this.updateProjectiles();
      this.updatePoisonTrail();
    }
    if (ticks > 0) this.justPressed.clear();
    this.updateView();
  }

  /** 毒だまり（毒蛇座の完成ボーナス） */
  private updatePoisonTrail(): void {
    this.poisonTrail.step(TICK_SECONDS, this.targetBodies(), this.fighter.ruleParams("毒だまり"));
    const g = this.trailGfx;
    if (!g) return;
    g.clear();
    for (const pool of this.poisonTrail.pools) {
      g.fillStyle(0x7bd35a, 0.25).fillCircle(pool.pos.x * M, pool.pos.y * M, pool.radius * M);
    }
  }

  private updateEnemies(): void {
    const target = {
      pos: this.player.pos,
      radius: 0.4,
      invulnerable: !canBeHit(this.player),
    };
    const events = stepEnemies(this.enemies, target, TICK_SECONDS, this.rng);
    for (const e of events) this.handleEnemyEvent(e);
    for (const enemy of this.enemies) {
      if (enemy.def.script) {
        const st = enemy.script;
        if (!st?.action || st.action.stage !== "windup") this.telegraphs.delete(enemy);
      } else if (enemy.state !== "windup" || !enemy.attack) {
        this.telegraphs.delete(enemy);
      }
    }
  }

  private handleEnemyEvent(e: EnemyEvent): void {
    switch (e.type) {
      case "windup":
        this.telegraphs.set(e.enemy, {
          shape: e.attack.shape,
          angle: e.angle,
          ...(e.at ? { at: e.at } : {}),
        });
        break;
      case "hit":
        this.hurtPlayer(e.damage, e.enemy);
        break;
      case "projectile": {
        const p = this.projectiles.spawn({
          pos: e.pos,
          angle: e.angle,
          speed: e.attack.projectile?.speed ?? 8,
          radius: e.attack.projectile?.radius ?? 0.25,
          range: e.attack.projectile?.range ?? 10,
          payload: e.damage,
        });
        this.projectileGfx.set(p, this.add.circle(0, 0, 3, 0xb0e07a).setDepth(3));
        break;
      }
      case "summon": {
        for (const c of performSummon(e.enemy, e.attack, enemyDef, this.rng, this.enemies)) {
          this.addEnemy(c);
        }
        this.showText(e.enemy.body.pos.x, e.enemy.body.pos.y - 1.2, "遠吠え！", "#ff9b6b", 12);
        break;
      }
      case "cloud": {
        const radius = e.attack.cloud?.radius ?? 2.5;
        this.clouds.push({
          x: e.pos.x,
          y: e.pos.y,
          radius,
          left: e.attack.cloud?.seconds ?? 5,
          damage: e.damage,
          gfx: this.add.circle(e.pos.x * M, e.pos.y * M, radius * M, 0x7bd35a, 0.25).setDepth(0),
          tick: 0,
        });
        break;
      }
      default:
        break;
    }
  }

  private hurtPlayer(rawDamage: number, attacker?: Enemy): void {
    if (this.world.inTown) return;
    // 敵の命中に対するプレイヤーの回避値は今は0（装備の画面 U-12 で扱う）
    if (!canBeHit(this.player)) return;
    const behind =
      attacker !== undefined &&
      attacker.def.noFacing !== true &&
      isBackHit(this.player.pos, attacker.body.pos, attacker.body.facing);
    const dealt = this.fighter.takeDamage(rawDamage, { playerBehindAttacker: behind });
    if (attacker) {
      this.fighter.retaliate(
        attacker.body,
        dealt,
        this.enemies.map((e) => e.body),
      );
    }
    this.cameras.main.shake(80, 0.002);
    this.showText(this.player.pos.x, this.player.pos.y, `-${dealt.toFixed(1)}`, "#ff8a8a", 9);
    if (attacker) this.lastHitBy = attacker.def.name;
    if (this.fighter.hp <= 0) this.die();
  }

  private updateClouds(): void {
    for (const c of this.clouds) {
      c.left -= TICK_SECONDS;
      c.tick += TICK_SECONDS;
      const inside = Math.hypot(this.player.pos.x - c.x, this.player.pos.y - c.y) <= c.radius;
      if (inside && c.tick >= 1) {
        c.tick = 0;
        this.hurtPlayer(c.damage);
      }
      if (c.left <= 0) c.gfx.destroy();
    }
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      if ((this.clouds[i]?.left ?? 0) <= 0) this.clouds.splice(i, 1);
    }
  }

  private updateProjectiles(): void {
    const hits = this.projectiles.step(TICK_SECONDS, [
      { id: "PLAYER", pos: this.player.pos, radius: 0.4, hp: 1 },
    ]);
    for (const h of hits) this.hurtPlayer(Number(h.projectile.payload));
    for (const [p, gfx] of this.projectileGfx) {
      const proj = p as { active: boolean; pos: { x: number; y: number } };
      if (!proj.active) {
        gfx.destroy();
        this.projectileGfx.delete(p);
      } else {
        gfx.setPosition(proj.pos.x * M, proj.pos.y * M);
      }
    }
  }

  /** 技の枠のキーを押している間、使える状態になるたびに使う（補助仕様書 1.1） */
  private updateSkills(actions: ReadonlySet<string>): void {
    if (this.justPressed.has("KeyK")) {
      this.job = this.job === WARRIOR_JOB ? ROGUE_JOB : WARRIOR_JOB;
      this.fighter = PlayScene.makeFighter(this.job);
      this.board = new StarBoard(BOARD_DATA, STAR_START_OF_JOB[this.job.id] ?? "STAR-GOU-START");
      this.equipStarting();
      this.attack = undefined;
    }
    if (this.time.now < this.busyUntil || this.attack || isDodging(this.player)) return;
    for (const [i, skill] of this.job.skills.entries()) {
      const key = PlayScene.SLOT_ACTIONS[i] ?? "";
      const held =
        key === "KeyR"
          ? this.pressed.has("KeyR") || this.justPressed.has("KeyR")
          : actions.has(key);
      if (!held) continue;
      const world = this.cameras.main.getWorldPoint(
        this.input.activePointer.x,
        this.input.activePointer.y,
      );
      const out = this.fighter.use(
        skill.id,
        this.player.pos,
        this.player.aimAngle,
        this.targetBodies(),
        this.rng,
        { aim: { x: world.x / M, y: world.y / M }, ground: this.ground },
      );
      if (!out.ok || !out.effective) continue;
      this.busyUntil = this.time.now + out.effective.skill.totalSeconds * 1000;
      if (out.movedTo) {
        this.player.pos.x = out.movedTo.x;
        this.player.pos.y = out.movedTo.y;
      }
      for (const { target, result } of out.hits) {
        this.onPlayerHit(target.id, result.damage, result.crit, result.back, result.feedback);
      }
      this.flashArea(out.effective.shape, this.player.aimAngle);
      break;
    }
  }

  /** 持ち物・キャラクターの画面。開いている間は、戦闘の時間を止める。止めたら true */
  private updatePanel(): boolean {
    const jp = this.justPressed;
    if (jp.has("KeyI")) this.panel = this.panel === "inventory" ? "none" : "inventory";
    if (jp.has("KeyC")) this.panel = this.panel === "character" ? "none" : "character";
    if (jp.has("KeyT")) this.panel = this.panel === "star" ? "none" : "star";
    if (jp.has("KeyJ")) this.panel = this.panel === "job" ? "none" : "job";
    if (jp.has("KeyB")) this.panel = this.panel === "smith" ? "none" : "smith";
    if (jp.has("KeyL") && this.world.inTown)
      this.panel = this.panel === "loadout" ? "none" : "loadout";
    if (jp.has("KeyM")) {
      // 開発用：クラフト素材を100ずつ入れる
      for (const id of Object.values(MATERIAL)) this.purse.addMaterial(id, 100);
    }
    if (jp.has("KeyU")) {
      // 開発用：ユニークを持ち物に入れる（Uキーで順番に）
      const entry = UNIQUES[this.uniqueCursor++ % UNIQUES.length];
      if (entry) {
        this.bag.add({
          uid: `itm_${String(this.itemSerial++).padStart(6, "0")}`,
          baseId: entry.baseId,
          rarity: "unique",
          ilvl: 20,
          affixes: [],
          enhance: 0,
          uniqueId: entry.id,
        });
      }
    }
    if (jp.has("KeyP")) {
      this.devPoints += 5;
      this.refreshPoints();
      this.applyBoard();
    }
    if (jp.has("Escape")) this.panel = "none";
    const open = this.panel !== "none";
    this.panelBg.setVisible(open);
    this.hud.setVisible(!open);
    if (this.panel !== "star" && this.panel !== "job") this.boardGfx.clear();
    this.panelText.setVisible(open);
    this.panelTip.setVisible(open);
    if (!open) return false;

    if (this.panel === "star" || this.panel === "job") {
      this.panelText.setWordWrapWidth(1200);
      return this.updateStarPanel();
    }
    this.panelText.setWordWrapWidth(this.panel === "smith" ? 290 : 1200);
    if (this.panel === "smith") return this.updateSmithPanel();
    if (
      this.panel === "merchant" ||
      this.panel === "stash" ||
      this.panel === "teleport" ||
      this.panel === "temple" ||
      this.panel === "altar" ||
      this.panel === "loadout"
    ) {
      return this.updateFacilityPanel();
    }
    this.panelText.setPosition(30, 30);
    this.panelTip.setPosition(330, 30);
    const stats = this.job.startingStats;
    const dual = this.job.aptitude.dualWield !== undefined;
    if (this.panel === "character") {
      const gear = computeGear(this.equipment, GEAR_DATA, stats);
      this.panelText.setText(
        `【キャラクター】${this.job.name}\n` + characterText(this.fighter, gear, stats),
      );
      this.panelTip.setText("");
      return true;
    }
    const entries = inventoryEntries(this.equipment, this.bag);
    const move = (jp.has("ArrowDown") ? 1 : 0) - (jp.has("ArrowUp") ? 1 : 0);
    this.panelCursor = Math.max(0, Math.min(entries.length - 1, this.panelCursor + move));
    const current = entries[this.panelCursor];
    if (jp.has("Enter") && current) {
      if (current.equipped) {
        const slot = this.equipment.all().find(([, i]) => i.uid === current.item.uid)?.[0];
        if (slot) {
          const removed = this.equipment.unequip(slot);
          if (removed && !this.bag.add(removed)) this.equipment.equip(removed, GEAR_DATA, { slot });
        }
      } else {
        this.bag.remove(current.item.uid);
        const r = this.equipment.equip(current.item, GEAR_DATA, { canDualWield: dual });
        if (r.ok) for (const old of r.replaced) this.bag.add(old);
        else this.bag.add(current.item);
      }
      this.applyGear();
      if (this.autoSaver.onEvent("trade")) void this.autoSave();
    }
    const list = inventoryEntries(this.equipment, this.bag);
    this.panelCursor = Math.max(0, Math.min(list.length - 1, this.panelCursor));
    const start = Math.max(0, this.panelCursor - 14);
    const rows = list
      .slice(start, start + 22)
      .map((e, i) => `${start + i === this.panelCursor ? "▶" : " "}${entryLabel(e, GEAR_DATA)}`);
    this.panelText.setText(
      `【持ち物】${String(this.bag.count)}/${String(this.bag.capacity)}  金貨 ${String(this.purse.gold)}\n↑↓ 選ぶ / Enter 装備・外す / I 閉じる\n\n${rows.join("\n")}`,
    );
    this.panelTip.setText(
      tooltipText(
        list[this.panelCursor],
        GEAR_DATA,
        this.equipment,
        stats,
        this.job.id,
        dual,
        new Set(this.discoveries.all()),
      ),
    );
    return true;
  }

  /** 鍛冶屋の画面：持ち物から選んだ装備を、強化・分解・素材で加工する（数字キー） */
  private updateSmithPanel(): boolean {
    const jp = this.justPressed;
    this.panelText.setPosition(30, 30);
    this.panelTip.setPosition(330, 30);
    const items = this.bag.items();
    const move = (jp.has("ArrowDown") ? 1 : 0) - (jp.has("ArrowUp") ? 1 : 0);
    this.panelCursor = Math.max(0, Math.min(items.length - 1, this.panelCursor + move));
    const it = items[this.panelCursor];
    const base = it ? GEAR_DATA.bases.get(it.baseId) : undefined;
    const rng = this.rng;
    const keyOp: [string, () => { ok: boolean; reason?: string } | undefined][] = [
      ["Digit1", () => (it ? enhance(it, this.purse) : undefined)],
      [
        "Digit2",
        () => {
          if (!it) return undefined;
          if (this.inscriptionOffer.length === 0) {
            this.inscriptionOffer = offerInscriptions(CRAFT_DATA, rng);
            return { ok: false, reason: "銘の候補を出した（Q/W/Eで選ぶ）" };
          }
          return undefined;
        },
      ],
      [
        "Digit3",
        () => {
          if (!it) return undefined;
          const refs = loadoutsReferencing(this.loadouts, it.uid);
          if (refs.length > 0 && this.pendingDisassemble !== it.uid) {
            this.pendingDisassemble = it.uid;
            return {
              ok: false,
              reason: `ロードアウト${refs.join("・")}に登録されている。もう一度3で分解（その部位は空きになる）`,
            };
          }
          this.pendingDisassemble = undefined;
          removeFromLoadouts(this.loadouts, it.uid);
          const gained = disassembleYield(it);
          disassemble(it.uid, this.bag, this.purse);
          return { ok: true, reason: `分解：${JSON.stringify(gained)}` };
        },
      ],
      ["Digit4", () => (it && base ? awaken(it, base, CRAFT_DATA, this.purse, rng) : undefined)],
      ["Digit5", () => (it && base ? eyeOpen(it, base, CRAFT_DATA, this.purse, rng) : undefined)],
      ["Digit6", () => (it && base ? reroll(it, base, CRAFT_DATA, this.purse, rng) : undefined)],
      ["Digit7", () => (it ? tune(it, 0, CRAFT_DATA, this.purse, rng) : undefined)],
      ["Digit8", () => (it ? carve(it, CRAFT_DATA, this.purse, rng) : undefined)],
      ["Digit9", () => (it ? seal(it, 0, CRAFT_DATA, this.purse, rng) : undefined)],
    ];
    for (const [key, run] of keyOp) {
      if (!jp.has(key)) continue;
      const r = run();
      if (r) {
        this.smithLog = r.ok
          ? `${key.slice(5)}：成功`
          : `${key.slice(5)}：できない（${r.reason ?? ""}）`;
        if (r.ok) {
          this.applyGear();
          if (this.autoSaver.onEvent("craft")) void this.autoSave();
        }
      }
    }
    // 銘：Q/W/E で候補から選ぶ
    const pick = ["KeyQ", "KeyW", "KeyE"].findIndex((k) => jp.has(k));
    const choice = this.inscriptionOffer[pick];
    if (it && pick >= 0 && choice) {
      const r = inscribe(it, choice);
      this.smithLog = r.ok ? `銘「${choice.name}」を刻んだ` : `銘：できない（${r.reason ?? ""}）`;
      if (r.ok) this.inscriptionOffer = [];
      this.applyGear();
    }
    const material = (id: string): number => this.purse.material(id);
    this.panelText.setText(
      `【鍛冶屋】魔塵${String(material(MATERIAL.magicDust))} 星砂${String(material(MATERIAL.starSand))} 目覚め${String(material(MATERIAL.awakeningDust))} 開眼${String(material(MATERIAL.eyeOpeningCrystal))} 転詞${String(material(MATERIAL.turnStone))} 音叉${String(material(MATERIAL.tuningFork))} 削詞${String(material(MATERIAL.carvingBlade))} 封詞${String(material(MATERIAL.sealWax))} 核${String(material(MATERIAL.bossCoreCh1))}\n↑↓ 装備を選ぶ / 1 強化 2 銘 3 分解 4 目覚め 5 開眼 6 転詞 7 調律(先頭) 8 削詞 9 封詞(先頭) / M 素材+100(開発用) / B 閉じる\n${this.smithLog}\n\n${items
        .map(
          (e, i) =>
            `${i === this.panelCursor ? "▶" : " "}${entryLabel({ item: e, equipped: false }, GEAR_DATA)} +${String(e.enhance)} 負荷${String(e.strain ?? 0)}${(e.fractures?.length ?? 0) > 0 ? " 亀裂" : ""}`,
        )
        .slice(0, 18)
        .join("\n")}`,
    );
    this.panelTip.setText(
      it
        ? `${tooltipText({ item: it, equipped: false }, GEAR_DATA, this.equipment, this.job.startingStats, this.job.id, false, new Set(this.discoveries.all()))}${this.inscriptionOffer.length > 0 ? `\n── 銘の候補 ──\n${this.inscriptionOffer.map((o, i) => `${"QWE"[i] ?? ""}: ${o.name}`).join("\n")}` : ""}`
        : "",
    );
    return true;
  }

  /** 星辰盤・職紋盤の画面：ノードの上にマウスを置くと説明、左クリックで取得、右クリックで返却 */
  private updateStarPanel(): boolean {
    const isJob = this.panel === "job";
    const jb = this.currentJobBoard();
    const data = isJob ? (JOB_BOARDS[this.job.id]?.data ?? BOARD_DATA) : BOARD_DATA;
    const board = isJob ? jb.board : this.board;
    const points = isJob ? this.jobPoints : this.starPoints;
    const evaluation = isJob ? this.jobBoardEval : this.boardEval;
    const p = this.input.activePointer;
    let hover: string | undefined;
    let best = isJob ? 12 : 7;
    for (const n of data.nodes.values()) {
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d < best) {
        best = d;
        hover = n.id;
      }
    }
    const jp = this.justPressed;
    if (!isJob && jp.has("KeyR") && this.world.inTown) {
      // 全体の振り直し（町の星読み師。MVPでは常に無料）
      this.board.reset();
      this.notice = "星辰盤を全て振り直した（無料）";
      this.noticeLeft = 3;
      this.applyBoard();
    }
    if (hover) {
      if (jp.has("Mouse0")) {
        if (isJob) jb.allocate(hover, points);
        else this.board.allocate(hover, points);
      }
      if (jp.has("Mouse2")) {
        if (isJob) jb.refund(hover);
        else {
          // 星辰盤の返却は、還星の灯を1個使う（町の星読み師）。灯がなければ返却できない
          if (!this.world.inTown) {
            this.notice = "星辰盤の返却は、町の星読み師でだけできる";
            this.noticeLeft = 3;
          } else {
            const r = this.board.refundWithLamp(hover, this.purse, MATERIAL.returnLamp);
            if (!r.ok) {
              this.notice =
                r.reason === "lamp" ? "還星の灯が足りない" : "返却できない（つながりが切れる）";
              this.noticeLeft = 3;
            }
          }
        }
      }
      if (jp.has("Mouse0") || jp.has("Mouse2")) this.applyBoard();
    }
    const g = this.boardGfx;
    g.clear();
    const dormant = new Set(evaluation.dormant.map((d) => d.id));
    g.lineStyle(1, 0x3a3855, 1);
    for (const n of data.nodes.values()) {
      for (const l of n.links) {
        const o = data.nodes.get(l);
        if (o && n.id < l) g.lineBetween(n.x, n.y, o.x, o.y);
      }
    }
    for (const n of data.nodes.values()) {
      const taken = board.has(n.id) || board.entrances.includes(n.id);
      const color = !taken
        ? 0x5c5a78
        : dormant.has(n.id)
          ? 0x8a8a8a
          : n.type === "天極" || n.type === "職奥義"
            ? 0xffd86b
            : n.type === "接続"
              ? 0x7bd35a
              : 0x6fb1d8;
      const big = n.type === "天極" || n.type === "職奥義";
      const mid = n.type === "輝星" || n.type === "星門" || n.type === "転変" || n.type === "接続";
      const r = (big ? 6 : mid ? 4 : n.type === "始点" ? 5 : 2.5) * (isJob ? 1.4 : 1);
      g.fillStyle(color, taken ? 1 : 0.8);
      g.fillCircle(n.x, n.y, r);
      if (n.id === hover) {
        g.lineStyle(1, 0xffffff, 1);
        g.strokeCircle(n.x, n.y, r + 2);
      }
      if (n.constellation && !taken) {
        g.lineStyle(1, 0x7bd35a, 0.6);
        g.strokeCircle(n.x, n.y, r + 1);
      }
    }
    this.panelText
      .setPosition(6, 6)
      .setText(
        `【${isJob ? `職紋盤：${this.job.name}` : "星辰盤"}】ポイント ${String(board.pointsUsed)}/${String(points)}（Pで+5・開発用）  有効 ${String(evaluation.active.length)}  休眠 ${String(dormant.size)}${isJob ? `  職奥義 ${jb.mastery ? "選択済み" : "未選択"}` : `  星座 ${String(evaluation.completedConstellations.length)}完成`}\n左クリック 取得 / 右クリック 返却${isJob ? "" : "（還星の灯1個・町）／ R 全体の振り直し（町・無料）"} / ${isJob ? "J" : "T"} 閉じる`,
      );
    const node = hover ? data.nodes.get(hover) : undefined;
    this.panelTip
      .setPosition(6, 290)
      .setText(
        node
          ? describeStarNode(
              node,
              data,
              board.has(node.id),
              evaluation,
              (id) => this.tagName.get(id) ?? id,
            )
          : "",
      );
    return true;
  }

  /** 章ボスのドロップ・討伐証・初回撃破の隠し星 */
  private bossDrops(enemy: Enemy, firstKill: boolean): void {
    const cfg = enemy.def.id === "BOSS-CH1" ? MOTHER_TREE_DROP : ABYSS_TREE_DROP;
    const drop = rollBossDrops(GENERATION_DATA, cfg, {
      firstKill,
      uid: () => `itm_${String(this.itemSerial++).padStart(6, "0")}`,
      rng: this.rng,
    });
    this.loot.spawn(enemy.body.pos, { items: drop.items, gold: 0, materials: drop.materials });
    for (const [id, n] of Object.entries(drop.tokens)) {
      this.bossTokens[id] = (this.bossTokens[id] ?? 0) + n;
    }
    this.notice = `${enemy.def.name}を倒した！ 討伐証 ${String(this.bossTokens["BOSS-CH1"] ?? 0)}個${drop.uniqueDropped ? "・専用ユニークが落ちた" : ""}`;
    this.noticeLeft = 8;
    // 腐根の母樹の初回撃破：隠し星を自動で得る（補助仕様書 9.5）
    if (firstKill && enemy.def.id === "BOSS-CH1") {
      this.explorationPoints += 1;
      this.refreshPoints();
    }
    if (this.autoSaver.onEvent("changeArea")) void this.autoSave();
  }

  /** 今のビルドを、ロードアウトの保存・適用の対象としてまとめる */
  private liveHost(): LoadoutHost {
    const jobBoards: LoadoutHost["jobBoards"] = {};
    for (const [id, jb] of this.jobBoards) jobBoards[id] = jb.snapshot();
    return {
      equipment: this.equipment,
      bag: this.bag,
      stash: this.stash,
      mainJob: this.job.id,
      starAllocation: [...this.board.allocated],
      extraEntries: this.board.entrances.slice(1),
      jobBoards,
    };
  }

  /** ロードアウトを適用した後、ゲームの状態（ジョブ・ツリー・戦闘者）を合わせる */
  private syncFromHost(host: LoadoutHost): void {
    const job = [WARRIOR_JOB, ROGUE_JOB].find((j) => j.id === host.mainJob) ?? this.job;
    if (job !== this.job) {
      this.job = job;
      this.fighter = PlayScene.makeFighter(job);
      this.fighter.setCharLevel(this.progression.character.level);
    }
    this.progression.setMainJob(job.id);
    this.board = new StarBoard(BOARD_DATA, STAR_START_OF_JOB[job.id] ?? "STAR-GOU-START");
    this.board.restore(host.starAllocation, host.extraEntries);
    this.jobBoards.clear();
    for (const [id, b] of Object.entries(host.jobBoards)) {
      const def = JOB_BOARDS[id];
      if (!def) continue;
      const jb = new JobBoard(def.data, def.start, id);
      jb.restore(b.allocation);
      this.jobBoards.set(id, jb);
    }
    this.applyGear();
    this.refreshPoints();
  }

  /** 星辰盤・職紋盤のポイントを計算し直す（キャラLv＋星図の欠片＋隠し星／ジョブLv） */
  private refreshPoints(): void {
    this.starPoints =
      starPointTotal(
        this.progression.character.level,
        this.quests.questPoints,
        this.explorationPoints,
      ) + this.devPoints;
    this.jobPoints = this.progression.jobPoints(this.job.id) + this.devPoints;
    this.applyBoard();
  }

  /** 敵を倒した：経験値・クエスト・討伐の記録 */
  private onEnemyDefeated(enemy: Enemy): void {
    const kind = enemy.def.boss ?? enemy.rank;
    const gained = this.progression.gainFromKill(enemy.level, kind);
    if (gained.char > 0) {
      this.fighter.setCharLevel(this.progression.character.level);
      this.notice = `キャラLv ${String(this.progression.character.level)} になった`;
      this.noticeLeft = 4;
      this.refreshPoints();
    }
    if (enemy.def.boss) this.world.firstKills.add(enemy.def.id);
    this.questProgress(this.quests.notify({ type: "kill", target: enemy.def.id }));
  }

  private questProgress(events: ReturnType<QuestLog["notify"]>): void {
    for (const e of events) {
      this.notice = `クエスト「${e.questId === "QST-FOREST" ? "森の異変" : e.questId}」：${e.stage.description}（星図の欠片+${String(e.stage.rewardQuestPoints)}）`;
      this.noticeLeft = 6;
    }
    if (events.length > 0) {
      this.refreshPoints();
      if (this.autoSaver.onEvent("changeArea")) void this.autoSave();
    }
  }

  /** 戦う対象（敵と、町の人形） */
  private targetBodies(): Combatant[] {
    return [...this.enemies.map((e) => e.body), ...(this.townDummy ? [this.townDummy] : [])];
  }

  /** 場所を移る：今の場所の表示物・敵・地面のアイテムを片付け、行き先を作る */
  private enterLocation(id: string, fromId?: string): void {
    for (const o of this.locationObjs) o.destroy();
    this.locationObjs = [];
    for (const v of this.views) {
      v.body.destroy();
      v.facing.destroy();
      v.hp.destroy();
    }
    this.views.length = 0;
    this.enemies.length = 0;
    this.dropped.clear();
    this.telegraphs.clear();
    for (const g of this.projectileGfx.values()) g.destroy();
    this.projectileGfx.clear();
    for (const c of this.clouds) c.gfx.destroy();
    this.clouds.length = 0;
    // 地面に落ちていて拾っていないアイテムは失われる（地域が作り直されるため）
    for (const label of this.lootLabels.values()) label.destroy();
    this.lootLabels.clear();
    this.loot.entries.length = 0;
    for (const v of this.containerViews.values()) v.destroy();
    this.containerViews.clear();
    this.townDummy = undefined;
    this.ground.traps.length = 0;
    this.ground.smokes.length = 0;

    const map = ALL_MAPS.find((m) => m.id === id) ?? this.mapDef;
    this.mapDef = map;
    this.walls = [...map.walls];
    this.doorObj = undefined;
    this.world.location = id;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      this.locationObjs.push(o);
      return o;
    };
    // 地面と壁
    add(
      this.add
        .rectangle(
          (map.width * M) / 2,
          (map.height * M) / 2,
          map.width * M,
          map.height * M,
          0x1d1c26,
        )
        .setDepth(-12),
    );
    add(
      this.add
        .grid(
          (map.width * M) / 2,
          (map.height * M) / 2,
          map.width * M,
          map.height * M,
          M,
          M,
          0x1d1c26,
          0,
          0x26253a,
          1,
        )
        .setDepth(-10),
    );
    for (const w of map.walls) {
      add(
        this.add
          .rectangle(
            (w.x + w.w / 2) * M,
            (w.y + w.h / 2) * M,
            w.w * M,
            w.h * M,
            id === TOWN_ID ? 0x3a3550 : 0x2b4a2f,
          )
          .setDepth(-5),
      );
    }
    // 出口
    for (const e of map.exits) {
      add(this.add.circle(e.pos.x * M, e.pos.y * M, e.radius * M, 0xd8c36f, 0.25).setDepth(-4));
      add(
        this.add
          .text(
            e.pos.x * M,
            (e.pos.y - e.radius - 1.5) * M,
            e.to === TOWN_ID ? "町へ" : "次の地域へ",
            { fontFamily: "sans-serif", fontSize: "8px", color: "#d8c36f" },
          )
          .setOrigin(0.5)
          .setDepth(-3),
      );
    }
    if (id === TOWN_ID) {
      // 町：施設の目印。安全地帯（敵は出ない）。薬瓶は全回復、HP・MPも回復
      for (const f of FACILITIES) {
        const pos = TOWN_FACILITY_POS[f.id];
        const open = facilityUnlocked(f.id, {
          charLevel: this.progression.character.level,
          firstKills: this.world.firstKills,
        });
        add(
          this.add.rectangle(pos.x * M, pos.y * M, 24, 24, open ? 0x6f8bd8 : 0x555566).setDepth(-3),
        );
        add(
          this.add
            .text(pos.x * M, (pos.y - 2.2) * M, f.name + (open ? "" : "（未開放）"), {
              fontFamily: "sans-serif",
              fontSize: "8px",
              color: open ? "#cfd8ff" : "#777788",
            })
            .setOrigin(0.5)
            .setDepth(-3),
        );
      }
      this.townDummy = createCombatant({
        id: "TOWN-DUMMY",
        pos: TOWN_FACILITY_POS.DUMMY,
        maxHp: 1e9,
        facing: Math.PI,
      });
      this.fighter.hp = this.fighter.maxHp;
      this.fighter.mp = this.fighter.init.maxMp;
      this.hpFlask.refill();
      this.mpFlask.refill();
      this.merchant.restock(
        GENERATION_DATA,
        5,
        () => `shop_${String(this.itemSerial++)}`,
        this.rng,
      );
      this.world.returnToTown();
    } else {
      const region =
        this.world.region?.map.id === id ? this.world.region : this.world.enter(id, this.rng);
      for (const e of region.enemies) this.addEnemy(e);
      this.questProgress(this.quests.notify({ type: "reach", region: id }));
      for (const c of region.containers) {
        this.containerViews.set(
          c.id,
          this.add
            .rectangle(
              c.pos.x * M,
              c.pos.y * M,
              c.kind === "chest" ? 14 : 10,
              c.kind === "chest" ? 10 : 10,
              c.kind === "chest" ? 0xd8a24a : 0x8a6b3a,
            )
            .setDepth(-2),
        );
      }
      if (map.teleportStone) {
        add(
          this.add
            .circle(
              map.teleportStone.x * M,
              map.teleportStone.y * M,
              6,
              this.world.unlockedTeleports.has(id) ? 0x7bd3ff : 0x556688,
            )
            .setDepth(-2),
        );
      }
    }
    // 入口に現れる
    const arrive =
      fromId !== undefined && fromId !== TOWN_ID && map.exits.some((e) => e.to === fromId)
        ? map.exits.find((e) => e.to === fromId)?.pos
        : undefined;
    const start = arrive
      ? { x: arrive.x + (arrive.x < map.width / 2 ? 4 : -4), y: arrive.y }
      : map.entrance;
    this.player.pos.x = start.x;
    this.player.pos.y = start.y;
    this.lastPos = { ...start };
    this.cameras.main.setBounds(0, 0, map.width * M, map.height * M);
    this.cameras.main.centerOn(start.x * M, start.y * M);
  }

  /** 死亡：町に戻る。アイテム・経験値・素材・金貨は失わない。HP・MP・薬瓶は全回復。記録を残す */
  private die(): void {
    if (this.world.inTown) return;
    const record = this.world.die(this.lastHitBy);
    this.notice = `倒れた（${record.cause}）。星見の村に戻った（${String(this.world.deaths)}回目）`;
    this.noticeLeft = 6;
    this.attack = undefined;
    this.enterLocation(TOWN_ID);
    if (this.autoSaver.onEvent("enterTown")) void this.autoSave();
  }

  /** 出口・転移の石・薬瓶・地域の進行を毎刻確かめる */
  private updateWorld(): void {
    const map = this.mapDef;
    // 壁との衝突
    const fixed = resolveWalls(this.player.pos, 0.4, this.walls, {
      width: map.width,
      height: map.height,
    });
    this.player.pos.x = fixed.x;
    this.player.pos.y = fixed.y;
    // 出口
    for (const e of map.exits) {
      if (Math.hypot(this.player.pos.x - e.pos.x, this.player.pos.y - e.pos.y) <= e.radius) {
        const from = this.world.location;
        if (e.to === TOWN_ID) {
          this.enterLocation(TOWN_ID);
          if (this.autoSaver.onEvent("enterTown")) void this.autoSave();
        } else {
          this.world.touchTeleportStone(e.to);
          this.world.move(e.to, this.rng);
          this.enterLocation(e.to, from);
          if (this.autoSaver.onEvent("changeArea")) void this.autoSave();
        }
        return;
      }
    }
    // 入口の転移の石に触れて解放する
    if (
      map.teleportStone &&
      Math.hypot(
        this.player.pos.x - map.teleportStone.x,
        this.player.pos.y - map.teleportStone.y,
      ) <= 1.5
    ) {
      if (this.world.touchTeleportStone(map.id)) {
        this.notice = `転移の石を解放した：${map.name}`;
        this.noticeLeft = 4;
      }
    }
    // 開発用：Lで即死（死亡の処理の確認）
    if (this.justPressed.has("KeyL")) {
      this.lastHitBy = "開発用の即死";
      this.fighter.hp = 0;
      this.die();
      return;
    }
    // 開発用：Nで次の地域へ移り、ボスがいればその手前に出る
    if (this.justPressed.has("KeyN")) {
      const order = ["MAP-A1", "MAP-A2", "MAP-A3", "MAP-A4", "MAP-A5"];
      const next = order[(order.indexOf(this.world.location) + 1) % order.length] ?? "MAP-A1";
      this.world.firstKills.add("BOSS-CH1");
      this.world.returnToTown();
      this.world.enter(next, this.rng);
      this.enterLocation(next);
      const boss = this.mapDef.boss;
      if (boss) {
        this.player.pos.x = boss.pos.x - 9;
        this.player.pos.y = boss.pos.y;
        this.lastPos = { ...this.player.pos };
        this.cameras.main.centerOn(this.player.pos.x * M, this.player.pos.y * M);
      }
      return;
    }
    // 薬瓶（Q：HP瓶、E：MP瓶）
    if (this.justPressed.has("KeyQ")) {
      this.hpFlask.use(this.fighter.maxHp, this.gearFlaskBonus());
    }
    if (this.justPressed.has("KeyE")) {
      this.mpFlask.use(this.fighter.init.maxMp, this.gearFlaskBonus());
    }
    this.fighter.hp = Math.min(
      this.fighter.maxHp,
      this.fighter.hp + this.hpFlask.tick(TICK_SECONDS),
    );
    this.fighter.mp = Math.min(
      this.fighter.init.maxMp,
      this.fighter.mp + this.mpFlask.tick(TICK_SECONDS),
    );
    // 町では、地面の戦闘の対象は人形だけ。町はHPが減らない（敵がいない）
  }

  private gearFlaskBonus(): number {
    return (
      computeGear(this.equipment, GEAR_DATA, this.job.startingStats).totals["薬瓶の回復量"] ?? 0
    );
  }

  /** F：近くの施設・宝箱を調べる。なければ装備を拾う */
  private interact(): boolean {
    const p = this.player.pos;
    if (this.world.inTown) {
      for (const f of FACILITIES) {
        const pos = TOWN_FACILITY_POS[f.id];
        if (Math.hypot(pos.x - p.x, pos.y - p.y) > 3) continue;
        if (
          !facilityUnlocked(f.id, {
            charLevel: this.progression.character.level,
            firstKills: this.world.firstKills,
          })
        ) {
          this.notice = `${f.name}はまだ使えない`;
          this.noticeLeft = 3;
          return true;
        }
        this.openFacility(f.id);
        return true;
      }
    }
    const region = this.world.region;
    const secret = this.mapDef.secret;
    if (
      region &&
      secret &&
      !region.secretOpen &&
      Math.hypot(secret.bush.x - p.x, secret.bush.y - p.y) <= 2.5
    ) {
      region.secretOpen = true;
      this.walls = this.walls.filter((w) => w !== secret.door);
      this.doorObj?.destroy();
      const chest = {
        id: `${this.mapDef.id}-SECRET`,
        kind: "chest" as const,
        pos: secret.chest,
        opened: false,
      };
      region.containers.push(chest);
      this.containerViews.set(
        chest.id,
        this.add.rectangle(chest.pos.x * M, chest.pos.y * M, 14, 10, 0xd8a24a).setDepth(-2),
      );
      if (!this.world.foundSecrets.has(this.mapDef.id)) {
        this.world.foundSecrets.add(this.mapDef.id);
        this.explorationPoints += 1;
        this.notice = "隠し部屋を見つけた（隠し星+1）";
        this.noticeLeft = 5;
        this.refreshPoints();
      } else {
        this.notice = "隠し部屋が開いた";
        this.noticeLeft = 3;
      }
      return true;
    }
    if (region) {
      for (const c of region.containers) {
        if (c.opened || Math.hypot(c.pos.x - p.x, c.pos.y - p.y) > 2) continue;
        c.opened = true;
        this.containerViews.get(c.id)?.setFillStyle(0x444444);
        const drop = rollDrops(
          GENERATION_DATA,
          {
            source: c.kind,
            enemyLevel: region.map.sections[0]?.levelMax ?? 1,
            generate: {},
            uid: () => `itm_${String(this.itemSerial++).padStart(6, "0")}`,
          },
          this.rng,
        );
        this.loot.spawn(c.pos, drop);
        return true;
      }
    }
    return false;
  }

  private openFacility(id: FacilityId): void {
    this.panelCursor = 0;
    switch (id) {
      case "SMITH":
        this.panel = "smith";
        break;
      case "STAR_READER":
        this.panel = "star";
        break;
      case "MERCHANT":
        this.panel = "merchant";
        break;
      case "STASH":
        this.panel = "stash";
        break;
      case "TELEPORT":
        this.panel = "teleport";
        break;
      case "TEMPLE":
        this.panel = "temple";
        break;
      case "ALTAR":
        this.panel = "altar";
        break;
      case "DUMMY":
        this.notice = "訓練用の人形：叩くとダメージが出る";
        this.noticeLeft = 3;
        break;
    }
  }

  /** 町の施設の画面（商人・倉庫・転移の石・転職神殿） */
  private updateFacilityPanel(): boolean {
    const jp = this.justPressed;
    this.panelText.setPosition(30, 30);
    this.panelTip.setPosition(330, 30);
    const move = (jp.has("ArrowDown") ? 1 : 0) - (jp.has("ArrowUp") ? 1 : 0);
    if (this.panel === "loadout") {
      const slots = [1, 2, 3];
      this.panelCursor = Math.max(0, Math.min(slots.length - 1, this.panelCursor + move));
      const id = slots[this.panelCursor] as number;
      const current = this.loadouts.find((l) => l.id === id);
      if (jp.has("KeyS")) {
        // 今のビルドを、この番号に保存する
        putLoadout(this.loadouts, captureLoadout(this.liveHost(), id, `ロードアウト${String(id)}`));
        this.activeLoadout = id;
        this.notice = `ロードアウト${String(id)}に保存した`;
        this.noticeLeft = 3;
        if (this.autoSaver.onEvent("respec")) void this.autoSave();
      }
      if (jp.has("Enter") && current) {
        const host = this.liveHost();
        const r = applyLoadout(host, current, GEAR_DATA, {
          inTown: this.world.inTown,
          canUseJob: (jobId) => jobId === this.job.id || this.progression.canChangeJob(jobId).ok,
        });
        if (r.ok) {
          this.syncFromHost(host);
          this.activeLoadout = id;
          this.notice = `ロードアウト${String(id)}に切り替えた${r.emptied.length > 0 ? `（なくなった装備の部位は空き：${r.emptied.join("・")}）` : ""}`;
          if (this.autoSaver.onEvent("respec")) void this.autoSave();
        } else {
          this.notice =
            r.reason === "full" ? "持ち物と倉庫がいっぱいで切り替えられない" : "切り替えられない";
        }
        this.noticeLeft = 4;
      }
      this.panelText.setText(
        `【ロードアウト】町でだけ切り替えられる（今：${String(this.activeLoadout)}番）\n↑↓ 選ぶ / Enter 切り替え / S 今のビルドを保存 / Esc 閉じる\n\n${slots
          .map((n) => {
            const l = this.loadouts.find((x) => x.id === n);
            return `${n === id ? "▶" : " "}${String(n)}番 ${l ? `${l.name}（${l.mainJob === "JOB-WARRIOR" ? "戦士" : "盗賊"}・装備${String(Object.values(l.equipment).filter((u) => u).length)}・星${String(l.starAllocation.length)}）` : "（空き）"}`;
          })
          .join("\n")}`,
      );
      this.panelTip.setText("");
      return true;
    }
    if (this.panel === "altar") {
      const pool = MOTHER_TREE_DROP.uniquePool;
      this.panelCursor = Math.max(0, Math.min(pool.length - 1, this.panelCursor + move));
      const pick = pool[this.panelCursor];
      if (jp.has("Enter") && pick) {
        const r = exchangeTokens(
          this.bossTokens,
          "BOSS-CH1",
          pick,
          pool,
          GENERATION_DATA,
          18,
          () => `itm_${String(this.itemSerial++).padStart(6, "0")}`,
        );
        if (r.ok && r.item) {
          this.bag.add(r.item);
          this.notice = `討伐証を交換した：${UNIQUE_DATA.uniques.get(pick)?.name ?? pick}`;
          if (this.autoSaver.onEvent("trade")) void this.autoSave();
        } else {
          this.notice = `討伐証が足りない（${String(TOKEN_EXCHANGE_COST)}個必要）`;
        }
        this.noticeLeft = 4;
      }
      this.panelText.setText(
        `【討伐の祭壇】討伐証 ${String(this.bossTokens["BOSS-CH1"] ?? 0)}個（${String(TOKEN_EXCHANGE_COST)}個で専用ユニークと交換）\n↑↓ 選ぶ / Enter 交換 / Esc 閉じる\n\n${pool.map((id, i) => `${i === this.panelCursor ? "▶" : " "}${UNIQUE_DATA.uniques.get(id)?.name ?? id}`).join("\n")}`,
      );
      this.panelTip.setText(pick ? (GEAR_DATA.uniques.get(pick)?.fixed ?? []).join("\n") : "");
      return true;
    }
    if (this.panel === "teleport") {
      const regions = ALL_MAPS.filter((m) => m.id !== TOWN_ID);
      this.panelCursor = Math.max(0, Math.min(regions.length - 1, this.panelCursor + move));
      const target = regions[this.panelCursor];
      if (jp.has("Enter") && target) {
        const r = this.world.teleportTo(target.id, this.rng);
        if (r.ok) {
          this.panel = "none";
          this.world.returnToTown();
          this.enterLocation(target.id);
          if (this.autoSaver.onEvent("changeArea")) void this.autoSave();
          return false;
        }
        this.notice = "その地域の転移の石はまだ解放していない";
        this.noticeLeft = 3;
      }
      this.panelText.setText(
        `【転移の石】↑↓ 選ぶ / Enter 移動 / Esc 閉じる\n\n${regions.map((m, i) => `${i === this.panelCursor ? "▶" : " "}${m.name} ${this.world.unlockedTeleports.has(m.id) ? "" : "（未解放）"}`).join("\n")}`,
      );
      this.panelTip.setText("");
      return true;
    }
    if (this.panel === "temple") {
      const jobs = [WARRIOR_JOB, ROGUE_JOB];
      this.panelCursor = Math.max(0, Math.min(jobs.length - 1, this.panelCursor + move));
      const target = jobs[this.panelCursor];
      if (jp.has("KeyY")) {
        this.progression.character.level = Math.max(15, this.progression.character.level);
        this.notice = "開発用：キャラLvを15にした";
        this.noticeLeft = 3;
      }
      if (jp.has("Enter") && target && target !== this.job) {
        const res = this.progression.canChangeJob(target.id);
        if (res.ok) {
          this.progression.changeJob(target.id);
          this.job = target;
          this.fighter = PlayScene.makeFighter(this.job);
          this.board = new StarBoard(
            BOARD_DATA,
            STAR_START_OF_JOB[this.job.id] ?? "STAR-GOU-START",
          );
          this.equipStarting();
          this.notice = `${target.name}に転職した`;
        } else {
          this.notice = "転職はキャラLv15から（Yキーで開発用にLv15にできる）";
        }
        this.noticeLeft = 3;
      }
      if (jp.has("KeyR")) {
        const jb = this.currentJobBoard();
        const ok = jb.respec(this.progression.jobLevel, this.purse);
        this.notice = ok
          ? "職紋盤を振り直した"
          : `金貨が足りない（${String(20 * this.progression.jobLevel)}G）`;
        this.noticeLeft = 3;
        this.applyBoard();
      }
      this.panelText.setText(
        `【転職神殿】↑↓ 選ぶ / Enter 転職（キャラLv15〜）/ R 職紋盤の振り直し / Esc 閉じる\n今のジョブ：${this.job.name}（キャラLv${String(this.progression.character.level)}）\n\n${jobs.map((j, i) => `${i === this.panelCursor ? "▶" : " "}${j.name}`).join("\n")}`,
      );
      this.panelTip.setText("");
      return true;
    }
    if (this.panel === "stash") {
      const entries = [
        ...this.bag.items().map((item) => ({ item, where: "持ち物" as const })),
        ...this.stash.items().map((item) => ({ item, where: "倉庫" as const })),
      ];
      this.panelCursor = Math.max(0, Math.min(entries.length - 1, this.panelCursor + move));
      const cur = entries[this.panelCursor];
      if (jp.has("Enter") && cur) {
        const [from, to] = cur.where === "持ち物" ? [this.bag, this.stash] : [this.stash, this.bag];
        if (!to.full) {
          from.remove(cur.item.uid);
          to.add(cur.item);
        }
      }
      this.panelText.setText(
        `【倉庫】持ち物 ${String(this.bag.count)}/${String(this.bag.capacity)}  倉庫 ${String(this.stash.count)}/${String(this.stash.capacity)}\n↑↓ 選ぶ / Enter 移す / Esc 閉じる\n\n${entries
          .slice(0, 22)
          .map(
            (e, i) =>
              `${i === this.panelCursor ? "▶" : " "}[${e.where}] ${entryLabel({ item: e.item, equipped: false }, GEAR_DATA)}`,
          )
          .join("\n")}`,
      );
      this.panelTip.setText(
        cur
          ? tooltipText(
              { item: cur.item, equipped: false },
              GEAR_DATA,
              this.equipment,
              this.job.startingStats,
              this.job.id,
              false,
              new Set(this.discoveries.all()),
            )
          : "",
      );
      return true;
    }
    // 商人：Tab で買う／売る
    if (jp.has("Tab")) this.listMode = this.listMode === "buy" ? "sell" : "buy";
    const list = this.listMode === "buy" ? this.merchant.stock : this.bag.items();
    this.panelCursor = Math.max(0, Math.min(list.length - 1, this.panelCursor + move));
    const cur = list[this.panelCursor];
    if (jp.has("Enter") && cur) {
      if (this.listMode === "buy") {
        const r = this.merchant.buy(cur.uid, this.bag, this.purse);
        if (!r.ok) this.notice = r.reason === "gold" ? "金貨が足りない" : "持ち物がいっぱい";
        else if (this.autoSaver.onEvent("trade")) void this.autoSave();
      } else {
        this.merchant.sell(cur.uid, this.bag, this.purse);
        if (this.autoSaver.onEvent("trade")) void this.autoSave();
      }
      this.noticeLeft = 3;
    }
    if (jp.has("KeyD")) {
      if (this.merchant.buyAwakeningDust(this.purse)) {
        if (this.autoSaver.onEvent("trade")) void this.autoSave();
      } else {
        this.notice = "金貨が足りない";
        this.noticeLeft = 3;
      }
    }
    this.panelText.setText(
      `【商人】金貨 ${String(this.purse.gold)}  ${this.listMode === "buy" ? "買う" : "売る"}（Tabで切替）\n↑↓ 選ぶ / Enter 決定 / D 目覚めの粉を買う(30G) / Esc 閉じる\n\n${list
        .slice(0, 20)
        .map(
          (e, i) =>
            `${i === this.panelCursor ? "▶" : " "}${entryLabel({ item: e, equipped: false }, GEAR_DATA)}  ${this.listMode === "buy" ? String(10 + 4 * e.ilvl) : String(sellPrice(e))}G`,
        )
        .join("\n")}`,
    );
    this.panelTip.setText(
      cur
        ? tooltipText(
            { item: cur, equipped: false },
            GEAR_DATA,
            this.equipment,
            this.job.startingStats,
            this.job.id,
            false,
            new Set(this.discoveries.all()),
          )
        : "",
    );
    return true;
  }

  /** 倒した敵のドロップを出し、金貨・素材を自動で拾い、Fで装備を拾う */
  private updateLoot(): void {
    for (const enemy of this.enemies) {
      if (enemy.body.hp > 0 || this.dropped.has(enemy)) continue;
      this.dropped.add(enemy);
      const fill = FILL_VALUE[enemy.def.boss ?? enemy.rank];
      this.hpFlask.addFill(fill);
      this.mpFlask.addFill(fill);
      this.fighter.onEnemyKilled(
        enemy.body,
        this.enemies.map((e) => e.body),
      );
      const firstKill = !this.world.firstKills.has(enemy.def.id);
      this.onEnemyDefeated(enemy);
      const source: DropSource = enemy.def.boss ?? enemy.rank;
      if (enemy.def.id === "BOSS-CH1" || enemy.def.id === "BOSS-ABYSS") {
        this.bossDrops(enemy, firstKill);
        continue;
      }
      const classes = Object.entries(this.job.aptitude)
        .filter(([, apt]) => apt === "S" || apt === "A")
        .map(([k]) => k);
      const drop = rollDrops(
        GENERATION_DATA,
        {
          source,
          enemyLevel: enemy.level,
          ...(enemy.def.familyTag ? { family: enemy.def.familyTag } : {}),
          generate: {
            job: { jobId: this.job.id, weaponClasses: classes as never },
          },
          uid: () => `itm_${String(this.itemSerial++).padStart(6, "0")}`,
        },
        this.rng,
      );
      this.loot.spawn(enemy.body.pos, drop);
    }
    for (const picked of this.loot.autoPickup(this.player.pos, this.purse)) {
      this.lootLabels.get(picked)?.destroy();
      this.lootLabels.delete(picked);
    }
    if (this.justPressed.has("KeyF") && !this.interact()) {
      const res = this.loot.pickupNearestItem(this.player.pos, this.bag);
      if (res.reason === "full")
        this.showText(this.player.pos.x, this.player.pos.y, "持ち物がいっぱい", "#ff8a8a", 9);
    }
    // ラベルの更新（拾われたものは消す）
    for (const e of this.loot.entries) {
      if (!this.lootLabels.has(e)) {
        const color =
          e.kind === "item" ? (PlayScene.RARITY_COLOR[e.item.rarity] ?? "#ffffff") : "#d8c36f";
        const name =
          e.kind === "item"
            ? itemBase(e.item.baseId).name
            : e.kind === "gold"
              ? `${String(e.amount)}G`
              : e.id.replace("MAT-", "");
        this.lootLabels.set(
          e,
          this.add
            .text(e.pos.x * M, e.pos.y * M, name, {
              fontFamily: "sans-serif",
              fontSize: "8px",
              color,
            })
            .setOrigin(0.5)
            .setDepth(6),
        );
      }
    }
    for (const [e, label] of this.lootLabels) {
      if (!this.loot.entries.includes(e)) {
        label.destroy();
        this.lootLabels.delete(e);
      }
    }
  }

  private static readonly RARITY_COLOR: Record<string, string> = {
    normal: "#ffffff",
    magic: "#6f9bff",
    rare: "#ffd86b",
    unique: "#ff9b4a",
    set: "#6fdc8a",
    astral: "#c07bff",
  };

  /** 地面に置いた効果（罠・煙玉）を進める */
  private updateGround(): void {
    const bodies = this.targetBodies();
    for (const ev of this.ground.step(TICK_SECONDS, bodies, this.rng)) {
      if (ev.type === "trap") {
        this.onPlayerHit(
          ev.target.id,
          ev.result.damage,
          ev.result.crit,
          ev.result.back,
          ev.result.feedback,
        );
      }
    }
    for (const b of bodies) tickCombatant(b, 0);
    this.groundLayer.clear();
    for (const t of this.ground.traps) {
      this.groundLayer.fillStyle(0xd8c36f, 0.5);
      this.groundLayer.fillCircle(t.pos.x * M, t.pos.y * M, 4);
    }
    for (const sm of this.ground.smokes) {
      this.groundLayer.fillStyle(0xb0b0c0, 0.25);
      this.groundLayer.fillCircle(sm.pos.x * M, sm.pos.y * M, sm.radius * M);
    }
  }

  private onPlayerHit(
    targetId: string,
    damage: number,
    crit: boolean,
    back: boolean,
    feedback: { hitStopSeconds: number; shake: number },
  ): void {
    this.hitStopLeft = Math.max(this.hitStopLeft, feedback.hitStopSeconds);
    this.cameras.main.shake(60, feedback.shake * 0.0008);
    const enemy = this.enemies.find((e) => e.body.id === targetId);
    if (!enemy) return;
    this.showText(
      enemy.body.pos.x,
      enemy.body.pos.y - 0.8,
      `${damage.toFixed(1)}${back ? "（背面）" : ""}`,
      crit ? "#ffd86b" : "#ffffff",
      crit ? 12 : 9,
    );
    alertPack(this.enemies, enemy);
  }

  private flashArea(shape: HitShape, angle: number): void {
    const cx = this.player.pos.x * M;
    const cy = this.player.pos.y * M;
    this.swing.clear();
    this.swing.fillStyle(0xffffff, 0.3);
    this.drawShape(this.swing, shape, cx, cy, angle);
    this.time.delayedCall(120, () => this.swing.clear());
  }

  private drawShape(
    g: Phaser.GameObjects.Graphics,
    shape: HitShape,
    cx: number,
    cy: number,
    angle: number,
  ): void {
    if (shape.kind === "cone") {
      const half = (shape.arcDegrees * Math.PI) / 360;
      g.slice(cx, cy, shape.range * M, angle - half, angle + half);
      g.fillPath();
    } else if (shape.kind === "circle") {
      g.fillCircle(cx, cy, shape.radius * M);
    } else {
      const w = shape.width * M;
      g.save();
      g.translateCanvas(cx, cy);
      g.rotateCanvas(angle);
      g.fillRect(0, -w / 2, shape.length * M, w);
      g.restore();
    }
  }

  /** 左クリックの通常攻撃（仮実装: 通常攻撃は技として扱う単位が決まったら置き換える） */
  private updateAttack(held: boolean): void {
    const weapon = this.fighter.init.weapon;
    if (!this.attack && held && !isDodging(this.player) && this.time.now >= this.busyUntil) {
      this.attack = new AttackRunner(basicAttackTiming(this.fighter.attackSpeed));
      this.attackAngle = this.player.aimAngle;
    }
    if (!this.attack) return;
    const fired = this.attack.step(TICK_SECONDS).length;
    for (let n = 0; n < fired; n++) {
      const spec: HitSpec = {
        shape: { kind: "cone", range: 1.6, arcDegrees: 90 },
        damage: {
          base: {
            physical:
              this.rng.int(Math.round(weapon.min * 100), Math.round(weapon.max * 100)) / 100,
          },
          skillMultiplier: 1,
          generic: { addPct: 0.004 * 20 },
        },
        weaponCrit: weapon.crit,
        accuracy: 100,
      };
      for (const { target, result } of strike(
        this.player.pos,
        this.attackAngle,
        this.targetBodies(),
        spec,
        this.rng,
      )) {
        if (result.hit) this.fighter.gauge.onHit(false);
        this.onPlayerHit(target.id, result.damage, result.crit, result.back, result.feedback);
      }
      this.flashArea(spec.shape, this.attackAngle);
    }
    if (this.attack.done) this.attack = undefined;
  }

  private showText(x: number, y: number, label: string, color: string, size: number): void {
    const t = this.add
      .text(x * M, y * M - 14, label, {
        fontFamily: "monospace",
        fontSize: `${String(size)}px`,
        color,
      })
      .setOrigin(0.5)
      .setDepth(8);
    this.tweens.add({
      targets: t,
      y: t.y - 18,
      alpha: 0,
      duration: 600,
      onComplete: () => {
        t.destroy();
      },
    });
  }

  private updateView(): void {
    this.body.setPosition(this.player.pos.x * M, this.player.pos.y * M);
    // 見た目の向きは8方向に丸める（照準自体は自由な角度）
    const angle = (facing8(this.player.aimAngle) * Math.PI) / 4;
    this.arrow.setPosition(this.body.x + Math.cos(angle) * 12, this.body.y + Math.sin(angle) * 12);
    this.arrow.setRotation(angle);
    this.body.setFillStyle(isDodging(this.player) && !canBeHit(this.player) ? 0xffffff : 0x6fb1d8);
    this.body.setAlpha(isDodging(this.player) ? 0.6 : 1);

    // 動作確認（pnpm smoke など）のための状態の公開
    document.body.dataset["stellaState"] = JSON.stringify({
      location: this.world.location,
      level: this.progression.character.level,
      exp: this.progression.character.exp,
      questPoints: this.quests.questPoints,
      starPoints: this.starPoints,
      deaths: this.world.deaths,
      bag: this.bag.count,
    });
    // ボスのHPバー
    this.bossBar.clear();
    const bossEnemy = this.enemies.find((e) => e.def.boss !== undefined && e.body.hp > 0);
    const engaged = bossEnemy?.script
      ? bossEnemy.script.engaged
      : bossEnemy !== undefined && bossEnemy.state !== "idle";
    if (bossEnemy && engaged) {
      this.bossBar.fillStyle(0x2a1a1a, 0.9);
      this.bossBar.fillRect(120, 22, 400, 8);
      this.bossBar.fillStyle(bossEnemy.body.invulnerable ? 0xaaaaaa : 0xd85a5a, 1);
      this.bossBar.fillRect(
        120,
        22,
        400 * Math.max(0, bossEnemy.body.hp / bossEnemy.body.maxHp),
        8,
      );
      this.bossLabel.setText(
        `${bossEnemy.def.name}${bossEnemy.body.invulnerable ? "（無敵）" : ""}`,
      );
    } else {
      this.bossLabel.setText("");
    }
    this.warn.clear();
    for (const v of this.views) {
      const e = v.enemy;
      const alive = e.body.hp > 0;
      v.body.setVisible(alive);
      v.facing.setVisible(alive && e.def.noFacing !== true);
      v.hp.setVisible(alive);
      if (!alive) continue;
      v.body.setPosition(e.body.pos.x * M, e.body.pos.y * M);
      v.body.setFillStyle(e.state === "down" ? 0xd8c36f : (ENEMY_COLORS[e.def.id] ?? 0x888888));
      v.facing.setPosition(
        e.body.pos.x * M + Math.cos(e.body.facing) * e.body.radius * M,
        e.body.pos.y * M + Math.sin(e.body.facing) * e.body.radius * M,
      );
      v.hp.setPosition(e.body.pos.x * M, e.body.pos.y * M - e.body.radius * M * 1.6);
      v.hp.setScale(Math.max(0, e.body.hp / e.body.maxHp), 1);
    }
    // 予兆：地面の範囲表示
    for (const [enemy, t] of this.telegraphs) {
      this.warn.fillStyle(0xff4a4a, 0.3);
      if (t.at) {
        for (const z of t.at) this.warn.fillCircle(z.pos.x * M, z.pos.y * M, z.radius * M);
      } else {
        this.drawShape(this.warn, t.shape, enemy.body.pos.x * M, enemy.body.pos.y * M, t.angle);
      }
    }

    this.hud.setText(
      `【${this.mapDef.name}】 HP瓶${String(this.hpFlask.charges)}(Q) MP瓶${String(this.mpFlask.charges)}(E)\nHP ${String(Math.ceil(this.fighter.hp))}/${String(this.fighter.init.maxHp)}  MP ${String(Math.floor(this.fighter.mp))}/${String(this.fighter.init.maxMp)}  ${this.fighter.gauge.def.name} ${String(Math.floor(this.fighter.gauge.value))}${this.fighter.gauge.intensified ? "（激化）" : ""}  [${this.job.name} / Kで切替]  気力 ${String(Math.floor(this.player.stamina))}/${String(PLAYER.staminaMax)}\nWASD 移動 / マウス 照準 / 左 通常攻撃・右/1/2/3/4/R で各ジョブの技 6つ / Space 回避${this.noticeLeft > 0 ? `\n★ ${this.notice}` : ""}\n金貨 ${String(this.purse.gold)}${this.savedNote}  持ち物 ${String(this.bag.count)}/${String(this.bag.capacity)}（F で拾う）  敵の命中 ${String(enemyAccuracy(3))}（Lv3）`,
    );
  }
}
