/**
 * @module tests/analytics-suspicious-refresh
 * @description Э3.4: фоновый пересчёт числа вопросов под подозрением по тестам; PRD-70 FR-04 —
 * вместе с качеством вопросов теста и пулами выдачи всех тестов.
 *
 * Пересчитываются только тесты с новыми прохождениями или правкой; тест без прохождений из сводки
 * уходит; сбой одного теста не роняет проход; повторный вызов во время прохода ничего не делает.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { observationsDouble } from "./helpers/observations-double";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getAllAttempts: vi.fn(), async getAttemptsByTests(ids: string[]) { return ((await this.getAllAttempts()) ?? []).filter((a: { testId: string }) => ids.includes(a.testId)); }, getAllScormAttempts: vi.fn(), getScormPackages: vi.fn(),
    getUser: vi.fn(), getTest: vi.fn().mockResolvedValue(undefined), selectObservations: vi.fn(),
    getTests: vi.fn(),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import {
  refreshSuspicious,
  resetSuspiciousEntries,
  suspiciousEntry,
  testPools,
  testQualities,
} from "../server/routes/analytics/suspicious-refresh";
// eslint-disable-next-line import/first -- must import AFTER vi.mock
import type { TestQuality } from "../server/services/analytics/question-quality";

/** Качество теста, как его отдаёт расчёт: число под подозрением, объём и пул. */
function quality(testId: string, suspicious: number, itemCount: number, pool: string[] = []): TestQuality {
  return { testId, items: [], pool, suspicious, itemCount };
}

/** Пул теста без прохождений — подменённый. */
const noPool = async () => [];

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
  storageMock.getTests.mockResolvedValue([
    { id: "t1", version: 1, updatedAt: new Date("2026-09-01T00:00:00Z") },
    { id: "t2", version: 1, updatedAt: new Date("2026-09-01T00:00:00Z") },
  ]);
  storageMock.getAllAttempts.mockResolvedValue([
    attempt("a1", "t1", "2026-10-01T10:00:00Z"),
    attempt("a2", "t1", "2026-10-02T10:00:00Z"),
    attempt("a3", "t2", "2026-10-01T12:00:00Z"),
  ]);
});

describe("refreshSuspicious (Э3.4)", () => {
  it("считает каждый тест с прохождениями и хранит число, объём и время", async () => {
    const compute = vi.fn(async (testId: string) => quality(testId, testId === "t1" ? 3 : 0, 10));

    await refreshSuspicious(compute, noPool);

    expect(compute).toHaveBeenCalledTimes(2);
    expect(suspiciousEntry("t1")).toMatchObject({ count: 3, items: 10, passages: 2, lastAttemptAt: "2026-10-02T10:00:00.000Z" });
    expect(suspiciousEntry("t2")).toMatchObject({ count: 0, passages: 1 });
  });

  it("второй проход пересчитывает только тест с новым прохождением", async () => {
    const compute = vi.fn(async (testId: string) => quality(testId, 1, 5));
    await refreshSuspicious(compute, noPool);
    compute.mockClear();

    storageMock.getAllAttempts.mockResolvedValue([
      attempt("a1", "t1", "2026-10-01T10:00:00Z"),
      attempt("a2", "t1", "2026-10-02T10:00:00Z"),
      attempt("a3", "t2", "2026-10-01T12:00:00Z"),
      attempt("a4", "t2", "2026-10-03T09:00:00Z"),
    ]);
    await refreshSuspicious(compute, noPool);

    expect(compute).toHaveBeenCalledTimes(1);
    expect(compute).toHaveBeenCalledWith("t2");
  });

  it("сбой одного теста не роняет проход, тест без прохождений уходит", async () => {
    await refreshSuspicious(async (testId) => quality(testId, 2, 4), noPool);
    storageMock.getAllAttempts.mockResolvedValue([attempt("a5", "t1", "2026-10-04T10:00:00Z")]);

    await refreshSuspicious(async () => { throw new Error("сбой"); }, noPool);

    // t1 не пересчитан из-за сбоя — прежнее число остаётся; t2 прохождений больше нет — ушёл.
    expect(suspiciousEntry("t1")).toMatchObject({ count: 2 });
    expect(suspiciousEntry("t2")).toBeUndefined();
  });

  it("повторный вызов во время прохода ничего не делает", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const compute = vi.fn(async (testId: string) => { await gate; return quality(testId, 1, 1); });

    const first = refreshSuspicious(compute, noPool);
    await refreshSuspicious(compute, noPool);
    release();
    await first;

    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("правка теста — повод пересчитать, даже без новых прохождений (PRD-70 FR-04)", async () => {
    const compute = vi.fn(async (testId: string) => quality(testId, 1, 5));
    await refreshSuspicious(compute, noPool);
    compute.mockClear();

    storageMock.getTests.mockResolvedValue([
      { id: "t1", version: 2, updatedAt: new Date("2026-10-05T00:00:00Z") },
      { id: "t2", version: 1, updatedAt: new Date("2026-09-01T00:00:00Z") },
    ]);
    await refreshSuspicious(compute, noPool);

    expect(compute).toHaveBeenCalledTimes(1);
    expect(compute).toHaveBeenCalledWith("t1");
  });

  it("хранит качество вопросов и пулы: у теста с прохождениями — из расчёта, без них — свой (PRD-70 §3.3)", async () => {
    storageMock.getTests.mockResolvedValue([
      { id: "t1", version: 1, updatedAt: new Date("2026-09-01T00:00:00Z") },
      { id: "t2", version: 1, updatedAt: new Date("2026-09-01T00:00:00Z") },
      { id: "t3", version: 1, updatedAt: new Date("2026-09-01T00:00:00Z") },
    ]);
    const poolOf = vi.fn(async () => ["q9"]);

    await refreshSuspicious(async (testId) => quality(testId, 0, 1, [`${testId}-q`]), poolOf);

    expect(testQualities().map(q => q.testId).sort()).toEqual(["t1", "t2"]);
    expect(poolOf).toHaveBeenCalledTimes(1);
    expect(poolOf).toHaveBeenCalledWith("t3");
    expect(Object.fromEntries(testPools())).toEqual({ t1: ["t1-q"], t2: ["t2-q"], t3: ["q9"] });
  });
});
