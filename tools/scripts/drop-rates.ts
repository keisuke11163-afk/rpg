/**
 * 入手の頻度の計測（pnpm drops。U-21）：仕様書v0.2 3.5 の前提（1時間に通常500体・魔法60体・精鋭15体）で、
 * 1時間に拾えるアイテム・希少・ユニーク・還星の灯の数を、実際のドロップの抽選（rollDrops）で数える。
 * 目安（8.6・4.13）：希少 20〜30個・ユニーク 1〜2個・還星の灯 3〜5個（ストーリー中）。
 */
import { loadGameContent } from "../../packages/content/src/index.ts";
import { Rng, TagIndex, rollDrops } from "../../packages/core/src/index.ts";

const db = loadGameContent();
const tags = new TagIndex(db.tags);
const job = db.jobs.get("JOB-WARRIOR");
if (job === undefined) throw new Error("戦士のデータがない");
type Source = "normal" | "magic" | "elite" | "miniBoss" | "woodChest" | "oldChest";
/** 仕様書v0.2 3.5 の撃破数だけ／それに中ボス1体・木の箱4つ・古い箱1つを足した1時間（後者は仮の前提。docs/progress D-U21-2）。 */
const SCENARIOS: Readonly<Record<string, Readonly<Partial<Record<Source, number>>>>> = {
  "敵だけ（通常500・魔法60・精鋭15）": { normal: 500, magic: 60, elite: 15 },
  "敵＋中ボス1・木の箱4・古い箱1": {
    normal: 500,
    magic: 60,
    elite: 15,
    miniBoss: 1,
    woodChest: 4,
    oldChest: 1,
  },
};
const HOURS = 200;
const LEVEL = 10;
const rng = Rng.fromSeed("drop-rates");
let uid = 0;
const nextUid = (): string => `d${String(++uid)}`;
for (const [name, perHour] of Object.entries(SCENARIOS)) {
  const counts = new Map<string, number>();
  const add = (k: string, n = 1): void => {
    counts.set(k, (counts.get(k) ?? 0) + n);
  };
  for (let h = 0; h < HOURS; h++) {
    for (const [source, kills] of Object.entries(perHour)) {
      for (let i = 0; i < kills; i++) {
        const r = rollDrops(db, rng, {
          source: source as Source,
          enemyLevel: LEVEL,
          mainJob: job,
          tags,
          nextUid,
        });
        for (const item of r.items) {
          add("アイテム");
          add(`レアリティ：${item.rarity}`);
        }
        for (const m of r.materials) add(`素材：${m.material}`, m.count);
        add("金貨", r.gold);
      }
    }
  }
  console.log(`■ ${name}：1時間あたり（${String(HOURS)}時間の平均・敵Lv${String(LEVEL)}）`);
  for (const [k, v] of [...counts].sort((a, b) => a[0].localeCompare(b[0])))
    console.log(`  ${k}：${(v / HOURS).toFixed(2)}`);
}
