/**
 * @module tests/workbook-import-allocation
 *
 * PRD-44 on the import book: the allocation question type across the three sheets that
 * describe it.
 *
 * «Вопросы» carries the statements in the ordinary options column plus three new ones —
 * «Бюджет распределения», «Минимум на вариант», «Максимум на вариант». The correct-answer
 * column must stay EMPTY: the method has no reference distribution at all, so a filled
 * cell is an author's mistake worth a row error rather than a silently ignored value.
 *
 * «Вклады вопросов» gains the source `распределение`, whose key is the statement index —
 * the same encoding `вариант` uses, because the statements live in the same list.
 *
 * «Оценка» treats the type the way it treats a measurement scale: values are stored but
 * warned about, since a budget question never earns points.
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
  id: "t1", name: "Лидерство", description: null, folderId: null,
  ownerId: null, visibility: "shared", createdAt: new Date(),
};

/** Four statements of one block of the reference questionnaire. */
const STATEMENTS = [
  "Разберу вместе с ним первую рабочую задачу",
  "Познакомлю с командой",
  "Дам чёткий регламент",
  "Расскажу, ради чего мы это делаем",
].join("#");

const allocationRow = (over: Record<string, unknown> = {}) => ({
  "Ключ строки": "q1",
  "Тема": "Лидерство",
  "Тип вопроса": "allocation",
  "Текст вопроса": "Как вы распределите своё внимание?",
  "Тексты вариантов ответа": STATEMENTS,
  "Номера правильных ответов": "",
  "Бюджет распределения": 7,
  ...over,
});

const SCALES = [
  { "Ключ": "cel", "Название": "Целеустремленный", "Тип": "number", "Агрегация": "sum" },
  { "Ключ": "vdo", "Название": "Вдохновляющий", "Тип": "number", "Агрегация": "sum" },
];

function book(sheets: Record<string, Record<string, unknown>[]>): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    if (rows.length) addJsonSheet(wb, name, rows);
  }
  return wb;
}

const run = (sheets: Record<string, Record<string, unknown>[]>) =>
  importWorkbook("test-1", book(sheets), { dryRun: false });

/** The `dataJson` the importer stored for the single created question. */
const storedData = () => (storageMock.createQuestion.mock.calls[0][0] as any).dataJson;

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getTopics.mockResolvedValue([TOPIC]);
  storageMock.getContentHashesByTopic.mockResolvedValue(new Set());
  storageMock.getQuestionsByTopic.mockResolvedValue([]);
  // Уникальный id на каждый созданный вопрос: с общим id все вклады книги
  // сходились бы на одном вопросе, и приёмка ЧИЛ «проходила» бы вхолостую.
  let created = 0;
  storageMock.createQuestion.mockImplementation(async (q: any) => ({ id: `q-new-${++created}`, ...q }));
  storageMock.getScales.mockResolvedValue([]);
  storageMock.createScale.mockImplementation(async (s: any) => ({ id: `scale-${s.key}`, ...s }));
  storageMock.getResultVariables.mockResolvedValue([]);
  storageMock.validateResultVariableFormula.mockResolvedValue({ valid: true });
  storageMock.upsertQuestionMeasurements.mockResolvedValue([]);
  storageMock.replaceTestQuestionScoring.mockResolvedValue([]);
  storageMock.getTest.mockResolvedValue({ id: "test-1", title: "Опросник ЧИЛ", status: "draft" });
});

describe("«Вопросы» — тип и бюджет (FR-37, FR-38)", () => {
  it("импортирует вопрос-распределение с бюджетом", async () => {
    const res = await run({ "Вопросы": [allocationRow()] });
    expect(res.errors).toEqual([]);
    const created = storageMock.createQuestion.mock.calls[0][0] as any;
    expect(created.type).toBe("allocation");
    expect(created.correctJson).toEqual({});
    expect(storedData()).toEqual({
      options: [
        "Разберу вместе с ним первую рабочую задачу",
        "Познакомлю с командой",
        "Дам чёткий регламент",
        "Расскажу, ради чего мы это делаем",
      ],
      budget: 7,
      minPerOption: 0,
      maxPerOption: 7,
    });
  });

  it("пустые «Минимум» и «Максимум» означают умолчания (FR-38)", async () => {
    await run({ "Вопросы": [allocationRow({ "Минимум на вариант": "", "Максимум на вариант": "" })] });
    expect(storedData()).toMatchObject({ minPerOption: 0, maxPerOption: 7 });
  });

  it("заполненные «Минимум» и «Максимум» доезжают", async () => {
    await run({ "Вопросы": [allocationRow({ "Минимум на вариант": 1, "Максимум на вариант": 4 })] });
    expect(storedData()).toMatchObject({ minPerOption: 1, maxPerOption: 4 });
  });

  it("без бюджета строка отвергается", async () => {
    const res = await run({ "Вопросы": [allocationRow({ "Бюджет распределения": "" })] });
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toMatch(/бюджет/i);
  });

  it("невыполнимая конфигурация отвергается С ЧИСЛАМИ (FR-40)", async () => {
    // Референсный случай: 4 утверждения по минимуму 2 при бюджете 7 требуют 8 из 7.
    const res = await run({ "Вопросы": [allocationRow({ "Минимум на вариант": 2 })] });
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toContain("8");
    expect(res.errors[0]).toContain("7");
  });

  it("максимумы, не закрывающие бюджет, отвергаются", async () => {
    const res = await run({ "Вопросы": [allocationRow({ "Максимум на вариант": 1 })] });
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toMatch(/распределени/i);
  });

  it("заполненная колонка правильных ответов — ошибка строки (FR-39)", async () => {
    const res = await run({ "Вопросы": [allocationRow({ "Номера правильных ответов": "1" })] });
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toMatch(/правильн/i);
  });

  it("меньше двух утверждений — ошибка", async () => {
    const res = await run({ "Вопросы": [allocationRow({ "Тексты вариантов ответа": "Одно" })] });
    expect(res.errors).toHaveLength(1);
  });

  it("колонки бюджета у ДРУГОГО типа — предупреждение, а не ошибка (FR-38)", async () => {
    const res = await run({
      "Вопросы": [{
        "Ключ строки": "q2",
        "Тема": "Лидерство",
        "Тип вопроса": "single",
        "Текст вопроса": "Обычный вопрос",
        "Тексты вариантов ответа": "А#Б",
        "Номера правильных ответов": "1",
        "Бюджет распределения": 7,
      }],
    });
    expect(res.errors).toEqual([]);
    expect(res.warnings.some((w: string) => /бюджет/i.test(w))).toBe(true);
  });
});

describe("«Вклады вопросов» — источник «распределение» (FR-41)", () => {
  const contribution = (index: number, scale: string, over: Record<string, unknown> = {}) => ({
    "Вопрос": "q1",
    "Шкала": scale,
    "Источник": "распределение",
    "Ключ источника": String(index),
    "Значение": 1,
    "Вес": 1,
    ...over,
  });

  it("принимает вклад распределения с ключом-индексом утверждения", async () => {
    const res = await run({
      "Вопросы": [allocationRow()],
      "Шкалы": SCALES,
      "Вклады вопросов": [contribution(0, "cel"), contribution(1, "vdo")],
    });
    expect(res.errors).toEqual([]);
    expect(res.measurements).toEqual({ rows: 2, questions: 1 });
    const written = storageMock.upsertQuestionMeasurements.mock.calls[0];
    const specs = written[written.length - 1] as any[];
    expect(specs.map((m) => m.sourceType)).toEqual(["option_allocation", "option_allocation"]);
    expect(specs.map((m) => m.sourceKey)).toEqual(["0", "1"]);
  });

  it("ключ проверяется по числу утверждений", async () => {
    const res = await run({
      "Вопросы": [allocationRow()],
      "Шкалы": SCALES,
      "Вклады вопросов": [contribution(4, "cel")],
    });
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toContain("Вклады вопросов");
  });

  it("пустые «Значение» и «Вес» дают коэффициент 1 (FR-14)", async () => {
    const res = await run({
      "Вопросы": [allocationRow()],
      "Шкалы": SCALES,
      "Вклады вопросов": [contribution(0, "cel", { "Значение": "", "Вес": "" })],
    });
    expect(res.errors).toEqual([]);
    const written = storageMock.upsertQuestionMeasurements.mock.calls[0];
    const specs = written[written.length - 1] as any[];
    expect(specs[0].valueJson).toBe(1);
    expect(specs[0].weight).toBe(1);
  });
});

describe("приёмка A-03: опросник ЧИЛ собирается книгой целиком (FR-43)", () => {
  const BLOCKS = 14;
  const STYLES = ["cel", "vdo", "kom", "pro"];

  /** 14 блоков по 4 утверждения, бюджет 7 — форма референсного опросника. */
  const chilQuestions = () =>
    Array.from({ length: BLOCKS }, (_, i) => ({
      "Ключ строки": `b${i + 1}`,
      "Тема": "Лидерство",
      "Тип вопроса": "allocation",
      "Текст вопроса": `Рабочая ситуация ${i + 1}`,
      "Тексты вариантов ответа": ["Целеустремлённо", "Вдохновляюще", "Командно", "Процессно"].join("#"),
      "Номера правильных ответов": "",
      "Бюджет распределения": 7,
      "Минимум на вариант": "",
      "Максимум на вариант": "",
    }));

  /** 56 строк вкладов: утверждение i каждого блока питает стиль i коэффициентом 1. */
  const chilContributions = () =>
    Array.from({ length: BLOCKS }, (_, b) =>
      STYLES.map((key, i) => ({
        "Вопрос": `b${b + 1}`,
        "Шкала": key,
        "Источник": "распределение",
        "Ключ источника": String(i),
        "Значение": 1,
        "Вес": 1,
      })),
    ).flat();

  const chilScales = () =>
    STYLES.map((key) => ({ "Ключ": key, "Название": key, "Тип": "number", "Агрегация": "sum" }));

  it("14 вопросов, четыре шкалы и 56 вкладов импортируются без ошибок", async () => {
    const res = await run({
      "Вопросы": chilQuestions(),
      "Шкалы": chilScales(),
      "Вклады вопросов": chilContributions(),
    });
    expect(res.errors).toEqual([]);
    expect(res.questions.created).toBe(BLOCKS);
    expect(res.scales.created).toBe(STYLES.length);
    expect(res.measurements).toEqual({ rows: BLOCKS * STYLES.length, questions: BLOCKS });
  });

  it("каждый блок сохранён с бюджетом 7 и четырьмя утверждениями", async () => {
    await run({
      "Вопросы": chilQuestions(),
      "Шкалы": chilScales(),
      "Вклады вопросов": chilContributions(),
    });
    expect(storageMock.createQuestion).toHaveBeenCalledTimes(BLOCKS);
    for (const call of storageMock.createQuestion.mock.calls) {
      const q = call[0] as any;
      expect(q.type).toBe("allocation");
      expect(q.dataJson).toMatchObject({ budget: 7, minPerOption: 0, maxPerOption: 7 });
      expect(q.dataJson.options).toHaveLength(4);
    }
  });
});

describe("«Оценка» — цена на измерительном типе (FR-10)", () => {
  it("предупреждает, но значения сохраняет", async () => {
    const res = await run({
      "Вопросы": [allocationRow()],
      "Оценка": [{ "Вопрос": "q1", "Балл": 5 }],
    });
    expect(res.errors).toEqual([]);
    expect(res.warnings.length).toBeGreaterThan(0);
    const rows = storageMock.replaceTestQuestionScoring.mock.calls[0][1] as any[];
    expect(rows[0].points).toBe(5);
  });
});
