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
    // PRD-51: документ отчёта читается через тот же источник, что и прочий состав.
    listReportBlocks: vi.fn(),
    getAdaptiveTopicSettingsByTest: vi.fn(),
    getAdaptiveLevelsByTest: vi.fn(),
    getAdaptiveLevelLinks: vi.fn(),
    getLatestSnapshot: vi.fn(),
    // «Сценарий в ИС»: источник выдачи читает пункты-сценарии теста.
    getTestScenarios: vi.fn(),
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
  storageMock.listReportBlocks.mockResolvedValue([] as never);
  storageMock.getAdaptiveTopicSettingsByTest.mockResolvedValue([] as never);
  storageMock.getAdaptiveLevelsByTest.mockResolvedValue([{ id: "lvl1" }] as never);
  storageMock.getAdaptiveLevelLinks.mockResolvedValue([{ id: "lnk1" }] as never);
  storageMock.getTestScenarios.mockResolvedValue([] as never);
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
      version: 3,
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

/**
 * PRD-56 FR-19a, звено 1: номер версии публикации уезжает в пакет.
 *
 * Без него разрез по версиям слеп ровно к тем прохождениям, ради которых пакет и собирали:
 * `attempts.snapshot_id` есть только у веб-попытки.
 */
describe("buildScormExportData — версия публикации (PRD-56 FR-19a)", () => {
  const publishedSnapshot = (version: number) => ({
    version,
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
  }) as never;

  it("опубликованный тест отдаёт номер активного снимка", async () => {
    storageMock.getTest.mockResolvedValue(baseTest({ status: "published" }));
    storageMock.getLatestSnapshot.mockResolvedValue(publishedSnapshot(3));

    const data = await buildScormExportData("t1", { source: "export" });

    expect(data.publicationVersion).toBe(3);
  });

  it("у черновика ключа нет вовсе — пакет остаётся прежним", async () => {
    // Не `undefined` значением, а ОТСУТСТВИЕ ключа: черновик собирается живым источником,
    // версии публикации у него не существует, и выдумывать её нечем.
    const data = await buildScormExportData("t1", { source: "export" });

    expect("publicationVersion" in data).toBe(false);
  });

  it("отладочная сборка версии не несёт даже у опубликованного теста", async () => {
    // PRD-18 D-4: отладочный прогон ВСЕГДА идёт по живому состоянию, а не по снимку.
    storageMock.getTest.mockResolvedValue(baseTest({ status: "published" }));
    storageMock.getLatestSnapshot.mockResolvedValue(publishedSnapshot(3));

    const data = await buildScormExportData("t1", { source: "debug" });

    expect("publicationVersion" in data).toBe(false);
    expect(storageMock.getLatestSnapshot).not.toHaveBeenCalled();
  });
});

describe("buildScormExportData — ипсативность (PRD-46 §5)", () => {
  const SCALE_KEYS = ["cel", "vdo", "kom", "pro"];

  /** Четыре варианта блока кормят четыре шкалы один к одному — устройство ЧИЛ. */
  const block = (questionId: string) =>
    SCALE_KEYS.map((_k, index) => ({
      questionId,
      scaleId: `sc-${index}`,
      sourceType: "option_allocation",
      sourceKey: String(index),
      valueJson: 1,
      weight: 1,
    }));

  const chil = (over: { hiddenIndex?: number } = {}) => {
    storageMock.getScales.mockResolvedValue(
      SCALE_KEYS.map((key, i) => ({
        id: `sc-${i}`,
        key,
        learnerVisibility: i === over.hiddenIndex ? "hidden" : "level_and_value",
      })) as never,
    );
    storageMock.getQuestionMeasurements.mockResolvedValue([...block("q1"), ...block("q2")] as never);
    storageMock.getQuestionsByTopic.mockResolvedValue([
      { id: "q1", type: "allocation", dataJson: { options: ["a", "b", "c", "d"], budget: 7 } },
      { id: "q2", type: "allocation", dataJson: { options: ["a", "b", "c", "d"], budget: 7 } },
    ] as never);
  };

  it("признаёт модель ЧИЛ и кладёт признак в данные выгрузки", async () => {
    chil();
    expect((await buildScormExportData("t1", { source: "debug" })).ipsativeScales).toBe(true);
  });

  it("скрытая шкала выводит модель из ипсативных", async () => {
    // Доля, отданная её варианту, из профиля уходит, и сумма показанных шкал перестаёт
    // быть постоянной — роза заявила бы целое, которого нет.
    chil({ hiddenIndex: 3 });
    expect((await buildScormExportData("t1", { source: "debug" })).ipsativeScales).toBe(false);
  });

  it("у теста без шкал признак ложен и лишних чтений не делает", async () => {
    expect((await buildScormExportData("t1", { source: "debug" })).ipsativeScales).toBe(false);
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

/**
 * PRD-56 FR-17a: снятое задание не уезжает и в пакет ЧЕРНОВИКА.
 *
 * У опубликованного теста правило выполняет снимок (`buildSnapshotContent` фильтрует состав
 * при публикации), поэтому пакет по снимку состав не меняет — это обратная сторона того же
 * правила (PRD-15). А черновик и отладочный прогон собираются ЖИВЫМИ, и без собственного
 * фильтра автор, снявший задание, продолжал видеть его в своём же прогоне.
 */
describe("buildScormExportData — исключённые задания (PRD-56 FR-17a)", () => {
  beforeEach(() => {
    storageMock.getQuestionsByTopic.mockResolvedValue([
      { id: "q1", type: "single", topicId: "tp1" },
      { id: "q2", type: "single", topicId: "tp1" },
    ] as never);
  });

  it("живая сборка снятое задание не берёт", async () => {
    storageMock.getTestQuestionScoring.mockResolvedValue([
      { testId: "t1", questionId: "q2", excludedFromDelivery: true },
    ] as never);

    const data = await buildScormExportData("t1", { source: "debug" });

    expect(data.sections[0].questions.map((q) => q.id)).toEqual(["q1"]);
  });

  it("без признака состав прежний", async () => {
    storageMock.getTestQuestionScoring.mockResolvedValue([
      { testId: "t1", questionId: "q2", points: 3, excludedFromDelivery: false },
    ] as never);

    const data = await buildScormExportData("t1", { source: "debug" });

    expect(data.sections[0].questions.map((q) => q.id)).toEqual(["q1", "q2"]);
  });

  it("сборка ПО СНИМКУ состав не меняет", async () => {
    // Снимок уже отфильтрован публикацией; применять к нему сегодняшние настройки значит
    // переписывать опубликованную версию задним числом.
    storageMock.getTest.mockResolvedValue(baseTest({ status: "published" }));
    storageMock.getLatestSnapshot.mockResolvedValue({
      version: 1,
      contentJson: {
        test: baseTest({ status: "published" }),
        sections: [{ id: "s1", topicId: "tp1" }],
        topics: [{ id: "tp1", name: "Topic" }],
        questionsByTopic: { tp1: [{ id: "q1", type: "single", topicId: "tp1" }, { id: "q2", type: "single", topicId: "tp1" }] },
        topicCoursesByTopic: { tp1: [] },
        topicEventsByTopic: { tp1: [] },
        adaptiveSettings: [], adaptiveLevels: [], adaptiveLevelLinksByLevel: {},
        scales: [], measurements: [], resultVariables: [], contentPages: [],
        // Снимок несёт СВОИ строки настроек: сегодняшнее исключение в них не попадает.
        questionScoring: [],
      },
    } as never);

    const data = await buildScormExportData("t1", { source: "export" });

    expect(data.sections[0].questions.map((q) => q.id)).toEqual(["q1", "q2"]);
  });
});

describe("«Сценарий в ИС»: раздел пункта-сценария в пакете (Э4)", () => {
  const item = { id: "it1", testId: "t1", topicId: "bank", questionId: null, title: "Работа в СЭД", required: true, timeLimitMinutes: null, imageUrl: null, groupKey: null, sortOrder: 0 };
  const bankQuestions = [
    { id: "s1", type: "simulation", topicId: "bank" },
    { id: "x1", type: "single", topicId: "bank" },
    { id: "s2", type: "simulation", topicId: "bank" },
  ];

  beforeEach(() => {
    storageMock.getTest.mockResolvedValue(baseTest({ mode: "scenario" }));
    storageMock.getTestScenarios.mockResolvedValue([item] as never);
    storageMock.getTopic.mockImplementation(async (id: string) => (id === "bank" ? { id: "bank", name: "Банк", feedbackJson: { text: "x" } } : undefined) as never);
    storageMock.getQuestionsByTopic.mockResolvedValue(bankQuestions as never);
  });

  it("тест «Сценарий» собирается: раздел под ключом пункта и его именем, пул — только сценарии", async () => {
    const data = await buildScormExportData("t1", { source: "debug" });
    expect(data.sections).toHaveLength(1);
    const [section] = data.sections;
    expect(section.topicId).toBe("scenario:it1");
    expect(section.topic).toMatchObject({ id: "scenario:it1", name: "Работа в СЭД", feedbackJson: null });
    expect(section.questions.map((q) => q.id)).toEqual(["s1", "s2"]);
  });

  it("фиксированный пункт несёт только свой сценарий", async () => {
    storageMock.getTestScenarios.mockResolvedValue([{ ...item, questionId: "s2" }] as never);
    const data = await buildScormExportData("t1", { source: "debug" });
    expect(data.sections[0].questions.map((q) => q.id)).toEqual(["s2"]);
  });

  it("пункт без сценариев — явный отказ, а не пакет без задания", async () => {
    storageMock.getQuestionsByTopic.mockResolvedValue([bankQuestions[1]] as never);
    await expect(buildScormExportData("t1", { source: "debug" })).rejects.toMatchObject({ status: 422 });
  });

  it("роутер несёт пункт рядом с темой", async () => {
    storageMock.getTest.mockResolvedValue(baseTest({ flowPolicyJson: { mode: "router_by_topics" } }));
    storageMock.getTopic.mockImplementation(async (id: string) => ({ id, name: id === "bank" ? "Банк" : "Topic" }) as never);
    const data = await buildScormExportData("t1", { source: "debug" });
    expect(data.sections.map((s) => s.topicId)).toEqual(["tp1", "scenario:it1"]);
  });
});
