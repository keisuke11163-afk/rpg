/**
 * 発動の条件の判定。種類（type）ごとの判定の関数を登録する。
 * 判定には「評価の文脈」の値だけを使う（本仕様書 4.9.1：条件付きの効果自身は判定に含めない）。
 */
import type { Condition } from "../data/schema.ts";
import { matchesFilter } from "./tags.ts";

export interface EvalContext {
  /** 評価の対象（技・敵など）が持つタグ。親タグ展開済み */
  tags: ReadonlySet<string>;
  /** 数値（能力値・Lv・HP割合など）。第1段階の値を入れる */
  stats: Readonly<Record<string, number>>;
  /** 数え上げの値。キーは「名前」または「名前:値」 */
  counts: Readonly<Record<string, number>>;
  /** 真偽の旗（例：ジョブがメインか、冷却状態か） */
  flags: ReadonlySet<string>;
}

export type ConditionFn = (condition: Condition, ctx: EvalContext) => boolean;

const builtin: Record<string, ConditionFn> = {
  /** { type: "タグ", tags: {all_of:[…]} } */
  タグ: (c, ctx) => matchesFilter(c.tags, ctx.tags),
  /** { type: "能力値", stat: "理", min: 200 }（min・max のどちらか、または両方） */
  能力値: (c, ctx) => {
    const value = ctx.stats[typeof c["stat"] === "string" ? c["stat"] : ""] ?? 0;
    const min = typeof c["min"] === "number" ? c["min"] : -Infinity;
    const max = typeof c["max"] === "number" ? c["max"] : Infinity;
    return value >= min && value <= max;
  },
  /** { type: "装備数", armor_class: "重装", min: 4 } のように、counts の「装備数:重装」を見る */
  装備数: (c, ctx) => {
    const key = `装備数:${typeof c["armor_class"] === "string" ? c["armor_class"] : ""}`;
    return (ctx.counts[key] ?? 0) >= (typeof c["min"] === "number" ? c["min"] : 1);
  },
  /** { type: "数え上げ", name: "取得星域数", min: 4 }：counts の値を見る */
  数え上げ: (c, ctx) => {
    const name = typeof c["name"] === "string" ? c["name"] : "";
    const min = typeof c["min"] === "number" ? c["min"] : 1;
    return (ctx.counts[name] ?? 0) >= min;
  },
  /** { type: "旗", name: "冷却状態の敵" } */
  旗: (c, ctx) => ctx.flags.has(typeof c["name"] === "string" ? c["name"] : ""),
  常に: () => true,
};

export class ConditionRegistry {
  private readonly fns = new Map<string, ConditionFn>(Object.entries(builtin));

  register(type: string, fn: ConditionFn): void {
    if (this.fns.has(type)) throw new Error(`条件の種類 ${type} は登録済み`);
    this.fns.set(type, fn);
  }

  has(type: string): boolean {
    return this.fns.has(type);
  }

  /** 全ての条件を満たすか。未登録の種類は誤り（黙って偽にしない） */
  all(conditions: readonly Condition[] | undefined, ctx: EvalContext): boolean {
    return (conditions ?? []).every((c) => {
      const fn = this.fns.get(c.type);
      if (!fn) throw new Error(`未登録の条件の種類: ${c.type}`);
      return fn(c, ctx);
    });
  }
}
