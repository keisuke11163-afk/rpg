import {
  formatDataErrors,
  validateContent,
  type ContentData,
  type DataError,
  type RawDataFile,
} from "@stella/core";
import ja from "../text/ja.json" with { type: "json" };
import { DATA_FILES } from "./files.ts";

export { DATA_FILES } from "./files.ts";

/** 表示の文章のキー。文章はコードに直接書かず、text/ja.json に置く（開発環境構築計画 5章）。 */
export type TextKey = keyof typeof ja;

const texts: Readonly<Record<string, string>> = ja;

/** キーに対応する日本語の文章を返す。 */
export function text(key: TextKey): string {
  return ja[key];
}

/** データのIDの表示名（text/ja.json の `name.<ID>`）。ない場合は undefined。 */
export function nameOf(id: string): string | undefined {
  return texts[`name.${id}`];
}

/** 表示名が必須の種類（画面に名前を出すもの）。 */
const NAMED_KINDS = ["tags", "stats", "hooks", "effects"] as const;

export type ContentValidationResult =
  | { readonly ok: true; readonly data: ContentData; readonly errors: readonly [] }
  | { readonly ok: false; readonly errors: readonly DataError[] };

/**
 * データファイルを検証する：core の検証（形・版・ID参照・規則）に加えて、
 * 全てのIDの表示名が text/ja.json にあることを確かめる。
 */
export function validateContentFiles(files: readonly RawDataFile[]): ContentValidationResult {
  const result = validateContent(files);
  if (!result.ok) return result;
  const errors: DataError[] = [];
  for (const kind of NAMED_KINDS) {
    for (const id of result.data[kind].keys()) {
      if (nameOf(id) === undefined) {
        errors.push({
          code: "unknown_reference",
          file: result.data.origins.get(id) ?? "",
          path: id,
          message: `表示名 name.${id} が text/ja.json にない`,
        });
      }
    }
  }
  return errors.length > 0 ? { ok: false, errors } : result;
}

/** データが壊れているときの誤り。全ての誤りを持つ。 */
export class ContentError extends Error {
  readonly errors: readonly DataError[];
  constructor(errors: readonly DataError[]) {
    super(`データの検証に失敗した（${String(errors.length)}件）\n${formatDataErrors(errors)}`);
    this.name = "ContentError";
    this.errors = errors;
  }
}

let cached: ContentData | undefined;

/** ゲームのデータを読み込んで検証する。壊れていれば ContentError を投げる。結果は使い回す。 */
export function loadContent(): ContentData {
  if (cached) return cached;
  const result = validateContentFiles(DATA_FILES);
  if (!result.ok) throw new ContentError(result.errors);
  cached = result.data;
  return cached;
}
