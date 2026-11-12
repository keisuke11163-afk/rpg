/**
 * アイテムのデータ（U-11）が、仕様のとおりに働くかを確かめる。
 * 開発計画書のテスト T12（100万回の抽選で、レアリティの割合が仕様書3.5の範囲に入る／
 * ジョブに合わせたドロップが35%前後）と、詞の枠が部位の上限を超えないことを含む。
 */
import {
  AFFIX_SLOTS,
  type ContentDb,
  type ItemRarity,
  Rng,
  TagIndex,
  affixTierValues,
  dropItemLevel,
  evaluateEffects,
  generateItem,
  itemEffectInstances,
  rarityWeights,
  rollDrops,
  rollRarity,
  weaponAffinity,
} from "@stella/core";
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../src/index.ts";

const db: ContentDb = loadGameContent();
const tags = new TagIndex(db.tags);
const job = (id: string) => {
  const j = db.jobs.get(id);
  if (j === undefined) throw new Error(`${id} がない`);
  return j;
};
const affix = (id: string) => {
  const a = db.affixes.get(id);
  if (a === undefined) throw new Error(`${id} がない`);
  return a;
};
let uidCounter = 0;
const nextUid = (): string => `itm_${String(++uidCounter)}`;

/** 二項分布の標準偏差の5倍（100万回で、偶然に外れる確率は約100万分の1以下）。 */
const tolerance = (p: number, n: number): number => 5 * Math.sqrt((p * (1 - p)) / n);

describe("T12：レアリティの抽選（100万回）", () => {
  it("補正なし：データの重みどおりの割合になる（仕様書v0.2 3.5 は 66／26／7／0.8／0.2。希少は D-FIN-2 で9）", () => {
    const rng = Rng.fromSeed("T12-rarity");
    const n = 1_000_000;
    const counts = new Map<ItemRarity, number>();
    for (let i = 0; i < n; i++) {
      const r = rollRarity(rng, { rarities: db.rarities });
      counts.set(r, (counts.get(r) ?? 0) + 1);
    }
    const weights = rarityWeights({ rarities: db.rarities });
    expect(Object.fromEntries(weights)).toEqual({
      normal: 64, // 合計が100になるように、通常が残りを受け持つ（rarityWeights）
      magic: 26,
      rare: 9,
      unique: 0.8,
      set: 0.2,
    });
    const total = [...weights.values()].reduce((a, w) => a + w, 0);
    for (const [rarity, w] of weights) {
      const p = w / total;
      const actual = (counts.get(rarity) ?? 0) / n;
      expect(Math.abs(actual - p), `${rarity}: ${String(actual)}`).toBeLessThan(tolerance(p, n));
    }
  });

  it("精鋭（希少以上×2.5）：重みどおりの割合になる", () => {
    const rng = Rng.fromSeed("T12-elite");
    const n = 1_000_000;
    const input = { rarities: db.rarities, rareMultiplier: 2.5 };
    const weights = rarityWeights(input);
    const counts = new Map<ItemRarity, number>();
    for (let i = 0; i < n; i++) {
      const r = rollRarity(rng, input);
      counts.set(r, (counts.get(r) ?? 0) + 1);
    }
    expect(weights.get("rare")).toBeCloseTo(22.5, 10);
    const total = [...weights.values()].reduce((a, w) => a + w, 0);
    for (const [rarity, w] of weights) {
      const p = w / total;
      expect(Math.abs((counts.get(rarity) ?? 0) / n - p), rarity).toBeLessThan(tolerance(p, n));
    }
  });
});

describe("T12：ジョブに合わせたドロップ（35%）", () => {
  it("戦士：35%前後が、戦士の適性がA以上の武器になる", () => {
    const rng = Rng.fromSeed("T12-job");
    const warrior = job("JOB-WARRIOR");
    let items = 0;
    let targeted = 0;
    for (let i = 0; i < 20_000; i++) {
      const r = rollDrops(db, rng, {
        source: "elite",
        enemyLevel: 5,
        mainJob: warrior,
        tags,
        nextUid,
      });
      r.items.forEach((item, k) => {
        // ユニークはジョブに合わせない（ベースを選ばない）ので、割合の分母から除く
        if (item.rarity === "unique") return;
        items += 1;
        if (r.jobTargeted[k] === true) {
          targeted += 1;
          const base = db.itemBases.get(item.base);
          expect(base?.category).toBe("weapon");
          const a = weaponAffinity(tags, warrior, base?.tags ?? []);
          expect(["S", "A"]).toContain(a);
        }
      });
    }
    expect(Math.abs(targeted / items - 0.35)).toBeLessThan(tolerance(0.35, items));
  });

  it("盗賊：短剣・爪だけに寄る（盗賊の適性がA以上の武器）", () => {
    const rng = Rng.fromSeed("T12-rogue");
    const rogue = job("JOB-ROGUE");
    const seen = new Set<string>();
    for (let i = 0; i < 3000; i++) {
      const r = rollDrops(db, rng, {
        source: "elite",
        enemyLevel: 5,
        mainJob: rogue,
        tags,
        nextUid,
      });
      r.items.forEach((item, k) => {
        if (r.jobTargeted[k] === true) seen.add(item.base);
      });
    }
    for (const id of seen) {
      const base = db.itemBases.get(id);
      expect(["S", "A"]).toContain(weaponAffinity(tags, rogue, base?.tags ?? []));
    }
    expect(seen.size).toBeGreaterThan(0);
  });
});

describe("詞の枠：部位の上限を超えない", () => {
  it("全てのベース × 希少 × アイテムLv1〜25", () => {
    const rng = Rng.fromSeed("slots");
    for (const base of db.itemBases.values()) {
      const slots = AFFIX_SLOTS[base.category];
      for (let i = 0; i < 2000; i++) {
        const item = generateItem(db, rng, {
          uid: "x",
          base,
          rarity: "rare",
          itemLevel: 1 + (i % 25),
        });
        const pre = item.affixes.filter((a) => affix(a.id).position === "prefix").length;
        expect(pre).toBeLessThanOrEqual(slots.prefix);
        expect(item.affixes.length - pre).toBeLessThanOrEqual(slots.suffix);
        expect(item.affixes.length).toBeLessThanOrEqual(6);
        for (const a of item.affixes) expect(affix(a.id).categories).toContain(base.category);
        // MVP：T7（iLv1〜11）・T6（12〜24）・T5（25）
        const maxTier = item.itemLevel >= 25 ? 5 : item.itemLevel >= 12 ? 6 : 7;
        for (const a of item.affixes) expect(a.tier).toBeGreaterThanOrEqual(maxTier);
      }
    }
  });
});

describe("詞のデータ（仕様書v0.2 3.6）", () => {
  it("T6 は T7 と T4 の間を補い、端数は切り上げる", () => {
    expect(affixTierValues(affix("AFX-PRE-ADDED-PHYSICAL-WPN")).get(6)).toEqual({ min: 3, max: 6 });
    expect(affixTierValues(affix("AFX-PRE-ADDED-FIRE-WPN")).get(6)).toEqual({ min: 3, max: 7 });
    expect(affixTierValues(affix("AFX-PRE-INC-PHYSICAL-WPN")).get(6)).toEqual({ min: 20, max: 31 });
    expect(affixTierValues(affix("AFX-SUF-MOVE-SPEED")).get(6)).toEqual({ min: 12, max: 12 });
    // T5（深淵の母樹のドロップ iLv25）
    expect(affixTierValues(affix("AFX-PRE-HP-MAX")).get(5)).toEqual({ min: 37, max: 53 });
  });

  it("詞の効果：値を差し替えて評価できる（物理ダメージ追加は、その武器のヒットだけに効く）", () => {
    const item = {
      uid: "itm_w",
      base: "BASE-WPN-LONGSWORD-T1",
      rarity: "magic" as const,
      itemLevel: 12,
      affixes: [
        { id: "AFX-PRE-ADDED-PHYSICAL-WPN", tier: 6 as const, rolls: [3, 6] },
        { id: "AFX-SUF-ATTACK-SPEED", tier: 7 as const, rolls: [4] },
      ],
    };
    const { view } = evaluateEffects(db, tags, itemEffectInstances(db, item));
    const added = view.stat("STAT-ADDED-PHYSICAL");
    expect(added.added).toEqual({ min: 3, max: 6 });
    expect(added.contributions[0]?.source).toEqual({ kind: "equipment", ref: "itm_w" });
    expect(view.stat("STAT-ATTACK-SPEED").increased).toBeCloseTo(0.04, 10);
    // 長剣の基本刻印：命中+40
    expect(view.stat("STAT-ACCURACY").added).toEqual({ min: 40, max: 40 });
  });
});

describe("ドロップ（仕様書v0.2 3.5、補助仕様書5・12章）", () => {
  it("アイテムLv：通常・魔法は敵のLv、精鋭+2、中ボス・章ボス+4", () => {
    expect(dropItemLevel(db, "normal", 7)).toBe(7);
    expect(dropItemLevel(db, "magic", 7)).toBe(7);
    expect(dropItemLevel(db, "elite", 7)).toBe(9);
    expect(dropItemLevel(db, "miniBoss", 11)).toBe(15);
    expect(() => dropItemLevel(db, "elite", 0)).toThrow(RangeError);
    expect(dropItemLevel(db, "chapterBoss", 14)).toBe(18);
    // 深淵の母樹（Lv21）は iLv25（補助仕様書11.2：MVPでT5の詞が出る唯一の入手先）
    expect(dropItemLevel(db, "abyssBoss", 21)).toBe(25);
  });

  it("ドロップの数：通常は10%で1個、魔法は60%で1〜2個、精鋭は必ず2〜4個", () => {
    const rng = Rng.fromSeed("counts");
    const n = 50_000;
    const stats = (source: "normal" | "magic" | "elite") => {
      let dropped = 0;
      const sizes = new Set<number>();
      for (let i = 0; i < n; i++) {
        const r = rollDrops(db, rng, { source, enemyLevel: 3, tags, nextUid });
        if (r.items.length > 0) {
          dropped += 1;
          sizes.add(r.items.length);
        }
      }
      return { rate: dropped / n, sizes: [...sizes].sort() };
    };
    const normal = stats("normal");
    expect(Math.abs(normal.rate - 0.1)).toBeLessThan(tolerance(0.1, n));
    expect(normal.sizes).toEqual([1]);
    const magic = stats("magic");
    expect(Math.abs(magic.rate - 0.6)).toBeLessThan(tolerance(0.6, n));
    expect(magic.sizes).toEqual([1, 2]);
    const elite = stats("elite");
    expect(elite.rate).toBe(1);
    expect(elite.sizes).toEqual([2, 3, 4]);
  });

  it("中ボス：4〜6個で、希少以上が必ず1個以上。還星の灯・目覚めの粉は1個確定", () => {
    const rng = Rng.fromSeed("miniboss");
    for (let i = 0; i < 2000; i++) {
      const r = rollDrops(db, rng, { source: "miniBoss", enemyLevel: 11, tags, nextUid });
      expect(r.items.length).toBeGreaterThanOrEqual(4);
      expect(r.items.length).toBeLessThanOrEqual(6);
      expect(r.items.some((x) => x.rarity === "rare" || x.rarity === "unique")).toBe(true);
      // 確定の分は希少か固有（星座はMVPの範囲外）
      expect(["rare", "unique"]).toContain(r.items[0]?.rarity);
      expect(r.materials).toContainEqual({ material: "MAT-RETURN-LAMP", count: 1 });
      expect(r.materials).toContainEqual({ material: "MAT-AWAKENING-DUST", count: 1 });
      expect(r.itemLevel).toBe(15);
      expect(r.gold).toBe(0);
    }
  });

  it("ユニーク：必要LvがアイテムLv以下の「どこでも」のものだけ落ちる。専用のものと星座は落ちない（U-16）", () => {
    const rng = Rng.fromSeed("uniques");
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i++) {
      const r = rollDrops(db, rng, { source: "elite", enemyLevel: 5, tags, nextUid });
      for (const item of r.items) {
        expect(item.rarity).not.toBe("set");
        if (item.rarity !== "unique") {
          expect(db.itemBases.get(item.base)?.unique).toBeUndefined();
          continue;
        }
        const base = db.itemBases.get(item.base);
        expect(base?.unique?.source).toBe("anywhere");
        expect(base?.requiredLevel ?? 99).toBeLessThanOrEqual(r.itemLevel);
        expect(item.affixes).toEqual([]);
        seen.add(item.base);
      }
    }
    // アイテムLv7（精鋭Lv5）で落ちるのは、旅人の古靴（Lv2）・狼牙の首飾り（Lv6）・二股の枝（Lv4）
    expect([...seen].sort()).toEqual(["BASE-UNQ-U02", "BASE-UNQ-U14", "BASE-UNQ-U17"]);
    // ユニークの無いアイテムLvでは、ユニークの重みは通常に回る
    const low = Rng.fromSeed("low");
    for (let i = 0; i < 5000; i++)
      for (const item of rollDrops(db, low, { source: "normal", enemyLevel: 1, tags, nextUid })
        .items)
        expect(item.rarity).not.toBe("unique");
  });

  it("金貨：通常は25%で（1＋Lv）〜2×（1＋Lv）、魔法は60%で2倍、精鋭は必ず5倍", () => {
    const rng = Rng.fromSeed("gold");
    const n = 40_000;
    const run = (source: "normal" | "magic" | "elite", mult: number, p: number) => {
      let got = 0;
      for (let i = 0; i < n; i++) {
        const { gold } = rollDrops(db, rng, { source, enemyLevel: 9, tags, nextUid });
        if (gold > 0) {
          got += 1;
          expect(gold % mult).toBe(0);
          expect(gold / mult).toBeGreaterThanOrEqual(10);
          expect(gold / mult).toBeLessThanOrEqual(20);
        }
      }
      expect(Math.abs(got / n - p)).toBeLessThan(tolerance(p, n) + 1e-12);
    };
    run("normal", 1, 0.25);
    run("magic", 2, 0.6);
    run("elite", 5, 1);
  });

  it("素材：獣牙は獣系の敵だけ（3%）。目覚めの粉は通常1%・精鋭20%", () => {
    const rng = Rng.fromSeed("materials");
    const n = 100_000;
    const count = (source: "normal" | "elite", family: string | undefined, material: string) => {
      let c = 0;
      for (let i = 0; i < n; i++) {
        const r = rollDrops(db, rng, {
          source,
          enemyLevel: 3,
          ...(family === undefined ? {} : { enemyFamily: family }),
          tags,
          nextUid,
        });
        if (r.materials.some((m) => m.material === material)) c += 1;
      }
      return c / n;
    };
    expect(Math.abs(count("normal", "TAG-FAMILY-BEAST", "MAT-BEAST-FANG") - 0.03)).toBeLessThan(
      tolerance(0.03, n),
    );
    expect(count("normal", undefined, "MAT-BEAST-FANG")).toBe(0);
    expect(count("normal", "TAG-FAMILY-UNDEAD", "MAT-BEAST-FANG")).toBe(0);
    expect(Math.abs(count("normal", undefined, "MAT-AWAKENING-DUST") - 0.01)).toBeLessThan(
      tolerance(0.01, n),
    );
    expect(Math.abs(count("elite", undefined, "MAT-AWAKENING-DUST") - 0.2)).toBeLessThan(
      tolerance(0.2, n),
    );
  });

  it("同じシードなら同じドロップ", () => {
    const make = () => {
      let k = 0;
      return rollDrops(db, Rng.fromSeed("same-drop"), {
        source: "elite",
        enemyLevel: 8,
        mainJob: job("JOB-WARRIOR"),
        tags,
        nextUid: () => `u${String(++k)}`,
      });
    };
    expect(make()).toEqual(make());
  });
});
