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
  /**
   * ボットの立ち位置（適正間合いを持たないジョブが、離れて撃つとき。魔法使い）。ゲームの規則ではなく、
   * ボットの動き方だけ。ボスとの距離（体の端から）の min〜max の真ん中に立ち、close より近ければ離れる。
   */
  readonly standoff?: { readonly min: number; readonly max: number; readonly close: number };
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
  /** 職能ゲージを使わない（毎刻み空にする。力の配分の「ジョブなし」の計測。T15）。 */
  readonly noGauge?: boolean;
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
  /** ガードで防いだ回数・パリィに成功した回数（騎士）。 */
  readonly guards: number;
  readonly parries: number;
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
    ...(options.seed === undefined ? {} : { rngSeed: options.seed }),
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
export function chooseSkill(
  sim: ArenaSimulation,
  db: ContentDb,
  tooClose = false,
): { action: Action } | undefined {
  const def = (id: string) => db.skills.get(id);
  // 近接の距離では、瞬間移動の技（影走り）は使わない。背面を取る意味が無いとき（影法師など）は無駄になる。
  // 背向けの外套（移動の技の後は全てのヒットが背面）を着ているときだけは使う
  const moveBackstab = sim.sheet.evaluated.view.stat("STAT-UNQ-MOVE-BACKSTAB").value > 0;
  const usable = sim.loadout.filter(
    (l) =>
      l.skill !== "SKL-BASIC-ATTACK" &&
      sim.blockOf(l.skill) === undefined &&
      (def(l.skill)?.action.type !== "teleport" || moveBackstab) &&
      // 瞬移（照準の方向へ跳ぶ）は、ボットは使わない（立ち位置を崩すだけ）
      def(l.skill)?.action.type !== "blink" &&
      // 跳躍後退（撃ちながら後ろへ跳ぶ）は、近すぎるときだけ使う（止まって集中を溜めるため）
      (!isLeap(def(l.skill)) || tooClose),
  );
  // ガードのジョブ（騎士）は、信念が6以上で断罪の刃を使う（10まで待つと、被弾の-1で溜まりきらない。ボットの動きだけ）
  const spendAt = sim.job.guard === undefined ? sim.jobGauge.max : sim.jobGauge.max * 0.6;
  const full = sim.jobGauge.value >= spendAt - 1e-9;
  const spender = (id: string): boolean => def(id)?.gauge?.cost === "all";
  // CD のある技が2秒以内に使えるようになるなら、その MP を残す（CD の無い技で使い切らない）
  const reserve = Math.max(
    0,
    ...sim.loadout
      .filter((l) => (def(l.skill)?.cooldown ?? 0) > 0 && sim.cooldowns.remaining(l.skill) <= 2)
      .map((l) => def(l.skill)?.mpCost ?? 0),
  );
  const affordable = (id: string): boolean => sim.mp - (def(id)?.mpCost ?? 0) >= reserve;
  // 召喚士：まだいない種類の召喚物を先に呼ぶ（枠の順のままだと、同じ種類ばかりで枠が埋まる。ボットの動きだけ）
  const present = new Set(sim.minions.map((m) => m.def.id));
  const dup = (id: string): boolean => {
    const a = def(id)?.action;
    return a?.type === "summon" && present.has(a.minion.id);
  };
  const free = usable
    .filter((l) => (def(l.skill)?.cooldown ?? 0) === 0 && !spender(l.skill) && affordable(l.skill))
    .sort((x, y) => Number(dup(x.skill)) - Number(dup(y.skill)));
  return (
    usable.find((l) => (def(l.skill)?.cooldown ?? 0) > 0 && !spender(l.skill)) ??
    usable.find((l) => spender(l.skill) && full) ??
    (sim.jobGauge.def.phase === undefined ? free[0] : choosePhaseSpell(sim, db, free))
  );
}

/**
 * 位相のジョブ（魔法使い）の呪文を選ぶ：合成魔法に変わる呪文があればそれ（枠の順の最初）、無ければ直前とは
 * 違う属性の呪文（位相が増える）、それも無ければ枠の順の最初。
 */
function choosePhaseSpell<T extends { readonly skill: string }>(
  sim: ArenaSimulation,
  db: ContentDb,
  free: readonly T[],
): T | undefined {
  const gauge = sim.jobGauge;
  const tagsOf = (l: T): readonly string[] => db.skills.get(l.skill)?.tags ?? [];
  return (
    free.find((l) => gauge.fusionFor(tagsOf(l)) !== undefined) ??
    free.find((l) => {
      const e = gauge.phaseElementOf(tagsOf(l));
      return e !== undefined && e !== gauge.lastSpellElement;
    }) ??
    free[0]
  );
}

function isLeap(d: { readonly action: { readonly type: string } } | undefined): boolean {
  const a = d?.action as { type: string; leap?: unknown } | undefined;
  return a?.type === "projectile" && a.leap !== undefined;
}

/**
 * 胞子の雲を避けて立つ位置。ボスの近接の距離の輪の上で自分に一番近い点が雲の中なら、雲の無い点を探す：
 * まず近接の輪の上（melee: true）、無ければ外側の輪（離れて雲が消えるのを待つ。melee: false）。
 * 雲を気にしなくてよいときは undefined（いつもどおりボスへ寄る）。
 */
function cloudSpot(
  sim: ArenaSimulation,
  boss: Enemy,
): { readonly x: number; readonly y: number; readonly melee: boolean } | undefined {
  const clouds = sim.field?.clouds ?? [];
  if (clouds.length === 0) return undefined;
  const r = sim.player.radius;
  const inside = (p: { x: number; y: number }): boolean =>
    clouds.some((c) => Math.hypot(p.x - c.center.x, p.y - c.center.y) <= c.radius + r + 0.2);
  const me = sim.motion.position;
  const ring = boss.combatant.radius + r + MELEE_GAP * 0.5;
  const toMe = Math.atan2(me.y - boss.position.y, me.x - boss.position.x);
  const mySpot = {
    x: boss.position.x + Math.cos(toMe) * ring,
    y: boss.position.y + Math.sin(toMe) * ring,
  };
  if (!inside(mySpot) && !inside(me)) return undefined;
  for (const [k, radius] of [ring, ring + 2, ring + 4, ring + 6].entries()) {
    let best: { x: number; y: number } | undefined;
    let bestD = Infinity;
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const p = {
        x: boss.position.x + Math.cos(a) * radius,
        y: boss.position.y + Math.sin(a) * radius,
      };
      if (inside(p)) continue;
      const d = Math.hypot(p.x - me.x, p.y - me.y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best !== undefined) return { ...best, melee: k === 0 };
  }
  return undefined;
}

/** 予兆の終わり際（残り0.25秒）に当たる範囲にいれば、範囲の外への向き（移動の入力）を返す。 */
function dodgeDirection(sim: ArenaSimulation, boss: Enemy): { x: number; y: number } | undefined {
  const a = boss.currentAttack;
  if (a === undefined) return undefined;
  const d = a.delivery;
  // 連続の叩きつけ（母樹）：当たり判定の間も、次の1回の位置が示される。その直前に回避する
  const repeatNext =
    boss.state === "active" && d.type === "strike" && d.aim === "target" && d.repeat !== undefined
      ? d.repeat.interval - (boss.timeInState % d.repeat.interval)
      : undefined;
  if (boss.state !== "windup" && repeatNext === undefined) return undefined;
  const left = repeatNext ?? a.windup / (1 + boss.haste) - boss.timeInState / (1 + boss.haste);
  if (left > 0.25 || sim.motion.currentStamina < 25) return undefined;
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

/**
 * ガードするボット（騎士）：ボスの叩きつけ・薙ぎ払いが当たる直前に、右クリックを押してパリィを狙う。
 * 予兆の残りが 0.12秒以下になったらガードを上げ（受付は0.18秒）、攻撃が終わるまで上げ続ける。
 * 残り 0.6秒以下の間は、新しい技を始めない（技の最中はガードを上げられないため）。
 * 自分が当たる範囲にいるときだけ。ガードできない攻撃（胞子の雲・召喚）は何もしない。
 */
function guardPlan(sim: ArenaSimulation, boss: Enemy): { guard: boolean; hold: boolean } {
  const a = boss.currentAttack;
  const none = { guard: false, hold: false };
  if (a === undefined || a.delivery.type !== "strike" || !(a.ratio > 0)) return none;
  if (boss.state !== "windup" && boss.state !== "active") return none;
  const d = a.delivery;
  const me = sim.motion.position;
  const center = d.aim === "target" ? boss.targetPoint : boss.position;
  const reach = d.shape.type === "line" ? d.shape.length : d.shape.radius;
  const gap = Math.hypot(me.x - center.x, me.y - center.y) - sim.player.radius;
  if (gap > reach + (d.aim === "target" ? 0 : boss.combatant.radius)) return none;
  if (boss.state === "active") {
    // 連続の叩きつけ：1回ごとに押し直す（押し続けだとパリィにならない）。次の1回の0.12秒前に上げ直す
    const repeat = d.repeat;
    if (repeat === undefined) return { guard: true, hold: true };
    const into = boss.timeInState % repeat.interval;
    const next = repeat.interval - into;
    return { guard: into <= 0.2 || next <= 0.12, hold: into <= 0.2 || next <= 0.4 };
  }
  const left = (a.windup - boss.timeInState) / (1 + boss.haste);
  return { guard: left <= 0.12, hold: left <= 0.6 };
}

/** 一番近い、生きているボス以外の敵（触手など）。 */
function nearestAdd(sim: ArenaSimulation, me: { x: number; y: number }): Enemy | undefined {
  let best: Enemy | undefined;
  let bestD = Infinity;
  for (const e of sim.field?.enemies ?? []) {
    if (e.def.boss !== undefined || e.state === "dead") continue;
    const d = Math.hypot(e.position.x - me.x, e.position.y - me.y);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
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
  // ガードできる騎士は、回避せずにパリィで受ける（攻撃面だけを測るときは、ガードに時間を使わない）
  const guardian = !invincible && sim.canGuard;
  const dodges = options.dodge ?? (!invincible && !guardian);
  let t = 0;
  let taken = 0;
  let killTime: number | undefined;
  let deaths = 0;
  let deathTime: number | undefined;
  const startHp = boss.combatant.health.hp;
  while (t < limit) {
    const me = sim.motion.position;
    // 呼ばれた触手が生きていれば、先に倒す（毒の棘を吐き続けるため。人なら先に片付ける）
    const add = nearestAdd(sim, me);
    const foe = add ?? boss;
    const dest = add === undefined ? (boss.burrowDestination ?? boss.position) : add.position;
    const dx = dest.x - me.x;
    const dy = dest.y - me.y;
    const dist = Math.hypot(dx, dy) - foe.combatant.radius - sim.player.radius;
    // 胞子の雲：近接の位置が雲の中なら、雲の無い近接の位置へ回る（無ければ外側で雲が消えるのを待つ）
    const spot =
      add === undefined && boss.burrowDestination === undefined ? cloudSpot(sim, boss) : undefined;
    const toSpot = spot === undefined ? undefined : { x: spot.x - me.x, y: spot.y - me.y };
    const atSpot = toSpot !== undefined && Math.hypot(toSpot.x, toSpot.y) <= 0.15;
    const move =
      toSpot !== undefined
        ? atSpot
          ? { x: 0, y: 0 }
          : toSpot
        : dist > MELEE_GAP
          ? { x: dx, y: dy }
          : { x: 0, y: 0 };
    // 適正間合いを持つジョブ（弓使い）：間合いの真ん中に立ち、止まって撃つ。近すぎれば離れ、遠ければ寄る。
    // 雲の中にいれば、雲の外へ出る
    const band = sim.job.preferredRange ?? build.standoff;
    let ranged: { move: { x: number; y: number }; attack: boolean } | undefined;
    if (band !== undefined) {
      const clouds = sim.field?.clouds ?? [];
      const cloud = clouds.find(
        (c) =>
          Math.hypot(me.x - c.center.x, me.y - c.center.y) <= c.radius + sim.player.radius + 0.2,
      );
      const lo = band.min + 0.5;
      const hi = band.max - 0.5;
      ranged = cloud
        ? { move: { x: me.x - cloud.center.x || 1, y: me.y - cloud.center.y }, attack: true }
        : dist > hi
          ? { move: { x: dx, y: dy }, attack: false }
          : dist < lo
            ? { move: { x: -dx, y: -dy }, attack: true }
            : { move: { x: 0, y: 0 }, attack: true };
    }
    const special = chooseSkill(sim, db, band !== undefined && dist < band.close + 0.5);
    // 近接の距離まで寄ってから技を使う（技の間は動けないので、離れたまま押すと届かない）
    const canAttack = spot === undefined || (spot.melee && atSpot);
    const held = new Set<Action>(
      ranged !== undefined
        ? ranged.attack
          ? [special?.action ?? "skill1"]
          : []
        : canAttack && dist <= MELEE_GAP + 0.2
          ? [special?.action ?? "skill1"]
          : [],
    );
    const pressed = new Set<Action>();
    // ガード（騎士）：予兆の終わり際にガードを上げる。ガードを上げている間と、その直前は攻撃しない
    const plan = guardian ? guardPlan(sim, boss) : undefined;
    if (plan?.hold === true) held.clear();
    if (plan?.guard === true) {
      held.add("skill2");
      if (sim.guard?.raised !== true) pressed.add("skill2");
    }
    // 予兆の回避：ボスの攻撃の予兆の終わり際に、当たる範囲にいれば、範囲の外へ回避する
    const away = dodgeDirection(sim, boss);
    if (dodges && away !== undefined) pressed.add("dodge");
    if (!invincible && sim.player.health.hp < sim.player.health.maxHp * 0.5) pressed.add("flaskHp");
    const frame: InputFrame = {
      held: away !== undefined && dodges ? new Set<Action>() : held,
      pressed,
      move: away !== undefined && dodges ? away : (ranged?.move ?? move),
      // ガードするときは、ボットの攻撃の相手（触手）ではなく、攻撃してくるボスの方を向く
      pointerWorld:
        plan?.hold === true
          ? { x: toPixels(boss.position.x), y: toPixels(boss.position.y) }
          : { x: toPixels(dest.x), y: toPixels(dest.y) },
    };
    const hpBefore = sim.player.health.hp + sim.player.health.ward;
    sim.frame(STEP, frame);
    const hpAfter = sim.player.health.hp + sim.player.health.ward;
    if (hpAfter < hpBefore) taken += hpBefore - hpAfter;
    if (invincible) sim.player.health.restoreFull();
    if (options.noGauge === true) sim.jobGauge.spend("all");
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
    guards: sim.guardCount,
    parries: sim.parryCount,
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

/**
 * ユニークのベースを、同じ分類・同じタグの下級の通常のベースに置き換える（力の配分の「装備なし」。T15）。
 * 通常のベースはそのまま返す。
 */
export function plainBase(db: ContentDb, baseId: string): string {
  const def = db.itemBases.get(baseId);
  if (def === undefined) throw new RangeError(`ベース ${baseId} が無い`);
  if (def.unique === undefined) return baseId;
  const key = [...def.tags].sort().join(",");
  for (const b of db.itemBases.values()) {
    if (b.unique !== undefined || b.category !== def.category || b.tier !== 1) continue;
    if ([...b.tags].sort().join(",") === key) return b.id;
  }
  throw new RangeError(`${baseId} の代わりの通常のベースが無い`);
}

/** 力の配分（仕様書v0.2 1.4・開発計画書 T15）を測るときの、外すもの。 */
export type ContributionPart = "equipment" | "tree" | "job";

/**
 * 1つの力の源を外したビルドと計測の設定（仕様書v0.2 1.4【v0.2】の測り方）。
 * - 装備（基礎＋詞＋固有）：詞・強化を外し、ユニークを同じ種類の下級の通常のベースにする。
 *   武器・防具の種類（基礎）は残す（外すと技の形・適性そのものが変わり、別のビルドになるため）
 * - ツリー：星辰盤を全て外す（MVPに流派盤は無い）
 * - ジョブ（職技・職紋盤・職能ゲージ）：職紋盤を外し、技の枠を通常攻撃だけにし、職能ゲージを使わない
 */
export function withoutPart(
  db: ContentDb,
  build: BenchBuild,
  part: ContributionPart,
): { readonly build: BenchBuild; readonly options: BenchOptions } {
  switch (part) {
    case "equipment":
      return {
        build: {
          ...build,
          equipment: build.equipment.map((e) => ({ slot: e.slot, base: plainBase(db, e.base) })),
        },
        options: {},
      };
    case "tree":
      return { build: { ...build, stars: [] }, options: {} };
    case "job":
      return {
        build: {
          ...build,
          jobNodes: [],
          skills: ["SKL-BASIC-ATTACK", undefined, undefined, undefined, undefined, undefined],
        },
        options: { noGauge: true },
      };
  }
}

/**
 * 武器だけを替えたビルド（片手と両手の比較。docs/progress D-FIN-4）。主手の詞をそのまま両方の手に付け、強化は+5。
 * off を省略すると副手は空き。主手・副手以外の装備はそのまま。
 */
export function withWeapons(b: BenchBuild, main: string, off?: string): BenchBuild {
  const w = b.equipment.find((e) => e.slot === "mainHand");
  const rest = b.equipment.filter((e) => e.slot !== "mainHand" && e.slot !== "offHand");
  const hand = (slot: "mainHand" | "offHand", base: string) => ({
    slot,
    base,
    ...(w?.affixes === undefined ? {} : { affixes: w.affixes }),
    enhance: 5,
  });
  return {
    ...b,
    equipment: [
      hand("mainHand", main),
      ...(off === undefined ? [] : [hand("offHand", off)]),
      ...rest,
    ],
  };
}
