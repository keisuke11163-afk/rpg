/**
 * セーブの保存先（差し替えられる）と、スロットの管理（補助仕様書 15章、開発環境構築計画 8章）。
 * ブラウザの保存領域・ファイル・テスト用のメモリを、同じ形で扱う。
 */
import { hashString } from "../rng.ts";
import { migrate } from "./migrate.ts";
import { SAVE_VERSION, saveSchema, type SaveData } from "./schema.ts";

export interface SaveStorage {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export class MemoryStorage implements SaveStorage {
  readonly map = new Map<string, string>();
  read(key: string): Promise<string | null> {
    return Promise.resolve(this.map.get(key) ?? null);
  }
  write(key: string, value: string): Promise<void> {
    this.map.set(key, value);
    return Promise.resolve();
  }
  remove(key: string): Promise<void> {
    this.map.delete(key);
    return Promise.resolve();
  }
}

export const SLOT_COUNT = 3;
const FORMAT = "stella-save";

interface Envelope {
  format: string;
  /** 本文の検査用の値（壊れたデータを検出する） */
  checksum: number;
  /** 本文のJSON文字列 */
  body: string;
}

function encode(data: unknown): string {
  const body = JSON.stringify(data);
  const envelope: Envelope = { format: FORMAT, checksum: hashString(body), body };
  return JSON.stringify(envelope);
}

/** 文字列を包みから取り出す。壊れていれば undefined */
function decode(text: string): unknown {
  try {
    const envelope = JSON.parse(text) as Partial<Envelope>;
    if (envelope.format !== FORMAT || typeof envelope.body !== "string") return undefined;
    if (hashString(envelope.body) !== envelope.checksum) return undefined;
    return JSON.parse(envelope.body);
  } catch {
    return undefined;
  }
}

export type LoadFailure = "empty" | "corrupt" | "tooNew" | "invalid" | "migrationFailed";

export type SaveLoadResult =
  | {
      ok: true;
      data: SaveData;
      /** 前の版から移行した */
      migratedFrom?: number;
      /** 本体が壊れていたので、1つ前のセーブから復元した */
      recoveredFromBackup: boolean;
      /** 整合性の修復の内容（存在しないアイテムを参照していたものなど） */
      repairs: string[];
    }
  | { ok: false; reason: LoadFailure };

const key = (slot: number, suffix = ""): string => `stella:slot${String(slot)}${suffix}`;

export class SaveManager {
  private readonly storage: SaveStorage;

  constructor(storage: SaveStorage) {
    this.storage = storage;
  }

  /** 保存する。上書きの前に、今のセーブを「1つ前」として残す */
  async save(slot: number, data: SaveData): Promise<void> {
    assertSlot(slot);
    const parsed = saveSchema.parse(data);
    const previous = await this.storage.read(key(slot));
    if (previous !== null && decode(previous) !== undefined) {
      await this.storage.write(key(slot, ":backup"), previous);
    }
    await this.storage.write(key(slot), encode(parsed));
  }

  async exists(slot: number): Promise<boolean> {
    assertSlot(slot);
    return (await this.storage.read(key(slot))) !== null;
  }

  /** 読み込む。壊れていたら元のデータを別に残し、1つ前から復元を試みる。元のデータは上書きしない */
  async load(slot: number): Promise<SaveLoadResult> {
    assertSlot(slot);
    const text = await this.storage.read(key(slot));
    if (text === null) return { ok: false, reason: "empty" };

    const first = this.interpret(text);
    if (first.ok) {
      // 移行する前に、元のファイルを残す
      if (first.migratedFrom !== undefined)
        await this.storage.write(key(slot, `:premigrate-v${String(first.migratedFrom)}`), text);
      return first;
    }
    if (first.reason === "tooNew") return first;

    // 壊れている：元のデータを残してから、1つ前を試す
    await this.storage.write(key(slot, ":corrupt"), text);
    const backup = await this.storage.read(key(slot, ":backup"));
    if (backup !== null) {
      const second = this.interpret(backup);
      if (second.ok) return { ...second, recoveredFromBackup: true };
    }
    return first;
  }

  private interpret(text: string): SaveLoadResult {
    const raw = decode(text);
    if (raw === undefined) return { ok: false, reason: "corrupt" };
    const migrated = migrate(raw);
    if (!migrated.ok) {
      return {
        ok: false,
        reason:
          migrated.reason === "tooNew"
            ? "tooNew"
            : migrated.reason === "failed"
              ? "migrationFailed"
              : "invalid",
      };
    }
    const parsed = saveSchema.safeParse(migrated.data);
    if (!parsed.success) return { ok: false, reason: "invalid" };
    const { data, repairs } = reconcile(parsed.data);
    return {
      ok: true,
      data,
      ...(migrated.from < SAVE_VERSION ? { migratedFrom: migrated.from } : {}),
      recoveredFromBackup: false,
      repairs,
    };
  }

  async delete(slot: number): Promise<void> {
    assertSlot(slot);
    for (const s of ["", ":backup", ":corrupt"]) await this.storage.remove(key(slot, s));
  }
}

function assertSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 1 || slot > SLOT_COUNT) {
    throw new RangeError(`スロットは1〜${String(SLOT_COUNT)}`);
  }
}

/**
 * 参照の整合（開発計画書 M-15）：存在しないアイテムを参照している部位は空きにし、
 * 持ち物・倉庫の存在しないuidは取り除く。分解で消えた装備を参照するロードアウトの扱いと同じ規則。
 */
export function reconcile(save: SaveData): { data: SaveData; repairs: string[] } {
  const repairs: string[] = [];
  const has = (uid: string): boolean => uid in save.items;
  const inventory = save.inventory.filter((uid) => {
    if (has(uid)) return true;
    repairs.push(`持ち物の ${uid} が存在しないので取り除いた`);
    return false;
  });
  const stash = save.stash.filter((uid) => {
    if (has(uid)) return true;
    repairs.push(`倉庫の ${uid} が存在しないので取り除いた`);
    return false;
  });
  const loadouts = save.loadouts.map((l) => {
    const equipment: Record<string, string | null> = {};
    for (const [slot, uid] of Object.entries(l.equipment)) {
      if (uid !== null && !has(uid)) {
        equipment[slot] = null;
        repairs.push(`ロードアウト${String(l.id)}の ${slot} は ${uid} が存在しないので空きにした`);
      } else {
        equipment[slot] = uid;
      }
    }
    return { ...l, equipment: equipment };
  });
  return { data: { ...save, inventory, stash, loadouts }, repairs };
}

/**
 * 自動セーブの判断（補助仕様書 15章）。町に入ったとき、地域を移ったとき、クラフト・売買・振り直しのとき、
 * ダンジョンの中では60秒ごと。手動セーブはない。
 */
export type AutoSaveEvent = "enterTown" | "changeArea" | "craft" | "trade" | "respec";

export const DUNGEON_AUTOSAVE_SECONDS = 60;

export class AutoSaver {
  private elapsed = 0;
  /** 最後に保存のきっかけになった出来事（表示・記録用） */
  lastEvent: AutoSaveEvent | undefined;

  /** 出来事で保存すべきか。保存したら経過をリセットする */
  onEvent(event: AutoSaveEvent): boolean {
    this.lastEvent = event;
    this.elapsed = 0;
    return true;
  }

  /** ダンジョンの中だけ、60秒ごとに true */
  tick(dt: number, inDungeon: boolean): boolean {
    if (!inDungeon) {
      this.elapsed = 0;
      return false;
    }
    this.elapsed += dt;
    if (this.elapsed >= DUNGEON_AUTOSAVE_SECONDS) {
      this.elapsed -= DUNGEON_AUTOSAVE_SECONDS;
      return true;
    }
    return false;
  }
}
