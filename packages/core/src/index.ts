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
export { StepInputBuffer } from "./time/step-input.ts";

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
  enemyAccuracy,
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
  resolveMaxStacks,
  validateAilmentApplication,
  type AilmentApplication,
  type AilmentApplyPlan,
  type AilmentCandidate,
  type AilmentRollInput,
  type AilmentTickPlan,
  type AilmentTickTarget,
  type StaggerAddPlan,
  type StaggerUpdatePlan,
} from "./combat/ailments.ts";

export { ZERO, add, length, normalize, scale, toDirection8, type Vec2 } from "./actor/vector.ts";
export {
  DEFAULT_MOTION,
  PlayerMotion,
  type Bounds,
  type MotionConfig,
  type MotionInput,
} from "./actor/player-motion.ts";

export { isBehind, overlapsShape, type HitShape } from "./combat/shapes.ts";
export {
  ActionTimeline,
  PLAYER_ATTACK_SPLIT,
  playerAttackTimeline,
  type TimelineEvents,
  type TimelinePhase,
  type TimelineSpec,
} from "./combat/timeline.ts";
export {
  Health,
  type DamageApplied,
  type HealthConfig,
  type HealthUpdatePlan,
} from "./combat/health.ts";
export {
  ProjectilePool,
  type ProjectileHit,
  type ProjectileSpawn,
  type ProjectileTarget,
} from "./combat/projectiles.ts";
export {
  Combatant,
  RECEIVED_STATS,
  resolveHit,
  type CombatantInit,
  type CombatantUpdatePlan,
  type ReceivedMultipliers,
  type HitInput,
  type HitReport,
} from "./combat/combatant.ts";

export {
  AFFINITIES,
  gaugeSchema,
  hitShapeSchema,
  jobSchema,
  skillSchema,
  type Affinity,
  type GaugeDef,
  type JobDef,
  type SkillAction,
  type SkillDef,
  type SkillMods,
} from "./content/job.ts";
export { SKILL_HOOKS, SKILL_HOOK_PARAMS, type SkillHook } from "./content/hooks.ts";
export { JobGauge, OUT_OF_COMBAT_SECONDS } from "./combat/gauge.ts";
export { TimedEffects } from "./combat/timed-effects.ts";
export {
  AFFINITY_ATTACK_SPEED,
  Cooldowns,
  affinityAtLeast,
  dualWieldAffinity,
  higherAffinity,
  lowerAffinity,
  resolveSkill,
  skillBlock,
  skillUseSeconds,
  unlockedSkills,
  weaponAffinity,
  type ResolvedSkill,
  type SkillBehavior,
  type SkillBlock,
  type SkillContext,
  type SkillUseState,
} from "./combat/skills.ts";
export {
  LingeringZone,
  SkillExecution,
  pullTowards,
  type TrapPlacement,
  type ZonePlacement,
  type ExecutionInput,
  type ExecutionTick,
  type PullPulse,
  type Strike,
  type WarcryPulse,
} from "./combat/skill-execution.ts";
export { chapterBossHp, normalEnemyHp, standardDps, standardHp } from "./combat/standards.ts";
export {
  ENEMY_RANKS,
  enemyAttackSchema,
  enemyRankSchema,
  enemySchema,
  type EnemyAttackDef,
  type EnemyBehavior,
  type EnemyDef,
  type EnemyDelivery,
  type EnemyRank,
  type EnemyRankDef,
} from "./content/enemy.ts";
export {
  ENEMY_RULES,
  FLANK,
  Enemy,
  EnemyAttackers,
  WANDER,
  angleDiff,
  enemyAttackDamage,
  enemyMaxHp,
  separate,
  turnTowards,
  type EnemyEvent,
  type EnemyInit,
  type EnemyState,
  type EnemyTarget,
  type EnemyUpdatePlan,
} from "./actor/enemy.ts";
export {
  ATTRIBUTE_EFFECTS,
  CATCH_UP,
  Character,
  JOB_CHANGE_LEVEL,
  JOB_LEVEL_CAP,
  LEVEL_CAP,
  LevelTrack,
  enemyXp,
  levelGapMultiplier,
  xpToNext,
  type Attributes,
  type CharacterInit,
  type XpGain,
} from "./character/progression.ts";

export {
  AFFIX_SLOTS,
  AFFIX_TIERS,
  ATTRIBUTES,
  BASE_CATEGORIES,
  DROP_SOURCES,
  ITEM_RARITIES,
  RARE_OR_BETTER,
  TIER_MIN_ILVL,
  type AffixDef,
  type AffixTier,
  type Attribute,
  type BaseCategory,
  type DropProfileDef,
  type DropSource,
  type ItemBaseDef,
  type ItemRarity,
  type MaterialDef,
  type MaterialDropDef,
  type RarityDef,
} from "./content/item.ts";
export { type TierValue, affixTierValues, eligibleTiers, tierWeights } from "./items/tiers.ts";
export { type RarityRollInput, rarityWeights, rollRarity } from "./items/rarity.ts";
export {
  EQUIPMENT_SOURCE,
  type GenerateItemInput,
  type ItemInstance,
  type RolledAffix,
  candidateAffixes,
  generateItem,
  itemEffectInstances,
  rollAffixValue,
} from "./items/generate.ts";
export {
  JOB_TARGETED_SHARE,
  type DropInput,
  type DropResult,
  dropItemLevel,
  droppableBases,
  jobTargetedBases,
  rollDrops,
} from "./items/drops.ts";
export { INVENTORY_SLOTS, Inventory } from "./items/inventory.ts";
export {
  Equipment,
  MVP_EQUIP_SLOTS,
  type MvpEquipSlot,
  UNMET_REQUIREMENT_MULTIPLIER,
  basePerformanceMultiplier,
  equipFromInventory,
  requirementMet,
  slotsFor,
  unequipToInventory,
} from "./items/equipment.ts";
