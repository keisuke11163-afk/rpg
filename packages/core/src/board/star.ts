/**
 * 星辰盤（本仕様書 4章）：取得・返却・接続・休眠・星座・共鳴変化。
 * 評価は 4.9.1 の3段階に従う。同じ状態なら、何度評価しても結果が同じ。
 */
import type { ConstellationDef, EffectDef, Modifier, StarNodeDef } from "../data/schema.ts";
import { ConditionRegistry, type EvalContext } from "../effects/conditions.ts";
import type { ActiveEffect } from "../effects/evaluate.ts";

export interface BoardData {
  nodes: ReadonlyMap<string, StarNodeDef>;
  effects: ReadonlyMap<string, EffectDef>;
  constellations: ReadonlyMap<string, ConstellationDef>;
}

export function makeBoardData(
  nodes: readonly StarNodeDef[],
  effects: readonly EffectDef[],
  constellations: readonly ConstellationDef[],
): BoardData {
  return {
    nodes: new Map(nodes.map((n) => [n.id, n])),
    effects: new Map(effects.map((e) => [e.id, e])),
    constellations: new Map(constellations.map((c) => [c.id, c])),
  };
}

/** 他ジョブの始点を追加の入口として開くコスト（本仕様書 5.1）と、入口の上限（出自と合わせて2つ） */
export const EXTRA_ENTRANCE_COST = 3;
export const MAX_ENTRANCES = 2;

export type AllocateDenied =
  | "unknown"
  | "start"
  | "already"
  | "notAdjacent"
  | "points"
  | "notAllocated"
  | "disconnects"
  | "entranceLimit"
  | "notStart";

export interface BoardEvaluation {
  /** 有効なノード（始点を含まない） */
  active: string[];
  /** 休眠：取得したまま、効果だけが消えている（ポイントは使ったまま） */
  dormant: { id: string; reason: string }[];
  /** 効果。星辰盤の効果と、完成した星座のボーナス */
  effects: ActiveEffect[];
  /** 完成している星座 */
  completedConstellations: string[];
  /** 有効なノードがある星域の数 */
  regionCount: number;
}

export interface BoardContext {
  /** 評価の文脈（第1段階の値：装備・能力値・旗）。条件の判定に使う */
  ctx: EvalContext;
  /** 星域タグごとの、装備中の共鳴紋の数 */
  resonance?: Readonly<Record<string, number>>;
}

/** 共鳴変化を適用した効果を返す（共鳴紋が足りなければそのまま） */
export function applyResonanceVariant(
  effect: EffectDef,
  resonance: Readonly<Record<string, number>> | undefined,
): EffectDef {
  const rv = effect.resonance_variant;
  if (!rv || (resonance?.[rv.region] ?? 0) < rv.min_resonance) return effect;
  const replaced = new Set((rv.replace ?? []).map((m) => keyOf(m)));
  const kept = effect.modifiers.filter((m) => !replaced.has(keyOf(m)));
  return { ...effect, modifiers: [...kept, ...(rv.replace ?? []), ...(rv.add ?? [])] };
}

function keyOf(m: Modifier): string {
  return m.kind === "挙動" ? `${m.kind}:${m.hook}` : `${m.kind}:${"stat" in m ? m.stat : ""}`;
}

export class StarBoard {
  readonly data: BoardData;
  /** 入口（始点のID）。最初の1つは出自の始点 */
  readonly entrances: string[];
  /** 取得したノード（始点を含まない）。取得した順 */
  readonly allocated: string[] = [];
  private readonly conditions: ConditionRegistry;

  constructor(data: BoardData, originStart: string, conditions = new ConditionRegistry()) {
    this.data = data;
    this.conditions = conditions;
    const start = data.nodes.get(originStart);
    if (!start || start.type !== "始点") throw new Error(`始点ではない: ${originStart}`);
    this.entrances = [originStart];
  }

  /** 使ったポイント（ノード1つにつき1、追加の入口は3） */
  get pointsUsed(): number {
    return this.allocated.length + (this.entrances.length - 1) * EXTRA_ENTRANCE_COST;
  }

  has(id: string): boolean {
    return this.allocated.includes(id);
  }

  /** 取得できるか。始点か取得済みのノードに隣り合っていて、ポイントが足りること */
  canAllocate(id: string, pointsTotal: number): { ok: boolean; reason?: AllocateDenied } {
    const node = this.data.nodes.get(id);
    if (!node) return { ok: false, reason: "unknown" };
    if (node.type === "始点") return { ok: false, reason: "start" };
    if (this.has(id)) return { ok: false, reason: "already" };
    const adjacent = node.links.some((l) => this.entrances.includes(l) || this.has(l));
    if (!adjacent) return { ok: false, reason: "notAdjacent" };
    if (this.pointsUsed + 1 > pointsTotal) return { ok: false, reason: "points" };
    return { ok: true };
  }

  allocate(id: string, pointsTotal: number): { ok: boolean; reason?: AllocateDenied } {
    const check = this.canAllocate(id, pointsTotal);
    if (check.ok) this.allocated.push(id);
    return check;
  }

  /** 返却できるか。返却した後も、残りのノードが全て入口につながっていること */
  canRefund(id: string): { ok: boolean; reason?: AllocateDenied } {
    if (!this.has(id)) return { ok: false, reason: "notAllocated" };
    const rest = this.allocated.filter((x) => x !== id);
    const reachable = this.structuralReach(rest);
    return rest.every((x) => reachable.has(x))
      ? { ok: true }
      : { ok: false, reason: "disconnects" };
  }

  refund(id: string): { ok: boolean; reason?: AllocateDenied } {
    const check = this.canRefund(id);
    if (check.ok) this.allocated.splice(this.allocated.indexOf(id), 1);
    return check;
  }

  /** 他ジョブの始点を追加の入口として開く（3ポイント。出自と合わせて最大2つ） */
  openEntrance(startId: string, pointsTotal: number): { ok: boolean; reason?: AllocateDenied } {
    const node = this.data.nodes.get(startId);
    if (!node || node.type !== "始点" || node.start?.job == null)
      return { ok: false, reason: "notStart" };
    if (this.entrances.includes(startId)) return { ok: false, reason: "already" };
    if (this.entrances.length >= MAX_ENTRANCES) return { ok: false, reason: "entranceLimit" };
    if (this.pointsUsed + EXTRA_ENTRANCE_COST > pointsTotal) return { ok: false, reason: "points" };
    this.entrances.push(startId);
    return { ok: true };
  }

  /** 全体の振り直し。入口は出自の1つに戻る */
  reset(): void {
    this.allocated.length = 0;
    this.entrances.length = 1;
  }

  /** 構造上の到達：休眠を考えず、入口から取得済みのノードだけをたどってつながるもの */
  private structuralReach(set: readonly string[]): Set<string> {
    const inSet = new Set(set);
    const seen = new Set<string>();
    const queue = [...this.entrances];
    const visited = new Set(queue);
    while (queue.length > 0) {
      const id = queue.pop() as string;
      for (const l of this.data.nodes.get(id)?.links ?? []) {
        if (inSet.has(l) && !visited.has(l)) {
          visited.add(l);
          seen.add(l);
          queue.push(l);
        }
      }
    }
    return seen;
  }

  /**
   * 評価（4.9.1）。第1段階：条件のないものを集める／第2段階：星門などの条件を、第1段階の値だけで判定する／
   * 第3段階：条件を満たしたノードの効果を加える。
   * 休眠：①条件（星門）を満たさない ②入口から有効なノードだけでつながっていない ③ポイントの上限を超えている。
   */
  evaluate(pointsTotal: number, bc: BoardContext): BoardEvaluation {
    const dormant: { id: string; reason: string }[] = [];
    const nodeOf = (id: string): StarNodeDef => this.data.nodes.get(id) as StarNodeDef;

    // ③ ポイントの上限：最後に取ったノードから順に休眠する
    const budget = pointsTotal - (this.entrances.length - 1) * EXTRA_ENTRANCE_COST;
    const withinCap = new Set(this.allocated.slice(0, Math.max(0, budget)));
    for (const id of this.allocated.slice(Math.max(0, budget))) {
      dormant.push({ id, reason: "ポイントの上限を超えている" });
    }

    // ① 星門の条件（第2段階：判定は第1段階の値だけ）
    const gateFails = new Set<string>();
    for (const id of withinCap) {
      const g = nodeOf(id).gate;
      if (g && !this.conditions.all([g.condition], bc.ctx)) {
        gateFails.add(id);
        dormant.push({ id, reason: `${nodeOf(id).name}：${g.label}を満たしていない` });
      }
    }

    // ② 入口から、有効なノードだけをたどってつながっているか
    const active = new Set<string>();
    const queue = [...this.entrances];
    const visited = new Set(queue);
    while (queue.length > 0) {
      const id = queue.pop() as string;
      for (const l of nodeOf(id).links) {
        if (visited.has(l) || !withinCap.has(l) || gateFails.has(l)) continue;
        visited.add(l);
        active.add(l);
        queue.push(l);
      }
    }
    for (const id of withinCap) {
      if (!active.has(id) && !gateFails.has(id)) {
        dormant.push({
          id,
          reason: "入口から有効なノードだけでつながっていない（休眠した星門の先など）",
        });
      }
    }

    // 第3段階：効果を加える
    const effects: ActiveEffect[] = [];
    const ordered = this.allocated.filter((id) => active.has(id));
    for (const id of ordered) {
      for (const eid of nodeOf(id).effects) {
        const e = this.data.effects.get(eid);
        if (e)
          effects.push({ effect: applyResonanceVariant(e, bc.resonance), origin: `ノード:${id}` });
      }
    }
    // 星座：全て有効なら、完成ボーナス
    const completed: string[] = [];
    for (const c of this.data.constellations.values()) {
      if (c.nodes.every((n) => active.has(n))) {
        completed.push(c.id);
        const e = this.data.effects.get(c.completionEffect);
        if (e)
          effects.push({ effect: applyResonanceVariant(e, bc.resonance), origin: `星座:${c.id}` });
      }
    }
    const regions = new Set(ordered.map((id) => nodeOf(id).region));
    return {
      active: ordered,
      dormant,
      effects,
      completedConstellations: completed,
      regionCount: regions.size,
    };
  }
}
