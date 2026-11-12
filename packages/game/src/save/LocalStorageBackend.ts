import type { SaveBackend } from "@stella/core";

/**
 * ブラウザの保存領域（localStorage）の保存先（補助仕様書15章：開発中はブラウザの保存領域）。
 * デスクトップ版では、ファイルの保存先に差し替える（SaveBackend を実装する）。
 */
export class LocalStorageBackend implements SaveBackend {
  private readonly storage: Storage;

  constructor(storage: Storage = window.localStorage) {
    this.storage = storage;
  }

  read(key: string): string | undefined {
    return this.storage.getItem(key) ?? undefined;
  }

  write(key: string, value: string): void {
    this.storage.setItem(key, value);
  }

  remove(key: string): void {
    this.storage.removeItem(key);
  }
}
