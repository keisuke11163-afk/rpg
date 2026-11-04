import {
  type ContentDb,
  type RawContent,
  formatContentError,
  loadContent,
} from "../../src/index.ts";

/** テスト用の、小さなデータ一式を作る。足りない文章のキーは自動で用意する。 */
export function buildDb(
  parts: { tags?: unknown[]; stats?: unknown[]; effects?: unknown[]; ailments?: unknown[] },
  knownHooks?: ReadonlySet<string>,
): ContentDb {
  const texts: Record<string, string> = {};
  for (const entry of [...(parts.tags ?? []), ...(parts.stats ?? [])]) {
    const key = (entry as { text?: unknown }).text;
    if (typeof key === "string") texts[key] = key;
  }
  const raw: RawContent = {
    manifest: { file: "manifest.json", value: { schemaVersion: 1, contentVersion: "0.0.1" } },
    texts,
    collections: {
      tags: [{ file: "tags.json", entries: parts.tags ?? [] }],
      stats: [{ file: "stats.json", entries: parts.stats ?? [] }],
      effects: [{ file: "effects.json", entries: parts.effects ?? [] }],
      ailments: [{ file: "ailments.json", entries: parts.ailments ?? [] }],
    },
  };
  const r = loadContent(raw, knownHooks === undefined ? {} : { knownHooks });
  if (!r.ok) throw new Error(r.errors.map(formatContentError).join("\n"));
  return r.content;
}

export const tag = (id: string, category: string, parents?: string[]): Record<string, unknown> => ({
  id,
  category,
  text: `t.${id.toLowerCase()}`,
  ...(parents === undefined ? {} : { parents }),
});

export const stat = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  text: `s.${id.toLowerCase()}`,
  unit: "flat",
  ...extra,
});

export const effect = (
  id: string,
  origin: string,
  modifiers: unknown[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  origin,
  modifiers,
  affects: { hit: true, ailmentBase: true },
  scope: "self",
  ...extra,
});

const ELEMS = ["PHYSICAL", "LIGHTNING", "COLD", "FIRE", "DARK", "HOLY"];

/** ダメージの計算に必要なタグ・能力値（packages/content の data/stats/combat.json と同じID）。 */
export function combatFixture(): {
  tags: Record<string, unknown>[];
  stats: Record<string, unknown>[];
} {
  return {
    tags: [
      ...ELEMS.map((e) => tag(`TAG-ELEM-${e}`, "element")),
      tag("TAG-FORM-MELEE", "form"),
      tag("TAG-FORM-SPELL", "form"),
      tag("TAG-FORM-FINISHER", "form"),
      tag("TAG-AIL-BLEED", "ailment"),
      tag("TAG-WPNGRP-SWORD", "weaponGroup"),
      tag("TAG-WPN-SWORD", "weapon", ["TAG-WPNGRP-SWORD"]),
      tag("TAG-WPN-SCYTHE", "weapon"),
      tag("TAG-WPN-DAGGER", "weapon"),
    ],
    stats: [
      stat("STAT-DAMAGE", { unit: "ratio" }),
      ...ELEMS.map((e) => stat(`STAT-ADDED-${e}`)),
      stat("STAT-CRIT-CHANCE", { unit: "ratio" }),
      stat("STAT-CRIT-MULTIPLIER", { unit: "ratio" }),
      stat("STAT-ACCURACY", { min: 0 }),
      stat("STAT-SKILL-LEVEL", { min: 0 }),
      stat("STAT-ARMOR", { min: 0 }),
      stat("STAT-EVASION", { min: 0 }),
      ...ELEMS.map((e) =>
        stat(`STAT-RESIST-${e}`, { unit: "ratio", baseCap: 0.75, capLimit: 0.9 }),
      ),
    ],
  };
}
