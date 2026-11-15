/**
 * ツールチップ・比較・能力値の内訳の表示用データ（補助仕様書 16章）。
 * 表示の形（行の種類）だけを決め、色や配置は表示層が決める。
 */
import { tierRange } from "./affix.ts";
import { isPercentStat, REQUIREMENT_PENALTY, type GearData } from "./gear.ts";
import type { AffixDef, ItemInstance, Rarity, RolledAffix } from "./types.ts";

export const RARITY_NAME: Readonly<Record<Rarity, string>> = {
  normal: "通常",
  magic: "魔法",
  rare: "希少",
  unique: "固有",
  set: "星座",
  astral: "星刻",
};

export interface TooltipContext {
  /** 今のジョブ（職詞の有効・無効の判定） */
  jobId?: string;
  /** 能力値（要求値の判定） */
  stats?: Readonly<Record<string, number>>;
  /** 今の技のタグ（タグの一致のヒント） */
  skillTags?: readonly string[];
}

export type LineKind = "title" | "base" | "implicit" | "affix" | "hint" | "warning" | "latent";

export interface TooltipLine {
  kind: LineKind;
  text: string;
}

function formatValue(def: AffixDef, a: RolledAffix): string {
  if (def.added === true) return `${String(a.rolls[0] ?? 0)}–${String(a.rolls[1] ?? 0)}`;
  const v = a.rolls[0] ?? 0;
  return isPercentStat(def.stat) ? `${String(v)}%` : `+${String(v)}`;
}

/** 詞1行（「物理ダメージ追加 4–8」など）と、タグの一致・職詞などのヒント */
export function describeAffix(
  def: AffixDef,
  a: RolledAffix,
  ctx: TooltipContext,
  jobName?: (id: string) => string,
): { text: string; hint?: string } {
  const tierText = `T${String(a.tier)}`;
  let text = `${def.name} ${formatValue(def, a)}（${tierText}）`;
  if (def.resonance === true && a.params?.["region"])
    text += ` ${a.params["region"].replace("TAG-REGION-", "")}`;
  let hint: string | undefined;
  if (def.job !== undefined) {
    const name = jobName?.(def.job) ?? def.job;
    hint =
      ctx.jobId === undefined || def.job === ctx.jobId
        ? `職詞：${name}で効果を発揮する`
        : `職詞：${name}のときだけ効果がある（今のジョブでは無効）`;
  } else if (def.family !== undefined) {
    hint = "系統詞：特定の系統の敵から落ちる";
  } else if (def.resonance === true) {
    hint = "共鳴紋：その星域の輝星の効果が強まる";
  }
  return hint === undefined ? { text } : { text, hint };
}

/** アイテムのツールチップ。要求値の未達は警告として出す */
export function describeItem(
  item: ItemInstance,
  data: GearData,
  ctx: TooltipContext = {},
  jobName?: (id: string) => string,
): TooltipLine[] {
  const base = data.bases.get(item.baseId);
  if (!base) return [{ kind: "title", text: "（不明なアイテム）" }];
  const lines: TooltipLine[] = [
    {
      kind: "title",
      text: `${RARITY_NAME[item.rarity]}の${base.name}${item.enhance > 0 ? ` +${String(item.enhance)}` : ""}`,
    },
    {
      kind: "base",
      text: `iLv ${String(item.ilvl)} ／ ${base.slot}${base.hands === 2 ? "（両手）" : ""}`,
    },
  ];
  if (base.weapon) {
    lines.push({
      kind: "base",
      text: `ダメージ ${String(base.weapon.min)}–${String(base.weapon.max)} ／ 速度 ${base.weapon.speed.toFixed(2)} ／ 会心率 ${String(Math.round(base.weapon.crit * 100))}%`,
    });
  }
  if (base.defense) {
    const label = { armor: "防具値", evasion: "回避値", barrier: "魔障" }[base.defense.kind];
    lines.push({ kind: "base", text: `${label} ${String(base.defense.value)}` });
  }
  if (base.implicit) lines.push({ kind: "implicit", text: base.implicit });
  for (const a of item.affixes) {
    const def = data.affixes.get(a.id);
    if (!def) continue;
    const d = describeAffix(def, a, ctx, jobName);
    lines.push({ kind: "affix", text: d.text });
    if (d.hint) lines.push({ kind: "hint", text: d.hint });
  }
  if (item.uniqueId !== undefined) lines.push({ kind: "latent", text: "潜在効果：？？？" });
  if (base.requirement) {
    const have = ctx.stats?.[base.requirement.stat] ?? Infinity;
    const text = `要求 ${base.requirement.stat} ${String(base.requirement.value)}`;
    lines.push(
      have < base.requirement.value
        ? {
            kind: "warning",
            text: `${text}（未達：基礎性能が${String(Math.round((1 - REQUIREMENT_PENALTY) * 100))}%下がる）`,
          }
        : { kind: "base", text },
    );
  }
  return lines;
}

/** 詞の値の範囲（「T7 10–19」）。ツールチップの補足に使う */
export function affixRangeText(def: AffixDef, tier: number): string {
  const r = tierRange(def, tier);
  return r.min === r.max ? String(r.min) : `${String(r.min)}–${String(r.max)}`;
}

/** 着替えの比較：現在の装備との差（武器の平均ダメージ・防御・攻撃速度など） */
export interface GearDiff {
  stat: string;
  from: number;
  to: number;
}

export function compareTotals(
  before: Readonly<Record<string, number>>,
  after: Readonly<Record<string, number>>,
): GearDiff[] {
  const stats = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: GearDiff[] = [];
  for (const stat of [...stats].sort()) {
    const from = before[stat] ?? 0;
    const to = after[stat] ?? 0;
    if (Math.abs(from - to) > 1e-9) out.push({ stat, from, to });
  }
  return out;
}
