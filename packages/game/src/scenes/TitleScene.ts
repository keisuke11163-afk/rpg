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
import { newCharacterProfile, testStartProfile } from "./arena-simulation.ts";
import { type ArenaSceneData, TOWN_REGION } from "./ArenaScene.ts";

/** 新しいキャラクターの出自（MVP：戦士・盗賊）。 */
const ORIGINS = ["JOB-WARRIOR", "JOB-ROGUE"] as const;

/** 選んだスロットで、どう始めるか。 */
export type SlotStart = "continue" | "backup" | "new-JOB-WARRIOR" | "new-JOB-ROGUE" | "dev";

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
  private texts: Phaser.GameObjects.Text[] = [];
  private selected: number | undefined;

  constructor() {
    super("title");
  }

  create(): void {
    this.db = loadGameContent();
    this.store = new SaveStore(this.db, new LocalStorageBackend());
    this.selected = undefined;
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
    const t = this.add
      .text(x, y, label, { fontFamily: "sans-serif", fontSize: "11px", color })
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", run);
    this.texts.push(t);
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
    for (const o of ORIGINS) {
      const job = this.db.jobs.get(o);
      opt(
        `新しく作る：出自 ${job === undefined ? o : text(job.text as TextKey)}${sel.state === "ok" ? "（今のデータを上書きする）" : ""}`,
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
        how === "continue" ? `スロット${String(slot)}から読み込んだ` : "1つ前の保存から再開した";
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
