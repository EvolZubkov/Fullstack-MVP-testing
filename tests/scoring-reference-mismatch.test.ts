/**
 * @module tests/scoring-reference-mismatch
 * @description A «Веса опций» question whose largest weight is not on the option marked
 * correct: the shared rule (`shared/scoring/reference-mismatch`), the publication warnings
 * gathered from a test's overrides (`server/services/scoring-warnings`) and the sentence the
 * author reads (`describeScoringWarning`). The motivating case is question `e8dca236` of the
 * test «Лидирует изменения»: weights `[0,2,1,1]`, correct option 4.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { weightedReferenceMismatch, type ScoringWarning } from "@shared/scoring/reference-mismatch";
import { describeScoringWarning } from "@/features/content-protection/issue-text";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getTestQuestionScoring: vi.fn(),
    getTestSections: vi.fn(),
    getAdaptiveTopicSettingsByTest: vi.fn(),
    getQuestionsByIds: vi.fn(),
    getTopic: vi.fn(),
  },
}));
vi.mock("../server/storage", () => ({ storage: storageMock }));

import { assessScoringPublish } from "../server/services/scoring-warnings";

const weighted = (weights: number[]) => ({ kind: "weighted" as const, weights });

describe("weightedReferenceMismatch", () => {
  it("reports the top-weight option when the marked one is cheaper", () => {
    expect(weightedReferenceMismatch("single", { correctIndex: 3 }, weighted([0, 2, 1, 1])))
      .toEqual({ correctIndex: 3, topIndices: [1] });
  });

  it("lists every option sharing the top weight", () => {
    expect(weightedReferenceMismatch("scale", { correctIndex: 2 }, weighted([2, 2, 1])))
      .toEqual({ correctIndex: 2, topIndices: [0, 1] });
  });

  it("is silent when the marked option carries the top weight, even in a tie", () => {
    expect(weightedReferenceMismatch("single", { correctIndex: 0 }, weighted([2, 1, 1, 0]))).toBeNull();
    expect(weightedReferenceMismatch("single", { correctIndex: 1 }, weighted([2, 2, 1, 0]))).toBeNull();
  });

  it("is silent for exact scoring, other types, no marked option and all-zero weights", () => {
    expect(weightedReferenceMismatch("single", { correctIndex: 3 }, { kind: "exact" })).toBeNull();
    expect(weightedReferenceMismatch("single", { correctIndex: 3 }, null)).toBeNull();
    expect(weightedReferenceMismatch("multiple", { correctIndex: 3 }, weighted([0, 2, 1, 1]))).toBeNull();
    expect(weightedReferenceMismatch("scale", {}, weighted([0, 2, 1]))).toBeNull();
    expect(weightedReferenceMismatch("single", { correctIndex: 0 }, weighted([0, 0, 0]))).toBeNull();
  });
});

describe("assessScoringPublish", () => {
  const override = (questionId: string, scoringJson: unknown) => ({ questionId, scoringJson });
  const question = (id: string, topicId: string, correctIndex: number, prompt = "Текст вопроса") =>
    ({ id, topicId, type: "single", correctJson: { correctIndex }, prompt });

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1" }, { topicId: "t2" }]);
    storageMock.getAdaptiveTopicSettingsByTest.mockResolvedValue([]);
    storageMock.getTopic.mockImplementation(async (id: string) => ({ id, name: id === "t1" ? "Блок 1" : "Блок 2" }));
  });

  it("warns about a mismatching weighted question, in section order", async () => {
    storageMock.getTestQuestionScoring.mockResolvedValue([
      override("q2", weighted([1, 0, 0])),
      override("q1", weighted([0, 2, 1, 1])),
      override("ok", weighted([2, 1, 1, 0])),
    ]);
    storageMock.getQuestionsByIds.mockResolvedValue([
      question("q1", "t1", 3, "<p>Прежде чем&nbsp;реализовывать идею</p>"),
      question("q2", "t2", 2),
      question("ok", "t1", 0),
    ]);

    const warnings = await assessScoringPublish("test");
    expect(warnings.map((w) => w.questionId)).toEqual(["q1", "q2"]);
    expect(warnings[0]).toEqual({
      code: "weighted_reference_mismatch",
      topicId: "t1",
      topicName: "Блок 1",
      questionId: "q1",
      questionExcerpt: "Прежде чем реализовывать идею",
      correctIndex: 3,
      topIndices: [1],
    });
  });

  it("skips questions whose topic is no longer in the test, and non-weighted overrides", async () => {
    storageMock.getTestQuestionScoring.mockResolvedValue([
      override("gone", weighted([0, 2])),
      override("exact", { kind: "exact" }),
    ]);
    storageMock.getQuestionsByIds.mockResolvedValue([question("gone", "t9", 0)]);

    expect(await assessScoringPublish("test")).toEqual([]);
    expect(storageMock.getQuestionsByIds).toHaveBeenCalledWith(["gone"]);
  });

  it("reads nothing more when the test has no weighted overrides", async () => {
    storageMock.getTestQuestionScoring.mockResolvedValue([]);
    expect(await assessScoringPublish("test")).toEqual([]);
    expect(storageMock.getQuestionsByIds).not.toHaveBeenCalled();
  });

  it("shortens a long prompt to one line", async () => {
    storageMock.getTestQuestionScoring.mockResolvedValue([override("q1", weighted([0, 2]))]);
    storageMock.getQuestionsByIds.mockResolvedValue([question("q1", "t1", 0, "слово ".repeat(30))]);
    const [w] = await assessScoringPublish("test");
    expect(w.questionExcerpt.endsWith("…")).toBe(true);
    expect(w.questionExcerpt.length).toBeLessThanOrEqual(61);
  });
});

describe("describeScoringWarning", () => {
  const base: ScoringWarning = {
    code: "weighted_reference_mismatch",
    topicId: "t1",
    topicName: "Блок 1",
    questionId: "q1",
    questionExcerpt: "Прежде чем реализовывать идею",
    correctIndex: 3,
    topIndices: [1],
  };

  it("names the top option and the marked one, 1-based", () => {
    expect(describeScoringWarning(base)).toBe(
      "Тема «Блок 1»: в вопросе «Прежде чем реализовывать идею» наибольший балл стоит у варианта 2, " +
      "а верным отмечен вариант 4. Баллы считаются по весам; в разборе ответов и аналитике верным будет показан вариант 4.",
    );
  });

  it("lists several top options", () => {
    expect(describeScoringWarning({ ...base, topIndices: [0, 1] })).toContain("у вариантов 1 и 2,");
    expect(describeScoringWarning({ ...base, topIndices: [0, 1, 2] })).toContain("у вариантов 1, 2 и 3,");
  });
});
