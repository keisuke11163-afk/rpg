/**
 * 転職で二刀流ができなくなるとき（docs/progress D-AUTO-2）：副手の片手武器を外す。
 * インベントリに入りきらなければ、何も変えずに転職しない（ロードアウトの切り替え D-U20-3 と同じ考え方）。
 * MVPの2つのジョブはどちらも二刀流ができるので、データの写しで盗賊の二刀流を外して確かめる。
 */
import { describe, expect, it } from "vitest";
import { type RawContent, loadContent } from "@stella/core";
import { rawContent } from "@stella/content";
import type { InputFrame } from "../src/input/frame.ts";
import { ArenaSimulation } from "../src/scenes/arena-simulation.ts";

function rogueWithoutDualWield(): RawContent {
  const c = rawContent.collections;
  return {
    ...rawContent,
    collections: {
      ...c,
      jobs: (c.jobs ?? []).map((f) => ({
        ...f,
        entries: f.entries.map((e) => {
          const job = e as { id?: string; dualWield?: string };
          if (job.id !== "JOB-ROGUE") return e;
          const rest = { ...job };
          delete rest.dualWield;
          return rest;
        }),
      })),
    },
  };
}

function setup(): ArenaSimulation {
  const loaded = loadContent(rogueWithoutDualWield());
  if (!loaded.ok) throw new Error(loaded.errors.map((e) => e.message).join("\n"));
  const sim = new ArenaSimulation(undefined, { db: loaded.content, enemies: false });
  expect(sim.job.id).toBe("JOB-WARRIOR");
  expect(sim.equipFromInventory("test-dagger")).toBe(true);
  expect(sim.equipFromInventory("test-axe", "offHand")).toBe(true);
  return sim;
}

/** インベントリを埋める（同じベースの写しを、別の uid で）。 */
function fill(sim: ArenaSimulation): void {
  const sample = sim.inventory.items[0];
  if (sample === undefined) throw new Error("見本の装備が無い");
  let n = 0;
  while (sim.inventory.items.length < sim.inventory.capacity)
    expect(sim.inventory.addItem({ ...sample, uid: `itm_fill_${String(n++)}` })).toBe(true);
}

describe("転職で二刀流ができなくなる（D-AUTO-2）", () => {
  it("副手を外せないときは、何も変えずに転職しない", () => {
    const sim = setup();
    fill(sim);
    const before = sim.saveData();
    expect(sim.changeJob()).toBe("inventoryFull");
    expect(sim.job.id).toBe("JOB-WARRIOR");
    expect(sim.equipment.get("offHand")?.uid).toBe("test-axe");
    expect(sim.saveData()).toEqual(before);
  });

  it("キーで転職して副手を外せないときは、理由を表示する", () => {
    const texts: string[] = [];
    const loaded = loadContent(rogueWithoutDualWield());
    if (!loaded.ok) throw new Error(loaded.errors.map((e) => e.message).join("\n"));
    const sim = new ArenaSimulation(undefined, {
      db: loaded.content,
      enemies: false,
      onText: (label) => texts.push(label),
    });
    expect(sim.equipFromInventory("test-dagger")).toBe(true);
    expect(sim.equipFromInventory("test-axe", "offHand")).toBe(true);
    fill(sim);
    const idle: InputFrame = {
      held: new Set(),
      pressed: new Set(),
      move: { x: 0, y: 0 },
      pointerWorld: { x: 0, y: 0 },
    };
    sim.frame(1 / 60, idle, { changeJob: true });
    expect(sim.job.id).toBe("JOB-WARRIOR");
    expect(texts.some((t) => t.includes("インベントリがいっぱい"))).toBe(true);
  });

  it("空きがあれば、副手をインベントリに戻して転職する", () => {
    const sim = setup();
    fill(sim);
    const last = sim.inventory.items.at(-1);
    if (last === undefined) throw new Error("空");
    sim.inventory.removeItem(last.uid);
    expect(sim.changeJob()).toBe("ok");
    expect(sim.job.id).toBe("JOB-ROGUE");
    expect(sim.canDualWield).toBe(false);
    expect(sim.equipment.get("offHand")).toBeUndefined();
    expect(sim.inventory.items.some((i) => i.uid === "test-axe")).toBe(true);
  });

  it("二刀流のまま転職できるジョブ同士では、副手はそのまま", () => {
    const sim = new ArenaSimulation(undefined, { enemies: false });
    expect(sim.equipFromInventory("test-dagger")).toBe(true);
    expect(sim.equipFromInventory("test-axe", "offHand")).toBe(true);
    fill(sim);
    expect(sim.changeJob()).toBe("ok");
    expect(sim.job.id).toBe("JOB-ROGUE");
    expect(sim.equipment.get("offHand")?.uid).toBe("test-axe");
  });
});
