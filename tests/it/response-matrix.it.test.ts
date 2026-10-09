/**
 * @module tests/it/response-matrix.it.test
 * @description PRD-66 FR-06 - FR-08: сборка матрицы «респондент × задание» на реальной базе.
 *
 * Чистые адаптеры проверены отдельно; здесь проверяется то, что без базы не проверишь: что
 * выборка берётся у слоя PRD-56 со всеми его правилами, что ответы обоих источников доезжают
 * одним списком, что группы респондента приходят из членства и из метки партии, и что редакция
 * прохождения из LMS восстанавливается по снимку публикации.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import {
  attempts, groups, scormAnswers, scormAttempts, testSnapshots, tests, topics, userGroups, users,
} from "@shared/schema";
import { computePsychoHash } from "@shared/questions/psycho-hash";
import { createHarness, type Harness } from "./db-harness";

const h = vi.hoisted(() => ({ current: null as Harness | null }));
vi.mock("../../server/db", () => ({
  get db() {
    if (!h.current) throw new Error("harness not initialized");
    return h.current.db;
  },
}));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { loadResponseMatrix } from "../../server/services/analytics/response-matrix";

const ALL_TESTS = { all: true, ids: new Set<string>() };

/** Оценка веб-ответа: «нулевой вариант верен», цена 2 балла. */
const grade = (_questionId: string, answer: unknown) =>
  answer === undefined
    ? { result: "incorrect" as const, earnedPoints: 0, possiblePoints: 2 }
    : answer === 0
      ? { result: "correct" as const, earnedPoints: 2, possiblePoints: 2 }
      : { result: "incorrect" as const, earnedPoints: 0, possiblePoints: 2 };

let testId: string;
let topicId: string;
let userId: string;

beforeAll(async () => {
  h.current = await createHarness();
});
afterAll(async () => {
  await h.current!.close();
});
beforeEach(async () => {
  await h.current!.reset();
  testId = randomUUID();
  topicId = randomUUID();
  userId = randomUUID();
  await h.current!.db.insert(users).values({
    id: userId, email: "a@b.c", passwordHash: "x", name: "Морозова Анна",
  } as never);
  await h.current!.db.insert(topics).values({ id: topicId, name: "JS" } as never);
  await h.current!.db.insert(tests).values({
    id: testId, title: "Тест", overallPassRuleJson: { type: "percent", value: 70 }, createdBy: userId,
  } as never);
});

/** Веб-попытка с выданным составом, штампами редакций и замером времени. */
async function webAttempt(over: Record<string, unknown> = {}) {
  const id = randomUUID();
  await h.current!.db.insert(attempts).values({
    id,
    userId,
    testId,
    testVersion: 1,
    variantJson: {
      sections: [{ topicId, topicName: "JS", questionIds: ["q1", "q2"], formId: "form-a" }],
      psychoHashes: { q1: "hash-1", q2: "hash-2" },
      latencyMs: { q1: 7000 },
    },
    answersJson: { q1: 0, q2: 1 },
    resultJson: { overallPercent: 50, overallPassed: false, totalPossiblePoints: 4 },
    startedAt: new Date("2026-09-11T14:00:00Z"),
    finishedAt: new Date("2026-09-11T14:20:00Z"),
    ...over,
  } as never);
  return id;
}

/** Прохождение из LMS со строками ответов. */
async function lmsAttempt(over: Record<string, unknown> = {}, answers: Array<Record<string, unknown>> = []) {
  const id = randomUUID();
  await h.current!.db.insert(scormAttempts).values({
    id,
    packageId: null,
    sessionId: null,
    testId,
    origin: "telemetry",
    participantKey: null,
    userId: null,
    lmsUserName: "Иванов Пётр",
    resultPercent: 64,
    resultPassed: false,
    maxPoints: 4,
    startedAt: new Date("2026-09-10T09:00:00Z"),
    finishedAt: new Date("2026-09-10T09:30:00Z"),
    lastActivityAt: new Date("2026-09-10T09:30:00Z"),
    ...over,
  } as never);
  for (const answer of answers) {
    await h.current!.db.insert(scormAnswers).values({
      id: randomUUID(),
      attemptId: id,
      questionId: "q1",
      questionPrompt: "Вопрос",
      questionType: "single",
      topicId,
      userAnswerJson: [0],
      result: "correct",
      isCorrect: true,
      points: 3,
      maxPoints: 4,
      latencyMs: 48_000,
      answeredAt: new Date("2026-09-10T09:10:00Z"),
      ...answer,
    } as never);
  }
  return id;
}

describe("loadResponseMatrix", () => {
  it("раскладывает веб-попытку по выданным заданиям", async () => {
    await webAttempt();

    const { observations, responses } = await loadResponseMatrix({ testIds: [testId] }, ALL_TESTS, grade);

    expect(observations).toHaveLength(1);
    expect(responses.map(r => r.questionId).sort()).toEqual(["q1", "q2"]);
    expect(responses.find(r => r.questionId === "q1")).toMatchObject({
      outcome: "correct", scoreRatio: 1, psychoHash: "hash-1", latencyMs: 7000, formKey: "form-a",
      source: "web", respondentId: userId,
    });
  });

  it("сводит ответы обоих источников одним списком", async () => {
    await webAttempt();
    await lmsAttempt({}, [{}]);

    const { responses } = await loadResponseMatrix({ testIds: [testId] }, ALL_TESTS, grade);

    expect(responses.filter(r => r.source === "web")).toHaveLength(2);
    expect(responses.filter(r => r.source === "telemetry")).toHaveLength(1);
  });

  it("группы респондента приходят из членства, а своей оси не заводится (FR-08)", async () => {
    const groupId = randomUUID();
    await h.current!.db.insert(groups).values({ id: groupId, name: "Розница" } as never);
    await h.current!.db.insert(userGroups).values({ id: randomUUID(), userId, groupId } as never);
    await webAttempt();

    const { responses } = await loadResponseMatrix({ testIds: [testId] }, ALL_TESTS, grade);

    expect(responses[0].groupKeys).toEqual([groupId]);
  });

  it("у импортированного прохождения группой служит метка партии", async () => {
    // Участник импорта в системе может быть не заведён вовсе: членства у него нет, и группа
    // известна только та, под которой загрузили выгрузку.
    const groupId = randomUUID();
    await h.current!.db.insert(groups).values({ id: groupId, name: "Опт" } as never);
    await lmsAttempt(
      { origin: "import", participantKey: "a".repeat(64), lmsUserName: null, groupId },
      [{}],
    );

    const { responses } = await loadResponseMatrix({ testIds: [testId] }, ALL_TESTS, grade);

    expect(responses[0].groupKeys).toEqual([groupId]);
  });

  it("редакция прохождения из LMS восстанавливается по снимку публикации", async () => {
    // Снимок заморожен (PRD-15): содержание задания в нём — ровно то, что видел участник
    // прохождения, сообщившего эту версию. Отпечаток считается ТОЙ ЖЕ функцией, что и при
    // записи вопроса, иначе серии наблюдений разойдутся на ровном месте.
    const snapshotId = randomUUID();
    const question = {
      id: "q1", type: "single", prompt: "Вопрос снимка",
      dataJson: { options: ["A", "B"] }, correctJson: { correctIndex: 0 },
    };
    await h.current!.db.insert(testSnapshots).values({
      id: snapshotId,
      testId,
      version: 3,
      contentJson: { questionsByTopic: { [topicId]: [question] } },
    } as never);
    await lmsAttempt({ snapshotId }, [{}]);

    const { responses } = await loadResponseMatrix({ testIds: [testId] }, ALL_TESTS, grade);

    expect(responses[0].psychoHash).toBe(computePsychoHash(question));
  });

  it("прохождение без версии публикации уходит в серию «версия неизвестна»", async () => {
    await lmsAttempt({}, [{}]);

    const { responses } = await loadResponseMatrix({ testIds: [testId] }, ALL_TESTS, grade);

    expect(responses[0].psychoHash).toBeNull();
  });

  it("условия отбора берутся у слоя PRD-56 и не переписываются", async () => {
    // Отбор по источнику — правило слоя наблюдений; матрица обязана ему подчиняться, иначе
    // психометрика посчитает не по той выборке, которую показывает экран.
    await webAttempt();
    await lmsAttempt({}, [{}]);

    const { responses } = await loadResponseMatrix(
      { testIds: [testId], sources: ["web"] }, ALL_TESTS, grade,
    );

    expect(responses.every(r => r.source === "web")).toBe(true);
  });

  it("на пустой выборке не падает и не выдумывает строк", async () => {
    const matrix = await loadResponseMatrix({ testIds: [randomUUID()] }, ALL_TESTS, grade);

    expect(matrix).toEqual({ observations: [], responses: [] });
  });
});
