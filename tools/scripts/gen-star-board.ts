/**
 * 星辰盤のデータ（MVPの範囲：剛域・剛迅域・迅域の一部。約150ノード）を決定的に生成する。
 * 出力：packages/content/data/star/{effects,nodes,constellations}.json
 * 実行：node tools/scripts/gen-star-board.ts
 * 数値はすべて仮値（"provisional": true）。データを手で直すときは、この生成スクリプトを直して作り直す。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Json = Record<string, unknown>;
const outDir = fileURLToPath(new URL("../../packages/content/data/star/", import.meta.url));
mkdirSync(outDir, { recursive: true });

const effects: Json[] = [];
const nodes: Json[] = [];
const constellations: Json[] = [];
const byId = new Map<string, Json>();

const T = {
  melee: "TAG-FORM-MELEE",
  heavy: "TAG-FORM-HEAVY",
  proj: "TAG-FORM-PROJECTILE",
  area: "TAG-FORM-AREA",
  move: "TAG-FORM-MOVE",
  phys: "TAG-ELEM-PHYSICAL",
  bleed: "TAG-AIL-BLEED",
  poison: "TAG-AIL-POISON",
  weaken: "TAG-AIL-WEAKEN",
  brk: "TAG-AIL-BREAK",
  sword: "TAG-WPNGRP-SWORD",
  claw: "TAG-WPN-CLAW",
  scythe: "TAG-WPN-SCYTHE",
  dagger: "TAG-WPN-DAGGER",
  gou: "TAG-REGION-GOU",
  goujin: "TAG-REGION-GOUJIN",
  jin: "TAG-REGION-JIN",
};
const NO = { 打撃値: false, 基準値: false };

type Mod = Json;
const add = (stat: string, value: number, filter?: Json, extra: Json = {}): Mod => ({
  kind: "加算％",
  stat,
  ...(filter ? { filter } : {}),
  value,
  ...extra,
});
const flat = (stat: string, value: number, filter?: Json): Mod => ({
  kind: "固定の追加",
  stat,
  ...(filter ? { filter } : {}),
  value,
});
const hook = (name: string, params?: Json): Mod => ({
  kind: "挙動",
  hook: name,
  ...(params ? { params } : {}),
});
const tags = (...ids: string[]): Json => ({ tags: { all_of: ids } });

function effect(id: string, source: string, modifiers: Mod[], extra: Json = {}): string {
  effects.push({
    id,
    source,
    modifiers,
    affects: NO,
    scope: "自分",
    provisional: true,
    ...extra,
  });
  return id;
}

let seq = 0;
const nextId = (region: string): string => `STAR-${region}-${String(++seq).padStart(4, "0")}`;

interface NodeSpec {
  region: string;
  regionTag: string;
  type: string;
  name: string;
  effects: string[];
  x: number;
  y: number;
  constellation?: string;
  gate?: Json;
  start?: Json;
}

function node(id: string, spec: NodeSpec): string {
  const n: Json = {
    id,
    region: spec.regionTag,
    type: spec.type,
    name: spec.name,
    links: [] as string[],
    effects: spec.effects,
    x: Math.round(spec.x),
    y: Math.round(spec.y),
    provisional: true,
    ...(spec.constellation ? { constellation: spec.constellation } : {}),
    ...(spec.gate ? { gate: spec.gate } : {}),
    ...(spec.start ? { start: spec.start } : {}),
  };
  nodes.push(n);
  byId.set(id, n);
  return id;
}

function link(a: string, b: string): void {
  const na = byId.get(a);
  const nb = byId.get(b);
  if (!na || !nb) throw new Error(`link ${a} ${b}`);
  (na["links"] as string[]).push(b);
  (nb["links"] as string[]).push(a);
}

// ---- 小星のテンプレート（必ずタグの条件か副次効果を持つ）。値は添字で少し変える ----
type Template = (i: number) => { name: string; mods: Mod[] };
const GOU_SMALL: Template[] = [
  () => ({ name: "剛の小星", mods: [flat("剛", 10), add("最大HP", 0.01)] }),
  (i) => ({ name: "鋼の皮膚", mods: [add("防具値", 0.03 + 0.002 * (i % 3)), flat("最大HP", 8)] }),
  (i) => ({
    name: "剛腕",
    mods: [
      add("ダメージ", 0.04 + 0.002 * (i % 3), tags(T.melee)),
      add("崩し値", 0.04, tags(T.melee)),
    ],
  }),
  (i) => ({
    name: "重い一撃",
    mods: [
      add("崩し値", 0.06 + 0.002 * (i % 3), tags(T.heavy)),
      add("ダメージ", 0.03, tags(T.heavy)),
    ],
  }),
  (i) => ({
    name: "闘志の火種",
    mods: [add("闘志の獲得量+%", 0.04 + 0.002 * (i % 3)), flat("剛", 5)],
  }),
];
const JIN_SMALL: Template[] = [
  () => ({ name: "迅の小星", mods: [flat("迅", 10), add("回避値", 0.01)] }),
  (i) => ({
    name: "鋭い目",
    mods: [add("会心率増加%", 0.03 + 0.002 * (i % 3)), add("ダメージ", 0.02, tags(T.phys))],
  }),
  () => ({
    name: "出血の刃",
    mods: [
      add("状態異常ダメージ", 0.06, { ailment: T.bleed }),
      flat("状態異常の持続秒数", 0.3, { ailment: T.bleed }),
    ],
  }),
  (i) => ({
    name: "毒の滴",
    mods: [
      add("状態異常ダメージ", 0.05 + 0.002 * (i % 3), { ailment: T.poison }),
      flat("状態異常の持続秒数", 0.2, { ailment: T.poison }),
    ],
  }),
  (i) => ({
    name: "軽い足",
    mods: [add("移動速度", 0.015 + 0.001 * (i % 3)), add("回避値", 0.02)],
  }),
];
const GOUJIN_SMALL: Template[] = [
  () => ({ name: "刃の巡り", mods: [flat("剛", 5), flat("迅", 5)] }),
  (i) => ({
    name: "機動の心得",
    mods: [add("移動速度", 0.015 + 0.001 * (i % 3)), add("ダメージ", 0.02, tags(T.move))],
  }),
  () => ({
    name: "二刀の呼吸",
    mods: [
      add("攻撃速度", 0.02, undefined, { conditions: [{ type: "旗", name: "二刀流" }] }),
      flat("迅", 4),
    ],
  }),
  (i) => ({
    name: "投擲の癖",
    mods: [add("投射物速度", 0.05 + 0.002 * (i % 3), tags(T.proj)), flat("命中", 15)],
  }),
];

function small(
  region: string,
  regionTag: string,
  templates: readonly Template[],
  index: number,
  x: number,
  y: number,
  constellation?: string,
  fixed?: { name: string; mods: Mod[] },
): string {
  const tpl = (templates[index % templates.length] as Template)(index);
  const f = fixed ?? tpl;
  const id = nextId(region);
  const eff = effect(`EFF-${id.slice(5)}`, "基本ノード", f.mods);
  return node(id, {
    region,
    regionTag,
    type: "小星",
    name: f.name,
    effects: [eff],
    x,
    y,
    ...(constellation ? { constellation } : {}),
  });
}

interface Ctx {
  region: string;
  regionTag: string;
  templates: readonly Template[];
  counter: number;
}
const ctxs: Record<string, Ctx> = {
  GOU: { region: "GOU", regionTag: T.gou, templates: GOU_SMALL, counter: 0 },
  GOUJIN: { region: "GOUJIN", regionTag: T.goujin, templates: GOUJIN_SMALL, counter: 0 },
  JIN: { region: "JIN", regionTag: T.jin, templates: JIN_SMALL, counter: 0 },
};

/** from から、角度 angle の方向へ n 個の小星を鎖にする。最後のノードのIDを返す */
function chain(
  c: Ctx,
  from: string,
  angle: number,
  n: number,
  step = 14,
  opts: {
    constellation?: string;
    fixed?: ({ name: string; mods: Mod[] } | undefined)[];
    bend?: number;
  } = {},
): string[] {
  const ids: string[] = [];
  let prev = from;
  let a = angle;
  let { x, y } = byId.get(from) as { x: number; y: number };
  for (let k = 0; k < n; k++) {
    a += opts.bend ?? 0;
    x += Math.cos(a) * step;
    y += Math.sin(a) * step;
    const id = small(
      c.region,
      c.regionTag,
      c.templates,
      c.counter++,
      x,
      y,
      opts.constellation,
      opts.fixed?.[k],
    );
    link(prev, id);
    ids.push(id);
    prev = id;
  }
  return ids;
}

function special(
  c: Ctx,
  from: string,
  type: "輝星" | "転変" | "天極" | "共鳴座" | "星門",
  name: string,
  effs: string[],
  angle: number,
  step = 16,
  extra: Partial<NodeSpec> = {},
): string {
  const f = byId.get(from) as { x: number; y: number };
  const id = nextId(c.region);
  node(id, {
    region: c.region,
    regionTag: c.regionTag,
    type,
    name,
    effects: effs,
    x: f.x + Math.cos(angle) * step,
    y: f.y + Math.sin(angle) * step,
    ...extra,
  });
  link(from, id);
  return id;
}

const PI = Math.PI;

// ================= 始点 =================
const gouStart = node("STAR-GOU-START", {
  region: "GOU",
  regionTag: T.gou,
  type: "始点",
  name: "戦士の始点",
  effects: [],
  x: 120,
  y: 180,
  start: { job: "JOB-WARRIOR" },
});
const goujinStart = node("STAR-GOUJIN-START", {
  region: "GOUJIN",
  regionTag: T.goujin,
  type: "始点",
  name: "予約枠の始点（拳闘士）",
  effects: [],
  x: 320,
  y: 180,
  start: { job: null },
});
const jinStart = node("STAR-JIN-START", {
  region: "JIN",
  regionTag: T.jin,
  type: "始点",
  name: "盗賊の始点",
  effects: [],
  x: 520,
  y: 180,
  start: { job: "JOB-ROGUE" },
});

// ================= 橋（始点どうしは約18ノード） =================
const bridge1 = chain(ctxs["GOUJIN"] as Ctx, gouStart, 0, 9, 10);
link(bridge1[bridge1.length - 1] as string, goujinStart);
const bridge2 = chain(ctxs["GOUJIN"] as Ctx, goujinStart, 0, 9, 10);
link(bridge2[bridge2.length - 1] as string, jinStart);

// ================= 剛域 =================
const G = ctxs["GOU"] as Ctx;
// 周りの輪
const gCore = chain(G, gouStart, -PI / 2, 5, 12, { bend: 0.12 });
const gCore2 = chain(G, gouStart, PI / 2, 5, 12, { bend: -0.12 });
// 鍛冶座（8）：北の輪
const forgeId = "CONST-FORGE";
const forge = chain(G, gCore[2] as string, -PI / 2 - 0.5, 8, 11, {
  constellation: forgeId,
  bend: 0.3,
  fixed: [
    { name: "鍛冶の小星", mods: [add("防具値", 0.05), add("ダメージ", 0.05, tags(T.phys))] },
    { name: "鍛冶の小星", mods: [add("防具値", 0.05), add("ダメージ", 0.05, tags(T.phys))] },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ],
});
const forgeBonus = effect(
  "EFF-CONST-FORGE",
  "基本ノード",
  [add("ダメージ", 0.004, undefined, { per: { count: "装備の強化値の合計" }, cap: 0.44 })],
  { note: "鍛冶座の完成ボーナス：装備の強化値の合計×0.4%（最大+44%）" },
);
constellations.push({
  id: forgeId,
  name: "鍛冶座",
  region: T.gou,
  nodes: forge,
  completionEffect: forgeBonus,
  provisional: true,
});

// 輝星：断ち切る刃 → 転変：重撃化
const severing = effect("EFF-NODE-SEVERING-EDGE", "輝星", [
  add("ダメージ", 0.2, tags(T.melee)),
  add("ダメージ", 0.2, tags(T.melee), { conditions: [{ type: "旗", name: "崩れた敵" }] }),
]);
const gN = chain(G, gCore[4] as string, -PI / 2 + 0.2, 4, 12);
const severingNode = special(G, gN[3] as string, "輝星", "断ち切る刃", [severing], -PI / 2);
const heavyMut = effect(
  "MUT-HEAVY-001",
  "転変",
  [add("崩し値", 0.6), add("ダメージ", 0.3), add("攻撃速度", -0.3), hook("タグ付与:重撃")],
  {
    target_skill_tags: { all_of: [T.melee] },
    scope: "自分の技",
    note: "重撃化：近接の技に崩し値+60%・ダメージ+30%、攻撃速度-30%",
    affects: { 打撃値: true, 基準値: true },
  },
);
special(G, severingNode, "転変", "重撃化", [heavyMut], -PI / 2 + 0.3);

// 東の枝：刃の門（剣系を装備している）
const gE = chain(G, gCore2[2] as string, 0.5, 4, 12);
const bladeGate = special(G, gE[3] as string, "星門", "刃の門", [], 0.4, 14, {
  gate: {
    condition: { type: "タグ", tags: { any_of: [T.sword] } },
    label: "主手に剣系（長剣・大剣）を装備している",
  },
});
const swordAura = effect(
  "EFF-NODE-SWORD-AURA",
  "輝星",
  [hook("衝撃波", { chance: 0.1, damageRatio: 0.5 })],
  { note: "剣気：剣での攻撃は、10%の確率で斬撃の衝撃波（武器ダメージの50%）" },
);
const swordNode = special(G, bladeGate, "輝星", "剣気", [swordAura], 0.3);
chain(G, swordNode, 0.3, 3, 12);

// 天極 K10 重荷の誇り（北東）／ 輝星 鉄の皮膚
const ironSkin = effect("EFF-NODE-IRON-SKIN", "輝星", [
  add("防具値", 0.3),
  hook("ガード中崩されない"),
]);
const gK = chain(G, gCore[3] as string, -PI / 2 + 0.9, 4, 12);
const ironNode = special(G, gK[3] as string, "輝星", "鉄の皮膚", [ironSkin], -PI / 2 + 0.7);
const k10 = effect(
  "EFF-KEY-K10",
  "天極",
  [
    add("ダメージ", 0.05, undefined, { per: { count: "装備中の防具種", value: "重装" } }),
    add("崩し値", 0.08, undefined, { per: { count: "装備中の防具種", value: "重装" } }),
    add("移動速度", -0.12),
    {
      kind: "挙動",
      hook: "崩されない",
      conditions: [{ type: "装備数", armor_class: "重装", min: 4 }],
    },
  ],
  {
    note: "代償：移動速度-12%",
    affects: { 打撃値: true, 基準値: "仮" },
    resonance_variant: { region: T.gou, min_resonance: 3, replace: [add("移動速度", -0.06)] },
  },
);
special(G, ironNode, "天極", "重荷の誇り", [k10], -PI / 2 + 0.6);

// 天極 K01 血の盟約（南）
const gS = chain(G, gCore2[3] as string, PI / 2 - 0.3, 5, 12);
const k01 = effect(
  "EFF-KEY-K01",
  "天極",
  [hook("スキルコストをHPで支払う", { mpMultiplier: 1.5 }), add("HP回復効果", 0.3)],
  {
    note: "代償：MPがほぼ不要になる代わりにHP管理が必要",
    resonance_variant: {
      region: T.gou,
      min_resonance: 3,
      add: [hook("支払ったHPの返還", { ratio: 0.2, delaySeconds: 2 })],
    },
  },
);
special(G, gS[4] as string, "天極", "血の盟約", [k01], PI / 2 - 0.2);

// 共鳴座（剛域）
const gR = chain(G, gCore2[4] as string, PI - 0.6, 3, 12);
special(
  G,
  gR[2] as string,
  "共鳴座",
  "共鳴座・剛域",
  [effect("EFF-RES-GOU", "基本ノード", [hook("残響の台座", { slot: "GOU" })])],
  PI - 0.5,
);
chain(G, gCore[1] as string, PI - 0.9, 5, 12);

// ================= 剛迅域 =================
const J = ctxs["GOUJIN"] as Ctx;
// 双刃座（7）：予約枠の始点の北
const dualId = "CONST-DUALBLADE";
const dual = chain(J, goujinStart, -PI / 2, 7, 11, {
  constellation: dualId,
  bend: 0.18,
  fixed: Array.from({ length: 7 }, () => ({
    name: "双刃の小星",
    mods: [
      add("攻撃速度", 0.03, undefined, { conditions: [{ type: "旗", name: "二刀流" }] }),
      flat("迅", 3),
    ],
  })),
});
const dualBonus = effect(
  "EFF-CONST-DUALBLADE",
  "基本ノード",
  [add("崩し値", 0.3, undefined, { conditions: [{ type: "旗", name: "二刀流の2撃目" }] })],
  { note: "双刃座の完成ボーナス：二刀流のとき、交互攻撃の2撃目の崩し値+30%" },
);
constellations.push({
  id: dualId,
  name: "双刃座",
  region: T.goujin,
  nodes: dual,
  completionEffect: dualBonus,
  provisional: true,
});
// 天極 K09 徒手の極意（南）
const jS = chain(J, goujinStart, PI / 2, 4, 12);
const k09 = effect(
  "EFF-KEY-K09",
  "天極",
  [
    hook("素手の基礎ダメージ", { perLevelMin: 1.0, perLevelMax: 1.8, speed: 1.6, crit: 0.06 }),
    hook("副手の基礎性能・詞・固有効果が2倍", { except: "片手武器" }),
    hook("禁止:主手の武器"),
  ],
  {
    note: "代償：主手に武器を持てない（持つとこの天極は無効になる）",
    conditions: [{ type: "旗", name: "主手が空" }],
  },
);
special(J, jS[3] as string, "天極", "徒手の極意", [k09], PI / 2);
// 機動の輝星・共鳴座・転変
const gale = effect("EFF-NODE-GALE", "輝星", [
  add("移動速度", 0.08),
  add("回避値", 0.2, undefined, { conditions: [{ type: "旗", name: "移動中" }] }),
]);
const jW = chain(J, bridge1[4] as string, PI / 2 + 0.5, 3, 12);
special(J, jW[2] as string, "輝星", "疾風の脚", [gale], PI / 2 + 0.4);
const split = effect(
  "MUT-PRJ-001",
  "転変",
  [
    hook("投射物の追加", { count: 2, spread_deg: 40 }),
    { kind: "乗算", stat: "ダメージ", value: 0.8 },
  ],
  {
    target_skill_tags: { all_of: [T.proj] },
    scope: "自分の技",
    affects: { 打撃値: true, 基準値: true },
  },
);
const jN = chain(J, bridge2[3] as string, -PI / 2 - 0.4, 3, 12);
special(J, jN[2] as string, "転変", "分裂の理", [split], -PI / 2 - 0.3);
const jR2 = chain(J, bridge2[5] as string, PI / 2 - 0.4, 2, 12);
special(
  J,
  jR2[1] as string,
  "共鳴座",
  "共鳴座・剛迅域",
  [effect("EFF-RES-GOUJIN", "基本ノード", [hook("残響の台座", { slot: "GOUJIN" })])],
  PI / 2 - 0.4,
);
chain(J, bridge1[2] as string, -PI / 2 + 0.4, 4, 12);

// ================= 迅域 =================
const I = ctxs["JIN"] as Ctx;
const jCoreN = chain(I, jinStart, -PI / 2, 5, 12, { bend: -0.12 });
const jCoreS = chain(I, jinStart, PI / 2, 5, 12, { bend: 0.12 });
// 毒蛇座（9）
const snakeId = "CONST-VIPER";
const snake = chain(I, jCoreS[2] as string, PI / 2 + 0.4, 9, 11, {
  constellation: snakeId,
  bend: -0.25,
  fixed: Array.from({ length: 9 }, () => ({
    name: "毒蛇の小星",
    mods: [
      add("状態異常ダメージ", 0.08, { ailment: T.poison }),
      flat("状態異常の持続秒数", 0.2, { ailment: T.poison }),
    ],
  })),
});
const snakeBonus = effect(
  "EFF-CONST-VIPER",
  "基本ノード",
  [hook("毒だまり", { minStacks: 10, ratioPerSecond: 0.2 })],
  {
    note: "毒蛇座の完成ボーナス：毒が10スタック以上の敵が移動すると、通った場所に毒だまり（毒の基準値の20%／秒）",
  },
);
constellations.push({
  id: snakeId,
  name: "毒蛇座",
  region: T.jin,
  nodes: snake,
  completionEffect: snakeBonus,
  provisional: true,
});
// 輝星 狙い澄まし・傷口を抉る
const aim = effect("EFF-NODE-AIM", "輝星", [
  add("会心率増加%", 0.4, undefined, {
    conditions: [{ type: "旗", name: "3秒同じ敵に当て続けた" }],
  }),
]);
const wound = effect("EFF-NODE-WOUND", "輝星", [
  hook("出血の持続延長", { seconds: 1, maxRatio: 2 }),
]);
const jA = chain(I, jCoreN[3] as string, -PI / 2 - 0.5, 3, 12);
special(I, jA[2] as string, "輝星", "狙い澄まし", [aim], -PI / 2 - 0.4);
const jB = chain(I, jCoreN[1] as string, -PI / 2 + 0.7, 4, 12);
const woundNode = special(I, jB[3] as string, "輝星", "傷口を抉る", [wound], -PI / 2 + 0.5);
// 転変 血の刃
const bloodBlade = effect(
  "MUT-BLEED-001",
  "転変",
  [hook("出血スタックの即時ダメージ"), add("状態異常ダメージ", -0.15, { ailment: T.bleed })],
  {
    target_skill_tags: { all_of: [T.bleed] },
    scope: "自分の技",
    note: "血の刃：出血を1スタック消費して残りダメージを即座に与える",
  },
);
special(I, woundNode, "転変", "血の刃", [bloodBlade], -PI / 2 + 0.3);
// 星門 獣の門
const jE = chain(I, jCoreN[4] as string, -0.3, 3, 12);
const beastGate = special(I, jE[2] as string, "星門", "獣の門", [], -0.3, 14, {
  gate: {
    condition: { type: "タグ", tags: { any_of: [T.claw, T.scythe] } },
    label: "主手に爪か鎌を装備している",
  },
});
const hunt = effect("EFF-NODE-HUNT", "輝星", [
  add("ダメージ", 0.25, undefined, { conditions: [{ type: "旗", name: "HPが50%以下の敵" }] }),
]);
const huntNode = special(I, beastGate, "輝星", "狩りの本能", [hunt], -0.2);
chain(I, huntNode, -0.2, 3, 12);
// 天極 K15 影写し／ K12 千変（星核寄り＝東）
const k15 = effect(
  "EFF-KEY-K15",
  "天極",
  [hook("遅延ダメージ", { ratio: 0.35, seconds: 4, cancelOnKill: 0.2 }), hook("禁止:遅延分の回復")],
  { note: "代償：回復で遅延分を減らすことはできない" },
);
const jK = chain(I, jCoreS[4] as string, 0.4, 4, 12);
special(I, jK[3] as string, "天極", "影写し", [k15], 0.4);
const k12 = effect(
  "EFF-KEY-K12",
  "天極",
  [hook("臨界", { kinds: 3, ratio: 0.6, intervalSeconds: 2 })],
  { note: "代償：状態異常が消えるので、付け直しが必要になる" },
);
const jKK = chain(I, jinStart, 0, 6, 12);
const kk = special(I, jKK[5] as string, "天極", "千変", [k12], 0);
// 共鳴座（迅域）
const jR = chain(I, jCoreN[2] as string, -PI / 2 + 1.1, 3, 12);
special(
  I,
  jR[2] as string,
  "共鳴座",
  "共鳴座・迅域",
  [effect("EFF-RES-JIN", "基本ノード", [hook("残響の台座", { slot: "JIN" })])],
  -PI / 2 + 1.1,
);
// 輪の補強
chain(I, kk, -0.5, 3, 12);

const write = (name: string, items: Json[]): void => {
  writeFileSync(`${outDir}${name}`, JSON.stringify({ dataVersion: 1, items }, null, 2) + "\n");
};
write("effects.json", effects);
write("nodes.json", nodes);
write("constellations.json", constellations);
console.log(
  `星辰盤：ノード${String(nodes.length)}・効果${String(effects.length)}・星座${String(constellations.length)}`,
);
