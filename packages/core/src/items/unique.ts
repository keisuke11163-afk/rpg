/**
 * ユニーク装備（本仕様書 3.7）：固有効果と潜在効果の組み込み、潜在効果の「？？？」の解放。
 */
import type { EffectDef, UniqueDef } from "../data/schema.ts";
import type { ActiveEffect, Evaluation } from "../effects/evaluate.ts";
import type { Equipment } from "./gear.ts";

export interface UniqueData {
  uniques: ReadonlyMap<string, UniqueDef>;
  effects: ReadonlyMap<string, EffectDef>;
}

export function makeUniqueData(
  uniques: readonly UniqueDef[],
  effects: readonly EffectDef[],
): UniqueData {
  return {
    uniques: new Map(uniques.map((u) => [u.id, u])),
    effects: new Map(effects.map((e) => [e.id, e])),
  };
}

/**
 * 装備中のユニークの効果。固有効果は常に有効、潜在効果は発動条件（他のシステムの旗）を持つので、
 * ここでは全て渡し、有効かどうかは効果の評価（条件の判定）が決める。
 * 同じユニークの二重取り（装備と残響）はできない（本仕様書 3.11.5）ので、同じユニークIDは1つだけ数える。
 */
export function equippedUniqueEffects(equipment: Equipment, data: UniqueData): ActiveEffect[] {
  const out: ActiveEffect[] = [];
  const seen = new Set<string>();
  for (const [slot, item] of equipment.all()) {
    if (item.uniqueId === undefined || seen.has(item.uniqueId)) continue;
    const def = data.uniques.get(item.uniqueId);
    if (!def) continue;
    seen.add(item.uniqueId);
    for (const id of [...def.fixed, def.latent.effect]) {
      const effect = data.effects.get(id);
      if (effect) out.push({ effect, origin: `装備:${slot}:${item.uid}` });
    }
  }
  return out;
}

/** 発動している潜在効果を持つユニークのID */
export function activeLatents(ev: Evaluation, data: UniqueData): string[] {
  const activeIds = new Set(ev.active.map((a) => a.effect.id));
  return [...data.uniques.values()].filter((u) => activeIds.has(u.latent.effect)).map((u) => u.id);
}

/** 発見の記録：潜在効果が初めて発動したとき、「？？？」が解放される。セーブの discoveries.latentRevealed に保存する */
export class DiscoveryTracker {
  private readonly revealed: Set<string>;

  constructor(initial: Iterable<string> = []) {
    this.revealed = new Set(initial);
  }

  has(id: string): boolean {
    return this.revealed.has(id);
  }

  all(): string[] {
    return [...this.revealed].sort();
  }

  /** 発動中の潜在効果を記録し、今回新しく解放されたもの（通知する対象）を返す */
  update(active: readonly string[]): string[] {
    const fresh: string[] = [];
    for (const id of active) {
      if (!this.revealed.has(id)) {
        this.revealed.add(id);
        fresh.push(id);
      }
    }
    return fresh;
  }
}
