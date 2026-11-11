/**
 * 星読みの記録の簡易版（仕様書v0.2 6.7・補助仕様書16章「新しい相互作用を発動した」）。
 * 仕様書6.6 の相互作用の一覧（I-xx）のうち、MVPで起こるものについて、今の状態で効いているかを判定する。
 * 初めて効いたものを「新しい星の巡り」として知らせ、セーブの discoveries.interactions_seen に残す（D-UI-3）。
 * Phaser に依存しない。
 */
import type { CharacterSheet, ContentDb, Equipment, StarRegion } from "@stella/core";

/** 相互作用の名前（仕様書6.6 の一覧の見出し。MVPで判定するものだけ）。 */
export const INTERACTION_NAMES: Readonly<Record<string, string>> = {
  "I-01": "共鳴紋",
  "I-02": "共鳴変化",
  "I-03": "星門の開閉",
  "I-09": "潜在効果の発動",
  "I-11": "装備部位のルールを変える天極",
  "I-12": "強化値を参照するノード",
  "I-13": "防具種を参照するノード",
  "I-15": "武器による技の変化",
  "I-16": "武器適性",
  "I-17": "職詞",
  "I-21": "武具連携",
  "I-23": "職紋盤の接続ノード",
  "I-25": "職能ゲージを参照する輝星",
  "I-30": "千の小傷 × 毒血同源 × 千変",
  "I-33": "徒手の極意 × 重荷の誇り × 盾",
};

export interface InteractionState {
  readonly db: ContentDb;
  readonly sheet: CharacterSheet;
  readonly equipment: Equipment;
  /** メインジョブのタグ（職詞の判定）。 */
  readonly mainJobTag: string;
  /** 武具連携（主手×副手）が成り立っているか。 */
  readonly pairing: boolean;
}

/** 今の装備・盤の状態で効いている相互作用（技を使ったときの I-15 は別。skillInteractions）。 */
export function activeInteractions(s: InteractionState): string[] {
  const { db, sheet, equipment } = s;
  const board = sheet.board;
  const active = new Set(board?.active ?? []);
  const has = (id: string): boolean => active.has(id);
  const out: string[] = [];
  // I-01：共鳴紋のある星域の輝星を取っている
  const resonance: Partial<Record<StarRegion, number>> = equipment.resonance();
  if (
    [...active].some((id) => {
      const n = db.starNodes.get(id);
      return n?.kind === "notable" && (resonance[n.region] ?? 0) > 0;
    })
  )
    out.push("I-01");
  if ((board?.resonating.length ?? 0) > 0) out.push("I-02");
  if ((board?.gates.size ?? 0) > 0) out.push("I-03");
  if (sheet.latents.some((l) => l.active)) out.push("I-09");
  const bareHands = has("STAR-KEY-BARE-HANDS") && equipment.get("mainHand") === undefined;
  if (bareHands) out.push("I-11");
  if (board?.constellations.includes("CONST-SMITH") === true) out.push("I-12");
  if (has("STAR-NT-LAYERS")) out.push("I-13");
  if (sheet.weapon !== undefined && sheet.affinity === "S") out.push("I-16");
  const mainJobTag = s.mainJobTag;
  if (
    equipment
      .entries()
      .some(([, item]) => item.affixes.some((a) => db.affixes.get(a.id)?.job === mainJobTag))
  )
    out.push("I-17");
  if (s.pairing) out.push("I-21");
  if ([...sheet.jobNodes].some((id) => db.jobNodes.get(id)?.kind === "connector")) out.push("I-23");
  if (has("STAR-NT-CYCLE")) out.push("I-25");
  if (has("STAR-KEY-MYRIAD") && sheet.latents.some((l) => l.active && l.base === "BASE-UNQ-U03"))
    out.push("I-30");
  const off = equipment.get("offHand");
  const shield =
    off !== undefined && (db.itemBases.get(off.base)?.tags.includes("TAG-WPN-SHIELD") ?? false);
  if (bareHands && has("STAR-KEY-BURDEN") && shield) out.push("I-33");
  return out;
}

/** 技を使ったときの相互作用（I-15：武器による技の変化が出た）。 */
export function skillInteractions(variants: readonly string[]): string[] {
  return variants.length > 0 ? ["I-15"] : [];
}
