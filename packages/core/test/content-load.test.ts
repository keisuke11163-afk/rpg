import { describe, expect, it } from "vitest";
import { type ContentErrorCode, type RawContent, loadContent } from "../src/index.ts";

/**
 * 正しい最小のデータ一式。各テストで一部を壊して使う。
 * 壊しやすいように、要素を名前付きで返す（raw の配列は同じ要素を参照している）。
 */
function fixture() {
  const melee: Record<string, unknown> = {
    id: "TAG-FORM-MELEE",
    category: "form",
    text: "tag.form.melee",
  };
  const swordGroup: Record<string, unknown> = {
    id: "TAG-WPNGRP-SWORD",
    category: "weaponGroup",
    text: "tag.weapon-group.sword",
  };
  const greatsword: Record<string, unknown> = {
    id: "TAG-WPN-GREATSWORD",
    category: "weapon",
    text: "tag.weapon.greatsword",
    parents: ["TAG-WPNGRP-SWORD"],
  };
  const damage: Record<string, unknown> = { id: "STAT-DAMAGE", text: "stat.damage", unit: "ratio" };
  const modifier: Record<string, unknown> = {
    kind: "more",
    stat: "STAT-DAMAGE",
    value: 1.6,
    filter: { allOf: ["TAG-FORM-MELEE"] },
  };
  const effect: Record<string, unknown> = {
    id: "EFF-TEST-KEYSTONE",
    origin: "keystone",
    modifiers: [modifier],
    affects: { hit: true, ailmentBase: true },
    scope: "self",
    provisional: true,
    provisionalNote: "BL-2で調整",
  };
  const manifest = {
    file: "data/manifest.json",
    value: { schemaVersion: 1, contentVersion: "0.1.0" } as unknown,
  };
  const tags: unknown[] = [melee, swordGroup, greatsword];
  const stats: unknown[] = [damage];
  const effects: unknown[] = [effect];
  const raw: RawContent = {
    manifest,
    texts: {
      "tag.form.melee": "近接",
      "tag.weapon.greatsword": "大剣",
      "tag.weapon-group.sword": "剣系",
      "stat.damage": "ダメージ",
    },
    collections: {
      tags: [{ file: "data/tags/t.json", entries: tags }],
      stats: [{ file: "data/stats/s.json", entries: stats }],
      effects: [{ file: "data/effects/e.json", entries: effects }],
    },
  };
  return { raw, manifest, melee, swordGroup, greatsword, damage, modifier, effect, stats, effects };
}

function codes(raw: RawContent): ContentErrorCode[] {
  const r = loadContent(raw);
  return r.ok ? [] : r.errors.map((e) => e.code);
}

function overrideEffect(id: string, priority: number): Record<string, unknown> {
  return {
    id,
    origin: "unique",
    modifiers: [{ kind: "override", stat: "STAT-DAMAGE", value: 0, priority }],
    affects: { hit: true, ailmentBase: false },
    scope: "self",
  };
}

describe("loadContent", () => {
  it("正しいデータは読み込める", () => {
    const r = loadContent(fixture().raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content.tags.size).toBe(3);
    expect(r.content.effects.get("EFF-TEST-KEYSTONE")?.origin).toBe("keystone");
  });

  it("仮値の一覧を出す", () => {
    const r = loadContent(fixture().raw);
    expect(r.ok && r.provisional).toEqual([
      {
        collection: "effects",
        id: "EFF-TEST-KEYSTONE",
        file: "data/effects/e.json",
        note: "BL-2で調整",
      },
    ]);
  });

  it("存在しないタグの参照を検出する", () => {
    const f = fixture();
    f.modifier["filter"] = { anyOf: ["TAG-NOPE"] };
    expect(codes(f.raw)).toEqual(["unknown-ref"]);
  });

  it("存在しない能力値・親タグ・文章のキーの参照を検出する", () => {
    const f = fixture();
    f.modifier["stat"] = "STAT-NOPE";
    f.greatsword["parents"] = ["TAG-NOPE"];
    f.damage["text"] = "stat.nope";
    expect(codes(f.raw).sort()).toEqual(["unknown-ref", "unknown-ref", "unknown-text"]);
  });

  it("範囲外の値を検出する", () => {
    const f = fixture();
    f.modifier["value"] = -2; // 乗算は正の数
    expect(codes(f.raw)).toContain("schema");
  });

  it("IDの重複を検出する（コレクションをまたいでも）", () => {
    const f = fixture();
    f.stats.push({ id: "TAG-FORM-MELEE", text: "stat.damage", unit: "flat" });
    expect(codes(f.raw)).toEqual(["duplicate-id"]);
  });

  it("IDの形の誤りを検出する", () => {
    const f = fixture();
    f.melee["id"] = "tag-form-melee";
    expect(codes(f.raw)).toContain("schema");
  });

  it("形の誤りがある要素を参照しても、同じ原因の誤りを重ねて出さない", () => {
    const f = fixture();
    f.melee["category"] = "nope";
    expect(codes(f.raw)).toEqual(["schema"]);
  });

  it("IDそのものが変わった場合は、参照する側も誤りになる", () => {
    const f = fixture();
    f.melee["id"] = "TAG-FORM-MELE";
    expect(codes(f.raw)).toEqual(["unknown-ref"]);
  });

  it("知らない項目（綴りの誤り）を検出する", () => {
    const f = fixture();
    f.melee["parnets"] = [];
    expect(codes(f.raw)).toEqual(["schema"]);
  });

  it("乗算を持てない出どころの乗算を検出する（仕様書v0.2 2.4）", () => {
    for (const origin of [
      "minorStar",
      "notableStar",
      "affix",
      "constellation",
      "implicit",
      "set",
    ]) {
      const f = fixture();
      f.effect["origin"] = origin;
      expect(codes(f.raw)).toEqual(["forbidden-more"]);
    }
  });

  it("乗算を持てる出どころでは誤りにしない", () => {
    for (const origin of [
      "keystone",
      "unique",
      "uniqueLatent",
      "jobSkill",
      "jobMastery",
      "setMax",
      "ailment",
    ]) {
      const f = fixture();
      f.effect["origin"] = origin;
      expect(codes(f.raw)).toEqual([]);
    }
  });

  it("転変ノードは減らす方向（1未満）の乗算だけを持てる", () => {
    const f = fixture();
    f.effect["origin"] = "mutation";
    expect(codes(f.raw)).toEqual(["forbidden-more"]);
    f.modifier["value"] = 0.8;
    expect(codes(f.raw)).toEqual([]);
  });

  it("同じ能力値・同じ優先度の上書きを検出する（仕様書v0.2 2.4.1）", () => {
    const f = fixture();
    const second = overrideEffect("EFF-B", 10);
    f.effects.push(overrideEffect("EFF-A", 10), second);
    expect(codes(f.raw)).toEqual(["override-conflict"]);
    second["modifiers"] = [{ kind: "override", stat: "STAT-DAMAGE", value: 0, priority: 20 }];
    expect(codes(f.raw)).toEqual([]);
  });

  describe("上書きの重複（同じ効果の中も含む）", () => {
    function withOverrides(
      ...effects: { id: string; modifiers: Record<string, unknown>[] }[]
    ): RawContent {
      const f = fixture();
      f.stats.push({ id: "STAT-SPEED", text: "stat.damage", unit: "ratio" });
      for (const e of effects) {
        f.effects.push({
          id: e.id,
          origin: "unique",
          modifiers: e.modifiers,
          affects: { hit: true, ailmentBase: false },
          scope: "self",
        });
      }
      return f.raw;
    }
    const ov = (stat: string, value: number, priority: number): Record<string, unknown> => ({
      kind: "override",
      stat,
      value,
      priority,
    });

    it("同じ効果の中・同じ能力値・同じ優先度は誤り（重複した修正値の位置を示す）", () => {
      const r = loadContent(
        withOverrides({
          id: "EFF-A",
          modifiers: [ov("STAT-DAMAGE", 10, 5), ov("STAT-DAMAGE", 20, 5)],
        }),
      );
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors).toHaveLength(1);
      const [e] = r.errors;
      expect(e?.code).toBe("override-conflict");
      expect(e?.id).toBe("EFF-A");
      expect(e?.path).toBe("modifiers.1.priority");
      expect(e?.message).toContain("modifiers.0");
    });

    it("同じ効果の中・同じ能力値・異なる優先度は正しい", () => {
      expect(
        codes(
          withOverrides({
            id: "EFF-A",
            modifiers: [ov("STAT-DAMAGE", 10, 5), ov("STAT-DAMAGE", 20, 6)],
          }),
        ),
      ).toEqual([]);
    });

    it("異なる効果の間・同じ能力値・同じ優先度は誤り（相手の効果と位置を示す）", () => {
      const r = loadContent(
        withOverrides(
          { id: "EFF-A", modifiers: [ov("STAT-DAMAGE", 10, 5)] },
          { id: "EFF-B", modifiers: [ov("STAT-DAMAGE", 20, 5)] },
        ),
      );
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors.map((e) => e.code)).toEqual(["override-conflict"]);
      expect(r.errors[0]?.id).toBe("EFF-B");
      expect(r.errors[0]?.path).toBe("modifiers.0.priority");
      expect(r.errors[0]?.message).toContain("EFF-A の modifiers.0");
    });

    it("異なる能力値・同じ優先度は正しい（同じ効果の中でも、異なる効果の間でも）", () => {
      expect(
        codes(
          withOverrides({
            id: "EFF-A",
            modifiers: [ov("STAT-DAMAGE", 10, 5), ov("STAT-SPEED", 20, 5)],
          }),
        ),
      ).toEqual([]);
      expect(
        codes(
          withOverrides(
            { id: "EFF-A", modifiers: [ov("STAT-DAMAGE", 10, 5)] },
            { id: "EFF-B", modifiers: [ov("STAT-SPEED", 20, 5)] },
          ),
        ),
      ).toEqual([]);
    });
  });

  it("登録されていないルールフックを検出する", () => {
    const f = fixture();
    f.effects.push({
      id: "EFF-HOOK",
      origin: "keystone",
      modifiers: [{ kind: "behavior", hook: "noSuchHook" }],
      affects: { hit: false, ailmentBase: false },
      scope: "self",
    });
    expect(codes(f.raw)).toEqual(["unknown-hook"]);
  });

  it("親タグの分類の誤りを検出する", () => {
    const f = fixture();
    f.melee["parents"] = ["TAG-WPNGRP-SWORD"]; // 形態のタグは親を持てない
    expect(codes(f.raw)).toEqual(["bad-parent"]);
  });

  it("親タグの循環を検出する", () => {
    const f = fixture();
    f.swordGroup["parents"] = ["TAG-WPN-GREATSWORD"];
    expect(codes(f.raw)).toEqual(expect.arrayContaining(["bad-parent", "cycle"]));
  });

  it("同じ属性への変換を誤りにする", () => {
    const f = fixture();
    f.modifier["kind"] = "convert";
    delete f.modifier["stat"];
    f.modifier["from"] = "fire";
    f.modifier["to"] = "fire";
    f.modifier["value"] = 0.5;
    expect(codes(f.raw)).toEqual(["schema"]);
  });

  it("データの形の版が合わないと読み込まない", () => {
    const f = fixture();
    f.manifest.value = { schemaVersion: 2, contentVersion: "0.1.0" };
    expect(codes(f.raw)).toEqual(["schema-version"]);
  });

  it("誤りは途中で止めずに全て集める", () => {
    const f = fixture();
    f.melee["category"] = "nope"; // 形の誤り（IDは読めるので、参照する側の誤りは重ねて出さない）
    f.stats.push({ id: "STAT-DAMAGE", text: "stat.damage", unit: "flat" });
    f.effect["origin"] = "affix";
    expect(codes(f.raw).sort()).toEqual(["duplicate-id", "forbidden-more", "schema"]);
  });
});

describe("loadContent（印・置き換え・条件）", () => {
  const withEffects = (effects: unknown[], hooks?: ReadonlySet<string>) => {
    const f = fixture();
    f.effects.push(...effects);
    (f.raw.collections.tags[0]?.entries as unknown[]).push({
      id: "TAG-AIL-BLEED",
      category: "ailment",
      text: "tag.form.melee",
    });
    const r = loadContent(f.raw, hooks === undefined ? {} : { knownHooks: hooks });
    return r.ok ? [] : r.errors.map((e) => e.code);
  };
  const eff = (id: string, extra: Record<string, unknown>) => ({
    id,
    origin: "unique",
    affects: { hit: false, ailmentBase: false },
    scope: "self",
    ...extra,
  });

  it("状態異常の付与の印には、状態異常のタグが必要", () => {
    expect(
      withEffects([
        eff("EFF-F1", {
          modifiers: [
            { kind: "flag", flag: "ailmentApply", mode: "force", target: "TAG-AIL-BLEED" },
          ],
        }),
      ]),
    ).toEqual([]);
    expect(
      withEffects([
        eff("EFF-F2", { modifiers: [{ kind: "flag", flag: "ailmentApply", mode: "force" }] }),
      ]),
    ).toEqual(["schema"]);
    expect(
      withEffects([
        eff("EFF-F3", {
          modifiers: [
            { kind: "flag", flag: "ailmentApply", mode: "force", target: "TAG-FORM-MELEE" },
          ],
        }),
      ]),
    ).toEqual(["schema"]);
    expect(
      withEffects([
        eff("EFF-F4", {
          modifiers: [{ kind: "flag", flag: "ailmentApply", mode: "force", target: "TAG-NOPE" }],
        }),
      ]),
    ).toEqual(["unknown-ref"]);
    expect(
      withEffects([
        eff("EFF-F5", {
          modifiers: [{ kind: "flag", flag: "crit", mode: "forbid", target: "TAG-AIL-BLEED" }],
        }),
      ]),
    ).toEqual(["schema"]);
  });

  it("置き換えの挙動は、登録されたルールフックでなければならない", () => {
    const e = eff("EFF-R", {
      modifiers: [{ kind: "replace", slot: "dodge", hook: "guardStance" }],
    });
    expect(withEffects([e])).toEqual(["unknown-hook"]);
    expect(withEffects([e], new Set(["guardStance"]))).toEqual([]);
  });

  it("条件の参照を検証する", () => {
    const cond = (conditions: unknown[]) =>
      eff("EFF-C", {
        modifiers: [{ kind: "increased", stat: "STAT-DAMAGE", value: 0.1 }],
        conditions,
      });
    expect(withEffects([cond([{ type: "statAtLeast", stat: "STAT-NOPE", value: 1 }])])).toEqual([
      "unknown-ref",
    ]);
    expect(withEffects([cond([{ type: "equippedTag", tag: "TAG-NOPE" }])])).toEqual([
      "unknown-ref",
    ]);
    expect(withEffects([cond([{ type: "mainJob", job: "TAG-FORM-MELEE" }])])).toEqual(["schema"]);
    expect(withEffects([cond([{ type: "factAtLeast", fact: "no.such.fact", value: 1 }])])).toEqual([
      "schema",
    ]);
    expect(
      withEffects([cond([{ type: "factAtLeast", fact: "armor.heavy.count", value: 4 }])]),
    ).toEqual([]);
  });
});
