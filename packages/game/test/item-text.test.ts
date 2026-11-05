import { describe, expect, it } from "vitest";
import {
  Character,
  Equipment,
  TagIndex,
  buildCharacterSheet,
  compareEquip,
  itemTooltip,
  sheetRows,
  skillContexts,
} from "@stella/core";
import { loadGameContent } from "@stella/content";
import {
  TEXT_COLOR,
  breakdownLines,
  comparisonLines,
  effectText,
  formatStatResult,
  sheetRowText,
  tooltipLines,
} from "../src/ui/item-text.ts";

const db = loadGameContent();
const tags = new TagIndex(db.tags);
const WARRIOR = db.jobs.get("JOB-WARRIOR");
if (WARRIOR === undefined) throw new Error("戦士が無い");
const sword = {
  uid: "sw",
  base: "BASE-WPN-LONGSWORD-T1",
  rarity: "magic" as const,
  itemLevel: 3,
  affixes: [
    { id: "AFX-PRE-INC-PHYSICAL-WPN", tier: 7 as const, rolls: [12] },
    { id: "AFX-PRE-ADDED-PHYSICAL-WPN", tier: 7 as const, rolls: [1, 3] },
  ],
};

describe("表示の文章（U-12 の画面）", () => {
  it("効果の説明：値の単位（率は%・範囲は最小–最大・増加は（増加））", () => {
    expect(effectText(db, "EFF-IMP-ACCURACY-40")).toBe("命中 +40");
    expect(effectText(db, "EFF-AFX-INC-PHYSICAL-LOCAL", [0.12])).toBe("物理 ダメージ +12%（増加）");
    expect(effectText(db, "EFF-AFX-ADDED-PHYSICAL", [{ min: 1, max: 3 }])).toBe(
      "物理ダメージ追加 +1–3",
    );
  });

  it("ツールチップ：名前はレアリティの色、要求値の未達は赤、タグが一致する詞は★で光る", () => {
    const tip = itemTooltip(db, sword, {
      attributes: { go: 5, jin: 10, ri: 5, kon: 5 },
      characterLevel: 1,
      contexts: skillContexts(db, tags, [["TAG-FORM-MELEE"]], ["TAG-WPN-SWORD"]),
    });
    const lines = tooltipLines(db, tip);
    expect(lines[0]?.text).toBe("下級の長剣");
    expect(lines.some((l) => l.text.includes("未達") && l.color === TEXT_COLOR.bad)).toBe(true);
    const inc = lines.find((l) => l.text.includes("ダメージ +12%"));
    expect(inc?.text.startsWith("★")).toBe(true);
    expect(inc?.color).toBe(TEXT_COLOR.highlight);
    expect(inc?.text).toContain("［この武器］");
    expect(lines.some((l) => l.text.startsWith("基本刻印：命中 +40"))).toBe(true);
  });

  it("比較：攻撃の毎秒ダメージと能力値の変化を、良くなるものは緑・悪くなるものは赤で出す", () => {
    const character = new Character({ origin: WARRIOR, level: 5 });
    const equipment = new Equipment(db);
    equipment.equip(
      { uid: "gs", base: "BASE-WPN-GREATSWORD-T1", rarity: "normal", itemLevel: 1, affixes: [] },
      "mainHand",
      true,
    );
    const cmp = compareEquip(db, tags, { character, job: WARRIOR, equipment }, sword, "mainHand", {
      canDualWield: true,
      skill: { tags: ["TAG-FORM-MELEE"], kind: "weapon", pct: 1 },
    });
    const lines = comparisonLines(db, cmp);
    expect(lines[0]?.text).toBe("外れる：下級の大剣");
    expect(lines.find((l) => l.text.startsWith("命中"))?.color).toBe(TEXT_COLOR.good);
    expect(lines.find((l) => l.text.includes("崩し値"))?.color).toBe(TEXT_COLOR.bad);
    expect(lines.some((l) => l.text.startsWith("通常攻撃の毎秒ダメージ"))).toBe(true);
  });

  it("キャラクターの画面：行の値と、出どころごとの内訳（装備は装備の名前）", () => {
    const character = new Character({ origin: WARRIOR, level: 5 });
    const equipment = new Equipment(db);
    equipment.equip(sword, "mainHand", true);
    const sheet = buildCharacterSheet(db, tags, { character, job: WARRIOR, equipment });
    const rows = sheetRows(db, sheet);
    const acc = rows.find((r) => r.stat === "STAT-ACCURACY");
    if (acc === undefined) throw new Error("命中の行が無い");
    expect(sheetRowText(db, acc)).toBe(`命中  ${String(acc.value)}`);
    const lines = breakdownLines(
      db,
      acc,
      (uid) => equipment.entries().find(([, i]) => i.uid === uid)?.[1],
    );
    expect(lines.map((l) => l.text)).toContain("下級の長剣：+40");
    expect(lines.some((l) => l.text.startsWith("基礎 10"))).toBe(true);
    expect(lines.some((l) => l.text.startsWith("能力値「迅」"))).toBe(true);
    const dmg = rows.find((r) => r.stat === "STAT-DAMAGE");
    if (dmg === undefined) throw new Error("ダメージの行が無い");
    expect(formatStatResult(db, dmg.result)).toBe("増加 +12%");
    const local = breakdownLines(db, dmg, () => sword);
    expect(local[0]?.text).toBe("下級の長剣：+12%（増加）［その武器のヒットだけ］");
    expect(local[0]?.color).toBe(TEXT_COLOR.local);
  });
});
