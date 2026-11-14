import { describe, expect, it } from "vitest";
import { type GaugeDef, JobGauge, gaugeSchema } from "../src/index.ts";

/** 位相の遷移表（魔法使い。仕様書v0.2 5.4・D-MAG-1〜3）。データと同じ形の、試験用の定義。 */
const PHASE: GaugeDef = gaugeSchema.parse({
  id: "GAU-TEST-PHASE",
  text: "gauge.phase",
  max: 3,
  gains: [],
  decayOutOfCombat: 0,
  stages: [],
  phase: {
    elements: ["fire", "cold", "lightning"],
    transitions: [
      { input: "first", add: 1 },
      { input: "same", add: 0 },
      { input: "different", add: 1 },
    ],
    neutral: "ignore",
    fusion: {
      at: 3,
      after: 0,
      excludeTags: ["TAG-FORM-AREA"],
      table: [
        {
          id: "steam",
          text: "gauge.phase.steam",
          elements: ["fire", "cold"],
          mods: { pctMultiplier: 1.8 },
        },
      ],
    },
  },
});

describe("位相（魔法使いの職能ゲージ）の遷移", () => {
  it("違う属性の呪文で+1。同じ属性を続けても増えない。最初の呪文も+1（D-MAG-1）", () => {
    const g = new JobGauge(PHASE);
    expect(g.onSpellCast("fire")).toBe(1);
    expect(g.onSpellCast("fire")).toBe(0);
    expect(g.value).toBe(1);
    expect(g.onSpellCast("cold")).toBe(1);
    expect(g.onSpellCast("cold")).toBe(0);
    expect(g.value).toBe(2);
    expect(g.onSpellCast("fire")).toBe(1);
    expect(g.value).toBe(3);
  });

  it("位相は最大値（3）で止まる", () => {
    const g = new JobGauge(PHASE);
    g.onSpellCast("fire");
    g.onSpellCast("lightning");
    g.onSpellCast("cold");
    g.onSpellCast("lightning");
    g.onSpellCast("fire");
    expect(g.value).toBe(3);
  });

  it("属性を持たない呪文（瞬移・魔法障壁）は、位相も直前の属性も変えない（D-MAG-2）", () => {
    const g = new JobGauge(PHASE);
    g.onSpellCast("fire");
    expect(g.onSpellCast(undefined)).toBe(0);
    expect(g.value).toBe(1);
    expect(g.onSpellCast("fire")).toBe(0); // 直前はまだ火
    expect(g.onSpellCast("cold")).toBe(1);
  });

  it("neutral が reset なら、属性を持たない呪文で位相が開始の量に戻る", () => {
    const g = new JobGauge(
      gaugeSchema.parse({ ...PHASE, phase: { ...PHASE.phase, neutral: "reset" } }),
    );
    g.onSpellCast("fire");
    g.onSpellCast("cold");
    g.onSpellCast(undefined);
    expect(g.value).toBe(0);
  });

  it("直前の2つの属性（順不同）が表にあり、位相が3なら、合成魔法に変わる。使うと位相は0に戻る", () => {
    const g = new JobGauge(PHASE);
    g.onSpellCast("fire");
    g.onSpellCast("cold");
    expect(g.fusion).toBeUndefined(); // 位相2
    g.onSpellCast("fire");
    expect(g.value).toBe(3);
    expect(g.fusion?.id).toBe("steam"); // 直前の2つは 氷・火
    expect(g.stages).toEqual(["steam"]);
    g.useFusion();
    expect(g.value).toBe(0);
    expect(g.fusion).toBeUndefined();
    expect(g.onSpellCast("lightning")).toBe(1); // 直前の属性は忘れる（最初の呪文）
  });

  it("表に無い組み合わせ（氷＋雷）では、合成魔法にならず、位相は3のまま。次の呪文で組み合わせが変わる", () => {
    const g = new JobGauge(PHASE);
    g.onSpellCast("fire");
    g.onSpellCast("cold");
    g.onSpellCast("lightning");
    expect(g.value).toBe(3);
    expect(g.fusion).toBeUndefined();
    g.onSpellCast("cold"); // 直前の2つは 雷・氷
    expect(g.fusion).toBeUndefined();
    g.onSpellCast("fire"); // 氷・火
    expect(g.fusion?.id).toBe("steam");
  });

  it("除く印のある呪文（隕星：範囲）・属性を持たない呪文は、合成魔法に変わらない", () => {
    const g = new JobGauge(PHASE);
    g.onSpellCast("fire");
    g.onSpellCast("cold");
    g.onSpellCast("fire");
    expect(g.fusionFor(["TAG-FORM-SPELL", "TAG-ELEM-COLD"])?.id).toBe("steam");
    // 組み合わせと関係のない属性（雷）の呪文は変えない（D-MAG-4）
    expect(g.fusionFor(["TAG-FORM-SPELL", "TAG-ELEM-LIGHTNING"])).toBeUndefined();
    expect(g.fusionFor(["TAG-FORM-SPELL", "TAG-FORM-AREA", "TAG-ELEM-FIRE"])).toBeUndefined();
    expect(g.fusionFor(["TAG-FORM-SPELL", "TAG-FORM-MOVEMENT"])).toBeUndefined();
  });

  it("開始の量（職詞「位相を1から開始する」）：戦闘外は開始の量。戦闘外になると開始の量に戻る（D-MAG-3）", () => {
    const g = new JobGauge(PHASE);
    expect(g.value).toBe(0);
    g.startValue = 1;
    expect(g.value).toBe(1);
    g.onSpellCast("fire"); // 戦闘中（直前なし）
    g.onSpellCast("cold");
    expect(g.value).toBe(3);
    g.update(4.9);
    expect(g.value).toBe(3);
    g.update(0.2); // 5秒間、攻撃も被弾も無い
    expect(g.value).toBe(1);
    expect(g.fusion).toBeUndefined();
    // 直前の属性も忘れた：氷（さっきの直前）が「最初の呪文」として+1になる。覚えていれば「同じ属性」で増えない
    expect(g.onSpellCast("cold")).toBe(1);
    expect(g.value).toBe(2);
  });

  it("位相の仕組みを持たないゲージ（戦士など）では、呪文を使っても位相が動かない。サブジョブはメインジョブのゲージを受け継がないので、サブジョブの魔法使いの技では位相は溜まらない", () => {
    const warrior = gaugeSchema.parse({
      id: "GAU-TEST-FERVOR",
      text: "gauge.fervor",
      max: 100,
      gains: [],
      decayOutOfCombat: 5,
      stages: [],
    });
    const g = new JobGauge(warrior);
    expect(g.onSpellCast("fire")).toBe(0);
    expect(g.onSpellCast("cold")).toBe(0);
    expect(g.value).toBe(0);
    expect(g.fusion).toBeUndefined();
    g.startValue = 1; // 位相の仕組みが無ければ、開始の量も効かない
    expect(g.value).toBe(0);
  });
});
