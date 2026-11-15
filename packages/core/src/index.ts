/**
 * @stella/core — ルールの中核。
 *
 * タグ・効果・ダメージ・状態異常・職能ゲージ・ツリー・アイテムの生成・セーブのモデルを、
 * ブラウザの機能と Phaser に依存せずに実装する（開発環境構築計画 3.1）。
 */

/** ルールの中核の公開APIの版。互換性のない変更をしたときに上げる。 */
export const CORE_API_VERSION = 1;

export * from "./rng.ts";
export * from "./time.ts";
export * from "./data/schema.ts";
export * from "./data/validate.ts";
export * from "./effects/tags.ts";
export * from "./effects/conditions.ts";
export * from "./effects/hooks.ts";
export * from "./effects/evaluate.ts";
export * from "./effects/priority.ts";
export * from "./combat/skill-level.ts";
export * from "./combat/damage.ts";
export * from "./combat/ailments.ts";
export * from "./player/input.ts";
export * from "./player/controller.ts";
export * from "./combat/weapons.ts";
export * from "./combat/geometry.ts";
export * from "./combat/combatant.ts";
export * from "./combat/projectile.ts";
export * from "./jobs/gauge.ts";
export * from "./jobs/skills.ts";
export * from "./jobs/warrior.ts";
export * from "./jobs/fighter.ts";
export * from "./enemy/stats.ts";
export * from "./enemy/def.ts";
export * from "./enemy/ai.ts";
export * from "./jobs/rogue.ts";
export * from "./combat/zones.ts";
export * from "./progress/exp.ts";
export * from "./progress/jobs.ts";
export * from "./jobs/definitions.ts";
export * from "./items/types.ts";
export * from "./items/affix.ts";
export * from "./items/rarity.ts";
export * from "./items/generate.ts";
export * from "./items/drops.ts";
export * from "./items/loot.ts";
export * from "./items/gear.ts";
export * from "./items/describe.ts";
export * from "./items/merchant.ts";
export * from "./save/schema.ts";
export * from "./save/migrate.ts";
export * from "./save/storage.ts";
export * from "./save/state.ts";
export * from "./board/star.ts";
export * from "./board/context.ts";
export * from "./board/job.ts";
export * from "./items/unique.ts";
export * from "./board/flags.ts";
export * from "./craft/craft.ts";
export * from "./world/map.ts";
export * from "./world/region.ts";
export * from "./world/flow.ts";
export * from "./combat/potion.ts";
export * from "./world/quest.ts";
