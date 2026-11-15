/**
 * 効果がぶつかったときの優先順位（本仕様書 2.4.1）。
 */
import type { Source } from "../data/schema.ts";
import { HOOK_PREFIX } from "./hooks.ts";
import type { HookCall } from "./evaluate.ts";

/** 規則2：天極 ＞ ユニーク ＞ セット ＞ 輝星・転変 ＞ 職紋・職技。小さいほど強い */
const SOURCE_RANK: Partial<Record<Source, number>> = {
  天極: 0,
  ユニーク: 1,
  セット: 2,
  セット最大段階: 2,
  輝星: 3,
  転変: 3,
  基本ノード: 4,
  職技: 4,
  職奥義: 4,
};

export function sourceRank(source: Source): number {
  return SOURCE_RANK[source] ?? 5;
}

/** 規則1：禁止は強制に勝つ。key は対象の名前（例：会心） */
export function resolveForceForbid(
  calls: readonly HookCall[],
  key: string,
): "forbid" | "force" | "none" {
  if (calls.some((c) => c.hook === HOOK_PREFIX.forbid + key)) return "forbid";
  if (calls.some((c) => c.hook === HOOK_PREFIX.force + key)) return "force";
  return "none";
}

export interface ReplaceResult {
  winner: HookCall | undefined;
  /** 無効になった効果（ツールチップに「無効（〇〇が優先）」と出す） */
  overridden: HookCall[];
}

/** 規則2：同じ枠を置き換える効果は、出どころの順位が最も高い1つだけが有効。同順位は効果IDの小さいほう */
export function resolveReplace(calls: readonly HookCall[], slot: string): ReplaceResult {
  const candidates = calls
    .filter((c) => c.hook === HOOK_PREFIX.replace + slot)
    .sort(
      (a, b) =>
        sourceRank(a.source) - sourceRank(b.source) ||
        (a.effectId < b.effectId ? -1 : a.effectId > b.effectId ? 1 : 0),
    );
  return { winner: candidates[0], overridden: candidates.slice(1) };
}

/** 規則3：生成を禁止する効果があるとき、同じ対象を生む効果は発動しない。返すのは発動できる生成 */
export function resolveSpawn(calls: readonly HookCall[], kind: string): HookCall[] {
  if (calls.some((c) => c.hook === HOOK_PREFIX.banSpawn + kind)) return [];
  return calls.filter((c) => c.hook === HOOK_PREFIX.spawn + kind);
}

/** 規則4：同じ数値を上書きする効果は、優先度（params.priority）の大きいものが勝つ */
export function resolveOverride(calls: readonly HookCall[], key: string): HookCall | undefined {
  const candidates = calls.filter((c) => c.hook === HOOK_PREFIX.override + key);
  let best: HookCall | undefined;
  for (const c of candidates) {
    const p = typeof c.params["priority"] === "number" ? c.params["priority"] : 0;
    const bp = best && typeof best.params["priority"] === "number" ? best.params["priority"] : 0;
    if (!best || p > bp) best = c;
  }
  return best;
}
