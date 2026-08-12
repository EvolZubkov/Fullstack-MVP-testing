// @vitest-environment node
/**
 * @module tests/storage/tests-repository.test
 * @description DAL coverage for {@link module:server/storage/tests-repository}
 * (the test aggregate: `tests` row lifecycle, sections reads, publication
 * snapshots and the "where used" referential lookups) against a real (pglite)
 * database. Driven through the `DatabaseStorage` facade so both the repository
 * and its facade delegations are exercised. Runs in the `node` environment
 * (per-file override) so pglite works under the otherwise-jsdom unit run, and
 * because it lives under `tests/` (not `tests/it/`) its coverage counts toward
 * the reported total. Fidelity caveat: pglite does not populate `rowCount` for
 * DELETE/UPDATE without RETURNING, so deletions assert observable effects.
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
import {
  tests, testSections, testSnapshots, attempts, questions, questionMeasurements,
  contentPages, topics, scales,
} from "@shared/schema";

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

// ─── Direct-insert helpers (bypass facade/Zod defaults) ─────────────────────

/** Insert a minimal `tests` row directly and return its id. */
async function insertTest(overrides: Record<string, unknown> = {}): Promise<string> {
  const id = (overrides.id as string) ?? randomUUID();
  await h.current!.db.insert(tests).values({
    id,
    title: "T",
    overallPassRuleJson: {},
    ...overrides,
    id,
  } as never);
  return id;
}

/** Insert a minimal `topics` row directly and return its id. */
async function insertTopic(): Promise<string> {
  const id = randomUUID();
  await h.current!.db.insert(topics).values({ id, name: "Topic" } as never);
  return id;
}

/** Insert a minimal `questions` row directly and return its id. */
async function insertQuestion(topicId: string): Promise<string> {
  const id = randomUUID();
  await h.current!.db.insert(questions).values({
    id, topicId, type: "single", prompt: "P", dataJson: {}, correctJson: {},
  } as never);
  return id;
}

/** Insert a `test_sections` row directly. */
async function insertSection(testId: string, topicId: string, sortOrder = 0): Promise<string> {
  const id = randomUUID();
  await h.current!.db.insert(testSections).values({
    id, testId, topicId, drawCount: 1, sortOrder,
  } as never);
  return id;
}

/** Insert a `scales` row directly and return its id. */
async function insertScale(testId: string, key = "s1"): Promise<string> {
  const id = randomUUID();
  await h.current!.db.insert(scales).values({
    id, testId, key, label: "S", type: "number",
  } as never);
  return id;
}

describe("TestsRepository — getTests / getTest + legacy normalization", () => {
  it("getTests returns all rows, mapped through legacy normalization", async () => {
    await insertTest({ title: "A", status: "draft", published: false });
    await insertTest({ title: "B", status: "published", published: true });
    const rows = await storage.getTests();
    expect(rows).toHaveLength(2);
    expect(rows.map((t) => t.title).sort()).toEqual(["A", "B"]);
  });

  it("getTest returns undefined for an unknown id", async () => {
    expect(await storage.getTest(randomUUID())).toBeUndefined();
  });

  it("getTest returns a consistent row unchanged (early-return branch)", async () => {
    const id = await insertTest({ status: "draft", published: false });
    const row = await storage.getTest(id);
    expect(row?.status).toBe("draft");
    expect(row?.published).toBe(false);
  });

  it("getTest derives status from published when status is empty (legacy row)", async () => {
    // status stored as plain text (not a real PG enum), so an empty value models
    // a pre-migration row; mapLegacyTest derives it from `published`.
    const id = await insertTest({ status: "", published: true });
    const row = await storage.getTest(id);
    expect(row?.status).toBe("published");
    expect(row?.published).toBe(true);
  });

  it("getTest re-syncs published when it drifts from status (mismatch branch)", async () => {
    const id = await insertTest({ status: "published", published: false });
    const row = await storage.getTest(id);
    expect(row?.status).toBe("published");
    expect(row?.published).toBe(true); // derived from status, overriding stored false
  });
});

describe("TestsRepository — getMigrationHealth", () => {
  it("reports zero when no test carries an unmigrated start page", async () => {
    await insertTest({ startPageContent: null });
    await insertTest({ startPageContent: "   " }); // whitespace-only → not legacy
    expect((await storage.getMigrationHealth()).legacyStartPageCount).toBe(0);
  });

  it("counts a test with non-empty start page and no intro content-page", async () => {
    const legacy = await insertTest({ startPageContent: "Welcome" });
    // A migrated test: same start page but an intro content-page (topic_id NULL).
    const migrated = await insertTest({ startPageContent: "Welcome" });
    await h.current!.db.insert(contentPages).values({
      testId: migrated, position: "before", type: "intro", kind: "intro",
    } as never);
    void legacy;
    expect((await storage.getMigrationHealth()).legacyStartPageCount).toBe(1);
  });
});

describe("TestsRepository — updateTest", () => {
  it("returns undefined for an unknown id", async () => {
    expect(await storage.updateTest(randomUUID(), { title: "X" })).toBeUndefined();
  });

  it("bumps version and syncs published from status", async () => {
    const id = await insertTest({ status: "draft", published: false, version: 1 });
    const updated = await storage.updateTest(id, { status: "published" });
    expect(updated?.status).toBe("published");
    expect(updated?.published).toBe(true);
    expect(updated?.version).toBe(2);
  });

  it("syncs status from published when only published is patched", async () => {
    const id = await insertTest({ status: "published", published: true });
    const updated = await storage.updateTest(id, { published: false });
    expect(updated?.published).toBe(false);
    expect(updated?.status).toBe("draft");
  });

  it("patches other fields without touching status/published sync", async () => {
    const id = await insertTest({ title: "Old", status: "draft", published: false });
    const updated = await storage.updateTest(id, { title: "New" });
    expect(updated?.title).toBe("New");
    expect(updated?.status).toBe("draft");
    expect(updated?.version).toBe(2);
  });
});

describe("TestsRepository — patchTestStatus", () => {
  it("returns undefined for an unknown id", async () => {
    expect(await storage.patchTestStatus(randomUUID(), "published")).toBeUndefined();
  });

  it("sets published=true when moving to published", async () => {
    const id = await insertTest({ status: "draft", published: false });
    const patched = await storage.patchTestStatus(id, "published");
    expect(patched?.status).toBe("published");
    const [row] = await h.current!.db.select().from(tests);
    expect(row.published).toBe(true);
  });

  it("clears published when moving to archived", async () => {
    const id = await insertTest({ status: "published", published: true });
    const patched = await storage.patchTestStatus(id, "archived");
    expect(patched?.status).toBe("archived");
    const [row] = await h.current!.db.select().from(tests);
    expect(row.published).toBe(false);
  });
});

describe("TestsRepository — deleteTest", () => {
  it("returns false for an unknown id", async () => {
    expect(await storage.deleteTest(randomUUID())).toBe(false);
  });

  it("deletes the test and its sections/snapshots, returns true", async () => {
    const topicId = await insertTopic();
    const testId = await insertTest();
    await insertSection(testId, topicId);
    await storage.createTestSnapshot({ testId, version: 1, contentJson: {}, publishedBy: null });

    expect(await storage.deleteTest(testId)).toBe(true);
    expect(await storage.getTest(testId)).toBeUndefined();
    expect(await storage.getTestSections(testId)).toHaveLength(0);
    expect(await storage.getSnapshotsForTest(testId)).toHaveLength(0);
  });
});

describe("TestsRepository — sections reads", () => {
  it("getTestSections returns rows for a test ordered by sortOrder", async () => {
    const topicA = await insertTopic();
    const topicB = await insertTopic();
    const testId = await insertTest();
    // Insert out of order; getTestSections must return them by sortOrder.
    await insertSection(testId, topicB, 1);
    await insertSection(testId, topicA, 0);

    const sections = await storage.getTestSections(testId);
    expect(sections).toHaveLength(2);
    expect(sections[0].sortOrder).toBe(0);
    expect(sections[0].topicId).toBe(topicA);
    expect(sections[1].topicId).toBe(topicB);
  });

  it("getTestSections returns empty for a test with no sections", async () => {
    const testId = await insertTest();
    expect(await storage.getTestSections(testId)).toEqual([]);
  });

  it("getTestSectionsByTopic returns sections across tests for a topic", async () => {
    const topicId = await insertTopic();
    const other = await insertTopic();
    const testA = await insertTest();
    const testB = await insertTest();
    await insertSection(testA, topicId);
    await insertSection(testB, topicId);
    await insertSection(testB, other);

    const rows = await storage.getTestSectionsByTopic(topicId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.topicId === topicId)).toBe(true);
  });
});

describe("TestsRepository — getTopicPageRefs", () => {
  it("returns the tests whose content pages reference a topic", async () => {
    const topicId = await insertTopic();
    const testA = await insertTest();
    const testB = await insertTest();
    await h.current!.db.insert(contentPages).values({
      testId: testA, topicId, position: "before_topic", type: "info", kind: "info",
    } as never);
    await h.current!.db.insert(contentPages).values({
      testId: testB, topicId, position: "before_topic", type: "info", kind: "info",
    } as never);
    // A page on another topic must not appear.
    const otherTopic = await insertTopic();
    await h.current!.db.insert(contentPages).values({
      testId: testA, topicId: otherTopic, position: "before_topic", type: "info", kind: "info",
    } as never);

    const refs = await storage.getTopicPageRefs(topicId);
    expect(refs.map((r) => r.testId).sort()).toEqual([testA, testB].sort());
  });

  it("returns empty when no content page references the topic", async () => {
    expect(await storage.getTopicPageRefs(randomUUID())).toEqual([]);
  });
});

describe("TestsRepository — where-used lookups", () => {
  it("getTestsUsingTopic returns distinct tests delivering a topic", async () => {
    const topicId = await insertTopic();
    const testId = await insertTest({ title: "Uses topic", mode: "standard" });
    // Two sections on the same topic must still yield ONE test (selectDistinct).
    await insertSection(testId, topicId, 0);
    await insertSection(testId, topicId, 1);
    const unrelated = await insertTest();
    await insertSection(unrelated, await insertTopic());

    const refs = await storage.getTestsUsingTopic(topicId);
    expect(refs).toHaveLength(1);
    expect(refs[0].id).toBe(testId);
    expect(refs[0].title).toBe("Uses topic");
  });

  it("getTestsUsingTopic returns empty for an unused topic", async () => {
    expect(await storage.getTestsUsingTopic(randomUUID())).toEqual([]);
  });

  it("getTestsUsingQuestion merges topic-delivery and measurement dependents (deduped)", async () => {
    const topicId = await insertTopic();
    const questionId = await insertQuestion(topicId);

    // testA delivers the question via a section on its topic.
    const testA = await insertTest({ title: "A" });
    await insertSection(testA, topicId);
    // testB references the question through a scale measurement (PRD-5).
    const testB = await insertTest({ title: "B" });
    const scaleId = await insertScale(testB);
    await h.current!.db.insert(questionMeasurements).values({
      testId: testB, questionId, scaleId, sourceType: "question", valueJson: 1,
    } as never);
    // testC delivers the topic AND has a measurement — must be deduplicated.
    const testC = await insertTest({ title: "C" });
    await insertSection(testC, topicId);
    const scaleC = await insertScale(testC);
    await h.current!.db.insert(questionMeasurements).values({
      testId: testC, questionId, scaleId: scaleC, sourceType: "question", valueJson: 2,
    } as never);

    const refs = await storage.getTestsUsingQuestion(questionId);
    expect(refs.map((r) => r.id).sort()).toEqual([testA, testB, testC].sort());
  });

  it("getTestsUsingQuestion returns empty when the question does not exist", async () => {
    // No question row → byTopic is empty; no measurements → viaMeasurements empty.
    expect(await storage.getTestsUsingQuestion(randomUUID())).toEqual([]);
  });
});

describe("TestsRepository — publication snapshots", () => {
  it("createTestSnapshot / getSnapshot round-trip", async () => {
    const testId = await insertTest();
    const snap = await storage.createTestSnapshot({
      testId, version: 1, contentJson: { hello: "world" }, publishedBy: "admin-1",
    });
    expect(snap.version).toBe(1);
    expect(snap.publishedBy).toBe("admin-1");

    const fetched = await storage.getSnapshot(snap.id);
    expect(fetched?.contentJson).toEqual({ hello: "world" });
    expect(await storage.getSnapshot(randomUUID())).toBeUndefined();
  });

  it("getLatestSnapshot returns the highest version", async () => {
    const testId = await insertTest();
    await storage.createTestSnapshot({ testId, version: 1, contentJson: {}, publishedBy: null });
    await storage.createTestSnapshot({ testId, version: 3, contentJson: { v: 3 }, publishedBy: null });
    await storage.createTestSnapshot({ testId, version: 2, contentJson: {}, publishedBy: null });

    const latest = await storage.getLatestSnapshot(testId);
    expect(latest?.version).toBe(3);
    expect(latest?.contentJson).toEqual({ v: 3 });
    expect(await storage.getLatestSnapshot(randomUUID())).toBeUndefined();
  });

  it("getSnapshotsForTest returns all versions in descending order", async () => {
    const testId = await insertTest();
    await storage.createTestSnapshot({ testId, version: 1, contentJson: {}, publishedBy: null });
    await storage.createTestSnapshot({ testId, version: 2, contentJson: {}, publishedBy: null });

    const rows = await storage.getSnapshotsForTest(testId);
    expect(rows.map((r) => r.version)).toEqual([2, 1]);
  });

  it("deleteSnapshotById removes a single snapshot", async () => {
    const testId = await insertTest();
    const s1 = await storage.createTestSnapshot({ testId, version: 1, contentJson: {}, publishedBy: null });
    const s2 = await storage.createTestSnapshot({ testId, version: 2, contentJson: {}, publishedBy: null });

    await storage.deleteSnapshotById(s1.id);
    expect(await storage.getSnapshot(s1.id)).toBeUndefined();
    expect(await storage.getSnapshot(s2.id)).toBeDefined();
  });

  it("deleteSnapshotsForTest removes every snapshot of a test", async () => {
    const testId = await insertTest();
    await storage.createTestSnapshot({ testId, version: 1, contentJson: {}, publishedBy: null });
    await storage.createTestSnapshot({ testId, version: 2, contentJson: {}, publishedBy: null });

    await storage.deleteSnapshotsForTest(testId);
    expect(await storage.getSnapshotsForTest(testId)).toHaveLength(0);
  });

  it("getReferencedSnapshotIds returns distinct non-null snapshot ids from attempts", async () => {
    const testId = await insertTest();
    const s1 = await storage.createTestSnapshot({ testId, version: 1, contentJson: {}, publishedBy: null });
    const userId = randomUUID();
    // Two attempts pin s1 (must be deduped), one attempt has no snapshot (excluded).
    await h.current!.db.insert(attempts).values({
      id: randomUUID(), userId, testId, snapshotId: s1.id, variantJson: {}, startedAt: new Date("2024-01-01"),
    } as never);
    await h.current!.db.insert(attempts).values({
      id: randomUUID(), userId, testId, snapshotId: s1.id, variantJson: {}, startedAt: new Date("2024-01-02"),
    } as never);
    await h.current!.db.insert(attempts).values({
      id: randomUUID(), userId, testId, snapshotId: null, variantJson: {}, startedAt: new Date("2024-01-03"),
    } as never);

    const ids = await storage.getReferencedSnapshotIds(testId);
    expect(ids).toEqual([s1.id]);
  });

  it("getReferencedSnapshotIds returns empty when no attempt pins a snapshot", async () => {
    const testId = await insertTest();
    expect(await storage.getReferencedSnapshotIds(testId)).toEqual([]);
  });
});
