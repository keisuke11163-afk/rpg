/**
 * Phaser の Text の style を、前と違うときだけ設定する小さな関数。
 * Phaser 4.2.1 の TextStyle.setColor・setWordWrapWidth は、同じ値でも必ず updateText()
 * （canvas の描き直しとテクスチャの転送）を呼ぶので、毎フレーム呼ぶと重い（1つの文字で毎フレーム texImage2D が走る）。
 * 毎フレーム描き直す画面（HUD・インベントリなどの画面）は、style 系の設定にこちらを使う。
 */
import type Phaser from "phaser";

/** 文字の色を、前と違うときだけ設定する。 */
export function setTextColor(t: Phaser.GameObjects.Text, color: string): Phaser.GameObjects.Text {
  if (t.style.color !== color) t.setColor(color);
  return t;
}

/** 折り返しの幅（0＝折り返さない）を、前と違うときだけ設定する（文字の単位で折り返す）。 */
export function setTextWrapWidth(
  t: Phaser.GameObjects.Text,
  width: number,
): Phaser.GameObjects.Text {
  const s = t.style;
  if (s.wordWrapWidth !== width || !s.wordWrapUseAdvanced) t.setWordWrapWidth(width, true);
  return t;
}
