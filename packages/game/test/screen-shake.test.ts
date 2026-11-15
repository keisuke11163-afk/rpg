/** 画面の揺れ（ui/screen-shake.ts。Phaser に依存しない純粋な関数・クラス）。 */
import { describe, expect, it } from "vitest";
import { NO_SHAKE, ScreenShake, shakeWithinBounds } from "../src/ui/screen-shake.ts";

/** 乱数の固定値（0 → −大きさ側、0.999 → ＋大きさ側）。 */
const low = (): number => 0;
const high = (): number => 0.999;
const mid = (): number => 0.5;

/** 同じ種から同じ列を出す乱数（決定的な確認用）。 */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

describe("ScreenShake の基本", () => {
  it("最初は揺れていなくて、update は {0, 0} を返す", () => {
    const shake = new ScreenShake(low);
    expect(shake.active).toBe(false);
    expect(shake.amplitude).toBe(0);
    expect(shake.update(16)).toEqual({ x: 0, y: 0 });
    expect(NO_SHAKE).toEqual({ x: 0, y: 0 });
  });

  it("trigger の後は揺れていて、update の x・y は −大きさ〜＋大きさ の範囲", () => {
    const shake = new ScreenShake(low);
    shake.trigger(3, 100);
    expect(shake.active).toBe(true);
    expect(shake.update(0)).toEqual({ x: -3, y: -3 });

    const up = new ScreenShake(high);
    up.trigger(3, 100);
    const o = up.update(0);
    expect(o.x).toBeCloseTo(3 * 0.998, 10);
    expect(o.y).toBeCloseTo(3 * 0.998, 10);

    const zero = new ScreenShake(mid);
    zero.trigger(3, 100);
    expect(zero.update(0)).toEqual({ x: 0, y: 0 });
  });

  it("乱数の値に関わらず、x・y は必ず −大きさ〜＋大きさ の中に入る", () => {
    const rnd = seeded(7);
    const shake = new ScreenShake(rnd);
    shake.trigger(4, 1000);
    for (let i = 0; i < 200; i++) {
      const o = shake.update(1);
      expect(Math.abs(o.x)).toBeLessThanOrEqual(4);
      expect(Math.abs(o.y)).toBeLessThanOrEqual(4);
    }
  });

  it("ずれは整数のピクセルに丸めない（実装の現状を固定。表示の側で丸めるかは仕様確認）", () => {
    const shake = new ScreenShake(high);
    shake.trigger(3, 100);
    const o = shake.update(0);
    expect(Number.isInteger(o.x)).toBe(false);
  });

  it("大きさは時間とともに直線で0まで減る（50ms で約半分）", () => {
    const shake = new ScreenShake(low);
    shake.trigger(10, 100);
    shake.update(50);
    expect(shake.amplitude).toBeCloseTo(5, 10);
    expect(shake.update(0)).toEqual({ x: -5, y: -5 });
    shake.update(25);
    expect(shake.amplitude).toBeCloseTo(2.5, 10);
  });

  it("経過がちょうど時間に達したら {0, 0} で止まる。超えても {0, 0}", () => {
    const shake = new ScreenShake(low);
    shake.trigger(3, 100);
    shake.update(99.9);
    expect(shake.active).toBe(true);
    expect(shake.update(0.1)).toEqual({ x: 0, y: 0 });
    expect(shake.active).toBe(false);
    expect(shake.amplitude).toBe(0);
    expect(shake.update(200)).toEqual({ x: 0, y: 0 });
  });

  it("強さ・時間が 0・負・NaN・Infinity の trigger は何もしない", () => {
    const bad: [number, number][] = [
      [0, 100],
      [-1, 100],
      [Number.NaN, 100],
      [Number.POSITIVE_INFINITY, 100],
      [3, 0],
      [3, -10],
      [3, Number.NaN],
      [3, Number.POSITIVE_INFINITY],
    ];
    for (const [strength, ms] of bad) {
      const shake = new ScreenShake(low);
      shake.trigger(strength, ms);
      expect(shake.active).toBe(false);
      expect(shake.update(0)).toEqual({ x: 0, y: 0 });
    }
  });

  it("update に負・NaN・Infinity の deltaMs を渡すと 0 として扱う（例外も NaN も出さない）", () => {
    const shake = new ScreenShake(low);
    shake.trigger(10, 100);
    expect(shake.update(-50)).toEqual({ x: -10, y: -10 });
    expect(shake.update(Number.NaN)).toEqual({ x: -10, y: -10 });
    expect(shake.update(Number.POSITIVE_INFINITY)).toEqual({ x: -10, y: -10 });
    expect(shake.amplitude).toBe(10);
    expect(shake.active).toBe(true);
  });

  it("reset() で止まり、止まった後は弱い揺れも始められる", () => {
    const shake = new ScreenShake(low);
    shake.trigger(10, 100);
    shake.update(10);
    shake.reset();
    expect(shake.active).toBe(false);
    expect(shake.amplitude).toBe(0);
    expect(shake.update(0)).toEqual({ x: 0, y: 0 });
    shake.trigger(1, 100);
    expect(shake.amplitude).toBe(1);
  });

  it("同じ乱数の列なら、同じ揺れになる（決定的）", () => {
    const a = new ScreenShake(seeded(42));
    const b = new ScreenShake(seeded(42));
    a.trigger(6, 300);
    b.trigger(6, 300);
    for (let i = 0; i < 20; i++) {
      expect(a.update(7)).toEqual(b.update(7));
    }
  });
});

describe("ScreenShake の置き換え", () => {
  it("揺れている途中で、今の（減った後の）大きさより弱い trigger は無視する", () => {
    const shake = new ScreenShake(low);
    shake.trigger(10, 100);
    shake.update(50); // 今の大きさ 5
    shake.trigger(3, 100);
    expect(shake.amplitude).toBeCloseTo(5, 10);
    shake.update(0);
    expect(shake.amplitude).toBeCloseTo(5, 10);
  });

  it("今の大きさと同じ強さの trigger は、新しい揺れに置き換えてやり直す", () => {
    const shake = new ScreenShake(low);
    shake.trigger(10, 100);
    shake.update(50); // 今の大きさ 5
    shake.trigger(5, 100);
    expect(shake.amplitude).toBe(5);
    shake.update(50);
    expect(shake.amplitude).toBeCloseTo(2.5, 10);
  });

  it("今より強い trigger は、強さと時間を新しいものにして置き換える", () => {
    const shake = new ScreenShake(low);
    shake.trigger(10, 100);
    shake.update(50); // 今の大きさ 5
    shake.trigger(8, 200);
    expect(shake.amplitude).toBe(8);
    shake.update(100); // 新しい時間 200ms の半分
    expect(shake.amplitude).toBeCloseTo(4, 10);
  });

  it("揺れ終わった後の trigger は、どの強さでも始まる", () => {
    const shake = new ScreenShake(low);
    shake.trigger(10, 100);
    shake.update(100);
    expect(shake.active).toBe(false);
    shake.trigger(1, 100);
    expect(shake.active).toBe(true);
    expect(shake.amplitude).toBe(1);
  });
});

describe("shakeWithinBounds", () => {
  it("offset が 0 なら base をそのまま返す", () => {
    expect(shakeWithinBounds(5, 0, 0, 10)).toBe(5);
    expect(shakeWithinBounds(0, 0, 0, 10)).toBe(0);
    expect(shakeWithinBounds(10, 0, 0, 10)).toBe(10);
  });

  it("範囲の中なら base + offset を返す（正・負とも）", () => {
    expect(shakeWithinBounds(5, 2, 0, 10)).toBe(7);
    expect(shakeWithinBounds(5, -2, 0, 10)).toBe(3);
  });

  it("端（max）で削られるときは、反対の向きに揺らす", () => {
    // base=9, +3 → 10 で止まる。反対の 9−3=6 の方が動ける量が多い
    expect(shakeWithinBounds(9, 3, 0, 10)).toBe(6);
    // base=max で正の向き → 反対（max−4）
    expect(shakeWithinBounds(10, 4, 0, 10)).toBe(6);
  });

  it("端（min）で削られるときは、反対の向きに揺らす", () => {
    expect(shakeWithinBounds(0, -4, 0, 10)).toBe(4);
    expect(shakeWithinBounds(1, -3, 0, 10)).toBe(4);
  });

  it("min=max（動けない）なら base を返す。max<min でも base を返す", () => {
    expect(shakeWithinBounds(5, 3, 5, 5)).toBe(5);
    expect(shakeWithinBounds(5, 3, 10, 0)).toBe(5);
    expect(shakeWithinBounds(5, -3, 10, 0)).toBe(5);
  });

  it("有限の入力では NaN を返さず、結果は（base が範囲内なら）範囲の中に入る", () => {
    const values = [-20, -5, -1, 0, 0.5, 3, 9.5, 10, 14];
    for (const base of [0, 4, 10])
      for (const offset of values)
        for (const [min, max] of [
          [0, 10],
          [0, 0],
          [-3, 3],
        ] as const) {
          const r = shakeWithinBounds(base, offset, min, max);
          expect(Number.isNaN(r)).toBe(false);
          if (base >= min && base <= max) {
            expect(r).toBeGreaterThanOrEqual(min);
            expect(r).toBeLessThanOrEqual(max);
          }
        }
  });
});
