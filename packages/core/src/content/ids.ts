import { z } from "zod";

/**
 * データのID（開発環境構築計画 5章）：英大文字・数字とハイフン。先頭は英大文字。
 * 例：`TAG-FORM-MELEE`、`UNQ-003`
 * IDは一度決めたら変えない（仕様書 10.2）。全てのコレクションを通して重複してはいけない。
 */
export const ID_PATTERN = /^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$/;

export const idSchema = z
  .string()
  .regex(ID_PATTERN, "IDは英大文字・数字とハイフン（例：TAG-FORM-MELEE）");

/** 表示の文章のキー（text/ja.json）。小文字・数字・ドット・ハイフン・アンダースコア。 */
export const textKeySchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)+$/,
    "文章のキーは小文字とドット区切り（例：tag.form.melee）",
  );

/** 仮値の印（MVP実装単位 2.1）。バランス調整で変わる前提のデータに付ける。 */
export const provisionalFields = {
  provisional: z.boolean().optional(),
  /** 仮値である理由や、決める時期のメモ。 */
  provisionalNote: z.string().optional(),
};
