/**
 * PRD-25: home-page section builders. Storage is mocked — these tests pin the
 * shaping and ordering rules, not the DAL.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getAssignedTestsForUser: vi.fn(),
    getTestSections: vi.fn(),
    getAttemptsByUserAndTest: vi.fn(),
    getAttemptsByUser: vi.fn(),
    getTest: vi.fn(),
  },
}));
vi.mock("../server/storage", () => ({ storage: storageMock }));

import { buildAssigned, buildRecentResults } from "../server/services/home/assigned";

const t1 = { id: "t1", title: "JS", description: null, maxAttempts: 2, retakePolicyJson: null };
const t2 = { id: "t2", title: "TS", description: null, maxAttempts: null, retakePolicyJson: null };

/** `YYYY-MM-DD` shifted from today, matching the UTC calendar-day cooldown math. */
function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86400000);
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getTestSections.mockResolvedValue([{ drawCount: 5 }]);
});

describe("buildAssigned", () => {
  it("puts a test with an in-progress attempt first", async () => {
    storageMock.getAssignedTestsForUser.mockResolvedValue([t1, t2]);
    storageMock.getAttemptsByUserAndTest.mockImplementation(async (_u: string, testId: string) =>
      testId === "t2" ? [{ id: "a2", finishedAt: null, variantJson: null }] : [],
    );

    const result = await buildAssigned("u1");

    expect(result.items[0].testId).toBe("t2");
    expect(result.items[0].inProgressAttemptId).toBe("a2");
    expect(result.items[1].testId).toBe("t1");
    expect(result.items[1].inProgressAttemptId).toBeNull();
    expect(result.total).toBe(2);
  });

  it("caps the list at four items but reports the true total", async () => {
    storageMock.getAssignedTestsForUser.mockResolvedValue([t1, t2, t1, t2, t1, t2]);
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([]);

    const result = await buildAssigned("u1");

    expect(result.items).toHaveLength(4);
    expect(result.total).toBe(6);
  });

  it("sums drawCount across sections into questionCount", async () => {
    storageMock.getAssignedTestsForUser.mockResolvedValue([t1]);
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([]);
    storageMock.getTestSections.mockResolvedValue([{ drawCount: 5 }, { drawCount: 3 }]);

    const result = await buildAssigned("u1");

    expect(result.items[0].questionCount).toBe(8);
    expect(result.items[0].completedAttempts).toBe(0);
    expect(result.items[0].maxAttempts).toBe(2);
  });

  it("reports blockedUntil while the retake cooldown is closed", async () => {
    const gated = { ...t1, retakePolicyJson: { enabled: true, cooldownPeriodDays: 30 } };
    storageMock.getAssignedTestsForUser.mockResolvedValue([gated]);
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([
      { id: "a1", finishedAt: daysAgo(1), resultJson: null },
    ]);

    const result = await buildAssigned("u1");

    const expected = new Date(daysAgo(1).getTime() + 30 * 86400000).toISOString().slice(0, 10);
    expect(result.items[0].blockedUntil).toBe(expected);
    expect(result.items[0].completedAttempts).toBe(1);
  });

  it("leaves blockedUntil null once the cooldown has elapsed", async () => {
    const gated = { ...t1, retakePolicyJson: { enabled: true, cooldownPeriodDays: 2 } };
    storageMock.getAssignedTestsForUser.mockResolvedValue([gated]);
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([
      { id: "a1", finishedAt: daysAgo(10), resultJson: null },
    ]);

    const result = await buildAssigned("u1");

    expect(result.items[0].blockedUntil).toBeNull();
  });

  it("leaves blockedUntil null when no retake policy is configured", async () => {
    storageMock.getAssignedTestsForUser.mockResolvedValue([t1]);
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([
      { id: "a1", finishedAt: daysAgo(0), resultJson: null },
    ]);

    const result = await buildAssigned("u1");

    expect(result.items[0].blockedUntil).toBeNull();
  });
});

describe("buildRecentResults", () => {
  it("returns the three most recent finished attempts, newest first", async () => {
    storageMock.getAttemptsByUser.mockResolvedValue([
      { id: "a1", testId: "t1", finishedAt: new Date("2026-01-01"), resultJson: { overallPercent: 50, overallPassed: false } },
      { id: "a2", testId: "t1", finishedAt: null, resultJson: null },
      { id: "a3", testId: "t1", finishedAt: new Date("2026-03-01"), resultJson: { overallPercent: 90, overallPassed: true } },
      { id: "a4", testId: "t1", finishedAt: new Date("2026-02-01"), resultJson: { overallPercent: 70, overallPassed: true } },
      { id: "a5", testId: "t1", finishedAt: new Date("2025-12-01"), resultJson: { overallPercent: 10, overallPassed: false } },
    ]);
    storageMock.getTest.mockResolvedValue({ id: "t1", title: "JS" });

    const result = await buildRecentResults("u1");

    expect(result.items.map((i) => i.attemptId)).toEqual(["a3", "a4", "a1"]);
    expect(result.items[0].percent).toBe(90);
    expect(result.items[0].passed).toBe(true);
    expect(result.items[0].testTitle).toBe("JS");
  });

  it("survives an attempt whose resultJson is missing", async () => {
    storageMock.getAttemptsByUser.mockResolvedValue([
      { id: "a1", testId: "t1", finishedAt: new Date("2026-01-01"), resultJson: null },
      { id: "a2", testId: "t1", finishedAt: new Date("2026-02-01"), resultJson: {} },
    ]);
    storageMock.getTest.mockResolvedValue({ id: "t1", title: "JS" });

    const result = await buildRecentResults("u1");

    expect(result.items).toHaveLength(2);
    expect(result.items[0].percent).toBe(0);
    expect(result.items[0].passed).toBeNull();
    expect(result.items[1].percent).toBe(0);
    expect(result.items[1].passed).toBeNull();
  });

  it("survives a deleted test behind the attempt", async () => {
    storageMock.getAttemptsByUser.mockResolvedValue([
      { id: "a1", testId: "gone", finishedAt: new Date("2026-01-01"), resultJson: { overallPercent: 42, overallPassed: false } },
    ]);
    storageMock.getTest.mockResolvedValue(undefined);

    const result = await buildRecentResults("u1");

    expect(result.items).toHaveLength(1);
    expect(result.items[0].testTitle).toBeTruthy();
    expect(result.items[0].percent).toBe(42);
  });
});
