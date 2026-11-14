/**
 * 星辰盤の MVP の範囲の追加分を作る（pnpm gen:star）。
 *
 * - 出力：packages/content/data/boards/star-mvp.json（ノード）と data/effects/star-mvp.json（効果）
 * - 既存の盤（data/boards/star.json）は変えない。ID を消す・変えると、既存のセーブデータが読めなくなるため。
 *   追加分は、既存のノードの先に枝としてつなぐ（つながりは追加分の側に書く）
 * - 名前つきのノードは、仕様書v0.2 にあるものだけ（4.5 の輝星・4.6 の転変・4.9 の星門の先）。
 *   戦士・盗賊で使えないもの（ガード・召喚・投射物・サブジョブが前提）は置かない
 * - 小星は、4.2 の星域のテーマと、4.3・4.4 の例の値の大きさで作る（値は仮。docs/progress D-STAR-12）
 *
 * - 8星域の環（仕様書v0.2 4.2。docs/progress D-RING-1〜6）：剛域→剛魂域→魂域→理魂域→理域→迅理域→迅域→剛迅域→剛域と、
 *   中心の星核を、少ないノードの「骨組み」でつなぐ（このファイルの末尾の「8星域の環」）
 *
 * 位置は星辰盤の画面の座標。ノードどうしが重ならないことは、テストで確かめる。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Mod =
  | { kind: "added" | "increased"; stat: string; value: number; filter?: { allOf?: string[] } }
  | {
      kind: "more";
      stat: string;
      value: number;
      filter?: { allOf?: string[] };
      drawback?: boolean;
    }
  | { kind: "flag"; flag: string; mode: "force" | "forbid"; drawback?: boolean };

interface EffectOut {
  id: string;
  origin: string;
  modifiers: Mod[];
  conditions?: unknown[];
  affects: { hit: boolean; ailmentBase: boolean };
  scope: "self";
  provisional: true;
  provisionalNote: string;
}

/** 星域（packages/core の STAR_REGIONS と同じ）。 */
type Region = "gou" | "goukon" | "kon" | "rikon" | "ri" | "jinri" | "jin" | "goujin" | "core";

interface NodeOut {
  id: string;
  text?: string;
  kind: "minor" | "notable" | "mutation" | "keystone";
  region: Region;
  links: string[];
  effects: string[];
  position: { x: number; y: number };
  resonanceCapBonus?: number;
  provisional: true;
  provisionalNote: string;
}

const NOTE_NODE =
  "星辰盤の MVP の追加分（tools/scripts/gen-star-mvp.ts で作る。配置は仮。docs/progress D-STAR-12）";
const NOTE_MINOR =
  "小星の値は、仕様書v0.2 4.3・4.4 の例の大きさに合わせた仮値（docs/progress D-STAR-12）";
const NOTE_NAMED =
  "仕様書v0.2 4.5・4.6・4.9 の効果。挙動はゲームのルールフック（docs/progress D-STAR-13）";

const effects: EffectOut[] = [];
const nodes: NodeOut[] = [];

function effect(
  id: string,
  origin: string,
  modifiers: Mod[],
  hit: boolean,
  note = NOTE_MINOR,
  conditions?: unknown[],
): string {
  effects.push({
    id,
    origin,
    modifiers,
    ...(conditions === undefined ? {} : { conditions }),
    affects: { hit, ailmentBase: hit },
    scope: "self",
    provisional: true,
    provisionalNote: note,
  });
  return id;
}

// ---- 小星（星域のテーマ。仕様書v0.2 4.2 の表） ----
// 仕様書4.3「小星は必ずタグの条件か副次効果を持つ」：能力値の小星と、4.4 に内容が書かれた星座の小星を除き、
// 主の効果に小さな副次効果（主の効果の1/3ほど）を1つ付ける（docs/progress D-FIN-3）
const inc = (stat: string, value: number, allOf?: string[]): Mod => ({
  kind: "increased",
  stat,
  value,
  ...(allOf === undefined ? {} : { filter: { allOf } }),
});
const add = (stat: string, value: number, allOf?: string[]): Mod => ({
  kind: "added",
  stat,
  value,
  ...(allOf === undefined ? {} : { filter: { allOf } }),
});
const MINOR = {
  // 剛域：最大HP・防具値・近接・崩し・闘志
  gouHp: effect(
    "EFF-SM-GOU-HP",
    "minorStar",
    [add("STAT-HP-MAX", 12), inc("STAT-ARMOR", 0.02)],
    false,
  ),
  gouArmor: effect(
    "EFF-SM-GOU-ARMOR",
    "minorStar",
    [inc("STAT-ARMOR", 0.06), add("STAT-HP-MAX", 4)],
    false,
  ),
  gouMelee: effect(
    "EFF-SM-GOU-MELEE",
    "minorStar",
    [inc("STAT-DAMAGE", 0.06, ["TAG-FORM-MELEE"])],
    true,
  ),
  gouStagger: effect(
    "EFF-SM-GOU-STAGGER",
    "minorStar",
    [inc("STAT-STAGGER", 0.08), inc("STAT-DAMAGE", 0.02, ["TAG-FORM-MELEE"])],
    true,
  ),
  gouAttr: "EFF-STAR-GO-10",
  // 迅域：会心・回避・速度・毒・出血
  jinCrit: effect(
    "EFF-SM-JIN-CRIT",
    "minorStar",
    [inc("STAT-CRIT-CHANCE", 0.08), add("STAT-CRIT-MULTIPLIER", 0.04)],
    true,
  ),
  jinEvasion: effect(
    "EFF-SM-JIN-EVASION",
    "minorStar",
    [inc("STAT-EVASION", 0.06), inc("STAT-MOVE-SPEED", 0.01)],
    false,
  ),
  jinSpeed: effect(
    "EFF-SM-JIN-SPEED",
    "minorStar",
    [inc("STAT-ATTACK-SPEED", 0.03), inc("STAT-MOVE-SPEED", 0.01)],
    false,
  ),
  jinPoison: effect(
    "EFF-SM-JIN-POISON",
    "minorStar",
    [
      inc("STAT-AILMENT-DAMAGE", 0.06, ["TAG-AIL-POISON"]),
      add("STAT-AILMENT-DURATION", 0.3, ["TAG-AIL-POISON"]),
    ],
    true,
  ),
  jinBleed: "EFF-STAR-BLEED-6",
  jinAttr: "EFF-STAR-JIN-10",
  // 剛迅域：二刀流・機動
  gjDual: "EFF-STAR-TWIN-SPEED",
  gjMove: effect(
    "EFF-SM-GJ-MOVE",
    "minorStar",
    [inc("STAT-MOVE-SPEED", 0.02), inc("STAT-EVASION", 0.02)],
    false,
  ),
  gjAttr: "EFF-STAR-GOJIN-5",
} as const;

// ---- 名前つきのノード（仕様書v0.2 にあるものだけ） ----
const named = {
  // 4.9 星門の先
  swordAura: effect(
    "EFF-NT-SWORD-AURA",
    "notableStar",
    [add("STAT-NT-SWORD-AURA", 0.1)],
    false,
    NOTE_NAMED,
  ),
  hunt: effect("EFF-NT-HUNT", "notableStar", [add("STAT-NT-HUNT", 0.25)], false, NOTE_NAMED),
  // 4.5 輝星
  severing: effect(
    "EFF-NT-SEVERING",
    "notableStar",
    [inc("STAT-DAMAGE", 0.2, ["TAG-FORM-MELEE"]), add("STAT-NT-BROKEN-MELEE", 0.2)],
    true,
    NOTE_NAMED,
  ),
  ironSkin: effect(
    "EFF-NT-IRON-SKIN",
    "notableStar",
    [inc("STAT-ARMOR", 0.3)],
    false,
    "仕様書v0.2 4.5。「ガード中は崩されない」はガードの操作が無いので省く",
  ),
  focus: effect("EFF-NT-FOCUS", "notableStar", [add("STAT-NT-FOCUS", 0.4)], false, NOTE_NAMED),
  shadowStep: effect(
    "EFF-NT-SHADOW-STEP",
    "notableStar",
    [add("STAT-NT-SHADOW-STEP", 0.25)],
    false,
    NOTE_NAMED,
  ),
  corrode: effect(
    "EFF-NT-CORRODE",
    "notableStar",
    [add("STAT-NT-CORRODE", 0.1)],
    false,
    NOTE_NAMED,
  ),
  gale: effect(
    "EFF-NT-GALE",
    "notableStar",
    [inc("STAT-MOVE-SPEED", 0.08), add("STAT-NT-GALE", 0.2)],
    false,
    NOTE_NAMED,
  ),
  layers: effect(
    "EFF-NT-LAYERS",
    "notableStar",
    [inc("STAT-ARMOR", 0.15), inc("STAT-EVASION", 0.15), inc("STAT-WARD-MAX", 0.15)],
    false,
    "仕様書v0.2 4.5「重ね着の妙」：重装・軽装・法衣を全て装備していると、全防御+15%",
    [
      { type: "factAtLeast", fact: "armor.heavy.count", value: 1 },
      { type: "factAtLeast", fact: "armor.light.count", value: 1 },
      { type: "factAtLeast", fact: "armor.robe.count", value: 1 },
    ],
  ),
  cycle: effect("EFF-NT-CYCLE", "notableStar", [add("STAT-NT-CYCLE", 0.05)], false, NOTE_NAMED),
  vessel: effect(
    "EFF-NT-VESSEL",
    "notableStar",
    [add("STAT-NT-VESSEL", 0.1)],
    false,
    "仕様書v0.2 4.5「星の器」：この星域の共鳴紋の効果の上限+10%（40% → 50%）。盤の評価で扱う",
  ),
  // 4.6 転変（乗算は減らす方向だけ）
  heavy: effect(
    "EFF-MUT-HEAVY",
    "mutation",
    [
      inc("STAT-STAGGER", 0.6, ["TAG-FORM-MELEE"]),
      inc("STAT-DAMAGE", 0.3, ["TAG-FORM-MELEE"]),
      inc("STAT-ATTACK-SPEED", -0.3),
      add("STAT-MUT-HEAVY", 1),
    ],
    true,
    "仕様書v0.2 4.6「重撃化」。近接の技は重撃のタグを得る（闘志の獲得）。攻撃速度-30%は全ての攻撃に",
  ),
  bloodBlade: effect(
    "EFF-MUT-BLOOD-BLADE",
    "mutation",
    [add("STAT-MUT-BLOOD-BLADE", 1), inc("STAT-AILMENT-DAMAGE", -0.3, ["TAG-AIL-BLEED"])],
    true,
    "仕様書v0.2 4.6「血の刃」。「出血の持続ダメージそのものは減る」の量は記載が無いので -30%（docs/progress D-STAR-13）",
  ),
} as const;

// 名前つきのノードの一時的な効果（ゲームが一定時間かける）
effect(
  "EFF-BUFF-FOCUS",
  "notableStar",
  [inc("STAT-CRIT-CHANCE", 0.4)],
  true,
  "狙い澄まし：同じ敵に3秒当て続けている間",
);
effect(
  "EFF-BUFF-SHADOW-STEP",
  "notableStar",
  [inc("STAT-DAMAGE-TAKEN", -0.25)],
  false,
  "影踏み：回避に成功した後1秒間",
);

/** 名前の文章のキー。 */
const TEXT: Record<string, string> = {};
function textKey(id: string, name: string): string {
  const key = `star.mvp.${id.toLowerCase().replace(/^star-/, "")}`;
  TEXT[key] = name;
  return key;
}

/**
 * from から、決まった向きに小星を並べ、最後に名前つきのノードを置く。
 * 戻り値は作ったノードの ID（最後が名前つきのノード）。
 */
function chain(
  prefix: string,
  region: NodeOut["region"],
  from: string,
  start: { x: number; y: number },
  step: { x: number; y: number },
  minors: readonly string[],
  count: number,
  end?: {
    id: string;
    kind: "notable" | "mutation";
    name: string;
    effect: string;
    resonanceCapBonus?: number;
  },
): string[] {
  const ids: string[] = [];
  let prev = from;
  for (let i = 0; i < count; i++) {
    const id = `${prefix}-${String(i + 1).padStart(2, "0")}`;
    nodes.push({
      id,
      kind: "minor",
      region,
      links: [prev],
      effects: [minors[i % minors.length] as string],
      position: { x: start.x + step.x * i, y: start.y + step.y * i },
      provisional: true,
      provisionalNote: NOTE_NODE,
    });
    ids.push(id);
    prev = id;
  }
  if (end !== undefined) {
    nodes.push({
      id: end.id,
      text: textKey(end.id, end.name),
      kind: end.kind,
      region,
      links: [prev],
      effects: [end.effect],
      position: { x: start.x + step.x * count, y: start.y + step.y * count },
      ...(end.resonanceCapBonus === undefined ? {} : { resonanceCapBonus: end.resonanceCapBonus }),
      provisional: true,
      provisionalNote: NOTE_NODE,
    });
    ids.push(end.id);
  }
  return ids;
}

// ---- 星門の先（開発計画書4.2 の MVP の星門：刃の門・獣の門） ----
chain(
  "STAR-SM-BLADE",
  "gou",
  "STAR-GOU-0102",
  { x: -200, y: 320 },
  { x: 0, y: 40 },
  [MINOR.gouMelee],
  1,
  {
    id: "STAR-NT-SWORD-AURA",
    kind: "notable",
    name: "剣気",
    effect: named.swordAura,
  },
);
chain(
  "STAR-SM-BEAST",
  "jin",
  "STAR-JIN-0102",
  { x: 200, y: 320 },
  { x: 0, y: 40 },
  [MINOR.jinCrit],
  1,
  {
    id: "STAR-NT-HUNT",
    kind: "notable",
    name: "狩りの本能",
    effect: named.hunt,
  },
);

// ---- 剛域（戦士の側。鍛冶座の先から北へ） ----
const gouA = chain(
  "STAR-SM-GOU-A",
  "gou",
  "STAR-SMITH-08",
  { x: -610, y: 110 },
  { x: 0, y: -40 },
  [MINOR.gouHp, MINOR.gouMelee, MINOR.gouArmor, MINOR.gouStagger, MINOR.gouAttr],
  7,
  { id: "STAR-NT-SEVERING", kind: "notable", name: "断ち切る刃", effect: named.severing },
);
chain(
  "STAR-SM-GOU-B",
  "gou",
  gouA[2] as string,
  { x: -650, y: 30 },
  { x: -40, y: 0 },
  [MINOR.gouArmor, MINOR.gouHp],
  3,
  { id: "STAR-NT-IRON-SKIN", kind: "notable", name: "鉄の皮膚", effect: named.ironSkin },
);
chain(
  "STAR-SM-GOU-C",
  "gou",
  gouA[5] as string,
  { x: -570, y: -90 },
  { x: 40, y: 0 },
  [MINOR.gouStagger, MINOR.gouMelee],
  3,
  { id: "STAR-MUT-HEAVY", kind: "mutation", name: "重撃化", effect: named.heavy },
);
chain(
  "STAR-SM-GOU-D",
  "gou",
  "STAR-NT-SEVERING",
  { x: -610, y: -210 },
  { x: 0, y: -40 },
  [MINOR.gouHp, MINOR.gouArmor, MINOR.gouAttr, MINOR.gouMelee],
  6,
  { id: "STAR-NT-LAYERS", kind: "notable", name: "重ね着の妙", effect: named.layers },
);

// ---- 迅域（盗賊の側。毒蛇座の先から北へ） ----
const jinA = chain(
  "STAR-SM-JIN-A",
  "jin",
  "STAR-VIPER-09",
  { x: 690, y: 110 },
  { x: 0, y: -40 },
  [MINOR.jinCrit, MINOR.jinPoison, MINOR.jinSpeed, MINOR.jinBleed, MINOR.jinEvasion],
  7,
  { id: "STAR-NT-FOCUS", kind: "notable", name: "狙い澄まし", effect: named.focus },
);
chain(
  "STAR-SM-JIN-B",
  "jin",
  jinA[1] as string,
  { x: 730, y: 70 },
  { x: 40, y: 0 },
  [MINOR.jinEvasion, MINOR.jinSpeed],
  3,
  { id: "STAR-NT-SHADOW-STEP", kind: "notable", name: "影踏み", effect: named.shadowStep },
);
chain(
  "STAR-SM-JIN-C",
  "jin",
  jinA[4] as string,
  { x: 650, y: -50 },
  { x: -40, y: 0 },
  [MINOR.jinPoison, MINOR.jinBleed],
  3,
  { id: "STAR-NT-CORRODE", kind: "notable", name: "腐食の手", effect: named.corrode },
);
chain(
  "STAR-SM-JIN-D",
  "jin",
  "STAR-NT-FOCUS",
  { x: 690, y: -210 },
  { x: 0, y: -40 },
  [MINOR.jinBleed, MINOR.jinCrit, MINOR.jinAttr],
  3,
  { id: "STAR-MUT-BLOOD-BLADE", kind: "mutation", name: "血の刃", effect: named.bloodBlade },
);
chain(
  "STAR-SM-JIN-E",
  "jin",
  "STAR-MUT-BLOOD-BLADE",
  { x: 730, y: -330 },
  { x: 40, y: 0 },
  [MINOR.jinSpeed, MINOR.jinEvasion, MINOR.jinAttr],
  4,
  {
    id: "STAR-NT-VESSEL-JIN",
    kind: "notable",
    name: "星の器",
    effect: named.vessel,
    resonanceCapBonus: 0.1,
  },
);

// ---- 影法師座（仕様書v0.2 4.4：迅域・小星7つ・背面からの会心率+1%〔固定値〕。docs/progress D-FIN-3） ----
// 完成ボーナス「影縫いの装束の仮想部位になる」はセット装備（MVPの範囲の外）の部位の数に足す値で、MVPでは何も起きない
const SHADOW_MINOR = effect(
  "EFF-STAR-SHADOW-BACKSTAB",
  "minorStar",
  [add("STAT-BACKSTAB-CRIT", 0.01)],
  true,
  "仕様書v0.2 4.4 の影法師座の小星の値（docs/progress D-FIN-3）",
);
chain(
  "STAR-SHADOW",
  "jin",
  jinA[2] as string,
  { x: 730, y: 30 },
  { x: 40, y: 0 },
  [SHADOW_MINOR],
  7,
);
effect(
  "EFF-CONST-SHADOW",
  "constellation",
  [add("STAT-CONST-SHADOW-SET", 1)],
  false,
  "仕様書v0.2 4.4：影縫いの装束の仮想部位（セット装備は MVP の範囲の外なので、MVPでは働かない。docs/progress D-FIN-3）",
);

// ---- 剛迅域（双刃座の先から西へ） ----
const gj = chain(
  "STAR-SM-GJ-A",
  "goujin",
  "STAR-TWIN-07",
  { x: -40, y: -480 },
  { x: -40, y: 0 },
  [MINOR.gjMove, MINOR.gjDual, MINOR.gjAttr],
  7,
  { id: "STAR-NT-GALE", kind: "notable", name: "疾風の脚", effect: named.gale },
);
chain(
  "STAR-SM-GJ-B",
  "goujin",
  gj[3] as string,
  { x: -160, y: -520 },
  { x: 0, y: -40 },
  [MINOR.gjAttr, MINOR.gjMove],
  3,
  { id: "STAR-NT-CYCLE", kind: "notable", name: "循環の泉", effect: named.cycle },
);
chain(
  "STAR-SM-GJ-C",
  "goujin",
  "STAR-NT-GALE",
  { x: -320, y: -440 },
  { x: 0, y: 40 },
  [MINOR.gjDual, MINOR.gjMove, MINOR.gjAttr],
  4,
);

// ---- 8星域の環（仕様書v0.2 4.2。骨組みだけ。docs/progress D-RING-1〜6） ----
// 環：剛域→剛魂域→魂域→理魂域→理域→迅理域→迅域→剛迅域→剛域。中心に星核。
// - 既存のノードの ID・効果は変えない。追加のノードから既存のノードへのつながりを、追加の側に書く
// - 始点は取れない（StarAllocation）ので、ほかのジョブの始点は通れない。剛域・迅域の始点の脇に、
//   始点を通らずに環を回れる小星を1つずつ置く（D-RING-3）
// - 小星は能力値の小星だけ（仕様書4.3 の「剛／迅／理／魂+10、または2種類に+5ずつ」。星核は巡礼者座の「全能力値+3」）。
//   新しい強さの数値は作らない（D-RING-4）
// - 天極は、仕様書4.7 の魂域の K05 と星核の K11 の、能力値で表せる部分だけ（D-RING-5）
const NOTE_RING =
  "8星域の環の骨組み（tools/scripts/gen-star-mvp.ts。配置は仮。docs/progress D-RING-1）";
const attr = (id: string, parts: [string, number][]): string =>
  effect(
    id,
    "minorStar",
    parts.map(([stat, value]) => add(stat, value)),
    false,
    "仕様書v0.2 4.3 の能力値の小星（剛／迅／理／魂+10、または2種類に+5ずつ）。8星域の環（docs/progress D-RING-4）",
  );
const RING = {
  ri: attr("EFF-STAR-RI-10", [["STAT-ATTR-RI", 10]]),
  kon: attr("EFF-STAR-KON-10", [["STAT-ATTR-KON", 10]]),
  goukon: attr("EFF-STAR-GOKON-5", [
    ["STAT-ATTR-GO", 5],
    ["STAT-ATTR-KON", 5],
  ]),
  rikon: attr("EFF-STAR-RIKON-5", [
    ["STAT-ATTR-RI", 5],
    ["STAT-ATTR-KON", 5],
  ]),
  core: effect(
    "EFF-STAR-ALL-3",
    "minorStar",
    [
      add("STAT-ATTR-GO", 3),
      add("STAT-ATTR-JIN", 3),
      add("STAT-ATTR-RI", 3),
      add("STAT-ATTR-KON", 3),
    ],
    false,
    "仕様書v0.2 4.4 の巡礼者座（星核の周縁）の小星の値「全能力値+3」。星座にはしていない（docs/progress D-RING-4）",
  ),
} as const;

// 天極の効果（affects を個別に決めるので、effect() を使わずに足す）
function keystoneEffect(
  id: string,
  modifiers: Mod[],
  affects: EffectOut["affects"],
  note: string,
): string {
  effects.push({
    id,
    origin: "keystone",
    modifiers,
    affects,
    scope: "self",
    provisional: true,
    provisionalNote: note,
  });
  return id;
}
const KEY = {
  // K05 腐敗の聖杯（魂域）：状態異常のダメージ×1.5。代償：打撃値-50%（基準値は変わらない）
  corrupt: keystoneEffect(
    "EFF-KEY-CORRUPT",
    [{ kind: "more", stat: "STAT-AILMENT-DAMAGE", value: 1.5 }],
    { hit: false, ailmentBase: true },
    "仕様書v0.2 4.7 K05「腐敗の聖杯」の利点。「死んだ敵の状態異常が近くの敵に移る」はルールフックが無いので、まだ働かない（docs/progress D-RING-5）",
  ),
  corruptCost: keystoneEffect(
    "EFF-KEY-CORRUPT-COST",
    [{ kind: "more", stat: "STAT-DAMAGE", value: 0.5, drawback: true }],
    { hit: true, ailmentBase: false },
    "仕様書v0.2 4.7 K05「腐敗の聖杯」の代償：打撃値-50%（基準値は変わらない＝状態異常の基準値には効かない）",
  ),
  // K11 均衡の天秤（星核）：付与率+50%。代償：会心しなくなる
  balance: keystoneEffect(
    "EFF-KEY-BALANCE",
    [
      { kind: "flag", flag: "crit", mode: "forbid", drawback: true },
      inc("STAT-AILMENT-CHANCE", 0.5),
    ],
    { hit: true, ailmentBase: true },
    "仕様書v0.2 4.7 K11「均衡の天秤」の、能力値で表せる部分（会心しない・付与率+50%）。「ダメージを平均で固定」「付与を蓄積にする」はルールフックが無いので、まだ働かない（docs/progress D-RING-5）",
  ),
} as const;

/** 環のノードを1つ足す（つながりは、この新しいノードの側に書く）。 */
function ringNode(
  id: string,
  region: Region,
  links: string[],
  effectId: string,
  position: { x: number; y: number },
  keystone?: { name: string; extra?: string[] },
): string {
  nodes.push({
    id,
    ...(keystone === undefined ? {} : { text: textKey(id, keystone.name) }),
    kind: keystone === undefined ? "minor" : "keystone",
    region,
    links,
    effects: [effectId, ...(keystone?.extra ?? [])],
    position,
    provisional: true,
    provisionalNote: NOTE_RING,
  });
  return id;
}

// 始点を通らない脇道（D-RING-3）：剛域（剛迅域の弧 ↔ 剛域の幹）・迅域（剛迅域の弧 ↔ 迅域の幹）
ringNode("STAR-SM-GOU-R-01", "gou", ["STAR-GOUJIN-0001", "STAR-GOU-0001"], MINOR.gouAttr, {
  x: -140,
  y: 0,
});
ringNode("STAR-SM-JIN-R-01", "jin", ["STAR-JIN-0011", "STAR-JIN-0001"], MINOR.jinAttr, {
  x: 140,
  y: 0,
});

// 迅域 → 迅理域 → 理域 → 理魂域（右下。D-RING-2：魔法使い・召喚士の始点を、迅域の STAR-JIN-0202 から付け替えた）
// 迅理域の小星は「迅+10」：魔法使いの計測のビルドは、ここを通って迅域へ行くので、理（MP）を足すと計測が動く（D-RING-4）
const jr = ringNode("STAR-SM-JR-A-01", "jinri", ["STAR-JIN-0201", "STAR-RI-START"], MINOR.jinAttr, {
  x: 250,
  y: 170,
});
const riA = ringNode("STAR-SM-RI-A-01", "ri", [jr, "STAR-RI-START", "STAR-RIKON-START"], RING.ri, {
  x: 260,
  y: 270,
});
const riB = ringNode("STAR-SM-RI-B-01", "ri", ["STAR-RI-START"], RING.ri, { x: 400, y: 270 });
ringNode("STAR-SM-RI-B-02", "ri", [riB], RING.ri, { x: 470, y: 300 });
const rkA1 = ringNode("STAR-SM-RK-A-01", "rikon", [riA, "STAR-RIKON-START"], RING.rikon, {
  x: 250,
  y: 410,
});
const rkA2 = ringNode("STAR-SM-RK-A-02", "rikon", [rkA1], RING.rikon, { x: 160, y: 470 });
ringNode("STAR-SM-RK-B-01", "rikon", ["STAR-RIKON-START"], RING.rikon, { x: 420, y: 400 });

// 魂域（下。始点は予約枠なので置かない。D-RING-6）
const konA1 = ringNode("STAR-SM-KON-A-01", "kon", [rkA2], RING.kon, { x: 75, y: 520 });
const konA2 = ringNode("STAR-SM-KON-A-02", "kon", [konA1], RING.kon, { x: 0, y: 540 });
const konA3 = ringNode("STAR-SM-KON-A-03", "kon", [konA2], RING.kon, { x: -75, y: 520 });
const konB = ringNode("STAR-SM-KON-B-01", "kon", [konA2], RING.kon, { x: 0, y: 615 });
ringNode(
  "STAR-KEY-CORRUPT",
  "kon",
  [konB],
  KEY.corrupt,
  { x: 0, y: 690 },
  {
    name: "腐敗の聖杯",
    extra: [KEY.corruptCost],
  },
);

// 剛魂域 → 剛域（左下。騎士の始点の STAR-GOU-0004 へのつながりは star.json のまま）
const gkA1 = ringNode("STAR-SM-GK-A-01", "goukon", [konA3], RING.goukon, { x: -125, y: 450 });
const gkA2 = ringNode("STAR-SM-GK-A-02", "goukon", [gkA1], RING.goukon, { x: -130, y: 370 });
const gkA3 = ringNode("STAR-SM-GK-A-03", "goukon", [gkA2], RING.goukon, { x: -130, y: 290 });
ringNode("STAR-SM-GK-A-04", "goukon", [gkA3, "STAR-GOU-0004", "STAR-GOUKON-START"], RING.goukon, {
  x: -130,
  y: 205,
});

// 星核（中心）：4つの小星の輪と、真ん中の天極。剛域・迅域・魂域・剛迅域から1本ずつの道
const coreA1 = ringNode("STAR-SM-CORE-A-01", "core", [], RING.core, { x: 0, y: 120 });
const coreA2 = ringNode("STAR-SM-CORE-A-02", "core", [coreA1], RING.core, { x: 60, y: 180 });
const coreA3 = ringNode("STAR-SM-CORE-A-03", "core", [coreA2], RING.core, { x: 0, y: 240 });
const coreA4 = ringNode("STAR-SM-CORE-A-04", "core", [coreA3, coreA1], RING.core, {
  x: -60,
  y: 180,
});
ringNode(
  "STAR-KEY-BALANCE",
  "core",
  [coreA1],
  KEY.balance,
  { x: 0, y: 180 },
  { name: "均衡の天秤" },
);
// 道：剛迅域の弧の頂点から下へ
const t1 = ringNode("STAR-SM-CORE-T-01", "core", ["STAR-GOUJIN-0005"], RING.core, {
  x: 0,
  y: -90,
});
const t2 = ringNode("STAR-SM-CORE-T-02", "core", [t1], RING.core, { x: 0, y: -20 });
ringNode("STAR-SM-CORE-T-03", "core", [t2, coreA1], RING.core, { x: 0, y: 50 });
// 道：剛域の幹・迅域の幹から
ringNode("STAR-SM-CORE-L-01", "core", ["STAR-GOU-0001", coreA4], RING.core, { x: -120, y: 60 });
ringNode("STAR-SM-CORE-R-01", "core", ["STAR-JIN-0003", coreA2], RING.core, { x: 125, y: 140 });
// 道：魂域から上へ
const kc1 = ringNode("STAR-SM-KON-C-01", "kon", [konA2], RING.kon, { x: 0, y: 465 });
const kc2 = ringNode("STAR-SM-KON-C-02", "kon", [kc1], RING.kon, { x: 0, y: 390 });
ringNode("STAR-SM-KON-C-03", "kon", [kc2, coreA3], RING.kon, { x: 0, y: 315 });

// ---- 名前つきのノードのルールフックの値（能力値） ----
const STATS: { id: string; text: string; unit: "flat" | "ratio" | "seconds"; name: string }[] = [
  {
    id: "STAT-NT-SWORD-AURA",
    text: "stat.nt-sword-aura",
    unit: "ratio",
    name: "剣気：衝撃波の確率",
  },
  {
    id: "STAT-NT-HUNT",
    text: "stat.nt-hunt",
    unit: "ratio",
    name: "狩りの本能：HPが半分以下の敵へのダメージ",
  },
  {
    id: "STAT-NT-BROKEN-MELEE",
    text: "stat.nt-broken-melee",
    unit: "ratio",
    name: "崩れた敵への近接ダメージ",
  },
  { id: "STAT-NT-FOCUS", text: "stat.nt-focus", unit: "ratio", name: "狙い澄まし：会心率の増加" },
  {
    id: "STAT-NT-SHADOW-STEP",
    text: "stat.nt-shadow-step",
    unit: "ratio",
    name: "影踏み：回避の後の受けるダメージの軽減",
  },
  {
    id: "STAT-NT-CORRODE",
    text: "stat.nt-corrode",
    unit: "ratio",
    name: "腐食の手：状態異常の敵の物理耐性の低下",
  },
  { id: "STAT-NT-GALE", text: "stat.nt-gale", unit: "ratio", name: "疾風の脚：移動中の回避値" },
  {
    id: "STAT-NT-CYCLE",
    text: "stat.nt-cycle",
    unit: "ratio",
    name: "循環の泉：MP100ごとの職能ゲージ",
  },
  { id: "STAT-NT-VESSEL", text: "stat.nt-vessel", unit: "ratio", name: "星の器" },
  { id: "STAT-MUT-HEAVY", text: "stat.mut-heavy", unit: "flat", name: "重撃化" },
  { id: "STAT-MUT-BLOOD-BLADE", text: "stat.mut-blood-blade", unit: "flat", name: "血の刃" },
  {
    id: "STAT-CONST-SHADOW-SET",
    text: "stat.const-shadow-set",
    unit: "flat",
    name: "影縫いの装束の仮想部位",
  },
];
for (const st of STATS) TEXT[st.text] = st.name;

const root = fileURLToPath(new URL("../../packages/content/", import.meta.url));
const json = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;
writeFileSync(`${root}data/boards/star-mvp.json`, json(nodes));
writeFileSync(`${root}data/effects/star-mvp.json`, json(effects));
writeFileSync(
  `${root}data/stats/star-mvp.json`,
  json(STATS.map((st) => ({ id: st.id, text: st.text, unit: st.unit, min: 0 }))),
);
// 名前の文章は text/ja.json に足す（同じキーは上書き）
const textPath = `${root}text/ja.json`;
const texts = JSON.parse(readFileSync(textPath, "utf-8")) as Record<string, string>;
writeFileSync(textPath, json({ ...texts, ...TEXT }));
console.log(`星辰盤の追加分：ノード ${String(nodes.length)}・効果 ${String(effects.length)}`);
