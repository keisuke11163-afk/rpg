/**
 * 戦闘画面の HUD に出す内容（ビューモデル）を、ArenaSimulation の状態から作る。
 * Phaser に依存しない（描くのは Hud.ts。中身はテストで確かめる）。規則・数値は変えず、読むだけ。
 */
import { type Facility, FLASK_RULES } from "@stella/core";
import { text, type TextKey } from "@stella/content";
import type { Action, Binding } from "../input/actions.ts";
import { bindingName } from "../settings/settings.ts";
import { type ArenaSimulation, SKILL_SLOTS, type SkillSlot } from "../scenes/arena-simulation.ts";

/** HUD が読む ArenaSimulation の部分（テストでは本物の ArenaSimulation を渡せばよい）。 */
export type HudSource = Pick<
  ArenaSimulation,
  | "db"
  | "playerHealth"
  | "player"
  | "mp"
  | "maxMp"
  | "motion"
  | "jobGauge"
  | "loadout"
  | "blockOf"
  | "cooldowns"
  | "executing"
  | "hpFlask"
  | "mpFlask"
  | "character"
  | "job"
  | "region"
  | "field"
  | "buffs"
  | "nearbyInteractable"
  | "inTrial"
>;

/** HP・MP・気力・職能ゲージの1本。 */
export interface HudVital {
  readonly id: "hp" | "mp" | "stamina" | "gauge";
  /** 棒の左の短い名前（例：HP・闘志）。 */
  readonly label: string;
  readonly value: number;
  readonly max: number;
  /** 0〜1 にクランプした割合（最大が0以下なら0）。 */
  readonly ratio: number;
  /** 数値の表示（例：268／268）。 */
  readonly text: string;
}

/** 職能ゲージの段階のしきい値（例：闘志の激化は50）。 */
export interface HudGaugeStage {
  readonly id: string;
  readonly label: string;
  readonly min: number;
  /** しきい値の、棒の上の位置（0〜1）。 */
  readonly ratio: number;
}

export interface HudGauge extends HudVital {
  readonly id: "gauge";
  readonly stages: readonly HudGaugeStage[];
  /** 今の段階（最も高いもの。位相のゲージは合成魔法）。段階に入っていなければ undefined。 */
  readonly stageId: string | undefined;
  readonly stageLabel: string | undefined;
}

/** 技の枠の状態。empty は技を入れていない枠。 */
export type HudSkillState =
  "ready" | "cooldown" | "mp" | "gauge" | "target" | "locked" | "blocked" | "empty";

export interface HudSkillSlot {
  readonly action: SkillSlot;
  /** キーの短い名前（左・右・1〜4。設定で割り当てを変えていれば、そのキーの名前）。 */
  readonly keyLabel: string;
  readonly skill: string | undefined;
  readonly name: string;
  /** 枠の中に収まる短い名前（4文字まで）。 */
  readonly shortName: string;
  readonly state: HudSkillState;
  /** 状態の短い説明（使えるときは空）。 */
  readonly stateLabel: string;
  /** CDの残り（秒。CD中でなければ0）。 */
  readonly cooldownRemaining: number;
  /** CDの総時間（秒）。見ていた間に分からなければ undefined（そのときは残り秒だけを出す）。 */
  readonly cooldownTotal: number | undefined;
  /** CDの残りの割合（1＝始まったばかり・0＝終わった）。総時間が分からなければ undefined。 */
  readonly cooldownRatio: number | undefined;
  /** 今その技を使っている最中か。 */
  readonly executing: boolean;
}

export interface HudFlask {
  readonly id: "hp" | "mp";
  readonly keyLabel: string;
  readonly charges: number;
  readonly max: number;
}

export interface HudLevel {
  readonly level: number;
  /** 経験値の割合（0〜1。上限なら1）。 */
  readonly xpRatio: number;
  readonly jobName: string;
  readonly jobLevel: number;
  readonly jobXpRatio: number;
  /** 追いつき補正（メインジョブの経験値×2）を受けているか。 */
  readonly catchingUp: boolean;
}

export interface HudBoss {
  readonly name: string;
  readonly level: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly hpRatio: number;
  readonly phase: number;
  readonly phases: number;
  /** 例：第1段階（切り替えの無敵の間は（無敵）を添える）。 */
  readonly stageLabel: string;
  /** 次の段階に移るHPの割合（棒の刻み。高い順）。 */
  readonly thresholds: readonly number[];
  readonly staggerRatio: number;
  readonly broken: boolean;
  readonly shielded: boolean;
}

export interface HudEffect {
  readonly kind: "buff" | "ailment" | "stagger";
  readonly label: string;
  /** 残りの秒数（分からないものは undefined）。 */
  readonly remaining: number | undefined;
  /** 重ねた数（2以上のときだけ表示する）。 */
  readonly stacks: number;
}

export interface HudModel {
  readonly regionName: string;
  readonly vitals: {
    readonly hp: HudVital;
    readonly mp: HudVital;
    readonly stamina: HudVital;
    readonly gauge: HudGauge;
  };
  /** HPが少ない（30%未満）。棒を点滅させる。 */
  readonly lowHp: boolean;
  readonly skills: readonly HudSkillSlot[];
  readonly flasks: readonly [HudFlask, HudFlask];
  readonly level: HudLevel;
  readonly boss: HudBoss | undefined;
  readonly effects: readonly HudEffect[];
  /** 近くの調べられる物の案内（例：F：宝箱を開ける）。無ければ undefined。 */
  readonly prompt: string | undefined;
  readonly saveStatus: string;
  /** 試し打ちの場にいる（星辰盤の振り直しが無料）。 */
  readonly inTrial: boolean;
}

/** HPが少ないとみなす割合（仮値。D-HUD-3）。 */
export const LOW_HP_RATIO = 0.3;

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const ratioOf = (value: number, max: number): number => (max > 0 ? clamp01(value / max) : 0);

/** 文章の {name} を値で置き換える。 */
export function fill(template: string, vars: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => {
    const v = vars[k];
    return v === undefined ? m : String(v);
  });
}

/** 数値の表示（例：268／268）。小数は切り捨てず四捨五入。 */
export function vitalText(value: number, max: number): string {
  return `${Math.round(value).toFixed(0)}／${Math.round(max).toFixed(0)}`;
}

function vital(id: HudVital["id"], label: string, value: number, max: number): HudVital {
  return { id, label, value, max, ratio: ratioOf(value, max), text: vitalText(value, max) };
}

/** 割り当ての短い名前（マウスは「左」「右」。キーは表示の名前）。 */
export function shortBindingName(b: Binding | undefined): string {
  if (b === undefined) return "";
  if ("mouse" in b) return text(b.mouse === "left" ? "hud.key.left" : "hud.key.right");
  return bindingName(b);
}

/** 枠に収まる短い名前（max 文字まで。超えたら切る）。 */
export function shortName(name: string, max = 4): string {
  // 書記素（見た目の1文字）で数える
  const chars = Array.from(
    new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(name),
    (x) => x.segment,
  );
  return chars.length <= max ? name : chars.slice(0, max).join("");
}

/**
 * 技のCDの総時間を覚える（ArenaSimulation の Cooldowns は残りしか持たないため、表示の側で、CDが始まったときの
 * 残りを総時間として覚える）。Phaser に依存しない。
 */
export class CooldownTracker {
  private readonly totals = new Map<string, number>();
  /** 見ていない間に始まったCD（シーンを作り直した直後など）。総時間が分からない。 */
  private readonly unknown = new Set<string>();
  private first = true;

  /** 今の残りを見せて、総時間（分からなければ undefined）を返す。 */
  observe(skill: string, remaining: number): number | undefined {
    if (!(remaining > 0)) {
      this.totals.delete(skill);
      this.unknown.delete(skill);
      return undefined;
    }
    const known = this.totals.get(skill);
    // 残りが増えた＝新しくCDが始まった（使い直した）。最初に見たときにもう CD 中なら、総時間は分からない
    if (known === undefined || remaining > known + 1e-6) {
      if (known === undefined && this.first) this.unknown.add(skill);
      else this.unknown.delete(skill);
      this.totals.set(skill, remaining);
    }
    return this.unknown.has(skill) ? undefined : this.totals.get(skill);
  }

  /** 1回分の見る作業が終わった（以後に始まったCDは、総時間が分かる）。 */
  endFrame(): void {
    this.first = false;
  }
}

const SKILL_STATE_TEXT: Readonly<Record<Exclude<HudSkillState, "ready">, TextKey>> = {
  cooldown: "hud.skill.cooldown",
  mp: "hud.skill.mp",
  gauge: "hud.skill.gauge",
  target: "hud.skill.target",
  locked: "hud.skill.locked",
  blocked: "hud.skill.blocked",
  empty: "hud.skill.empty",
};

/** 技以外から付く強化の効果の名前（ArenaSimulation が buffs.add に渡す ref → 文章のキー）。 */
const BUFF_TEXT: Readonly<Record<string, TextKey>> = {
  focus: "hud.buff.focus",
  demon: "hud.buff.demon",
  surge: "hud.buff.surge",
  "uniform-light": "hud.buff.uniform-light",
  "shadow-step": "hud.buff.shadow-step",
  "beast-hunt": "hud.buff.beast-hunt",
};

/** 町の施設の名前（ArenaScene の施設の名札と、近くの物の案内で使う）。 */
export const FACILITY_TEXT: Readonly<Record<Facility, TextKey>> = {
  temple: "facility.temple",
  starReader: "facility.starReader",
  altar: "facility.altar",
  smith: "facility.smith",
  merchant: "facility.merchant",
  stash: "facility.stash",
  teleport: "facility.teleport",
  dummy: "facility.dummy",
};

/** 強化の効果の名前：技から付いた効果は技の名前、それ以外は BUFF_TEXT（知らないものは ref のまま）。 */
function buffName(src: HudSource, ref: string): string {
  const skill = src.db.skills.get(ref);
  if (skill !== undefined) return text(skill.text as TextKey);
  const key = BUFF_TEXT[ref];
  return key === undefined ? ref : text(key);
}

function skillSlots(
  src: HudSource,
  bindings: Readonly<Record<Action, readonly Binding[]>>,
  tracker: CooldownTracker | undefined,
): HudSkillSlot[] {
  const gaugeName = text(src.jobGauge.def.text as TextKey);
  const slots = SKILL_SLOTS.map((action): HudSkillSlot => {
    const keyLabel = shortBindingName(bindings[action][0]);
    const entry = src.loadout.find((l) => l.action === action);
    if (entry === undefined)
      return {
        action,
        keyLabel,
        skill: undefined,
        name: "",
        shortName: "",
        state: "empty",
        stateLabel: text(SKILL_STATE_TEXT.empty),
        cooldownRemaining: 0,
        cooldownTotal: undefined,
        cooldownRatio: undefined,
        executing: false,
      };
    const def = src.db.skills.get(entry.skill);
    const name = def === undefined ? entry.skill : text(def.text as TextKey);
    const remaining = src.cooldowns.remaining(entry.skill);
    const total = tracker?.observe(entry.skill, remaining);
    const block = src.blockOf(entry.skill);
    const state: HudSkillState =
      block === undefined ? "ready" : block === "affinity" ? "blocked" : block;
    return {
      action,
      keyLabel,
      skill: entry.skill,
      name,
      shortName: shortName(name),
      state,
      stateLabel:
        state === "ready"
          ? ""
          : state === "cooldown"
            ? fill(text(SKILL_STATE_TEXT.cooldown), { s: remaining.toFixed(1) })
            : state === "gauge"
              ? fill(text(SKILL_STATE_TEXT.gauge), { gauge: gaugeName })
              : text(SKILL_STATE_TEXT[state]),
      cooldownRemaining: remaining,
      cooldownTotal: total,
      cooldownRatio: total === undefined ? undefined : clamp01(remaining / total),
      executing: src.executing === action,
    };
  });
  tracker?.endFrame();
  return slots;
}

function gaugeVital(src: HudSource): HudGauge {
  const g = src.jobGauge;
  const label = text(g.def.text as TextKey);
  const base = vital("gauge", label, g.value, g.max);
  const stages = g.def.stages.map((s) => ({
    id: s.id,
    label: text(s.text as TextKey),
    min: s.min,
    ratio: ratioOf(s.min, g.max),
  }));
  const reached = stages.filter((s) => g.hasStage(s.id));
  const top = reached[reached.length - 1];
  // 位相のゲージ（魔法使い）は、段階の代わりに合成魔法の名前
  const fusion = g.fusion;
  return {
    ...base,
    id: "gauge",
    stages,
    stageId: top?.id ?? fusion?.id,
    stageLabel: top?.label ?? (fusion === undefined ? undefined : text(fusion.text as TextKey)),
  };
}

function bossOf(src: HudSource): HudBoss | undefined {
  const e = src.field?.enemies.find((x) => x.def.boss !== undefined && x.state !== "dead");
  const boss = e?.def.boss;
  if (e === undefined || boss === undefined) return undefined;
  const h = e.combatant.health;
  const st = e.combatant.stagger;
  const phases = boss.phaseThresholds.length + 1;
  return {
    name: text(e.def.text as TextKey),
    level: e.level,
    hp: h.hp,
    maxHp: h.maxHp,
    hpRatio: ratioOf(h.hp, h.maxHp),
    phase: e.phase,
    phases,
    stageLabel: `${fill(text("hud.boss.stage"), { n: e.phase, of: phases })}${e.shielded ? text("hud.boss.shielded") : ""}`,
    thresholds: [...boss.phaseThresholds],
    staggerRatio: st.broken ? 1 : ratioOf(st.current, st.max),
    broken: st.broken,
    shielded: e.shielded,
  };
}

function effectsOf(src: HudSource): HudEffect[] {
  const out: HudEffect[] = src.buffs.active.map((b) => ({
    kind: "buff" as const,
    label: buffName(src, b.ref),
    remaining: b.remaining,
    stacks: 1,
  }));
  // 状態異常（ArenaScene の ailmentText と同じ内容）
  const db = src.db;
  const st = src.player.ailments;
  for (const tag of st.activeTags()) {
    const def = [...db.ailments.values()].find((a) => a.tag === tag);
    const tagDef = db.tags.get(tag);
    out.push({
      kind: "ailment",
      label: tagDef === undefined ? tag : text(tagDef.text as TextKey),
      remaining: undefined,
      stacks: def === undefined ? 0 : st.stacks(def.id),
    });
  }
  if (src.player.stagger.broken)
    out.push({ kind: "stagger", label: text("hud.staggered"), remaining: undefined, stacks: 1 });
  return out;
}

/** 近くの調べられる物の案内。 */
export function promptOf(src: HudSource, interactKey: string): string | undefined {
  const n = src.nearbyInteractable();
  if (n === undefined) return undefined;
  const what =
    n.kind === "facility"
      ? text(FACILITY_TEXT[n.facility])
      : n.kind === "chest"
        ? text("hud.prompt.chest")
        : n.kind === "secret"
          ? text("hud.prompt.secret")
          : text("hud.prompt.stone");
  return fill(text("hud.prompt"), { key: interactKey, what });
}

export interface HudModelOptions {
  /** 実際に使う割り当て（設定の画面で変えた分を含む）。 */
  readonly bindings: Readonly<Record<Action, readonly Binding[]>>;
  /** 最後のセーブ・読み込みの結果。 */
  readonly saveStatus?: string;
  /** CDの総時間を覚えるもの（無ければ総時間は undefined）。 */
  readonly cooldowns?: CooldownTracker;
}

/** ArenaSimulation の今の状態から、HUD のビューモデルを作る（状態は変えない。tracker だけ覚える）。 */
export function buildHudModel(src: HudSource, options: HudModelOptions): HudModel {
  const hp = src.playerHealth;
  const motion = src.motion;
  const c = src.character;
  const jobTrack = c.jobTrack(src.job.id);
  const gauge = gaugeVital(src);
  const bindings = options.bindings;
  return {
    regionName:
      src.region === undefined ? text("hud.region.dev") : text(src.region.text as TextKey),
    vitals: {
      hp: vital("hp", text("hud.hp"), hp.hp, hp.maxHp),
      mp: vital("mp", text("hud.mp"), src.mp, src.maxMp),
      stamina: vital(
        "stamina",
        text("hud.stamina"),
        motion.currentStamina,
        motion.config.maxStamina,
      ),
      gauge,
    },
    lowHp: hp.maxHp > 0 && hp.hp > 0 && hp.hp / hp.maxHp < LOW_HP_RATIO,
    skills: skillSlots(src, bindings, options.cooldowns),
    flasks: [
      {
        id: "hp",
        keyLabel: shortBindingName(bindings.flaskHp[0]),
        charges: src.hpFlask.charges,
        max: FLASK_RULES.maxCharges,
      },
      {
        id: "mp",
        keyLabel: shortBindingName(bindings.flaskMp[0]),
        charges: src.mpFlask.charges,
        max: FLASK_RULES.maxCharges,
      },
    ],
    level: {
      level: c.level,
      xpRatio: c.progress.toNext > 0 ? ratioOf(c.progress.xp, c.progress.toNext) : 1,
      jobName: text(src.job.text as TextKey),
      jobLevel: c.jobLevel(src.job.id),
      jobXpRatio: jobTrack.toNext > 0 ? ratioOf(jobTrack.xp, jobTrack.toNext) : 1,
      catchingUp: c.catchingUp,
    },
    boss: bossOf(src),
    effects: effectsOf(src),
    prompt: promptOf(src, shortBindingName(bindings.interact[0])),
    saveStatus: options.saveStatus ?? "",
    inTrial: src.inTrial,
  };
}

/** 手応えの表示のきっかけを見つけるための、状態の数（ArenaSimulation から読む）。 */
export interface HudEventInput {
  /** 被弾した回数（敵の攻撃と、試験用の場の危険地帯の合計）。 */
  readonly hitsTaken: number;
  readonly level: number;
  readonly jobId: string;
  readonly jobLevel: number;
}

/** 前の刻みから増えたもの（被弾・Lv UP・ジョブLv UP）。 */
export interface HudEvents {
  readonly hurt: boolean;
  /** 上がった後のキャラLv（上がっていなければ undefined）。 */
  readonly levelUp: number | undefined;
  /** 上がった後のジョブLv（上がっていなければ・ジョブを変えたときは undefined）。 */
  readonly jobLevelUp: number | undefined;
}

/**
 * 状態の数の増加から、手応えの表示（被弾の赤い縁・Lv UP）のきっかけを見つける。規則には関わらない。
 * 最初に見たときは、何も起きていない扱い。
 */
export class HudEventTracker {
  private last: HudEventInput | undefined;

  observe(now: HudEventInput): HudEvents {
    const prev = this.last;
    this.last = now;
    if (prev === undefined) return { hurt: false, levelUp: undefined, jobLevelUp: undefined };
    return {
      hurt: now.hitsTaken > prev.hitsTaken,
      levelUp: now.level > prev.level ? now.level : undefined,
      jobLevelUp:
        now.jobId === prev.jobId && now.jobLevel > prev.jobLevel ? now.jobLevel : undefined,
    };
  }
}
