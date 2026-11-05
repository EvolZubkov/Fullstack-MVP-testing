/**
 * @module server/services/__tests__/questions-workbook-roundtrip
 * @description The «Вопросы» sheet round trip through a REAL .xlsx buffer.
 *
 * Export → ExcelJS buffer → read back → import must give back the question exactly as
 * the editor stored it. Three things used to break on the way: a markdown text with a
 * tag in it was read as foreign HTML and converted (listings lost their tags), a `#`
 * inside an option cut it in two, and the stored SVG of a formula was dropped.
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
import { normalizePromptByFormat } from "../question-text";
import { addJsonSheet, ExcelJS, readWorkbookFromBuffer, sheetHeaders, sheetToObjects, workbookToBuffer } from "../../utils/excel";
import type { Question } from "@shared/schema";

const topic = {
  id: "t1", name: "Вёрстка", description: null, folderId: null,
  ownerId: null, visibility: "shared", createdAt: new Date(),
};

/** A question as the editor stores it: the prompt goes through the same write path. */
function question(overrides: Partial<Record<string, unknown>> & { prompt: string }): Question {
  const promptFormat = (overrides.promptFormat as "markdown" | "richText" | "html" | undefined) ?? "markdown";
  return {
    id: "q1",
    topicId: "t1",
    type: "single",
    dataJson: { options: ["Да", "Нет"] },
    correctJson: { correctIndex: 0 },
    difficulty: 50,
    shuffleAnswers: true,
    feedbackMode: "general",
    feedback: null,
    feedbackCorrect: null,
    feedbackIncorrect: null,
    optionFeedbackJson: null,
    tags: [],
    orderIndex: null,
    ...overrides,
    promptFormat,
    prompt: normalizePromptByFormat(overrides.prompt, promptFormat).prompt,
  } as unknown as Question;
}

/** Export the question into an .xlsx buffer and read the sheet back. */
async function throughBook(q: Question): Promise<{ rows: Record<string, unknown>[]; headers: Set<string> }> {
  const wb = new ExcelJS.Workbook();
  addJsonSheet(wb, "Вопросы", [serializeQuestionRow(q, topic.name)]);
  const back = await readWorkbookFromBuffer(await workbookToBuffer(wb));
  const ws = back.getWorksheet("Вопросы")!;
  return { rows: sheetToObjects(ws), headers: sheetHeaders(ws) };
}

/** Round trip as an UPDATE of the same question (ID kept). */
async function updateThroughBook(q: Question): Promise<Record<string, any>> {
  storageMock.getQuestion.mockResolvedValue(q);
  const { rows, headers } = await throughBook(q);
  const result = await importQuestionRows(rows, headers, { dryRun: false });
  expect(result.errors).toEqual([]);
  return storageMock.updateQuestion.mock.calls[0][1];
}

/** Round trip as a NEW question on another installation (ID unknown there). */
async function createThroughBook(q: Question): Promise<Record<string, any>> {
  storageMock.getQuestion.mockResolvedValue(undefined);
  const { rows, headers } = await throughBook(q);
  const result = await importQuestionRows(rows, headers, { dryRun: false });
  expect(result.errors).toEqual([]);
  return storageMock.createQuestion.mock.calls[0][0];
}

const LISTING = "Что выведет разметка?\n\n```html\n<div class=\"box\">\n  <b>текст</b>\n</div>\n```\n\nИ `<i>` в строке.";

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getTopics.mockResolvedValue([topic]);
  storageMock.getContentHashesByTopic.mockResolvedValue(new Set());
  storageMock.getQuestionsByTopic.mockResolvedValue([]);
  storageMock.createQuestion.mockImplementation(async (q: any) => ({ id: "new1", ...q }));
  storageMock.updateQuestion.mockImplementation(async (_id: string, q: any) => ({ id: "q1", ...q }));
});

describe("«Вопросы» round trip — markdown text", () => {
  it("keeps emphasis, links and a numbered list", async () => {
    const q = question({
      prompt: "Выберите **верное** утверждение о *налогах*:\n1. первое\n2. второе\n\nСм. [справку](https://example.com/help).",
    });
    expect((await createThroughBook(q)).prompt).toBe(q.prompt);
  });

  it("keeps the tags inside a listing and an inline code span", async () => {
    const q = question({ prompt: LISTING });
    expect((await createThroughBook(q)).prompt).toBe(q.prompt);
    vi.clearAllMocks();
    expect((await updateThroughBook(q)).prompt).toBe(q.prompt);
  });

  it("keeps a tag the author wrote on purpose when the row updates its own question", async () => {
    const q = question({ prompt: "Тег <b> делает текст жирным" });
    expect((await updateThroughBook(q)).prompt).toBe("Тег <b> делает текст жирным");
  });

  it("still converts foreign markup in a cell that was edited", async () => {
    const q = question({ prompt: "Старый текст" });
    storageMock.getQuestion.mockResolvedValue(q);
    const { rows, headers } = await throughBook(q);
    rows[0]["Текст вопроса"] = "Новый <b>жирный</b> текст";
    await importQuestionRows(rows, headers, { dryRun: false });
    expect(storageMock.updateQuestion.mock.calls[0][1].prompt).toBe("Новый **жирный** текст");
  });

  it("keeps markdown in the feedback texts", async () => {
    const q = question({
      prompt: "Вопрос",
      feedbackMode: "conditional",
      feedbackCorrect: "**Верно.** Тег `<b>` — жирный.",
      feedbackIncorrect: "Тег <i> — курсив,\nсм. [справку](https://example.com/#tags)",
    });
    const saved = await updateThroughBook(q);
    expect(saved.feedbackCorrect).toBe(q.feedbackCorrect);
    expect(saved.feedbackIncorrect).toBe(q.feedbackIncorrect);
  });

  it("carries the stored SVG of a formula", async () => {
    const q = question({ prompt: "Найдите $$x^2$$" });
    const saved = await createThroughBook(q);
    expect(saved.prompt).toBe(q.prompt);
    expect(Object.keys(saved.dataJson.formulas ?? {})).toEqual(["x^2"]);
  });
});

describe("«Вопросы» round trip — rich formats", () => {
  it("keeps a «форматированный» text", async () => {
    const q = question({
      prompt: "<p><strong>Срочно!</strong> Заполните:</p><ul><li>Имя — <em>Пётр</em></li><li>Участок — 7</li></ul>",
      promptFormat: "richText",
    });
    const saved = await createThroughBook(q);
    expect(saved.promptFormat).toBe("richText");
    expect(saved.prompt).toBe(q.prompt);
  });

  it("keeps an html text with a listing", async () => {
    const q = question({
      prompt: "<p>Что выведет запрос?</p>\n<pre><code class=\"language-sql\">SELECT 1 &lt; 2;</code></pre>",
      promptFormat: "html",
    });
    const saved = await createThroughBook(q);
    expect(saved.promptFormat).toBe("html");
    expect(saved.prompt).toBe(q.prompt);
  });
});

describe("«Вопросы» round trip — `#` inside list items", () => {
  it("keeps options with `#` and the correct answer number", async () => {
    const options = ["Язык C#", "Ссылка https://example.com/page#part", "**Жирный** вариант"];
    const q = question({ prompt: "Вопрос", dataJson: { options }, correctJson: { correctIndex: 2 } });
    const saved = await createThroughBook(q);
    expect(saved.dataJson.options).toEqual(options);
    expect(saved.correctJson).toEqual({ correctIndex: 2 });
  });

  it("keeps a `#` in ranking items and matching sides", async () => {
    const items = ["Шаг #1", "Шаг #2", "Шаг #3"];
    const ranking = question({ type: "ranking", prompt: "Порядок", dataJson: { items }, correctJson: { correctOrder: [2, 0, 1] } });
    const savedRanking = await createThroughBook(ranking);
    expect(savedRanking.dataJson.items).toEqual(items);
    expect(savedRanking.correctJson).toEqual({ correctOrder: [2, 0, 1] });

    vi.clearAllMocks();
    storageMock.getTopics.mockResolvedValue([topic]);
    storageMock.getContentHashesByTopic.mockResolvedValue(new Set());
    storageMock.createQuestion.mockImplementation(async (q: any) => ({ id: "new1", ...q }));
    const left = ["C#", "F#"];
    const right = ["Microsoft #1", "Microsoft #2", "Лишний"];
    const matching = question({
      type: "matching", prompt: "Сопоставьте", dataJson: { left, right },
      correctJson: { pairs: [{ left: 0, right: 0 }, { left: 1, right: 1 }] },
    });
    const savedMatching = await createThroughBook(matching);
    expect(savedMatching.dataJson).toEqual({ left, right });
  });

  it("keeps a `#` in «ОС по вариантам»", async () => {
    const q = question({
      prompt: "Вопрос",
      dataJson: { options: ["А", "Б", "В"] },
      optionFeedbackJson: [null, "См. раздел #2", "Тег <b> — жирный"],
    });
    expect((await updateThroughBook(q)).optionFeedbackJson).toEqual([null, "См. раздел #2", "Тег <b> — жирный"]);
  });

  it("reads a legacy book without the escape as before", async () => {
    const q = question({ prompt: "Вопрос", dataJson: { options: ["А", "Б"] } });
    const { rows, headers } = await throughBook(q);
    rows[0]["Тексты вариантов ответа"] = "А # Б # В";
    rows[0]["ID"] = "";
    storageMock.getQuestion.mockResolvedValue(undefined);
    await importQuestionRows(rows, headers, { dryRun: false });
    expect(storageMock.createQuestion.mock.calls[0][0].dataJson.options).toEqual(["А", "Б", "В"]);
  });
});
