import Phaser from "phaser";
import {
  MVP_EQUIP_SLOTS,
  type ItemInstance,
  type MvpEquipSlot,
  type SheetRow,
  damagePreview,
  Rng,
  sheetRows,
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
} from "./panel-layout.ts";

const DEPTH = 1000;
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
  private message: { text: string; until: number } | undefined;
  /** 星辰盤の視点（始点を中心にして開く）。 */
  private camera: BoardCamera = { cx: 0, cy: 0, zoom: ZOOM.initial };
  /** 星辰盤をドラッグで動かしている（押した位置と、その時の視点）。 */
  private drag: { x: number; y: number; cam: BoardCamera; moved: boolean } | undefined;

  constructor(scene: Phaser.Scene, sim: ArenaSimulation) {
    this.scene = scene;
    this.sim = sim;
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
    this.kind = this.kind === kind ? undefined : kind;
    this.hovered = undefined;
    if (this.kind === "starBoard") this.centerOn(this.sim.starRoot);
  }

  close(): void {
    this.kind = undefined;
  }

  snapshot(): PanelSnapshot {
    return { open: this.kind, hovered: this.hovered, lines: this.shown };
  }

  /** 画面の位置を指す（マウスを動かしたとき。自動の確認でも使う）。 */
  hover(x: number, y: number): void {
    if (this.kind === "starBoard") {
      const n = nodeAt(this.sim.db, this.camera, x, y);
      this.hovered = n === undefined ? undefined : { kind: "starNode", id: n.id };
    } else if (this.kind === "inventory") this.hovered = inventoryTarget(x, y);
    else if (this.kind === "character")
      this.hovered = characterTarget(x, y, sheetRows(this.sim.db, this.sim.sheet).length);
    else this.hovered = undefined;
  }

  /** クリック。何かをしたら true。 */
  click(x: number, y: number, button: "left" | "right"): boolean {
    if (this.kind === "starBoard") {
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

  private say(message: string): void {
    this.message = { text: message, until: this.scene.time.now + 1500 };
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
      else this.renderStarBoard();
      if (this.message !== undefined && this.scene.time.now < this.message.until)
        this.line(
          PANEL.x + 8,
          PANEL.y + PANEL.height - 14,
          { text: this.message.text, color: TEXT_COLOR.bad },
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
}
