/**
 * @module tests/it/harness-smoke.it.test
 * @description Proves the pglite harness runs the REAL DAL end-to-end: no db
 * mock, real SQL, real WHERE/insert/delete and FK cascade. Uses topic/question
 * flows (no email encryption, so no crypto-env dependency).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { topics } from "@shared/schema";
import { createHarness, type Harness } from "./db-harness";

// Point server/db at the pglite-backed drizzle instance. The getter resolves
// lazily (in test bodies, after beforeAll), so the hoisted mock is fine.
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

describe("pglite harness smoke — real SQL through DatabaseStorage", () => {
  it("createTopic maintains its invariants against real SQL", async () => {
    const topic = await storage.createTopic({ name: "Networks", description: "d" } as never);
    expect(topic.id).toBeTruthy();
    // These are set by createTopic and now actually persisted (not a mock echo).
    expect(topic.nameNormalized).toBe("networks");
    expect(topic.visibility).toBe("private");

    const fetched = await storage.getTopic(topic.id);
    expect(fetched?.name).toBe("Networks");
  });

  it("createQuestion round-trips and is found by the topic index path", async () => {
    const topic = await storage.createTopic({ name: "T", description: "" } as never);
    const q = await storage.createQuestion({
      topicId: topic.id,
      type: "single",
      prompt: "What?",
      dataJson: { options: ["a", "b"] },
      correctJson: { correctIndex: 0 },
    } as never);

    const byTopic = await storage.getQuestionsByTopic(topic.id);
    expect(byTopic).toHaveLength(1);
    expect(byTopic[0].id).toBe(q.id);
  });

  it("deleteTopic cascades to its questions (real delete, real predicates)", async () => {
    const topic = await storage.createTopic({ name: "T2", description: "" } as never);
    await storage.createQuestion({
      topicId: topic.id,
      type: "single",
      prompt: "?",
      dataJson: { options: ["a"] },
      correctJson: { correctIndex: 0 },
    } as never);

    const ok = await storage.deleteTopic(topic.id);
    expect(ok).toBe(true);
    expect(await storage.getQuestionsByTopic(topic.id)).toHaveLength(0);
    expect(await storage.getTopic(topic.id)).toBeUndefined();
  });

  it("reset() isolates cases — no rows leak from the previous test", async () => {
    expect(await storage.getTopics()).toHaveLength(0);
  });
});

describe("pglite harness — transaction atomicity capability", () => {
  it("a throw inside db.transaction rolls back every write", async () => {
    const db = h.current!.db;
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(topics).values({ id: randomUUID(), name: "Rolled back" } as never);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // Nothing persisted — proves the harness observes real rollback semantics,
    // the foundation for the deleteTestDeep / multi-step-delete atomicity specs.
    expect(await storage.getTopics()).toHaveLength(0);
  });
});
