/**
 * クエスト（補助仕様書 9.6）：段階ごとの達成条件と報酬（星図の欠片＝星辰盤のポイント）。
 */

export type QuestCondition = { type: "reach"; region: string } | { type: "kill"; target: string };

export interface QuestStage {
  id: string;
  description: string;
  condition: QuestCondition;
  /** 星辰盤のポイント（星図の欠片） */
  rewardQuestPoints: number;
}

export interface QuestDef {
  id: string;
  name: string;
  stages: readonly QuestStage[];
}

export type QuestEvent = { type: "reach"; region: string } | { type: "kill"; target: string };

export interface QuestProgressEvent {
  questId: string;
  stage: QuestStage;
  /** このクエストを完了した */
  completed: boolean;
}

export class QuestLog {
  private readonly defs: readonly QuestDef[];
  private readonly done = new Map<string, Set<string>>();

  constructor(defs: readonly QuestDef[], saved: Readonly<Record<string, readonly string[]>> = {}) {
    this.defs = defs;
    for (const d of defs) this.done.set(d.id, new Set(saved[d.id] ?? []));
  }

  /** 出来事を伝える。新しく達成した段階（報酬をもらう対象）を返す。同じ段階は一度だけ */
  notify(event: QuestEvent): QuestProgressEvent[] {
    const out: QuestProgressEvent[] = [];
    for (const def of this.defs) {
      const done = this.done.get(def.id) as Set<string>;
      for (const stage of def.stages) {
        if (done.has(stage.id)) continue;
        const c = stage.condition;
        const hit =
          c.type === event.type &&
          (c.type === "reach"
            ? c.region === (event as { region: string }).region
            : c.target === (event as { target: string }).target);
        if (!hit) continue;
        done.add(stage.id);
        out.push({ questId: def.id, stage, completed: def.stages.every((s) => done.has(s.id)) });
      }
    }
    return out;
  }

  /** セーブの復元：達成済みの段階を記録する（報酬はもう受け取っている） */
  restoreStage(questId: string, stageId: string): void {
    this.done.get(questId)?.add(stageId);
  }

  isDone(questId: string, stageId: string): boolean {
    return this.done.get(questId)?.has(stageId) ?? false;
  }

  /** これまでに得た星図の欠片（星辰盤のポイント） */
  get questPoints(): number {
    let n = 0;
    for (const d of this.defs) {
      for (const s of d.stages) if (this.isDone(d.id, s.id)) n += s.rewardQuestPoints;
    }
    return n;
  }

  snapshot(): Record<string, string[]> {
    return Object.fromEntries([...this.done].map(([id, set]) => [id, [...set].sort()]));
  }
}

/** 星辰盤のポイントの合計（補助仕様書 4.4）：キャラLv 2〜20で19＋星図の欠片＋隠し星 */
export function starPointTotal(
  charLevel: number,
  questPoints: number,
  explorationPoints: number,
): number {
  return Math.max(0, charLevel - 1) + questPoints + explorationPoints;
}
