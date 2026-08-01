/**
 * @module tests/it/question-order.it.test
 * @description PRD-30 Э1: the question bank has an author-defined order.
 *
 * Two invariants are asserted against the REAL repositories on the in-process
 * pglite harness, because both are pure SQL side effects no unit test can see:
 *
 * 1. `questions.order_index` round-trips through the DAL (create/duplicate) and
 *    defaults to NULL — «index not set» (FR-01). A non-null default would put
 *    every question of every topic into one group of equals and the feature
 *    would be invisible.
 * 2. `getQuestionsByTopic` returns the bank ORDERED — ascending index, NULLs
 *    last (FR-08). Before this change the query had no ORDER BY at all, so
 *    PostgreSQL was free to return rows in any order; the assertion below is
 *    the only thing standing between that and a silently arbitrary bank.
 *
 * The delivery-time rule (equal indices shuffled inside their group, FR-05) is
 * NOT asserted here: shuffling belongs to the ordering engine of Э2, while the
 * DAL must be deterministic. Within a group of equal indices this query orders
 * by `id`, so the test compares SETS for the tied pair, not positions.
 */
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
// eslint-disable-next-line import/first
import type { InsertQuestion } from "@shared/schema";

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

/** Minimal valid `single`-choice question payload (jsonb columns are notNull). */
function singleQ(topicId: string, over: Partial<InsertQuestion> = {}): InsertQuestion {
  return {
    topicId,
    type: "single",
    prompt: "single?",
    dataJson: { options: ["a", "b", "c"] },
    correctJson: { correctIndex: 0 },
    ...over,
  } as InsertQuestion;
}

async function makeTopic(name: string): Promise<string> {
  const topic = await storage.createTopic({ name } as never);
  return topic.id;
}

describe("questions.order_index — storage round-trip (PRD-30 FR-01)", () => {
  it("defaults to NULL: a question created without an index has none", async () => {
    const topicId = await makeTopic("T-default");

    const created = await storage.createQuestion(singleQ(topicId, { prompt: "no index" }));

    expect(created.orderIndex).toBeNull();
  });

  it("stores the value it was given", async () => {
    const topicId = await makeTopic("T-store");

    const created = await storage.createQuestion(singleQ(topicId, { orderIndex: 20 }));

    expect(created.orderIndex).toBe(20);
    expect((await storage.getQuestion(created.id))!.orderIndex).toBe(20);
  });

  it("updateQuestion clears the index when given null", async () => {
    const topicId = await makeTopic("T-clear");
    const created = await storage.createQuestion(singleQ(topicId, { orderIndex: 30 }));

    const updated = await storage.updateQuestion(created.id, { orderIndex: null });

    expect(updated!.orderIndex).toBeNull();
  });

  it("duplicateQuestion carries the index over to the copy", async () => {
    const topicId = await makeTopic("T-duplicate");
    const created = await storage.createQuestion(singleQ(topicId, { orderIndex: 40 }));

    const copy = await storage.duplicateQuestion(created.id);

    expect(copy!.orderIndex).toBe(40);
  });
});

describe("getQuestionsByTopic — bank order (PRD-30 FR-08)", () => {
  it("orders by index ascending and puts questions without an index last", async () => {
    const topicId = await makeTopic("T-order");
    // Inserted deliberately out of order, so passing cannot be an accident of
    // insertion sequence: the pre-change query had no ORDER BY at all.
    await storage.createQuestion(singleQ(topicId, { prompt: "no index A" }));
    await storage.createQuestion(singleQ(topicId, { prompt: "third", orderIndex: 30 }));
    await storage.createQuestion(singleQ(topicId, { prompt: "first", orderIndex: 10 }));
    await storage.createQuestion(singleQ(topicId, { prompt: "no index B" }));
    await storage.createQuestion(singleQ(topicId, { prompt: "second", orderIndex: 20 }));

    const prompts = (await storage.getQuestionsByTopic(topicId)).map((q) => q.prompt);

    expect(prompts.slice(0, 3)).toEqual(["first", "second", "third"]);
    expect(prompts.slice(3).sort()).toEqual(["no index A", "no index B"]);
  });

  it("keeps questions with equal indices together, before the unindexed tail", async () => {
    const topicId = await makeTopic("T-ties");
    await storage.createQuestion(singleQ(topicId, { prompt: "tail" }));
    await storage.createQuestion(singleQ(topicId, { prompt: "tie A", orderIndex: 20 }));
    await storage.createQuestion(singleQ(topicId, { prompt: "lead", orderIndex: 10 }));
    await storage.createQuestion(singleQ(topicId, { prompt: "tie B", orderIndex: 20 }));

    const prompts = (await storage.getQuestionsByTopic(topicId)).map((q) => q.prompt);

    expect(prompts[0]).toBe("lead");
    // The pair shares an index, so their relative order is not meaningful here —
    // only that both sit between the leader and the unindexed tail.
    expect(prompts.slice(1, 3).sort()).toEqual(["tie A", "tie B"]);
    expect(prompts[3]).toBe("tail");
  });
});
