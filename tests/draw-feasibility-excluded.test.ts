/**
 * @module tests/draw-feasibility-excluded
 * @description PRD-56 FR-17a, FR-17b: проверка выполнимости видит пул БЕЗ исключённых заданий.
 *
 * Исключение задания уменьшает пул темы. Если проверка выполнимости об этом не знает, она
 * разрешит публикацию теста, который выдать нельзя: «выдать 5 из 5», где пятое задание автор
 * снял. Ошибка вскроется не на публикации, а у участника — на старте попытки.
 *
 * Обратное правило тоже проверяется: исключение в ДРУГОМ тесте пул этого теста не трогает —
 * признак живёт в настройках вопроса внутри теста.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getTest: vi.fn(),
    getTestSections: vi.fn(),
    getQuestionsByTopic: vi.fn(),
    getTopic: vi.fn().mockResolvedValue({ id: "t1", name: "Право" }),
    getAdaptiveLevels: vi.fn().mockResolvedValue([]),
    getTestQuestionScoring: vi.fn().mockResolvedValue([]),
    getScales: vi.fn().mockResolvedValue([]),
    getResultVariables: vi.fn().mockResolvedValue([]),
    getQuestionMeasurements: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { assessTestPublish } from "../server/services/draw-feasibility";

const TEST = {
  id: "test1", title: "Сертификация", mode: "standard",
  status: "draft", ownerId: "u1",
};

function question(id: string) {
  return { id, topicId: "t1", type: "single", prompt: id, tags: [], difficulty: 50 };
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getTest.mockResolvedValue(TEST);
  storageMock.getTestSections.mockResolvedValue([
    { id: "s1", testId: "test1", topicId: "t1", drawCount: 3, drawAll: false, drawBlueprintJson: null },
  ]);
  storageMock.getQuestionsByTopic.mockResolvedValue([
    question("a"), question("b"), question("c"),
  ]);
  storageMock.getAdaptiveLevels.mockResolvedValue([]);
  storageMock.getTestQuestionScoring.mockResolvedValue([]);
  storageMock.getTopic.mockResolvedValue({ id: "t1", name: "Право" });
});

describe("assessTestPublish — исключённые задания", () => {
  it("разрешает публикацию, пока заданий хватает", async () => {
    const findings = await assessTestPublish("test1");

    expect(findings).toEqual([]);
  });

  it("не считает доступным задание, исключённое из выдачи", async () => {
    // Пул темы: три задания, одно исключено — выдать три больше нельзя.
    storageMock.getTestQuestionScoring.mockResolvedValue([
      { testId: "test1", questionId: "b", excludedFromDelivery: true },
    ]);

    const findings = await assessTestPublish("test1");

    expect(findings.length).toBeGreaterThan(0);
  });

  it("не трогает пул из-за исключения в другом тесте", async () => {
    storageMock.getTestQuestionScoring.mockResolvedValue([
      { testId: "test1", questionId: "b", points: 3, excludedFromDelivery: false },
    ]);

    const findings = await assessTestPublish("test1");

    expect(findings).toEqual([]);
  });
});
