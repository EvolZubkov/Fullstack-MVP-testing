/**
 * @module server/services/__tests__/questions-import-simulation
 * @description «Сценарий в ИС» on the «Вопросы» workbook path.
 *
 * A scenario does not fit in a cell — its content is a graph of scenes with images — so the book
 * does not carry it: a row of that type is skipped with a warning that names the archive as the
 * way to move it, never imported half-empty and never reported as an «unknown type».
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

const topic = { id: "t1", name: "Работа в СЭД", description: null, folderId: null, ownerId: null, visibility: "shared", createdAt: new Date() };
const HEADERS = new Set(["Тема", "Тип вопроса", "Текст вопроса", "Тексты вариантов ответа", "Номера правильных ответов"]);

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getTopics.mockResolvedValue([topic]);
  storageMock.getContentHashesByTopic.mockResolvedValue(new Set());
  storageMock.getQuestionsByTopic.mockResolvedValue([]);
});

describe("importQuestionRows — строки сценария", () => {
  it.each(["simulation", "Сценарий"])("тип «%s» пропускается с предупреждением про архив", async (type) => {
    const res = await importQuestionRows(
      [{ "Тема": "Работа в СЭД", "Тип вопроса": type, "Текст вопроса": "Зарегистрируйте письмо" }],
      HEADERS,
      { dryRun: false },
    );
    expect(res.created).toBe(0);
    expect(res.errors).toEqual([]);
    expect(res.warnings).toEqual(["Строка 2: вопрос «Сценарий» переносится архивом .scenario.zip, а не книгой — строка пропущена"]);
    expect(storageMock.createQuestion).not.toHaveBeenCalled();
    expect(storageMock.updateQuestion).not.toHaveBeenCalled();
  });
});
