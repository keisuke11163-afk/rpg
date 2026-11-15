import Phaser from "phaser";
import type { ArenaSimulation, FieldChest } from "../scenes/arena-simulation.ts";
import { WORLD_DEPTH } from "./depth.ts";
import { FACILITY_LOOKS, PROP_COLORS } from "./look-tables.ts";
import {
  CHEST_SIZE,
  STONE_SIZE,
  TEXTURES,
  chestTexture,
  facilityTexture,
  stoneTexture,
} from "./placeholders.ts";
import { exitDirection, pulse } from "./prop-plan.ts";
import { toPixels } from "./units.ts";

/** 場の物の表示が読むもの（sim の一部）。 */
export type PropSource = Pick<
  ArenaSimulation,
  | "region"
  | "size"
  | "chests"
  | "unlockedRegions"
  | "secretsFound"
  | "exitOpen"
  | "nearbyInteractable"
>;

/** 場の物の絵の、位置に対する原点（下の辺の少し上が位置。足元に影を置く）。 */
const PROP_ORIGIN_Y = 0.62;

/** 場の物の絵（高さ height ピクセル）の、位置より下にはみ出す高さ（名前を絵の下に置くのに使う）。 */
export function propBelow(height: number): number {
  return Math.round((1 - PROP_ORIGIN_Y) * height);
}

interface Prop {
  readonly image: Phaser.GameObjects.Image;
  readonly shadow: Phaser.GameObjects.Image;
}

/**
 * 場の物（町の施設・宝箱・転移の石・隠し星・出口）の表示。
 * 物の絵は地域に入ったときに作り、状態（宝箱を開けた・石を解放した・隠し星を見つけた・出口が開いた）が
 * 変わったときだけ絵を替える。F で使える物（sim.nearbyInteractable）の下に光を出す（HUD の案内と同じ物）。
 * 物の位置は sim の位置のまま（クリック・確認の位置を変えない）。
 */
export class PropView {
  private readonly scene: Phaser.Scene;
  private readonly facilities = new Map<string, Prop>();
  private readonly chests = new Map<FieldChest, Prop>();
  private readonly secrets = new Map<string, Prop>();
  private stone: Prop | undefined;
  /** 転移の石（と町の転移の石）の、いつも出す淡い光。 */
  private stoneGlow: Phaser.GameObjects.Image | undefined;
  private stoneLit: boolean | undefined;
  /** F で使える物の下の光（1つを使い回す）。 */
  private readonly focus: Phaser.GameObjects.Image;
  /** 開いた出口（明滅させる）と閉じた出口の絵。 */
  private readonly exitsOpen: Phaser.GameObjects.Graphics;
  private readonly exitsClosed: Phaser.GameObjects.Graphics;
  /** 出口の開閉（前のフレーム。変わったときだけ描き直す。毎フレーム文字列を作らないよう、真偽値の列で持つ）。 */
  private exitState: boolean[] | undefined;

  constructor(scene: Phaser.Scene, src: PropSource) {
    this.scene = scene;
    this.exitsOpen = scene.add.graphics().setDepth(WORLD_DEPTH.exit);
    this.exitsClosed = scene.add.graphics().setDepth(WORLD_DEPTH.exit);
    this.focus = scene.add
      .image(0, 0, TEXTURES.glow)
      .setDepth(WORLD_DEPTH.propGlow)
      .setTint(PROP_COLORS.glow)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false);
    const r = src.region;
    if (r === undefined) return;
    for (const f of r.facilities ?? []) {
      if (f.kind === "dummy") continue;
      const look = FACILITY_LOOKS[f.kind];
      this.facilities.set(f.kind, this.prop(f.at.x, f.at.y, facilityTexture(f.kind), look.width));
      if (f.kind === "teleport") this.stoneGlow = this.glow(f.at.x, f.at.y, look.accent);
    }
    const stone = r.teleportStone;
    if (stone !== undefined && r.kind === "dungeon") {
      this.stone = this.prop(stone.x, stone.y, stoneTexture(false), STONE_SIZE.width);
      this.stoneGlow = this.glow(stone.x, stone.y, PROP_COLORS.stoneLit.glow);
    }
    for (const x of r.secrets ?? [])
      this.secrets.set(x.id, this.prop(x.at.x, x.at.y, TEXTURES.secret, 16));
  }

  private prop(x: number, y: number, key: string, width: number): Prop {
    const px = Math.round(toPixels(x));
    const py = Math.round(toPixels(y));
    const shadow = this.scene.add
      .image(px, py + 4, TEXTURES.shadow)
      .setDisplaySize(width + 2, 6)
      .setDepth(WORLD_DEPTH.prop - 1);
    const image = this.scene.add
      .image(px, py, key)
      .setOrigin(0.5, PROP_ORIGIN_Y)
      .setDepth(WORLD_DEPTH.prop);
    return { image, shadow };
  }

  private glow(x: number, y: number, color: number): Phaser.GameObjects.Image {
    return this.scene.add
      .image(Math.round(toPixels(x)), Math.round(toPixels(y)) - 2, TEXTURES.glow)
      .setDepth(WORLD_DEPTH.propGlow)
      .setTint(color)
      .setBlendMode(Phaser.BlendModes.ADD);
  }

  /** 状態を合わせ、光を動かす（毎フレーム。絵を替えるのは状態が変わったときだけ）。 */
  update(src: PropSource, now: number): void {
    const r = src.region;
    if (r === undefined) return;
    // 宝箱：場に出た宝箱（入るたびに抽選）の絵を作り、開けたら替える
    for (const c of src.chests) {
      let p = this.chests.get(c);
      if (p === undefined) {
        p = this.prop(c.at.x, c.at.y, chestTexture(c.kind, c.opened), CHEST_SIZE.width);
        this.chests.set(c, p);
      }
      const key = chestTexture(c.kind, c.opened);
      if (p.image.texture.key !== key) p.image.setTexture(key);
    }
    for (const [id, p] of this.secrets) {
      const found = src.secretsFound.has(id);
      p.image.setVisible(!found);
      p.shadow.setVisible(!found);
    }
    // 転移の石：解放したら緑に。光はゆっくり明滅（町の石はいつも光る）
    if (this.stone !== undefined) {
      const lit = src.unlockedRegions.has(r.id);
      if (lit !== this.stoneLit) {
        this.stoneLit = lit;
        this.stone.image.setTexture(stoneTexture(lit));
        this.stoneGlow?.setVisible(lit);
      }
    }
    this.stoneGlow
      ?.setAlpha(0.35 + 0.35 * pulse(now, 2200))
      .setScale(0.9 + 0.15 * pulse(now, 2200));
    this.drawExits(src, now);
    // F で使える物の下の光
    const near = src.nearbyInteractable();
    let target: Prop | undefined;
    if (near !== undefined)
      switch (near.kind) {
        case "chest":
          target = this.chests.get(near.chest);
          break;
        case "secret":
          target = this.secrets.get(near.id);
          break;
        case "stone":
          target = this.stone;
          break;
        case "facility":
          target = this.facilities.get(near.facility);
          break;
      }
    if (target === undefined) this.focus.setVisible(false);
    else {
      const img = target.image;
      const k = Math.max(img.width, img.height) / 20;
      this.focus
        .setVisible(true)
        .setPosition(img.x, img.y - 2)
        .setScale(k * (1 + 0.08 * pulse(now, 900)))
        .setAlpha(0.55 + 0.3 * pulse(now, 900));
    }
  }

  /** 出口：開いている＝緑の光る帯と外向きの矢印、閉じている＝赤い帯と格子。開閉が変わったときだけ描く。 */
  private drawExits(src: PropSource, now: number): void {
    const exits = src.region?.exits ?? [];
    const prev = this.exitState;
    let changed = prev?.length !== exits.length;
    for (let i = 0; !changed && i < exits.length; i++) {
      const x = exits[i];
      if (x !== undefined && src.exitOpen(x) !== prev?.[i]) changed = true;
    }
    if (changed) {
      const state = exits.map((x) => src.exitOpen(x));
      this.exitState = state;
      this.exitsOpen.clear();
      this.exitsClosed.clear();
      exits.forEach((x, i) => {
        const open = state[i] === true;
        const g = open ? this.exitsOpen : this.exitsClosed;
        const color = open ? PROP_COLORS.exitOpen : PROP_COLORS.exitClosed;
        const rx = toPixels(x.rect.x);
        const ry = toPixels(x.rect.y);
        const rw = toPixels(x.rect.width);
        const rh = toPixels(x.rect.height);
        const dir = exitDirection(x.rect, src.size);
        const horizontal = dir === "left" || dir === "right";
        g.fillStyle(color, open ? 0.16 : 0.12).fillRect(rx, ry, rw, rh);
        // 地域の内側を向いた辺に明るい線
        g.fillStyle(color, 0.85);
        if (dir === "right") g.fillRect(rx, ry, 2, rh);
        else if (dir === "left") g.fillRect(rx + rw - 2, ry, 2, rh);
        else if (dir === "down") g.fillRect(rx, ry, rw, 2);
        else g.fillRect(rx, ry + rh - 2, rw, 2);
        const cx = rx + rw / 2;
        const cy = ry + rh / 2;
        if (open) {
          // 外向きの矢印（帯の長い向きに 1.5m ごと）
          const step = 24;
          const len = horizontal ? rh : rw;
          for (let t = step / 2; t < len; t += step) {
            const ax = horizontal ? cx : rx + t;
            const ay = horizontal ? ry + t : cy;
            const s = dir === "right" || dir === "down" ? 1 : -1;
            g.fillStyle(color, 0.8);
            if (horizontal) g.fillTriangle(ax + 4 * s, ay, ax - 3 * s, ay - 5, ax - 3 * s, ay + 5);
            else g.fillTriangle(ax, ay + 4 * s, ax - 5, ay - 3 * s, ax + 5, ay - 3 * s);
          }
        } else {
          // 閉じた格子
          g.fillStyle(color, 0.55);
          if (horizontal) for (let t = 4; t < rh; t += 6) g.fillRect(rx + 2, ry + t, rw - 4, 1);
          else for (let t = 4; t < rw; t += 6) g.fillRect(rx + t, ry + 2, 1, rh - 4);
        }
      });
    }
    // 開いた出口はゆっくり明滅（閉じた出口は止めておく。明滅は弱め：0.8〜1）
    this.exitsOpen.setAlpha(0.8 + 0.2 * pulse(now, 1400));
  }
}
