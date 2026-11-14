import type { ContentDb } from "../content/load.ts";
import type { EffectInstance } from "../effects/evaluate.ts";

/** 職紋盤のノードの効果の出どころ（修正値の内訳に使う）。 */
export const JOB_NODE_SOURCE = "jobNode";
/** 副職紋（サブジョブの職紋盤）のノードの効果の出どころ（docs/progress D-SUB-3）。 */
export const SUB_JOB_NODE_SOURCE = "subJobNode";
/** 副職紋のポイントの上限（仕様書v0.2 4.12・5.1：最大20）。 */
export const SUB_JOB_BOARD_MAX_POINTS = 20;

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

/**
 * 副職紋のポイント（docs/progress D-SUB-2）：min(20, サブジョブのジョブLv − 1)。職紋盤と同じ規則で、上限を20にする
 * （MVP後の機能の提案 2章 ①。仕様書v0.2 4.12 の「ジョブLv×2/3」は採らない。Q-SUB-1）。
 */
export function subJobBoardPoints(jobLevel: number): number {
  return Math.min(SUB_JOB_BOARD_MAX_POINTS, jobBoardPoints(jobLevel));
}

/** 副職紋の振り直しの金貨（メインの職紋盤と同じ：20 × サブジョブのジョブLv。docs/progress D-SUB-2）。 */
export function subJobBoardRespecCost(jobLevel: number): number {
  return jobBoardRespecCost(jobLevel);
}

/**
 * 盤の使い方：main＝メインジョブの職紋盤、sub＝副職紋（サブジョブ。職奥義・接続ノードは取れない。
 * 効果の出どころは subJob。docs/progress D-SUB-2・D-SUB-3）。
 */
export type JobBoardRole = "main" | "sub";

/** 取れない理由。subOnlyMinor は副職紋で職奥義・接続ノードを取ろうとしたとき。 */
export type JobAllocateBlock =
  | "unknown"
  | "otherJob"
  | "start"
  | "taken"
  | "points"
  | "notAdjacent"
  | "masteryChosen"
  | "subOnlyMinor";

/** 副職紋で取れるノードの種類（小ノード・大ノード＝輝星。docs/progress D-SUB-2）。 */
const SUB_JOB_NODE_KINDS: ReadonlySet<string> = new Set(["minor", "notable"]);

/**
 * 1つのジョブの職紋盤の取得（仕様書v0.2 4.10）。
 * - 取れるのは、始点か取ったノードの隣で、まだ取っていないノード。ポイントが残っていること
 * - 職奥義は、3つから1つしか選べない（別の職奥義を取っていると取れない）
 * - 返せるのは、返しても、ほかの取ったノードが始点からつながったままのとき
 * - 副職紋（role が sub）：職奥義・接続ノードは取れない。効果の出どころは subJob（source は subJobNode）。
 *   メインの職紋盤とは別の取得状態（別の JobBoardAllocation）を持つ（docs/progress D-SUB-2）
 */
export class JobBoardAllocation {
  private readonly db: ContentDb;
  readonly job: string;
  readonly role: JobBoardRole;
  private order: string[];

  constructor(
    db: ContentDb,
    job: string,
    allocated: readonly string[] = [],
    role: JobBoardRole = "main",
  ) {
    this.db = db;
    this.job = job;
    this.role = role;
    const seen = new Set<string>();
    let mastery = 0;
    for (const id of allocated) {
      const n = db.jobNodes.get(id);
      if (n === undefined) throw new RangeError(`職紋盤のノード ${id} がデータに無い`);
      if (n.job !== job) throw new RangeError(`ノード ${id} はジョブ ${job} の盤ではない`);
      if (n.kind === "start") throw new RangeError(`始点 ${id} は取得しない`);
      if (seen.has(id)) throw new RangeError(`ノード ${id} が2回取得されている`);
      if (role === "sub" && !SUB_JOB_NODE_KINDS.has(n.kind))
        throw new RangeError(
          `副職紋では ${n.kind} のノード ${id} を取れない（職奥義・接続ノード）`,
        );
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
    if (this.role === "sub" && !SUB_JOB_NODE_KINDS.has(n.kind)) return "subOnlyMinor";
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

  /** 有効なノードの効果。副職紋は、同じ効果のデータを出どころ subJob として返す（docs/progress D-SUB-3）。 */
  effects(points: number): EffectInstance[] {
    const out: EffectInstance[] = [];
    for (const id of this.active(points))
      for (const effectId of this.db.jobNodes.get(id)?.effects ?? [])
        out.push(
          this.role === "sub"
            ? { effectId, source: { kind: SUB_JOB_NODE_SOURCE, ref: id }, origin: "subJob" }
            : { effectId, source: { kind: JOB_NODE_SOURCE, ref: id } },
        );
    return out;
  }

  /** 取った星辰盤への接続ノードの数（有効なもの）。副職紋は接続ノードを取れないので、いつも0。 */
  connectors(points: number): number {
    return this.active(points).filter((id) => this.db.jobNodes.get(id)?.kind === "connector")
      .length;
  }
}
