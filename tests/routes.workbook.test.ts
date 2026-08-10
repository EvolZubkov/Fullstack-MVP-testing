/**
 * @module tests/routes.workbook
 * @description Integration tests for the PRD-14 FR-15 «Импорт» section endpoints
 * (POST /api/workbook/inspect, POST /api/workbook/import-new, GET
 * /api/workbook/template): sheet detection without a testId, new-test creation
 * on import, dry-run against an empty target, and the template download.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";
import ExcelJS from "exceljs";
import { addJsonSheet, workbookToBuffer, readWorkbookFromBuffer } from "../server/utils/excel";
import { VARIANT_THRESHOLD_HEADERS } from "../server/utils/workbook-sheets";
import { QUESTION_HEADERS } from "../server/services/questions-export";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://fake/test";
});

const { storageMock, testSettingsMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    setTestOwner: vi.fn(),
    getTest: vi.fn(),
    // questions import
    getTopics: vi.fn(),
    createTopic: vi.fn(),
    getQuestion: vi.fn(),
    createQuestion: vi.fn(),
    updateQuestion: vi.fn(),
    getContentHashesByTopic: vi.fn(),
    // scales / result vars / measurements
    getScales: vi.fn(),
    createScale: vi.fn(),
    updateScale: vi.fn(),
    getResultVariables: vi.fn(),
    createResultVariable: vi.fn(),
    updateResultVariable: vi.fn(),
    validateResultVariableFormula: vi.fn(),
    upsertQuestionMeasurements: vi.fn(),
  },
  testSettingsMock: { create: vi.fn(), save: vi.fn() },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/services/test-settings", () => ({ testSettingsService: testSettingsMock }));
vi.mock("../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import workbookRouter from "../server/routes/workbook";

const authorUser = { id: "user-1", role: "author", status: "active" };
const dbTopic = { id: "t1", name: "JavaScript", description: null, folderId: null, createdAt: new Date() };

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    req.session.userId = "user-1";
    next();
  });
  app.use("/api/workbook", workbookRouter);
  return app;
}

async function makeWorkbook(sheets: Record<string, Record<string, unknown>[]>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    if (rows.length === 0) continue;
    addJsonSheet(wb, name, rows);
  }
  return workbookToBuffer(wb);
}

const questionRow = {
  "Тема": "JavaScript",
  "Тип вопроса": "multiple_choice",
  "Текст вопроса": "2+2?",
  "Тексты вариантов ответа": "3#4#5",
  "Номера правильных ответов": "2",
};
const scaleRow = { "Ключ": "ee", "Название": "Истощение", "Тип": "number" };

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUser.mockResolvedValue(authorUser);
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getTopics.mockResolvedValue([dbTopic]);
  storageMock.getContentHashesByTopic.mockResolvedValue(new Set());
  storageMock.createQuestion.mockResolvedValue({ id: "newq-1" });
  storageMock.getScales.mockResolvedValue([]);
  storageMock.createScale.mockResolvedValue({ id: "scale-new", key: "ee" });
  storageMock.getResultVariables.mockResolvedValue([]);
  storageMock.createResultVariable.mockResolvedValue({ id: "rv-new" });
  storageMock.validateResultVariableFormula.mockResolvedValue({ valid: true });
  storageMock.upsertQuestionMeasurements.mockResolvedValue([]);
  storageMock.getTest.mockResolvedValue({ id: "test-new", title: "Новый тест", status: "draft" });
  testSettingsMock.create.mockResolvedValue({ id: "test-new", title: "Новый тест" });
  testSettingsMock.save.mockResolvedValue({ id: "test-new" });
});

describe("POST /api/workbook/inspect", () => {
  it("файл только с «Вопросами» → requiresTest=false", async () => {
    const buf = await makeWorkbook({ "Вопросы": [questionRow] });
    const res = await request(makeApp()).post("/api/workbook/inspect").attach("file", buf, "wb.xlsx");

    expect(res.status).toBe(200);
    expect(res.body.hasQuestions).toBe(true);
    expect(res.body.requiresTest).toBe(false);
    expect(res.body.counts.questions).toBe(1);
  });

  it("файл со «Шкалами» → requiresTest=true", async () => {
    const buf = await makeWorkbook({ "Вопросы": [questionRow], "Шкалы": [scaleRow] });
    const res = await request(makeApp()).post("/api/workbook/inspect").attach("file", buf, "wb.xlsx");

    expect(res.status).toBe(200);
    expect(res.body.hasScales).toBe(true);
    expect(res.body.requiresTest).toBe(true);
    expect(res.body.sheets).toEqual(expect.arrayContaining(["Вопросы", "Шкалы"]));
  });

  it("файл со «Структурой» → requiresTest=true", async () => {
    const buf = await makeWorkbook({
      "Вопросы": [questionRow],
      "Структура": [{ "Раздел": "JavaScript", "Вопросов в выборке": "5", "Тип порога": "Сумма баллов", "Порог": "4" }],
    });
    const res = await request(makeApp()).post("/api/workbook/inspect").attach("file", buf, "wb.xlsx");

    expect(res.body.hasStructure).toBe(true);
    expect(res.body.requiresTest).toBe(true);
  });

  it("без файла → 400", async () => {
    const res = await request(makeApp()).post("/api/workbook/inspect");
    expect(res.status).toBe(400);
  });
});

describe("POST /api/workbook/import-new", () => {
  it("dryRun: считает план против пустого теста, ничего не создаёт", async () => {
    const buf = await makeWorkbook({ "Вопросы": [questionRow], "Шкалы": [scaleRow] });
    const res = await request(makeApp())
      .post("/api/workbook/import-new?dryRun=true")
      .field("newTestTitle", "Стресс-опросник")
      .attach("file", buf, "wb.xlsx");

    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.test).toEqual({ id: null, title: "Стресс-опросник" });
    expect(res.body.questions.created).toBe(1);
    expect(res.body.scales.created).toBe(1);
    expect(testSettingsMock.create).not.toHaveBeenCalled();
    expect(storageMock.createQuestion).not.toHaveBeenCalled();
    expect(storageMock.createScale).not.toHaveBeenCalled();
  });

  it("реальный импорт: создаёт бессекционный черновик и пишет в него", async () => {
    const buf = await makeWorkbook({ "Вопросы": [questionRow], "Шкалы": [scaleRow] });
    const res = await request(makeApp())
      .post("/api/workbook/import-new")
      .field("newTestTitle", "Новый тест")
      .attach("file", buf, "wb.xlsx");

    expect(res.status).toBe(201);
    expect(res.body.test).toEqual({ id: "test-new", title: "Новый тест" });
    expect(testSettingsMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ test: expect.objectContaining({ title: "Новый тест" }), sections: [] }),
    );
    expect(storageMock.setTestOwner).toHaveBeenCalledWith("test-new", "user-1");
    expect(storageMock.createScale).toHaveBeenCalled();
  });

  it("со «Структурой»: создаёт тест и применяет разделы (router_by_topics)", async () => {
    const buf = await makeWorkbook({
      "Вопросы": [questionRow],
      "Структура": [
        { "Раздел": "JavaScript", "Порядок": "1", "Вопросов в выборке": "5", "Тип порога": "Сумма баллов", "Порог": "4", "Обязательный": "да" },
      ],
      "Квоты": [{ "Раздел": "JavaScript", "Тег": "basics", "Количество": "3" }],
    });
    const res = await request(makeApp())
      .post("/api/workbook/import-new")
      .field("newTestTitle", "Сертификация")
      .attach("file", buf, "wb.xlsx");

    expect(res.status).toBe(201);
    expect(res.body.structure).toEqual({ sections: 1, quotas: 1 });
    expect(testSettingsMock.save).toHaveBeenCalledWith(
      "test-new",
      expect.objectContaining({
        test: expect.objectContaining({ flowPolicyJson: { mode: "router_by_topics" } }),
        sections: [expect.objectContaining({ topicId: "t1", drawCount: 5 })],
      }),
    );
  });

  it("без названия нового теста → 400", async () => {
    const buf = await makeWorkbook({ "Шкалы": [scaleRow] });
    const res = await request(makeApp())
      .post("/api/workbook/import-new")
      .attach("file", buf, "wb.xlsx");
    expect(res.status).toBe(400);
  });
});

describe("GET /api/workbook/template", () => {
  it("отдаёт книгу с 4 листами и справкой", async () => {
    const res = await request(makeApp())
      .get("/api/workbook/template")
      .buffer(true)
      .parse((r: any, cb: any) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    const wb = await readWorkbookFromBuffer(res.body as Buffer);
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toEqual(
      expect.arrayContaining(["Вопросы", "Структура", "Квоты", "Шкалы", "Показатели", "Вклады вопросов", "Справка"]),
    );
  });

  // The template is the author's starting point: a sheet the importer reads but
  // the template omits is a feature they cannot reach without hand-crafting the
  // book. «Пороги вариантов» (PRD-24) shipped in the export and the importer and
  // was missing here.
  it("несёт ВСЕ листы, которые понимает импорт", async () => {
    const res = await request(makeApp())
      .get("/api/workbook/template")
      .buffer(true)
      .parse((r: any, cb: any) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });

    const wb = await readWorkbookFromBuffer(res.body as Buffer);
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toEqual([
      // PRD-30: правило выдачи теста; лист идёт первым, потому что относится к тесту целиком.
      "Настройки",
      "Вопросы",
      "Структура",
      "Квоты",
      "Пороги вариантов",
      "Оценка",
      "Шкалы",
      "Показатели",
      "Вклады вопросов",
      // Documentation sheets close the book; neither is a role name, so the
      // importer ignores them and the filled example can never be imported.
      "Справка",
      "Пример",
      // Hidden source of the dropdown lists — last, so the book still opens on
      // «Вопросы»; not a role name either, so the importer skips it as well.
      "Значения",
    ]);
  });

  it("заголовки «Порогов вариантов» совпадают с теми, что пишет экспорт", async () => {
    const res = await request(makeApp())
      .get("/api/workbook/template")
      .buffer(true)
      .parse((r: any, cb: any) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });

    const wb = await readWorkbookFromBuffer(res.body as Buffer);
    const sheet = wb.worksheets.find((w) => w.name === "Пороги вариантов");
    const header = (sheet?.getRow(1).values as unknown[]).slice(1);
    expect(header).toEqual(VARIANT_THRESHOLD_HEADERS);
  });

  // Variants (PRD-17) travel in a «Варианты теста» column of «Вопросы»; the
  // export writes it and the import reads it. Without it in the template the
  // author cannot assign a question to a variant — and «Пороги вариантов» has
  // nothing to threshold. The sheet additionally offers the optional per-test
  // scoring pair, which the importer accepts here (canonical place: «Оценка»).
  it("лист «Вопросы» несёт колонки экспорта, варианты теста и пару оценки", async () => {
    const res = await request(makeApp())
      .get("/api/workbook/template")
      .buffer(true)
      .parse((r: any, cb: any) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });

    const wb = await readWorkbookFromBuffer(res.body as Buffer);
    const sheet = wb.worksheets.find((w) => w.name === "Вопросы");
    const header = (sheet?.getRow(1).values as unknown[]).slice(1);
    for (const col of ["Ключ строки", ...QUESTION_HEADERS, "Варианты теста"]) {
      expect(header, `нет колонки «${col}»`).toContain(col);
    }
    expect(header).toContain("Балл");
    expect(header).toContain("Цена ответа");
  });

  it("справка объясняет новый лист и тип порога «По вариантам»", async () => {
    const res = await request(makeApp())
      .get("/api/workbook/template")
      .buffer(true)
      .parse((r: any, cb: any) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });

    const wb = await readWorkbookFromBuffer(res.body as Buffer);
    const help = wb.worksheets.find((w) => w.name === "Справка");
    const text = JSON.stringify(help?.getSheetValues());
    expect(text).toContain("Пороги вариантов");
    expect(text).toContain("По вариантам");
  });
});

// ─── Руководство по заполнению шаблона (PDF) ─────────────────────────────────
// The «Импорт» section offers the beginner guide as a PDF next to «Скачать
// шаблон». The artifact is pre-built by `npm run docs:pdf` and committed under
// `docs/dist`, so the running service serves it without needing Chrome.

describe("GET /api/workbook/docs/:doc", () => {
  it("отдаёт руководство по заполнению шаблона как PDF", async () => {
    const res = await request(makeApp())
      .get("/api/workbook/docs/guide")
      .buffer(true)
      .parse((r: any, cb: any) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toContain("attachment");
    // A real PDF, not an error page: the format's magic bytes.
    expect((res.body as Buffer).subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("неизвестный документ → 404", async () => {
    const res = await request(makeApp()).get("/api/workbook/docs/unknown");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Unknown document" });
  });
});
