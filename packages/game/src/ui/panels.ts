/**
 * インベントリ・キャラクターの画面の文章を作る（補助仕様書 16章）。
 * 描画（Phaser）から切り離して、表示する内容だけを組み立てる。
 */
import {
  RARITY_NAME,
  compareTotals,
  computeGear,
  describeItem,
  withGearStats,
  type Equipment,
  type Fighter,
  type GearData,
  type GearStats,
  type ItemBag,
  type ItemInstance,
} from "@stella/core";

export interface PanelEntry {
  item: ItemInstance;
  equipped: boolean;
  slot?: string;
}

/** 一覧：装備中のもの（＊）と、持ち物 */
export function inventoryEntries(equipment: Equipment, bag: ItemBag): PanelEntry[] {
  return [
    ...equipment.all().map(([slot, item]): PanelEntry => ({ item, equipped: true, slot })),
    ...bag.items().map((item): PanelEntry => ({ item, equipped: false })),
  ];
}

export function entryLabel(entry: PanelEntry, data: GearData): string {
  const base = data.bases.get(entry.item.baseId);
  const mark = entry.equipped ? `＊${entry.slot ?? ""} ` : "  ";
  return `${mark}[${RARITY_NAME[entry.item.rarity]}] ${base?.name ?? "?"}`;
}

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
const STAT_LABEL_PCT = /%|速度|耐性|率|増加|短縮|ガード|崩し値|ダメージ$|回復量/;

function valueText(stat: string, v: number): string {
  return STAT_LABEL_PCT.test(stat) ? pct(v) : v.toFixed(1);
}

/** 選んだアイテムのツールチップ。持ち物のものは、装備したときの変化も出す */
export function tooltipText(
  entry: PanelEntry | undefined,
  data: GearData,
  equipment: Equipment,
  stats: Readonly<Record<string, number>>,
  jobId: string,
  canDualWield: boolean,
): string {
  if (!entry) return "";
  const prefixes = {
    title: "",
    base: "",
    implicit: "◇ ",
    affix: "・",
    hint: "　↳ ",
    warning: "！",
    latent: "？",
  } as const;
  const lines = describeItem(entry.item, data, { jobId, stats }).map(
    (l) => prefixes[l.kind] + l.text,
  );
  if (!entry.equipped) {
    const after = equipment.clone();
    const result = after.equip(entry.item, data, { canDualWield });
    if (result.ok) {
      const diff = compareTotals(
        computeGear(equipment, data, stats).totals,
        computeGear(after, data, stats).totals,
      );
      lines.push("── 装備すると ──");
      if (diff.length === 0) lines.push("（能力値の変化なし）");
      for (const d of diff) {
        lines.push(`${d.stat}: ${valueText(d.stat, d.from)} → ${valueText(d.stat, d.to)}`);
      }
    } else {
      lines.push("── 装備できない ──");
    }
  }
  return lines.join("\n");
}

/** キャラクターの画面：能力値と、修正値の内訳 */
export function characterText(
  fighter: Fighter,
  gear: GearStats,
  stats: Readonly<Record<string, number>>,
): string {
  const total = withGearStats(stats, gear);
  const r = fighter.weaponDamageRange();
  const lines = [
    `最大HP ${String(fighter.maxHp)}  最大MP ${String(fighter.init.maxMp)}`,
    `剛 ${String(total["剛"])}  迅 ${String(total["迅"])}  理 ${String(total["理"])}  魂 ${String(total["魂"])}`,
    `武器ダメージ ${r.physical.min.toFixed(1)}–${r.physical.max.toFixed(1)}${r.fire.max > 0 ? `（火 ${String(r.fire.min)}–${String(r.fire.max)}）` : ""}`,
    `攻撃速度 ${fighter.attackSpeed.toFixed(2)}回/秒  会心率 ${pct(fighter.weapon.crit)}（増加 ${pct(fighter.critIncrease)}）`,
    `防具値 ${gear.armor.toFixed(0)}  回避値 ${gear.evasion.toFixed(0)}  魔障 ${gear.barrier.toFixed(0)}`,
  ];
  if (gear.penalized.length > 0) {
    lines.push(`！要求値の未達（基礎性能-40%）: ${gear.penalized.join("・")}`);
  }
  lines.push("── 修正値の内訳（どの装備から、いくつ）──");
  for (const b of gear.breakdown) {
    lines.push(`${b.slot} ${b.source}: ${b.stat} ${valueText(b.stat, b.value)}`);
  }
  return lines.join("\n");
}
