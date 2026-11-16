/**
 * 戦闘画面の HUD（補助仕様書16章）を描く。中身（ビューモデル）は hud-model.ts が作り、ここは並べて描くだけ。
 * 画面に固定（scrollFactor 0）。深さは世界の絵より上、画面（インベントリなど。深さ1000）より下。
 *
 * 配置（内部解像度 640×360）：
 * - 左上：地域の名前・Lv と経験値・ジョブとジョブLv
 * - 上中央：ボスがいるときだけ、ボスのHP・段階・崩しゲージ
 * - 右上：セーブの状態（変わったときに数秒だけ）
 * - 左下：HP・MP・気力・職能ゲージの棒
 * - 下中央：技の枠6つと薬瓶。その上に効果・状態異常の札、さらに上に近くの物の案内
 * - 右下：小さな地図（ArenaScene が描く。ここでは何も置かない）
 *
 * スマホ（タッチ）の表示のとき（docs/progress TOUCH-2）は、左下・右下にスティックとボタンが来るので、
 * 棒を左上（地域名・Lv の下）、効果の札をその下、小さな地図を右上、セーブの状態を地図の下、近くの物の案内を
 * 下中央に置き、下中央の技の枠は出さない（技のボタンが代わり）。配置の表は HUD_PLACES（PC とタッチの2つ）。
 */
import Phaser from "phaser";
import { text } from "@stella/content";
import { MINIMAP } from "./minimap.ts";
import { setTextColor } from "./text-style.ts";
import {
  type HudEffect,
  type HudFlask,
  type HudGauge,
  type HudModel,
  type HudSkillSlot,
  type HudVital,
  fill,
  secondsText,
} from "./hud-model.ts";

/** HUD の深さ（棒・地図の Graphics は900。画面は1000）。 */
export const HUD_DEPTH = 905;

const W = 640;
const H = 360;

/** 配置の数値（画面のピクセル）。 */
export const HUD_LAYOUT = {
  vitals: { x: 8, labelRight: 41, barX: 44, barWidth: 84, barHeight: 8, row: 11, rows: 4 },
  skills: { box: 38, height: 28, gap: 3, flask: 22, flaskGap: 8, bottom: 6 },
  chips: { height: 11, gap: 3 },
  top: { x: 8, y: 5 },
  boss: { width: 280, y: 4 },
} as const;

/** HUD の配置の種類：pc＝キーボード・マウス、touch＝スマホ（タッチの操作部が左下・右下に出る）。 */
export type HudLayoutKind = "pc" | "touch";

/**
 * 配置の表（PC とタッチ。画面のピクセル）。PC の値は前と同じ（PC の画面は変えない）。
 * - vitalsTop：HP などの棒の1本目の上端
 * - chips：効果の札の位置（aboveSkills＝技の枠の上。数なら、その位置から右へ）
 * - prompt：近くの物の案内の下端（aboveChips＝札の上）
 * - save：セーブの状態の右上
 * - skills：下中央の技の枠を出すか
 */
export const HUD_PLACES: Readonly<
  Record<
    HudLayoutKind,
    {
      readonly vitalsTop: number;
      readonly chips:
        "aboveSkills" | { readonly x: number; readonly y: number; readonly maxX: number };
      readonly prompt: "aboveChips" | number;
      readonly save: { readonly x: number; readonly y: number };
      readonly skills: boolean;
    }
  >
> = {
  pc: {
    vitalsTop: H - 8 - HUD_LAYOUT.vitals.rows * HUD_LAYOUT.vitals.row,
    chips: "aboveSkills",
    prompt: "aboveChips",
    save: { x: W - 8, y: HUD_LAYOUT.top.y },
    skills: true,
  },
  // 仮値: タッチの配置（docs/progress D-TOUCH-2）。棒は Lv・ジョブLv の下、札はその下（左スティックの範囲の上の端）、
  // 案内は下中央（左右の操作部の間）、セーブの状態は右上の地図（MINIMAP_TOUCH）の下
  touch: {
    vitalsTop: 54,
    chips: { x: 8, y: 102, maxX: 330 },
    prompt: H - 8,
    save: { x: W - 8, y: 76 },
    skills: false,
  },
};

/** 技の枠の左端（下中央に、技の枠6つと薬瓶2つを並べる）。 */
function skillBarX(): number {
  const s = HUD_LAYOUT.skills;
  const total = 6 * s.box + 5 * s.gap + s.flaskGap + 2 * s.flask + s.gap;
  return Math.round(W / 2 - total / 2);
}
const SKILL_Y = H - HUD_LAYOUT.skills.bottom - HUD_LAYOUT.skills.height;

const COLOR = {
  hp: 0xe04848,
  hpLow: 0xff8a8a,
  mp: 0x4f8ff0,
  stamina: 0x5fc173,
  gauge: 0xc77a2a,
  gaugeStage: 0xffa94d,
  barBack: 0x22212b,
  barEdge: 0x0e0d12,
  panel: 0x16151c,
  xp: 0xffd166,
  jobXp: 0xc3a6ff,
  boss: 0xd94a4a,
  bossTrail: 0xf2c4a0,
  bossShield: 0xc8a2ff,
  stagger: 0xffd166,
} as const;

export const SLOT_BORDER: Readonly<Record<HudSkillSlot["state"], number>> = {
  ready: 0x8c88a0,
  cooldown: 0x4a4858,
  mp: 0x6fa8ff,
  gauge: 0xff9f43,
  target: 0x6a6878,
  locked: 0x3a3846,
  blocked: 0x6a6878,
  empty: 0x2e2d38,
};
/** 使えない理由ごとの、枠に重ねる色（CD・空きは別に描く）。 */
export const SLOT_TINT: Readonly<Partial<Record<HudSkillSlot["state"], number>>> = {
  mp: 0x2a4f9a,
  gauge: 0x8a4a12,
  target: 0x3a3846,
  blocked: 0x3a3846,
  locked: 0x0e0d12,
};

const EFFECT_STYLE: Readonly<Record<HudEffect["kind"], { border: number; color: string }>> = {
  buff: { border: 0x7bd389, color: "#c8f5d0" },
  ailment: { border: 0xff6b6b, color: "#ffc4c4" },
  stagger: { border: 0xffd166, color: "#ffe6a6" },
};

const FONT = "sans-serif";

/** セーブの状態を出しておく時間（ミリ秒）と、消えるまでの時間。 */
const SAVE_SHOW_MS = 3000;
const SAVE_FADE_MS = 600;
/** 被弾の赤い縁の時間（ミリ秒）。 */
const HURT_MS = 260;

export interface HudRenderOptions {
  /** インベントリなどの画面を開いている（HPなどの棒だけを、画面の下の帯に出す）。 */
  readonly panelOpen: boolean;
  /** 大きな地図を開いている（地図と重なる案内を出さない）。 */
  readonly bigMap: boolean;
  /** シーンの時刻（ミリ秒。点滅・表示の時間に使う）。 */
  readonly now: number;
  /** 配置の種類（初期は pc）。 */
  readonly layout?: HudLayoutKind;
}

/** 戦闘画面の HUD。 */
export class Hud {
  private readonly scene: Phaser.Scene;
  /** 棒・枠などの図形。 */
  private readonly g: Phaser.GameObjects.Graphics;
  /** 被弾・HPが少ないときの赤い縁（HUD より下、世界の絵より上）。 */
  private readonly edge: Phaser.GameObjects.Graphics;
  private readonly region: Phaser.GameObjects.Text;
  private readonly lv: Phaser.GameObjects.Text;
  private readonly jobLv: Phaser.GameObjects.Text;
  private readonly catchUp: Phaser.GameObjects.Text;
  private readonly trial: Phaser.GameObjects.Text;
  private readonly vitalLabels: Phaser.GameObjects.Text[];
  private readonly vitalValues: Phaser.GameObjects.Text[];
  private readonly slotKeys: Phaser.GameObjects.Text[];
  private readonly slotNames: Phaser.GameObjects.Text[];
  private readonly slotCds: Phaser.GameObjects.Text[];
  private readonly flaskKeys: Phaser.GameObjects.Text[];
  private readonly flaskCounts: Phaser.GameObjects.Text[];
  private readonly chips: Phaser.GameObjects.Text[] = [];
  /** 画面を開いている間に隠す文字（chips は数が変わるので別）。 */
  private readonly fixedTexts: readonly Phaser.GameObjects.Text[];
  private readonly prompt: Phaser.GameObjects.Text;
  private readonly bossName: Phaser.GameObjects.Text;
  private readonly bossStage: Phaser.GameObjects.Text;
  private readonly bossHp: Phaser.GameObjects.Text;
  private readonly save: Phaser.GameObjects.Text;
  /** 最後に出したセーブの状態と、出し始めた時刻。 */
  private lastSave: string | undefined;
  private saveShownAt = -Infinity;
  /** ボスのHPの、遅れて減る部分（減った量を少しの間見せる）。 */
  private bossTrail = 1;
  private hurtAt = -Infinity;
  private lastNow = 0;
  /** 今の配置：full＝通常、strip＝画面を開いている間の下の帯（開発用の確認 snapshot が返す）。 */
  private mode: "full" | "strip" = "full";
  /** 今の配置の種類（開発用の確認 snapshot が返す）。 */
  private layout: HudLayoutKind = "pc";

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.edge = scene.add
      .graphics()
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH - 6);
    this.g = scene.add.graphics().setScrollFactor(0).setDepth(HUD_DEPTH);
    // 縁取りは、小さな文字を拡大したときににじむので使わない（下敷き・暗い背景の上に置く）
    const t = (size: number, color = "#e8e6f0", stroke = false): Phaser.GameObjects.Text =>
      scene.add
        .text(0, 0, "", {
          fontFamily: FONT,
          fontSize: `${String(size)}px`,
          color,
          ...(stroke ? { stroke: "#0e0d12", strokeThickness: 2 } : {}),
        })
        .setScrollFactor(0)
        .setDepth(HUD_DEPTH + 1);
    this.region = t(10).setPosition(HUD_LAYOUT.top.x, HUD_LAYOUT.top.y);
    this.lv = t(8, "#ffe6a6");
    this.jobLv = t(8, "#e2d4ff");
    this.catchUp = t(8, "#ffd166");
    this.trial = t(8, "#ffd166").setOrigin(0.5, 0);
    this.vitalLabels = [0, 1, 2, 3].map(() => t(8, "#c9c6d6").setOrigin(1, 0));
    this.vitalValues = [0, 1, 2, 3].map(() => t(8).setOrigin(0.5, 0));
    this.slotKeys = [0, 1, 2, 3, 4, 5].map(() => t(8, "#c3a6ff"));
    this.slotNames = [0, 1, 2, 3, 4, 5].map(() => t(8).setOrigin(0.5, 1));
    this.slotCds = [0, 1, 2, 3, 4, 5].map(() => t(10, "#ffffff").setOrigin(0.5, 0.5));
    this.flaskKeys = [0, 1].map(() => t(8, "#c3a6ff"));
    this.flaskCounts = [0, 1].map(() => t(8).setOrigin(1, 1));
    this.prompt = scene.add
      .text(W / 2, 0, "", {
        fontFamily: FONT,
        fontSize: "10px",
        color: "#e8e6f0",
        backgroundColor: "#16151ccc",
        padding: { x: 5, y: 2 },
      })
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH + 1);
    this.bossName = t(9, "#ffe0e0");
    this.bossStage = t(8, "#ffc4c4").setOrigin(1, 0);
    this.bossHp = t(8).setOrigin(0.5, 0);
    this.save = t(8, "#b8b4c8")
      .setOrigin(1, 0)
      .setPosition(W - 8, HUD_LAYOUT.top.y);
    // 全体を隠すときの対象（作ったときに1回だけ並べる。毎フレーム配列を作らない）
    this.fixedTexts = [
      this.region,
      this.lv,
      this.jobLv,
      this.catchUp,
      this.trial,
      this.prompt,
      this.bossName,
      this.bossStage,
      this.bossHp,
      ...this.slotKeys,
      ...this.slotNames,
      ...this.slotCds,
      ...this.flaskKeys,
      ...this.flaskCounts,
    ];
  }

  /** 被弾した（赤い縁を短く出す）。 */
  hurt(now: number): void {
    this.hurtAt = now;
  }

  /** Lvが上がった：画面の中央に短く出す。同じ刻みに2つ出すときは row をずらして重ならないようにする。 */
  levelUp(label: string, color = "#ffd166", row = 0): void {
    const t = this.scene.add
      .text(W / 2, 112 + row * 20, label, {
        fontFamily: FONT,
        fontSize: "14px",
        color,
        stroke: "#0e0d12",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH + 2);
    this.scene.tweens.add({
      targets: t,
      y: t.y - 14,
      alpha: { from: 1, to: 0 },
      delay: 700,
      duration: 900,
      onComplete: () => {
        t.destroy();
      },
    });
  }

  /** 開発用の確認：今の配置と、主な部品の表示（pnpm e2e が見る）。 */
  snapshot(): {
    mode: "full" | "strip";
    layout: HudLayoutKind;
    regionVisible: boolean;
    skillKeysVisible: number;
    vitalLabelY: number;
    vitalLabelsVisible: number;
  } {
    return {
      mode: this.mode,
      layout: this.layout,
      regionVisible: this.region.visible,
      skillKeysVisible: this.slotKeys.filter((t) => t.visible).length,
      vitalLabelY: this.vitalLabels[0]?.y ?? 0,
      vitalLabelsVisible: this.vitalLabels.filter((t) => t.visible).length,
    };
  }

  render(m: HudModel, o: HudRenderOptions): void {
    const dt = Math.max(0, o.now - this.lastNow) / 1000;
    this.lastNow = o.now;
    const g = this.g.clear();
    this.layout = o.layout ?? "pc";
    const place = HUD_PLACES[this.layout];
    this.renderEdge(m, o.now);
    this.save.setPosition(place.save.x, place.save.y);
    this.renderSave(m.saveStatus, o.now);
    const full = !o.panelOpen;
    this.mode = full ? "full" : "strip";
    // 画面を開いている間：HPなどの棒だけを、画面の下の帯（画面の外）に横に並べる
    if (o.panelOpen) this.renderVitalsStrip(g, m, o.now);
    else this.renderVitals(g, m, o.now, place.vitalsTop);
    this.setVisible(full);
    if (!full) return;
    this.renderTop(g, m);
    this.renderBoss(g, m, dt);
    if (place.skills) this.renderSkills(g, m.skills, m.flasks);
    else this.hideSkills();
    const chipsTop = this.renderEffects(g, m.effects, place.chips);
    this.prompt
      .setText(m.prompt ?? "")
      .setVisible(m.prompt !== undefined && !o.bigMap)
      .setY(place.prompt === "aboveChips" ? chipsTop - 3 : place.prompt);
  }

  /** 下中央の技の枠の文字を隠す（タッチの表示。技のボタンが代わり）。 */
  private hideSkills(): void {
    for (const list of [
      this.slotKeys,
      this.slotNames,
      this.slotCds,
      this.flaskKeys,
      this.flaskCounts,
    ])
      for (const t of list) t.setVisible(false);
  }

  /** 全体の表示を切り替える（画面を開いている間の、下の帯の棒は別）。 */
  private setVisible(full: boolean): void {
    // 全体を出すときは、各 render* がそれぞれ表示を決める
    if (full) return;
    for (const t of this.fixedTexts) t.setVisible(false);
    for (const t of this.chips) t.setVisible(false);
  }

  private renderEdge(m: HudModel, now: number): void {
    const e = this.edge.clear();
    const hurt = Math.max(0, 1 - (now - this.hurtAt) / HURT_MS);
    // HPが少ない間は、ゆっくり脈打つ薄い縁
    const low = m.lowHp ? 0.18 + 0.12 * Math.sin(now / 160) : 0;
    const a = Math.max(hurt * 0.75, low);
    if (a <= 0.01) return;
    for (let i = 0; i < 6; i++) {
      e.lineStyle(2, 0xff2b2b, a * (1 - i / 6)).strokeRect(
        1 + i * 2,
        1 + i * 2,
        W - 2 - i * 4,
        H - 2 - i * 4,
      );
    }
  }

  private renderSave(status: string, now: number): void {
    if (status !== this.lastSave) {
      this.lastSave = status;
      this.saveShownAt = now;
      this.save.setText(status);
    }
    const age = now - this.saveShownAt;
    const alpha =
      status === ""
        ? 0
        : age < SAVE_SHOW_MS
          ? 1
          : Math.max(0, 1 - (age - SAVE_SHOW_MS) / SAVE_FADE_MS);
    this.save.setAlpha(alpha).setVisible(alpha > 0);
  }

  /** 1本の棒（背景・中身・縁）。 */
  private bar(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    w: number,
    h: number,
    ratio: number,
    color: number,
  ): void {
    g.fillStyle(COLOR.barEdge, 0.9)
      .fillRect(x - 1, y - 1, w + 2, h + 2)
      .fillStyle(COLOR.barBack, 1)
      .fillRect(x, y, w, h)
      .fillStyle(color, 1)
      .fillRect(x, y, Math.round(w * ratio), h);
    // 上の1ピクセルを明るくして、立体に見せる
    if (h >= 4 && ratio > 0) g.fillStyle(0xffffff, 0.18).fillRect(x, y, Math.round(w * ratio), 1);
  }

  private vitalColor(v: HudVital, m: HudModel, now: number): number {
    switch (v.id) {
      case "hp":
        // HPが少ない間は点滅させる
        return m.lowHp && Math.floor(now / 250) % 2 === 0 ? COLOR.hpLow : COLOR.hp;
      case "mp":
        return COLOR.mp;
      case "stamina":
        return COLOR.stamina;
      case "gauge":
        return m.vitals.gauge.stageId === undefined ? COLOR.gauge : COLOR.gaugeStage;
    }
  }

  /**
   * 職能ゲージの刻み。段階のしきい値は白い刻み、個数で数えるゲージ（pips）は暗い区切り。
   * stub が true なら、段階の刻みは棒の外（上下に2ピクセル）にだけ描く：数値の文字を棒の上に重ねる帯で、文字と重ならないように。
   */
  private gaugeTicks(
    g: Phaser.GameObjects.Graphics,
    gauge: HudGauge,
    x: number,
    y: number,
    w: number,
    h: number,
    stub = false,
  ): void {
    for (const s of gauge.stages) {
      if (s.ratio <= 0 || s.ratio >= 1) continue;
      const tx = x + Math.round(w * s.ratio);
      g.fillStyle(0xffffff, gauge.value >= s.min ? 0.9 : 0.5);
      if (stub) g.fillRect(tx, y - 2, 1, 2).fillRect(tx, y + h, 1, 2);
      else g.fillRect(tx, y - 1, 1, h + 2);
    }
    const pips = gauge.pips;
    if (pips !== undefined)
      for (let i = 1; i < pips; i++)
        g.fillStyle(COLOR.barEdge, 0.9).fillRect(x + Math.round((w * i) / pips), y, 1, h);
  }

  private vitalText(v: HudVital): string {
    if (v.id !== "gauge") return v.text;
    // 段階に入っている間は、量と段階の名前（最大は刻みで分かるので省く。棒の右に収めるため）
    const gauge = v as HudGauge;
    return gauge.stageLabel === undefined ? v.text : `${v.valueText} ${gauge.stageLabel}`;
  }

  private vitalList(m: HudModel): readonly HudVital[] {
    return [m.vitals.hp, m.vitals.mp, m.vitals.stamina, m.vitals.gauge];
  }

  /** 左下（タッチの表示では左上）：HP・MP・気力・職能ゲージ。top は1本目の上端。 */
  private renderVitals(
    g: Phaser.GameObjects.Graphics,
    m: HudModel,
    now: number,
    top: number,
  ): void {
    const L = HUD_LAYOUT.vitals;
    // 読みやすいように、薄い下敷き
    g.fillStyle(COLOR.panel, 0.55).fillRect(
      L.x - 4,
      top - 3,
      L.barX + L.barWidth - L.x + 54,
      L.rows * L.row + 4,
    );
    this.vitalList(m).forEach((v, i) => {
      const y = top + i * L.row;
      this.bar(g, L.barX, y, L.barWidth, L.barHeight, v.ratio, this.vitalColor(v, m, now));
      if (v.id === "gauge") this.gaugeTicks(g, m.vitals.gauge, L.barX, y, L.barWidth, L.barHeight);
      this.vitalLabels[i]
        ?.setText(v.label)
        .setPosition(L.labelRight, y - 1)
        .setVisible(true);
      const value = this.vitalValues[i];
      value
        ?.setText(this.vitalText(v))
        .setOrigin(0, 0)
        .setPosition(L.barX + L.barWidth + 4, y - 1)
        .setVisible(true);
      if (value !== undefined)
        setTextColor(value, v.id === "hp" && m.lowHp ? "#ff8a8a" : "#e8e6f0");
    });
  }

  /** 画面を開いている間：画面の下（深さ1000の画面の外）の帯に、棒を横に並べる。 */
  private renderVitalsStrip(g: Phaser.GameObjects.Graphics, m: HudModel, now: number): void {
    const y = H - 18;
    const cell = (W - 16) / 4;
    this.vitalList(m).forEach((v, i) => {
      const x0 = 8 + i * cell;
      const label = this.vitalLabels[i];
      label?.setText(v.label);
      const lw = label === undefined ? 20 : label.width;
      label?.setPosition(x0 + lw, y - 1).setVisible(true);
      const bx = x0 + lw + 3;
      const bw = Math.round(cell - lw - 12);
      this.bar(g, bx, y, bw, 8, v.ratio, this.vitalColor(v, m, now));
      if (v.id === "gauge") this.gaugeTicks(g, m.vitals.gauge, bx, y, bw, 8, true);
      const value = this.vitalValues[i];
      if (value === undefined) return;
      setTextColor(value.setText(this.vitalText(v)).setOrigin(0.5, 0), "#ffffff")
        .setPosition(bx + bw / 2, y - 1)
        .setVisible(true);
    });
  }

  /** 左上：地域・Lv・ジョブ。上中央：試し打ちの場の案内。 */
  private renderTop(g: Phaser.GameObjects.Graphics, m: HudModel): void {
    const x = HUD_LAYOUT.top.x;
    const barX = 74;
    const barW = 80;
    this.region.setText(m.regionName).setVisible(true);
    this.lv
      .setText(fill(text("hud.lv"), { n: m.level.level }))
      .setPosition(x, 19)
      .setVisible(true);
    this.bar(g, barX, 23, barW, 3, m.level.xpRatio, COLOR.xp);
    this.jobLv
      .setText(fill(text("hud.jobLv"), { job: m.level.jobName, n: m.level.jobLevel }))
      .setPosition(x, 29)
      .setVisible(true);
    this.bar(g, barX, 33, barW, 3, m.level.jobXpRatio, COLOR.jobXp);
    this.catchUp.setText(text("hud.catchUp")).setPosition(x, 39).setVisible(m.level.catchingUp);
    this.trial
      .setText(text("hud.trial"))
      .setPosition(W / 2, m.boss === undefined ? HUD_LAYOUT.boss.y : 36)
      .setVisible(m.inTrial);
  }

  /** 上中央：ボスのHP（名前・Lv・段階・崩しゲージ）。 */
  private renderBoss(g: Phaser.GameObjects.Graphics, m: HudModel, dt: number): void {
    const b = m.boss;
    if (b === undefined) {
      this.bossTrail = 1;
      for (const t of [this.bossName, this.bossStage, this.bossHp]) t.setVisible(false);
      return;
    }
    const w = HUD_LAYOUT.boss.width;
    const x = Math.round(W / 2 - w / 2);
    const y = HUD_LAYOUT.boss.y;
    // 遅れて減る部分：毎秒、最大HPの40%ずつ追いつく
    this.bossTrail =
      b.hpRatio > this.bossTrail ? b.hpRatio : Math.max(b.hpRatio, this.bossTrail - 0.4 * dt);
    g.fillStyle(COLOR.panel, 0.6).fillRect(x - 4, y - 2, w + 8, 33);
    this.bossName
      .setText(`${b.name}　${fill(text("hud.lv"), { n: b.level })}`)
      .setPosition(x, y)
      .setVisible(true);
    this.bossStage
      .setText(b.broken ? `${b.stageLabel}・${text("hud.boss.broken")}` : b.stageLabel)
      .setPosition(x + w, y + 1)
      .setVisible(true);
    const by = y + 13;
    const bh = 9;
    g.fillStyle(COLOR.barEdge, 1)
      .fillRect(x - 1, by - 1, w + 2, bh + 2)
      .fillStyle(COLOR.barBack, 1)
      .fillRect(x, by, w, bh)
      .fillStyle(COLOR.bossTrail, 0.8)
      .fillRect(x, by, Math.round(w * this.bossTrail), bh)
      .fillStyle(b.shielded ? COLOR.bossShield : COLOR.boss, 1)
      .fillRect(x, by, Math.round(w * b.hpRatio), bh)
      .fillStyle(0xffffff, 0.2)
      .fillRect(x, by, Math.round(w * b.hpRatio), 1);
    // 段階が変わるHPの刻み
    for (const t of b.thresholds)
      g.fillStyle(0xffffff, 0.7).fillRect(x + Math.round(w * t), by - 2, 1, bh + 4);
    this.bossHp
      .setText(
        `${Math.ceil(b.hp).toLocaleString("ja-JP")}／${Math.round(b.maxHp).toLocaleString("ja-JP")}`,
      )
      .setPosition(x + w / 2, by - 1)
      .setVisible(true);
    // 崩しゲージ（崩れている間は満タンで点滅）
    const blink = b.broken && Math.floor(this.lastNow / 150) % 2 === 0;
    this.bar(g, x, by + bh + 4, w, 3, b.staggerRatio, blink ? 0xffffff : COLOR.stagger);
  }

  /** 下中央：技の枠6つと薬瓶2つ。 */
  private renderSkills(
    g: Phaser.GameObjects.Graphics,
    skills: readonly HudSkillSlot[],
    flasks: readonly HudFlask[],
  ): void {
    const S = HUD_LAYOUT.skills;
    const x0 = skillBarX();
    const y = SKILL_Y;
    skills.forEach((s, i) => {
      const x = x0 + i * (S.box + S.gap);
      const h = S.height;
      const w = S.box;
      g.fillStyle(COLOR.panel, 0.85).fillRect(x, y, w, h);
      const tint = SLOT_TINT[s.state];
      if (tint !== undefined)
        g.fillStyle(tint, s.state === "locked" ? 0.55 : 0.45).fillRect(x, y, w, h);
      if (s.onCooldown) {
        // CDの覆い：上の辺が下へ下がっていく（残りの割合の高さ）。総時間が分からなければ全体を覆う
        const r = s.cooldownRatio ?? 1;
        const ch = Math.round(h * r);
        g.fillStyle(0x000000, 0.6).fillRect(x, y + h - ch, w, ch);
      }
      if (s.state === "locked") this.lockIcon(g, x + w - 8, y + 3);
      // 使えない理由（MP不足など）が別にあっても、CD中なら覆いと残り秒は出る（枠の色は理由の色）
      const border = s.executing ? 0xffffff : SLOT_BORDER[s.state];
      g.lineStyle(1, border, 1).strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      if (s.state === "ready" || s.executing)
        g.fillStyle(0xffffff, 0.08).fillRect(x + 1, y + 1, w - 2, 1);
      const dim = s.state === "locked" || s.state === "empty";
      this.slotKeys[i]
        ?.setText(s.keyLabel)
        .setPosition(x + 2, y)
        .setAlpha(dim ? 0.5 : 1)
        .setVisible(true);
      const name = this.slotNames[i];
      if (name !== undefined)
        setTextColor(
          name.setText(s.shortName),
          s.state === "mp" ? "#9cc4ff" : s.state === "gauge" ? "#ffc489" : "#e8e6f0",
        )
          .setPosition(x + w / 2, y + h - 1)
          .setAlpha(s.state === "ready" || s.state === "cooldown" ? 1 : 0.6)
          .setVisible(true);
      this.slotCds[i]
        ?.setText(s.onCooldown ? secondsText(s.cooldownRemaining) : "")
        .setPosition(x + w / 2, y + h / 2 + 1)
        .setVisible(s.onCooldown);
    });
    // 薬瓶（Q：HP・E：MP。残りの回数）
    const fx0 = x0 + 6 * (S.box + S.gap) - S.gap + S.flaskGap;
    flasks.forEach((f, i) => {
      const x = fx0 + i * (S.flask + S.gap);
      const w = S.flask;
      const h = S.height;
      const empty = f.charges <= 0;
      g.fillStyle(COLOR.panel, 0.85).fillRect(x, y, w, h);
      g.lineStyle(1, empty ? 0x3a3846 : 0x8c88a0, 1).strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      // 瓶の形（首と胴）
      const color = f.id === "hp" ? COLOR.hp : COLOR.mp;
      const cx = x + Math.round(w / 2);
      g.fillStyle(0xc9c6d6, empty ? 0.3 : 0.8).fillRect(cx - 2, y + 9, 4, 3);
      g.fillStyle(color, empty ? 0.25 : 1).fillRect(cx - 5, y + 12, 10, 9);
      g.fillStyle(0xffffff, empty ? 0.05 : 0.3).fillRect(cx - 4, y + 13, 2, 4);
      this.flaskKeys[i]
        ?.setText(f.keyLabel)
        .setPosition(x + 2, y)
        .setVisible(true);
      // 回数は枠の中の右下（枠の下の線に重ならないよう、線の1ピクセル内側に収める）
      const count = this.flaskCounts[i];
      if (count !== undefined)
        setTextColor(count.setText(String(f.charges)), empty ? "#ff6b6b" : "#ffffff")
          .setPosition(x + w - 2, y + h - 2)
          .setVisible(true);
    });
  }

  /** 鍵の印（未習得の技）。 */
  private lockIcon(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
    g.lineStyle(1, 0xc9c6d6, 0.9).strokeRect(x + 1.5, y + 0.5, 3, 3);
    g.fillStyle(0xc9c6d6, 0.9).fillRect(x, y + 3, 6, 4);
  }

  /** 技の枠の上（タッチの表示では左上の棒の下）：効果・状態異常の札。返り値は札の上端（その上に案内を置く）。 */
  private renderEffects(
    g: Phaser.GameObjects.Graphics,
    effects: readonly HudEffect[],
    place: (typeof HUD_PLACES)[HudLayoutKind]["chips"],
  ): number {
    const C = HUD_LAYOUT.chips;
    const y = place === "aboveSkills" ? SKILL_Y - 3 - C.height : place.y;
    const xMax = place === "aboveSkills" ? MINIMAP.x - 6 : place.maxX;
    let x = place === "aboveSkills" ? skillBarX() : place.x;
    let shown = 0;
    effects.forEach((e, i) => {
      const t = this.chip(i);
      const style = EFFECT_STYLE[e.kind];
      const label = `${e.label}${e.stacks > 1 ? ` ${String(e.stacks)}` : ""}${
        e.remaining === undefined
          ? ""
          : ` ${fill(text("hud.skill.cooldown"), { s: Math.ceil(e.remaining - 1e-6) })}`
      }`;
      setTextColor(t.setText(label), style.color);
      const w = Math.ceil(t.width) + 6;
      if (x + w > xMax) {
        t.setVisible(false);
        return;
      }
      g.fillStyle(COLOR.panel, 0.85).fillRect(x, y, w, C.height);
      g.lineStyle(1, style.border, 0.9).strokeRect(x + 0.5, y + 0.5, w - 1, C.height - 1);
      t.setPosition(x + 3, y).setVisible(true);
      x += w + C.gap;
      shown += 1;
    });
    for (let i = effects.length; i < this.chips.length; i++) this.chips[i]?.setVisible(false);
    return shown > 0 ? y : SKILL_Y;
  }

  private chip(i: number): Phaser.GameObjects.Text {
    let t = this.chips[i];
    if (t === undefined) {
      t = this.scene.add
        .text(0, 0, "", { fontFamily: FONT, fontSize: "8px", color: "#e8e6f0" })
        .setScrollFactor(0)
        .setDepth(HUD_DEPTH + 1);
      this.chips[i] = t;
    }
    return t;
  }
}
