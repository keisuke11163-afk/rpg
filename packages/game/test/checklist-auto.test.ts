/**
 * テストプレイのチェックリスト（docs/progress/テストプレイ_チェックリスト.md）のうち、
 * ボット・シミュレーター・ランダムな操作で確かめられる項目（「問題のサイン」が起きないこと）。
 * 手触り（分かりやすさ・楽しさ）は人が確かめる。ここは数値と整合性だけ。
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { loadGameContent } from "@stella/content";
import { type BenchBuild, runBossBench, withWeapons } from "../src/bench/boss-bench.ts";
import { BENCH_BUILDS } from "../src/bench/builds.ts";
import { ArenaSimulation } from "../src/scenes/arena-simulation.ts";

const db = loadGameContent();
const find = (id: string): BenchBuild => {
  const b = BENCH_BUILDS.find((x) => x.id === id);
  if (b === undefined) throw new Error(`ビルド ${id} が無い`);
  return b;
};

describe("チェックリスト 3-4・3-5：二刀流と基準のビルドも、深淵の母樹に勝てる（ボット）", () => {
  // 3-1〜3-3 は boss-bench.test.ts（D-FIN-7）
  for (const id of ["rogue-dual-shadow", "baseline-warrior"])
    it(`${id}：3つのシードで、倒れずに倒せる（180秒以内）`, () => {
      for (const seed of ["s1", "s2", "s3"]) {
        const r = runBossBench(db, find(id), {
          region: "REGION-A5-BOSS",
          invincible: false,
          seconds: 180,
          seed,
        });
        expect(r.boss).toBe("ENM-ABYSS-MOTHER-TREE");
        expect(r.deaths, `${id} ${seed}`).toBe(0);
        expect(r.killTime, `${id} ${seed}`).toBeDefined();
      }
    }, 120_000);

  it("基準の戦士はユニーク・天極を持たない（3-5 の前提）", () => {
    const b = find("baseline-warrior");
    for (const e of b.equipment) expect(db.itemBases.get(e.base)?.unique).toBeUndefined();
    for (const s of b.stars) expect(db.starNodes.get(s)?.kind).not.toBe("keystone");
  });
});

describe("チェックリスト 6-3：片手の二刀流と両手武器（D-FIN-4）", () => {
  /** 深淵の母樹の攻撃面のDPS（120秒・3シードの平均。pnpm bench -- --hands と同じ）。 */
  const dps = (b: BenchBuild): number =>
    ["a", "b", "c"]
      .map(
        (seed) =>
          runBossBench(db, b, { region: "REGION-A5-BOSS", invincible: true, seconds: 120, seed })
            .dps,
      )
      .reduce((x, y) => x + y, 0) / 3;

  it("二刀流は1本より目に見えて強く（+5%以上）、両手武器は二刀流より強いまま", () => {
    const w = find("baseline-warrior");
    const one = dps(withWeapons(w, "BASE-WPN-LONGSWORD-T1"));
    const dual = dps(withWeapons(w, "BASE-WPN-LONGSWORD-T1", "BASE-WPN-LONGSWORD-T1"));
    const two = dps(withWeapons(w, "BASE-WPN-GREATSWORD-T1"));
    // 問題のサイン「二刀流にしても変わった感じがしない」
    expect(dual).toBeGreaterThan(one * 1.05);
    // 問題のサイン「両手武器を使う理由がなくなった」
    expect(two).toBeGreaterThan(dual);
    const r = find("baseline-rogue");
    const rOne = dps(withWeapons(r, "BASE-WPN-DAGGER-T1"));
    const rDual = dps(withWeapons(r, "BASE-WPN-DAGGER-T1", "BASE-WPN-DAGGER-T1"));
    expect(rDual).toBeGreaterThan(rOne * 1.05);
  }, 120_000);
});

describe("チェックリスト 4-1：3つのロードアウトを切り替えても、装備が消えたり増えたりしない", () => {
  type Op =
    | { readonly kind: "switch"; readonly id: number }
    | { readonly kind: "equip"; readonly pick: number; readonly off: boolean }
    | { readonly kind: "unequip"; readonly off: boolean }
    | { readonly kind: "stash"; readonly pick: number }
    | { readonly kind: "unstash"; readonly pick: number }
    | { readonly kind: "disassemble"; readonly pick: number };
  const op: fc.Arbitrary<Op> = fc.oneof(
    fc.record({ kind: fc.constant("switch" as const), id: fc.integer({ min: 1, max: 3 }) }),
    fc.record({ kind: fc.constant("equip" as const), pick: fc.nat(), off: fc.boolean() }),
    fc.record({ kind: fc.constant("unequip" as const), off: fc.boolean() }),
    fc.record({ kind: fc.constant("stash" as const), pick: fc.nat() }),
    fc.record({ kind: fc.constant("unstash" as const), pick: fc.nat() }),
    fc.record({ kind: fc.constant("disassemble" as const), pick: fc.nat() }),
  );

  const held = (sim: ArenaSimulation): string[] => [
    ...sim.equipment.entries().map(([, i]) => i.uid),
    ...sim.inventory.items.map((i) => i.uid),
    ...sim.stash.items.map((i) => i.uid),
  ];

  it("ランダムな操作（切り替え・着替え・倉庫・分解）の後も、持ち物は分解した物だけ減り、参照は持っている物だけ", () => {
    fc.assert(
      fc.property(fc.array(op, { maxLength: 40 }), (ops) => {
        const sim = new ArenaSimulation(undefined, { enemies: false, db });
        const p = sim.motion.position;
        sim.motion.displace({ x: 17 - p.x, y: 12 - p.y });
        expect(sim.inSafeZone).toBe(true);
        let expected = new Set(held(sim));
        const nth = <T>(list: readonly T[], n: number): T | undefined =>
          list.length === 0 ? undefined : list[n % list.length];
        for (const o of ops) {
          switch (o.kind) {
            case "switch":
              sim.switchLoadout(o.id);
              break;
            case "equip": {
              const item = nth(sim.inventory.items, o.pick);
              if (item !== undefined)
                sim.equipFromInventory(item.uid, o.off ? "offHand" : undefined);
              break;
            }
            case "unequip":
              sim.unequip(o.off ? "offHand" : "mainHand");
              break;
            case "stash": {
              const item = nth(sim.inventory.items, o.pick);
              if (item !== undefined) sim.toStash(item.uid);
              break;
            }
            case "unstash": {
              const item = nth(sim.stash.items, o.pick);
              if (item !== undefined) sim.fromStash(item.uid);
              break;
            }
            case "disassemble": {
              const item = nth(sim.inventory.items, o.pick);
              if (item !== undefined && sim.smith(item.uid, { kind: "disassemble" }).ok)
                expected = new Set([...expected].filter((u) => u !== item.uid));
              break;
            }
          }
          const now = held(sim);
          // 同じ装備が2か所に無い
          expect(new Set(now).size).toBe(now.length);
          // 分解した物以外は消えず、増えもしない
          expect(new Set(now)).toEqual(expected);
          // どのロードアウトも、持っている装備だけを参照する
          for (const l of sim.loadouts)
            for (const uid of Object.values(l.equipment)) expect(expected.has(uid)).toBe(true);
        }
      }),
      { numRuns: 60, seed: 4013 },
    );
  }, 60_000);
});
