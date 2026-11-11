import { ELEMENTS, type Element } from "../content/effect.ts";
import type { ArmorType, LatentCondition } from "../content/item.ts";
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
import { type StarBoardResult, evaluateStarBoard, starPoints } from "../board/star-board.ts";
import {
  type EffectInstance,
  type EvaluatedEffects,
  type StatResult,
  evaluateEffects,
  stageOneView,
} from "../effects/evaluate.ts";
import type { TagIndex } from "../effects/tag-index.ts";
import { type JobBoardAllocation, jobBoardPoints } from "../board/job-board.ts";
import type { Equipment } from "../items/equipment.ts";
import { requirementMet } from "../items/equipment.ts";
import type { ItemInstance } from "../items/generate.ts";
import { ATTRIBUTE_EFFECTS, type Attributes, type Character } from "./progression.ts";

/** 能力値の数値（能力値の小星・装備で増える。仕様書v0.2 2.2・4.3）。基礎の値は出自の初期能力値。 */
export const ATTRIBUTE_STATS: Readonly<Record<keyof Attributes, string>> = {
  go: "STAT-ATTR-GO",
  jin: "STAT-ATTR-JIN",
  ri: "STAT-ATTR-RI",
  kon: "STAT-ATTR-KON",
};

/** 会心率の増加をダメージに変える能力値と、その効果（盲目の賢者の目隠し）。 */
const CRIT_TO_DAMAGE_STAT = "STAT-UNQ-CRIT-TO-DAMAGE";
const CRIT_TO_DAMAGE_EFFECT = "EFF-UNQ-U06-CONVERTED";

/** 魔障が回復し始めるまでの秒数の基礎（仕様書v0.2 2.6：2秒）。 */
export const BASE_WARD_DELAY = 2;
/** 移動速度の倍率の下限。 */
export const MIN_MOVE_SPEED_FACTOR = 0.1;

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
  /** 星辰盤の取得（取った順）とポイント（省略すると星辰盤なし）。 */
  readonly starBoard?: {
    readonly allocation: readonly string[];
    /** 省略すると {@link starPoints}（キャラLv−1）。 */
    readonly points?: number;
  };
  /** メインジョブの職紋盤の取得（省略すると職紋盤なし）。ポイントはメインジョブのジョブLv−1。 */
  readonly jobBoard?: JobBoardAllocation;
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
  /** 能力値（出自の初期能力値＋星辰盤・装備の分。第1段階の値。仕様書v0.2 4.9.1）。 */
  readonly attributes: Attributes;
  /** 星辰盤の評価（星辰盤を渡さなければ undefined）。 */
  readonly board: StarBoardResult | undefined;
  /** ダメージの計算に渡す、攻撃する側。 */
  readonly attacker: DamageAttacker;
  /** 主手の武器（素手なら undefined）。 */
  readonly weapon: SheetWeapon | undefined;
  /**
   * 副手の武器で攻撃する側（二刀流のとき。通常攻撃と連撃の技の、副手のヒットに使う。仕様書v0.2 3.2）。
   * 二刀流でなければ undefined。
   */
  readonly offAttacker: DamageAttacker | undefined;
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
  /** 受ける側の値（防具・耐性・回避・魔障。仕様書v0.2 2.6・3.3）。戦闘の受ける側に渡す。 */
  readonly defense: {
    readonly armor: number;
    readonly evasion: number;
    readonly resist: Readonly<Record<Element, number>>;
    readonly maxWard: number;
    /** 魔障が回復し始めるまでの秒数（法衣の統一ボーナスで-1秒）。 */
    readonly wardRechargeDelay: number;
    /** 受けるダメージ・崩し値の倍率（自己強化・重装の統一ボーナス）。 */
    readonly damageTaken: number;
    readonly staggerTaken: number;
  };
  /** 移動速度の倍率（1 ＋ 移動速度の増加。大盾・重鎖の帯・亀裂・軽装の統一ボーナスなど）。 */
  readonly moveSpeed: number;
  /** メインジョブの職紋盤の有効なノード（職奥義を含む）。 */
  readonly jobNodes: ReadonlySet<string>;
  /** 統一ボーナスの防具種（4部位以上。仕様書v0.2 3.3）。 */
  readonly uniform: ArmorType | undefined;
  /** 装備しているユニークの潜在効果と、条件を満たしているか（仕様書v0.2 3.7）。 */
  readonly latents: readonly {
    readonly uid: string;
    readonly base: string;
    readonly active: boolean;
  }[];
}

/** 潜在効果の条件を満たしているか（星座・星辰盤のノード・メインジョブ・強化値。職紋盤は U-15 の後）。 */
export function latentConditionMet(
  cond: LatentCondition,
  ctx: {
    readonly board: StarBoardResult | undefined;
    readonly mainJobTag: string;
    readonly enhance: number;
    /** メインジョブの職紋盤の有効なノード（職奥義を含む）。 */
    readonly jobNodes?: ReadonlySet<string>;
  },
): boolean {
  switch (cond.type) {
    case "constellation":
      return cond.pending !== true && (ctx.board?.constellations.includes(cond.id) ?? false);
    case "starNode":
      return cond.pending !== true && (ctx.board?.active.includes(cond.id) ?? false);
    case "jobNode":
    case "jobMastery":
      return cond.pending !== true && (ctx.jobNodes?.has(cond.id) ?? false);
    case "mainJob":
      return ctx.mainJobTag === cond.job;
    case "enhanceAtLeast":
      return ctx.enhance >= cond.value;
  }
}

/** キャラクターの能力値を計算する（装備・能力値・一時的な効果を、効果の評価にまとめて渡す）。 */
export function buildCharacterSheet(
  db: ContentDb,
  tags: TagIndex,
  input: CharacterSheetInput,
): CharacterSheet {
  const { character, job, equipment } = input;
  const origin = character.attributes;
  const baseStats: Record<string, number> = { ...character.baseStats() };
  if (db.stats.has("STAT-WARD-DELAY")) baseStats["STAT-WARD-DELAY"] = BASE_WARD_DELAY;
  for (const k of Object.keys(ATTRIBUTE_STATS) as (keyof Attributes)[])
    if (db.stats.has(ATTRIBUTE_STATS[k])) baseStats[ATTRIBUTE_STATS[k]] = origin[k];
  const facts = {
    baseStats,
    equippedTags: equipment?.equippedTags() ?? {},
    mainJob: job.tag,
    facts: equipment?.facts() ?? { "mainHand.empty": 1 },
  };
  // 職紋盤（メインジョブの盤だけ。仕様書v0.2 4.10）
  const jobBoard = input.jobBoard?.job === job.id ? input.jobBoard : undefined;
  const jobPoints = jobBoardPoints(character.jobLevel(job.id));
  const jobActive = new Set(jobBoard?.active(jobPoints) ?? []);
  const gear = [
    ...(input.extraEffects ?? []),
    ...(equipment?.effects() ?? []),
    ...(jobBoard?.effects(jobPoints) ?? []),
  ];
  // 星辰盤：星門の条件は、第1段階の値（基礎・装備・星門を通らないノード）で判定する
  const board =
    input.starBoard === undefined
      ? undefined
      : evaluateStarBoard(db, tags, {
          allocation: input.starBoard.allocation,
          points: input.starBoard.points ?? starPoints(character.level),
          rootJob: job.id,
          // 接続ノードを1つ取るごとに、×2にする範囲が1ノード広がる（3つで半径3。docs/progress D-U15-3）
          boostRadius: jobBoard?.connectors(jobPoints) ?? 0,
          baseInstances: gear,
          facts,
        });
  const unconditional = [...gear, ...(board?.effects ?? [])];
  // 能力値：出自＋能力値の小星・装備の分（第1段階の値。要求値の判定にもこの値を使う）
  const stage1 = stageOneView(db, tags, unconditional, facts);
  const attributes = Object.fromEntries(
    (Object.keys(ATTRIBUTE_STATS) as (keyof Attributes)[]).map((k) => [
      k,
      db.stats.has(ATTRIBUTE_STATS[k])
        ? Math.max(0, Math.floor(stage1.stat(ATTRIBUTE_STATS[k]).value))
        : origin[k],
    ]),
  ) as unknown as Attributes;
  const attributeEffects: EffectInstance[] = (
    Object.keys(ATTRIBUTE_EFFECTS) as (keyof Attributes)[]
  )
    .filter((k) => attributes[k] > 0)
    .map((k) => ({
      effectId: ATTRIBUTE_EFFECTS[k],
      source: { kind: "attribute", ref: k },
      stacks: attributes[k],
    }));
  // ユニークの潜在効果：条件を満たしたものだけ効く
  const latents: { uid: string; base: string; active: boolean }[] = [];
  const latentEffects: EffectInstance[] = [];
  for (const [, item] of equipment?.entries() ?? []) {
    const u = db.itemBases.get(item.base)?.unique;
    if (u === undefined) continue;
    const active = latentConditionMet(u.latent.condition, {
      board,
      mainJobTag: job.tag,
      enhance: item.enhance ?? 0,
      jobNodes: jobActive,
    });
    latents.push({ uid: item.uid, base: item.base, active });
    if (active)
      for (const effectId of u.latent.effects)
        latentEffects.push({ effectId, source: { kind: "equipment", ref: item.uid } });
  }
  const instances = [
    ...unconditional,
    ...attributeEffects,
    ...(equipment?.defenseEffects(attributes) ?? []),
    ...latentEffects,
  ];
  let evaluated = evaluateEffects(db, tags, instances, facts);
  // 盲目の賢者の目隠し（U06）：会心率の増加1%ごとに、ダメージ+0.5%（加算）。会心率の増加を見てから足す
  if (db.stats.has(CRIT_TO_DAMAGE_STAT) && db.effects.has(CRIT_TO_DAMAGE_EFFECT)) {
    const ratio = evaluated.view.stat(CRIT_TO_DAMAGE_STAT).value;
    const critInc = evaluated.view.stat("STAT-CRIT-CHANCE").increased;
    if (ratio > 0 && critInc > 0)
      evaluated = evaluateEffects(
        db,
        tags,
        [
          ...instances,
          {
            effectId: CRIT_TO_DAMAGE_EFFECT,
            source: { kind: "unique", ref: CRIT_TO_DAMAGE_STAT },
            values: [ratio * critInc],
          },
        ],
        facts,
      );
  }
  const view = evaluated.view;
  const main = equipment?.mainWeapon(attributes);
  const off = main === undefined ? undefined : equipment?.offWeapon(attributes);
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
    board,
    attacker: {
      db,
      view,
      characterLevel: character.level,
      ...(main === undefined ? {} : { weapon: main.weapon }),
    },
    weapon,
    offAttacker:
      off === undefined
        ? undefined
        : { db, view, characterLevel: character.level, weapon: off.weapon },
    weaponTags,
    affinity,
    attackSpeed,
    maxHp: view.stat("STAT-HP-MAX").value,
    maxMp: view.stat("STAT-MP-MAX").value,
    effectDuration: 1 + view.stat("STAT-EFFECT-DURATION").increased,
    defense: {
      armor: view.stat("STAT-ARMOR").value,
      evasion: view.stat("STAT-EVASION").value,
      resist: Object.fromEntries(
        ELEMENTS.map((e) => {
          const id = `STAT-RESIST-${e.toUpperCase()}`;
          return [e, db.stats.has(id) ? view.stat(id).value : 0];
        }),
      ) as Record<Element, number>,
      maxWard: db.stats.has("STAT-WARD-MAX") ? view.stat("STAT-WARD-MAX").value : 0,
      wardRechargeDelay: db.stats.has("STAT-WARD-DELAY")
        ? view.stat("STAT-WARD-DELAY").value
        : BASE_WARD_DELAY,
      damageTaken: multiplierOf(view.stat("STAT-DAMAGE-TAKEN")),
      staggerTaken: multiplierOf(view.stat("STAT-STAGGER-TAKEN")),
    },
    moveSpeed: Math.max(MIN_MOVE_SPEED_FACTOR, 1 + view.stat("STAT-MOVE-SPEED").increased),
    uniform: equipment?.uniformType(),
    jobNodes: jobActive,
    latents,
  };
}

/** 受ける側の倍率（加算と乗算。0未満にはしない）。 */
function multiplierOf(r: StatResult): number {
  return Math.max(0, (1 + r.increased) * r.more);
}

/** キャラクターの画面に並べる能力値1つ（タグの条件つきの修正値は、tags の文脈で集計する）。 */
export interface SheetStat {
  readonly stat: string;
  /** 集計の文脈のタグ（例：物理ダメージ増加は TAG-ELEM-PHYSICAL）。 */
  readonly tags?: readonly string[];
}

/** キャラクターの画面に並べる能力値（補助仕様書16章「能力値と、修正値の内訳」）。 */
export const SHEET_STATS: readonly SheetStat[] = [
  { stat: "STAT-ATTR-GO" },
  { stat: "STAT-ATTR-JIN" },
  { stat: "STAT-ATTR-RI" },
  { stat: "STAT-ATTR-KON" },
  { stat: "STAT-HP-MAX" },
  { stat: "STAT-MP-MAX" },
  { stat: "STAT-ACCURACY" },
  { stat: "STAT-ARMOR" },
  { stat: "STAT-EVASION" },
  { stat: "STAT-WARD-MAX" },
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
