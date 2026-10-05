/**
 * @module server/services/analytics/__tests__/question-bank-quality
 * @description PRD-70 FR-13, FR-14, §3.3 - §3.5: свод качества вопроса банка по тестам — без
 * общего среднего, только по тестам читателя; ориентир сложности — единственное усреднение.
 */
import { describe, expect, it } from "vitest";

import { bankQuality, difficultyLandmark } from "../question-bank-quality";
import type { QuestionInTest, TestQuality } from "../question-quality";

/** Вопрос в тесте: здоров, данных хватает, выдавался, если не сказано иное. */
function row(questionId: string, over: Partial<QuestionInTest> = {}): QuestionInTest {
  return {
    questionId,
    flag: null,
    suspicious: false,
    rank: 50,
    enoughData: true,
    observations: 100,
    hardness: 40,
    delivered: 100,
    overexposure: null,
    ...over,
  };
}

function test(testId: string, items: QuestionInTest[], pool: string[] = items.map(i => i.questionId)): TestQuality {
  return { testId, items, pool, suspicious: items.filter(i => i.suspicious).length, itemCount: items.length };
}

const KEY = { tone: "error" as const, title: "Сильные ошибаются чаще", detail: "" };
const EASY = { tone: "warning" as const, title: "Слишком лёгкий", detail: "" };
const ALL = () => true;

describe("bankQuality", () => {
  it("«на ревизии» — признак хотя бы в одном тесте; главный — по рангу, остальные — числом", () => {
    const qualities = [
      test("t1", [row("q1", { flag: KEY, suspicious: true, rank: 1 })]),
      test("t2", [row("q1", { flag: EASY, suspicious: true, rank: 7 })]),
      test("t3", [row("q1", { enoughData: false, flag: { tone: "info", title: "Мало данных", detail: "" } })]),
    ];
    const pools = new Map(qualities.map(q => [q.testId, q.pool]));

    const q1 = bankQuality(qualities, pools, ALL).get("q1")!;

    expect(q1.review).toEqual({ tone: "error", title: "Сильные ошибаются чаще", tests: 1, of: 2, more: 1 });
    expect(q1.testIds).toEqual(["t1", "t2", "t3"]);
  });

  it("ничего не видно из тестов вне области читателя (§3.5)", () => {
    const qualities = [
      test("mine", [row("q1")]),
      test("other", [row("q1", { flag: KEY, suspicious: true, rank: 1, overexposure: { sharePercent: 90, expectedPercent: 40 } })]),
    ];
    const pools = new Map(qualities.map(q => [q.testId, q.pool]));

    const q1 = bankQuality(qualities, pools, id => id === "mine").get("q1")!;

    expect(q1.review).toBeNull();
    expect(q1.overexposure).toBeNull();
    expect(q1.testIds).toEqual(["mine"]);
  });

  it("переэкспонирован — по тесту с наибольшим превышением, знаменатель — тесты с вопросом в пуле", () => {
    const qualities = [
      test("t1", [row("q1", { overexposure: { sharePercent: 70, expectedPercent: 40 } })]),
      test("t2", [row("q1", { overexposure: { sharePercent: 82, expectedPercent: 40 } })]),
    ];
    const pools = new Map<string, string[]>([["t1", ["q1"]], ["t2", ["q1"]], ["t3", ["q1"]]]);

    expect(bankQuality(qualities, pools, ALL).get("q1")!.overexposure)
      .toEqual({ sharePercent: 82, expectedPercent: 40, tests: 2, of: 3 });
  });

  it("«не выдавался» — в пуле теста и нигде не выдан; вне пулов — не считается (§3.3)", () => {
    const qualities = [test("t1", [row("q1"), row("q2", { delivered: 0, observations: 0 })], ["q1", "q2"])];
    // t2 без прохождений: его пул известен только из пулов.
    const pools = new Map<string, string[]>([["t1", ["q1", "q2"]], ["t2", ["q3"]]]);

    const result = bankQuality(qualities, pools, ALL);

    expect(result.get("q1")!.neverDelivered).toBe(false);
    expect(result.get("q2")!.neverDelivered).toBe(true);
    expect(result.get("q3")!.neverDelivered).toBe(true);
    expect(result.has("q4")).toBe(false);
  });
});

describe("difficultyLandmark", () => {
  it("среднее по тестам, взвешенное числом наблюдений; малые выборки не входят (§3.4)", () => {
    const qualities = [
      test("t1", [row("q1", { hardness: 42, observations: 214 })]),
      test("t2", [row("q1", { hardness: 39, observations: 412 })]),
      test("t3", [row("q1", { hardness: null, observations: 6 })]),
    ];

    expect(difficultyLandmark(qualities, "q1")).toEqual({ hardness: 40, tests: 2, observations: 626 });
  });

  it("ни одного теста с достаточными данными — ориентира нет", () => {
    expect(difficultyLandmark([test("t1", [row("q1", { hardness: null })])], "q1")).toBeNull();
    expect(difficultyLandmark([], "q1")).toBeNull();
  });
});
