/**
 * @module tests/retake-gate-assignment
 *
 * PRD-31 §3: the assignment is the unit of access. Barrier A (calendar cooldown)
 * gates the FIRST attempt of an assignment and is measured against attempts of
 * OTHER assignments; barrier B (hour interval) gates every later attempt and is
 * measured against the previous attempt of the SAME assignment. They never apply
 * at the same moment, which is what keeps barrier A from silently becoming a
 * between-attempts barrier again — the defect this PRD exists to fix.
 */
import { describe, it, expect } from "vitest";
import { decideRetake, countAttemptsInAssignment } from "../server/services/retake-gate";
import type { RetakePolicy } from "../shared/schema";

const NOW = new Date("2026-08-01T12:00:00.000Z");

const policy = (over: Partial<RetakePolicy> = {}): RetakePolicy =>
  ({
    enabled: true,
    cooldownPeriodDays: 30,
    gateMode: "before_internal_start",
    eligibilityPlugin: null,
    ...over,
  }) as RetakePolicy;

const intervalOnly = (hours: number): RetakePolicy =>
  policy({ enabled: false, cooldownPeriodDays: undefined, attemptInterval: { enabled: true, hours } });

describe("decideRetake — assignment model", () => {
  it("is inert when neither barrier is enabled", () => {
    const r = decideRetake(policy({ enabled: false, cooldownPeriodDays: undefined }), {
      currentAssignmentId: "a1",
      attempts: [{ assignmentId: "a1", finishedAt: new Date("2026-08-01T11:00:00.000Z") }],
      now: NOW,
    });
    expect(r.allowed).toBe(true);
  });

  it("is inert when the policy is absent altogether", () => {
    expect(decideRetake(null, { currentAssignmentId: null, attempts: [], now: NOW }).allowed).toBe(true);
  });

  it("barrier A does NOT block a repeat inside the current assignment", () => {
    const r = decideRetake(policy(), {
      currentAssignmentId: "a1",
      attempts: [{ assignmentId: "a1", finishedAt: new Date("2026-07-31T12:00:00.000Z") }],
      now: NOW,
    });
    expect(r.allowed).toBe(true);
  });

  it("barrier A blocks the FIRST attempt of a new assignment", () => {
    const r = decideRetake(policy(), {
      currentAssignmentId: "a2",
      attempts: [{ assignmentId: "a1", finishedAt: new Date("2026-07-31T12:00:00.000Z") }],
      now: NOW,
    });
    expect(r.allowed).toBe(false);
    expect(r.blockedBy).toBe("cooldown");
    expect(r.availableDate).toBe("2026-08-30");
    expect(r.daysUntil).toBe(29);
  });

  it("barrier B blocks a repeat inside the assignment until the hours elapse", () => {
    const r = decideRetake(intervalOnly(24), {
      currentAssignmentId: "a1",
      attempts: [{ assignmentId: "a1", finishedAt: new Date("2026-08-01T06:00:00.000Z") }],
      now: NOW,
    });
    expect(r.allowed).toBe(false);
    expect(r.blockedBy).toBe("attemptInterval");
    expect(r.availableAt).toBe("2026-08-02T06:00:00.000Z");
    expect(r.intervalHours).toBe(24);
  });

  it("barrier B opens once the interval has elapsed", () => {
    const r = decideRetake(intervalOnly(24), {
      currentAssignmentId: "a1",
      attempts: [{ assignmentId: "a1", finishedAt: new Date("2026-07-30T06:00:00.000Z") }],
      now: NOW,
    });
    expect(r.allowed).toBe(true);
  });

  it("barrier B ignores attempts of OTHER assignments", () => {
    const r = decideRetake(intervalOnly(24), {
      currentAssignmentId: "a2",
      attempts: [{ assignmentId: "a1", finishedAt: new Date("2026-08-01T11:00:00.000Z") }],
      now: NOW,
    });
    expect(r.allowed).toBe(true);
  });

  it("barrier B measures from the LATEST attempt inside the assignment", () => {
    const r = decideRetake(intervalOnly(24), {
      currentAssignmentId: "a1",
      attempts: [
        { assignmentId: "a1", finishedAt: new Date("2026-07-01T00:00:00.000Z") },
        { assignmentId: "a1", finishedAt: new Date("2026-08-01T06:00:00.000Z") },
      ],
      now: NOW,
    });
    expect(r.allowed).toBe(false);
    expect(r.availableAt).toBe("2026-08-02T06:00:00.000Z");
  });

  it("unfinished attempts move neither barrier", () => {
    const r = decideRetake(intervalOnly(24), {
      currentAssignmentId: "a1",
      attempts: [{ assignmentId: "a1", finishedAt: null }],
      now: NOW,
    });
    expect(r.allowed).toBe(true);
  });

  it("with both barriers on, a repeat inside the assignment answers to B only", () => {
    const both = policy({ attemptInterval: { enabled: true, hours: 24 } });
    const blocked = decideRetake(both, {
      currentAssignmentId: "a1",
      attempts: [{ assignmentId: "a1", finishedAt: new Date("2026-08-01T06:00:00.000Z") }],
      now: NOW,
    });
    expect(blocked.blockedBy).toBe("attemptInterval");
    // The 30-day cooldown would still be running here, and must NOT be consulted.
    const open = decideRetake(both, {
      currentAssignmentId: "a1",
      attempts: [{ assignmentId: "a1", finishedAt: new Date("2026-07-30T06:00:00.000Z") }],
      now: NOW,
    });
    expect(open.allowed).toBe(true);
  });

  it("the legacy NULL bucket behaves as one assignment", () => {
    const inside = decideRetake(intervalOnly(24), {
      currentAssignmentId: null,
      attempts: [{ assignmentId: null, finishedAt: new Date("2026-08-01T11:00:00.000Z") }],
      now: NOW,
    });
    expect(inside.allowed).toBe(false);
    expect(inside.blockedBy).toBe("attemptInterval");

    const acrossFromLegacy = decideRetake(policy(), {
      currentAssignmentId: "a1",
      attempts: [{ assignmentId: null, finishedAt: new Date("2026-07-31T12:00:00.000Z") }],
      now: NOW,
    });
    expect(acrossFromLegacy.blockedBy).toBe("cooldown");
  });

  it("an enabled but unconfigured cooldown decides nothing", () => {
    const r = decideRetake(policy({ cooldownPeriodDays: undefined }), {
      currentAssignmentId: "a2",
      attempts: [{ assignmentId: "a1", finishedAt: new Date("2026-07-31T12:00:00.000Z") }],
      now: NOW,
    });
    expect(r.allowed).toBe(true);
  });
});

describe("countAttemptsInAssignment", () => {
  const attempts = [
    { assignmentId: "a1", finishedAt: new Date("2026-07-01T00:00:00.000Z") },
    { assignmentId: "a1", finishedAt: null },
    { assignmentId: "a2", finishedAt: new Date("2026-07-02T00:00:00.000Z") },
    { assignmentId: null, finishedAt: new Date("2026-07-03T00:00:00.000Z") },
  ];

  it("counts only FINISHED attempts of the current assignment", () => {
    expect(countAttemptsInAssignment(attempts, "a1")).toBe(1);
    expect(countAttemptsInAssignment(attempts, "a2")).toBe(1);
    expect(countAttemptsInAssignment(attempts, "a3")).toBe(0);
  });

  it("counts the legacy NULL bucket as its own assignment", () => {
    expect(countAttemptsInAssignment(attempts, null)).toBe(1);
  });
});
