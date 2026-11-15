import type { SaveStorage } from "@stella/core";

/**
 * ブラウザの保存領域（localStorage）を保存先にする。
 * 仮実装: デスクトップ版（MVPの後）でファイルに置き換える。保存先は SaveStorage の差し替えで変わる。
 */
export class BrowserStorage implements SaveStorage {
  read(key: string): Promise<string | null> {
    try {
      return Promise.resolve(window.localStorage.getItem(key));
    } catch {
      return Promise.resolve(null);
    }
  }
  write(key: string, value: string): Promise<void> {
    try {
      window.localStorage.setItem(key, value);
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
    return Promise.resolve();
  }
  remove(key: string): Promise<void> {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // 保存領域が使えない環境では何もしない
    }
    return Promise.resolve();
  }
}
