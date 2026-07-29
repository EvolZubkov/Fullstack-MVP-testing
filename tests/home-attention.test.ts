/**
 * PRD-25 section 5: attention rules. Pure shaping over already-built section
 * data — no storage, no network, so the rules can be pinned exactly.
 */
import { describe, it, expect } from "vitest";
import { buildAttention } from "../server/services/home/attention";
import type { AssignedTestItem, MyTestItem } from "@shared/home/contract";

const assigned = (over: Partial<AssignedTestItem> = {}): AssignedTestItem => ({
  testId: "t1",
  title: "JS",
  description: null,
  questionCount: 5,
  completedAttempts: 0,
  maxAttempts: null,
  inProgressAttemptId: null,
  blockedUntil: null,
  ...over,
});

const myTest = (over: Partial<MyTestItem> = {}): MyTestItem => ({
  testId: "t1",
  title: "JS",
  status: "draft",
  sectionCount: 1,
  questionCount: 0,
  updatedAt: "2026-01-01T00:00:00.000Z",
  owned: true,
  flags: [],
  canEdit: true,
  canDebug: true,
  canExport: true,
  ...over,
});

describe("buildAttention", () => {
  it("raises an in-progress attempt with a resume link", () => {
    const rows = buildAttention({ assigned: [assigned({ inProgressAttemptId: "a1" })] });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("attempt-in-progress");
    expect(rows[0].href).toBe("/learner/test/t1");
    expect(rows[0].action).toBe("Продолжить");
    expect(rows[0].severity).toBe("info");
  });

  it("suppresses the retake row while an attempt is still in progress", () => {
    const rows = buildAttention({
      assigned: [assigned({ inProgressAttemptId: "a1", completedAttempts: 1, maxAttempts: 3 })],
    });
    expect(rows.map((r) => r.kind)).toEqual(["attempt-in-progress"]);
  });

  it("does not raise a retake row while the cooldown is still closed", () => {
    const rows = buildAttention({
      assigned: [assigned({ blockedUntil: "2030-01-01", completedAttempts: 1 })],
    });
    expect(rows).toHaveLength(0);
  });

  it("does not raise a retake row before the first completed attempt", () => {
    const rows = buildAttention({ assigned: [assigned({ completedAttempts: 0, maxAttempts: 3 })] });
    expect(rows).toHaveLength(0);
  });

  it("raises a retake row once the cooldown is open and attempts remain", () => {
    const rows = buildAttention({
      assigned: [assigned({ blockedUntil: null, completedAttempts: 1, maxAttempts: 3 })],
    });
    expect(rows.map((r) => r.kind)).toEqual(["retake-available"]);
    expect(rows[0].action).toBe("Пройти снова");
    expect(rows[0].subtitle).toContain("осталось 2 попытки");
  });

  it("raises a retake row when the attempt count is unlimited", () => {
    const rows = buildAttention({
      assigned: [assigned({ completedAttempts: 2, maxAttempts: null })],
    });
    expect(rows.map((r) => r.kind)).toEqual(["retake-available"]);
    expect(rows[0].subtitle).toBe("JS");
  });

  it("does not raise a retake row when attempts are exhausted", () => {
    const rows = buildAttention({ assigned: [assigned({ completedAttempts: 3, maxAttempts: 3 })] });
    expect(rows).toHaveLength(0);
  });

  it("turns test flags into rows with the editor link", () => {
    const rows = buildAttention({ myTests: [myTest({ flags: ["test-empty-draft"] })] });
    expect(rows[0].kind).toBe("test-empty-draft");
    expect(rows[0].href).toBe("/author/tests");
    expect(rows[0].title).toBe("Черновик без вопросов");
    expect(rows[0].action).toBe("Открыть редактор");
  });

  it("labels the pool drift without leaking the internal term", () => {
    const rows = buildAttention({ myTests: [myTest({ flags: ["test-pool-drift"] })] });
    expect(rows[0].title).toBe("Содержимое тем изменилось");
    expect(rows[0].action).toBe("Посмотреть расхождения");
    expect(rows[0].severity).toBe("warning");
    expect(`${rows[0].title} ${rows[0].subtitle}`.toLowerCase()).not.toContain("дрейф");
  });

  it("labels a test edited after publish as a warning", () => {
    const rows = buildAttention({ myTests: [myTest({ flags: ["test-edited-after-publish"] })] });
    expect(rows[0].title).toBe("Изменён после публикации");
    expect(rows[0].action).toBe("Опубликовать заново");
    expect(rows[0].severity).toBe("warning");
  });

  it("emits one row per flag of a test, with distinct ids", () => {
    const rows = buildAttention({
      myTests: [myTest({ flags: ["test-edited-after-publish", "test-pool-drift"] })],
    });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  });

  it("puts warnings above informational rows", () => {
    const rows = buildAttention({
      assigned: [assigned({ inProgressAttemptId: "a1" })],
      myTests: [myTest({ flags: ["test-empty-draft"] }), myTest({ testId: "t2", flags: ["test-pool-drift"] })],
      duplicateTopicGroups: 2,
    });
    expect(rows[0].kind).toBe("test-pool-drift");
    const severities = rows.map((r) => r.severity);
    expect(severities.indexOf("warning")).toBe(0);
    expect(severities.lastIndexOf("warning")).toBeLessThan(severities.indexOf("info"));
  });

  it("raises one row for the whole duplicate-topics report", () => {
    const rows = buildAttention({ duplicateTopicGroups: 3 });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("topic-duplicates");
    expect(rows[0].subtitle).toContain("3");
    expect(rows[0].action).toBe("Открыть отчёт");
  });

  it("stays silent when the duplicate report is empty", () => {
    expect(buildAttention({ duplicateTopicGroups: 0 })).toEqual([]);
  });

  it("raises one row for the not-started assignments", () => {
    const rows = buildAttention({ assignmentsNotStarted: 4 });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("assignment-not-started");
    expect(rows[0].subtitle).toContain("4");
  });

  it("stays silent about sections the user cannot see", () => {
    // No `duplicateTopicGroups` / `assignmentsNotStarted` key at all — the caller
    // omits what the user has no right to, and that is the section's only gate.
    expect(buildAttention({ myTests: [myTest()] })).toEqual([]);
  });

  it("returns an empty list when nothing needs attention", () => {
    expect(buildAttention({})).toEqual([]);
  });
});
