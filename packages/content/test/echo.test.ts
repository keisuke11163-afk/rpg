/**
 * 残響化（仕様書v0.2 3.11.5・4.8。MVP後の機能の提案 1章）：利点の数値は50%・代償は100%・ルールはそのまま、
 * 共鳴座は3つまで・半径6ノード以内の輝星に残響の加護（+15%）。MVP の盤には共鳴座を置かない（提案 1-2 案A）ので、
 * 試験用の共鳴座をデータの写しに足して確かめる。
 */
import {
  type ContentDb,
  type RawContent,
  TagIndex,
  echoBlock,
  echoConflicts,
  echoEffectInstances,
  echoReview,
  evaluateStarBoard,
  loadContent,
} from "@stella/core";
import { describe, expect, it } from "vitest";
import { loadGameContent, rawContent } from "../src/index.ts";

const db: ContentDb = loadGameContent();

/** 盗賊の始点につながる試験用の共鳴座を n 個足したデータ。 */
function withSockets(n: number, extraUnique?: { id: string; echo: false }): ContentDb {
  const c = rawContent.collections;
  const sockets = Array.from({ length: n }, (_, i) => ({
    id: `STAR-TEST-SOCKET-${String(i + 1)}`,
    kind: "socket",
    region: "jin",
    links: ["STAR-JIN-START"],
    position: { x: 600 + i * 40, y: 600 },
  }));
  const raw: RawContent = {
    ...rawContent,
    collections: {
      ...c,
      starNodes: [...(c.starNodes ?? []), { file: "test/sockets.json", entries: sockets }],
      ...(extraUnique === undefined
        ? {}
        : {
            itemBases: (c.itemBases ?? []).map((src) => ({
              ...src,
              entries: (src.entries as { id: string; unique?: object }[]).map((b) =>
                b.id === extraUnique.id && b.unique !== undefined
                  ? { ...b, unique: { ...b.unique, echo: false } }
                  : b,
              ),
            })),
          }),
    },
  };
  const r = loadContent(raw);
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join("\n"));
  return r.content;
}

describe("残響の効果（3.11.5）", () => {
  it("千の小傷：打撃値-40%（代償）は100%のまま、出血の最大スタック+4（利点）は+2、必ず出血（ルール）はそのまま", () => {
    const fx = echoEffectInstances(db, "BASE-UNQ-U03", "s");
    const byId = new Map(fx.map((f) => [f.effectId, f]));
    expect(byId.get("EFF-UNQ-U03-PENALTY")?.values).toBeUndefined();
    expect(byId.get("EFF-UNQ-U03-STACKS")?.values).toEqual([2]);
    expect(byId.get("EFF-UNQ-U03-BLEED")?.values).toBeUndefined();
    expect(fx.every((f) => f.source.kind === "echo")).toBe(true);
  });

  it("旅人の古靴：移動速度+12% → +6%。狼牙の首飾りの「出血が移る」（数値のルール）はそのまま", () => {
    const shoes = echoEffectInstances(db, "BASE-UNQ-U02", "s");
    expect(shoes.find((f) => f.effectId === "EFF-UNQ-U02-MOVE")?.values?.[0]).toBeCloseTo(0.06);
    const fang = echoEffectInstances(db, "BASE-UNQ-U14", "s");
    expect(fang[0]?.values).toBeUndefined();
  });

  it("潜在効果は残響では働かない（固有効果だけ）", () => {
    const fx = echoEffectInstances(db, "BASE-UNQ-U06", "s").map((f) => f.effectId);
    expect(fx).not.toContain("EFF-UNQ-U06-LATENT");
  });

  it("ユニークでない・残響化できない（echo: false）ものは作れない。MVP の9個は全て残響化できる", () => {
    expect(echoBlock(db, "BASE-WPN-DAGGER-T1")).toBe("notUnique");
    const forbidden = withSockets(0, { id: "BASE-UNQ-U17", echo: false });
    expect(echoBlock(forbidden, "BASE-UNQ-U17")).toBe("forbidden");
    expect(echoEffectInstances(forbidden, "BASE-UNQ-U17", "s")).toEqual([]);
    const uniques = [...db.itemBases.values()].filter((b) => b.unique !== undefined);
    expect(uniques.length).toBeGreaterThanOrEqual(9);
    for (const b of uniques) expect(echoBlock(db, b.id), b.id).toBeUndefined();
  });

  it("同じユニークを装備と残響で同時に使えない（V-01）", () => {
    expect(echoConflicts(["BASE-UNQ-U03"], { a: "BASE-UNQ-U03", b: "BASE-UNQ-U02" })).toEqual([
      "BASE-UNQ-U03",
    ]);
  });

  it("代償の印の付け忘れ：ユニークの固有効果の、弱める向きの数値（1未満の乗算・負の加算）には drawback の印がある", () => {
    for (const r of echoReview(db)) {
      const m = db.effects.get(r.effect)?.modifiers[r.index];
      if (m === undefined || !("value" in m) || typeof m.value !== "number") continue;
      const weakens =
        (m.kind === "more" && m.value < 1) ||
        ((m.kind === "increased" || m.kind === "added") && m.value < 0);
      if (weakens) expect(r.kind, `${r.base} ${r.effect}`).toBe("drawback");
    }
    expect(
      echoReview(db)
        .filter((r) => r.kind === "drawback")
        .map((r) => r.base),
    ).toEqual(["BASE-UNQ-U03"]);
  });
});

describe("共鳴座（4.8。試験用の盤）", () => {
  const sdb = withSockets(4);
  const tags = new TagIndex(sdb.tags);
  const S = (i: number): string => `STAR-TEST-SOCKET-${String(i)}`;
  const run = (allocation: string[], echoes: Record<string, string>) =>
    evaluateStarBoard(sdb, tags, {
      allocation,
      points: 30,
      rootJob: "JOB-ROGUE",
      baseInstances: [],
      echoes,
    });

  it("取った共鳴座にはめ込んだ残響が働く。取っていない共鳴座は働かない", () => {
    const on = run([S(1)], { [S(1)]: "BASE-UNQ-U02" });
    expect(on.echoSockets).toEqual([S(1)]);
    expect(on.effects.some((e) => e.source.kind === "echo")).toBe(true);
    const off = run([], { [S(1)]: "BASE-UNQ-U02" });
    expect(off.echoSockets).toEqual([]);
    expect(off.effects.some((e) => e.source.kind === "echo")).toBe(false);
  });

  it("同時に働く残響は3つまで（取った順）", () => {
    const all = [S(1), S(2), S(3), S(4)];
    const r = run(all, {
      [S(1)]: "BASE-UNQ-U02",
      [S(2)]: "BASE-UNQ-U03",
      [S(3)]: "BASE-UNQ-U16",
      [S(4)]: "BASE-UNQ-U17",
    });
    expect(r.echoSockets).toEqual([S(1), S(2), S(3)]);
  });

  it("残響の加護：共鳴座から6ノード以内の輝星の数値が+15%（残響が無ければ変わらない）", () => {
    const path = ["STAR-JIN-0001", "STAR-JIN-0002", "STAR-NOTABLE-REOPEN"];
    const reopen = (echoes: Record<string, string>) =>
      run([S(1), ...path], echoes).effects.find((e) => e.source.ref === "STAR-NOTABLE-REOPEN");
    expect(reopen({})?.values).toBeUndefined();
    const base = sdb.effects.get("EFF-NOTABLE-REOPEN")?.modifiers[0];
    const v = base !== undefined && "value" in base ? base.value : undefined;
    expect(typeof v).toBe("number");
    expect(reopen({ [S(1)]: "BASE-UNQ-U02" })?.values?.[0]).toBeCloseTo((v as number) * 1.15);
  });

  it("MVP の盤には共鳴座が無い（提案 1-2 案A）", () => {
    expect([...db.starNodes.values()].filter((n) => n.kind === "socket")).toEqual([]);
  });
});
