/**
 * @module tests/it/attempts-by-tests.it.test
 * @description PRD-70 FR-01: analytics reads the attempts of one test (or of a reader's scope) by
 * query instead of loading the whole table and filtering in memory. The filter moved from
 * JavaScript into SQL, so a real DB is where the selection itself is provable.
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

/** Minimal attempt row of the given test. */
function attemptOf(testId: string) {
  return {
    userId: randomUUID(),
    testId,
    testVersion: 1,
    variantJson: { sections: [] },
    answersJson: null,
    resultJson: null,
    startedAt: new Date(),
    finishedAt: null,
  } as never;
}

describe("getAttemptsByTests (PRD-70 FR-01)", () => {
  it("returns the attempts of the listed tests and nothing else", async () => {
    const [t1, t2, t3] = [randomUUID(), randomUUID(), randomUUID()];
    const a1 = await storage.createAttempt(attemptOf(t1));
    const a2 = await storage.createAttempt(attemptOf(t1));
    const b1 = await storage.createAttempt(attemptOf(t2));
    await storage.createAttempt(attemptOf(t3));

    const one = await storage.getAttemptsByTests([t1]);
    expect(one.map(a => a.id).sort()).toEqual([a1.id, a2.id].sort());

    const two = await storage.getAttemptsByTests([t1, t2]);
    expect(two.map(a => a.id).sort()).toEqual([a1.id, a2.id, b1.id].sort());
  });

  it("reads nothing for an empty list — an empty scope is not «all tests»", async () => {
    await storage.createAttempt(attemptOf(randomUUID()));

    expect(await storage.getAttemptsByTests([])).toEqual([]);
  });
});
