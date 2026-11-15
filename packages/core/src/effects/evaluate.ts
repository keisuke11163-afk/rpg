/**
 * 修正値の集計と、段階に分けた評価（本仕様書 2.4・4.9.1）。
 *
 * - 第1段階：条件のない効果だけを集める
 * - 第2段階：条件を判定する。判定に使うのは、呼び出し側が渡す文脈（第1段階の値）だけ
 * - 第3段階：条件を満たした効果を加える
 * 同じ入力なら何度評価しても結果が同じ（出どころの順に並べて足すので、入力の並び順にも依らない）。
 */
import type { EffectDef, Modifier, Source } from "../data/schema.ts";
import { ConditionRegistry, type EvalContext } from "./conditions.ts";
import { HOOK_PREFIX } from "./hooks.ts";
import { matchesFilter } from "./tags.ts";

/** 有効にしようとしている効果1つと、その出どころ */
export interface ActiveEffect {
  effect: EffectDef;
  /** 出どころの表示用の名前（例：装備:武器、ノード:N-0142）。内訳に出る */
  origin: string;
  /** 重ね掛けの数（既定1）。effect.stack_cap で切り詰める */
  stacks?: number;
  /** 上書きの優先度などに使う補助の値 */
  priority?: number;
}

/** 値を問い合わせるときの対象 */
export interface StatQuery {
  stat: string;
  /** 対象の技・敵のタグ（親タグ展開済み）。効果の target_skill_tags と照合する */
  tags?: ReadonlySet<string>;
  ailment?: string;
  element?: string;
  /** true なら、絞り込み（filter）を持つ修正値だけを数える（属性ごとの補正を、汎用の補正と分けて取り出す用途） */
  onlyFiltered?: boolean;
}

export interface BreakdownEntry {
  origin: string;
  effectId: string;
  source: Source;
  kind: Modifier["kind"];
  /** 実際に効いた値（重ね掛け・per・cap を反映した後） */
  value: number;
  note?: string;
}

export interface StatResult {
  base: number;
  flat: number;
  addPct: number;
  mult: number;
  /** 上限に達して切り詰められたか */
  capped: boolean;
  value: number;
  breakdown: BreakdownEntry[];
}

/** 評価の結果。何度でも問い合わせできる */
export interface Evaluation {
  /** 有効になった効果（第1段階＋第3段階） */
  active: readonly ActiveEffect[];
  /** 条件を満たさずに休眠した効果 */
  dormant: readonly ActiveEffect[];
  stat(query: StatQuery, base?: number, baseCap?: number): StatResult;
  /** 有効な挙動（ルールフック）の呼び出し */
  /** 有効な挙動。tags を渡すと、対象の技のタグに合わない効果（target_skill_tags）を除く */
  hooks(tags?: ReadonlySet<string>): HookCall[];
}

export interface HookCall {
  hook: string;
  params: Readonly<Record<string, unknown>>;
  origin: string;
  effectId: string;
  source: Source;
  priority: number;
}

function hasAnyCondition(entry: ActiveEffect): boolean {
  const { effect } = entry;
  if (effect.conditions.length > 0) return true;
  return effect.modifiers.some((m) => "conditions" in m && (m.conditions?.length ?? 0) > 0);
}

function sortKey(e: ActiveEffect): string {
  return `${e.origin}\u0000${e.effect.id}`;
}

function modifierApplies(effect: EffectDef, m: Modifier, q: StatQuery): boolean {
  if (m.kind === "挙動" || m.stat !== q.stat) return false;
  if (effect.target_skill_tags && !matchesFilter(effect.target_skill_tags, q.tags ?? new Set()))
    return false;
  if (m.kind === "変換" || m.kind === "付け替え") return false;
  const f = m.filter;
  if (!f) return q.onlyFiltered !== true;
  if (f.ailment !== undefined && f.ailment !== q.ailment) return false;
  if (f.element !== undefined && f.element !== q.element) return false;
  if (f.tags && !matchesFilter(f.tags, q.tags ?? new Set())) return false;
  return true;
}

function perFactor(m: Modifier, ctx: EvalContext): number {
  if (m.kind === "挙動" || m.kind === "変換" || m.kind === "付け替え" || !m.per) return 1;
  const key = m.per.value !== undefined ? `${m.per.count}:${m.per.value}` : m.per.count;
  return ctx.counts[key] ?? 0;
}

export function evaluate(
  entries: readonly ActiveEffect[],
  ctx: EvalContext,
  conditions: ConditionRegistry = new ConditionRegistry(),
): Evaluation {
  const ordered = [...entries].sort((a, b) =>
    sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0,
  );

  // 第1段階：条件のない効果。第2段階：条件の判定。第3段階：満たしたものを加える
  const phase1 = ordered.filter((e) => !hasAnyCondition(e));
  const conditional = ordered.filter(hasAnyCondition);
  const satisfied: ActiveEffect[] = [];
  const dormant: ActiveEffect[] = [];
  for (const e of conditional) {
    (conditions.all(e.effect.conditions, ctx) ? satisfied : dormant).push(e);
  }
  const active = [...phase1, ...satisfied];

  const stat = (q: StatQuery, base = 0, baseCap?: number): StatResult => {
    let flat = 0;
    let addPct = 0;
    let mult = 1;
    let capAdd = 0;
    const breakdown: BreakdownEntry[] = [];
    for (const entry of active) {
      const { effect } = entry;
      const stacks = Math.min(entry.stacks ?? 1, effect.stack_cap ?? Infinity);
      for (const m of effect.modifiers) {
        if (
          !modifierApplies(effect, m, q) ||
          m.kind === "挙動" ||
          m.kind === "変換" ||
          m.kind === "付け替え"
        )
          continue;
        if (m.conditions && !conditions.all(m.conditions, ctx)) continue;
        const per = perFactor(m, ctx);
        let value: number;
        if (m.kind === "乗算") {
          value = m.value ** (stacks * (m.per ? per : 1));
        } else {
          value = m.value * stacks * (m.per ? per : 1);
        }
        if (m.cap !== undefined && m.kind !== "乗算") {
          value = Math.sign(value) * Math.min(Math.abs(value), Math.abs(m.cap));
        }
        if (m.kind === "固定の追加") flat += value;
        else if (m.kind === "加算％") addPct += value;
        else if (m.kind === "乗算") mult *= value;
        else capAdd += value;
        breakdown.push({
          origin: entry.origin,
          effectId: effect.id,
          source: effect.source,
          kind: m.kind,
          value,
        });
      }
    }
    let value = (base + flat) * (1 + addPct) * mult;
    let capped = false;
    if (baseCap !== undefined) {
      const cap = baseCap + capAdd;
      if (value > cap) {
        value = cap;
        capped = true;
      }
    }
    return { base, flat, addPct, mult, capped, value, breakdown };
  };

  const hooks = (tags?: ReadonlySet<string>): HookCall[] => {
    const calls: HookCall[] = [];
    for (const entry of active) {
      if (
        tags &&
        entry.effect.target_skill_tags &&
        !matchesFilter(entry.effect.target_skill_tags, tags)
      )
        continue;
      for (const m of entry.effect.modifiers) {
        if (m.kind !== "挙動") continue;
        if (m.conditions && !conditions.all(m.conditions, ctx)) continue;
        calls.push({
          hook: m.hook,
          params: m.params ?? {},
          origin: entry.origin,
          effectId: entry.effect.id,
          source: entry.effect.source,
          priority: entry.priority ?? 0,
        });
      }
    }
    return calls;
  };

  return { active, dormant, stat, hooks };
}

/** 修正値の内訳を、デバッグ用の文章にする（「どの出どころから、いくつ」） */
export function explain(result: StatResult): string {
  const lines = result.breakdown.map(
    (b) => `  ${b.origin}（${b.effectId}）${b.kind} ${String(b.value)}`,
  );
  return [
    `基礎 ${String(result.base)} / 固定 ${String(result.flat)} / 加算％ ${String(result.addPct)} / 乗算 ${String(result.mult)} → ${String(result.value)}${result.capped ? "（上限）" : ""}`,
    ...lines,
  ].join("\n");
}

export { HOOK_PREFIX };
