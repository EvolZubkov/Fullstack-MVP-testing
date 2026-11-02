// @vitest-environment node
/**
 * @module tests/storage/attempts-timer.test
 * @description DAL coverage for `startAttemptTimer`
 * ({@link module:server/storage/attempts-repository}) against a real (pglite)
 * database, through the {@link DatabaseStorage} facade. The test-wide countdown
 * starts on the first question shown; the stamp is written ONCE, survives a
 * concurrent whole-row progress write and is never set on a finished attempt.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { createHarness, type Harness } from "../it/db-harness";

const h = vi.hoisted(() => ({ current: null as Harness | null }));
vi.mock("../../server/db", () => ({
  get db() {
    if (!h.current) throw new Error("harness not initialized");
    return h.current.db;
  },
}));
// Deterministic, config-free email crypto so the facade imports without ENCRYPTION_* env.
vi.mock("../../server/utils/crypto", () => ({
  encryptEmail: async (e: string) => `enc:${e}`,
  decryptEmail: async (e: string) => e.replace(/^enc:/, ""),
  hashEmail: (e: string) => `hash:${e}`,
  hashPassword: async (p: string) => `hashed:${p}`,
  verifyPassword: async (plain: string, stored: string) => stored === `hashed:${plain}`,
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

/** A fresh, unfinished attempt (the table carries no foreign keys). */
async function newAttempt(finished = false): Promise<string> {
  const attempt = await storage.createAttempt({
    userId: randomUUID(),
    testId: randomUUID(),
    testVersion: 1,
    snapshotId: null,
    assignmentId: null,
    variantJson: { sections: [] },
    answersJson: null,
    resultJson: null,
    startedAt: new Date(),
    finishedAt: finished ? new Date() : null,
  });
  return attempt.id;
}

describe("startAttemptTimer", () => {
  it("a new attempt has not started its clock", async () => {
    const id = await newAttempt();
    expect((await storage.getAttempt(id))?.timerStartedAt).toBeNull();
  });

  it("stamps the start once and returns the stored stamp on every later call", async () => {
    const id = await newAttempt();
    const first = await storage.startAttemptTimer(id);
    expect(first).toBeInstanceOf(Date);
    const second = await storage.startAttemptTimer(id);
    expect(second?.getTime()).toBe(first!.getTime());
    expect((await storage.getAttempt(id))?.timerStartedAt?.getTime()).toBe(first!.getTime());
  });

  it("a progress write of the whole variant does not drop the stamp", async () => {
    const id = await newAttempt();
    const stamp = await storage.startAttemptTimer(id);
    await storage.updateAttempt(id, { variantJson: { sections: [], currentIndex: 1 } });
    expect((await storage.getAttempt(id))?.timerStartedAt?.getTime()).toBe(stamp!.getTime());
  });

  it("a progress write cannot set or move the stamp", async () => {
    const id = await newAttempt();
    await storage.updateAttempt(id, { timerStartedAt: new Date(0) } as never);
    expect((await storage.getAttempt(id))?.timerStartedAt).toBeNull();
  });

  it("never stamps a finished attempt", async () => {
    const id = await newAttempt(true);
    expect(await storage.startAttemptTimer(id)).toBeNull();
    expect((await storage.getAttempt(id))?.timerStartedAt).toBeNull();
  });

  it("returns null for a missing attempt", async () => {
    expect(await storage.startAttemptTimer(randomUUID())).toBeNull();
  });
});
