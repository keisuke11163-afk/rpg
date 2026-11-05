/**
 * @stella/core — ルールの中核。
 *
 * タグ・効果・ダメージ・状態異常・職能ゲージ・ツリー・アイテムの生成・セーブのモデルを、
 * ブラウザの機能と Phaser に依存せずに実装する（開発環境構築計画 3.1）。
 */

/** ルールの中核の公開APIの版。互換性のない変更をしたときに上げる。 */
export const CORE_API_VERSION = 1;

export { Rng, type RngState } from "./random/rng.ts";
export { FIXED_STEP_SECONDS, FixedStepClock, type AdvanceResult } from "./time/fixed-step.ts";

export { ID_PATTERN } from "./content/ids.ts";
export { TAG_CATEGORIES, type TagDef } from "./content/tag.ts";
export { type StatDef } from "./content/stat.ts";
export {
  EFFECT_ORIGINS,
  ELEMENTS,
  MORE_ALLOWED_ORIGINS,
  MORE_REDUCTION_ONLY_ORIGINS,
  type EffectDef,
  type EffectOrigin,
  type Element,
  type Modifier,
  type TagFilter,
} from "./content/effect.ts";
export { SUPPORTED_SCHEMA_VERSION, type Manifest } from "./content/manifest.ts";
export { KNOWN_HOOKS } from "./content/hooks.ts";
export {
  formatContentError,
  loadContent,
  type ContentDb,
  type ContentError,
  type ContentErrorCode,
  type LoadResult,
  type ProvisionalEntry,
  type RawContent,
  type RawSource,
} from "./content/load.ts";
