/**
 * @module tests/it/exposure-report
 * @description PRD-55 (FR-31, FR-31a, FR-32): величины, которые аналитика теста показывает
 * автору, — экспозиция задания в ЭТОМ тесте, его показы во всех тестах и медиана времени.
 *
 * Круглый рейс на настоящей базе обязателен: обе величины считает SQL — группировка по заданию с
 * фильтром теста и `percentile_cont` по `latency_ms`. Ошибка в них не уронит ни один запрос, а
 * проявится неверным числом на экране, которое никто не отличит от правды.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { scormAttempts, scormAnswers } from "@shared/schema";
import { createHarness, type Harness } from "./db-harness";

const h = vi.hoisted(() => ({ current: null as Harness | null }));
vi.mock("../../server/db", () => ({
  get db() {
    if (!h.current) throw new Error("harness not initialized");
    return h.current.db;
  },
}));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { ExposureRepository } from "../../server/storage/exposure-repository";

let repo: ExposureRepository;
const TEST_A = "test-a";
const TEST_B = "test-b";
const WINDOW_START = new Date("2026-01-01");

beforeAll(async () => {
  h.current = await createHarness();
  repo = new ExposureRepository();
});

afterAll(async () => {
  await h.current?.close();
  h.current = null;
});

beforeEach(async () => {
  await h.current!.reset();
});

/** Прохождение телеметрии с ответами; `latency` в миллисекундах, `null` = не измерялось. */
async function attemptWith(testId: string, answers: Array<{ questionId: string; latency: number | null }>) {
  const attemptId = randomUUID();
  await h.current!.db.insert(scormAttempts).values({
    id: attemptId,
    packageId: null,
    sessionId: null,
    attemptNumber: 1,
    testId,
    origin: "telemetry",
    startedAt: new Date("2026-09-01T10:00:00"),
    finishedAt: new Date("2026-09-01T10:20:00"),
    lastActivityAt: new Date("2026-09-01T10:20:00"),
  });
  for (const a of answers) {
    await h.current!.db.insert(scormAnswers).values({
      id: randomUUID(),
      attemptId,
      questionId: a.questionId,
      questionPrompt: "?",
      questionType: "single",
      userAnswerJson: { index: 0 },
      result: "correct",
      isCorrect: true,
      latencyMs: a.latency,
      answeredAt: new Date("2026-09-01T10:05:00"),
    });
  }
}

describe("величины для карточки задания", () => {
  it("экспозиция в ЭТОМ тесте считается отдельно от показов в других", async () => {
    await repo.recordDeliveries(["q1"], TEST_A, new Date("2026-09-01"));
    await repo.recordDeliveries(["q1"], TEST_A, new Date("2026-09-02"));
    await repo.recordDeliveries(["q1"], TEST_B, new Date("2026-09-03"));

    const own = await repo.getDeliveryCountsForTest(["q1"], TEST_A, WINDOW_START);
    const global = await repo.getDeliveryCounts(["q1"], WINDOW_START);

    expect(own.get("q1")).toBe(2);
    expect(global.get("q1")).toBe(3);
  });

  it("считает, в скольких ДРУГИХ тестах задание выдавалось", async () => {
    await repo.recordDeliveries(["q1"], TEST_A, new Date("2026-09-01"));
    await repo.recordDeliveries(["q1"], TEST_B, new Date("2026-09-01"));
    await repo.recordDeliveries(["q1"], "test-c", new Date("2026-09-01"));

    const others = await repo.getOtherTestsCount(["q1"], TEST_A, WINDOW_START);
    expect(others.get("q1")).toBe(2);
  });

  it("задание только своего теста даёт ноль других", async () => {
    await repo.recordDeliveries(["q1"], TEST_A, new Date("2026-09-01"));
    const others = await repo.getOtherTestsCount(["q1"], TEST_A, WINDOW_START);
    expect(others.get("q1") ?? 0).toBe(0);
  });

  it("медиана времени считается по измеренным ответам этого теста", async () => {
    await attemptWith(TEST_A, [{ questionId: "q1", latency: 10000 }]);
    await attemptWith(TEST_A, [{ questionId: "q1", latency: 20000 }]);
    await attemptWith(TEST_A, [{ questionId: "q1", latency: 90000 }]);

    const stats = await repo.getLatencyStats(["q1"], TEST_A, WINDOW_START);
    expect(stats.get("q1")).toEqual({ medianMs: 20000, sampleSize: 3 });
  });

  it("неизмеренные ответы в выборку не идут — иначе медиана врёт", async () => {
    await attemptWith(TEST_A, [{ questionId: "q1", latency: 10000 }]);
    await attemptWith(TEST_A, [{ questionId: "q1", latency: null }]);
    await attemptWith(TEST_A, [{ questionId: "q1", latency: null }]);

    const stats = await repo.getLatencyStats(["q1"], TEST_A, WINDOW_START);
    expect(stats.get("q1")).toEqual({ medianMs: 10000, sampleSize: 1 });
  });

  it("медиана устойчива к брошенной вкладке", async () => {
    // Четыре быстрых ответа и один «ушёл на обед»: среднее уехало бы за восемь минут.
    for (const ms of [20000, 22000, 25000, 27000, 2_400_000]) {
      await attemptWith(TEST_A, [{ questionId: "q1", latency: ms }]);
    }
    const stats = await repo.getLatencyStats(["q1"], TEST_A, WINDOW_START);
    expect(stats.get("q1")!.medianMs).toBe(25000);
  });

  it("задание без измерений в карте отсутствует", async () => {
    await attemptWith(TEST_A, [{ questionId: "q1", latency: null }]);
    const stats = await repo.getLatencyStats(["q1"], TEST_A, WINDOW_START);
    expect(stats.has("q1")).toBe(false);
  });

  it("чужой тест в выборку времени не попадает", async () => {
    await attemptWith(TEST_B, [{ questionId: "q1", latency: 10000 }]);
    const stats = await repo.getLatencyStats(["q1"], TEST_A, WINDOW_START);
    expect(stats.has("q1")).toBe(false);
  });
});
