import Phaser from "phaser";
import {
  type ContentDb,
  type PlayerProfile,
  SAVE_SLOTS,
  SaveStore,
  type SlotSummary,
  toSaveData,
} from "@stella/core";
import { loadGameContent, text, type TextKey } from "@stella/content";
import { SCREEN } from "../config.ts";
import { exposeDebug } from "../debug.ts";
import { LocalStorageBackend } from "../save/LocalStorageBackend.ts";
import { fill } from "../ui/hud-model.ts";
import { newCharacterProfile, testStartProfile } from "./arena-simulation.ts";
import { type ArenaSceneData, TOWN_REGION } from "./ArenaScene.ts";

/** 選んだスロットで、どう始めるか。 */
/** new-<ジョブのID>：そのジョブを出自にして新しく作る（出自にできるのは、データに初期能力値があるジョブ）。 */
export type SlotStart = "continue" | "backup" | `new-${string}` | "dev";

/**
 * タイトル：キャラクターの選択・作成（補助仕様書15・16章：3スロット）。
 * - 正しいセーブデータ：続きから（町から再開する。補助仕様書15章）
 * - 空き：出自（戦士・盗賊）を選んで新しく作る
 * - 壊れたデータ：1つ前の保存（.bak）から再開するか、新しく作る（壊れたデータは、保存するときに .corrupt に残す）
 * - 開発版だけ：試験用の初期の状態（キャラLv15・試験用の武器一式）で始める
 */
export class TitleScene extends Phaser.Scene {
  private db!: ContentDb;
  private store!: SaveStore;
  /** 描き直すときに消すもの（文字・ホバーの下敷き）。 */
  private texts: Phaser.GameObjects.GameObject[] = [];
  private selected: number | undefined;

  constructor() {
    super("title");
  }

  create(): void {
    this.db = loadGameContent();
    this.store = new SaveStore(this.db, new LocalStorageBackend());
    this.selected = undefined;
    this.decorate();
    this.draw();
    exposeDebug({
      title: () => ({
        slots: this.store.list().map((s) => ({ slot: s.slot, state: s.state })),
        selected: this.selected ?? null,
      }),
      startSlot: (slot?: number | string, how?: number | string) =>
        this.start(Number(slot), String(how) as SlotStart),
    });
    document.body.dataset["stellaReady"] = "true";
    document.body.dataset["stellaScene"] = "title";
  }

  private button(x: number, y: number, label: string, color: string, run: () => void): void {
    const t = this.add.text(x, y, label, { fontFamily: "sans-serif", fontSize: "11px", color });
    // ホバー：行の下に薄い帯を出し、文字を明るくする（クリックする位置・行の並びは変えない）
    const glow = this.add
      .rectangle(x - 6, y - 2, Math.max(260, t.width + 16), t.height + 4, 0xc3a6ff, 0.12)
      .setOrigin(0, 0)
      .setVisible(false);
    const edge = this.add
      .rectangle(x - 6, y - 2, 2, t.height + 4, 0xc3a6ff, 0.9)
      .setOrigin(0, 0)
      .setVisible(false);
    const hover = (on: boolean): void => {
      glow.setVisible(on);
      edge.setVisible(on);
      t.setColor(on ? "#ffffff" : color);
    };
    t.setDepth(1)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", run)
      .on("pointerover", () => {
        hover(true);
      })
      .on("pointerout", () => {
        hover(false);
      });
    this.texts.push(glow, edge, t);
    // 描き直した（スロットを選んだ）直後、ポインターがこの行の上に乗ったままなら、動かさなくてもホバーの帯を出す
    // （Phaser は、ポインターが動くまで pointerover を出さないため）
    const p = this.input.activePointer;
    if (t.getBounds().contains(p.x, p.y)) {
      hover(true);
      // Phaser はこの行を「乗った」と数えていないので、離れても pointerout が出ない。次に動いたとき、外れていれば自分で戻す
      this.input.once("pointermove", (q: Phaser.Input.Pointer) => {
        if (t.active && !t.getBounds().contains(q.x, q.y)) hover(false);
      });
    }
  }

  /** 背景の飾り（題字の下の線と星・薄い星空・下端の一言）。作ったときに1回だけ。 */
  private decorate(): void {
    const cx = SCREEN.width / 2;
    const g = this.add.graphics();
    // 薄い星空（決まった並び。毎回同じ）
    let seed = 7;
    const rand = (): number => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let i = 0; i < 40; i++) {
      const x = Math.floor(rand() * SCREEN.width);
      const y = Math.floor(rand() * SCREEN.height);
      g.fillStyle(0xc3a6ff, 0.08 + rand() * 0.18).fillRect(x, y, 1, 1);
    }
    // 題字の下の飾りの線（中央に小さな星）
    const ly = 58;
    g.fillStyle(0x4a4858, 1)
      .fillRect(cx - 120, ly, 104, 1)
      .fillRect(cx + 16, ly, 104, 1);
    g.fillStyle(0xc3a6ff, 0.5)
      .fillRect(cx - 40, ly, 24, 1)
      .fillRect(cx + 16, ly, 24, 1);
    g.fillStyle(0xffd166, 1).fillTriangle(cx, ly - 4, cx - 4, ly, cx + 4, ly);
    g.fillStyle(0xffd166, 1).fillTriangle(cx, ly + 5, cx - 4, ly + 1, cx + 4, ly + 1);
    // 下端：版と、操作の一言
    const dim = { fontFamily: "sans-serif", fontSize: "8px", color: "#6a6878" } as const;
    this.add.text(8, SCREEN.height - 14, text("game.subtitle"), dim);
    this.add.text(SCREEN.width - 8, SCREEN.height - 14, text("title.hint"), dim).setOrigin(1, 0);
  }

  private label(x: number, y: number, label: string, color = "#9a96a8", size = "11px"): void {
    this.texts.push(
      this.add.text(x, y, label, { fontFamily: "sans-serif", fontSize: size, color }),
    );
  }

  private slotText(s: SlotSummary): string {
    switch (s.state) {
      case "empty":
        return `スロット${String(s.slot)}：空き`;
      case "corrupt":
        return `スロット${String(s.slot)}：セーブデータが壊れている（${s.error.kind}）`;
      case "ok": {
        const job = this.db.jobs.get(s.mainJob);
        return `スロット${String(s.slot)}：${s.name}　Lv${String(s.level)}　${job === undefined ? s.mainJob : text(job.text as TextKey)}`;
      }
    }
  }

  private draw(): void {
    for (const t of this.texts) t.destroy();
    this.texts = [];
    const cx = SCREEN.width / 2;
    this.texts.push(
      this.add
        .text(cx, 40, text("game.title"), {
          fontFamily: "sans-serif",
          fontSize: "22px",
          color: "#e8e6f0",
        })
        .setOrigin(0.5),
    );
    this.label(cx - 150, 80, "キャラクターを選ぶ（クリック）");
    const list = this.store.list();
    list.forEach((s, i) => {
      const y = 100 + i * 22;
      const color = s.state === "ok" ? "#e8e6f0" : s.state === "corrupt" ? "#ff6b6b" : "#9a96a8";
      this.button(
        cx - 150,
        y,
        `${this.selected === s.slot ? "▶ " : ""}${this.slotText(s)}`,
        color,
        () => {
          this.selected = s.slot;
          this.draw();
        },
      );
    });
    const sel = list.find((s) => s.slot === this.selected);
    if (sel === undefined) return;
    let y = 100 + SAVE_SLOTS * 22 + 16;
    const opt = (label: string, how: SlotStart, color = "#7bd389"): void => {
      this.button(cx - 130, y, label, color, () => {
        this.start(sel.slot, how);
      });
      y += 20;
    };
    if (sel.state === "ok") opt("続きから（町から再開する）", "continue");
    if (sel.state === "corrupt" && this.store.loadBackup(sel.slot).ok)
      opt("1つ前の保存から再開する", "backup");
    for (const job of this.db.jobs.values()) {
      if (job.originAttributes === undefined) continue;
      const o = job.id;
      opt(
        `新しく作る：出自 ${text(job.text as TextKey)}${sel.state === "ok" ? "（今のデータを上書きする）" : ""}`,
        `new-${o}`,
        sel.state === "ok" ? "#ffd166" : "#7bd389",
      );
    }
    if (import.meta.env.DEV) opt("開発用：試験用の初期の状態（Lv15）で始める", "dev", "#c3a6ff");
  }

  /** スロットで始める（ArenaScene の町へ）。 */
  start(slot: number, how: SlotStart): boolean {
    if (!(Number.isInteger(slot) && slot >= 1 && slot <= SAVE_SLOTS)) return false;
    let profile: PlayerProfile | undefined;
    let status: string;
    if (how === "continue" || how === "backup") {
      const r = how === "continue" ? this.store.load(slot) : this.store.loadBackup(slot);
      if (!r.ok) return false;
      profile = r.profile;
      status =
        how === "continue" ? fill(text("hud.save.loaded"), { n: slot }) : "1つ前の保存から再開した";
    } else if (how === "dev") {
      profile = testStartProfile(this.db);
      status = "開発用の初期の状態で始めた";
    } else {
      const origin = how.slice("new-".length);
      profile = newCharacterProfile(this.db, origin, "旅人");
      status = "新しいキャラクターで始めた";
    }
    // 新しく作ったら、すぐに保存する（今あるデータは .bak・壊れていれば .corrupt に残る）
    if (how !== "continue" && how !== "backup") this.store.save(slot, toSaveData(this.db, profile));
    document.body.dataset["stellaReady"] = "false";
    this.scene.start("arena", {
      slot,
      region: TOWN_REGION,
      profile,
      status,
    } satisfies ArenaSceneData);
    return true;
  }
}
