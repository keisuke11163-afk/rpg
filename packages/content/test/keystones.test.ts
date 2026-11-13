/**
 * 天極（K01・K09・K10・K12・K15）と輝星「傷口を抉る」（仕様書v0.2 4.5・4.7）の、能力値の計算と盤の配置。
 */
import {
  Character,
  type ContentDb,
  Equipment,
  type ItemInstance,
  type JobDef,
  Rng,
  StarAllocation,
  generateItem,
  TagIndex,
  buildCharacterSheet,
  bareHandsDamage,
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
    character: new Character({ jobs: db.jobs, origin, level: 20 }),
    job: origin,
    equipment: e,
    starBoard: { allocation, points: 25 },
  });
}

describe("bareHandsDamage（徒手の極意の素手の基礎ダメージ。D-FIN-5）", () => {
  it("上限より下では式のまま（キャラLv×1.0〜×1.8）、上では最大を上限に・最小を同じ比で抑える", () => {
    expect(bareHandsDamage(10, 30)).toEqual({ min: 10, max: 18 });
    expect(bareHandsDamage(16, 30)).toEqual({ min: 16, max: 28.8 });
    const capped = bareHandsDamage(20, 30);
    expect(capped.max).toBe(30);
    expect(capped.min).toBeCloseTo(16.667, 3);
    // 上限0は上限なし
    expect(bareHandsDamage(20, 0)).toEqual({ min: 20, max: 36 });
  });
});

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

  it("K09 徒手の極意：主手が空なら素手の基礎ダメージが キャラLv×1.0〜×1.8（最大の上限30。D-FIN-5）。武器を持つと無効", () => {
    const path = pathTo(W, "STAR-KEY-BARE-HANDS");
    const bare = sheet(WARRIOR, path);
    // Lv20：式では 20〜36。上限30で最大を抑え、最小も同じ比（1:1.8）で抑える
    expect(bare.evaluated.view.stat("STAT-KEY-BARE-HANDS-MAX").value).toBe(30);
    const physical = bare.attacker.weapon?.base.physical;
    expect(physical?.max).toBe(30);
    expect(physical?.min).toBeCloseTo(30 / 1.8, 10);
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

describe("鍛冶座（仕様書v0.2 4.4。開発計画書4.2 の MVP の星座）", () => {
  it("小星8個を全て取ると完成し、装備の強化値の合計×0.4%だけ与ダメージが増える", () => {
    const W = startNodeOf(db, "JOB-WARRIOR") as string;
    const path = pathTo(W, "STAR-SMITH-08");
    const withGear = (enhance: number) =>
      sheet(WARRIOR, path, (e) => {
        e.equip({ ...item("w", "BASE-WPN-GREATSWORD-T1"), enhance }, "mainHand", true);
        e.equip({ ...item("b", "BASE-ARM-IRON-BODY-T1"), enhance }, "body", true);
      });
    const a = withGear(0);
    const b = withGear(5);
    expect(b.board?.constellations).toContain("CONST-SMITH");
    const dmg = (s: typeof a) => s.evaluated.view.stat("STAT-DAMAGE", ["TAG-ELEM-FIRE"]).increased;
    // 強化値の合計10 → +4%（物理でない文脈で比べる。小星の物理ダメージ+5%を除くため）
    expect(dmg(b) - dmg(a)).toBeCloseTo(0.04);
    expect(path.length).toBeLessThanOrEqual(25);
  });
});

describe("共鳴紋と共鳴変化（仕様書v0.2 3.6・6.1 I-01・I-02）", () => {
  const mark = (uid: string, base: string, region: "GOU" | "JIN" | "GOUJIN"): ItemInstance => ({
    ...item(uid, base),
    rarity: "magic",
    affixes: [{ id: `AFX-SUF-RESONANCE-${region}`, tier: 7, rolls: [1] }],
  });

  it("共鳴紋1つにつき、その星域の輝星の効果の数値の部分+10%（上限+40%）", () => {
    const R = startNodeOf(db, "JOB-ROGUE") as string;
    const path = pathTo(R, "STAR-NOTABLE-REOPEN");
    const reopen = (n: number) =>
      sheet(ROGUE, path, (e) => {
        const slots = ["head", "body", "hands", "feet", "belt"] as const;
        const bases = ["HEAD", "BODY", "HANDS", "FEET", "BELT"];
        for (let i = 0; i < n; i++)
          e.equip(
            mark(`m${String(i)}`, `BASE-ARM-LEATHER-${bases[i] ?? ""}-T1`, "JIN"),
            slots[i] ?? "head",
            true,
          );
      }).evaluated.view.stat("STAT-NOTABLE-REOPEN").value;
    expect(reopen(0)).toBeCloseTo(1);
    expect(reopen(2)).toBeCloseTo(1.2);
    expect(reopen(5)).toBeCloseTo(1.4); // 上限+40%
  });

  it("別の星域の共鳴紋・輝星でないノード（小星）には効かない", () => {
    const R = startNodeOf(db, "JOB-ROGUE") as string;
    const path = pathTo(R, "STAR-NOTABLE-REOPEN");
    const s = sheet(ROGUE, path, (e) =>
      e.equip(mark("g", "BASE-ARM-IRON-HEAD-T1", "GOU"), "head", true),
    );
    expect(s.evaluated.view.stat("STAT-NOTABLE-REOPEN").value).toBeCloseTo(1);
  });

  it("同じ星域の共鳴紋3つで、その星域の天極が共鳴変化になる（重荷の誇り：移動の低下 -12% → -6%）", () => {
    const W = startNodeOf(db, "JOB-WARRIOR") as string;
    const path = pathTo(W, "STAR-KEY-BURDEN");
    const gear = (n: number) => (e: Equipment) => {
      const slots = ["head", "body", "hands"] as const;
      const bases = ["HEAD", "BODY", "HANDS"];
      for (let i = 0; i < n; i++)
        e.equip(
          mark(`g${String(i)}`, `BASE-ARM-LEATHER-${bases[i] ?? ""}-T1`, "GOU"),
          slots[i] ?? "head",
          true,
        );
    };
    expect(sheet(WARRIOR, path, gear(2)).moveSpeed).toBeCloseTo(0.88);
    const three = sheet(WARRIOR, path, gear(3));
    expect(three.board?.resonating).toContain("STAR-KEY-BURDEN");
    expect(three.moveSpeed).toBeCloseTo(0.94);
  });

  it("星鉄の首飾り：共鳴紋が確定で付き、詞の枠が1つ減る", () => {
    const base = db.itemBases.get("BASE-ACC-STAR-IRON-NECK-T1");
    if (base === undefined) throw new Error("星鉄の首飾りが無い");
    const rng = Rng.fromSeed("star-iron");
    for (let i = 0; i < 300; i++) {
      for (const rarity of ["normal", "magic", "rare"] as const) {
        const it = generateItem(db, rng, { uid: "n", base, rarity, itemLevel: 20 });
        const marks = it.affixes.filter((a) => db.affixes.get(a.id)?.resonance !== undefined);
        expect(marks.length).toBeGreaterThanOrEqual(1);
        expect(it.affixes.length).toBeLessThanOrEqual(5);
      }
    }
  });
});
