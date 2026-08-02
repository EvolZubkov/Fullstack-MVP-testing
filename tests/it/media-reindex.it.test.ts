/**
 * @module tests/it/media-reindex
 * @description `reindexAllUsages` through the REAL facade against pglite. The mock-based
 * unit suite (`tests/media-reindex.test.ts`) proves the route wires the right calls; this
 * suite proves the calls actually work against real SQL — in particular that
 * `MediaRepository.deleteUsagesExcept` (`<> ALL($1)`, a single array-typed bind parameter)
 * correctly drops the usage rows of an entity that no longer exists while leaving a live
 * entity's rows alone. That gap — a topic/folder cascade delete removing a question directly
 * via SQL without going through the write-time index — is exactly what
 * `server/storage/topics-repository.ts`'s cascades used to leave behind before the route
 * handlers started handing the cascaded ids to `clearCascadedUsages`; a full reindex is the
 * backstop for anything that still slips through.
 *
 * Since PRD-32 the walk also covers the feedback blocks — `test_feedback`, `topic_feedback`
 * and the test-wide `scale_feedback`/`variable_feedback` sets — so this suite exercises them
 * against real SQL in both directions: an attachment written WITHOUT the indexing route (the
 * Excel import and friends) gains its rows, and rows whose owning test or topic is gone lose
 * theirs.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { tests } from "@shared/schema";
import { createHarness, type Harness } from "./db-harness";

const h = vi.hoisted(() => ({ current: null as Harness | null }));
vi.mock("../../server/db", () => ({
  get db() {
    if (!h.current) throw new Error("harness not initialized");
    return h.current.db;
  },
}));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { storage } from "../../server/storage";
// eslint-disable-next-line import/first
import { syncEntityUsages, reindexAllUsages } from "../../server/services/media/usage-index";

beforeAll(async () => {
  h.current = await createHarness();
});
afterAll(async () => {
  await h.current!.close();
});
beforeEach(async () => {
  await h.current!.reset();
});

/** Minimal media asset insert; only the fields a test cares about vary. */
function assetPayload(overrides: Partial<Parameters<typeof storage.createMediaAsset>[0]> = {}) {
  return {
    checksum: "a".repeat(64),
    storageKey: "media/aa/aa/" + "a".repeat(64) + ".png",
    mimeType: "image/png",
    byteSize: 10,
    kind: "image" as const,
    originalName: "pic.png",
    ownerId: "u1",
    visibility: "shared" as const,
    ...overrides,
  };
}

describe("reindexAllUsages — through the real facade against pglite", () => {
  it("drops the usage rows of a question that no longer exists, keeps a live one's", async () => {
    const topic = await storage.createTopic({ name: "T" } as never);
    const asset = await storage.createMediaAsset(assetPayload());
    // The live question carries the reference on its REAL `mediaUrl` column: the
    // reindex walker re-syncs every question from the row `getQuestions()` returns
    // (not from whatever was indexed before), so its usage row must be derivable
    // from that real row or the walker's own re-sync would drop it right back out
    // before the cleanup step even runs.
    const liveQuestion = await storage.createQuestion({
      topicId: topic.id, type: "single", prompt: "Live",
      dataJson: { options: ["a", "b"] }, correctJson: { correctIndex: 0 },
      mediaUrl: `/api/media/${asset.id}`,
    } as never);
    const goneQuestion = await storage.createQuestion({
      topicId: topic.id, type: "single", prompt: "Gone",
      dataJson: { options: ["a", "b"] }, correctJson: { correctIndex: 0 },
    } as never);
    await syncEntityUsages("question", liveQuestion.id, liveQuestion);
    // `goneQuestion` never carried a real `mediaUrl` — its index row only exists
    // because SOMETHING (standing in for a cascade delete that bypassed the
    // write-time cleanup) wrote it directly, which is exactly the gap this test
    // covers: the row must survive until the entity is examined and found gone.
    await syncEntityUsages("question", goneQuestion.id, { mediaUrl: `/api/media/${asset.id}` });

    // Simulate the cascade gap this task closes: the question is removed through the
    // repository facade directly, the same way a topic/folder cascade delete does at the
    // SQL level — no route-level cleanup call in between.
    await storage.deleteQuestion(goneQuestion.id);

    const before = await storage.getMediaUsagesByAsset(asset.id);
    expect(before.map((u) => u.entityId).sort()).toEqual([goneQuestion.id, liveQuestion.id].sort());

    await reindexAllUsages();

    const after = await storage.getMediaUsagesByAsset(asset.id);
    expect(after).toHaveLength(1);
    expect(after[0].entityId).toBe(liveQuestion.id);
  });

  it("leaves an untouched entity type's rows alone (scoped per type, not a global wipe)", async () => {
    const topic = await storage.createTopic({ name: "T" } as never);
    const asset = await storage.createMediaAsset(assetPayload());
    const question = await storage.createQuestion({
      topicId: topic.id, type: "single", prompt: "Q",
      dataJson: { options: ["a", "b"] }, correctJson: { correctIndex: 0 },
      mediaUrl: `/api/media/${asset.id}`,
    } as never);
    await syncEntityUsages("question", question.id, question);

    const report = await reindexAllUsages();

    // Question + topic: since PRD-32 the walk visits topics too (a topic carries its own
    // `topic_feedback` media), so the topic this fixture creates is an entity of its own.
    expect(report.entities).toBe(2);
    const usages = await storage.getMediaUsagesByAsset(asset.id);
    expect(usages).toHaveLength(1);
    expect(usages[0].entityId).toBe(question.id);
  });

  it("picks up the PRD-32 feedback blocks of a test, a topic, the scale set and the indicator set", async () => {
    // The whole point of the rebuild for these four types: the attachment was written into
    // storage WITHOUT the route that indexes it (this fixture stands in for the Excel import
    // and any other direct write), so nothing but the rebuild can produce the rows.
    const asset = await storage.createMediaAsset(assetPayload({
      mimeType: "application/pdf", kind: "document", originalName: "memo.pdf",
    }));
    const feedback = {
      assets: [
        { title: "Памятка", fileName: "memo.pdf", mimeType: "application/pdf", url: `/api/media/${asset.id}` },
      ],
    };
    // No `createTest` on the facade — the test row goes in directly, the same way the other
    // integration suites build one.
    const testId = randomUUID();
    await h.current!.db.insert(tests).values({
      id: testId, title: "T", overallPassRuleJson: { type: "percent", value: 80 },
      feedbackJson: feedback,
    } as never);
    const topic = await storage.createTopic({ name: "T", feedbackJson: feedback } as never);
    await storage.createScale({
      testId, key: "s", label: "S", type: "number",
      configJson: { interpretation: { bands: [{ min: 0, max: 10, feedback }] } },
    } as never);
    await storage.createResultVariable({
      testId, name: "v", label: "V", type: "number", formula: "1",
      configJson: { feedback },
    } as never);

    await reindexAllUsages();

    const rows = await storage.getMediaUsagesByAsset(asset.id);
    const byType = new Map(rows.map((u) => [u.entityType, u.entityId]));
    expect(byType.get("test_feedback")).toBe(testId);
    expect(byType.get("topic_feedback")).toBe(topic.id);
    // Keyed by the TEST, not by the scale/indicator row: the indexing unit is the whole set
    // (spec §6.1).
    expect(byType.get("scale_feedback")).toBe(testId);
    expect(byType.get("variable_feedback")).toBe(testId);
    // Exactly four rows, one per type — the design settings hold nothing, so `test_design`
    // must NOT also claim this file (no double counting of the same asset under one test).
    expect(rows).toHaveLength(4);
    expect(byType.size).toBe(4);

    // And the opposite drift: the owners are gone (again bypassing the write-time cleanup),
    // so the rebuild must drop every one of those rows.
    await storage.deleteTest(testId);
    await storage.deleteTopic(topic.id);
    await reindexAllUsages();
    expect(await storage.getMediaUsagesByAsset(asset.id)).toHaveLength(0);
  });
});
