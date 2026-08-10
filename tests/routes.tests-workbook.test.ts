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
    // PRD-48 FR-10: «Код темы» проставляется теме, у которой его нет.
    updateTopic: vi.fn(),
    getQuestion: vi.fn(),
    createQuestion: vi.fn(),
    updateQuestion: vi.fn(),
    getContentHashesByTopic: vi.fn(),
    getQuestionsByTopic: vi.fn(),
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
    // PRD-48 §4.1: «Папка» of the settings sheet is resolved from the folder tree;
    // a segment the tree does not have yet is created (the import creates topics
    // by name the same way).
    getTestFolders: vi.fn().mockResolvedValue([]),
    createTestFolder: vi.fn(),
    // PRD-15 block D: «Оценка» sheet (per-test scoring overrides).
    getTestQuestionScoring: vi.fn().mockResolvedValue([]),
    replaceTestQuestionScoring: vi.fn().mockResolvedValue([]),
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
import { FlowPolicyValidationError, validateFlowPolicy } from "../server/services/flow-policy-validator";

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
  storageMock.updateTopic.mockResolvedValue(dbTopic);
  storageMock.getContentHashesByTopic.mockResolvedValue(new Set());
  storageMock.getQuestionsByTopic.mockResolvedValue([]);
  storageMock.createQuestion.mockResolvedValue({ id: "newq-1" });
  storageMock.getScales.mockResolvedValue([]);
  storageMock.createScale.mockResolvedValue({ id: "scale-new", key: "ee" });
  storageMock.getResultVariables.mockResolvedValue([]);
  storageMock.createResultVariable.mockResolvedValue({ id: "rv-new" });
  storageMock.validateResultVariableFormula.mockResolvedValue({ valid: true });
  storageMock.upsertQuestionMeasurements.mockResolvedValue([]);
  storageMock.getTestQuestionScoring.mockResolvedValue([]);
  storageMock.replaceTestQuestionScoring.mockResolvedValue([]);
  storageMock.getTestFolders.mockResolvedValue([]);
  storageMock.createTestFolder.mockResolvedValue({ id: "folder-new", name: "Папка", parentId: null });
  // Разделы приёмника: импорт «Структуры» читает их, чтобы не стереть обратную связь
  // раздела, которого книга не назвала. По умолчанию тест-приёмник разделов не имеет.
  storageMock.getTestSections.mockResolvedValue([]);
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

  it("FR-28: тема и вопрос, созданные при импорте, принадлежат импортёру", async () => {
    // Тема из файла отсутствует в банке → создаётся. Импортёр (user-1) должен
    // стать её владельцем (createTopic выводит ownerId из createdBy). Регрессия:
    // раньше importWorkbook не пробрасывал actor и темы получали createdBy=null.
    storageMock.getTopics.mockResolvedValue([]);
    storageMock.createTopic.mockResolvedValue({ id: "t-new", name: "Новая тема" });

    const buf = await makeWorkbook({
      "Вопросы": [{ ...questionRow, "Тема": "Новая тема" }],
    });
    const res = await postWorkbook(buf);

    expect(res.status).toBe(200);
    expect(storageMock.createTopic).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Новая тема", createdBy: "user-1" }),
    );
    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: "user-1" }),
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
  it("создаёт разделы с порогом и квотами", async () => {
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

  // ── PRD-17 (FR-13): «Варианты» column → form_set_json ──
  const vQuestion = (key: string, vars: string) => ({
    "Ключ строки": key, "Тема": "JavaScript", "Тип вопроса": "multiple_choice",
    "Текст вопроса": `${key}?`, "Тексты вариантов ответа": "3#4#5", "Номера правильных ответов": "2",
    "Варианты": vars,
  });

  it("строит form_set_json из СТАРОГО имени колонки «Варианты» (совместимость)", async () => {
    let n = 0;
    storageMock.createQuestion.mockImplementation(async () => ({ id: `nq${++n}` }));
    const buf = await makeWorkbook({
      "Вопросы": [vQuestion("q1", "1"), vQuestion("q2", "2"), vQuestion("q3", "1; 2")],
      "Структура": [{ "Раздел": "JavaScript", "Порядок": "1", "Вопросов в выборке": "3", "Тип порога": "Сумма баллов", "Порог": "2" }],
    });
    const res = await postWorkbook(buf);
    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    const fs = (testSettingsMock.save.mock.calls[0][1] as any).sections[0].formSetJson;
    expect(fs.forms.map((f: any) => f.label)).toEqual(["Вариант 1", "Вариант 2"]);
    expect(fs.forms[0].questionIds).toEqual(["nq1", "nq3"]); // вариант 1
    expect(fs.forms[1].questionIds).toEqual(["nq2", "nq3"]); // вариант 2
  });

  // The column is named «Варианты теста»: on the «Вопросы» sheet the bare word
  // «варианты» already belongs to the answer options («Тексты вариантов ответа»),
  // so the short name read as «варианты ответа» to every first-time author.
  const vQuestionNew = (key: string, vars: string) => ({
    "Ключ строки": key, "Тема": "JavaScript", "Тип вопроса": "multiple_choice",
    "Текст вопроса": `${key}?`, "Тексты вариантов ответа": "3#4#5", "Номера правильных ответов": "2",
    "Варианты теста": vars,
  });

  it("строит form_set_json из колонки «Варианты теста»", async () => {
    let n = 0;
    storageMock.createQuestion.mockImplementation(async () => ({ id: `nq${++n}` }));
    const buf = await makeWorkbook({
      "Вопросы": [vQuestionNew("q1", "1"), vQuestionNew("q2", "2"), vQuestionNew("q3", "1; 2")],
      "Структура": [{ "Раздел": "JavaScript", "Порядок": "1", "Вопросов в выборке": "3", "Тип порога": "Сумма баллов", "Порог": "2" }],
    });
    const res = await postWorkbook(buf);
    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    const fs = (testSettingsMock.save.mock.calls[0][1] as any).sections[0].formSetJson;
    expect(fs.forms.map((f: any) => f.label)).toEqual(["Вариант 1", "Вариант 2"]);
    expect(fs.forms[0].questionIds).toEqual(["nq1", "nq3"]);
    expect(fs.forms[1].questionIds).toEqual(["nq2", "nq3"]);
  });

  it("новое имя имеет приоритет, когда в листе есть оба", async () => {
    let n = 0;
    storageMock.createQuestion.mockImplementation(async () => ({ id: `nq${++n}` }));
    const buf = await makeWorkbook({
      "Вопросы": [
        { ...vQuestionNew("q1", "1"), "Варианты": "2" },
        { ...vQuestionNew("q2", "2"), "Варианты": "1" },
      ],
      "Структура": [{ "Раздел": "JavaScript", "Вопросов в выборке": "2", "Тип порога": "Сумма баллов", "Порог": "1" }],
    });
    const res = await postWorkbook(buf);
    expect(res.body.errors).toEqual([]);
    const fs = (testSettingsMock.save.mock.calls[0][1] as any).sections[0].formSetJson;
    expect(fs.forms[0].questionIds).toEqual(["nq1"]); // из «Варианты теста», не из «Варианты»
    expect(fs.forms[1].questionIds).toEqual(["nq2"]);
  });

  // «Варианты» is ALSO the ancient name of «Тексты вариантов ответа». It keeps
  // that meaning only on a sheet without the canonical options column — where
  // variant membership cannot be expressed anyway.
  it("древний лист без «Текстов вариантов ответа» читает «Варианты» как тексты ответов", async () => {
    storageMock.createQuestion.mockImplementation(async () => ({ id: "nq1" }));
    const buf = await makeWorkbook({
      "Вопросы": [{
        "Ключ строки": "q1", "Тема": "JavaScript", "Тип вопроса": "multiple_choice",
        "Текст вопроса": "2+2?", "Варианты": "3#4#5", "Номера правильных ответов": "2",
      }],
    });
    const res = await postWorkbook(buf);

    expect(res.body.errors).toEqual([]);
    expect(res.body.questions.created).toBe(1);
    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ dataJson: { options: ["3", "4", "5"] } }),
    );
  });

  it("один вариант на тему → ошибка «нужно ≥2», секция без form_set_json", async () => {
    storageMock.createQuestion.mockImplementation(async () => ({ id: "nqx" }));
    const buf = await makeWorkbook({
      "Вопросы": [vQuestion("q1", "1")],
      "Структура": [{ "Раздел": "JavaScript", "Вопросов в выборке": "3", "Тип порога": "Сумма баллов", "Порог": "2" }],
    });
    const res = await postWorkbook(buf);
    expect(res.body.errors.some((e: string) => /только один вариант/.test(e))).toBe(true);
    expect((testSettingsMock.save.mock.calls[0][1] as any).sections[0].formSetJson).toBeNull();
  });
});

// ─── «Код темы» (PRD-48 FR-10) ────────────────────────────────────────────────
// Формулы показателей адресуют тему как topicById("<код>"): книга, приехавшая на
// другой стенд без кодов, оставит формулы без адресата.

describe("POST /:id/workbook/import — «Код темы»", () => {
  const withCode = {
    id: "t-law", name: "Право", code: "law", description: null, folderId: null, createdAt: new Date(),
  };
  const withoutCode = {
    id: "t-fin", name: "Финансы", code: null, description: null, folderId: null, createdAt: new Date(),
  };

  it("проставляется теме без кода и не перетирает существующий", async () => {
    storageMock.getTopics.mockResolvedValue([withCode, withoutCode]);
    const buf = await makeWorkbook({
      "Структура": [
        { "Раздел": "Финансы", "Порядок": 1, "Вопросов в выборке": 1, "Код темы": "fin" },
        { "Раздел": "Право", "Порядок": 2, "Вопросов в выборке": 1, "Код темы": "другой" },
      ],
    });
    const res = await postWorkbook(buf);

    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    // Тема без кода получила его; тема с кодом не тронута ВОВСЕ.
    expect(storageMock.updateTopic).toHaveBeenCalledTimes(1);
    expect(storageMock.updateTopic).toHaveBeenCalledWith("t-fin", { code: "fin" });
  });

  it("dryRun не пишет код", async () => {
    storageMock.getTopics.mockResolvedValue([withoutCode]);
    const buf = await makeWorkbook({
      "Структура": [{ "Раздел": "Финансы", "Порядок": 1, "Вопросов в выборке": 1, "Код темы": "fin" }],
    });
    await postWorkbook(buf, "?dryRun=true");

    expect(storageMock.updateTopic).not.toHaveBeenCalled();
  });

  it("книга без колонки «Код темы» не трогает коды", async () => {
    storageMock.getTopics.mockResolvedValue([withoutCode]);
    const buf = await makeWorkbook({
      "Структура": [{ "Раздел": "Финансы", "Порядок": 1, "Вопросов в выборке": 1 }],
    });
    const res = await postWorkbook(buf);

    expect(res.body.errors).toEqual([]);
    expect(storageMock.updateTopic).not.toHaveBeenCalled();
  });
});

// ─── «Оценка» (PRD-15 block D, FR-36) ─────────────────────────────────────────

describe("POST /:id/workbook/import — «Оценка»", () => {
  it("пишет переопределения по «Ключ строки» с пином contentHash (replace на тест)", async () => {
    const buf = await makeWorkbook({
      "Вопросы": [questionRow],
      "Оценка": [{ "Вопрос": "q1", "Балл": "2", "Цена ответа": "веса: 1 # 0 # 0", "Сложность": "80" }],
    });
    const res = await postWorkbook(buf);

    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(res.body.scoring).toEqual({ rows: 1 });
    expect(storageMock.replaceTestQuestionScoring).toHaveBeenCalledWith("test-1", [
      expect.objectContaining({
        questionId: "newq-1",
        points: 2,
        difficulty: 80,
        scoringJson: { kind: "weighted", weights: [1, 0, 0] },
        pinnedContentHash: expect.any(String),
      }),
    ]);
  });

  it("«точное» — явное точное переопределение", async () => {
    const buf = await makeWorkbook({
      "Вопросы": [questionRow],
      "Оценка": [{ "Вопрос": "q1", "Цена ответа": "точное" }],
    });
    const res = await postWorkbook(buf);
    expect(res.body.errors).toEqual([]);
    expect(storageMock.replaceTestQuestionScoring).toHaveBeenCalledWith("test-1", [
      expect.objectContaining({ scoringJson: { kind: "exact" } }),
    ]);
  });

  it("невалидная грамматика «Цены ответа» — ошибка строки, строка не пишется", async () => {
    const buf = await makeWorkbook({
      "Вопросы": [questionRow],
      "Оценка": [{ "Вопрос": "q1", "Цена ответа": "ступени: correct == total => 2" }],
    });
    const res = await postWorkbook(buf);
    expect(res.body.errors.some((e: string) => e.includes("Оценка"))).toBe(true);
    expect(res.body.scoring.rows).toBe(0);
  });

  it("dryRun: считает строки, но не пишет", async () => {
    const buf = await makeWorkbook({
      "Вопросы": [questionRow],
      "Оценка": [{ "Вопрос": "q1", "Балл": "3" }],
    });
    const res = await postWorkbook(buf, "?dryRun=true");
    expect(res.body.scoring).toEqual({ rows: 1 });
    expect(storageMock.replaceTestQuestionScoring).not.toHaveBeenCalled();
  });

  // «Балл» / «Цена ответа» / «Сложность» — НЕЗАВИСИМЫЕ звенья цепочки (§5.3
  // гайда): неразобранная градуированная цена не должна утаскивать за собой
  // валидные балл и сложность той же строки.
  it("невалидная «Цена ответа» не отменяет «Балл» и «Сложность» той же строки", async () => {
    const buf = await makeWorkbook({
      "Вопросы": [questionRow],
      "Оценка": [{ "Вопрос": "q1", "Балл": "2", "Цена ответа": "не грамматика", "Сложность": "80" }],
    });
    const res = await postWorkbook(buf);

    expect(res.body.errors.some((e: string) => e.includes("Оценка"))).toBe(true);
    expect(res.body.scoring).toEqual({ rows: 1 });
    expect(storageMock.replaceTestQuestionScoring).toHaveBeenCalledWith("test-1", [
      expect.objectContaining({ questionId: "newq-1", points: 2, difficulty: 80, scoringJson: null }),
    ]);
  });
});

// ─── Legacy «Вопросы»-sheet scoring fallback (нет листа «Оценка») ──────────────
// Files authored per the import guide put «Балл»/«Цена ответа» on the «Вопросы»
// sheet (pre-T-40 layout). With no «Оценка» sheet, scoring is derived from those
// columns into the test's per-question overrides; «Оценка» wins when both exist.

describe("POST /:id/workbook/import — цена ответа на листе «Вопросы» (fallback)", () => {
  it("выводит переопределения из «Балл»/«Цена ответа» листа «Вопросы», когда нет листа «Оценка»", async () => {
    const buf = await makeWorkbook({
      "Вопросы": [{ ...questionRow, "Балл": "2", "Цена ответа": "веса: 1 # 0 # 0" }],
    });
    const res = await postWorkbook(buf);

    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(res.body.scoring).toEqual({ rows: 1 });
    expect(storageMock.replaceTestQuestionScoring).toHaveBeenCalledWith("test-1", [
      expect.objectContaining({
        questionId: "newq-1",
        points: 2,
        scoringJson: { kind: "weighted", weights: [1, 0, 0] },
        difficulty: null,
        pinnedContentHash: expect.any(String),
      }),
    ]);
  });

  it("«ступени» для одиночного выбора на листе «Вопросы» → ошибка строки", async () => {
    const buf = await makeWorkbook({
      "Вопросы": [{ ...questionRow, "Цена ответа": "ступени: correct == total => 2" }],
    });
    const res = await postWorkbook(buf);
    expect(res.body.errors.some((e: string) => /Вопросы.*одиночн/i.test(e))).toBe(true);
    expect(res.body.scoring.rows).toBe(0);
  });

  // Регрессия исходного дефекта: книга сертификации РТК несла «Балл»=2 рядом с
  // «Ценой ответа» в нераспознанной нотации — балл молча терялся, и вопрос
  // проваливался к системному умолчанию в 1 балл.
  it("невалидная «Цена ответа» на листе «Вопросы» не отменяет «Балл» строки", async () => {
    const buf = await makeWorkbook({
      "Вопросы": [{ ...questionRow, "Балл": "2", "Цена ответа": "ступени: correct == total => 2" }],
    });
    const res = await postWorkbook(buf);

    expect(res.body.errors.some((e: string) => /Вопросы.*одиночн/i.test(e))).toBe(true);
    expect(res.body.scoring).toEqual({ rows: 1 });
    expect(storageMock.replaceTestQuestionScoring).toHaveBeenCalledWith("test-1", [
      expect.objectContaining({ questionId: "newq-1", points: 2, scoringJson: null }),
    ]);
  });

  // PRD-10 §1.2: ключ РТК `%A2B1C1D0` — исходная нотация весов одиночного выбора.
  it("разбирает ключ РТК «%…» в колонке «Цена ответа» листа «Вопросы»", async () => {
    const buf = await makeWorkbook({
      "Вопросы": [{ ...questionRow, "Балл": "2", "Цена ответа": "%A0B2C1" }],
    });
    const res = await postWorkbook(buf);

    expect(res.body.errors).toEqual([]);
    expect(storageMock.replaceTestQuestionScoring).toHaveBeenCalledWith("test-1", [
      expect.objectContaining({
        questionId: "newq-1",
        points: 2,
        scoringJson: { kind: "weighted", weights: [0, 2, 1] },
      }),
    ]);
  });

  it("лист «Оценка» имеет приоритет над «Балл»/«Цена ответа» листа «Вопросы»", async () => {
    const buf = await makeWorkbook({
      "Вопросы": [{ ...questionRow, "Балл": "9", "Цена ответа": "веса: 1 # 0 # 0" }],
      "Оценка": [{ "Вопрос": "q1", "Балл": "2" }],
    });
    const res = await postWorkbook(buf);

    expect(res.body.errors).toEqual([]);
    // Только переопределение из «Оценки» (Балл=2, без градуированной цены).
    expect(storageMock.replaceTestQuestionScoring).toHaveBeenCalledWith("test-1", [
      expect.objectContaining({ questionId: "newq-1", points: 2, scoringJson: null }),
    ]);
  });
});

// ─── Предупреждение о конфликте источников оценки ────────────────────────────
// The template offers «Балл»/«Цена ответа» on «Вопросы» AND an «Оценка» sheet.
// When a book carries both, «Оценка» silently wins — which is a surprise worth
// saying out loud, especially when «Оценка» is empty and therefore CLEARS the
// test's overrides while the author believes they filled them in on «Вопросы».

describe("POST /:id/workbook/import — конфликт источников оценки", () => {
  it("оба источника → предупреждение, что оценка взята с листа «Оценка»", async () => {
    const buf = await makeWorkbook({
      "Вопросы": [{ ...questionRow, "Балл": "9" }],
      "Оценка": [{ "Вопрос": "q1", "Балл": "2" }],
    });
    const res = await postWorkbook(buf);

    expect(res.body.errors).toEqual([]);
    expect(res.body.warnings).toHaveLength(1);
    expect(res.body.warnings[0]).toContain("Оценка");
    expect(res.body.warnings[0]).toContain("Вопросы");
  });

  it("пустой лист «Оценка» рядом с «Баллом» — предупреждение говорит, что строк 0", async () => {
    // The trap: an untouched «Оценка» sheet from the template clears the whole
    // override set, so the «Балл» the author filled in on «Вопросы» is dropped.
    const buf = await makeWorkbook({
      "Вопросы": [{ ...questionRow, "Балл": "9" }],
      "Оценка": [],
    });
    // makeWorkbook skips empty sheets — add the header-only sheet explicitly.
    const wb = await readWorkbookFromBuffer(buf);
    wb.addWorksheet("Оценка").addRow(["Вопрос", "Балл", "Цена ответа", "Сложность"]);
    const res = await postWorkbook(await workbookToBuffer(wb));

    expect(res.body.warnings).toHaveLength(1);
    expect(res.body.warnings[0]).toContain("0");
    expect(res.body.scoring.rows).toBe(0);
    expect(storageMock.replaceTestQuestionScoring).toHaveBeenCalledWith("test-1", []);
  });

  it("только лист «Оценка», без колонок на «Вопросах» → предупреждения нет", async () => {
    const buf = await makeWorkbook({
      "Вопросы": [questionRow],
      "Оценка": [{ "Вопрос": "q1", "Балл": "2" }],
    });
    const res = await postWorkbook(buf);
    expect(res.body.warnings).toEqual([]);
  });

  it("только колонки на «Вопросах», без листа «Оценка» → предупреждения нет", async () => {
    const buf = await makeWorkbook({
      "Вопросы": [{ ...questionRow, "Балл": "2" }],
    });
    const res = await postWorkbook(buf);
    expect(res.body.warnings).toEqual([]);
  });

  it("колонки на «Вопросах» есть, но пусты → предупреждения нет", async () => {
    // The shipped template carries both the «Оценка» sheet and the scoring
    // columns, so a book that simply uses the canonical sheet must stay quiet.
    const buf = await makeWorkbook({
      "Вопросы": [{ ...questionRow, "Балл": "", "Цена ответа": "" }],
      "Оценка": [{ "Вопрос": "q1", "Балл": "2" }],
    });
    const res = await postWorkbook(buf);

    expect(res.body.warnings).toEqual([]);
    expect(res.body.scoring.rows).toBe(1);
  });

  it("дедуплицированный вопрос сохраняет алиас «Ключ строки» для резолва цены", async () => {
    // Вопрос уже есть в банке (хэш совпал) → пропуск; алиас всё равно резолвится
    // в существующий id, и цена с листа «Вопросы» к нему применяется.
    storageMock.getContentHashesByTopic.mockImplementation(async () => {
      // Любой хэш считаем существующим (для этого теста единственный вопрос).
      return new Set<string>(["__match_all__"]);
    });
    const existing = { id: "q-existing", type: "single", dataJson: { options: ["3", "4", "5"] }, contentHash: "h-existing" };
    storageMock.getQuestionsByTopic.mockResolvedValue([existing]);
    // Подменяем проверку хэша: getContentHashesByTopic должен вернуть хэш строки.
    // Проще — вернуть set, содержащий вычисленный хэш. Используем реальный расчёт:
    const { computeQuestionHash } = await import("../server/services/questions-import");
    const hash = computeQuestionHash("single", "2+2?", { options: ["3", "4", "5"] });
    storageMock.getContentHashesByTopic.mockResolvedValue(new Set([hash]));
    storageMock.getQuestionsByTopic.mockResolvedValue([{ ...existing, contentHash: hash }]);

    const buf = await makeWorkbook({
      "Вопросы": [{ ...questionRow, "Балл": "5" }],
    });
    const res = await postWorkbook(buf);

    expect(res.body.questions.skipped).toBe(1);
    expect(res.body.errors).toEqual([]);
    expect(storageMock.replaceTestQuestionScoring).toHaveBeenCalledWith("test-1", [
      expect.objectContaining({ questionId: "q-existing", points: 5 }),
    ]);
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
  learnerVisibility: "hidden", scormTarget: "none", sortOrder: 0,
};
const exportRv = {
  id: "rv-1", testId: "test-1", name: "passed", label: "Сдал", type: "boolean", formula: "score >= 60",
  learnerVisibility: "hidden", scormTarget: "both", controlsStatus: "none", sortOrder: 0,
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

  // PRD-15 block D (FR-36): the test's scoring overrides round-trip via «Оценка».
  it("выгружает лист «Оценка» с переопределениями по алиасу", async () => {
    storageMock.getTestQuestionScoring.mockResolvedValue([
      {
        id: "ov-1", testId: "test-1", questionId: "q-1",
        points: 7, scoringJson: null, difficulty: 90, pinnedContentHash: "h",
      },
    ]);
    const res = await getExport();
    const wb = await readWorkbookFromBuffer(res.body as Buffer);
    expect(wb.worksheets.map((w) => w.name)).toContain("Оценка");
    const rows = sheetToObjects(wb.getWorksheet("Оценка")!);
    expect(rows[0]).toMatchObject({ "Вопрос": "q1", "Балл": 7, "Сложность": 90 });
  });

  // PRD-17 (FR-13): section variants round-trip via «Варианты теста» (numbers).
  it("выгружает колонку «Варианты теста» номерами по позиции формы", async () => {
    storageMock.getTestSections.mockResolvedValue([
      {
        topicId: "t1", drawCount: 5, sortOrder: 0, required: true, topicPassRuleJson: null, drawBlueprintJson: null,
        formSetJson: { forms: [
          { id: "f1", label: "Вариант 1", questionIds: ["q-1"] },
          { id: "f2", label: "Вариант 2", questionIds: ["q-1", "q-2"] },
        ] },
      },
    ]);
    storageMock.getQuestions.mockResolvedValue([exportQuestion, { ...exportQuestion, id: "q-2", prompt: "3+3?" }]);
    const res = await getExport();
    const wb = await readWorkbookFromBuffer(res.body as Buffer);
    const byId = new Map(
      sheetToObjects(wb.getWorksheet("Вопросы")!).map((r: any) => [r["ID"], String(r["Варианты теста"])]),
    );
    expect(byId.get("q-1")).toBe("1; 2"); // в обоих вариантах
    expect(byId.get("q-2")).toBe("2");
  });
});

// ─── PRD-48 FR-23: книга СТАРОГО формата ─────────────────────────────────────
// Книга, снятая до этой работы: лист «Настройки» с одной строкой «Порядок выдачи
// вопросов» и «Структура» без новых колонок. Такая книга обязана импортироваться без
// ошибок и не менять того, чего не касалась: разборы ячеек покрыты юнитами, а вот
// сквозной прогон через роут проверяет ещё и то, ЧТО уходит в службу настроек.

describe("POST /:id/workbook/import — книга старого формата (FR-23)", () => {
  const finTopic = { id: "t-fin", name: "Финансы", code: null };

  beforeEach(() => {
    storageMock.getTopics.mockResolvedValue([finTopic]);
    // Тест-приёмник живёт своей жизнью: у него есть и сценарий, и защита, и кулдаун —
    // ни одного из них старая книга не называет.
    storageMock.getTest.mockResolvedValue({
      ...baseTest,
      flowPolicyJson: { mode: "router_by_topics", router: { completionPolicy: "all_required_passed" } },
      copyProtection: true,
      retakePolicyJson: { enabled: true, cooldownPeriodDays: 30 },
      overallPassRuleJson: { type: "percent", value: 70 },
    });
  });

  /** Ровно те листы и колонки, что были у книги до PRD-48. */
  const legacyBook = () =>
    makeWorkbook({
      "Настройки": [{ "Параметр": "Порядок выдачи вопросов", "Значение": "Полное перемешивание" }],
      "Структура": [
        {
          "Раздел": "Финансы", "Порядок": 1, "Вопросов в выборке": 3,
          "Тип порога": "Сумма баллов", "Порог": 2, "Обязательный": "да",
          "Случайный порядок вопросов": "",
        },
      ],
      "Квоты": [{ "Раздел": "Финансы", "Тег": "basics", "Количество": 2 }],
    });

  it("импортируется без ошибок и применяет порядок выдачи", async () => {
    const res = await postWorkbook(await legacyBook());

    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(res.body.warnings).toEqual([]);
    expect(res.body.structure).toEqual({ sections: 1, quotas: 1 });
    expect((testSettingsMock.save.mock.calls[0][1] as any).test).toMatchObject({
      questionOrder: "shuffle_all",
    });
  });

  it("в патче нет ни одного поля, которого книга не называла", async () => {
    await postWorkbook(await legacyBook());

    const patch = (testSettingsMock.save.mock.calls[0][1] as any).test as Record<string, unknown>;
    // `status` служба требует всегда, остальное — только названное книгой.
    expect(Object.keys(patch).sort()).toEqual(["questionOrder", "status"]);
  });

  it("разделы применяются, но новые поля раздела остаются незаданными", async () => {
    await postWorkbook(await legacyBook());

    const section = (testSettingsMock.save.mock.calls[0][1] as any).sections[0];
    expect(section).toMatchObject({
      topicId: "t-fin",
      drawCount: 3,
      required: true,
      topicPassRuleJson: { source: "custom", type: "absolute", value: 2 },
      // Колонок в книге нет: тема выдаётся выборкой, лимита и своего балла у неё нет,
      // а порядок вопросов — «как в тесте».
      drawAll: false,
      timeLimitMinutes: null,
      defaultPoints: null,
      questionOrder: null,
    });
  });
});

// ─── Выгрузка: проводка PRD-48 в роуте ───────────────────────────────────────
// Сериализаторы строк покрыты юнитами, а вот СБОРКА их аргументов живёт в роуте:
// карта кодов тем, чтение `flowPolicyJson.router.sectionUnlockRules` с переводом
// идентификаторов тем в имена и обход родителей папки для параметра «Папка».

describe("GET /:id/workbook/export — коды тем, разблокировка и путь папки", () => {
  const jsTopic = { id: "t1", name: "JavaScript", code: "js" };
  const mainTopic = { id: "t-main", name: "Основной", code: null };

  beforeEach(() => {
    storageMock.getTopics.mockResolvedValue([jsTopic, mainTopic]);
    storageMock.getTestSections.mockResolvedValue([
      { topicId: "t1", drawCount: 5, sortOrder: 0, required: true, topicPassRuleJson: null, drawBlueprintJson: null },
      { topicId: "t-main", drawCount: 3, sortOrder: 1, required: true, topicPassRuleJson: null, drawBlueprintJson: null },
    ]);
    storageMock.getQuestions.mockResolvedValue([]);
    storageMock.getScales.mockResolvedValue([]);
    storageMock.getResultVariables.mockResolvedValue([]);
    storageMock.getQuestionMeasurements.mockResolvedValue([]);
  });

  it("«Код темы» берётся из темы, а не из раздела; тема без кода даёт пустую ячейку", async () => {
    const res = await getExport();
    const wb = await readWorkbookFromBuffer(res.body as Buffer);
    const rows = sheetToObjects(wb.getWorksheet("Структура")!);

    expect(rows[0]).toMatchObject({ "Раздел": "JavaScript", "Код темы": "js" });
    // Пустая ячейка на импорте означает «оставить как есть» — код не выдумывается.
    expect(String(rows[1]["Код темы"] ?? "")).toBe("");
  });

  it("правила разблокировки выгружаются ИМЕНАМИ тем, а не идентификаторами", async () => {
    storageMock.getTest.mockResolvedValue({
      ...baseTest,
      flowPolicyJson: {
        mode: "router_by_topics",
        router: {
          sectionUnlockRules: {
            "t-main": { mode: "after_sections_passed", sectionIds: ["t1"] },
          },
        },
      },
    });

    const res = await getExport();
    const wb = await readWorkbookFromBuffer(res.body as Buffer);
    const rows = sheetToObjects(wb.getWorksheet("Структура")!);

    // Раздел без правила — «Доступен сразу», зависимостей нет.
    expect(rows[0]).toMatchObject({ "Раздел": "JavaScript", "Доступность раздела": "Доступен сразу" });
    expect(String(rows[0]["Зависит от разделов"] ?? "")).toBe("");
    expect(rows[1]).toMatchObject({
      "Раздел": "Основной",
      "Доступность раздела": "После успешного прохождения выбранных разделов",
      "Зависит от разделов": "JavaScript",
    });
    // Идентификаторов тем в книге быть не должно: на другом стенде они мертвы.
    expect(JSON.stringify(rows)).not.toContain("t-main");
  });

  it("«Папка» выгружается путём от корня", async () => {
    storageMock.getTest.mockResolvedValue({ ...baseTest, folderId: "f2" });
    storageMock.getTestFolders.mockResolvedValue([
      { id: "f1", name: "Аттестация", parentId: null },
      { id: "f2", name: "2026", parentId: "f1" },
    ]);

    const res = await getExport();
    const wb = await readWorkbookFromBuffer(res.body as Buffer);
    const rows = sheetToObjects(wb.getWorksheet("Настройки")!);
    const folder = rows.find((r: any) => r["Параметр"] === "Папка");

    expect(folder?.["Значение"]).toBe("Аттестация / 2026");
  });

  it("тест вне папок выгружается пустой «Папкой»", async () => {
    storageMock.getTest.mockResolvedValue({ ...baseTest, folderId: null });
    storageMock.getTestFolders.mockResolvedValue([{ id: "f1", name: "Аттестация", parentId: null }]);

    const res = await getExport();
    const wb = await readWorkbookFromBuffer(res.body as Buffer);
    const rows = sheetToObjects(wb.getWorksheet("Настройки")!);
    const folder = rows.find((r: any) => r["Параметр"] === "Папка");

    expect(String(folder?.["Значение"] ?? "")).toBe("");
  });

  // Дерево папок приходит из базы как плоский список, и цикл в нём — вопрос
  // испорченных данных, а не невозможного случая: без защиты обход зациклится и
  // выгрузка повиснет вместо того, чтобы отдать книгу.
  it("цикл в дереве папок не подвешивает выгрузку", async () => {
    storageMock.getTest.mockResolvedValue({ ...baseTest, folderId: "f2" });
    storageMock.getTestFolders.mockResolvedValue([
      { id: "f1", name: "Аттестация", parentId: "f2" },
      { id: "f2", name: "2026", parentId: "f1" },
    ]);

    const res = await getExport();
    expect(res.status).toBe(200);
    const wb = await readWorkbookFromBuffer(res.body as Buffer);
    const rows = sheetToObjects(wb.getWorksheet("Настройки")!);
    const folder = String(rows.find((r: any) => r["Параметр"] === "Папка")?.["Значение"] ?? "");

    // Каждая папка цикла названа ровно один раз — обход останавливается на повторе.
    expect(folder).toBe("Аттестация / 2026");
  });
});

// ─── PRD-48 FR-12/FR-13: «Обратная связь» + «Рекомендации» ───────────────────
// Обратная связь есть у теста и у раздела, форма одна; курсы, материалы и
// мероприятия лежат ВНУТРИ неё, поэтому «Рекомендации» подчинены «Обратной
// связи» так же, как «Квоты» — «Структуре». Раздел адресуется ИМЕНЕМ темы:
// идентификаторы на другом стенде мертвы.

describe("GET /:id/workbook/export — обратная связь и рекомендации", () => {
  const jsTopic = { id: "topic-js-0001", name: "JavaScript", code: null };
  const testFeedback = {
    format: "plain",
    text: "Общий отзыв по тесту",
    links: [{ title: "Курс по JS", url: "https://example.test/js" }],
    assets: [{ title: "Памятка", url: "https://example.test/memo.pdf" }],
    events: [{ title: "Вебинар", url: "" }],
  };
  const sectionFeedback = {
    format: "html",
    text: "<b>Отзыв по теме</b>",
    links: [{ title: "Курс по замыканиям", url: "https://example.test/closures" }],
    assets: [],
    events: [],
  };

  beforeEach(() => {
    storageMock.getTopics.mockResolvedValue([jsTopic]);
    storageMock.getTest.mockResolvedValue({ ...baseTest, feedbackJson: testFeedback });
    storageMock.getTestSections.mockResolvedValue([
      {
        topicId: jsTopic.id, drawCount: 5, sortOrder: 0, required: true,
        topicPassRuleJson: null, drawBlueprintJson: null, feedbackJson: sectionFeedback,
      },
    ]);
    storageMock.getQuestions.mockResolvedValue([]);
    storageMock.getScales.mockResolvedValue([]);
    storageMock.getResultVariables.mockResolvedValue([]);
    storageMock.getQuestionMeasurements.mockResolvedValue([]);
  });

  it("пишет по строке на владельца и по строке на каждую рекомендацию", async () => {
    const res = await getExport();
    expect(res.status).toBe(200);
    const wb = await readWorkbookFromBuffer(res.body as Buffer);

    const fbRows = sheetToObjects(wb.getWorksheet("Обратная связь")!);
    expect(fbRows).toHaveLength(2);
    expect(fbRows[0]).toMatchObject({
      "Уровень": "Тест", "Формат": "Простой", "Текст": "Общий отзыв по тесту",
    });
    expect(String(fbRows[0]["Раздел"] ?? "")).toBe("");
    expect(fbRows[1]).toMatchObject({
      "Уровень": "Раздел", "Раздел": "JavaScript", "Формат": "HTML", "Текст": "<b>Отзыв по теме</b>",
    });

    // `sheetToObjects` выбрасывает пустые ячейки, поэтому строки сводятся к полному
    // набору колонок: пустая «Ссылка» мероприятия — значимое значение, а не пропуск.
    const recRows = sheetToObjects(wb.getWorksheet("Рекомендации")!).map((r: any) =>
      Object.fromEntries(
        ["Уровень", "Раздел", "Тип", "Заголовок", "Ссылка"].map((h) => [h, String(r[h] ?? "")]),
      ),
    );
    expect(recRows).toEqual([
      { "Уровень": "Тест", "Раздел": "", "Тип": "Курс", "Заголовок": "Курс по JS", "Ссылка": "https://example.test/js" },
      { "Уровень": "Тест", "Раздел": "", "Тип": "Материал", "Заголовок": "Памятка", "Ссылка": "https://example.test/memo.pdf" },
      { "Уровень": "Тест", "Раздел": "", "Тип": "Мероприятие", "Заголовок": "Вебинар", "Ссылка": "" },
      {
        "Уровень": "Раздел", "Раздел": "JavaScript", "Тип": "Курс",
        "Заголовок": "Курс по замыканиям", "Ссылка": "https://example.test/closures",
      },
    ]);

    // Раздел выгружен ИМЕНЕМ темы: идентификатор на другом стенде не найдёт никого.
    expect(JSON.stringify(fbRows)).not.toContain(jsTopic.id);
    expect(JSON.stringify(recRows)).not.toContain(jsTopic.id);
  });

  // Порядок листов описывает тест сверху вниз: обратная связь принадлежит структуре,
  // а не оценке, поэтому стоит между «Порогами вариантов» и «Оценкой».
  it("оба листа стоят между «Порогами вариантов» и «Оценкой»", async () => {
    const res = await getExport();
    const wb = await readWorkbookFromBuffer(res.body as Buffer);
    const names = wb.worksheets.map((w) => w.name);

    expect(names.indexOf("Обратная связь")).toBe(names.indexOf("Пороги вариантов") + 1);
    expect(names.indexOf("Рекомендации")).toBe(names.indexOf("Обратная связь") + 1);
    expect(names.indexOf("Оценка")).toBe(names.indexOf("Рекомендации") + 1);
  });

  // Тест без обратной связи — листы всё равно есть, одними заголовками: книга
  // описывает контракт целиком, иначе автору некуда вписать первую строку.
  it("тест без обратной связи даёт листы с одними заголовками", async () => {
    storageMock.getTest.mockResolvedValue({ ...baseTest, feedbackJson: null });
    storageMock.getTestSections.mockResolvedValue([
      {
        topicId: jsTopic.id, drawCount: 5, sortOrder: 0, required: true,
        topicPassRuleJson: null, drawBlueprintJson: null, feedbackJson: null,
      },
    ]);

    const res = await getExport();
    const wb = await readWorkbookFromBuffer(res.body as Buffer);

    expect(sheetToObjects(wb.getWorksheet("Обратная связь")!)).toEqual([]);
    expect(sheetToObjects(wb.getWorksheet("Рекомендации")!)).toEqual([]);
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

// ─── PRD-24: лист «Пороги вариантов» ─────────────────────────────────────────

describe("POST /:id/workbook/import — «Пороги вариантов» (PRD-24 FR-14)", () => {
  /** Two questions split across two variants of the same topic. */
  const q = (key: string, variants: string) => ({
    ...questionRow,
    "Ключ строки": key,
    "Текст вопроса": `Вопрос ${key}`,
    "Варианты": variants,
  });
  const structure = [{ "Раздел": "JavaScript", "Вопросов в выборке": "1", "Тип порога": "По вариантам" }];

  it("привязывает пороги к вариантам по номеру и складывает их в правило", async () => {
    const buf = await makeWorkbook({
      "Вопросы": [q("q1", "1"), q("q2", "2")],
      "Структура": structure,
      "Пороги вариантов": [
        { "Раздел": "JavaScript", "Вариант": "1", "Тип порога": "Процент", "Порог": "60" },
        { "Раздел": "JavaScript", "Вариант": "2", "Тип порога": "Сумма баллов", "Порог": "1" },
      ],
    });
    const res = await postWorkbook(buf);

    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    const saved = testSettingsMock.save.mock.calls[0][1].sections[0];
    const formIds = saved.formSetJson.forms.map((f: { id: string }) => f.id);
    // keyed by the freshly minted formId, in variant order
    expect(saved.topicPassRuleJson).toEqual({
      source: "by_variant",
      byForm: {
        [formIds[0]]: { type: "percent", value: 60 },
        [formIds[1]]: { type: "absolute", value: 1 },
      },
    });
  });

  it("номер варианта, которого нет у темы → ошибка строки", async () => {
    const buf = await makeWorkbook({
      "Вопросы": [q("q1", "1"), q("q2", "2")],
      "Структура": structure,
      "Пороги вариантов": [
        { "Раздел": "JavaScript", "Вариант": "1", "Тип порога": "Процент", "Порог": "60" },
        { "Раздел": "JavaScript", "Вариант": "2", "Тип порога": "Процент", "Порог": "60" },
        { "Раздел": "JavaScript", "Вариант": "9", "Тип порога": "Процент", "Порог": "60" },
      ],
    });
    const res = await postWorkbook(buf);
    expect(res.body.errors.some((e: string) => /вариант 9 не объявлен/i.test(e))).toBe(true);
  });

  it("неполное покрытие вариантов → ошибка раздела (книга не обходит валидацию)", async () => {
    const buf = await makeWorkbook({
      "Вопросы": [q("q1", "1"), q("q2", "2")],
      "Структура": structure,
      "Пороги вариантов": [{ "Раздел": "JavaScript", "Вариант": "1", "Тип порога": "Процент", "Порог": "60" }],
    });
    const res = await postWorkbook(buf);
    expect(res.body.errors.some((e: string) => /задано 1 из 2 порогов/i.test(e))).toBe(true);
  });

  it("книга без листа порогов импортируется как прежде", async () => {
    const buf = await makeWorkbook({
      "Вопросы": [questionRow],
      "Структура": [{ "Раздел": "JavaScript", "Вопросов в выборке": "1", "Тип порога": "Процент", "Порог": "70" }],
    });
    const res = await postWorkbook(buf);
    expect(res.body.errors).toEqual([]);
    expect(testSettingsMock.save.mock.calls[0][1].sections[0].topicPassRuleJson).toEqual({
      source: "custom", type: "percent", value: 70,
    });
  });
});

// ─── PRD-48 FR-06/FR-07: сценарий прохождения ────────────────────────────────
// Проход «Структуры» БЕЗУСЛОВНО ставил `router_by_topics` (PRD-14 FR-16), и
// линейный тест возвращался из круга «экспорт → импорт» маршрутизатором. Теперь
// сценарий приходит с листа «Настройки», а книга, которая его не назвала, не
// трогает его вовсе.

describe("POST /:id/workbook/import — сценарий прохождения (PRD-48)", () => {
  const finTopic = {
    id: "t-fin", name: "Финансы", description: null, folderId: null, createdAt: new Date(),
  };
  const structureRow = { "Раздел": "Финансы", "Порядок": 1, "Вопросов в выборке": 2 };
  const flowRow = (value: string) => ({ "Параметр": "Сценарий прохождения", "Значение": value });

  /** Аргумент `test` единственного вызова save. */
  const savedTest = () =>
    (testSettingsMock.save.mock.calls[0][1] as any).test as Record<string, unknown>;

  beforeEach(() => {
    storageMock.getTopics.mockResolvedValue([finTopic]);
  });

  it("книга со «Структурой» без сценария не делает тест маршрутизатором", async () => {
    const buf = await makeWorkbook({ "Структура": [structureRow] });
    const res = await postWorkbook(buf);

    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(res.body.structure.sections).toBe(1);
    expect(testSettingsMock.save).toHaveBeenCalledTimes(1);
    // Именно ОТСУТСТВУЕТ, а не «равно чему-то»: импорт не вправе трогать
    // сценарий, которого книга не называла.
    expect(savedTest()).not.toHaveProperty("flowPolicyJson");
  });

  it("сценарий из книги применяется", async () => {
    const buf = await makeWorkbook({
      "Настройки": [flowRow("Через страницу-маршрутизатор")],
      "Структура": [structureRow],
    });
    const res = await postWorkbook(buf);

    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(savedTest().flowPolicyJson).toMatchObject({ mode: "router_by_topics" });
  });

  it("линейный сценарий из книги обнуляет ветвь router", async () => {
    storageMock.getTest.mockResolvedValue({
      ...baseTest,
      flowPolicyJson: { mode: "router_by_topics", router: { completionPolicy: "all_required_passed" } },
    });
    const buf = await makeWorkbook({
      "Настройки": [flowRow("Линейный по темам")],
      "Структура": [structureRow],
    });
    const res = await postWorkbook(buf);

    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(savedTest().flowPolicyJson).toEqual({ mode: "linear_by_topics", router: null });
  });

  // Книга может нести ОДНИ «Настройки» — ветвь сохранения без «Структуры»
  // применяет сценарий на тех же правилах.
  it("книга с одними «Настройками» тоже применяет сценарий", async () => {
    const buf = await makeWorkbook({ "Настройки": [flowRow("Через страницу-маршрутизатор")] });
    const res = await postWorkbook(buf);

    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(savedTest().flowPolicyJson).toMatchObject({ mode: "router_by_topics" });
  });

  // Настройки самого маршрутизатора живут в той же колонке: переход на него не
  // должен стирать политику завершения, которой книга не касалась.
  it("переход на маршрутизатор сохраняет его настройки", async () => {
    storageMock.getTest.mockResolvedValue({
      ...baseTest,
      flowPolicyJson: { mode: "linear_flat", router: { completionPolicy: "all_required_completed" } },
    });
    const buf = await makeWorkbook({ "Настройки": [flowRow("Через страницу-маршрутизатор")] });
    const res = await postWorkbook(buf);

    expect(res.status).toBe(200);
    expect(savedTest().flowPolicyJson).toEqual({
      mode: "router_by_topics",
      router: { completionPolicy: "all_required_completed" },
    });
  });

  it("политика завершения из книги перекрывает сохранённую", async () => {
    storageMock.getTest.mockResolvedValue({
      ...baseTest,
      flowPolicyJson: { mode: "router_by_topics", router: { completionPolicy: "all_required_completed" } },
    });
    const buf = await makeWorkbook({
      "Настройки": [
        flowRow("Через страницу-маршрутизатор"),
        { "Параметр": "Политика завершения маршрутизатора", "Значение": "Только если все обязательные разделы пройдены" },
      ],
    });
    const res = await postWorkbook(buf);

    expect(res.body.errors).toEqual([]);
    expect(savedTest().flowPolicyJson).toEqual({
      mode: "router_by_topics",
      router: { completionPolicy: "all_required_passed" },
    });
  });
});

// ─── PRD-48 FR-20: JSON-настройки собираются ПОВЕРХ текущих ──────────────────
// Несколько параметров листа живут в одной JSON-колонке. Книга, назвавшая один из
// них, не вправе обнулить соседей, которых не называла: собранная с нуля политика
// стёрла бы «Разделять период по результату попытки», вводный блок отчёта или тип
// общего правила — молча и без единой строки в `errors`.

describe("POST /:id/workbook/import — слияние JSON-настроек (FR-20)", () => {
  const savedTest = () => (testSettingsMock.save.mock.calls[0][1] as any).test;

  /** Книга «Настройки» из одной строки — ровно один названный параметр. */
  const oneParam = (name: string, value: unknown) =>
    makeWorkbook({ "Настройки": [{ "Параметр": name, "Значение": value }] });

  it("«Период охлаждения» не обнуляет остальную политику повторного прохождения", async () => {
    storageMock.getTest.mockResolvedValue({
      ...baseTest,
      retakePolicyJson: {
        enabled: true,
        cooldownPeriodDays: 30,
        cooldownByOutcome: true,
        cooldownPeriodDaysPassed: 90,
        cooldownPeriodDaysFailed: 7,
        blockedPageId: "page-1",
        attemptInterval: { enabled: true, hours: 24 },
        eligibilityPlugin: { key: "external", failPolicy: "failClosed" },
      },
    });

    const res = await postWorkbook(await oneParam("Период охлаждения, календарных дней", "14"));

    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(savedTest().retakePolicyJson).toEqual({
      enabled: true,
      cooldownPeriodDays: 14,
      cooldownByOutcome: true,
      cooldownPeriodDaysPassed: 90,
      cooldownPeriodDaysFailed: 7,
      // Не параметр листа вовсе (раздел 5 спеки) — обязан уцелеть тем более.
      blockedPageId: "page-1",
      attemptInterval: { enabled: true, hours: 24 },
      eligibilityPlugin: { key: "external", failPolicy: "failClosed" },
    });
  });

  it("«Интервал, часов» не выключает само ограничение между попытками", async () => {
    storageMock.getTest.mockResolvedValue({
      ...baseTest,
      retakePolicyJson: { enabled: true, attemptInterval: { enabled: true, hours: 24 } },
    });

    const res = await postWorkbook(await oneParam("Интервал, часов", "6"));

    expect(res.body.errors).toEqual([]);
    expect(savedTest().retakePolicyJson).toEqual({
      enabled: true,
      attemptInterval: { enabled: true, hours: 6 },
    });
  });

  it("вводный текст итогов не стирает ни его формат, ни блок отчёта", async () => {
    storageMock.getTest.mockResolvedValue({
      ...baseTest,
      introJson: {
        reportSameAsResults: true,
        results: { format: "html", text: "<p>Итоги</p>" },
        report: { format: "plain", text: "Отчёт" },
      },
    });

    const res = await postWorkbook(await oneParam("Вводный текст на экране итогов", "Новый текст"));

    expect(res.body.errors).toEqual([]);
    expect(savedTest().introJson).toEqual({
      reportSameAsResults: true,
      results: { format: "html", text: "Новый текст" },
      report: { format: "plain", text: "Отчёт" },
    });
  });

  it("«Порог» не сбрасывает тип общего правила", async () => {
    storageMock.getTest.mockResolvedValue({
      ...baseTest,
      overallPassRuleJson: { type: "percent", value: 70 },
    });

    const res = await postWorkbook(await oneParam("Порог", "80"));

    expect(res.body.errors).toEqual([]);
    expect(savedTest().overallPassRuleJson).toEqual({ type: "percent", value: 80 });
  });

  // Обратная сторона того же правила: колонку, которой книга не касалась вовсе,
  // патч не должен упоминать — иначе служба перезапишет её умолчанием.
  it("книга без параметров колонки не упоминает её в патче", async () => {
    storageMock.getTest.mockResolvedValue({
      ...baseTest,
      retakePolicyJson: { enabled: true, cooldownPeriodDays: 30 },
      introJson: { results: { format: "plain", text: "Итоги" } },
      overallPassRuleJson: { type: "percent", value: 70 },
    });

    const res = await postWorkbook(await oneParam("Лимит времени теста", "45"));

    expect(res.body.errors).toEqual([]);
    expect(savedTest()).not.toHaveProperty("retakePolicyJson");
    expect(savedTest()).not.toHaveProperty("introJson");
    expect(savedTest()).not.toHaveProperty("overallPassRuleJson");
  });
});

// ─── PRD-48 §4.1: «Название» ─────────────────────────────────────────────────
// В СУЩЕСТВУЮЩИЙ тест книга название применяет — это переименование, которого
// автор и ждёт. Не применяется оно только при создании теста импортом
// (`/api/workbook/import-new`, признак `keepTitle`), см. tests/routes.workbook.

describe("POST /:id/workbook/import — «Название»", () => {
  it("книга переименовывает существующий тест", async () => {
    const buf = await makeWorkbook({
      "Настройки": [{ "Параметр": "Название", "Значение": "Имя из книги" }],
    });
    const res = await postWorkbook(buf);

    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(testSettingsMock.save).toHaveBeenCalledWith(
      "test-1",
      expect.objectContaining({ test: expect.objectContaining({ title: "Имя из книги" }) }),
    );
  });
});

// ─── PRD-48: пустой лист «Структура» не глотает «Настройки» ──────────────────
// Выгрузка пишет «Структуру» ВСЕГДА — у теста без разделов одними заголовками, — и
// шаблон книги везёт её такой же. Ветвь применения настроек стояла под
// `sections.length > 0`, запасная — под «листа нет вовсе»: у книги с заголовочной
// «Структурой» не срабатывала ни одна, и все 38 параметров молча терялись.

describe("POST /:id/workbook/import — заголовочная «Структура» + «Настройки»", () => {
  /** Книга с листом «Настройки» и «Структурой» БЕЗ строк данных. */
  async function headerOnlyStructureBook(
    settings: Record<string, unknown>[],
    structureHeaders: string[] = ["Раздел", "Порядок", "Вопросов в выборке"],
  ): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    // makeWorkbook пропускает листы с нулём строк данных — собираем лист явно.
    addJsonSheet(wb, "Настройки", settings);
    wb.addWorksheet("Структура").addRow(structureHeaders);
    return workbookToBuffer(wb);
  }

  it("настройки применяются, разделы не переписываются", async () => {
    const buf = await headerOnlyStructureBook([
      { "Параметр": "Лимит времени теста", "Значение": "45" },
      { "Параметр": "Максимум попыток", "Значение": "3" },
    ]);
    const res = await postWorkbook(buf);

    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(res.body.structure.sections).toBe(0);
    expect(testSettingsMock.save).toHaveBeenCalledTimes(1);
    const payload = testSettingsMock.save.mock.calls[0][1] as any;
    expect(payload.test).toMatchObject({ timeLimitMinutes: 45, maxAttempts: 3 });
    // Разделов книга не описала — служба не должна их трогать.
    expect(payload).not.toHaveProperty("sections");
  });

  it("пустая «Структура» без «Настроек» ничего не сохраняет", async () => {
    const buf = await headerOnlyStructureBook([{ "Параметр": "Лимит времени теста", "Значение": "" }]);
    const res = await postWorkbook(buf);

    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(testSettingsMock.save).not.toHaveBeenCalled();
  });

  it("книга со «Структурой» и «Настройками» сохраняется ОДНИМ вызовом", async () => {
    const buf = await makeWorkbook({
      "Настройки": [{ "Параметр": "Лимит времени теста", "Значение": "45" }],
      "Структура": [{ "Раздел": "JavaScript", "Порядок": 1, "Вопросов в выборке": 2 }],
    });
    const res = await postWorkbook(buf);

    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(testSettingsMock.save).toHaveBeenCalledTimes(1);
    const payload = testSettingsMock.save.mock.calls[0][1] as any;
    expect(payload.test).toMatchObject({ timeLimitMinutes: 45 });
    expect(payload.sections).toHaveLength(1);
  });
});

// ─── PRD-48 FR-12/FR-13: загрузка обратной связи и рекомендаций ──────────────
// Владелец, названный на листе «Обратная связь», получает обратную связь ЦЕЛИКОМ
// из книги: текст и формат из своей строки, курсы/материалы/мероприятия — из строк
// «Рекомендаций» с тем же владельцем. Не названный не меняется вовсе.

describe("POST /:id/workbook/import — обратная связь и рекомендации", () => {
  const structureRows = [{ "Раздел": "JavaScript", "Порядок": 1, "Вопросов в выборке": 2 }];

  it("применяет обратную связь тесту и разделу вместе с рекомендациями", async () => {
    const buf = await makeWorkbook({
      "Структура": structureRows,
      "Обратная связь": [
        { "Уровень": "Тест", "Раздел": "", "Формат": "Простой", "Текст": "Общий отзыв" },
        { "Уровень": "Раздел", "Раздел": "JavaScript", "Формат": "HTML", "Текст": "<b>Отзыв темы</b>" },
      ],
      "Рекомендации": [
        { "Уровень": "Тест", "Раздел": "", "Тип": "Курс", "Заголовок": "Курс", "Ссылка": "https://example.test/c" },
        { "Уровень": "Тест", "Раздел": "", "Тип": "Материал", "Заголовок": "Памятка", "Ссылка": "https://example.test/m.pdf" },
        { "Уровень": "Тест", "Раздел": "", "Тип": "Мероприятие", "Заголовок": "Вебинар", "Ссылка": "" },
        { "Уровень": "Раздел", "Раздел": "JavaScript", "Тип": "Курс", "Заголовок": "Курс темы", "Ссылка": "https://example.test/t" },
      ],
    });
    const res = await postWorkbook(buf);

    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    const payload = testSettingsMock.save.mock.calls[0][1] as any;
    expect(payload.test.feedbackJson).toEqual({
      format: "plain",
      text: "Общий отзыв",
      links: [{ title: "Курс", url: "https://example.test/c" }],
      assets: [{ title: "Памятка", url: "https://example.test/m.pdf" }],
      events: [{ title: "Вебинар", url: "" }],
    });
    expect(payload.sections[0].feedbackJson).toEqual({
      format: "html",
      text: "<b>Отзыв темы</b>",
      links: [{ title: "Курс темы", url: "https://example.test/t" }],
      assets: [],
      events: [],
    });
  });

  // Книга Э1 листов не несёт — и обратной связи не касается ни у кого.
  it("книга без листа «Обратная связь» обратную связь не трогает", async () => {
    const buf = await makeWorkbook({
      "Настройки": [{ "Параметр": "Лимит времени теста", "Значение": "45" }],
      "Структура": structureRows,
    });
    const res = await postWorkbook(buf);

    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    const payload = testSettingsMock.save.mock.calls[0][1] as any;
    expect(payload.test).not.toHaveProperty("feedbackJson");
    expect(payload.sections[0]).not.toHaveProperty("feedbackJson");
  });

  // Пустой текст при пустых рекомендациях — это «обратной связи нет», а не пустая
  // структура: иначе экран итогов нарисовал бы пустую рамку.
  it("владелец с пустым текстом и без рекомендаций получает null", async () => {
    const buf = await makeWorkbook({
      "Обратная связь": [{ "Уровень": "Тест", "Раздел": "", "Формат": "Простой", "Текст": "" }],
    });
    const res = await postWorkbook(buf);

    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    const payload = testSettingsMock.save.mock.calls[0][1] as any;
    expect(payload.test.feedbackJson).toBeNull();
  });

  // Выгрузка пишет оба листа ВСЕГДА — у теста без обратной связи одними заголовками.
  // Такая книга не называет ни одного владельца, а значит и сохранять ей нечего.
  it("заголовочные листы никого не называют и сохранения не вызывают", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Обратная связь").addRow(["Уровень", "Раздел", "Формат", "Текст"]);
    wb.addWorksheet("Рекомендации").addRow(["Уровень", "Раздел", "Тип", "Заголовок", "Ссылка"]);
    const res = await postWorkbook(await workbookToBuffer(wb));

    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(testSettingsMock.save).not.toHaveBeenCalled();
  });

  // Рекомендации физически лежат ВНУТРИ обратной связи владельца, поэтому владельца,
  // которого нет на первом листе, у рекомендации быть не может.
  it("рекомендация-сирота даёт ошибку строки, остальные строки применяются", async () => {
    const buf = await makeWorkbook({
      "Структура": structureRows,
      "Обратная связь": [{ "Уровень": "Тест", "Раздел": "", "Формат": "Простой", "Текст": "Общий отзыв" }],
      "Рекомендации": [
        { "Уровень": "Раздел", "Раздел": "Право", "Тип": "Курс", "Заголовок": "Курс права", "Ссылка": "https://example.test/law" },
        { "Уровень": "Тест", "Раздел": "", "Тип": "Курс", "Заголовок": "Курс", "Ссылка": "https://example.test/c" },
      ],
    });
    const res = await postWorkbook(buf);

    expect(res.status).toBe(200);
    expect(res.body.errors.some((e: string) => /Право/.test(e))).toBe(true);
    const payload = testSettingsMock.save.mock.calls[0][1] as any;
    expect(payload.test.feedbackJson).toMatchObject({
      text: "Общий отзыв",
      links: [{ title: "Курс", url: "https://example.test/c" }],
    });
  });

  // Иначе обратная связь раздела ушла бы в пустоту: разделов с таким именем в тесте нет.
  it("раздел не с листа «Структура» даёт ошибку строки", async () => {
    const buf = await makeWorkbook({
      "Структура": structureRows,
      "Обратная связь": [
        { "Уровень": "Раздел", "Раздел": "Право", "Формат": "Простой", "Текст": "Отзыв права" },
      ],
    });
    const res = await postWorkbook(buf);

    expect(res.status).toBe(200);
    expect(res.body.errors.some((e: string) => /Право/.test(e))).toBe(true);
  });

  // «Структура» переписывает разделы удалением и вставкой, поэтому поле, которого нет в
  // полезной нагрузке, не «остаётся как было», а СТИРАЕТСЯ. Книга не меняет того, чего не
  // назвала (FR-20), и книга Э1 — со «Структурой», но без листа «Обратная связь» — обязана
  // оставить обратную связь разделов приёмника нетронутой.
  describe("раздел, которого лист не назвал", () => {
    const existingSection = {
      topicId: "t1",
      drawCount: 2,
      sortOrder: 0,
      required: true,
      topicPassRuleJson: null,
      drawBlueprintJson: null,
      feedbackJson: {
        format: "plain",
        text: "Отзыв, который уже есть в тесте",
        links: [{ title: "Курс", url: "https://example.test/c" }],
        assets: [],
        events: [],
      },
    };

    beforeEach(() => {
      storageMock.getTestSections.mockResolvedValue([existingSection]);
    });

    it("книга без листа «Обратная связь» сохраняет обратную связь раздела", async () => {
      const buf = await makeWorkbook({ "Структура": structureRows });
      const res = await postWorkbook(buf);

      expect(res.status).toBe(200);
      expect(res.body.errors).toEqual([]);
      const payload = testSettingsMock.save.mock.calls[0][1] as any;
      expect(payload.sections[0].feedbackJson).toEqual(existingSection.feedbackJson);
    });

    it("названный раздел с пустым текстом и без рекомендаций обратную связь обнуляет", async () => {
      const buf = await makeWorkbook({
        "Структура": structureRows,
        "Обратная связь": [
          { "Уровень": "Раздел", "Раздел": "JavaScript", "Формат": "Простой", "Текст": "" },
        ],
      });
      const res = await postWorkbook(buf);

      expect(res.status).toBe(200);
      expect(res.body.errors).toEqual([]);
      const payload = testSettingsMock.save.mock.calls[0][1] as any;
      expect(payload.sections[0].feedbackJson).toBeNull();
    });

    it("названный раздел с текстом свою обратную связь заменяет", async () => {
      const buf = await makeWorkbook({
        "Структура": structureRows,
        "Обратная связь": [
          { "Уровень": "Раздел", "Раздел": "JavaScript", "Формат": "Простой", "Текст": "Новый отзыв" },
        ],
      });
      const res = await postWorkbook(buf);

      expect(res.status).toBe(200);
      expect(res.body.errors).toEqual([]);
      const payload = testSettingsMock.save.mock.calls[0][1] as any;
      expect(payload.sections[0].feedbackJson).toEqual({
        format: "plain",
        text: "Новый отзыв",
        links: [],
        assets: [],
        events: [],
      });
    });
  });

  // Книга без «Структуры» разделы не переписывает — применить обратную связь разделу
  // в ней нечему, зато обратная связь ТЕСТА обязана примениться.
  it("без листа «Структура» обратная связь теста применяется, а раздела — ошибка", async () => {
    const buf = await makeWorkbook({
      "Обратная связь": [
        { "Уровень": "Тест", "Раздел": "", "Формат": "Простой", "Текст": "Общий отзыв" },
        { "Уровень": "Раздел", "Раздел": "JavaScript", "Формат": "Простой", "Текст": "Отзыв темы" },
      ],
    });
    const res = await postWorkbook(buf);

    expect(res.status).toBe(200);
    expect(res.body.errors.some((e: string) => /JavaScript/.test(e) && /Структура/.test(e))).toBe(true);
    const payload = testSettingsMock.save.mock.calls[0][1] as any;
    expect(payload.test.feedbackJson).toMatchObject({ text: "Общий отзыв" });
    expect(payload).not.toHaveProperty("sections");
  });
});

// ─── PRD-48 FR-11: правила разблокировки разделов ────────────────────────────
// Правила ключуются ИДЕНТИФИКАТОРАМИ ТЕМ (`isSectionUnlocked` читает
// `unlockRules[section.topicId]`), поэтому книга адресует их именами тем:
// идентификаторы разделов на импорте всё равно новые.

describe("POST /:id/workbook/import — разблокировка разделов (PRD-48)", () => {
  const introTopic = {
    id: "t-intro", name: "Вводный", code: null, description: null, folderId: null, createdAt: new Date(),
  };
  const mainTopic = {
    id: "t-main", name: "Основной", code: null, description: null, folderId: null, createdAt: new Date(),
  };
  const routerRow = { "Параметр": "Сценарий прохождения", "Значение": "Через страницу-маршрутизатор" };

  beforeEach(() => {
    storageMock.getTopics.mockResolvedValue([introTopic, mainTopic]);
  });

  it("зависимость по имени темы превращается в идентификатор темы", async () => {
    const buf = await makeWorkbook({
      "Настройки": [routerRow],
      "Структура": [
        { "Раздел": "Вводный", "Порядок": 1, "Вопросов в выборке": 1, "Доступность раздела": "Доступен сразу", "Зависит от разделов": "" },
        { "Раздел": "Основной", "Порядок": 2, "Вопросов в выборке": 1, "Доступность раздела": "После завершения выбранных разделов", "Зависит от разделов": "Вводный" },
      ],
    });
    const res = await postWorkbook(buf);

    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    const flow = (testSettingsMock.save.mock.calls[0][1] as any).test.flowPolicyJson;
    expect(flow.mode).toBe("router_by_topics");
    expect(flow.router.sectionUnlockRules[mainTopic.id]).toEqual({
      mode: "after_sections_completed",
      sectionIds: [introTopic.id],
    });
  });

  // Молча выброшенная зависимость ОТКРЫЛА бы раздел, который должен быть закрыт.
  it("имя зависимости не из разделов книги → ошибка строки", async () => {
    const buf = await makeWorkbook({
      "Настройки": [routerRow],
      "Структура": [
        { "Раздел": "Основной", "Порядок": 1, "Вопросов в выборке": 1, "Доступность раздела": "После успешного прохождения выбранных разделов", "Зависит от разделов": "Отсутствующий" },
      ],
    });
    const res = await postWorkbook(buf);

    expect(res.body.errors.some((e: string) => /Отсутствующий/.test(e))).toBe(true);
  });

  it("книга без колонок правил не трогает разблокировку", async () => {
    const buf = await makeWorkbook({
      "Настройки": [routerRow],
      "Структура": [{ "Раздел": "Вводный", "Порядок": 1, "Вопросов в выборке": 1 }],
    });
    const res = await postWorkbook(buf);

    expect(res.body.errors).toEqual([]);
    const flow = (testSettingsMock.save.mock.calls[0][1] as any).test.flowPolicyJson;
    expect(flow.router).not.toHaveProperty("sectionUnlockRules");
  });
});

// ─── PRD-48: отказ службы настроек виден построчно ───────────────────────────
// Служба запрещает сочетания, которые редактор не даст даже собрать (адаптивный
// режим в плоском сценарии). Раньше её исключение доходило до роута и
// становилось ответом 500 «Failed to import workbook»: автор видел отказ без
// единого слова о причине.

describe("POST /:id/workbook/import — отказ службы настроек", () => {
  const finTopic = {
    id: "t-fin", name: "Финансы", description: null, folderId: null, createdAt: new Date(),
  };

  beforeEach(() => {
    storageMock.getTopics.mockResolvedValue([finTopic]);
    // Мок службы прогоняет НАСТОЯЩУЮ проверку сценария — иначе тест доказывал бы
    // только то, что мок умеет бросать.
    testSettingsMock.save.mockImplementation(async (_id: string, payload: any) => {
      const violations = validateFlowPolicy(payload.test, payload.sections, payload.adaptiveSettings);
      if (violations.length > 0) throw new FlowPolicyValidationError(violations);
      return { id: "test-1" };
    });
  });

  it("недопустимое сочетание настроек → ошибка в результате, а не исключение", async () => {
    const buf = await makeWorkbook({
      "Настройки": [
        { "Параметр": "Режим теста", "Значение": "Адаптивный" },
        { "Параметр": "Сценарий прохождения", "Значение": "Линейный" },
      ],
      "Структура": [{ "Раздел": "Финансы", "Порядок": 1, "Вопросов в выборке": 2 }],
    });
    const res = await postWorkbook(buf);

    expect(res.status).toBe(200);
    expect(res.body.errors.some((e: string) => /адаптивн/i.test(e))).toBe(true);
    expect(res.body.errors.every((e: string) => e.startsWith("Настройки теста:"))).toBe(true);
  });
});

// ─── PRD-48 §4.1: лист «Настройки», параметр «Папка» ─────────────────────────

describe("POST /:id/workbook/import — «Настройки»: папка теста", () => {
  /** A one-parameter «Настройки» sheet: a «Папка» row and nothing else. */
  const folderBook = (path: string) =>
    makeWorkbook({ "Настройки": [{ "Параметр": "Папка", "Значение": path }] });

  it("«Папка» создаёт недостающие папки и кладёт тест в последнюю", async () => {
    storageMock.getTestFolders.mockResolvedValue([]);
    storageMock.createTestFolder
      .mockResolvedValueOnce({ id: "f1", name: "Аттестация", parentId: null })
      .mockResolvedValueOnce({ id: "f2", name: "2026", parentId: "f1" });

    const res = await postWorkbook(await folderBook("Аттестация / 2026"));

    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(storageMock.createTestFolder).toHaveBeenCalledTimes(2);
    expect(storageMock.createTestFolder).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ name: "Аттестация", parentId: null }),
    );
    expect(storageMock.createTestFolder).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ name: "2026", parentId: "f1" }),
    );
    expect(testSettingsMock.save).toHaveBeenCalledWith(
      "test-1",
      expect.objectContaining({ test: expect.objectContaining({ folderId: "f2" }) }),
    );
  });

  it("существующая папка не создаётся повторно", async () => {
    storageMock.getTestFolders.mockResolvedValue([{ id: "f1", name: "Аттестация", parentId: null }]);
    storageMock.createTestFolder.mockResolvedValue({ id: "f2", name: "2026", parentId: "f1" });

    const res = await postWorkbook(await folderBook("Аттестация / 2026"));

    expect(res.status).toBe(200);
    expect(storageMock.createTestFolder).toHaveBeenCalledTimes(1);
    expect(storageMock.createTestFolder).toHaveBeenCalledWith(
      expect.objectContaining({ name: "2026", parentId: "f1" }),
    );
    expect(testSettingsMock.save).toHaveBeenCalledWith(
      "test-1",
      expect.objectContaining({ test: expect.objectContaining({ folderId: "f2" }) }),
    );
  });

  it("путь из одного имени кладёт тест в корневую папку", async () => {
    storageMock.getTestFolders.mockResolvedValue([]);
    storageMock.createTestFolder.mockResolvedValue({ id: "f1", name: "Аттестация", parentId: null });

    await postWorkbook(await folderBook("Аттестация"));

    expect(storageMock.createTestFolder).toHaveBeenCalledTimes(1);
    expect(testSettingsMock.save).toHaveBeenCalledWith(
      "test-1",
      expect.objectContaining({ test: expect.objectContaining({ folderId: "f1" }) }),
    );
  });

  it("dryRun не создаёт папок и ничего не сохраняет", async () => {
    storageMock.getTestFolders.mockResolvedValue([]);

    const res = await postWorkbook(await folderBook("Аттестация / 2026"), "?dryRun=true");

    expect(res.status).toBe(200);
    expect(storageMock.createTestFolder).not.toHaveBeenCalled();
    expect(testSettingsMock.save).not.toHaveBeenCalled();
  });
});
