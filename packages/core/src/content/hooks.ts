/**
 * ルールフック（開発計画書 6.1 の原則1）：ゲームのルールを変える効果は、本体に名前付きの処理として登録し、
 * データからは名前とパラメータで呼び出す。データの検証では、登録されていない名前を誤りにする。
 */

/**
 * 技の挙動のフック（U-08。処理は combat/skills.ts の SKILL_HOOK_PARAMS と、それを使うゲームの層）。
 * - shockwave：前方に衝撃波（直線）を出す（戦士の薙ぎ払い × 槌系）
 * - lingeringFissure：当たり判定の場所に亀裂が残り、間隔ごとに再びダメージ（激化した地割り）
 * - crossFissure：直線の中ほどに、垂直な直線を加える（地割り × 大槌）
 * - fullStagger：当てた敵の崩しゲージを満タンにする（激化した突進）
 * - pullIn：周りの敵を自分の方へ引き寄せる（激化した旋風）
 */
export const SKILL_HOOKS = [
  "shockwave",
  "lingeringFissure",
  "crossFissure",
  "fullStagger",
  "pullIn",
] as const;
export type SkillHook = (typeof SKILL_HOOKS)[number];

/**
 * 技の挙動のフックに必要なパラメータ（データで値を決める。値は仮値で、データの側に印を付ける）。
 * ratio は、技の技倍率に対する割合（例：0.5なら、技倍率の半分）。
 */
export const SKILL_HOOK_PARAMS: Readonly<Record<SkillHook, readonly string[]>> = {
  shockwave: ["ratio", "length", "width"],
  lingeringFissure: ["ratio", "duration", "interval"],
  crossFissure: ["length"],
  fullStagger: [],
  pullIn: ["radius", "speed"],
};

export const KNOWN_HOOKS: ReadonlySet<string> = new Set<string>([...SKILL_HOOKS]);
