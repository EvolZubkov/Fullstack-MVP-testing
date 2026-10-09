/**
 * @module server/services/analytics/__tests__/test-answer-facts
 * @description PRD-56: общий сбор ответов теста — то место, где разрешается оценивание.
 *
 * Проверяется не «работает ли выборка» (это интеграционные наборы), а правила, ради которых сбор
 * и вынесен в одно место: измерительный ответ не становится неверным, задание не из теста не
 * роняет сбор, а пороги тем приезжают вместе с фактами — чтобы срез и страница теста не считали
 * их по-разному.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    selectAnswersForTest: vi.fn(),
    getQuestionsByIds: vi.fn(),
    getTopics: vi.fn(),
    getTest: vi.fn(),
    getTestSections: vi.fn(),
    getTestQuestionScoring: vi.fn(),
  },
}));

vi.mock("../../../storage", () => ({ storage: storageMock }));
vi.mock("../../../db", () => ({ db: {} }));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { loadTestAnswerFacts, variantQuestionIds } from "../test-answer-facts";

const SINGLE = {
  id: "q1", type: "single", prompt: "Что такое бюджет?", topicId: "tp-1", tags: ["Планирование"],
  correctJson: { correctIndex: 0 }, dataJson: { options: ["А", "Б"] }, difficulty: 60,
};
const SCALE = {
  id: "q2", type: "scale", prompt: "Насколько согласны?", topicId: "tp-1", tags: [],
  correctJson: null, dataJson: { min: 1, max: 5 },
};

/** Веб-попытка: выдали оба задания, ответили на оба. */
const attempt = (over: Record<string, unknown> = {}) => ({
  id: "a1",
  variantJson: { sections: [{ topicId: "tp-1", questionIds: ["q1", "q2"] }] },
  answersJson: { q1: 0, q2: 4 },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.selectAnswersForTest.mockResolvedValue([]);
  storageMock.getQuestionsByIds.mockResolvedValue([SINGLE, SCALE]);
  storageMock.getTopics.mockResolvedValue([{ id: "tp-1", name: "Бюджет" }]);
  storageMock.getTest.mockResolvedValue({
    id: "t1", overallPassRuleJson: { type: "percent", value: 70 }, defaultQuestionPoints: 1,
  });
  storageMock.getTestSections.mockResolvedValue([
    { id: "s1", testId: "t1", topicId: "tp-1", topicPassRuleJson: null },
  ]);
  storageMock.getTestQuestionScoring.mockResolvedValue([]);
});

describe("variantQuestionIds", () => {
  it("собирает состав и обычной выдачи, и адаптивных уровней", () => {
    expect(variantQuestionIds({ sections: [{ questionIds: ["q1", "q2"] }] })).toEqual(["q1", "q2"]);
    expect(variantQuestionIds({
      topics: [{ levelsState: [{ questionIds: ["q3"] }, { questionIds: ["q4"] }] }],
    })).toEqual(["q3", "q4"]);
  });

  it("у попытки без варианта состава нет, и это не ошибка", () => {
    expect(variantQuestionIds(null)).toEqual([]);
    expect(variantQuestionIds({})).toEqual([]);
  });
});

describe("loadTestAnswerFacts", () => {
  it("измерительный ответ приходит третьим состоянием, а не неверным", async () => {
    // У шкального задания эталона нет вовсе (PRD-26 FR-08): «неверно» было бы про него ложью,
    // а в знаменателе доли верных оно занижало бы её ровно на число таких ответов.
    const { facts } = await loadTestAnswerFacts("t1", [attempt()]);

    expect(facts.find(f => f.questionId === "q2")).toMatchObject({
      result: "neutral",
      earnedPoints: null,
      possiblePoints: null,
    });
    expect(facts.find(f => f.questionId === "q1")).toMatchObject({ result: "correct" });
  });

  it("цена задания — та же цепочка, что оценивает ответы; у измерительного цены нет", async () => {
    // Переопределение в тесте сильнее цены раздела, а та — цены теста.
    storageMock.getTestSections.mockResolvedValue([
      { id: "s1", testId: "t1", topicId: "tp-1", topicPassRuleJson: null, defaultPoints: 2 },
    ]);
    storageMock.getTestQuestionScoring.mockResolvedValue([{ questionId: "q1", points: 3 }]);
    const { pointsOf } = await loadTestAnswerFacts("t1", [attempt()]);

    expect(pointsOf(SINGLE as never)).toBe(3);
    expect(pointsOf(SCALE as never)).toBeNull();
    expect(pointsOf({ ...SINGLE, id: "q9" } as never)).toBe(2);
  });

  it("задание, которого в тесте больше нет, сбор не роняет", async () => {
    storageMock.getQuestionsByIds.mockResolvedValue([SINGLE]);

    const { facts } = await loadTestAnswerFacts("t1", [attempt()]);

    expect(facts.map(f => f.questionId)).toEqual(["q1"]);
  });

  it("ответы из LMS добавляют задания, которых нет в вариантах веб-попыток", async () => {
    // Задание, выданное только пакетом, в вариантах не встречается — без этого шага его
    // ответы отбрасывались бы молча (FR-25).
    storageMock.selectAnswersForTest.mockResolvedValue([
      { questionId: "q9", attemptId: "s1", result: "correct", latencyMs: null, points: null, maxPoints: null, origin: "telemetry" },
    ]);
    storageMock.getQuestionsByIds.mockResolvedValue([SINGLE, SCALE, { ...SINGLE, id: "q9" }]);

    await loadTestAnswerFacts("t1", [attempt()]);

    expect(storageMock.getQuestionsByIds.mock.calls[0][0]).toContain("q9");
  });

  it("отдаёт пороги тем и подписи — их считает правило теста, а не читатель", async () => {
    storageMock.getTestSections.mockResolvedValue([
      { id: "s1", testId: "t1", topicId: "tp-1", topicPassRuleJson: { source: "inherit_overall" } },
    ]);

    const { topicRules, topicNameById } = await loadTestAnswerFacts("t1", [attempt()]);

    // Раздел сказал «как у теста» — тема получает общий порог (70 %), а не свой.
    expect(topicRules.get("tp-1")).toMatchObject({ type: "percent", value: 70 });
    expect(topicNameById.get("tp-1")).toBe("Бюджет");
  });

  it("раздел без правила порога темы его и не получает", async () => {
    // Порога нет — значит исхода у темы не существует, и выдумывать его нельзя.
    const { topicRules } = await loadTestAnswerFacts("t1", [attempt()]);

    expect(topicRules.get("tp-1")).toBeNull();
  });
});
