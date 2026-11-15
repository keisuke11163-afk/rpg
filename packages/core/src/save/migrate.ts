/**
 * セーブの版の移行。読み込みの前に元のデータを残し（呼び出し側）、1つずつ版を上げる。
 */
import { SAVE_VERSION } from "./schema.ts";

type Json = Record<string, unknown>;

/** 版 n → n+1 の変換。入力は検証前の生のデータ */
export const MIGRATIONS: Readonly<Record<number, (data: Json) => Json>> = {
  // v1 → v2：金貨を素材の中（"金貨"）から、独立した項目に移す。boss_tokens・discoveries を足す
  1: (d) => {
    const materials = { ...((d["materials"] as Record<string, number> | undefined) ?? {}) };
    const gold = materials["金貨"] ?? 0;
    delete materials["金貨"];
    return {
      ...d,
      saveVersion: 2,
      gold,
      materials,
      bossTokens: d["bossTokens"] ?? {},
      discoveries: d["discoveries"] ?? {
        latentRevealed: [],
        bondsRevealed: [],
        interactionsSeen: [],
      },
    };
  },
};

export type MigrationResult =
  | { ok: true; data: Json; from: number }
  | { ok: false; reason: "tooNew" | "unknown" | "failed"; from?: number };

export function migrate(raw: unknown): MigrationResult {
  if (typeof raw !== "object" || raw === null) return { ok: false, reason: "unknown" };
  let data = raw as Json;
  const from = data["saveVersion"];
  if (typeof from !== "number" || !Number.isInteger(from) || from < 1) {
    return { ok: false, reason: "unknown" };
  }
  if (from > SAVE_VERSION) return { ok: false, reason: "tooNew", from };
  let version = from;
  while (version < SAVE_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) return { ok: false, reason: "failed", from };
    try {
      data = step(data);
    } catch {
      return { ok: false, reason: "failed", from };
    }
    version++;
  }
  return { ok: true, data, from };
}
