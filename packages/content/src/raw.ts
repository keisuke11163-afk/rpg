/**
 * データのファイルの一覧。
 *
 * ブラウザ（Vite）でも Node.js でも同じように読めるように、ファイルを静的に読み込む。
 * データのファイルを追加したら、ここにも追加する。登録し忘れたファイルは、
 * データの検証（pnpm validate:data）が誤りとして知らせる。
 */
import type { RawContent } from "@stella/core";
import ailmentDefs from "../data/ailments/ailments.json" with { type: "json" };
import chapter1Enemies from "../data/enemies/chapter1.json" with { type: "json" };
import enemyRanks from "../data/enemies/ranks.json" with { type: "json" };
import attributeEffects from "../data/effects/attributes.json" with { type: "json" };
import rogueEffects from "../data/effects/rogue.json" with { type: "json" };
import warriorEffects from "../data/effects/warrior.json" with { type: "json" };
import affixEffects from "../data/effects/affixes.json" with { type: "json" };
import starEffects from "../data/effects/star.json" with { type: "json" };
import starNodes from "../data/boards/star.json" with { type: "json" };
import constellations from "../data/boards/constellations.json" with { type: "json" };
import implicitEffects from "../data/effects/implicits.json" with { type: "json" };
import gauges from "../data/gauges/gauges.json" with { type: "json" };
import affixes from "../data/items/affixes.json" with { type: "json" };
import itemBases from "../data/items/bases.json" with { type: "json" };
import dropProfiles from "../data/items/drops.json" with { type: "json" };
import materials from "../data/items/materials.json" with { type: "json" };
import rarities from "../data/items/rarities.json" with { type: "json" };
import jobDefs from "../data/jobs/jobs.json" with { type: "json" };
import manifest from "../data/manifest.json" with { type: "json" };
import commonSkills from "../data/skills/common.json" with { type: "json" };
import rogueSkills from "../data/skills/rogue.json" with { type: "json" };
import warriorSkills from "../data/skills/warrior.json" with { type: "json" };
import combatStats from "../data/stats/combat.json" with { type: "json" };
import ailments from "../data/tags/ailments.json" with { type: "json" };
import elements from "../data/tags/elements.json" with { type: "json" };
import enemyFamilies from "../data/tags/enemy-families.json" with { type: "json" };
import forms from "../data/tags/forms.json" with { type: "json" };
import jobs from "../data/tags/jobs.json" with { type: "json" };
import regions from "../data/tags/regions.json" with { type: "json" };
import weapons from "../data/tags/weapons.json" with { type: "json" };
import ja from "../text/ja.json" with { type: "json" };

export const rawContent: RawContent = {
  manifest: { file: "data/manifest.json", value: manifest },
  texts: ja,
  collections: {
    tags: [
      { file: "data/tags/forms.json", entries: forms },
      { file: "data/tags/elements.json", entries: elements },
      { file: "data/tags/ailments.json", entries: ailments },
      { file: "data/tags/weapons.json", entries: weapons },
      { file: "data/tags/jobs.json", entries: jobs },
      { file: "data/tags/regions.json", entries: regions },
      { file: "data/tags/enemy-families.json", entries: enemyFamilies },
    ],
    stats: [{ file: "data/stats/combat.json", entries: combatStats }],
    effects: [
      { file: "data/effects/attributes.json", entries: attributeEffects },
      { file: "data/effects/warrior.json", entries: warriorEffects },
      { file: "data/effects/rogue.json", entries: rogueEffects },
      { file: "data/effects/implicits.json", entries: implicitEffects },
      { file: "data/effects/affixes.json", entries: affixEffects },
      { file: "data/effects/star.json", entries: starEffects },
    ],
    ailments: [{ file: "data/ailments/ailments.json", entries: ailmentDefs }],
    skills: [
      { file: "data/skills/common.json", entries: commonSkills },
      { file: "data/skills/warrior.json", entries: warriorSkills },
      { file: "data/skills/rogue.json", entries: rogueSkills },
    ],
    gauges: [{ file: "data/gauges/gauges.json", entries: gauges }],
    jobs: [{ file: "data/jobs/jobs.json", entries: jobDefs }],
    enemies: [{ file: "data/enemies/chapter1.json", entries: chapter1Enemies }],
    enemyRanks: [{ file: "data/enemies/ranks.json", entries: enemyRanks }],
    rarities: [{ file: "data/items/rarities.json", entries: rarities }],
    itemBases: [{ file: "data/items/bases.json", entries: itemBases }],
    affixes: [{ file: "data/items/affixes.json", entries: affixes }],
    materials: [{ file: "data/items/materials.json", entries: materials }],
    dropProfiles: [{ file: "data/items/drops.json", entries: dropProfiles }],
    starNodes: [{ file: "data/boards/star.json", entries: starNodes }],
    constellations: [{ file: "data/boards/constellations.json", entries: constellations }],
  },
};

/** 登録されているデータのファイル（data/ からの場所）。 */
export function registeredDataFiles(): string[] {
  const c = rawContent.collections;
  return [
    rawContent.manifest.file,
    ...[
      ...c.tags,
      ...c.stats,
      ...c.effects,
      ...(c.ailments ?? []),
      ...(c.skills ?? []),
      ...(c.gauges ?? []),
      ...(c.jobs ?? []),
      ...(c.enemies ?? []),
      ...(c.enemyRanks ?? []),
      ...(c.rarities ?? []),
      ...(c.itemBases ?? []),
      ...(c.affixes ?? []),
      ...(c.materials ?? []),
      ...(c.dropProfiles ?? []),
      ...(c.starNodes ?? []),
      ...(c.constellations ?? []),
    ].map((s) => s.file),
  ];
}
