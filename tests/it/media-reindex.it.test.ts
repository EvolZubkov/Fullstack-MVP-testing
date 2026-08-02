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

    expect(report.entities).toBe(1);
    const usages = await storage.getMediaUsagesByAsset(asset.id);
    expect(usages).toHaveLength(1);
    expect(usages[0].entityId).toBe(question.id);
  });
});
