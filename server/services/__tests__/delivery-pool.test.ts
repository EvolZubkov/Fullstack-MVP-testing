/**
 * @module server/services/__tests__/delivery-pool
 * @description Пул выдачи теста — одно определение для профиля экспозиции, «Качества вопросов»
 * и проверки публикации (решение владельца 2026-09-26).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../storage", () => ({ storage: {} }));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { loadDeliveryPool, sectionPoolOf, type DeliveryPoolSource } from "../delivery-pool";
import type { Question } from "@shared/schema";

const q = (id: string, topicId = "t1", difficulty: number | null = 50) =>
  ({ id, topicId, difficulty, tags: [], type: "single", prompt: id }) as unknown as Question;

function source(over: Partial<Record<keyof DeliveryPoolSource, unknown>> = {}): DeliveryPoolSource {
  return {
    getTest: vi.fn().mockResolvedValue({ id: "test1", mode: "standard" }),
    getTestSections: vi.fn().mockResolvedValue([{ id: "s1", testId: "test1", topicId: "t1", formSetJson: null }]),
    getQuestionsByTopic: vi.fn().mockResolvedValue([q("a"), q("b"), q("c")]),
    getTestQuestionScoring: vi.fn().mockResolvedValue([]),
    getAdaptiveLevelsByTest: vi.fn().mockResolvedValue([]),
    ...over,
  } as DeliveryPoolSource;
}

describe("sectionPoolOf", () => {
  it("без вариантов и адаптива пул — весь доступный банк", () => {
    const pool = sectionPoolOf({ section: { topicId: "t1", formSetJson: null }, available: [q("a"), q("b")], mode: "standard" });
    expect(pool.map(x => x.id)).toEqual(["a", "b"]);
  });

  it("раздел с вариантами выдаёт только вопросы вариантов из доступного банка", () => {
    const pool = sectionPoolOf({
      section: {
        topicId: "t1",
        formSetJson: { forms: [
          { id: "f1", label: "1", questionIds: ["a", "x"] },
          { id: "f2", label: "2", questionIds: ["c"] },
        ] } as never,
      },
      available: [q("a"), q("b"), q("c")],
      mode: "standard",
    });
    // «x» в банке нет (удалён или исключён) — выдать его нельзя.
    expect(pool.map(x => x.id)).toEqual(["a", "c"]);
  });

  it("адаптив выдаёт вопросы, попавшие в полосу уровня своей темы", () => {
    const pool = sectionPoolOf({
      section: { topicId: "t1", formSetJson: null },
      available: [q("a", "t1", 20), q("b", "t1", 80), q("c", "t1", null)],
      mode: "adaptive",
      levels: [
        { topicId: "t1", minDifficulty: 10, maxDifficulty: 30 },
        { topicId: "t2", minDifficulty: 70, maxDifficulty: 90 },
      ],
    });
    expect(pool.map(x => x.id)).toEqual(["a"]);
  });
});

describe("loadDeliveryPool", () => {
  it("снимает исключённые из выдачи ЭТОГО теста", async () => {
    const pool = await loadDeliveryPool("test1", {
      src: source({
        getTestQuestionScoring: vi.fn().mockResolvedValue([
          { questionId: "b", excludedFromDelivery: true },
          { questionId: "c", excludedFromDelivery: false },
        ]),
      }),
    });
    expect(pool.questionIds).toEqual(["a", "c"]);
    expect([...pool.excluded]).toEqual(["b"]);
    expect(pool.sections[0].bank.map(x => x.id)).toEqual(["a", "b", "c"]);
  });

  it("учитывает будущие исключения (FR-17b)", async () => {
    const pool = await loadDeliveryPool("test1", { src: source(), alsoExcluded: ["a"] });
    expect(pool.questionIds).toEqual(["b", "c"]);
  });

  it("адаптив берёт ДЕЙСТВУЮЩУЮ трудность теста (FR-34)", async () => {
    const src = source({
      getTest: vi.fn().mockResolvedValue({ id: "test1", mode: "adaptive" }),
      getQuestionsByTopic: vi.fn().mockResolvedValue([q("a", "t1", 20), q("b", "t1", 80)]),
      getTestQuestionScoring: vi.fn().mockResolvedValue([{ questionId: "b", difficulty: 25, excludedFromDelivery: false }]),
      getAdaptiveLevelsByTest: vi.fn().mockResolvedValue([{ topicId: "t1", minDifficulty: 10, maxDifficulty: 30 }]),
    });
    const pool = await loadDeliveryPool("test1", { src });
    expect(pool.questionIds).toEqual(["a", "b"]);
  });

  it("уровни у неадаптивного теста не читаются", async () => {
    const src = source();
    await loadDeliveryPool("test1", { src });
    expect(src.getAdaptiveLevelsByTest).not.toHaveBeenCalled();
  });

  it("два раздела на одной теме не дублируют вопросы пула", async () => {
    const pool = await loadDeliveryPool("test1", {
      src: source({
        getTestSections: vi.fn().mockResolvedValue([
          { id: "s1", topicId: "t1", formSetJson: null },
          { id: "s2", topicId: "t1", formSetJson: null },
        ]),
      }),
    });
    expect(pool.questionIds).toEqual(["a", "b", "c"]);
  });
});
