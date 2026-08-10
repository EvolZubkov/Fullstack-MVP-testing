/**
 * @module tests/media-asset-access
 * @description The delivery rule (§6.1 of the spec). Three independent grounds: owner or
 * admin, a shared file to an authoring role, and — the only one that lets a LEARNER
 * through — the asset being used in content that learner may reach.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getMediaUsagesByAsset: vi.fn(),
    getQuestion: vi.fn(),
    isTestAssignedToUser: vi.fn(),
    getTestSectionsByTopic: vi.fn(),
    getContentPage: vi.fn(),
    getSnapshot: vi.fn(),
  },
}));
vi.mock("../server/storage", () => ({ storage: storageMock }));

import { ROLES } from "../shared/access";
import { canDeliverAsset, clearAssetAccessCache } from "../server/services/media/asset-access";

const asset = (over: Record<string, unknown> = {}) => ({
  id: "a1", ownerId: "author-1", visibility: "shared", ...over,
} as never);

beforeEach(() => {
  vi.clearAllMocks();
  clearAssetAccessCache();
  storageMock.getMediaUsagesByAsset.mockResolvedValue([]);
});

describe("canDeliverAsset", () => {
  it("lets the owner through", async () => {
    const ok = await canDeliverAsset(asset({ visibility: "private" }), "author-1", [ROLES.AUTHOR]);
    expect(ok).toBe(true);
  });

  it("lets an administrator through", async () => {
    const ok = await canDeliverAsset(asset({ visibility: "private" }), "someone", [ROLES.ADMINISTRATOR]);
    expect(ok).toBe(true);
  });

  it("lets an authoring role read a shared file", async () => {
    const ok = await canDeliverAsset(asset(), "author-2", [ROLES.AUTHOR]);
    expect(ok).toBe(true);
  });

  it("refuses another author a private file", async () => {
    const ok = await canDeliverAsset(asset({ visibility: "private" }), "author-2", [ROLES.AUTHOR]);
    expect(ok).toBe(false);
  });

  it("refuses a learner a file used nowhere", async () => {
    const ok = await canDeliverAsset(asset(), "learner-1", [ROLES.LEARNER]);
    expect(ok).toBe(false);
  });

  it("lets a learner through when the file is used by an assigned test", async () => {
    storageMock.getMediaUsagesByAsset.mockResolvedValue([
      { assetId: "a1", entityType: "content_page", entityId: "page-1", field: "image" },
    ]);
    storageMock.getContentPage.mockResolvedValue({ id: "page-1", testId: "t1" });
    storageMock.isTestAssignedToUser.mockResolvedValue(true);
    const ok = await canDeliverAsset(asset(), "learner-1", [ROLES.LEARNER]);
    expect(ok).toBe(true);
    expect(storageMock.isTestAssignedToUser).toHaveBeenCalledWith("t1", "learner-1");
  });

  it("reaches the test of a question through its topic's sections", async () => {
    storageMock.getMediaUsagesByAsset.mockResolvedValue([
      { assetId: "a1", entityType: "question", entityId: "q-1", field: "mediaUrl" },
    ]);
    storageMock.getQuestion.mockResolvedValue({ id: "q-1", topicId: "top-1" });
    storageMock.getTestSectionsByTopic.mockResolvedValue([{ testId: "t9" }]);
    storageMock.isTestAssignedToUser.mockResolvedValue(true);
    expect(await canDeliverAsset(asset(), "learner-1", [ROLES.LEARNER])).toBe(true);
    expect(storageMock.isTestAssignedToUser).toHaveBeenCalledWith("t9", "learner-1");
  });

  it("lets a learner through when the file is used by the test's own feedback", async () => {
    storageMock.getMediaUsagesByAsset.mockResolvedValue([
      { assetId: "a1", entityType: "test_feedback", entityId: "t5", field: "feedbackJson.assets.0.url" },
    ]);
    storageMock.isTestAssignedToUser.mockResolvedValue(true);
    expect(await canDeliverAsset(asset(), "learner-1", [ROLES.LEARNER])).toBe(true);
    expect(storageMock.isTestAssignedToUser).toHaveBeenCalledWith("t5", "learner-1");
  });

  it("reaches the tests of a topic's feedback through the sections using that topic", async () => {
    storageMock.getMediaUsagesByAsset.mockResolvedValue([
      { assetId: "a1", entityType: "topic_feedback", entityId: "topic-1", field: "feedbackJson.assets.0.url" },
    ]);
    storageMock.getTestSectionsByTopic.mockResolvedValue([{ testId: "test-1" }]);
    storageMock.isTestAssignedToUser.mockResolvedValue(true);
    expect(await canDeliverAsset(asset(), "learner-1", [ROLES.LEARNER])).toBe(true);
    expect(storageMock.getTestSectionsByTopic).toHaveBeenCalledWith("topic-1");
    expect(storageMock.isTestAssignedToUser).toHaveBeenCalledWith("test-1", "learner-1");
  });

  it("keys scale and result-variable feedback by the test itself", async () => {
    storageMock.getMediaUsagesByAsset.mockResolvedValue([
      { assetId: "a1", entityType: "scale_feedback", entityId: "test-7", field: "0.interpretation.bands.1.feedback.assets.0.url" },
      { assetId: "a1", entityType: "variable_feedback", entityId: "test-8", field: "0.interpretation.outcomes.0.feedback.assets.0.url" },
    ]);
    // Only the second test is assigned: the first must still be asked about, otherwise
    // the "set of the test" keying would be silently resolving nothing.
    storageMock.isTestAssignedToUser.mockImplementation(async (testId: string) => testId === "test-8");
    expect(await canDeliverAsset(asset(), "learner-1", [ROLES.LEARNER])).toBe(true);
    expect(storageMock.isTestAssignedToUser).toHaveBeenCalledWith("test-7", "learner-1");
    expect(storageMock.isTestAssignedToUser).toHaveBeenCalledWith("test-8", "learner-1");
  });

  it("refuses a learner whose assignment does not cover the using test", async () => {
    storageMock.getMediaUsagesByAsset.mockResolvedValue([
      { assetId: "a1", entityType: "content_page", entityId: "page-1", field: "image" },
    ]);
    storageMock.getContentPage.mockResolvedValue({ id: "page-1", testId: "t1" });
    storageMock.isTestAssignedToUser.mockResolvedValue(false);
    expect(await canDeliverAsset(asset(), "learner-1", [ROLES.LEARNER])).toBe(false);
  });

  it("caches the decision for the same asset and user", async () => {
    storageMock.getMediaUsagesByAsset.mockResolvedValue([]);
    await canDeliverAsset(asset(), "learner-1", [ROLES.LEARNER]);
    await canDeliverAsset(asset(), "learner-1", [ROLES.LEARNER]);
    expect(storageMock.getMediaUsagesByAsset).toHaveBeenCalledTimes(1);
  });

  it("stops trusting a decision once it expires", async () => {
    vi.useFakeTimers();
    try {
      storageMock.getMediaUsagesByAsset.mockResolvedValue([]);
      await canDeliverAsset(asset(), "learner-1", [ROLES.LEARNER]);
      vi.advanceTimersByTime(61_000);
      await canDeliverAsset(asset(), "learner-1", [ROLES.LEARNER]);
      // A revoked assignment does not touch the usage index, so only expiry can
      // stop a stale decision from being served.
      expect(storageMock.getMediaUsagesByAsset).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("forgets decisions when the usage index is rewritten", async () => {
    storageMock.getMediaUsagesByAsset.mockResolvedValue([]);
    await canDeliverAsset(asset(), "learner-1", [ROLES.LEARNER]);
    clearAssetAccessCache();
    await canDeliverAsset(asset(), "learner-1", [ROLES.LEARNER]);
    expect(storageMock.getMediaUsagesByAsset).toHaveBeenCalledTimes(2);
  });
});
