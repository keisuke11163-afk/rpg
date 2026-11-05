import type { ContentDb } from "../content/load.ts";
import {
  type Migration,
  MIGRATIONS,
  type PlayerProfile,
  type SaveData,
  SaveDataError,
  fromSaveData,
  migrateSaveData,
} from "./save-data.ts";

/** セーブのスロットの数（補助仕様書15章：キャラクター3人分）。 */
export const SAVE_SLOTS = 3;
/** 保存の形式の名前（封筒）。 */
export const SAVE_FORMAT = "stella-sigil-save";

/**
 * 保存先（補助仕様書15章：開発中はブラウザの保存領域、デスクトップ版ではファイル）。差し替えられるように、
 * 文字列の読み書きだけにする。
 */
export interface SaveBackend {
  read(key: string): string | undefined;
  write(key: string, value: string): void;
  remove(key: string): void;
}

/** メモリの保存先（テスト用）。 */
export class MemoryBackend implements SaveBackend {
  readonly data = new Map<string, string>();
  read(key: string): string | undefined {
    return this.data.get(key);
  }
  write(key: string, value: string): void {
    this.data.set(key, value);
  }
  remove(key: string): void {
    this.data.delete(key);
  }
}

/** 文字列の検査値（FNV-1a 32ビット。偶然の破損の検出用。改ざんの防止ではない）。 */
export function checksum(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** セーブデータを、保存する文字列にする（形式の名前・版・検査値の封筒に入れる）。 */
export function encodeSave(data: SaveData): string {
  const payload = JSON.stringify(data);
  return JSON.stringify({
    format: SAVE_FORMAT,
    save_version: data.save_version,
    checksum: checksum(payload),
    payload,
  });
}

/**
 * 保存した文字列を、今の版のセーブデータに戻す（封筒・検査値・版の移行・形を検証する）。
 * 壊れていれば SaveDataError。
 */
export function decodeSave(
  text: string,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
): SaveData {
  let envelope: unknown;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new SaveDataError("parse", "保存した文字列が JSON ではない");
  }
  if (
    typeof envelope !== "object" ||
    envelope === null ||
    (envelope as { format?: unknown }).format !== SAVE_FORMAT ||
    typeof (envelope as { payload?: unknown }).payload !== "string"
  )
    throw new SaveDataError("parse", "セーブデータの封筒の形が正しくない");
  const e = envelope as { payload: string; checksum?: unknown };
  if (e.checksum !== checksum(e.payload))
    throw new SaveDataError("checksum", "検査値が合わない（データが壊れている）");
  let data: unknown;
  try {
    data = JSON.parse(e.payload);
  } catch {
    throw new SaveDataError("parse", "セーブデータの中身が JSON ではない");
  }
  return migrateSaveData(data, migrations);
}

/** スロットの状態（タイトルのキャラクターの選択の一覧）。 */
export type SlotSummary =
  | { readonly slot: number; readonly state: "empty" }
  | { readonly slot: number; readonly state: "corrupt"; readonly error: SaveDataError }
  | {
      readonly slot: number;
      readonly state: "ok";
      readonly name: string;
      readonly level: number;
      readonly mainJob: string;
    };

export type LoadResult =
  | { readonly ok: true; readonly data: SaveData; readonly profile: PlayerProfile }
  | { readonly ok: false; readonly error: SaveDataError | undefined };

function requireSlot(slot: number): void {
  if (!(Number.isInteger(slot) && slot >= 1 && slot <= SAVE_SLOTS))
    throw new RangeError(`スロットは1〜${String(SAVE_SLOTS)}の整数（${String(slot)}）`);
}

/**
 * スロットごとの保存と読み込み（補助仕様書15章）。
 * - 読み込みは、壊れたデータを検出しても、保存先を一切変えない
 * - 保存は、書く前にデータを読み戻して検証し、合わなければ何も書かない
 * - 保存するとき、今あるデータが正しければ1つ前の分（.bak）に、壊れていれば .corrupt に退避してから書く
 *   （壊れたデータを、確かめずに上書きしない）
 */
export class SaveStore {
  private readonly backend: SaveBackend;
  private readonly db: ContentDb;
  private readonly prefix: string;
  private readonly migrations: Readonly<Record<number, Migration>>;

  constructor(
    db: ContentDb,
    backend: SaveBackend,
    options: { prefix?: string; migrations?: Readonly<Record<number, Migration>> } = {},
  ) {
    this.db = db;
    this.backend = backend;
    this.prefix = options.prefix ?? "stella-sigil";
    this.migrations = options.migrations ?? MIGRATIONS;
  }

  key(slot: number, suffix: "" | ".bak" | ".corrupt" = ""): string {
    requireSlot(slot);
    return `${this.prefix}/slot${String(slot)}${suffix}`;
  }

  /** 文字列を、検証済みのデータと状態に戻す（参照の検証を含む）。 */
  private parse(text: string): { data: SaveData; profile: PlayerProfile } {
    const data = decodeSave(text, this.migrations);
    return { data, profile: fromSaveData(this.db, data) };
  }

  private tryParse(text: string): LoadResult {
    try {
      return { ok: true, ...this.parse(text) };
    } catch (e) {
      if (e instanceof SaveDataError) return { ok: false, error: e };
      throw e;
    }
  }

  /** 読み込む（保存先は変えない）。空なら error は undefined。 */
  load(slot: number): LoadResult {
    const text = this.backend.read(this.key(slot));
    if (text === undefined) return { ok: false, error: undefined };
    return this.tryParse(text);
  }

  /** 1つ前の保存（.bak）を読み込む（保存先は変えない）。 */
  loadBackup(slot: number): LoadResult {
    const text = this.backend.read(this.key(slot, ".bak"));
    if (text === undefined) return { ok: false, error: undefined };
    return this.tryParse(text);
  }

  /** 保存する。書く前にデータを検証し、合わなければ何も書かずに SaveDataError。 */
  save(slot: number, data: SaveData): void {
    const text = encodeSave(data);
    // 読み戻して、参照まで検証する（壊れたデータを書かない）
    this.parse(text);
    const key = this.key(slot);
    const previous = this.backend.read(key);
    if (previous !== undefined) {
      const ok = this.tryParse(previous).ok;
      if (ok) this.backend.write(this.key(slot, ".bak"), previous);
      else if (this.backend.read(this.key(slot, ".corrupt")) === undefined)
        this.backend.write(this.key(slot, ".corrupt"), previous);
    }
    this.backend.write(key, text);
  }

  /** スロットの一覧。 */
  list(): SlotSummary[] {
    const out: SlotSummary[] = [];
    for (let slot = 1; slot <= SAVE_SLOTS; slot++) {
      const r = this.load(slot);
      if (r.ok)
        out.push({
          slot,
          state: "ok",
          name: r.data.character.name,
          level: r.data.character.level,
          mainJob: r.data.character.main_job,
        });
      else if (r.error === undefined) out.push({ slot, state: "empty" });
      else out.push({ slot, state: "corrupt", error: r.error });
    }
    return out;
  }
}

/** 自動セーブのきっかけ（補助仕様書15章）。 */
export type AutoSaveReason = "enterTown" | "changeRegion" | "craft" | "trade" | "respec";
/** ダンジョンの中の自動セーブの間隔（秒。補助仕様書15章）。 */
export const DUNGEON_AUTOSAVE_SECONDS = 60;

/**
 * 自動セーブの時期（補助仕様書15章：町に入ったとき・地域を移ったとき・クラフト・売買・振り直しをしたとき、
 * ダンジョンの中では60秒ごと）。手動のセーブは無い。
 */
export class AutoSaveTimer {
  private elapsed = 0;
  private pending: AutoSaveReason | undefined;

  /** 最後に知らせたきっかけ（まだ保存していなければ）。 */
  get reason(): AutoSaveReason | undefined {
    return this.pending;
  }

  /** きっかけを知らせる（次の {@link due} で保存する）。 */
  notify(reason: AutoSaveReason): void {
    this.pending = reason;
  }

  /** 時間を進める。ダンジョンの中だけ数える。 */
  tick(dt: number, inDungeon: boolean): void {
    if (!(Number.isFinite(dt) && dt >= 0))
      throw new RangeError(`経過時間は0以上の有限の数（${String(dt)}）`);
    if (inDungeon) this.elapsed += dt;
  }

  /** 保存する時期か。true を返したら、数え直す。 */
  due(): boolean {
    if (this.pending === undefined && this.elapsed < DUNGEON_AUTOSAVE_SECONDS) return false;
    this.pending = undefined;
    this.elapsed = 0;
    return true;
  }
}
