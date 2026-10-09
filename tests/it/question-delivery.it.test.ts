/**
 * @module tests/it/question-delivery.it.test
 * @description PRD-56 FR-17a: переключение состояния «исключён из выдачи» на реальной базе.
 *
 * Признак живёт в той же строке, что и переопределения цены и трудности задания внутри теста
 * (`test_question_scoring`). Отсюда главное, что здесь проверяется: переключение состояния не
 * имеет права затирать соседние поля — иначе исключение задания молча сбрасывает его цену,
 * и тест начинает считаться иначе.
 *
 * Проверять это без базы нельзя: речь именно об upsert по уникальному ключу (test, question).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { questions, testQuestionScoring, tests, topics, users } from "@shared/schema";
import { createHarness, type Harness } from "./db-harness";

const h = vi.hoisted(() => ({ current: null as Harness | null }));
vi.mock("../../server/db", () => ({
  get db() {
    if (!h.current) throw new Error("harness not initialized");
    return h.current.db;
  },
}));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { ScalesVariablesRepository } from "../../server/storage/scales-variables-repository";

let repo: ScalesVariablesRepository;
let testId: string;
let questionId: string;
let userId: string;

beforeAll(async () => {
  h.current = await createHarness();
  repo = new ScalesVariablesRepository();
});
afterAll(async () => {
  await h.current!.close();
});
beforeEach(async () => {
  await h.current!.reset();
  testId = randomUUID();
  questionId = randomUUID();
  userId = randomUUID();
  const topicId = randomUUID();

  await h.current!.db.insert(users).values({
    id: userId, email: "a@b.c", passwordHash: "x", name: "Автор",
  } as never);
  await h.current!.db.insert(tests).values({
    id: testId, title: "Сертификация",
    overallPassRuleJson: { type: "percent", value: 70 }, createdBy: userId,
  } as never);
  await h.current!.db.insert(topics).values({
    id: topicId, name: "Право", createdBy: userId,
  } as never);
  await h.current!.db.insert(questions).values({
    id: questionId, topicId, type: "single", prompt: "Вопрос",
    dataJson: { options: ["А", "Б"] }, correctJson: { correctIndex: 0 },
    createdBy: userId,
  } as never);
});

/** Строка настроек задания в этом тесте. */
async function row() {
  const rows = await repo.getTestQuestionScoring(testId);
  return rows.find(r => r.questionId === questionId);
}

describe("setQuestionDelivery", () => {
  it("заводит состояние там, где строки настроек ещё не было", async () => {
    await repo.setQuestionDelivery(testId, questionId, true);

    expect(await row()).toMatchObject({ excludedFromDelivery: true });
  });

  it("возвращает задание в выдачу", async () => {
    await repo.setQuestionDelivery(testId, questionId, true);
    await repo.setQuestionDelivery(testId, questionId, false);

    expect((await row())?.excludedFromDelivery).toBe(false);
  });

  it("не затирает цену и трудность задания", async () => {
    // Переопределения живут в той же строке: исключение из выдачи — это про показ, а не про
    // стоимость. Сброс цены здесь изменил бы результат теста у всех, кто его пройдёт.
    await h.current!.db.insert(testQuestionScoring).values({
      testId, questionId, points: 5, difficulty: 80,
    } as never);

    await repo.setQuestionDelivery(testId, questionId, true);

    expect(await row()).toMatchObject({
      points: 5, difficulty: 80, excludedFromDelivery: true,
    });
  });

  it("держит состояние порознь у разных тестов", async () => {
    // Негодное ЗДЕСЬ задание может быть годно в другом тесте: это и есть причина, по которой
    // признак лежит в настройках теста, а не у вопроса.
    const otherTestId = randomUUID();
    await h.current!.db.insert(tests).values({
      id: otherTestId, title: "Другой",
      overallPassRuleJson: { type: "percent", value: 70 }, createdBy: userId,
    } as never);

    await repo.setQuestionDelivery(testId, questionId, true);

    const otherRows = await repo.getTestQuestionScoring(otherTestId);
    expect(otherRows).toEqual([]);
  });
});

/**
 * Очистка ОЦЕНКИ не должна возвращать задание в выдачу: признак исключения живёт в той же
 * строке, что и переопределения цены, и удаление строки целиком молча снимало его. Так
 * «Сбросить» в «Оценке ответа» и лист «Оценка» книги Excel возвращали скомпрометированный
 * вопрос участникам (найдено 2026-10-01).
 */
describe("очистка оценки не трогает исключение из выдачи", () => {
  it("сброс оценки исключённого задания оставляет строку с одним признаком", async () => {
    await h.current!.db.insert(testQuestionScoring).values({
      testId, questionId, points: 5, difficulty: 80, excludedFromDelivery: true,
    } as never);

    expect(await repo.deleteTestQuestionScoring(testId, questionId)).toBe(true);

    expect(await row()).toMatchObject({
      points: null, scoringJson: null, difficulty: null, excludedFromDelivery: true,
    });
  });

  it("сброс оценки обычного задания удаляет строку, как раньше", async () => {
    await h.current!.db.insert(testQuestionScoring).values({ testId, questionId, points: 5 } as never);

    expect(await repo.deleteTestQuestionScoring(testId, questionId)).toBe(true);
    expect(await row()).toBeUndefined();
  });

  it("лист «Оценка» сохраняет исключение у задания, которого в листе нет", async () => {
    await repo.setQuestionDelivery(testId, questionId, true);

    await repo.replaceTestQuestionScoring(testId, []);

    expect(await row()).toMatchObject({ points: null, excludedFromDelivery: true });
  });

  it("лист «Оценка» сохраняет исключение у задания, которое в листе есть", async () => {
    await repo.setQuestionDelivery(testId, questionId, true);

    await repo.replaceTestQuestionScoring(testId, [{ questionId, points: 3 } as never]);

    expect(await row()).toMatchObject({ points: 3, excludedFromDelivery: true });
  });
});
