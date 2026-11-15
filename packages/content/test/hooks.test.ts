import { PoisonTrail, createCombatant, createRng, type Combatant } from "@stella/core";
import { describe, expect, it } from "vitest";
import { BOARD_DATA } from "../src/index.ts";
import { build } from "./helpers.ts";

const O = { x: 0, y: 0 };
let id = 0;
const foe = (x = 1.2, facing = Math.PI, hp = 1e7): Combatant =>
  createCombatant({ id: `H${String(id++)}`, pos: { x, y: 0 }, maxHp: hp, facing });
const cons = (code: string): string[] =>
  BOARD_DATA.constellations.get(code)?.nodes.map((nid) => `#${nid}`) ?? [];

describe("星座・輝星・転変・天極のルールが、戦闘で働く", () => {
  it("毒蛇座の完成：毒が10スタック以上の敵が移動すると、毒だまりができて周りの敵を傷つける", () => {
    const b = build({ job: "rogue", uniques: [], star: cons("CONST-VIPER") });
    const rule = b.f.ruleParams("毒だまり");
    expect(rule).toBeDefined();
    const trail = new PoisonTrail();
    const walker = foe(0);
    const bystander = foe(1.8);
    for (let i = 0; i < 10; i++) walker.ailments.apply("poison", { reference: { physical: 100 } });
    trail.step(0.1, [walker, bystander], rule);
    walker.pos.x = 2;
    trail.step(0.1, [walker, bystander], rule);
    expect(trail.pools.length).toBeGreaterThanOrEqual(1);
    const hp = bystander.hp;
    for (let i = 0; i < 20; i++) trail.step(0.1, [walker, bystander], rule);
    expect(bystander.hp).toBeLessThan(hp);
    // 毒が10スタックに満たなければ、だまりはできない
    const trail2 = new PoisonTrail();
    const weak = foe(0);
    for (let i = 0; i < 9; i++) weak.ailments.apply("poison", { reference: { physical: 100 } });
    trail2.step(0.1, [weak], rule);
    weak.pos.x = 5;
    trail2.step(0.1, [weak], rule);
    expect(trail2.pools).toHaveLength(0);
    // 完成していなければ、ルールがない
    expect(build({ job: "rogue", uniques: [] }).f.ruleParams("毒だまり")).toBeUndefined();
  });
  it("千の小傷＋毒血同源：出血10スタックでも、毒蛇座の毒だまりが出血で発動する（G4の確認）", () => {
    const b = build({
      job: "rogue",
      uniques: ["UNQ-U03"],
      jobBoard: ["毒血同源"],
      star: cons("CONST-VIPER"),
    });
    const e = foe(1.2, Math.PI);
    for (let i = 0; i < 15; i++) {
      b.f.mp = 1000;
      b.f.use("SKL-ROG-FLURRY", O, 0, [e], createRng(i));
    }
    expect(e.ailments.stackCount("poison")).toBe(0);
    expect(e.ailments.countedStacks("poison")).toBeGreaterThanOrEqual(10);
    const trail = new PoisonTrail();
    trail.step(0.1, [e], b.f.ruleParams("毒だまり"));
    e.pos.x += 3;
    trail.step(0.1, [e], b.f.ruleParams("毒だまり"));
    expect(trail.pools.length).toBeGreaterThanOrEqual(1);
  });
  it("重撃化（転変）：近接の技が「重撃」になり、闘志の獲得が+6になる。崩し値+60%・ダメージ+30%・攻撃速度-30%", () => {
    const plain = build({ job: "warrior", uniques: [], weapon: "BASE-WPN-GREATSWORD-T1" });
    const mut = build({
      job: "warrior",
      uniques: [],
      star: ["重撃化"],
      weapon: "BASE-WPN-GREATSWORD-T1",
    });
    const a = foe(1.5, Math.PI);
    const c = foe(1.5, Math.PI);
    plain.f.use("SKL-WAR-SWEEP", O, 0, [a], createRng(1));
    mut.f.use("SKL-WAR-SWEEP", O, 0, [c], createRng(1));
    expect(plain.f.gauge.value).toBe(2);
    expect(mut.f.gauge.value).toBe(6);
    const spec = mut.f.hitSpec(mut.f.effective(mut.f.init.skills[0] as never), createRng(1));
    const base = plain.f.hitSpec(plain.f.effective(plain.f.init.skills[0] as never), createRng(1));
    expect((spec.breakBonus ?? 0) - (base.breakBonus ?? 0)).toBeGreaterThan(0.55);
    expect(mut.f.attackSpeed).toBeLessThan(plain.f.attackSpeed);
  });
  it("血の刃（転変）：出血している敵へのヒットで、出血を1スタック消費して残りダメージを即座に与える", () => {
    const run = (star: string[]): { stacks: number; hp: number } => {
      const b = build({ job: "rogue", uniques: ["UNQ-U03"], star });
      const e = foe(1.2, Math.PI);
      for (let i = 0; i < 4; i++) e.ailments.apply("bleed", { reference: { physical: 100 } });
      const before = e.hp;
      b.f.use("SKL-ROG-FLURRY", O, 0, [e], createRng(2));
      return { stacks: e.ailments.stackCount("bleed"), hp: before - e.hp };
    };
    const plain = run([]);
    const blade = run(["血の刃"]);
    // 通常は、ヒットのたびに出血が付いて増える。血の刃は1ヒットごとに1スタック消費する
    expect(blade.stacks).toBeLessThan(plain.stacks);
    expect(blade.hp).toBeGreaterThan(plain.hp);
  });
  it("傷口を抉る（輝星）：出血している敵へのヒットは、出血の持続を延ばす（最大で元の2倍まで）", () => {
    const b = build({
      job: "rogue",
      uniques: [],
      star: ["傷口を抉る"],
      weapon: "BASE-WPN-DAGGER-T1",
    });
    const e = foe(1.2, Math.PI);
    e.ailments.apply("bleed", { reference: { physical: 100 } });
    const before = e.ailments.exportStacks("bleed")[0]?.remaining ?? 0;
    b.f.use("SKL-ROG-FLURRY", O, 0, [e], createRng(3));
    const after = e.ailments.exportStacks("bleed")[0]?.remaining ?? 0;
    expect(after).toBeGreaterThan(before);
    for (let i = 0; i < 20; i++) {
      b.f.mp = 1000;
      b.f.use("SKL-ROG-FLURRY", O, 0, [e], createRng(10 + i));
    }
    for (const s of e.ailments.exportStacks("bleed"))
      expect(s.remaining).toBeLessThanOrEqual(s.duration * 1.0001);
    expect(e.ailments.exportStacks("bleed").every((s) => s.duration <= 10.0001)).toBe(true);
  });
  it("千変（天極）：3種類以上の状態異常を受けた敵へのヒットで、持続ダメージの残りの60%を即座に与えて消す（2秒に1回まで）", () => {
    const b = build({ job: "rogue", uniques: ["UNQ-U03"], jobBoard: ["毒血同源"], star: ["千変"] });
    const e = foe(1.2, Math.PI, 1e7);
    for (let i = 0; i < 5; i++) e.ailments.apply("bleed", { reference: { physical: 200 } });
    e.ailments.apply("weaken", { reference: {} });
    e.ailments.setAlias("bleed", "poison"); // 毒血同源（ヒットのたびに設定される）
    expect(e.ailments.countedKinds()).toBeGreaterThanOrEqual(3);
    const remaining = e.ailments.remainingDamage("bleed");
    const hp = e.hp;
    const out = b.f.use("SKL-ROG-FLURRY", O, 0, [e], createRng(4));
    const direct = out.hits.reduce((s, h) => s + h.result.damage, 0);
    expect(hp - e.hp - direct).toBeGreaterThan(remaining * 0.5);
    // 持続ダメージは消える（ヒットで新しく付いた分だけ残る）
    expect(e.ailments.remainingDamage("bleed")).toBeLessThan(remaining * 0.5);
    // 種類が足りない敵では起きない
    const plain = foe(1.2, Math.PI);
    plain.ailments.apply("bleed", { reference: { physical: 200 } });
    const r2 = plain.ailments.remainingDamage("bleed");
    build({ job: "rogue", uniques: [], star: ["千変"] }).f.use(
      "SKL-ROG-FLURRY",
      O,
      0,
      [plain],
      createRng(5),
    );
    expect(plain.ailments.remainingDamage("bleed")).toBeGreaterThan(r2 * 0.5);
  });
  it("剣気（輝星・刃の門の先）：剣系で攻撃すると、10%の確率で斬撃の衝撃波（武器ダメージの50%）が飛ぶ", () => {
    const run = (weapon: string): number => {
      const b = build({ job: "warrior", uniques: [], star: ["剣気"], weapon });
      let extra = 0;
      for (let i = 0; i < 300; i++) {
        b.f.mp = 1000;
        const front = foe(1.5, Math.PI);
        const far = foe(5, Math.PI);
        const out = b.f.use("SKL-WAR-SWEEP", O, 0, [front, far], createRng(i));
        extra += out.hits.filter((h) => h.target === far).length;
      }
      return extra;
    };
    // 大剣（剣系）：門が開いて衝撃波が出る。短剣では門が閉じて出ない
    expect(run("BASE-WPN-GREATSWORD-T1")).toBeGreaterThan(5);
    expect(run("BASE-WPN-DAGGER-T1")).toBe(0);
  });
  it("影写し（天極）：受けるダメージの35%を数秒かけてゆっくり受ける。敵を倒すと溜まっている分の20%が消える", () => {
    const b = build({ job: "rogue", uniques: [], star: ["影写し"] });
    const f = b.f;
    f.hp = 1000;
    const before = f.hp;
    f.takeDamage(100);
    expect(before - f.hp).toBeCloseTo(65, 0);
    const poolHp = f.hp;
    for (let i = 0; i < 60 * 6; i++) f.tick(1 / 60);
    expect(poolHp - f.hp).toBeGreaterThan(30);
    expect(poolHp - f.hp).toBeLessThan(36);
    // 敵を倒すと、溜まっている分が減る
    const g = build({ job: "rogue", uniques: [], star: ["影写し"] }).f;
    g.hp = 1000;
    g.takeDamage(100);
    g.onEnemyKilled(foe(), []);
    const hp2 = g.hp;
    for (let i = 0; i < 60 * 6; i++) g.tick(1 / 60);
    expect(hp2 - g.hp).toBeLessThan(poolHp - f.hp);
  });
  it("血の盟約（天極）：スキルのコストをHPで支払う（MPコスト×1.5）。MPは減らない。HPが足りなければ使えない", () => {
    const b = build({ job: "warrior", uniques: [], star: ["血の盟約"] });
    const f = b.f;
    f.hp = 50;
    const mp = f.mp;
    expect(f.use("SKL-WAR-RIFT", O, 0, [foe(3)], createRng(1)).ok).toBe(true);
    expect(f.hp).toBeCloseTo(50 - 10 * 1.5);
    expect(f.mp).toBe(mp);
    f.tick(10);
    f.hp = 14;
    expect(f.canUse("SKL-WAR-RIFT").ok).toBe(false);
  });
  it("徒手の極意（天極）：主手が空のとき、素手の基礎ダメージがキャラLv×1.0〜×1.8（速度1.6・会心率6%）", () => {
    const b = build({ job: "warrior", uniques: [], star: ["徒手の極意"] });
    b.f.setCharLevel(20);
    expect(b.f.weapon.min).toBeCloseTo(20);
    expect(b.f.weapon.max).toBeCloseTo(36);
    expect(b.f.weapon.speed).toBe(1.6);
    expect(b.f.weapon.crit).toBe(0.06);
    // 天極がなければ、素手は1〜3
    const plain = build({ job: "warrior", uniques: [] });
    expect(plain.f.weapon.min).toBe(1);
    expect(plain.f.weapon.max).toBe(3);
    // 武器を持つと、この天極は無効になる
    const armed = build({
      job: "warrior",
      uniques: [],
      star: ["徒手の極意"],
      weapon: "BASE-WPN-GREATSWORD-T1",
    });
    expect(armed.f.weapon.min).toBeCloseTo(14);
  });
  it("双刃座の完成：二刀流のとき、交互攻撃の2撃目の崩し値+30%（連刃3撃で、崩しの合計が約1.1倍）", () => {
    const gauge = (star: string[], flags: string[]): number => {
      const b = build({ job: "rogue", uniques: [], star, flags });
      const e = createCombatant({
        id: `D${String(id++)}`,
        pos: { x: 1.2, y: 0 },
        maxHp: 1e9,
        facing: Math.PI,
      });
      b.f.use("SKL-ROG-FLURRY", O, 0, [e], createRng(1));
      return e.breakGauge.gauge;
    };
    const plain = gauge([], ["二刀流"]);
    const dual = gauge(cons("CONST-DUALBLADE"), ["二刀流"]);
    expect(dual / plain).toBeGreaterThan(1.07);
    expect(dual / plain).toBeLessThan(1.13);
    // 二刀流でなければ、完成していても働かない
    const single = gauge(cons("CONST-DUALBLADE"), []);
    expect(single / gauge([], [])).toBeCloseTo(1, 1);
  });
  it("風見座の完成：U02「旅人の古靴」の潜在効果が目覚め、短縮が0.5秒になる（MVPでは剛迅域に置いた風見座）", () => {
    const wind = cons("CONST-WINDVANE");
    expect(wind).toHaveLength(6);
    const b = build({ job: "warrior", uniques: ["UNQ-U02"], star: wind });
    expect(b.latentActive).toEqual(["UNQ-U02"]);
    expect(b.f.ruleParams("移動距離ごとのCD短縮")?.["seconds"]).toBe(0.5);
    const none = build({ job: "warrior", uniques: ["UNQ-U02"] });
    expect(none.f.ruleParams("移動距離ごとのCD短縮")?.["seconds"]).toBe(0.3);
  });
});
