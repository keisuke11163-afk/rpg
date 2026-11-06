import {
  type ContentDb,
  type RawContent,
  formatContentError,
  loadContent,
} from "../../src/index.ts";

/** テスト用の、小さなデータ一式を作る。足りない文章のキーは自動で用意する。 */
export function buildDb(
  parts: {
    tags?: unknown[];
    stats?: unknown[];
    effects?: unknown[];
    ailments?: unknown[];
    skills?: unknown[];
    gauges?: unknown[];
    jobs?: unknown[];
  },
  knownHooks?: ReadonlySet<string>,
): ContentDb {
  const texts: Record<string, string> = {};
  for (const entry of [
    ...(parts.tags ?? []),
    ...(parts.stats ?? []),
    ...(parts.skills ?? []),
    ...(parts.gauges ?? []),
    ...(parts.jobs ?? []),
    ...(parts.gauges ?? []).flatMap((g) => (g as { stages?: unknown[] }).stages ?? []),
  ]) {
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
      skills: [{ file: "skills.json", entries: parts.skills ?? [] }],
      gauges: [{ file: "gauges.json", entries: parts.gauges ?? [] }],
      jobs: [{ file: "jobs.json", entries: parts.jobs ?? [] }],
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

/** 状態異常の定義（packages/content の data/ailments/ailments.json と同じ値）。 */
export const AILMENT_FIXTURE: unknown[] = [
  {
    id: "AIL-BURN",
    tag: "TAG-AIL-BURN",
    kind: "dot",
    sourceElements: ["fire"],
    dotElement: "fire",
    totalRatio: 0.5,
    duration: 4,
    stacking: { mode: "strongest" },
  },
  {
    id: "AIL-BLEED",
    tag: "TAG-AIL-BLEED",
    kind: "dot",
    sourceElements: ["physical"],
    dotElement: "physical",
    totalRatio: 1.5,
    duration: 5,
    stacking: { mode: "stack", maxStacks: 8 },
    movingMultiplier: 2,
  },
  {
    id: "AIL-POISON",
    tag: "TAG-AIL-POISON",
    kind: "dot",
    sourceElements: ["physical", "dark"],
    dotElement: "dark",
    totalRatio: 0.6,
    duration: 3,
    stacking: { mode: "stack" },
  },
  {
    id: "AIL-WEAKEN",
    tag: "TAG-AIL-WEAKEN",
    kind: "debuff",
    sourceElements: ["dark"],
    duration: 4,
    dealtMultiplier: 0.85,
    bossDealtMultiplier: 0.92,
  },
  {
    id: "AIL-STAGGER",
    tag: "TAG-AIL-STAGGER",
    kind: "stagger",
    defaultCoefficient: 0.3,
    enemy: {
      gaugeRatio: 0.2,
      decayDelay: 3,
      decayPerSecond: 0.1,
      breakDuration: 2,
      takenMultiplier: 1.25,
      growthPerBreak: 1,
    },
    boss: {
      gaugeRatio: 0.15,
      decayDelay: 3,
      decayPerSecond: 0.1,
      breakDuration: 1,
      takenMultiplier: 1.15,
      growthPerBreak: 1.5,
    },
    player: {
      gaugeRatio: 0.5,
      decayDelay: 2,
      decayPerSecond: 0.2,
      breakDuration: 0.6,
      takenMultiplier: 1,
      growthPerBreak: 1,
    },
  },
];

/** 戦闘の計算に必要なもの一式（タグ・能力値・状態異常）に、効果を加えたデータ。 */
export function fullCombatDb(
  effects: unknown[] = [],
  extra: {
    tags?: unknown[];
    stats?: unknown[];
    skills?: unknown[];
    gauges?: unknown[];
    jobs?: unknown[];
  } = {},
): ContentDb {
  const fx = combatFixture();
  const ailmentTags = ["BURN", "POISON", "WEAKEN", "STAGGER"].map((c) =>
    tag(`TAG-AIL-${c}`, "ailment"),
  );
  const extraStats = [
    stat("STAT-AILMENT-CHANCE", { unit: "ratio", min: 0 }),
    stat("STAT-AILMENT-DAMAGE", { unit: "ratio" }),
    stat("STAT-AILMENT-DURATION", { unit: "seconds", min: 0 }),
    stat("STAT-AILMENT-MAX-STACKS", { min: 0 }),
    stat("STAT-STAGGER", { unit: "ratio" }),
    stat("STAT-STAGGER-RESIST", { unit: "ratio", min: 0, baseCap: 1 }),
    stat("STAT-DAMAGE-TAKEN", { unit: "ratio" }),
    stat("STAT-STAGGER-TAKEN", { unit: "ratio" }),
  ];
  return buildDb({
    tags: [...fx.tags, ...ailmentTags, ...(extra.tags ?? [])],
    stats: [...fx.stats, ...extraStats, ...(extra.stats ?? [])],
    effects,
    ailments: AILMENT_FIXTURE,
    skills: extra.skills ?? [],
    gauges: extra.gauges ?? [],
    jobs: extra.jobs ?? [],
  });
}
