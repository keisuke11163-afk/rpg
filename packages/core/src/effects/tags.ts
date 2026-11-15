/**
 * 星紋タグ（本仕様書 1.5）。親タグを含めて照合する。
 * 例：大剣は「大剣」と「剣系」の両方に当てはまる。
 */
import type { TagDef, TagFilter } from "../data/schema.ts";

export class TagRegistry {
  private readonly parents = new Map<string, readonly string[]>();

  constructor(tags: readonly TagDef[]) {
    for (const tag of tags) this.parents.set(tag.id, tag.parents ?? []);
  }

  has(id: string): boolean {
    return this.parents.has(id);
  }

  /** タグ自身と、全ての祖先のタグ */
  expand(ids: Iterable<string>): Set<string> {
    const result = new Set<string>();
    const stack = [...ids];
    while (stack.length > 0) {
      const id = stack.pop() as string;
      if (result.has(id)) continue;
      result.add(id);
      stack.push(...(this.parents.get(id) ?? []));
    }
    return result;
  }
}

/** 絞り込みが、タグの集合（親タグ展開済み）に当てはまるか。絞り込みがなければ常に真 */
export function matchesFilter(filter: TagFilter | undefined, tags: ReadonlySet<string>): boolean {
  if (!filter) return true;
  if (filter.all_of && !filter.all_of.every((t) => tags.has(t))) return false;
  if (filter.any_of && filter.any_of.length > 0 && !filter.any_of.some((t) => tags.has(t)))
    return false;
  if (filter.none_of?.some((t) => tags.has(t))) return false;
  return true;
}
