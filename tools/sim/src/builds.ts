/**
 * ビルドの定義と、ボス戦の撃破時間・DPSの測定（開発計画書 BL-1・BL-2、T14）。
 * ゲームの画面と同じ計算（装備の能力値・星辰盤・職紋盤・ユニーク・ゲージの効果）で戦闘者を作る。
 * 測るのは「敵の攻撃を避け続ける理想的なプレイヤー」の撃破時間（受けるダメージは測らない）。
 */
import {
  BASIC_ATTACK,
  ConditionRegistry,
  Equipment,
  JobBoard,
  ROGUE_JOB,
  StarBoard,
  TagRegistry,
  WARRIOR_JOB,
  applyGaugeHooks,
  boardFlags,
  buildBoardContext,
  computeGear,
  createEnemy,
  createFighter,
  createRng,
  doubleNearStart,
  equippedUniqueEffects,
  evaluate,
  stepEnemy,
  withGearStats,
  type ActiveEffect,
  type Enemy,
  type Fighter,
  type ItemInstance,
  type JobDef,
  type RolledAffix,
} from "@stella/core";
import {
  BOARD_DATA,
  GEAR_DATA,
  JOB_BOARDS,
  STAR_START_OF_JOB,
  TAG_DATA,
  UNIQUE_DATA,
  enemyDef,
} from "@stella/content";

export interface GearPiece {
  baseId: string;
  affixes?: RolledAffix[];
  enhance?: number;
  uniqueId?: string;
}

export interface BuildSpec {
  name: string;
  job: "warrior" | "rogue";
  charLevel: number;
  jobLevel: number;
  /** 部位を指定しない装備（武器・防具）。種類から自動で部位が決まる */
  gear: GearPiece[];
  /** 星辰盤・職紋盤で取るノード（名前。"#ID" でID指定）。経路のノードも取る */
  star: string[];
  job_: string[];
  /** 二刀流など、旗 */
  flags?: string[];
}

const tags = new TagRegistry(TAG_DATA);
const nameToId = new Map(TAG_DATA.map((t) => [t.name, t.id]));

let serial = 0;
export const affix = (id: string, tier: number, ...rolls: number[]): RolledAffix => ({
  id,
  tier,
  rolls,
});

function pathTake(
  board: { allocate(id: string, p: number): unknown; has(id: string): boolean },
  data: typeof BOARD_DATA,
  start: string,
  names: readonly string[],
): void {
  for (const name of names) {
    const target = name.startsWith("#")
      ? name.slice(1)
      : [...data.nodes.values()].find((x) => x.name === name)?.id;
    if (!target) throw new Error(`ノードがない: ${name}`);
    const prev = new Map<string, string>();
    const q = [start];
    const seen = new Set(q);
    while (q.length > 0) {
      const id = q.shift() as string;
      for (const l of data.nodes.get(id)?.links ?? []) {
        if (!seen.has(l)) {
          seen.add(l);
          prev.set(l, id);
          q.push(l);
        }
      }
    }
    const path: string[] = [];
    for (let c: string | undefined = target; c && c !== start; c = prev.get(c)) path.unshift(c);
    for (const id of path) if (!board.has(id)) board.allocate(id, 9999);
  }
}

export interface BuiltFighter {
  fighter: Fighter;
  starPoints: number;
  jobPoints: number;
}

/** ビルドから、ゲームと同じ計算で戦闘者を作る */
export function buildFighter(spec: BuildSpec): BuiltFighter {
  const jobDef: JobDef = spec.job === "warrior" ? WARRIOR_JOB : ROGUE_JOB;
  const eq = new Equipment();
  for (const g of spec.gear) {
    const item: ItemInstance = {
      uid: `sim_${String(serial++)}`,
      baseId: g.baseId,
      rarity: g.uniqueId ? "unique" : (g.affixes?.length ?? 0) > 0 ? "rare" : "normal",
      ilvl: spec.charLevel,
      affixes: g.affixes ?? [],
      enhance: g.enhance ?? 0,
      ...(g.uniqueId ? { uniqueId: g.uniqueId } : {}),
    };
    eq.equip(item, GEAR_DATA, { canDualWield: true });
  }
  const stats = jobDef.startingStats;
  const bc = buildBoardContext(eq, GEAR_DATA, {
    tags,
    characterStats: stats,
    ...(spec.flags?.includes("二刀流") ? { dualWield: true } : {}),
  });
  const star = new StarBoard(BOARD_DATA, STAR_START_OF_JOB[jobDef.id] as string);
  const jb = JOB_BOARDS[jobDef.id];
  if (!jb) throw new Error(jobDef.id);
  const job = new JobBoard(jb.data, jb.start, jobDef.id);
  pathTake(star, BOARD_DATA, star.entrances[0] as string, spec.star);
  pathTake(job.board, jb.data, jb.start, spec.job_);
  const starEval = star.evaluate(9999, bc);
  const jobEval = job.evaluate(9999, bc);
  const flags = boardFlags([
    { data: BOARD_DATA, evaluation: starEval },
    { data: jb.data, evaluation: jobEval },
  ]);
  for (const f of spec.flags ?? []) flags.add(f);
  const ctx = { ...bc.ctx, flags: new Set([...bc.ctx.flags, ...flags]) };
  const starEffects: ActiveEffect[] = job.connectionActive(jobEval)
    ? doubleNearStart(BOARD_DATA, starEval, STAR_START_OF_JOB[jobDef.id] as string, 3, 2)
    : starEval.effects;
  const entries = [...starEffects, ...jobEval.effects, ...equippedUniqueEffects(eq, UNIQUE_DATA)];

  const weaponBase = spec.gear.find((g) => GEAR_DATA.bases.get(g.baseId)?.slot === "主手");
  const wb = weaponBase ? GEAR_DATA.bases.get(weaponBase.baseId) : undefined;
  const f = createFighter(jobDef, {
    maxHp: 48 + 12 * spec.charLevel,
    maxMp: 60,
    weaponKey: jobDef.startingWeapon.weaponKey,
    weaponClass: wb?.weaponClass ?? jobDef.startingWeapon.weaponClass,
    jobLevel: spec.jobLevel,
    stats: withGearStats(stats, computeGear(eq, GEAR_DATA, stats)),
    ...(spec.flags?.includes("二刀流") ? { dualWield: true } : {}),
  });
  f.setCharLevel(spec.charLevel);
  f.setGear(computeGear(eq, GEAR_DATA, stats));
  f.setEffectSource(entries, ctx, (skill) =>
    tags.expand(skill.tags.map((t) => nameToId.get(t)).filter((x): x is string => x !== undefined)),
  );
  applyGaugeHooks(f.gauge, evaluate(entries, ctx, new ConditionRegistry()).hooks());
  return { fighter: f, starPoints: star.pointsUsed, jobPoints: job.pointsUsed };
}

/** 技の優先順位：解放技・終結技 → 強い技 → 通常攻撃 */
const ORDER: Record<"warrior" | "rogue", string[]> = {
  warrior: ["SKL-WAR-RUIN", "SKL-WAR-RIFT", "SKL-WAR-SWEEP", BASIC_ATTACK.id],
  rogue: ["SKL-ROG-FINISH", "SKL-ROG-FLURRY", BASIC_ATTACK.id],
};

export interface FightResult {
  seconds: number;
  killed: boolean;
}

/**
 * ボス（または的）に対する撃破時間。敵は攻撃を続けるが、プレイヤーは全て避ける（無敵）として測る。
 * 近接の技は、敵の近くで使う（ボスが根渡りで動いても追いつく）。
 */
export function fightBoss(
  fighter: Fighter,
  spec: BuildSpec,
  bossId: string,
  level: number,
  seed: number | string,
  maxSeconds = 400,
): FightResult {
  const boss: Enemy = createEnemy({
    def: enemyDef(bossId),
    level,
    pos: { x: 0, y: 0 },
    id: `sim-${bossId}`,
    facing: 0,
  });
  const rng = createRng(seed);
  const player = { pos: { x: 2.2, y: 0 }, radius: 0.4, invulnerable: true };
  let time = 0;
  let busy = 0;
  while (boss.body.hp > 0 && time < maxSeconds) {
    time += 1 / 60;
    fighter.tick(1 / 60);
    player.pos = { x: boss.body.pos.x + 2.2, y: boss.body.pos.y };
    stepEnemy(boss, player, 1 / 60, rng);
    boss.body.facing = Math.PI;
    fighter.noteMovement(false, 0, 1 / 60);
    busy -= 1 / 60;
    if (busy > 0) continue;
    for (const id of ORDER[spec.job]) {
      const out = fighter.use(id, player.pos, Math.PI, [boss.body], rng);
      if (!out.ok) continue;
      busy =
        id === BASIC_ATTACK.id
          ? 1 / fighter.attackSpeed
          : (out.effective?.skill.totalSeconds ?? 0.5);
      break;
    }
  }
  return { seconds: time, killed: boss.body.hp <= 0 };
}
