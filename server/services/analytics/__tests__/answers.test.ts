/**
 * @module server/services/analytics/__tests__/answers
 * @description PRD-56 FR-25, FR-33: ответы обоих источников сводятся в одну статистику вопроса.
 *
 * Страница теста считала разбор ответов по одним веб-попыткам, а плитки над ним — по всем
 * прохождениям (Э1). На тесте, который проходят в LMS, это два ответа на один вопрос: сколько
 * человек ошиблось. Здесь проверяется, что источник перестал влиять на число.
 *
 * Второе правило — третье состояние ответа. PRD-54 завёл `neutral`: измерительный ответ не
 * бывает ни верным, ни неверным, и попадание его в знаменатель доли верных сделало бы у
 * опросника «долю верных», которой у него нет.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { storageMock } = vi.hoisted(() => ({
  storageMock: { selectAnswersForTest: vi.fn() },
}));
vi.mock("../../../storage", () => ({ storage: storageMock }));

// eslint-disable-next-line import/first -- должно импортироваться ПОСЛЕ vi.mock
import { loadAnswerFacts, summariseAnswers, type AnswerFact } from "../answers";

function fact(over: Partial<AnswerFact> = {}): AnswerFact {
  return {
    questionId: "q1",
    attemptId: "a1",
    result: "correct",
    source: "web",
    latencyMs: null,
    earnedPoints: 1,
    possiblePoints: 1,
    answer: 0,
    ...over,
  };
}

describe("summariseAnswers", () => {
  it("сводит ответы на один вопрос из веба и из LMS в одну строку", () => {
    const stats = summariseAnswers([
      fact({ source: "web", result: "correct" }),
      fact({ source: "telemetry", result: "incorrect" }),
      fact({ source: "import", result: "correct" }),
    ]);

    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ questionId: "q1", answered: 3, graded: 3, correct: 2 });
  });

  it("считает долю верных по оценённым ответам", () => {
    const stats = summariseAnswers([
      fact({ result: "correct" }),
      fact({ result: "incorrect" }),
      fact({ result: "incorrect" }),
      fact({ result: "incorrect" }),
    ]);

    expect(stats[0].correctPercent).toBe(25);
  });

  it("не считает измерительный ответ ни верным, ни неверным", () => {
    // PRD-54: `neutral` — ответ, которому нечего было оценивать. В знаменателе доли верных он
    // занижал бы её ровно на число таких ответов, а в числителе врал бы прямо.
    const stats = summariseAnswers([
      fact({ result: "correct" }),
      fact({ result: "neutral" }),
      fact({ result: "neutral" }),
    ]);

    expect(stats[0]).toMatchObject({ answered: 3, graded: 1, correct: 1, correctPercent: 100 });
  });

  it("у вопроса, где оценивать было нечего, доли верных нет", () => {
    // Ноль — это «все ошиблись», а здесь никто не ошибался: оценивания не было.
    const stats = summariseAnswers([fact({ result: "neutral" }), fact({ result: "neutral" })]);

    expect(stats[0].correctPercent).toBeNull();
  });

  it("держит вопросы порознь", () => {
    const stats = summariseAnswers([
      fact({ questionId: "q1", result: "correct" }),
      fact({ questionId: "q2", result: "incorrect" }),
    ]);

    expect(stats.map(row => row.questionId).sort()).toEqual(["q1", "q2"]);
  });

  it("считает, сколько наблюдений пришло из каждого источника", () => {
    // Читателю нужно знать, на чём стоит число: доля верных, собранная целиком из импорта,
    // и та же доля по вебу — разные по надёжности вещи.
    const stats = summariseAnswers([
      fact({ source: "web" }),
      fact({ source: "telemetry" }),
      fact({ source: "telemetry" }),
    ]);

    expect(stats[0].bySource).toEqual({ web: 1, telemetry: 2, import: 0 });
  });

  it("ничего не выдумывает на пустом списке", () => {
    expect(summariseAnswers([])).toEqual([]);
  });
});

describe("loadAnswerFacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.selectAnswersForTest.mockResolvedValue([]);
  });

  it("берёт ответы веб-попыток через переданную оценку", async () => {
    // Правила оценивания живут в маршруте вместе со scoring-контекстом теста: тащить их сюда
    // значило бы считать эффективную стоимость вопроса второй раз и рискнуть разойтись.
    const facts = await loadAnswerFacts("test1", {
      attempts: [{ id: "a1", answersJson: { q1: 0, q2: 1 } }],
      grade: questionId => (questionId === "q1"
        ? { result: "correct", earnedPoints: 1, possiblePoints: 1 }
        : { result: "incorrect", earnedPoints: 0, possiblePoints: 1 }),
    });

    // Сам ответ едет вместе с оценкой (FR-22): разбросу измерительного задания нужен именно
    // он — что выбрали, — а из «верно / неверно» этого не восстановить.
    expect(facts).toEqual([
      { questionId: "q1", attemptId: "a1", result: "correct", source: "web", latencyMs: null,
        earnedPoints: 1, possiblePoints: 1, answer: 0 },
      { questionId: "q2", attemptId: "a1", result: "incorrect", source: "web", latencyMs: null,
        earnedPoints: 0, possiblePoints: 1, answer: 1 },
    ]);
  });

  it("берёт время на задании из формы веб-попытки (PRD-66 FR-37a)", async () => {
    // Веб мерит время с этой работы и хранит его рядом с составом выдачи: карта ответов
    // плоская, «задание -> значение», и второй величине в ней места нет.
    const facts = await loadAnswerFacts("test1", {
      attempts: [{
        id: "a1",
        answersJson: { q1: 0, q2: 1 },
        variantJson: { sections: [], latencyMs: { q1: 42_000 } },
      }],
      grade: () => ({ result: "correct", earnedPoints: 1, possiblePoints: 1 }),
    });

    expect(facts[0].latencyMs).toBe(42_000);
    // У задания, которого в замере нет, время НЕ измерялось — это не ноль секунд.
    expect(facts[1].latencyMs).toBeNull();
  });

  it("попытка, пройденная до замера, времени не выдумывает", async () => {
    const facts = await loadAnswerFacts("test1", {
      attempts: [{ id: "a1", answersJson: { q1: 0 }, variantJson: { sections: [] } }],
      grade: () => ({ result: "correct", earnedPoints: 1, possiblePoints: 1 }),
    });

    expect(facts[0].latencyMs).toBeNull();
  });

  it("пропускает ответ на вопрос, которого в тесте уже нет", async () => {
    // Вопрос могли убрать из темы: его ответы остались в попытке, но приписывать их
    // несуществующему заданию незачем — строки статистики у него не будет.
    const facts = await loadAnswerFacts("test1", {
      attempts: [{ id: "a1", answersJson: { q1: 0, ghost: 1 } }],
      grade: questionId => (questionId === "q1"
        ? { result: "correct", earnedPoints: 1, possiblePoints: 1 }
        : null),
    });

    expect(facts.map(f => f.questionId)).toEqual(["q1"]);
  });

  it("добавляет ответы из LMS, сохраняя источник и время", async () => {
    storageMock.selectAnswersForTest.mockResolvedValue([
      { questionId: "q1", attemptId: "lms-1", result: "incorrect", latencyMs: 48_000,
        points: 0, maxPoints: 1, origin: "telemetry" },
      { questionId: "q2", attemptId: "lms-2", result: "neutral", latencyMs: null,
        points: null, maxPoints: null, origin: "import" },
    ]);

    const facts = await loadAnswerFacts("test1", {
      attempts: [],
      grade: () => ({ result: "correct", earnedPoints: 1, possiblePoints: 1 }),
    });

    expect(facts).toEqual([
      { questionId: "q1", attemptId: "lms-1", result: "incorrect", source: "telemetry",
        latencyMs: 48_000, earnedPoints: 0, possiblePoints: 1 },
      { questionId: "q2", attemptId: "lms-2", result: "neutral", source: "import",
        latencyMs: null, earnedPoints: null, possiblePoints: null },
    ]);
    expect(storageMock.selectAnswersForTest).toHaveBeenCalledWith("test1");
  });
});
