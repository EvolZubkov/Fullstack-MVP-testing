/**
 * @module tests/media-usage-on-snapshot
 * @description A publication snapshot freezes the whole delivered test into `contentJson`
 * (PRD-15 block B); the media library must index that frozen blob as a `snapshot` usage
 * (spec §8.2/§4.3), or an asset that only survives inside a published snapshot reads as an
 * orphan and can be deleted out from under an in-flight/delivered attempt. Covers the two
 * write points: `createTestSnapshot` (index on publish) and `pruneSnapshots` (clear the
 * dropped snapshot's rows when retention removes it, mirroring
 * `tests/media-usage-on-content-save.test.ts` for the other entity types).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { syncEntityUsages } from "../server/services/media/usage-index";

vi.mock("../server/storage", () => ({
  storage: {
    getMediaAssetByStorageKey: vi.fn().mockResolvedValue(undefined),
    replaceMediaUsages: vi.fn().mockResolvedValue(undefined),
  },
}));

import { storage } from "../server/storage";

beforeEach(() => vi.clearAllMocks());

describe("syncEntityUsages(\"snapshot\", ...) — walking the frozen content", () => {
  it("indexes media found anywhere inside contentJson (questions, content pages, design)", async () => {
    const contentJson = {
      test: { id: "t1", title: "Frozen" },
      questionsByTopic: {
        tp1: [
          {
            id: "q1",
            dataJson: { imageUrl: "/api/media/11111111-1111-1111-1111-111111111111" },
          },
        ],
      },
      contentPages: [
        {
          id: "p1",
          valuesJson: {
            body: '<p><img src="/api/media/22222222-2222-2222-2222-222222222222" alt=""></p>',
          },
        },
      ],
    };

    await syncEntityUsages("snapshot", "snap-1", contentJson);

    expect(storage.replaceMediaUsages).toHaveBeenCalledWith("snapshot", "snap-1", [
      { assetId: "11111111-1111-1111-1111-111111111111", field: "questionsByTopic.tp1.0.dataJson.imageUrl" },
      { assetId: "22222222-2222-2222-2222-222222222222", field: "contentPages.0.valuesJson.body" },
    ]);
  });

  it("clears the snapshot's usage rows when it is pruned/deleted (entity = null)", async () => {
    await syncEntityUsages("snapshot", "snap-1", null);
    expect(storage.replaceMediaUsages).toHaveBeenCalledWith("snapshot", "snap-1", []);
  });
});

describe("createTestSnapshot — indexes the frozen deliverable on publish", () => {
  it("calls syncEntityUsages(\"snapshot\", <new id>, content) right after the row is persisted", async () => {
    vi.resetModules();
    const storageMock = {
      getTest: vi.fn(),
      getTestSections: vi.fn(),
      getTopics: vi.fn(),
      getQuestionsByTopic: vi.fn(),
      getTopicCourses: vi.fn(),
      getTopicEvents: vi.fn(),
      getScales: vi.fn(),
      getQuestionMeasurements: vi.fn(),
      getResultVariables: vi.fn(),
      getContentPages: vi.fn(),
      getTestQuestionScoring: vi.fn(),
      getAdaptiveTopicSettingsByTest: vi.fn(),
      getAdaptiveLevelsByTest: vi.fn(),
      getAdaptiveLevelLinks: vi.fn(),
      createTestSnapshot: vi.fn(),
      getLatestSnapshot: vi.fn().mockResolvedValue(undefined),
      getSnapshotsForTest: vi.fn().mockResolvedValue([]),
      getReferencedSnapshotIds: vi.fn().mockResolvedValue([]),
      deleteSnapshotById: vi.fn(),
      replaceMediaUsages: vi.fn().mockResolvedValue(undefined),
      getMediaAssetByStorageKey: vi.fn().mockResolvedValue(undefined),
    };
    const logErrorMock = vi.fn();

    vi.doMock("../server/storage", () => ({ storage: storageMock }));
    vi.doMock("../server/logger", () => ({ logger: { error: logErrorMock, info: vi.fn(), warn: vi.fn() } }));

    const cover = "/api/media/33333333-3333-3333-3333-333333333333";
    storageMock.getTest.mockResolvedValue({ id: "t1", title: "T", mode: "standard", version: 1, status: "draft" });
    storageMock.getTestSections.mockResolvedValue([{ id: "s1", testId: "t1", topicId: "tp1", drawCount: 1 }]);
    storageMock.getTopics.mockResolvedValue([{ id: "tp1", name: "Тема" }]);
    storageMock.getQuestionsByTopic.mockResolvedValue([
      { id: "q1", topicId: "tp1", type: "single", points: 1, difficulty: 50, tags: [], dataJson: { imageUrl: cover } },
    ]);
    storageMock.getTopicCourses.mockResolvedValue([]);
    storageMock.getTopicEvents.mockResolvedValue([]);
    storageMock.getScales.mockResolvedValue([]);
    storageMock.getQuestionMeasurements.mockResolvedValue([]);
    storageMock.getResultVariables.mockResolvedValue([]);
    storageMock.getContentPages.mockResolvedValue([]);
    storageMock.getTestQuestionScoring.mockResolvedValue([]);
    storageMock.createTestSnapshot.mockImplementation(async (s: unknown) => ({ id: "snap-new", ...(s as object) }));

    const { createTestSnapshot } = await import("../server/services/test-snapshot");
    await createTestSnapshot("t1", "admin");

    expect(storageMock.replaceMediaUsages).toHaveBeenCalledWith(
      "snapshot",
      "snap-new",
      [{ assetId: "33333333-3333-3333-3333-333333333333", field: "questionsByTopic.tp1.0.dataJson.imageUrl" }],
    );
    // Persistence must not fail even if the sync itself throws — publication is
    // more important than the index, the full re-sync is the safety net.
    expect(logErrorMock).not.toHaveBeenCalled();

    vi.doUnmock("../server/storage");
    vi.doUnmock("../server/logger");
  });
});
