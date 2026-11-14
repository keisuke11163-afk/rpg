/**
 * 職紋盤・副職紋の図（docs/progress D-JBD-1）：盤の図の共通の部品（座標の変換・当たり判定・全体が収まる視点・
 * ドラッグ・拡大）と、職紋盤の図の純粋な関数（状態の分類・形・説明の行）。右クリックで返す（試し打ちの場だけ）。
 */
import { describe, expect, it } from "vitest";
import { FIXED_STEP_SECONDS, JobBoardAllocation } from "@stella/core";
import { loadGameContent } from "@stella/content";
import {
  boardToScreen,
  fitCamera,
  insideArea,
  nodeAtScreen,
  panCamera,
  polygonPoints,
  screenToBoard,
  zoomCamera,
} from "../src/ui/board-view.ts";
import {
  JOB_ZOOM,
  fitJobCamera,
  jobBlockText,
  jobBoardEdges,
  jobBoardNodes,
  jobEdgeLit,
  jobNodeAt,
  jobNodeLines,
  jobNodeRadius,
  jobNodeScreen,
  jobNodeShape,
  jobNodeState,
  subJobNodeInert,
} from "../src/ui/job-board-view.ts";
import { BOARD_AREA, ZOOM, nodeAt, toBoard, toScreen } from "../src/ui/star-board-view.ts";
import { ArenaSimulation, DUMMY_POSITION } from "../src/scenes/arena-simulation.ts";
import type { InputFrame } from "../src/input/frame.ts";
import type { Action } from "../src/input/actions.ts";
import { toPixels } from "../src/world/units.ts";

const db = loadGameContent();
const AREA = { x: 10, y: 20, width: 400, height: 200 };
const JOBS = ["JOB-WARRIOR", "JOB-ROGUE", "JOB-ARCHER", "JOB-MAGE", "JOB-KNIGHT", "JOB-SUMMONER"];
const W = "JBN-WARRIOR-";

describe("盤の図の共通の部品", () => {
  it("盤の座標と画面のピクセルは、行って戻ると同じ。視点の中心は範囲の中心に来る", () => {
    const cam = { cx: 30, cy: -12, zoom: 0.75 };
    expect(boardToScreen(AREA, cam, { x: 30, y: -12 })).toEqual({ x: 210, y: 120 });
    for (const p of [
      { x: 0, y: 0 },
      { x: -120, y: 330 },
      { x: 55.5, y: -7.25 },
    ]) {
      const back = screenToBoard(AREA, cam, boardToScreen(AREA, cam, p));
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
    }
  });

  it("星辰盤の変換は、共通の部品にしても前と同じ式（BOARD_AREA の中心・拡大率）", () => {
    const cam = { cx: 100, cy: 50, zoom: ZOOM.initial };
    const p = { x: 140, y: 20 };
    expect(toScreen(cam, p)).toEqual({
      x: BOARD_AREA.x + BOARD_AREA.width / 2 + (p.x - cam.cx) * cam.zoom,
      y: BOARD_AREA.y + BOARD_AREA.height / 2 + (p.y - cam.cy) * cam.zoom,
    });
    const back = toBoard(cam, toScreen(cam, p));
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
    // 星辰盤の当たり判定：ノードの位置を指すとそのノード、範囲の外は無し
    const n = [...db.starNodes.values()][0];
    expect(n).toBeDefined();
    if (n === undefined) return;
    const c = { cx: n.position.x, cy: n.position.y, zoom: 1 };
    const s = toScreen(c, n.position);
    expect(nodeAt(db, c, s.x, s.y)?.id).toBe(n.id);
    expect(nodeAt(db, c, BOARD_AREA.x - 1, s.y)).toBeUndefined();
  });

  it("当たり判定：半径+2 の中でいちばん近いノード。外・範囲の外は undefined", () => {
    const nodes = [
      { id: "a", position: { x: 0, y: 0 } },
      { id: "b", position: { x: 10, y: 0 } },
    ];
    const cam = { cx: 0, cy: 0, zoom: 1 };
    const r = (): number => 5;
    expect(nodeAtScreen(nodes, AREA, cam, 210, 120, r)?.id).toBe("a");
    expect(nodeAtScreen(nodes, AREA, cam, 216, 120, r)?.id).toBe("b"); // b の方が近い
    expect(nodeAtScreen(nodes, AREA, cam, 217, 120, r)?.id).toBe("b");
    expect(nodeAtScreen(nodes, AREA, cam, 210, 128, r)).toBeUndefined(); // 8 > 5+2
    expect(nodeAtScreen(nodes, AREA, cam, 210, 127, r)?.id).toBe("a"); // 7 = 5+2
    const far = { cx: 0, cy: 0, zoom: 1 };
    expect(nodeAtScreen([{ position: { x: -205, y: 0 } }], AREA, far, 5, 120, r)).toBeUndefined();
    expect(insideArea(AREA, { x: 10, y: 20 })).toBe(true);
    expect(insideArea(AREA, { x: 410, y: 220 })).toBe(true);
    expect(insideArea(AREA, { x: 410.5, y: 100 })).toBe(false);
  });

  it("全体が収まる視点：外接矩形の中心で、余白を除いた範囲に収まる拡大率（上限・下限で止める）", () => {
    const pts = [
      { x: -100, y: 0 },
      { x: 100, y: 300 },
    ];
    const cam = fitCamera(AREA, pts, 10, { min: 0.1, max: 5 });
    expect(cam.cx).toBe(0);
    expect(cam.cy).toBe(150);
    expect(cam.zoom).toBeCloseTo(180 / 300, 9); // 高さで決まる
    for (const p of pts) {
      const s = boardToScreen(AREA, cam, p);
      expect(s.y).toBeGreaterThanOrEqual(AREA.y + 10 - 1e-9);
      expect(s.y).toBeLessThanOrEqual(AREA.y + AREA.height - 10 + 1e-9);
    }
    expect(fitCamera(AREA, pts, 10, { min: 0.1, max: 0.5 }).zoom).toBe(0.5);
    expect(fitCamera(AREA, pts, 10, { min: 0.9, max: 5 }).zoom).toBe(0.9);
    expect(fitCamera(AREA, [{ x: 4, y: 4 }], 10, { min: 0.1, max: 2 })).toEqual({
      cx: 4,
      cy: 4,
      zoom: 2,
    });
    expect(fitCamera(AREA, [], 10, { min: 0.1, max: 2 })).toEqual({ cx: 0, cy: 0, zoom: 2 });
  });

  it("ドラッグで盤が指に付いて動き、拡大は範囲に収まる", () => {
    const start = { cx: 10, cy: 10, zoom: 2 };
    const moved = panCamera(start, 40, -20);
    expect(moved).toEqual({ cx: -10, cy: 20, zoom: 2 });
    // 押した所の盤の点が、指の位置に付いてくる
    const grabbed = screenToBoard(AREA, start, { x: 100, y: 100 });
    const now = boardToScreen(AREA, moved, grabbed);
    expect(now.x).toBeCloseTo(140, 9);
    expect(now.y).toBeCloseTo(80, 9);
    expect(zoomCamera(start, 10, { min: 0.5, max: 3 }).zoom).toBe(3);
    expect(zoomCamera(start, 0.01, { min: 0.5, max: 3 }).zoom).toBe(0.5);
    expect(zoomCamera(start, 1.15, { min: 0.5, max: 3 })).toEqual({ cx: 10, cy: 10, zoom: 2.3 });
  });

  it("正多角形の頂点：数・半径・最初の頂点の向き", () => {
    const pts = polygonPoints(4, { x: 5, y: 5 }, 10, -Math.PI / 2);
    expect(pts).toHaveLength(4);
    expect(pts[0]?.x).toBeCloseTo(5, 9);
    expect(pts[0]?.y).toBeCloseTo(-5, 9); // 上
    for (const p of polygonPoints(6, { x: 0, y: 0 }, 3))
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(3);
  });
});

describe("職紋盤の図", () => {
  it("6つのジョブの盤は、全体が最初の視点で描く範囲に収まり、ノードが重ならない", () => {
    for (const job of JOBS) {
      const nodes = jobBoardNodes(db, job);
      expect(nodes.length, job).toBeGreaterThanOrEqual(20);
      const cam = fitJobCamera(db, job);
      expect(cam.zoom).toBeGreaterThanOrEqual(JOB_ZOOM.min);
      expect(cam.zoom).toBeLessThanOrEqual(JOB_ZOOM.max);
      const screens = nodes.map((n) => ({ n, s: jobNodeScreen(cam, n) }));
      for (const { n, s } of screens) {
        const r = jobNodeRadius(n.kind, cam.zoom);
        expect(s.x - r, n.id).toBeGreaterThanOrEqual(BOARD_AREA.x);
        expect(s.y - r, n.id).toBeGreaterThanOrEqual(BOARD_AREA.y);
        expect(s.x + r, n.id).toBeLessThanOrEqual(BOARD_AREA.x + BOARD_AREA.width);
        expect(s.y + r, n.id).toBeLessThanOrEqual(BOARD_AREA.y + BOARD_AREA.height);
        // 自分の位置を指すと自分（ほかのノードと当たり判定が重ならない）
        expect(jobNodeAt(db, job, cam, s.x, s.y)?.id, n.id).toBe(n.id);
      }
      for (let i = 0; i < screens.length; i++)
        for (let j = i + 1; j < screens.length; j++) {
          const a = screens[i];
          const b = screens[j];
          if (a === undefined || b === undefined) continue;
          const gap =
            Math.hypot(a.s.x - b.s.x, a.s.y - b.s.y) -
            jobNodeRadius(a.n.kind, cam.zoom) -
            jobNodeRadius(b.n.kind, cam.zoom);
          expect(gap, `${a.n.id}・${b.n.id}`).toBeGreaterThan(4);
        }
    }
  });

  it("つながりは向きなし・重複なしで、データの links を全て含む", () => {
    const edges = jobBoardEdges(db, "JOB-WARRIOR");
    const keys = new Set(edges.map(([a, b]) => `${a}|${b}`));
    expect(keys.size).toBe(edges.length);
    for (const n of jobBoardNodes(db, "JOB-WARRIOR"))
      for (const l of n.links) {
        const [a, b] = n.id < l ? [n.id, l] : [l, n.id];
        expect(keys.has(`${a}|${b}`), `${n.id}→${l}`).toBe(true);
      }
    expect(edges.every(([a, b]) => a < b)).toBe(true);
  });

  it("状態の分類：始点・取れる（隣でポイントが足りる）・取得済み・取れない（理由）", () => {
    const b = new JobBoardAllocation(db, "JOB-WARRIOR", [`${W}T1`]);
    expect(jobNodeState(b, `${W}START`, 5).state).toBe("root");
    expect(jobNodeState(b, `${W}T1`, 5).state).toBe("taken");
    expect(jobNodeState(b, `${W}T2`, 5)).toEqual({ state: "available", block: undefined });
    expect(jobNodeState(b, `${W}B1A`, 5).state).toBe("available");
    expect(jobNodeState(b, `${W}T3`, 5)).toEqual({ state: "blocked", block: "notAdjacent" });
    expect(jobNodeState(b, `${W}T2`, 1)).toEqual({ state: "blocked", block: "points" });
    // 職奥義は1つだけ
    const m = new JobBoardAllocation(db, "JOB-WARRIOR", [
      ...[1, 2, 3, 4, 5, 6, 7].map((i) => `${W}T${String(i)}`),
      `${W}M-SURGE`,
    ]);
    expect(jobNodeState(m, `${W}M-DEMON`, 20)).toEqual({
      state: "blocked",
      block: "masteryChosen",
    });
    // 副職紋：職奥義・接続ノードは種類で取れない（excluded）
    const s = new JobBoardAllocation(db, "JOB-WARRIOR", [], "sub");
    expect(jobNodeState(s, `${W}C1`, 20)).toEqual({ state: "excluded", block: "subOnlyMinor" });
    expect(jobNodeState(s, `${W}M-SURGE`, 20).state).toBe("excluded");
    expect(jobNodeState(s, `${W}T1`, 20).state).toBe("available");
  });

  it("線は両端が取得済みか始点のときだけ光る", () => {
    const b = new JobBoardAllocation(db, "JOB-WARRIOR", [`${W}T1`]);
    const st = (id: string) => jobNodeState(b, id, 5).state;
    expect(jobEdgeLit(st, `${W}START`, `${W}T1`)).toBe(true);
    expect(jobEdgeLit(st, `${W}T1`, `${W}T2`)).toBe(false);
  });

  it("形：接続ノードはひし形・職奥義は六角形・ほかは円。半径は職奥義 > 輝星 > 始点 > 接続 > 小ノード", () => {
    const c = { x: 0, y: 0 };
    expect(jobNodeShape("connector", c, 5)).toHaveLength(4);
    expect(jobNodeShape("mastery", c, 5)).toHaveLength(6);
    expect(jobNodeShape("minor", c, 5)).toBeUndefined();
    expect(jobNodeShape("notable", c, 5)).toBeUndefined();
    const r = (k: Parameters<typeof jobNodeRadius>[0]): number => jobNodeRadius(k, 1);
    expect(r("mastery")).toBeGreaterThan(r("notable"));
    expect(r("notable")).toBeGreaterThan(r("start"));
    expect(r("start")).toBeGreaterThan(r("connector"));
    expect(r("connector")).toBeGreaterThan(r("minor"));
    expect(jobNodeRadius("minor", 0.1)).toBe(3); // 小さくしすぎない
  });

  it("説明の行：名前・種類・効果・状態。副職紋ではゲージ系のノードに【サブでは働かない】（D-SUB-15）", () => {
    const b = new JobBoardAllocation(db, "JOB-WARRIOR", [`${W}T1`]);
    const forge = db.jobNodes.get(`${W}FORGE`);
    expect(forge).toBeDefined();
    if (forge === undefined) return;
    const lines = jobNodeLines(db, forge, "blocked", "notAdjacent", "main").map((l) => l.text);
    expect(lines[0]).toBe("闘志の炉");
    expect(lines).toContain("輝星（大ノード）");
    expect(lines).toContain("闘志の自然減少-50%");
    expect(lines.at(-1)).toBe("取れない：取ったノードの隣ではない");
    const t1 = db.jobNodes.get(`${W}T1`);
    if (t1 === undefined) throw new Error("T1");
    expect(jobNodeLines(db, t1, "taken", "taken", "main").map((l) => l.text)).toContain("取得済み");
    expect(
      jobNodeLines(db, t1, jobNodeState(b, `${W}T2`, 5).state, undefined, "main").at(-1)?.text,
    ).toBe("取れる（左クリックで取る）");
    // ゲージの獲得の小ノード（T4）
    const t4 = db.jobNodes.get(`${W}T4`);
    if (t4 === undefined) throw new Error("T4");
    expect(subJobNodeInert(db, t4)).toBe(true);
    expect(subJobNodeInert(db, t1)).toBe(false);
    const sub = jobNodeLines(db, t4, "available", undefined, "sub").map((l) => l.text);
    expect(sub[0]?.startsWith("【サブでは働かない】")).toBe(true);
    expect(sub.some((l) => l.includes("サブジョブでは働かない"))).toBe(true);
    expect(
      jobNodeLines(db, t4, "available", undefined, "main").some((l) =>
        l.text.includes("サブでは働かない"),
      ),
    ).toBe(false);
    expect(jobBlockText("subOnlyMinor", "sub")).toBe(
      "副職紋では、職奥義と星辰盤への接続ノードは取れない",
    );
    expect(jobBlockText("points", "sub")).toContain("最大20");
  });
});

describe("職紋盤のノードを1つ返す（右クリック。D-JBD-2）", () => {
  const frame = (move = { x: 0, y: 0 }): InputFrame => ({
    held: new Set<Action>(),
    pressed: new Set<Action>(),
    move,
    pointerWorld: { x: toPixels(DUMMY_POSITION.x), y: toPixels(DUMMY_POSITION.y) },
  });
  it("試し打ちの場だけ返せる（つながりが切れるノードは返らない）。出ると元に戻る", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    expect(sim.allocateJobNode(`${W}T1`)).toBe(true);
    expect(sim.refundJobNode(`${W}T1`)).toBe(false); // 試し打ちの場の外
    expect(sim.jobBoard.nodes).toEqual([`${W}T1`]);
    for (let i = 0; i < 600 && sim.motion.position.x < DUMMY_POSITION.x - 2; i++)
      sim.frame(FIXED_STEP_SECONDS, frame({ x: 1, y: 0 }));
    expect(sim.startTrial()).toBe(true);
    expect(sim.allocateJobNode(`${W}T2`)).toBe(true);
    expect(sim.refundJobNode(`${W}T1`)).toBe(false); // T2 がつながらなくなる
    expect(sim.refundJobNode(`${W}T2`)).toBe(true);
    expect(sim.refundJobNode(`${W}T2`)).toBe(false); // 取っていない
    expect(sim.jobBoard.nodes).toEqual([`${W}T1`]);
    expect(sim.endTrial()).toBe(true);
    expect(sim.jobBoard.nodes).toEqual([`${W}T1`]);
  });
});
