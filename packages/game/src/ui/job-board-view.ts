import {
  type ContentDb,
  type JobAllocateBlock,
  type JobBoardAllocation,
  type JobNodeDef,
  type JobNodeKind,
  subJobEffectWorks,
} from "@stella/core";
import { text, type TextKey } from "@stella/content";
import {
  type BoardCamera,
  type Point,
  boardToScreen,
  fitCamera,
  nodeAtScreen,
  polygonPoints,
} from "./board-view.ts";
import { TEXT_COLOR, type TextLine, effectText } from "./item-text.ts";
import { BOARD_AREA } from "./star-board-view.ts";

/**
 * 職紋盤（J の画面）と副職紋の面の図（仕様書v0.2 4.10・5.1）：星辰盤と同じ描き方（線でつながった丸いノード・
 * ズーム・ドラッグ・指すと右の列に説明）。描く範囲・右の列は星辰盤と同じ（BOARD_AREA・BOARD_DETAIL）。
 * ここは Phaser に依存しない純粋な関数（座標・当たり判定・状態の分類・説明の行）。描くのは EquipmentPanel。
 */

/** 職紋盤の拡大率の範囲（盤が小さいので、星辰盤より大きくしない上限を低めにする）。 */
export const JOB_ZOOM = { min: 0.4, max: 1.6 } as const;
/** 全体が収まる視点の余白（画面のピクセル。ノードの半径と下の凡例のぶん）。 */
export const JOB_FIT_MARGIN = 22;

/** そのジョブの盤のノード（データの順）。 */
export function jobBoardNodes(db: ContentDb, job: string): JobNodeDef[] {
  return [...db.jobNodes.values()].filter((n) => n.job === job);
}

/** そのジョブの盤のつながり（向きなし・重複なし。[小さいID, 大きいID]）。 */
export function jobBoardEdges(db: ContentDb, job: string): [string, string][] {
  const out: [string, string][] = [];
  for (const n of jobBoardNodes(db, job))
    for (const other of db.jobLinks.get(n.id) ?? []) if (n.id < other) out.push([n.id, other]);
  return out;
}

/** 盤の全体が描く範囲に収まる視点（開いたとき・ジョブや面を替えたとき）。 */
export function fitJobCamera(db: ContentDb, job: string): BoardCamera {
  return fitCamera(
    BOARD_AREA,
    jobBoardNodes(db, job).map((n) => n.position),
    JOB_FIT_MARGIN,
    JOB_ZOOM,
  );
}

/** ノードの半径（画面のピクセル。種類で変える：職奥義 > 輝星 > 始点 > 接続 > 小ノード）。 */
export function jobNodeRadius(kind: JobNodeKind, zoom: number): number {
  const base =
    kind === "mastery"
      ? 10
      : kind === "notable"
        ? 8
        : kind === "start"
          ? 7
          : kind === "connector"
            ? 6
            : 5;
  return Math.max(3, base * zoom);
}

/**
 * ノードの形（頂点。undefined は円）：接続ノードはひし形、職奥義は六角形、ほかは円。
 * 円と見分けられるように、外接円の半径は jobNodeRadius より少し大きくする。
 */
export function jobNodeShape(kind: JobNodeKind, c: Point, r: number): Point[] | undefined {
  if (kind === "connector") return polygonPoints(4, c, r * 1.25, -Math.PI / 2);
  if (kind === "mastery") return polygonPoints(6, c, r * 1.1, -Math.PI / 2);
  return undefined;
}

/** 画面の位置にあるノード（描く範囲の外なら undefined）。 */
export function jobNodeAt(
  db: ContentDb,
  job: string,
  cam: BoardCamera,
  x: number,
  y: number,
): JobNodeDef | undefined {
  return nodeAtScreen(jobBoardNodes(db, job), BOARD_AREA, cam, x, y, (n) =>
    jobNodeRadius(n.kind, cam.zoom),
  );
}

/** ノードの画面の位置。 */
export function jobNodeScreen(cam: BoardCamera, n: JobNodeDef): Point {
  return boardToScreen(BOARD_AREA, cam, n.position);
}

/**
 * ノードの状態（色分けの元）：root＝始点、taken＝取得済み、available＝取れる（隣で、ポイントが足りる）、
 * blocked＝取れない（block が理由）、excluded＝副職紋では取れない種類（職奥義・接続ノード）。
 */
export type JobNodeState = "root" | "taken" | "available" | "blocked" | "excluded";

/** ノードの状態と、取れない理由（取得の規則は JobBoardAllocation のまま）。 */
export function jobNodeState(
  board: JobBoardAllocation,
  id: string,
  points: number,
): { readonly state: JobNodeState; readonly block: JobAllocateBlock | undefined } {
  const block = board.allocateBlock(id, points);
  if (block === undefined) return { state: "available", block };
  if (block === "start") return { state: "root", block };
  if (block === "taken") return { state: "taken", block };
  if (block === "subOnlyMinor") return { state: board.has(id) ? "taken" : "excluded", block };
  return { state: "blocked", block };
}

/** 状態ごとの見た目（塗り・縁の色・透明度）。星辰盤の色に合わせる（取得済み＝金・取れる＝緑の縁）。 */
export const JOB_NODE_LOOK: Readonly<
  Record<JobNodeState, { readonly fill: number; readonly stroke: number; readonly alpha: number }>
> = {
  root: { fill: 0xffd166, stroke: 0xffffff, alpha: 1 },
  taken: { fill: 0xffd166, stroke: 0xffe08a, alpha: 1 },
  available: { fill: 0x2a3a2e, stroke: 0x7bd389, alpha: 1 },
  blocked: { fill: 0x2a2934, stroke: 0x6a6878, alpha: 1 },
  excluded: { fill: 0x1c1b22, stroke: 0x4a4858, alpha: 0.5 },
};

/** 種類ごとの縁の色（取れない・取れるときの、種類の見分け。取得済みは金）。 */
export const JOB_KIND_ACCENT: Readonly<Partial<Record<JobNodeKind, number>>> = {
  notable: 0xffe08a,
  connector: 0x6fb7ff,
  mastery: 0xc3a6ff,
};

/** つながりの線を光らせるか（両端が取得済みか始点）。 */
export function jobEdgeLit(state: (id: string) => JobNodeState, a: string, b: string): boolean {
  const on = (s: JobNodeState): boolean => s === "taken" || s === "root";
  return on(state(a)) && on(state(b));
}

const KIND_TEXT: Readonly<Record<JobNodeKind, TextKey>> = {
  start: "jobboard.kind.start",
  minor: "jobboard.kind.minor",
  notable: "jobboard.kind.notable",
  connector: "jobboard.kind.connector",
  mastery: "jobboard.kind.mastery",
};

/** ノードの名前（名前の無い小ノードは効果の説明。始点は種類の名前）。 */
export function jobNodeName(db: ContentDb, n: JobNodeDef): string {
  if (n.text !== undefined) return text(n.text as TextKey);
  const effects = n.effects ?? [];
  return effects.length === 0
    ? text(KIND_TEXT[n.kind])
    : effects.map((e) => effectText(db, e)).join("、");
}

/** 副職紋で、ゲージの能力値を変える効果だけのノード（取っても働かない。docs/progress D-SUB-15）。 */
export function subJobNodeInert(db: ContentDb, n: JobNodeDef): boolean {
  const effects = n.effects ?? [];
  return effects.length > 0 && !effects.some((e) => subJobEffectWorks(db, e));
}

/** 取れない理由の文章。 */
export function jobBlockText(block: JobAllocateBlock | undefined, role: "main" | "sub"): string {
  switch (block) {
    case "points":
      return text(role === "sub" ? "jobboard.block.points-sub" : "jobboard.block.points");
    case "notAdjacent":
      return text("jobboard.block.not-adjacent");
    case "masteryChosen":
      return text("jobboard.block.mastery-chosen");
    case "subOnlyMinor":
      return text("subjob.board.block.sub-only-minor");
    default:
      return text("jobboard.state.blocked");
  }
}

/**
 * 右の列の説明の行（名前・種類・効果の文章・状態）。副職紋の面では、ゲージ系のノードに「【サブでは働かない】」の
 * 印と断り書きを出す（docs/progress D-SUB-15）。
 */
export function jobNodeLines(
  db: ContentDb,
  n: JobNodeDef,
  state: JobNodeState,
  block: JobAllocateBlock | undefined,
  role: "main" | "sub",
): TextLine[] {
  const inert = role === "sub" && subJobNodeInert(db, n);
  const lines: TextLine[] = [
    {
      text: `${inert ? text("subjob.board.inert") : ""}${jobNodeName(db, n)}`,
      color: TEXT_COLOR.highlight,
    },
    { text: text(KIND_TEXT[n.kind]), color: TEXT_COLOR.dim },
  ];
  if (n.description !== undefined)
    lines.push({ text: text(n.description as TextKey), color: TEXT_COLOR.normal });
  else if (n.text !== undefined)
    for (const e of n.effects ?? [])
      lines.push({ text: effectText(db, e), color: TEXT_COLOR.normal });
  if (inert) lines.push({ text: text("subjob.board.inert-note"), color: TEXT_COLOR.bad });
  if (state === "root") lines.push({ text: text("jobboard.state.root"), color: TEXT_COLOR.dim });
  else if (state === "taken")
    lines.push(
      { text: text("jobboard.state.taken"), color: TEXT_COLOR.good },
      { text: text("jobboard.refund"), color: TEXT_COLOR.dim },
    );
  else if (state === "available")
    lines.push({ text: text("jobboard.state.available"), color: TEXT_COLOR.good });
  else
    lines.push({
      text: `${text("jobboard.state.blocked")}：${jobBlockText(block, role)}`,
      color: state === "excluded" ? TEXT_COLOR.bad : TEXT_COLOR.dim,
    });
  return lines;
}
