/**
 * 読み込むデータファイルの一覧。
 * data/ にファイルを足したら、ここにも足す（足し忘れは content のテストと pnpm validate:data で見つかる）。
 * ブラウザ（Vite）と Node.js の両方で同じように読めるように、JSON を直接 import する。
 */
import type { RawDataFile } from "@stella/core";
import effects from "../data/effects/effects.json" with { type: "json" };
import hooks from "../data/hooks/hooks.json" with { type: "json" };
import stats from "../data/stats/stats.json" with { type: "json" };
import tags from "../data/tags/tags.json" with { type: "json" };

export const DATA_FILES: readonly RawDataFile[] = [
  { path: "tags/tags.json", content: tags },
  { path: "stats/stats.json", content: stats },
  { path: "hooks/hooks.json", content: hooks },
  { path: "effects/effects.json", content: effects },
];
