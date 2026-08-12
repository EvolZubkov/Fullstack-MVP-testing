/**
 * @module tests/it/topic-touch.it.test
 * @description PRD-25 FR-20 invariant: `topics.updated_at` is the recency key the
 * home-page section «Мои темы и вопросы» orders by, and it must reflect a change
 * to the topic itself OR to ANY of its questions. Every mutation point in the DAL
 * therefore has to touch the parent topic in the SAME transaction as the mutation
 * (risk R-4: a missed write point silently produces a wrong ordering that no
 * other test would catch, because nothing else in the product reads this column).
 *
 * These specs run the REAL repositories against the in-process pglite harness, so
 * they assert the actual SQL side effect rather than a mocked call. A short pause
 * precedes each mutation: `now()` has microsecond resolution but the assertions
 * compare millisecond epochs, so without a gap the "before" and "after" stamps
 * could round to the same value and a missing write would pass unnoticed.
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

/** Epoch (ms) of the topic's current recency stamp. */
async function stamp(topicId: string): Promise<number> {
  const topic = await storage.getTopic(topicId);
  if (!topic) throw new Error(`topic ${topicId} not found`);
  return topic.updatedAt.getTime();
}

/** Guarantee a measurable gap between the "before" and "after" stamps. */
function pause(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 25));
}

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

/** Create a topic and return its id. */
async function makeTopic(name: string): Promise<string> {
  const topic = await storage.createTopic({ name } as never);
  return topic.id;
}

describe("topics.updated_at — touched by mutations of the topic itself", () => {
  it("updateTopic moves the stamp forward", async () => {
    const topicId = await makeTopic("T-update");
    const before = await stamp(topicId);

    await pause();
    await storage.updateTopic(topicId, { description: "changed" });

    expect(await stamp(topicId)).toBeGreaterThan(before);
  });

  it("updateTopic still refreshes nameNormalized on a rename", async () => {
    const topicId = await makeTopic("Ёлка");
    const before = await stamp(topicId);

    await pause();
    const updated = await storage.updateTopic(topicId, { name: "Сосна" });

    expect(updated!.name).toBe("Сосна");
    expect(updated!.nameNormalized).toBe("сосна");
    expect(await stamp(topicId)).toBeGreaterThan(before);
  });
});

describe("topics.updated_at — touched by mutations of the topic's questions", () => {
  it("createQuestion moves the parent topic's stamp forward", async () => {
    const topicId = await makeTopic("T-create-q");
    const before = await stamp(topicId);

    await pause();
    await storage.createQuestion(singleQ(topicId));

    expect(await stamp(topicId)).toBeGreaterThan(before);
  });

  it("updateQuestion moves the parent topic's stamp forward", async () => {
    const topicId = await makeTopic("T-update-q");
    const q = await storage.createQuestion(singleQ(topicId, { prompt: "before" }));
    const before = await stamp(topicId);

    await pause();
    await storage.updateQuestion(q.id, { prompt: "after" });

    expect(await stamp(topicId)).toBeGreaterThan(before);
  });

  it("updateQuestion that moves a question touches BOTH the old and the new topic", async () => {
    const oldTopicId = await makeTopic("T-move-from");
    const newTopicId = await makeTopic("T-move-to");
    const q = await storage.createQuestion(singleQ(oldTopicId));
    const beforeOld = await stamp(oldTopicId);
    const beforeNew = await stamp(newTopicId);

    await pause();
    await storage.updateQuestion(q.id, { topicId: newTopicId });

    // The old topic lost a question — it changed too, and must say so.
    expect(await stamp(oldTopicId)).toBeGreaterThan(beforeOld);
    expect(await stamp(newTopicId)).toBeGreaterThan(beforeNew);
  });

  it("deleteQuestion moves the parent topic's stamp forward", async () => {
    const topicId = await makeTopic("T-delete-q");
    const q = await storage.createQuestion(singleQ(topicId));
    const before = await stamp(topicId);

    await pause();
    expect(await storage.deleteQuestion(q.id)).toBe(true);

    expect(await stamp(topicId)).toBeGreaterThan(before);
  });

  it("deleteQuestionsBulk moves the stamp of EVERY affected topic", async () => {
    const topicA = await makeTopic("T-bulk-a");
    const topicB = await makeTopic("T-bulk-b");
    const qa = await storage.createQuestion(singleQ(topicA, { prompt: "a" }));
    const qb = await storage.createQuestion(singleQ(topicB, { prompt: "b" }));
    const beforeA = await stamp(topicA);
    const beforeB = await stamp(topicB);

    await pause();
    // One call spanning two topics, plus an unknown id that must not disturb it.
    expect(await storage.deleteQuestionsBulk([qa.id, qb.id, randomUUID()])).toBe(2);

    expect(await stamp(topicA)).toBeGreaterThan(beforeA);
    expect(await stamp(topicB)).toBeGreaterThan(beforeB);
  });

  it("duplicateQuestion moves the parent topic's stamp forward", async () => {
    const topicId = await makeTopic("T-duplicate-q");
    const q = await storage.createQuestion(singleQ(topicId, { prompt: "orig" }));
    const before = await stamp(topicId);

    await pause();
    const copy = await storage.duplicateQuestion(q.id);

    expect(copy!.prompt).toBe("orig (копия)");
    expect(await stamp(topicId)).toBeGreaterThan(before);
  });
});
