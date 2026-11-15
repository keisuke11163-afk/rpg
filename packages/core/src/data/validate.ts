/**
 * データの検証（開発計画書 6.1・T17）。
 * スキーマ（形・値の範囲）→ ID重複 → ID参照 → 規則（乗算の出どころ）の順に調べ、全ての誤りを集めて返す。
 */
import {
  DATA_KINDS,
  DATA_VERSION,
  MULTIPLIER_SOURCES,
  dataFileSchema,
  kindSchemas,
  type DataKind,
  type DataSet,
  type EffectDef,
  type TagFilter,
} from "./schema.ts";

export interface DataIssue {
  /** 例：effects/EFF-001.modifiers[0] */
  where: string;
  message: string;
}

export interface RawFile {
  /** 表示用のファイル名（例：tags/forms.json） */
  file: string;
  kind: DataKind;
  /** JSON.parse した値 */
  json: unknown;
}

export interface LoadResult {
  data: DataSet;
  issues: DataIssue[];
}

/** 生のJSONをスキーマで読み、データの集合にする。形の誤りは issues に集める */
export function parseFiles(files: readonly RawFile[]): LoadResult {
  const data: DataSet = { tags: [], effects: [], starNodes: [], constellations: [] };
  const issues: DataIssue[] = [];
  for (const { file, kind, json } of files) {
    const wrapper = dataFileSchema.safeParse(json);
    if (!wrapper.success) {
      for (const issue of wrapper.error.issues) {
        issues.push({
          where: file,
          message: `ファイルの形：${issue.message}（${issue.path.join(".")}）`,
        });
      }
      continue;
    }
    wrapper.data.items.forEach((item, index) => {
      const parsed = kindSchemas[kind].safeParse(item);
      if (parsed.success) {
        (data[kind] as unknown[]).push(parsed.data);
      } else {
        const id = (item as { id?: unknown } | null)?.id;
        const label = typeof id === "string" ? id : `[${String(index)}]`;
        for (const issue of parsed.error.issues) {
          issues.push({
            where: `${file}:${label}`,
            message: `${issue.message}${issue.path.length > 0 ? `（${issue.path.join(".")}）` : ""}`,
          });
        }
      }
    });
  }
  return { data, issues };
}

function filterTagRefs(filter: TagFilter | undefined): string[] {
  if (!filter) return [];
  return [...(filter.all_of ?? []), ...(filter.any_of ?? []), ...(filter.none_of ?? [])];
}

function effectTagRefs(effect: EffectDef): { where: string; id: string }[] {
  const refs: { where: string; id: string }[] = [];
  const add = (where: string, ids: readonly string[]): void => {
    for (const id of ids) refs.push({ where, id });
  };
  add("target_skill_tags", filterTagRefs(effect.target_skill_tags));
  const addConditions = (where: string, conditions: EffectDef["conditions"] | undefined): void => {
    conditions?.forEach((c, i) => {
      add(`${where}.conditions[${String(i)}]`, [
        ...filterTagRefs(c.tags),
        ...(c.tag ? [c.tag] : []),
      ]);
    });
  };
  addConditions("", effect.conditions);
  effect.modifiers.forEach((m, i) => {
    const where = `modifiers[${String(i)}]`;
    addConditions(where, "conditions" in m ? m.conditions : undefined);
    switch (m.kind) {
      case "変換":
        add(where, [m.from, m.to]);
        break;
      case "付け替え":
        add(where, [...m.from, ...m.to]);
        break;
      case "挙動":
        break;
      default: {
        if (m.filter) {
          add(`${where}.filter`, [
            ...filterTagRefs(m.filter.tags),
            ...(m.filter.ailment ? [m.filter.ailment] : []),
            ...(m.filter.element ? [m.filter.element] : []),
          ]);
        }
        if (m.per?.tag) add(`${where}.per`, [m.per.tag]);
      }
    }
  });
  return refs;
}

/** 読み込んだデータの、ID重複・ID参照・規則を検証する */
export function validateData(data: DataSet): DataIssue[] {
  const issues: DataIssue[] = [];

  // ID重複（全ての種類をまたいで一意）
  const seen = new Map<string, DataKind>();
  for (const kind of DATA_KINDS) {
    for (const item of data[kind]) {
      const previous = seen.get(item.id);
      if (previous) {
        issues.push({
          where: `${kind}:${item.id}`,
          message: `IDが重複している（${previous}にも存在する）`,
        });
      } else {
        seen.set(item.id, kind);
      }
    }
  }

  const tagIds = new Set(data.tags.map((t) => t.id));

  // タグの親の参照・循環
  const parentOf = new Map(data.tags.map((t) => [t.id, t.parents ?? []]));
  for (const tag of data.tags) {
    for (const parent of tag.parents ?? []) {
      if (!tagIds.has(parent)) {
        issues.push({ where: `tags:${tag.id}`, message: `存在しない親タグ ${parent}` });
      }
    }
    const stack = [...(tag.parents ?? [])];
    const visited = new Set<string>();
    while (stack.length > 0) {
      const current = stack.pop() as string;
      if (current === tag.id) {
        issues.push({ where: `tags:${tag.id}`, message: "親子関係が循環している" });
        break;
      }
      if (visited.has(current)) continue;
      visited.add(current);
      stack.push(...(parentOf.get(current) ?? []));
    }
  }

  // 効果
  for (const effect of data.effects) {
    for (const ref of effectTagRefs(effect)) {
      if (!tagIds.has(ref.id)) {
        issues.push({
          where: `effects:${effect.id}.${ref.where}`,
          message: `存在しないタグ ${ref.id}`,
        });
      }
    }
    effect.modifiers.forEach((m, i) => {
      if (m.kind !== "乗算") return;
      const where = `effects:${effect.id}.modifiers[${String(i)}]`;
      if (!MULTIPLIER_SOURCES.includes(effect.source)) {
        issues.push({
          where,
          message: `出どころ「${effect.source}」は乗算を持てない（本仕様書 2.4・8.3）`,
        });
      } else if (effect.source === "転変" && m.value >= 1) {
        issues.push({
          where,
          message: "転変が持てる乗算は、減らす方向（1未満）だけ（本仕様書 2.4）",
        });
      }
    });
  }

  // 効果：共鳴変化の星域タグ、天極の代償の明記（本仕様書 10.4：代償がない天極は作らない）
  for (const effect of data.effects) {
    const rv = effect.resonance_variant;
    if (rv && !tagIds.has(rv.region)) {
      issues.push({
        where: `effects:${effect.id}`,
        message: `存在しないタグ ${rv.region}（共鳴変化）`,
      });
    }
    if (effect.source === "天極" && !(effect.note ?? "").startsWith("代償：")) {
      issues.push({
        where: `effects:${effect.id}`,
        message: "天極には「代償：」で始まる note が必要",
      });
    }
  }
  issues.push(...validateStarBoard(data, tagIds));

  // 規則4（本仕様書 2.4.1）：同じ数値を上書きする効果で、同じ優先度は作らない
  const overrides = new Map<string, string>();
  for (const effect of data.effects) {
    for (const m of effect.modifiers) {
      if (m.kind !== "挙動" || !m.hook.startsWith("上書き:")) continue;
      const priority = typeof m.params?.["priority"] === "number" ? m.params["priority"] : 0;
      const key = `${m.hook}#${String(priority)}`;
      const other = overrides.get(key);
      if (other !== undefined && other !== effect.id) {
        issues.push({
          where: `effects:${effect.id}`,
          message: `${m.hook} の優先度 ${String(priority)} が ${other} と同じ（同じ優先度の上書きは作れない）`,
        });
      } else {
        overrides.set(key, effect.id);
      }
    }
  }
  return issues;
}

/** 星辰盤の検証：つながりの双方向性・存在・到達可能性・星座・星門 */
function validateStarBoard(data: DataSet, tagIds: ReadonlySet<string>): DataIssue[] {
  const issues: DataIssue[] = [];
  const nodes = new Map(data.starNodes.map((n) => [n.id, n]));
  const effectIds = new Set(data.effects.map((e) => e.id));
  for (const node of data.starNodes) {
    const where = `starNodes:${node.id}`;
    if (!tagIds.has(node.region))
      issues.push({ where, message: `存在しない星域タグ ${node.region}` });
    for (const link of node.links) {
      const other = nodes.get(link);
      if (!other) issues.push({ where, message: `存在しないノードへのつながり ${link}` });
      else if (!other.links.includes(node.id)) {
        issues.push({ where, message: `つながり ${link} が双方向ではない` });
      }
      if (link === node.id) issues.push({ where, message: "自分自身へのつながり" });
    }
    for (const e of node.effects) {
      if (!effectIds.has(e)) issues.push({ where, message: `存在しない効果 ${e}` });
    }
    if (node.type === "星門" && !node.gate) issues.push({ where, message: "星門に条件がない" });
    if (node.type === "始点" && !node.start) issues.push({ where, message: "始点に start がない" });
    if (node.type !== "始点" && node.type !== "星門" && node.effects.length === 0) {
      issues.push({ where, message: "効果のないノード" });
    }
    if (node.gate) {
      for (const t of [
        ...(node.gate.condition.tags?.all_of ?? []),
        ...(node.gate.condition.tags?.any_of ?? []),
      ]) {
        if (!tagIds.has(t)) issues.push({ where, message: `星門の条件に存在しないタグ ${t}` });
      }
    }
  }
  // 全てのノードが、どれかの始点から到達できる
  const starts = data.starNodes.filter((n) => n.type === "始点").map((n) => n.id);
  const seen = new Set(starts);
  const queue = [...starts];
  while (queue.length > 0) {
    const id = queue.pop() as string;
    for (const link of nodes.get(id)?.links ?? []) {
      if (nodes.has(link) && !seen.has(link)) {
        seen.add(link);
        queue.push(link);
      }
    }
  }
  for (const node of data.starNodes) {
    if (!seen.has(node.id))
      issues.push({ where: `starNodes:${node.id}`, message: "始点から到達できない" });
  }
  // 星座
  for (const c of data.constellations) {
    const where = `constellations:${c.id}`;
    if (!effectIds.has(c.completionEffect)) {
      issues.push({ where, message: `存在しない完成ボーナス ${c.completionEffect}` });
    }
    for (const id of c.nodes) {
      const node = nodes.get(id);
      if (!node) issues.push({ where, message: `存在しないノード ${id}` });
      else if (node.constellation !== c.id)
        issues.push({ where, message: `${id} の constellation が一致しない` });
    }
  }
  for (const node of data.starNodes) {
    if (
      node.constellation !== undefined &&
      !data.constellations.some((c) => c.id === node.constellation)
    ) {
      issues.push({
        where: `starNodes:${node.id}`,
        message: `存在しない星座 ${node.constellation}`,
      });
    }
  }
  return issues;
}

/** 仮値（"provisional": true）の一覧 */
export function listProvisional(data: DataSet): string[] {
  const out: string[] = [];
  for (const kind of DATA_KINDS) {
    for (const item of data[kind]) {
      if (item.provisional) out.push(`${kind}:${item.id}`);
    }
  }
  return out;
}

export { DATA_VERSION };
