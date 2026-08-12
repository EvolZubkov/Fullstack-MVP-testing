/**
 * @module tests/media-usage-on-content-save
 * @description Saving a content page or a test's design keeps the usage index in step,
 * mirroring `tests/media-usage-on-question-save.test.ts` for the two entity types Задача 10
 * left unindexed. Without this, the delivery rule (`server/services/media/asset-access.ts`)
 * refuses a learner the content-page picture or the design background/logo they were just
 * shown, once the public `/uploads` static mount is switched off (Задача 14).
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

describe("content page save -> usage index", () => {
  it("indexes the page's own media and a reference found inside its html field", async () => {
    await syncEntityUsages("content_page", "p1", {
      id: "p1",
      mode: "html",
      valuesJson: {
        values: {
          cover: "/api/media/11111111-1111-1111-1111-111111111111",
          // `html` mode: the reference sits INSIDE markup, not as the whole
          // field value — collectMediaRefs must still find it (media-refs.ts
          // findMediaRefsInText).
          body: '<p>Смотрите <img src="/api/media/22222222-2222-2222-2222-222222222222" alt=""></p>',
        },
      },
    });

    expect(storage.replaceMediaUsages).toHaveBeenCalledWith("content_page", "p1", [
      { assetId: "11111111-1111-1111-1111-111111111111", field: "valuesJson.values.cover" },
      { assetId: "22222222-2222-2222-2222-222222222222", field: "valuesJson.values.body" },
    ]);
  });

  it("clears the rows when a content page is deleted", async () => {
    await syncEntityUsages("content_page", "p1", null);
    expect(storage.replaceMediaUsages).toHaveBeenCalledWith("content_page", "p1", []);
  });
});

describe("test design save -> usage index", () => {
  it("indexes media referenced by the design's params (logo, background, ...)", async () => {
    const designSettings = {
      templateId: "default",
      templateVersion: "1.0.0",
      templateApiVersion: "1.1.0",
      params: {
        logo: "/api/media/33333333-3333-3333-3333-333333333333",
        backgroundImage: "/api/media/44444444-4444-4444-4444-444444444444",
      },
    };

    await syncEntityUsages("test_design", "t1", designSettings);

    expect(storage.replaceMediaUsages).toHaveBeenCalledWith("test_design", "t1", [
      { assetId: "33333333-3333-3333-3333-333333333333", field: "params.logo" },
      { assetId: "44444444-4444-4444-4444-444444444444", field: "params.backgroundImage" },
    ]);
  });

  it("clears the design usage rows when the test is deleted", async () => {
    await syncEntityUsages("test_design", "t1", null);
    expect(storage.replaceMediaUsages).toHaveBeenCalledWith("test_design", "t1", []);
  });
});
