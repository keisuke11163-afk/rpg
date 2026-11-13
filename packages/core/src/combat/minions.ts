import type { Vec2 } from "../actor/vector.ts";
import type { GaugeDef, MinionDef } from "../content/job.ts";
import type { ContentDb } from "../content/load.ts";
import { type ModifierView, evaluateEffects } from "../effects/evaluate.ts";
import { TagIndex } from "../effects/tag-index.ts";
import type { Rng } from "../random/rng.ts";
import { staggerProfiles } from "./ailments.ts";
import { Combatant, type HitReport, resolveHit } from "./combatant.ts";
import type { DamageAttacker, DamageSkill } from "./damage.ts";
import { baseSkillLevel } from "./skill-level.ts";
import { standardHp } from "./standards.ts";

/**
 * 召喚物（召喚士。仕様書v0.2 5.5・5.1.1・MVP後の機能の提案3章 H-03・M-17）。
 *
 * - 召喚物はプレイヤーと同じ陣営（team "player"）の戦う者。敵の攻撃を受け、倒されるまで残る（M-17：永続）
 * - 召喚物ごとに契約枠を使う。枠が足りなければ呼べない。倒された・犠牲にした召喚物の枠は、すぐに戻る（H-03）
 * - セーブしない（地域を移る・転職する・倒れると消える。docs/progress D-SUM-8）
 *
 * ここは「数と枠とHPとダメージ」の規則だけ。動き（追従・索敵・攻撃の間隔）は呼び出す側（game の MinionField）。
 */

/** 召喚物の陣営（プレイヤーと同じ。敵の投射物はこの陣営に当たり、プレイヤーの投射物は当たらない）。 */
export const MINION_TEAM = "player";

/**
 * 召喚物の最大HP（仕様書v0.2 5.1.1）：基本の技レベルに対応するキャラLv（1 ＋ 5 ×（技レベル － 1））の
 * 標準HP（2.8 の「プレイヤーHP（目安）」の列を直線で補った値。補助仕様書0.1 の標準HPと同じ）× 召喚物の割合。
 * hpIncreased は持ち主の「召喚物HP+%」（魂の能力値・骨の指輪など。加算）。
 */
export function minionMaxHp(def: MinionDef, characterLevel: number, hpIncreased = 0): number {
  const level = baseSkillLevel(characterLevel);
  const at = Math.min(100, 1 + 5 * (level - 1));
  if (!Number.isFinite(hpIncreased))
    throw new RangeError(`召喚物HPの加算は有限の数（${String(hpIncreased)}）`);
  return standardHp(at) * def.hpRatio * Math.max(0, 1 + hpIncreased);
}

/**
 * 契約枠の数（仕様書v0.2 5.5・5.1・H-03）。
 * - メインジョブ：ゲージの最大値（10）＋ 最大値の加算（職詞「契約枠+1」・職奥義「軍勢」など）
 * - サブジョブ：決まった数（6）に固定。職詞・装備・天極では増えない（H-03 の承認：天極も効かない）
 * 契約枠の仕組みを持たないゲージなら0（召喚できない）。
 */
export function contractCapacity(def: GaugeDef, as: "main" | "sub", maxBonus = 0): number {
  if (def.contract === undefined) return 0;
  if (as === "sub") return def.contract.subJobFixed;
  return Math.max(0, def.max + maxBonus);
}

/** 呼び出した召喚物1体。 */
export class Minion {
  readonly id: string;
  readonly def: MinionDef;
  readonly combatant: Combatant;
  /** 向き（ラジアン）。 */
  facing: number;
  /** 次に攻撃できるまでの秒数。 */
  attackCooldown = 0;

  constructor(db: ContentDb, id: string, def: MinionDef, position: Vec2, maxHp: number) {
    this.id = id;
    this.def = def;
    this.facing = 0;
    this.combatant = new Combatant(db, {
      id,
      team: MINION_TEAM,
      position,
      radius: def.radius,
      facing: 0,
      maxHp,
      // 崩しの設定はプレイヤーと同じ（召喚物の崩されやすさは仕様書に無い。D-SUM-3）
      staggerProfile: staggerProfiles(db).player,
    });
  }

  get position(): Vec2 {
    return this.combatant.position;
  }
  set position(p: Vec2) {
    this.combatant.position = p;
  }
  get dead(): boolean {
    return this.combatant.health.dead;
  }
}

/** 召喚の結果（呼べなかった理由）。 */
export type SummonBlock = "slots" | "forbidden";

/**
 * 契約枠と、呼び出している召喚物の一覧。
 * 枠の数（capacity）は呼び出す側が決める（contractCapacity）。枠が減っても、すでにいる召喚物は消さない
 * （新しく呼べなくなるだけ。docs/progress D-SUM-7）。
 */
export class MinionSquad {
  private list: Minion[] = [];
  private serial = 0;
  capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  get minions(): readonly Minion[] {
    return this.list;
  }

  /** 使っている契約枠（いる召喚物のコストの合計）。 */
  get used(): number {
    return this.list.reduce((s, m) => s + m.def.slots, 0);
  }

  /** 空いている契約枠。 */
  get free(): number {
    return Math.max(0, this.capacity - this.used);
  }

  /**
   * 呼べない理由（呼べるなら undefined）。forbidden は「召喚物を生む」の禁止の印（一騎当千など。仕様書v0.2 2.4.1 の規則3）。
   */
  blockOf(def: MinionDef, forbidden = false): SummonBlock | undefined {
    if (forbidden) return "forbidden";
    if (this.used + def.slots > this.capacity) return "slots";
    return undefined;
  }

  /**
   * 召喚物を呼ぶ。枠が足りない・禁止なら呼ばずに undefined。
   * 最大HPは minionMaxHp（持ち主のキャラLv・召喚物HPの加算）。
   */
  summon(
    db: ContentDb,
    def: MinionDef,
    options: {
      readonly characterLevel: number;
      readonly position: Vec2;
      readonly hpIncreased?: number;
      readonly forbidden?: boolean;
    },
  ): Minion | undefined {
    if (this.blockOf(def, options.forbidden === true) !== undefined) return undefined;
    const maxHp = minionMaxHp(def, options.characterLevel, options.hpIncreased ?? 0);
    this.serial += 1;
    const m = new Minion(db, `minion-${String(this.serial)}`, def, options.position, maxHp);
    this.list.push(m);
    return m;
  }

  /** 召喚物を取り除く（魂の供儀で犠牲にした）。枠はすぐに戻る。いなければ false。 */
  remove(minion: Minion): boolean {
    const i = this.list.indexOf(minion);
    if (i < 0) return false;
    this.list.splice(i, 1);
    return true;
  }

  /** 倒された召喚物を取り除き、その一覧を返す（枠が戻る）。 */
  removeDead(): Minion[] {
    const dead = this.list.filter((m) => m.dead);
    if (dead.length > 0) this.list = this.list.filter((m) => !m.dead);
    return dead;
  }

  /** 全て消す（転職・倒れた・地域を移った）。 */
  clear(): void {
    this.list = [];
  }

  /** 位置に最も近い召喚物（いなければ undefined）。 */
  nearest(at: Vec2): Minion | undefined {
    let best: Minion | undefined;
    let dist = Infinity;
    for (const m of this.list) {
      if (m.dead) continue;
      const d = Math.hypot(m.position.x - at.x, m.position.y - at.y);
      if (d < dist) {
        dist = d;
        best = m;
      }
    }
    return best;
  }
}

/**
 * 召喚物の攻撃のダメージの形：呪文と同じく「基礎値 × 技レベルの倍率」（仕様書v0.2 5.1.1）で、回避されない
 * （召喚物の命中は仕様書に無い。docs/progress D-SUM-4）。pct は倍率（炎霊の爆発など）。
 */
export function minionDamageSkill(def: MinionDef, pct = 1): DamageSkill {
  return { tags: def.attack.tags, kind: "spell", pct, base: def.attack.base };
}

const emptyViews = new WeakMap<ContentDb, ModifierView>();

/**
 * 召喚物の攻撃者。召喚物は「召喚物の〜」の補正だけを受け、持ち主の「あなたの〜」の補正は受けない（仕様書v0.2 9章 V-05）。
 * そのため効果の一覧は空で、持ち主の「召喚物のダメージ+%」と指揮の+20%は、ヒットごとの加算（extraIncreased）で渡す。
 */
export function minionAttacker(db: ContentDb, characterLevel: number): DamageAttacker {
  let view = emptyViews.get(db);
  if (view === undefined) {
    view = evaluateEffects(db, new TagIndex(db.tags), []).view;
    emptyViews.set(db, view);
  }
  return { db, view, characterLevel };
}

/** 召喚物の攻撃のヒットを解決する（ダメージ → HP → 状態異常 → 崩し。resolveHit と同じ）。 */
export function resolveMinionHit(input: {
  readonly db: ContentDb;
  readonly minion: Minion;
  readonly target: Combatant;
  readonly rng: Rng;
  /** 持ち主のキャラLv（技レベルを決める）。 */
  readonly characterLevel: number;
  /** このヒットのダメージの加算（持ち主の「召喚物のダメージ+%」・指揮・集中の+20%）。 */
  readonly extraIncreased?: number;
  /** 攻撃の倍率（省略で1。炎霊の爆発）。 */
  readonly pct?: number;
  readonly roll?: "random" | "average";
}): HitReport {
  const { db, minion } = input;
  const a = minion.def.attack;
  return resolveHit({
    db,
    attacker: minionAttacker(db, input.characterLevel),
    attackerPosition: minion.position,
    skill: minionDamageSkill(minion.def, input.pct ?? 1),
    ...(a.ailmentChance === undefined ? {} : { skillChance: a.ailmentChance }),
    ...(a.staggerCoefficient === undefined ? {} : { staggerCoefficient: a.staggerCoefficient }),
    target: input.target,
    rng: input.rng,
    ...(input.roll === undefined ? {} : { roll: input.roll }),
    ...(input.extraIncreased === undefined || input.extraIncreased === 0
      ? {}
      : { extraIncreased: input.extraIncreased }),
  });
}
