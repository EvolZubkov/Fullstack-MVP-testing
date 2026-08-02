/**
 * @module tests/media-usage-on-feedback-save
 * @description Сохранение обратной связи держит индекс использования в согласии с контентом.
 * Без строки индекса правило выдачи откажет ученику в файле, который автор ему приложил.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { syncEntityUsages, testFeedbackUsageEntity } from "../server/services/media/usage-index";

vi.mock("../server/storage", () => ({
  storage: {
    getMediaAssetByStorageKey: vi.fn().mockResolvedValue(undefined),
    replaceMediaUsages: vi.fn().mockResolvedValue(undefined),
  },
}));

import { storage } from "../server/storage";

const ID = "11111111-1111-1111-1111-111111111111";
const SECTION_ID = "22222222-2222-2222-2222-222222222222";

/** Feedback block carrying ONE PDF attachment at the canonical address. */
function feedbackWithAsset(assetId: string) {
  return {
    format: "plain",
    text: "",
    links: [],
    events: [],
    assets: [{ title: "Памятка", fileName: "p.pdf", mimeType: "application/pdf", url: `/api/media/${assetId}` }],
  };
}

beforeEach(() => vi.clearAllMocks());

describe("feedback save -> usage index", () => {
  it("индексирует вложение обратной связи теста", async () => {
    await syncEntityUsages("test_feedback", "test-1", testFeedbackUsageEntity(feedbackWithAsset(ID), []));
    expect(storage.replaceMediaUsages).toHaveBeenCalledWith("test_feedback", "test-1", [
      { assetId: ID, field: "test.assets.0.url" },
    ]);
  });

  it("индексирует вложение обратной связи РАЗДЕЛА, когда у самого теста вложения нет", async () => {
    await syncEntityUsages(
      "test_feedback",
      "test-1",
      testFeedbackUsageEntity(null, [{ feedbackJson: feedbackWithAsset(SECTION_ID) }]),
    );
    expect(storage.replaceMediaUsages).toHaveBeenCalledWith("test_feedback", "test-1", [
      { assetId: SECTION_ID, field: "sections.0.assets.0.url" },
    ]);
  });

  it("держит в одной строке вложения теста И его разделов — они не затирают друг друга", async () => {
    // Ключ пары (тип, идентификатор) один на тест: два раздельных вызова
    // syncEntityUsages переписали бы строки целиком, и выжил бы только последний.
    await syncEntityUsages(
      "test_feedback",
      "test-1",
      testFeedbackUsageEntity(feedbackWithAsset(ID), [
        { feedbackJson: null },
        { feedbackJson: feedbackWithAsset(SECTION_ID) },
      ]),
    );
    expect(storage.replaceMediaUsages).toHaveBeenCalledWith("test_feedback", "test-1", [
      { assetId: ID, field: "test.assets.0.url" },
      { assetId: SECTION_ID, field: "sections.1.assets.0.url" },
    ]);
  });

  it("очищает строки, когда обратной связи не стало", async () => {
    await syncEntityUsages("test_feedback", "test-1", testFeedbackUsageEntity(null, []));
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

  it("индексирует набор шкал теста целиком", async () => {
    await syncEntityUsages("scale_feedback", "test-1", [
      {
        key: "burnout",
        configJson: {
          interpretation: {
            bands: [
              {
                min: 0,
                max: 10,
                feedback: {
                  assets: [{ title: "Памятка", fileName: "p.pdf", mimeType: "application/pdf", url: `/api/media/${ID}` }],
                },
              },
            ],
          },
        },
      },
    ]);
    expect(storage.replaceMediaUsages).toHaveBeenCalledWith("scale_feedback", "test-1", [
      { assetId: ID, field: "0.configJson.interpretation.bands.0.feedback.assets.0.url" },
    ]);
  });
});
