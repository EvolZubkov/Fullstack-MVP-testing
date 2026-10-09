/**
 * @module tests/snapshot-excluded-questions
 * @description PRD-56 FR-17a, FR-17b: исключение задания и снимок публикации.
 *
 * Два правила, которые легко перепутать.
 *
 * НОВАЯ публикация исключённое задание не берёт: снимок фиксирует то, что тест выдаёт СЕЙЧАС,
 * а сейчас он его не выдаёт. Иначе автор снимает вопрос, публикует тест и получает его обратно.
 *
 * УЖЕ опубликованная версия не меняется — это свойство снимков (PRD-15) и обещание, которое
 * окно подтверждения даёт словами (FR-17b): пока тест не опубликован заново, и веб, и
 * выгруженный пакет продолжают выдавать вопрос по снимку.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getTest: vi.fn(),
    getTestSections: vi.fn(),
    // «Сценарий в ИС»: пунктов-сценариев у этих тестов нет.
    getTestScenarios: vi.fn(async () => []),
    getTopics: vi.fn(),
    getQuestionsByTopic: vi.fn(),
    getTopicCourses: vi.fn().mockResolvedValue([]),
    getTopicEvents: vi.fn().mockResolvedValue([]),
    getContentPages: vi.fn().mockResolvedValue([]),
    getScales: vi.fn().mockResolvedValue([]),
    getResultVariables: vi.fn().mockResolvedValue([]),
    getQuestionMeasurements: vi.fn().mockResolvedValue([]),
    getTestQuestionScoring: vi.fn().mockResolvedValue([]),
    listReportBlocks: vi.fn().mockResolvedValue([]),
    getAdaptiveTopicSettingsByTest: vi.fn().mockResolvedValue([]),
    getAdaptiveLevelsByTest: vi.fn().mockResolvedValue([]),
    getAdaptiveLevelLinks: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { buildSnapshotContent } from "../server/services/test-snapshot";

function question(id: string) {
  return { id, topicId: "t1", type: "single", prompt: id, tags: [], difficulty: 50 };
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getTest.mockResolvedValue({
    id: "test1", title: "Сертификация", mode: "standard", version: 1,
    overallPassRuleJson: { type: "percent", value: 70 },
  });
  storageMock.getTestSections.mockResolvedValue([
    { id: "s1", testId: "test1", topicId: "t1", drawCount: 2 },
  ]);
  storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "Право" }]);
  storageMock.getQuestionsByTopic.mockResolvedValue([question("a"), question("b"), question("c")]);
  storageMock.getTestQuestionScoring.mockResolvedValue([]);
  storageMock.listReportBlocks.mockResolvedValue([]);
});

/** Идентификаторы заданий темы, попавшие в снимок. */
async function snapshotQuestionIds(): Promise<string[]> {
  const content = await buildSnapshotContent("test1");
  return (content?.questionsByTopic?.t1 ?? []).map(q => q.id);
}

describe("снимок публикации и исключённые задания", () => {
  it("берёт все задания темы, пока ничего не исключено", async () => {
    expect(await snapshotQuestionIds()).toEqual(["a", "b", "c"]);
  });

  it("не берёт в новую публикацию задание, исключённое из выдачи", async () => {
    // Снимок фиксирует то, что тест выдаёт СЕЙЧАС: иначе автор снимает вопрос, публикует
    // тест и получает его обратно — причём молча.
    storageMock.getTestQuestionScoring.mockResolvedValue([
      { testId: "test1", questionId: "b", excludedFromDelivery: true },
    ]);

    expect(await snapshotQuestionIds()).toEqual(["a", "c"]);
  });

  it("оставляет задание, у которого признак снят", async () => {
    storageMock.getTestQuestionScoring.mockResolvedValue([
      { testId: "test1", questionId: "b", points: 3, excludedFromDelivery: false },
    ]);

    expect(await snapshotQuestionIds()).toEqual(["a", "b", "c"]);
  });
});
