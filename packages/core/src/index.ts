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
