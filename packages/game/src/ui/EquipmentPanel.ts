import Phaser from "phaser";
import {
  MVP_EQUIP_SLOTS,
  type ItemInstance,
  type MvpEquipSlot,
  type SheetRow,
  CRAFT_MATERIALS,
  CRAFT_OPS,
  type CraftOp,
  AWAKENING_DUST_PRICE,
  INSCRIPTIONS,
  MAX_LOADOUTS,
  basePrice,
  sellPrice,
  craftBlock,
  loadoutsUsing,
  damagePreview,
  effectMatchesContexts,
  enhanceCost,
  opLoad,
  Rng,
  sheetRows,
  ALTAR_TOKEN_COST,
} from "@stella/core";
import { text, type TextKey } from "@stella/content";
import { type ArenaSimulation, SKILL_SLOTS, type SkillSlot } from "../scenes/arena-simulation.ts";
import {
  RARITY_COLOR,
  SLOT_NAME,
  TEXT_COLOR,
  type TextLine,
  breakdownLines,
  comparisonLines,
  effectText,
  itemName,
  sheetRowText,
  tooltipLines,
} from "./item-text.ts";
import {
  BOARD_AREA,
  BOARD_DETAIL,
  type BoardCamera,
  ZOOM,
  clampZoom,
  nodeAt,
  nodeLines,
  nodeRadius,
  toScreen,
} from "./star-board-view.ts";
import {
  PANEL,
  type PanelKind,
  type PanelTarget,
  cellPosition,
  characterTarget,
  inventoryTarget,
  stashCellAt,
  stashCellPosition,
} from "./panel-layout.ts";

const DEPTH = 1000;
/** インベントリの画面のロードアウトの切り替えの列（画面のピクセル）。 */
const LOADOUT_ROW = {
  x: PANEL.grid.x,
  y: PANEL.grid.y + PANEL.grid.rows * PANEL.grid.cell + 44,
  w: 40,
  h: 12,
};
/** 技の枠のキー（補助仕様書1.1）。 */
const SKILL_KEY: Readonly<Record<SkillSlot, string>> = {
  skill1: "左クリック",
  skill2: "右クリック",
  skill3: "1",
  skill4: "2",
  skill5: "3",
  skill6: "4",
};
const FONT = { fontFamily: "sans-serif", fontSize: "9px" } as const;
const LINE = 11;
const colorNumber = (c: string): number => Number.parseInt(c.slice(1), 16);

/** 表示した行（自動の確認で、表示の数値を読むため）。 */
export interface PanelSnapshot {
  readonly open: PanelKind | undefined;
  readonly hovered: PanelTarget | undefined;
  readonly lines: readonly string[];
}

/**
 * インベントリ・装備（I）とキャラクター（C）の画面（補助仕様書16章）。
 * - インベントリ：左クリックで装備（武器は主手）、右クリックで副手に装備、装備の部位を左クリックで外す。
 *   指した装備のツールチップと、装備したときの比較を右の列に出す
 * - キャラクター：能力値の一覧。指した能力値の修正値の内訳を右の列に出す
 * 表示の数値は、戦闘と同じ計算（ArenaSimulation.sheet）から作る。
 */
export class EquipmentPanel {
  private readonly scene: Phaser.Scene;
  private readonly sim: ArenaSimulation;
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly pool: Phaser.GameObjects.Text[] = [];
  private used = 0;
  private kind: PanelKind | undefined;
  private hovered: PanelTarget | undefined;
  private shown: string[] = [];
  private message: { text: string; until: number; color: string } | undefined;
  /** 星辰盤の全体の振り直しの行（クリックの当たり判定）。 */
  private respecRow: { y0: number; y1: number } | undefined;
  /** 鍛冶屋で選んだ装備の uid。 */
  private smithSelected: string | undefined;
  /** 鍛冶屋の操作の行（クリックの当たり判定。描くたびに作り直す）。 */
  private smithRows: { y0: number; y1: number; run: () => void }[] = [];
  /** 職紋盤の画面の行（左右の2列）。 */
  private jobRows: { x0: number; x1: number; y0: number; y1: number; run: () => void }[] = [];
  /** 星辰盤の視点（始点を中心にして開く）。 */
  private camera: BoardCamera = { cx: 0, cy: 0, zoom: ZOOM.initial };
  /** 星辰盤をドラッグで動かしている（押した位置と、その時の視点）。 */
  private drag: { x: number; y: number; cam: BoardCamera; moved: boolean } | undefined;

  private readonly onTravel: ((to: string) => void) | undefined;

  constructor(
    scene: Phaser.Scene,
    sim: ArenaSimulation,
    options: { readonly onTravel?: (to: string) => void } = {},
  ) {
    this.scene = scene;
    this.sim = sim;
    this.onTravel = options.onTravel;
    this.g = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH);
    scene.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      const button = p.button === 2 ? "right" : "left";
      // 星辰盤の何も無い所を左ボタンで押すと、ドラッグで動かす（離したときに動いていなければ何もしない）
      if (
        this.kind === "starBoard" &&
        button === "left" &&
        nodeAt(sim.db, this.camera, p.x, p.y) === undefined
      ) {
        this.drag = { x: p.x, y: p.y, cam: this.camera, moved: false };
        return;
      }
      this.click(p.x, p.y, button);
    });
    scene.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      const d = this.drag;
      if (d === undefined || !p.isDown) return;
      if (Math.hypot(p.x - d.x, p.y - d.y) > 2) d.moved = true;
      this.camera = {
        ...d.cam,
        cx: d.cam.cx - (p.x - d.x) / d.cam.zoom,
        cy: d.cam.cy - (p.y - d.y) / d.cam.zoom,
      };
    });
    scene.input.on("pointerup", () => {
      this.drag = undefined;
    });
    // ホイールで拡大・縮小（星辰盤だけ）
    scene.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      if (this.kind === "starBoard") this.zoomBy(dy > 0 ? 1 / 1.15 : 1.15);
    });
  }

  /** 星辰盤の拡大率を変える（自動の確認でも使う）。 */
  zoomBy(k: number): void {
    this.camera = { ...this.camera, zoom: clampZoom(this.camera.zoom * k) };
  }

  /** 星辰盤の視点を、ノードの位置に合わせる（開いたときは始点）。 */
  centerOn(id: string | undefined): void {
    const n = id === undefined ? undefined : this.sim.db.starNodes.get(id);
    if (n !== undefined) this.camera = { ...this.camera, cx: n.position.x, cy: n.position.y };
  }

  /** ノードの画面の位置（自動の確認で、クリックする位置を求めるため）。 */
  nodeScreen(id: string): { x: number; y: number } | undefined {
    const n = this.sim.db.starNodes.get(id);
    return n === undefined ? undefined : toScreen(this.camera, n.position);
  }

  get open(): PanelKind | undefined {
    return this.kind;
  }

  /** 画面を開く・閉じる（同じ画面のキーなら閉じる）。 */
  toggle(kind: PanelKind): void {
    // 施設の画面（鍛冶屋・倉庫・商人・転移の石）を開いているときは、どのキーでも閉じる
    const facility =
      this.kind === "smith" ||
      this.kind === "stash" ||
      this.kind === "merchant" ||
      this.kind === "teleport" ||
      this.kind === "altar";
    this.kind =
      this.kind === kind || (facility && this.sim.region !== undefined) ? undefined : kind;
    this.hovered = undefined;
    if (this.kind === "starBoard") this.centerOn(this.sim.starRoot);
  }

  close(): void {
    this.kind = undefined;
  }

  /** 画面を開く（施設を使ったとき）。開いていれば何もしない。 */
  show(kind: PanelKind): void {
    if (this.kind === kind) return;
    this.kind = kind;
    this.hovered = undefined;
    if (kind === "starBoard") this.centerOn(this.sim.starRoot);
  }

  snapshot(): PanelSnapshot {
    return { open: this.kind, hovered: this.hovered, lines: this.shown };
  }

  /** 画面の位置を指す（マウスを動かしたとき。自動の確認でも使う）。 */
  hover(x: number, y: number): void {
    if (this.kind === "starBoard") {
      const n = nodeAt(this.sim.db, this.camera, x, y);
      this.hovered = n === undefined ? undefined : { kind: "starNode", id: n.id };
    } else if (
      this.kind === "inventory" ||
      this.kind === "smith" ||
      this.kind === "stash" ||
      this.kind === "merchant"
    )
      this.hovered = inventoryTarget(x, y);
    else if (this.kind === "character")
      this.hovered = characterTarget(x, y, sheetRows(this.sim.db, this.sim.sheet).length);
    else this.hovered = undefined;
  }

  /** クリック。何かをしたら true。 */
  click(x: number, y: number, button: "left" | "right"): boolean {
    if (this.kind === "teleport" || this.kind === "merchant" || this.kind === "altar") {
      if (x >= PANEL.detail.x) {
        const row = this.smithRows.find((r) => y >= r.y0 && y < r.y1);
        if (row === undefined) return false;
        row.run();
        return true;
      }
      if (this.kind === "teleport" || this.kind === "altar") return false;
      const t = inventoryTarget(x, y);
      const item = t?.kind === "item" ? this.sim.inventory.items[t.index] : undefined;
      if (item === undefined) return false;
      const price = this.sim.sell(item.uid);
      if (price !== undefined)
        this.say(`${itemName(this.sim.db, item)}を ${String(price)} 金貨で売った`, TEXT_COLOR.good);
      return true;
    }
    if (this.kind === "stash") {
      const si = stashCellAt(x, y);
      if (si !== undefined) {
        const item = this.sim.stash.items[si];
        if (item !== undefined && !this.sim.fromStash(item.uid)) this.say("インベントリがいっぱい");
        return true;
      }
      const t = inventoryTarget(x, y);
      const item = t?.kind === "item" ? this.sim.inventory.items[t.index] : undefined;
      if (item === undefined) return false;
      if (!this.sim.toStash(item.uid)) this.say("倉庫がいっぱい");
      return true;
    }
    if (this.kind === "smith") {
      if (x >= PANEL.detail.x) {
        const row = this.smithRows.find((r) => y >= r.y0 && y < r.y1);
        if (row === undefined) return false;
        row.run();
        return true;
      }
      const t = inventoryTarget(x, y);
      if (t?.kind !== "item") return false;
      this.smithSelected = this.sim.inventory.items[t.index]?.uid;
      return true;
    }
    if (this.kind === "jobBoard") {
      const row = this.jobRows.find((r) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1);
      if (row === undefined) return false;
      row.run();
      return true;
    }
    if (this.kind === "starBoard") {
      const r = this.respecRow;
      if (r !== undefined && x >= BOARD_DETAIL.x && y >= r.y0 && y < r.y1) {
        if (this.sim.resetStars()) this.say("星辰盤を全て振り直した", TEXT_COLOR.good);
        return true;
      }
      const n = nodeAt(this.sim.db, this.camera, x, y);
      if (n === undefined) return false;
      if (button === "left") {
        if (!this.sim.allocateStar(n.id)) {
          const block = this.sim.stars.allocateBlock(n.id, this.sim.starRoot, this.sim.starPoints);
          if (block !== "taken" && block !== "start")
            this.say(block === "points" ? "ポイントが足りない" : "取ったノードの隣だけ取れる");
        }
      } else {
        const r = this.sim.refundStar(n.id);
        if (r === "noLamp") this.say("還星の灯が無い");
        else if (r === "blocked" && this.sim.stars.has(n.id))
          this.say("返すと、始点からつながらなくなるノードがある");
      }
      return true;
    }
    if (this.kind === "character") {
      const target = characterTarget(x, y, sheetRows(this.sim.db, this.sim.sheet).length);
      if (target?.kind !== "skillSlot") return false;
      if (!this.sim.cycleSlotSkill(target.index, button === "right" ? -1 : 1))
        this.say("技の実行中は替えられない");
      return true;
    }
    if (this.kind !== "inventory") return false;
    const lo = LOADOUT_ROW;
    if (y >= lo.y && y < lo.y + lo.h && x >= lo.x && x < lo.x + lo.w * MAX_LOADOUTS) {
      const id = Math.floor((x - lo.x) / lo.w) + 1;
      const r = this.sim.switchLoadout(id);
      if (r === "ok") this.say(`ロードアウト${String(id)}に切り替えた`, TEXT_COLOR.good);
      else if (r !== "same")
        this.say(
          r === "notSafe"
            ? "安全地帯（人形の近く）でだけ切り替えられる"
            : r === "inventoryFull"
              ? "インベントリがいっぱい"
              : "切り替えられない",
        );
      return true;
    }
    const target = inventoryTarget(x, y);
    if (target === undefined) return false;
    const sim = this.sim;
    if (target.kind === "slot") {
      if (sim.equipment.get(target.slot) === undefined) return false;
      if (!sim.unequip(target.slot)) this.say("外せない（インベントリがいっぱい・技の実行中）");
      return true;
    }
    if (target.kind !== "item") return false;
    const item = sim.inventory.items[target.index];
    if (item === undefined) return false;
    const slot: MvpEquipSlot | undefined = button === "right" ? "offHand" : undefined;
    if (!sim.equipFromInventory(item.uid, slot))
      this.say(button === "right" ? "副手に装備できない" : "装備できない");
    return true;
  }

  private say(message: string, color: string = TEXT_COLOR.bad): void {
    this.message = { text: message, until: this.scene.time.now + 1500, color };
  }

  private line(x: number, y: number, l: TextLine, width?: number): void {
    let t = this.pool[this.used];
    if (t === undefined) {
      t = this.scene.add
        .text(0, 0, "", FONT)
        .setScrollFactor(0)
        .setDepth(DEPTH + 1);
      this.pool.push(t);
    }
    this.used += 1;
    t.setPosition(x, y).setText(l.text).setColor(l.color).setVisible(true);
    t.setWordWrapWidth(width ?? 0, true);
    this.shown.push(l.text);
  }

  /** 行を上から並べる。最後の y を返す。 */
  private lines(x: number, y: number, list: readonly TextLine[], width: number): number {
    let cy = y;
    for (const l of list) {
      this.line(x, cy, l, width);
      const h = this.pool[this.used - 1]?.height ?? LINE;
      cy += Math.max(LINE, h);
    }
    return cy;
  }

  render(): void {
    this.g.clear();
    this.used = 0;
    this.shown = [];
    if (this.kind !== undefined) {
      this.g
        .fillStyle(0x16151c, 0.97)
        .fillRect(PANEL.x, PANEL.y, PANEL.width, PANEL.height)
        .lineStyle(1, 0x4a4858, 1)
        .strokeRect(PANEL.x, PANEL.y, PANEL.width, PANEL.height);
      if (this.kind === "inventory") this.renderInventory();
      else if (this.kind === "character") this.renderCharacter();
      else if (this.kind === "smith") this.renderSmith();
      else if (this.kind === "stash") this.renderStash();
      else if (this.kind === "merchant") this.renderMerchant();
      else if (this.kind === "teleport") this.renderTeleport();
      else if (this.kind === "altar") this.renderAltar();
      else if (this.kind === "jobBoard") this.renderJobBoard();
      else this.renderStarBoard();
      if (this.message !== undefined && this.scene.time.now < this.message.until)
        this.line(
          PANEL.x + 8,
          PANEL.y + PANEL.height - 14,
          { text: this.message.text, color: this.message.color },
          0,
        );
    }
    for (let i = this.used; i < this.pool.length; i++) this.pool[i]?.setVisible(false);
  }

  private findItem = (uid: string): ItemInstance | undefined =>
    this.sim.equipment.entries().find(([, i]) => i.uid === uid)?.[1] ??
    this.sim.inventory.items.find((i) => i.uid === uid);

  private renderInventory(): void {
    const sim = this.sim;
    const db = sim.db;
    this.line(
      PANEL.x + 8,
      PANEL.y + 6,
      {
        text: "インベントリ・装備（I で閉じる）　左クリック：装備／右クリック：副手に装備／装備の部位をクリック：外す",
        color: TEXT_COLOR.dim,
      },
      0,
    );
    // 装備の部位
    MVP_EQUIP_SLOTS.forEach((slot, i) => {
      const item = sim.equipment.get(slot);
      const y = PANEL.slots.y + i * PANEL.slots.row;
      const hovered = this.hovered?.kind === "slot" && this.hovered.slot === slot;
      if (hovered)
        this.g.fillStyle(0x2a2934, 1).fillRect(PANEL.slots.x - 2, y - 1, PANEL.slots.width, 12);
      this.line(
        PANEL.slots.x,
        y,
        {
          text: `${SLOT_NAME[slot]}：${item === undefined ? "―" : itemName(db, item)}`,
          color: item === undefined ? TEXT_COLOR.dim : RARITY_COLOR[item.rarity],
        },
        0,
      );
    });
    // インベントリの枠
    const g = PANEL.grid;
    for (let i = 0; i < sim.inventory.capacity; i++) {
      const { x, y } = cellPosition(i);
      const item = sim.inventory.items[i];
      const hovered = this.hovered?.kind === "item" && this.hovered.index === i;
      this.g
        .lineStyle(1, hovered ? 0xffe08a : 0x3a3846, 1)
        .strokeRect(x, y, g.cell - 1, g.cell - 1);
      if (item !== undefined)
        this.g
          .fillStyle(colorNumber(RARITY_COLOR[item.rarity]), 0.85)
          .fillRect(x + 3, y + 3, g.cell - 7, g.cell - 7);
    }
    const mats = [...sim.inventory.materials.entries()]
      .map(([id, n]) => {
        const m = db.materials.get(id);
        return `${m === undefined ? id : text(m.text as TextKey)}×${String(n)}`;
      })
      .join("・");
    this.lines(
      g.x,
      g.y + g.rows * g.cell + 4,
      [
        {
          text: `装備 ${String(sim.inventory.items.length)}／${String(sim.inventory.capacity)}・金貨 ${String(sim.inventory.gold)}`,
          color: TEXT_COLOR.normal,
        },
        { text: mats === "" ? "素材なし" : mats, color: TEXT_COLOR.dim },
      ],
      155,
    );
    // ロードアウト（仕様書v0.2 4.13）：番号をクリックで切り替え（安全地帯だけ）
    const lo = LOADOUT_ROW;
    this.line(lo.x, lo.y - LINE - 2, {
      text: `ロードアウト（${sim.inSafeZone ? "クリックで切り替え" : "人形の近くで切り替えられる"}）`,
      color: TEXT_COLOR.dim,
    });
    for (let id = 1; id <= MAX_LOADOUTS; id++) {
      const x = lo.x + (id - 1) * lo.w;
      const active = sim.activeLoadout === id;
      const exists = sim.loadouts.some((l) => l.id === id);
      this.g.lineStyle(1, active ? 0xffd166 : 0x4a4858, 1).strokeRect(x, lo.y, lo.w - 4, lo.h);
      this.line(x + 4, lo.y + 1, {
        text: `${String(id)}${exists ? "" : "（空き）"}`,
        color: active ? TEXT_COLOR.highlight : TEXT_COLOR.normal,
      });
    }
    // ツールチップと比較
    const d = PANEL.detail;
    const target = this.hovered;
    let item: ItemInstance | undefined;
    if (target?.kind === "slot") item = sim.equipment.get(target.slot);
    if (target?.kind === "item") item = sim.inventory.items[target.index];
    if (item === undefined) {
      this.line(
        d.x,
        d.y,
        { text: "装備を指すと、詳しい内容を出す", color: TEXT_COLOR.dim },
        d.width,
      );
      return;
    }
    let y = this.lines(d.x, d.y, tooltipLines(db, sim.tooltip(item)), d.width);
    if (target?.kind === "item") {
      const cmp = sim.compare(item.uid);
      y += 4;
      this.line(d.x, y, { text: "― 装備したときの変化 ―", color: TEXT_COLOR.dim }, d.width);
      y += LINE;
      this.lines(
        d.x,
        y,
        cmp === undefined
          ? [{ text: "装備できない", color: TEXT_COLOR.bad }]
          : comparisonLines(db, cmp),
        d.width,
      );
    }
  }

  private renderCharacter(): void {
    const sim = this.sim;
    const db = sim.db;
    const sheet = sim.sheet;
    const c = sim.character;
    const a = sheet.attributes;
    const basic = sim.basicAttackDamage();
    const preview =
      basic === undefined ? undefined : damagePreview(sheet, basic, Rng.fromSeed("sheet"));
    this.lines(
      PANEL.x + 8,
      PANEL.y + 6,
      [
        {
          text: "キャラクター（C で閉じる）　能力値を指すと、修正値の内訳を出す",
          color: TEXT_COLOR.dim,
        },
        {
          text: `Lv${String(c.level)}・${text(sim.job.text as TextKey)}・剛 ${String(a.go)}・迅 ${String(a.jin)}・理 ${String(a.ri)}・魂 ${String(a.kon)}`,
          color: TEXT_COLOR.normal,
        },
        {
          text: `武器：${itemName(db, sim.weapon)}（適性${sheet.affinity}${sheet.weapon?.requirementMet === false ? "・要求値の未達" : ""}）・攻撃速度 ${sheet.attackSpeed.toFixed(2)}回/秒${preview === undefined ? "" : `・通常攻撃 平均 ${preview.average.toFixed(1)}・会心率 ${(preview.critChance * 100).toFixed(1)}%`}`,
          color: sheet.weapon?.requirementMet === false ? TEXT_COLOR.bad : TEXT_COLOR.normal,
        },
      ],
      PANEL.width - 16,
    );
    const rows: SheetRow[] = sheetRows(db, sheet);
    rows.forEach((row, i) => {
      const y = PANEL.stats.y + i * PANEL.stats.row;
      const hovered = this.hovered?.kind === "stat" && this.hovered.index === i;
      if (hovered)
        this.g.fillStyle(0x2a2934, 1).fillRect(PANEL.stats.x - 2, y - 1, PANEL.stats.width, 11);
      this.line(PANEL.stats.x, y, { text: sheetRowText(db, row), color: TEXT_COLOR.normal }, 0);
    });
    // 技の枠（補助仕様書1.1：左クリック・右クリック・1〜4。左クリックで次の技・右クリックで前の技）
    const k = PANEL.skillSlots;
    this.line(k.x, k.y - LINE - 2, { text: "― 技の枠 ―", color: TEXT_COLOR.dim }, 0);
    const slots = new Map(sim.loadout.map((l) => [l.action, l.skill]));
    SKILL_SLOTS.forEach((slot, i) => {
      const y = k.y + i * k.row;
      if (this.hovered?.kind === "skillSlot" && this.hovered.index === i)
        this.g.fillStyle(0x2a2934, 1).fillRect(k.x - 2, y - 1, k.width, 11);
      const skill = slots.get(slot);
      const def = skill === undefined ? undefined : db.skills.get(skill);
      this.line(
        k.x,
        y,
        {
          text: `${SKILL_KEY[slot]}：${def === undefined ? "―" : text(def.text as TextKey)}`,
          color: def === undefined ? TEXT_COLOR.dim : TEXT_COLOR.normal,
        },
        0,
      );
    });
    const d = PANEL.detail;
    const target = this.hovered;
    const row = target?.kind === "stat" ? rows[target.index] : undefined;
    if (row === undefined) {
      this.line(
        d.x,
        PANEL.stats.y,
        { text: "能力値を指すと、内訳を出す", color: TEXT_COLOR.dim },
        d.width,
      );
      return;
    }
    this.lines(d.x, PANEL.stats.y, breakdownLines(db, row, this.findItem), d.width);
  }

  private renderStarBoard(): void {
    const sim = this.sim;
    const db = sim.db;
    const board = sim.sheet.board;
    const cam = this.camera;
    const g = this.g;
    const lamps = sim.inventory.material("MAT-RETURN-LAMP");
    this.line(
      PANEL.x + 8,
      PANEL.y + 6,
      {
        text: `星辰盤（T で閉じる）　ポイント ${String(sim.stars.spent)}／${String(sim.starPoints)}・還星の灯 ${String(lamps)}　左クリック：取る／右クリック：返す／ドラッグ：動かす／ホイール：拡大・縮小`,
        color: TEXT_COLOR.dim,
      },
      0,
    );
    const a = BOARD_AREA;
    g.lineStyle(1, 0x3a3846, 1).strokeRect(a.x, a.y, a.width, a.height);
    const inside = (p: { x: number; y: number }): boolean =>
      p.x >= a.x && p.y >= a.y && p.x <= a.x + a.width && p.y <= a.y + a.height;
    const active = new Set(board?.active ?? []);
    const allocated = new Set(sim.stars.nodes);
    // タグの強調：今の技に効く効果を持つノード（仕様書v0.2 11章「タグが一致すると光る」）
    const contexts = sim.skillContexts();
    const matches = (id: string): boolean =>
      (db.starNodes.get(id)?.effects ?? []).some((e) => effectMatchesContexts(db, e, contexts));
    // つながり
    for (const [id, near] of db.starLinks) {
      const from = db.starNodes.get(id);
      if (from === undefined) continue;
      for (const other of near) {
        if (other < id) continue;
        const to = db.starNodes.get(other);
        if (to === undefined) continue;
        const p = toScreen(cam, from.position);
        const q = toScreen(cam, to.position);
        if (!inside(p) || !inside(q)) continue;
        const lit =
          (active.has(id) || id === board?.root) && (active.has(other) || other === board?.root);
        g.lineStyle(lit ? 2 : 1, lit ? 0xffd166 : 0x4a4858, 1).lineBetween(p.x, p.y, q.x, q.y);
      }
    }
    // ノード
    for (const n of db.starNodes.values()) {
      const p = toScreen(cam, n.position);
      if (!inside(p)) continue;
      const r = nodeRadius(n.kind, cam.zoom);
      const isRoot = n.id === board?.root;
      const isActive = active.has(n.id);
      const dormant = allocated.has(n.id) && !isActive;
      const can = sim.stars.allocateBlock(n.id, sim.starRoot, sim.starPoints) === undefined;
      const fill = isRoot || isActive ? 0xffd166 : dormant ? 0x6a6878 : 0x2a2934;
      g.fillStyle(fill, 1).fillCircle(p.x, p.y, r);
      const stroke = n.kind === "gate" ? 0xc3a6ff : can ? 0x7bd389 : 0x8c88a0;
      g.lineStyle(1, stroke, 1).strokeCircle(p.x, p.y, r);
      if (n.kind === "start" && !isRoot) g.lineStyle(1, 0x8c88a0, 1).strokeCircle(p.x, p.y, r + 2);
      if (matches(n.id)) g.lineStyle(1, 0xffe08a, 0.9).strokeCircle(p.x, p.y, r + 2);
      if (this.hovered?.kind === "starNode" && this.hovered.id === n.id)
        g.lineStyle(1, 0xffffff, 1).strokeCircle(p.x, p.y, r + 3);
    }
    // 説明
    const d = BOARD_DETAIL;
    const target = this.hovered;
    const node = target?.kind === "starNode" ? db.starNodes.get(target.id) : undefined;
    let y = d.y;
    if (node === undefined)
      y = this.lines(
        d.x,
        y,
        [{ text: "ノードを指すと、効果と状態を出す", color: TEXT_COLOR.dim }],
        d.width,
      );
    else
      y = this.lines(
        d.x,
        y,
        nodeLines(
          db,
          node,
          board,
          allocated.has(node.id),
          sim.stars.allocateBlock(node.id, sim.starRoot, sim.starPoints),
        ),
        d.width,
      );
    const dormantCount = board?.dormant.size ?? 0;
    // 全体の振り直し（町の星読み師。MVPでは無料）。安全地帯だけ
    this.respecRow = { y0: y + 6, y1: y + 6 + LINE };
    this.line(d.x, y + 6, {
      text: sim.inSafeZone
        ? "［全体の振り直し（無料）］"
        : "全体の振り直しは、人形の近く（町の星読み師）で",
      color: sim.inSafeZone ? TEXT_COLOR.good : TEXT_COLOR.dim,
    });
    y += LINE + 2;
    this.lines(
      d.x,
      y + 6,
      [
        {
          text: `有効 ${String(active.size)}・休眠 ${String(dormantCount)}`,
          color: TEXT_COLOR.normal,
        },
        ...[...(board?.gates ?? new Map<string, boolean>())].map(([id, open]) => {
          const gn = db.starNodes.get(id);
          return {
            text: `${gn?.text === undefined ? id : text(gn.text as TextKey)}：${open ? "開いている" : "閉じている"}`,
            color: open ? TEXT_COLOR.good : TEXT_COLOR.bad,
          };
        }),
      ],
      d.width,
    );
  }

  /** 鍛冶屋の操作を行い、結果を出す。 */
  private runSmith(uid: string, action: Parameters<ArenaSimulation["smith"]>[1]): void {
    const r = this.sim.smith(uid, action);
    this.say(r.message, r.ok ? TEXT_COLOR.good : TEXT_COLOR.bad);
    if (action.kind === "disassemble" && r.ok) this.smithSelected = undefined;
  }

  /** 鍛冶屋（仕様書v0.2 3.9〜3.11、補助仕様書8章）：インベントリの装備を選び、強化・銘・クラフト・分解をする。 */
  private renderSmith(): void {
    const sim = this.sim;
    const db = sim.db;
    this.smithRows = [];
    const mats = (Object.values(CRAFT_MATERIALS) as string[])
      .map((m) => {
        const def = db.materials.get(m);
        return `${def === undefined ? m : text(def.text as TextKey)} ${String(sim.inventory.material(m))}`;
      })
      .join("・");
    this.line(
      PANEL.x + 8,
      PANEL.y + 6,
      {
        text: "鍛冶屋（B で閉じる）　装備をクリックで選び、右の操作をクリック",
        color: TEXT_COLOR.dim,
      },
      0,
    );
    this.line(
      PANEL.x + 8,
      PANEL.y + PANEL.height - 28,
      { text: mats, color: TEXT_COLOR.normal },
      0,
    );
    const g = PANEL.grid;
    for (let i = 0; i < sim.inventory.capacity; i++) {
      const { x, y } = cellPosition(i);
      const item = sim.inventory.items[i];
      const selected = item !== undefined && item.uid === this.smithSelected;
      const hovered = this.hovered?.kind === "item" && this.hovered.index === i;
      this.g
        .lineStyle(1, selected ? 0x7bd389 : hovered ? 0xffe08a : 0x3a3846, 1)
        .strokeRect(x, y, g.cell - 1, g.cell - 1);
      if (item !== undefined)
        this.g
          .fillStyle(colorNumber(RARITY_COLOR[item.rarity]), 0.85)
          .fillRect(x + 3, y + 3, g.cell - 7, g.cell - 7);
    }
    const d = PANEL.detail;
    const item = sim.inventory.items.find((i) => i.uid === this.smithSelected);
    if (item === undefined) {
      this.line(d.x, d.y, { text: "装備を選ぶと、操作を出す", color: TEXT_COLOR.dim }, d.width);
      return;
    }
    this.lines(PANEL.slots.x, PANEL.slots.y, tooltipLines(db, sim.tooltip(item)), 150);
    const uid = item.uid;
    const matName = (m: string): string => {
      const def = db.materials.get(m);
      return def === undefined ? m : text(def.text as TextKey);
    };
    const actions: { label: string; run: () => void; enabled: boolean }[] = [];
    const cost = enhanceCost(item);
    actions.push({
      label:
        cost === undefined
          ? "強化：上限（+10）"
          : `強化 +${String((item.enhance ?? 0) + 1)}（${Object.entries(cost)
              .map(([m, n]) => `${matName(m)}${String(n)}`)
              .join("・")}）`,
      run: () => {
        this.runSmith(uid, { kind: "enhance" });
      },
      enabled:
        cost !== undefined &&
        Object.entries(cost).every(([m, n]) => sim.inventory.material(m) >= n),
    });
    if ((item.enhance ?? 0) >= 10 && item.inscription === undefined)
      for (const e of INSCRIPTIONS)
        actions.push({
          label: `銘：${effectText(db, e)}`,
          run: () => {
            this.runSmith(uid, { kind: "inscribe", effect: e });
          },
          enabled: true,
        });
    const op = (o: CraftOp, label: string): void => {
      const block = craftBlock(item, o);
      const m = CRAFT_OPS[o.kind].material;
      actions.push({
        label: `${label}（${matName(m)} ${String(sim.inventory.material(m))}・負荷+${String(opLoad(item, o))}）`,
        run: () => {
          this.runSmith(uid, o);
        },
        enabled: block === undefined && sim.inventory.material(m) > 0,
      });
    };
    if (item.rarity === "normal") op({ kind: "awaken" }, "目覚めの粉：魔法にする");
    if (item.rarity === "magic") op({ kind: "insight" }, "開眼の結晶：希少にする");
    if (item.rarity === "rare") op({ kind: "transmute" }, "転詞の石：詞を全て抽選し直す");
    if (item.affixes.length > 0) op({ kind: "erase" }, "削詞の刃：詞を1つ消す");
    for (const a of item.affixes) {
      const def = db.affixes.get(a.id);
      const name = def === undefined ? a.id : text(def.text as TextKey);
      op({ kind: "tune", affix: a.id }, `調律：${name}`);
      if (item.sealed !== a.id) op({ kind: "seal", affix: a.id }, `封詞：${name}`);
    }
    actions.push({
      label: (() => {
        const using = loadoutsUsing(sim.loadouts, uid);
        return `分解する（装備はなくなる${using.length > 0 ? `。ロードアウト${using.join("・")}の部位が空きになる` : ""}）`;
      })(),
      run: () => {
        this.runSmith(uid, { kind: "disassemble" });
      },
      enabled: true,
    });
    let y: number = d.y;
    for (const a of actions) {
      const y0 = y;
      y = this.lines(
        d.x,
        y,
        [{ text: a.label, color: a.enabled ? TEXT_COLOR.good : TEXT_COLOR.dim }],
        d.width,
      );
      if (a.enabled) this.smithRows.push({ y0, y1: y, run: a.run });
    }
  }

  /** インベントリの枠を描く（倉庫・商人・鍛冶屋で共通）。 */
  private drawInventoryGrid(selected?: string): void {
    const sim = this.sim;
    const g = PANEL.grid;
    for (let i = 0; i < sim.inventory.capacity; i++) {
      const { x, y } = cellPosition(i);
      const item = sim.inventory.items[i];
      const hovered = this.hovered?.kind === "item" && this.hovered.index === i;
      const isSel = item !== undefined && item.uid === selected;
      this.g
        .lineStyle(1, isSel ? 0x7bd389 : hovered ? 0xffe08a : 0x3a3846, 1)
        .strokeRect(x, y, g.cell - 1, g.cell - 1);
      if (item !== undefined)
        this.g
          .fillStyle(colorNumber(RARITY_COLOR[item.rarity]), 0.85)
          .fillRect(x + 3, y + 3, g.cell - 7, g.cell - 7);
    }
  }

  /** 指したインベントリの装備のツールチップを、左の列に出す。 */
  private hoveredTooltip(): void {
    const t = this.hovered;
    const item = t?.kind === "item" ? this.sim.inventory.items[t.index] : undefined;
    if (item !== undefined)
      this.lines(
        PANEL.slots.x,
        PANEL.slots.y,
        tooltipLines(this.sim.db, this.sim.tooltip(item)),
        150,
      );
  }

  /** 倉庫（補助仕様書13章：120枠。町だけ）。 */
  private renderStash(): void {
    const sim = this.sim;
    this.line(
      PANEL.x + 8,
      PANEL.y + 6,
      {
        text: `倉庫（I で閉じる）　インベントリの装備をクリックで倉庫へ／倉庫の装備をクリックでインベントリへ　倉庫 ${String(sim.stash.items.length)}／${String(sim.stash.capacity)}`,
        color: TEXT_COLOR.dim,
      },
      0,
    );
    this.drawInventoryGrid();
    const g = PANEL.stashGrid;
    for (let i = 0; i < g.columns * g.rows; i++) {
      const { x, y } = stashCellPosition(i);
      const item = sim.stash.items[i];
      this.g.lineStyle(1, 0x3a3846, 1).strokeRect(x, y, g.cell - 1, g.cell - 1);
      if (item !== undefined)
        this.g
          .fillStyle(colorNumber(RARITY_COLOR[item.rarity]), 0.85)
          .fillRect(x + 3, y + 3, g.cell - 7, g.cell - 7);
    }
    this.hoveredTooltip();
  }

  /** 商人（補助仕様書5章）：インベントリの装備をクリックで売る、品揃えをクリックで買う。 */
  private renderMerchant(): void {
    const sim = this.sim;
    const db = sim.db;
    this.smithRows = [];
    this.line(
      PANEL.x + 8,
      PANEL.y + 6,
      {
        text: `商人（I で閉じる）　インベントリの装備をクリックで売る／右の品をクリックで買う　金貨 ${String(sim.inventory.gold)}`,
        color: TEXT_COLOR.dim,
      },
      0,
    );
    this.drawInventoryGrid();
    this.hoveredTooltip();
    const t = this.hovered;
    const hoveredItem = t?.kind === "item" ? sim.inventory.items[t.index] : undefined;
    if (hoveredItem !== undefined)
      this.line(
        PANEL.grid.x,
        PANEL.grid.y + PANEL.grid.rows * PANEL.grid.cell + 30,
        { text: `売値 ${String(sellPrice(hoveredItem))} 金貨`, color: TEXT_COLOR.highlight },
        0,
      );
    const d = PANEL.detail;
    const rows: { label: string; run: () => void; enabled: boolean }[] = sim.merchantStock.map(
      (item) => {
        const price = basePrice(item.itemLevel);
        return {
          label: `${itemName(db, item)}（アイテムLv${String(item.itemLevel)}）　${String(price)} 金貨`,
          run: () => {
            if (sim.buy(item.uid)) this.say(`${itemName(db, item)}を買った`, TEXT_COLOR.good);
            else this.say("金貨が足りない・インベントリがいっぱい");
          },
          enabled: sim.inventory.gold >= price,
        };
      },
    );
    rows.push({
      label: `目覚めの粉　${String(AWAKENING_DUST_PRICE)} 金貨`,
      run: () => {
        if (sim.buyDust()) this.say("目覚めの粉を買った", TEXT_COLOR.good);
        else this.say("金貨が足りない");
      },
      enabled: sim.inventory.gold >= AWAKENING_DUST_PRICE,
    });
    let y: number = d.y;
    this.line(d.x, y, { text: "― 品揃え（町に戻るたびに入れ替わる）―", color: TEXT_COLOR.dim }, 0);
    y += LINE + 2;
    for (const r of rows) {
      const y0 = y;
      y = this.lines(
        d.x,
        y,
        [{ text: r.label, color: r.enabled ? TEXT_COLOR.good : TEXT_COLOR.dim }],
        d.width,
      );
      this.smithRows.push({ y0, y1: y, run: r.run });
    }
  }

  /** 転移の石（補助仕様書9.4）：解放した地域の入口へ移る。 */
  /**
   * 職紋盤（仕様書v0.2 4.10）：メインジョブの盤のノードを一覧で出し、クリックで取る。
   * 振り直し（全て返す）は、安全地帯で金貨を払う。
   */
  private renderJobBoard(): void {
    const sim = this.sim;
    const db = sim.db;
    const board = sim.jobBoard;
    const points = sim.jobBoardPoints;
    this.jobRows = [];
    this.line(
      PANEL.x + 8,
      PANEL.y + 6,
      {
        text: `職紋盤：${text(sim.job.text as TextKey)}（J で閉じる）　ポイント ${String(board.spent)}／${String(points)}　クリック：取る`,
        color: TEXT_COLOR.dim,
      },
      0,
    );
    const nodes = [...db.jobNodes.values()].filter(
      (n) => n.job === sim.job.id && n.kind !== "start",
    );
    const label = (id: string): TextLine => {
      const n = db.jobNodes.get(id);
      if (n === undefined) return { text: id, color: TEXT_COLOR.dim };
      const taken = board.has(id);
      const can = board.allocateBlock(id, points) === undefined;
      const mark = taken ? "■" : can ? "□" : "・";
      const kind = n.kind === "mastery" ? "【職奥義】" : n.kind === "connector" ? "【接続】" : "";
      const name = n.text === undefined ? "" : `${text(n.text as TextKey)}：`;
      const desc =
        n.description !== undefined
          ? text(n.description as TextKey)
          : (n.effects ?? []).map((e) => effectText(db, e)).join("・");
      return {
        text: `${mark} ${kind}${name}${desc}`,
        color: taken ? TEXT_COLOR.highlight : can ? TEXT_COLOR.good : TEXT_COLOR.dim,
      };
    };
    const column = (x: number, width: number, y0: number, ids: readonly string[]): number => {
      let y = y0;
      for (const id of ids) {
        const top = y;
        y = this.lines(x, y, [label(id)], width);
        this.jobRows.push({
          x0: x,
          x1: x + width,
          y0: top,
          y1: y,
          run: () => {
            if (sim.allocateJobNode(id)) return;
            const block = board.allocateBlock(id, points);
            if (block === "taken") return;
            this.say(
              block === "points"
                ? "ポイントが足りない（ジョブLvで増える）"
                : block === "masteryChosen"
                  ? "職奥義は1つだけ選べる"
                  : "取ったノードの隣だけ取れる",
            );
          },
        });
      }
      return y;
    };
    const left = nodes.filter((n) => n.kind === "minor" || n.kind === "notable").map((n) => n.id);
    const right = nodes
      .filter((n) => n.kind === "connector" || n.kind === "mastery")
      .map((n) => n.id);
    column(PANEL.slots.x, PANEL.detail.x - PANEL.slots.x - 8, PANEL.slots.y, left);
    let y = column(PANEL.detail.x, PANEL.detail.width, PANEL.detail.y, right);
    y += LINE;
    const top = y;
    const cost = sim.jobBoardRespecCost;
    y = this.lines(
      PANEL.detail.x,
      y,
      [
        {
          text: `▶ 全て振り直す（金貨 ${String(cost)}。安全地帯だけ）　所持 ${String(sim.inventory.gold)}`,
          color: sim.inventory.gold >= cost && board.spent > 0 ? TEXT_COLOR.good : TEXT_COLOR.dim,
        },
      ],
      PANEL.detail.width,
    );
    this.jobRows.push({
      x0: PANEL.detail.x,
      x1: PANEL.detail.x + PANEL.detail.width,
      y0: top,
      y1: y,
      run: () => {
        if (sim.resetJobBoard()) this.say("職紋盤を全て振り直した", TEXT_COLOR.good);
        else this.say("振り直せない（安全地帯・金貨・取得したノードが要る）");
      },
    });
  }

  /** 討伐の祭壇（仕様書v0.2 3.12）：討伐証10個で、専用ユニークを1つ選んで交換する。 */
  private renderAltar(): void {
    const sim = this.sim;
    const db = sim.db;
    this.smithRows = [];
    this.line(
      PANEL.x + 8,
      PANEL.y + 6,
      { text: "討伐の祭壇（I で閉じる）　欲しいユニークをクリック", color: TEXT_COLOR.dim },
      0,
    );
    const d = PANEL.detail;
    let y: number = d.y;
    for (const c of sim.altarCandidates()) {
      const have = sim.bossTokens.get(c.token) ?? 0;
      y = this.lines(
        d.x,
        y,
        [
          {
            text: `討伐証 ${String(have)}／${String(ALTAR_TOKEN_COST)}`,
            color: have >= ALTAR_TOKEN_COST ? TEXT_COLOR.good : TEXT_COLOR.dim,
          },
        ],
        d.width,
      );
      for (const baseId of c.bases) {
        const base = db.itemBases.get(baseId);
        if (base === undefined) continue;
        const y0 = y;
        y = this.lines(
          d.x,
          y,
          [
            {
              text: `◆ ${text(base.text as TextKey)}（必要Lv${String(base.requiredLevel)}）`,
              color: have >= ALTAR_TOKEN_COST ? TEXT_COLOR.highlight : TEXT_COLOR.dim,
            },
          ],
          d.width,
        );
        this.smithRows.push({
          y0,
          y1: y,
          run: () => {
            if (sim.exchangeAtAltar(baseId))
              this.say(`${text(base.text as TextKey)}と交換した`, TEXT_COLOR.good);
            else this.say("討伐証が足りない・インベントリがいっぱい", TEXT_COLOR.bad);
          },
        });
      }
    }
  }

  private renderTeleport(): void {
    const sim = this.sim;
    const db = sim.db;
    this.smithRows = [];
    this.line(
      PANEL.x + 8,
      PANEL.y + 6,
      { text: "転移の石（I で閉じる）　行き先をクリック", color: TEXT_COLOR.dim },
      0,
    );
    const dests: { id: string; name: string }[] = [];
    for (const id of sim.unlockedRegions) {
      const r = db.regions.get(id);
      if (r !== undefined && r.kind === "dungeon")
        dests.push({ id, name: text(r.text as TextKey) });
    }
    // 開発用の機能：開発用の試験用の場（開発版だけ）
    if (import.meta.env.DEV) dests.push({ id: "DEV-ARENA", name: "試験用の場（開発用）" });
    const d = PANEL.detail;
    let y: number = d.y;
    if (dests.length === 0)
      this.line(
        d.x,
        y,
        { text: "まだ解放した転移の石が無い（地域の入口の石に触れる）", color: TEXT_COLOR.dim },
        d.width,
      );
    for (const dest of dests) {
      const y0 = y;
      y = this.lines(d.x, y, [{ text: `→ ${dest.name}`, color: TEXT_COLOR.good }], d.width);
      this.smithRows.push({
        y0,
        y1: y,
        run: () => {
          this.onTravel?.(dest.id);
        },
      });
    }
  }
}
