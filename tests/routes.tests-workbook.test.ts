/**
 * @module tests/routes.tests-workbook
 * @description Integration tests for the PRD-14 FR-15 multi-sheet workbook import
 * (POST /api/tests/:id/workbook/import): sheet recognition, multi-pass order,
 * question alias resolution in «Вклады вопросов», upsert of scales/result variables,
 * controlsStatus guard, and dry-run (no writes).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";
import ExcelJS from "exceljs";
import { addJsonSheet, workbookToBuffer, readWorkbookFromBuffer, sheetToObjects } from "../server/utils/excel";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://fake/test";
});

const { storageMock, testSettingsMock } = vi.hoisted(() => ({
  storageMock: {
    getTest: vi.fn(),
    getUser: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    // questions
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
    // export
    getTestSections: vi.fn(),
    getQuestions: vi.fn(),
    getQuestionMeasurements: vi.fn(),
  },
  // FR-16: the structure pass applies sections via testSettingsService.save.
  testSettingsMock: { create: vi.fn(), save: vi.fn() },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/services/test-settings", () => ({ testSettingsService: testSettingsMock }));
vi.mock("../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import testsWorkbookRouter from "../server/routes/tests-workbook";

const baseTest = { id: "test-1", title: "Тест" };
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
  app.use("/api/tests", testsWorkbookRouter);
  return app;
}

/** Build a multi-sheet xlsx buffer from per-sheet row arrays. */
async function makeWorkbook(sheets: Record<string, Record<string, unknown>[]>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    if (rows.length === 0) continue;
    addJsonSheet(wb, name, rows);
  }
  return workbookToBuffer(wb);
}

function postWorkbook(buf: Buffer, query = "") {
  return request(makeApp())
    .post(`/api/tests/test-1/workbook/import${query}`)
    .attach("file", buf, "wb.xlsx");
}

const questionRow = {
  "Ключ строки": "q1",
  "Тема": "JavaScript",
  "Тип вопроса": "multiple_choice",
  "Текст вопроса": "2+2?",
  "Тексты вариантов ответа": "3#4#5",
  "Номера правильных ответов": "2",
};
const scaleRow = { "Ключ": "ee", "Название": "Истощение", "Тип": "number" };

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getTest.mockResolvedValue(baseTest);
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
  testSettingsMock.save.mockResolvedValue({ id: "test-1" });
});

describe("POST /:id/workbook/import — основной поток", () => {
  it("импортирует вопросы, шкалы и измерения; измерение резолвит вопрос по «Ключ строки»", async () => {
    const buf = await makeWorkbook({
      "Вопросы": [questionRow],
      "Шкалы": [scaleRow],
      "Вклады вопросов": [
        { "Вопрос": "q1", "Шкала": "ee", "Источник": "вариант", "Ключ источника": "1", "Значение": "3" },
      ],
    });
    const res = await postWorkbook(buf);

    expect(res.status).toBe(200);
    expect(res.body.questions.created).toBe(1);
    expect(res.body.scales.created).toBe(1);
    expect(res.body.measurements).toMatchObject({ rows: 1, questions: 1 });
    expect(res.body.errors).toEqual([]);

    // Вопрос создан, шкала создана.
    expect(storageMock.createQuestion).toHaveBeenCalled();
    expect(storageMock.createScale).toHaveBeenCalled();
    // Измерение записано для нового вопроса newq-1, шкала scale-new, option index 1.
    expect(storageMock.upsertQuestionMeasurements).toHaveBeenCalledWith(
      "test-1",
      "newq-1",
      expect.arrayContaining([
        expect.objectContaining({ scaleId: "scale-new", sourceType: "option", sourceKey: "1", valueJson: 3 }),
      ]),
    );
  });

  it("измерение резолвит вопрос по существующему ID", async () => {
    storageMock.getQuestion.mockResolvedValue({
      id: "q-existing",
      type: "single",
      dataJson: { options: ["a", "b", "c"] },
    });
    storageMock.getScales.mockResolvedValue([{ id: "scale-1", key: "ee", sortOrder: 0 }]);

    const buf = await makeWorkbook({
      "Вклады вопросов": [
        { "Вопрос": "q-existing", "Шкала": "ee", "Источник": "вариант", "Ключ источника": "0", "Значение": "5" },
      ],
    });
    const res = await postWorkbook(buf);

    expect(res.body.measurements.rows).toBe(1);
    expect(storageMock.upsertQuestionMeasurements).toHaveBeenCalledWith(
      "test-1",
      "q-existing",
      expect.any(Array),
    );
  });

  it("импортирует показатель с валидной формулой", async () => {
    const buf = await makeWorkbook({
      "Показатели": [
        { "Имя": "passed", "Метка": "Сдал", "Тип": "boolean", "Формула": "score >= 60", "Управляет статусом": "успех" },
      ],
    });
    const res = await postWorkbook(buf);

    expect(res.body.resultVariables.created).toBe(1);
    expect(storageMock.createResultVariable).toHaveBeenCalledWith(
      expect.objectContaining({ name: "passed", controlsStatus: "success", testId: "test-1" }),
    );
  });
});

describe("POST /:id/workbook/import — ошибки и валидация", () => {
  it("неизвестная шкала в «Вкладах вопросов» → ошибка строки", async () => {
    const buf = await makeWorkbook({
      "Вклады вопросов": [{ "Вопрос": "q-x", "Шкала": "missing", "Источник": "вопрос", "Значение": "1" }],
    });
    storageMock.getQuestion.mockResolvedValue({ id: "q-x", type: "single", dataJson: { options: ["a", "b"] } });
    const res = await postWorkbook(buf);

    expect(res.body.errors.length).toBe(1);
    expect(res.body.errors[0]).toMatch(/шкала/i);
    expect(storageMock.upsertQuestionMeasurements).not.toHaveBeenCalled();
  });

  it("второй показатель с тем же controlsStatus → ошибка (гард ≤1)", async () => {
    const buf = await makeWorkbook({
      "Показатели": [
        { "Имя": "a", "Метка": "A", "Тип": "boolean", "Формула": "x", "Управляет статусом": "успех" },
        { "Имя": "b", "Метка": "B", "Тип": "boolean", "Формула": "y", "Управляет статусом": "успех" },
      ],
    });
    const res = await postWorkbook(buf);

    expect(res.body.resultVariables.created).toBe(1);
    expect(res.body.errors.some((e: string) => /success|управляет/i.test(e))).toBe(true);
  });

  it("невалидная формула → ошибка строки", async () => {
    storageMock.validateResultVariableFormula.mockResolvedValue({ valid: false });
    const buf = await makeWorkbook({
      "Показатели": [{ "Имя": "x", "Метка": "X", "Тип": "number", "Формула": "???" }],
    });
    const res = await postWorkbook(buf);

    expect(res.body.resultVariables.created).toBe(0);
    expect(res.body.errors.some((e: string) => /формул/i.test(e))).toBe(true);
  });

  it("404 если тест не найден", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    const buf = await makeWorkbook({ "Шкалы": [scaleRow] });
    expect((await postWorkbook(buf)).status).toBe(404);
  });
});

describe("POST /:id/workbook/import?dryRun=true — предпросмотр", () => {
  it("считает план, но ничего не пишет", async () => {
    const buf = await makeWorkbook({
      "Вопросы": [questionRow],
      "Шкалы": [scaleRow],
      "Вклады вопросов": [
        { "Вопрос": "q1", "Шкала": "ee", "Источник": "вариант", "Ключ источника": "1", "Значение": "3" },
      ],
    });
    const res = await postWorkbook(buf, "?dryRun=true");

    expect(res.body.dryRun).toBe(true);
    expect(res.body.questions.created).toBe(1);
    expect(res.body.scales.created).toBe(1);
    expect(res.body.measurements.rows).toBe(1);
    expect(storageMock.createQuestion).not.toHaveBeenCalled();
    expect(storageMock.createScale).not.toHaveBeenCalled();
    expect(storageMock.upsertQuestionMeasurements).not.toHaveBeenCalled();
  });
});

describe("POST /:id/workbook/import — «Структура» + «Квоты» (FR-16)", () => {
  it("создаёт разделы с порогом и квотами; режим router_by_topics", async () => {
    const buf = await makeWorkbook({
      "Вопросы": [questionRow],
      "Структура": [
        { "Раздел": "JavaScript", "Порядок": "1", "Вопросов в выборке": "5", "Тип порога": "Сумма баллов", "Порог": "4", "Обязательный": "да" },
      ],
      "Квоты": [{ "Раздел": "JavaScript", "Тег": "basics", "Количество": "3", "Режим": "Ровно" }],
    });
    const res = await postWorkbook(buf);

    expect(res.status).toBe(200);
    expect(res.body.structure).toEqual({ sections: 1, quotas: 1 });
    expect(res.body.errors).toEqual([]);
    expect(testSettingsMock.save).toHaveBeenCalledWith(
      "test-1",
      expect.objectContaining({
        test: expect.objectContaining({ flowPolicyJson: { mode: "router_by_topics" } }),
        sections: [
          expect.objectContaining({
            topicId: "t1",
            drawCount: 5,
            required: true,
            topicPassRuleJson: { source: "custom", type: "absolute", value: 4 },
            drawBlueprintJson: { strata: [{ tag: "basics", count: 3, mode: "exact" }] },
          }),
        ],
      }),
    );
  });

  it("Σ квот > «Вопросов в выборке» → ошибка строки, save не вызывается", async () => {
    const buf = await makeWorkbook({
      "Структура": [{ "Раздел": "JavaScript", "Вопросов в выборке": "3", "Тип порога": "Сумма баллов", "Порог": "2" }],
      "Квоты": [
        { "Раздел": "JavaScript", "Тег": "a", "Количество": "2" },
        { "Раздел": "JavaScript", "Тег": "b", "Количество": "3" },
      ],
    });
    const res = await postWorkbook(buf);

    expect(res.body.errors.some((e: string) => /сумма квот/i.test(e))).toBe(true);
    expect(res.body.structure.sections).toBe(0);
    expect(testSettingsMock.save).not.toHaveBeenCalled();
  });

  it("dryRun: считает структуру, но не сохраняет", async () => {
    const buf = await makeWorkbook({
      "Структура": [{ "Раздел": "JavaScript", "Вопросов в выборке": "5", "Тип порога": "Сумма баллов", "Порог": "4" }],
      "Квоты": [{ "Раздел": "JavaScript", "Тег": "basics", "Количество": "3" }],
    });
    const res = await postWorkbook(buf, "?dryRun=true");

    expect(res.body.structure).toEqual({ sections: 1, quotas: 1 });
    expect(testSettingsMock.save).not.toHaveBeenCalled();
  });
});

// ─── Export ─────────────────────────────────────────────────────────────────

const exportQuestion = {
  id: "q-1",
  topicId: "t1",
  type: "single",
  prompt: "2+2?",
  dataJson: { options: ["3", "4", "5"] },
  correctJson: { correctIndex: 1 },
  points: 1,
  difficulty: 50,
  shuffleAnswers: true,
  feedback: null,
  feedbackMode: "general",
  feedbackCorrect: null,
  feedbackIncorrect: null,
  tags: [],
  scoringJson: null,
};
const exportScale = {
  id: "s-1", testId: "test-1", key: "ee", label: "Истощение", description: null, type: "number",
  aggregation: "sum", normalization: "none", direction: "positive", configJson: {},
  showToLearner: false, scormTarget: "none", sortOrder: 0,
};
const exportRv = {
  id: "rv-1", testId: "test-1", name: "passed", label: "Сдал", type: "boolean", formula: "score >= 60",
  showToLearner: false, scormTarget: "both", controlsStatus: "none", sortOrder: 0,
};
const exportMeasurement = {
  id: "m-1", testId: "test-1", questionId: "q-1", scaleId: "s-1",
  sourceType: "option", sourceKey: "1", valueJson: 3, weight: 1, conditionJson: null, sortOrder: 0,
};

function getExport() {
  return request(makeApp())
    .get("/api/tests/test-1/workbook/export")
    .buffer(true)
    .parse((r: any, cb: any) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
}

describe("GET /:id/workbook/export", () => {
  beforeEach(() => {
    storageMock.getTestSections.mockResolvedValue([
      {
        topicId: "t1", drawCount: 5, sortOrder: 0, required: true,
        topicPassRuleJson: { source: "custom", type: "absolute", value: 3 },
        drawBlueprintJson: { strata: [{ tag: "basics", count: 2, mode: "exact" }] },
      },
    ]);
    storageMock.getQuestions.mockResolvedValue([exportQuestion]);
    storageMock.getScales.mockResolvedValue([exportScale]);
    storageMock.getResultVariables.mockResolvedValue([exportRv]);
    storageMock.getQuestionMeasurements.mockResolvedValue([exportMeasurement]);
  });

  it("выгружает 4 листа с локальным «Ключ строки» и ссылками по алиасу", async () => {
    const res = await getExport();
    expect(res.status).toBe(200);
    const wb = await readWorkbookFromBuffer(res.body as Buffer);
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toEqual(
      expect.arrayContaining(["Вопросы", "Структура", "Квоты", "Шкалы", "Показатели", "Вклады вопросов"]),
    );

    const qRows = sheetToObjects(wb.getWorksheet("Вопросы")!);
    expect(qRows[0]).toMatchObject({ "Ключ строки": "q1", "ID": "q-1", "Тип вопроса": "multiple_choice" });

    const structRows = sheetToObjects(wb.getWorksheet("Структура")!);
    expect(structRows[0]).toMatchObject({
      "Раздел": "JavaScript", "Вопросов в выборке": 5, "Тип порога": "Сумма баллов", "Порог": 3, "Обязательный": "да",
    });

    const quotaRows = sheetToObjects(wb.getWorksheet("Квоты")!);
    expect(quotaRows[0]).toMatchObject({ "Раздел": "JavaScript", "Тег": "basics", "Количество": 2, "Режим": "Ровно" });

    const sRows = sheetToObjects(wb.getWorksheet("Шкалы")!);
    expect(sRows[0]).toMatchObject({ "Ключ": "ee", "Название": "Истощение" });

    const rvRows = sheetToObjects(wb.getWorksheet("Показатели")!);
    expect(rvRows[0]).toMatchObject({ "Имя": "passed" });

    const mRows = sheetToObjects(wb.getWorksheet("Вклады вопросов")!);
    expect(mRows[0]).toMatchObject({
      "Вопрос": "q1", "Шкала": "ee", "Источник": "вариант", "Ключ источника": "1", "Значение": 3,
    });
  });
});

describe("Round-trip: экспорт → реимпорт", () => {
  beforeEach(() => {
    storageMock.getTestSections.mockResolvedValue([
      {
        topicId: "t1", drawCount: 5, sortOrder: 0, required: true,
        topicPassRuleJson: { source: "custom", type: "absolute", value: 3 },
        drawBlueprintJson: { strata: [{ tag: "basics", count: 2, mode: "exact" }] },
      },
    ]);
    storageMock.getQuestions.mockResolvedValue([exportQuestion]);
    storageMock.getScales.mockResolvedValue([exportScale]);
    storageMock.getResultVariables.mockResolvedValue([exportRv]);
    storageMock.getQuestionMeasurements.mockResolvedValue([exportMeasurement]);
  });

  it("импорт выгруженной книги воспроизводит измерение для того же вопроса/шкалы", async () => {
    const exportRes = await getExport();
    const buf = exportRes.body as Buffer;

    // На реимпорте вопрос и шкала существуют → пути обновления; алиас q1 → q-1.
    storageMock.getQuestion.mockResolvedValue(exportQuestion);
    const res = await postWorkbook(buf);

    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(storageMock.upsertQuestionMeasurements).toHaveBeenCalledWith(
      "test-1",
      "q-1",
      expect.arrayContaining([
        expect.objectContaining({ scaleId: "s-1", sourceType: "option", sourceKey: "1", valueJson: 3 }),
      ]),
    );
  });
});
