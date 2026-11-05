import { MVP_EQUIP_SLOTS, type MvpEquipSlot } from "@stella/core";

/**
 * インベントリ・装備・キャラクターの画面の配置（画面のピクセル。内部解像度 640×360）。
 * 当たり判定（どこを指しているか）は Phaser に依存しない関数にして、テストで確かめる。
 */
export const PANEL = {
  x: 8,
  y: 28,
  width: 624,
  height: 300,
  /** 装備の部位の一覧（左の列）。 */
  slots: { x: 16, y: 52, width: 150, row: 13 },
  /** インベントリの枠（中の列。10列×6行）。 */
  grid: { x: 176, y: 52, columns: 10, rows: 6, cell: 15 },
  /** ツールチップ・比較・内訳（右の列）。 */
  detail: { x: 340, y: 52, width: 284 },
  /** キャラクターの画面の能力値の一覧（左の列）。 */
  stats: { x: 16, y: 74, width: 300, row: 11 },
  /** キャラクターの画面の技の枠（右の列の下）。 */
  skillSlots: { x: 340, y: 246, width: 284, row: 11, count: 6 },
} as const;

export type PanelKind = "inventory" | "character";

export type PanelTarget =
  | { readonly kind: "slot"; readonly slot: MvpEquipSlot }
  | { readonly kind: "item"; readonly index: number }
  | { readonly kind: "stat"; readonly index: number }
  | { readonly kind: "skillSlot"; readonly index: number };

/** インベントリの画面で、画面の位置が指しているもの（何も指していなければ undefined）。 */
export function inventoryTarget(x: number, y: number): PanelTarget | undefined {
  const s = PANEL.slots;
  if (x >= s.x && x < s.x + s.width && y >= s.y) {
    const i = Math.floor((y - s.y) / s.row);
    const slot = MVP_EQUIP_SLOTS[i];
    if (slot !== undefined) return { kind: "slot", slot };
  }
  const g = PANEL.grid;
  const cx = Math.floor((x - g.x) / g.cell);
  const cy = Math.floor((y - g.y) / g.cell);
  if (x >= g.x && y >= g.y && cx < g.columns && cy < g.rows)
    return { kind: "item", index: cy * g.columns + cx };
  return undefined;
}

/** キャラクターの画面で、画面の位置が指している能力値の行か技の枠（count は能力値の行の数）。 */
export function characterTarget(x: number, y: number, count: number): PanelTarget | undefined {
  const k = PANEL.skillSlots;
  if (x >= k.x && x < k.x + k.width && y >= k.y) {
    const i = Math.floor((y - k.y) / k.row);
    if (i < k.count) return { kind: "skillSlot", index: i };
  }
  const s = PANEL.stats;
  if (x < s.x || x >= s.x + s.width || y < s.y) return undefined;
  const i = Math.floor((y - s.y) / s.row);
  return i < count ? { kind: "stat", index: i } : undefined;
}

/** インベントリの枠の左上（画面のピクセル）。 */
export function cellPosition(index: number): { x: number; y: number } {
  const g = PANEL.grid;
  return {
    x: g.x + (index % g.columns) * g.cell,
    y: g.y + Math.floor(index / g.columns) * g.cell,
  };
}
