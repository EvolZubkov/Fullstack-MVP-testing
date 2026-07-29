/**
 * @module tests/workbook-template
 * @description Contract tests for the «Импорт» section's downloadable workbook
 * template (`GET /api/workbook/template`). The template is the artifact authors
 * start from, so it is held to three properties:
 *
 * - ACTUALITY — every role sheet's header row equals the canonical header list
 *   the importer/exporter use, so the template cannot silently lag the format;
 * - COMPLETENESS — the «Справка» sheet documents EVERY column of EVERY role
 *   sheet, and states the accepted values for the enumerated ones;
 * - VALIDITY — the shipped example rows import through the real importer with
 *   zero errors, so a reader who copies them gets a working book.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import ExcelJS from "exceljs";
import { addJsonSheet, workbookToBuffer, readWorkbookFromBuffer, sheetToObjects } from "../server/utils/excel";
import { QUESTION_HEADERS } from "../server/services/questions-export";
import {
  SCALE_HEADERS,
  RESULT_VAR_HEADERS,
  MEASUREMENT_HEADERS,
  STRUCTURE_HEADERS,
  QUOTA_HEADERS,
  VARIANT_THRESHOLD_HEADERS,
  SCORING_OVERRIDE_HEADERS,
  VARIANTS_COLUMN,
} from "../server/utils/workbook-sheets";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://fake/test";
});

const { storageMock, testSettingsMock } = vi.hoisted(() => ({
  storageMock: {
    getTest: vi.fn(),
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
    getTestQuestionScoring: vi.fn(),
    replaceTestQuestionScoring: vi.fn(),
  },
  testSettingsMock: { create: vi.fn(), save: vi.fn() },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/services/test-settings", () => ({ testSettingsService: testSettingsMock }));
vi.mock("../server/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  buildWorkbookTemplate,
  EXAMPLE_ROWS,
  ROLE_SHEET_NAMES,
  HELP_SHEET,
  EXAMPLE_SHEET,
  SCORING_COL_POINTS,
  SCORING_COL_PRICE,
} from "../server/services/workbook-template";
import { importWorkbook } from "../server/services/workbook-import";

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getTopics.mockResolvedValue([]);
  storageMock.getContentHashesByTopic.mockResolvedValue(new Set());
  storageMock.getQuestionsByTopic.mockResolvedValue([]);
  storageMock.getScales.mockResolvedValue([]);
  storageMock.getResultVariables.mockResolvedValue([]);
  storageMock.getTestQuestionScoring.mockResolvedValue([]);
  storageMock.validateResultVariableFormula.mockResolvedValue({ valid: true });
  storageMock.getTest.mockResolvedValue({ id: "test-1", status: "draft" });
});

/**
 * Canonical header list per role sheet. «Вопросы» is checked separately: the
 * template deliberately offers MORE than the export writes (row alias, variant
 * membership, the optional per-test scoring pair), so an equality check there
 * would forbid exactly the columns the importer accepts.
 */
const CANONICAL: Record<string, string[]> = {
  "Структура": STRUCTURE_HEADERS,
  "Квоты": QUOTA_HEADERS,
  "Пороги вариантов": VARIANT_THRESHOLD_HEADERS,
  "Оценка": SCORING_OVERRIDE_HEADERS,
  "Шкалы": SCALE_HEADERS,
  "Показатели": RESULT_VAR_HEADERS,
  "Вклады вопросов": MEASUREMENT_HEADERS,
};

/** Header row of a sheet, as plain trimmed strings. */
function headersOf(ws: ExcelJS.Worksheet): string[] {
  const row = ws.getRow(1);
  const out: string[] = [];
  for (let c = 1; c <= (ws.actualColumnCount || ws.columnCount); c++) {
    out.push(String(row.getCell(c).value ?? "").trim());
  }
  return out;
}

/** Whole-sheet text, for reference-content assertions. */
function textOf(ws: ExcelJS.Worksheet | undefined): string {
  return JSON.stringify(ws?.getSheetValues() ?? []);
}

describe("шаблон книги — актуальность", () => {
  it("содержит все ролевые листы, справку и пример", async () => {
    const wb = await buildWorkbookTemplate();
    const names = wb.worksheets.map((w) => w.name);
    for (const role of ROLE_SHEET_NAMES) expect(names).toContain(role);
    expect(names).toContain(HELP_SHEET);
    expect(names).toContain(EXAMPLE_SHEET);
  });

  it("заголовки каждого ролевого листа совпадают с каноническими", async () => {
    const wb = await buildWorkbookTemplate();
    for (const [name, expected] of Object.entries(CANONICAL)) {
      const ws = wb.worksheets.find((w) => w.name === name);
      expect(ws, `лист «${name}» отсутствует`).toBeTruthy();
      expect(headersOf(ws!), `заголовки листа «${name}»`).toEqual(expected);
    }
  });

  it("«Вопросы» несут все колонки экспорта плюс алиас, варианты и оценку", async () => {
    const wb = await buildWorkbookTemplate();
    const headers = headersOf(wb.worksheets.find((w) => w.name === "Вопросы")!);

    // Everything the export writes must be offered, or a round-trip loses data.
    for (const col of ["Ключ строки", ...QUESTION_HEADERS, VARIANTS_COLUMN]) {
      expect(headers, `нет колонки «${col}»`).toContain(col);
    }
    // …and the scoring pair the importer accepts here, which the export routes
    // to «Оценка». Hiding an accepted column makes it undiscoverable.
    expect(headers).toContain(SCORING_COL_POINTS);
    expect(headers).toContain(SCORING_COL_PRICE);
    expect(new Set(headers).size, "дублей быть не должно").toBe(headers.length);
  });
});

describe("шаблон книги — полнота справки", () => {
  it("справка описывает каждую колонку каждого ролевого листа", async () => {
    const wb = await buildWorkbookTemplate();
    const help = textOf(wb.worksheets.find((w) => w.name === HELP_SHEET));

    // Read the columns off the TEMPLATE ITSELF, not off a list kept here by
    // hand: any column added to the template must gain a reference row, and a
    // column the importer accepts cannot ship undocumented.
    const missing: string[] = [];
    for (const name of ROLE_SHEET_NAMES) {
      const ws = wb.worksheets.find((w) => w.name === name)!;
      for (const col of headersOf(ws)) {
        if (col && !help.includes(col)) missing.push(`${name} → ${col}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("справка перечисляет допустимые значения перечислимых колонок", async () => {
    const wb = await buildWorkbookTemplate();
    const help = textOf(wb.worksheets.find((w) => w.name === HELP_SHEET));

    // Values a reader cannot guess and the parsers reject when wrong.
    const required = [
      "multiple_choice", "multiple_response", "matching", "ranking",
      "number", "boolean", "category", "level",
      "sum", "avg", "weighted_avg", "max", "min",
      "percent", "custom", "positive", "inverse",
      "suspend_data", "interaction", "both",
      "вариант", "пара", "позиция",
      "Ровно", "Не менее",
      "Сумма баллов", "Процент", "По вариантам", "Как у теста",
      "успех", "завершение",
      "веса", "ступени", "точное",
    ];
    const missing = required.filter((v) => !help.includes(v));
    expect(missing).toEqual([]);
  });

  it("справка не протекает внутренними обозначениями", async () => {
    const wb = await buildWorkbookTemplate();
    const help = textOf(wb.worksheets.find((w) => w.name === HELP_SHEET));
    for (const tag of ["PRD-", "BRD-", "T-40", "FR-", "router_by_topics"]) {
      expect(help, `в справке не должно быть «${tag}»`).not.toContain(tag);
    }
  });
});

describe("шаблон книги — валидность примеров", () => {
  it("лист с примерами не является ролевым, поэтому импорт его не читает", async () => {
    expect(ROLE_SHEET_NAMES).not.toContain(EXAMPLE_SHEET);
    expect(ROLE_SHEET_NAMES).not.toContain(HELP_SHEET);
  });

  it("ролевые листы шаблона пусты — скачанный файл ничего не создаёт", async () => {
    const wb = await buildWorkbookTemplate();
    for (const name of ROLE_SHEET_NAMES) {
      const ws = wb.worksheets.find((w) => w.name === name)!;
      expect(sheetToObjects(ws), `лист «${name}» должен быть без строк данных`).toEqual([]);
    }
  });

  it("строки-примеры проходят настоящий импорт без единой ошибки", async () => {
    // The example rows are shipped as a ready-to-copy book: feed exactly those
    // rows to the real importer and require a clean plan.
    const wb = new ExcelJS.Workbook();
    for (const name of ROLE_SHEET_NAMES) {
      const rows = EXAMPLE_ROWS[name];
      if (rows?.length) addJsonSheet(wb, name, rows);
    }
    const loaded = await readWorkbookFromBuffer(await workbookToBuffer(wb));

    const result = await importWorkbook("test-1", loaded, { dryRun: true });

    expect(result.errors).toEqual([]);
    expect(result.questions.created).toBeGreaterThan(0);
    expect(result.structure.sections).toBeGreaterThan(0);
    expect(result.scoring.rows).toBeGreaterThan(0);
    expect(result.scales.created).toBeGreaterThan(0);
    expect(result.resultVariables.created).toBeGreaterThan(0);
    expect(result.measurements.rows).toBeGreaterThan(0);
  });

  it("примеры покрывают все четыре типа вопросов", async () => {
    const types = EXAMPLE_ROWS["Вопросы"].map((r) => r["Тип вопроса"]);
    expect(new Set(types)).toEqual(
      new Set(["multiple_choice", "multiple_response", "matching", "ranking"]),
    );
  });

  it("лист «Пример» показывает заполненные строки для каждого ролевого листа с примерами", async () => {
    const wb = await buildWorkbookTemplate();
    const example = textOf(wb.worksheets.find((w) => w.name === EXAMPLE_SHEET));
    for (const [name, rows] of Object.entries(EXAMPLE_ROWS)) {
      if (!rows.length) continue;
      expect(example, `на листе примеров нет блока «${name}»`).toContain(name);
    }
  });
});
