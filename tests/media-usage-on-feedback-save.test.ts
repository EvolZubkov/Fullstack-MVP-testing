/**
 * @module tests/media-usage-on-feedback-save
 * @description Сохранение обратной связи держит индекс использования в согласии с контентом.
 * Без строки индекса правило выдачи откажет ученику в файле, который автор ему приложил.
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

const ID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => vi.clearAllMocks());

describe("feedback save -> usage index", () => {
  it("индексирует вложение обратной связи теста", async () => {
    await syncEntityUsages("test_feedback", "test-1", {
      format: "plain",
      text: "",
      links: [],
      events: [],
      assets: [{ title: "Памятка", fileName: "p.pdf", mimeType: "application/pdf", url: `/api/media/${ID}` }],
    });
    expect(storage.replaceMediaUsages).toHaveBeenCalledWith("test_feedback", "test-1", [
      { assetId: ID, field: "assets.0.url" },
    ]);
  });

  it("очищает строки, когда обратной связи не стало", async () => {
    await syncEntityUsages("test_feedback", "test-1", null);
    expect(storage.replaceMediaUsages).toHaveBeenCalledWith("test_feedback", "test-1", []);
  });

  it("индексирует вложение обратной связи темы", async () => {
    await syncEntityUsages("topic_feedback", "topic-1", {
      format: "plain",
      text: "",
      links: [],
      events: [],
      assets: [{ title: "Памятка", fileName: "p.pdf", mimeType: "application/pdf", url: `/api/media/${ID}` }],
    });
    expect(storage.replaceMediaUsages).toHaveBeenCalledWith("topic_feedback", "topic-1", [
      { assetId: ID, field: "assets.0.url" },
    ]);
  });
});
