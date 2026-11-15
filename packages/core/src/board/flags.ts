/**
 * 潜在効果などの発動条件に使う「旗」を、ツリーの評価結果から作る。
 * 旗の名前：ノード:名前／種類:名前（例：輝星:傷口を抉る・天極:徒手の極意・職奥義:鬼神化）／星座:名前。
 */
import type { BoardData, BoardEvaluation } from "./star.ts";

export function boardFlags(
  boards: readonly { data: BoardData; evaluation: BoardEvaluation }[],
): Set<string> {
  const flags = new Set<string>();
  for (const { data, evaluation } of boards) {
    for (const id of evaluation.active) {
      const node = data.nodes.get(id);
      if (!node) continue;
      flags.add(`ノード:${node.name}`);
      flags.add(`${node.type}:${node.name}`);
    }
    for (const cid of evaluation.completedConstellations) {
      const c = data.constellations.get(cid);
      if (c) flags.add(`星座:${c.name}`);
    }
  }
  return flags;
}
