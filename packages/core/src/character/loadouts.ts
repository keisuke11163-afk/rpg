import type { MvpEquipSlot } from "../items/equipment.ts";

/** ロードアウトの数（仕様書v0.2 4.13：3つまで。拡張で5つまで）。 */
export const MAX_LOADOUTS = 3;

/**
 * ロードアウト（仕様書v0.2 4.13）：装備の参照・星辰盤の配置・メインジョブをまとめて保存する。
 * 装備は実体を参照する（同じ装備を複数のロードアウトに登録できる）。
 */
export interface LoadoutRecord {
  readonly id: number;
  readonly name: string;
  readonly mainJob: string;
  /** 部位 → 装備の uid。 */
  readonly equipment: Readonly<Partial<Record<MvpEquipSlot, string>>>;
  /** 星辰盤の取得（取った順）。 */
  readonly starAllocation: readonly string[];
  /** 追加の入口（星渡りの外套など。MVPでは使わず、セーブデータの値を保つ）。 */
  readonly extraEntries: readonly string[];
  /**
   * 職紋盤の取得（ジョブ → 取った順のノード。職奥義の選択はノードから決まる）。仕様書v0.2 4.13「全てのツリーの配置」。
   * 省略は「このロードアウトでは別に持っていない」（版2の古いセーブデータ）：切り替えても今の職紋盤のまま
   * （docs/progress D-AUTO-3）。使っているロードアウトの分は、セーブデータの jobs[].board_allocation が正。
   */
  readonly jobBoards?: Readonly<Record<string, readonly string[]>>;
}

/** 新しいロードアウト（空の装備・星辰盤）。 */
export function emptyLoadout(id: number, mainJob: string): LoadoutRecord {
  if (!(Number.isInteger(id) && id >= 1 && id <= MAX_LOADOUTS))
    throw new RangeError(`ロードアウトの id は1〜${String(MAX_LOADOUTS)}（${String(id)}）`);
  return {
    id,
    name: `ロードアウト${String(id)}`,
    mainJob,
    equipment: {},
    starAllocation: [],
    extraEntries: [],
  };
}

/** その装備を登録しているロードアウトの id（なくす前の確認の表示に使う）。 */
export function loadoutsUsing(loadouts: readonly LoadoutRecord[], uid: string): number[] {
  return loadouts.filter((l) => Object.values(l.equipment).includes(uid)).map((l) => l.id);
}

/**
 * 装備がなくなったとき（分解・売却など）、その装備を登録していた全てのロードアウトで、その部位を空きにする
 * （仕様書v0.2 4.13）。新しい一覧を返す（元は変えない）。
 */
export function forgetItem(loadouts: readonly LoadoutRecord[], uid: string): LoadoutRecord[] {
  return loadouts.map((l) => {
    if (!Object.values(l.equipment).includes(uid)) return l;
    const equipment: Partial<Record<MvpEquipSlot, string>> = {};
    for (const [slot, ref] of Object.entries(l.equipment) as [MvpEquipSlot, string][])
      if (ref !== uid) equipment[slot] = ref;
    return { ...l, equipment };
  });
}
