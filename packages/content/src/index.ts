import { type ContentDb, formatContentError, loadContent } from "@stella/core";
import ja from "../text/ja.json" with { type: "json" };
import { rawContent } from "./raw.ts";

export { rawContent, registeredDataFiles } from "./raw.ts";

/** 表示の文章のキー。文章はコードに直接書かず、text/ja.json に置く（開発環境構築計画 5章）。 */
export type TextKey = keyof typeof ja;

/** キーに対応する日本語の文章を返す。 */
export function text(key: TextKey): string {
  return ja[key];
}

/** ゲームのデータを読み込み、検証する。誤りがあれば、全ての誤りを含めて例外を投げる。 */
export function loadGameContent(): ContentDb {
  const result = loadContent(rawContent);
  if (!result.ok) {
    throw new Error(
      `データの誤り（${String(result.errors.length)}件）\n${result.errors.map(formatContentError).join("\n")}`,
    );
  }
  return result.content;
}
