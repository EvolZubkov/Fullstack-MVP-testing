/**
 * @module server/services/analytics/__tests__/test-summary
 * @description PRD-56 FR-25: сводка теста считается по ВСЕМ его прохождениям.
 *
 * Дефект, ради которого затеян этап: страница теста читала только веб-попытки, и на тесте,
 * который проходят в LMS, её числа расходились с разделом «Аналитика». Здесь проверяется
 * половина починки, которую можно проверить без базы: из одного и того же набора наблюдений
 * получается одна и та же сводка, откуда бы наблюдения ни приехали.
 */

import { describe, expect, it } from "vitest";

import type { Observation } from "../observations";
import { summariseObservations } from "../test-summary";

function observation(over: Partial<Observation> = {}): Observation {
  return {
    id: "o1",
    source: "web",
    testId: "test-1",
    userId: "user-1",
    participant: "Морозова Анна",
    participantKey: null,
    participantId: "user-1",
    groupId: null,
    startedAt: new Date("2026-09-11T14:00:00Z"),
    finishedAt: new Date("2026-09-11T14:20:00Z"),
    durationMs: 20 * 60 * 1000,
    percent: 80,
    passed: true,
    outcome: "passed",
    snapshotId: null,
    formId: null,
    adaptive: false,
    earnedPoints: 16,
    possiblePoints: 20,
    ...over,
  };
}

describe("summariseObservations", () => {
  it("считает прохождения всех источников, а не только веба", () => {
    const summary = summariseObservations([
      observation({ id: "w", source: "web" }),
      observation({ id: "t", source: "telemetry", userId: null, participantKey: "aa", participantId: "aa" }),
      observation({ id: "i", source: "import", userId: null, participantKey: "bb", participantId: "bb" }),
    ]);

    expect(summary.completedAttempts).toBe(3);
  });

  it("считает участников по людям и псевдонимам, не задваивая одного", () => {
    const summary = summariseObservations([
      observation({ id: "a", userId: "user-1" }),
      observation({ id: "b", userId: "user-1" }),
      observation({ id: "c", source: "import", userId: null, participantKey: "bb", participantId: "bb" }),
    ]);

    expect(summary.uniqueParticipants).toBe(2);
  });

  it("не включает незавершённые прохождения в средние", () => {
    const summary = summariseObservations([
      observation({ id: "a", percent: 80 }),
      observation({
        id: "b", outcome: "incomplete", finishedAt: null,
        percent: null, passed: null, durationMs: null,
      }),
    ]);

    expect(summary.totalAttempts).toBe(2);
    expect(summary.completedAttempts).toBe(1);
    expect(summary.avgPercent).toBe(80);
  });

  it("отвечает null там, где оценивать было нечего", () => {
    const summary = summariseObservations([
      observation({ id: "a", percent: null, passed: null, outcome: "completed" }),
      observation({ id: "b", percent: null, passed: null, outcome: "completed" }),
    ]);

    expect(summary.avgPercent).toBeNull();
    expect(summary.passRate).toBeNull();
    expect(summary.completedAttempts).toBe(2);
  });

  it("считает долю сдавших только по тем, кому вынесли вердикт", () => {
    const summary = summariseObservations([
      observation({ id: "a", passed: true, outcome: "passed" }),
      observation({ id: "b", passed: false, outcome: "failed", percent: 40 }),
      observation({ id: "c", passed: null, outcome: "completed", percent: null }),
    ]);

    expect(summary.judgedAttempts).toBe(2);
    expect(summary.passRate).toBe(50);
  });

  it("берёт медиану времени, а не среднее", () => {
    const minute = 60 * 1000;
    const summary = summariseObservations([
      observation({ id: "a", durationMs: 10 * minute }),
      observation({ id: "b", durationMs: 12 * minute }),
      // Ушедший на обед: среднее он сдвинул бы на часы, медиану — нет (решение PRD-55).
      observation({ id: "c", durationMs: 300 * minute }),
    ]);

    expect(summary.medianDurationMs).toBe(12 * minute);
  });

  it("на пустой выборке отвечает нулями и null, а не делением на ноль", () => {
    const summary = summariseObservations([]);

    expect(summary.totalAttempts).toBe(0);
    expect(summary.avgPercent).toBeNull();
    expect(summary.passRate).toBeNull();
    expect(summary.medianDurationMs).toBeNull();
  });

  it("считает баллы: среднее набранное и наибольшее достижимое", () => {
    const summary = summariseObservations([
      observation({ id: "a", earnedPoints: 15, possiblePoints: 20 }),
      observation({ id: "b", earnedPoints: 9, possiblePoints: 20 }),
      // Вариант подлиннее: достижимый максимум у теста с вариантами не один.
      observation({ id: "c", earnedPoints: 21, possiblePoints: 30 }),
    ]);

    expect(summary.avgScore).toBe(15);
    expect(summary.maxScore).toBe(30);
  });

  it("отдаёт и среднее время, и медиану — они отвечают на разные вопросы", () => {
    const minute = 60 * 1000;
    const summary = summariseObservations([
      observation({ id: "a", durationMs: 10 * minute }),
      observation({ id: "b", durationMs: 20 * minute }),
    ]);

    expect(summary.avgDurationMs).toBe(15 * minute);
    expect(summary.medianDurationMs).toBe(15 * minute);
  });

  it("не мешает адаптивные прохождения в средний процент", () => {
    // У адаптивного теста результат — достигнутый уровень, а не доля; усреднять его
    // вместе с процентами обычных прохождений значит складывать разные величины.
    const summary = summariseObservations([
      observation({ id: "a", percent: 80 }),
      observation({ id: "b", adaptive: true, percent: 0, passed: true }),
    ]);

    expect(summary.avgPercent).toBe(80);
    expect(summary.adaptiveAttempts).toBe(1);
    expect(summary.adaptivePassed).toBe(1);
  });
});
