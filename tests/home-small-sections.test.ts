/**
 * @module tests/home-small-sections
 *
 * PRD-25 FR-11/FR-12/FR-13: the three counter-style home sections. These carry
 * real rules that no other suite exercises — the «active assignment» definition,
 * the personal-only «not started» count, the 30-day window with its scope filter
 * and its division-by-zero guard, and the template lifecycle filter.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { storageMock, dbMock, scopeMock } = vi.hoisted(() => ({
  storageMock: {
    getAllAssignments: vi.fn(),
    getAttemptsByUserAndTest: vi.fn(),
    getUsers: vi.fn(),
    getAllAttempts: vi.fn(),
  },
  dbMock: { rows: [] as Array<{ name: string }>, where: vi.fn() },
  scopeMock: { readableTestScope: vi.fn() },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/services/test-access", () => scopeMock);
vi.mock("../server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (...args: unknown[]) => {
          dbMock.where(...args);
          return Promise.resolve(dbMock.rows);
        },
      }),
    }),
  },
}));

import { buildPeople } from "../server/services/home/people";
import { buildSummary } from "../server/services/home/summary";
import { buildMaterials } from "../server/services/home/materials";

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const daysAhead = (n: number) => new Date(Date.now() + n * DAY);

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getAllAssignments.mockResolvedValue([]);
  storageMock.getAttemptsByUserAndTest.mockResolvedValue([]);
  storageMock.getUsers.mockResolvedValue([]);
  storageMock.getAllAttempts.mockResolvedValue([]);
  scopeMock.readableTestScope.mockResolvedValue({ all: true, ids: new Set() });
  dbMock.rows = [];
});

describe("buildPeople", () => {
  it("counts an assignment without a due date as active", async () => {
    storageMock.getAllAssignments.mockResolvedValue([
      { id: "a1", testId: "t1", userId: "u1", groupId: null, dueDate: null },
    ]);

    const result = await buildPeople();

    expect(result.activeAssignments).toBe(1);
  });

  it("drops an assignment whose due date has passed", async () => {
    storageMock.getAllAssignments.mockResolvedValue([
      { id: "a1", testId: "t1", userId: "u1", groupId: null, dueDate: daysAgo(1) },
      { id: "a2", testId: "t2", userId: "u2", groupId: null, dueDate: daysAhead(1) },
    ]);

    const result = await buildPeople();

    expect(result.activeAssignments).toBe(1);
  });

  it("counts «not started» only for personal assignments, never for group ones", async () => {
    storageMock.getAllAssignments.mockResolvedValue([
      { id: "a1", testId: "t1", userId: "u1", groupId: null, dueDate: null },
      // A group assignment carries a NULL userId and must not be counted.
      { id: "a2", testId: "t2", userId: null, groupId: "g1", dueDate: null },
    ]);
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([]);

    const result = await buildPeople();

    expect(result.notStarted).toBe(1);
    expect(storageMock.getAttemptsByUserAndTest).toHaveBeenCalledTimes(1);
    expect(storageMock.getAttemptsByUserAndTest).toHaveBeenCalledWith("u1", "t1");
  });

  it("does not count an assignment the learner has already attempted", async () => {
    storageMock.getAllAssignments.mockResolvedValue([
      { id: "a1", testId: "t1", userId: "u1", groupId: null, dueDate: null },
    ]);
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([{ id: "att1" }]);

    const result = await buildPeople();

    expect(result.notStarted).toBe(0);
  });

  it("counts only users created within the last seven days", async () => {
    storageMock.getUsers.mockResolvedValue([
      { id: "u1", createdAt: daysAgo(1) },
      { id: "u2", createdAt: daysAgo(6) },
      { id: "u3", createdAt: daysAgo(30) },
    ]);

    const result = await buildPeople();

    expect(result.newUsers7d).toBe(2);
  });
});

describe("buildSummary", () => {
  const attempt = (over: Record<string, unknown> = {}) => ({
    id: "att1",
    userId: "u1",
    testId: "t1",
    finishedAt: daysAgo(1),
    resultJson: { overallPercent: 80, overallPassed: true },
    ...over,
  });

  it("returns zeros instead of dividing by zero on an empty selection", async () => {
    storageMock.getAllAttempts.mockResolvedValue([]);

    const result = await buildSummary("u1", ["administrator"]);

    expect(result).toEqual({ attempts30d: 0, passRate: 0, avgPercent: 0, activeUsers: 0 });
  });

  it("ignores unfinished attempts and anything older than the window", async () => {
    storageMock.getAllAttempts.mockResolvedValue([
      attempt({ id: "in-window" }),
      attempt({ id: "unfinished", finishedAt: null }),
      attempt({ id: "too-old", finishedAt: daysAgo(31) }),
    ]);

    const result = await buildSummary("u1", ["administrator"]);

    expect(result.attempts30d).toBe(1);
  });

  it("keeps only attempts of tests inside the caller's scope", async () => {
    scopeMock.readableTestScope.mockResolvedValue({ all: false, ids: new Set(["t1"]) });
    storageMock.getAllAttempts.mockResolvedValue([
      attempt({ id: "mine", testId: "t1" }),
      attempt({ id: "someone-elses", testId: "t2" }),
      attempt({ id: "orphan", testId: null }),
    ]);

    const result = await buildSummary("u1", ["author"]);

    expect(result.attempts30d).toBe(1);
  });

  it("rounds the pass rate and the average percent to whole percents", async () => {
    storageMock.getAllAttempts.mockResolvedValue([
      attempt({ id: "a", userId: "u1", resultJson: { overallPercent: 80, overallPassed: true } }),
      attempt({ id: "b", userId: "u2", resultJson: { overallPercent: 70, overallPassed: false } }),
      attempt({ id: "c", userId: "u2", resultJson: { overallPercent: 61, overallPassed: false } }),
    ]);

    const result = await buildSummary("u1", ["administrator"]);

    expect(result.passRate).toBe(33);
    expect(result.avgPercent).toBe(70);
    expect(result.activeUsers).toBe(2);
  });

  it("treats an attempt without a result as zero percent instead of failing", async () => {
    storageMock.getAllAttempts.mockResolvedValue([attempt({ resultJson: null })]);

    const result = await buildSummary("u1", ["administrator"]);

    expect(result.attempts30d).toBe(1);
    expect(result.avgPercent).toBe(0);
    expect(result.passRate).toBe(0);
  });
});

describe("buildMaterials", () => {
  it("returns the names of templates in the active lifecycle state", async () => {
    dbMock.rows = [{ name: "Стандартный" }, { name: "Сертификация (РТК)" }];

    const result = await buildMaterials(["administrator"]);

    expect(result.activeTemplates).toEqual(["Стандартный", "Сертификация (РТК)"]);
    expect(result.showTemplates).toBe(true);
  });

  it("reports an empty list rather than failing when nothing is active", async () => {
    dbMock.rows = [];

    const result = await buildMaterials(["administrator"]);

    expect(result.activeTemplates).toEqual([]);
  });

  it("offers every document on the consolidated download route", async () => {
    const result = await buildMaterials(["administrator"]);

    expect(result.docs.map((d) => d.id)).toEqual([
      "test-authoring",
      "import-workbook",
      "template-development",
      "template-spec",
    ]);
    expect(result.docs.every((d) => d.href === `/api/docs/${d.id}`)).toBe(true);
  });

  it("shows an author only the documents their rights cover", async () => {
    const result = await buildMaterials(["author"]);

    // An author holds tests.read and questions.importExport but not
    // adminTemplates.manage, so the two template documents are withheld.
    expect(result.docs.map((d) => d.id)).toEqual(["test-authoring", "import-workbook"]);
  });

  it("does not query templates for a reader who does not manage them", async () => {
    dbMock.rows = [{ name: "Стандартный" }];

    const result = await buildMaterials(["author"]);

    expect(result.showTemplates).toBe(false);
    expect(result.activeTemplates).toEqual([]);
    expect(dbMock.where).not.toHaveBeenCalled();
  });

  it("gives a pure learner nothing to download", async () => {
    const result = await buildMaterials(["learner"]);

    expect(result.docs).toEqual([]);
  });
});
