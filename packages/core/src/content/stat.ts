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
  /** 値の下限（省略すると下限なし）。 */
  min: z.number().optional(),
  /** 値の上限の初期値（例：耐性の75%）。上限を変える修正値（cap）で増減する。省略すると上限なし。 */
  baseCap: z.number().optional(),
  /** 上限を変える修正値で、上限を上げられる限界（例：耐性は75%から、効果で最大90%まで。仕様書2.6）。 */
  capLimit: z.number().optional(),
  ...provisionalFields,
});

export type StatDef = z.infer<typeof statSchema>;
