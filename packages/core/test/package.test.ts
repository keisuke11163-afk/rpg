import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CORE_API_VERSION } from "../src/index.ts";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as {
  dependencies?: Record<string, string>;
};

describe("@stella/core", () => {
  it("読み込める", () => {
    expect(CORE_API_VERSION).toBe(1);
  });

  it("実行時の依存は zod だけに限る（開発環境構築計画 3.1）", () => {
    const deps = Object.keys(manifest.dependencies ?? {});
    expect(deps.filter((name) => name !== "zod")).toEqual([]);
  });
});
