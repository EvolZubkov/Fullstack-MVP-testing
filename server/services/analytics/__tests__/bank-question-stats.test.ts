/**
 * @module server/services/analytics/__tests__/bank-question-stats
 * @description PRD-70 FR-10 - FR-12: статистика вопроса банка — строка на тест читателя, где вопрос
 * выдавался, без итогов; версии содержания сводятся по тестам; редакция выбирает выборку строк.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  storage: {
    getQuestionsByIds: vi.fn(),
    getTopics: vi.fn(),
    getTest: vi.fn(),
    getAttemptsByTests: vi.fn(),
    getLatencyStats: vi.fn(),
  },
  testPsychometrics: vi.fn(),
  computeItemBreakdown: vi.fn(),
  loadTestScoringContext: vi.fn(),
}));

vi.mock("../../../storage", () => ({ storage: mocks.storage }));
vi.mock("../../effective-scoring", () => ({ loadTestScoringContext: mocks.loadTestScoringContext }));
vi.mock("../psychometrics", () => ({ computeItemBreakdown: mocks.computeItemBreakdown }));
vi.mock("../test-psychometrics", () => ({
  testPsychometrics: mocks.testPsychometrics,
  correctIndexesOf: () => [0],
  cutRatioOf: () => 0.7,
}));
vi.mock("../review-inputs", () => ({ exposureWindowStart: () => new Date("2025-10-01T00:00:00Z") }));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { bankQuestionStats } from "../bank-question-stats";

const KEY = { tone: "error" as const, title: "Сильные ошибаются чаще", detail: "вероятна ошибка в ключе: r = −0,21" };

/** Вопрос в тесте из фонового пересчёта. */
function inTest(over: Record<string, unknown> = {}) {
  return {
    questionId: "q1", flag: null, suspicious: false, rank: 50, enoughData: true, observations: 214,
    hardness: 42, delivered: 214, drawMode: "quota", sharePercent: 44, expectedPercent: 40, overexposure: null,
    ...over,
  };
}

/** Разбор вопроса в тесте: редакции и мёртвые варианты. */
function breakdown(versions: Array<{ psychoHash: string | null; observations: number; firstAt: string; lastAt: string }>, difficulty = 0.58) {
  return {
    item: { observations: 214, difficulty, difficultyConfidence: "reliable", itemRest: -0.21, coefficientConfidence: "reliable" },
    versions,
    options: [
      { label: "Сувенир", dead: false, share: 0.6 },
      { label: "Скидка партнёру", dead: true, share: 0 },
    ],
  };
}

const QUALITIES = [
  { testId: "t1", items: [inTest({ flag: KEY, suspicious: true, rank: 1 })], pool: ["q1"], suspicious: 1, itemCount: 1 },
  { testId: "t2", items: [inTest({ delivered: 412 })], pool: ["q1"], suspicious: 0, itemCount: 1 },
  { testId: "t3", items: [inTest({ delivered: 0, observations: 0 })], pool: ["q1"], suspicious: 0, itemCount: 1 },
  { testId: "other", items: [inTest()], pool: ["q1"], suspicious: 0, itemCount: 1 },
];

const OLD = { psychoHash: "h-old", observations: 100, firstAt: "2026-03-12T00:00:00Z", lastAt: "2026-09-03T00:00:00Z" };
const CUR = { psychoHash: "h-cur", observations: 114, firstAt: "2026-09-04T00:00:00Z", lastAt: "2026-10-01T00:00:00Z" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.storage.getQuestionsByIds.mockResolvedValue([{
    id: "q1", prompt: "Что считается подарком?", type: "single", topicId: "tp1", tags: ["Антикоррупция"],
    psychoHash: "h-cur", correctJson: { correctIndex: 0 },
  }]);
  mocks.storage.getTopics.mockResolvedValue([{ id: "tp1", name: "Право и комплаенс" }]);
  mocks.storage.getTest.mockImplementation(async (id: string) => ({ id, title: `Тест ${id}`, overallPassRuleJson: null }));
  mocks.storage.getAttemptsByTests.mockResolvedValue([
    { resultJson: {}, variantJson: { sections: [{ questionIds: ["q1"] }] }, answersJson: { q1: 0 } },
    { resultJson: {}, variantJson: { sections: [{ questionIds: ["q1"] }] }, answersJson: {} },
  ]);
  mocks.storage.getLatencyStats.mockResolvedValue(new Map([["q1", { medianMs: 41_000, sampleSize: 50 }]]));
  mocks.testPsychometrics.mockResolvedValue({ responses: [], questionById: new Map() });
  mocks.loadTestScoringContext.mockResolvedValue({ difficultyOf: () => 30 });
  mocks.computeItemBreakdown.mockReturnValue(breakdown([OLD, CUR]));
});

describe("bankQuestionStats", () => {
  it("строка на тест читателя, где вопрос выдавался; без итогов; по числу выдач", async () => {
    const stats = await bankQuestionStats("q1", QUALITIES as never, id => id !== "other");

    expect(stats!.rows.map(r => r.testId)).toEqual(["t2", "t1"]);
    const t1 = stats!.rows.find(r => r.testId === "t1")!;
    expect(t1).toMatchObject({
      title: "Тест t1", delivered: 214, sharePercent: 44, expectedPercent: 40, drawMode: "quota",
      difficulty: 0.58, itemRest: -0.21, declared: 30, hardness: 42, skipShare: 50, latencyMedianMs: 41_000,
      flag: KEY,
    });
    expect(t1.deadOptions).toEqual([{ label: "Скидка партнёру", chosen: 0, of: 214 }]);
    expect(stats!.rows.find(r => r.testId === "t2")!.flag).toBeNull();
    expect(stats!.question).toMatchObject({ topicName: "Право и комплаенс", tags: ["Антикоррупция"] });
  });

  it("версии сводятся по тестам; по умолчанию — текущая редакция (FR-11)", async () => {
    const stats = await bankQuestionStats("q1", QUALITIES as never, id => id !== "other");

    expect(stats!.versions).toEqual([
      { ...CUR, tests: 2, observations: 228, current: true },
      { ...OLD, tests: 2, observations: 200, current: false },
    ]);
    expect(stats!.selectedVersion).toBe("h-cur");
    // Строки пересчитаны по выбранной редакции.
    expect(mocks.computeItemBreakdown).toHaveBeenCalledWith(expect.anything(), expect.anything(), "q1", [0], "h-cur");
  });

  it("запрошенная редакция — смена выборки; одна редакция — выбирать нечего", async () => {
    await bankQuestionStats("q1", QUALITIES as never, () => true, "h-old");
    expect(mocks.computeItemBreakdown).toHaveBeenCalledWith(expect.anything(), expect.anything(), "q1", [0], "h-old");

    mocks.computeItemBreakdown.mockReturnValue(breakdown([CUR]));
    const single = await bankQuestionStats("q1", QUALITIES as never, () => true);
    expect(single!.selectedVersion).toBeUndefined();
  });

  it("мало данных — наблюдаемой сложности нет; нет вопроса — нет статистики", async () => {
    mocks.computeItemBreakdown.mockReturnValue({
      ...breakdown([CUR]),
      item: { observations: 6, difficulty: 0.9, difficultyConfidence: "insufficient", itemRest: null, coefficientConfidence: "insufficient" },
    });
    const thin = await bankQuestionStats("q1", QUALITIES as never, id => id === "t1");
    expect(thin!.rows[0]).toMatchObject({ hardness: null, observations: 6 });

    mocks.storage.getQuestionsByIds.mockResolvedValue([]);
    expect(await bankQuestionStats("nope", QUALITIES as never, () => true)).toBeNull();
  });
});
