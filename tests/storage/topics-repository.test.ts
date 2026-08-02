// @vitest-environment node
/**
 * @module tests/storage/topics-repository.test
 * @description DAL coverage for {@link module:server/storage/topics-repository}
 * against a real (pglite) database, driven through the {@link DatabaseStorage}
 * facade (so `server/storage.ts` topic delegates are exercised too). The
 * repository is a thin data-access layer with real cascades, transactions and a
 * formula-rename side effect — mocking drizzle would assert query shape, not
 * behaviour — so these specs run the actual SQL through the same in-process
 * Postgres harness the integration suite uses. Runs in the `node` environment
 * (per-file override) so pglite works under the otherwise-jsdom unit run, and
 * because it lives under `tests/` (not `tests/it/`) its coverage counts toward
 * the reported total.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { normalizeTopicName } from "@shared/topics/naming";
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
import { tests, testSections, contentPages, resultVariables } from "@shared/schema";

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

/** Insert a minimal `tests` row directly (FK target for sections/pages/vars). */
async function insertTest(): Promise<string> {
  const id = randomUUID();
  await h.current!.db.insert(tests).values({
    id,
    title: "T",
    overallPassRuleJson: {},
  } as never);
  return id;
}

/** Insert a `test_sections` row binding a topic to a test (no FK, direct). */
async function insertSection(testId: string, topicId: string): Promise<void> {
  await h.current!.db.insert(testSections).values({
    id: randomUUID(),
    testId,
    topicId,
    drawCount: 1,
  } as never);
}

/** Seed a topic (owned by U1) with N single-choice questions via the facade. */
async function seedTopicWithQuestions(count: number, name = "Src") {
  const topic = await storage.createTopic({ name, createdBy: U1 } as never);
  for (let i = 0; i < count; i += 1) {
    await storage.createQuestion({
      topicId: topic.id,
      type: "single",
      prompt: `Q${i + 1}`,
      dataJson: { options: ["a", "b"] },
      correctJson: { correctIndex: 0 },
    } as never);
  }
  return topic;
}

describe("TopicsRepository — reads (getTopics / getTopic)", () => {
  it("getTopics returns an empty list initially, then the created rows", async () => {
    expect(await storage.getTopics()).toEqual([]);
    await storage.createTopic({ name: "A" } as never);
    await storage.createTopic({ name: "B" } as never);
    const names = (await storage.getTopics()).map((t) => t.name).sort();
    expect(names).toEqual(["A", "B"]);
  });

  it("getTopic round-trips a row and returns undefined for an unknown id", async () => {
    const created = await storage.createTopic({ name: "Alpha", description: "d" } as never);
    const fetched = await storage.getTopic(created.id);
    expect(fetched?.name).toBe("Alpha");
    expect(fetched?.description).toBe("d");
    expect(await storage.getTopic(randomUUID())).toBeUndefined();
  });
});

describe("TopicsRepository — createTopic invariants (topicInsertValues)", () => {
  it("applies private-by-default visibility, NULL owner and a normalized name", async () => {
    const t = await storage.createTopic({ name: "  Финансы  " } as never);
    // Visibility defaults to private in the builder (not the column's `shared`).
    expect(t.visibility).toBe("private");
    expect(t.ownerId).toBeNull();
    expect(t.createdBy).toBeNull();
    expect(t.code).toBeNull();
    // FR-27: name is normalized (trim + collapse + lowercase + ё->е).
    expect(t.nameNormalized).toBe(normalizeTopicName("  Финансы  "));
    expect(t.nameNormalized).toBe("финансы");
  });

  it("derives ownerId from createdBy when no explicit owner is given", async () => {
    const t = await storage.createTopic({ name: "Owned", createdBy: U1 } as never);
    expect(t.ownerId).toBe(U1);
    expect(t.createdBy).toBe(U1);
  });

  it("honours an explicit owner, shared visibility, code and rich feedback", async () => {
    const feedbackJson = {
      format: "plain",
      text: "",
      links: [{ title: "Course", url: "https://example.com/c" }],
      assets: [],
      events: [{ title: "Webinar" }],
    };
    const t = await storage.createTopic({
      name: "Shared",
      ownerId: U2,
      createdBy: U1,
      visibility: "shared",
      code: "sh1",
      feedbackJson,
    } as never);
    expect(t.ownerId).toBe(U2); // explicit owner wins over createdBy
    expect(t.visibility).toBe("shared");
    expect(t.code).toBe("sh1");
    expect((t.feedbackJson as typeof feedbackJson).links[0].title).toBe("Course");
  });
});

describe("TopicsRepository — updateTopic", () => {
  it("refreshes nameNormalized on rename (name-present branch)", async () => {
    const t = await storage.createTopic({ name: "Alpha" } as never);
    const updated = await storage.updateTopic(t.id, { name: "Бета Гамма" } as never);
    expect(updated?.name).toBe("Бета Гамма");
    expect(updated?.nameNormalized).toBe(normalizeTopicName("Бета Гамма"));
    expect(updated?.nameNormalized).toBe("бета гамма");
  });

  it("keeps nameNormalized untouched on a non-name update (else branch)", async () => {
    const t = await storage.createTopic({ name: "Stable" } as never);
    const before = t.nameNormalized;
    const updated = await storage.updateTopic(t.id, { description: "new" } as never);
    expect(updated?.description).toBe("new");
    expect(updated?.name).toBe("Stable");
    expect(updated?.nameNormalized).toBe(before);
  });

  it("returns undefined when the id does not exist", async () => {
    expect(await storage.updateTopic(randomUUID(), { name: "x" } as never)).toBeUndefined();
  });
});

describe("TopicsRepository — renameTopicInFormulas", () => {
  /** Create a test + section(topic) + result variable with the given formula. */
  async function seedFormula(topicId: string, formula: string): Promise<string> {
    const testId = await insertTest();
    await insertSection(testId, topicId);
    const [rv] = await h.current!.db
      .insert(resultVariables)
      .values({ testId, name: "verdict", label: "V", type: "boolean", formula } as never)
      .returning();
    return rv.id;
  }

  async function formulaOf(id: string): Promise<string> {
    const [rv] = await h.current!.db.select().from(resultVariables).where(eq(resultVariables.id, id));
    return rv.formula;
  }

  it("rewrites a live topicByName(...) reference on rename", async () => {
    const topic = await storage.createTopic({ name: "Этика" } as never);
    const rvId = await seedFormula(topic.id, 'topicByName("Этика").percent >= 70');
    await storage.renameTopicInFormulas(topic.id, "Этика", "Комплаенс");
    expect(await formulaOf(rvId)).toBe('topicByName("Комплаенс").percent >= 70');
  });

  it("is a no-op when the name is unchanged (oldName === newName early return)", async () => {
    const topic = await storage.createTopic({ name: "Same" } as never);
    const formula = 'topicByName("Same").percent >= 70';
    const rvId = await seedFormula(topic.id, formula);
    await storage.renameTopicInFormulas(topic.id, "Same", "Same");
    expect(await formulaOf(rvId)).toBe(formula);
  });

  it("is a no-op when no section references the topic (empty testIds branch)", async () => {
    const topic = await storage.createTopic({ name: "Lonely" } as never);
    // A variable exists, but under a test whose sections do NOT use this topic.
    const otherTopic = await storage.createTopic({ name: "Other" } as never);
    const rvId = await seedFormula(otherTopic.id, 'topicByName("Lonely").percent >= 70');
    await storage.renameTopicInFormulas(topic.id, "Lonely", "New");
    // Unchanged: the topic under rename has no sections, so nothing is scanned.
    expect(await formulaOf(rvId)).toBe('topicByName("Lonely").percent >= 70');
  });

  it("is a no-op when no formula matches (empty changed branch)", async () => {
    const topic = await storage.createTopic({ name: "NoRef" } as never);
    const formula = "percent >= 50"; // does not reference the topic by name
    const rvId = await seedFormula(topic.id, formula);
    await storage.renameTopicInFormulas(topic.id, "NoRef", "Renamed");
    expect(await formulaOf(rvId)).toBe(formula);
  });
});

describe("TopicsRepository — deleteTopic (full cascade)", () => {
  it("deletes the topic, its questions, sections and content pages; reports what it cascaded", async () => {
    const topic = await seedTopicWithQuestions(2, "ToDelete");
    const questionIds = (await storage.getQuestionsByTopic(topic.id)).map((q) => q.id);
    const testId = await insertTest();
    await insertSection(testId, topic.id);
    const [page] = await h.current!.db.insert(contentPages).values({
      testId,
      topicId: topic.id,
      position: "before_topic",
      type: "info",
      kind: "info",
    } as never).returning();

    const result = await storage.deleteTopic(topic.id);
    expect(result.deleted).toBe(true);
    // Cascaded ids travel back so the caller can clean up their media-usage rows
    // (server/services/media/usage-index.ts) — the repository itself must not
    // depend on that service (see module JSDoc).
    expect(result.questionIds.sort()).toEqual([...questionIds].sort());
    expect(result.contentPageIds).toEqual([page.id]);

    expect(await storage.getTopic(topic.id)).toBeUndefined();
    expect(await storage.getQuestionsByTopic(topic.id)).toEqual([]);
    const secs = await h.current!.db.select().from(testSections).where(eq(testSections.topicId, topic.id));
    expect(secs).toEqual([]);
    const pages = await h.current!.db.select().from(contentPages).where(eq(contentPages.topicId, topic.id));
    expect(pages).toEqual([]);
  });

  it("reports not-deleted with empty cascades for a topic that does not exist", async () => {
    const result = await storage.deleteTopic(randomUUID());
    expect(result).toEqual({ deleted: false, questionIds: [], contentPageIds: [] });
  });
});

describe("TopicsRepository — deleteTopicsBulk", () => {
  it("returns an empty result for an empty id list (guard branch)", async () => {
    expect(await storage.deleteTopicsBulk([])).toEqual({ count: 0, questionIds: [], contentPageIds: [] });
  });

  it("deletes many topics with their questions and reports the cascaded ids", async () => {
    const a = await seedTopicWithQuestions(1, "Bulk A");
    const b = await seedTopicWithQuestions(2, "Bulk B");
    const survivor = await storage.createTopic({ name: "Survivor" } as never);
    const aQuestionIds = (await storage.getQuestionsByTopic(a.id)).map((q) => q.id);
    const bQuestionIds = (await storage.getQuestionsByTopic(b.id)).map((q) => q.id);

    const result = await storage.deleteTopicsBulk([a.id, b.id]);
    expect(result.count).toBe(2);
    expect(result.questionIds.sort()).toEqual([...aQuestionIds, ...bQuestionIds].sort());
    expect(result.contentPageIds).toEqual([]);

    expect(await storage.getTopic(a.id)).toBeUndefined();
    expect(await storage.getTopic(b.id)).toBeUndefined();
    expect(await storage.getQuestionsByTopic(b.id)).toEqual([]);
    // Untargeted topic survives.
    expect(await storage.getTopic(survivor.id)).toBeDefined();
  });
});

describe("TopicsRepository — moveTopicsToFolder", () => {
  it("returns 0 for an empty id list (guard branch)", async () => {
    expect(await storage.moveTopicsToFolder([], randomUUID())).toBe(0);
  });

  it("moves topics into a folder and back to root, returning the count", async () => {
    const folderId = randomUUID(); // topics.folderId has no FK, no folder row needed
    const a = await storage.createTopic({ name: "M1" } as never);
    const b = await storage.createTopic({ name: "M2" } as never);

    expect(await storage.moveTopicsToFolder([a.id, b.id], folderId)).toBe(2);
    expect((await storage.getTopic(a.id))?.folderId).toBe(folderId);
    expect((await storage.getTopic(b.id))?.folderId).toBe(folderId);

    expect(await storage.moveTopicsToFolder([a.id], null)).toBe(1);
    expect((await storage.getTopic(a.id))?.folderId).toBeNull();
    expect((await storage.getTopic(b.id))?.folderId).toBe(folderId);
  });
});

describe("TopicsRepository — feedback-derived recommendations", () => {
  it("getTopicCourses / getTopicEvents project the topic's feedback_json", async () => {
    const topic = await storage.createTopic({
      name: "WithFeedback",
      feedbackJson: {
        format: "plain",
        text: "",
        links: [{ title: "Course 1", url: "https://example.com/1" }],
        assets: [],
        events: [{ title: "Event 1" }],
      },
    } as never);

    const courses = await storage.getTopicCourses(topic.id);
    expect(courses).toEqual([
      { id: `${topic.id}:link:0`, topicId: topic.id, title: "Course 1", url: "https://example.com/1" },
    ]);
    const events = await storage.getTopicEvents(topic.id);
    expect(events).toEqual([{ id: `${topic.id}:event:0`, topicId: topic.id, title: "Event 1" }]);
  });

  it("returns empty arrays for a topic without feedback_json", async () => {
    const topic = await storage.createTopic({ name: "Bare" } as never);
    expect(await storage.getTopicCourses(topic.id)).toEqual([]);
    expect(await storage.getTopicEvents(topic.id)).toEqual([]);
  });

  it("returns empty arrays for a missing topic", async () => {
    expect(await storage.getTopicCourses(randomUUID())).toEqual([]);
    expect(await storage.getTopicEvents(randomUUID())).toEqual([]);
  });
});

describe("TopicsRepository — duplicateTopicWithQuestions", () => {
  it("returns undefined for a missing topic", async () => {
    expect(await storage.duplicateTopicWithQuestions(randomUUID(), U2)).toBeUndefined();
  });

  it("copies the topic + questions with copy invariants (owner, private, unique name)", async () => {
    const original = await seedTopicWithQuestions(2, "Src");

    const result = await storage.duplicateTopicWithQuestions(original.id, U2);
    expect(result).toBeDefined();
    const copy = result!.topic;

    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toBe("Src (копия)");
    expect(copy.nameNormalized).toBe(normalizeTopicName("Src (копия)"));
    expect(copy.visibility).toBe("private");
    expect(copy.ownerId).toBe(U2);
    expect(copy.createdBy).toBe(U2);

    expect(result!.questions).toHaveLength(2);
    const copied = await storage.getQuestionsByTopic(copy.id);
    expect(copied.map((q) => q.prompt).sort()).toEqual(["Q1", "Q2"]);
  });

  it("makes the name unique when one owner duplicates the same topic twice (loop branch)", async () => {
    const original = await seedTopicWithQuestions(0, "Dup");
    const first = await storage.duplicateTopicWithQuestions(original.id, U2);
    const second = await storage.duplicateTopicWithQuestions(original.id, U2);
    expect(first!.topic.name).toBe("Dup (копия)");
    expect(second!.topic.name).toBe("Dup (копия) 2");
    expect((await storage.getTopics()).filter((t) => t.ownerId === U2)).toHaveLength(2);
  });

  it("keeps the base copy name for an unowned copy (uniqueTopicName !ownerId branch)", async () => {
    const original = await seedTopicWithQuestions(0, "Anon");
    // No createdBy -> ownerId NULL -> uniqueTopicName short-circuits to base.
    const first = await storage.duplicateTopicWithQuestions(original.id);
    const second = await storage.duplicateTopicWithQuestions(original.id);
    expect(first!.topic.ownerId).toBeNull();
    expect(first!.topic.name).toBe("Anon (копия)");
    // Unowned rows are excluded from the uniqueness index, so the name repeats.
    expect(second!.topic.name).toBe("Anon (копия)");
  });
});
