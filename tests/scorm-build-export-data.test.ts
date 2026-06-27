/**
 * @module tests/scorm-build-export-data
 * @description Phase-1 unit tests for the shared SCORM ExportData assembler
 * (`server/scorm/build-export-data.ts`). The `debug` source runs through the REAL
 * live data source (`liveDataSource`), so this also exercises that source's
 * getters; the `export` (snapshot-aware) source path is covered end-to-end by
 * `scorm-export.test.ts`. Verifies the assembled shape, the adaptive branch, the
 * empty-design fallback, and the typed build errors (404/422).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted storage mock — `liveDataSource` reads the real wrappers over it ───
const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getTest: vi.fn(),
    getTestSections: vi.fn(),
    getTopics: vi.fn(),
    getTopic: vi.fn(),
    getQuestionsByTopic: vi.fn(),
    getQuestionsByIds: vi.fn(),
    getTopicCourses: vi.fn(),
    getTopicEvents: vi.fn(),
    getContentPages: vi.fn(),
    getResultVariables: vi.fn(),
    getScales: vi.fn(),
    getQuestionMeasurements: vi.fn(),
    getTestQuestionScoring: vi.fn(),
    getAdaptiveTopicSettingsByTest: vi.fn(),
    getAdaptiveLevelsByTest: vi.fn(),
    getAdaptiveLevelLinks: vi.fn(),
    getLatestSnapshot: vi.fn(),
  },
}));

vi.mock("../server/db", () => ({ db: {} }));
vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/services/template-dir", () => ({
  resolveTemplateDir: vi.fn(async () => "/fake/template/dir"),
}));
vi.mock("../server/template-registry", () => ({
  isSupportedTemplateApiVersion: vi.fn((v: string) => v === "1.0"),
}));

import { buildScormExportData, ScormBuildError } from "../server/scorm/build-export-data";
import { liveDataSource } from "../server/services/test-snapshot";
import { resolveTemplateDir } from "../server/services/template-dir";

const baseTest = (over: Record<string, unknown> = {}) =>
  ({
    id: "t1",
    title: "T",
    mode: "standard",
    designSettingsJson: { templateId: "default", params: {} },
    ...over,
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getTest.mockResolvedValue(baseTest());
  storageMock.getTestSections.mockResolvedValue([{ id: "s1", topicId: "tp1" }] as never);
  storageMock.getTopic.mockResolvedValue({ id: "tp1", name: "Topic" } as never);
  storageMock.getQuestionsByTopic.mockResolvedValue([] as never);
  storageMock.getTopicCourses.mockResolvedValue([] as never);
  storageMock.getTopicEvents.mockResolvedValue([] as never);
  storageMock.getContentPages.mockResolvedValue([] as never);
  storageMock.getResultVariables.mockResolvedValue([] as never);
  storageMock.getScales.mockResolvedValue([] as never);
  storageMock.getQuestionMeasurements.mockResolvedValue([] as never);
  storageMock.getTestQuestionScoring.mockResolvedValue([] as never);
  storageMock.getAdaptiveTopicSettingsByTest.mockResolvedValue([] as never);
  storageMock.getAdaptiveLevelsByTest.mockResolvedValue([{ id: "lvl1" }] as never);
  storageMock.getAdaptiveLevelLinks.mockResolvedValue([{ id: "lnk1" }] as never);
});

describe("buildScormExportData", () => {
  it("assembles ExportData from the live source for source=debug", async () => {
    const data = await buildScormExportData("t1", { source: "debug" });

    expect(data.test.id).toBe("t1");
    expect(data.sections).toHaveLength(1);
    expect(data.sections[0]).toMatchObject({ id: "s1", topic: { id: "tp1" } });
    expect(data.designSettings).toMatchObject({ templateId: "default" });
    expect(data.templateDir).toBe("/fake/template/dir");
    expect(data.adaptiveSettings).toBeNull();
    // Telemetry is request-specific and stays in the caller.
    expect("telemetry" in data).toBe(false);

    // The debug source reads live storage directly (PRD-18 D-4).
    expect(storageMock.getTest).toHaveBeenCalledWith("t1");
    expect(storageMock.getContentPages).toHaveBeenCalledWith("t1");
    expect(resolveTemplateDir).toHaveBeenCalledWith("default", { activeOnly: true });
  });

  it("captures adaptive settings with per-level links for an adaptive test", async () => {
    storageMock.getTest.mockResolvedValue(baseTest({ mode: "adaptive" }));

    const data = await buildScormExportData("t1", { source: "debug" });

    expect(data.adaptiveSettings).not.toBeNull();
    expect(data.adaptiveSettings!.levels[0]).toMatchObject({ id: "lvl1", links: [{ id: "lnk1" }] });
    expect(storageMock.getAdaptiveLevelLinks).toHaveBeenCalledWith("lvl1");
  });

  it("falls back to default designSettings when designSettingsJson is empty", async () => {
    storageMock.getTest.mockResolvedValue(baseTest({ designSettingsJson: null }));

    const data = await buildScormExportData("t1", { source: "debug" });

    expect(data.designSettings).toEqual({ templateId: "default", params: {} });
  });

  it("throws ScormBuildError 404 when the test is missing", async () => {
    storageMock.getTest.mockResolvedValue(undefined);

    await expect(buildScormExportData("nope", { source: "debug" })).rejects.toBeInstanceOf(ScormBuildError);
    await expect(buildScormExportData("nope", { source: "debug" })).rejects.toMatchObject({
      status: 404,
      message: "Test not found",
    });
  });

  it("throws ScormBuildError 422 for an unsupported templateApiVersion", async () => {
    storageMock.getTest.mockResolvedValue(
      baseTest({ designSettingsJson: { templateId: "corporate", templateApiVersion: "9.9", params: {} } }),
    );

    await expect(buildScormExportData("t1", { source: "debug" })).rejects.toMatchObject({
      status: 422,
      field: "templateApiVersion",
    });
  });

  it("reads from the active snapshot for source=export of a published test", async () => {
    storageMock.getTest.mockResolvedValue(baseTest({ status: "published" }));
    storageMock.getLatestSnapshot.mockResolvedValue({
      contentJson: {
        test: baseTest({ status: "published" }),
        sections: [{ id: "s1", topicId: "tp1" }],
        topics: [{ id: "tp1", name: "Topic" }],
        questionsByTopic: { tp1: [] },
        topicCoursesByTopic: { tp1: [] },
        topicEventsByTopic: { tp1: [] },
        adaptiveSettings: [],
        adaptiveLevels: [],
        adaptiveLevelLinksByLevel: {},
        scales: [],
        measurements: [],
        resultVariables: [],
        contentPages: [],
        questionScoring: [],
      },
    } as never);

    const data = await buildScormExportData("t1", { source: "export" });

    expect(data.sections[0].topic).toMatchObject({ id: "tp1" });
    expect(storageMock.getLatestSnapshot).toHaveBeenCalledWith("t1");
    // The frozen snapshot is the source — the bake does NOT re-read live sections.
    expect(storageMock.getTestSections).not.toHaveBeenCalled();
  });
});

describe("liveDataSource — live read facade backing the debug source", () => {
  it("delegates every getter to live storage", async () => {
    storageMock.getTopics.mockResolvedValue([{ id: "tp1" }] as never);
    storageMock.getQuestionsByIds.mockResolvedValue([] as never);

    const src = liveDataSource();
    await Promise.all([
      src.getTest("t1"),
      src.getTestSections("t1"),
      src.getTopics(),
      src.getTopic("tp1"),
      src.getQuestionsByTopic("tp1"),
      src.getQuestionsByIds(["q1"]),
      src.getTopicCourses("tp1"),
      src.getTopicEvents("tp1"),
      src.getAdaptiveTopicSettingsByTest("t1"),
      src.getAdaptiveLevelsByTest("t1"),
      src.getAdaptiveLevelLinks("lvl1"),
      src.getScales("t1"),
      src.getQuestionMeasurements("t1"),
      src.getResultVariables("t1"),
      src.getContentPages("t1"),
      src.getTestQuestionScoring("t1"),
    ]);

    expect(storageMock.getTopics).toHaveBeenCalled();
    expect(storageMock.getQuestionsByIds).toHaveBeenCalledWith(["q1"]);
    expect(storageMock.getTest).toHaveBeenCalledWith("t1");
  });
});
