import { z } from "zod";
import { idSchema, provisionalFields, textKeySchema } from "./ids.ts";

/**
 * 能力値・二次的な数値の定義（開発計画書 6.2「能力値」）。
 * 修正値は、ここで定義した能力値だけを対象にできる。
 */
export const statSchema = z.strictObject({
  id: idSchema,
  text: textKeySchema,
  /** 値の種類。flat＝そのままの数、ratio＝割合（0.1＝10%）、seconds＝秒 */
  unit: z.enum(["flat", "ratio", "seconds"]),
  ...provisionalFields,
});

export type StatDef = z.infer<typeof statSchema>;
