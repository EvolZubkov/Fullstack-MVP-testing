/**
 * @module tests/routes.tests-workbook-question-order
 *
 * PRD-30 Э6 end-to-end through the workbook import route: both new columns have
 * to travel from the file into the storage payloads.
 *
 * The parser unit tests (tests/workbook-question-order) prove the cells are read
 * correctly; these prove the values are actually HANDED OVER — a field the
 * import orchestrator forgets to copy is the quiet failure mode here (the import
 * reports success, the setting never lands).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";
import ExcelJS from "exceljs";

vi.hoisted(() => { process.env.DATABASE_URL = "postgresql://fake/test"; });

const { storageMock, testSettingsMock } = vi.hoisted(() => ({
  testSettingsMock: { save: vi.fn(), create: vi.fn() },
  storageMock: {
    getTest: vi.fn(), getTestSections: vi.fn().mockResolvedValue([]),
    getTopics: vi.fn(), getTopic: vi.fn(),
    getQuestionsByTopic: vi.fn().mockResolvedValue([]),
    getContentHashesByTopic: vi.fn().mockResolvedValue(new Set()),
    createQuestion: vi.fn().mockResolvedValue({ id: "newq-1" }),
    updateQuestion: vi.fn().mockResolvedValue({ id: "q1" }),
    getUser: vi.fn(), getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    getScales: vi.fn().mockResolvedValue([]),
    getResultVariables: vi.fn().mockResolvedValue([]),
    getQuestionMeasurements: vi.fn().mockResolvedValue([]),
    upsertQuestionMeasurements: vi.fn().mockResolvedValue([]),
    getTestQuestionScoring: vi.fn().mockResolvedValue([]),
    replaceTestQuestionScoring: vi.fn().mockResolvedValue([]),
    getSharedTopicIds: vi.fn().mockResolvedValue([]),
    getTopicIdsByOwner: vi.fn().mockResolvedValue([]),
    getActiveTopicGrantsForGrantees: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/db", () => ({ db: {} }));
vi.mock("../server/services/test-settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/services/test-settings")>();
  return { ...actual, testSettingsService: testSettingsMock };
});

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import testsWorkbookRouter from "../server/routes/tests-workbook";

const authorUser = {
  id: "author1", email: "a@test.com", name: "Author", role: "author",
  status: "active", mustChangePassword: false, gdprConsent: true,
  passwordHash: "x", emailHash: "x", createdAt: new Date(), lastLoginAt: null, createdBy: null,
};
const baseTest = {
  id: "test-1", title: "T", mode: "standard", status: "draft", version: 1,
  ownerId: "author1", createdAt: new Date(),
};
const dbTopic = {
  id: "t1", name: "JavaScript", description: null, folderId: null,
  ownerId: "author1", visibility: "shared", createdAt: new Date(),
};
const questionRow = {
  "Ключ строки": "q1",
  "Тема": "JavaScript",
  "Тип вопроса": "multiple_choice",
  "Текст вопроса": "2+2?",
  "Тексты вариантов ответа": "3#4#5",
  "Номера правильных ответов": "2",
};

async function makeWorkbook(sheets: Record<string, Record<string, unknown>[]>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    if (rows.length === 0) continue;
    const ws = wb.addWorksheet(name);
    const headers = Object.keys(rows[0]);
    ws.addRow(headers);
    for (const row of rows) ws.addRow(headers.map((h) => row[h] ?? ""));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    req.session.userId = "author1";
    next();
  });
  app.use("/api/tests", testsWorkbookRouter);
  return app;
}

const postWorkbook = (buf: Buffer) =>
  request(makeApp()).post("/api/tests/test-1/workbook/import").attach("file", buf, "wb.xlsx");

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getTest.mockResolvedValue(baseTest);
  storageMock.getUser.mockResolvedValue(authorUser);
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getTopics.mockResolvedValue([dbTopic]);
  storageMock.getTopic.mockResolvedValue(dbTopic);
  storageMock.getContentHashesByTopic.mockResolvedValue(new Set());
  storageMock.getQuestionsByTopic.mockResolvedValue([]);
  storageMock.createQuestion.mockResolvedValue({ id: "newq-1" });
  testSettingsMock.save.mockResolvedValue({ id: "test-1" });
});

/** The single section the import handed to the storage layer. */
const savedSection = () => testSettingsMock.save.mock.calls[0][1].sections[0];

describe("import «Структура» → «Случайный порядок вопросов» (PRD-30 FR-15)", () => {
  const structureRow = (over: Record<string, unknown> = {}) => ({
    "Раздел": "JavaScript",
    "Порядок": "1",
    "Вопросов в выборке": "3",
    "Тип порога": "",
    "Порог": "",
    "Обязательный": "да",
    ...over,
  });

  it("«нет» сохраняется как fixed", async () => {
    const buf = await makeWorkbook({
      "Вопросы": [questionRow],
      "Структура": [structureRow({ "Случайный порядок вопросов": "нет" })],
    });

    const res = await postWorkbook(buf);

    expect(res.body.errors).toEqual([]);
    expect(savedSection()).toMatchObject({ questionOrder: "fixed" });
  });

  it("«да» сохраняется как random", async () => {
    const buf = await makeWorkbook({
      "Вопросы": [questionRow],
      "Структура": [structureRow({ "Случайный порядок вопросов": "да" })],
    });

    await postWorkbook(buf);

    expect(savedSection()).toMatchObject({ questionOrder: "random" });
  });

  it("книга без колонки импортируется как раньше — тема наследует тест", async () => {
    const buf = await makeWorkbook({
      "Вопросы": [questionRow],
      "Структура": [structureRow()],
    });

    const res = await postWorkbook(buf);

    expect(res.body.errors).toEqual([]);
    expect(savedSection()).toMatchObject({ questionOrder: null });
  });
});

describe("import «Вопросы» → «Индекс в теме» (PRD-30 FR-15)", () => {
  it("индекс доходит до создаваемого вопроса", async () => {
    const buf = await makeWorkbook({
      "Вопросы": [{ ...questionRow, "Индекс в теме": "20" }],
    });

    const res = await postWorkbook(buf);

    expect(res.body.errors).toEqual([]);
    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ orderIndex: 20 }),
    );
  });

  it("ноль сохраняется как ноль, а не как «не задано»", async () => {
    const buf = await makeWorkbook({
      "Вопросы": [{ ...questionRow, "Индекс в теме": "0" }],
    });

    await postWorkbook(buf);

    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ orderIndex: 0 }),
    );
  });

  it("пустая ячейка = «не задано» (null)", async () => {
    const buf = await makeWorkbook({
      "Вопросы": [{ ...questionRow, "Индекс в теме": "" }],
    });

    await postWorkbook(buf);

    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ orderIndex: null }),
    );
  });

  it("нецелое значение — ошибка строки, вопрос не создаётся", async () => {
    const buf = await makeWorkbook({
      "Вопросы": [{ ...questionRow, "Индекс в теме": "два с половиной" }],
    });

    const res = await postWorkbook(buf);

    expect(res.body.errors.join(" ")).toContain("Индекс в теме");
    expect(storageMock.createQuestion).not.toHaveBeenCalled();
  });
});

/**
 * PRD-30 FR-22: the test-wide rule travels on its OWN sheet — «Настройки», a
 * key/value list. The book had no place for settings of the test itself, so the
 * sheet is new; a book exported before it must keep importing unchanged.
 */
describe("import «Настройки» → правило теста (PRD-30 FR-22)", () => {
  const structureRow = {
    "Раздел": "JavaScript",
    "Порядок": "1",
    "Вопросов в выборке": "3",
    "Тип порога": "",
    "Порог": "",
    "Обязательный": "да",
    "Случайный порядок вопросов": "",
  };
  /** The test-level payload the import handed to the storage layer. */
  const savedTest = () => testSettingsMock.save.mock.calls[0][1].test;

  it("«Полное перемешивание» доезжает до теста", async () => {
    const buf = await makeWorkbook({
      "Настройки": [{ "Параметр": "Порядок выдачи вопросов", "Значение": "Полное перемешивание" }],
      "Вопросы": [questionRow],
      "Структура": [structureRow],
    });

    const res = await postWorkbook(buf);

    expect(res.body.errors).toEqual([]);
    expect(savedTest()).toMatchObject({ questionOrder: "shuffle_all" });
  });

  it("«Фиксированный порядок» доезжает до теста", async () => {
    const buf = await makeWorkbook({
      "Настройки": [{ "Параметр": "Порядок выдачи вопросов", "Значение": "Фиксированный порядок" }],
      "Вопросы": [questionRow],
      "Структура": [structureRow],
    });

    await postWorkbook(buf);

    expect(savedTest()).toMatchObject({ questionOrder: "fixed" });
  });

  it("книга без листа «Настройки» ничего не меняет в тесте", async () => {
    const buf = await makeWorkbook({ "Вопросы": [questionRow], "Структура": [structureRow] });

    await postWorkbook(buf);

    expect(savedTest()).not.toHaveProperty("questionOrder");
  });

  it("пустое значение не сбрасывает настройку теста", async () => {
    const buf = await makeWorkbook({
      "Настройки": [{ "Параметр": "Порядок выдачи вопросов", "Значение": "" }],
      "Вопросы": [questionRow],
      "Структура": [structureRow],
    });

    await postWorkbook(buf);

    expect(savedTest()).not.toHaveProperty("questionOrder");
  });

  it("непонятное значение — ошибка импорта с адресом строки", async () => {
    const buf = await makeWorkbook({
      "Настройки": [{ "Параметр": "Порядок выдачи вопросов", "Значение": "как-нибудь" }],
      "Вопросы": [questionRow],
      "Структура": [structureRow],
    });

    const res = await postWorkbook(buf);

    expect(res.body.errors.join(" ")).toMatch(/Лист «Настройки», строка 2/);
  });

  it("книга ТОЛЬКО с настройками сохраняет их без разделов", async () => {
    const buf = await makeWorkbook({
      "Настройки": [{ "Параметр": "Порядок выдачи вопросов", "Значение": "Перемешивание" }],
    });

    const res = await postWorkbook(buf);

    expect(res.body.errors).toEqual([]);
    expect(testSettingsMock.save).toHaveBeenCalledTimes(1);
    expect(testSettingsMock.save.mock.calls[0][1].sections).toBeUndefined();
    expect(savedTest()).toMatchObject({ questionOrder: "random" });
  });
});
