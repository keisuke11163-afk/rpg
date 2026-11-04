import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "tools/**/test/**/*.test.ts"],
    environment: "node",
    // リントの検査（boundaries.test.ts）は型の情報を使うので時間がかかる
    testTimeout: 30000,
  },
});
