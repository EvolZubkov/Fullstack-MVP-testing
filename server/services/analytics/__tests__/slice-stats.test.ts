/**
 * @module server/services/analytics/__tests__/slice-stats
 * @description PRD-56 FR-06, FR-06c, FR-06d: разрез «срез × тест».
 *
 * Срез отвечает на «кого учили и с каким результатом». Проверяется и то, что он говорит, и то,
 * чего он не говорит: отклонений от невидимой величины в нём нет (FR-06c), а ниже порога
 * наблюдений процент не печатается вовсе (FR-06d).
 */

import { describe, expect, it } from "vitest";

import type { Observation } from "../observations";
import { summariseSlice } from "../slice-stats";

function observation(over: Partial<Observation> = {}): Observation {
  return {
    id: "o1",
    source: "web",
    testId: "test1",
    userId: "u1",
    participant: "Морозова Анна",
    participantKey: null,
    participantId: "u1",
    groupId: null,
    startedAt: new Date("2026-09-11T14:00:00Z"),
    finishedAt: new Date("2026-09-11T14:20:00Z"),
    durationMs: 1_200_000,
    percent: 80,
    passed: true,
    earnedPoints: 16,
    possiblePoints: 20,
    outcome: "passed",
    adaptive: false,
    snapshotId: null,
    formId: null,
    ...over,
  };
}

/** Двенадцать прохождений: выборка выше порога в десять. */
function enough(passedCount: number): Observation[] {
  return Array.from({ length: 12 }, (_, index) => observation({
    id: `o${index}`,
    participantId: `u${index}`,
    passed: index < passedCount,
    outcome: index < passedCount ? "passed" : "failed",
    percent: index < passedCount ? 80 : 40,
  }));
}

describe("summariseSlice", () => {
  it("считает объёмы: начато, завершено, сдали", () => {
    const stats = summariseSlice({
      observations: [
        ...enough(9),
        observation({ id: "running", outcome: "incomplete", finishedAt: null, percent: null, passed: null }),
      ],
      minObservations: 10,
    });

    expect(stats.started).toBe(13);
    expect(stats.completed).toBe(12);
    expect(stats.passed).toBe(9);
  });

  it("печатает проценты, когда прохождений хватает", () => {
    const stats = summariseSlice({ observations: enough(9), minObservations: 10 });

    expect(stats.passRate).toBe(75);
    expect(stats.avgPercent).toBeCloseTo((9 * 80 + 3 * 40) / 12, 5);
    expect(stats.enoughData).toBe(true);
  });

  it("ниже порога не печатает процент, а говорит «мало данных»", () => {
    // FR-06d: «33 % сдали» на трёх прохождениях — не статистика, а шум.
    const stats = summariseSlice({
      observations: [
        observation({ id: "a", participantId: "u1" }),
        observation({ id: "b", participantId: "u2", passed: false, outcome: "failed", percent: 40 }),
        observation({ id: "c", participantId: "u3", passed: false, outcome: "failed", percent: 30 }),
      ],
      minObservations: 10,
    });

    expect(stats.enoughData).toBe(false);
    expect(stats.passRate).toBeNull();
    expect(stats.avgPercent).toBeNull();
    // Объём остаётся: он и есть то, что читатель должен увидеть вместо процента.
    expect(stats.completed).toBe(3);
  });

  it("не выдумывает процент там, где оценивать было нечего", () => {
    const stats = summariseSlice({
      observations: Array.from({ length: 12 }, (_, i) => observation({
        id: `q${i}`, participantId: `u${i}`,
        outcome: "completed", passed: null, percent: null,
      })),
      minObservations: 10,
    });

    expect(stats.passRate).toBeNull();
    expect(stats.avgPercent).toBeNull();
    expect(stats.completed).toBe(12);
  });

  it("считает участников, а не прохождения", () => {
    const stats = summariseSlice({
      observations: [
        observation({ id: "a", participantId: "u1" }),
        observation({ id: "b", participantId: "u1" }),
        observation({ id: "c", participantId: "u2" }),
      ],
      minObservations: 10,
    });

    expect(stats.participants).toBe(2);
    expect(stats.started).toBe(3);
  });

  it("не сравнивает срез ни с чем: в ответе нет отклонений", () => {
    // FR-06c: список срезов показывает факты. Отклонение от невидимой на экране величины —
    // это то, из-за чего понятие «база» и убрали.
    const stats = summariseSlice({ observations: enough(9), minObservations: 10 });

    expect(Object.keys(stats).some(key => /delta|diff|base/i.test(key))).toBe(false);
  });

  it("на пустом срезе отвечает нулями и null, а не делением на ноль", () => {
    const stats = summariseSlice({ observations: [], minObservations: 10 });

    expect(stats).toMatchObject({
      started: 0, completed: 0, passed: 0, participants: 0,
      passRate: null, avgPercent: null, enoughData: false,
    });
  });
});
