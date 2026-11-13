import {
  type CharacterSheet,
  type CharacterSheetInput,
  type DamagePreview,
  type SheetStat,
  SHEET_STATS,
  buildCharacterSheet,
  damagePreview,
  sheetRows,
} from "../character/sheet.ts";
import type { DamageSkill } from "../combat/damage.ts";
import type { ContentDb } from "../content/load.ts";
import type { StatResult } from "../effects/evaluate.ts";
import type { TagIndex } from "../effects/tag-index.ts";
import { Rng } from "../random/rng.ts";
import type { Equipment, MvpEquipSlot } from "./equipment.ts";
import type { ItemInstance } from "./generate.ts";

/** 能力値1つの変化（まとめた値だけでなく、加算・乗算・追加のどれかが変われば変化とする）。 */
export interface StatChange {
  readonly stat: string;
  readonly tags: readonly string[];
  readonly before: StatResult;
  readonly after: StatResult;
}

/** 装備の比較の結果（補助仕様書16章「装備の比較」）。 */
export interface EquipComparison {
  readonly slot: MvpEquipSlot;
  /** 装備すると外れる物（両手武器で副手も外れる場合を含む）。 */
  readonly displaced: readonly ItemInstance[];
  /** 値が変わる能力値だけ。 */
  readonly changes: readonly StatChange[];
  readonly attackSpeed: { readonly before: number; readonly after: number };
  /** 技のダメージの見積もり（指定したときだけ）。 */
  readonly damage: { readonly before: DamagePreview; readonly after: DamagePreview } | undefined;
  /** 装備した後の能力値（比較の元の計算。表示と戦闘で同じ計算）。 */
  readonly afterSheet: CharacterSheet;
}

export interface CompareOptions {
  /** ダメージの見積もりに使う技（例：通常攻撃）。 */
  readonly skill?: DamageSkill;
  readonly stats?: readonly SheetStat[];
  readonly canDualWield: boolean;
}

const sameNumber = (a: number, b: number): boolean =>
  Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));

/** 表示に出る部分（まとめた値・追加・固定の追加・加算・乗算・上限）が同じか。 */
function sameResult(a: StatResult, b: StatResult): boolean {
  return (
    sameNumber(a.value, b.value) &&
    sameNumber(a.added.min, b.added.min) &&
    sameNumber(a.added.max, b.added.max) &&
    sameNumber(a.fixedAdded.min, b.fixedAdded.min) &&
    sameNumber(a.fixedAdded.max, b.fixedAdded.max) &&
    sameNumber(a.increased, b.increased) &&
    sameNumber(a.more, b.more) &&
    a.cap === b.cap
  );
}

/**
 * 装備したときの能力値の変化を、今の装備を変えずに計算する（装備の写しで計算する）。
 * 装備した後の値は、実際に装備したときの戦闘の値と同じ計算（buildCharacterSheet）で出す。
 */
export function compareEquip(
  db: ContentDb,
  tags: TagIndex,
  input: CharacterSheetInput & { readonly equipment: Equipment },
  item: ItemInstance,
  slot: MvpEquipSlot,
  options: CompareOptions,
): EquipComparison {
  const before = buildCharacterSheet(db, tags, input);
  const next = input.equipment.clone();
  const displaced = next.equip(item, slot, options.canDualWield);
  const after = buildCharacterSheet(db, tags, { ...input, equipment: next });
  const stats = options.stats ?? SHEET_STATS;
  const a = sheetRows(db, before, stats);
  const b = sheetRows(db, after, stats);
  const changes: StatChange[] = [];
  a.forEach((row, i) => {
    const after = b[i]?.result ?? row.result;
    if (!sameResult(row.result, after))
      changes.push({ stat: row.stat, tags: row.tags, before: row.result, after });
  });
  const skill = options.skill;
  return {
    slot,
    displaced,
    changes,
    attackSpeed: { before: before.attackSpeed, after: after.attackSpeed },
    damage:
      skill === undefined
        ? undefined
        : {
            before: damagePreview(before, skill, Rng.fromSeed("compare")),
            after: damagePreview(after, skill, Rng.fromSeed("compare")),
          },
    afterSheet: after,
  };
}
