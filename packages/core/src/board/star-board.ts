import type { StarNodeDef, StarRegion } from "../content/board.ts";
import {
  ECHO_BLESSING,
  ECHO_BLESSING_RADIUS,
  MAX_ACTIVE_ECHOES,
  echoBlock,
  echoEffectInstances,
} from "../items/echo.ts";
import type { Condition } from "../content/effect.ts";
import type { ContentDb } from "../content/load.ts";
import {
  type EffectInstance,
  type EvaluationFacts,
  conditionMet,
  stageOneView,
} from "../effects/evaluate.ts";
import type { TagIndex } from "../effects/tag-index.ts";

/** 星辰盤のノードの効果の出どころ（修正値の内訳・休眠の表示に使う）。 */
export const STAR_NODE_SOURCE = "starNode";
export const CONSTELLATION_SOURCE = "constellation";

/**
 * 星辰盤のポイント（仕様書v0.2 4.12）：キャラLv2から1つずつ（キャラLv−1）＋クエスト＋探索。
 */
export function starPoints(level: number, questPoints = 0, explorationPoints = 0): number {
  for (const [v, what] of [
    [level, "キャラLv"],
    [questPoints, "クエストのポイント"],
    [explorationPoints, "探索のポイント"],
  ] as const)
    if (!(Number.isSafeInteger(v) && v >= 0))
      throw new RangeError(`${what}は0以上の整数（${String(v)}）`);
  return Math.max(0, level - 1) + questPoints + explorationPoints;
}

/** ジョブの始点（無ければ undefined）。 */
export function startNodeOf(db: ContentDb, jobId: string): string | undefined {
  for (const n of db.starNodes.values()) if (n.startFor?.includes(jobId) === true) return n.id;
  return undefined;
}

function links(db: ContentDb, id: string): ReadonlySet<string> {
  return db.starLinks.get(id) ?? new Set();
}

/** root から、nodes の中だけをたどって行けるノード（root 自身は含めない）。 */
function reachable(
  db: ContentDb,
  root: string | undefined,
  nodes: ReadonlySet<string>,
  passable: (id: string) => boolean = () => true,
): Set<string> {
  const out = new Set<string>();
  if (root === undefined) return out;
  const queue = [root];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    for (const next of links(db, cur)) {
      if (out.has(next) || !nodes.has(next)) continue;
      out.add(next);
      if (passable(next)) queue.push(next);
    }
  }
  return out;
}

/** 共鳴紋1つあたりの輝星の効果の強化と、その上限（仕様書v0.2 6.1 I-01。星の器で50%は MVP の盤に無い）。 */
export const RESONANCE_PER_MARK = 0.1;
export const RESONANCE_CAP = 0.4;

/**
 * 効果の数値の部分だけを (1＋amp) 倍にした値（修正値ごと）。値を持たない修正値（印など）は変えない。
 * 乗算は、1を超える分（または1に足りない分）だけを強める（×1.2 → ×1.22）。
 */
export function amplifiedValues(
  db: ContentDb,
  effectId: string,
  amp: number,
): (number | { min: number; max: number } | undefined)[] | undefined {
  const def = db.effects.get(effectId);
  if (def === undefined) return undefined;
  return def.modifiers.map((m) => {
    if (!("value" in m)) return undefined;
    const v = m.value;
    if (typeof v === "object") return { min: v.min * (1 + amp), max: v.max * (1 + amp) };
    if (m.kind === "more") return 1 + (v - 1) * (1 + amp);
    return v * (1 + amp);
  });
}

/** root から、盤のつながりで radius ノード以内にあるノード（root 自身は含めない）。 */
export function nodesWithin(db: ContentDb, root: string | undefined, radius: number): Set<string> {
  const out = new Set<string>();
  if (root === undefined || !(radius > 0)) return out;
  let frontier = [root];
  for (let d = 0; d < radius; d++) {
    const next: string[] = [];
    for (const cur of frontier)
      for (const l of links(db, cur)) {
        if (l === root || out.has(l)) continue;
        out.add(l);
        next.push(l);
      }
    frontier = next;
  }
  return out;
}

/**
 * 星辰盤の取得の状態（取った順を保つ。ポイントの上限を超えたときに、最後に取ったものから休眠させるため）。
 * 取得・返却の規則（仕様書v0.2 4.3・4.9.1）：
 * - 取れるのは、始点か取ったノードの隣で、まだ取っていない、始点でないノード。ポイントが残っていること
 * - 星門の条件を満たしていなくても取れる（休眠したまま。条件を満たせば有効になる）
 * - 返せるのは、返しても、始点につながっていたほかのノードが、始点からつながったままのとき
 */
export class StarAllocation {
  private readonly db: ContentDb;
  private order: string[];

  constructor(db: ContentDb, allocated: readonly string[] = []) {
    this.db = db;
    const seen = new Set<string>();
    for (const id of allocated) {
      const n = db.starNodes.get(id);
      if (n === undefined) throw new RangeError(`ノード ${id} がデータに無い`);
      if (n.kind === "start") throw new RangeError(`始点 ${id} は取得しない`);
      if (seen.has(id)) throw new RangeError(`ノード ${id} が2回取得されている`);
      seen.add(id);
    }
    this.order = [...allocated];
  }

  /** 取った順のノード。 */
  get nodes(): readonly string[] {
    return this.order;
  }
  has(id: string): boolean {
    return this.order.includes(id);
  }
  get spent(): number {
    return this.order.length;
  }

  /** 取れない理由（取れるなら undefined）。 */
  allocateBlock(
    id: string,
    root: string | undefined,
    points: number,
  ): "unknown" | "start" | "taken" | "points" | "notAdjacent" | undefined {
    const n = this.db.starNodes.get(id);
    if (n === undefined) return "unknown";
    if (n.kind === "start") return "start";
    if (this.has(id)) return "taken";
    if (this.order.length >= points) return "points";
    const near = links(this.db, id);
    if (!(root !== undefined && near.has(root)) && !this.order.some((x) => near.has(x)))
      return "notAdjacent";
    return undefined;
  }

  allocate(id: string, root: string | undefined, points: number): boolean {
    if (this.allocateBlock(id, root, points) !== undefined) return false;
    this.order.push(id);
    return true;
  }

  /** 返せるか（返しても、始点につながっていたほかのノードが、つながったままか）。 */
  canRefund(id: string, root: string | undefined): boolean {
    if (!this.has(id)) return false;
    const all = new Set(this.order);
    const before = reachable(this.db, root, all);
    all.delete(id);
    const after = reachable(this.db, root, all);
    before.delete(id);
    for (const x of before) if (!after.has(x)) return false;
    return true;
  }

  refund(id: string, root: string | undefined): boolean {
    if (!this.canRefund(id, root)) return false;
    this.order = this.order.filter((x) => x !== id);
    return true;
  }

  /** 全て返す（全体の振り直し。仕様書v0.2 4.13）。 */
  clear(): void {
    this.order = [];
  }
}

/** 休眠の理由（仕様書v0.2 4.9.1 の休眠の規則1〜3）。 */
export type DormantReason =
  | { readonly type: "budget" }
  | { readonly type: "gate"; readonly gate: string; readonly unmet: readonly Condition[] }
  | { readonly type: "disconnected" };

export interface StarBoardInput {
  /** 取った順のノード。 */
  readonly allocation: readonly string[];
  /** 使えるポイント（{@link starPoints}）。 */
  readonly points: number;
  /** 始点にするジョブ（メインジョブ）。 */
  readonly rootJob: string;
  /** 第1段階の効果（能力値・装備など。星門の能力値の条件の判定に使う）。 */
  readonly baseInstances: readonly EffectInstance[];
  readonly facts?: EvaluationFacts;
  /**
   * 職紋盤の接続ノード（仕様書v0.2 4.10）：始点からこのノード数以内にある小星の効果を×2にする（0・省略で無し）。
   */
  readonly boostRadius?: number;
  /** 星域ごとの共鳴紋の数（天極の共鳴変化。共鳴紋の付いた装備は、まだ無い）。 */
  readonly resonance?: Partial<Record<StarRegion, number>>;
  /**
   * 遺物の写し（仕様書v0.2 3.11.6）：星座の小星を取得済みとして扱う（ポイントを使わない・経路には使えない・
   * 星門やつながりに関係なく効く）。写した小星で完成した星座は、完成ボーナスが completionBonus 倍。
   * その星座の小星でないノード・すでに有効なノードは無視する。数の上限は呼ぶ側で切る（{@link relicCopies}）。
   */
  readonly relic?: {
    readonly constellation: string;
    readonly nodes: readonly string[];
    readonly completionBonus: number;
  };
  /**
   * 共鳴座にはめ込んだ残響（共鳴座のノード → ユニークのベース。仕様書v0.2 3.11.5・4.8）。
   * 有効な共鳴座のうち、取った順に3つまでが働く。MVP の盤には共鳴座が無い（MVP後の機能の提案 1-2）。
   */
  readonly echoes?: Readonly<Record<string, string>>;
}

export interface StarBoardResult {
  readonly root: string | undefined;
  /** 有効なノード（取った順）。 */
  readonly active: readonly string[];
  /** 休眠したノードと理由。 */
  readonly dormant: ReadonlyMap<string, DormantReason>;
  /** 開いている星門・閉じている星門（取ったものだけ）。 */
  readonly gates: ReadonlyMap<string, boolean>;
  /** 完成した星座。 */
  readonly constellations: readonly string[];
  /** 共鳴変化が効いている天極。 */
  readonly resonating: readonly string[];
  /** 遺物で写して効いている小星（取った順ではなく、遺物の選んだ順）。 */
  readonly relicNodes: readonly string[];
  /** 遺物の写しを使って完成した星座（完成ボーナスが減る）。 */
  readonly relicCompleted: readonly string[];
  /** 働いている残響の共鳴座（取った順・3つまで）。 */
  readonly echoSockets: readonly string[];
  /** 有効なノード・星座・共鳴変化の効果（能力値の計算に渡す）。 */
  readonly effects: readonly EffectInstance[];
  readonly spent: number;
  readonly points: number;
}

/**
 * 星辰盤を評価する（仕様書v0.2 4.9.1）。
 * 1. ポイントの上限を超えた分は、最後に取ったものから休眠（規則3）
 * 2. 第1段階：始点から、星門を通らずにつながるノードの効果と、基礎の効果（能力値・装備）で値を作る
 * 3. 第2段階：星門の条件を、第1段階の値と事実だけで判定する（門の先のノード自身の効果は含めない）
 * 4. 第3段階：始点から、開いた星門だけを通ってつながるノードを有効にする。つながらないノードは休眠
 *    （閉じた門の先なら星門の理由、そうでなければつながっていない理由）
 * 同じ入力なら、何度評価しても結果は同じ。
 */
export function evaluateStarBoard(
  db: ContentDb,
  tags: TagIndex,
  input: StarBoardInput,
): StarBoardResult {
  const root = startNodeOf(db, input.rootJob);
  const dormant = new Map<string, DormantReason>();
  const budget = Math.max(0, input.points);
  const within = input.allocation.slice(0, budget);
  for (const id of input.allocation.slice(budget)) dormant.set(id, { type: "budget" });
  const pool = new Set(within);
  const node = (id: string): StarNodeDef | undefined => db.starNodes.get(id);
  const isGate = (id: string): boolean => node(id)?.kind === "gate";
  // 星の器：取った（ポイントの内の）ノードのうち、上限を上げるものの星域ごとの合計
  const capBonus = new Map<StarRegion, number>();
  for (const id of within) {
    const n = node(id);
    if (n?.resonanceCapBonus !== undefined)
      capBonus.set(n.region, (capBonus.get(n.region) ?? 0) + n.resonanceCapBonus);
  }
  // 職紋盤の接続ノード：始点の周り（盤のつながりで数えた距離）の小星は×2
  const boosted = nodesWithin(db, root, input.boostRadius ?? 0);
  // 残響の加護を受ける輝星（働いている共鳴座が決まってから入れる。第1段階には効かせない）
  const blessed = new Set<string>();
  const instancesOf = (ids: Iterable<string>): EffectInstance[] => {
    const out: EffectInstance[] = [];
    for (const id of ids) {
      const n = node(id);
      const double = boosted.has(id) && n?.kind === "minor";
      // 共鳴紋：その星域の輝星の効果の数値の部分を +10%／個（上限+40%。仕様書v0.2 6.1 I-01）
      const marks = n?.kind === "notable" ? (input.resonance?.[n.region] ?? 0) : 0;
      const cap = n === undefined ? RESONANCE_CAP : RESONANCE_CAP + (capBonus.get(n.region) ?? 0);
      const amp =
        Math.min(cap, RESONANCE_PER_MARK * marks) +
        (n?.kind === "notable" && blessed.has(id) ? ECHO_BLESSING : 0);
      for (const effectId of n?.effects ?? []) {
        const values = amp > 0 ? amplifiedValues(db, effectId, amp) : undefined;
        out.push({
          effectId,
          source: { kind: STAR_NODE_SOURCE, ref: id },
          ...(double ? { stacks: 2 } : {}),
          ...(values === undefined ? {} : { values }),
        });
      }
      // 事実の数だけ重ねる効果（重荷の誇り）
      const fs = n?.factStacked;
      const count = fs === undefined ? 0 : Math.max(0, input.facts?.facts?.[fs.fact] ?? 0);
      if (fs !== undefined && count > 0)
        for (const effectId of fs.effects)
          out.push({ effectId, source: { kind: STAR_NODE_SOURCE, ref: id }, stacks: count });
    }
    return out;
  };
  // 第1段階：星門を通らずにつながるノード（星門そのものは含めない）
  const ungated = new Set(
    [...reachable(db, root, pool, (id) => !isGate(id))].filter((id) => !isGate(id)),
  );
  const facts = input.facts ?? {};
  let stage1: ReturnType<typeof stageOneView> | undefined;
  const view = (): ReturnType<typeof stageOneView> => {
    stage1 ??= stageOneView(db, tags, [...input.baseInstances, ...instancesOf(ungated)], facts);
    return stage1;
  };
  // 第2段階：取った星門の条件
  const gates = new Map<string, boolean>();
  const unmetOf = new Map<string, Condition[]>();
  for (const id of within) {
    const conditions = node(id)?.gate?.conditions;
    if (conditions === undefined) continue;
    const unmet = conditions.filter((c) => !conditionMet(c, view(), facts, tags));
    gates.set(id, unmet.length === 0);
    unmetOf.set(id, unmet);
  }
  // 第3段階：開いた星門だけを通ってつながるノード
  const open = (id: string): boolean => !isGate(id) || gates.get(id) === true;
  const reached = reachable(db, root, pool, open);
  const active = within.filter((id) => reached.has(id) && open(id));
  const activeSet = new Set(active);
  for (const id of within) {
    if (activeSet.has(id)) continue;
    // 閉じた星門か、その先（星門を無視すればつながる）なら、星門の理由
    let gate: string | undefined;
    if (isGate(id) && reached.has(id)) gate = id;
    else
      for (const [g, ok] of gates) {
        if (ok || !reached.has(g)) continue;
        if (reachable(db, g, pool, open).has(id)) {
          gate = g;
          break;
        }
      }
    dormant.set(
      id,
      gate === undefined
        ? { type: "disconnected" }
        : { type: "gate", gate, unmet: unmetOf.get(gate) ?? [] },
    );
  }
  // 遺物の写し：その星座の小星で、まだ有効でないもの（重なりは1つにする）
  const relicDef =
    input.relic === undefined ? undefined : db.constellations.get(input.relic.constellation);
  const relicNodes =
    input.relic === undefined || relicDef === undefined
      ? []
      : [...new Set(input.relic.nodes)].filter(
          (id) => relicDef.nodes.includes(id) && node(id)?.kind === "minor" && !activeSet.has(id),
        );
  const relicSet = new Set(relicNodes);
  // 星座・共鳴変化
  const constellations = [...db.constellations.values()]
    .filter((c) => c.nodes.every((n) => activeSet.has(n) || relicSet.has(n)))
    .map((c) => c.id);
  const relicCompleted = constellations.filter((c) =>
    (db.constellations.get(c)?.nodes ?? []).some((n) => relicSet.has(n)),
  );
  const resonating = active.filter((id) => {
    const r = node(id)?.resonance;
    const region = node(id)?.region;
    return (
      r !== undefined && region !== undefined && (input.resonance?.[region] ?? 0) >= r.threshold
    );
  });
  // 残響：有効な共鳴座のうち、残響をはめ込んだもの（取った順に3つまで）
  const echoSockets = active
    .filter((id) => node(id)?.kind === "socket" && input.echoes?.[id] !== undefined)
    .filter((id) => echoBlock(db, input.echoes?.[id] ?? "") === undefined)
    .slice(0, MAX_ACTIVE_ECHOES);
  for (const id of echoSockets)
    for (const n of nodesWithin(db, id, ECHO_BLESSING_RADIUS)) blessed.add(n);
  const effects: EffectInstance[] = [...instancesOf(active), ...instancesOf(relicNodes)];
  for (const id of echoSockets)
    effects.push(...echoEffectInstances(db, input.echoes?.[id] ?? "", id));
  for (const id of resonating)
    for (const effectId of node(id)?.resonance?.effects ?? [])
      effects.push({ effectId, source: { kind: STAR_NODE_SOURCE, ref: id } });
  for (const c of constellations) {
    const def = db.constellations.get(c);
    if (def === undefined) continue;
    const stacks =
      def.completionStacks === undefined
        ? 1
        : Math.max(0, Math.floor(input.facts?.facts?.[def.completionStacks] ?? 0));
    // 遺物の写しで完成した星座は、完成ボーナスの数値の部分を completionBonus 倍にする（9章 V-13）
    const values =
      input.relic !== undefined && relicCompleted.includes(c)
        ? amplifiedValues(db, def.completionEffect, input.relic.completionBonus - 1)
        : undefined;
    if (stacks > 0)
      effects.push({
        effectId: def.completionEffect,
        source: { kind: CONSTELLATION_SOURCE, ref: c },
        ...(stacks === 1 ? {} : { stacks }),
        ...(values === undefined ? {} : { values }),
      });
  }
  return {
    root,
    active,
    dormant,
    gates,
    constellations,
    resonating,
    relicNodes,
    relicCompleted,
    echoSockets,
    effects,
    spent: input.allocation.length,
    points: input.points,
  };
}

/** 遺物で写し取れる小星の数（強化値で増える。仕様書v0.2 3.11.6）。 */
export function relicCopyLimit(db: ContentDb, base: string, enhance: number): number {
  const r = db.itemBases.get(base)?.relic;
  if (r === undefined) return 0;
  return Math.floor(r.copies.base + r.copies.perEnhance * Math.max(0, enhance) + 1e-9);
}

/** 遺物で写し取れる小星（その星座の小星。選べる候補）。遺物でなければ空。 */
export function relicCandidates(db: ContentDb, base: string): string[] {
  const r = db.itemBases.get(base)?.relic;
  const c = r === undefined ? undefined : db.constellations.get(r.constellation);
  return (c?.nodes ?? []).filter((id) => db.starNodes.get(id)?.kind === "minor");
}

/**
 * 遺物の選んだ小星が正しいか（候補の中・重ならない・強化値の上限以下）。正しくなければ理由。
 * 遺物でないベースに選んだ小星があるのも正しくない。
 */
export function relicSelectionProblem(
  db: ContentDb,
  base: string,
  enhance: number,
  nodes: readonly string[],
): string | undefined {
  if (db.itemBases.get(base)?.relic === undefined)
    return nodes.length === 0 ? undefined : `${base} は遺物ではない`;
  const candidates = relicCandidates(db, base);
  for (const n of nodes) if (!candidates.includes(n)) return `${n} は写し取れる小星ではない`;
  if (new Set(nodes).size !== nodes.length) return "同じ小星が2回選ばれている";
  const limit = relicCopyLimit(db, base, enhance);
  if (nodes.length > limit)
    return `写し取れるのは${String(limit)}つまで（${String(nodes.length)}つ選ばれている）`;
  return undefined;
}

/** 装備の遺物の写し（星辰盤の評価に渡す形）。遺物でない・選んでいなければ undefined。 */
export function relicCopies(
  db: ContentDb,
  item: {
    readonly base: string;
    readonly enhance?: number;
    readonly relicNodes?: readonly string[];
  },
): StarBoardInput["relic"] {
  const r = db.itemBases.get(item.base)?.relic;
  if (r === undefined || item.relicNodes === undefined || item.relicNodes.length === 0)
    return undefined;
  const limit = relicCopyLimit(db, item.base, item.enhance ?? 0);
  const candidates = relicCandidates(db, item.base);
  return {
    constellation: r.constellation,
    nodes: [...new Set(item.relicNodes)].filter((n) => candidates.includes(n)).slice(0, limit),
    completionBonus: r.completionBonus,
  };
}
