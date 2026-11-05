import type { Affinity, JobDef } from "../content/job.ts";
import type { ContentDb } from "../content/load.ts";
import {
  type DamageAttacker,
  type DamageDefender,
  type DamageSkill,
  computeHit,
} from "../combat/damage.ts";
import type { Rng } from "../random/rng.ts";
import { AFFINITY_ATTACK_SPEED, weaponAffinity } from "../combat/skills.ts";
import {
  type EffectInstance,
  type EvaluatedEffects,
  type StatResult,
  evaluateEffects,
} from "../effects/evaluate.ts";
import type { TagIndex } from "../effects/tag-index.ts";
import type { Equipment } from "../items/equipment.ts";
import { requirementMet } from "../items/equipment.ts";
import type { ItemInstance } from "../items/generate.ts";
import type { Attributes, Character } from "./progression.ts";

/** 素手のタグ（仕様書v0.2 3.2：全ジョブの適性はA）。 */
export const UNARMED_WEAPON_TAG = "TAG-WPN-UNARMED";
/** 素手の攻撃速度（回/秒）。仮値: 仕様書に素手の攻撃速度の記載がないため（docs/progress D-U12-4）。 */
export const UNARMED_ATTACK_SPEED = 1;
/** 攻撃速度の倍率の下限（加算の増加が大きく負になっても、0や負にしない）。 */
export const MIN_ATTACK_SPEED_FACTOR = 0.1;

export interface CharacterSheetInput {
  readonly character: Character;
  /** メインジョブ（character.mainJob のデータ）。 */
  readonly job: JobDef;
  /** 装備（省略すると何も装備していない）。 */
  readonly equipment?: Equipment;
  /** 一時的な効果（戦吼の強化など）。 */
  readonly extraEffects?: readonly EffectInstance[];
}

/** 主手の武器の状態。 */
export interface SheetWeapon {
  readonly item: ItemInstance;
  /** 要求値を満たしているか（満たさなければ基礎ダメージが-40%。仕様書v0.2 2.2）。 */
  readonly requirementMet: boolean;
  /** 武器の基礎の攻撃速度（回/秒）。 */
  readonly baseAttackSpeed: number;
}

/**
 * キャラクターの能力値（U-12）。戦闘の計算（攻撃する側・最大HP・最大MP・攻撃速度）と、
 * キャラクターの画面の表示は、どちらもこの1つの計算の結果を使う（表示と戦闘の数値が食い違わないように）。
 */
export interface CharacterSheet {
  readonly evaluated: EvaluatedEffects;
  /** 能力値（出自の初期能力値。星辰盤・装備の分は U-14 以降）。 */
  readonly attributes: Attributes;
  /** ダメージの計算に渡す、攻撃する側。 */
  readonly attacker: DamageAttacker;
  /** 主手の武器（素手なら undefined）。 */
  readonly weapon: SheetWeapon | undefined;
  /** 主手の武器のタグ（素手なら素手のタグ）。技の変化・適性に使う。 */
  readonly weaponTags: readonly string[];
  /** メインジョブの、主手の武器への適性。 */
  readonly affinity: Affinity;
  /** 攻撃速度（回/秒）＝ 武器の基礎 ×（1 ＋ 攻撃速度の増加 ＋ 適性の補正）。 */
  readonly attackSpeed: number;
  readonly maxHp: number;
  readonly maxMp: number;
  /** 効果時間の倍率（1 ＋ 効果時間の増加）。 */
  readonly effectDuration: number;
}

/** キャラクターの能力値を計算する（装備・能力値・一時的な効果を、効果の評価にまとめて渡す）。 */
export function buildCharacterSheet(
  db: ContentDb,
  tags: TagIndex,
  input: CharacterSheetInput,
): CharacterSheet {
  const { character, job, equipment } = input;
  const attributes = character.attributes;
  const evaluated = evaluateEffects(
    db,
    tags,
    [
      ...(input.extraEffects ?? []),
      ...character.attributeEffects(),
      ...(equipment?.effects() ?? []),
    ],
    {
      baseStats: character.baseStats(),
      equippedTags: equipment?.equippedTags() ?? {},
      mainJob: job.tag,
    },
  );
  const view = evaluated.view;
  const main = equipment?.mainWeapon(attributes);
  const item = equipment?.get("mainHand");
  const base = item === undefined ? undefined : db.itemBases.get(item.base);
  const weapon: SheetWeapon | undefined =
    main === undefined || item === undefined || base === undefined
      ? undefined
      : {
          item,
          requirementMet: requirementMet(base, attributes),
          baseAttackSpeed: main.attackSpeed,
        };
  const weaponTags = main?.weapon.tags ?? [UNARMED_WEAPON_TAG];
  const affinity = weaponAffinity(tags, job, weaponTags);
  const attackSpeed =
    (main?.attackSpeed ?? UNARMED_ATTACK_SPEED) *
    Math.max(
      MIN_ATTACK_SPEED_FACTOR,
      1 + view.stat("STAT-ATTACK-SPEED").increased + AFFINITY_ATTACK_SPEED[affinity],
    );
  return {
    evaluated,
    attributes,
    attacker: {
      db,
      view,
      characterLevel: character.level,
      ...(main === undefined ? {} : { weapon: main.weapon }),
    },
    weapon,
    weaponTags,
    affinity,
    attackSpeed,
    maxHp: view.stat("STAT-HP-MAX").value,
    maxMp: view.stat("STAT-MP-MAX").value,
    effectDuration: 1 + view.stat("STAT-EFFECT-DURATION").increased,
  };
}

/** キャラクターの画面に並べる能力値1つ（タグの条件つきの修正値は、tags の文脈で集計する）。 */
export interface SheetStat {
  readonly stat: string;
  /** 集計の文脈のタグ（例：物理ダメージ増加は TAG-ELEM-PHYSICAL）。 */
  readonly tags?: readonly string[];
}

/** キャラクターの画面に並べる能力値（補助仕様書16章「能力値と、修正値の内訳」）。 */
export const SHEET_STATS: readonly SheetStat[] = [
  { stat: "STAT-HP-MAX" },
  { stat: "STAT-MP-MAX" },
  { stat: "STAT-ACCURACY" },
  { stat: "STAT-ARMOR" },
  { stat: "STAT-EVASION" },
  { stat: "STAT-DAMAGE", tags: ["TAG-ELEM-PHYSICAL"] },
  { stat: "STAT-CRIT-CHANCE" },
  { stat: "STAT-CRIT-MULTIPLIER" },
  { stat: "STAT-ATTACK-SPEED" },
  { stat: "STAT-MOVE-SPEED" },
  { stat: "STAT-COOLDOWN-REDUCTION" },
  { stat: "STAT-RESIST-FIRE" },
  { stat: "STAT-RESIST-COLD" },
  { stat: "STAT-RESIST-LIGHTNING" },
  { stat: "STAT-RESIST-DARK" },
  { stat: "STAT-RESIST-HOLY" },
  { stat: "STAT-STAGGER" },
  { stat: "STAT-AILMENT-CHANCE", tags: ["TAG-AIL-BLEED"] },
  { stat: "STAT-AILMENT-DAMAGE", tags: ["TAG-AIL-BLEED"] },
];

/** 修正値の内訳の1行（出どころごとにまとめる）。 */
export interface SheetBreakdownLine {
  /** 出どころの種類（equipment・attribute・buff など）。 */
  readonly sourceKind: string;
  /** 出どころの実体（装備の uid・能力値の名前など）。 */
  readonly sourceRef: string;
  readonly kind: StatResult["contributions"][number]["kind"];
  readonly value: number | { readonly min: number; readonly max: number };
  readonly effectId: string;
  /** 局所の効果（その武器のヒットだけに効く）か。 */
  readonly local: boolean;
}

export interface SheetRow {
  readonly stat: string;
  readonly tags: readonly string[];
  /** まとめた値（StatResult.value）。 */
  readonly value: number;
  readonly result: StatResult;
  readonly breakdown: readonly SheetBreakdownLine[];
}

/** キャラクターの画面の能力値の行（内訳つき）。局所の効果は内訳に印を付けて出す。 */
export function sheetRows(
  db: ContentDb,
  sheet: CharacterSheet,
  stats: readonly (SheetStat | string)[] = SHEET_STATS,
): SheetRow[] {
  const view = sheet.evaluated.view;
  return stats.map((entry) => {
    const { stat, tags = [] } = typeof entry === "string" ? { stat: entry } : entry;
    const result = view.stat(stat, tags);
    return {
      stat,
      tags,
      value: result.value,
      result,
      breakdown: result.contributions.map((c) => ({
        sourceKind: c.source.kind,
        sourceRef: c.source.ref,
        kind: c.kind,
        value: c.value,
        effectId: c.effectId,
        local: db.effects.get(c.effectId)?.locality === "local",
      })),
    };
  });
}

/** 技1回のダメージの見積もり（キャラクターの画面・装備の比較の表示）。 */
export interface DamagePreview {
  /** 会心でないときの平均の打撃値（防御・耐性の前）。 */
  readonly average: number;
  readonly critChance: number;
  readonly critMultiplier: number;
  /** 会心の期待値を含む、1回の平均（防御・耐性・命中の前）。 */
  readonly expected: number;
  /** 1秒あたりの平均（expected × 攻撃速度。技の使用時間・クールダウンは含めない）。 */
  readonly perSecond: number;
}

/**
 * 技1回のダメージの見積もり。戦闘と同じ計算（computeHit）を、抽選せずに平均の値で行う。
 * 的は防御・耐性・回避なし（表示の比較のため）。
 */
export function damagePreview(
  sheet: CharacterSheet,
  skill: DamageSkill,
  rng: Rng,
  defender: DamageDefender = { resist: {}, armor: 0, evasion: 0 },
): DamagePreview {
  const r = computeHit(sheet.attacker, skill, defender, { rng, roll: "average" });
  // 会心の抽選の結果に依らない値にする（会心なら会心倍率で割り戻す）
  const average = r.crit ? r.preMitigationTotal / r.critMultiplier : r.preMitigationTotal;
  const expected = average * (1 + r.critChance * (r.critMultiplier - 1));
  return {
    average,
    critChance: r.critChance,
    critMultiplier: r.critMultiplier,
    expected,
    perSecond: expected * sheet.attackSpeed,
  };
}
