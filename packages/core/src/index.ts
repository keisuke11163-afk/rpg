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
  type LoadOptions,
  type LoadResult,
  type ProvisionalEntry,
  type RawContent,
  type RawSource,
} from "./content/load.ts";

export {
  EQUIP_SLOTS,
  FACTS,
  FLAGS,
  REPLACE_SLOTS,
  type EquipSlot,
  type FactId,
  type FlagId,
  type ReplaceSlot,
} from "./content/registries.ts";
export { type Condition } from "./content/effect.ts";
export { TagIndex } from "./effects/tag-index.ts";
export {
  EQUIPMENT_SOURCE_KIND,
  ModifierView,
  evaluateEffects,
  type ActiveBehavior,
  type Contribution,
  type ConversionEntry,
  type DormantEffect,
  type EffectInstance,
  type EffectSource,
  type EvaluatedEffects,
  type EvaluationFacts,
  type FlagResolution,
  type FlagResult,
  type HitScope,
  type Range,
  type ReplacementResult,
  type RetagEntry,
  type StatResult,
} from "./effects/evaluate.ts";

export { CONVERSION_ORDER, ELEMENT_TAG, conversionAllowed } from "./content/elements.ts";
export {
  AFFIX_SKILL_LEVEL_INCREASED,
  MAX_BASE_SKILL_LEVEL,
  SPELL_BASE_MULTIPLIER,
  WEAPON_SKILL_PCT_PER_LEVEL,
  baseSkillLevel,
  spellBaseMultiplier,
  weaponSkillPct,
} from "./combat/skill-level.ts";
export {
  ARMOR_REDUCTION_CAP,
  EVASION_CAP,
  armorReduction,
  baseAccuracy,
  evadeChance,
  hitChance,
} from "./combat/defense.ts";
export {
  BASE_CRIT_MULTIPLIER,
  COMBAT_STATS,
  applyConversions,
  computeHit,
  expectedHitDamage,
  type DamageAttacker,
  type DamageDefender,
  type DamagePortion,
  type DamageSkill,
  type DamageWeapon,
  type HitOptions,
  type HitResult,
} from "./combat/damage.ts";

export {
  type AilmentDef,
  type DebuffAilmentDef,
  type DotAilmentDef,
  type StaggerAilmentDef,
  type StaggerProfile,
} from "./content/ailment.ts";
export {
  AILMENT_STATS,
  AilmentState,
  StaggerGauge,
  ailmentCandidates,
  countAilmentTypes,
  rollAilments,
  staggerProfiles,
  staggerValue,
  validateAilmentApplication,
  type AilmentApplication,
  type AilmentCandidate,
  type AilmentRollInput,
  type AilmentTickTarget,
} from "./combat/ailments.ts";
