/**
 * @module tests/workbook-import-scale
 *
 * PRD-26 on the two test-scoped sheets of the import book.
 *
 * «Вклады вопросов»: a scale contributes through `источник = вариант`, where the source
 * key is the graduation index — the shape the burnout inventory is authored in. The key
 * is validated against the graduation count, which only works while `unitCountOfQuestion`
 * reads a scale's `options` list.
 *
 * «Оценка»: graduation weights are accepted for a scale (FR-07), but a price set on a
 * MEASUREMENT-only scale warns instead of silently storing numbers that can never reach
 * the result (FR-25) — the values are still written, because they come alive the moment
 * the author sets a correct graduation.
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

const TOPIC = {
  id: "t1", name: "Выгорание", description: null, folderId: null,
  ownerId: null, visibility: "shared", createdAt: new Date(),
};

const GRADES = "Никогда#Очень редко#Редко#Часто#Очень часто#Постоянно";

/** One measurement-only scale row of the inventory. */
const scaleQuestionRow = (over: Record<string, unknown> = {}) => ({
  "Ключ строки": "q1",
  "Тема": "Выгорание",
  "Тип вопроса": "scale",
  "Текст вопроса": "После работы я чувствую себя как «выжатый лимон»",
  "Тексты вариантов ответа": GRADES,
  "Номера правильных ответов": "",
  ...over,
});

/** Per-graduation contributions into one scale: value = graduation index. */
function contributionRows(questionKey: string, scaleKey: string): Record<string, unknown>[] {
  return Array.from({ length: 6 }, (_, i) => ({
    "Вопрос": questionKey,
    "Шкала": scaleKey,
    "Источник": "вариант",
    "Ключ источника": String(i),
    "Значение": i,
    "Вес": 1,
  }));
}

function book(sheets: Record<string, Record<string, unknown>[]>): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    if (rows.length) addJsonSheet(wb, name, rows);
  }
  return wb;
}

const run = (sheets: Record<string, Record<string, unknown>[]>) =>
  importWorkbook("test-1", book(sheets), { dryRun: false });

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getTopics.mockResolvedValue([TOPIC]);
  storageMock.getContentHashesByTopic.mockResolvedValue(new Set());
  storageMock.getQuestionsByTopic.mockResolvedValue([]);
  storageMock.createQuestion.mockImplementation(async (q: any) => ({ id: "q-new", ...q }));
  storageMock.getScales.mockResolvedValue([]);
  storageMock.createScale.mockImplementation(async (s: any) => ({ id: "scale-1", ...s }));
  storageMock.getResultVariables.mockResolvedValue([]);
  storageMock.validateResultVariableFormula.mockResolvedValue({ valid: true });
  storageMock.upsertQuestionMeasurements.mockResolvedValue([]);
  storageMock.replaceTestQuestionScoring.mockResolvedValue([]);
  storageMock.getTest.mockResolvedValue({ id: "test-1", title: "Опросник", status: "draft" });
});

describe("«Вклады вопросов» — scale contributions (PRD-26 FR-12)", () => {
  const scaleSheet = [{ "Ключ": "ee", "Название": "Эмоциональное истощение", "Тип": "number" }];

  it("accepts a per-graduation contribution grid for a scale question", async () => {
    const res = await run({
      "Вопросы": [scaleQuestionRow()],
      "Шкалы": scaleSheet,
      "Вклады вопросов": contributionRows("q1", "ee"),
    });
    expect(res.errors).toEqual([]);
    expect(res.measurements).toEqual({ rows: 6, questions: 1 });
    expect(storageMock.upsertQuestionMeasurements).toHaveBeenCalledTimes(1);
    const written = storageMock.upsertQuestionMeasurements.mock.calls[0];
    // Every graduation index reached the store with its own value.
    const specs = written[written.length - 1] as any[];
    expect(specs.map((m) => m.sourceKey)).toEqual(["0", "1", "2", "3", "4", "5"]);
    expect(specs.map((m) => m.valueJson)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("validates the source key against the GRADUATION count", async () => {
    // The regression this guards: `unitCountOfQuestion` used to read `options` only for
    // single/multiple, so a scale resolved to 0 units and every key looked out of range.
    const res = await run({
      "Вопросы": [scaleQuestionRow()],
      "Шкалы": scaleSheet,
      "Вклады вопросов": [
        ...contributionRows("q1", "ee"),
        { "Вопрос": "q1", "Шкала": "ee", "Источник": "вариант", "Ключ источника": "6", "Значение": 6, "Вес": 1 },
      ],
    });
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toContain("Вклады вопросов");
  });
});

describe("«Оценка» — pricing a scale (PRD-26 FR-07/FR-25)", () => {
  it("accepts graduation weights on a scale", async () => {
    const res = await run({
      "Вопросы": [scaleQuestionRow({ "Номера правильных ответов": "4" })],
      "Оценка": [{ "Вопрос": "q1", "Цена ответа": "веса: 0 # 1 # 2 # 3 # 4 # 5" }],
    });
    expect(res.errors).toEqual([]);
    expect(res.scoring).toEqual({ rows: 1 });
    const rows = storageMock.replaceTestQuestionScoring.mock.calls[0][1] as any[];
    expect(rows[0].scoringJson).toEqual({ kind: "weighted", weights: [0, 1, 2, 3, 4, 5] });
  });

  it("warns when a price is set on a MEASUREMENT scale, but still stores it", async () => {
    const res = await run({
      "Вопросы": [scaleQuestionRow()],
      "Оценка": [{ "Вопрос": "q1", "Балл": 5, "Цена ответа": "веса: 0 # 1 # 2 # 3 # 4 # 5" }],
    });
    expect(res.errors).toEqual([]);
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toContain("измерительная шкала");
    // Stored anyway: the numbers come alive as soon as a correct graduation is set.
    const rows = storageMock.replaceTestQuestionScoring.mock.calls[0][1] as any[];
    expect(rows[0].points).toBe(5);
    expect(rows[0].scoringJson).toEqual({ kind: "weighted", weights: [0, 1, 2, 3, 4, 5] });
  });

  it("does not warn for a scale that HAS a correct graduation", async () => {
    const res = await run({
      "Вопросы": [scaleQuestionRow({ "Номера правильных ответов": "4" })],
      "Оценка": [{ "Вопрос": "q1", "Балл": 2 }],
    });
    expect(res.warnings).toEqual([]);
  });

  it("refuses «ступени» on a scale with a readable reason", async () => {
    const res = await run({
      "Вопросы": [scaleQuestionRow()],
      "Оценка": [{ "Вопрос": "q1", "Цена ответа": "ступени: c>=1 => 1" }],
    });
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toContain("шкалы");
  });
});

describe("«Вопросы» warnings reach the book result", () => {
  it("forwards the scale shuffle notice with the sheet name", async () => {
    const res = await run({
      "Вопросы": [scaleQuestionRow({ "Следование вариантов ответов": "Random" })],
    });
    expect(res.errors).toEqual([]);
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toContain("Лист «Вопросы»");
    expect(res.warnings[0]).toContain("не перемешивается");
  });
});
