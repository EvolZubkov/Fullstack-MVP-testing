/**
 * @module tests/workbook-import-text-types
 *
 * PRD-57 FR-31, AC-08: книга Excel возит текстовые типы заданий — короткий ответ,
 * пропуски и развёрнутый ответ.
 *
 * Круг «экспорт — импорт» здесь важнее отдельных веток: правила проверки это КОНСТРУКЦИЯ,
 * и потерять в ней связку, допуск или пометку долгого выражения означает молча подменить
 * эталон задания. Поэтому каждый тип проверяется кругом, а не только разбором.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://fake/test";
});

const { storageMock, testSettingsMock } = vi.hoisted(() => ({
  storageMock: {
    getTopics: vi.fn(),
    createTopic: vi.fn(),
    getQuestion: vi.fn(),
    createQuestion: vi.fn(),
    updateQuestion: vi.fn(),
    getContentHashesByTopic: vi.fn(),
    getQuestionsByTopic: vi.fn(),
    getScales: vi.fn(),
    createScale: vi.fn(),
    updateScale: vi.fn(),
    getResultVariables: vi.fn(),
    createResultVariable: vi.fn(),
    updateResultVariable: vi.fn(),
    validateResultVariableFormula: vi.fn(),
    upsertQuestionMeasurements: vi.fn(),
    replaceTestQuestionScoring: vi.fn(),
    getTest: vi.fn(),
  },
  testSettingsMock: { create: vi.fn(), save: vi.fn() },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/services/test-settings", () => ({
  testSettingsService: testSettingsMock,
  __esModule: true,
}));

import ExcelJS from "exceljs";
import { addJsonSheet } from "../server/utils/excel";
import { importWorkbook } from "../server/services/workbook-import";
import { serializeQuestionRow } from "../server/services/questions-export";
import type { Question } from "../shared/schema";

const TOPIC = {
  id: "t1", name: "Надзор", description: null, folderId: null,
  ownerId: null, visibility: "shared", createdAt: new Date(),
};

function book(sheets: Record<string, Record<string, unknown>[]>): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    if (rows.length) addJsonSheet(wb, name, rows);
  }
  return wb;
}

const run = (rows: Record<string, unknown>[]) =>
  importWorkbook("test-1", book({ "Вопросы": rows }), { dryRun: false });

/** Вопрос, который импорт создал. */
const created = () => storageMock.createQuestion.mock.calls[0]?.[0] as any;

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getTopics.mockResolvedValue([TOPIC]);
  storageMock.getContentHashesByTopic.mockResolvedValue(new Set());
  storageMock.getQuestionsByTopic.mockResolvedValue([]);
  let n = 0;
  storageMock.createQuestion.mockImplementation(async (q: any) => ({ id: `q-new-${++n}`, ...q }));
  storageMock.getScales.mockResolvedValue([]);
  storageMock.getResultVariables.mockResolvedValue([]);
  storageMock.validateResultVariableFormula.mockResolvedValue({ valid: true });
  storageMock.upsertQuestionMeasurements.mockResolvedValue([]);
  storageMock.replaceTestQuestionScoring.mockResolvedValue([]);
  storageMock.getTest.mockResolvedValue({ id: "test-1", title: "Проверка", status: "draft" });
});

describe("короткий ответ", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    "Тема": "Надзор",
    "Тип вопроса": "short_answer",
    "Текст вопроса": "Как называется служба?",
    "Номера правильных ответов": "Ростехнадзор\nФедеральная служба по * надзору",
    ...over,
  });

  it("правила приезжают набором, связка по умолчанию «любое»", async () => {
    const res = await run([row()]);
    expect(res.errors).toEqual([]);
    expect(created().type).toBe("short");
    expect(created().correctJson).toEqual({
      answerKind: "text",
      join: "any",
      rules: [
        { kind: "text", match: "wildcard", value: "Ростехнадзор" },
        { kind: "text", match: "wildcard", value: "Федеральная служба по * надзору" },
      ],
    });
  });

  it("предел длины приезжает своей колонкой", async () => {
    await run([row({ "Предел длины": 120 })]);
    expect(created().dataJson).toEqual({ maxLength: 120 });
  });

  it("числовой ответ: связка, единица и допуск", async () => {
    await run([row({
      "Номера правильных ответов": ">= 10\n<= 20",
      "Вид ответа": "число",
      "Связка правил": "все",
      "Единица измерения": "°C",
    })]);
    expect(created().correctJson).toEqual({
      answerKind: "number",
      join: "all",
      unit: "°C",
      rules: [
        { kind: "number", op: "gte", value: 10 },
        { kind: "number", op: "lte", value: 20 },
      ],
    });
  });

  it("задание без правил принимается: проверка просто не написана", async () => {
    const res = await run([row({ "Номера правильных ответов": "" })]);
    expect(res.errors).toEqual([]);
    expect(created().correctJson).toEqual({ answerKind: "text", join: "any", rules: [] });
  });

  it("нечитаемое числовое правило останавливает строку, а не молчит", async () => {
    const res = await run([row({ "Номера правильных ответов": "около трёх", "Вид ответа": "число" })]);
    expect(res.errors.join(" ")).toContain("около трёх");
    expect(storageMock.createQuestion).not.toHaveBeenCalled();
  });
});

describe("пропуски", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    "Тема": "Надзор",
    "Тип вопроса": "fill_in_blanks",
    "Текст вопроса": "Столица России — {{city}}, основана в {{year}} году.",
    "Номера правильных ответов": "[city] Москва\n[year] = 1703",
    ...over,
  });

  it("правила раскладываются по пропускам текста", async () => {
    const res = await run([row()]);
    expect(res.errors).toEqual([]);
    expect(created().type).toBe("blanks");
    expect(created().correctJson).toEqual({
      blanks: [
        { id: "city", answerKind: "text", join: "any", rules: [{ kind: "text", match: "wildcard", value: "Москва" }] },
        { id: "year", answerKind: "number", join: "any", rules: [{ kind: "number", op: "eq", value: 1703 }] },
      ],
    });
  });

  it("имя, которого нет в тексте задания, останавливает строку", async () => {
    const res = await run([row({ "Номера правильных ответов": "[country] Россия" })]);
    expect(res.errors.join(" ")).toContain("country");
    expect(storageMock.createQuestion).not.toHaveBeenCalled();
  });

  it("текст без пропусков у этого типа — ошибка", async () => {
    const res = await run([row({ "Текст вопроса": "Совсем без пропусков", "Номера правильных ответов": "" })]);
    expect(res.errors).toHaveLength(1);
  });
});

describe("развёрнутый ответ", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    "Тема": "Надзор",
    "Тип вопроса": "long_answer",
    "Текст вопроса": "Опишите порядок действий при аварии.",
    ...over,
  });

  it("подсказка, предел длины и обязательность приезжают колонками", async () => {
    const res = await run([row({
      "Подсказка в поле": "Ответьте своими словами",
      "Предел длины": 4000,
      "Ответ обязателен": "да",
    })]);
    expect(res.errors).toEqual([]);
    expect(created().type).toBe("long");
    expect(created().dataJson).toEqual({
      placeholder: "Ответьте своими словами",
      maxLength: 4000,
      required: true,
    });
    expect(created().correctJson).toEqual({});
  });

  it("заполненная колонка правил — ошибка, а не значение на выброс", async () => {
    const res = await run([row({ "Номера правильных ответов": "хоть что-то" })]);
    expect(res.errors).toHaveLength(1);
    expect(storageMock.createQuestion).not.toHaveBeenCalled();
  });
});

describe("оформление содержимого переживает книгу (AC-01a, FR-31)", () => {
  it("листинг кода и формула доезжают без потерь", async () => {
    const prompt = "Что выведет код?\n\n```python\nfor i in range(3):\n    print(i)\n```\n\nи $$E = mc^2$$";
    await run([{
      "Тема": "Надзор",
      "Тип вопроса": "long_answer",
      "Текст вопроса": prompt,
    }]);
    expect(created().prompt).toContain("```python");
    expect(created().prompt).toContain("    print(i)");
    expect(created().prompt).toContain("$$E = mc^2$$");
  });
});

describe("круг «экспорт — импорт»", () => {
  const question = (over: Partial<Question>): Question => ({
    id: "q1",
    topicId: "t1",
    type: "short",
    prompt: "Как называется служба?",
    dataJson: {},
    correctJson: {},
    difficulty: 50,
    orderIndex: 0,
    shuffleAnswers: true,
    feedback: null,
    feedbackMode: "general",
    feedbackCorrect: null,
    feedbackIncorrect: null,
    tags: [],
    createdBy: null,
    createdAt: new Date(),
    ...over,
  } as unknown as Question);

  const roundTrip = async (q: Question) => {
    const row = serializeQuestionRow(q, "Надзор");
    delete (row as Record<string, unknown>)["ID"];
    const res = await run([row as Record<string, unknown>]);
    expect(res.errors).toEqual([]);
    return created();
  };

  it("короткий ответ с регулярным выражением и пометкой долгого", async () => {
    const correctJson = {
      answerKind: "text",
      join: "all",
      rules: [
        { kind: "text", match: "wildcard", value: "Федеральная служба по * надзору" },
        { kind: "text", match: "regex", value: String.raw`^РТН$`, slow: true },
      ],
    };
    const back = await roundTrip(question({ type: "short", correctJson, dataJson: { maxLength: 200 } } as Partial<Question>));
    expect(back.correctJson).toEqual(correctJson);
    expect(back.dataJson).toEqual({ maxLength: 200 });
  });

  it("числовой короткий ответ с единицей и допуском", async () => {
    const correctJson = {
      answerKind: "number",
      join: "any",
      unit: "°C",
      rules: [{ kind: "number", op: "eq", value: -25, tolerance: { unit: "abs", value: 2 } }],
    };
    const back = await roundTrip(question({ type: "short", correctJson } as Partial<Question>));
    expect(back.correctJson).toEqual(correctJson);
  });

  it("пропуски", async () => {
    const correctJson = {
      blanks: [
        { id: "city", answerKind: "text", join: "any", rules: [{ kind: "text", match: "wildcard", value: "Москва" }] },
        { id: "year", answerKind: "number", join: "any", rules: [{ kind: "number", op: "eq", value: 1703 }] },
      ],
    };
    const back = await roundTrip(question({
      type: "blanks",
      prompt: "Столица России — {{city}}, основана в {{year}} году.",
      correctJson,
    } as Partial<Question>));
    expect(back.correctJson).toEqual(correctJson);
  });

  it("развёрнутый ответ", async () => {
    const dataJson = { placeholder: "Ответьте своими словами", maxLength: 4000, required: true };
    const back = await roundTrip(question({ type: "long", dataJson, correctJson: {} } as Partial<Question>));
    expect(back.dataJson).toEqual(dataJson);
    expect(back.correctJson).toEqual({});
  });
});
