import Phaser from "phaser";
import type { ContentDb, Vec2 } from "@stella/core";
import { text, type TextKey } from "@stella/content";
import { RARITY_COLOR } from "../ui/item-text.ts";
import type { GroundLoot, LootField } from "./LootField.ts";

export { RARITY_COLOR };
import { ENTITY_DEPTH, WORLD_DEPTH } from "./depth.ts";
import { toPixels } from "./units.ts";
import { LOOT_COLORS } from "./look-tables.ts";
import { TEXTURES } from "./placeholders.ts";
import { pulse } from "./prop-plan.ts";
import { fillShadow } from "./sprites.ts";

const cssColor = (c: number): string => `#${c.toString(16).padStart(6, "0")}`;
const GOLD_COLOR = cssColor(LOOT_COLORS.gold);
const MATERIAL_COLOR = cssColor(LOOT_COLORS.material);
/** 光の柱・脈打つ輪を出すレアリティ（希少以上）。 */
const SHINY: ReadonlySet<string> = new Set(["rare", "unique", "set"]);
/** 名前を出す距離（m。仮値：Alt を押していないときは、近くの物だけ。docs/progress D-U11-13）。 */
export const LABEL_DISTANCE = 4;

const colorNumber = (c: string): number => Number.parseInt(c.slice(1), 16);

/** 地面の物の表示（LootField の状態を描く）。名前はレアリティの色で、Alt を押している間は全て表示する。 */
export class LootView {
  private readonly scene: Phaser.Scene;
  private readonly db: ContentDb;
  private readonly labels = new Map<number, Phaser.GameObjects.Text>();
  /** 地面の物の絵と影（ドロップの id ごと）。 */
  private readonly icons = new Map<number, Phaser.GameObjects.Image>();
  /** 今のフレームで場にある物の id（毎フレーム作り直さず、空にして使い回す）。 */
  private readonly alive = new Set<number>();

  constructor(scene: Phaser.Scene, db: ContentDb) {
    this.scene = scene;
    this.db = db;
  }

  /** 表示の名前と色。 */
  label(d: GroundLoot): { text: string; color: string } {
    switch (d.kind) {
      case "item": {
        const base = this.db.itemBases.get(d.item.base);
        const name = base === undefined ? d.item.base : text(base.text as TextKey);
        return { text: name, color: RARITY_COLOR[d.item.rarity] };
      }
      case "gold":
        return { text: `金貨 ${String(d.amount)}`, color: GOLD_COLOR };
      case "material": {
        const m = this.db.materials.get(d.material);
        const name = m === undefined ? d.material : text(m.text as TextKey);
        return { text: d.count > 1 ? `${name}×${String(d.count)}` : name, color: MATERIAL_COLOR };
      }
    }
  }

  /**
   * 地面の物を描く。装備は宝石形の印をレアリティの色で、金貨は重なった硬貨、素材は紫の結晶。
   * 希少以上の装備は、細い光の柱と足元の脈打つ輪（g に描く。数は少ない）。
   */
  render(
    field: LootField,
    g: Phaser.GameObjects.Graphics,
    player: Vec2,
    showAll: boolean,
    shadows: Phaser.GameObjects.Graphics,
    now = this.scene.time.now,
  ): void {
    const alive = this.alive;
    alive.clear();
    for (const d of field.drops) {
      alive.add(d.id);
      const { text: label, color } = this.label(d);
      const x = Math.round(toPixels(d.position.x));
      const y = Math.round(toPixels(d.position.y));
      let v = this.icons.get(d.id);
      if (v === undefined) {
        const key =
          d.kind === "item"
            ? TEXTURES.lootItem
            : d.kind === "gold"
              ? TEXTURES.lootGold
              : TEXTURES.lootMaterial;
        // 印はプレイヤー・敵の体より下（depth.ts の loot）
        const icon = this.scene.add.image(x, y, key).setDepth(WORLD_DEPTH.loot);
        if (d.kind === "item") icon.setTint(colorNumber(color));
        v = icon;
        this.icons.set(d.id, v);
      }
      // 少しだけ浮き沈みする（id でずらす。揃って動かないように）
      const bob = Math.round(pulse(now, 1600, (d.id % 7) / 7));
      v.setPosition(x, y - bob);
      fillShadow(shadows, x, y + 3, 9, 3);
      if (d.kind === "item" && SHINY.has(d.item.rarity)) {
        const c = colorNumber(color);
        const p = pulse(now, 1200, (d.id % 5) / 5);
        // 光の柱（上へ薄くなる）
        g.fillStyle(c, 0.12).fillRect(x - 2, y - 30, 5, 28);
        g.fillStyle(c, 0.3).fillRect(x, y - 34, 1, 32);
        // 足元の脈打つ輪
        g.lineStyle(1, c, 0.8 - 0.6 * p).strokeEllipse(x, y + 2, 10 + 10 * p, 4 + 4 * p);
      }
      let t = this.labels.get(d.id);
      if (t === undefined) {
        t = this.scene.add
          .text(0, 0, label, { fontFamily: "sans-serif", fontSize: "8px", color })
          .setOrigin(0.5, 1)
          .setDepth(ENTITY_DEPTH.label);
        this.labels.set(d.id, t);
      }
      const near = Math.hypot(d.position.x - player.x, d.position.y - player.y) <= LABEL_DISTANCE;
      t.setPosition(x, y - 6).setVisible(showAll || near);
    }
    for (const [id, t] of this.labels) {
      if (alive.has(id)) continue;
      t.destroy();
      this.labels.delete(id);
    }
    for (const [id, v] of this.icons) {
      if (alive.has(id)) continue;
      v.destroy();
      this.icons.delete(id);
    }
  }
}
