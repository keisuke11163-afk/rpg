import type { ContentDb, StarBoardResult, StarNodeDef } from "@stella/core";
import { text, type TextKey } from "@stella/content";
import { PANEL } from "./panel-layout.ts";
import { type BoardCamera, boardToScreen, nodeAtScreen, screenToBoard } from "./board-view.ts";
import { TEXT_COLOR, type TextLine, effectText, statName } from "./item-text.ts";

/** 星辰盤の画面の表示の範囲（画面のピクセル）。 */
export const BOARD_AREA = {
  x: PANEL.x + 4,
  y: PANEL.y + 22,
  width: PANEL.width - 8 - 220,
  height: PANEL.height - 26,
} as const;
/** 右の列（ノードの説明）。 */
export const BOARD_DETAIL = { x: BOARD_AREA.x + BOARD_AREA.width + 8, y: PANEL.y + 22, width: 208 };
export const ZOOM = { min: 0.4, max: 2.5, initial: 0.6 } as const;

export type { BoardCamera } from "./board-view.ts";

/** 盤の座標 → 画面のピクセル。 */
export function toScreen(cam: BoardCamera, p: { x: number; y: number }): { x: number; y: number } {
  return boardToScreen(BOARD_AREA, cam, p);
}

/** 画面のピクセル → 盤の座標。 */
export function toBoard(cam: BoardCamera, s: { x: number; y: number }): { x: number; y: number } {
  return screenToBoard(BOARD_AREA, cam, s);
}

/** ノードの半径（画面のピクセル。種類で変える）。 */
export function nodeRadius(kind: StarNodeDef["kind"], zoom: number): number {
  const base =
    kind === "keystone" ? 10 : kind === "notable" || kind === "gate" || kind === "start" ? 7 : 5;
  return Math.max(3, base * zoom);
}

/** 画面の位置にあるノード（表示の範囲の外なら undefined）。 */
export function nodeAt(
  db: ContentDb,
  cam: BoardCamera,
  x: number,
  y: number,
): StarNodeDef | undefined {
  return nodeAtScreen(db.starNodes.values(), BOARD_AREA, cam, x, y, (n) =>
    nodeRadius(n.kind, cam.zoom),
  );
}

/** 拡大率を範囲に収める。 */
export function clampZoom(z: number): number {
  return Math.min(ZOOM.max, Math.max(ZOOM.min, z));
}

const KIND_NAME: Readonly<Record<StarNodeDef["kind"], string>> = {
  start: "始点",
  minor: "小星",
  notable: "輝星",
  mutation: "転変ノード",
  keystone: "天極",
  gate: "星門",
  socket: "共鳴座",
};

/** ノードの名前（名前の無い小星は、効果の説明）。 */
export function nodeName(db: ContentDb, n: StarNodeDef): string {
  if (n.text !== undefined) return text(n.text as TextKey);
  const first = n.effects?.[0];
  return first === undefined ? KIND_NAME[n.kind] : effectText(db, first);
}

/** ノードの説明の行（種類・効果・星門の条件・休眠の理由。仕様書v0.2 4.9.1）。 */
export function nodeLines(
  db: ContentDb,
  n: StarNodeDef,
  board: StarBoardResult | undefined,
  allocated: boolean,
  block: string | undefined,
): TextLine[] {
  const lines: TextLine[] = [
    { text: nodeName(db, n), color: TEXT_COLOR.highlight },
    { text: KIND_NAME[n.kind], color: TEXT_COLOR.dim },
  ];
  for (const e of n.effects ?? [])
    lines.push({ text: effectText(db, e), color: TEXT_COLOR.normal });
  for (const c of n.gate?.conditions ?? [])
    lines.push({
      text: `条件：${
        c.type === "equippedTag"
          ? `${c.slot === "mainHand" ? "主手に" : ""}${db.tags.has(c.tag) ? text(db.tags.get(c.tag)?.text as TextKey) : c.tag}を装備している`
          : c.type === "statAtLeast"
            ? `${statName(db, c.stat)}が${String(c.value)}以上`
            : c.type === "mainJob"
              ? `メインジョブが${c.job}`
              : `${c.fact}が${String(c.value)}以上`
      }`,
      color: TEXT_COLOR.normal,
    });
  const why = board?.dormant.get(n.id);
  if (allocated && why !== undefined) {
    const reason =
      why.type === "budget"
        ? "ポイントの上限を超えている"
        : why.type === "disconnected"
          ? "始点からつながっていない"
          : `${(() => {
              const g = db.starNodes.get(why.gate);
              return g === undefined ? why.gate : nodeName(db, g);
            })()}：条件を満たしていない`;
    lines.push({ text: `休眠：${reason}`, color: TEXT_COLOR.bad });
  } else if (allocated)
    lines.push({ text: "取得済み（右クリックで返す：還星の灯1つ）", color: TEXT_COLOR.good });
  else if (n.kind !== "start")
    lines.push(
      block === undefined
        ? { text: "左クリックで取る", color: TEXT_COLOR.good }
        : {
            text:
              block === "points"
                ? "ポイントが足りない"
                : block === "notAdjacent"
                  ? "取ったノードの隣ではない"
                  : "取れない",
            color: TEXT_COLOR.dim,
          },
    );
  return lines;
}

/**
 * 星辰盤の検索（補助仕様書16章）：名前・種類・効果の説明に、空白で区切った全ての語を含むノード。
 * 大文字と小文字・全角と半角の英数字は区別しない。空の検索は何も返さない。並びは盤のデータの順。
 */
export function searchStarNodes(db: ContentDb, query: string): StarNodeDef[] {
  const words = normalizeSearch(query)
    .split(/\s+/)
    .filter((w) => w !== "");
  if (words.length === 0) return [];
  const out: StarNodeDef[] = [];
  for (const n of db.starNodes.values()) {
    const hay = normalizeSearch(
      [nodeName(db, n), KIND_NAME[n.kind], ...(n.effects ?? []).map((e) => effectText(db, e))].join(
        " ",
      ),
    );
    if (words.every((w) => hay.includes(w))) out.push(n);
  }
  return out;
}

/** 検索の比較の形（全角の英数字・空白を半角に、英字を小文字に）。 */
function normalizeSearch(s: string): string {
  return s
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ")
    .toLowerCase();
}
