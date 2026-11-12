import type { ContentDb } from "../content/load.ts";
import type { EffectInstance } from "../effects/evaluate.ts";

/** 職紋盤のノードの効果の出どころ（修正値の内訳に使う）。 */
export const JOB_NODE_SOURCE = "jobNode";

/** 職紋盤のポイント（仕様書v0.2 4.12、補助仕様書4.4）：ジョブLv2から1つずつ（ジョブLv−1）。 */
export function jobBoardPoints(jobLevel: number): number {
  if (!(Number.isSafeInteger(jobLevel) && jobLevel >= 1))
    throw new RangeError(`ジョブLvは1以上の整数（${String(jobLevel)}）`);
  return jobLevel - 1;
}

/** 職紋盤の振り直しの金貨（補助仕様書5章：20 × ジョブLv）。 */
export function jobBoardRespecCost(jobLevel: number): number {
  return 20 * (jobBoardPoints(jobLevel) + 1);
}

export type JobAllocateBlock =
  "unknown" | "otherJob" | "start" | "taken" | "points" | "notAdjacent" | "masteryChosen";

/**
 * 1つのジョブの職紋盤の取得（仕様書v0.2 4.10）。
 * - 取れるのは、始点か取ったノードの隣で、まだ取っていないノード。ポイントが残っていること
 * - 職奥義は、3つから1つしか選べない（別の職奥義を取っていると取れない）
 * - 返せるのは、返しても、ほかの取ったノードが始点からつながったままのとき
 */
export class JobBoardAllocation {
  private readonly db: ContentDb;
  readonly job: string;
  private order: string[];

  constructor(db: ContentDb, job: string, allocated: readonly string[] = []) {
    this.db = db;
    this.job = job;
    const seen = new Set<string>();
    let mastery = 0;
    for (const id of allocated) {
      const n = db.jobNodes.get(id);
      if (n === undefined) throw new RangeError(`職紋盤のノード ${id} がデータに無い`);
      if (n.job !== job) throw new RangeError(`ノード ${id} はジョブ ${job} の盤ではない`);
      if (n.kind === "start") throw new RangeError(`始点 ${id} は取得しない`);
      if (seen.has(id)) throw new RangeError(`ノード ${id} が2回取得されている`);
      if (n.kind === "mastery" && ++mastery > 1) throw new RangeError("職奥義は1つだけ");
      seen.add(id);
    }
    this.order = [...allocated];
  }

  get nodes(): readonly string[] {
    return this.order;
  }
  has(id: string): boolean {
    return this.order.includes(id);
  }
  get spent(): number {
    return this.order.length;
  }
  /** 始点（盤のデータが無いジョブは undefined）。 */
  get root(): string | undefined {
    return this.db.jobBoardStarts.get(this.job);
  }
  /** 選んだ職奥義（無ければ undefined）。 */
  get mastery(): string | undefined {
    return this.order.find((id) => this.db.jobNodes.get(id)?.kind === "mastery");
  }

  private links(id: string): ReadonlySet<string> {
    return this.db.jobLinks.get(id) ?? new Set();
  }

  /** 始点から、取ったノードだけをたどって行けるノード。 */
  private reachable(pool: ReadonlySet<string>): Set<string> {
    const out = new Set<string>();
    const root = this.root;
    if (root === undefined) return out;
    const queue = [root];
    while (queue.length > 0) {
      const cur = queue.shift() as string;
      for (const next of this.links(cur)) {
        if (out.has(next) || !pool.has(next)) continue;
        out.add(next);
        queue.push(next);
      }
    }
    return out;
  }

  /** 取れない理由（取れるなら undefined）。 */
  allocateBlock(id: string, points: number): JobAllocateBlock | undefined {
    const n = this.db.jobNodes.get(id);
    if (n === undefined) return "unknown";
    if (n.job !== this.job) return "otherJob";
    if (n.kind === "start") return "start";
    if (this.has(id)) return "taken";
    if (this.order.length >= points) return "points";
    const near = this.links(id);
    const root = this.root;
    if (!(root !== undefined && near.has(root)) && !this.order.some((x) => near.has(x)))
      return "notAdjacent";
    if (n.kind === "mastery" && this.mastery !== undefined) return "masteryChosen";
    return undefined;
  }

  allocate(id: string, points: number): boolean {
    if (this.allocateBlock(id, points) !== undefined) return false;
    this.order.push(id);
    return true;
  }

  canRefund(id: string): boolean {
    if (!this.has(id)) return false;
    const all = new Set(this.order);
    const before = this.reachable(all);
    all.delete(id);
    const after = this.reachable(all);
    before.delete(id);
    for (const x of before) if (!after.has(x)) return false;
    return true;
  }

  refund(id: string): boolean {
    if (!this.canRefund(id)) return false;
    this.order = this.order.filter((x) => x !== id);
    return true;
  }

  /** 全て返す（転職神殿の振り直し）。 */
  clear(): void {
    this.order = [];
  }

  /**
   * 有効なノード：ポイントの上限までで、始点からつながっているもの（取った順）。
   * 超えた分・つながっていない分は効かない（セーブデータを手で変えた場合などの守り）。
   */
  active(points: number): string[] {
    const within = this.order.slice(0, Math.max(0, points));
    const reached = this.reachable(new Set(within));
    return within.filter((id) => reached.has(id));
  }

  /** 有効なノードの効果。 */
  effects(points: number): EffectInstance[] {
    const out: EffectInstance[] = [];
    for (const id of this.active(points))
      for (const effectId of this.db.jobNodes.get(id)?.effects ?? [])
        out.push({ effectId, source: { kind: JOB_NODE_SOURCE, ref: id } });
    return out;
  }

  /** 取った星辰盤への接続ノードの数（有効なもの）。 */
  connectors(points: number): number {
    return this.active(points).filter((id) => this.db.jobNodes.get(id)?.kind === "connector")
      .length;
  }
}
