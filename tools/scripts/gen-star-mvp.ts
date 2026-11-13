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
 * 位置は星辰盤の画面の座標。ノードどうしが重ならないことは、テストで確かめる。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Mod =
  | { kind: "added" | "increased"; stat: string; value: number; filter?: { allOf?: string[] } }
  | { kind: "more"; stat: string; value: number; filter?: { allOf?: string[] } };

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

interface NodeOut {
  id: string;
  text?: string;
  kind: "minor" | "notable" | "mutation";
  region: "gou" | "goujin" | "jin";
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
