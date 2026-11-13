/**
 * 星辰盤（MVPの範囲）のノードの一覧を作る（pnpm report:star。docs/progress D-FIN-3・Q-U14-1）。
 * データ（data/boards/star*.json・constellations.json と効果）から、読みやすい表を
 * docs/progress/星辰盤_MVPのノード一覧.md に書く。盤を変えたら、もう一度実行する（テストで差分を検出する）。
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadGameContent } from "../../packages/content/src/index.ts";
import ja from "../../packages/content/text/ja.json" with { type: "json" };

const texts: Readonly<Record<string, string>> = ja;
const db = loadGameContent();
const out = fileURLToPath(
  new URL("../../docs/progress/星辰盤_MVPのノード一覧.md", import.meta.url),
);

const REGION: Record<string, string> = {
  gou: "剛域",
  goujin: "剛迅域",
  jin: "迅域",
  jinri: "迅理域",
};
const KIND: Record<string, string> = {
  start: "始点",
  minor: "小星",
  notable: "輝星",
  mutation: "転変",
  keystone: "天極",
  gate: "星門",
  socket: "共鳴座",
};

function pct(v: number): string {
  return `${String(Math.round(v * 1000) / 10)}%`;
}
function effectText(id: string): string {
  const e = db.effects.get(id);
  if (e === undefined) return id;
  const mods = e.modifiers.map((m) => {
    const name = "stat" in m ? (texts[db.stats.get(m.stat)?.text ?? ""] ?? m.stat) : m.kind;
    const filter =
      "filter" in m && m.filter !== undefined
        ? `[${[...(m.filter.allOf ?? []), ...(m.filter.anyOf ?? [])].map((t) => texts[db.tags.get(t)?.text ?? ""] ?? t).join("・")}]`
        : "";
    const value =
      "value" in m && typeof m.value === "number"
        ? m.kind === "increased"
          ? `+${pct(m.value)}`
          : m.kind === "more"
            ? `×${String(m.value)}`
            : db.stats.get("stat" in m ? m.stat : "")?.unit === "ratio"
              ? `+${pct(m.value)}`
              : `+${String(m.value)}`
        : "";
    return `${filter}${name}${value}`;
  });
  return `${mods.join("、")}${e.conditions === undefined || e.conditions.length === 0 ? "" : "（条件付き）"}`;
}

const nodes = [...db.starNodes.values()];
const inConst = new Map<string, string>();
for (const c of db.constellations.values())
  for (const n of c.nodes) inConst.set(n, texts[c.text] ?? c.id);

const lines: string[] = [
  "# 星辰盤（MVPの範囲）のノードの一覧",
  "",
  "> `pnpm report:star` で、データから作る（手で書き換えない）。暫定の採用（docs/progress D-FIN-3）。",
  "> 仕様書v0.2：4.3（ノードの種類）・4.4（星座）・4.12（ポイント：MVP は Lv20 の19＋クエスト4＋探索2＝25）",
  "",
  "## 数",
  "",
  "| 星域 | " + Object.values(KIND).join(" | ") + " | 合計 |",
  "|---|" +
    Object.values(KIND)
      .map(() => "---|")
      .join("") +
    "---|",
];
for (const [r, rname] of Object.entries(REGION)) {
  const inR = nodes.filter((n) => n.region === r);
  if (inR.length === 0) continue;
  lines.push(
    `| ${rname} | ${Object.keys(KIND)
      .map((k) => String(inR.filter((n) => n.kind === k).length))
      .join(" | ")} | ${String(inR.length)} |`,
  );
}
lines.push(
  `| 合計 | ${Object.keys(KIND)
    .map((k) => String(nodes.filter((n) => n.kind === k).length))
    .join(" | ")} | ${String(nodes.length)} |`,
  "",
  "## 星座（仕様書v0.2 4.4）",
  "",
  "| 星座 | 小星の数 | 完成ボーナス |",
  "|---|---|---|",
);
for (const c of db.constellations.values())
  lines.push(
    `| ${texts[c.text] ?? c.id} | ${String(c.nodes.length)} | ${effectText(c.completionEffect)} |`,
  );
lines.push(
  "",
  "## ノード",
  "",
  "| ID | 星域 | 種類 | 名前・星座 | 効果 | つながり |",
  "|---|---|---|---|---|---|",
);
for (const n of [...nodes].sort(
  (a, b) => a.region.localeCompare(b.region) || a.id.localeCompare(b.id),
)) {
  const name = n.text !== undefined ? (texts[n.text] ?? "") : (inConst.get(n.id) ?? "");
  const links = [...(db.starLinks.get(n.id) ?? [])].sort().join(" ");
  lines.push(
    `| ${n.id} | ${REGION[n.region] ?? n.region} | ${KIND[n.kind] ?? n.kind} | ${name} | ${(n.effects ?? []).map(effectText).join(" ／ ")} | ${links} |`,
  );
}
writeFileSync(out, `${lines.join("\n")}\n`);
console.log(`星辰盤のノードの一覧：${String(nodes.length)}ノード → ${out}`);
