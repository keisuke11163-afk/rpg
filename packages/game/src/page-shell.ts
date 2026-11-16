/**
 * ページ側の後始末（docs/progress TOUCH-4）：スマホ（タッチ）の端末での、長押しのメニュー・拡大の抑止と、
 * 横向き専用の「端末を横向きにしてください」の画面（縦持ちの間はゲームを止め、音も止める）。
 * PC（タッチでない端末）では何もしない（今と同じ画面・挙動）。
 */
import type Phaser from "phaser";
import { text } from "@stella/content";
import { sfx } from "./audio/sfx.ts";
import { shouldBlockPortrait } from "./input/touch-controls.ts";

/**
 * 主な入力がタッチの端末か（スマホ・タブレット）。粗いポインター（指）が主、または触れられてホバーが無い。
 * マウスもあるタブレットは、ここが false でも、触れればタッチの表示に切り替わる（TouchModeSwitch）。
 */
export function isTouchPrimaryDevice(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const noHover = window.matchMedia("(hover: none)").matches;
  return coarse || (navigator.maxTouchPoints > 0 && noHover);
}

/** 縦持ちで止めているか（開発用の確認）。 */
let pausedForPortrait = false;
export function portraitPaused(): boolean {
  return pausedForPortrait;
}

/** ページ側の後始末を付ける（main.ts から1回だけ）。 */
export function installPageShell(game: Phaser.Game): void {
  const touch = isTouchPrimaryDevice();
  if (!touch) return;
  // 長押しのメニュー（画像の保存など）・iOS のピンチの拡大を出さない（ゲームの画面の上だけでなく、ページ全体）
  document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
  });
  document.addEventListener(
    "gesturestart",
    (e) => {
      e.preventDefault();
    },
    { passive: false },
  );
  const overlay = createPortraitOverlay();
  const update = (): void => {
    const block = shouldBlockPortrait(true, window.innerWidth, window.innerHeight);
    if (block === pausedForPortrait) return;
    pausedForPortrait = block;
    overlay.style.display = block ? "flex" : "none";
    if (block) {
      // ゲームを止める（描画の繰り返しを止めるので、シミュレーションも進まない）。押していた指は離す
      window.dispatchEvent(new Event("stella-pause"));
      game.loop.sleep();
      sfx.setPaused(true);
    } else {
      sfx.setPaused(false);
      game.loop.wake();
      window.dispatchEvent(new Event("stella-pause"));
    }
  };
  // 起動の途中（描画の繰り返しが始まる前）に縦持ちだったときも、始まった最初のフレームで止める
  game.events.on("prestep", () => {
    if (pausedForPortrait && game.loop.running) game.loop.sleep();
  });
  window.addEventListener("resize", update);
  window.addEventListener("orientationchange", update);
  update();
}

/** 「端末を横向きにしてください」の画面（DOM。ゲームの上に重ねる。触れてもゲームに届かない）。 */
function createPortraitOverlay(): HTMLDivElement {
  const el = document.createElement("div");
  el.id = "stella-portrait";
  Object.assign(el.style, {
    position: "fixed",
    inset: "0",
    zIndex: "100",
    display: "none",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "16px",
    padding: "24px",
    boxSizing: "border-box",
    background: "#101014",
    color: "#e8e6f0",
    fontFamily: "sans-serif",
    textAlign: "center",
  });
  // 端末の形（縦の長方形が横に倒れる絵。CSS の図形だけ）
  const phone = document.createElement("div");
  Object.assign(phone.style, {
    width: "44px",
    height: "72px",
    border: "3px solid #c3a6ff",
    borderRadius: "8px",
    transform: "rotate(-90deg)",
    margin: "12px",
  });
  const title = document.createElement("div");
  title.textContent = text("touch.portrait");
  Object.assign(title.style, { fontSize: "20px", fontWeight: "bold" });
  const sub = document.createElement("div");
  sub.textContent = text("touch.portrait.sub");
  Object.assign(sub.style, { fontSize: "13px", color: "#9a96a8" });
  el.append(phone, title, sub);
  // 触れてもゲーム（Phaser は window でも指の出来事を受け取る）に届かないよう、ここで止める
  for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"])
    el.addEventListener(
      type,
      (e) => {
        e.preventDefault();
        e.stopPropagation();
      },
      { passive: false },
    );
  document.body.appendChild(el);
  return el;
}
