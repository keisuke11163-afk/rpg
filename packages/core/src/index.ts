/**
 * @stella/core — ルールの中核。
 *
 * タグ・効果・ダメージ・状態異常・職能ゲージ・ツリー・アイテムの生成・セーブのモデルを、
 * ブラウザの機能と Phaser に依存せずに実装する（開発環境構築計画 3.1）。
 */

/** ルールの中核の公開APIの版。互換性のない変更をしたときに上げる。 */
export const CORE_API_VERSION = 1;

export { Rng, type RngState } from "./random/rng.ts";
export { FLASK_FILL, FLASK_RULES, Flask, type FlaskState } from "./character/flasks.ts";
export {
  JOB_NODE_SOURCE,
  JobBoardAllocation,
  type JobAllocateBlock,
  jobBoardPoints,
  jobBoardRespecCost,
} from "./board/job-board.ts";
export { type JobNodeDef, type JobNodeKind } from "./content/board.ts";
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
  conditionMet,
  evaluateEffects,
  stageOneView,
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
  type StaggerResizePlan,
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
  type HealthResizePlan,
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
  type EnemyResidue,
} from "./content/enemy.ts";
export {
  ENEMY_RULES,
  FLANK,
  Enemy,
  EnemyAttackers,
  WANDER,
  angleDiff,
  cloudCenters,
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
  ATTRIBUTE_STATS,
  MIN_ATTACK_SPEED_FACTOR,
  SHEET_STATS,
  UNARMED_ATTACK_SPEED,
  UNARMED_WEAPON_TAG,
  type CharacterSheet,
  type CharacterSheetInput,
  type DamagePreview,
  damagePreview,
  type SheetBreakdownLine,
  type SheetRow,
  type SheetStat,
  type SheetWeapon,
  buildCharacterSheet,
  bareHandsDamage,
  BARE_HANDS_MAX_STAT,
  BASE_WARD_DELAY,
  latentConditionMet,
  sheetRows,
} from "./character/sheet.ts";

export {
  AFFIX_SLOTS,
  AFFIX_TIERS,
  ATTRIBUTES,
  BASE_CATEGORIES,
  ARMOR_TYPES,
  type ArmorType,
  type LatentCondition,
  type UniqueDef,
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
  addAffixes,
  candidateAffixes,
  JOB_AFFIX_BOOST,
  type AffixContext,
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
  droppableUniques,
  jobTargetedBases,
  rollDrops,
  uniqueItem,
  ALTAR_TOKEN_COST,
} from "./items/drops.ts";
export { INVENTORY_SLOTS, Inventory } from "./items/inventory.ts";
export {
  type ItemTooltip,
  type TooltipContext,
  type TooltipEffectLine,
  effectMatchesContexts,
  itemTooltip,
  skillContexts,
} from "./items/tooltip.ts";
export {
  type CompareOptions,
  type EquipComparison,
  type StatChange,
  compareEquip,
} from "./items/compare.ts";
export {
  AWAKENING_DUST,
  AWAKENING_DUST_PRICE,
  MERCHANT_STOCK_SIZE,
  SELL_MULTIPLIER,
  STASH_SLOTS,
  type StockInput,
  basePrice,
  buyAwakeningDust,
  buyItem,
  createStash,
  rollMerchantStock,
  sellItem,
  sellPrice,
  transferItem,
} from "./items/merchant.ts";
export {
  ENHANCE_STEP,
  Equipment,
  MAX_ENHANCE,
  MVP_EQUIP_SLOTS,
  ARMOR_SLOTS,
  DEFENSE_EFFECTS,
  UNIFORM_EFFECTS,
  UNIFORM_PIECES,
  enhanceMultiplier,
  type MvpEquipSlot,
  UNMET_REQUIREMENT_MULTIPLIER,
  basePerformanceMultiplier,
  equipFromInventory,
  levelMet,
  requirementMet,
  slotsFor,
  unequipToInventory,
} from "./items/equipment.ts";

export {
  MIGRATIONS,
  SAVE_SKILL_SLOTS,
  SAVE_VERSION,
  type KeptSaveFields,
  type Migration,
  type PlayerProfile,
  type SaveData,
  SaveDataError,
  type SaveDataV1,
  emptyKeptFields,
  fromSaveData,
  migrateSaveData,
  saveDataSchema,
  saveDataV1Schema,
  toSaveData,
} from "./save/save-data.ts";
export {
  AutoSaveTimer,
  type AutoSaveReason,
  DUNGEON_AUTOSAVE_SECONDS,
  type LoadResult as SaveLoadResult,
  MemoryBackend,
  SAVE_FORMAT,
  SAVE_SLOTS,
  type SaveBackend,
  SaveStore,
  type SlotSummary,
  checksum,
  decodeSave,
  encodeSave,
} from "./save/save-store.ts";

export {
  NODE_EFFECT_ORIGIN,
  STAR_NODE_KINDS,
  STAR_REGIONS,
  type ConstellationDef,
  type StarNodeDef,
  type StarNodeKind,
  type StarRegion,
  constellationSchema,
  starNodeSchema,
} from "./content/board.ts";
export {
  CONSTELLATION_SOURCE,
  type DormantReason,
  STAR_NODE_SOURCE,
  StarAllocation,
  type StarBoardInput,
  type StarBoardResult,
  evaluateStarBoard,
  startNodeOf,
  nodesWithin,
  starPoints,
} from "./board/star-board.ts";

export {
  CRACKS,
  CRACK_CHANCE,
  CRAFT_MATERIALS,
  CRAFT_OPS,
  type CraftBlock,
  type CraftOp,
  type CraftResult,
  ENHANCE_COSTS,
  INSCRIPTIONS,
  INSPIRATION_CHANCE,
  MAX_FORGE_LOAD,
  SEAL_LOAD_AFTER_FIRST,
  UNSTABLE_LOAD,
  craft,
  craftBlock,
  craftWithInventory,
  disassembleFromInventory,
  disassemblyYield,
  enhance,
  enhanceCost,
  enhanceWithInventory,
  inscribe,
  opLoad,
} from "./items/crafting.ts";

export {
  type LoadoutRecord,
  MAX_LOADOUTS,
  emptyLoadout,
  forgetItem,
  loadoutsUsing,
} from "./character/loadouts.ts";

export {
  FACILITIES,
  type Facility,
  type Rect,
  type QuestDef,
  type RegionDef,
  inRect,
  questSchema,
  regionSchema,
} from "./content/region.ts";
export {
  ELITE_CHANCE,
  type LayoutChest,
  type LayoutPack,
  MAGIC_PACK_CHANCE,
  OLD_CHEST_CHANCE,
  PACK_ACTIVE_CHANCE,
  type RegionLayout,
  WOOD_CHESTS,
  rollRegionLayout,
} from "./world/layout.ts";
