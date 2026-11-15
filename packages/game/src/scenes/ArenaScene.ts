// 場の描画と入力：地域（町・ダンジョン。補助仕様書8・9章）と、開発用の試験用の場
import Phaser from "phaser";
import {
  type ContentDb,
  type Facility,
  type FlaskState,
  type HitReport,
  type HitShape,
  JOB_CHANGE_LEVEL,
  MVP_EQUIP_SLOTS,
  type PlayerProfile,
  SaveDataError,
  SaveStore,
  type Vec2,
} from "@stella/core";
import { loadGameContent } from "@stella/content";
import { text, type TextKey } from "@stella/content";
import { LocalStorageBackend } from "../save/LocalStorageBackend.ts";
import { sfx } from "../audio/sfx.ts";
import {
  SfxEventTracker,
  type SfxKey,
  SfxLimiter,
  hitSfx,
  skillUseSfx,
} from "../audio/sfx-events.ts";
import { roundShake, ScreenShake, shakeOffsetWithinBounds } from "../ui/screen-shake.ts";
import { EquipmentPanel } from "../ui/EquipmentPanel.ts";
import { Hud } from "../ui/Hud.ts";
import {
  CooldownTracker,
  FACILITY_TEXT,
  HudEventTracker,
  type HudModel,
  ailmentsOf,
  buildHudModel,
  fill,
  promptOf,
  shortBindingName,
} from "../ui/hud-model.ts";
import { itemName } from "../ui/item-text.ts";
import { BIG_MAP, MINIMAP, type MinimapMarkKind, minimapMarks } from "../ui/minimap.ts";
import {
  DEFAULT_SETTINGS,
  type Settings,
  bindingName,
  bindingsToKeybinds,
  effectiveBindings,
  keybindsToBindings,
  scaleFits,
} from "../settings/settings.ts";
import { loadSettings, saveSettings } from "../settings/storage.ts";
import { BOARD_AREA } from "../ui/star-board-view.ts";
import { exposeDebug } from "../debug.ts";
import type { Action } from "../input/actions.ts";
import { type InputFrame, InputSystem } from "../input/InputSystem.ts";
import { EnemyFieldView } from "../world/EnemyFieldView.ts";
import { LootView } from "../world/LootView.ts";
import { TEXTURES, playerTexture } from "../world/placeholders.ts";
import { WORLD_DEPTH } from "../world/depth.ts";
import { drawGround } from "../world/GroundView.ts";
import { groundThemeOf } from "../world/ground-theme.ts";
import { PropView } from "../world/PropView.ts";
import { fillShadow } from "../world/sprites.ts";
import { PIXELS_PER_METER, toPixels } from "../world/units.ts";
import { ARENA, ArenaSimulation, HAZARD } from "./arena-simulation.ts";

/** 町（ゲームを始める場所・死亡して戻る場所。補助仕様書7・15章）。 */
export const TOWN_REGION = "REGION-TOWN";
/** 開発用の試験用の場（開発版だけ。地域のデータには無い）。 */
export const DEV_ARENA = "DEV-ARENA";

/** シーンを作り直すときに渡す、地域の移動の情報。 */
export interface ArenaSceneData {
  /** セーブのスロット（1〜3）。 */
  readonly slot?: number;
  readonly region?: string;
  readonly profile?: PlayerProfile;
  readonly carry?: {
    readonly hp: number;
    readonly mp: number;
    readonly flasks?: { readonly hp: FlaskState; readonly mp: FlaskState };
  };
  readonly status?: string;
}

/** 施設の名前。 */
const facilityName = (kind: Facility): string => text(FACILITY_TEXT[kind]);

let dbCache: ContentDb | undefined;
let entryCount = 0;

/** 画面を開いている間は渡さない行動（クリックを画面の操作に使うため）。 */
const PANEL_BLOCKED: ReadonlySet<Action> = new Set<Action>([
  "skill1",
  "skill2",
  "skill3",
  "skill4",
  "skill5",
  "skill6",
  "interact",
]);

function withoutPanelBlocked(frame: InputFrame): InputFrame {
  return {
    ...frame,
    held: new Set([...frame.held].filter((a) => !PANEL_BLOCKED.has(a))),
    pressed: new Set([...frame.pressed].filter((a) => !PANEL_BLOCKED.has(a))),
  };
}

const SLOT_LABEL: Readonly<Record<string, string>> = {
  skill1: "左",
  skill2: "右",
  skill3: "1",
  skill4: "2",
  skill5: "3",
  skill6: "4",
};

/**
 * 画面の揺れ（表示だけ。カメラのスクロールに足す。HUD は揺れない。docs/progress D-HUD-4・D-HUD-12）：
 * 始めの大きさ（ピクセル）と、0まで減る時間（ミリ秒）。仮値: 仕様書に無い（docs/progress D-HUD-4）。
 */
const SHAKE = {
  hurt: { strength: 2, durationMs: 110 },
  crit: { strength: 1.5, durationMs: 90 },
} as const;
/** カメラがプレイヤーを追う速さ（1フレームに残りの距離のこの割合だけ近づく。元の startFollow と同じ）。 */
const CAMERA_LERP = 0.2;

/** 召喚物の色（図形の仮の表示）。 */
const MINION_COLORS: Readonly<Record<string, number>> = {
  "MIN-SKELETON": 0xe8e2d0,
  "MIN-FIRE-SPIRIT": 0xff8a3d,
  "MIN-DIRE-WOLF": 0x8a8f99,
};

/** 試験用の場の描画・入力の取得（計算は ArenaSimulation）。 */
export class ArenaScene extends Phaser.Scene {
  private sim!: ArenaSimulation;
  private enemyView: EnemyFieldView | undefined;
  private lootView!: LootView;
  private showLoot = false;
  private controls!: InputSystem;
  /** 設定（補助仕様書16章。端末ごと。D-UI-2）。 */
  private settings: Settings = DEFAULT_SETTINGS;
  /** M で開く大きな地図を開いているか。 */
  private bigMap = false;
  private keyJob!: Phaser.Input.Keyboard.Key;
  private jobPressed = false;
  private body!: Phaser.GameObjects.Image;
  /** プレイヤーの足元の輪（群れの中で自分を見つけやすく）。 */
  private bodyRing!: Phaser.GameObjects.Image;
  /** 足元の影（毎フレーム描き直す。予兆の fx より前に作る）。 */
  private shadows!: Phaser.GameObjects.Graphics;
  /** 前のフレームのプレイヤーの位置（歩きの揺れ。表示だけ）。 */
  private readonly lastBodyPos = { x: 0, y: 0 };
  /** 歩きの揺れの位相（歩いている時間。ミリ秒）。 */
  private walkMs = 0;
  private facing!: Phaser.GameObjects.Image;
  /** 場の物（施設・宝箱・転移の石・隠し星・出口）の表示。 */
  private propView!: PropView;
  private dummyImage: Phaser.GameObjects.Image | undefined;
  private dummyFacing: Phaser.GameObjects.Image | undefined;
  private fx!: Phaser.GameObjects.Graphics;
  /** 詳しい情報（開発用の文字。設定で切り替える。初期は出さない。D-HUD-1）。 */
  private debugText!: Phaser.GameObjects.Text;
  /** 戦闘画面の HUD（補助仕様書16章）。 */
  private hudView!: Hud;
  /** 技のCDの総時間・手応えのきっかけを覚えるもの。シーンを作るたび（create）に新しくする。 */
  private cooldownTracker = new CooldownTracker();
  private hudEvents = new HudEventTracker();
  /** 手応えの表示を出した回数（開発用の確認 hud() が返す。シーンを作るたびに0から）。 */
  private hudCounts = { hurt: 0, levelUp: 0, jobLevelUp: 0 };
  /** 最後に作った HUD のビューモデル（開発用の確認 hud() が返す）。 */
  private hudModel: HudModel | undefined;
  private bars!: Phaser.GameObjects.Graphics;
  /** インベントリ・装備（I）とキャラクター（C）の画面。 */
  private panel!: EquipmentPanel;
  /** セーブの保存先（補助仕様書15章）。 */
  private store!: SaveStore;
  /** 最後のセーブ・読み込みの結果（HUD に出す）。 */
  private saveStatus = "";
  /** セーブのスロット（タイトルで選んだもの）。 */
  private slot = 1;
  /** 開発用：描画のフレームの経過時間を固定する（ミリ秒）。null なら実際の経過時間を使う。 */
  private debugFrameDeltaMs: number | null = null;
  /** 画面の揺れ（表示だけ。乱数は Math.random だが、照準の計算では差し引くのでシミュレーションには入らない）。 */
  private readonly shake = new ScreenShake();
  /** 揺れを足す前のカメラのスクロール（プレイヤーを追った位置。毎フレーム書き換えて使い回す）。 */
  private readonly cameraBase = { x: 0, y: 0 };
  /** cameraBase に最初の位置を入れたか（シーンを作った直後は false。最初のフレームは追わずに合わせる）。 */
  private cameraStarted = false;
  /** 今カメラのスクロールに足している揺れのずれ（実際に足した値。毎フレーム書き換えて使い回す）。 */
  private readonly cameraShake = { x: 0, y: 0 };
  /** 装備の部位ごとの uid（効果音の判定用。毎フレーム書き換えて使い回す）。 */
  private readonly equipmentUids: (string | undefined)[] = MVP_EQUIP_SLOTS.map(() => undefined);
  /** 効果音のきっかけを見るもの・間引くもの。シーンを作るたび（create）に新しくする。 */
  private sfxEvents!: SfxEventTracker;
  private sfxLimiter = new SfxLimiter();

  constructor() {
    super("arena");
  }

  create(data: ArenaSceneData = {}): void {
    const db = (dbCache ??= loadGameContent());
    const regionId = data.region ?? TOWN_REGION;
    const region = regionId === DEV_ARENA ? undefined : db.regions.get(regionId);
    this.store = new SaveStore(db, new LocalStorageBackend());
    this.slot = data.slot ?? 1;
    const profile = data.profile ?? this.loadProfile();
    if (data.status !== undefined) this.saveStatus = data.status;
    const size = region?.size ?? ARENA;
    // 地面（地域の種類ごとの色と模様。入ったときに1回だけ描く。docs/progress WORLD-1）
    const theme = groundThemeOf(region, (id) => db.enemies.get(id)?.boss !== undefined);
    if (theme.kind === "dev")
      this.add
        .tileSprite(0, 0, toPixels(size.width), toPixels(size.height), TEXTURES.floor)
        .setOrigin(0, 0)
        .setDepth(WORLD_DEPTH.floor);
    drawGround(this, theme, {
      width: size.width,
      height: size.height,
      ...(region?.entrance === undefined ? {} : { entrance: region.entrance }),
      facilities: (region?.facilities ?? []).map((f) => f.at),
      exits: (region?.exits ?? []).map((x) => x.rect),
    });
    // 地域の外（ボスの間など、地図が画面より小さいとき）の色
    this.cameras.main.setBackgroundColor(theme.palette.outside);
    entryCount += 1;
    this.sim = new ArenaSimulation(undefined, {
      db,
      ...(profile === undefined ? {} : { profile }),
      ...(region === undefined ? {} : { region }),
      ...(data.carry === undefined ? {} : { carry: data.carry }),
      layoutSeed: `${regionId}-${String(entryCount)}-${String(Date.now())}`,
      onHit: (report, at) => {
        // 会心・崩し：画面を小さく揺らす（HUD は揺らさない）。当てた敵は短く白く光らせる（表示だけ）
        if (report.hit.crit || report.staggerBroke)
          this.shake.trigger(SHAKE.crit.strength, SHAKE.crit.durationMs);
        this.enemyView?.flash(report.targetId);
        this.sfxLimiter.request(hitSfx(report));
        this.popDamage(report, at);
      },
      onText: (label, at, color) => {
        this.popText(label, at, color);
      },
      onExit: (to) => {
        this.time.delayedCall(0, () => {
          this.travel(to);
        });
      },
      onDeath: () => {
        this.time.delayedCall(0, () => {
          this.travel(TOWN_REGION, text("hud.save.died"));
        });
      },
      onFacility: (kind) => {
        this.useFacility(kind);
      },
    });
    this.propView = new PropView(this, this.sim);
    // 足元の影（敵・ドロップ・プレイヤー）と、予兆・技の当たり判定・ドロップを描く Graphics。
    // 地面・場の物より後、敵・プレイヤーの絵より前に作る（深さは全て0で、作る順で重なりが決まる。D-WORLD-6）
    this.shadows = this.add.graphics();
    this.fx = this.add.graphics();
    if (this.sim.field !== undefined) this.enemyView = new EnemyFieldView(this, this.sim.field);
    else this.enemyView = undefined;
    this.lootView = new LootView(this, this.sim.db);
    this.drawRegionLabels();
    // 位置は体の中心（照準を合わせた所に当たるように。docs/progress D-U07-4）
    const dummy = this.sim.dummy;
    if (dummy !== undefined) {
      this.dummyImage = this.add
        .image(toPixels(dummy.position.x), toPixels(dummy.position.y), TEXTURES.dummy)
        .setOrigin(0.5, 0.5);
      this.dummyFacing = this.add
        .image(toPixels(dummy.position.x), toPixels(dummy.position.y), TEXTURES.facing)
        .setOrigin(-0.6, 0.5)
        .setRotation(Math.PI)
        .setTint(0xa07850);
    } else {
      this.dummyImage = undefined;
      this.dummyFacing = undefined;
    }
    this.bodyRing = this.add.image(0, 0, TEXTURES.playerRing);
    this.body = this.add.image(0, 0, playerTexture(this.sim.job.id)).setOrigin(0.5, 0.5);
    this.walkMs = 0;
    this.lastBodyPos.x = toPixels(this.sim.motion.position.x);
    this.lastBodyPos.y = toPixels(this.sim.motion.position.y);
    // 向きの印：体と武器の外側（中心から約8ピクセル）に置く
    this.facing = this.add.image(0, 0, TEXTURES.facing).setOrigin(-0.8, 0.5);
    // 音量・拡大率は端末ごと（localStorage）、キーの割り当てはキャラクターのセーブ（開発計画書6.9）
    this.settings = { ...loadSettings(), bindings: keybindsToBindings(this.sim.keybinds) };
    this.controls = new InputSystem(this, effectiveBindings(this.settings));
    this.applySettings();
    const keyboard = this.input.keyboard;
    if (keyboard === null) throw new Error("キーボードの入力が使えない");
    // 開発用の機能：開発用の試験用の場だけ、B で鍛冶屋・G で転職（町では施設を F で使う）
    keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.B, true).on("down", () => {
      if (this.sim.region === undefined) this.panel.toggle("smith");
    });
    this.keyJob = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.G, true);
    this.keyJob.on("down", () => {
      if (this.sim.region === undefined) this.jobPressed = true;
    });

    // カメラはプレイヤーを自分で追う（followCamera）。Phaser の startFollow を使うと、揺れのずれを
    // スクロールに足したときに追う計算（補間）に混ざるため（docs/progress D-HUD-12）
    const camera = this.cameras.main;
    camera.setBounds(0, 0, toPixels(size.width), toPixels(size.height));
    camera.setRoundPixels(true);
    // Phaser は描画の前（preRender）に、bounds でスクロールを切り詰める。揺れのずれを足したスクロールが
    // 切り詰められて揺れが消えないよう、その切り詰めは止める（切り詰めは followCamera が自分でやる。
    // clampX・clampY は bounds を使うので、setBounds は残す。地図が画面より小さい向きでも揺れが出る。D-HUD-4）
    camera.useBounds = false;
    this.shake.reset();
    this.cameraStarted = false;
    this.cameraShake.x = 0;
    this.cameraShake.y = 0;

    // 効果音（仮素材）：AudioContext は Phaser の WebAudio の音の管理のもの（ゲームに1つ）を使い回す。
    // 最初のキー・クリックで動かす（ブラウザの自動再生の制限。Phaser も同じことをする）
    sfx.attach(
      this.sound instanceof Phaser.Sound.WebAudioSoundManager ? this.sound.context : undefined,
    );
    this.sfxEvents = new SfxEventTracker((id) => this.skillSound(id));
    this.sfxLimiter = new SfxLimiter();
    keyboard.on("keydown", () => {
      sfx.unlock();
    });
    this.input.on("pointerdown", () => {
      sfx.unlock();
    });

    // 棒・地図は世界の絵（敵・プレイヤー）より上、画面（深さ1000）より下
    this.bars = this.add.graphics().setScrollFactor(0).setDepth(900);
    this.hudView = new Hud(this);
    this.cooldownTracker = new CooldownTracker();
    this.hudEvents = new HudEventTracker();
    this.hudCounts = { hurt: 0, levelUp: 0, jobLevelUp: 0 };
    // 詳しい情報は、左上の HUD（地域・Lv・ジョブ）の下に、下敷き付きで出す
    this.debugText = this.add
      .text(8, 50, "", {
        fontFamily: "sans-serif",
        fontSize: "10px",
        color: "#e8e6f0",
        lineSpacing: 2,
        backgroundColor: "#16151cb3",
        padding: { x: 3, y: 2 },
        // 長い行（操作の説明）は画面の幅で折り返す（日本語は空白が無いので、文字の単位で）
        wordWrap: { width: 616, useAdvancedWrap: true },
      })
      .setScrollFactor(0)
      .setDepth(902)
      .setVisible(false);
    this.panel = new EquipmentPanel(this, this.sim, {
      onTravel: (to) => {
        this.travel(to);
      },
      settings: {
        get: () => this.settings,
        set: (s) => {
          const bindingsChanged = s.bindings !== this.settings.bindings;
          // 音量を変えたら、今の音量が分かるように確認の音を1回鳴らす（音量0なら鳴らない）
          if (s.volume !== this.settings.volume) this.sfxLimiter.request("ui");
          this.settings = s;
          saveSettings({ ...s, bindings: {} });
          if (bindingsChanged) {
            this.controls.setBindings(effectiveBindings(s));
            this.sim.keybinds = bindingsToKeybinds(s.bindings);
            this.saveNow();
          }
          this.applySettings();
        },
      },
    });

    const sim = this.sim;
    exposeDebug({
      player: () => ({
        x: sim.motion.position.x,
        y: sim.motion.position.y,
        direction8: sim.motion.direction8,
        stamina: sim.motion.currentStamina,
        dodging: sim.motion.dodging,
        invulnerable: sim.motion.invulnerable,
        dodgePending: sim.dodgePending,
        totalSteps: sim.clock.totalSteps,
        // 画面の上の位置（ゲームのピクセル。揺れを含まないカメラの位置を引いたもの）
        screenX: this.body.x - this.viewScrollX(),
        screenY: this.body.y - this.viewScrollY(),
      }),
      hazard: () => ({
        hits: sim.hazardHits,
        avoided: sim.hazardAvoided,
        phase: sim.time % HAZARD.period,
        x: HAZARD.x,
        y: HAZARD.y,
      }),
      dummy: () => {
        const d = sim.dummy;
        const img = this.dummyImage;
        if (d === undefined || img === undefined) return null;
        return {
          x: d.position.x,
          y: d.position.y,
          hp: d.health.hp,
          maxHp: d.health.maxHp,
          hits: sim.hitCount,
          lastDamage: sim.lastHit?.hit.total ?? 0,
          lastCrit: sim.lastHit?.hit.crit ?? false,
          lastBackstab: sim.lastHit?.backstab ?? false,
          lastAilments: sim.lastHit?.ailments.map((a) => a.tag) ?? [],
          broken: d.stagger.broken,
          statuses: d.statuses.active.map((s) => s.effectId),
          screenX: img.x - this.viewScrollX(),
          screenY: img.y - this.viewScrollY(),
        };
      },
      // 地域（U-18a）：今の地域・近くの調べられるもの・宝箱・転移の石・死亡の記録
      region: () => ({
        id: sim.region?.id ?? DEV_ARENA,
        kind: sim.region?.kind ?? "arena",
        near: (() => {
          const n = sim.nearbyInteractable();
          return n === undefined ? null : n.kind === "facility" ? n.facility : n.kind;
        })(),
        chests: sim.chests.map((c) => ({ x: c.at.x, y: c.at.y, kind: c.kind, opened: c.opened })),
        packs: sim.field?.entries.length ?? 0,
        unlocked: [...sim.unlockedRegions],
        deaths: sim.deathLog.count,
        lastCause: sim.deathLog.lastCause,
        facilities: (sim.region?.facilities ?? []).map((f) => ({
          kind: f.kind,
          x: f.at.x,
          y: f.at.y,
        })),
        stone: sim.region?.teleportStone ?? null,
        secrets: (sim.region?.secrets ?? []).map((x) => ({ id: x.id, x: x.at.x, y: x.at.y })),
        quests: [...sim.questStages],
        starPoints: sim.starPoints,
        exits: (sim.region?.exits ?? []).map((x) => ({ to: x.to, ...x.rect })),
        hp: sim.player.health.hp,
        maxHp: sim.player.health.maxHp,
      }),
      // 確認用：地域を移る（開発版だけ）・その場で倒れる（開発版だけ）
      goRegion: (id?: number | string) => {
        this.travel(String(id));
        return true;
      },
      die: () => {
        sim.player.health.takeDamage(sim.player.health.hp + sim.player.health.maxHp);
        return true;
      },
      teleportTo: (x?: number | string, y?: number | string) => {
        const p = sim.motion.position;
        sim.motion.displace({ x: Number(x) - p.x, y: Number(y) - p.y });
        return { x: sim.motion.position.x, y: sim.motion.position.y };
      },
      // 確認用：闘志の量を決める（開発版だけ。自動の確認で、激化・解放を短い時間で試すため）
      setFervor: (value?: number | string) => sim.setFervor(Number(value ?? 0)),
      enemies: () => sim.field?.debug() ?? [],
      // 地面の物と持ち物（U-11）
      loot: () =>
        sim.loot.drops.map((d) => ({
          id: d.id,
          kind: d.kind,
          x: d.position.x,
          y: d.position.y,
          rarity: d.kind === "item" ? d.item.rarity : null,
          label: this.lootView.label(d).text,
        })),
      inventory: () => ({
        items: sim.inventory.items.map((i) => ({ uid: i.uid, base: i.base, rarity: i.rarity })),
        gold: sim.inventory.gold,
        materials: Object.fromEntries(sim.inventory.materials),
      }),
      // 確認用：プレイヤーの右1mに、精鋭（Lv5）のドロップを置く（開発版だけ）
      dropLoot: () => {
        const p = sim.motion.position;
        sim.dropLoot("elite", 5, { x: p.x + 1, y: p.y });
        return sim.loot.drops.length;
      },
      // 確認用：経験値を得る（開発版だけ）
      grantXp: (value?: number | string) => {
        sim.gainXp(Number(value ?? 0));
        return sim.character.level;
      },
      playerState: () => ({
        hp: sim.player.health.hp,
        maxHp: sim.player.health.maxHp,
        hitsTaken: sim.hitsTaken,
        avoided: sim.attacksAvoided,
        deaths: sim.deaths,
        staggered: sim.player.stagger.broken,
        poison: sim.player.ailments.stacks("AIL-POISON"),
        enemyHits: sim.enemyHits,
        kills: sim.field?.kills ?? 0,
      }),
      // 確認用：技の枠に技を入れる（開発版だけ。index は0〜5）
      assignSkill: (index?: number | string, skill?: number | string) =>
        sim.setSlotSkill(Number(index), skill === undefined ? undefined : String(skill)),
      // 確認用：プレイヤーの右3mに敵を出す（開発版だけ）
      spawnEnemy: (id?: number | string) => sim.spawnEnemy(String(id)),
      skills: () => ({
        weapon: sim.weapon?.uid ?? null,
        affinity: sim.affinity,
        attackSpeed: sim.attackSpeed,
        mp: sim.mp,
        fervor: sim.jobGauge.value,
        stages: sim.jobGauge.stages,
        executing: sim.executing ?? null,
        lastSkill: sim.lastSkill?.id ?? null,
        lastVariants: sim.lastSkill?.variants ?? [],
        uses: Object.fromEntries(sim.uses),
        buffs: sim.buffs.active.map((b) => b.effectId),
        cooldowns: Object.fromEntries(
          sim.loadout.map((l) => [l.skill, sim.cooldowns.remaining(l.skill)]),
        ),
        job: sim.job.id,
        jobLevel: sim.character.jobLevel(sim.job.id),
        jobLevels: Object.fromEntries(
          [...sim.db.jobs.keys()].map((j) => [j, sim.character.jobLevel(j)]),
        ),
        level: sim.character.level,
        xp: sim.character.progress.xp,
        traps: sim.traps.length,
        smokes: sim.smokes.length,
        arrows: sim.arrows.active,
        minions: sim.minions.map((m) => ({ def: m.def.id, hp: m.combatant.health.hp })),
        contract: sim.minionField.squad.used,
        guarding: sim.guard?.raised ?? false,
      }),
      // サブジョブ（開発版だけ）：設定できるか・今のサブジョブ・サブの技・枠の技・副職紋のポイントと取得
      subJob: () => ({
        canSet: sim.canSetSubJob,
        id: sim.subJob?.id ?? null,
        skills: sim.subSkills(),
        slots: sim.loadout.map((l) => l.skill),
        points: sim.subJobBoardPoints,
        spent: sim.subJobBoard?.spent ?? 0,
        nodes: [...(sim.subJobBoard?.nodes ?? [])],
        mainJob: sim.job.id,
      }),
      // セーブ（U-13）：今すぐ保存する・スロットの一覧・最後の結果（開発版だけ）
      saveNow: () => this.saveNow(),
      saves: () => ({
        status: this.saveStatus,
        slots: this.store.list().map((x) => ({
          slot: x.slot,
          state: x.state,
          name: x.state === "ok" ? x.name : null,
          level: x.state === "ok" ? x.level : null,
        })),
        keys: Object.keys(window.localStorage).filter((k) => k.startsWith("stella-sigil/")),
      }),
      // 星辰盤（U-14）：取得・休眠・ノードの画面の位置
      stars: () => ({
        allocated: [...sim.stars.nodes],
        active: [...(sim.sheet.board?.active ?? [])],
        dormant: Object.fromEntries(
          [...(sim.sheet.board?.dormant.entries() ?? [])].map(([k, v]) => [k, v.type]),
        ),
        points: sim.starPoints,
        attributes: { ...sim.sheet.attributes },
        lamps: sim.inventory.material("MAT-RETURN-LAMP"),
      }),
      starNodeScreen: (id?: number | string) => this.panel.nodeScreen(String(id)) ?? null,
      // 職紋盤・副職紋の図（開発版だけ）：今の図のノードの画面の位置（図に出ていなければ null）・右の列の操作の行・
      // 図の視点・メインの職紋盤の取得
      jobNodeScreen: (id?: number | string) => this.panel.jobNodeScreen(String(id)) ?? null,
      jobBoard: () => ({
        job: sim.job.id,
        points: sim.jobBoardPoints,
        spent: sim.jobBoard.spent,
        nodes: [...sim.jobBoard.nodes],
        rows: [...this.panel.jobPanelRows()],
        camera: { ...this.panel.jobBoardCamera },
        inTrial: sim.inTrial,
        area: { ...BOARD_AREA },
        shown: [...this.panel.jobNodesShown()],
      }),
      // 設定（補助仕様書16章）：今の設定と、設定の画面の行の位置
      settings: () => ({
        dodge: effectiveBindings(this.settings).dodge.map((b) => ("key" in b ? b.key : b.mouse)),
        volume: this.settings.volume,
        scale: this.settings.scale,
        keybinds: this.sim.saveData().settings.keybinds,
        rows: [...this.panel.settingsRowBoxes()],
      }),
      // ロードアウト（U-20）
      loadouts: () => ({
        active: sim.activeLoadout,
        list: sim.loadouts.map((l) => ({
          id: l.id,
          mainHand: l.equipment.mainHand ?? null,
          stars: l.starAllocation.length,
        })),
        safe: sim.inSafeZone,
      }),
      // 確認用：素材を得る（開発版だけ）
      grantMaterial: (id?: number | string, n?: number | string) => {
        sim.inventory.addMaterial(String(id), Number(n ?? 1));
        return sim.inventory.material(String(id));
      },
      itemDetail: (uid?: number | string) => {
        const i = sim.inventory.items.find((x) => x.uid === String(uid));
        return i === undefined
          ? null
          : {
              rarity: i.rarity,
              affixes: i.affixes.length,
              enhance: i.enhance ?? 0,
              forgeLoad: i.forgeLoad ?? 0,
            };
      },
      // 画面（U-12）：開いている画面・表示した行・戦闘の能力値
      panel: () => {
        const p = this.panel.snapshot();
        return {
          open: p.open ?? null,
          lines: [...p.lines],
          search: { query: p.search.query, hits: [...p.search.hits] },
          bigMap: this.bigMap,
          sheet: { hp: sim.sheet.maxHp, mp: sim.sheet.maxMp, attackSpeed: sim.sheet.attackSpeed },
        };
      },
      // HUD（D-HUD-1）：今のビューモデルと、詳しい情報（開発用の文字）を出しているか
      hud: () => ({
        model: this.hudModel ?? null,
        debugVisible: this.debugText.visible,
        debugHud: this.settings.debugHud,
        // 手応えの表示を出した回数（このシーンを作ってからの累計）
        events: { ...this.hudCounts },
        // 配置（通常・画面を開いている間の下の帯）と、主な部品の表示
        view: this.hudView.snapshot(),
      }),
      // 照準の世界座標：揺れを含まない式（InputSystem）と、Phaser の pointer.worldX/Y（揺れを含む）の両方。
      // shakeX/Y は今カメラのスクロールに足している揺れのずれ。viewX/Y は描画に使ったカメラの左上
      aim: () => ({
        ...this.controls.pointerWorld(),
        phaserX: this.input.activePointer.worldX,
        phaserY: this.input.activePointer.worldY,
        shakeX: this.cameraShake.x,
        shakeY: this.cameraShake.y,
        // 描画に使われたカメラの左上（worldView。揺れを含む。揺れが画面に出ているかの確認用）
        viewX: this.cameras.main.worldView.x,
        viewY: this.cameras.main.worldView.y,
      }),
      // 確認用：画面を揺らす（開発版だけ。照準が揺れに影響されないことを確かめる）
      shake: (strength?: number | string, ms?: number | string) => {
        this.shake.trigger(Number(strength ?? 3), Number(ms ?? 100));
        return this.shake.active;
      },
      // 効果音（仮素材）：種類ごとの鳴らそうとした回数・実際に合成した回数（ゲームを開いてからの累計）と、
      // AudioContext の状態
      sfx: () => ({ ...sfx.counts(), state: sfx.state, volume: this.settings.volume }),
      // 敵の手応えの表示（ヒットの白い光・撃破で散る図形）を出した回数（このシーンを作ってからの累計）
      fx: () => this.enemyView?.counts() ?? { flashes: 0, bursts: 0 },
      // 刻みが0のフレームを再現するため（pnpm e2e）。null で元に戻す
      setFrameDeltaMs: (ms: number | null) => {
        this.debugFrameDeltaMs = ms;
      },
    });
    document.body.dataset["stellaReady"] = "true";
    document.body.dataset["stellaScene"] = "arena";
  }

  /**
   * セーブデータを読み込む。無ければ・壊れていれば undefined（試験用の初期の状態で始める）。
   * 壊れたデータは上書きせずに残す（次の保存のときに .corrupt に退避する）。
   */
  private loadProfile(): PlayerProfile | undefined {
    const r = this.store.load(this.slot);
    if (r.ok) {
      this.saveStatus = fill(text("hud.save.loaded"), { n: this.slot });
      return r.profile;
    }
    this.saveStatus =
      r.error === undefined
        ? text("hud.save.none")
        : fill(text("hud.save.corrupt"), { kind: r.error.kind });
    return undefined;
  }

  /**
   * 別の地域へ移る（シーンを作り直す。プレイヤーの状態は引き継ぐ）。移る前に自動セーブする（補助仕様書15章）。
   * 町へ移ると全回復し、ダンジョンからダンジョンへは、HP・MPの割合を引き継ぐ（docs/progress D-U18a-2）。
   */
  travel(to: string, status?: string): void {
    const sim = this.sim;
    const toTown = to === TOWN_REGION || to === DEV_ARENA;
    this.saveNow();
    const carry = toTown
      ? undefined
      : {
          hp: sim.player.health.hp / sim.player.health.maxHp,
          mp: sim.mp / sim.maxMp,
          flasks: { hp: sim.hpFlask.state, mp: sim.mpFlask.state },
        };
    document.body.dataset["stellaReady"] = "false";
    this.scene.restart({
      slot: this.slot,
      region: to,
      profile: sim.profile(),
      ...(carry === undefined ? {} : { carry }),
      status: status ?? this.saveStatus,
    } satisfies ArenaSceneData);
  }

  /** 町の施設を使う（F。補助仕様書8章）。 */
  private useFacility(kind: Facility): void {
    const at = this.sim.motion.position;
    switch (kind) {
      case "smith":
        this.panel.show("smith");
        break;
      case "starReader":
        this.panel.show("starBoard");
        break;
      case "stash":
        this.panel.show("stash");
        break;
      case "merchant":
        this.panel.show("merchant");
        break;
      case "teleport":
        this.panel.show("teleport");
        break;
      case "temple":
        if (!this.sim.character.canChangeJob)
          this.popText(fill(text("hud.temple.needLevel"), { n: JOB_CHANGE_LEVEL }), at, "#ff6b6b");
        else this.jobPressed = true;
        break;
      case "altar":
        this.panel.show("altar");
        break;
      case "dummy":
        break;
    }
  }

  /** 施設・転移の石・出口の名前（作ったときに1回だけ）。 */
  private drawRegionLabels(): void {
    const r = this.sim.region;
    if (r === undefined) return;
    // 名前は場の物の絵の上（絵の高さは最大22ピクセルで、位置より約14ピクセル上まで）。
    // 地面の模様の上でも読めるよう、暗い縁取りを付ける
    const style = {
      fontFamily: "sans-serif",
      fontSize: "8px",
      color: "#c3a6ff",
      stroke: "#0e0d12",
      strokeThickness: 2,
    } as const;
    for (const f of r.facilities ?? [])
      if (f.kind !== "dummy")
        this.add
          .text(toPixels(f.at.x), toPixels(f.at.y) - 15, facilityName(f.kind), style)
          .setOrigin(0.5, 1);
    if (r.teleportStone !== undefined && r.kind === "dungeon")
      this.add
        .text(
          toPixels(r.teleportStone.x),
          toPixels(r.teleportStone.y) - 15,
          text("facility.teleport"),
          style,
        )
        .setOrigin(0.5, 1);
    for (const x of r.exits ?? []) {
      const to = this.sim.db.regions.get(x.to);
      this.add
        .text(
          toPixels(x.rect.x + x.rect.width / 2),
          toPixels(x.rect.y) - 4,
          `→ ${to === undefined ? x.to : text(to.text as TextKey)}${x.requires === undefined ? "" : "（ボスを倒すと開く）"}`,
          style,
        )
        .setOrigin(0.5, 1);
    }
  }

  /** 今の状態を保存する（自動セーブ）。失敗したら、元のデータを変えずに知らせる。 */
  private saveNow(): boolean {
    try {
      this.store.save(this.slot, this.sim.saveData());
      this.saveStatus = fill(text("hud.save.auto"), { time: new Date().toLocaleTimeString() });
      return true;
    } catch (e) {
      this.saveStatus = fill(text("hud.save.failed"), {
        error: e instanceof SaveDataError ? e.message : String(e),
      });
      return false;
    }
  }

  override update(_time: number, deltaMs: number): void {
    // 入力の取得はフレームごと。保持と刻みへの受け渡しは ArenaSimulation が行う
    const raw = this.controls.read();
    if (raw.pressed.has("inventory")) this.panel.toggle("inventory");
    if (raw.pressed.has("character")) this.panel.toggle("character");
    if (raw.pressed.has("starBoard")) this.panel.toggle("starBoard");
    if (raw.pressed.has("jobBoard")) this.panel.toggle("jobBoard");
    // M：大きな地図を開く・閉じる（補助仕様書1.1。D-UI-4）
    if (raw.pressed.has("map")) this.bigMap = !this.bigMap;
    // Esc：大きな地図・画面を開いていれば閉じる。何も開いていなければ設定を開く
    if (raw.pressed.has("menu")) {
      if (this.bigMap) this.bigMap = false;
      else if (this.panel.open === undefined) this.panel.show("settings");
      else this.panel.close();
    }
    const pointer = this.input.activePointer;
    this.panel.hover(pointer.x, pointer.y);
    // 画面を開いている間も、ゲームは止めない（移動・回避はできる）。クリックは画面の操作に使うので、
    // 技の枠・拾うの入力は渡さない（docs/progress D-U12-8）
    const open = this.panel.open !== undefined;
    const frame = open ? withoutPanelBlocked(raw) : raw;
    this.showLoot = frame.held.has("showLoot");
    this.sim.frame((this.debugFrameDeltaMs ?? deltaMs) / 1000, frame, {
      changeJob: this.jobPressed,
    });
    this.jobPressed = false;
    if (this.sim.autosave.due()) this.saveNow();
    this.render();
    this.panel.render();
    this.playSfx();
    this.followCamera(deltaMs);
  }

  /** 揺れを含まないカメラのスクロール（画面の上の位置の確認用）。 */
  private viewScrollX(): number {
    return this.cameras.main.scrollX - this.cameraShake.x;
  }
  private viewScrollY(): number {
    return this.cameras.main.scrollY - this.cameraShake.y;
  }

  /**
   * カメラでプレイヤーを追い、揺れのずれを足す（docs/progress D-HUD-12）。
   * 追う位置（cameraBase）は揺れを含まない。揺れはその上に足すだけなので、追う計算に混ざらない。
   * 地図の端（カメラの bounds）では、ずれを反対の向きにする（shakeWithinBounds）。
   * 実際に足したずれは InputSystem に渡し、照準の計算で差し引く（揺れが照準に入らないように）。
   * @param deltaMs 実際のフレームの経過時間（揺れの減衰に使う。表示だけ）
   */
  private followCamera(deltaMs: number): void {
    const cam = this.cameras.main;
    // Phaser の startFollow と同じ：対象を画面の中心（origin）に置くスクロール
    const tx = this.body.x - cam.width * cam.originX;
    const ty = this.body.y - cam.height * cam.originY;
    const base = this.cameraBase;
    if (this.cameraStarted) {
      base.x = cam.clampX(base.x + (tx - base.x) * CAMERA_LERP);
      base.y = cam.clampY(base.y + (ty - base.y) * CAMERA_LERP);
    } else {
      // 地域に入った最初のフレームから、プレイヤーに合わせる
      base.x = cam.clampX(tx);
      base.y = cam.clampY(ty);
      this.cameraStarted = true;
    }
    const off = this.shake.update(deltaMs);
    // 整数のピクセルに丸めて足す（小数で足すと、描画の丸めで揺れが消えたり半端に見えたりする。
    // 0 から離れる向きに丸め、小さな揺れが 0 ばかりにならないようにする）。
    // 動ける幅がある向きは bounds の中で、無い向き（地図が画面より小さい）はそのまま足す
    const dx = shakeOffsetWithinBounds(
      base.x,
      roundShake(off.x),
      cam.clampX(-Infinity),
      cam.clampX(Infinity),
    );
    const dy = shakeOffsetWithinBounds(
      base.y,
      roundShake(off.y),
      cam.clampY(-Infinity),
      cam.clampY(Infinity),
    );
    cam.setScroll(base.x + dx, base.y + dy);
    this.cameraShake.x = dx;
    this.cameraShake.y = dy;
    this.controls.setViewOffset(dx, dy);
  }

  /**
   * 技を使ったときの音（技のタグと動き方。武器による変化でタグが替わる通常攻撃（弓）も見る）。
   * 通常攻撃の近接は鳴らさない（undefined。当たったときの hit だけ。D-SFX-8）。
   */
  private skillSound(id: string): SfxKey | undefined {
    const def = this.sim.db.skills.get(id);
    if (def === undefined) return "skillMelee";
    let tags: readonly string[] = def.tags;
    let action: string = def.action.type;
    const last = this.sim.lastSkill;
    if (last?.id === id)
      for (const v of def.weaponVariants ?? [])
        if (last.variants.includes(`weapon:${v.weaponTag}`)) {
          tags = v.mods.tags ?? tags;
          action = v.mods.action?.type ?? action;
        }
    return skillUseSfx(id, tags, action);
  }

  /** 効果音：このフレームの出来事を集め、間引いて鳴らす（表示の時計。シミュレーションには関わらない）。 */
  private playSfx(): void {
    const sim = this.sim;
    const inv = sim.inventory;
    let materials = 0;
    for (const n of inv.materials.values()) materials += n;
    // 部位ごとの装備の uid（配列は使い回す。トラッカーが自分の写しと比べる）
    const equipment = this.equipmentUids;
    for (let i = 0; i < MVP_EQUIP_SLOTS.length; i++) {
      const slot = MVP_EQUIP_SLOTS[i];
      equipment[i] = slot === undefined ? undefined : sim.equipment.get(slot)?.uid;
    }
    for (const key of this.sfxEvents.observe({
      hitsTaken: sim.hitsTaken + sim.hazardHits,
      hp: sim.playerHealth.hp,
      kills: sim.field?.kills ?? 0,
      guards: sim.guardCount + sim.parryCount,
      dodging: sim.motion.dodging,
      // sim の Map をそのまま渡す（トラッカーが自分の写しと比べる）
      skillUses: sim.uses,
      flaskCharges: sim.hpFlask.charges + sim.mpFlask.charges,
      carried: inv.items.length + inv.gold + materials,
      level: sim.character.level,
      jobId: sim.job.id,
      jobLevel: sim.character.jobLevel(sim.job.id),
      deaths: sim.deaths,
      chestsOpened: sim.chests.reduce((n, c) => n + (c.opened ? 1 : 0), 0),
      panel: this.panel.open,
      equipment,
      nodes:
        sim.stars.nodes.length + sim.jobBoard.nodes.length + (sim.subJobBoard?.nodes.length ?? 0),
    }))
      this.sfxLimiter.request(key);
    sfx.play(this.sfxLimiter.flush(this.time.now));
  }

  /** 操作の説明（今の割り当てで。設定で変えると変わる）。 */
  private controlsHint(): string {
    const k = (a: Action): string =>
      effectiveBindings(this.settings)[a].map(bindingName).join("・");
    return `${k("moveUp")}${k("moveLeft")}${k("moveDown")}${k("moveRight")}移動・マウス照準・${k("dodge")} 回避・${k("inventory")} インベントリ・${k("character")} キャラクター・${k("starBoard")} 星辰盤・Esc 設定`;
  }

  /** 音量と画面の拡大率を効かせる（割り当ては InputSystem.setBindings）。 */
  private applySettings(): void {
    this.sound.volume = this.settings.volume;
    sfx.setVolume(this.settings.volume);
    const scale = this.scale;
    // 窓に収まらない整数倍（窓を小さくした後など）は、画面に合わせる
    const s = scaleFits(this.settings.scale, {
      width: window.innerWidth,
      height: window.innerHeight,
    })
      ? this.settings.scale
      : "fit";
    if (s === "fit") {
      if (scale.scaleMode !== Phaser.Scale.FIT || scale.zoom !== 1) {
        scale.scaleMode = Phaser.Scale.FIT;
        scale.setZoom(1);
        scale.refresh();
      }
    } else if (scale.scaleMode !== Phaser.Scale.NONE || scale.zoom !== s) {
      scale.scaleMode = Phaser.Scale.NONE;
      scale.setZoom(s);
      scale.refresh();
    }
  }

  /** 受けている状態異常（全ての種類。補助仕様書16章「状態異常のアイコン」の文字の版）。HUD の札と同じ内容（ailmentsOf）。 */
  private ailmentText(): string {
    return ailmentsOf(this.sim)
      .map((a) => `・${a.label}${a.stacks > 1 ? ` ${String(a.stacks)}` : ""}`)
      .join("");
  }

  /** 小さな地図（補助仕様書16章）：右下に、地域の全体と自分・敵・宝箱・出口などの点。 */
  private drawMinimap(): void {
    // 画面（インベントリなど）を開いている間は描かない（画面の下からはみ出さないように）
    if (this.panel.open !== undefined) return;
    const frame = this.bigMap ? BIG_MAP : MINIMAP;
    const zoom = this.bigMap ? 2 : 1;
    const sim = this.sim;
    const r = sim.region;
    const center = (x: { x: number; y: number; width: number; height: number }) => ({
      x: x.x + x.width / 2,
      y: x.y + x.height / 2,
    });
    const marks = minimapMarks(
      {
        size: sim.size,
        player: sim.motion.position,
        enemies: (sim.field?.enemies ?? [])
          .filter((e) => e.state !== "dead" && !e.underground)
          .map((e) => ({
            x: e.position.x,
            y: e.position.y,
            boss: e.def.boss !== undefined,
            elite: e.rank.id === "RANK-ELITE",
          })),
        chests: sim.chests.filter((c) => !c.opened).map((c) => c.at),
        exits: (r?.exits ?? []).map((x) => ({ ...center(x.rect), open: sim.exitOpen(x) })),
        stone: r?.kind === "dungeon" ? r.teleportStone : undefined,
        facilities: (r?.facilities ?? []).filter((f) => f.kind !== "dummy").map((f) => f.at),
      },
      frame,
    );
    const g = this.bars;
    g.fillStyle(0x16151c, this.bigMap ? 0.9 : 0.75)
      .fillRect(frame.x, frame.y, frame.width, frame.height)
      .lineStyle(1, 0x4a4858, 1)
      .strokeRect(frame.x, frame.y, frame.width, frame.height);
    const STYLE: Readonly<Record<MinimapMarkKind, { color: number; size: number }>> = {
      facility: { color: 0x8c88a0, size: 2 },
      exit: { color: 0x7bd389, size: 3 },
      exitClosed: { color: 0x6a6878, size: 3 },
      stone: { color: 0xc3a6ff, size: 3 },
      chest: { color: 0xffd166, size: 2 },
      enemy: { color: 0xff6b6b, size: 1 },
      elite: { color: 0xff9f43, size: 2 },
      boss: { color: 0xff3b3b, size: 4 },
      player: { color: 0xffffff, size: 3 },
    };
    for (const m of marks) {
      const s = STYLE[m.kind];
      const size = s.size * zoom;
      g.fillStyle(s.color, 1).fillRect(
        Math.round(m.x - size / 2),
        Math.round(m.y - size / 2),
        size,
        size,
      );
    }
  }

  private skillName(id: string): string {
    const def = this.sim.db.skills.get(id);
    return def === undefined ? id : text(def.text as TextKey);
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

  /** HUD を描き、手応えの表示（被弾の赤い縁と揺れ・Lv UP）のきっかけを見る。 */
  private renderHud(): void {
    const sim = this.sim;
    const now = this.time.now;
    const model = buildHudModel(sim, {
      bindings: effectiveBindings(this.settings),
      saveStatus: this.saveStatus,
      cooldowns: this.cooldownTracker,
    });
    this.hudModel = model;
    const ev = this.hudEvents.observe({
      hitsTaken: sim.hitsTaken + sim.hazardHits,
      hp: sim.playerHealth.hp,
      level: sim.character.level,
      jobId: sim.job.id,
      jobLevel: sim.character.jobLevel(sim.job.id),
    });
    if (ev.hurt) {
      // 被弾（HPが実際に減ったとき）：画面の縁を短く赤く・画面を小さく揺らす（HUD は揺らさない）
      this.hudCounts.hurt += 1;
      this.hudView.hurt(now);
      this.shake.trigger(SHAKE.hurt.strength, SHAKE.hurt.durationMs);
    }
    // キャラLv UP とジョブLv UP が同じ刻みに起きたら、両方を縦にずらして出す
    let row = 0;
    if (ev.levelUp !== undefined) {
      this.hudCounts.levelUp += 1;
      this.hudView.levelUp(fill(text("hud.levelUp"), { n: ev.levelUp }), undefined, row);
      row += 1;
    }
    if (ev.jobLevelUp !== undefined) {
      this.hudCounts.jobLevelUp += 1;
      this.hudView.levelUp(
        fill(text("hud.jobLevelUp"), { job: model.level.jobName, n: ev.jobLevelUp }),
        "#e2d4ff",
        row,
      );
    }
    this.hudView.render(model, {
      panelOpen: this.panel.open !== undefined,
      bigMap: this.bigMap,
      now,
    });
  }

  /**
   * プレイヤーの姿：ジョブの絵（転職したら替える）・左右の向き・待機の小さな上下・歩きの揺れ・足元の影と輪。
   * 上下と揺れは原点（origin）と回転だけで出し、body の位置（カメラ・確認の screenX/Y が使う）は動かさない。
   */
  private renderPlayerBody(x: number, y: number): void {
    const motion = this.sim.motion;
    const key = playerTexture(this.sim.job.id);
    if (this.body.texture.key !== key) this.body.setTexture(key);
    // 左向き（8方向の 3・4・5）は左右を反転。真上・真下は前の向きのまま
    const d8 = motion.direction8;
    if (d8 === 3 || d8 === 4 || d8 === 5) this.body.setFlipX(true);
    else if (d8 === 7 || d8 === 0 || d8 === 1) this.body.setFlipX(false);
    const dt = this.debugFrameDeltaMs ?? this.game.loop.delta;
    const moved = Math.hypot(x - this.lastBodyPos.x, y - this.lastBodyPos.y) > 0.01;
    this.lastBodyPos.x = x;
    this.lastBodyPos.y = y;
    let lift: number;
    let tilt = 0;
    if (moved && !motion.dodging) {
      this.walkMs += dt;
      // 歩き：1歩ごとに1ピクセル跳ね、少し左右に傾く
      lift = Math.abs(Math.sin(this.walkMs / 90)) >= 0.5 ? 1 : 0;
      tilt = Math.sin(this.walkMs / 90) * 0.07;
    } else {
      this.walkMs = 0;
      // 待機：ゆっくり1ピクセル上下（息）
      lift = Math.sin(this.time.now / 450) > 0.6 ? 1 : 0;
    }
    this.body
      .setOrigin(0.5, 0.5 + lift / this.body.height)
      .setRotation(tilt)
      .setPosition(x, y)
      .setAlpha(motion.invulnerable ? 0.5 : 1);
    fillShadow(this.shadows, x, y + 11, 14, 5);
    this.bodyRing.setPosition(x, y + 11);
  }

  private render(): void {
    const sim = this.sim;
    const motion = sim.motion;
    const p = motion.position;
    const x = Math.round(toPixels(p.x));
    const y = Math.round(toPixels(p.y));
    this.shadows.clear();
    this.renderPlayerBody(x, y);
    this.facing.setPosition(x, y).setRotation((motion.direction8 * Math.PI) / 4);
    const dummy = sim.dummy;
    if (dummy !== undefined && this.dummyImage !== undefined && this.dummyFacing !== undefined) {
      const dx0 = Math.round(toPixels(dummy.position.x));
      const dy0 = Math.round(toPixels(dummy.position.y));
      this.dummyImage.setPosition(dx0, dy0);
      this.dummyFacing.setPosition(dx0, dy0);
      // Phaser 4 では setTintFill が無くなり、setTint ＋ setTintMode で白く光らせる
      if (sim.flash > 0) this.dummyImage.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
      else if (dummy.stagger.broken)
        this.dummyImage.setTint(0xffd166).setTintMode(Phaser.TintModes.MULTIPLY);
      else this.dummyImage.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
    }

    const g = this.fx.clear();
    // 騎士：盾を構えている間だけ、正面に小さな弧（ガードの印。見た目だけ）
    if (sim.guard?.raised === true) {
      const a = motion.facing;
      g.lineStyle(3, 0x9ad1ff, 0.9)
        .beginPath()
        .arc(x, y, 14, a - 0.9, a + 0.9)
        .strokePath();
    }
    if (sim.region === undefined) {
      const t = sim.time % HAZARD.period;
      const hx = toPixels(HAZARD.x);
      const hy = toPixels(HAZARD.y);
      const r = HAZARD.radius * PIXELS_PER_METER;
      if (t < HAZARD.telegraph) g.lineStyle(1, 0xff6b6b, 0.4 + t).strokeCircle(hx, hy, r);
      else if (t < HAZARD.telegraph + HAZARD.active)
        g.fillStyle(0xff6b6b, 0.5).fillCircle(hx, hy, r);
    }
    // 地域：施設・転移の石・宝箱・隠し星・出口（PropView。状態が変わったときだけ絵を替える）
    const region = sim.region;
    this.propView.update(sim, this.time.now);
    // 敵：予兆・雲・体・HP
    if (sim.field !== undefined)
      this.enemyView?.render(
        sim.field,
        g,
        (shape, origin, facing) => {
          this.drawShape(g, shape, origin, facing);
        },
        this.shadows,
      );
    // 地面の物（名前は近くの物だけ。Alt を押している間は全て）
    this.lootView.render(sim.loot, g, motion.position, this.showLoot, this.shadows);
    // 煙玉と罠
    for (const p of sim.poisonPuddles)
      g.fillStyle(0x7bd389, 0.22).fillCircle(
        toPixels(p.center.x),
        toPixels(p.center.y),
        p.radius * PIXELS_PER_METER,
      );
    for (const z of sim.smokes)
      g.fillStyle(0x8c88a0, 0.25).fillCircle(
        toPixels(z.center.x),
        toPixels(z.center.y),
        z.radius * PIXELS_PER_METER,
      );
    for (const tr of sim.traps)
      g.lineStyle(1, 0xffd166, 0.9).strokeCircle(
        toPixels(tr.center.x),
        toPixels(tr.center.y),
        tr.radius * PIXELS_PER_METER,
      );
    // 召喚物（召喚士）：種類ごとの色の円・向きの線・HPの棒（図形だけ。ドット絵は後で）
    for (const m of sim.minions) {
      // 倒れた召喚物は描かない（取り除かれるのはその刻みの終わり）
      if (m.dead) continue;
      const x = toPixels(m.position.x);
      const y = toPixels(m.position.y);
      const r = m.def.radius * PIXELS_PER_METER;
      const color = MINION_COLORS[m.def.id] ?? 0xc9a0ff;
      g.fillStyle(color, 0.9).fillCircle(x, y, r);
      g.lineStyle(1, 0x1b1a22, 1).strokeCircle(x, y, r);
      g.lineBetween(x, y, x + Math.cos(m.facing) * r, y + Math.sin(m.facing) * r);
      const hp = m.combatant.health;
      g.fillStyle(0x2a2934, 1)
        .fillRect(x - 8, y - r - 5, 16, 2)
        .fillStyle(0xc9a0ff, 1)
        .fillRect(x - 8, y - r - 5, Math.round((16 * hp.hp) / hp.maxHp), 2);
    }
    // 炎霊の火球
    g.fillStyle(0xff8a3d, 1);
    for (const b of sim.minionField.bolts.positions())
      g.fillCircle(toPixels(b.position.x), toPixels(b.position.y), 3);
    // 指揮・集中の対象の印
    const commanded = sim.commandTarget;
    if (commanded !== undefined)
      g.lineStyle(1, 0xc9a0ff, 1).strokeCircle(
        toPixels(commanded.position.x),
        toPixels(commanded.position.y),
        commanded.radius * PIXELS_PER_METER + 4,
      );
    // プレイヤーの矢（弓使い）
    g.lineStyle(2, 0xf4e3b2, 1);
    for (const a of sim.arrows.positions()) {
      const x = toPixels(a.position.x);
      const y = toPixels(a.position.y);
      g.lineBetween(x, y, x - a.direction.x * 10, y - a.direction.y * 10);
    }
    // 残っている亀裂・矢の雨
    for (const z of sim.zones) {
      g.fillStyle(0xff9f43, 0.18);
      for (const part of z.parts) this.drawShape(g, part.shape, part.origin, part.facing);
    }
    // 技の当たり判定（出た直後の少しの間だけ）
    g.fillStyle(0xffffff, 0.22);
    for (const s of sim.visibleStrikes()) this.drawShape(g, s.shape, s.origin, s.facing);
    // 人形のHPと崩しゲージ
    if (dummy !== undefined && this.dummyImage !== undefined) {
      const dx = this.dummyImage.x - 12;
      const dy = this.dummyImage.y - 18;
      g.fillStyle(0x2a2934, 1)
        .fillRect(dx, dy, 24, 3)
        .fillStyle(0xff6b6b, 1)
        .fillRect(dx, dy, Math.round((24 * dummy.health.hp) / dummy.health.maxHp), 3)
        .fillStyle(0x2a2934, 1)
        .fillRect(dx, dy + 4, 24, 2)
        .fillStyle(0xffd166, 1)
        .fillRect(
          dx,
          dy + 4,
          dummy.stagger.broken ? 24 : Math.round((24 * dummy.stagger.current) / dummy.stagger.max),
          2,
        );
    }

    this.bars.clear();
    this.drawMinimap();
    this.renderHud();
    // 詳しい情報（開発用の文字）：設定で出すときだけ作る（大きな地図・画面を開いている間は出さない）
    const showDebug = this.settings.debugHud && !this.bigMap && this.panel.open === undefined;
    this.debugText.setVisible(showDebug);
    if (!showDebug) return;
    const gauge = sim.jobGauge;

    const last = sim.lastHit;
    const stageText = gauge.def.stages
      .filter((s) => gauge.hasStage(s.id))
      .map((s) => text(s.text as TextKey))
      .join("・");
    const gaugeName = text(gauge.def.text as TextKey);
    const c = sim.character;
    const slots = sim.loadout
      .map((l) => {
        const name = this.skillName(l.skill);
        const block = sim.blockOf(l.skill);
        const cd = sim.cooldowns.remaining(l.skill);
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
    const lastSkill = sim.lastSkill;
    this.debugText.setText(
      [
        `${region === undefined ? "試験用の場（開発用。B 鍛冶屋・G 転職）" : text(region.text as TextKey)}　${this.controlsHint()}${(() => {
          // 近くの物の案内は HUD と同じ文章（promptOf。割り当てを変えていればそのキーの名前）
          const p = promptOf(sim, shortBindingName(effectiveBindings(this.settings).interact[0]));
          return p === undefined ? "" : `　【${p}】`;
        })()}`,
        `Lv${String(c.level)}（経験値 ${c.progress.xp.toFixed(0)}／${String(c.progress.toNext)}）・${text(sim.job.text as TextKey)} ジョブLv${String(c.jobLevel(sim.job.id))}（${c.jobTrack(sim.job.id).xp.toFixed(0)}／${String(c.jobTrack(sim.job.id).toNext)}）${c.catchingUp ? "・追いつき補正×2" : ""}`,
        slots,
        `武器：${itemName(sim.db, sim.weapon)}（適性${sim.affinity}・攻撃速度 ${sim.attackSpeed.toFixed(2)}回/秒）${sim.buffs.active.length > 0 ? `・効果：${sim.buffs.active.map((b) => `${this.skillName(b.ref)}（${b.remaining.toFixed(1)}秒）`).join("・")}` : ""}`,
        dummy === undefined
          ? `敵：残り ${String(sim.field?.entries.length ?? 0)}・宝箱 ${String(sim.chests.filter((c) => !c.opened).length)}・倒れた回数 ${String(sim.deathLog.count)}`
          : `人形：HP ${dummy.health.hp.toFixed(0)}／${dummy.health.maxHp.toFixed(0)}・DPS ${sim.dps().toFixed(1)}・ヒット ${String(sim.hitCount)}${dummy.stagger.broken ? "・崩れ" : ""}${dummy.statuses.active.length > 0 ? "・威圧" : ""}`,
        last === undefined
          ? "最後のヒット：なし"
          : `最後のヒット：${last.hit.evaded ? "回避された" : `${last.hit.total.toFixed(1)}${last.hit.crit ? "・会心" : ""}${last.backstab ? "・背面" : ""}${last.ailments.length > 0 ? "・出血" : ""}`}${lastSkill === undefined ? "" : `（${lastSkill.variants.join("・") || "変化なし"}）`}`,
        region === undefined
          ? `危険地帯：被弾 ${String(sim.hazardHits)}／回避で無効 ${String(sim.hazardAvoided)}`
          : "",
        `持ち物：装備 ${String(sim.inventory.items.length)}／${String(sim.inventory.capacity)}・金貨 ${String(sim.inventory.gold)}・素材 ${String([...sim.inventory.materials.values()].reduce((a, b) => a + b, 0))}（F で装備を拾う・Alt で名前を全て表示）`,
        `敵：倒した数 ${String(sim.field?.kills ?? 0)}・被弾 ${String(sim.hitsTaken)}・回避で無効 ${String(sim.attacksAvoided)}・倒れた回数 ${String(sim.deaths)}${this.ailmentText()}${sim.player.stagger.broken ? "・よろめき" : ""}`,
        `セーブ：${this.saveStatus}`,
        `HP ${sim.playerHealth.hp.toFixed(0)}・MP ${sim.mp.toFixed(0)}・薬瓶 Q:${String(sim.hpFlask.charges)} E:${String(sim.mpFlask.charges)}・気力 ${motion.currentStamina.toFixed(0)}・${gaugeName} ${gauge.value.toFixed(0)}${stageText === "" ? "" : `（${stageText}）`}${sim.inTrial ? "・試し打ちの場（振り直し無料・離れると戻る）" : ""}`,
      ].filter((line) => line !== ""),
    );
  }
}
