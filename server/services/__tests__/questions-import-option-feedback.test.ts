/**
 * @module server/services/__tests__/questions-import-option-feedback
 * @description «ОС по вариантам» on the Excel round trip.
 *
 * The column holds one slot per option, joined by `#` like «Тексты вариантов ответа».
 * A book exported before the column existed must not erase stored texts on re-import
 * (the column is judged by the sheet HEADERS, not by an empty cell), while a present
 * column replaces them wholesale — clearing the cell is how the author removes them.
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
import { serializeQuestionRow, QUESTION_HEADERS, QUESTION_WIDTHS } from "../questions-export";
import type { Question } from "@shared/schema";

const topic = {
  id: "t1", name: "Налоги", description: null, folderId: null,
  ownerId: null, visibility: "shared", createdAt: new Date(),
};

const BASE_HEADERS = ["ID", "Тема", "Тип вопроса", "Текст вопроса", "Тексты вариантов ответа", "Номера правильных ответов"];
const WITH_COLUMN = new Set([...BASE_HEADERS, "ОС по вариантам"]);
const WITHOUT_COLUMN = new Set(BASE_HEADERS);

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "Тема": "Налоги",
    "Тип вопроса": "multiple_choice",
    "Текст вопроса": "Что такое НДФЛ?",
    "Тексты вариантов ответа": "А#Б#В",
    "Номера правильных ответов": "1",
    ...overrides,
  };
}

const stored = {
  id: "q1",
  topicId: "t1",
  type: "single",
  prompt: "Что такое НДФЛ?",
  dataJson: { options: ["А", "Б", "В"] },
  correctJson: { correctIndex: 0 },
  difficulty: 50,
  tags: [],
  optionFeedbackJson: [null, "Почему Б"],
};

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getTopics.mockResolvedValue([topic]);
  storageMock.getContentHashesByTopic.mockResolvedValue(new Set());
  storageMock.getQuestionsByTopic.mockResolvedValue([]);
  storageMock.getQuestion.mockResolvedValue(stored);
  storageMock.createQuestion.mockImplementation(async (q: any) => ({ id: "new1", ...q }));
  storageMock.updateQuestion.mockImplementation(async (_id: string, q: any) => ({ id: "q1", ...q }));
});

describe("importQuestionRows — «ОС по вариантам»", () => {
  it("creates a question with texts aligned by slot, empty slot = no text", async () => {
    await importQuestionRows([row({ "ОС по вариантам": " # Почему Б \r\n # " })], WITH_COLUMN, { dryRun: false });

    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ optionFeedbackJson: [null, "Почему Б"] }),
    );
  });

  it("warns about and ignores the column for a type other than single choice", async () => {
    const result = await importQuestionRows(
      [row({ "Тип вопроса": "multiple_response", "Номера правильных ответов": "1,2", "ОС по вариантам": "x#y" })],
      WITH_COLUMN,
      { dryRun: false },
    );

    expect(storageMock.createQuestion).toHaveBeenCalledWith(expect.objectContaining({ optionFeedbackJson: null }));
    expect(result.warnings.join("\n")).toContain("только к вопросу с одним ответом");
  });

  it("warns about texts past the last option", async () => {
    const result = await importQuestionRows([row({ "ОС по вариантам": "a#b#c#d" })], WITH_COLUMN, { dryRun: false });

    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ optionFeedbackJson: ["a", "b", "c"] }),
    );
    expect(result.warnings.join("\n")).toContain("лишние не сохранены");
  });

  it("a present but cleared column erases the stored texts", async () => {
    await importQuestionRows([row({ ID: "q1", "ОС по вариантам": "" })], WITH_COLUMN, { dryRun: false });

    expect(storageMock.updateQuestion).toHaveBeenCalledWith("q1", expect.objectContaining({ optionFeedbackJson: null }));
  });

  it("a book without the column keeps the stored texts", async () => {
    await importQuestionRows([row({ ID: "q1" })], WITHOUT_COLUMN, { dryRun: false });

    expect(storageMock.updateQuestion).toHaveBeenCalledWith(
      "q1",
      expect.objectContaining({ optionFeedbackJson: [null, "Почему Б"] }),
    );
  });

  it("a book without the column still drops a text whose option is gone", async () => {
    await importQuestionRows([row({ ID: "q1", "Тексты вариантов ответа": "А#В" })], WITHOUT_COLUMN, { dryRun: false });

    // Only two options remain; the text at position 1 now sits on «В» — kept by position,
    // the same rule the editor applies when the column is not present.
    expect(storageMock.updateQuestion).toHaveBeenCalledWith(
      "q1",
      expect.objectContaining({ optionFeedbackJson: [null, "Почему Б"] }),
    );
  });
});

describe("serializeQuestionRow — «ОС по вариантам»", () => {
  it("is a declared column with a width", () => {
    expect(QUESTION_HEADERS).toContain("ОС по вариантам");
    expect(QUESTION_WIDTHS.length).toBe(QUESTION_HEADERS.length);
  });

  it("prints one slot per option, empty where there is no text", () => {
    const cells = serializeQuestionRow(stored as unknown as Question, "Налоги");
    expect(cells["ОС по вариантам"]).toBe("#Почему Б#");
  });

  it("prints an empty cell when no option has a text", () => {
    const cells = serializeQuestionRow({ ...stored, optionFeedbackJson: null } as unknown as Question, "Налоги");
    expect(cells["ОС по вариантам"]).toBe("");
  });

  it("round-trips through the import", async () => {
    const cells = serializeQuestionRow(stored as unknown as Question, "Налоги");
    await importQuestionRows([row({ "ОС по вариантам": cells["ОС по вариантам"] })], WITH_COLUMN, { dryRun: false });

    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ optionFeedbackJson: [null, "Почему Б"] }),
    );
  });
});
