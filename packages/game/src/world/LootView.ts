// 仮実装: U-18a feature/town-and-dungeon-base で、地域の地面のアイテムの表示に置き換える（試験用の表示）
import Phaser from "phaser";
import type { ContentDb, Vec2 } from "@stella/core";
import { text, type TextKey } from "@stella/content";
import { RARITY_COLOR } from "../ui/item-text.ts";
import type { GroundLoot, LootField } from "./LootField.ts";

export { RARITY_COLOR };
import { toPixels } from "./units.ts";

const GOLD_COLOR = "#ffd166";
const MATERIAL_COLOR = "#c3a6ff";
/** 名前を出す距離（m。仮値：Alt を押していないときは、近くの物だけ。docs/progress D-U11-13）。 */
export const LABEL_DISTANCE = 4;

const colorNumber = (c: string): number => Number.parseInt(c.slice(1), 16);

/** 地面の物の表示（LootField の状態を描く）。名前はレアリティの色で、Alt を押している間は全て表示する。 */
export class LootView {
  private readonly scene: Phaser.Scene;
  private readonly db: ContentDb;
  private readonly labels = new Map<number, Phaser.GameObjects.Text>();

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

  render(field: LootField, g: Phaser.GameObjects.Graphics, player: Vec2, showAll: boolean): void {
    const alive = new Set<number>();
    for (const d of field.drops) {
      alive.add(d.id);
      const { text: label, color } = this.label(d);
      const x = Math.round(toPixels(d.position.x));
      const y = Math.round(toPixels(d.position.y));
      g.fillStyle(colorNumber(color), 1);
      if (d.kind === "item") g.fillRect(x - 3, y - 3, 6, 6);
      else g.fillCircle(x, y, 2);
      let t = this.labels.get(d.id);
      if (t === undefined) {
        t = this.scene.add
          .text(0, 0, label, { fontFamily: "sans-serif", fontSize: "8px", color })
          .setOrigin(0.5, 1);
        this.labels.set(d.id, t);
      }
      const near = Math.hypot(d.position.x - player.x, d.position.y - player.y) <= LABEL_DISTANCE;
      t.setPosition(x, y - 4).setVisible(showAll || near);
    }
    for (const [id, t] of this.labels) {
      if (alive.has(id)) continue;
      t.destroy();
      this.labels.delete(id);
    }
  }
}
