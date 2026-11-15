import {
  Equipment,
  JobBoard,
  ROGUE_JOB,
  StarBoard,
  TagRegistry,
  WARRIOR_JOB,
  activeLatents,
  boardFlags,
  buildBoardContext,
  computeGear,
  createFighter,
  equippedUniqueEffects,
  evaluate,
  type ActiveEffect,
  type Fighter,
  type ItemInstance,
} from "@stella/core";
import { BOARD_DATA, GEAR_DATA, JOB_BOARDS, TAG_DATA, UNIQUE_DATA } from "../src/index.ts";

export const tags = new TagRegistry(TAG_DATA);
const nameToId = new Map(TAG_DATA.map((t) => [t.name, t.id]));
const stats = { 剛: 30, 迅: 30, 理: 5, 魂: 5 };
let n = 0;
export const uniqueItem = (id: string, enhance = 0): ItemInstance => {
  const def = UNIQUE_DATA.uniques.get(id);
  if (!def) throw new Error(id);
  return {
    uid: `h_${String(n++)}`,
    baseId: def.baseId,
    rarity: "unique",
    ilvl: 20,
    affixes: [],
    enhance,
    uniqueId: id,
  };
};

/** 装備とツリーの「旗」から、ユニークの効果を戦闘に組み込んだ戦闘者を作る */
export function build(opts: {
  job: "warrior" | "rogue";
  uniques: string[];
  star?: string[];
  jobBoard?: string[];
  weapon?: string;
  flags?: string[];
}): { f: Fighter; eq: Equipment; flags: Set<string>; latentActive: string[] } {
  const jobDef = opts.job === "warrior" ? WARRIOR_JOB : ROGUE_JOB;
  const eq = new Equipment();
  if (opts.weapon)
    eq.equip(
      {
        uid: `w_${String(n++)}`,
        baseId: opts.weapon,
        rarity: "normal",
        ilvl: 1,
        affixes: [],
        enhance: 0,
      },
      GEAR_DATA,
    );
  for (const id of opts.uniques) eq.equip(uniqueItem(id), GEAR_DATA, { canDualWield: true });
  const bc = buildBoardContext(eq, GEAR_DATA, {
    tags,
    characterStats: stats,
    ...(opts.flags?.includes("二刀流") ? { dualWield: true } : {}),
  });
  // ツリー
  const star = new StarBoard(
    BOARD_DATA,
    opts.job === "warrior" ? "STAR-GOU-START" : "STAR-JIN-START",
  );
  const jb = JOB_BOARDS[jobDef.id];
  const job = new JobBoard(jb?.data as never, jb?.start as string, jobDef.id);
  const takeByName = (
    board: { allocate(id: string, p: number): unknown; has(id: string): boolean },
    data: typeof BOARD_DATA,
    start: string,
    names: string[],
  ): void => {
    for (const name of names) {
      const target = name.startsWith("#")
        ? name.slice(1)
        : [...data.nodes.values()].find((x) => x.name === name)?.id;
      if (!target) throw new Error(name);
      const prev = new Map<string, string>();
      const q = [start];
      const seen = new Set(q);
      while (q.length) {
        const id = q.shift() as string;
        for (const l of data.nodes.get(id)?.links ?? [])
          if (!seen.has(l)) {
            seen.add(l);
            prev.set(l, id);
            q.push(l);
          }
      }
      const path: string[] = [];
      for (let c: string | undefined = target; c && c !== start; c = prev.get(c)) path.unshift(c);
      for (const id of path) if (!board.has(id)) board.allocate(id, 999);
    }
  };
  takeByName(star, BOARD_DATA, star.entrances[0] as string, opts.star ?? []);
  takeByName(job.board, jb?.data as never, jb?.start as string, opts.jobBoard ?? []);
  const starEval = star.evaluate(999, bc);
  const jobEval = job.evaluate(999, bc);
  const flags = boardFlags([
    { data: BOARD_DATA, evaluation: starEval },
    { data: jb?.data as never, evaluation: jobEval },
  ]);
  for (const x of opts.flags ?? []) flags.add(x);
  const ctx = { ...bc.ctx, flags: new Set([...bc.ctx.flags, ...flags]) };
  const entries: ActiveEffect[] = [
    ...starEval.effects,
    ...jobEval.effects,
    ...equippedUniqueEffects(eq, UNIQUE_DATA),
  ];
  const f = createFighter(jobDef, {
    ...(opts.flags?.includes("二刀流") ? { dualWield: true } : {}),
    maxHp: 100,
    maxMp: 1000,
    weaponKey: opts.job === "warrior" ? "greatsword" : "dagger",
    weaponClass: opts.job === "warrior" ? "greatsword" : "dagger",
    jobLevel: 12,
  });
  f.setGear(computeGear(eq, GEAR_DATA, stats));
  f.setEffectSource(entries, ctx, (skill) =>
    tags.expand(skill.tags.map((t) => nameToId.get(t)).filter((x): x is string => x !== undefined)),
  );
  const latentActive = activeLatents(evaluate(entries, ctx), UNIQUE_DATA);
  return { f, eq, flags, latentActive };
}
