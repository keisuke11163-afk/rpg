// 仮実装: U-18a feature/town-and-dungeon-base で、町とダンジョンの地図に置き換える（試験用の場）
import Phaser from "phaser";
import {
  type HitReport,
  type HitShape,
  type PlayerProfile,
  SaveDataError,
  SaveStore,
  type Vec2,
} from "@stella/core";
import { loadGameContent } from "@stella/content";
import { text, type TextKey } from "@stella/content";
import { LocalStorageBackend } from "../save/LocalStorageBackend.ts";
import { EquipmentPanel } from "../ui/EquipmentPanel.ts";
import { itemName } from "../ui/item-text.ts";
import { SCREEN } from "../config.ts";
import { exposeDebug } from "../debug.ts";
import type { Action } from "../input/actions.ts";
import { type InputFrame, InputSystem } from "../input/InputSystem.ts";
import { EnemyFieldView } from "../world/EnemyFieldView.ts";
import { LootView } from "../world/LootView.ts";
import { TEXTURES } from "../world/placeholders.ts";
import { PIXELS_PER_METER, toPixels } from "../world/units.ts";
import { ARENA, ArenaSimulation, DUMMY_POSITION, HAZARD } from "./arena-simulation.ts";

/** セーブのスロット（タイトルの画面ができるまでは1つ目だけ）。 */
const SAVE_SLOT = 1;

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

/** 試験用の場の描画・入力の取得（計算は ArenaSimulation）。 */
export class ArenaScene extends Phaser.Scene {
  private sim!: ArenaSimulation;
  private enemyView: EnemyFieldView | undefined;
  private lootView!: LootView;
  private showLoot = false;
  private controls!: InputSystem;
  private keyJob!: Phaser.Input.Keyboard.Key;
  private jobPressed = false;
  private body!: Phaser.GameObjects.Image;
  private facing!: Phaser.GameObjects.Image;
  private dummyImage!: Phaser.GameObjects.Image;
  private dummyFacing!: Phaser.GameObjects.Image;
  private fx!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Text;
  private bars!: Phaser.GameObjects.Graphics;
  /** インベントリ・装備（I）とキャラクター（C）の画面。 */
  private panel!: EquipmentPanel;
  /** セーブの保存先（補助仕様書15章）。 */
  private store!: SaveStore;
  /** 最後のセーブ・読み込みの結果（HUD に出す）。 */
  private saveStatus = "";
  /** 開発用：描画のフレームの経過時間を固定する（ミリ秒）。null なら実際の経過時間を使う。 */
  private debugFrameDeltaMs: number | null = null;

  constructor() {
    super("arena");
  }

  create(): void {
    this.add
      .tileSprite(0, 0, toPixels(ARENA.width), toPixels(ARENA.height), TEXTURES.floor)
      .setOrigin(0, 0);
    this.fx = this.add.graphics();
    const db = loadGameContent();
    this.store = new SaveStore(db, new LocalStorageBackend());
    const profile = this.loadProfile();
    this.sim = new ArenaSimulation(undefined, {
      db,
      ...(profile === undefined ? {} : { profile }),
      onHit: (report, at) => {
        if (report.hit.crit || report.staggerBroke) this.cameras.main.shake(80, 0.004);
        this.popDamage(report, at);
      },
      onText: (label, at, color) => {
        this.popText(label, at, color);
      },
    });
    if (this.sim.field !== undefined) this.enemyView = new EnemyFieldView(this, this.sim.field);
    this.lootView = new LootView(this, this.sim.db);
    // 位置は体の中心（照準を合わせた所に当たるように。docs/progress D-U07-4）
    this.dummyImage = this.add
      .image(toPixels(DUMMY_POSITION.x), toPixels(DUMMY_POSITION.y), TEXTURES.dummy)
      .setOrigin(0.5, 0.5);
    this.dummyFacing = this.add
      .image(toPixels(DUMMY_POSITION.x), toPixels(DUMMY_POSITION.y), TEXTURES.facing)
      .setOrigin(-0.6, 0.5)
      .setRotation(Math.PI)
      .setTint(0xa07850);
    this.body = this.add.image(0, 0, TEXTURES.player).setOrigin(0.5, 0.5);
    this.facing = this.add.image(0, 0, TEXTURES.facing).setOrigin(-0.6, 0.5);
    this.controls = new InputSystem(this);
    const keyboard = this.input.keyboard;
    if (keyboard === null) throw new Error("キーボードの入力が使えない");
    // 仮実装: U-18a feature/town-and-dungeon-base で、町の鍛冶屋に置き換える（B で鍛冶屋の画面）
    keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.B, true).on("down", () => {
      this.panel.toggle("smith");
    });
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
    this.panel = new EquipmentPanel(this, this.sim);

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
        // 画面の上の位置（ゲームのピクセル。カメラの位置を引いたもの）
        screenX: this.body.x - this.cameras.main.scrollX,
        screenY: this.body.y - this.cameras.main.scrollY,
      }),
      hazard: () => ({
        hits: sim.hazardHits,
        avoided: sim.hazardAvoided,
        phase: sim.time % HAZARD.period,
        x: HAZARD.x,
        y: HAZARD.y,
      }),
      dummy: () => ({
        x: sim.dummy.position.x,
        y: sim.dummy.position.y,
        hp: sim.dummy.health.hp,
        maxHp: sim.dummy.health.maxHp,
        hits: sim.hitCount,
        lastDamage: sim.lastHit?.hit.total ?? 0,
        lastCrit: sim.lastHit?.hit.crit ?? false,
        lastBackstab: sim.lastHit?.backstab ?? false,
        lastAilments: sim.lastHit?.ailments.map((a) => a.tag) ?? [],
        broken: sim.dummy.stagger.broken,
        statuses: sim.dummy.statuses.active.map((s) => s.effectId),
        screenX: this.dummyImage.x - this.cameras.main.scrollX,
        screenY: this.dummyImage.y - this.cameras.main.scrollY,
      }),
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
          sheet: { hp: sim.sheet.maxHp, mp: sim.sheet.maxMp, attackSpeed: sim.sheet.attackSpeed },
        };
      },
      // 刻みが0のフレームを再現するため（pnpm e2e）。null で元に戻す
      setFrameDeltaMs: (ms: number | null) => {
        this.debugFrameDeltaMs = ms;
      },
    });
    document.body.dataset["stellaReady"] = "true";
  }

  /**
   * セーブデータを読み込む。無ければ・壊れていれば undefined（試験用の初期の状態で始める）。
   * 壊れたデータは上書きせずに残す（次の保存のときに .corrupt に退避する）。
   */
  private loadProfile(): PlayerProfile | undefined {
    // 仮実装: U-18a feature/town-and-dungeon-base で、タイトルのキャラクターの選択（3スロット）に置き換える（常にスロット1）
    const r = this.store.load(SAVE_SLOT);
    if (r.ok) {
      this.saveStatus = `スロット${String(SAVE_SLOT)}から読み込んだ`;
      return r.profile;
    }
    this.saveStatus =
      r.error === undefined
        ? "セーブデータなし（新しく始めた）"
        : `セーブデータが壊れている（${r.error.kind}）。元のデータは残し、新しく始めた`;
    return undefined;
  }

  /** 今の状態を保存する（自動セーブ）。失敗したら、元のデータを変えずに知らせる。 */
  private saveNow(): boolean {
    try {
      this.store.save(SAVE_SLOT, this.sim.saveData());
      this.saveStatus = `自動セーブ（${new Date().toLocaleTimeString()}）`;
      return true;
    } catch (e) {
      this.saveStatus = `セーブできなかった：${e instanceof SaveDataError ? e.message : String(e)}`;
      return false;
    }
  }

  override update(_time: number, deltaMs: number): void {
    // 入力の取得はフレームごと。保持と刻みへの受け渡しは ArenaSimulation が行う
    const raw = this.controls.read();
    if (raw.pressed.has("inventory")) this.panel.toggle("inventory");
    if (raw.pressed.has("character")) this.panel.toggle("character");
    if (raw.pressed.has("starBoard")) this.panel.toggle("starBoard");
    if (raw.pressed.has("menu")) this.panel.close();
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

  private render(): void {
    const sim = this.sim;
    const motion = sim.motion;
    const p = motion.position;
    const x = Math.round(toPixels(p.x));
    const y = Math.round(toPixels(p.y));
    this.body.setPosition(x, y).setAlpha(motion.invulnerable ? 0.5 : 1);
    this.facing.setPosition(x, y).setRotation((motion.direction8 * Math.PI) / 4);
    const dummy = sim.dummy;
    const dx0 = Math.round(toPixels(dummy.position.x));
    const dy0 = Math.round(toPixels(dummy.position.y));
    this.dummyImage.setPosition(dx0, dy0);
    this.dummyFacing.setPosition(dx0, dy0);
    // Phaser 4 では setTintFill が無くなり、setTint ＋ setTintMode で白く光らせる
    if (sim.flash > 0) this.dummyImage.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    else if (dummy.stagger.broken)
      this.dummyImage.setTint(0xffd166).setTintMode(Phaser.TintModes.MULTIPLY);
    else this.dummyImage.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);

    const g = this.fx.clear();
    const t = sim.time % HAZARD.period;
    const hx = toPixels(HAZARD.x);
    const hy = toPixels(HAZARD.y);
    const r = HAZARD.radius * PIXELS_PER_METER;
    if (t < HAZARD.telegraph) g.lineStyle(1, 0xff6b6b, 0.4 + t).strokeCircle(hx, hy, r);
    else if (t < HAZARD.telegraph + HAZARD.active) g.fillStyle(0xff6b6b, 0.5).fillCircle(hx, hy, r);
    // 敵：予兆・雲・体・HP
    if (sim.field !== undefined)
      this.enemyView?.render(sim.field, g, (shape, origin, facing) => {
        this.drawShape(g, shape, origin, facing);
      });
    // 地面の物（名前は近くの物だけ。Alt を押している間は全て）
    this.lootView.render(sim.loot, g, motion.position, this.showLoot);
    // 煙玉と罠
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
    // 残っている亀裂
    for (const z of sim.zones) {
      g.fillStyle(0xff9f43, 0.18);
      for (const part of z.parts) this.drawShape(g, part.shape, part.origin, part.facing);
    }
    // 技の当たり判定（出た直後の少しの間だけ）
    g.fillStyle(0xffffff, 0.22);
    for (const s of sim.visibleStrikes()) this.drawShape(g, s.shape, s.origin, s.facing);
    // 人形のHPと崩しゲージ
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

    const bar = (row: number, ratio: number, color: number): void => {
      const by = SCREEN.height - 38 + row * 8;
      this.bars
        .fillStyle(0x2a2934, 1)
        .fillRect(8, by, 100, 5)
        .fillStyle(color, 1)
        .fillRect(8, by, Math.round(100 * Math.max(0, Math.min(1, ratio))), 5);
    };
    this.bars.clear();
    bar(0, sim.playerHealth.hp / sim.playerHealth.maxHp, 0xff6b6b);
    bar(1, sim.mp / sim.maxMp, 0x6fa8ff);
    bar(2, motion.currentStamina / motion.config.maxStamina, 0x7bd389);
    const gauge = sim.jobGauge;
    bar(3, gauge.value / gauge.max, gauge.hasStage("empowered") ? 0xff9f43 : 0xb5651d);

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
    this.hud.setText([
      "試験用の場（WASD移動・マウス照準・スペース回避・I インベントリ・C キャラクター・T 星辰盤・B 鍛冶屋・Gで転職）",
      `Lv${String(c.level)}（経験値 ${c.progress.xp.toFixed(0)}／${String(c.progress.toNext)}）・${text(sim.job.text as TextKey)} ジョブLv${String(c.jobLevel(sim.job.id))}（${c.jobTrack(sim.job.id).xp.toFixed(0)}／${String(c.jobTrack(sim.job.id).toNext)}）${c.catchingUp ? "・追いつき補正×2" : ""}`,
      slots,
      `武器：${itemName(sim.db, sim.weapon)}（適性${sim.affinity}・攻撃速度 ${sim.attackSpeed.toFixed(2)}回/秒）${sim.buffs.active.length > 0 ? `・効果：${sim.buffs.active.map((b) => `${this.skillName(b.ref)}（${b.remaining.toFixed(1)}秒）`).join("・")}` : ""}`,
      `人形：HP ${dummy.health.hp.toFixed(0)}／${dummy.health.maxHp.toFixed(0)}・DPS ${sim.dps().toFixed(1)}・ヒット ${String(sim.hitCount)}${dummy.stagger.broken ? "・崩れ" : ""}${dummy.statuses.active.length > 0 ? "・威圧" : ""}`,
      last === undefined
        ? "最後のヒット：なし"
        : `最後のヒット：${last.hit.evaded ? "回避された" : `${last.hit.total.toFixed(1)}${last.hit.crit ? "・会心" : ""}${last.backstab ? "・背面" : ""}${last.ailments.length > 0 ? "・出血" : ""}`}${lastSkill === undefined ? "" : `（${lastSkill.variants.join("・") || "変化なし"}）`}`,
      `危険地帯：被弾 ${String(sim.hazardHits)}／回避で無効 ${String(sim.hazardAvoided)}`,
      `持ち物：装備 ${String(sim.inventory.items.length)}／${String(sim.inventory.capacity)}・金貨 ${String(sim.inventory.gold)}・素材 ${String([...sim.inventory.materials.values()].reduce((a, b) => a + b, 0))}（F で装備を拾う・Alt で名前を全て表示）`,
      `敵：倒した数 ${String(sim.field?.kills ?? 0)}・被弾 ${String(sim.hitsTaken)}・回避で無効 ${String(sim.attacksAvoided)}・倒れた回数 ${String(sim.deaths)}${sim.player.ailments.stacks("AIL-POISON") > 0 ? `・毒 ${String(sim.player.ailments.stacks("AIL-POISON"))}` : ""}${sim.player.stagger.broken ? "・よろめき" : ""}`,
      `セーブ：${this.saveStatus}`,
      `HP ${sim.playerHealth.hp.toFixed(0)}・MP ${sim.mp.toFixed(0)}・気力 ${motion.currentStamina.toFixed(0)}・${gaugeName} ${gauge.value.toFixed(0)}${stageText === "" ? "" : `（${stageText}）`}`,
    ]);
  }
}
