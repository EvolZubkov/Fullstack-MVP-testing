/**
 * PRD-25: home-page section builders. Storage is mocked — these tests pin the
 * shaping and ordering rules, not the DAL.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Role } from "@shared/access";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getAssignedTestsForUser: vi.fn(),
    getTestSections: vi.fn(),
    getAttemptsByUserAndTest: vi.fn(),
    getAttemptsByUser: vi.fn(),
    getTest: vi.fn(),
    getTests: vi.fn(),
    getTopics: vi.fn(),
    getQuestionsByTopic: vi.fn(),
  },
}));
vi.mock("../server/storage", () => ({ storage: storageMock }));

const { accessMock } = vi.hoisted(() => ({
  accessMock: {
    readableTestScope: vi.fn(),
    visibleTopicScope: vi.fn(),
    getPublicationState: vi.fn(),
  },
}));
vi.mock("../server/services/test-access", () => ({
  readableTestScope: accessMock.readableTestScope,
}));
vi.mock("../server/services/topic-access", () => ({
  visibleTopicScope: accessMock.visibleTopicScope,
}));
vi.mock("../server/services/test-snapshot", () => ({
  getPublicationState: accessMock.getPublicationState,
}));

import { buildAssigned, buildRecentResults } from "../server/services/home/assigned";
import { buildMyTests } from "../server/services/home/my-tests";
import { buildMyTopics } from "../server/services/home/my-topics";

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

/** An author holds tests.edit / tests.publish / tests.export.scorm. */
const AUTHOR: Role[] = ["author"];
/** A manager holds tests.read only — no edit, publish or export. */
const MANAGER: Role[] = ["manager"];

/** A test row as the DAL returns it, reduced to the fields the section reads. */
function testRow(id: string, updatedAt: string, over: Record<string, unknown> = {}) {
  return {
    id,
    title: id.toUpperCase(),
    status: "draft",
    ownerId: "u1",
    updatedAt: new Date(updatedAt),
    ...over,
  };
}

const CLEAN_STATE = { state: "draft", editedAfterPublish: false, poolDrift: false };

describe("buildMyTests", () => {
  beforeEach(() => {
    accessMock.readableTestScope.mockResolvedValue({ all: true, ids: new Set<string>() });
    accessMock.getPublicationState.mockResolvedValue(CLEAN_STATE);
  });

  it("sorts by updatedAt descending and caps at six with the true total", async () => {
    storageMock.getTests.mockResolvedValue([
      testRow("t3", "2026-03-01"),
      testRow("t7", "2026-07-01"),
      testRow("t1", "2026-01-01"),
      testRow("t5", "2026-05-01"),
      testRow("t2", "2026-02-01"),
      testRow("t6", "2026-06-01"),
      testRow("t4", "2026-04-01"),
    ]);

    const result = await buildMyTests("u1", AUTHOR);

    expect(result.items.map((i) => i.testId)).toEqual(["t7", "t6", "t5", "t4", "t3", "t2"]);
    expect(result.total).toBe(7);
  });

  it("keeps only tests inside the readable scope", async () => {
    accessMock.readableTestScope.mockResolvedValue({ all: false, ids: new Set(["t2"]) });
    storageMock.getTests.mockResolvedValue([
      testRow("t1", "2026-01-01"),
      testRow("t2", "2026-02-01"),
    ]);

    const result = await buildMyTests("u1", AUTHOR);

    expect(result.items.map((i) => i.testId)).toEqual(["t2"]);
    expect(result.total).toBe(1);
  });

  it("marks a test of another owner as not owned", async () => {
    storageMock.getTests.mockResolvedValue([
      testRow("mine", "2026-02-01", { ownerId: "u1" }),
      testRow("theirs", "2026-01-01", { ownerId: "u2" }),
    ]);

    const result = await buildMyTests("u1", AUTHOR);

    expect(result.items[0].owned).toBe(true);
    expect(result.items[1].owned).toBe(false);
  });

  it("counts sections and the drawn questions of a test", async () => {
    storageMock.getTests.mockResolvedValue([testRow("t1", "2026-01-01")]);
    storageMock.getTestSections.mockResolvedValue([{ drawCount: 5 }, { drawCount: 3 }]);

    const result = await buildMyTests("u1", AUTHOR);

    expect(result.items[0].sectionCount).toBe(2);
    expect(result.items[0].questionCount).toBe(8);
  });

  it("takes the status and the publication flags from the snapshot service", async () => {
    storageMock.getTests.mockResolvedValue([testRow("t1", "2026-01-01", { status: "published" })]);
    accessMock.getPublicationState.mockResolvedValue({
      state: "published_with_changes",
      editedAfterPublish: true,
      poolDrift: true,
    });

    const result = await buildMyTests("u1", AUTHOR);

    expect(result.items[0].status).toBe("published_with_changes");
    expect(result.items[0].flags).toEqual(
      expect.arrayContaining(["test-edited-after-publish", "test-pool-drift"]),
    );
  });

  it("flags a draft without questions as an empty draft", async () => {
    storageMock.getTests.mockResolvedValue([testRow("t1", "2026-01-01")]);
    storageMock.getTestSections.mockResolvedValue([]);

    const result = await buildMyTests("u1", AUTHOR);

    expect(result.items[0].flags).toEqual(["test-empty-draft"]);
  });

  it("hides the publication flags from a user without tests.publish", async () => {
    storageMock.getTests.mockResolvedValue([testRow("t1", "2026-01-01", { status: "published" })]);
    accessMock.getPublicationState.mockResolvedValue({
      state: "published_with_changes",
      editedAfterPublish: true,
      poolDrift: true,
    });

    const result = await buildMyTests("u1", MANAGER);

    expect(result.items[0].flags).toEqual([]);
    expect(result.items[0].canEdit).toBe(false);
    expect(result.items[0].canDebug).toBe(false);
    expect(result.items[0].canExport).toBe(false);
  });

  it("derives the actions from the capabilities of the roles", async () => {
    storageMock.getTests.mockResolvedValue([testRow("t1", "2026-01-01")]);

    const result = await buildMyTests("u1", AUTHOR);

    expect(result.items[0].canEdit).toBe(true);
    expect(result.items[0].canDebug).toBe(true);
    expect(result.items[0].canExport).toBe(true);
  });

  it("raises flagged tests to the top of the window", async () => {
    storageMock.getTests.mockResolvedValue([
      testRow("fresh", "2026-05-01"),
      testRow("stale", "2026-01-01", { status: "published" }),
    ]);
    accessMock.getPublicationState.mockImplementation(async (id: string) =>
      id === "stale"
        ? { state: "published_with_changes", editedAfterPublish: true, poolDrift: false }
        : CLEAN_STATE,
    );

    const result = await buildMyTests("u1", AUTHOR);

    expect(result.items.map((i) => i.testId)).toEqual(["stale", "fresh"]);
  });

  it("asks the snapshot service only about the six tests in the window (R-3)", async () => {
    storageMock.getTests.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => testRow(`t${i}`, `2026-01-${String(i + 1).padStart(2, "0")}`)),
    );

    const result = await buildMyTests("u1", AUTHOR);

    expect(result.total).toBe(20);
    expect(result.items).toHaveLength(6);
    expect(accessMock.getPublicationState).toHaveBeenCalledTimes(6);
  });
});

describe("buildMyTopics", () => {
  beforeEach(() => {
    accessMock.visibleTopicScope.mockResolvedValue({ all: true, ids: new Set<string>() });
    storageMock.getQuestionsByTopic.mockResolvedValue([]);
  });

  function topicRow(id: string, updatedAt: string, over: Record<string, unknown> = {}) {
    return {
      id,
      name: id.toUpperCase(),
      code: `code_${id}`,
      ownerId: "u1",
      updatedAt: new Date(updatedAt),
      ...over,
    };
  }

  it("sorts by updatedAt descending and caps at six with the true total", async () => {
    storageMock.getTopics.mockResolvedValue([
      topicRow("a3", "2026-03-01"),
      topicRow("a7", "2026-07-01"),
      topicRow("a1", "2026-01-01"),
      topicRow("a5", "2026-05-01"),
      topicRow("a2", "2026-02-01"),
      topicRow("a6", "2026-06-01"),
      topicRow("a4", "2026-04-01"),
    ]);

    const result = await buildMyTopics("u1", AUTHOR);

    expect(result.items.map((i) => i.topicId)).toEqual(["a7", "a6", "a5", "a4", "a3", "a2"]);
    expect(result.total).toBe(7);
  });

  it("keeps only topics inside the visible scope", async () => {
    accessMock.visibleTopicScope.mockResolvedValue({ all: false, ids: new Set(["a2"]) });
    storageMock.getTopics.mockResolvedValue([
      topicRow("a1", "2026-01-01"),
      topicRow("a2", "2026-02-01"),
    ]);

    const result = await buildMyTopics("u1", AUTHOR);

    expect(result.items.map((i) => i.topicId)).toEqual(["a2"]);
    expect(result.total).toBe(1);
  });

  it("counts the questions of a topic and keeps its code", async () => {
    storageMock.getTopics.mockResolvedValue([topicRow("a1", "2026-01-01")]);
    storageMock.getQuestionsByTopic.mockResolvedValue([{ id: "q1" }, { id: "q2" }, { id: "q3" }]);

    const result = await buildMyTopics("u1", AUTHOR);

    expect(result.items[0].questionCount).toBe(3);
    expect(result.items[0].code).toBe("code_a1");
    expect(result.items[0].name).toBe("A1");
  });

  it("marks a topic of another owner as not owned", async () => {
    storageMock.getTopics.mockResolvedValue([
      topicRow("mine", "2026-02-01", { ownerId: "u1" }),
      topicRow("theirs", "2026-01-01", { ownerId: "u2" }),
    ]);

    const result = await buildMyTopics("u1", AUTHOR);

    expect(result.items[0].owned).toBe(true);
    expect(result.items[1].owned).toBe(false);
  });
});
