/**
 * 効果音のきっかけ（どの出来事でどの音を鳴らすか）。Phaser・WebAudio に依存しない（テストできる）。
 * HUD の HudEventTracker と同じ流儀で、シミュレーションの読み取り用の値をフレームごとに比べて出来事を見つける。
 * 鳴らす音の重なりは SfxLimiter で抑える（音ごとの最小の間隔と、1フレームに鳴らす数の上限）。
 * 音の合成は sfx.ts（仮素材。docs/progress D-SFX-1）。
 */

/**
 * 効果音のキー。本素材（音声ファイル）に差し替えるときも同じキーを使う（MVP実装単位 2.1 の仮素材の流儀）。
 */
export const SFX_KEYS = [
  "hit",
  "crit",
  "break",
  "kill",
  "hurt",
  "guard",
  "dodge",
  "skillMelee",
  "skillProjectile",
  "skillSpell",
  "skillSummon",
  "skillBuff",
  "flask",
  "pickup",
  "levelUp",
  "death",
  "chest",
  "ui",
] as const;
export type SfxKey = (typeof SFX_KEYS)[number];

/** 音ごとの鳴らし方の規則。 */
export interface SfxRule {
  /** 同じ音を続けて鳴らすときの最小の間隔（ミリ秒）。これより短い間隔の2回目は鳴らさない。 */
  readonly minIntervalMs: number;
  /** 1フレームに鳴らす数の上限を超えたとき、大きい方から鳴らす。 */
  readonly priority: number;
}

/**
 * 音ごとの規則（仮値: 仕様書に無い。docs/progress D-SFX-3）。
 * 範囲攻撃で20体に当たっても、ヒットの音は45ミリ秒に1回まで・1フレームに1回まで。
 */
export const SFX_RULES: Readonly<Record<SfxKey, SfxRule>> = {
  death: { minIntervalMs: 500, priority: 100 },
  levelUp: { minIntervalMs: 300, priority: 90 },
  hurt: { minIntervalMs: 120, priority: 80 },
  break: { minIntervalMs: 80, priority: 70 },
  crit: { minIntervalMs: 60, priority: 60 },
  kill: { minIntervalMs: 60, priority: 55 },
  chest: { minIntervalMs: 200, priority: 50 },
  guard: { minIntervalMs: 80, priority: 45 },
  flask: { minIntervalMs: 150, priority: 40 },
  pickup: { minIntervalMs: 60, priority: 35 },
  skillSpell: { minIntervalMs: 60, priority: 31 },
  skillSummon: { minIntervalMs: 60, priority: 31 },
  skillMelee: { minIntervalMs: 50, priority: 30 },
  skillProjectile: { minIntervalMs: 50, priority: 30 },
  skillBuff: { minIntervalMs: 60, priority: 30 },
  dodge: { minIntervalMs: 100, priority: 25 },
  hit: { minIntervalMs: 45, priority: 20 },
  ui: { minIntervalMs: 50, priority: 10 },
};

/** 1フレームに鳴らす音の数の上限（仮値: 仕様書に無い。docs/progress D-SFX-3）。 */
export const SFX_MAX_PER_FRAME = 4;

/**
 * 鳴らす音を、フレームの間ためて、フレームの終わりに間引いて渡す。
 * 同じフレームの同じ音は1つにまとめ、最小の間隔より短い音は捨て、上限を超えた分は優先度の低い方から捨てる。
 */
export class SfxLimiter {
  private readonly rules: Readonly<Record<SfxKey, SfxRule>>;
  private readonly maxPerFrame: number;
  private readonly pending = new Set<SfxKey>();
  private readonly lastPlayed = new Map<SfxKey, number>();

  constructor(
    rules: Readonly<Record<SfxKey, SfxRule>> = SFX_RULES,
    maxPerFrame = SFX_MAX_PER_FRAME,
  ) {
    this.rules = rules;
    this.maxPerFrame = Math.max(0, Math.floor(maxPerFrame));
  }

  /** 鳴らしたい音を足す（undefined は無視する）。 */
  request(key: SfxKey | undefined): void {
    if (key !== undefined) this.pending.add(key);
  }

  /**
   * このフレームに鳴らす音を返し、ためた音を空にする。
   * @param nowMs 今の時刻（ミリ秒。表示の時計。単調に増えるもの）
   * @returns 鳴らす音（優先度の高い順。同じ優先度は SFX_KEYS の順）
   */
  flush(nowMs: number): SfxKey[] {
    if (this.pending.size === 0) return [];
    const ready = SFX_KEYS.filter((k) => {
      if (!this.pending.has(k)) return false;
      const last = this.lastPlayed.get(k);
      return last === undefined || nowMs - last >= this.rules[k].minIntervalMs;
    });
    this.pending.clear();
    // 安定な並べ替え（同じ優先度は SFX_KEYS の順のまま）
    const out = ready
      .sort((a, b) => this.rules[b].priority - this.rules[a].priority)
      .slice(0, this.maxPerFrame);
    for (const k of out) this.lastPlayed.set(k, nowMs);
    return out;
  }
}

/** ヒットの報告のうち、音を決めるのに使う所（core の HitReport と同じ形）。 */
export interface SfxHitInput {
  readonly hit: { readonly crit: boolean; readonly evaded: boolean };
  readonly staggerBroke: boolean;
}

/** ヒットの音：崩し → 会心 → ヒット（回避されたヒットは鳴らさない）。 */
export function hitSfx(report: SfxHitInput): SfxKey | undefined {
  if (report.hit.evaded) return undefined;
  if (report.staggerBroke) return "break";
  if (report.hit.crit) return "crit";
  return "hit";
}

/**
 * 技を使ったときの音を、技のタグと動き方から決める（召喚 → 魔法 → 投射 → 強化・戦吼 → 近接）。
 * @param tags 技のタグ（content の skills の tags）
 * @param actionType 技の動き方（content の skills の action.type）
 */
export function skillSfx(tags: readonly string[], actionType?: string): SfxKey {
  if (tags.includes("TAG-FORM-SUMMON") || actionType === "summon") return "skillSummon";
  if (tags.includes("TAG-FORM-SPELL")) return "skillSpell";
  if (tags.includes("TAG-FORM-PROJECTILE") || actionType === "projectile") return "skillProjectile";
  if (
    tags.includes("TAG-FORM-WARCRY") ||
    actionType === "warcry" ||
    actionType === "selfBuff" ||
    actionType === "command"
  )
    return "skillBuff";
  return "skillMelee";
}

/** フレームごとに見る、シミュレーションの読み取り用の値（表示の側で集める）。 */
export interface SfxObservation {
  /** 被弾の回数（敵の攻撃と危険地帯の合計）。 */
  readonly hitsTaken: number;
  readonly hp: number;
  /** 倒した敵の数。 */
  readonly kills: number;
  /** ガードで防いだ回数とパリィの回数の合計。 */
  readonly guards: number;
  /** 回避の動作中か。 */
  readonly dodging: boolean;
  /** 技ごとの使った回数（技のID → 回数）。 */
  readonly skillUses: ReadonlyMap<string, number>;
  /** 薬瓶の残り（HP・MP の合計）。 */
  readonly flaskCharges: number;
  /** 地面の物の数。 */
  readonly groundItems: number;
  /** 持ち物の量（装備の数＋金貨＋素材の数）。 */
  readonly carried: number;
  readonly level: number;
  readonly jobId: string;
  readonly jobLevel: number;
  /** 倒れた回数。 */
  readonly deaths: number;
  /** 開けた宝箱の数。 */
  readonly chestsOpened: number;
  /** 開いている画面（無ければ undefined）。 */
  readonly panel: string | undefined;
  /** 装備の並び（部位と装備の uid を連ねた文字。変わったら装備を替えた）。 */
  readonly equipment: string;
  /** 取ったノードの数（星辰盤・職紋盤・副職紋の合計）。 */
  readonly nodes: number;
}

/**
 * 値の変化から、鳴らす音の一覧を決める。最初の observe は比べる相手が無いので何も返さない
 * （地域に入った直後に音を鳴らさない）。
 */
export class SfxEventTracker {
  private last: SfxObservation | undefined;
  private readonly skillKey: (skillId: string) => SfxKey;

  /** @param skillKey 技のIDから技の音を決める（ArenaScene が技の定義から skillSfx で決める）。 */
  constructor(skillKey: (skillId: string) => SfxKey) {
    this.skillKey = skillKey;
  }

  observe(now: SfxObservation): SfxKey[] {
    const prev = this.last;
    this.last = now;
    if (prev === undefined) return [];
    const out: SfxKey[] = [];
    const add = (k: SfxKey): void => {
      if (!out.includes(k)) out.push(k);
    };
    if (now.deaths > prev.deaths) add("death");
    // 被弾：回数が増え、かつHPが減ったとき（盾で防いだ・吸収したときは鳴らさない。HUD の hurt と同じ）
    else if (now.hitsTaken > prev.hitsTaken && now.hp < prev.hp) add("hurt");
    if (now.guards > prev.guards) add("guard");
    if (now.kills > prev.kills) add("kill");
    if (now.dodging && !prev.dodging) add("dodge");
    for (const [id, n] of now.skillUses)
      if (n > (prev.skillUses.get(id) ?? 0)) add(this.skillKey(id));
    if (now.flaskCharges < prev.flaskCharges) add("flask");
    // 拾った：地面の物が減り、持ち物が増えた（店で買った・装備を外したときは地面の物が減らないので鳴らさない）
    if (now.groundItems < prev.groundItems && now.carried > prev.carried) add("pickup");
    if (now.level > prev.level || (now.jobId === prev.jobId && now.jobLevel > prev.jobLevel))
      add("levelUp");
    if (now.chestsOpened > prev.chestsOpened) add("chest");
    // UI：画面を開いた・切り替えた・装備を替えた・ノードを取った
    if (
      (now.panel !== undefined && now.panel !== prev.panel) ||
      now.equipment !== prev.equipment ||
      now.nodes > prev.nodes
    )
      add("ui");
    return out;
  }
}
