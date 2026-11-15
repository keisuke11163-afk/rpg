/**
 * ルールフック（開発計画書 6.1）。ルールを変える効果は、本体に名前付きの処理を登録し、
 * データからは名前とパラメータで参照する。
 *
 * 名前の接頭辞は、効果の優先順位（本仕様書 2.4.1）の規則に使う構造を表す。
 */

export const HOOK_PREFIX = {
  /** 「必ず〜」。同じ対象の「禁止」があれば負ける */
  force: "強制:",
  /** 「〜しない／できない」。強制に勝つ */
  forbid: "禁止:",
  /** 同じ入力・同じ枠を置き換える効果。出どころの順位で1つだけが有効 */
  replace: "置換:",
  /** 同じ数値を上書きする効果。params.priority の大きいものが勝つ */
  override: "上書き:",
  /** 生成を禁止する効果（例：生成禁止:召喚物） */
  banSpawn: "生成禁止:",
  /** 生成する効果（例：生成:召喚物）。生成禁止があると発動しない */
  spawn: "生成:",
} as const;

export type HookFn = (params: Readonly<Record<string, unknown>>) => void;

export class HookRegistry {
  private readonly hooks = new Map<string, HookFn>();

  register(name: string, fn: HookFn): void {
    if (this.hooks.has(name)) throw new Error(`ルールフック ${name} は登録済み`);
    this.hooks.set(name, fn);
  }

  has(name: string): boolean {
    return this.hooks.has(name) || isStructuralHook(name);
  }

  get(name: string): HookFn | undefined {
    return this.hooks.get(name);
  }

  names(): string[] {
    return [...this.hooks.keys()].sort();
  }
}

/** 優先順位の規則に使う接頭辞を持つ名前は、登録がなくてもデータに書ける */
export function isStructuralHook(name: string): boolean {
  return Object.values(HOOK_PREFIX).some((p) => name.startsWith(p));
}
