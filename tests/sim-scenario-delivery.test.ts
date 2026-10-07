/**
 * @module tests/sim-scenario-delivery
 * @description How a «Сценарий» test reaches the delivery (`server/services/test-snapshot`): its
 * scenario item is ONE section of the bank topic that draws one question; the pool is the topic's
 * scenarios only (or the fixed one); ordinary sections still never deliver scenarios before the
 * hosts can play them inside a section; a snapshot taken before scenario items reads as none.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../server/storage", () => ({ storage: {} }));

const { scenarioSection, scenarioPool, snapshotDataSource, isScenarioSection } = await import("../server/services/test-snapshot");

const item = {
  id: "item-1", testId: "t", topicId: "bank", questionId: null, title: null,
  required: true, timeLimitMinutes: 10, imageUrl: null, sortOrder: 0,
};
const q = (id: string, type: string) => ({ id, type, topicId: "bank" });
const bankQuestions = [q("s1", "simulation"), q("x1", "single"), q("s2", "simulation"), q("x2", "long")];

describe("пункт-сценарий в выдаче", () => {
  it("становится разделом темы-банка с выдачей одного вопроса и помнит свой пункт", () => {
    const section = scenarioSection(item as never);
    // Ключ раздела — ключ пункта: пункт на той же теме, что обычный раздел, с ним не схлопнется.
    expect(section).toMatchObject({ topicId: "scenario:item-1", drawCount: 1, drawAll: false, formSetJson: null, required: true, timeLimitMinutes: 10 });
    expect(isScenarioSection(section)).toBe(true);
    expect(isScenarioSection({ ...section, scenarioItem: undefined } as never)).toBe(false);
  });

  it("пул — только сценарии темы; у фиксированной выдачи — только выбранный", () => {
    expect(scenarioPool(item as never, bankQuestions as never).map((x) => x.id)).toEqual(["s1", "s2"]);
    expect(scenarioPool({ ...item, questionId: "s2" } as never, bankQuestions as never).map((x) => x.id)).toEqual(["s2"]);
  });

  it("снимок теста «Сценарий» отдаёт пункт разделом, а пул — сценариями", async () => {
    const src = snapshotDataSource({
      test: { mode: "scenario" },
      sections: [{ topicId: "old-topic" }],
      scenarios: [item],
      questionsByTopic: { bank: bankQuestions },
    } as never);
    const sections = await src.getTestSections("t");
    expect(sections).toHaveLength(1);
    expect(sections[0].topicId).toBe("scenario:item-1");
    expect((await src.getScenarioPool(item as never)).map((x) => x.id)).toEqual(["s1", "s2"]);
    // Обычный путь чтения темы сценарии по-прежнему не выдаёт.
    expect((await src.getQuestionsByTopic("bank")).map((x) => x.id)).toEqual(["x1", "x2"]);
  });

  it("стандартный тест читает свои разделы; снимок без пунктов — пунктов нет", async () => {
    const src = snapshotDataSource({ test: { mode: "standard" }, sections: [{ topicId: "a" }], questionsByTopic: {} } as never);
    expect((await src.getTestSections("t")).map((s) => s.topicId)).toEqual(["a"]);
    expect(await src.getTestScenarios("t")).toEqual([]);
  });
});
