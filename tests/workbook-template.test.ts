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
import { scales, resultVariables } from "@shared/schema";
import {
  QUESTION_HEADERS,
  QUESTION_TYPE_CHOICES,
  SHUFFLE_CHOICES,
  FEEDBACK_MODE_CHOICES,
} from "../server/services/questions-export";
import {
  SCALE_HEADERS,
  RESULT_VAR_HEADERS,
  MEASUREMENT_HEADERS,
  STRUCTURE_HEADERS,
  QUOTA_HEADERS,
  VARIANT_THRESHOLD_HEADERS,
  SCORING_OVERRIDE_HEADERS,
  VARIANTS_COLUMN,
  BOOL_CHOICES,
  CONTROLS_CHOICES,
  MEASUREMENT_SOURCE_CHOICES,
  PASS_TYPE_CHOICES,
  QUOTA_MODE_CHOICES,
  SCALE_TYPE_CHOICES,
  STRUCTURE_PASS_TYPE_CHOICES,
  UNLOCK_MODE_CHOICES,
  SETTING_PARAM_NAMES,
  FEEDBACK_HEADERS,
  FEEDBACK_FORMAT_CHOICES,
  RECOMMENDATION_HEADERS,
  RECOMMENDATION_TYPE_CHOICES,
  OWNER_CHOICES,
  PAGE_HEADERS,
  PAGE_FIELD_HEADERS,
  PAGE_ZONE_CHOICES,
  PAGE_KIND_CHOICES,
  PAGE_MODE_CHOICES,
  PAGE_TARGET_CHOICES,
  parseBool,
  parseFeedbackSheets,
  parseMeasurementRow,
  parsePageSheets,
  parseQuotaRow,
  parseStructureRow,
  parseVariantThresholdRow,
  serBool,
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
    getContentPages: vi.fn(),
    createContentPage: vi.fn(),
    updateContentPage: vi.fn(),
    deleteContentPage: vi.fn(),
  },
  testSettingsMock: { create: vi.fn(), save: vi.fn() },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
/**
 * Варианты оформления берутся из НАСТОЯЩЕГО манифеста «Стандартного» шаблона: только так
 * прогон примерных строк проверяет, что ключ варианта и ключи полей в примере существуют.
 * Выдуманный здесь список проверял бы согласованность примера сам с собой.
 */
vi.mock("../server/services/content-page-fields", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/services/content-page-fields")>();
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const manifest = JSON.parse(
    readFileSync(join(process.cwd(), "server/scorm/templates/default/manifest.json"), "utf8"),
  ) as { contentTemplates?: unknown[] };
  return { ...actual, resolveContentTemplates: vi.fn(async () => manifest.contentTemplates ?? null) };
});
vi.mock("../server/services/test-settings", () => ({ testSettingsService: testSettingsMock }));
vi.mock("../server/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  buildWorkbookTemplate,
  EXAMPLE_ROWS,
  ROLE_SHEET_NAMES,
  HELP_SHEET,
  EXAMPLE_SHEET,
  CHOICES_SHEET,
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
  // Системные страницы создаёт сам тест, поэтому у приёмника примерных строк обязана
  // существовать страница итогов: строка «Итоги» её НАХОДИТ, а не создаёт.
  storageMock.getContentPages.mockResolvedValue([
    {
      id: "p-results", testId: "test-1", topicId: null, position: "after", kind: "results",
      mode: "template", type: "info", templateKey: "results.standard", sortOrder: 0,
      valuesJson: {}, settingsJson: {}, autoAdvance: false, autoAdvanceDelayMs: null,
    },
  ]);
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
  "Обратная связь": FEEDBACK_HEADERS,
  "Рекомендации": RECOMMENDATION_HEADERS,
  "Страницы": PAGE_HEADERS,
  "Поля страниц": PAGE_FIELD_HEADERS,
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
      // «Настройки» — единственное исключение: это список «параметр — значение», и
      // пустой лист не назвал бы автору ни одной настройки. Он проверяется ниже.
      if (name === "Настройки") continue;
      const ws = wb.worksheets.find((w) => w.name === name)!;
      expect(sheetToObjects(ws), `лист «${name}» должен быть без строк данных`).toEqual([]);
    }
  });

  it("лист «Настройки» шаблона перечисляет все параметры", async () => {
    const wb = await buildWorkbookTemplate();
    const sheet = wb.worksheets.find((w) => w.name === "Настройки")!;
    const names = sheetToObjects(sheet).map((r) => String(r["Параметр"]));
    expect(names).toEqual(SETTING_PARAM_NAMES);
    expect(names.length).toBeGreaterThan(30);
  });

  it("значения на листе «Настройки» пусты — шаблон ничего не переносит", async () => {
    // Пустая ячейка «Значение» означает «оставить как есть», поэтому скачанный
    // шаблон остаётся холостым, несмотря на 38 заполненных строк.
    const wb = await buildWorkbookTemplate();
    const sheet = wb.worksheets.find((w) => w.name === "Настройки")!;
    const values = sheetToObjects(sheet).map((r) => String(r["Значение"] ?? ""));
    expect(values.filter((v) => v !== "")).toEqual([]);
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
    // Обе страницы примера доехали: системная найдена и обновлена, авторская создана.
    expect(result.pages).toMatchObject({ updated: 1, created: 1 });
    // Ключ, которого вариант «Стандартного» шаблона не объявляет, применён не был бы —
    // и загрузка сказала бы об этом. Пример не вправе учить такому.
    expect(result.warnings.filter((w) => w.includes("не объявляет полей"))).toEqual([]);
  });

  // Значение поля хранится НА странице: строка примера с адресом, которого нет на листе
  // «Страницы», дала бы читателю готовую ошибку-сироту. Свойство проверяется на самих
  // строках, чтобы поломка была названа причиной, а не общей ошибкой импорта.
  it("каждое примерное поле страницы ссылается на страницу из примера «Страниц»", () => {
    const address = (r: Record<string, unknown>) =>
      ["Зона", "Раздел", "Вид", "Номер"]
        .map((c) => String(r[c] ?? "").trim().toLowerCase())
        .join("|");
    const pages = new Set(EXAMPLE_ROWS["Страницы"].map(address));

    expect(pages.size).toBeGreaterThan(1);
    expect(EXAMPLE_ROWS["Поля страниц"].filter((r) => !pages.has(address(r)))).toEqual([]);
    // Пример показывает обе стороны страницы: и содержание, и настройку.
    expect(new Set(EXAMPLE_ROWS["Поля страниц"].map((r) => r["Куда"])))
      .toEqual(new Set(PAGE_TARGET_CHOICES));
    // …и оба положения книги: системную страницу, которую можно только найти, и авторскую.
    expect(EXAMPLE_ROWS["Страницы"].some((r) => r["Вид"] === "Авторская")).toBe(true);
    expect(EXAMPLE_ROWS["Страницы"].some((r) => r["Вид"] !== "Авторская")).toBe(true);
  });

  it("примеры покрывают ВСЕ типы вопросов", async () => {
    // Список сверяется с перечнем типов, а не с рукописной копией: тип, добавленный
    // без строки-примера, обязан ронять этот тест — иначе автор узнает о новом типе
    // только из документации, которой в шаблоне нет.
    const types = EXAMPLE_ROWS["Вопросы"].map((r) => r["Тип вопроса"]);
    expect(new Set(types)).toEqual(
      new Set(["multiple_choice", "multiple_response", "matching", "ranking", "scale", "allocation"]),
    );
  });

  it("пример шкалы показывает опросник без правильного ответа (PRD-26)", async () => {
    const scale = EXAMPLE_ROWS["Вопросы"].find((r) => r["Тип вопроса"] === "scale");
    expect(scale).toBeTruthy();
    // Пустая ячейка — это и есть переключатель «правильного ответа нет»; заполнив её
    // в примере, мы научили бы автора ровно противоположному.
    expect(scale!["Номера правильных ответов"]).toBe("");
    expect(String(scale!["Тексты вариантов ответа"]).split("#").length).toBeGreaterThanOrEqual(2);

    // У примера должен быть смысл: градации складываются в шкалу-накопитель.
    const key = scale!["Ключ строки"];
    const contributions = EXAMPLE_ROWS["Вклады вопросов"].filter((r) => r["Вопрос"] === key);
    expect(contributions).toHaveLength(5);
    expect(contributions.map((r) => r["Ключ источника"])).toEqual(["0", "1", "2", "3", "4"]);
    const scaleKey = contributions[0]["Шкала"];
    expect(EXAMPLE_ROWS["Шкалы"].some((r) => r["Ключ"] === scaleKey)).toBe(true);
  });

  // Рекомендация хранится ВНУТРИ обратной связи владельца, поэтому строка примера,
  // ссылающаяся на владельца без строки на листе «Обратная связь», дала бы читателю
  // готовую ошибку-сироту. Свойство проверяется на самих строках, чтобы поломка была
  // названа причиной, а не общей ошибкой импорта.
  it("каждая примерная рекомендация ссылается на владельца из примера обратной связи", () => {
    const owner = (r: Record<string, unknown>) =>
      `${String(r["Кому"] ?? "")}|${String(r["Раздел"] ?? "").trim().toLowerCase()}`;
    const owners = new Set(EXAMPLE_ROWS["Обратная связь"].map(owner));

    expect(owners.size).toBeGreaterThan(1);
    expect(EXAMPLE_ROWS["Рекомендации"].filter((r) => !owners.has(owner(r)))).toEqual([]);
    // Пример показывает все три вида рекомендаций, иначе о двух из них автор не узнает.
    expect(new Set(EXAMPLE_ROWS["Рекомендации"].map((r) => r["Тип"])))
      .toEqual(new Set(RECOMMENDATION_TYPE_CHOICES));
  });

  // Раздел из примера обязан существовать на листе «Структура»: обратная связь раздела,
  // которого в тесте нет, — ошибка строки.
  it("раздел примерной обратной связи есть на листе «Структура»", () => {
    const sections = new Set(
      EXAMPLE_ROWS["Структура"].map((r) => String(r["Раздел"]).trim().toLowerCase()),
    );
    for (const row of EXAMPLE_ROWS["Обратная связь"]) {
      const name = String(row["Раздел"] ?? "").trim().toLowerCase();
      if (!name) continue;
      expect(sections, `раздела «${row["Раздел"]}» нет на листе «Структура»`).toContain(name);
    }
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

// ─── проверка ввода (выпадающие списки) ───────────────────────────────────────

/** Значения списка, на который ссылается проверка ввода ячейки. */
function choicesBehind(wb: ExcelJS.Workbook, sheet: string, column: string): string[] {
  const ws = wb.worksheets.find((w) => w.name === sheet)!;
  const index = headersOf(ws).indexOf(column);
  expect(index, `на листе «${sheet}» нет колонки «${column}»`).toBeGreaterThanOrEqual(0);
  const dv = ws.getCell(2, index + 1).dataValidation as { type?: string; formulae?: string[] } | undefined;
  expect(dv?.type, `у «${sheet}»/«${column}» нет проверки-списка`).toBe("list");
  const ref = String(dv!.formulae![0]);
  const m = /^'(.+)'!\$([A-Z]+)\$(\d+):\$[A-Z]+\$(\d+)$/.exec(ref);
  expect(m, `ссылка списка неразборчива: ${ref}`).toBeTruthy();
  const [, source, letter, from, to] = m!;
  const values = wb.worksheets.find((w) => w.name === source)!;
  const out: string[] = [];
  for (let r = Number(from); r <= Number(to); r += 1) {
    out.push(String(values.getCell(`${letter}${r}`).value ?? ""));
  }
  return out;
}

describe("шаблон книги — проверка ввода", () => {
  it("перечислимые колонки получают выпадающий список", async () => {
    const wb = await buildWorkbookTemplate();

    expect(choicesBehind(wb, "Вопросы", "Тип вопроса")).toEqual(QUESTION_TYPE_CHOICES);
    expect(choicesBehind(wb, "Вопросы", "Следование вариантов ответов")).toEqual(SHUFFLE_CHOICES);
    expect(choicesBehind(wb, "Вопросы", "Режим ОС")).toEqual(FEEDBACK_MODE_CHOICES);
    expect(choicesBehind(wb, "Структура", "Тип порога")).toEqual(STRUCTURE_PASS_TYPE_CHOICES);
    expect(choicesBehind(wb, "Структура", "Обязательный")).toEqual(BOOL_CHOICES);
    expect(choicesBehind(wb, "Структура", "Выдавать все вопросы темы")).toEqual(BOOL_CHOICES);
    expect(choicesBehind(wb, "Структура", "Доступность раздела")).toEqual(UNLOCK_MODE_CHOICES);
    expect(choicesBehind(wb, "Квоты", "Режим")).toEqual(QUOTA_MODE_CHOICES);
    expect(choicesBehind(wb, "Пороги вариантов", "Тип порога")).toEqual(PASS_TYPE_CHOICES);
    expect(choicesBehind(wb, "Шкалы", "Тип")).toEqual(SCALE_TYPE_CHOICES);
    expect(choicesBehind(wb, "Показатели", "Управляет статусом")).toEqual(CONTROLS_CHOICES);
    expect(choicesBehind(wb, "Вклады вопросов", "Источник")).toEqual(MEASUREMENT_SOURCE_CHOICES);
    expect(choicesBehind(wb, "Обратная связь", "Кому")).toEqual(OWNER_CHOICES);
    expect(choicesBehind(wb, "Обратная связь", "Формат")).toEqual(FEEDBACK_FORMAT_CHOICES);
    expect(choicesBehind(wb, "Рекомендации", "Кому")).toEqual(OWNER_CHOICES);
    expect(choicesBehind(wb, "Рекомендации", "Тип")).toEqual(RECOMMENDATION_TYPE_CHOICES);
    // Адрес страницы набирается на ДВУХ листах и должен совпасть побуквенно, поэтому
    // закрытые колонки адреса получают список на обоих.
    expect(choicesBehind(wb, "Страницы", "Зона")).toEqual(PAGE_ZONE_CHOICES);
    expect(choicesBehind(wb, "Страницы", "Вид")).toEqual(PAGE_KIND_CHOICES);
    expect(choicesBehind(wb, "Страницы", "Режим")).toEqual(PAGE_MODE_CHOICES);
    expect(choicesBehind(wb, "Страницы", "Автопереход")).toEqual(BOOL_CHOICES);
    expect(choicesBehind(wb, "Поля страниц", "Зона")).toEqual(PAGE_ZONE_CHOICES);
    expect(choicesBehind(wb, "Поля страниц", "Вид")).toEqual(PAGE_KIND_CHOICES);
    expect(choicesBehind(wb, "Поля страниц", "Куда")).toEqual(PAGE_TARGET_CHOICES);
  });

  // Excel не открывает книгу, где подсказка проверки длиннее 255 символов, а текст
  // ошибки — 225: файл идёт «на восстановление», и восстановление вырезает сами
  // проверки. Колонка «Параметр» перечисляет 38 имён, поэтому граница не теоретическая.
  it("подсказки проверок укладываются в ограничения Excel", async () => {
    const wb = await buildWorkbookTemplate();
    const long: string[] = [];
    for (const name of ROLE_SHEET_NAMES) {
      const ws = wb.worksheets.find((w) => w.name === name)!;
      headersOf(ws).forEach((column, i) => {
        const dv = ws.getCell(2, i + 1).dataValidation as
          | { promptTitle?: string; prompt?: string; errorTitle?: string; error?: string }
          | undefined;
        if (!dv) return;
        if ((dv.prompt ?? "").length > 255) long.push(`${name}/${column}: подсказка`);
        if ((dv.error ?? "").length > 225) long.push(`${name}/${column}: текст ошибки`);
        if ((dv.promptTitle ?? "").length > 32) long.push(`${name}/${column}: заголовок подсказки`);
        if ((dv.errorTitle ?? "").length > 32) long.push(`${name}/${column}: заголовок ошибки`);
      });
    }
    expect(long).toEqual([]);
  });

  it("лист-источник списков скрыт и не является ролевым", async () => {
    const wb = await buildWorkbookTemplate();
    const ws = wb.worksheets.find((w) => w.name === CHOICES_SHEET)!;

    expect(ws, "листа со списками нет").toBeTruthy();
    expect(ws.state).toBe("hidden");
    // Иначе импортёр попытался бы прочитать его как данные.
    expect(ROLE_SHEET_NAMES).not.toContain(CHOICES_SHEET);
  });

  it("проверка покрывает не только первую строку", async () => {
    const wb = await buildWorkbookTemplate();
    const ws = wb.worksheets.find((w) => w.name === "Квоты")!;
    const column = headersOf(ws).indexOf("Режим") + 1;

    for (const row of [2, 50, 400]) {
      const dv = ws.getCell(row, column).dataValidation as { type?: string } | undefined;
      expect(dv?.type, `строка ${row} осталась без проверки`).toBe("list");
    }
  });

  // Главное свойство: список не должен предлагать то, что загрузка не примет.
  // Проверяется настоящими разборщиками, а не повторением тех же констант.
  it("каждое предлагаемое значение принимается разборщиком", async () => {
    const wb = await buildWorkbookTemplate();

    for (const value of choicesBehind(wb, "Структура", "Тип порога")) {
      const row = { "Раздел": "Финансы", "Вопросов в выборке": 3, "Тип порога": value, "Порог": 50 };
      expect(parseStructureRow(row, 0).ok, `«Тип порога» = «${value}»`).toBe(true);
    }

    // Три длинные фразы: список обязан предлагать ровно то написание, которое
    // разборщик узнаёт, иначе строка отвергается целиком.
    for (const value of choicesBehind(wb, "Структура", "Доступность раздела")) {
      const row = {
        "Раздел": "Финансы", "Вопросов в выборке": 3, "Тип порога": "Нет",
        "Доступность раздела": value, "Зависит от разделов": "Право",
      };
      expect(parseStructureRow(row, 0).ok, `«Доступность раздела» = «${value}»`).toBe(true);
    }

    for (const value of choicesBehind(wb, "Квоты", "Режим")) {
      const row = { "Раздел": "Финансы", "Тег": "базовый", "Количество": 2, "Режим": value };
      expect(parseQuotaRow(row).ok, `«Режим» = «${value}»`).toBe(true);
    }

    for (const value of choicesBehind(wb, "Пороги вариантов", "Тип порога")) {
      const row = { "Раздел": "Финансы", "Вариант": 1, "Тип порога": value, "Порог": 1 };
      expect(parseVariantThresholdRow(row).ok, `«Тип порога» = «${value}»`).toBe(true);
    }

    for (const value of choicesBehind(wb, "Вклады вопросов", "Источник")) {
      const row = { "Вопрос": "q1", "Шкала": "finlit", "Источник": value, "Ключ источника": "0", "Значение": 1 };
      expect(parseMeasurementRow(row).ok, `«Источник» = «${value}»`).toBe(true);
    }

    // У шкал и показателей разборщик пропускает значение как есть, а сужает его
    // уже enum схемы — поэтому сверяем список именно с ним.
    expect(choicesBehind(wb, "Шкалы", "Агрегация")).toEqual([...scales.aggregation.enumValues]);
    expect(choicesBehind(wb, "Шкалы", "SCORM")).toEqual([...scales.scormTarget.enumValues]);
    expect(choicesBehind(wb, "Показатели", "Тип")).toEqual([...resultVariables.type.enumValues]);
    expect(choicesBehind(wb, "Показатели", "SCORM")).toEqual([...resultVariables.scormTarget.enumValues]);

    // Оба листа обратной связи: значение из списка обязано быть принято разборщиком —
    // «Кому» опознаёт владельца, «Формат» и «Тип» отвергают строку целиком.
    for (const level of choicesBehind(wb, "Обратная связь", "Кому")) {
      const isTest = level === "Тест";
      for (const format of choicesBehind(wb, "Обратная связь", "Формат")) {
        const parsed = parseFeedbackSheets(
          [{ "Кому": level, "Раздел": isTest ? "" : "Финансы", "Формат": format, "Текст": "ОС" }],
          [],
        );
        expect(parsed.errors, `«${level}» / «${format}»`).toEqual([]);
      }
    }
    for (const type of choicesBehind(wb, "Рекомендации", "Тип")) {
      const parsed = parseFeedbackSheets(
        [{ "Кому": "Тест", "Раздел": "", "Формат": "Простой", "Текст": "ОС" }],
        [{ "Кому": "Тест", "Раздел": "", "Тип": type, "Заголовок": "Материал", "Ссылка": "https://a.test" }],
      );
      expect(parsed.errors, `«Тип» = «${type}»`).toEqual([]);
    }

    // Страницы: значение из любого списка обязано читаться разборщиком листов. «Зона»
    // проверяется двумя прогонами — с разделом и без: какие зоны требуют раздела, знает
    // сам разборщик, и повторять это знание здесь значило бы разойтись с ним.
    for (const zone of choicesBehind(wb, "Страницы", "Зона")) {
      const row = (topic: string) => ({
        "Зона": zone, "Раздел": topic, "Вид": "Авторская", "Номер": 1,
        "Вариант": "info.text-lead", "Режим": "Шаблон", "Автопереход": "нет", "Задержка, мс": "",
      });
      const clean = [row("Финансы"), row("")].filter((r) => parsePageSheets([r], []).errors.length === 0);
      expect(clean, `«Зона» = «${zone}» должна читаться ровно в одном из двух видов`).toHaveLength(1);
    }
    for (const kind of choicesBehind(wb, "Страницы", "Вид")) {
      for (const mode of choicesBehind(wb, "Страницы", "Режим")) {
        for (const auto of choicesBehind(wb, "Страницы", "Автопереход")) {
          const parsed = parsePageSheets(
            [{
              "Зона": "После теста", "Раздел": "", "Вид": kind, "Номер": 1,
              "Вариант": "info.text-lead", "Режим": mode, "Автопереход": auto, "Задержка, мс": "",
            }],
            [],
          );
          expect(parsed.errors, `«${kind}» / «${mode}» / «${auto}»`).toEqual([]);
        }
      }
    }
    for (const target of choicesBehind(wb, "Поля страниц", "Куда")) {
      const parsed = parsePageSheets(
        [{ "Зона": "После теста", "Раздел": "", "Вид": "Авторская", "Номер": 1 }],
        [{
          "Зона": "После теста", "Раздел": "", "Вид": "Авторская", "Номер": 1,
          "Куда": target, "Ключ": "title", "Значение": "Текст",
        }],
      );
      expect(parsed.errors, `«Куда» = «${target}»`).toEqual([]);
    }

    // «да»/«нет» — то, что пишет экспорт и читает parseBool.
    expect(choicesBehind(wb, "Структура", "Обязательный")).toEqual([serBool(true), serBool(false)]);
    expect(parseBool(choicesBehind(wb, "Структура", "Обязательный")[0])).toBe(true);
    expect(parseBool(choicesBehind(wb, "Структура", "Обязательный")[1])).toBe(false);
  });
});

// ─── оформление ───────────────────────────────────────────────────────────────

describe("шаблон книги — оформление", () => {
  it("на листе «Пример» каждый блок оформлен как таблица", async () => {
    const wb = await buildWorkbookTemplate();
    const ws = wb.worksheets.find((w) => w.name === EXAMPLE_SHEET)!;

    // Строка заголовков блока «Вопросы» — по его первой колонке.
    let headerRow = 0;
    ws.eachRow((row, n) => {
      if (!headerRow && String(row.getCell(1).value ?? "") === "Ключ строки") headerRow = n;
    });
    expect(headerRow, "не найдена строка заголовков блока").toBeGreaterThan(0);

    const header = ws.getRow(headerRow).getCell(1);
    expect(header.font?.bold, "заголовок блока не выделен").toBe(true);
    expect((header.fill as ExcelJS.FillPattern)?.fgColor?.argb, "заголовок без заливки").toBeTruthy();
    expect(header.border?.bottom, "заголовок без рамки").toBeTruthy();

    const data = ws.getRow(headerRow + 1).getCell(1);
    expect(data.border?.top, "строка данных без рамки").toBeTruthy();
    expect(data.alignment?.wrapText, "длинный текст должен переноситься").toBe(true);

    // Подпись блока — строкой выше заголовков, отдельным начертанием.
    expect(ws.getRow(headerRow - 1).getCell(1).font?.bold).toBe(true);
  });

  it("на ролевых листах строка заголовков выделена и закреплена", async () => {
    const wb = await buildWorkbookTemplate();
    for (const name of ROLE_SHEET_NAMES) {
      const ws = wb.worksheets.find((w) => w.name === name)!;
      expect(ws.getRow(1).font?.bold, `«${name}»: заголовок не выделен`).toBe(true);
      expect(ws.views?.[0]?.state, `«${name}»: заголовок не закреплён`).toBe("frozen");
    }
  });
});
