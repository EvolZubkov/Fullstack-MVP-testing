/**
 * @module tests/it/duplicate-topic.it.test
 * @description duplicateTopicWithQuestions now builds the copy through createTopic,
 * so the copy carries the topic invariants (normalized name, owner = duplicator,
 * private visibility, preserved folder) instead of leaving them NULL, and the copy
 * name is made unique within the owner so duplicating twice does not violate the
 * owner-scoped name-uniqueness index.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { normalizeTopicName } from "@shared/topics/naming";
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

const U1 = "user-1";
const U2 = "user-2";

async function seedTopicWithQuestions(folderId?: string) {
  const topic = await storage.createTopic({
    name: "Src", description: "d", folderId, createdBy: U1,
  } as never);
  for (const prompt of ["Q1", "Q2"]) {
    await storage.createQuestion({
      topicId: topic.id, type: "single", prompt,
      dataJson: { options: ["a", "b"] }, correctJson: { correctIndex: 0 },
    } as never);
  }
  return topic;
}

describe("duplicateTopicWithQuestions — copy respects topic invariants", () => {
  it("sets nameNormalized, private visibility, owner=duplicator, keeps folder; copies questions", async () => {
    const folderId = randomUUID(); // topics.folderId has no FK, no folder row needed
    const original = await seedTopicWithQuestions(folderId);

    const result = await storage.duplicateTopicWithQuestions(original.id, U2);
    expect(result).toBeDefined();
    const copy = result!.topic;

    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toBe("Src (копия)");
    expect(copy.nameNormalized).toBe(normalizeTopicName("Src (копия)"));
    expect(copy.nameNormalized).not.toBeNull();
    expect(copy.visibility).toBe("private");
    expect(copy.ownerId).toBe(U2);
    expect(copy.createdBy).toBe(U2);
    expect(copy.folderId).toBe(folderId);

    expect(result!.questions).toHaveLength(2);
    const copied = await storage.getQuestionsByTopic(copy.id);
    expect(copied.map((q) => q.prompt).sort()).toEqual(["Q1", "Q2"]);
  });

  it("gives a distinct name when one owner duplicates the same topic twice", async () => {
    const original = await seedTopicWithQuestions();

    const first = await storage.duplicateTopicWithQuestions(original.id, U2);
    const second = await storage.duplicateTopicWithQuestions(original.id, U2);

    expect(first!.topic.name).toBe("Src (копия)");
    expect(second!.topic.name).toBe("Src (копия) 2");
    // Both persisted — owner-scoped uniqueness respected, no conflict.
    expect((await storage.getTopics()).filter((t) => t.ownerId === U2)).toHaveLength(2);
  });

  it("returns undefined for a missing topic", async () => {
    expect(await storage.duplicateTopicWithQuestions(randomUUID(), U2)).toBeUndefined();
  });
});
