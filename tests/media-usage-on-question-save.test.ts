/**
 * @module tests/media-usage-on-question-save
 * @description Saving a question keeps the usage index in step. Without this the delivery
 * rule refuses a learner the picture of the question they were just given.
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

describe("question save -> usage index", () => {
  it("indexes the question's own media and the media inside its data", async () => {
    await syncEntityUsages("question", "q1", {
      id: "q1",
      mediaUrl: "/api/media/11111111-1111-1111-1111-111111111111",
      dataJson: { options: [{ image: "/api/media/22222222-2222-2222-2222-222222222222" }] },
    });
    expect(storage.replaceMediaUsages).toHaveBeenCalledWith("question", "q1", [
      { assetId: "11111111-1111-1111-1111-111111111111", field: "mediaUrl" },
      { assetId: "22222222-2222-2222-2222-222222222222", field: "dataJson.options.0.image" },
    ]);
  });

  it("clears the rows when a question is deleted", async () => {
    await syncEntityUsages("question", "q1", null);
    expect(storage.replaceMediaUsages).toHaveBeenCalledWith("question", "q1", []);
  });
});
