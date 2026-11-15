/**
 * MVPのユニーク9個（U02・U03・U06・U13〜U18。本仕様書 3.7）のデータを生成する。
 * 出力：packages/content/data/unique/{effects,uniques}.json
 * 実行：node tools/scripts/gen-uniques.ts
 * 固有効果は「ルールフック」で書き、潜在効果は他のシステム（ノード・星座・職奥義）の旗を条件にする。数値は仮値。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Json = Record<string, unknown>;
const outDir = fileURLToPath(new URL("../../packages/content/data/unique/", import.meta.url));
mkdirSync(outDir, { recursive: true });

const effects: Json[] = [];
const uniques: Json[] = [];
const hook = (name: string, params?: Json): Json => ({
  kind: "挙動",
  hook: name,
  ...(params ? { params } : {}),
});
const flag = (name: string): Json => ({ type: "旗", name });

function effect(id: string, modifiers: Json[], extra: Json = {}): string {
  effects.push({
    id,
    source: "ユニーク",
    modifiers,
    affects: { 打撃値: false, 基準値: false },
    scope: "自分",
    provisional: true,
    ...extra,
  });
  return id;
}

const NOTES: Record<string, { fixed: string; latent: string }> = {
  U02: {
    fixed:
      "移動速度+12%。10m移動するごとに、全スキルのクールダウンを0.3秒短縮する（1秒あたり最大1.0秒分）",
    latent: "星座「風見座」を完成：短縮が0.5秒になる",
  },
  U03: {
    fixed: "打撃値と基準値が-40%。物理ヒットは必ず出血を付与する。出血の最大スタック+4（8→12）",
    latent:
      "職紋「毒血同源」：出血が毒としても扱われる（ダメージは二重にならない。種類・数を数える効果に計上される）",
  },
  U06: {
    fixed: "攻撃と呪文が必中になる。会心しなくなる。会心率の増加1%ごとに、ダメージ+0.5%（加算）",
    latent: "職紋（弓使い）「心眼」：集中の最大値+50",
  },
  U13: {
    fixed:
      "止まっている間、1秒ごとに防具値+10%（最大+50%。動くと0に戻る）。攻撃を受けると、攻撃してきた敵に毒を1スタック付与する（基準値は受けたダメージの30%）",
    latent: "天極「徒手の極意」：毒を付与する相手が、攻撃してきた敵の周囲3mの全ての敵になる",
  },
  U14: {
    fixed: "出血している敵を倒すと、残っていた出血が最も近い敵1体に移る（移ると1スタックになる）",
    latent: "輝星「傷口を抉る」：移るときにスタック数を保つ",
  },
  U15: {
    fixed:
      "崩れている敵へのヒットで闘志+3（重撃なら+9）。敵の崩しゲージを満タンにすると、周囲4mの敵の崩しゲージを最大値の30%だけ増やす",
    latent: "職奥義「鬼神化」：鬼神の間は、周囲へ増やす量が50%になる",
  },
  U16: {
    fixed:
      "敵の背後にいる間、その敵から受けるダメージ-15%。移動の技を使った後2秒間、全てのヒットを背面からのヒットとして扱う",
    latent: "職奥義「影法師」：代わりに、背面からのヒットで得るコンボ点+1（1秒に1回まで）",
  },
  U17: {
    fixed:
      "ヒットのたびに、近くの別の敵1体にも、そのヒットの50%のダメージが当たる（分かれたヒットは状態異常を付与しない）",
    latent: "星座「双刃座」を完成：二刀流のとき、分かれたヒットも状態異常を付与する",
  },
  U18: {
    fixed: "敵の毒10スタックにつき、その敵が受けるダメージ×1.04（乗算。最大×1.20）",
    latent: "星座「毒蛇座」を完成：上限が×1.30になる",
  },
};

function unique(
  code: string,
  name: string,
  baseId: string,
  requiredLevel: number,
  obtain: string,
  fixed: { mods: Json[]; extra?: Json },
  latent: { mods: Json[]; conditions: Json[]; hint: string },
  weight = 1,
): void {
  const notes = NOTES[code];
  const f = effect(`EFF-UNQ-${code}-FIXED`, fixed.mods, {
    ...(fixed.extra ?? {}),
    note: notes?.fixed,
  });
  const l = effect(`EFF-UNQ-${code}-LATENT`, latent.mods, {
    conditions: latent.conditions,
    note: notes?.latent,
  });
  uniques.push({
    id: `UNQ-${code}`,
    name,
    baseId,
    requiredLevel,
    obtain,
    weight,
    fixed: [f],
    latent: { effect: l, hint: latent.hint },
    provisional: true,
  });
}

unique(
  "U02",
  "旅人の古靴",
  "BASE-ARM-LIGHT-FEET-T1",
  2,
  "any",
  {
    mods: [
      { kind: "加算％", stat: "移動速度", value: 0.12 },
      hook("移動距離ごとのCD短縮", { distance: 10, seconds: 0.3, maxPerSecond: 1.0 }),
    ],
  },
  {
    mods: [hook("移動距離ごとのCD短縮", { distance: 10, seconds: 0.5, maxPerSecond: 1.0 })],
    conditions: [flag("星座:風見座")],
    hint: "風を読む星座に応える",
  },
);

unique(
  "U03",
  "千の小傷",
  "BASE-WPN-DAGGER-T1",
  14,
  "boss-ch1",
  {
    mods: [
      { kind: "乗算", stat: "ダメージ", value: 0.6 },
      hook("強制付与:出血"),
      { kind: "固定の追加", stat: "出血の最大スタック", value: 4 },
    ],
    extra: {
      affects: { 打撃値: true, 基準値: true },
      note: "打撃値と基準値が-40%（本仕様書 3.7 U03。v0.2で-60%から変更）",
    },
  },
  {
    mods: [hook("別の異常として数える", { from: "TAG-AIL-BLEED", to: "TAG-AIL-POISON" })],
    conditions: [flag("ノード:毒血同源")],
    hint: "盗賊の毒の術に応える",
  },
);

unique(
  "U06",
  "盲目の賢者の目隠し",
  "BASE-ARM-LIGHT-HEAD-T1",
  20,
  "any",
  {
    mods: [
      hook("必中"),
      hook("禁止:会心"),
      { kind: "加算％", stat: "ダメージ", value: 0.005, per: { count: "会心率増加%" } },
    ],
  },
  {
    mods: [hook("集中の最大値", { add: 50 })],
    conditions: [flag("ノード:心眼")],
    hint: "弓使いの心の目に応える",
  },
);

unique(
  "U13",
  "樹皮の盾",
  "BASE-SHD-LARGE-T1",
  12,
  "boss-ch1",
  {
    mods: [
      hook("静止で防具値上昇", { perSecond: 0.1, max: 0.5 }),
      hook("被弾時の毒付与", { ratio: 0.3, radius: 0 }),
    ],
  },
  {
    mods: [hook("被弾時の毒付与", { ratio: 0.3, radius: 3 })],
    conditions: [flag("ノード:徒手の極意")],
    hint: "素手の者の覚悟に応える",
  },
);

unique(
  "U14",
  "狼牙の首飾り",
  "BASE-ACC-NECK-AMBER-T1",
  6,
  "elite-beast",
  { mods: [hook("出血の移転", { keepStacks: false })] },
  {
    mods: [hook("出血の移転", { keepStacks: true })],
    conditions: [flag("ノード:傷口を抉る")],
    hint: "傷を抉る者に応える",
  },
  3,
);

unique(
  "U15",
  "打ち鳴らしの籠手",
  "BASE-ARM-HEAVY-HANDS-T1",
  10,
  "any",
  {
    mods: [
      hook("崩れた敵へのヒットで闘志", { gain: 3, heavyGain: 9 }),
      hook("崩しの拡散", { radius: 4, ratio: 0.3 }),
    ],
  },
  {
    mods: [hook("崩しの拡散", { radius: 4, ratio: 0.5 })],
    conditions: [flag("ノード:鬼神化"), flag("鬼神中")],
    hint: "鬼神の宿る者に応える",
  },
);

unique(
  "U16",
  "背向けの外套",
  "BASE-ARM-LIGHT-BODY-T1",
  16,
  "any",
  {
    mods: [
      hook("背後にいる間の被ダメージ軽減", { ratio: 0.15 }),
      hook("移動の技の後の背面扱い", { seconds: 2 }),
    ],
  },
  {
    mods: [hook("背面ヒットでコンボ点", { gain: 1, intervalSeconds: 1 })],
    conditions: [flag("ノード:影法師")],
    hint: "影となる者に応える",
  },
);

unique(
  "U17",
  "二股の枝",
  "BASE-WPN-AXE-T1",
  4,
  "any",
  { mods: [hook("分岐ヒット", { ratio: 0.5, radius: 5, ailments: false })] },
  {
    mods: [hook("分岐ヒット", { ratio: 0.5, radius: 5, ailments: true })],
    conditions: [flag("星座:双刃座"), flag("二刀流")],
    hint: "双つの刃の星座に応える",
  },
);

unique(
  "U18",
  "母樹の根冠",
  "BASE-ARM-HEAVY-HEAD-T1",
  14,
  "boss-ch1",
  { mods: [hook("毒スタックによる被ダメージ倍率", { perStacks: 10, mult: 1.04, max: 1.2 })] },
  {
    mods: [hook("毒スタックによる被ダメージ倍率", { perStacks: 10, mult: 1.04, max: 1.3 })],
    conditions: [flag("星座:毒蛇座")],
    hint: "毒蛇の星座に応える",
  },
);

const write = (name: string, items: Json[]): void => {
  writeFileSync(`${outDir}${name}`, JSON.stringify({ dataVersion: 1, items }, null, 2) + "\n");
};
write("effects.json", effects);
write("uniques.json", uniques);
console.log(`ユニーク：${String(uniques.length)}個・効果${String(effects.length)}件`);
