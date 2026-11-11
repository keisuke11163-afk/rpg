/**
 * 天極（K01・K09・K10・K12・K15）と輝星「傷口を抉る」（仕様書v0.2 4.5・4.7）の、能力値の計算と盤の配置。
 */
import {
  Character,
  type ContentDb,
  Equipment,
  type ItemInstance,
  type JobDef,
  StarAllocation,
  TagIndex,
  buildCharacterSheet,
  startNodeOf,
} from "@stella/core";
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../src/index.ts";

const db: ContentDb = loadGameContent();
const tags = new TagIndex(db.tags);
const job = (id: string): JobDef => {
  const j = db.jobs.get(id);
  if (j === undefined) throw new Error(`${id} がない`);
  return j;
};
const WARRIOR = job("JOB-WARRIOR");
const ROGUE = job("JOB-ROGUE");
const item = (uid: string, base: string): ItemInstance => ({
  uid,
  base,
  rarity: "normal",
  itemLevel: 1,
  affixes: [],
});

/** 始点から、そのノードまでの最短の取り方（始点を含まない）。 */
function pathTo(root: string, goal: string): string[] {
  const prev = new Map<string, string>();
  const queue = [root];
  const seen = new Set([root]);
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    if (cur === goal) break;
    for (const n of db.starLinks.get(cur) ?? []) {
      if (seen.has(n) || db.starNodes.get(n)?.kind === "start") continue;
      seen.add(n);
      prev.set(n, cur);
      queue.push(n);
    }
  }
  const out: string[] = [];
  for (let c = goal; c !== root; c = prev.get(c) as string) out.unshift(c);
  return out;
}

function sheet(origin: JobDef, allocation: readonly string[], equip?: (e: Equipment) => void) {
  const e = new Equipment(db);
  equip?.(e);
  return buildCharacterSheet(db, tags, {
    character: new Character({ origin, level: 20 }),
    job: origin,
    equipment: e,
    starBoard: { allocation, points: 25 },
  });
}

describe("MVPの星辰盤のポイント（25＝Lv20の19＋クエスト4＋探索2）で、ビルドが成り立つ", () => {
  it("盗賊：毒蛇座（完成）＋千変＋傷口を抉るを、25ポイント以内で取れる（I-30 のビルド）", () => {
    const root = startNodeOf(db, "JOB-ROGUE") as string;
    const want = [
      ...(db.constellations.get("CONST-VIPER")?.nodes ?? []).flatMap((n) => pathTo(root, n)),
      ...pathTo(root, "STAR-KEY-MYRIAD"),
      ...pathTo(root, "STAR-NOTABLE-REOPEN"),
    ];
    const unique = [...new Set(want)];
    expect(unique.length).toBeLessThanOrEqual(25);
    // 取れる順に並べて、本当に取れることを確かめる
    const a = new StarAllocation(db);
    const order = [...unique].sort((x, y) => pathTo(root, x).length - pathTo(root, y).length);
    for (const id of order) expect(a.allocate(id, root, 25), id).toBe(true);
    const s = sheet(ROGUE, a.nodes);
    expect(s.board?.constellations).toContain("CONST-VIPER");
    expect(s.board?.active).toContain("STAR-KEY-MYRIAD");
  });

  it("戦士の始点から、血の盟約・重荷の誇り・徒手の極意へ5ノード以内", () => {
    const root = startNodeOf(db, "JOB-WARRIOR") as string;
    for (const k of ["STAR-KEY-BLOOD-PACT", "STAR-KEY-BURDEN", "STAR-KEY-BARE-HANDS"])
      expect(pathTo(root, k).length, k).toBeLessThanOrEqual(5);
    const rroot = startNodeOf(db, "JOB-ROGUE") as string;
    expect(pathTo(rroot, "STAR-KEY-SHADOW-COPY").length).toBeLessThanOrEqual(5);
  });
});

describe("天極の効果", () => {
  const W = startNodeOf(db, "JOB-WARRIOR") as string;

  it("K09 徒手の極意：主手が空なら素手の基礎ダメージが キャラLv×1.0〜×1.8。武器を持つと無効", () => {
    const path = pathTo(W, "STAR-KEY-BARE-HANDS");
    const bare = sheet(WARRIOR, path);
    expect(bare.attacker.weapon?.base.physical).toEqual({ min: 20, max: 36 });
    const armed = sheet(WARRIOR, path, (e) =>
      e.equip(item("w", "BASE-WPN-LONGSWORD-T1"), "mainHand", true),
    );
    expect(armed.evaluated.view.stat("STAT-KEY-BARE-HANDS").value).toBe(0);
    expect(sheet(WARRIOR, []).attacker.weapon?.base.physical).toEqual({ min: 1, max: 3 });
  });

  it("K09：副手の盾の基礎性能・基本刻印が2倍（片手武器の副手は2倍にならない）", () => {
    const path = pathTo(W, "STAR-KEY-BARE-HANDS");
    const shield = (e: Equipment) => e.equip(item("s", "BASE-SHD-TOWER-T1"), "offHand", true);
    const without = sheet(WARRIOR, [], shield);
    const withK = sheet(WARRIOR, path, shield);
    // 大盾：防具値24、移動-5%
    expect(withK.defense.armor - without.defense.armor).toBeCloseTo(24);
    // 大盾の基本刻印（移動-5%）は2倍にならない（仕様書v0.2 3.9：基本刻印は上がらない）
    expect(withK.moveSpeed).toBeCloseTo(0.95);
    const dual = sheet(WARRIOR, path, (e) =>
      e.equip(item("o", "BASE-WPN-AXE-T1"), "offHand", true),
    );
    expect(dual.evaluated.view.stat("STAT-AILMENT-CHANCE", ["TAG-AIL-BLEED"]).value).toBeCloseTo(
      sheet(WARRIOR, [], (e) =>
        e.equip(item("o", "BASE-WPN-AXE-T1"), "offHand", true),
      ).evaluated.view.stat("STAT-AILMENT-CHANCE", ["TAG-AIL-BLEED"]).value,
    );
  });

  it("K10 重荷の誇り：重装1部位につき与ダメージ+5%・崩し値+8%、移動-12%、4部位以上で崩されない", () => {
    const path = pathTo(W, "STAR-KEY-BURDEN");
    const heavy = (n: number) => (e: Equipment) => {
      for (const p of ["HEAD", "BODY", "HANDS", "FEET", "BELT"].slice(0, n))
        e.equip(item(p, `BASE-ARM-IRON-${p}-T1`), p.toLowerCase() as "head", true);
    };
    // 途中の小星（剛）の分を除くため、天極の手前までを取ったものと比べる
    const base3 = sheet(WARRIOR, path.slice(0, -1), heavy(3));
    const k3 = sheet(WARRIOR, path, heavy(3));
    const dmg = (s: typeof k3) =>
      s.evaluated.view.stat("STAT-DAMAGE", ["TAG-ELEM-PHYSICAL", "TAG-FORM-MELEE"]).increased;
    expect(dmg(k3) - dmg(base3)).toBeCloseTo(0.15);
    expect(
      k3.evaluated.view.stat("STAT-STAGGER").increased -
        base3.evaluated.view.stat("STAT-STAGGER").increased,
    ).toBeCloseTo(0.24);
    expect(k3.evaluated.view.flag("beStaggered", undefined).resolution).not.toBe("forbid");
    const k4 = sheet(WARRIOR, path, heavy(4));
    expect(k4.evaluated.view.flag("beStaggered", undefined).resolution).toBe("forbid");
    // 重鎖の帯は無い（4部位）ので、移動は -12% だけ
    expect(k4.moveSpeed).toBeCloseTo(0.88);
  });

  it("K01 血の盟約：MPコスト×1.5をHPで払う・HPの回復効果+30%。共鳴変化はまだ効かない", () => {
    const s = sheet(WARRIOR, pathTo(W, "STAR-KEY-BLOOD-PACT"));
    expect(s.evaluated.view.stat("STAT-KEY-BLOOD-PACT").value).toBe(1.5);
    expect(s.evaluated.view.stat("STAT-HP-RECOVERY").increased).toBeCloseTo(0.3);
    expect(s.evaluated.view.stat("STAT-KEY-BLOOD-PACT-REFUND").value).toBe(0);
  });
});
