/**
 * @module features/tests/editor/questions/__tests__/question-summary.test
 * @description Unit tests for {@link buildQuestionSummary}: the read-only summary of a
 * question INSIDE one test (meta line + deviation flags) shown in «Вопросы теста».
 */
import { describe, expect, it } from "vitest";
import { buildQuestionSummary, type SummaryQuestion } from "../question-summary";
import type { EditorSection, ScaleModel } from "../../test-editor.types";
import type { QuestionScoringOverride } from "../../scoring-api";

function section(patch: Partial<EditorSection> = {}): EditorSection {
  return {
    topicId: "t1",
    topicName: "О компании",
    maxQuestions: 10,
    drawCount: 4,
    drawAll: false,
    required: true,
    timeLimit: { source: "inherit_test" } as EditorSection["timeLimit"],
    feedback: { format: "plain", text: "" } as EditorSection["feedback"],
    feedbackLinks: [],
    feedbackAssets: [],
    feedbackEvents: [],
    defaultPoints: null,
    ...patch,
  };
}

function question(patch: Partial<SummaryQuestion> = {}): SummaryQuestion {
  return {
    id: "q1",
    tags: ["Стратегия"],
    difficulty: 50,
    contentHash: "h1",
    feedbackMode: "general",
    feedback: "",
    feedbackCorrect: "",
    feedbackIncorrect: "",
    ...patch,
  };
}

function override(patch: Partial<QuestionScoringOverride> = {}): QuestionScoringOverride {
  return {
    id: "o1",
    testId: "test",
    questionId: "q1",
    points: null,
    scoringJson: null,
    difficulty: null,
    pinnedContentHash: "h1",
    ...patch,
  };
}

const scale = (key: string, label: string) => ({ key, label }) as ScaleModel;

function build(patch: Partial<Parameters<typeof buildQuestionSummary>[0]> = {}) {
  return buildQuestionSummary({
    question: question(),
    section: section(),
    mode: "standard",
    testDefaultPoints: null,
    override: undefined,
    measurements: [],
    scales: [],
    excluded: false,
    openComments: 0,
    ...patch,
  });
}

const flagKeys = (s: ReturnType<typeof build>) => s.flags.map((f) => f.key);

describe("buildQuestionSummary: meta line", () => {
  it("lists sub-topic, difficulty, points, price and feedback in that order", () => {
    expect(build().meta).toEqual([
      "Стратегия",
      "сложность 50",
      "балл 1",
      "цена ответа «Точное»",
      "без обратной связи",
    ]);
  });

  it("names a question without tags and without difficulty", () => {
    const meta = build({ question: question({ tags: [], difficulty: null }) }).meta;
    expect(meta[0]).toBe("без подтемы");
    expect(meta[1]).toBe("сложность не задана");
  });

  it("joins several sub-topics", () => {
    expect(build({ question: question({ tags: ["А", "Б"] }) }).meta[0]).toBe("А, Б");
  });

  it("resolves points through section and test defaults", () => {
    expect(build({ testDefaultPoints: 3 }).meta).toContain("балл 3");
    expect(build({ testDefaultPoints: 3, section: section({ defaultPoints: 2 }) }).meta)
      .toContain("балл 2");
  });

  it("takes points, price and difficulty from the test override", () => {
    const meta = build({
      override: override({ points: 5, scoringJson: { kind: "tiered", tiers: [] } as never, difficulty: 80 }),
    }).meta;
    expect(meta).toContain("балл 5");
    expect(meta).toContain("цена ответа «Ступени»");
    expect(meta).toContain("сложность 80");
  });

  it("names contributing scales once each, in scale order", () => {
    const meta = build({
      scales: [scale("lead", "Лидерство"), scale("comm", "Коммуникация")],
      measurements: [
        { questionId: "q1", scaleKey: "comm", sourceType: "option", sourceKey: "0", value: 1, weight: 1 },
        { questionId: "q1", scaleKey: "lead", sourceType: "option", sourceKey: "0", value: 2, weight: 1 },
        { questionId: "q1", scaleKey: "lead", sourceType: "option", sourceKey: "1", value: 1, weight: 1 },
        { questionId: "q2", scaleKey: "comm", sourceType: "question", sourceKey: null, value: 1, weight: 1 },
      ],
    }).meta;
    expect(meta).toContain("шкалы «Лидерство», «Коммуникация»");
  });

  it("uses the singular for one scale and skips zero contributions", () => {
    const meta = build({
      scales: [scale("lead", "Лидерство"), scale("comm", "Коммуникация")],
      measurements: [
        { questionId: "q1", scaleKey: "lead", sourceType: "question", sourceKey: null, value: 2, weight: 1 },
        { questionId: "q1", scaleKey: "comm", sourceType: "question", sourceKey: null, value: 0, weight: 1 },
      ],
    }).meta;
    expect(meta).toContain("шкала «Лидерство»");
  });

  it("describes general and conditional feedback", () => {
    expect(build({ question: question({ feedback: "Текст" }) }).meta).toContain("обратная связь: общая");
    expect(
      build({ question: question({ feedbackMode: "conditional", feedbackIncorrect: "Нет" }) }).meta,
    ).toContain("обратная связь: верно / неверно");
    // Conditional mode without texts has nothing to show.
    expect(build({ question: question({ feedbackMode: "conditional", feedback: "X" }) }).meta)
      .toContain("без обратной связи");
  });

  it("names the variants a question belongs to", () => {
    const formSet = {
      forms: [
        { id: "a", label: "A", questionIds: ["q1", "q2"] },
        { id: "b", label: "B", questionIds: ["q1"] },
      ],
    };
    expect(build({ section: section({ formSet }) }).meta).toContain("варианты A, B");
    const one = { forms: [formSet.forms[0], { id: "b", label: "B", questionIds: ["q2"] }] };
    expect(build({ section: section({ formSet: one }) }).meta).toContain("вариант A");
  });
});

describe("buildQuestionSummary: flags", () => {
  it("has no flags for a plain question", () => {
    expect(build().flags).toEqual([]);
  });

  it("marks a test override", () => {
    expect(flagKeys(build({ override: override({ points: 2 }) }))).toEqual(["override"]);
  });

  it("does not mark a row that only carries the delivery exclusion", () => {
    // Analytics writes an override row with every scoring value empty.
    expect(flagKeys(build({ override: override({ pinnedContentHash: null }), excluded: true })))
      .toEqual(["excluded"]);
  });

  it("marks a stale override instead of a plain one", () => {
    const s = build({ override: override({ points: 2, pinnedContentHash: "old" }) });
    expect(flagKeys(s)).toEqual(["stale"]);
    expect(s.flags[0]).toMatchObject({ label: "Настройка устарела", tone: "warning" });
  });

  it("marks a question outside every variant", () => {
    const formSet = {
      forms: [
        { id: "a", label: "A", questionIds: ["q2"] },
        { id: "b", label: "B", questionIds: ["q3"] },
      ],
    };
    expect(flagKeys(build({ section: section({ formSet }) }))).toEqual(["no-variant"]);
  });

  it("marks a question outside quotas as neutral while a remainder is drawn", () => {
    const s = build({
      section: section({ drawCount: 4, drawBlueprint: { strata: [{ tag: "Другое", count: 2 }] } }),
    });
    expect(s.flags).toEqual([{ key: "outside-quota", label: "вне квот", tone: "neutral" }]);
  });

  it("warns that a question outside quotas is never drawn when quotas fill the draw", () => {
    const s = build({
      section: section({ drawCount: 4, drawBlueprint: { strata: [{ tag: "Другое", count: 4 }] } }),
    });
    expect(s.flags).toEqual([
      { key: "outside-quota", label: "вне квот, не выдаётся", tone: "warning" },
    ]);
  });

  it("matches quota tags case-insensitively", () => {
    const s = build({
      section: section({ drawBlueprint: { strata: [{ tag: "стратегия", count: 4 }] } }),
    });
    expect(s.flags).toEqual([]);
  });

  it("ignores quotas when the whole topic is drawn, in variants mode and in adaptive mode", () => {
    const drawBlueprint = { strata: [{ tag: "Другое", count: 4 }] };
    expect(build({ section: section({ drawBlueprint, drawAll: true }) }).flags).toEqual([]);
    expect(build({ section: section({ drawBlueprint }), mode: "adaptive" }).flags).toEqual([]);
    const formSet = {
      forms: [
        { id: "a", label: "A", questionIds: ["q1"] },
        { id: "b", label: "B", questionIds: ["q1"] },
      ],
    };
    expect(build({ section: section({ drawBlueprint, formSet }) }).flags).toEqual([]);
  });

  it("counts open review comments with the right plural", () => {
    expect(build({ openComments: 1 }).flags).toEqual([
      { key: "comments", label: "1 открытый комментарий", tone: "info" },
    ]);
    expect(build({ openComments: 3 }).flags[0].label).toBe("3 открытых комментария");
    expect(build({ openComments: 5 }).flags[0].label).toBe("5 открытых комментариев");
  });

  it("orders flags: scoring, delivery, exclusion, comments", () => {
    const formSet = {
      forms: [
        { id: "a", label: "A", questionIds: ["q2"] },
        { id: "b", label: "B", questionIds: ["q3"] },
      ],
    };
    const s = build({
      override: override({ points: 2 }),
      section: section({ formSet }),
      excluded: true,
      openComments: 2,
    });
    expect(flagKeys(s)).toEqual(["override", "no-variant", "excluded", "comments"]);
  });
});
