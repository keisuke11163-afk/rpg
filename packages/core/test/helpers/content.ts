import {
  type ContentDb,
  type RawContent,
  formatContentError,
  loadContent,
} from "../../src/index.ts";

/** テスト用の、小さなデータ一式を作る。足りない文章のキーは自動で用意する。 */
export function buildDb(
  parts: { tags?: unknown[]; stats?: unknown[]; effects?: unknown[] },
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
