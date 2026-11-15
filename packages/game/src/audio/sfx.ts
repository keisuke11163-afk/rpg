/**
 * 効果音の合成（WebAudio）。仮素材：音声ファイルを使わず、オシレーターとノイズとエンベロープで作る
 * （MVP実装単位 2.1。docs/progress D-SFX-1）。本素材に差し替えるときは、SFX_DEFS の代わりに
 * 同じキー（SfxKey）の音声ファイルを鳴らす。
 * AudioContext はゲームに1つ（Phaser の WebAudio の音の管理が作ったもの）を使い回す。シーンを作り直しても作り直さない。
 * 表示の側の乱数（ノイズ）は、シミュレーションには関わらない。
 */
import { SFX_KEYS, type SfxKey } from "./sfx-events.ts";

/** 音の1つの部品（声部）。時間はミリ秒、音の高さは Hz、大きさは 0〜1。 */
export type SfxVoice =
  | {
      readonly kind: "tone";
      readonly wave: OscillatorType;
      /** 始めの高さ。 */
      readonly freq: number;
      /** 終わりの高さ（省略すると変えない）。 */
      readonly freqEnd?: number;
      readonly durationMs: number;
      readonly gain: number;
      /** 鳴り始めるまでの遅れ。 */
      readonly delayMs?: number;
      /** 立ち上がりの時間（省略すると 4 ミリ秒）。 */
      readonly attackMs?: number;
    }
  | {
      readonly kind: "noise";
      /** ノイズを通すフィルター。 */
      readonly filter: BiquadFilterType;
      readonly freq: number;
      readonly freqEnd?: number;
      readonly q?: number;
      readonly durationMs: number;
      readonly gain: number;
      readonly delayMs?: number;
      readonly attackMs?: number;
    };

/** 音の定義（仮素材）。 */
export interface SfxDef {
  readonly voices: readonly SfxVoice[];
}

const tone = (
  wave: OscillatorType,
  freq: number,
  freqEnd: number | undefined,
  durationMs: number,
  gain: number,
  delayMs = 0,
): SfxVoice => ({
  kind: "tone",
  wave,
  freq,
  ...(freqEnd === undefined ? {} : { freqEnd }),
  durationMs,
  gain,
  delayMs,
});
const noise = (
  filter: BiquadFilterType,
  freq: number,
  freqEnd: number | undefined,
  durationMs: number,
  gain: number,
  delayMs = 0,
  q = 1,
): SfxVoice => ({
  kind: "noise",
  filter,
  freq,
  ...(freqEnd === undefined ? {} : { freqEnd }),
  q,
  durationMs,
  gain,
  delayMs,
});

/**
 * 仮素材の効果音の表（キーは本素材と共通。docs/progress D-SFX-2 に、どの出来事で鳴るかの表）。
 * 短く（多くは 0.2 秒以下）、高すぎない音域（主に 100〜2000Hz）、小さめの音量にしている。
 */
export const SFX_DEFS: Readonly<Record<SfxKey, SfxDef>> = {
  // 通常のヒット：短い打撃（帯域のノイズ＋低い音）
  hit: { voices: [noise("bandpass", 1600, 900, 60, 0.32, 0, 1.2), tone("sine", 200, 90, 70, 0.3)] },
  // 会心：打撃＋高い「キン」
  crit: {
    voices: [
      noise("bandpass", 1800, 900, 70, 0.34, 0, 1.2),
      tone("sine", 220, 90, 80, 0.32),
      tone("triangle", 1250, 1650, 110, 0.12, 10),
    ],
  },
  // 崩し：重い打撃が沈む音
  break: {
    voices: [
      noise("lowpass", 1100, 300, 160, 0.36),
      tone("square", 170, 55, 200, 0.1),
      tone("triangle", 330, 110, 180, 0.16),
    ],
  },
  // 撃破：下がる音と、はじける音
  kill: {
    voices: [
      tone("triangle", 560, 200, 160, 0.18),
      noise("highpass", 2200, undefined, 90, 0.12, 20),
    ],
  },
  // 被弾：低くにごった音
  hurt: {
    voices: [tone("sawtooth", 150, 70, 170, 0.12), noise("lowpass", 700, 250, 120, 0.3)],
  },
  // ガード：金属の「カン」
  guard: {
    voices: [
      tone("square", 820, 700, 60, 0.07),
      tone("triangle", 1640, 1500, 160, 0.1),
      noise("bandpass", 3000, undefined, 40, 0.12, 0, 2),
    ],
  },
  // 回避：風を切る音（上がるノイズ）
  dodge: { voices: [noise("bandpass", 500, 2000, 150, 0.2, 0, 0.8)] },
  // 近接の技：振る音（下がるノイズ）
  skillMelee: { voices: [noise("bandpass", 1400, 450, 110, 0.18, 0, 0.9)] },
  // 投射の技：弦の音と、飛ぶ音
  skillProjectile: {
    voices: [tone("triangle", 880, 460, 80, 0.12), noise("highpass", 2400, undefined, 70, 0.07)],
  },
  // 魔法：上がる2つの音
  skillSpell: {
    voices: [tone("sine", 440, 880, 220, 0.13), tone("sine", 660, 1320, 200, 0.06, 30)],
  },
  // 召喚：ゆっくり上がる低めの音
  skillSummon: {
    voices: [
      tone("triangle", 196, 392, 300, 0.15),
      tone("sine", 294, 588, 280, 0.07, 40),
      noise("lowpass", 600, 1200, 260, 0.06),
    ],
  },
  // 戦吼・強化：短い2つの音
  skillBuff: {
    voices: [
      tone("square", 262, undefined, 90, 0.06),
      tone("square", 392, undefined, 120, 0.06, 80),
    ],
  },
  // 薬瓶：泡の音
  flask: {
    voices: [tone("sine", 480, 900, 110, 0.16), tone("sine", 640, 1100, 110, 0.12, 80)],
  },
  // 拾う：明るい2つの音
  pickup: {
    voices: [
      tone("triangle", 988, undefined, 60, 0.12),
      tone("triangle", 1319, undefined, 90, 0.1, 55),
    ],
  },
  // Lv UP：上がる分散和音
  levelUp: {
    voices: [
      tone("triangle", 523, undefined, 140, 0.13),
      tone("triangle", 659, undefined, 140, 0.13, 90),
      tone("triangle", 784, undefined, 140, 0.13, 180),
      tone("triangle", 1047, undefined, 320, 0.13, 270),
    ],
  },
  // 倒れた：長く下がる音
  death: {
    voices: [tone("triangle", 392, 98, 750, 0.18), noise("lowpass", 500, 150, 600, 0.14)],
  },
  // 宝箱：ふたの音と明るい音
  chest: {
    voices: [
      noise("lowpass", 900, undefined, 70, 0.22),
      tone("triangle", 659, undefined, 90, 0.11, 60),
      tone("triangle", 988, undefined, 160, 0.11, 130),
    ],
  },
  // UI の操作・音量の確認：短い「ポッ」
  ui: { voices: [tone("sine", 1000, 900, 45, 0.12)] },
};

/** 全体の音量に掛ける値（仮値: 音量1でも耳に痛くないように。docs/progress D-SFX-4）。 */
const MASTER_GAIN = 0.5;

/** 鳴らした回数（種類ごと。ゲームを開いてからの累計）。 */
export interface SfxCounts {
  /** 鳴らそうとした回数（間引いた後。音量0・合成できないときも数える）。 */
  readonly triggered: Readonly<Record<SfxKey, number>>;
  /** 実際に合成した回数（音量0・AudioContext が無い・止まっている・タブが隠れているときは数えない）。 */
  readonly played: Readonly<Record<SfxKey, number>>;
}

const zeroCounts = (): Record<SfxKey, number> =>
  Object.fromEntries(SFX_KEYS.map((k) => [k, 0])) as Record<SfxKey, number>;

/** AudioContext の状態（合成できない環境は "none"）。 */
export type SfxContextState = AudioContextState | "none";

/**
 * 効果音を鳴らすもの。ゲームに1つ（{@link sfx}）。AudioContext は attach で受け取る（無ければ何もしない）。
 * 例外を投げない（音が鳴らなくても、ゲームは止めない）。
 */
export class SfxPlayer {
  private context: AudioContext | undefined;
  private master: GainNode | undefined;
  private noiseBuffer: AudioBuffer | undefined;
  private volume = 0;
  private readonly triggeredCounts = zeroCounts();
  private readonly playedCounts = zeroCounts();
  private readonly isHidden: () => boolean;

  /** @param isHidden タブが隠れているか（隠れている間は鳴らさない）。 */
  constructor(isHidden: () => boolean = () => typeof document !== "undefined" && document.hidden) {
    this.isHidden = isHidden;
  }

  /**
   * 使う AudioContext を決める。同じものなら何もしない（シーンを作り直したとき）。
   * undefined なら鳴らさない（AudioContext が無い環境）。
   */
  attach(context: AudioContext | undefined): void {
    if (context === this.context) return;
    this.context = context;
    this.master = undefined;
    this.noiseBuffer = undefined;
  }

  /** 音量（0〜1。設定の Settings.volume）。 */
  setVolume(volume: number): void {
    this.volume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0;
    if (this.master !== undefined && this.context !== undefined)
      this.master.gain.setValueAtTime(this.volume * MASTER_GAIN, this.context.currentTime);
  }

  /**
   * ユーザーの操作（キー・クリック）のときに呼ぶ。ブラウザの自動再生の制限で止まっている AudioContext を動かす。
   * 動かせなくても例外を投げない。
   */
  unlock(): void {
    const ctx = this.context;
    if (ctx?.state !== "suspended") return;
    try {
      ctx.resume().catch(() => undefined);
    } catch {
      // 動かせない環境では何もしない
    }
  }

  /** AudioContext の状態（確認用）。 */
  get state(): SfxContextState {
    return this.context?.state ?? "none";
  }

  /** 鳴らした回数（確認用。写しを返す）。 */
  counts(): SfxCounts {
    return { triggered: { ...this.triggeredCounts }, played: { ...this.playedCounts } };
  }

  /** 音を鳴らす（SfxLimiter で間引いた後の一覧）。鳴らせないときは黙って捨てる。 */
  play(keys: readonly SfxKey[]): void {
    for (const key of keys) {
      this.triggeredCounts[key] += 1;
      // 音量0なら何も作らない。止まっている（自動再生の制限・タブを離れた）・隠れている間も捨てる
      const ctx = this.context;
      if (this.volume <= 0 || ctx?.state !== "running" || this.isHidden()) continue;
      try {
        this.synth(ctx, SFX_DEFS[key]);
        this.playedCounts[key] += 1;
      } catch {
        // 合成に失敗しても、ゲームは止めない
      }
    }
  }

  /** 全体の音量のノード（1つを使い回す。強い音が重なっても割れにくいよう、コンプレッサーを通す）。 */
  private output(ctx: AudioContext): GainNode {
    if (this.master !== undefined) return this.master;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.ratio.value = 6;
    compressor.connect(ctx.destination);
    const master = ctx.createGain();
    master.gain.value = this.volume * MASTER_GAIN;
    master.connect(compressor);
    this.master = master;
    return master;
  }

  /** 白いノイズ（0.5秒。1つを使い回す）。 */
  private noise(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer !== undefined) return this.noiseBuffer;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.5), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
    return buffer;
  }

  private synth(ctx: AudioContext, def: SfxDef): void {
    const out = this.output(ctx);
    const now = ctx.currentTime;
    for (const v of def.voices) {
      const start = now + (v.delayMs ?? 0) / 1000;
      const dur = v.durationMs / 1000;
      const end = start + dur;
      const attack = Math.min(dur / 2, (v.attackMs ?? 4) / 1000);
      // エンベロープ：0 → 立ち上がり → 指数で減る（0 には指数で近づけないので、小さな値まで）
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(v.gain, start + attack);
      env.gain.exponentialRampToValueAtTime(0.0001, end);
      env.connect(out);
      let source: AudioScheduledSourceNode;
      if (v.kind === "tone") {
        const osc = ctx.createOscillator();
        osc.type = v.wave;
        osc.frequency.setValueAtTime(v.freq, start);
        if (v.freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(v.freqEnd, end);
        osc.connect(env);
        source = osc;
      } else {
        const src = ctx.createBufferSource();
        src.buffer = this.noise(ctx);
        src.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = v.filter;
        filter.Q.value = v.q ?? 1;
        filter.frequency.setValueAtTime(v.freq, start);
        if (v.freqEnd !== undefined) filter.frequency.exponentialRampToValueAtTime(v.freqEnd, end);
        src.connect(filter);
        filter.connect(env);
        source = src;
      }
      source.start(start);
      source.stop(end + 0.02);
      // 鳴り終わったらつなぎを外す（ノードを残さない）
      source.onended = () => {
        source.disconnect();
        env.disconnect();
      };
    }
  }
}

/** ゲームに1つの効果音（シーンを作り直しても使い回す）。 */
export const sfx = new SfxPlayer();
