import type { Attributes } from "../character/progression.ts";
import type { DamageWeapon } from "../combat/damage.ts";
import type { StarRegion } from "../content/board.ts";
import type { ArmorType, ItemBaseDef } from "../content/item.ts";
import type { ContentDb } from "../content/load.ts";
import type { EquipSlot, FactId } from "../content/registries.ts";
import type { EffectInstance } from "../effects/evaluate.ts";
import { type ItemInstance, itemEffectInstances } from "./generate.ts";
import type { Inventory } from "./inventory.ts";

/** MVPで使う装備の部位（遺物を除く10部位。MVP実装単位1章）。 */
export const MVP_EQUIP_SLOTS = [
  "mainHand",
  "offHand",
  "head",
  "body",
  "hands",
  "feet",
  "belt",
  "neck",
  "ring1",
  "ring2",
  "relic",
] as const satisfies readonly EquipSlot[];
export type MvpEquipSlot = (typeof MVP_EQUIP_SLOTS)[number];

/** 防具の部位（統一ボーナスを数える部位。仕様書v0.2 3.3）。 */
export const ARMOR_SLOTS = [
  "head",
  "body",
  "hands",
  "feet",
  "belt",
] as const satisfies readonly MvpEquipSlot[];
/** 統一ボーナスに必要な、同じ防具種の部位の数（仕様書v0.2 3.3：4部位以上）。 */
export const UNIFORM_PIECES = 4;

/** 防具・盾の基礎性能の効果（値は装備ごとに差し替える。出どころは装備の uid）。 */
export const DEFENSE_EFFECTS = {
  armor: "EFF-BASE-ARMOR",
  evasion: "EFF-BASE-EVASION",
  ward: "EFF-BASE-WARD",
} as const;

/** 統一ボーナスの効果（仕様書v0.2 3.3。軽装の「回避した直後の移動速度」は、回避したときの一定時間の効果）。 */
export const UNIFORM_EFFECTS: Readonly<Record<ArmorType, string>> = {
  heavy: "EFF-UNIFORM-HEAVY",
  light: "EFF-UNIFORM-LIGHT-DODGE",
  robe: "EFF-UNIFORM-ROBE",
};

/** 強化1段階ごとの基礎性能（仕様書v0.2 3.9：+5%。+10で+50%）。 */
export const ENHANCE_STEP = 0.05;
/** 強化値の上限（仕様書v0.2 3.9）。 */
export const MAX_ENHANCE = 10;

/** 強化による基礎性能の倍率（1 ＋ 0.05 × 強化値）。 */
export function enhanceMultiplier(item: { readonly enhance?: number }): number {
  return 1 + ENHANCE_STEP * (item.enhance ?? 0);
}

/** 要求値を満たさないときの基礎性能の倍率（仕様書v0.2 2.2：基礎性能が-40%）。 */
export const UNMET_REQUIREMENT_MULTIPLIER = 0.6;

/**
 * そのベースを装備できる部位（仕様書v0.2 3.1）。
 * - 武器：主手。片手武器は、二刀流ができるなら副手にも（仕様書v0.2 3.2：戦士・盗賊だけ）
 * - 盾：副手。指輪：2つの指輪の部位のどちらか。その他：分類と同じ名前の部位
 */
export function slotsFor(base: ItemBaseDef, canDualWield: boolean): MvpEquipSlot[] {
  switch (base.category) {
    case "weapon":
      return base.weapon?.hands === 1 && canDualWield ? ["mainHand", "offHand"] : ["mainHand"];
    case "shield":
      return ["offHand"];
    case "ring":
      return ["ring1", "ring2"];
    default:
      return [base.category];
  }
}

/** 要求値を満たしているか（要求値の無いベースは常に満たす）。 */
export function requirementMet(base: ItemBaseDef, attributes: Attributes): boolean {
  const r = base.requirement;
  return r === undefined || attributes[r.attribute] >= r.value;
}

/**
 * 必要Lvに届いているか（キャラLv ≥ ベースの必要Lv）。{@link requirementMet} と同じ形。
 * 要求値と違い、届いていなければ装備できない（{@link equipFromInventory} が確かめる）。
 */
export function levelMet(base: ItemBaseDef, level: number): boolean {
  return level >= base.requiredLevel;
}

/** 基礎性能の倍率（要求値を満たさなければ0.6。仕様書v0.2 2.2・3.9 の基礎性能の定義）。 */
export function basePerformanceMultiplier(base: ItemBaseDef, attributes: Attributes): number {
  return requirementMet(base, attributes) ? 1 : UNMET_REQUIREMENT_MULTIPLIER;
}

function isTwoHanded(base: ItemBaseDef | undefined): boolean {
  return base?.category === "weapon" && base.weapon?.hands === 2;
}

/**
 * 装備している物（部位 → 装備の実体）。部位の規則：
 * - 両手武器を主手に持つと、副手は空になる
 * - 主手が両手武器のときに副手に装備すると、主手は空になる
 * 外れた物は、呼び出す側に返す（インベントリに戻す）。
 */
export class Equipment {
  private readonly db: ContentDb;
  private readonly slots = new Map<MvpEquipSlot, ItemInstance>();

  constructor(db: ContentDb) {
    this.db = db;
  }

  /** 同じ装備の写し（比較の表示で、装備したときの能力値を、状態を変えずに計算するため）。 */
  clone(): Equipment {
    const out = new Equipment(this.db);
    for (const [s, i] of this.slots) out.slots.set(s, i);
    return out;
  }

  get(slot: MvpEquipSlot): ItemInstance | undefined {
    return this.slots.get(slot);
  }

  /** 装備している物（部位の順）。 */
  entries(): [MvpEquipSlot, ItemInstance][] {
    return MVP_EQUIP_SLOTS.flatMap((s) => {
      const item = this.slots.get(s);
      return item === undefined ? [] : [[s, item] as [MvpEquipSlot, ItemInstance]];
    });
  }

  /** 装備の実体のベース。ベースが無ければ RangeError。 */
  baseOf(item: ItemInstance): ItemBaseDef {
    const base = this.db.itemBases.get(item.base);
    if (base === undefined) throw new RangeError(`ベース ${item.base} が無い`);
    return base;
  }

  /**
   * 装備したときに外れる物（状態は変えない）。部位に装備できない物なら RangeError。
   */
  displaced(item: ItemInstance, slot: MvpEquipSlot, canDualWield: boolean): ItemInstance[] {
    const base = this.baseOf(item);
    if (!slotsFor(base, canDualWield).includes(slot))
      throw new RangeError(`${item.base} は ${slot} に装備できない`);
    if ([...this.slots.values()].some((i) => i.uid === item.uid))
      throw new RangeError(`${item.uid} はすでに装備している`);
    const out: ItemInstance[] = [];
    const current = this.slots.get(slot);
    if (current !== undefined) out.push(current);
    if (slot === "mainHand" && isTwoHanded(base)) {
      const off = this.slots.get("offHand");
      if (off !== undefined) out.push(off);
    }
    if (slot === "offHand") {
      const main = this.slots.get("mainHand");
      if (main !== undefined && isTwoHanded(this.baseOf(main))) out.push(main);
    }
    return out;
  }

  /** 装備する。外れた物を返す（{@link displaced} と同じ）。 */
  equip(item: ItemInstance, slot: MvpEquipSlot, canDualWield: boolean): ItemInstance[] {
    const out = this.displaced(item, slot, canDualWield);
    for (const [s, i] of this.slots) if (out.includes(i)) this.slots.delete(s);
    this.slots.set(slot, item);
    return out;
  }

  /** 外す。外した物を返す。 */
  unequip(slot: MvpEquipSlot): ItemInstance | undefined {
    const item = this.slots.get(slot);
    this.slots.delete(slot);
    return item;
  }

  /** 装備の効果（基本刻印と詞）。効果の評価に渡す。 */
  effects(): EffectInstance[] {
    return this.entries().flatMap(([, item]) => itemEffectInstances(this.db, item));
  }

  /**
   * 防具・盾の基礎性能（防具値・回避値・魔障）の効果。強化（+5%／段階）と要求値の未達（-40%）を掛ける
   * （仕様書v0.2 3.3・3.9）。統一ボーナスの常に効く効果（重装・法衣）も含める。
   */
  defenseEffects(attributes: Attributes): EffectInstance[] {
    const out: EffectInstance[] = [];
    for (const [, item] of this.entries()) {
      const base = this.baseOf(item);
      const d = base.defense;
      if (d === undefined) continue;
      const m = basePerformanceMultiplier(base, attributes) * enhanceMultiplier(item);
      const source = { kind: "equipment", ref: item.uid };
      for (const key of ["armor", "evasion", "ward"] as const) {
        const v = d[key];
        if (v !== undefined) out.push({ effectId: DEFENSE_EFFECTS[key], source, values: [v * m] });
      }
    }
    const uniform = this.uniformType();
    if (uniform !== undefined && uniform !== "light")
      out.push({ effectId: UNIFORM_EFFECTS[uniform], source: { kind: "uniform", ref: uniform } });
    return out;
  }

  /**
   * 条件・数に使う事実（仕様書の「重装4部位以上」「主手が空」「二刀流」など）：防具種ごとの部位の数・
   * 主手が空なら1・副手に武器（二刀流）なら1。
   */
  facts(): Partial<Record<FactId, number>> {
    const out: Partial<Record<FactId, number>> = {
      "armor.heavy.count": 0,
      "armor.light.count": 0,
      "armor.robe.count": 0,
      "mainHand.empty": this.slots.has("mainHand") ? 0 : 1,
    };
    for (const slot of ARMOR_SLOTS) {
      const item = this.slots.get(slot);
      const t = item === undefined ? undefined : this.baseOf(item).defense?.type;
      if (t !== undefined) out[`armor.${t}.count`] = (out[`armor.${t}.count`] ?? 0) + 1;
    }
    const off = this.slots.get("offHand");
    out.dualWield = off !== undefined && this.baseOf(off).category === "weapon" ? 1 : 0;
    out["enhance.total"] = this.entries().reduce((s, [, i]) => s + (i.enhance ?? 0), 0);
    const main = this.slots.get("mainHand");
    out.twoHanded = main !== undefined && isTwoHanded(this.baseOf(main)) ? 1 : 0;
    return out;
  }

  /** 星域ごとの共鳴紋の数（仕様書v0.2 6.1 I-01・I-02）。 */
  resonance(): Partial<Record<StarRegion, number>> {
    const out: Partial<Record<StarRegion, number>> = {};
    for (const [, item] of this.entries())
      for (const a of item.affixes) {
        const r = this.db.affixes.get(a.id)?.resonance;
        if (r !== undefined) out[r] = (out[r] ?? 0) + 1;
      }
    return out;
  }

  /** 統一ボーナスの防具種（防具の5部位のうち4部位以上が同じ種類。仕様書v0.2 3.3）。無ければ undefined。 */
  uniformType(): ArmorType | undefined {
    const counts = new Map<ArmorType, number>();
    for (const slot of ARMOR_SLOTS) {
      const item = this.slots.get(slot);
      const t = item === undefined ? undefined : this.baseOf(item).defense?.type;
      if (t !== undefined) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    for (const [t, n] of counts) if (n >= UNIFORM_PIECES) return t;
    return undefined;
  }

  /** 部位ごとの装備のタグ（条件「主手に剣系」などの判定に使う）。 */
  equippedTags(): Partial<Record<EquipSlot, readonly string[]>> {
    const out: Partial<Record<EquipSlot, readonly string[]>> = {};
    for (const [slot, item] of this.entries()) out[slot] = this.baseOf(item).tags;
    return out;
  }

  /**
   * 主手の武器（ダメージの計算に渡す形）と攻撃速度（回/秒。武器の基礎の値）。主手が空なら undefined。
   * 基礎ダメージ（基礎性能）だけに、強化（+5%／段階）と要求値の未達（-40%）を掛ける。会心率・攻撃速度は変わらない
   * （仕様書v0.2 3.9）。
   */
  mainWeapon(
    attributes: Attributes,
  ): { readonly weapon: DamageWeapon; readonly attackSpeed: number } | undefined {
    return this.weaponIn("mainHand", attributes);
  }

  /** 副手の武器（二刀流。仕様書v0.2 3.2：それぞれの手の武器のダメージを使う）。盾・空なら undefined。 */
  offWeapon(
    attributes: Attributes,
  ): { readonly weapon: DamageWeapon; readonly attackSpeed: number } | undefined {
    return this.weaponIn("offHand", attributes);
  }

  private weaponIn(
    slot: "mainHand" | "offHand",
    attributes: Attributes,
  ): { readonly weapon: DamageWeapon; readonly attackSpeed: number } | undefined {
    const item = this.slots.get(slot);
    if (item === undefined) return undefined;
    const base = this.baseOf(item);
    const w = base.weapon;
    if (w === undefined) return undefined;
    const m = basePerformanceMultiplier(base, attributes) * enhanceMultiplier(item);
    return {
      weapon: {
        uid: item.uid,
        tags: base.tags,
        base: { physical: { min: w.damage.physical.min * m, max: w.damage.physical.max * m } },
        critChance: w.critChance,
      },
      attackSpeed: w.attackSpeed,
    };
  }
}

/**
 * インベントリの装備を装備する（外れた物はインベントリに戻す）。
 * 次のときは、何も変えずに false：
 * - キャラLv（`level`）が、その装備の必要Lv（`ItemBaseDef.requiredLevel`）に届いていない
 * - 外れた物がインベントリに入りきらない（両手武器で主手と副手が外れる場合など）
 *
 * 必要Lvを確かめるのはここだけにしている。{@link Equipment.equip}・{@link Equipment.displaced} は
 * 部位の規則だけを扱う低い層で、セーブデータを読み込むときにも使う。そこで確かめると、
 * 読み込みの順（キャラLvを戻す前に装備を戻す、など）や仕様の変更で、すでに着ている装備が
 * 読み込めなくなるおそれがあるため。プレイヤーが装備を着る経路（画面・ロードアウトの切り替えなど）は、
 * この関数を通す。
 */
export function equipFromInventory(
  inventory: Inventory,
  equipment: Equipment,
  uid: string,
  slot: MvpEquipSlot,
  canDualWield: boolean,
  level: number,
): boolean {
  const item = inventory.items.find((i) => i.uid === uid);
  if (item === undefined) throw new RangeError(`インベントリに ${uid} が無い`);
  const out = equipment.displaced(item, slot, canDualWield);
  if (!levelMet(equipment.baseOf(item), level)) return false;
  // 装備する物が1枠空け、外れた物が枠を使う
  if (inventory.items.length - 1 + out.length > inventory.capacity) return false;
  inventory.removeItem(uid);
  equipment.equip(item, slot, canDualWield);
  for (const i of out) inventory.addItem(i);
  return true;
}

/** 装備を外して、インベントリに戻す。インベントリがいっぱいなら、何も変えずに false。 */
export function unequipToInventory(
  inventory: Inventory,
  equipment: Equipment,
  slot: MvpEquipSlot,
): boolean {
  if (equipment.get(slot) === undefined) return true;
  if (inventory.full) return false;
  const item = equipment.unequip(slot);
  if (item !== undefined) inventory.addItem(item);
  return true;
}
