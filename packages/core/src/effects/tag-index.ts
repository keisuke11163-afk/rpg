import type { TagFilter } from "../content/effect.ts";
import type { TagDef } from "../content/tag.ts";

/**
 * 星紋タグの照合（仕様書 1.5）。
 * 親タグを持つタグは、親タグの条件にも当てはまる（例：大剣は「剣系」の条件に当てはまる）。
 */
export class TagIndex {
  private readonly tags: ReadonlyMap<string, TagDef>;
  private readonly ancestors = new Map<string, readonly string[]>();

  constructor(tags: ReadonlyMap<string, TagDef>) {
    this.tags = tags;
  }

  /** タグとその全ての親タグ（親の親も含む）。 */
  private ancestorsOf(id: string): readonly string[] {
    const cached = this.ancestors.get(id);
    if (cached !== undefined) return cached;
    const out: string[] = [];
    const stack = [...(this.tags.get(id)?.parents ?? [])];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined || out.includes(current)) continue;
      out.push(current);
      stack.push(...(this.tags.get(current)?.parents ?? []));
    }
    this.ancestors.set(id, out);
    return out;
  }

  /** タグの集まりに、全ての親タグを加えたもの。照合はこの集まりに対して行う。 */
  closure(ids: Iterable<string>): ReadonlySet<string> {
    const out = new Set<string>();
    for (const id of ids) {
      out.add(id);
      for (const parent of this.ancestorsOf(id)) out.add(parent);
    }
    return out;
  }

  /**
   * タグの条件に当てはまるか。context は closure() を通した集まりを渡す。
   * - allOf：全てを含む ／ anyOf：どれか1つを含む ／ noneOf：どれも含まない
   * - 条件がない（undefined）場合は、常に当てはまる
   */
  static matches(filter: TagFilter | undefined, context: ReadonlySet<string>): boolean {
    if (filter === undefined) return true;
    if (filter.allOf !== undefined && !filter.allOf.every((t) => context.has(t))) return false;
    if (filter.anyOf !== undefined && !filter.anyOf.some((t) => context.has(t))) return false;
    if (filter.noneOf?.some((t) => context.has(t)) === true) return false;
    return true;
  }
}
