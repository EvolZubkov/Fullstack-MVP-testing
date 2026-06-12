/**
 * @module tests/test-snapshot-delivery
 *
 * Integration tests of PRD-15 block B publication snapshots (T-24, BRC-20..24):
 * - createTestSnapshot freezes the deliverable and prunes stale versions (FR-10/FR-17);
 * - dataSourceForAttempt serves a pinned attempt from its snapshot, isolated
 *   from later bank edits (FR-11/FR-13);
 * - getPublicationState detects pool drift and post-publish edits (FR-12).
 *
 * Storage is mocked: the service layer is the unit under test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
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
    getLatestSnapshot: vi.fn(),
    getSnapshot: vi.fn(),
    getSnapshotsForTest: vi.fn(),
    getReferencedSnapshotIds: vi.fn(),
    deleteSnapshotById: vi.fn(),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));

import {
  buildSnapshotContent,
  createTestSnapshot,
  dataSourceForAttempt,
  exportSourceForTest,
  getPublicationState,
} from "../server/services/test-snapshot";

const q = (id: string, contentHash: string, topicId = "tp1") =>
  ({ id, topicId, type: "single", points: 1, difficulty: 50, tags: [], contentHash }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getTest.mockResolvedValue({ id: "t1", title: "T", mode: "standard", version: 3, status: "published" });
  storageMock.getTestSections.mockResolvedValue([{ id: "s1", testId: "t1", topicId: "tp1", drawCount: 1 }]);
  storageMock.getTopics.mockResolvedValue([{ id: "tp1", name: "Тема" }]);
  storageMock.getQuestionsByTopic.mockResolvedValue([q("q1", "h1"), q("q2", "h2")]);
  storageMock.getTopicCourses.mockResolvedValue([]);
  storageMock.getTopicEvents.mockResolvedValue([]);
  storageMock.getScales.mockResolvedValue([]);
  storageMock.getQuestionMeasurements.mockResolvedValue([]);
  storageMock.getResultVariables.mockResolvedValue([]);
  storageMock.getContentPages.mockResolvedValue([]);
  storageMock.getTestQuestionScoring.mockResolvedValue([]);
  storageMock.getLatestSnapshot.mockResolvedValue(undefined);
  storageMock.getSnapshotsForTest.mockResolvedValue([]);
  storageMock.getReferencedSnapshotIds.mockResolvedValue([]);
  storageMock.createTestSnapshot.mockImplementation(async (s: any) => ({ id: "snap-new", ...s }));
});

describe("buildSnapshotContent — captures the deliverable", () => {
  it("freezes sections, the topic pool and scoring config", async () => {
    const content = await buildSnapshotContent("t1");
    expect(content?.test.id).toBe("t1");
    expect(content?.sections).toHaveLength(1);
    expect(content?.questionsByTopic.tp1.map((x) => x.id)).toEqual(["q1", "q2"]);
  });

  it("returns null for a missing test", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    expect(await buildSnapshotContent("gone")).toBeNull();
  });

  // PRD-15 block D (FR-32): overrides freeze RAW and resolve at delivery.
  it("freezes the per-test scoring overrides raw", async () => {
    const row = { id: "ov1", testId: "t1", questionId: "q1", points: 7, scoringJson: null, difficulty: null, pinnedContentHash: "h1" };
    storageMock.getTestQuestionScoring.mockResolvedValue([row]);
    const content = await buildSnapshotContent("t1");
    expect(content?.questionScoring).toEqual([row]);
  });

  it("a pre-block-D snapshot (no questionScoring) serves an empty override set", async () => {
    const frozen = await buildSnapshotContent("t1");
    delete (frozen as any).questionScoring; // emulate an old snapshot blob
    storageMock.getSnapshot.mockResolvedValue({ id: "snap-old", contentJson: frozen });
    const src = await dataSourceForAttempt("snap-old");
    expect(await src.getTestQuestionScoring("t1")).toEqual([]);
  });
});

describe("createTestSnapshot — versioning and retention (FR-10/FR-17)", () => {
  it("assigns version latest+1", async () => {
    storageMock.getLatestSnapshot.mockResolvedValue({ id: "old", version: 4 });
    await createTestSnapshot("t1", "admin");
    expect(storageMock.createTestSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ testId: "t1", version: 5, publishedBy: "admin" }),
    );
  });

  it("prunes snapshots not kept and not referenced by attempts", async () => {
    storageMock.getSnapshotsForTest.mockResolvedValue([
      { id: "snap-new", version: 2 },
      { id: "snap-old-unref", version: 1 },
      { id: "snap-old-ref", version: 0 },
    ]);
    storageMock.getReferencedSnapshotIds.mockResolvedValue(["snap-old-ref"]);
    await createTestSnapshot("t1", null);
    // The new one and the referenced one are kept; the unreferenced old is dropped.
    expect(storageMock.deleteSnapshotById).toHaveBeenCalledWith("snap-old-unref");
    expect(storageMock.deleteSnapshotById).not.toHaveBeenCalledWith("snap-old-ref");
    expect(storageMock.deleteSnapshotById).not.toHaveBeenCalledWith("snap-new");
  });
});

describe("dataSourceForAttempt — isolation (FR-11/FR-13)", () => {
  it("serves a pinned attempt from its snapshot, ignoring live bank edits", async () => {
    const frozen = await buildSnapshotContent("t1"); // pool = q1,q2
    storageMock.getSnapshot.mockResolvedValue({ id: "snap-1", contentJson: frozen });
    // The live bank changes after capture — must not leak into the pinned source.
    storageMock.getQuestionsByTopic.mockResolvedValue([q("q1", "h1"), q("q2", "h2"), q("q3", "h3")]);

    const src = await dataSourceForAttempt("snap-1");
    expect((await src.getQuestionsByTopic("tp1")).map((x) => x.id)).toEqual(["q1", "q2"]);
  });

  it("falls back to live storage for an unpinned (legacy/draft) attempt", async () => {
    const src = await dataSourceForAttempt(null);
    expect((await src.getQuestionsByTopic("tp1")).map((x) => x.id)).toEqual(["q1", "q2"]);
  });

  it("falls back to live storage when the pinned snapshot is missing", async () => {
    storageMock.getSnapshot.mockResolvedValue(undefined);
    const src = await dataSourceForAttempt("ghost");
    expect(await src.getTest("t1")).toBeTruthy();
  });
});

describe("exportSourceForTest — SCORM from snapshot (FR-16)", () => {
  it("exports a published test from its active snapshot, not live edits", async () => {
    const frozen = await buildSnapshotContent("t1"); // pool q1,q2
    storageMock.getLatestSnapshot.mockResolvedValue({ id: "snap-1", contentJson: frozen });
    storageMock.getQuestionsByTopic.mockResolvedValue([q("q1", "h1"), q("q9", "h9")]); // live drifted
    const src = await exportSourceForTest("t1");
    expect((await src.getQuestionsByTopic("tp1")).map((x) => x.id)).toEqual(["q1", "q2"]);
  });

  it("exports a draft from live storage (no snapshot)", async () => {
    storageMock.getTest.mockResolvedValue({ id: "t1", mode: "standard", version: 1, status: "draft" });
    const src = await exportSourceForTest("t1");
    expect((await src.getQuestionsByTopic("tp1")).map((x) => x.id)).toEqual(["q1", "q2"]);
    expect(storageMock.getLatestSnapshot).not.toHaveBeenCalled();
  });

  it("snapshot topics carry full rows (name + feedback) for the SCORM builder", async () => {
    storageMock.getTopics.mockResolvedValue([
      { id: "tp1", name: "Тема", feedback: "Фидбек темы", description: null, folderId: null },
    ]);
    const content = await buildSnapshotContent("t1");
    expect(content?.topics[0]).toMatchObject({ id: "tp1", name: "Тема", feedback: "Фидбек темы" });
  });
});

describe("getPublicationState — drift detection (FR-12)", () => {
  it("reports plain published when nothing diverged", async () => {
    const frozen = await buildSnapshotContent("t1"); // captured at version 3
    storageMock.getLatestSnapshot.mockResolvedValue({ id: "snap-1", version: 1, contentJson: frozen });
    const st = await getPublicationState("t1");
    expect(st.state).toBe("published");
    expect(st.editedAfterPublish).toBe(false);
    expect(st.poolDrift).toBe(false);
  });

  it("flags editedAfterPublish when the test version bumped past the snapshot", async () => {
    const frozen = await buildSnapshotContent("t1");
    storageMock.getLatestSnapshot.mockResolvedValue({ id: "snap-1", version: 1, contentJson: frozen });
    storageMock.getTest.mockResolvedValue({ id: "t1", mode: "standard", version: 5, status: "published" });
    const st = await getPublicationState("t1");
    expect(st.state).toBe("published_with_changes");
    expect(st.editedAfterPublish).toBe(true);
  });

  it("flags poolDrift when a topic gained a question since publish", async () => {
    const frozen = await buildSnapshotContent("t1"); // pool h1,h2 at version 3
    storageMock.getLatestSnapshot.mockResolvedValue({ id: "snap-1", version: 1, contentJson: frozen });
    // Same test version, but the live pool grew → drift.
    storageMock.getQuestionsByTopic.mockResolvedValue([q("q1", "h1"), q("q2", "h2"), q("q3", "h3")]);
    const st = await getPublicationState("t1");
    expect(st.state).toBe("published_with_changes");
    expect(st.poolDrift).toBe(true);
  });

  it("flags poolDrift when a question was edited (contentHash changed)", async () => {
    const frozen = await buildSnapshotContent("t1");
    storageMock.getLatestSnapshot.mockResolvedValue({ id: "snap-1", version: 1, contentJson: frozen });
    storageMock.getQuestionsByTopic.mockResolvedValue([q("q1", "h1-EDITED"), q("q2", "h2")]);
    const st = await getPublicationState("t1");
    expect(st.poolDrift).toBe(true);
  });

  it("maps draft straight through without snapshot lookups", async () => {
    storageMock.getTest.mockResolvedValue({ id: "t1", mode: "standard", version: 1, status: "draft" });
    const st = await getPublicationState("t1");
    expect(st.state).toBe("draft");
    expect(storageMock.getLatestSnapshot).not.toHaveBeenCalled();
  });
});
