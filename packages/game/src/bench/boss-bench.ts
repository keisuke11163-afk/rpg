/**
 * ボスの撃破時間の計測（U-21 の土台。開発計画書 工程BL-2）。
 *
 * 実際の装備・星辰盤・職紋盤のビルドで、ゲームと同じ ArenaSimulation をボスの間で回す。
 * DPSシミュレーター（tools/sim）は core だけを通るので、ユニーク・天極・職奥義・二刀流のルールフックは
 * ここでしか測れない。操作は簡単なボット：ボスに近づく・根渡りの行き先へ動く・使える技を優先順に使う・
 * HPが減ったら薬瓶。予兆を避ける操作はしない。
 *
 * 攻撃面だけを測るときは（invincible）、プレイヤーを毎フレーム全回復し、受けたダメージは記録だけする。
 */
import {
  type ContentDb,
  type Enemy,
  FIXED_STEP_SECONDS,
  FixedStepClock,
  type ItemInstance,
  type MvpEquipSlot,
  affixTierValues,
  emptyKeptFields,
} from "@stella/core";
import type { Action } from "../input/actions.ts";
import type { InputFrame } from "../input/frame.ts";
import { ArenaSimulation, newCharacterProfile } from "../scenes/arena-simulation.ts";
import { toPixels } from "../world/units.ts";

/** 計測するビルド。 */
export interface BenchBuild {
  readonly id: string;
  readonly name: string;
  /** メインジョブ（出自もこのジョブにする）。 */
  readonly job: string;
  /** 装備（部位・ベース・詞〔T6 の中央の値〕・強化値）。 */
  readonly equipment: readonly {
    readonly slot: MvpEquipSlot;
    readonly base: string;
    readonly affixes?: readonly string[];
    readonly enhance?: number;
  }[];
  /** 取る星辰盤のノード（始点からの最短の道も取る）。 */
  readonly stars: readonly string[];
  /** 取る職紋盤のノード（始点からの最短の道も取る）。 */
  readonly jobNodes: readonly string[];
  /** 技の枠（1〜6。省略するとジョブの初期の並び）。破軍・罠設置は初期の枠に無いので、ここで入れる。 */
  readonly skills?: readonly (string | undefined)[];
}

export interface BenchOptions {
  /** ボスの間（省略すると深淵の母樹の間）。 */
  readonly region?: string;
  /** 打ち切る秒数。 */
  readonly seconds?: number;
  /** 攻撃面だけを測る（毎フレーム全回復）。 */
  readonly invincible?: boolean;
  /** 予兆を見て回避する（省略すると、攻撃面だけを測るときは回避しない）。 */
  readonly dodge?: boolean;
  readonly seed?: string;
}

export interface BenchResult {
  readonly build: string;
  readonly boss: string;
  /** 倒した秒数（倒せなければ undefined）。 */
  readonly killTime: number | undefined;
  /** ボスに与えたダメージ÷戦った秒数。 */
  readonly dps: number;
  /** 受けたダメージ÷戦った秒数（攻撃面だけを測るときも記録する）。 */
  readonly damageTakenPerSecond: number;
  readonly maxHp: number;
  /** 使った星辰盤・職紋盤のポイント。 */
  readonly starsSpent: number;
  readonly jobNodesSpent: number;
  /** 倒れた回数（invincible でなければ）。 */
  readonly deaths: number;
  /** 倒れた時刻（倒れなければ undefined）と、そのときのボスの残りHPの割合。 */
  readonly deathTime: number | undefined;
  readonly bossHpLeft: number;
  readonly criticals: number;
  /** 技ごとの使った回数。 */
  readonly uses: Readonly<Record<string, number>>;
  /** 受けたダメージの内訳（敵のID:攻撃のID → 毎秒。「持続ほか」はヒット以外＝毒の水たまり・状態異常など）。 */
  readonly takenBySource: Readonly<Record<string, number>>;
  /** 敵の攻撃を受けた回数・回避の無敵で避けた回数。 */
  readonly hitsTaken: number;
  readonly attacksAvoided: number;
}

const STEP = FIXED_STEP_SECONDS;
/** ボスに近づく距離（体の端から。m）。 */
const MELEE_GAP = 0.6;

/** ベースの詞を、T6 の中央の値で付ける。 */
function rolledAffix(db: ContentDb, id: string): ItemInstance["affixes"][number] {
  const affix = db.affixes.get(id);
  if (affix === undefined) throw new RangeError(`詞 ${id} が無い`);
  const values = affixTierValues(affix);
  const tier = values.has(6) ? 6 : 7;
  const v = values.get(tier);
  if (v === undefined) throw new RangeError(`詞 ${id} に T6・T7 が無い`);
  const rolls =
    affix.roll === "added"
      ? [v.min, v.max]
      : [affix.roll === "fixed" ? v.min : Math.round((v.min + v.max) / 2)];
  return { id, tier: tier, rolls };
}

/** 始点から goal までの最短の道（始点を含まない）。links は向きを持たない。 */
function shortestPath(
  links: ReadonlyMap<string, ReadonlySet<string>>,
  root: string,
  goal: string,
  skip: (id: string) => boolean,
): string[] {
  const prev = new Map<string, string>();
  const queue = [root];
  const seen = new Set([root]);
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    if (cur === goal) break;
    for (const n of links.get(cur) ?? []) {
      if (seen.has(n) || skip(n)) continue;
      seen.add(n);
      prev.set(n, cur);
      queue.push(n);
    }
  }
  if (!seen.has(goal)) throw new RangeError(`${goal} へ行けない`);
  const out: string[] = [];
  for (let c = goal; c !== root; c = prev.get(c) as string) out.unshift(c);
  return out;
}

/** ビルドを用意したシミュレーション（ボスの間。キャラLv20・ジョブLv20・星辰盤25ポイント）。 */
export function prepareBench(
  db: ContentDb,
  build: BenchBuild,
  options: BenchOptions = {},
): ArenaSimulation {
  const regionId = options.region ?? "REGION-A5-BOSS";
  const region = db.regions.get(regionId);
  if (region === undefined) throw new RangeError(`地域 ${regionId} が無い`);
  const base = newCharacterProfile(db, build.job, build.name);
  // MVPの星辰盤のポイント：Lv20 の19＋クエスト4＋探索2（補助仕様書4.4）
  const profile = { ...base, kept: { ...emptyKeptFields(), questPoints: 4, explorationPoints: 2 } };
  const sim = new ArenaSimulation(new FixedStepClock(), {
    db,
    region,
    profile,
    layoutSeed: options.seed ?? "bench",
  });
  sim.gainXp(1e9);
  // 装備（主手の指定が無ければ素手）
  if (!build.equipment.some((e) => e.slot === "mainHand")) sim.unequip("mainHand");
  build.equipment.forEach((e, i) => {
    const uid = `itm_${String(800000 + i)}`;
    const def = db.itemBases.get(e.base);
    if (def === undefined) throw new RangeError(`ベース ${e.base} が無い`);
    sim.inventory.addItem({
      uid,
      base: e.base,
      rarity:
        def.unique !== undefined
          ? "unique"
          : (e.affixes?.length ?? 0) > 2
            ? "rare"
            : (e.affixes?.length ?? 0) > 0
              ? "magic"
              : "normal",
      itemLevel: 21,
      affixes: (e.affixes ?? []).map((a) => rolledAffix(db, a)),
      ...(e.enhance === undefined ? {} : { enhance: e.enhance }),
    });
    if (e.slot === "mainHand") sim.unequip("mainHand");
    if (!sim.equipFromInventory(uid, e.slot))
      throw new RangeError(`${e.base} を ${e.slot} に装備できない`);
  });
  // 星辰盤
  const root = sim.starRoot;
  if (root === undefined) throw new RangeError("星辰盤の始点が無い");
  for (const goal of build.stars)
    for (const id of shortestPath(
      db.starLinks,
      root,
      goal,
      (n) => db.starNodes.get(n)?.kind === "start",
    ))
      if (!sim.stars.has(id) && !sim.allocateStar(id))
        throw new RangeError(
          `星辰盤の ${id} を取れない（${String(sim.stars.spent)}／${String(sim.starPoints)}）`,
        );
  // 技の枠
  build.skills?.forEach((skill, i) => {
    if (!sim.setSlotSkill(i, skill))
      throw new RangeError(`技の枠 ${String(i + 1)} に ${String(skill)} を入れられない`);
  });
  // 職紋盤
  const jroot = sim.jobBoard.root;
  if (jroot === undefined) throw new RangeError("職紋盤の始点が無い");
  for (const goal of build.jobNodes)
    for (const id of shortestPath(db.jobLinks, jroot, goal, (n) => {
      const k = db.jobNodes.get(n)?.kind;
      return k === "start" || (k === "mastery" && n !== goal);
    }))
      if (!sim.jobBoard.has(id) && !sim.allocateJobNode(id))
        throw new RangeError(`職紋盤の ${id} を取れない`);
  return sim;
}

/**
 * 使う技を選ぶ：①CDのある技（強化・弱体化・設置など）で使えるもの、②ゲージを全て使う技（終結技・解放技）は
 * ゲージが最大のときだけ、③CDの無い技、④通常攻撃。同じ区分の中は枠の順。
 */
function chooseSkill(sim: ArenaSimulation, db: ContentDb): { action: Action } | undefined {
  const def = (id: string) => db.skills.get(id);
  // 近接の距離では、瞬間移動の技（影走り）は使わない。背面を取る意味が無いとき（影法師など）は無駄になる。
  // 背向けの外套（移動の技の後は全てのヒットが背面）を着ているときだけは使う
  const moveBackstab = sim.sheet.evaluated.view.stat("STAT-UNQ-MOVE-BACKSTAB").value > 0;
  const usable = sim.loadout.filter(
    (l) =>
      l.skill !== "SKL-BASIC-ATTACK" &&
      sim.blockOf(l.skill) === undefined &&
      (def(l.skill)?.action.type !== "teleport" || moveBackstab),
  );
  const full = sim.jobGauge.value >= sim.jobGauge.max - 1e-9;
  const spender = (id: string): boolean => def(id)?.gauge?.cost === "all";
  // CD のある技が2秒以内に使えるようになるなら、その MP を残す（CD の無い技で使い切らない）
  const reserve = Math.max(
    0,
    ...sim.loadout
      .filter((l) => (def(l.skill)?.cooldown ?? 0) > 0 && sim.cooldowns.remaining(l.skill) <= 2)
      .map((l) => def(l.skill)?.mpCost ?? 0),
  );
  const affordable = (id: string): boolean => sim.mp - (def(id)?.mpCost ?? 0) >= reserve;
  return (
    usable.find((l) => (def(l.skill)?.cooldown ?? 0) > 0 && !spender(l.skill)) ??
    usable.find((l) => spender(l.skill) && full) ??
    usable.find(
      (l) => (def(l.skill)?.cooldown ?? 0) === 0 && !spender(l.skill) && affordable(l.skill),
    )
  );
}

/** 予兆の終わり際（残り0.25秒）に当たる範囲にいれば、範囲の外への向き（移動の入力）を返す。 */
function dodgeDirection(sim: ArenaSimulation, boss: Enemy): { x: number; y: number } | undefined {
  const a = boss.currentAttack;
  if (a === undefined || boss.state !== "windup") return undefined;
  const left = a.windup / (1 + boss.haste) - boss.timeInState / (1 + boss.haste);
  if (left > 0.25 || sim.motion.currentStamina < 25) return undefined;
  const d = a.delivery;
  const me = sim.motion.position;
  let center = boss.position;
  let radius = 0;
  if (d.type === "strike") {
    center = d.aim === "target" ? boss.targetPoint : boss.position;
    radius = d.shape.type === "line" ? d.shape.length : d.shape.radius;
  } else if (d.type === "cloud") {
    center = boss.targetPoint;
    radius = d.radius + (d.spread ?? 0);
  } else return undefined;
  const dx = me.x - center.x;
  const dy = me.y - center.y;
  const dist = Math.hypot(dx, dy);
  if (dist > radius + sim.player.radius) return undefined;
  // 真ん中にいるときは、ボスから離れる向き
  return dist > 1e-6
    ? { x: dx, y: dy }
    : { x: me.x - boss.position.x || 1, y: me.y - boss.position.y };
}

/** ボスを探す（倒れた後も、消えるまでは返す）。 */
function bossOf(sim: ArenaSimulation): Enemy | undefined {
  return sim.field?.enemies.find((e) => e.def.boss !== undefined);
}

/** ボスの撃破時間を測る。 */
export function runBossBench(
  db: ContentDb,
  build: BenchBuild,
  options: BenchOptions = {},
): BenchResult {
  const sim = prepareBench(db, build, options);
  const boss = bossOf(sim);
  if (boss === undefined) throw new RangeError("ボスがいない");
  const limit = options.seconds ?? 300;
  const invincible = options.invincible ?? true;
  const dodges = options.dodge ?? !invincible;
  let t = 0;
  let taken = 0;
  let killTime: number | undefined;
  let deaths = 0;
  let deathTime: number | undefined;
  const startHp = boss.combatant.health.hp;
  while (t < limit) {
    const me = sim.motion.position;
    const dest = boss.burrowDestination ?? boss.position;
    const dx = dest.x - me.x;
    const dy = dest.y - me.y;
    const dist = Math.hypot(dx, dy) - boss.combatant.radius - sim.player.radius;
    const move = dist > MELEE_GAP ? { x: dx, y: dy } : { x: 0, y: 0 };
    const special = chooseSkill(sim, db);
    // 近接の距離まで寄ってから技を使う（技の間は動けないので、離れたまま押すと届かない）
    const held = new Set<Action>(dist <= MELEE_GAP + 0.2 ? [special?.action ?? "skill1"] : []);
    const pressed = new Set<Action>();
    // 予兆の回避：ボスの攻撃の予兆の終わり際に、当たる範囲にいれば、範囲の外へ回避する
    const away = dodgeDirection(sim, boss);
    if (dodges && away !== undefined) pressed.add("dodge");
    if (!invincible && sim.player.health.hp < sim.player.health.maxHp * 0.5) pressed.add("flaskHp");
    const frame: InputFrame = {
      held: away !== undefined && dodges ? new Set<Action>() : held,
      pressed,
      move: away !== undefined && dodges ? away : move,
      pointerWorld: { x: toPixels(dest.x), y: toPixels(dest.y) },
    };
    const hpBefore = sim.player.health.hp + sim.player.health.ward;
    sim.frame(STEP, frame);
    const hpAfter = sim.player.health.hp + sim.player.health.ward;
    if (hpAfter < hpBefore) taken += hpBefore - hpAfter;
    if (invincible) sim.player.health.restoreFull();
    t += STEP;
    if (boss.state === "dead") {
      killTime = t;
      break;
    }
    if (!invincible && sim.player.health.dead) {
      deaths += 1;
      deathTime = t;
      break;
    }
  }
  const dealt = startHp - Math.max(0, boss.combatant.health.hp);
  return {
    build: build.id,
    boss: boss.def.id,
    killTime,
    dps: dealt / Math.max(t, 1e-9),
    damageTakenPerSecond: taken / Math.max(t, 1e-9),
    maxHp: sim.player.health.maxHp,
    starsSpent: sim.stars.spent,
    jobNodesSpent: sim.jobBoard.spent,
    deaths,
    deathTime,
    bossHpLeft: Math.max(0, boss.combatant.health.hp) / boss.combatant.health.maxHp,
    criticals: sim.criticals,
    uses: Object.fromEntries(sim.uses),
    takenBySource: takenBreakdown(sim, taken, t),
    hitsTaken: sim.hitsTaken,
    attacksAvoided: sim.attacksAvoided,
  };
}

function takenBreakdown(sim: ArenaSimulation, total: number, t: number): Record<string, number> {
  const seconds = Math.max(t, 1e-9);
  const out: Record<string, number> = {};
  let hits = 0;
  for (const [k, v] of sim.damageTakenBySource) {
    out[k] = v / seconds;
    hits += v;
  }
  out["持続ほか"] = Math.max(0, total - hits) / seconds;
  return out;
}
