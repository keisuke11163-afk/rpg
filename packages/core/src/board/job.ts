/**
 * 職紋盤（本仕様書 4.10）。ジョブごとに別の盤で、配置はジョブごとに残る。
 * 星辰盤と同じグラフの仕組み（StarBoard）に、職奥義（3つから1つ）・星辰盤への接続・振り直しを足す。
 */
import type { EffectDef, Modifier, StarNodeDef } from "../data/schema.ts";
import type { ActiveEffect } from "../effects/evaluate.ts";
import type { JobGauge } from "../jobs/gauge.ts";
import {
  StarBoard,
  type AllocateDenied,
  type BoardContext,
  type BoardData,
  type BoardEvaluation,
} from "./star.ts";

export type JobBoardDenied = AllocateDenied | "masteryTaken";

/** 職紋盤の振り直しの金額：20 × ジョブLv（補助仕様書 5章） */
export function jobRespecCost(jobLevel: number): number {
  return 20 * jobLevel;
}

export class JobBoard {
  readonly jobId: string;
  readonly board: StarBoard;
  private readonly data: BoardData;

  constructor(data: BoardData, startId: string, jobId: string) {
    this.jobId = jobId;
    this.data = data;
    this.board = new StarBoard(data, startId);
  }

  /** ポイントは、ジョブLv 2〜20で1つずつ（ジョブごと）。使った分は盤が数える */
  get allocated(): readonly string[] {
    return this.board.allocated;
  }

  get pointsUsed(): number {
    return this.board.pointsUsed;
  }

  private masteryNodes(): StarNodeDef[] {
    return [...this.data.nodes.values()].filter((n) => n.type === "職奥義");
  }

  /** 選んでいる職奥義（なければ undefined） */
  get mastery(): string | undefined {
    return this.board.allocated.find((id) => this.data.nodes.get(id)?.type === "職奥義");
  }

  canAllocate(id: string, points: number): { ok: boolean; reason?: JobBoardDenied } {
    const node = this.data.nodes.get(id);
    if (node?.type === "職奥義" && this.mastery !== undefined && this.mastery !== id) {
      return { ok: false, reason: "masteryTaken" };
    }
    return this.board.canAllocate(id, points);
  }

  allocate(id: string, points: number): { ok: boolean; reason?: JobBoardDenied } {
    const check = this.canAllocate(id, points);
    if (!check.ok) return check;
    return this.board.allocate(id, points);
  }

  refund(id: string): { ok: boolean; reason?: JobBoardDenied } {
    return this.board.refund(id);
  }

  /** 職紋盤の全体の振り直し（金貨が必要）。払えなければ何も変えない */
  respec(jobLevel: number, gold: { spendGold(n: number): boolean }): boolean {
    if (this.board.allocated.length === 0) return true;
    if (!gold.spendGold(jobRespecCost(jobLevel))) return false;
    this.board.reset();
    return true;
  }

  evaluate(points: number, bc: BoardContext): BoardEvaluation {
    return this.board.evaluate(points, bc);
  }

  /** 職奥義の選び直し（3つから1つ）：選んだ職奥義を外す */
  clearMastery(): void {
    const m = this.mastery;
    if (m) this.board.refund(m);
  }

  /** 接続ノードが有効か（星辰盤の始点周辺の小星が×2になる） */
  connectionActive(evaluation: BoardEvaluation): boolean {
    return evaluation.active.some((id) => this.data.nodes.get(id)?.type === "接続");
  }

  /** セーブ用：取得したノード（取った順）。職奥義は masteryChoice にも保存する */
  snapshot(): { allocation: string[]; mastery: string | null } {
    return { allocation: [...this.board.allocated], mastery: this.mastery ?? null };
  }

  /** セーブの復元：取った順に取得し直す（ポイントの検査は呼び出し側が評価で行う） */
  restore(allocation: readonly string[]): void {
    this.board.reset();
    for (const id of allocation) this.board.allocate(id, Number.MAX_SAFE_INTEGER);
  }

  masteryOptions(): StarNodeDef[] {
    return this.masteryNodes();
  }
}

/** 効果の数値を k 倍にする（加算％・固定の追加だけ。乗算・上限・挙動は変えない） */
export function scaleEffect(effect: EffectDef, k: number): EffectDef {
  const scale = (m: Modifier): Modifier =>
    m.kind === "加算％" || m.kind === "固定の追加" ? { ...m, value: m.value * k } : m;
  return { ...effect, modifiers: effect.modifiers.map(scale) };
}

/**
 * 星辰盤の始点の周り（半径 radius ノード）にある小星の効果を k 倍にする（職紋盤の接続ノード）。
 * 距離はグラフの歩数。接続は重ならない（何個取っても×2）。
 */
export function doubleNearStart(
  data: BoardData,
  evaluation: BoardEvaluation,
  startId: string,
  radius: number,
  k: number,
): ActiveEffect[] {
  const near = new Set<string>();
  let frontier = [startId];
  const seen = new Set(frontier);
  for (let d = 0; d < radius; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const l of data.nodes.get(id)?.links ?? []) {
        if (!seen.has(l)) {
          seen.add(l);
          near.add(l);
          next.push(l);
        }
      }
    }
    frontier = next;
  }
  return evaluation.effects.map((e) => {
    const nodeId = e.origin.startsWith("ノード:") ? e.origin.slice(4) : undefined;
    const node = nodeId ? data.nodes.get(nodeId) : undefined;
    if (node && node.type === "小星" && near.has(node.id)) {
      return { ...e, effect: scaleEffect(e.effect, k) };
    }
    return e;
  });
}

/** 職能ゲージに作用する職紋盤・職奥義の効果を、ゲージに反映する */
export function applyGaugeHooks(
  gauge: JobGauge,
  hooks: readonly { hook: string; params: Readonly<Record<string, unknown>> }[],
): void {
  gauge.mods = {};
  gauge.forceIntensified = false;
  gauge.releaseDisabled = false;
  const num = (v: unknown, d: number): number => (typeof v === "number" ? v : d);
  for (const h of hooks) {
    switch (h.hook) {
      case "闘志の自然減少":
        gauge.mods.decayMultiplier = num(h.params["multiplier"], 1);
        break;
      case "闘志:被弾獲得倍率":
        gauge.mods.damagedGainMultiplier = num(h.params["multiplier"], 1);
        break;
      case "闘志の下限":
        gauge.mods.floor = num(h.params["floor"], 0);
        gauge.mods.keepAfterRelease = num(h.params["keepAfterRelease"], 0);
        break;
      case "鬼神化":
        gauge.forceIntensified = true;
        gauge.releaseDisabled = h.params["releaseDisabled"] === true;
        break;
      case "コンボ点の最大値":
        gauge.mods.maxAdd = num(h.params["add"], 0);
        break;
    }
  }
}
