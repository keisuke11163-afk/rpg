/**
 * 装備（部位ごとの着脱）と、装備から決まる能力値の計算（本仕様書 2.2・3.1・3.9）。
 * 能力値は保存せず、装備が変わるたびに計算し直す。
 */
import type { AffixDef, ItemBase, ItemInstance, RolledAffix, Slot } from "./types.ts";

export const EQUIP_SLOTS = [
  "主手",
  "副手",
  "頭",
  "胴",
  "手",
  "足",
  "腰",
  "首",
  "指輪1",
  "指輪2",
] as const;
export type EquipSlot = (typeof EQUIP_SLOTS)[number];

/** 要求値の未達で、基礎性能が-40%（本仕様書 2.2） */
export const REQUIREMENT_PENALTY = 0.6;

export interface GearData {
  bases: ReadonlyMap<string, ItemBase>;
  affixes: ReadonlyMap<string, AffixDef>;
  /** ベースの基本刻印の数値（ベースID → 能力値の名前 → 値）。百分率の値は 0.15 のように比で持つ */
  implicit: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

export function makeGearData(
  bases: readonly ItemBase[],
  affixes: readonly AffixDef[],
  implicit: GearData["implicit"],
): GearData {
  return {
    bases: new Map(bases.map((b) => [b.id, b])),
    affixes: new Map(affixes.map((a) => [a.id, a])),
    implicit,
  };
}

export type EquipDenied = "slot" | "twoHanded" | "dualWield" | "empty";

export class Equipment {
  private readonly slots = new Map<EquipSlot, ItemInstance>();

  get(slot: EquipSlot): ItemInstance | undefined {
    return this.slots.get(slot);
  }

  /** 着替えの比較などのための写し */
  clone(): Equipment {
    const copy = new Equipment();
    for (const [slot, item] of this.slots) copy.slots.set(slot, item);
    return copy;
  }

  all(): [EquipSlot, ItemInstance][] {
    return EQUIP_SLOTS.flatMap((s) => {
      const item = this.slots.get(s);
      return item ? [[s, item] as [EquipSlot, ItemInstance]] : [];
    });
  }

  /** 装備できる部位の候補 */
  slotsFor(base: ItemBase, canDualWield: boolean): EquipSlot[] {
    if (base.slot === "指輪") return ["指輪1", "指輪2"];
    if (base.slot === "主手" && base.kind === "weapon" && base.hands === 1 && canDualWield) {
      return ["主手", "副手"];
    }
    return [base.slot];
  }

  /**
   * 装備する。置き換えられたアイテムを返す。両手武器は副手を空ける。
   * 副手に片手武器を持てるのは、二刀流ができるジョブだけ（本仕様書 3.2）。
   */
  equip(
    item: ItemInstance,
    data: GearData,
    options: { slot?: EquipSlot; canDualWield?: boolean } = {},
  ): { ok: boolean; reason?: EquipDenied; replaced: ItemInstance[]; slot?: EquipSlot } {
    const base = data.bases.get(item.baseId);
    if (!base) return { ok: false, reason: "empty", replaced: [] };
    const candidates = this.slotsFor(base, options.canDualWield === true);
    const slot: EquipSlot | undefined =
      options.slot ?? candidates.find((s) => !this.slots.has(s)) ?? candidates[0];
    if (slot === undefined || !candidates.includes(slot)) {
      return { ok: false, reason: "slot", replaced: [] };
    }

    const replaced: ItemInstance[] = [];
    const take = (s: EquipSlot): void => {
      const old = this.slots.get(s);
      if (old) {
        replaced.push(old);
        this.slots.delete(s);
      }
    };
    if (slot === "副手") {
      // 副手：盾・片手武器。主手が両手武器なら装備できない
      const main = this.slots.get("主手");
      const mainBase = main ? data.bases.get(main.baseId) : undefined;
      if (mainBase?.hands === 2) return { ok: false, reason: "twoHanded", replaced: [] };
      if (base.kind === "weapon" && options.canDualWield !== true) {
        return { ok: false, reason: "dualWield", replaced: [] };
      }
    }
    take(slot);
    if (slot === "主手" && base.hands === 2) take("副手");
    this.slots.set(slot, item);
    return { ok: true, replaced, slot };
  }

  unequip(slot: EquipSlot): ItemInstance | undefined {
    const item = this.slots.get(slot);
    this.slots.delete(slot);
    return item;
  }
}

export interface WeaponStats {
  min: number;
  max: number;
  speed: number;
  crit: number;
  /** 局所の追加ダメージ（武器の詞）。基礎値に加わり、技倍率を受ける */
  addedPhysical: { min: number; max: number };
  addedFire: { min: number; max: number };
  baseId: string;
  weaponClass: ItemBase["weaponClass"];
}

export interface BreakdownLine {
  slot: EquipSlot;
  uid: string;
  source: string;
  stat: string;
  value: number;
}

export interface GearStats {
  weapon: WeaponStats | undefined;
  /** 能力値の名前ごとの合計。百分率の値は比（0.07 = +7%）。基礎性能の値は実数 */
  totals: Record<string, number>;
  armor: number;
  evasion: number;
  barrier: number;
  /** 要求値の未達で、基礎性能が-40%になっている装備 */
  penalized: EquipSlot[];
  breakdown: BreakdownLine[];
}

/** 百分率として扱う詞（値を100で割って比にする）。「追加」「最大HP」などは実数 */
const PERCENT_STAT = /%|速度|耐性|付与率|短縮|率/;
export function isPercentStat(stat: string): boolean {
  return PERCENT_STAT.test(stat) && !/追加|最大HP/.test(stat);
}

/** 装備から、能力値を計算する。characterStats は剛・迅・理・魂（要求値の判定に使う。装備の能力値は含めない＝第1段階の値） */
export function computeGear(
  equipment: Equipment,
  data: GearData,
  characterStats: Readonly<Record<string, number>>,
): GearStats {
  const out: GearStats = {
    weapon: undefined,
    totals: {},
    armor: 0,
    evasion: 0,
    barrier: 0,
    penalized: [],
    breakdown: [],
  };
  const add = (slot: EquipSlot, uid: string, source: string, stat: string, value: number): void => {
    out.totals[stat] = (out.totals[stat] ?? 0) + value;
    out.breakdown.push({ slot, uid, source, stat, value });
  };

  for (const [slot, item] of equipment.all()) {
    const base = data.bases.get(item.baseId);
    if (!base) continue;
    const unmet = base.requirement
      ? (characterStats[base.requirement.stat] ?? 0) < base.requirement.value
      : false;
    if (unmet) out.penalized.push(slot);
    const perf = unmet ? REQUIREMENT_PENALTY : 1;

    // 防具・盾の基礎性能
    if (base.defense) {
      const v = base.defense.value * perf;
      if (base.defense.kind === "armor") out.armor += v;
      else if (base.defense.kind === "evasion") out.evasion += v;
      else out.barrier += v;
    }

    // 武器：主手の武器が攻撃の基準。副手の片手武器（二刀流）は別に扱う（U-12 では主手のみ）
    if (base.weapon && slot === "主手") {
      const w: WeaponStats = {
        min: base.weapon.min * perf,
        max: base.weapon.max * perf,
        speed: base.weapon.speed,
        crit: base.weapon.crit,
        addedPhysical: { min: 0, max: 0 },
        addedFire: { min: 0, max: 0 },
        baseId: base.id,
        weaponClass: base.weaponClass,
      };
      out.weapon = w;
    }

    // 基本刻印
    for (const [stat, value] of Object.entries(data.implicit[base.id] ?? {})) {
      add(slot, item.uid, `基本刻印（${base.name}）`, stat, value);
    }

    // 詞
    for (const a of item.affixes) {
      const def = data.affixes.get(a.id);
      if (!def) continue;
      applyAffix(out, slot, item, a, def, add);
    }
  }
  // 基本刻印の「防具値+15%」など、実数への影響
  out.armor *= 1 + (out.totals["防具値増加"] ?? 0);
  return out;
}

function applyAffix(
  out: GearStats,
  slot: EquipSlot,
  item: ItemInstance,
  a: RolledAffix,
  def: AffixDef,
  add: (slot: EquipSlot, uid: string, source: string, stat: string, value: number) => void,
): void {
  const label = `${def.name}（T${String(a.tier)}）`;
  // 武器の詞の追加ダメージは、その武器だけに効く（局所。本仕様書 3.7 の5）
  if (def.added === true && slot === "主手" && out.weapon) {
    const [min = 0, max = 0] = a.rolls;
    const target = def.stat === "火ダメージ追加" ? out.weapon.addedFire : out.weapon.addedPhysical;
    target.min += min;
    target.max += max;
    add(slot, item.uid, label, def.stat, (min + max) / 2);
    return;
  }
  const raw = a.rolls[0] ?? 0;
  add(slot, item.uid, label, def.stat, isPercentStat(def.stat) ? raw / 100 : raw);
}

/** 能力値（剛・迅・理・魂）に、装備の加算を足した値 */
export function withGearStats(
  base: Readonly<Record<string, number>>,
  gear: GearStats,
): Record<string, number> {
  const out = { ...base };
  const all = gear.totals["全能力値"] ?? 0;
  for (const k of ["剛", "迅", "理", "魂"]) out[k] = (out[k] ?? 0) + all + (gear.totals[k] ?? 0);
  return out;
}

export type { Slot };
