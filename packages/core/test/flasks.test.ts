import { describe, expect, it } from "vitest";
import { FLASK_FILL, FLASK_RULES, Flask } from "../src/index.ts";

describe("薬瓶（補助仕様書6章）", () => {
  it("3回まで使え、1.5秒かけて総量を回復する。回復の最中は同じ瓶を使えない", () => {
    const f = new Flask();
    expect(f.charges).toBe(3);
    expect(f.use(120)).toBe(true);
    expect(f.use(120)).toBe(false);
    let total = 0;
    for (let i = 0; i < 90; i++) total += f.update(1 / 60);
    expect(total).toBeCloseTo(120);
    expect(f.active).toBe(false);
    expect(f.update(1)).toBe(0);
    expect(f.use(1)).toBe(true);
    f.update(2);
    expect(f.use(1)).toBe(true);
    f.update(2);
    expect(f.charges).toBe(0);
    expect(f.use(1)).toBe(false);
  });

  it("充填：40たまるごとに1回分戻る。満タンなら充填は捨てる。町では全回復", () => {
    expect(FLASK_FILL).toMatchObject({
      normal: 1,
      magic: 3,
      elite: 10,
      miniBoss: 30,
      chapterBoss: 40,
    });
    const f = new Flask({ charges: 1, fill: 0 });
    f.addFill(FLASK_FILL.elite * 3);
    expect(f.state).toEqual({ charges: 1, fill: 30 });
    f.addFill(FLASK_FILL.elite);
    expect(f.state).toEqual({ charges: 2, fill: 0 });
    f.addFill(FLASK_FILL.chapterBoss * 2);
    expect(f.state).toEqual({ charges: 3, fill: 0 });
    const g = new Flask({ charges: 0, fill: 5 });
    g.refill();
    expect(g.state).toEqual({ charges: FLASK_RULES.maxCharges, fill: 0 });
  });

  it("不正な値は RangeError", () => {
    expect(() => new Flask({ charges: 4, fill: 0 })).toThrow(RangeError);
    expect(() => new Flask({ charges: 1, fill: 40 })).toThrow(RangeError);
    expect(() => new Flask().use(Number.NaN)).toThrow(RangeError);
    expect(() => {
      new Flask().addFill(-1);
    }).toThrow(RangeError);
  });
});
