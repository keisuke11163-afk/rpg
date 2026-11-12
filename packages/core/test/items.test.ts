/**
 * アイテムの生成の仕組み（U-11）：詞のtierの補間・tierの重み・レアリティの抽選の手順・
 * 詞の枠・値の抽選・データの検証。データは小さなテスト用のもの（実際のデータは packages/content のテスト）。
 */
import { describe, expect, it } from "vitest";
import {
  AFFIX_SLOTS,
  type AffixDef,
  type ContentDb,
  type ItemBaseDef,
  type RawContent,
  type RarityDef,
  Rng,
  affixTierValues,
  candidateAffixes,
  eligibleTiers,
  evaluateEffects,
  formatContentError,
  generateItem,
  INVENTORY_SLOTS,
  Inventory,
  itemEffectInstances,
  loadContent,
  rarityWeights,
  rollAffixValue,
  TagIndex,
  tierWeights,
} from "../src/index.ts";
import { effect, stat, tag } from "./helpers/content.ts";

const RARITIES = [
  { id: "R-N", rarity: "normal", text: "r.n", weight: 66, affixes: { min: 0, max: 0 } },
  { id: "R-M", rarity: "magic", text: "r.m", weight: 26, affixes: { min: 1, max: 2 } },
  { id: "R-R", rarity: "rare", text: "r.r", weight: 7, affixes: { min: 3, max: 6 } },
  { id: "R-U", rarity: "unique", text: "r.u", weight: 0.8, affixes: { min: 0, max: 0 } },
  { id: "R-S", rarity: "set", text: "r.s", weight: 0.2, affixes: { min: 0, max: 0 } },
];

const affix = (
  id: string,
  position: "prefix" | "suffix",
  categories: string[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  text: `a.${id.toLowerCase()}`,
  position,
  categories,
  effect: "EFF-A-FLAT",
  roll: "range",
  scale: 1,
  weight: 100,
  tiers: [
    { tier: 7, min: 10, max: 19 },
    { tier: 4, min: 50, max: 69 },
  ],
  ...extra,
});

interface Parts {
  rarities?: unknown[];
  itemBases?: unknown[];
  affixes?: unknown[];
  materials?: unknown[];
  dropProfiles?: unknown[];
  effects?: unknown[];
}

function raw(parts: Parts): RawContent {
  const entries = [
    ...(parts.rarities ?? RARITIES),
    ...(parts.itemBases ?? []),
    ...(parts.affixes ?? []),
    ...(parts.materials ?? []),
  ];
  const texts: Record<string, string> = {};
  for (const e of entries) {
    const key = (e as { text?: unknown }).text;
    if (typeof key === "string") texts[key] = key;
  }
  const tags = [tag("TAG-WPN-SWORD", "weapon"), tag("TAG-FAMILY-BEAST", "enemyFamily")];
  const stats = [stat("STAT-FLAT"), stat("STAT-RANGE")];
  for (const t of [...tags, ...stats]) texts[(t as { text: string }).text] = "x";
  return {
    manifest: { file: "manifest.json", value: { schemaVersion: 1, contentVersion: "0.0.1" } },
    texts,
    collections: {
      tags: [{ file: "tags.json", entries: tags }],
      stats: [{ file: "stats.json", entries: stats }],
      effects: [
        {
          file: "effects.json",
          entries: parts.effects ?? [
            effect("EFF-A-FLAT", "affix", [{ kind: "added", stat: "STAT-FLAT", value: 1 }]),
            effect("EFF-A-RANGE", "affix", [
              { kind: "added", stat: "STAT-RANGE", value: { min: 1, max: 2 } },
            ]),
            effect("EFF-IMP", "implicit", [{ kind: "added", stat: "STAT-FLAT", value: 5 }]),
          ],
        },
      ],
      rarities: [{ file: "rarities.json", entries: parts.rarities ?? RARITIES }],
      itemBases: [{ file: "bases.json", entries: parts.itemBases ?? [] }],
      affixes: [{ file: "affixes.json", entries: parts.affixes ?? [] }],
      materials: [{ file: "materials.json", entries: parts.materials ?? [] }],
      dropProfiles: [{ file: "drops.json", entries: parts.dropProfiles ?? [] }],
    },
  };
}

function db(parts: Parts): ContentDb {
  const r = loadContent(raw(parts));
  if (!r.ok) throw new Error(r.errors.map(formatContentError).join("\n"));
  return r.content;
}

function errors(parts: Parts): string[] {
  const r = loadContent(raw(parts));
  return r.ok ? [] : r.errors.map(formatContentError);
}

const base = (id: string, category: string, extra: Record<string, unknown> = {}) => ({
  id,
  text: `b.${id.toLowerCase()}`,
  category,
  tags: [],
  tier: 1,
  requiredLevel: 1,
  ...extra,
});
const weaponBase = (id: string, extra: Record<string, unknown> = {}) =>
  base(id, "weapon", {
    tags: ["TAG-WPN-SWORD"],
    weapon: {
      hands: 1,
      damage: { physical: { min: 6, max: 11 } },
      attackSpeed: 1.4,
      critChance: 0.05,
    },
    ...extra,
  });

const getAffix = (d: ContentDb, id: string): AffixDef => {
  const a = d.affixes.get(id);
  if (a === undefined) throw new Error(id);
  return a;
};
const getBase = (d: ContentDb, id: string): ItemBaseDef => {
  const b = d.itemBases.get(id);
  if (b === undefined) throw new Error(id);
  return b;
};

// ---------------------------------------------------------------------------

describe("詞のtier（仕様書v0.2 3.6）", () => {
  it("表に無いtierは、隣の載っているtierの間を等間隔で補い、端数は切り上げる", () => {
    const d = db({
      affixes: [
        affix("AFX-A", "prefix", ["weapon"], {
          tiers: [
            { tier: 7, min: 1, max: 3 },
            { tier: 4, min: 6, max: 11 },
            { tier: 1, min: 18, max: 32 },
            { tier: 0, min: 24, max: 40 },
          ],
        }),
      ],
    });
    const v = affixTierValues(getAffix(d, "AFX-A"));
    // T6 ＝ T7 ＋（T4 − T7）× 1/3：min 1＋5/3＝2.67 → 3、max 3＋8/3＝5.67 → 6
    expect(v.get(6)).toEqual({ min: 3, max: 6 });
    // T5 ＝ 2/3：min 1＋10/3＝4.33 → 5、max 3＋16/3＝8.33 → 9
    expect(v.get(5)).toEqual({ min: 5, max: 9 });
    // T3 ＝ T4 ＋（T1 − T4）× 1/3：min 6＋4＝10、max 11＋7＝18（ちょうど整数は、そのまま）
    expect(v.get(3)).toEqual({ min: 10, max: 18 });
    expect(v.get(2)).toEqual({ min: 14, max: 25 });
    expect(v.get(7)).toEqual({ min: 1, max: 3 });
    expect(v.get(0)).toEqual({ min: 24, max: 40 });
  });

  it("載っている最も低いtierより低いtierは補わない（職技レベルのような T2以上だけの詞）", () => {
    const d = db({
      affixes: [
        affix("AFX-B", "prefix", ["weapon"], {
          roll: "fixed",
          tiers: [
            { tier: 1, min: 1, max: 1 },
            { tier: 0, min: 2, max: 2 },
          ],
        }),
      ],
    });
    const v = affixTierValues(getAffix(d, "AFX-B"));
    expect([...v.keys()]).toEqual([1, 0]);
    expect(eligibleTiers(getAffix(d, "AFX-B"), 25)).toEqual([]);
  });

  it("アイテムLvで出現できるtier（T7 iLv1・T6 12・T5 25）。極T0は回廊の第12階層以上だけ", () => {
    const d = db({
      affixes: [
        affix("AFX-A", "prefix", ["weapon"], {
          tiers: [
            { tier: 7, min: 1, max: 3 },
            { tier: 4, min: 6, max: 11 },
            { tier: 1, min: 18, max: 32 },
            { tier: 0, min: 24, max: 40 },
          ],
        }),
      ],
    });
    const a = getAffix(d, "AFX-A");
    expect(eligibleTiers(a, 1)).toEqual([7]);
    expect(eligibleTiers(a, 11)).toEqual([7]);
    expect(eligibleTiers(a, 12)).toEqual([6, 7]);
    expect(eligibleTiers(a, 25)).toEqual([5, 6, 7]);
    expect(eligibleTiers(a, 100)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(eligibleTiers(a, 100, { allowT0: true })).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("tierの重み：最も高いtierが40、残りを60で等分。1つなら100", () => {
    expect(tierWeights([7])).toEqual([{ tier: 7, weight: 100 }]);
    expect(tierWeights([6, 7])).toEqual([
      { tier: 6, weight: 40 },
      { tier: 7, weight: 60 },
    ]);
    expect(tierWeights([5, 6, 7])).toEqual([
      { tier: 5, weight: 40 },
      { tier: 6, weight: 30 },
      { tier: 7, weight: 30 },
    ]);
    expect(tierWeights([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("レアリティの抽選の手順（仕様書v0.2 3.5）", () => {
  const d = db({});
  const w = (input: Partial<Parameters<typeof rarityWeights>[0]> = {}) =>
    Object.fromEntries(rarityWeights({ rarities: d.rarities, ...input }));

  it("補正が無ければ基本の重み（合計100）", () => {
    expect(w()).toEqual({ normal: 66, magic: 26, rare: 7, unique: 0.8, set: 0.2 });
  });

  it("敵の格の補正は希少以上にかかり、魔法は変えず、通常で合計を100にする", () => {
    const r = w({ rareMultiplier: 2.5 });
    expect(r["rare"]).toBeCloseTo(17.5, 10);
    expect(r["unique"]).toBeCloseTo(2, 10);
    expect(r["set"]).toBeCloseTo(0.5, 10);
    expect(r["magic"]).toBe(26);
    expect(r["normal"]).toBeCloseTo(100 - 26 - 17.5 - 2 - 0.5, 10);
  });

  it("発見率：希少は ×（1＋IF）、固有・星座は ×（1＋IF×200÷（IF＋200））", () => {
    const r = w({ findRate: 1 }); // IF 100%
    expect(r["rare"]).toBeCloseTo(14, 10);
    expect(r["unique"]).toBeCloseTo(0.8 * (1 + 2 / 3), 10); // +67%
    const r3 = w({ findRate: 3 }); // IF 300%：固有は +120%
    expect(r3["unique"]).toBeCloseTo(0.8 * 2.2, 10);
  });

  it("回廊の階層ボーナスは希少以上にかかる", () => {
    const r = w({ corridorBonus: 1.5 });
    expect(r["rare"]).toBeCloseTo(17.5, 10);
  });

  it("通常が0を下回る場合は、通常を0にして残りを比例で縮める", () => {
    const r = w({ rareMultiplier: 10, findRate: 2 }); // 希少 7×10×3＝210
    expect(r["normal"]).toBe(0);
    const total = Object.values(r).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(100, 10);
    const others = 26 + 210 + 0.8 * 10 * 2 + 0.2 * 10 * 2; // 固有・星座：IF 200% → ×2
    expect(r["magic"]).toBeCloseTo((26 * 100) / others, 10);
  });

  it("落とせないレアリティは0にして、手順4で通常に回す", () => {
    const r = w({ unavailable: new Set(["unique", "set"]) });
    expect(r).toEqual({ normal: 67, magic: 26, rare: 7, unique: 0, set: 0 });
  });

  it("希少以上だけ：通常・魔法を0にし、希少以上の比で100にする", () => {
    const r = w({ rareOrBetterOnly: true });
    expect(r["normal"]).toBe(0);
    expect(r["magic"]).toBe(0);
    expect(r["rare"]).toBeCloseTo(87.5, 10);
    expect(r["unique"]).toBeCloseTo(10, 10);
    expect(r["set"]).toBeCloseTo(2.5, 10);
  });

  it("補正が NaN・負・Infinity なら RangeError", () => {
    for (const bad of [Number.NaN, -1, Infinity]) {
      expect(() => w({ rareMultiplier: bad })).toThrow(RangeError);
      expect(() => w({ findRate: bad })).toThrow(RangeError);
      expect(() => w({ corridorBonus: bad })).toThrow(RangeError);
    }
  });
});

// ---------------------------------------------------------------------------

describe("アイテムの生成", () => {
  const prefixes = ["AFX-P1", "AFX-P2", "AFX-P3", "AFX-P4"];
  const suffixes = ["AFX-S1", "AFX-S2", "AFX-S3", "AFX-S4"];
  const d = db({
    itemBases: [
      weaponBase("BASE-W", { implicitEffects: ["EFF-IMP"] }),
      base("BASE-RING", "ring"),
      base("BASE-FEET", "feet"),
    ],
    affixes: [
      ...prefixes.map((id) => affix(id, "prefix", ["weapon", "ring"])),
      ...suffixes.map((id) => affix(id, "suffix", ["weapon", "ring"])),
      affix("AFX-RANGE", "prefix", ["weapon"], {
        effect: "EFF-A-RANGE",
        roll: "added",
        tiers: [
          { tier: 7, min: 1, max: 3 },
          { tier: 4, min: 6, max: 11 },
        ],
      }),
      affix("AFX-FEET", "suffix", ["feet"], {
        roll: "fixed",
        scale: 0.01,
        tiers: [
          { tier: 7, min: 10, max: 10 },
          { tier: 4, min: 15, max: 15 },
        ],
      }),
    ],
  });

  it("希少：詞の数は3〜6、部位の枠（前詞・後詞）を超えない。同じ詞は1つまで", () => {
    const rng = Rng.fromSeed("rare");
    const counts = new Set<number>();
    for (let i = 0; i < 3000; i++) {
      for (const b of ["BASE-W", "BASE-RING"]) {
        const item = generateItem(d, rng, {
          uid: `u${String(i)}`,
          base: getBase(d, b),
          rarity: "rare",
          itemLevel: 1 + (i % 40),
        });
        const slots = AFFIX_SLOTS[getBase(d, b).category];
        const pre = item.affixes.filter((a) => getAffix(d, a.id).position === "prefix").length;
        const suf = item.affixes.length - pre;
        expect(pre).toBeLessThanOrEqual(slots.prefix);
        expect(suf).toBeLessThanOrEqual(slots.suffix);
        expect(new Set(item.affixes.map((a) => a.id)).size).toBe(item.affixes.length);
        expect(item.affixes.length).toBeGreaterThanOrEqual(3);
        expect(item.affixes.length).toBeLessThanOrEqual(Math.min(6, slots.prefix + slots.suffix));
        if (b === "BASE-W") counts.add(item.affixes.length);
      }
    }
    expect([...counts].sort()).toEqual([3, 4, 5, 6]);
  });

  it("通常は詞なし、魔法は1〜2", () => {
    const rng = Rng.fromSeed("magic");
    for (let i = 0; i < 500; i++) {
      const w = getBase(d, "BASE-W");
      expect(
        generateItem(d, rng, { uid: "n", base: w, rarity: "normal", itemLevel: 5 }).affixes,
      ).toEqual([]);
      const m = generateItem(d, rng, { uid: "m", base: w, rarity: "magic", itemLevel: 5 });
      expect(m.affixes.length).toBeGreaterThanOrEqual(1);
      expect(m.affixes.length).toBeLessThanOrEqual(2);
    }
  });

  it("付けられる詞が足りないときは、付けられる数まで（足：詞は1種類だけ）", () => {
    const item = generateItem(d, Rng.fromSeed("feet"), {
      uid: "f",
      base: getBase(d, "BASE-FEET"),
      rarity: "rare",
      itemLevel: 1,
    });
    expect(item.affixes.map((a) => a.id)).toEqual(["AFX-FEET"]);
    expect(item.affixes[0]?.rolls).toEqual([10]);
  });

  it("部位に合わない詞は付かない", () => {
    expect(candidateAffixes(d, getBase(d, "BASE-RING"), 1).map((c) => c.affix.id)).not.toContain(
      "AFX-RANGE",
    );
  });

  it("tierは、アイテムLvで出現できるもので、最も高いtierがおよそ40%", () => {
    const rng = Rng.fromSeed("tiers");
    const seen = new Map<number, number>();
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const t = generateItem(d, rng, {
        uid: "t",
        base: getBase(d, "BASE-W"),
        rarity: "magic",
        itemLevel: 12,
      }).affixes[0]?.tier;
      if (t !== undefined) seen.set(t, (seen.get(t) ?? 0) + 1);
    }
    expect([...seen.keys()].sort()).toEqual([6, 7]);
    expect((seen.get(6) ?? 0) / n).toBeCloseTo(0.4, 1);
  });

  it("値：range は範囲の整数を1つ、added は最小・最大、fixed はtierの値", () => {
    const rng = Rng.fromSeed("values");
    const p1 = getAffix(d, "AFX-P1");
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const [v] = rollAffixValue(rng, p1, 7);
      expect(Number.isInteger(v)).toBe(true);
      seen.add(v ?? -1);
    }
    expect(Math.min(...seen)).toBe(10);
    expect(Math.max(...seen)).toBe(19);
    expect(seen.size).toBe(10);
    expect(rollAffixValue(rng, getAffix(d, "AFX-RANGE"), 6)).toEqual([3, 6]);
    expect(rollAffixValue(rng, getAffix(d, "AFX-FEET"), 6)).toEqual([12]); // 10＋5/3 → 12
    expect(() => rollAffixValue(rng, p1, 0)).toThrow(RangeError);
  });

  it("固有・星座・不正なアイテムLvは作らない（RangeError）", () => {
    const w = getBase(d, "BASE-W");
    const rng = Rng.fromSeed("x");
    expect(() =>
      generateItem(d, rng, { uid: "u", base: w, rarity: "unique", itemLevel: 1 }),
    ).toThrow(RangeError);
    expect(() => generateItem(d, rng, { uid: "u", base: w, rarity: "set", itemLevel: 1 })).toThrow(
      RangeError,
    );
    for (const bad of [0, 1.5, Number.NaN, -1])
      expect(() =>
        generateItem(d, rng, { uid: "u", base: w, rarity: "rare", itemLevel: bad }),
      ).toThrow(RangeError);
  });

  it("同じシードなら同じアイテム", () => {
    const make = () =>
      generateItem(d, Rng.fromSeed("same"), {
        uid: "s",
        base: getBase(d, "BASE-W"),
        rarity: "rare",
        itemLevel: 20,
      });
    expect(make()).toEqual(make());
  });

  it("効果：基本刻印と、詞（値を差し替え、scale を掛ける）。出どころは装備の uid", () => {
    const item = {
      uid: "itm_1",
      base: "BASE-W",
      rarity: "rare" as const,
      itemLevel: 12,
      affixes: [
        { id: "AFX-P1", tier: 7 as const, rolls: [15] },
        { id: "AFX-RANGE", tier: 6 as const, rolls: [3, 6] },
      ],
    };
    expect(itemEffectInstances(d, item)).toEqual([
      { effectId: "EFF-IMP", source: { kind: "equipment", ref: "itm_1" } },
      { effectId: "EFF-A-FLAT", source: { kind: "equipment", ref: "itm_1" }, values: [15] },
      {
        effectId: "EFF-A-RANGE",
        source: { kind: "equipment", ref: "itm_1" },
        values: [{ min: 3, max: 6 }],
      },
    ]);
  });
});

// ---------------------------------------------------------------------------

describe("アイテムのデータの検証", () => {
  it("詞の効果：存在しない・出どころが affix でない・修正値が2つ・roll と値の形が合わない", () => {
    const e = errors({
      effects: [
        effect("EFF-IMP", "implicit", [{ kind: "added", stat: "STAT-FLAT", value: 5 }]),
        effect("EFF-TWO", "affix", [
          { kind: "added", stat: "STAT-FLAT", value: 1 },
          { kind: "added", stat: "STAT-FLAT", value: 2 },
        ]),
        effect("EFF-FLAT", "affix", [{ kind: "added", stat: "STAT-FLAT", value: 1 }]),
      ],
      affixes: [
        affix("AFX-NONE", "prefix", ["weapon"], { effect: "EFF-NONE" }),
        affix("AFX-IMP", "prefix", ["weapon"], { effect: "EFF-IMP" }),
        affix("AFX-TWO", "prefix", ["weapon"], { effect: "EFF-TWO" }),
        affix("AFX-ADDED", "prefix", ["weapon"], { effect: "EFF-FLAT", roll: "added" }),
      ],
    });
    expect(e.some((x) => x.includes("AFX-NONE") && x.includes("unknown-ref"))).toBe(true);
    expect(e.some((x) => x.includes("AFX-IMP") && x.includes("affix ではない"))).toBe(true);
    expect(e.some((x) => x.includes("AFX-TWO") && x.includes("1つだけ"))).toBe(true);
    expect(e.some((x) => x.includes("AFX-ADDED") && x.includes("roll"))).toBe(true);
  });

  it("詞のtier：重複・並び・最小が最大を超える・fixed で幅がある", () => {
    const e = errors({
      affixes: [
        affix("AFX-DUP", "prefix", ["weapon"], {
          tiers: [
            { tier: 7, min: 1, max: 2 },
            { tier: 7, min: 1, max: 2 },
          ],
        }),
        affix("AFX-ORDER", "prefix", ["weapon"], {
          tiers: [
            { tier: 4, min: 1, max: 2 },
            { tier: 7, min: 1, max: 2 },
          ],
        }),
        affix("AFX-MINMAX", "prefix", ["weapon"], { tiers: [{ tier: 7, min: 3, max: 2 }] }),
        affix("AFX-FIXED", "prefix", ["weapon"], {
          roll: "fixed",
          tiers: [{ tier: 7, min: 1, max: 2 }],
        }),
      ],
    });
    for (const id of ["AFX-DUP", "AFX-ORDER", "AFX-MINMAX", "AFX-FIXED"])
      expect(
        e.some((x) => x.includes(id)),
        id,
      ).toBe(true);
  });

  it("ベース：武器の基礎性能の有無・基本刻印の出どころ・存在しないタグ", () => {
    const e = errors({
      itemBases: [
        base("BASE-NOWPN", "weapon"),
        weaponBase("BASE-RINGWPN", { category: "ring" }),
        weaponBase("BASE-BADIMP", { implicitEffects: ["EFF-A-FLAT"] }),
        weaponBase("BASE-BADTAG", { tags: ["TAG-NONE"] }),
      ],
    });
    for (const id of ["BASE-NOWPN", "BASE-RINGWPN", "BASE-BADIMP", "BASE-BADTAG"])
      expect(
        e.some((x) => x.includes(id)),
        id,
      ).toBe(true);
  });

  it("レアリティ・ドロップ：同じものが2つ・存在しない素材・系統のタグ・確定の数が最小を超える", () => {
    const drop = (id: string, extra: Record<string, unknown> = {}) => ({
      id,
      source: "elite",
      chance: 1,
      count: { min: 2, max: 4 },
      rareMultiplier: 2.5,
      guaranteedRareOrBetter: 0,
      itemLevelBonus: 2,
      materials: [],
      ...extra,
    });
    const e = errors({
      rarities: [...RARITIES, { ...RARITIES[0], id: "R-N2" }] as RarityDef[],
      materials: [{ id: "MAT-A", text: "m.a" }],
      dropProfiles: [
        drop("DROP-1", {
          materials: [
            { material: "MAT-NONE", chance: 0.1 },
            { material: "MAT-A", chance: 0.1, family: "TAG-WPN-SWORD" },
          ],
        }),
        drop("DROP-2"),
        drop("DROP-3", { source: "miniBoss", guaranteedRareOrBetter: 3 }),
        drop("DROP-4", { source: "magic", materials: [{ material: "MAT-A" }] }),
      ],
    });
    expect(e.some((x) => x.includes("R-N2") && x.includes("2つ"))).toBe(true);
    expect(e.some((x) => x.includes("DROP-1") && x.includes("MAT-NONE"))).toBe(true);
    expect(e.some((x) => x.includes("DROP-1") && x.includes("enemyFamily"))).toBe(true);
    expect(e.some((x) => x.includes("DROP-2") && x.includes("2つ"))).toBe(true);
    expect(e.some((x) => x.includes("DROP-3") && x.includes("確定"))).toBe(true);
    expect(e.some((x) => x.includes("DROP-4"))).toBe(true);
  });
});

describe("効果の値の差し替え（EffectInstance.values）", () => {
  const d = db({});
  const tags = new TagIndex(d.tags);
  const src = { kind: "equipment", ref: "itm" };
  it("差し替えた値で評価し、重ねた数も掛かる", () => {
    const { view } = evaluateEffects(d, tags, [
      { effectId: "EFF-A-FLAT", source: src, values: [7] },
      { effectId: "EFF-A-RANGE", source: src, values: [{ min: 3, max: 6 }], stacks: 2 },
    ]);
    expect(view.stat("STAT-FLAT").added).toEqual({ min: 7, max: 7 });
    expect(view.stat("STAT-RANGE").added).toEqual({ min: 6, max: 12 });
  });
  it("値の形が違う・範囲が逆・NaN・Infinity なら RangeError", () => {
    const bad =
      (values: (number | { min: number; max: number })[], effectId = "EFF-A-FLAT") =>
      () =>
        evaluateEffects(d, tags, [{ effectId, source: src, values }]);
    expect(bad([{ min: 1, max: 2 }])).toThrow(RangeError);
    expect(bad([3], "EFF-A-RANGE")).toThrow(RangeError);
    expect(bad([{ min: 5, max: 2 }], "EFF-A-RANGE")).toThrow(RangeError);
    expect(bad([Number.NaN])).toThrow(RangeError);
    expect(bad([Infinity])).toThrow(RangeError);
  });
});

describe("インベントリ（補助仕様書13章）", () => {
  const item = (uid: string) => ({
    uid,
    base: "BASE-W",
    rarity: "normal" as const,
    itemLevel: 1,
    affixes: [],
  });
  it("60枠。いっぱいなら入れずに false（状態は変わらない）", () => {
    const inv = new Inventory();
    expect(inv.capacity).toBe(INVENTORY_SLOTS);
    expect(INVENTORY_SLOTS).toBe(60);
    for (let i = 0; i < 60; i++) expect(inv.addItem(item(`u${String(i)}`))).toBe(true);
    expect(inv.full).toBe(true);
    expect(inv.addItem(item("over"))).toBe(false);
    expect(inv.items).toHaveLength(60);
    expect(inv.items.some((i) => i.uid === "over")).toBe(false);
  });
  it("同じ uid の装備は入れない（RangeError）", () => {
    const inv = new Inventory();
    inv.addItem(item("a"));
    expect(() => inv.addItem(item("a"))).toThrow(RangeError);
    expect(inv.items).toHaveLength(1);
  });
  it("金貨・素材は枠を使わない。不正な数は状態を変えずに RangeError", () => {
    const inv = new Inventory(0);
    inv.addGold(30);
    inv.addGold(12);
    inv.addMaterial("MAT-A", 2);
    inv.addMaterial("MAT-A", 1);
    expect(inv.gold).toBe(42);
    expect(inv.material("MAT-A")).toBe(3);
    expect(inv.material("MAT-B")).toBe(0);
    for (const bad of [-1, 1.5, Number.NaN, Infinity]) {
      expect(() => {
        inv.addGold(bad);
      }).toThrow(RangeError);
      expect(() => {
        inv.addMaterial("MAT-A", bad);
      }).toThrow(RangeError);
    }
    expect(() => {
      inv.addGold(Number.MAX_SAFE_INTEGER);
    }).toThrow(RangeError);
    expect(inv.gold).toBe(42);
    expect(inv.material("MAT-A")).toBe(3);
    expect(() => new Inventory(-1)).toThrow(RangeError);
  });
});
