/**
 * @module tests/media-usage-index
 * @description Turning found references into index rows: canonical ids go through as
 * they are, legacy addresses resolve via the storage key, and an unresolvable reference
 * is dropped rather than written as a dangling row.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getMediaAssetByStorageKey: vi.fn(),
    replaceMediaUsages: vi.fn(),
  },
}));
vi.mock("../server/storage", () => ({ storage: storageMock }));

import { syncEntityUsages } from "../server/services/media/usage-index";

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.replaceMediaUsages.mockResolvedValue(undefined);
});

describe("syncEntityUsages", () => {
  it("writes canonical references straight through", async () => {
    await syncEntityUsages("question", "q1", {
      mediaUrl: "/api/media/11111111-1111-1111-1111-111111111111",
    });
    expect(storageMock.replaceMediaUsages).toHaveBeenCalledWith("question", "q1", [
      { assetId: "11111111-1111-1111-1111-111111111111", field: "mediaUrl" },
    ]);
  });

  it("resolves a legacy address through the storage key", async () => {
    storageMock.getMediaAssetByStorageKey.mockResolvedValue({ id: "asset-9" });
    await syncEntityUsages("question", "q2", { mediaUrl: "/uploads/media/old.png" });
    expect(storageMock.getMediaAssetByStorageKey).toHaveBeenCalledWith("media/old.png");
    expect(storageMock.replaceMediaUsages).toHaveBeenCalledWith("question", "q2", [
      { assetId: "asset-9", field: "mediaUrl" },
    ]);
  });

  it("drops an unresolvable legacy address instead of writing a dangling row", async () => {
    storageMock.getMediaAssetByStorageKey.mockResolvedValue(undefined);
    await syncEntityUsages("question", "q3", { mediaUrl: "/uploads/media/gone.png" });
    expect(storageMock.replaceMediaUsages).toHaveBeenCalledWith("question", "q3", []);
  });

  it("clears the rows of an entity that lost its media", async () => {
    await syncEntityUsages("question", "q4", { prompt: "без медиа" });
    expect(storageMock.replaceMediaUsages).toHaveBeenCalledWith("question", "q4", []);
  });

  it("de-duplicates the same asset in the same field path", async () => {
    await syncEntityUsages("content_page", "p1", {
      a: "/api/media/22222222-2222-2222-2222-222222222222",
      b: "/api/media/22222222-2222-2222-2222-222222222222",
    });
    expect(storageMock.replaceMediaUsages).toHaveBeenCalledWith("content_page", "p1", [
      { assetId: "22222222-2222-2222-2222-222222222222", field: "a" },
      { assetId: "22222222-2222-2222-2222-222222222222", field: "b" },
    ]);
  });

  it("keeps every distinct asset found inside one HTML field", async () => {
    await syncEntityUsages("content_page", "p1", {
      html:
        '<p><img src="/api/media/11111111-1111-1111-1111-111111111111"></p>' +
        '<p><img src="/api/media/22222222-2222-2222-2222-222222222222"></p>',
    });
    expect(storageMock.replaceMediaUsages).toHaveBeenCalledWith("content_page", "p1", [
      { assetId: "11111111-1111-1111-1111-111111111111", field: "html" },
      { assetId: "22222222-2222-2222-2222-222222222222", field: "html" },
    ]);
  });
});
