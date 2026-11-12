import { z } from "zod";

/** このコードが読めるデータの形の版。データの形を変えたら上げ、移行の手順を用意する。 */
export const SUPPORTED_SCHEMA_VERSION = 1;

export const manifestSchema = z.strictObject({
  /** データの形の版。 */
  schemaVersion: z.number().int().positive(),
  /** コンテンツの版（セーブデータに記録する。開発計画書 6.9）。 */
  contentVersion: z.string().regex(/^\d+\.\d+\.\d+$/, "版は 0.1.0 の形式"),
});
export type Manifest = z.infer<typeof manifestSchema>;
