/**
 * @module tests/it/attempt-assignment-pin.it.test
 * @description PRD-31 (FR-12): an attempt is pinned to the assignment it was taken
 * under. The whole access model is scoped to that column — `maxAttempts` counts
 * inside the assignment, barrier B (the hour interval) measures inside it and
 * barrier A (the calendar cooldown) measures across it — so a `createAttempt` that
 * silently dropped the field left every row NULL while `getCurrentAssignmentId`
 * returned a real id. The scope then collapsed without a single error: `inside` was
 * always empty, so barrier B never fired, barrier A fired between EVERY attempt, and
 * the per-assignment counter never reached `maxAttempts`.
 *
 * A round-trip on a real DB is the only place this is provable: the route already
 * passed the value, and the loss happened in the INSERT statement.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { createHarness, type Harness } from "./db-harness";

const h = vi.hoisted(() => ({ current: null as Harness | null }));
vi.mock("../../server/db", () => ({
  get db() {
    if (!h.current) throw new Error("harness not initialized");
    return h.current.db;
  },
}));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { DatabaseStorage } from "../../server/storage";

let storage: DatabaseStorage;

beforeAll(async () => {
  h.current = await createHarness();
  storage = new DatabaseStorage();
});
afterAll(async () => {
  await h.current!.close();
});
beforeEach(async () => {
  await h.current!.reset();
});

/** Minimal attempt row; only the pinning columns matter here. */
function attemptRow(over: Record<string, unknown> = {}) {
  return {
    userId: randomUUID(),
    testId: randomUUID(),
    testVersion: 1,
    variantJson: { sections: [] },
    answersJson: null,
    resultJson: null,
    startedAt: new Date(),
    finishedAt: null,
    ...over,
  } as never;
}

describe("createAttempt — assignment pin (PRD-31 FR-12)", () => {
  it("persists the assignment the attempt was taken under", async () => {
    const assignmentId = randomUUID();
    const created = await storage.createAttempt(attemptRow({ assignmentId }));

    expect(created.assignmentId).toBe(assignmentId);
    // Read back rather than trusting the INSERT's own RETURNING: the defect was a
    // column missing from the statement, which a re-read catches unambiguously.
    expect((await storage.getAttempt(created.id))?.assignmentId).toBe(assignmentId);
  });

  it("keeps the legacy bucket (no assignment) as NULL, not as a made-up id", async () => {
    const created = await storage.createAttempt(attemptRow({ assignmentId: null }));
    expect((await storage.getAttempt(created.id))?.assignmentId).toBeNull();
  });

  it("splits a learner's attempts of one test by assignment", async () => {
    const userId = randomUUID();
    const testId = randomUUID();
    const first = randomUUID();
    const second = randomUUID();
    await storage.createAttempt(attemptRow({ userId, testId, assignmentId: first }));
    await storage.createAttempt(attemptRow({ userId, testId, assignmentId: second }));

    const rows = await storage.getAttemptsByUserAndTest(userId, testId);
    expect(rows.map((r) => r.assignmentId).sort()).toEqual([first, second].sort());
  });
});

// The assertions read the surviving ROWS, not the returned count: the count comes
// from the driver's `rowCount`, which pglite does not populate for DELETE, so it is
// 0 here regardless of what was removed. What the callers depend on is which rows
// are gone.
describe("annulInProgressAttempts — scoped to one learner", () => {
  it("drops only the given learner's unfinished attempts of that test", async () => {
    const testId = randomUUID();
    const mine = randomUUID();
    const other = randomUUID();
    const myOpen = await storage.createAttempt(attemptRow({ userId: mine, testId }));
    const myDone = await storage.createAttempt(
      attemptRow({ userId: mine, testId, finishedAt: new Date() }),
    );
    const theirOpen = await storage.createAttempt(attemptRow({ userId: other, testId }));

    await storage.annulInProgressAttempts(testId, mine);

    expect(await storage.getAttempt(myOpen.id)).toBeUndefined();
    // A FINISHED attempt is the record of a spent attempt — never annulled.
    expect(await storage.getAttempt(myDone.id)).toBeDefined();
    // Another learner's open run is none of this call's business.
    expect(await storage.getAttempt(theirOpen.id)).toBeDefined();
  });

  it("without a learner still annuls the whole test (republish path)", async () => {
    const testId = randomUUID();
    const a = await storage.createAttempt(attemptRow({ userId: randomUUID(), testId }));
    const b = await storage.createAttempt(attemptRow({ userId: randomUUID(), testId }));
    const elsewhere = await storage.createAttempt(attemptRow({ userId: randomUUID() }));

    await storage.annulInProgressAttempts(testId);

    expect(await storage.getAttempt(a.id)).toBeUndefined();
    expect(await storage.getAttempt(b.id)).toBeUndefined();
    expect(await storage.getAttempt(elsewhere.id)).toBeDefined();
  });
});
