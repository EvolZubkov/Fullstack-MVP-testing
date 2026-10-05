/**
 * @module tests/analytics-suspicious-refresh
 * @description Э3.4: фоновый пересчёт числа вопросов под подозрением по тестам.
 *
 * Пересчитываются только тесты с новыми прохождениями; тест без прохождений из сводки уходит;
 * сбой одного теста не роняет проход; повторный вызов во время прохода ничего не делает.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { observationsDouble } from "./helpers/observations-double";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getAllAttempts: vi.fn(), async getAttemptsByTests(ids: string[]) { return ((await this.getAllAttempts()) ?? []).filter((a: { testId: string }) => ids.includes(a.testId)); }, getAllScormAttempts: vi.fn(), getScormPackages: vi.fn(),
    getUser: vi.fn(), getTest: vi.fn().mockResolvedValue(undefined), selectObservations: vi.fn(),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { refreshSuspicious, resetSuspiciousEntries, suspiciousEntry } from "../server/routes/analytics/suspicious-refresh";

/** Завершённая веб-попытка теста, оконченная в `at`. */
function attempt(id: string, testId: string, at: string) {
  return {
    id, testId, userId: `u-${id}`, startedAt: new Date(at), finishedAt: new Date(at),
    answersJson: {}, variantJson: {},
    resultJson: { overallPercent: 80, overallPassed: true, totalEarnedPoints: 8, totalPossiblePoints: 10, mode: "standard" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetSuspiciousEntries();
  storageMock.selectObservations.mockImplementation(observationsDouble(storageMock as never));
  storageMock.getAllScormAttempts.mockResolvedValue([]);
  storageMock.getScormPackages.mockResolvedValue([]);
  storageMock.getUser.mockResolvedValue(undefined);
  storageMock.getAllAttempts.mockResolvedValue([
    attempt("a1", "t1", "2026-10-01T10:00:00Z"),
    attempt("a2", "t1", "2026-10-02T10:00:00Z"),
    attempt("a3", "t2", "2026-10-01T12:00:00Z"),
  ]);
});

describe("refreshSuspicious (Э3.4)", () => {
  it("считает каждый тест с прохождениями и хранит число, объём и время", async () => {
    const compute = vi.fn(async (testId: string) => ({ suspicious: testId === "t1" ? 3 : 0, items: 10 }));

    await refreshSuspicious(compute);

    expect(compute).toHaveBeenCalledTimes(2);
    expect(suspiciousEntry("t1")).toMatchObject({ count: 3, items: 10, passages: 2, lastAttemptAt: "2026-10-02T10:00:00.000Z" });
    expect(suspiciousEntry("t2")).toMatchObject({ count: 0, passages: 1 });
  });

  it("второй проход пересчитывает только тест с новым прохождением", async () => {
    const compute = vi.fn(async () => ({ suspicious: 1, items: 5 }));
    await refreshSuspicious(compute);
    compute.mockClear();

    storageMock.getAllAttempts.mockResolvedValue([
      attempt("a1", "t1", "2026-10-01T10:00:00Z"),
      attempt("a2", "t1", "2026-10-02T10:00:00Z"),
      attempt("a3", "t2", "2026-10-01T12:00:00Z"),
      attempt("a4", "t2", "2026-10-03T09:00:00Z"),
    ]);
    await refreshSuspicious(compute);

    expect(compute).toHaveBeenCalledTimes(1);
    expect(compute).toHaveBeenCalledWith("t2");
  });

  it("сбой одного теста не роняет проход, тест без прохождений уходит", async () => {
    await refreshSuspicious(async () => ({ suspicious: 2, items: 4 }));
    storageMock.getAllAttempts.mockResolvedValue([attempt("a5", "t1", "2026-10-04T10:00:00Z")]);

    await refreshSuspicious(async () => { throw new Error("сбой"); });

    // t1 не пересчитан из-за сбоя — прежнее число остаётся; t2 прохождений больше нет — ушёл.
    expect(suspiciousEntry("t1")).toMatchObject({ count: 2 });
    expect(suspiciousEntry("t2")).toBeUndefined();
  });

  it("повторный вызов во время прохода ничего не делает", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const compute = vi.fn(async () => { await gate; return { suspicious: 1, items: 1 }; });

    const first = refreshSuspicious(compute);
    await refreshSuspicious(compute);
    release();
    await first;

    expect(compute).toHaveBeenCalledTimes(2);
  });
});
