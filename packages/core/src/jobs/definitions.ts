/**
 * MVPの2つのジョブ（戦士・盗賊）の定義と、標準のジョブの登録。
 */
import { WEAPONS } from "../combat/weapons.ts";
import { JobRegistry, type JobDef } from "../progress/jobs.ts";
import { Fighter } from "./fighter.ts";
import { COMBO, ROGUE_APTITUDE, ROGUE_BACKSTAB, ROGUE_SKILLS } from "./rogue.ts";
import { WARRIOR_APTITUDE, type WeaponClass } from "./skills.ts";
import { FURY, WARRIOR_SKILLS } from "./warrior.ts";

export const WARRIOR_JOB: JobDef = {
  id: "JOB-WARRIOR",
  name: "戦士",
  gauge: FURY,
  skills: WARRIOR_SKILLS,
  aptitude: WARRIOR_APTITUDE,
  startingStats: { 剛: 20, 迅: 10, 理: 5, 魂: 5 },
  startingWeapon: { weaponKey: "greatsword", weaponClass: "greatsword" },
};

export const ROGUE_JOB: JobDef = {
  id: "JOB-ROGUE",
  name: "盗賊",
  gauge: COMBO,
  skills: ROGUE_SKILLS,
  aptitude: ROGUE_APTITUDE,
  startingStats: { 剛: 10, 迅: 20, 理: 5, 魂: 5 },
  backstab: ROGUE_BACKSTAB,
  startingWeapon: { weaponKey: "dagger", weaponClass: "dagger" },
};

export function createStandardJobs(): JobRegistry {
  const registry = new JobRegistry();
  registry.register(WARRIOR_JOB);
  registry.register(ROGUE_JOB);
  return registry;
}

/** ジョブの定義と装備から、技を使う者を作る。ジョブごとのコードは要らない（データだけで動く） */
export function createFighter(
  job: JobDef,
  init: {
    maxHp: number;
    maxMp: number;
    weaponKey: string;
    weaponClass: WeaponClass;
    jobLevel: number;
    dualWield?: boolean;
    stats?: Readonly<Record<string, number>>;
  },
): Fighter {
  const weapon = WEAPONS[init.weaponKey];
  if (!weapon) throw new Error(`武器がない: ${init.weaponKey}`);
  // 適性：二刀流のときは二刀流の適性、そうでなければ武器の適性。なければ標準（A）
  const aptitude =
    (init.dualWield === true ? job.aptitude.dualWield : job.aptitude[init.weaponClass]) ?? "A";
  return new Fighter({
    maxHp: init.maxHp,
    maxMp: init.maxMp,
    weapon,
    weaponClass: init.weaponClass,
    aptitude,
    jobLevel: init.jobLevel,
    skills: job.skills,
    gauge: job.gauge,
    stats: init.stats ?? job.startingStats,
    ...(init.dualWield === true ? { dualWield: true } : {}),
    ...(job.backstab ? { backstab: job.backstab } : {}),
  });
}
