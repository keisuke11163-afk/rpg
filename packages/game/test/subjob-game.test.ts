/**
 * サブジョブのゲーム層（仕様書v0.2 5.1・MVP後の機能の提案 2章。docs/progress D-SUBG-*）：
 * ArenaSimulation のサブジョブの選択・技の枠・副職紋・適性と二刀流・契約枠・セーブの往復・サブジョブが無いときの互換。
 * core の規則そのものは packages/core/test/subjob.test.ts、データとの組み合わせは packages/content/test/subjob.test.ts。
 */
import { describe, expect, it } from "vitest";
import {
  Character,
  FIXED_STEP_SECONDS,
  SUB_SKILL_SLOT_LIMIT,
  fromSaveData,
  subSkillsInSlots,
} from "@stella/core";
import { loadGameContent, text } from "@stella/content";
import type { Action } from "../src/input/actions.ts";
import type { InputFrame } from "../src/input/frame.ts";
import {
  ArenaSimulation,
  DUMMY_POSITION,
  SKILL_SLOTS,
  newCharacterProfile,
} from "../src/scenes/arena-simulation.ts";
import { toPixels } from "../src/world/units.ts";
import { prepareBench } from "../src/bench/boss-bench.ts";
import { SUBJOB_BENCH_BUILDS } from "../src/bench/builds.ts";

const STEP = FIXED_STEP_SECONDS;
const db = loadGameContent();

const at = (x: number, y: number) => ({ x: toPixels(x), y: toPixels(y) });
function frame(
  pressed: Action[] = [],
  pointer = at(DUMMY_POSITION.x, DUMMY_POSITION.y),
  move = { x: 0, y: 0 },
): InputFrame {
  return { held: new Set(pressed), pressed: new Set(pressed), move, pointerWorld: pointer };
}

/**
 * メインジョブ main・キャラLv level・ジョブごとのジョブLv（省略したジョブは1）のシミュレーション。
 * 装備は出自（メインジョブ）の初期の武器。
 */
function simOf(
  main: string,
  level = 25,
  jobLevels: Readonly<Record<string, number>> = {},
  opts: { seed?: string; enemies?: boolean } = {},
): ArenaSimulation {
  const base = newCharacterProfile(db, main, "試験");
  const origin = db.jobs.get(main);
  if (origin === undefined) throw new Error(main);
  const character = new Character({
    origin,
    jobs: db.jobs,
    level,
    jobLevels: { [main]: level, ...jobLevels },
  });
  return new ArenaSimulation(undefined, {
    db,
    enemies: opts.enemies ?? false,
    rngSeed: opts.seed ?? "sub",
    profile: { ...base, character },
  });
}

/** 枠の技を1回使い、動作が終わるまで進める。 */
function use(sim: ArenaSimulation, skill: string): void {
  const slot = sim.loadout.find((l) => l.skill === skill)?.action;
  if (slot === undefined) throw new Error(`${skill} が枠に無い`);
  sim.frame(STEP, frame([slot]));
  for (let i = 0; i < 120 && sim.executing !== undefined; i++) sim.frame(STEP, frame());
}

const slotsOf = (sim: ArenaSimulation): (string | undefined)[] => {
  const m = new Map(sim.loadout.map((l) => [l.action, l.skill]));
  return SKILL_SLOTS.map((s) => m.get(s));
};

describe("サブジョブの選択", () => {
  it("キャラLv24では設定できない（理由は ja.json の subjob.block.level）。Lv25で設定でき、外せる", () => {
    const low = simOf("JOB-ROGUE", 24, { "JOB-WARRIOR": 10 });
    expect(low.canSetSubJob).toBe(false);
    expect(low.setSubJob("JOB-WARRIOR")).toBe("blocked");
    expect(low.subJobBlockText("JOB-WARRIOR")).toBe(text("subjob.block.level"));
    expect(low.subJob).toBeUndefined();

    const sim = simOf("JOB-ROGUE", 25, { "JOB-WARRIOR": 10 });
    expect(sim.canSetSubJob).toBe(true);
    expect(sim.setSubJob("JOB-WARRIOR")).toBe("ok");
    expect(sim.subJob?.id).toBe("JOB-WARRIOR");
    expect(sim.setSubJob("JOB-WARRIOR")).toBe("same");
    expect(sim.clearSubJob()).toBe("ok");
    expect(sim.subJob).toBeUndefined();
    expect(sim.clearSubJob()).toBe("none");
  });

  it("メインと同じジョブは設定できず、候補の一覧に理由が付く。存在しないジョブは unknown", () => {
    const sim = simOf("JOB-ROGUE");
    expect(sim.setSubJob("JOB-ROGUE")).toBe("blocked");
    expect(sim.setSubJob("JOB-NOPE")).toBe("unknown");
    const options = sim.subJobOptions();
    expect(options.map((o) => o.id)).toEqual([...db.jobs.keys()]);
    const self = options.find((o) => o.id === "JOB-ROGUE");
    expect(self?.block).toBe("sameAsMain");
    expect(self?.reason).toBe(text("subjob.block.same-as-main"));
    expect(options.filter((o) => o.block === undefined).length).toBe(db.jobs.size - 1);
  });

  it("候補を順に切り替えられる（設定できないジョブは飛ばし、最後の次は「なし」）", () => {
    const sim = simOf("JOB-WARRIOR");
    const seen: (string | undefined)[] = [];
    for (let i = 0; i < db.jobs.size; i++) {
      expect(sim.cycleSubJob(1)).toBe("ok");
      seen.push(sim.subJob?.id);
    }
    expect(seen).toEqual([...[...db.jobs.keys()].filter((j) => j !== "JOB-WARRIOR"), undefined]);
  });

  it("試し打ちの場・技の実行中は、転職と同じく変えられない（busy）", () => {
    const sim = simOf("JOB-ROGUE", 25, { "JOB-WARRIOR": 10 });
    for (let i = 0; i < 600 && sim.motion.position.x < DUMMY_POSITION.x - 2; i++)
      sim.frame(STEP, frame([], undefined, { x: 1, y: 0 }));
    expect(sim.startTrial()).toBe(true);
    expect(sim.setSubJob("JOB-WARRIOR")).toBe("busy");
    expect(sim.changeJob()).toBe("busy");
    expect(sim.endTrial()).toBe(true);
    expect(sim.setSubJob("JOB-WARRIOR")).toBe("ok");
    sim.frame(STEP, frame(["skill1"]));
    expect(sim.executing).toBeDefined();
    expect(sim.clearSubJob()).toBe("busy");
  });

  it("サブジョブと同じジョブに転職すると、サブジョブは外れる（副職紋の効果も消える）", () => {
    const sim = simOf("JOB-WARRIOR", 25, { "JOB-ROGUE": 10 });
    expect(sim.setSubJob("JOB-ROGUE")).toBe("ok");
    expect(sim.allocateSubJobNode("JBN-ROGUE-T1")).toBe(true);
    expect(sim.sheet.subJobNodes.size).toBe(1);
    expect(sim.changeJob()).toBe("ok"); // 戦士 → 盗賊
    expect(sim.job.id).toBe("JOB-ROGUE");
    expect(sim.subJob).toBeUndefined();
    expect(sim.sheet.subJobNodes.size).toBe(0);
    // 副職紋の取得はジョブごとに残る（セーブにも残る）
    expect(sim.saveData().sub_job_boards).toEqual({ "JOB-ROGUE": ["JBN-ROGUE-T1"] });
  });
});

describe("ロードアウトの切り替え", () => {
  it("サブジョブはロードアウトに含めない。切り替えでメインがサブと同じジョブになるとサブが外れ、枠のサブの技も戻る", () => {
    const sim = simOf("JOB-WARRIOR", 25, { "JOB-ROGUE": 10 });
    for (let i = 0; i < 600 && sim.motion.position.x < DUMMY_POSITION.x - 2; i++)
      sim.frame(STEP, frame([], undefined, { x: 1, y: 0 }));
    const warriorSlots = slotsOf(sim);
    expect(sim.switchLoadout(2)).toBe("ok");
    expect(sim.changeJob()).toBe("ok"); // ロードアウト2は盗賊
    expect(sim.switchLoadout(1)).toBe("ok");
    expect(sim.job.id).toBe("JOB-WARRIOR");
    expect(sim.setSubJob("JOB-ROGUE")).toBe("ok");
    expect(sim.setSlotSkill(5, "SKL-ROGUE-POISON")).toBe(true);
    expect(sim.switchLoadout(2)).toBe("ok");
    expect(sim.job.id).toBe("JOB-ROGUE");
    expect(sim.subJob).toBeUndefined();
    expect(sim.switchLoadout(1)).toBe("ok");
    expect(sim.job.id).toBe("JOB-WARRIOR");
    expect(sim.subJob).toBeUndefined(); // ロードアウト1に戻っても、サブジョブは戻らない（Q-SUB-3）
    expect(slotsOf(sim)).toEqual(warriorSlots);
  });
});

describe("サブジョブの技", () => {
  it("サブ戦士の戦吼を、盗賊の技の枠から使える（強化がかかる・コンボ点は増えない）", () => {
    const sim = simOf("JOB-ROGUE", 25, { "JOB-WARRIOR": 10 });
    expect(sim.assignableSkills()).not.toContain("SKL-WARRIOR-WARCRY");
    expect(sim.setSlotSkill(5, "SKL-WARRIOR-WARCRY")).toBe(false);
    expect(sim.setSubJob("JOB-WARRIOR")).toBe("ok");
    expect(sim.subSkills()).toEqual(["SKL-WARRIOR-CHARGE", "SKL-WARRIOR-WARCRY"]);
    expect(sim.assignableSkills().slice(-2)).toEqual(sim.subSkills());
    expect(sim.setSlotSkill(5, "SKL-WARRIOR-WARCRY")).toBe(true);
    expect(sim.isSubSkill("SKL-WARRIOR-WARCRY")).toBe(true);
    expect(sim.blockOf("SKL-WARRIOR-WARCRY")).toBeUndefined();
    const gauge = sim.jobGauge.value;
    use(sim, "SKL-WARRIOR-WARCRY");
    expect(sim.buffs.instances().map((b) => b.effectId)).toContain("EFF-WARRIOR-WARCRY-ATTACK");
    expect(sim.jobGauge.value).toBe(gauge); // 戦吼の「闘志+20」はメインのゲージに入らない
    expect(sim.cooldowns.remaining("SKL-WARRIOR-WARCRY")).toBeGreaterThan(0);
  });

  it(`サブジョブの技は、技の枠に${String(SUB_SKILL_SLOT_LIMIT)}つまで（サブの技が2つなので、構造上これ以上は入らない）`, () => {
    const sim = simOf("JOB-ROGUE", 25, { "JOB-WARRIOR": 10 });
    expect(sim.setSubJob("JOB-WARRIOR")).toBe("ok");
    expect(sim.setSlotSkill(4, "SKL-WARRIOR-CHARGE")).toBe(true);
    expect(sim.setSlotSkill(5, "SKL-WARRIOR-WARCRY")).toBe(true);
    expect(subSkillsInSlots(slotsOf(sim), sim.subSkills())).toBe(2);
    // 同じ技を別の枠に入れると入れ替え（数は2のまま）
    expect(sim.setSlotSkill(1, "SKL-WARRIOR-CHARGE")).toBe(true);
    expect(subSkillsInSlots(slotsOf(sim), sim.subSkills())).toBe(2);
    // 枠を順に切り替えても、上限を超えない
    for (let i = 0; i < 20; i++) {
      sim.cycleSlotSkill(i % SKILL_SLOTS.length);
      expect(subSkillsInSlots(slotsOf(sim), sim.subSkills())).toBeLessThanOrEqual(
        SUB_SKILL_SLOT_LIMIT,
      );
    }
  });

  it("サブジョブのジョブLvで覚えていない技は入れられない（戦吼はジョブLv5）", () => {
    const sim = simOf("JOB-ROGUE", 25, { "JOB-WARRIOR": 4 });
    expect(sim.setSubJob("JOB-WARRIOR")).toBe("ok");
    expect(sim.subSkills()).toEqual(["SKL-WARRIOR-CHARGE"]);
    expect(sim.setSlotSkill(5, "SKL-WARRIOR-WARCRY")).toBe(false);
    expect(sim.setSlotSkill(5, "SKL-WARRIOR-CHARGE")).toBe(true);
  });

  it("サブジョブを外す・変えると、枠のサブジョブの技はその枠の初期の技（無ければ空き）に戻り、使えなくなる", () => {
    const sim = simOf("JOB-ROGUE", 25, { "JOB-WARRIOR": 10, "JOB-MAGE": 10 });
    const before = slotsOf(sim);
    expect(sim.setSubJob("JOB-WARRIOR")).toBe("ok");
    expect(sim.setSlotSkill(5, "SKL-WARRIOR-WARCRY")).toBe(true); // 煙玉の枠
    expect(sim.setSlotSkill(1, "SKL-WARRIOR-CHARGE")).toBe(true); // 連刃の枠
    expect(sim.clearSubJob()).toBe("ok");
    expect(slotsOf(sim)).toEqual(before);
    expect(sim.blockOf("SKL-WARRIOR-WARCRY")).toBe("locked");

    expect(sim.setSubJob("JOB-WARRIOR")).toBe("ok");
    expect(sim.setSlotSkill(5, "SKL-WARRIOR-WARCRY")).toBe(true);
    expect(sim.setSlotSkill(4, "SKL-ROGUE-SMOKE")).toBe(true); // 煙玉を別の枠へ（毒刃の枠）
    expect(sim.setSubJob("JOB-MAGE")).toBe("ok");
    // 煙玉は枠4にあるので、枠5は空きに戻る
    expect(slotsOf(sim)[5]).toBeUndefined();
  });

  it("全てのジョブの組み合わせで、サブジョブの技はゲージが無くても使える（locked・gauge にならない）", () => {
    const levels = Object.fromEntries([...db.jobs.keys()].map((j) => [j, 25]));
    for (const main of db.jobs.keys())
      for (const sub of db.jobs.keys()) {
        if (main === sub) continue;
        const sim = simOf(main, 25, levels);
        expect(sim.setSubJob(sub)).toBe("ok");
        const skills = sim.subSkills();
        expect(skills).toHaveLength(2);
        skills.forEach((s, i) => {
          expect(sim.setSlotSkill(4 + i, s)).toBe(true);
          const block = sim.blockOf(s);
          expect([undefined, "target"], `${main}＋${sub}：${s} → ${String(block)}`).toContain(
            block,
          );
        });
      }
  });
});

describe("副職紋", () => {
  it("ポイントは min(20, サブジョブのジョブLv−1)。境界で取れなくなる", () => {
    const sim = simOf("JOB-WARRIOR", 25, { "JOB-ROGUE": 4 });
    expect(sim.subJobBoard).toBeUndefined();
    expect(sim.subJobBoardPoints).toBe(0);
    expect(sim.allocateSubJobNode("JBN-ROGUE-T1")).toBe(false);
    expect(sim.setSubJob("JOB-ROGUE")).toBe("ok");
    expect(sim.subJobBoardPoints).toBe(3);
    expect(sim.allocateSubJobNode("JBN-ROGUE-T1")).toBe(true);
    expect(sim.allocateSubJobNode("JBN-ROGUE-T2")).toBe(true);
    expect(sim.allocateSubJobNode("JBN-ROGUE-T3")).toBe(true);
    expect(sim.subJobBoardPointsLeft).toBe(0);
    expect(sim.allocateSubJobNode("JBN-ROGUE-T4")).toBe(false);
    expect(sim.subJobBoard?.allocateBlock("JBN-ROGUE-T4", sim.subJobBoardPoints)).toBe("points");
    expect(simOf("JOB-WARRIOR", 25, { "JOB-ROGUE": 21 }).setSubJob("JOB-ROGUE")).toBe("ok");
    const hi = simOf("JOB-WARRIOR", 25, { "JOB-ROGUE": 25 });
    hi.setSubJob("JOB-ROGUE");
    expect(hi.subJobBoardPoints).toBe(20);
  });

  it("職奥義・接続ノードは取れない。取った小ノードの効果が能力値に入る（出どころ subJob）", () => {
    const sim = simOf("JOB-WARRIOR", 25, { "JOB-ROGUE": 25 });
    expect(sim.setSubJob("JOB-ROGUE")).toBe("ok");
    for (const id of [
      "JBN-ROGUE-T1",
      "JBN-ROGUE-T2",
      "JBN-ROGUE-T3",
      "JBN-ROGUE-T4",
      "JBN-ROGUE-T5",
    ])
      expect(sim.allocateSubJobNode(id)).toBe(true);
    expect(sim.allocateSubJobNode("JBN-ROGUE-C1")).toBe(false);
    expect(sim.subJobBoard?.allocateBlock("JBN-ROGUE-C1", 20)).toBe("subOnlyMinor");
    expect([...sim.sheet.subJobNodes]).toEqual([
      "JBN-ROGUE-T1",
      "JBN-ROGUE-T2",
      "JBN-ROGUE-T3",
      "JBN-ROGUE-T4",
      "JBN-ROGUE-T5",
    ]);
    // メインの職紋盤には入らない
    expect(sim.sheet.jobNodes.size).toBe(0);
  });

  it("振り直しは安全地帯で金貨（20×ジョブLv）。1つずつ返すのは試し打ちの場だけ（無料）", () => {
    const sim = simOf("JOB-WARRIOR", 25, { "JOB-ROGUE": 10 });
    expect(sim.setSubJob("JOB-ROGUE")).toBe("ok");
    expect(sim.allocateSubJobNode("JBN-ROGUE-T1")).toBe(true);
    expect(sim.allocateSubJobNode("JBN-ROGUE-T2")).toBe(true);
    expect(sim.refundSubJobNode("JBN-ROGUE-T2")).toBe(false);
    expect(sim.subJobBoardRespecCost).toBe(200);
    // 町の外（人形から離れている）では振り直せない
    expect(sim.inSafeZone).toBe(false);
    expect(sim.resetSubJobBoard()).toBe(false);
    for (let i = 0; i < 600 && sim.motion.position.x < DUMMY_POSITION.x - 2; i++)
      sim.frame(STEP, frame([], undefined, { x: 1, y: 0 }));
    expect(sim.inSafeZone).toBe(true);
    // 試し打ちの場：1つ返せる・無料で振り直せる・出ると元に戻る
    expect(sim.startTrial()).toBe(true);
    expect(sim.subJobBoardRespecCost).toBe(0);
    expect(sim.refundSubJobNode("JBN-ROGUE-T1")).toBe(false); // 返すと T2 がつながらない
    expect(sim.refundSubJobNode("JBN-ROGUE-T2")).toBe(true);
    expect(sim.saveData().sub_job_boards).toEqual({
      "JOB-ROGUE": ["JBN-ROGUE-T1", "JBN-ROGUE-T2"],
    });
    expect(sim.endTrial()).toBe(true);
    expect(sim.subJobBoard?.nodes).toEqual(["JBN-ROGUE-T1", "JBN-ROGUE-T2"]);
    // 金貨が足りない（新しいキャラは0）→ 足りる
    expect(sim.inventory.gold).toBe(0);
    expect(sim.resetSubJobBoard()).toBe(false);
    sim.inventory.addGold(1000);
    expect(sim.resetSubJobBoard()).toBe(true);
    expect(sim.subJobBoard?.spent).toBe(0);
    expect(sim.inventory.gold).toBe(800);
  });
});

describe("セーブの往復", () => {
  it("サブジョブ・副職紋（ジョブごと）・枠のサブジョブの技が、保存して読み込むと同じになる", () => {
    const sim = simOf("JOB-WARRIOR", 25, { "JOB-ROGUE": 12, "JOB-MAGE": 8 });
    expect(sim.setSubJob("JOB-MAGE")).toBe("ok");
    expect(sim.allocateSubJobNode("JBN-MAGE-T1")).toBe(true);
    expect(sim.setSubJob("JOB-ROGUE")).toBe("ok");
    expect(sim.allocateSubJobNode("JBN-ROGUE-T1")).toBe(true);
    expect(sim.allocateSubJobNode("JBN-ROGUE-B1A")).toBe(true);
    expect(sim.setSlotSkill(5, "SKL-ROGUE-POISON")).toBe(true);
    const data = sim.saveData();
    expect(data.character.sub_job).toBe("JOB-ROGUE");
    expect(data.sub_job_boards).toEqual({
      "JOB-MAGE": ["JBN-MAGE-T1"],
      "JOB-ROGUE": ["JBN-ROGUE-T1", "JBN-ROGUE-B1A"],
    });
    const again = new ArenaSimulation(undefined, {
      db,
      enemies: false,
      profile: fromSaveData(db, data),
    });
    expect(again.subJob?.id).toBe("JOB-ROGUE");
    expect(again.subJobBoard?.nodes).toEqual(["JBN-ROGUE-T1", "JBN-ROGUE-B1A"]);
    expect(slotsOf(again)[5]).toBe("SKL-ROGUE-POISON");
    expect(again.sheet.subJobNodes).toEqual(sim.sheet.subJobNodes);
    expect(again.saveData()).toEqual(data);
    // 別のジョブの副職紋も残っていて、サブジョブを戻すと効く
    expect(again.setSubJob("JOB-MAGE")).toBe("ok");
    expect(again.subJobBoard?.nodes).toEqual(["JBN-MAGE-T1"]);
  });

  it("サブジョブが無ければ、セーブに sub_job_boards は出ない（今までと同じ形）", () => {
    const sim = simOf("JOB-WARRIOR");
    const data = sim.saveData();
    expect(data.character.sub_job).toBeNull();
    expect("sub_job_boards" in data).toBe(false);
  });
});

describe("適性・二刀流・契約枠", () => {
  it("武器適性は、メインとサブ（1段階下げる）の高い方", () => {
    const sim = simOf("JOB-WARRIOR", 25, { "JOB-ROGUE": 5 });
    // 短剣を持たせる（戦士は短剣C・盗賊は短剣S → A）
    sim.inventory.addItem({
      uid: "itm_dagger",
      base: "BASE-WPN-DAGGER-T1",
      rarity: "normal",
      itemLevel: 1,
      affixes: [],
    });
    expect(sim.equipFromInventory("itm_dagger", "mainHand")).toBe(true);
    expect(sim.affinity).toBe("C");
    expect(sim.setSubJob("JOB-ROGUE")).toBe("ok");
    expect(sim.affinity).toBe("A");
    expect(sim.clearSubJob()).toBe("ok");
    expect(sim.affinity).toBe("C");
  });

  it("二刀流はサブジョブからも受け継ぐ。外すと副手の片手武器をインベントリに戻す", () => {
    const sim = simOf("JOB-ARCHER", 25, { "JOB-ROGUE": 5 });
    expect(sim.canDualWield).toBe(false);
    expect(sim.setSubJob("JOB-ROGUE")).toBe("ok");
    expect(sim.canDualWield).toBe(true);
    sim.inventory.addItem({
      uid: "itm_dagger",
      base: "BASE-WPN-DAGGER-T1",
      rarity: "normal",
      itemLevel: 1,
      affixes: [],
    });
    expect(sim.equipFromInventory("itm_dagger", "offHand")).toBe(true);
    expect(sim.equipment.get("offHand")?.uid).toBe("itm_dagger");
    expect(sim.clearSubJob()).toBe("ok");
    expect(sim.canDualWield).toBe(false);
    expect(sim.equipment.get("offHand")).toBeUndefined();
    expect(sim.inventory.items.some((i) => i.uid === "itm_dagger")).toBe(true);
  });

  it("サブ召喚士なら契約枠6（固定）で、骸兵＋魔狼まで呼べる。サブを外すと召喚物は消え、枠は0", () => {
    const sim = simOf("JOB-WARRIOR", 25, { "JOB-SUMMONER": 10 });
    expect(sim.minionField.squad.capacity).toBe(0);
    expect(sim.setSubJob("JOB-SUMMONER")).toBe("ok");
    expect(sim.minionField.squad.capacity).toBe(6);
    expect(sim.subSkills()).toEqual(["SKL-SUMMONER-SKELETON", "SKL-SUMMONER-DIRE-WOLF"]);
    expect(sim.setSlotSkill(4, "SKL-SUMMONER-SKELETON")).toBe(true);
    expect(sim.setSlotSkill(5, "SKL-SUMMONER-DIRE-WOLF")).toBe(true);
    use(sim, "SKL-SUMMONER-SKELETON");
    use(sim, "SKL-SUMMONER-DIRE-WOLF");
    expect(sim.minions.map((m) => m.def.id).sort()).toEqual(["MIN-DIRE-WOLF", "MIN-SKELETON"]);
    expect(sim.minionField.squad.used).toBe(6);
    for (let i = 0; i < 1200 && sim.cooldowns.remaining("SKL-SUMMONER-SKELETON") > 0; i++)
      sim.frame(STEP, frame());
    expect(sim.blockOf("SKL-SUMMONER-SKELETON")).toBe("gauge"); // 枠が足りない
    expect(sim.jobGauge.def.id).toBe("GAU-FERVOR"); // メインのゲージのまま（契約枠のゲージは作らない）
    expect(sim.clearSubJob()).toBe("ok");
    expect(sim.minions).toHaveLength(0);
    expect(sim.minionField.squad.capacity).toBe(0);
  });

  it("メインが召喚士なら、サブジョブがあっても契約枠は今までどおり10", () => {
    const sim = simOf("JOB-SUMMONER", 25, { "JOB-WARRIOR": 5 });
    expect(sim.minionField.squad.capacity).toBe(10);
    expect(sim.setSubJob("JOB-WARRIOR")).toBe("ok");
    expect(sim.minionField.squad.capacity).toBe(10);
  });
});

describe("サブジョブが無いときは今までと同じ", () => {
  /** 人形を通常攻撃で叩き続けて、数値を集める。 */
  function run(sim: ArenaSimulation): unknown {
    for (let i = 0; i < 600 && sim.motion.position.x < DUMMY_POSITION.x - 2; i++)
      sim.frame(STEP, frame([], undefined, { x: 1, y: 0 }));
    for (let i = 0; i < 600; i++) sim.frame(STEP, frame(["skill1", "skill3"]));
    return {
      hits: sim.hitCount,
      dps: sim.dps(),
      report: sim.lastHit,
      gauge: sim.jobGauge.value,
      mp: sim.mp,
      sheet: { maxHp: sim.sheet.maxHp, attackSpeed: sim.attackSpeed, affinity: sim.affinity },
      save: sim.saveData(),
    };
  }

  it("サブジョブを設定して外した後は、一度も設定しなかったときと同じ数値（同じシード）", () => {
    const plain = simOf("JOB-ROGUE", 25, { "JOB-WARRIOR": 10 }, { seed: "same" });
    const toggled = simOf("JOB-ROGUE", 25, { "JOB-WARRIOR": 10 }, { seed: "same" });
    expect(toggled.setSubJob("JOB-WARRIOR")).toBe("ok");
    expect(toggled.clearSubJob()).toBe("ok");
    expect(run(toggled)).toEqual(run(plain));
  });

  it("サブジョブが無ければ、技の枠の候補・二刀流・契約枠は今までどおり", () => {
    const sim = simOf("JOB-WARRIOR");
    expect(sim.subSkills()).toEqual([]);
    expect(sim.assignableSkills()).toEqual([
      "SKL-BASIC-ATTACK",
      ...(db.jobs.get("JOB-WARRIOR")?.skills.map((s) => s.skill) ?? []),
    ]);
    expect(sim.canDualWield).toBe(true);
    expect(sim.minionField.squad.capacity).toBe(0);
    expect(sim.subJobBoardPoints).toBe(0);
    expect(sim.sheet.subJobNodes.size).toBe(0);
  });
});

describe("ボットのビルド（pnpm bench -- --subjob）", () => {
  it("サブジョブのビルドは、Lv25・サブジョブ・副職紋・枠のサブジョブの技を用意できる", () => {
    for (const b of SUBJOB_BENCH_BUILDS) {
      const sim = prepareBench(db, b);
      expect(sim.character.level).toBe(25);
      expect(sim.subJob?.id).toBe(b.subJob?.job);
      expect(sim.subJobBoard?.spent).toBeGreaterThan(0);
      expect(sim.subJobBoard?.spent).toBeLessThanOrEqual(sim.subJobBoardPoints);
      const subs = sim.loadout.filter((l) => sim.isSubSkill(l.skill));
      expect(subs.length).toBeGreaterThan(0);
      for (const l of subs) expect(sim.blockOf(l.skill)).toBeUndefined();
    }
  });
});
