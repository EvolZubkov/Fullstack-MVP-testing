/**
 * @module tests/it/analytics-answers.it.test
 * @description PRD-56 FR-25: ответы прохождений из LMS читаются по тесту, а не по попытке.
 *
 * Проверять это без базы нельзя: выборка соединяет ответы с прохождениями, а тест у строки
 * телеметрии бывает известен только через пакет — у части старых записей `test_id` пуст. Тот же
 * запасной путь уже заведён для самих прохождений; если ответы о нём не знают, статистика
 * вопросов молча теряет ровно те прохождения, ради которых пакет и собирали.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { scormAnswers, scormAttempts, scormPackages, tests, users } from "@shared/schema";
import { createHarness, type Harness } from "./db-harness";

const h = vi.hoisted(() => ({ current: null as Harness | null }));
vi.mock("../../server/db", () => ({
  get db() {
    if (!h.current) throw new Error("harness not initialized");
    return h.current.db;
  },
}));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { AnalyticsRepository } from "../../server/storage/analytics-repository";

let repo: AnalyticsRepository;
let testId: string;
let otherTestId: string;
let userId: string;

/** Прохождение из LMS с ответами на вопросы. */
async function lmsAttempt(
  answers: Array<{ questionId: string; result: string; latencyMs?: number | null }>,
  over: Record<string, unknown> = {},
) {
  const attemptId = randomUUID();
  await h.current!.db.insert(scormAttempts).values({
    id: attemptId,
    packageId: null,
    testId,
    origin: "telemetry",
    lmsUserName: "Иванов Пётр",
    startedAt: new Date("2026-09-10T09:00:00Z"),
    finishedAt: new Date("2026-09-10T09:30:00Z"),
    lastActivityAt: new Date("2026-09-10T09:30:00Z"),
    ...over,
  } as never);

  for (const answer of answers) {
    await h.current!.db.insert(scormAnswers).values({
      id: randomUUID(),
      attemptId,
      questionId: answer.questionId,
      questionPrompt: "Вопрос " + answer.questionId,
      questionType: "single",
      userAnswerJson: { value: 0 },
      result: answer.result,
      answeredAt: new Date("2026-09-10T09:15:00Z"),
      latencyMs: answer.latencyMs ?? null,
    } as never);
  }
  return attemptId;
}

beforeAll(async () => {
  h.current = await createHarness();
  repo = new AnalyticsRepository();
});
afterAll(async () => {
  await h.current!.close();
});
beforeEach(async () => {
  await h.current!.reset();
  testId = randomUUID();
  otherTestId = randomUUID();
  userId = randomUUID();
  await h.current!.db.insert(users).values({
    id: userId, email: "a@b.c", passwordHash: "x", name: "Морозова Анна",
  } as never);
  for (const id of [testId, otherTestId]) {
    await h.current!.db.insert(tests).values({
      id,
      title: "Тест " + id.slice(0, 4),
      overallPassRuleJson: { type: "percent", value: 70 },
      createdBy: userId,
    } as never);
  }
});

describe("selectAnswersForTest", () => {
  it("отдаёт ответы прохождений этого теста с их результатом и временем", async () => {
    await lmsAttempt([
      { questionId: "q1", result: "correct", latencyMs: 48_000 },
      { questionId: "q2", result: "incorrect" },
    ]);

    const rows = await repo.selectAnswersForTest(testId);

    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual(
      expect.objectContaining({ questionId: "q1", result: "correct", latencyMs: 48_000, origin: "telemetry" }),
    );
    expect(rows).toContainEqual(
      expect.objectContaining({ questionId: "q2", result: "incorrect", latencyMs: null }),
    );
  });

  it("не берёт ответы чужого теста", async () => {
    await lmsAttempt([{ questionId: "q1", result: "correct" }]);
    await lmsAttempt([{ questionId: "q9", result: "correct" }], { testId: otherTestId });

    const rows = await repo.selectAnswersForTest(testId);

    expect(rows.map(row => row.questionId)).toEqual(["q1"]);
  });

  it("находит ответы строки, у которой тест известен только через пакет", async () => {
    // Backfill дошёл не до всех записей телеметрии: у части `test_id` пуст, и тест у них —
    // тест пакета. Терять такие ответы значит занижать статистику вопроса молча.
    const packageId = randomUUID();
    await h.current!.db.insert(scormPackages).values({
      id: packageId, testId, testTitle: "Тест", secretKey: "k",
      apiBaseUrl: "http://localhost", exportedAt: new Date("2026-09-01T00:00:00Z"),
      version: 1, isActive: true, createdBy: userId,
    } as never);
    await lmsAttempt([{ questionId: "q1", result: "correct" }], { testId: null, packageId });

    const rows = await repo.selectAnswersForTest(testId);

    expect(rows.map(row => row.questionId)).toEqual(["q1"]);
  });

  it("несёт источник: импортированная выгрузка отличается от живой телеметрии", async () => {
    await lmsAttempt([{ questionId: "q1", result: "correct" }], {
      origin: "import", participantKey: "pk-1", lmsUserName: null,
    });

    const rows = await repo.selectAnswersForTest(testId);

    expect(rows[0].origin).toBe("import");
  });

  it("отдаёт пусто, когда прохождений нет", async () => {
    expect(await repo.selectAnswersForTest(testId)).toEqual([]);
  });
});
