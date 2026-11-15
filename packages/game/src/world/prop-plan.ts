/**
 * 場の物の表示の計算（Phaser に依存しない。テストできる）。
 */

/** 出口の向き（地域の外へ出る向き）。 */
export type ExitDirection = "left" | "right" | "up" | "down";

/**
 * 出口の四角（m）が地域のどの端にあるか（矢印の向き）。端に接していなければ、近い方の端。
 */
export function exitDirection(
  rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  size: { readonly width: number; readonly height: number },
): ExitDirection {
  const gaps: [ExitDirection, number][] = [
    ["left", rect.x],
    ["right", size.width - (rect.x + rect.width)],
    ["up", rect.y],
    ["down", size.height - (rect.y + rect.height)],
  ];
  let best = gaps[0] ?? ["right", 0];
  for (const g of gaps) if (g[1] < best[1]) best = g;
  return best[0];
}

/** 0〜1を行き来する脈（周期 periodMs ミリ秒。phase は 0〜1 のずれ）。 */
export function pulse(nowMs: number, periodMs: number, phase = 0): number {
  return 0.5 - 0.5 * Math.cos(((nowMs / periodMs + phase) % 1) * Math.PI * 2);
}
