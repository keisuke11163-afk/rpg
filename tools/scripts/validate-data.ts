/**
 * データの検証（U-02）。スキーマ・ID重複・ID参照・値の範囲・乗算の出どころを調べ、仮値の件数を出す。
 */
import { listProvisional } from "../../packages/core/src/index.ts";
import { RAW_FILES, loadContent } from "../../packages/content/src/index.ts";

const { data, issues } = loadContent();
if (issues.length > 0) {
  console.error(
    `データの検証：失敗（${String(issues.length)}件）\n${issues.map((i) => `  ${i.where}: ${i.message}`).join("\n")}`,
  );
  process.exit(1);
}
console.log(
  `データの検証：${String(RAW_FILES.length)}ファイル、タグ${String(data.tags.length)}件・効果${String(data.effects.length)}件、問題なし（仮値${String(listProvisional(data).length)}件）`,
);
