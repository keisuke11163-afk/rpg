// 場の計算：地域（町・ダンジョン。補助仕様書8・9章）と、開発用の試験用の場（地域を渡さないとき）
import {
  type Affinity,
  Character,
  Combatant,
  type ContentDb,
  Cooldowns,
  type DamageAttacker,
  type DamageSkill,
  type DropSource,
  FixedStepClock,
  type Health,
  type HitReport,
  type HitShape,
  type CharacterSheet,
  AutoSaveTimer,
  type CraftBlock,
  type CraftOp,
  craftWithInventory,
  disassembleFromInventory,
  enhanceCost,
  enhanceWithInventory,
  inscribe,
  StarAllocation,
  startNodeOf,
  starPoints,
  type Enemy,
  Equipment,
  type ItemInstance,
  Inventory,
  type Facility,
  type KeptSaveFields,
  type RegionDef,
  inRect,
  rollMerchantStock,
  rollRegionLayout,
  buyAwakeningDust,
  buyItem,
  sellItem,
  transferItem,
  type PlayerProfile,
  type SaveData,
  createStash,
  emptyKeptFields,
  emptyLoadout,
  forgetItem,
  type LoadoutRecord,
  MAX_LOADOUTS,
  toSaveData,
  JobGauge,
  type MvpEquipSlot,
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
  enemyXp,
  length,
  levelGapMultiplier,
  overlapsShape,
  pullTowards,
  resolveHit,
  resolveSkill,
  rollDrops,
  skillBlock,
  staggerProfiles,
  UNIFORM_EFFECTS,
  ALTAR_TOKEN_COST,
  uniqueItem,
  FLASK_FILL,
  FLASK_RULES,
  Flask,
  type FlaskState,
  unlockedSkills,
  buildCharacterSheet,
  compareEquip,
  dualWieldAffinity,
  type EquipComparison,
  itemTooltip,
  type ItemTooltip,
  skillContexts,
  equipFromInventory,
  slotsFor,
  unequipToInventory,
} from "@stella/core";
import { type TextKey, loadGameContent, text } from "@stella/content";
import type { Action } from "../input/actions.ts";
import type { InputFrame } from "../input/frame.ts";
import { EnemyField } from "../world/EnemyField.ts";
import { LootField } from "../world/LootField.ts";

/** 軽装の統一ボーナスの移動速度が続く秒数（仕様書v0.2 3.3：回避した直後0.5秒間）。 */
const LIGHT_UNIFORM_SECONDS = 0.5;
/** 系統詞【獣狩りの】の移動速度が続く秒数（仕様書v0.2 3.6）。 */
const BEAST_HUNT_SECONDS = 3;
import { toMeters } from "../world/units.ts";

/** 試験用の場の大きさ（m）。 */
export const ARENA = { width: 80, height: 40 } as const;

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

// 開発用の機能：試験用の初期の状態の持ち物（補助仕様書14章の MVP の下級の武器を1つずつ。通常のレアリティ・詞なし）
/** 試験用の武器（uid → ベース）。uid は表示の確認・テストで使う。 */
export const TEST_WEAPONS: readonly { readonly uid: string; readonly base: string }[] = [
  { uid: "test-greatsword", base: "BASE-WPN-GREATSWORD-T1" },
  { uid: "test-greataxe", base: "BASE-WPN-GREATAXE-T1" },
  { uid: "test-greatmace", base: "BASE-WPN-GREATMACE-T1" },
  { uid: "test-axe", base: "BASE-WPN-AXE-T1" },
  { uid: "test-longsword", base: "BASE-WPN-LONGSWORD-T1" },
  { uid: "test-dagger", base: "BASE-WPN-DAGGER-T1" },
  { uid: "test-claw", base: "BASE-WPN-CLAW-T1" },
];
/** ジョブの初期装備の武器（補助仕様書3.4。転職したときに持ち替える）。 */
const START_WEAPON: Readonly<Record<string, string>> = {
  "JOB-WARRIOR": "test-greatsword",
  "JOB-ROGUE": "test-dagger",
};

/** 技の枠（補助仕様書1.1：左クリック・右クリック・1〜4 の6枠）。 */
export const SKILL_SLOTS = ["skill1", "skill2", "skill3", "skill4", "skill5", "skill6"] as const;
export type SkillSlot = (typeof SKILL_SLOTS)[number];

export type Loadout = readonly { readonly action: SkillSlot; readonly skill: string }[];
/**
 * 技の枠の初期の並び（ジョブごと）。枠1は通常攻撃（補助仕様書1.1）、残りは覚える順（補助仕様書3.5）。
 * 6つ目より後に覚える技（破軍・罠設置）は、キャラクターの画面で枠に入れる（docs/progress D-U12-9）。
 */
export const DEFAULT_SKILL_SLOTS: Readonly<Record<string, readonly string[]>> = {
  "JOB-WARRIOR": [
    "SKL-BASIC-ATTACK",
    "SKL-WARRIOR-SWEEP",
    "SKL-WARRIOR-CHARGE",
    "SKL-WARRIOR-WARCRY",
    "SKL-WARRIOR-EARTHSPLITTER",
    "SKL-WARRIOR-WHIRLWIND",
  ],
  "JOB-ROGUE": [
    "SKL-BASIC-ATTACK",
    "SKL-ROGUE-FLURRY",
    "SKL-ROGUE-PIERCE",
    "SKL-ROGUE-SHADOWSTEP",
    "SKL-ROGUE-POISON",
    "SKL-ROGUE-SMOKE",
  ],
};
// 開発用の機能：試験用の初期の状態（戦士の出自・キャラLv15・戦士のジョブLv15）
const TEST_START = { level: 15, jobLevel: 15 } as const;

/** ヒットの手応え：止まる時間（秒）と、白く光る時間。 */
const HIT_STOP = 0.05;
const FLASH = 0.08;
/** 当たり判定を見せる時間（秒）。 */
export const SHOW_STRIKE = 0.12;
/** 吸い寄せたとき、これより近くには寄せない（m）。 */
const PULL_MIN_DISTANCE = 1;
/** 一定時間の効果を必ず付け直す間隔に、少しだけ余裕を持たせる（煙の中の敵の命中-30%）。 */
const ZONE_REFRESH = 0.1;

/**
 * 計算の刻みで使う「押した瞬間」の行動。これ以外の押した瞬間の入力は保持しない
 * （まだ使わない行動を保持し続けて、後で古い入力が発動するのを防ぐ）。
 * 回避（U-06）と、技の枠（U-07 の通常攻撃を、U-08 で全ての技の枠に広げた）、
 * 装備を拾う F（U-11）。
 */
const STEP_ACTIONS = [
  "dodge",
  "interact",
  "flaskHp",
  "flaskMp",
  "skill1",
  "skill2",
  "skill3",
  "skill4",
  "skill5",
  "skill6",
] as const satisfies readonly Action[];
type StepAction = (typeof STEP_ACTIONS)[number];

/** 技の実行と、当たった敵の記録（group ごと）。 */
interface Running {
  readonly exec: SkillExecution | LingeringZone;
  readonly hit: Map<string, Set<string>>;
  /** 1回の使用で1体以上に当たったときのゲージ（コンボ点）を、もう得たか。 */
  gained?: boolean;
}

/** 置いた煙玉。 */
export interface SmokeZone {
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
export interface Trap {
  readonly skill: ResolvedSkill;
  readonly center: Vec2;
  readonly radius: number;
  remaining: number;
}

/** 表示用：出た当たり判定（出た時刻つき）。 */
export interface ShownStrike {
  readonly shape: HitShape;
  readonly origin: Vec2;
  readonly facing: number;
  readonly t: number;
}

/** 行動に無い、試験用のキー（G で転職）と確認用の入力。 */
export interface ArenaExtraInput {
  /** Tab を押した瞬間か（武器を替える。技の実行中は替えない）。 */
  readonly switchWeapon?: boolean;
  /** G を押した瞬間か（転職。キャラLv15から。技の実行中は替えない）。 */
  readonly changeJob?: boolean;
}

export interface ArenaSimulationOptions {
  /** ゲームのデータ（既定は loadGameContent()）。 */
  db?: ContentDb;
  /** 人形・敵へのヒットを解決したときに呼ぶ（表示の手応え用。回避されたヒットは呼ばない）。 */
  onHit?: (report: HitReport, at: Vec2) => void;
  /** 試験用の敵を出すか（既定は出す。入力の処理だけを確かめるテストでは出さない）。 */
  enemies?: boolean;
  /** 文字を出す（Lvアップなど。表示用）。 */
  onText?: (label: string, at: Vec2, color: string) => void;
  /** セーブデータから戻したプレイヤー（省略すると試験用の初期の状態）。 */
  profile?: PlayerProfile;
  /** 地域（省略すると開発用の試験用の場）。 */
  region?: RegionDef;
  /** 地域の配置の抽選のシード（入るたびに変える）。 */
  layoutSeed?: string;
  /** 出口に入った（行き先の地域）。 */
  onExit?: (to: string) => void;
  /** 地域で倒れた（町に戻す）。 */
  onDeath?: () => void;
  /** 町の施設を調べた（F）。 */
  onFacility?: (kind: Facility) => void;
  /** 入ったときのHP・MPの割合（地域から地域へ移るとき。省略すると満タン）。 */
  carry?: {
    readonly hp: number;
    readonly mp: number;
    /** 薬瓶の回数と充填（ダンジョンからダンジョンへ。省略すると満タン）。 */
    readonly flasks?: { readonly hp: FlaskState; readonly mp: FlaskState };
  };
}

/** 場に置いた宝箱（補助仕様書9.3。F で開ける）。 */
export interface FieldChest {
  readonly at: Vec2;
  readonly kind: "woodChest" | "oldChest";
  readonly level: number;
  opened: boolean;
}

/** F で調べられる距離（m。施設・宝箱・転移の石）。仮値: 拾う距離（1.5m）より少し広くした（docs/progress D-U18a-3）。 */
export const INTERACT_DISTANCE = 2;

/** クラフトができない理由の表示。 */
const CRAFT_BLOCK_TEXT: Readonly<Record<CraftBlock, string>> = {
  settled: "鍛造負荷が100を超える（定着）",
  rarity: "レアリティが合わない",
  noAffix: "対象の詞が無い",
  sealed: "封詞した詞は調律できない",
  unique: "ユニークはクラフトできない",
  material: "素材が足りない",
};

/** 試験用の場の安全地帯（訓練用の人形の周り。m）。 */
export const SAFE_ZONE_RADIUS = 4;

/** 還星の灯（星辰盤の1ノードを返す。仕様書v0.2 4.13）。 */
export const RETURN_LAMP = "MAT-RETURN-LAMP";

/**
 * 新しいキャラクター（補助仕様書3.4：キャラLv1・ジョブLv1。初期装備は出自の武器。技は通常攻撃と、ジョブLv1で覚える技）。
 * 初期装備の胴（重装・軽装）は、防具のベースが無いので、まだ持たせない（docs/progress Q-U11-2）。
 */
export function newCharacterProfile(db: ContentDb, originId: string, name: string): PlayerProfile {
  const origin = db.jobs.get(originId);
  if (origin === undefined) throw new RangeError(`ジョブ ${originId} がない`);
  const character = new Character({ origin, level: 1 });
  const equipment = new Equipment(db);
  const base = NEW_CHARACTER_WEAPON[originId];
  if (base !== undefined)
    equipment.equip(
      { uid: "itm_000001", base, rarity: "normal", itemLevel: 1, affixes: [] },
      "mainHand",
      true,
    );
  return {
    name,
    character,
    equipment,
    inventory: new Inventory(),
    stash: createStash(),
    skillSlots: new Map(),
    starAllocation: [],
    loadouts: [emptyLoadout(1, origin.id)],
    activeLoadout: 1,
    unlockedRegions: [],
    deathLog: { count: 0, lastCause: null },
    questStages: [],
    secretsFound: [],
    bossKills: {},
    kept: emptyKeptFields(),
  };
}

/** 出自の初期装備の武器（補助仕様書3.4）。 */
const NEW_CHARACTER_WEAPON: Readonly<Record<string, string>> = {
  "JOB-WARRIOR": "BASE-WPN-GREATSWORD-T1",
  "JOB-ROGUE": "BASE-WPN-DAGGER-T1",
};

/** 開発用の機能：試験用の初期の状態（キャラLv15・試験用の武器一式。タイトルの「開発用」から始める）。 */
export function testStartProfile(db: ContentDb): PlayerProfile {
  const origin = db.jobs.get("JOB-WARRIOR");
  if (origin === undefined) throw new Error("戦士のデータがない");
  const character = new Character({
    origin,
    level: TEST_START.level,
    jobLevels: { [origin.id]: TEST_START.jobLevel },
  });
  const inventory = new Inventory();
  const equipment = new Equipment(db);
  for (const w of TEST_WEAPONS) {
    const item = { uid: w.uid, base: w.base, rarity: "normal" as const, itemLevel: 1, affixes: [] };
    if (w.uid === START_WEAPON[origin.id]) equipment.equip(item, "mainHand", true);
    else inventory.addItem(item);
  }
  // 開発用：星辰盤の1ノードの返却を試せるように、還星の灯を持たせる
  inventory.addMaterial(RETURN_LAMP, 5);
  return {
    name: "試験用の戦士",
    character,
    equipment,
    inventory,
    stash: createStash(),
    skillSlots: new Map(),
    starAllocation: [],
    loadouts: [emptyLoadout(1, origin.id)],
    activeLoadout: 1,
    unlockedRegions: [],
    deathLog: { count: 0, lastCause: null },
    questStages: [],
    secretsFound: [],
    bossKills: {},
    kept: emptyKeptFields(),
  };
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
  readonly character: Character;
  /** 訓練用の人形（開発用の試験用の場と、町。ダンジョンには無い）。 */
  readonly dummy: Combatant | undefined;
  /** 地域（開発用の試験用の場なら undefined）。 */
  readonly region: RegionDef | undefined;
  /** 場の広さ（m）。 */
  readonly size: { readonly width: number; readonly height: number };
  /** 置いた宝箱。 */
  readonly chests: FieldChest[] = [];
  /** 解放した転移の石の地域（補助仕様書9.4）。 */
  readonly unlockedRegions: Set<string>;
  /** 死亡の記録（補助仕様書7章）。 */
  deathLog: { count: number; lastCause: string | null };
  /** 終えたクエストの段階（補助仕様書9.6）。 */
  readonly questStages: Set<string>;
  /** 見つけた隠し星（補助仕様書9.5）。 */
  readonly secretsFound: Set<string>;
  /** ボスの敵のID → 倒した回数（補助仕様書11章）。 */
  readonly bossKills: Map<string, number>;
  /** 討伐証のID → 持っている数（仕様書v0.2 3.12）。 */
  readonly bossTokens: Map<string, number>;
  /** 星辰盤のクエストのポイント（星図の欠片）と探索のポイント（隠し星）。 */
  private questPoints: number;
  private explorationPoints: number;
  private lastHitBy: string | null = null;
  /** 薬瓶（補助仕様書6章）。 */
  hpFlask = new Flask();
  mpFlask = new Flask();
  /** プレイヤーの戦う者を作ったときの、魔障が回復し始めるまでの秒数。 */
  private wardDelay = 2;
  private readonly onExit: ((to: string) => void) | undefined;
  private readonly onDeath: (() => void) | undefined;
  private readonly onFacility: ((kind: Facility) => void) | undefined;
  private exited = false;
  /** 試験用の敵（出さない設定なら undefined）。 */
  readonly field: EnemyField | undefined;
  readonly cooldowns = new Cooldowns();
  readonly buffs = new TimedEffects();
  private readonly stepInput = new StepInputBuffer<StepAction>();
  private readonly rng = Rng.fromSeed("arena");
  /** ドロップの抽選（戦闘の乱数の列を変えないように、別の列にする）。 */
  private readonly dropRng = Rng.fromSeed("arena-drops");
  private itemSerial = 0;
  /** 持ち物（補助仕様書13章）。 */
  readonly inventory: Inventory;
  /** 倉庫（町だけで使う。試験用の場では、セーブデータの中身を保つだけ）。 */
  readonly stash: Inventory;
  /** 装備（補助仕様書16章。町でもダンジョンでも着替えられる）。 */
  readonly equipment: Equipment;
  /** キャラクターの名前（セーブデータ）。 */
  readonly name: string;
  /** まだ使っていないセーブデータの項目（保存し直すときに、そのまま戻す）。 */
  private readonly kept: KeptSaveFields;
  /** 自動セーブの時期（試験用の場はダンジョンとして扱う：60秒ごと）。 */
  readonly autosave = new AutoSaveTimer();
  /** 星辰盤の取得（仕様書v0.2 4章。ロードアウトを替えると替わる）。 */
  private starsValue: StarAllocation;
  /** ロードアウト（仕様書v0.2 4.13）。使っているものの装備・星辰盤は、今の状態が正。 */
  private loadoutList: LoadoutRecord[];
  private activeLoadoutId: number;
  /** クラフトの抽選（戦闘・ドロップの乱数の列を変えないように、別の列にする）。 */
  private readonly craftRng = Rng.fromSeed("arena-craft");
  private starVersion = 0;
  private equipmentVersion = 0;
  /** ジョブごとの技の枠。 */
  private readonly skillSlotsByJob = new Map<string, (string | undefined)[]>();
  private sheetValue!: CharacterSheet;
  /** 地面に落ちている物。 */
  readonly loot = new LootField(Rng.fromSeed("arena-loot"));
  private readonly onHit: ((report: HitReport, at: Vec2) => void) | undefined;
  private readonly onText: ((label: string, at: Vec2, color: string) => void) | undefined;
  private jobGaugeValue: JobGauge;
  private smokeList: SmokeZone[] = [];
  private trapList: Trap[] = [];
  private levelUpCount = 0;
  /** 照準の位置（m。影走りの対象・置く技の位置）。 */
  private aimPoint: Vec2 = { x: 0, y: 0 };
  /** プレイヤーの戦う者（HP・状態異常・崩し。敵の攻撃を受ける）。 */
  private playerValue!: Combatant;
  private hitsTakenCount = 0;
  private avoidedAttacks = 0;
  private deathCount = 0;
  private enemyHitCount = 0;
  private attackerVersion = "";
  private current: { slot: SkillSlot; run: Running } | undefined;
  private zoneRuns: Running[] = [];
  private readonly strikes: ShownStrike[] = [];
  private mpValue = 60;
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
    this.onText = options.onText;
    this.tags = new TagIndex(this.db.tags);
    const profile = options.profile ?? testStartProfile(this.db);
    this.name = profile.name;
    this.character = profile.character;
    this.equipment = profile.equipment;
    this.inventory = profile.inventory;
    this.stash = profile.stash;
    this.kept = profile.kept;
    this.region = options.region;
    this.size = options.region?.size ?? ARENA;
    this.onExit = options.onExit;
    this.onDeath = options.onDeath;
    this.onFacility = options.onFacility;
    this.unlockedRegions = new Set(profile.unlockedRegions);
    this.deathLog = { ...profile.deathLog };
    this.questStages = new Set(profile.questStages);
    this.secretsFound = new Set(profile.secretsFound);
    this.bossKills = new Map(Object.entries(profile.bossKills));
    this.bossTokens = new Map(Object.entries(profile.kept.bossTokens));
    this.questPoints = profile.kept.questPoints;
    this.explorationPoints = profile.kept.explorationPoints;
    this.starsValue = new StarAllocation(this.db, profile.starAllocation);
    this.loadoutList = [...profile.loadouts];
    this.activeLoadoutId = profile.activeLoadout;
    for (const [job, slots] of profile.skillSlots) this.skillSlotsByJob.set(job, [...slots]);
    // 拾った物の uid が、持っている物と重ならないように続きの番号から始める
    for (const i of [
      ...this.inventory.items,
      ...this.stash.items,
      ...this.equipment.entries().map(([, x]) => x),
    ]) {
      const m = /^itm_(\d+)$/.exec(i.uid);
      if (m !== null) this.itemSerial = Math.max(this.itemSerial, Number(m[1]));
    }
    this.jobGaugeValue = this.newGauge();
    const region = options.region;
    const start = region?.entrance ?? { x: 12, y: 12 };
    this.motion = new PlayerMotion({ ...start }, undefined, {
      minX: 0.5,
      minY: 0.75,
      maxX: this.size.width - 0.5,
      maxY: this.size.height - 0.25,
    });
    this.refreshAttacker();
    this.playerValue = this.newPlayer();
    this.mpValue = this.maxMp;
    if (options.carry !== undefined) {
      const lost = this.playerValue.health.maxHp * (1 - Math.min(1, Math.max(0, options.carry.hp)));
      if (lost > 0 && options.carry.hp > 0) this.playerValue.health.takeDamage(lost);
      this.mpValue = this.maxMp * Math.min(1, Math.max(0, options.carry.mp));
      if (options.carry.flasks !== undefined) {
        this.hpFlask = new Flask(options.carry.flasks.hp);
        this.mpFlask = new Flask(options.carry.flasks.mp);
      }
    }
    const bounds = {
      minX: 0.5,
      minY: 0.5,
      maxX: this.size.width - 0.5,
      maxY: this.size.height - 0.5,
    };
    if (region === undefined)
      this.field =
        options.enemies === false
          ? undefined
          : new EnemyField(this.db, this.rng.fork("enemies"), bounds);
    else if (region.kind === "dungeon") {
      // 入るたびの配置（補助仕様書9.3）
      const layout = rollRegionLayout(
        this.db,
        region,
        Rng.fromSeed(options.layoutSeed ?? `${region.id}-layout`),
      );
      this.field = new EnemyField(
        this.db,
        this.rng.fork("enemies"),
        bounds,
        [
          ...layout.packs.map((p, i) => ({
            id: `pack-${String(i)}`,
            enemy: p.enemy,
            level: p.level,
            count: p.count,
            at: p.at,
            ranks: p.ranks,
          })),
          // 決まった位置の敵（中ボス）は、入るたびに出る
          ...(region.fixedEnemies ?? []).map((f) => ({
            id: f.id,
            enemy: f.enemy,
            level: f.level,
            count: 1,
            at: f.at,
            ...(f.anchors === undefined ? {} : { anchors: f.anchors }),
          })),
        ],
        false,
      );
      for (const c of layout.chests) this.chests.push({ ...c, opened: false });
    } else this.field = undefined;
    if (region?.kind === "town")
      this.merchantStock.push(
        ...rollMerchantStock(this.db, Rng.fromSeed(options.layoutSeed ?? "merchant"), {
          itemLevel: this.character.level,
          nextUid: () => `itm_${String(++this.itemSerial).padStart(6, "0")}`,
        }),
      );
    const dummyAt =
      region === undefined
        ? DUMMY_POSITION
        : region.facilities?.find((f) => f.kind === "dummy")?.at;
    this.dummy =
      dummyAt === undefined
        ? undefined
        : new Combatant(this.db, {
            id: "dummy",
            team: "enemy",
            position: { ...dummyAt },
            radius: 0.5,
            facing: Math.PI, // 左（プレイヤーの方）を向く
            maxHp: 5000,
            staggerProfile: staggerProfiles(this.db).enemy,
          });
    if (region !== undefined) this.progressQuests({ type: "enterRegion", id: region.id });
  }

  /**
   * ボスを倒した（補助仕様書11章、仕様書v0.2 3.12）：倒した回数・討伐証。初めて倒したときは隠し星（9.5）。
   * 専用ユニーク（初回は確定・2回目以降は確率）は、ユニークの仕組み（U-16）の後。
   */
  private onBossKilled(enemy: Enemy): void {
    const boss = enemy.def.boss;
    if (boss === undefined) return;
    const kills = (this.bossKills.get(enemy.def.id) ?? 0) + 1;
    this.bossKills.set(enemy.def.id, kills);
    this.bossTokens.set(
      boss.tokens.id,
      (this.bossTokens.get(boss.tokens.id) ?? 0) + boss.tokens.count,
    );
    this.onText?.(
      `${text(enemy.def.text as TextKey)}を倒した（討伐証 +${String(boss.tokens.count)}）`,
      this.motion.position,
      "#ffd166",
    );
    // 専用ユニーク（仕様書v0.2 3.12）：初回は確定、2回目以降は確率で1つ
    const pool = boss.uniques;
    if (pool !== undefined && (kills === 1 || this.dropRng.chance(pool.repeatChance))) {
      const base = this.db.itemBases.get(this.dropRng.pick(pool.pool));
      if (base !== undefined)
        this.loot.place(
          {
            itemLevel: enemy.level + 4,
            items: [
              uniqueItem(
                base,
                `itm_${String(++this.itemSerial).padStart(6, "0")}`,
                enemy.level + 4,
              ),
            ],
            jobTargeted: [false],
            gold: 0,
            materials: [],
          },
          enemy.position,
        );
    }
    const secret = boss.firstKillSecret;
    if (secret !== undefined && !this.secretsFound.has(secret.id)) {
      this.secretsFound.add(secret.id);
      this.explorationPoints += secret.explorationPoints;
      this.attackerVersion = "";
      this.onText?.(
        `隠し星を見つけた（星辰盤のポイント +${String(secret.explorationPoints)}）`,
        this.motion.position,
        "#ffd166",
      );
    }
    this.autosave.notify("bossKill");
  }

  /** 討伐の祭壇で交換できる専用ユニーク（討伐証の種類ごとに、その討伐証を落とすボスの候補）。 */
  altarCandidates(): { readonly token: string; readonly bases: readonly string[] }[] {
    const byToken = new Map<string, Set<string>>();
    for (const e of this.db.enemies.values()) {
      const b = e.boss;
      if (b?.uniques === undefined) continue;
      const set = byToken.get(b.tokens.id) ?? new Set<string>();
      for (const id of b.uniques.pool) set.add(id);
      byToken.set(b.tokens.id, set);
    }
    return [...byToken].map(([token, bases]) => ({ token, bases: [...bases] }));
  }

  /**
   * 討伐の祭壇で、討伐証10個を専用ユニーク1つと交換する（町だけ。仕様書v0.2 3.12）。
   * 討伐証が足りない・候補に無い・インベントリがいっぱいなら、何も変えずに false。
   */
  exchangeAtAltar(baseId: string): boolean {
    if (!this.inTown || this.inventory.full) return false;
    const entry = this.altarCandidates().find((c) => c.bases.includes(baseId));
    const base = this.db.itemBases.get(baseId);
    if (entry === undefined || base === undefined) return false;
    const have = this.bossTokens.get(entry.token) ?? 0;
    if (have < ALTAR_TOKEN_COST) return false;
    this.bossTokens.set(entry.token, have - ALTAR_TOKEN_COST);
    const level = Math.max(base.requiredLevel, this.character.level);
    this.inventory.addItem(
      uniqueItem(base, `itm_${String(++this.itemSerial).padStart(6, "0")}`, level),
    );
    this.autosave.notify("trade");
    return true;
  }

  /** 出口が開いているか（requires の敵を一度でも倒したか。A5 は母樹の初回撃破で開く）。 */
  exitOpen(exit: { readonly requires?: { readonly defeated: string } | undefined }): boolean {
    return exit.requires === undefined || (this.bossKills.get(exit.requires.defeated) ?? 0) > 0;
  }

  /** クエストの段階を進める（条件に合う段階を終え、星図の欠片を得る。補助仕様書9.6）。 */
  private progressQuests(event: { type: "enterRegion" | "defeat"; id: string }): void {
    for (const q of this.db.quests.values())
      for (const st of q.stages) {
        if (this.questStages.has(st.id)) continue;
        const t = st.trigger;
        const hit =
          (t.type === "enterRegion" && event.type === "enterRegion" && t.region === event.id) ||
          (t.type === "defeat" && event.type === "defeat" && t.enemy === event.id);
        if (!hit) continue;
        this.questStages.add(st.id);
        this.questPoints += st.questPoints;
        this.attackerVersion = "";
        this.onText?.(
          `${text(q.text as TextKey)}：${text(st.text as TextKey)}（星図の欠片 +${String(st.questPoints)}）`,
          this.motion.position,
          "#ffd166",
        );
      }
  }

  /** 商人の品揃え（町に入るたびに入れ替わる。補助仕様書5章）。 */
  readonly merchantStock: ItemInstance[] = [];

  /** 倉庫へ移す（町だけ。補助仕様書13章）。 */
  toStash(uid: string): boolean {
    if (!this.inSafeZone || !this.inventory.items.some((i) => i.uid === uid)) return false;
    return transferItem(this.inventory, this.stash, uid);
  }

  /** 倉庫から出す（町だけ）。 */
  fromStash(uid: string): boolean {
    if (!this.inSafeZone || !this.stash.items.some((i) => i.uid === uid)) return false;
    return transferItem(this.stash, this.inventory, uid);
  }

  /** 商人に売る（町だけ）。売った装備を登録していたロードアウトは、その部位が空きになる（仕様書v0.2 4.13）。 */
  sell(uid: string): number | undefined {
    if (!this.inTown || !this.inventory.items.some((i) => i.uid === uid)) return undefined;
    const price = sellItem(this.inventory, uid);
    this.loadoutList = forgetItem(this.loadoutList, uid);
    this.autosave.notify("trade");
    return price;
  }

  /** 商人から買う（町だけ）。 */
  buy(uid: string): boolean {
    if (!this.inTown) return false;
    if (!buyItem(this.inventory, this.merchantStock, uid)) return false;
    this.autosave.notify("trade");
    return true;
  }

  /** 商人から目覚めの粉を買う（町だけ）。 */
  buyDust(): boolean {
    if (!this.inTown || !buyAwakeningDust(this.inventory)) return false;
    this.autosave.notify("trade");
    return true;
  }

  /** 町か。 */
  get inTown(): boolean {
    return this.region?.kind === "town";
  }

  /** 近くの、F で調べられるもの（宝箱・隠し星・転移の石・町の施設）。 */
  nearbyInteractable():
    | { readonly kind: "chest"; readonly chest: FieldChest }
    | { readonly kind: "secret"; readonly id: string; readonly points: number }
    | { readonly kind: "stone" }
    | { readonly kind: "facility"; readonly facility: Facility }
    | undefined {
    const p = this.motion.position;
    const near = (q: { x: number; y: number }): boolean =>
      Math.hypot(q.x - p.x, q.y - p.y) <= INTERACT_DISTANCE;
    const chest = this.chests.find((c) => !c.opened && near(c.at));
    if (chest !== undefined) return { kind: "chest", chest };
    const r = this.region;
    if (r === undefined) return undefined;
    const secret = (r.secrets ?? []).find((x) => !this.secretsFound.has(x.id) && near(x.at));
    if (secret !== undefined)
      return { kind: "secret", id: secret.id, points: secret.explorationPoints };
    if (r.kind === "dungeon" && r.teleportStone !== undefined && near(r.teleportStone))
      return { kind: "stone" };
    const f = r.facilities?.find((x) => x.kind !== "dummy" && near(x.at));
    return f === undefined ? undefined : { kind: "facility", facility: f.kind };
  }

  /** F で調べる。宝箱を開ける・転移の石を解放する・施設を使う。何かをしたら true。 */
  private interactWorld(): boolean {
    const t = this.nearbyInteractable();
    if (t === undefined) return false;
    switch (t.kind) {
      case "chest":
        t.chest.opened = true;
        this.dropLoot(t.chest.kind, t.chest.level, t.chest.at);
        return true;
      case "secret":
        this.secretsFound.add(t.id);
        this.explorationPoints += t.points;
        this.attackerVersion = "";
        this.onText?.(
          `隠し星を見つけた（星辰盤のポイント +${String(t.points)}）`,
          this.motion.position,
          "#ffd166",
        );
        return true;
      case "stone":
        if (this.region !== undefined && !this.unlockedRegions.has(this.region.id)) {
          this.unlockedRegions.add(this.region.id);
          this.onText?.("転移の石を解放した", this.motion.position, "#7bd389");
        }
        return true;
      case "facility":
        this.onFacility?.(t.facility);
        return true;
    }
  }

  /** メインジョブ。 */
  get job(): JobDef {
    const j = this.db.jobs.get(this.character.mainJob);
    if (j === undefined) throw new Error(`ジョブ ${this.character.mainJob} がない`);
    return j;
  }
  /** メインジョブの技の並び（技を入れた枠だけ。枠の順）。 */
  get loadout(): Loadout {
    return this.slotSkills(this.job.id).flatMap((skill, i) => {
      const action = SKILL_SLOTS[i];
      return skill === undefined || action === undefined ? [] : [{ action, skill }];
    });
  }

  /** ジョブの技の枠（6つ。空きは undefined）。ジョブごとに残す（転職しても戻せば元の並び）。 */
  private slotSkills(jobId: string): (string | undefined)[] {
    let slots = this.skillSlotsByJob.get(jobId);
    if (slots === undefined) {
      const init = DEFAULT_SKILL_SLOTS[jobId] ?? ["SKL-BASIC-ATTACK"];
      slots = SKILL_SLOTS.map((_, i) => init[i]);
      this.skillSlotsByJob.set(jobId, slots);
    }
    return slots;
  }

  /** 技の枠に入れられる技（通常攻撃と、今のジョブLvで覚えている技）。 */
  assignableSkills(): string[] {
    return ["SKL-BASIC-ATTACK", ...unlockedSkills(this.job, this.character.jobLevel(this.job.id))];
  }

  /**
   * 技の枠に技を入れる（undefined で空ける）。ほかの枠にある技なら、入れ替える。
   * 技の実行中・覚えていない技・範囲外の枠なら、何も変えずに false。
   */
  setSlotSkill(index: number, skill: string | undefined): boolean {
    if (this.current !== undefined) return false;
    if (!(Number.isInteger(index) && index >= 0 && index < SKILL_SLOTS.length)) return false;
    if (skill !== undefined && !this.assignableSkills().includes(skill)) return false;
    const slots = this.slotSkills(this.job.id);
    const other = skill === undefined ? -1 : slots.indexOf(skill);
    if (other >= 0) slots[other] = slots[index];
    slots[index] = skill;
    return true;
  }

  /** 技の枠の技を、入れられる技の順に1つ進める（dir が -1 なら戻す）。最後の次は空き。 */
  cycleSlotSkill(index: number, dir: 1 | -1 = 1): boolean {
    const slots = this.slotSkills(this.job.id);
    const options: (string | undefined)[] = [...this.assignableSkills(), undefined];
    const at = options.indexOf(slots[index]);
    const next = options[(at + dir + options.length) % options.length];
    return this.setSlotSkill(index, next);
  }
  /** メインジョブの職能ゲージ（戦士は闘志・盗賊はコンボ点）。 */
  get jobGauge(): JobGauge {
    return this.jobGaugeValue;
  }
  get maxMp(): number {
    return this.sheetValue.maxMp;
  }
  /** キャラクターの能力値（戦闘の計算と、キャラクターの画面の表示の両方が使う）。 */
  get sheet(): CharacterSheet {
    return this.sheetValue;
  }
  get smokes(): readonly SmokeZone[] {
    return this.smokeList;
  }
  get traps(): readonly Trap[] {
    return this.trapList;
  }
  /** Lv・ジョブLvが上がった回数。 */
  get levelUps(): number {
    return this.levelUpCount;
  }

  /** プレイヤーの戦う者（倒れると、作り直す）。 */
  get player(): Combatant {
    return this.playerValue;
  }
  get playerHealth(): Health {
    return this.playerValue.health;
  }
  /** 敵の攻撃を受けた回数（回避されたヒットを除く）。 */
  get hitsTaken(): number {
    return this.hitsTakenCount;
  }
  /** 敵の攻撃を回避の無敵時間で無効にした回数。 */
  get attacksAvoided(): number {
    return this.avoidedAttacks;
  }
  get deaths(): number {
    return this.deathCount;
  }
  /** プレイヤーの技が敵に当たった回数。 */
  get enemyHits(): number {
    return this.enemyHitCount;
  }

  /**
   * ドロップを抽選して、地面に置く（敵が倒れたとき。確認用にも使う）。
   * ジョブに合わせたドロップは、今のメインジョブ（仕様書v0.2 3.5）。
   */
  dropLoot(source: DropSource, enemyLevel: number, at: Vec2, enemyFamily?: string): void {
    const result = rollDrops(this.db, this.dropRng, {
      source,
      enemyLevel,
      ...(enemyFamily === undefined ? {} : { enemyFamily }),
      mainJob: this.job,
      tags: this.tags,
      nextUid: () => `itm_${String(++this.itemSerial).padStart(6, "0")}`,
    });
    this.loot.place(result, at);
  }

  /** 確認用：プレイヤーの右3mに敵を出す（開発版の確認用）。 */
  spawnEnemy(id: string): string {
    if (this.field === undefined) throw new Error("試験用の敵を出さない設定");
    const p = this.motion.position;
    return this.field.spawn(id, "normal", 5, { x: p.x + 3, y: p.y }, `debug-${id}`).id;
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
  /** 主手の武器（素手なら undefined）。 */
  get weapon(): ItemInstance | undefined {
    return this.equipment.get("mainHand");
  }
  get affinity(): Affinity {
    return this.sheetValue.affinity;
  }
  get attackSpeed(): number {
    return this.sheetValue.attackSpeed;
  }
  get attacker(): DamageAttacker {
    return this.sheetValue.attacker;
  }
  /** 今のメインジョブが二刀流をできるか（片手武器を副手に持てる。仕様書v0.2 3.2）。 */
  get canDualWield(): boolean {
    return dualWieldAffinity(this.job) !== undefined;
  }
  /** 装備を替えられるか（技の実行中は替えない）。 */
  get canChangeEquipment(): boolean {
    return this.current === undefined;
  }

  /**
   * インベントリの装備を装備する。部位を省略すると、武器は主手、ほかは空いている最初の部位（無ければ最初の部位）。
   * 技の実行中・装備できない部位・外れた物が入りきらないときは、何も変えずに false。
   */
  equipFromInventory(uid: string, slot?: MvpEquipSlot): boolean {
    if (!this.canChangeEquipment) return false;
    const item = this.inventory.items.find((i) => i.uid === uid);
    if (item === undefined) return false;
    const target = slot ?? this.defaultSlot(item);
    const base = this.db.itemBases.get(item.base);
    if (target === undefined || base === undefined) return false;
    if (!slotsFor(base, this.canDualWield).includes(target)) return false;
    if (!equipFromInventory(this.inventory, this.equipment, uid, target, this.canDualWield))
      return false;
    this.equipmentChanged();
    return true;
  }

  /**
   * 部位を省略したときに装備する部位：武器は主手（副手には部位を指定して装備する）、
   * ほかは空いている最初の部位（無ければ最初の部位）。装備できなければ undefined（docs/progress D-U12-6）。
   */
  defaultSlot(item: ItemInstance): MvpEquipSlot | undefined {
    const base = this.db.itemBases.get(item.base);
    if (base === undefined) return undefined;
    const slots = slotsFor(base, this.canDualWield);
    if (base.category === "weapon") return "mainHand";
    return slots.find((s) => this.equipment.get(s) === undefined) ?? slots[0];
  }

  /** 星辰盤の取得。 */
  get stars(): StarAllocation {
    return this.starsValue;
  }

  /** ロードアウトの一覧（使っているものは、今の状態で置き換えた形）。 */
  get loadouts(): readonly LoadoutRecord[] {
    return this.loadoutList.map((l) =>
      l.id === this.activeLoadoutId ? this.currentLoadout(l) : l,
    );
  }
  get activeLoadout(): number {
    return this.activeLoadoutId;
  }

  /** 今の状態を、ロードアウトの形にする。 */
  private currentLoadout(base: LoadoutRecord): LoadoutRecord {
    return {
      ...base,
      mainJob: this.character.mainJob,
      equipment: Object.fromEntries(this.equipment.entries().map(([s, i]) => [s, i.uid])),
      starAllocation: [...this.stars.nodes],
    };
  }

  /**
   * 安全地帯か（ロードアウトの切り替え・星辰盤の全体の振り直しは町でだけできる。補助仕様書8章）。
   * 地域では町の中。開発用の試験用の場では、訓練用の人形の周り4m。
   */
  get inSafeZone(): boolean {
    if (this.region !== undefined) return this.region.kind === "town";
    const p = this.motion.position;
    return Math.hypot(p.x - DUMMY_POSITION.x, p.y - DUMMY_POSITION.y) <= SAFE_ZONE_RADIUS;
  }

  /**
   * ロードアウトを切り替える（仕様書v0.2 4.13）。今の装備・星辰盤・メインジョブを今のロードアウトに保存し、
   * 切り替え先の装備（インベントリ・倉庫にある物）・星辰盤・メインジョブにする。まだ無いロードアウトは、今の状態の写しで作る。
   * 持っていない装備・装備できない部位は空きにする。切り替えた後のインベントリが枠を超えるなら、何も変えない。
   */
  switchLoadout(id: number): "ok" | "same" | "notSafe" | "busy" | "inventoryFull" | "unknown" {
    if (!(Number.isInteger(id) && id >= 1 && id <= MAX_LOADOUTS)) return "unknown";
    if (id === this.activeLoadoutId) return "same";
    if (this.current !== undefined) return "busy";
    if (!this.inSafeZone) return "notSafe";
    const here = this.loadoutList.find((l) => l.id === this.activeLoadoutId);
    const saved = this.currentLoadout(
      here ?? emptyLoadout(this.activeLoadoutId, this.character.mainJob),
    );
    const target = this.loadoutList.find((l) => l.id === id) ?? {
      ...saved,
      id,
      name: `ロードアウト${String(id)}`,
    };
    // 切り替えた後のインベントリの数を先に確かめる
    const equipped = new Set(this.equipment.entries().map(([, i]) => i.uid));
    const wanted = new Set(Object.values(target.equipment));
    const fromInventory = [...wanted].filter(
      (u) => !equipped.has(u) && this.inventory.items.some((i) => i.uid === u),
    ).length;
    const toInventory = [...equipped].filter((u) => !wanted.has(u)).length;
    if (this.inventory.items.length - fromInventory + toInventory > this.inventory.capacity)
      return "inventoryFull";
    // 保存
    this.loadoutList = [
      ...this.loadoutList.filter((l) => l.id !== saved.id && l.id !== target.id),
      saved,
      target,
    ].sort((a, b) => a.id - b.id);
    // メインジョブ（転職できるときだけ。docs/progress D-U20-2）
    if (target.mainJob !== this.character.mainJob && this.character.canChangeJob) {
      this.character.changeJob(target.mainJob);
      this.jobGaugeValue = this.newGauge();
    }
    // 装備：今の装備を外して脇に置き、切り替え先の装備を集めて付ける
    const aside = this.equipment.entries().map(([slot]) => this.equipment.unequip(slot));
    const pick = (uid: string): ItemInstance | undefined => {
      const held = aside.find((i) => i?.uid === uid);
      if (held !== undefined) {
        aside.splice(aside.indexOf(held), 1);
        return held;
      }
      return this.inventory.removeItem(uid) ?? this.stash.removeItem(uid);
    };
    const kept: Partial<Record<MvpEquipSlot, string>> = {};
    for (const [slot, uid] of Object.entries(target.equipment) as [MvpEquipSlot, string][]) {
      const item = pick(uid);
      if (item === undefined) continue;
      const base = this.db.itemBases.get(item.base);
      if (base === undefined || !slotsFor(base, this.canDualWield).includes(slot)) {
        this.inventory.addItem(item);
        continue;
      }
      for (const out of this.equipment.equip(item, slot, this.canDualWield))
        this.inventory.addItem(out);
      kept[slot] = uid;
    }
    for (const i of aside) if (i !== undefined) this.inventory.addItem(i);
    this.starsValue = new StarAllocation(this.db, target.starAllocation);
    this.activeLoadoutId = id;
    this.equipmentVersion += 1;
    this.starVersion += 1;
    this.attackerVersion = "";
    this.refreshAttacker();
    this.syncPlayerMaxHp();
    return "ok";
  }

  /** 星辰盤の全体の振り直し（町の星読み師。MVPでは常に無料。仕様書v0.2 4.13・補助仕様書5章）。安全地帯だけ。 */
  resetStars(): boolean {
    if (!this.inSafeZone || this.current !== undefined) return false;
    this.stars.clear();
    this.starsChanged();
    this.autosave.notify("respec");
    return true;
  }

  /** 星辰盤のポイント（キャラLv−1＋クエスト＋探索。仕様書v0.2 4.12）。 */
  get starPoints(): number {
    return starPoints(this.character.level, this.questPoints, this.explorationPoints);
  }

  /** 星辰盤の始点（メインジョブ）。 */
  get starRoot(): string | undefined {
    return startNodeOf(this.db, this.job.id);
  }

  /** 星辰盤のノードを取る。取れなければ false（理由は stars.allocateBlock）。 */
  allocateStar(id: string): boolean {
    if (!this.stars.allocate(id, this.starRoot, this.starPoints)) return false;
    this.starsChanged();
    return true;
  }

  /**
   * 星辰盤のノードを1つ返す（還星の灯を1つ使う。仕様書v0.2 4.13）。
   * 灯が無い・返すと始点からつながらなくなるノードがあるときは、何も変えずに false。
   */
  refundStar(id: string): "ok" | "noLamp" | "blocked" {
    if (!this.stars.canRefund(id, this.starRoot)) return "blocked";
    if (this.inventory.material(RETURN_LAMP) < 1) return "noLamp";
    this.inventory.spendMaterial(RETURN_LAMP, 1);
    this.stars.refund(id, this.starRoot);
    this.starsChanged();
    return "ok";
  }

  private starsChanged(): void {
    this.starVersion += 1;
    this.refreshAttacker();
    this.syncPlayerMaxHp();
  }

  /**
   * 鍛冶屋（インベントリの装備だけ。仕様書v0.2 3.9〜3.11）。操作のたびに自動セーブのきっかけを知らせる。
   * 戻り値は、できたかと、表示する結果。
   */
  smith(
    uid: string,
    action:
      | { readonly kind: "enhance" }
      | { readonly kind: "inscribe"; readonly effect: string }
      | { readonly kind: "disassemble" }
      | CraftOp,
  ): { readonly ok: boolean; readonly message: string } {
    const item = this.inventory.items.find((i) => i.uid === uid);
    if (item === undefined) return { ok: false, message: "インベントリに無い" };
    let result: { ok: boolean; message: string };
    switch (action.kind) {
      case "enhance":
        result = enhanceWithInventory(this.inventory, uid)
          ? { ok: true, message: `+${String((item.enhance ?? 0) + 1)} に強化した` }
          : {
              ok: false,
              message: enhanceCost(item) === undefined ? "強化値の上限" : "素材が足りない",
            };
        break;
      case "inscribe":
        try {
          this.inventory.replaceItem(inscribe(item, action.effect));
          result = { ok: true, message: "銘を刻んだ" };
        } catch (e) {
          result = { ok: false, message: e instanceof Error ? e.message : String(e) };
        }
        break;
      case "disassemble": {
        const got = disassembleFromInventory(this.inventory, uid);
        // その装備を登録していた全てのロードアウトで、その部位を空きにする（仕様書v0.2 4.13）
        this.loadoutList = forgetItem(this.loadoutList, uid);
        result = {
          ok: true,
          message: `分解した（${Object.entries(got)
            .map(([m, n]) => {
              const def = this.db.materials.get(m);
              return `${def === undefined ? m : text(def.text as TextKey)}×${String(n)}`;
            })
            .join("・")}）`,
        };
        break;
      }
      default: {
        const r = craftWithInventory(this.db, this.craftRng, this.inventory, uid, action);
        result =
          typeof r === "string"
            ? { ok: false, message: CRAFT_BLOCK_TEXT[r] }
            : {
                ok: true,
                message: `完了${r.cracked === undefined ? "" : "・亀裂が付いた"}${r.inspired === undefined ? "" : "・霊感で詞のtierが上がった"}`,
              };
      }
    }
    if (result.ok) this.autosave.notify("craft");
    return result;
  }

  /** 今の状態（セーブデータにする元）。 */
  profile(): PlayerProfile {
    return {
      name: this.name,
      character: this.character,
      equipment: this.equipment,
      inventory: this.inventory,
      stash: this.stash,
      skillSlots: this.skillSlotsByJob,
      starAllocation: this.stars.nodes,
      loadouts: this.loadoutList,
      activeLoadout: this.activeLoadoutId,
      unlockedRegions: [...this.unlockedRegions],
      deathLog: { ...this.deathLog },
      questStages: [...this.questStages],
      secretsFound: [...this.secretsFound],
      bossKills: Object.fromEntries(this.bossKills),
      kept: {
        ...this.kept,
        bossTokens: Object.fromEntries(this.bossTokens),
        questPoints: this.questPoints,
        explorationPoints: this.explorationPoints,
      },
    };
  }

  /** セーブデータ（今の版）。 */
  saveData(): SaveData {
    return toSaveData(this.db, this.profile());
  }

  /** 今の技の並びのタグ（ツールチップの「タグが一致すると光る」の文脈）。 */
  private loadoutSkillTags(): string[][] {
    return this.loadout.flatMap((l) => {
      const def = this.db.skills.get(l.skill);
      return def === undefined ? [] : [[...def.tags]];
    });
  }

  /** 今の技の並びの文脈（「タグが一致すると光る」の判定に使う）。 */
  skillContexts(): ReadonlySet<string>[] {
    return skillContexts(this.db, this.tags, this.loadoutSkillTags(), this.sheetValue.weaponTags);
  }

  /** 装備のツールチップの中身（今の能力値・キャラLv・技の並びで判定する）。 */
  tooltip(item: ItemInstance): ItemTooltip {
    return itemTooltip(this.db, item, {
      attributes: this.sheetValue.attributes,
      characterLevel: this.character.level,
      contexts: this.skillContexts(),
    });
  }

  /** 通常攻撃のダメージの計算に渡す形（今の武器で変化を当てはめる。表示・比較の見積もり用）。 */
  basicAttackDamage(): DamageSkill | undefined {
    const basic = this.db.skills.get("SKL-BASIC-ATTACK");
    return basic === undefined
      ? undefined
      : resolveSkill(this.db, basic, {
          stages: [],
          weaponTags: this.tags.closure(this.sheetValue.weaponTags),
          gaugeSpent: 0,
        }).damage;
  }

  /** インベントリの装備を装備したときの比較（装備できなければ undefined）。通常攻撃のダメージの見積もりを含む。 */
  compare(uid: string, slot?: MvpEquipSlot): EquipComparison | undefined {
    const item = this.inventory.items.find((i) => i.uid === uid);
    if (item === undefined) return undefined;
    const target = slot ?? this.defaultSlot(item);
    const base = this.db.itemBases.get(item.base);
    if (target === undefined || base === undefined) return undefined;
    if (!slotsFor(base, this.canDualWield).includes(target)) return undefined;
    const skill = this.basicAttackDamage();
    return compareEquip(
      this.db,
      this.tags,
      {
        character: this.character,
        job: this.job,
        equipment: this.equipment,
        extraEffects: this.buffs.instances(),
      },
      item,
      target,
      { canDualWield: this.canDualWield, ...(skill === undefined ? {} : { skill }) },
    );
  }

  /** 装備を外して、インベントリに戻す。技の実行中・インベントリがいっぱいなら false。 */
  unequip(slot: MvpEquipSlot): boolean {
    if (!this.canChangeEquipment || this.equipment.get(slot) === undefined) return false;
    if (!unequipToInventory(this.inventory, this.equipment, slot)) return false;
    this.equipmentChanged();
    return true;
  }

  private equipmentChanged(): void {
    this.equipmentVersion += 1;
    // 構築の途中（最初の装備）は、能力値の計算を後でまとめて行う
    if ((this.motion as PlayerMotion | undefined) === undefined) return;
    this.refreshAttacker();
    // 最大HPが変わったら、今のHPの割合はそのまま、最大HPを合わせる
    this.syncPlayerMaxHp();
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
    if (extra.changeJob === true) this.changeJob();
    this.aimPoint = { x: toMeters(input.pointerWorld.x), y: toMeters(input.pointerWorld.y) };
    this.stepInput.press(STEP_ACTIONS.filter((a) => input.pressed.has(a)));
    for (let i = 0; i < steps; i++) this.step(input);
    return steps;
  }

  /** 武器を、インベントリの次の武器に替える（技の実行中は替えない）。 */
  switchWeapon(): void {
    if (!this.canChangeEquipment) return;
    const next = this.inventory.items.find(
      (i) => this.db.itemBases.get(i.base)?.category === "weapon",
    );
    if (next !== undefined) this.equipFromInventory(next.uid, "mainHand");
  }

  /** 転職する（戦士と盗賊を順に替える）。武器はジョブの初期装備に持ち替える。 */
  changeJob(): void {
    if (this.current !== undefined || !this.character.canChangeJob) return;
    const jobs = [...this.db.jobs.keys()];
    const next = jobs[(jobs.indexOf(this.job.id) + 1) % jobs.length];
    if (next === undefined || !this.character.changeJob(next)) return;
    // 二刀流ができなくなったら、副手の片手武器を外す（入りきらなければ、そのまま残す）
    const off = this.equipment.get("offHand");
    if (
      off !== undefined &&
      !this.canDualWield &&
      this.db.itemBases.get(off.base)?.category === "weapon"
    )
      unequipToInventory(this.inventory, this.equipment, "offHand");
    const start = START_WEAPON[next];
    if (start !== undefined && this.inventory.items.some((i) => i.uid === start))
      equipFromInventory(this.inventory, this.equipment, start, "mainHand", this.canDualWield);
    this.equipmentVersion += 1;
    this.jobGaugeValue = this.newGauge();
    this.attackerVersion = "";
    this.refreshAttacker();
    this.syncPlayerMaxHp();
  }

  /** 経験値を得る。Lvが上がったら、HPを全回復する（最大HPが変わるため）。 */
  gainXp(amount: number): void {
    const before = this.character.level;
    const r = this.character.gainXp(amount);
    if (r.characterLevels > 0 || r.jobLevels > 0) {
      this.levelUpCount += r.characterLevels + r.jobLevels;
      this.attackerVersion = "";
      this.refreshAttacker();
      if (this.character.level !== before) this.playerValue = this.newPlayer();
      this.onText?.(
        `${r.characterLevels > 0 ? `Lv${String(this.character.level)}` : ""}${r.jobLevels > 0 ? ` ジョブLv${String(this.character.jobLevel(this.job.id))}` : ""}`,
        this.motion.position,
        "#7bd389",
      );
    }
  }

  /** 確認用：職能ゲージの量を決める（開発版の確認・テストで、激化・解放を短い時間で試すため）。 */
  setFervor(value: number): number {
    this.jobGaugeValue.spend("all");
    this.jobGaugeValue.add(value);
    this.jobGaugeValue.markCombat();
    return this.jobGaugeValue.value;
  }

  /** 技が使えない理由（使えるなら undefined）。 */
  blockOf(skillId: string): SkillBlock | "locked" | "target" | undefined {
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
      mp: this.mpValue,
      gauge: this.jobGaugeValue.value,
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
    const d = t.radius + this.playerValue.radius + gap;
    return { x: t.position.x + Math.cos(away) * d, y: t.position.y + Math.sin(away) * d };
  }

  /** 直近5秒のDPS（表示用）。 */
  dps(): number {
    while ((this.recentDamage[0]?.t ?? Infinity) < this.elapsed - 5) this.recentDamage.shift();
    return this.recentDamage.reduce((s, d) => s + d.amount, 0) / 5;
  }

  /** プレイヤーの戦う者（最大HPは、能力値の評価の値）。 */
  private newPlayer(): Combatant {
    const d = this.sheetValue.defense;
    const c = new Combatant(this.db, {
      id: "player",
      team: "player",
      position: this.motion.position,
      radius: 0.35,
      maxHp: this.sheetValue.maxHp,
      maxWard: d.maxWard,
      wardRechargeDelay: d.wardRechargeDelay,
      staggerProfile: staggerProfiles(this.db).player,
    });
    this.applyDefense(c);
    return c;
  }

  /** 能力値の受ける側の値（防具値・回避値・耐性・受けるダメージと崩し値の倍率）を、プレイヤーに渡す。 */
  private applyDefense(c: Combatant): void {
    const d = this.sheetValue.defense;
    c.armor = d.armor;
    c.evasion = d.evasion;
    c.resist = { ...d.resist };
    c.ownReceived = { damage: d.damageTaken, stagger: d.staggerTaken };
  }

  /** メインジョブの職能ゲージ（メインジョブのものだけが有効。仕様書5章）。 */
  private newGauge(): JobGauge {
    const g = this.db.gauges.get(this.job.gauge ?? "");
    if (g === undefined) throw new Error(`ジョブ ${this.job.id} の職能ゲージがない`);
    return new JobGauge(g);
  }

  /** プレイヤーの技の対象（訓練用の人形と、生きている敵）。 */
  private targets(): Combatant[] {
    return [...(this.dummy === undefined ? [] : [this.dummy]), ...(this.field?.targets() ?? [])];
  }

  /** 効果（戦吼の強化など）・Lv・ジョブ・装備が変わったら、能力値を計算し直す（キャラクターの画面と同じ計算）。 */
  private refreshAttacker(): void {
    const version = `${String(this.buffs.version)}|${String(this.character.level)}|${this.job.id}|${String(this.equipmentVersion)}|${String(this.starVersion)}`;
    if (this.attackerVersion === version) return;
    this.attackerVersion = version;
    this.sheetValue = buildCharacterSheet(this.db, this.tags, {
      character: this.character,
      job: this.job,
      equipment: this.equipment,
      extraEffects: this.buffs.instances(),
      starBoard: { allocation: this.stars.nodes, points: this.starPoints },
    });
    this.mpValue = Math.min(this.mpValue, this.sheetValue.maxMp);
    // 職能ゲージの獲得量（職詞。メインジョブの条件は効果の側で判定する）
    this.jobGaugeValue.gainMultiplier = Math.max(
      0,
      1 + this.sheetValue.evaluated.view.stat("STAT-GAUGE-GAIN").increased,
    );
  }

  /**
   * 最大HPが変わったとき（装備・転職）、HPの割合を保って作り直す（着替えで全回復しないように）。
   * 試験用の場では、状態異常・崩しは引き継がない（docs/progress D-U12-5）。
   */
  private syncPlayerMaxHp(): void {
    // 構築の途中（最初の装備）は、まだプレイヤーがいない
    const player = this.playerValue as Combatant | undefined;
    const old = player?.health;
    if (old === undefined || player === undefined) return;
    this.applyDefense(player);
    if (
      old.maxHp === this.sheetValue.maxHp &&
      old.maxWard === this.sheetValue.defense.maxWard &&
      this.wardDelay === this.sheetValue.defense.wardRechargeDelay
    )
      return;
    const ratio = old.hp / old.maxHp;
    this.playerValue = this.newPlayer();
    this.wardDelay = this.sheetValue.defense.wardRechargeDelay;
    const lost = this.sheetValue.maxHp * (1 - ratio);
    if (lost > 0 && ratio > 0) this.playerValue.health.takeDamage(lost);
  }

  private startSkill(slot: SkillSlot, skillId: string): void {
    const def = this.db.skills.get(skillId);
    if (def === undefined) return;
    // 終結技は、使う前のゲージの量で強さが決まる
    const cost = def.gauge?.cost;
    const spent = cost === "all" ? this.jobGaugeValue.value : (cost ?? 0);
    const resolved: ResolvedSkill = resolveSkill(this.db, def, {
      stages: this.jobGaugeValue.stages,
      weaponTags: this.tags.closure(this.sheetValue.weaponTags),
      // 職詞「終結技のコンボ点+1として扱う」（終結技だけ。ゲージから減る量は変わらない）
      gaugeSpent:
        def.finisher === undefined
          ? spent
          : spent + this.sheetValue.evaluated.view.stat("STAT-FINISHER-POINTS").value,
    });
    let teleportTo: Vec2 | undefined;
    if (def.action.type === "teleport") {
      const t = this.stepTarget(def.action.range);
      if (t === undefined) return;
      teleportTo = this.behind(t, def.action.behind);
    }
    this.mpValue -= def.mpCost;
    this.cooldowns.start(def.id, def.cooldown);
    if (def.gauge?.cost !== undefined) this.jobGaugeValue.spend(def.gauge.cost);
    if (def.gauge?.gainOnUse !== undefined) this.jobGaugeValue.add(def.gauge.gainOnUse);
    this.jobGaugeValue.markCombat();
    for (const e of def.selfEffects ?? [])
      this.buffs.add(e.effect, e.duration * this.sheetValue.effectDuration, def.id);
    this.lastSkillValue = { id: def.id, variants: resolved.variants };
    this.useCounts.set(def.id, (this.useCounts.get(def.id) ?? 0) + 1);
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

  private step(input: InputFrame): void {
    const dt = this.clock.stepSeconds;
    // 試験用の場はダンジョンとして扱う（60秒ごとの自動セーブ。補助仕様書15章）
    this.autosave.tick(dt, true);
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
    const dodgePressed = this.stepInput.take("dodge");
    const interact = this.stepInput.take("interact");
    // 薬瓶（補助仕様書6章）：最大値×割合×（1＋腰の装備などの回復量）を1.5秒かけて回復する
    const recovery = Math.max(
      0,
      1 + this.sheetValue.evaluated.view.stat("STAT-FLASK-RECOVERY").increased,
    );
    if (this.stepInput.take("flaskHp") && !this.playerValue.health.dead)
      this.hpFlask.use(this.playerValue.health.maxHp * FLASK_RULES.hpRatio * recovery);
    if (this.stepInput.take("flaskMp") && !this.playerValue.health.dead)
      this.mpFlask.use(this.maxMp * FLASK_RULES.mpRatio * recovery);
    const pressed = new Set<SkillSlot>();
    for (const a of SKILL_SLOTS) if (this.stepInput.take(a)) pressed.add(a);
    const held = (slot: SkillSlot): boolean => input.held.has(slot);
    // よろめいている間は、移動・技・回避ができない（補助仕様書3.3）。押した回避は使われずに消える
    const staggered = this.playerValue.stagger.broken;
    if (staggered) this.current = undefined;
    const dodge = dodgePressed && !staggered;
    if (dodge) this.current = undefined; // 回避で技を取り消せる

    // 技を使い始める（照準の方向へ）。枠の順に、使えるものを1つ。押し続けている間は繰り返し使う（補助仕様書1.1）
    if (this.current === undefined && !this.motion.dodging && !dodge && !staggered) {
      const use = this.loadout.find(
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
        for (const e of w.allyEffects)
          this.buffs.add(e, w.duration * this.sheetValue.effectDuration, exec.skill.def.id);
        for (const t of this.targets()) {
          const dist = length({ x: t.position.x - w.origin.x, y: t.position.y - w.origin.y });
          if (dist > w.radius + t.radius) continue;
          for (const e of w.enemyEffects) t.statuses.add(e, w.duration, exec.skill.def.id);
        }
        this.showShape({ type: "circle", radius: w.radius }, w.origin, 0);
      }
      if (tick.pull !== undefined) {
        const p = tick.pull;
        for (const t of this.targets()) {
          const d = t.position;
          const movable = this.field?.byCombatant(t)?.def.moveSpeed !== 0;
          const inside = length({ x: d.x - p.origin.x, y: d.y - p.origin.y }) <= p.radius;
          if (!t.isBoss && movable && inside)
            t.position = pullTowards(d, p.origin, p.speed * dt, PULL_MIN_DISTANCE);
        }
      }
      for (const z of tick.zones) this.zoneRuns.push({ exec: z, hit: new Map() });
      if (tick.selfBuff !== undefined) {
        for (const e of tick.selfBuff.effects)
          this.buffs.add(
            e,
            tick.selfBuff.duration * this.sheetValue.effectDuration,
            exec.skill.def.id,
          );
      }
      if (tick.zone !== undefined) {
        const z = tick.zone;
        this.smokeList.push({
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
        this.trapList.push({
          skill: exec.skill,
          center: t.center,
          radius: t.radius,
          remaining: t.duration,
        });
        // 同時に置ける数を超えたら、古いものから消える
        while (this.trapList.length > t.max) this.trapList.shift();
      }
      moveMultiplier = tick.moveMultiplier;
      if (tick.finished) this.current = undefined;
    }
    for (const z of this.zoneRuns) this.resolveStrikes(z, (z.exec as LingeringZone).update(dt));
    this.updateSmokes(dt);
    this.updateTraps(dt);
    this.zoneRuns = this.zoneRuns.filter((z) => !(z.exec as LingeringZone).done);

    const wasDodging = this.motion.dodging;
    this.motion.update(dt, {
      move: staggered ? ZERO : input.move,
      aim: this.current === undefined && !staggered ? aim : ZERO,
      dodge,
      // 技の移動の倍率 × 能力値の移動速度（大盾・重鎖の帯・亀裂・移動速度の詞など）
      speedMultiplier: moveMultiplier * this.sheetValue.moveSpeed,
    });
    // 軽装の統一ボーナス：回避した直後0.5秒間、移動速度+20%（仕様書v0.2 3.3）。回避が終わった瞬間から数える
    const dodgeEnded = wasDodging && !(this.motion.dodging as boolean);
    if (dodgeEnded && this.sheetValue.uniform === "light")
      this.buffs.add(UNIFORM_EFFECTS.light, LIGHT_UNIFORM_SECONDS, "uniform-light");
    this.playerValue.position = this.motion.position;
    this.playerValue.moving = length(input.move) > 0 && !staggered;

    // 敵の行動と攻撃
    this.field?.update(dt, this.playerValue, this.motion.invulnerable, this.motion.facing, {
      onPlayerHit: (report, enemy) => {
        if (report.hit.evaded) return;
        this.hitsTakenCount += 1;
        this.lastHitBy = enemy.def.id;
        this.jobGaugeValue.onDamageTaken(
          report.applied.toHp + report.applied.toWard,
          this.playerValue.health.maxHp,
        );
      },
      onAvoided: () => {
        this.avoidedAttacks += 1;
      },
      onBossEvent: (enemy, event, phase) => {
        const label =
          event === "phase"
            ? `${text(enemy.def.text as TextKey)}：第${String(phase)}段階`
            : event === "burrow"
              ? "根渡り：地中に潜った"
              : "根渡り：現れた";
        this.onText?.(label, enemy.position, event === "phase" ? "#ff9f43" : "#c8a2ff");
      },
      onEnemyKilled: (enemy) => {
        // 経験値（補助仕様書4.2）：5＋2×敵のLv、格の倍率（中ボス・章ボスは種類の倍率）、Lvの差の補正
        this.gainXp(
          enemyXp(enemy.level, enemy.def.xpMultiplier ?? enemy.rank.xpMultiplier) *
            levelGapMultiplier(this.character.level, enemy.level),
        );
        this.progressQuests({ type: "defeat", id: enemy.def.id });
        if (enemy.def.boss !== undefined) this.onBossKilled(enemy);
        // 薬瓶の充填（補助仕様書6章。HP瓶とMP瓶は別にたまる）
        const fill = FLASK_FILL[enemy.def.dropSource ?? enemy.rank.rank];
        this.hpFlask.addFill(fill);
        this.mpFlask.addFill(fill);
        // 系統詞【獣狩りの】：獣を倒すと3秒間移動速度+15%（仕様書v0.2 3.6）
        if (
          enemy.def.family !== undefined &&
          this.tags.closure([enemy.def.family]).has("TAG-FAMILY-BEAST") &&
          this.sheetValue.evaluated.view.stat("STAT-BEAST-HUNT").value > 0
        )
          this.buffs.add("EFF-BUFF-BEAST-HUNT", BEAST_HUNT_SECONDS, "beast-hunt");
        // ドロップ（仕様書v0.2 3.5、補助仕様書12章）。敵の格（通常・魔法・精鋭）がドロップの出どころ
        this.dropLoot(
          enemy.def.dropSource ?? enemy.rank.rank,
          enemy.level,
          enemy.position,
          enemy.def.family,
        );
      },
    });

    // 拾う（補助仕様書13章）：金貨・素材は近づくと自動で、装備は F で。F は先に宝箱・転移の石・施設を調べる
    this.loot.autoPickup(this.motion.position, this.inventory);
    if (interact && !this.interactWorld()) {
      const r = this.loot.pickNearestItem(this.motion.position, this.inventory);
      if (r.kind === "full")
        this.onText?.("インベントリがいっぱい", this.motion.position, "#ff6b6b");
    }
    // 出口（その範囲に入ると、別の地域へ移る）。閉じている出口は通れない
    if (!this.exited)
      for (const x of this.region?.exits ?? [])
        if (inRect(this.motion.position, x.rect) && this.exitOpen(x)) {
          this.exited = true;
          this.autosave.notify("changeRegion");
          this.onExit?.(x.to);
          break;
        }

    const dot = this.dummy?.update(dt) ?? 0;
    if (dot > 0) this.recentDamage.push({ t: this.elapsed, amount: dot });
    const playerDot = this.playerValue.update(dt);
    if (playerDot > 0) this.jobGaugeValue.onDamageTaken(playerDot, this.playerValue.health.maxHp);
    // 死亡（補助仕様書7章）：回数と原因を記録する。地域では町に戻す（アイテム・経験値は失わない）。
    // 開発用の試験用の場では、その場で全回復する
    if (this.playerValue.health.dead && !this.exited) {
      this.deathCount += 1;
      this.deathLog = { count: this.deathLog.count + 1, lastCause: this.lastHitBy };
      if (this.region !== undefined) {
        this.exited = true;
        this.autosave.notify("enterTown");
        this.onDeath?.();
      } else this.playerValue = this.newPlayer();
    }
    this.mpValue = Math.min(this.maxMp, this.mpValue + this.maxMp * 0.06 * dt);
    const flaskHp = this.hpFlask.update(dt);
    if (flaskHp > 0 && !this.playerValue.health.dead) this.playerValue.health.heal(flaskHp);
    this.mpValue = Math.min(this.maxMp, this.mpValue + this.mpFlask.update(dt));
    this.cooldowns.update(dt);
    this.buffs.update(dt);
    this.jobGaugeValue.update(dt);
    this.refreshAttacker();
    this.elapsed += dt;
    if (this.region === undefined) this.updateHazard();
    if (this.dummy !== undefined && this.dummy.health.hp < this.dummy.health.maxHp * 0.2)
      this.dummy.health.restoreFull();
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
    this.jobGaugeValue.onHitDealt(this.tags.closure(first.skill.damage.tags));
    // コンボ点：1回の使用で、1体以上に当たれば1回だけ増える（docs/progress D-U10-1）
    const gain = first.skill.def.gauge?.gainOnHit;
    if (gain !== undefined && run.gained !== true) {
      run.gained = true;
      this.jobGaugeValue.add(gain);
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
    // 背面からの補正：メインジョブの職能（盗賊）＋短剣の基本刻印「背面からの会心率+5%（固定値）」（その武器のヒットだけ）
    const view = this.sheetValue.evaluated.view;
    const weaponUid = damage.kind === "weapon" ? this.sheetValue.attacker.weapon?.uid : undefined;
    const scope = { weaponUid };
    const jobBonus = this.job.backstabBonus;
    const extraCrit = view.stat("STAT-BACKSTAB-CRIT", [], scope).value;
    const bonus =
      jobBonus === undefined && extraCrit === 0
        ? undefined
        : {
            critChance: (jobBonus?.critChance ?? 0) + extraCrit,
            ailmentChance: jobBonus?.ailmentChance ?? 0,
          };
    const report = resolveHit({
      db: this.db,
      attacker: this.sheetValue.attacker,
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
    if (t !== this.dummy) this.field?.onEnemyHit(t);
    if (t === this.dummy) this.lastReport = report;
    if (report.hit.evaded) return false;
    // 爪の基本刻印「ヒットでHP吸収0.5%」：与えたダメージの割合だけHPを回復する（その武器のヒットだけ）
    const leech = view.stat("STAT-LIFE-LEECH", [], scope).value;
    const dealt = report.applied.toHp + report.applied.toWard;
    if (leech > 0 && dealt > 0) this.playerValue.health.heal(dealt * leech);
    this.hitStopLeft = HIT_STOP;
    if (t === this.dummy) {
      this.dummyHits += 1;
      this.recentDamage.push({ t: this.elapsed, amount: report.hit.total });
      this.flashLeft = FLASH;
    } else this.enemyHitCount += 1;
    this.onHit?.(report, t.position);
    return true;
  }

  /** 煙玉：中の敵に命中-30%をかけ続け、間隔ごとに衰弱を必ず付ける（仕様書v0.2 5.6）。 */
  private updateSmokes(dt: number): void {
    for (const z of this.smokeList) {
      z.remaining -= dt;
      z.untilNext -= dt;
      const pulse = z.untilNext <= 1e-9;
      if (pulse) z.untilNext += z.interval;
      const def = z.ailment === undefined ? undefined : this.db.ailmentsByTag.get(z.ailment);
      for (const t of this.targets()) {
        const dist = length({ x: t.position.x - z.center.x, y: t.position.y - z.center.y });
        if (dist > z.radius + t.radius) continue;
        for (const e of z.enemyEffects) t.statuses.add(e, dt + ZONE_REFRESH, z.skill);
        if (pulse && def !== undefined && (def.kind === "debuff" || def.kind === "dot")) {
          t.ailments.apply({
            ailmentId: def.id,
            tag: def.tag,
            total: 0,
            duration: def.duration,
            maxStacks: 1,
          });
          if (t !== this.dummy) this.field?.onEnemyHit(t);
        }
      }
    }
    this.smokeList = this.smokeList.filter((z) => z.remaining > 1e-9);
  }

  /** 罠：敵が踏むと起爆する（起爆したときの能力値で計算する。主手の武器のヒット）。 */
  private updateTraps(dt: number): void {
    const left: Trap[] = [];
    for (const trap of this.trapList) {
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
    this.trapList = left;
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
      const taken = this.playerValue.health.takeDamage(5);
      this.jobGaugeValue.onDamageTaken(taken.toHp + taken.toWard, this.playerValue.health.maxHp);
    }
  }
}
