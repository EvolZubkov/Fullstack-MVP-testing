// @vitest-environment node
/**
 * @module tests/storage/questions-repository.test
 * @description DAL coverage for {@link module:server/storage/questions-repository}
 * against a real (pglite) database, driven through the `DatabaseStorage` facade
 * (so `server/storage.ts` delegation is exercised too). The repository is a thin
 * data-access layer — mocking drizzle would assert query shape, not behaviour —
 * so these specs run the actual SQL through the same in-process Postgres harness
 * the integration suite uses. Runs in the `node` environment (per-file override)
 * so pglite works under the otherwise-jsdom unit run; living under `tests/` (not
 * `tests/it/`) its coverage counts toward the reported total.
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

/** Create a parent topic and return its id (questions live under a topic). */
async function makeTopic(name: string): Promise<string> {
  const topic = await storage.createTopic({ name } as never);
  return topic.id;
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

/** Minimal valid payloads for every question type (shape is domain-plausible). */
function questionOfType(topicId: string, type: InsertQuestion["type"]): InsertQuestion {
  switch (type) {
    case "single":
      return singleQ(topicId, { prompt: "single?" });
    case "multiple":
      return {
        topicId, type, prompt: "multiple?",
        dataJson: { options: ["a", "b", "c"] },
        correctJson: { correctIndices: [0, 2] },
      } as InsertQuestion;
    case "matching":
      return {
        topicId, type, prompt: "matching?",
        dataJson: { left: ["l1", "l2"], right: ["r1", "r2"] },
        correctJson: { pairs: [[0, 1], [1, 0]] },
      } as InsertQuestion;
    case "ranking":
      return {
        topicId, type, prompt: "ranking?",
        dataJson: { items: ["x", "y", "z"] },
        correctJson: { order: [2, 0, 1] },
      } as InsertQuestion;
  }
}

describe("QuestionsRepository — create & read a single question", () => {
  it("createQuestion applies column defaults; getQuestion round-trips the row", async () => {
    const topicId = await makeTopic("T-create");
    const created = await storage.createQuestion(singleQ(topicId));

    // Persisted content survives the round-trip.
    expect(created.id).toBeTruthy();
    expect(created.topicId).toBe(topicId);
    expect(created.type).toBe("single");
    expect(created.prompt).toBe("single?");
    expect(created.dataJson).toEqual({ options: ["a", "b", "c"] });
    expect(created.correctJson).toEqual({ correctIndex: 0 });

    // Defaults from createQuestion (?? / || null branches, no explicit input).
    expect(created.difficulty).toBe(50);
    expect(created.shuffleAnswers).toBe(true);
    expect(created.feedbackMode).toBe("general");
    expect(created.tags).toEqual([]);
    expect(created.mediaUrl).toBeNull();
    expect(created.mediaType).toBeNull();
    expect(created.feedback).toBeNull();
    expect(created.feedbackCorrect).toBeNull();
    expect(created.feedbackIncorrect).toBeNull();
    expect(created.contentHash).toBeNull();
    expect(created.createdBy).toBeNull();

    // getQuestion reads back the exact same row.
    const fetched = await storage.getQuestion(created.id);
    expect(fetched).toEqual(created);
  });

  it("createQuestion honours explicit values over the defaults", async () => {
    const topicId = await makeTopic("T-explicit");
    const created = await storage.createQuestion(
      singleQ(topicId, {
        prompt: "explicit",
        difficulty: 10,
        shuffleAnswers: false,
        feedbackMode: "conditional",
        tags: ["tag-a", "tag-b"],
        mediaUrl: "uploads/media/x.png",
        mediaType: "image",
        feedback: "gen",
        feedbackCorrect: "yes",
        feedbackIncorrect: "no",
        contentHash: "hash-1",
        createdBy: "user-1",
      }),
    );

    expect(created.difficulty).toBe(10);
    expect(created.shuffleAnswers).toBe(false);
    expect(created.feedbackMode).toBe("conditional");
    expect(created.tags).toEqual(["tag-a", "tag-b"]);
    expect(created.mediaUrl).toBe("uploads/media/x.png");
    expect(created.mediaType).toBe("image");
    expect(created.feedback).toBe("gen");
    expect(created.feedbackCorrect).toBe("yes");
    expect(created.feedbackIncorrect).toBe("no");
    expect(created.contentHash).toBe("hash-1");
    expect(created.createdBy).toBe("user-1");
  });

  it("getQuestion returns undefined for an unknown id", async () => {
    expect(await storage.getQuestion(randomUUID())).toBeUndefined();
  });

  it("createQuestion persists all four question types", async () => {
    const topicId = await makeTopic("T-types");
    for (const type of ["single", "multiple", "matching", "ranking"] as const) {
      const created = await storage.createQuestion(questionOfType(topicId, type));
      expect(created.type).toBe(type);
      const fetched = await storage.getQuestion(created.id);
      expect(fetched?.type).toBe(type);
      expect(fetched?.dataJson).toEqual(created.dataJson);
      expect(fetched?.correctJson).toEqual(created.correctJson);
    }
    expect(await storage.getQuestionsByTopic(topicId)).toHaveLength(4);
  });
});

describe("QuestionsRepository — collection reads", () => {
  it("getQuestions returns every question across topics", async () => {
    const topicA = await makeTopic("T-a");
    const topicB = await makeTopic("T-b");
    await storage.createQuestion(singleQ(topicA));
    await storage.createQuestion(singleQ(topicA));
    await storage.createQuestion(singleQ(topicB));

    expect(await storage.getQuestions()).toHaveLength(3);
  });

  it("getQuestionsByTopic filters to the requested topic; unknown topic yields []", async () => {
    const topicA = await makeTopic("T-scoped-a");
    const topicB = await makeTopic("T-scoped-b");
    await storage.createQuestion(singleQ(topicA, { prompt: "a1" }));
    await storage.createQuestion(singleQ(topicA, { prompt: "a2" }));
    await storage.createQuestion(singleQ(topicB, { prompt: "b1" }));

    const inA = await storage.getQuestionsByTopic(topicA);
    expect(inA).toHaveLength(2);
    expect(inA.every((q) => q.topicId === topicA)).toBe(true);

    expect(await storage.getQuestionsByTopic(randomUUID())).toEqual([]);
  });

  it("getQuestionsByIds short-circuits on [] and otherwise matches the id set", async () => {
    // Empty-input branch: no query is issued.
    expect(await storage.getQuestionsByIds([])).toEqual([]);

    const topicId = await makeTopic("T-ids");
    const q1 = await storage.createQuestion(singleQ(topicId, { prompt: "q1" }));
    const q2 = await storage.createQuestion(singleQ(topicId, { prompt: "q2" }));
    await storage.createQuestion(singleQ(topicId, { prompt: "q3" }));

    // Only the requested ids come back (unknown ids are silently dropped).
    const got = await storage.getQuestionsByIds([q1.id, q2.id, randomUUID()]);
    expect(got.map((q) => q.id).sort()).toEqual([q1.id, q2.id].sort());
  });

  it("getContentHashesByTopic returns only non-null hashes of that topic", async () => {
    const topicId = await makeTopic("T-hash");
    const otherTopic = await makeTopic("T-hash-other");
    await storage.createQuestion(singleQ(topicId, { contentHash: "h1" }));
    await storage.createQuestion(singleQ(topicId, { contentHash: "h2" }));
    // Null-hash question in the same topic — excluded by the IS NOT NULL predicate.
    await storage.createQuestion(singleQ(topicId));
    // Hash in a different topic — excluded by the topic predicate.
    await storage.createQuestion(singleQ(otherTopic, { contentHash: "h3" }));

    const hashes = await storage.getContentHashesByTopic(topicId);
    expect(hashes).toBeInstanceOf(Set);
    expect([...hashes].sort()).toEqual(["h1", "h2"]);

    // Topic with no hashes at all yields an empty set.
    expect(await storage.getContentHashesByTopic(randomUUID())).toEqual(new Set());
  });
});

describe("QuestionsRepository — duplicate", () => {
  it("duplicateQuestion copies content into the same topic with a suffixed prompt", async () => {
    const topicId = await makeTopic("T-dup");
    const original = await storage.createQuestion(
      singleQ(topicId, {
        prompt: "orig",
        difficulty: 33,
        shuffleAnswers: false,
        feedbackMode: "conditional",
        feedback: "fb",
        feedbackCorrect: "ok",
        feedbackIncorrect: "bad",
        mediaUrl: "uploads/media/y.png",
        mediaType: "image",
        tags: ["t1"],
      }),
    );

    const copy = await storage.duplicateQuestion(original.id);
    expect(copy).toBeDefined();
    expect(copy!.id).not.toBe(original.id);
    expect(copy!.prompt).toBe("orig (копия)");
    expect(copy!.topicId).toBe(topicId);
    expect(copy!.type).toBe("single");
    expect(copy!.dataJson).toEqual(original.dataJson);
    expect(copy!.correctJson).toEqual(original.correctJson);
    expect(copy!.difficulty).toBe(33);
    expect(copy!.shuffleAnswers).toBe(false);
    expect(copy!.feedbackMode).toBe("conditional");
    expect(copy!.feedback).toBe("fb");
    expect(copy!.feedbackCorrect).toBe("ok");
    expect(copy!.feedbackIncorrect).toBe("bad");
    expect(copy!.mediaUrl).toBe("uploads/media/y.png");
    expect(copy!.mediaType).toBe("image");
    expect(copy!.tags).toEqual(["t1"]);

    // Both rows now live in the topic.
    expect(await storage.getQuestionsByTopic(topicId)).toHaveLength(2);
  });

  it("duplicateQuestion returns undefined for a missing question", async () => {
    expect(await storage.duplicateQuestion(randomUUID())).toBeUndefined();
  });
});

describe("QuestionsRepository — update", () => {
  it("updateQuestion patches fields and returns the updated row", async () => {
    const topicId = await makeTopic("T-upd");
    const q = await storage.createQuestion(singleQ(topicId, { prompt: "before" }));

    const updated = await storage.updateQuestion(q.id, {
      prompt: "after",
      difficulty: 77,
      tags: ["new"],
    });
    expect(updated).toBeDefined();
    expect(updated!.prompt).toBe("after");
    expect(updated!.difficulty).toBe(77);
    expect(updated!.tags).toEqual(["new"]);
    // Untouched fields are preserved.
    expect(updated!.type).toBe("single");

    // The change is persisted, not just returned.
    const fetched = await storage.getQuestion(q.id);
    expect(fetched?.prompt).toBe("after");
  });

  it("updateQuestion returns undefined for a missing question", async () => {
    expect(await storage.updateQuestion(randomUUID(), { prompt: "x" })).toBeUndefined();
  });
});

describe("QuestionsRepository — delete", () => {
  it("deleteQuestion removes the row and reports true; false for a miss", async () => {
    const topicId = await makeTopic("T-del");
    const q = await storage.createQuestion(singleQ(topicId));

    expect(await storage.deleteQuestion(q.id)).toBe(true);
    expect(await storage.getQuestion(q.id)).toBeUndefined();

    // Deleting an already-gone id returns false (empty RETURNING).
    expect(await storage.deleteQuestion(q.id)).toBe(false);
    expect(await storage.deleteQuestion(randomUUID())).toBe(false);
  });

  it("deleteQuestionsBulk short-circuits on [] and returns the deleted count", async () => {
    // Empty-input branch: nothing deleted, no query issued.
    expect(await storage.deleteQuestionsBulk([])).toBe(0);

    const topicId = await makeTopic("T-del-bulk");
    const q1 = await storage.createQuestion(singleQ(topicId, { prompt: "q1" }));
    const q2 = await storage.createQuestion(singleQ(topicId, { prompt: "q2" }));
    await storage.createQuestion(singleQ(topicId, { prompt: "q3" }));

    // Mix of real and unknown ids — only existing rows count.
    const removed = await storage.deleteQuestionsBulk([q1.id, q2.id, randomUUID()]);
    expect(removed).toBe(2);

    const remaining = await storage.getQuestionsByTopic(topicId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].prompt).toBe("q3");
  });
});
