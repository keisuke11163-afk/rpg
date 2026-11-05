import { z } from "zod";
import { idSchema, provisionalFields, textKeySchema } from "./ids.ts";

/** 星紋タグの分類（仕様書 1.5）。 */
export const TAG_CATEGORIES = [
  "form", // 形態
  "element", // 属性
  "ailment", // 状態異常
  "weapon", // 武器
  "weaponGroup", // 武器の系統（親タグ。仕様書v0.2 1.5）
  "job", // ジョブ
  "region", // 星域
  "enemyFamily", // 敵の系統
] as const;

export const tagSchema = z.strictObject({
  id: idSchema,
  category: z.enum(TAG_CATEGORIES),
  text: textKeySchema,
  /** 親タグ。親タグの条件にも当てはまる（例：大剣は剣系にも当てはまる）。 */
  parents: z.array(idSchema).optional(),
  ...provisionalFields,
});

export type TagDef = z.infer<typeof tagSchema>;

/** 親タグとして持てる分類（子の分類 → 親の分類）。 */
export const ALLOWED_PARENT_CATEGORY: Partial<Record<TagDef["category"], TagDef["category"]>> = {
  weapon: "weaponGroup",
};
