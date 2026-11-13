import type { ContentDb } from "../content/load.ts";
import type { EffectInstance } from "../effects/evaluate.ts";

/**
 * 残響化（仕様書v0.2 3.11.5・4.8。MVP後の機能の提案 1章）。
 *
 * ユニークを壊して作る「残響」は、星辰盤の共鳴座にはめ込むと固有効果が働く。
 * - 利点の数値は50%。代償の数値（修正値の drawback の印）は100%のまま
 * - ルール部分（印・挙動・付け替えなど数値の無いもの、echoRule の印の数値）はそのまま
 * - 潜在効果は残響では働かない
 * MVP の盤には共鳴座を置かない（提案 1-2 案A）。仕組みは試験用の盤で確かめる。
 */

/** 残響の利点の数値の倍率。 */
export const ECHO_BENEFIT_RATIO = 0.5;
/** 同時に有効な残響の数（4.8）。 */
export const MAX_ACTIVE_ECHOES = 3;
/** 残響の加護：共鳴座からこのノード数以内の輝星の効果の数値の部分を +15%（4.8）。 */
export const ECHO_BLESSING_RADIUS = 6;
export const ECHO_BLESSING = 0.15;
/** 残響の効果の出どころ。 */
export const ECHO_SOURCE = "echo";

/** 残響化できない理由（できるなら undefined）。 */
export type EchoBlock = "notUnique" | "forbidden";

export function echoBlock(db: ContentDb, baseId: string): EchoBlock | undefined {
  const u = db.itemBases.get(baseId)?.unique;
  if (u === undefined) return "notUnique";
  if (u.echo === false) return "forbidden";
  return undefined;
}

/**
 * 残響の効果（共鳴座にはめ込んだときに働くもの）。固有効果ごとに、修正値の値の差し替えで
 * 利点の数値を50%にする。残響化できないベースは空。
 */
export function echoEffectInstances(db: ContentDb, baseId: string, ref: string): EffectInstance[] {
  if (echoBlock(db, baseId) !== undefined) return [];
  const u = db.itemBases.get(baseId)?.unique;
  const out: EffectInstance[] = [];
  for (const effectId of u?.effects ?? []) {
    const def = db.effects.get(effectId);
    if (def === undefined) continue;
    const values = def.modifiers.map((m) => {
      if (!("value" in m) || m.drawback === true || m.echoRule === true) return undefined;
      // 上書き（override）は数値でもルール（優先度で1つだけ効く）なので、そのまま
      if (m.kind === "override") return undefined;
      const v = m.value;
      const k = ECHO_BENEFIT_RATIO;
      if (typeof v === "object") return { min: v.min * k, max: v.max * k };
      if (m.kind === "more") return 1 + (v - 1) * k;
      return v * k;
    });
    out.push({
      effectId,
      source: { kind: ECHO_SOURCE, ref },
      ...(values.some((v) => v !== undefined) ? { values } : {}),
    });
  }
  return out;
}

/**
 * 同じユニークを装備と残響で同時に使っていないか（9章 V-01）。重なっているベースを返す。
 */
export function echoConflicts(
  equippedBases: readonly string[],
  echoes: Readonly<Record<string, string>>,
): string[] {
  const equipped = new Set(equippedBases);
  return [...new Set(Object.values(echoes))].filter((b) => equipped.has(b));
}

/**
 * ユニークの固有効果の数値のうち、残響で50%になるもの（利点）と100%のもの（代償・ルール）の一覧。
 * データを足すときに、代償の印の付け忘れを見つけるために使う（提案 1-1：「検証で一覧にできる」）。
 */
export function echoReview(db: ContentDb): {
  base: string;
  effect: string;
  index: number;
  stat: string;
  value: unknown;
  kind: "benefit" | "drawback" | "rule";
}[] {
  const out: ReturnType<typeof echoReview> = [];
  for (const b of db.itemBases.values()) {
    const u = b.unique;
    if (u === undefined || u.echo === false) continue;
    for (const effectId of u.effects) {
      db.effects.get(effectId)?.modifiers.forEach((m, index) => {
        if (!("value" in m)) return;
        out.push({
          base: b.id,
          effect: effectId,
          index,
          stat: "stat" in m ? m.stat : m.kind,
          value: m.value,
          kind:
            m.drawback === true
              ? "drawback"
              : m.echoRule === true || m.kind === "override"
                ? "rule"
                : "benefit",
        });
      });
    }
  }
  return out;
}
