import type {
  ArmorType,
  ContentDb,
  EquipComparison,
  ItemInstance,
  ItemRarity,
  ItemTooltip,
  MvpEquipSlot,
  SheetBreakdownLine,
  SheetRow,
  StatResult,
} from "@stella/core";
import { text, type TextKey } from "@stella/content";

/** レアリティの色（仕様書v0.2 3.5：通常は白・魔法は青・希少は黄・固有は橙・星座は緑）。 */
export const RARITY_COLOR: Readonly<Record<ItemRarity, string>> = {
  normal: "#e8e6f0",
  magic: "#6fa8ff",
  rare: "#ffd166",
  unique: "#ff9f43",
  set: "#7bd389",
};
/** 文章の色。 */
export const TEXT_COLOR = {
  normal: "#e8e6f0",
  dim: "#9a96a8",
  /** タグが一致する行（仕様書v0.2 11章「タグが一致すると光る」）。 */
  highlight: "#ffe08a",
  bad: "#ff6b6b",
  good: "#7bd389",
  local: "#c3a6ff",
} as const;

/** 表示の1行。 */
export interface TextLine {
  readonly text: string;
  readonly color: string;
}

/** 装備の部位の名前。 */
export const SLOT_NAME: Readonly<Record<MvpEquipSlot, string>> = {
  mainHand: "主手",
  offHand: "副手",
  head: "頭",
  body: "胴",
  hands: "手",
  feet: "足",
  belt: "腰",
  neck: "首",
  ring1: "指輪1",
  ring2: "指輪2",
};

const ATTRIBUTE_NAME: Readonly<Record<string, string>> = {
  go: "剛",
  jin: "迅",
  ri: "理",
  kon: "魂",
};

const t = (key: string): string => text(key as TextKey);

/** 装備の名前（ベースの名前＋強化値。詞による名前は、まだ作らない）。 */
export function itemName(db: ContentDb, item: ItemInstance | undefined): string {
  if (item === undefined) return "素手";
  const base = db.itemBases.get(item.base);
  const name = base === undefined ? item.base : t(base.text);
  return (item.enhance ?? 0) > 0 ? `${name} +${String(item.enhance)}` : name;
}

/** タグの名前（無ければID）。 */
export function tagName(db: ContentDb, tagId: string): string {
  const tag = db.tags.get(tagId);
  return tag === undefined ? tagId : t(tag.text);
}

/** 能力値の名前。タグの文脈があれば、前に付ける（例：物理 ダメージ）。 */
export function statName(db: ContentDb, statId: string, tags: readonly string[] = []): string {
  const def = db.stats.get(statId);
  const name = def === undefined ? statId : t(def.text);
  return tags.length === 0 ? name : `${tags.map((x) => tagName(db, x)).join("・")} ${name}`;
}

const isRatio = (db: ContentDb, statId: string): boolean => db.stats.get(statId)?.unit === "ratio";
const pct = (v: number): string => `${(v * 100).toFixed(Math.abs(v * 100) < 10 ? 1 : 0)}%`;
const signed = (s: string, v: number): string => (v >= 0 ? `+${s}` : s);
const num = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** 値1つ（単位に合わせる。率は%、それ以外は数）。 */
export function formatAmount(db: ContentDb, statId: string, value: number): string {
  return isRatio(db, statId) ? pct(value) : num(value);
}

/** 能力値の集計の値（キャラクターの画面の1行の値）。 */
export function formatStatResult(db: ContentDb, r: StatResult): string {
  const parts: string[] = [];
  const ratio = isRatio(db, r.stat);
  const hasBase =
    r.base !== 0 || r.added.min !== 0 || r.added.max !== 0 || r.override !== undefined;
  if (!ratio || hasBase) parts.push(formatAmount(db, r.stat, r.value));
  if (r.increased !== 0) parts.push(`増加 ${signed(pct(r.increased), r.increased)}`);
  if (r.more !== 1) parts.push(`×${r.more.toFixed(2)}`);
  if (parts.length === 0) parts.push(formatAmount(db, r.stat, r.value));
  return parts.join("・");
}

/** 修正値の値1つ（範囲なら最小–最大）。 */
function formatValue(
  db: ContentDb,
  statId: string,
  kind: string,
  value: number | { readonly min: number; readonly max: number },
): string {
  if (typeof value === "object") {
    const a = formatAmount(db, statId, value.min);
    const b = formatAmount(db, statId, value.max);
    return value.min === value.max ? `+${a}` : `+${a}–${b}`;
  }
  if (kind === "increased") return `${signed(pct(value), value)}（増加）`;
  if (kind === "more") return `×${(1 + value).toFixed(2)}`;
  return signed(formatAmount(db, statId, value), value);
}

/** 効果の説明（修正値ごとに1つ。values があれば値を差し替える）。 */
export function effectText(
  db: ContentDb,
  effectId: string,
  values?: readonly (number | { min: number; max: number } | undefined)[],
): string {
  const effect = db.effects.get(effectId);
  if (effect === undefined) return effectId;
  return effect.modifiers
    .map((m, i) => {
      if (!("stat" in m)) return effectId;
      const filterTags = "filter" in m && m.filter?.allOf !== undefined ? m.filter.allOf : [];
      const v = values?.[i] ?? ("value" in m ? m.value : 0);
      return `${statName(db, m.stat, filterTags)} ${formatValue(db, m.stat, m.kind, v)}`;
    })
    .join("、");
}

/** 詞の値（表示の単位の抽選の値を、効果の値に直す）。 */
function affixValues(
  roll: string,
  scale: number,
  rolls: readonly number[],
): (number | { min: number; max: number })[] {
  return [
    roll === "added"
      ? { min: (rolls[0] ?? 0) * scale, max: (rolls[1] ?? 0) * scale }
      : (rolls[0] ?? 0) * scale,
  ];
}

/** ツールチップの行（補助仕様書16章）。 */
/** 防具種の名前（仕様書v0.2 3.3）。 */
const ARMOR_TYPE_NAME: Readonly<Record<ArmorType, string>> = {
  heavy: "重装",
  light: "軽装",
  robe: "法衣",
};

export function tooltipLines(db: ContentDb, tip: ItemTooltip): TextLine[] {
  const lines: TextLine[] = [
    { text: itemName(db, tip.item), color: RARITY_COLOR[tip.rarity] },
    {
      text: [
        t(`item.rarity.${tip.rarity}`),
        `アイテムLv${String(tip.itemLevel)}`,
        ...tip.base.tags.map((x) => tagName(db, x)),
        ...(tip.defense?.type === undefined ? [] : [ARMOR_TYPE_NAME[tip.defense.type]]),
      ].join("・"),
      color: TEXT_COLOR.dim,
    },
  ];
  if (tip.weapon !== undefined) {
    const w = tip.weapon;
    const unmet = tip.requirement?.met === false;
    lines.push({
      text: `${w.hands === 2 ? "両手" : "片手"}・物理 ${num(w.physical.min)}–${num(w.physical.max)}${unmet ? "（要求値の未達で-40%）" : ""}`,
      color: unmet ? TEXT_COLOR.bad : TEXT_COLOR.normal,
    });
    lines.push({
      text: `会心率 ${pct(w.critChance)}・攻撃速度 ${w.attackSpeed.toFixed(2)}回/秒`,
      color: TEXT_COLOR.normal,
    });
  }
  if (tip.defense !== undefined) {
    const d = tip.defense;
    const unmet = tip.requirement?.met === false;
    const parts = [
      ...(d.armor > 0 ? [`防具値 ${num(d.armor)}`] : []),
      ...(d.evasion > 0 ? [`回避値 ${num(d.evasion)}`] : []),
      ...(d.ward > 0 ? [`魔障 ${num(d.ward)}`] : []),
      ...(d.guard === undefined ? [] : [`ガード率 ${pct(d.guard)}`]),
    ];
    lines.push({
      text: `${parts.join("・")}${unmet ? "（要求値の未達で-40%）" : ""}`,
      color: unmet ? TEXT_COLOR.bad : TEXT_COLOR.normal,
    });
  }
  if (tip.requirement !== undefined)
    lines.push({
      text: `要求：${ATTRIBUTE_NAME[tip.requirement.attribute] ?? tip.requirement.attribute} ${String(tip.requirement.value)}${tip.requirement.met ? "" : "（未達）"}`,
      color: tip.requirement.met ? TEXT_COLOR.dim : TEXT_COLOR.bad,
    });
  if (!tip.levelMet)
    lines.push({ text: `必要Lv ${String(tip.base.requiredLevel)}`, color: TEXT_COLOR.bad });
  const load = tip.item.forgeLoad ?? 0;
  if (load > 0)
    lines.push({
      text: `鍛造負荷 ${String(load)}／100${load >= 60 ? "（亀裂・霊感が起きる）" : ""}`,
      color: load >= 60 ? TEXT_COLOR.bad : TEXT_COLOR.dim,
    });
  if (tip.unique !== undefined) {
    lines.push({ text: t(tip.unique.description), color: TEXT_COLOR.highlight });
    lines.push({
      text: `潜在効果：${tip.unique.revealed ? t(tip.unique.latentText) : "？？？"}`,
      color: tip.unique.revealed ? TEXT_COLOR.normal : TEXT_COLOR.dim,
    });
  }
  for (const e of tip.effects) {
    // ユニークの固有効果は、説明の文章で示す（効果の行を重ねない）
    if (tip.unique !== undefined && tip.base.unique?.effects.includes(e.effectId) === true)
      continue;
    const values =
      e.affix !== undefined && e.rolled !== undefined
        ? affixValues(e.affix.roll, e.affix.scale, e.rolled.rolls)
        : undefined;
    const sealed = e.affix !== undefined && e.affix.id === tip.item.sealed;
    const label = `${e.kind === "implicit" ? "基本刻印：" : ""}${effectText(db, e.effectId, values)}${e.rolled === undefined ? "" : `（T${String(e.rolled.tier)}）`}${e.local ? "［この武器］" : ""}${sealed ? "［封詞］" : ""}`;
    lines.push({
      text: `${e.matchesSkills ? "★ " : ""}${label}`,
      color: e.matchesSkills
        ? TEXT_COLOR.highlight
        : e.local
          ? TEXT_COLOR.local
          : TEXT_COLOR.normal,
    });
  }
  for (const c of tip.item.cracks ?? [])
    lines.push({ text: `亀裂：${effectText(db, c)}`, color: TEXT_COLOR.bad });
  if (tip.item.inscription !== undefined)
    lines.push({
      text: `銘：${effectText(db, tip.item.inscription)}`,
      color: TEXT_COLOR.highlight,
    });
  return lines;
}

/** 装備の比較の行（増えるものは緑・減るものは赤）。 */
export function comparisonLines(db: ContentDb, cmp: EquipComparison): TextLine[] {
  const lines: TextLine[] = [];
  const color = (better: boolean): string => (better ? TEXT_COLOR.good : TEXT_COLOR.bad);
  if (cmp.displaced.length > 0)
    lines.push({
      text: `外れる：${cmp.displaced.map((i) => itemName(db, i)).join("・")}`,
      color: TEXT_COLOR.dim,
    });
  if (cmp.damage !== undefined) {
    const a = cmp.damage.before.perSecond;
    const b = cmp.damage.after.perSecond;
    if (Math.abs(a - b) > 1e-9)
      lines.push({
        text: `通常攻撃の毎秒ダメージ ${a.toFixed(1)} → ${b.toFixed(1)}`,
        color: color(b > a),
      });
  }
  const s = cmp.attackSpeed;
  if (Math.abs(s.before - s.after) > 1e-9)
    lines.push({
      text: `攻撃速度 ${s.before.toFixed(2)} → ${s.after.toFixed(2)}回/秒`,
      color: color(s.after > s.before),
    });
  for (const c of cmp.changes) {
    // 受けるダメージ・受ける崩し値は、減るほうが良い
    const lowerIsBetter = c.stat === "STAT-DAMAGE-TAKEN" || c.stat === "STAT-STAGGER-TAKEN";
    const delta = c.after.value - c.before.value + (c.after.increased - c.before.increased);
    lines.push({
      text: `${statName(db, c.stat, c.tags)} ${formatStatResult(db, c.before)} → ${formatStatResult(db, c.after)}`,
      color: color(lowerIsBetter ? delta < 0 : delta > 0),
    });
  }
  if (lines.length === 0) lines.push({ text: "能力値の変化なし", color: TEXT_COLOR.dim });
  return lines;
}

/** 修正値の出どころの名前（装備は装備の名前、能力値は能力値の名前）。 */
export function sourceName(
  db: ContentDb,
  line: SheetBreakdownLine,
  findItem: (uid: string) => ItemInstance | undefined,
): string {
  switch (line.sourceKind) {
    case "equipment":
      return itemName(db, findItem(line.sourceRef));
    case "attribute":
      return `能力値「${ATTRIBUTE_NAME[line.sourceRef] ?? line.sourceRef}」`;
    case "skill":
    case "buff": {
      const skill = db.skills.get(line.sourceRef);
      return skill === undefined ? line.sourceRef : t(skill.text);
    }
    default:
      return line.sourceRef;
  }
}

/** キャラクターの画面の1行。 */
export function sheetRowText(db: ContentDb, row: SheetRow): string {
  return `${statName(db, row.stat, row.tags)}  ${formatStatResult(db, row.result)}`;
}

/** 修正値の内訳の行（どの出どころから、いくつ。補助仕様書16章）。 */
export function breakdownLines(
  db: ContentDb,
  row: SheetRow,
  findItem: (uid: string) => ItemInstance | undefined,
): TextLine[] {
  const lines: TextLine[] = [];
  if (row.result.base !== 0)
    lines.push({
      text: `基礎 ${formatAmount(db, row.stat, row.result.base)}`,
      color: TEXT_COLOR.dim,
    });
  for (const b of row.breakdown)
    lines.push({
      text: `${sourceName(db, b, findItem)}：${formatValue(db, row.stat, b.kind, b.value)}${b.local ? "［その武器のヒットだけ］" : ""}`,
      color: b.local ? TEXT_COLOR.local : TEXT_COLOR.normal,
    });
  if (lines.length === 0) lines.push({ text: "修正値なし", color: TEXT_COLOR.dim });
  return lines;
}
