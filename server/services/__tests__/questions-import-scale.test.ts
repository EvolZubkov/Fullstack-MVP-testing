/**
 * @module server/services/__tests__/questions-import-scale
 * @description PRD-26 scale rows on the «Вопросы» import/export path.
 *
 * The rule under test is the one the author actually operates: the correct-answer
 * column IS the switch. Empty means «measurement only» — no check, no points, only a
 * contribution to the PRD-5 scales; one number means a checked scale. Several numbers
 * are refused rather than silently truncated, because taking the first would bake the
 * author's mistake into the question bank.
 *
 * The round trip is pinned too: a measurement scale must survive export → import
 * unchanged, which only works while the export writes an EMPTY cell for it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://fake/test";
});

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getTopics: vi.fn(),
    getTopic: vi.fn(),
    createTopic: vi.fn(),
    getContentHashesByTopic: vi.fn(),
    getQuestionsByTopic: vi.fn(),
    getQuestion: vi.fn(),
    createQuestion: vi.fn(),
    updateQuestion: vi.fn(),
  },
}));

vi.mock("../../storage", () => ({ storage: storageMock }));

import { importQuestionRows } from "../questions-import";
import { serializeQuestionRow } from "../questions-export";
import type { Question } from "@shared/schema";

const topic = {
  id: "t1", name: "Выгорание", description: null, folderId: null,
  ownerId: null, visibility: "shared", createdAt: new Date(),
};

const HEADERS = new Set([
  "Тема", "Тип вопроса", "Текст вопроса", "Тексты вариантов ответа",
  "Номера правильных ответов", "Следование вариантов ответов",
]);

const GRADES = "Никогда#Очень редко#Редко#Часто#Очень часто#Постоянно";

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "Тема": "Выгорание",
    "Тип вопроса": "scale",
    "Текст вопроса": "После работы я чувствую себя как «выжатый лимон»",
    "Тексты вариантов ответа": GRADES,
    "Номера правильных ответов": "",
    ...overrides,
  };
}

/** The single question the import created. */
function created(): any {
  expect(storageMock.createQuestion).toHaveBeenCalledTimes(1);
  return storageMock.createQuestion.mock.calls[0][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getTopics.mockResolvedValue([topic]);
  storageMock.getContentHashesByTopic.mockResolvedValue(new Set());
  storageMock.getQuestionsByTopic.mockResolvedValue([]);
  storageMock.createQuestion.mockImplementation(async (q: any) => ({ id: "new1", ...q }));
});

describe("importQuestionRows — scale rows (PRD-26)", () => {
  it("imports a scale with its graduations in the authored order", async () => {
    const res = await importQuestionRows([row()], HEADERS, { dryRun: false });
    expect(res.errors).toEqual([]);
    expect(res.created).toBe(1);
    const q = created();
    expect(q.type).toBe("scale");
    expect(q.dataJson).toEqual({
      options: ["Никогда", "Очень редко", "Редко", "Часто", "Очень часто", "Постоянно"],
    });
  });

  it("an EMPTY correct-answer cell means measurement mode: {} and never null", async () => {
    // `questions.correct_json` is NOT NULL, so the measurement state has to be an
    // empty object — a null would fail the insert.
    await importQuestionRows([row()], HEADERS, { dryRun: false });
    expect(created().correctJson).toEqual({});
    expect(created().correctJson).not.toBeNull();
  });

  it("one number means a checked scale, converted to a 0-based index", async () => {
    await importQuestionRows([row({ "Номера правильных ответов": "4" })], HEADERS, { dryRun: false });
    expect(created().correctJson).toEqual({ correctIndex: 3 });
  });

  it("accepts the first graduation as the key (off-by-one guard)", async () => {
    await importQuestionRows([row({ "Номера правильных ответов": "1" })], HEADERS, { dryRun: false });
    expect(created().correctJson).toEqual({ correctIndex: 0 });
  });

  it("refuses several numbers instead of silently taking the first", async () => {
    const res = await importQuestionRows([row({ "Номера правильных ответов": "2,4" })], HEADERS, { dryRun: false });
    expect(res.created).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toContain("одна или её нет вовсе");
    expect(storageMock.createQuestion).not.toHaveBeenCalled();
  });

  it("refuses a graduation number out of range", async () => {
    const res = await importQuestionRows([row({ "Номера правильных ответов": "9" })], HEADERS, { dryRun: false });
    expect(res.created).toBe(0);
    expect(res.errors[0]).toContain("некорректный номер правильной градации");
  });

  it("needs at least two graduations, and says so in the scale's own words", async () => {
    const res = await importQuestionRows(
      [row({ "Тексты вариантов ответа": "Никогда" })],
      HEADERS,
      { dryRun: false },
    );
    expect(res.created).toBe(0);
    expect(res.errors[0]).toContain("2 градации шкалы");
  });

  it("warns — but does not fail — when the row asks for a shuffled order", async () => {
    const res = await importQuestionRows(
      [row({ "Следование вариантов ответов": "Random" })],
      HEADERS,
      { dryRun: false },
    );
    expect(res.errors).toEqual([]);
    expect(res.created).toBe(1);
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toContain("не перемешивается");
  });

  it("stays silent when the row fixes the order explicitly", async () => {
    const res = await importQuestionRows(
      [row({ "Следование вариантов ответов": "Fixed" })],
      HEADERS,
      { dryRun: false },
    );
    expect(res.warnings).toEqual([]);
  });

  it("does not warn about the order for other types", async () => {
    const res = await importQuestionRows(
      [
        {
          "Тема": "Выгорание",
          "Тип вопроса": "multiple_choice",
          "Текст вопроса": "Обычный вопрос",
          "Тексты вариантов ответа": "А#Б",
          "Номера правильных ответов": "1",
          "Следование вариантов ответов": "Random",
        },
      ],
      HEADERS,
      { dryRun: false },
    );
    expect(res.warnings).toEqual([]);
  });

  it("still requires a correct answer for single choice — the empty rule is scale-only", async () => {
    const res = await importQuestionRows(
      [
        {
          "Тема": "Выгорание",
          "Тип вопроса": "multiple_choice",
          "Текст вопроса": "Обычный вопрос",
          "Тексты вариантов ответа": "А#Б",
          "Номера правильных ответов": "",
        },
      ],
      HEADERS,
      { dryRun: false },
    );
    expect(res.created).toBe(0);
    expect(res.errors[0]).toContain("некорректный номер правильного ответа");
  });
});

// ─── export + round trip ─────────────────────────────────────────────────────

describe("serializeQuestionRow — scale rows (PRD-26)", () => {
  const question = (correctJson: unknown): Question =>
    ({
      id: "q1",
      topicId: "t1",
      type: "scale",
      prompt: "После работы я чувствую себя как «выжатый лимон»",
      dataJson: { options: ["Никогда", "Очень редко", "Редко", "Часто", "Очень часто", "Постоянно"] },
      correctJson,
      difficulty: 50,
      shuffleAnswers: false,
      mediaUrl: null,
      mediaType: null,
      feedback: null,
      feedbackMode: "general",
      feedbackCorrect: null,
      feedbackIncorrect: null,
      contentHash: "h1",
      tags: [],
      createdBy: null,
      createdAt: new Date(),
    }) as unknown as Question;

  it("writes the scale type and the graduations", () => {
    const r = serializeQuestionRow(question({}), "Выгорание");
    expect(r["Тип вопроса"]).toBe("scale");
    expect(r["Тексты вариантов ответа"]).toBe("Никогда#Очень редко#Редко#Часто#Очень часто#Постоянно");
  });

  it("writes an EMPTY correct-answer cell for a measurement scale", () => {
    // This is what makes the round trip work: a «1» here would turn every survey
    // item into a checked question on the next import.
    expect(serializeQuestionRow(question({}), "Выгорание")["Номера правильных ответов"]).toBe("");
  });

  it("writes the 1-based graduation number for a checked scale", () => {
    expect(
      serializeQuestionRow(question({ correctIndex: 3 }), "Выгорание")["Номера правильных ответов"],
    ).toBe("4");
    expect(
      serializeQuestionRow(question({ correctIndex: 0 }), "Выгорание")["Номера правильных ответов"],
    ).toBe("1");
  });

  it("round-trips a measurement scale through export → import unchanged", async () => {
    const exported = serializeQuestionRow(question({}), "Выгорание");
    const res = await importQuestionRows([exported], HEADERS, { dryRun: false });
    expect(res.errors).toEqual([]);
    const q = created();
    expect(q.type).toBe("scale");
    expect(q.correctJson).toEqual({});
    expect(q.dataJson).toEqual((question({}).dataJson as any));
  });

  it("round-trips a checked scale through export → import unchanged", async () => {
    const exported = serializeQuestionRow(question({ correctIndex: 2 }), "Выгорание");
    const res = await importQuestionRows([exported], HEADERS, { dryRun: false });
    expect(res.errors).toEqual([]);
    expect(created().correctJson).toEqual({ correctIndex: 2 });
  });
});
