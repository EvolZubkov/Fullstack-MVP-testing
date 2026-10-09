/**
 * @module tests/it/question-option-feedback.it.test
 * @description `questions.option_feedback_json` against the REAL repositories on the
 * pglite harness. The repository names every column it writes explicitly, so a column it
 * forgets is silently dropped — only a round-trip through SQL catches that.
 *
 * Asserted: the column defaults to NULL, stores what it was given, survives a partial
 * update that does not mention it, and travels with a question copy and a topic copy.
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

describe("questions.option_feedback_json — storage round-trip", () => {
  it("defaults to NULL", async () => {
    const topicId = await makeTopic("T-default");

    const created = await storage.createQuestion(singleQ(topicId));

    expect(created.optionFeedbackJson).toBeNull();
  });

  it("stores the texts and keeps them through an unrelated update", async () => {
    const topicId = await makeTopic("T-store");
    const created = await storage.createQuestion(singleQ(topicId, { optionFeedbackJson: [null, "Почему b"] }));

    const updated = await storage.updateQuestion(created.id, { difficulty: 70 });

    expect(created.optionFeedbackJson).toEqual([null, "Почему b"]);
    expect(updated?.optionFeedbackJson).toEqual([null, "Почему b"]);
  });

  it("copies the texts with the question", async () => {
    const topicId = await makeTopic("T-dup");
    const created = await storage.createQuestion(singleQ(topicId, { optionFeedbackJson: ["Почему a"] }));

    const copy = await storage.duplicateQuestion(created.id);

    expect(copy?.optionFeedbackJson).toEqual(["Почему a"]);
  });

  it("copies the texts with the topic", async () => {
    const topicId = await makeTopic("T-topic");
    await storage.createQuestion(singleQ(topicId, { optionFeedbackJson: [null, null, "Почему c"] }));

    const result = await storage.duplicateTopicWithQuestions(topicId);

    expect(result?.questions[0]?.optionFeedbackJson).toEqual([null, null, "Почему c"]);
  });
});
