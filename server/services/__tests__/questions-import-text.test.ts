/**
 * @module server/services/__tests__/questions-import-text
 * @description Canonical form on the Excel import path.
 *
 * The import is the noisiest source of author text in the service: cells come
 * from Word, from other systems and from hand editing, so the same question can
 * arrive with CRLF endings and stray spaces. It must be stored exactly as the
 * editor would store it, and — critically — the content hash must be computed
 * from that canonical form, because the hash is what deduplicates imported rows
 * and what pins a published snapshot.
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

import { importQuestionRows, computeQuestionHash } from "../questions-import";

const topic = {
  id: "t1", name: "JavaScript", description: null, folderId: null,
  ownerId: null, visibility: "shared", createdAt: new Date(),
};

const HEADERS = new Set([
  "Тема", "Тип вопроса", "Текст вопроса", "Тексты вариантов ответа",
  "Номера правильных ответов", "Обратная связь",
]);

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "Тема": "JavaScript",
    "Тип вопроса": "multiple_choice",
    "Текст вопроса": "Вопрос",
    "Тексты вариантов ответа": "А#Б",
    "Номера правильных ответов": "1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getTopics.mockResolvedValue([topic]);
  storageMock.getContentHashesByTopic.mockResolvedValue(new Set());
  storageMock.getQuestionsByTopic.mockResolvedValue([]);
  storageMock.createQuestion.mockImplementation(async (q: any) => ({ id: "new1", ...q }));
});

describe("importQuestionRows — canonical text", () => {
  it("stores an imported prompt in canonical form", async () => {
    await importQuestionRows(
      [row({ "Текст вопроса": " Первая строка \r\n\r\n\r\n Вторая строка " })],
      HEADERS,
      { dryRun: false },
    );

    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Первая строка\n\nВторая строка" }),
    );
  });

  it("stores a multi-line answer option in canonical form", async () => {
    await importQuestionRows(
      [row({ "Тексты вариантов ответа": "А\r\n  вторая строка#Б" })],
      HEADERS,
      { dryRun: false },
    );

    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ dataJson: { options: ["А\nвторая строка", "Б"] } }),
    );
  });

  it("stores imported feedback in canonical form", async () => {
    await importQuestionRows(
      [row({ "Обратная связь": " Пояснение \r\n\r\n\r\n продолжение " })],
      HEADERS,
      { dryRun: false },
    );

    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ feedback: "Пояснение\n\nпродолжение" }),
    );
  });

  it("converts markup in a prompt cell into the stored markdown subset", async () => {
    await importQuestionRows(
      [row({ "Текст вопроса": "<p>Что такое <b>замыкание</b>?</p>" })],
      HEADERS,
      { dryRun: false },
    );

    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Что такое **замыкание**?" }),
    );
  });

  it("converts markup in an option cell without eating the separator", async () => {
    await importQuestionRows(
      [row({ "Тексты вариантов ответа": "<b>Первый</b>#Второй<br>с переносом" })],
      HEADERS,
      { dryRun: false },
    );

    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        dataJson: { options: ["**Первый**", "Второй\nс переносом"] },
      }),
    );
  });

  it("leaves a comparison in a cell alone: it is text, not markup", async () => {
    await importQuestionRows([row({ "Текст вопроса": "Верно ли, что a < b и b > c?" })], HEADERS, {
      dryRun: false,
    });

    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Верно ли, что a < b и b > c?" }),
    );
  });

  it("hashes the canonical form, so a re-import of the same text is deduplicated", async () => {
    const canonicalHash = computeQuestionHash("single", "Вопрос", { options: ["А", "Б"] });

    await importQuestionRows(
      [row({ "Текст вопроса": " Вопрос \r\n", "Тексты вариантов ответа": " А # Б " })],
      HEADERS,
      { dryRun: false },
    );

    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ contentHash: canonicalHash }),
    );
  });
});
