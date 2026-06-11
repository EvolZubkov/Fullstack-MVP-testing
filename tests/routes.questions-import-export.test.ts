/**
 * Tests for questions import/export:
 *
 * Export:
 *   - ID column присутствует и стоит первым
 *   - ID в экспорте совпадает с question.id
 *
 * Import — автосоздание темы:
 *   - Тема создаётся если не найдена
 *   - Существующая тема используется (без учёта регистра)
 *   - Ошибка строки если поле "Тема" пустое
 *
 * Import — обновление по ID:
 *   - ID найден → updateQuestion вызывается со всеми полями
 *   - ID найден → ответ содержит updated++
 *   - ID не найден → createQuestion вызывается, counted as created
 *   - Пустой ID → поведение по хэшу (skip дубль / create новый)
 *   - Смена типа через ID разрешена
 *   - Смена темы через ID — вопрос переносится в новую тему
 *   - Дублирующийся ID в файле → последняя строка побеждает
 *   - contentHash пересчитывается при обновлении
 *   - Ответ содержит { created, updated, skipped, errors }
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";
import ExcelJS from "exceljs";
import {
  addJsonSheet,
  readWorkbookFromBuffer,
  sheetToArrays,
  sheetToObjects,
  workbookToBuffer,
} from "../server/utils/excel";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
// DATABASE_URL нужен чтобы db.ts не падал при загрузке модуля (storage замокан)
vi.hoisted(() => { process.env.DATABASE_URL = "postgresql://fake/test"; });

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getQuestions: vi.fn(),
    getQuestion: vi.fn(),
    createQuestion: vi.fn(),
    updateQuestion: vi.fn(),
    deleteQuestion: vi.fn(),
    getTopics: vi.fn(),
    getTopic: vi.fn(),
    createTopic: vi.fn(),
    getTestSections: vi.fn(),
    getUser: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    // PRD-15 block C: topic visibility scope for FR-28 import matching.
    getUserGroups: vi.fn().mockResolvedValue([]),
    getSharedTopicIds: vi.fn().mockResolvedValue([]),
    getTopicIdsByOwner: vi.fn().mockResolvedValue([]),
    getActiveTopicGrantsForGrantees: vi.fn().mockResolvedValue([]),
    getContentHashesByTopic: vi.fn(),
    // referential protection (PRD-15 FR-03..FR-05): defaults = no dependents,
    // so import updates pass the draw-feasibility guard.
    getQuestionsByTopic: vi.fn().mockResolvedValue([]),
    getTestsUsingTopic: vi.fn().mockResolvedValue([]),
    getTestSectionsByTopic: vi.fn().mockResolvedValue([]),
    getMeasurementsForQuestions: vi.fn().mockResolvedValue([]),
    getTopicPageRefs: vi.fn().mockResolvedValue([]),
    getAdaptiveLevels: vi.fn().mockResolvedValue([]),
    getTest: vi.fn(),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));

import questionsRouter from "../server/routes/questions";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const authorUser = {
  id: "author1", email: "a@test.com", name: "Author", role: "author",
  status: "active", mustChangePassword: false, gdprConsent: true,
  passwordHash: "x", emailHash: "x", createdAt: new Date(), lastLoginAt: null, createdBy: null,
};

const dbTopic = { id: "t1", name: "JavaScript", description: null, folderId: null, createdAt: new Date() };
const dbTopic2 = { id: "t2", name: "TypeScript", description: null, folderId: null, createdAt: new Date() };

const dbQuestion = {
  id: "q1", topicId: "t1", type: "single", prompt: "What is JS?",
  dataJson: { options: ["A", "B"] }, correctJson: { correctIndex: 0 },
  points: 1, difficulty: 50, shuffleAnswers: true,
  feedback: null, contentHash: "abc123",
  feedbackMode: "general", feedbackCorrect: null, feedbackIncorrect: null,
  mediaUrl: null, mediaType: null, createdAt: new Date(),
};

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    next();
  });
  app.use("/api/questions", questionsRouter);
  return app;
}

function asAuthor(req: request.Test) {
  return req.set("x-test-user", "author1");
}

/** Строит XLSX-буфер из массива объектов (имитирует экспортированный файл) */
async function makeImportXlsx(rows: Record<string, unknown>[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  addJsonSheet(wb, "Вопросы", rows);
  return workbookToBuffer(wb);
}

/** Читает XLSX-буфер из ответа и возвращает строки */
async function parseXlsxResponse(body: Buffer): Promise<Record<string, unknown>[]> {
  const wb = await readWorkbookFromBuffer(body);
  return sheetToObjects(wb.worksheets[0]);
}

/** Минимальная строка импорта с одиночным вопросом */
function singleRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "Тема": "JavaScript",
    "Тип вопроса": "multiple_choice",
    "Текст вопроса": "What is JS?",
    "Балл": 1,
    "Сложность": 50,
    "Тексты вариантов ответа": "A#B",
    "Номера правильных ответов": "1",
    "Следование вариантов ответов": "Random",
    "Обратная связь": "",
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT — колонка ID
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /export — ID column", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getQuestions.mockResolvedValue([dbQuestion]);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    app = makeApp();
  });

  it("экспорт содержит колонку ID", async () => {
    const res = await asAuthor(
      request(app).get("/api/questions/export").buffer(true).parse((r: any, cb: any) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      })
    );
    expect(res.status).toBe(200);
    const rows = await parseXlsxResponse(res.body as Buffer);
    expect(rows[0]).toHaveProperty("ID");
  });

  it("ID в экспорте совпадает с question.id", async () => {
    const res = await asAuthor(
      request(app).get("/api/questions/export").buffer(true).parse((r: any, cb: any) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      })
    );
    const rows = await parseXlsxResponse(res.body as Buffer);
    expect(rows[0]["ID"]).toBe("q1");
  });

  it("ID стоит первым столбцом в экспорте", async () => {
    const res = await asAuthor(
      request(app).get("/api/questions/export").buffer(true).parse((r: any, cb: any) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      })
    );
    const wb = await readWorkbookFromBuffer(res.body as Buffer);
    const headers = sheetToArrays(wb.worksheets[0])[0] as string[];
    expect(headers[0]).toBe("ID");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IMPORT — автосоздание темы
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /import — автосоздание темы", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getContentHashesByTopic.mockResolvedValue(new Set());
    storageMock.createQuestion.mockResolvedValue({ ...dbQuestion });
    app = makeApp();
  });

  it("создаёт тему если она не найдена", async () => {
    storageMock.getTopics.mockResolvedValue([]);
    storageMock.createTopic.mockResolvedValue({ ...dbTopic, name: "Новая тема" });

    const buf = await makeImportXlsx([singleRow({ "Тема": "Новая тема" })]);
    const res = await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(res.status).toBe(200);
    // FR-28: new topics created by import are owned by the importer.
    expect(storageMock.createTopic).toHaveBeenCalledWith({ name: "Новая тема", createdBy: "author1" });
  });

  it("использует существующую тему (без учёта регистра)", async () => {
    storageMock.getTopics.mockResolvedValue([dbTopic]);

    const buf = await makeImportXlsx([singleRow({ "Тема": "JAVASCRIPT" })]);
    await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(storageMock.createTopic).not.toHaveBeenCalled();
    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ topicId: "t1" })
    );
  });

  it("не создаёт тему дважды если несколько строк с одной новой темой", async () => {
    storageMock.getTopics.mockResolvedValue([]);
    storageMock.createTopic.mockResolvedValue({ ...dbTopic, id: "t-new", name: "Новая тема" });

    const buf = await makeImportXlsx([
      singleRow({ "Тема": "Новая тема", "Текст вопроса": "Q1?" }),
      singleRow({ "Тема": "Новая тема", "Текст вопроса": "Q2?" }),
    ]);
    await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(storageMock.createTopic).toHaveBeenCalledTimes(1);
  });

  it("возвращает ошибку строки если поле Тема пустое", async () => {
    storageMock.getTopics.mockResolvedValue([dbTopic]);

    const buf = await makeImportXlsx([singleRow({ "Тема": "" })]);
    const res = await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(res.status).toBe(200);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0]).toMatch(/тема/i);
    expect(storageMock.createTopic).not.toHaveBeenCalled();
  });

  it("сохраняет оригинальный регистр при создании новой темы", async () => {
    storageMock.getTopics.mockResolvedValue([]);
    storageMock.createTopic.mockResolvedValue({ ...dbTopic, name: "Базы Данных" });

    const buf = await makeImportXlsx([singleRow({ "Тема": "Базы Данных" })]);
    await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(storageMock.createTopic).toHaveBeenCalledWith({ name: "Базы Данных", createdBy: "author1" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IMPORT — PRD-15 FR-28: visible-area matching, importer-owned new topics
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /import — FR-28 visible-area topic matching (non-admin author)", () => {
  let app: express.Express;
  // An author who only sees the shared bank; private topics of others are hidden.
  const foreignTopic = { id: "t-foreign", name: "Секретная", description: null, folderId: null, ownerId: "other", visibility: "private", createdAt: new Date() };

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getUserRoles.mockResolvedValue(["author"]); // non-admin
    storageMock.getContentHashesByTopic.mockResolvedValue(new Set());
    storageMock.createQuestion.mockResolvedValue({ ...dbQuestion });
    app = makeApp();
  });

  // clearAllMocks keeps implementations, so restore the admin default this
  // suite overrode — otherwise later describes inherit the "author" roles.
  afterEach(() => {
    storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  });

  it("does NOT match a name that exists only outside the importer's visible area", async () => {
    // The topic exists but is invisible (private, other owner) -> a new topic is
    // created, owned by the importer, instead of matching the foreign one.
    storageMock.getTopics.mockResolvedValue([foreignTopic]);
    storageMock.createTopic.mockResolvedValue({ ...foreignTopic, id: "t-mine", ownerId: "author1" });

    const buf = await makeImportXlsx([singleRow({ "Тема": "Секретная" })]);
    const res = await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(res.status).toBe(200);
    expect(storageMock.createTopic).toHaveBeenCalledWith({ name: "Секретная", createdBy: "author1" });
    // The created (importer-owned) topic is used, not the foreign one.
    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ topicId: "t-mine" }),
    );
  });

  it("denies updating a question whose topic the importer does not manage", async () => {
    storageMock.getTopics.mockResolvedValue([foreignTopic]);
    storageMock.getQuestion.mockResolvedValue({ ...dbQuestion, topicId: "t-foreign" });
    storageMock.getTopic.mockResolvedValue(foreignTopic);

    const buf = await makeImportXlsx([singleRow({ "ID": "q1", "Тема": "Секретная" })]);
    const res = await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(0);
    expect(res.body.errors.join(" ")).toContain("управляемой вами теме");
    expect(storageMock.updateQuestion).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IMPORT — обновление по ID
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /import — обновление по ID", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getTopics.mockResolvedValue([dbTopic, dbTopic2]);
    storageMock.getContentHashesByTopic.mockResolvedValue(new Set());
    storageMock.createQuestion.mockResolvedValue({ ...dbQuestion });
    storageMock.updateQuestion.mockResolvedValue({ ...dbQuestion });
    app = makeApp();
  });

  it("вызывает updateQuestion когда ID найден", async () => {
    storageMock.getQuestion.mockResolvedValue(dbQuestion);

    const buf = await makeImportXlsx([singleRow({ "ID": "q1", "Балл": 5 })]);
    const res = await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(res.status).toBe(200);
    expect(storageMock.updateQuestion).toHaveBeenCalledWith("q1", expect.objectContaining({
      prompt: "What is JS?",
      topicId: "t1",
      points: 5,
    }));
    expect(storageMock.createQuestion).not.toHaveBeenCalled();
  });

  it("ответ содержит updated=1 при обновлении", async () => {
    storageMock.getQuestion.mockResolvedValue(dbQuestion);

    const buf = await makeImportXlsx([singleRow({ "ID": "q1" })]);
    const res = await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(res.body.updated).toBe(1);
    expect(res.body.created).toBe(0);
  });

  it("создаёт новый вопрос если ID не найден", async () => {
    storageMock.getQuestion.mockResolvedValue(undefined);

    const buf = await makeImportXlsx([singleRow({ "ID": "nonexistent-id" })]);
    const res = await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(res.status).toBe(200);
    expect(storageMock.createQuestion).toHaveBeenCalled();
    expect(storageMock.updateQuestion).not.toHaveBeenCalled();
  });

  it("ответ содержит created=1 если ID не найден и создан новый", async () => {
    storageMock.getQuestion.mockResolvedValue(undefined);

    const buf = await makeImportXlsx([singleRow({ "ID": "nonexistent-id" })]);
    const res = await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(res.body.created).toBe(1);
    expect(res.body.updated).toBe(0);
  });

  it("без ID — использует хэш-дедупликацию (пропускает дубль)", async () => {
    const existingHash = require("crypto")
      .createHash("sha256")
      .update(JSON.stringify({ type: "single", prompt: "What is JS?", data: { options: ["A", "B"] } }))
      .digest("hex");
    storageMock.getContentHashesByTopic.mockResolvedValue(new Set([existingHash]));

    const buf = await makeImportXlsx([singleRow()]);
    const res = await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(res.body.skipped).toBe(1);
    expect(res.body.created).toBe(0);
    expect(storageMock.createQuestion).not.toHaveBeenCalled();
  });

  it("обновление обновляет все поля включая тип", async () => {
    storageMock.getQuestion.mockResolvedValue(dbQuestion);
    storageMock.getTopics.mockResolvedValue([dbTopic]);

    const buf = await makeImportXlsx([singleRow({
      "ID": "q1",
      "Тип вопроса": "multiple_response",
      "Тексты вариантов ответа": "A#B#C",
      "Номера правильных ответов": "1,2",
    })]);
    await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(storageMock.updateQuestion).toHaveBeenCalledWith("q1", expect.objectContaining({
      type: "multiple",
    }));
  });

  it("смена темы через ID — переносит вопрос в новую тему", async () => {
    storageMock.getQuestion.mockResolvedValue(dbQuestion);

    const buf = await makeImportXlsx([singleRow({ "ID": "q1", "Тема": "TypeScript" })]);
    await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(storageMock.updateQuestion).toHaveBeenCalledWith("q1", expect.objectContaining({
      topicId: "t2",
    }));
  });

  it("дублирующийся ID в файле — обновляется дважды (последняя строка побеждает)", async () => {
    storageMock.getQuestion.mockResolvedValue(dbQuestion);

    const buf = await makeImportXlsx([
      singleRow({ "ID": "q1", "Балл": 2, "Текст вопроса": "First version?" }),
      singleRow({ "ID": "q1", "Балл": 9, "Текст вопроса": "Second version?" }),
    ]);
    await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(storageMock.updateQuestion).toHaveBeenCalledTimes(2);
    const lastCall = storageMock.updateQuestion.mock.calls[1];
    expect(lastCall[1]).toMatchObject({ points: 9, prompt: "Second version?" });
  });

  it("contentHash пересчитывается при обновлении", async () => {
    storageMock.getQuestion.mockResolvedValue(dbQuestion);

    const buf = await makeImportXlsx([singleRow({ "ID": "q1", "Текст вопроса": "New question text?" })]);
    await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    const updateCall = storageMock.updateQuestion.mock.calls[0];
    const updatedData = updateCall[1];
    expect(updatedData.contentHash).toBeDefined();
    expect(updatedData.contentHash).not.toBe("abc123");
  });

  it("ответ содержит поля created, updated, skipped, errors", async () => {
    storageMock.getQuestion.mockResolvedValue(dbQuestion);

    const buf = await makeImportXlsx([singleRow({ "ID": "q1" })]);
    const res = await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(res.body).toHaveProperty("created");
    expect(res.body).toHaveProperty("updated");
    expect(res.body).toHaveProperty("skipped");
    expect(res.body).toHaveProperty("errors");
  });

  it("смешанный файл: часть с ID (update), часть без ID (create)", async () => {
    storageMock.getQuestion.mockResolvedValue(dbQuestion);

    const buf = await makeImportXlsx([
      singleRow({ "ID": "q1", "Текст вопроса": "Updated?" }),
      singleRow({ "Текст вопроса": "Brand new question?" }),
    ]);
    const res = await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(res.body.updated).toBe(1);
    expect(res.body.created).toBe(1);
  });

  it("обновление балла и сложности без изменения контента", async () => {
    storageMock.getQuestion.mockResolvedValue(dbQuestion);

    const buf = await makeImportXlsx([singleRow({ "ID": "q1", "Балл": 3, "Сложность": 75 })]);
    await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(storageMock.updateQuestion).toHaveBeenCalledWith("q1", expect.objectContaining({
      points: 3,
      difficulty: 75,
    }));
  });

  it("обновление обратной связи", async () => {
    storageMock.getQuestion.mockResolvedValue(dbQuestion);

    const buf = await makeImportXlsx([singleRow({ "ID": "q1", "Обратная связь": "Правильно!" })]);
    await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(storageMock.updateQuestion).toHaveBeenCalledWith("q1", expect.objectContaining({
      feedback: "Правильно!",
    }));
  });

  it("ошибка строки если Тип вопроса неизвестен при обновлении по ID", async () => {
    storageMock.getQuestion.mockResolvedValue(dbQuestion);

    const buf = await makeImportXlsx([singleRow({ "ID": "q1", "Тип вопроса": "Неизвестный тип" })]);
    const res = await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(res.body.errors).toHaveLength(1);
    expect(storageMock.updateQuestion).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRD-14 Ф0 — matching: формат "лево || право", дистракторы, непозиционные пары
// ─────────────────────────────────────────────────────────────────────────────

/** Строка matching с разделителем сторон "||" (целевой формат Ф0). */
function matchingRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "Тема": "JavaScript",
    "Тип вопроса": "matching",
    "Текст вопроса": "Сопоставьте звуки",
    "Балл": 1,
    "Сложность": 50,
    "Тексты вариантов ответа": "Кошка # Собака # Рыба || Мяу # Гав # Буль # Кваква",
    "Номера правильных ответов": "1-2, 2-1, 3-3",
    "Следование вариантов ответов": "Random",
    "Обратная связь": "",
    ...overrides,
  };
}

describe("POST /import — matching (PRD-14 Ф0)", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getContentHashesByTopic.mockResolvedValue(new Set());
    storageMock.createQuestion.mockResolvedValue({ ...dbQuestion });
    app = makeApp();
  });

  it("разбирает формат '|| ' с дистракторами и непозиционными парами", async () => {
    const buf = await makeImportXlsx([matchingRow()]);
    const res = await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "matching",
        dataJson: {
          left: ["Кошка", "Собака", "Рыба"],
          right: ["Мяу", "Гав", "Буль", "Кваква"],
        },
        correctJson: {
          pairs: [
            { left: 0, right: 1 },
            { left: 1, right: 0 },
            { left: 2, right: 2 },
          ],
        },
      })
    );
  });

  it("обратная совместимость: без '|| ' старый позиционный разбор", async () => {
    const buf = await makeImportXlsx([
      matchingRow({ "Тексты вариантов ответа": "A#1#B#2", "Номера правильных ответов": "" }),
    ]);
    await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        dataJson: { left: ["A", "B"], right: ["1", "2"] },
        correctJson: { pairs: [{ left: 0, right: 0 }, { left: 1, right: 1 }] },
      })
    );
  });

  it("некорректная пара (вне диапазона) → ошибка строки, без создания", async () => {
    const buf = await makeImportXlsx([matchingRow({ "Номера правильных ответов": "1-9" })]);
    const res = await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0]).toMatch(/пара/i);
    expect(storageMock.createQuestion).not.toHaveBeenCalled();
  });

  it("пустые пары при '|| ' → позиционный fallback", async () => {
    const buf = await makeImportXlsx([
      matchingRow({
        "Тексты вариантов ответа": "A # B || X # Y",
        "Номера правильных ответов": "",
      }),
    ]);
    await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        correctJson: { pairs: [{ left: 0, right: 0 }, { left: 1, right: 1 }] },
      })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRD-14 Ф0 — ranking: явный правильный порядок
// ─────────────────────────────────────────────────────────────────────────────

/** Строка ranking. */
function rankingRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "Тема": "JavaScript",
    "Тип вопроса": "ranking",
    "Текст вопроса": "Расставьте по порядку",
    "Балл": 1,
    "Сложность": 50,
    "Тексты вариантов ответа": "Шаг А # Шаг Б # Шаг В",
    "Номера правильных ответов": "3,1,2",
    "Следование вариантов ответов": "Fixed",
    "Обратная связь": "",
    ...overrides,
  };
}

describe("POST /import — ranking (PRD-14 Ф0)", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getContentHashesByTopic.mockResolvedValue(new Set());
    storageMock.createQuestion.mockResolvedValue({ ...dbQuestion });
    app = makeApp();
  });

  it("читает явный порядок как 1-based перестановку", async () => {
    const buf = await makeImportXlsx([rankingRow()]);
    const res = await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(res.body.created).toBe(1);
    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        dataJson: { items: ["Шаг А", "Шаг Б", "Шаг В"] },
        correctJson: { correctOrder: [2, 0, 1] },
      })
    );
  });

  it("обратная совместимость: пустой порядок → элементы уже в правильном порядке", async () => {
    const buf = await makeImportXlsx([rankingRow({ "Номера правильных ответов": "" })]);
    await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ correctJson: { correctOrder: [0, 1, 2] } })
    );
  });

  it("не-перестановка (дубликаты позиций) → ошибка строки", async () => {
    const buf = await makeImportXlsx([rankingRow({ "Номера правильных ответов": "1,1,2" })]);
    const res = await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0]).toMatch(/порядок/i);
    expect(storageMock.createQuestion).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRD-14 Ф0 — Балл/Сложность = 0 сохраняются; диапазон сложности
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /import — Балл/Сложность = 0 (PRD-14 Ф0)", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getContentHashesByTopic.mockResolvedValue(new Set());
    storageMock.createQuestion.mockResolvedValue({ ...dbQuestion });
    app = makeApp();
  });

  it("Балл = 0 и Сложность = 0 сохраняются как 0, а не подменяются", async () => {
    const buf = await makeImportXlsx([singleRow({ "Балл": 0, "Сложность": 0 })]);
    await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ points: 0, difficulty: 0 })
    );
  });

  it("Сложность вне диапазона 0..100 → ошибка строки", async () => {
    const buf = await makeImportXlsx([singleRow({ "Сложность": 150 })]);
    const res = await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0]).toMatch(/сложност/i);
    expect(storageMock.createQuestion).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRD-14 Ф0 — FR-05: согласование Режима ОС при обновлении по ID
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /import — feedbackMode sync (PRD-14 Ф0)", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getContentHashesByTopic.mockResolvedValue(new Set());
    storageMock.updateQuestion.mockResolvedValue({ ...dbQuestion });
    app = makeApp();
  });

  it("переданная обратная связь выставляет feedbackMode='general'", async () => {
    storageMock.getQuestion.mockResolvedValue(dbQuestion);

    const buf = await makeImportXlsx([singleRow({ "ID": "q1", "Обратная связь": "Молодец!" })]);
    await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(storageMock.updateQuestion).toHaveBeenCalledWith(
      "q1",
      expect.objectContaining({ feedback: "Молодец!", feedbackMode: "general" })
    );
  });

  it("пустая обратная связь не трогает feedbackMode", async () => {
    storageMock.getQuestion.mockResolvedValue(dbQuestion);

    const buf = await makeImportXlsx([singleRow({ "ID": "q1", "Обратная связь": "" })]);
    await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    const call = storageMock.updateQuestion.mock.calls[0];
    expect(call[1]).not.toHaveProperty("feedbackMode");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRD-14 Ф0 — round-trip: экспорт matching → импорт того же файла
// ─────────────────────────────────────────────────────────────────────────────

describe("Round-trip matching (PRD-14 Ф0)", () => {
  const matchingQuestion = {
    ...dbQuestion,
    id: "m1",
    type: "matching",
    prompt: "Сопоставьте звуки",
    dataJson: { left: ["Кошка", "Собака", "Рыба"], right: ["Мяу", "Гав", "Буль", "Кваква"] },
    correctJson: { pairs: [{ left: 0, right: 1 }, { left: 1, right: 0 }, { left: 2, right: 2 }] },
  };

  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getContentHashesByTopic.mockResolvedValue(new Set());
    storageMock.createQuestion.mockResolvedValue({ ...matchingQuestion });
    app = makeApp();
  });

  it("экспорт пишет 'лево || право' и пары, импорт воспроизводит вопрос без потерь", async () => {
    storageMock.getQuestions.mockResolvedValue([matchingQuestion]);

    // 1) Экспорт
    const exportRes = await asAuthor(
      request(app).get("/api/questions/export").buffer(true).parse((r: any, cb: any) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      })
    );
    const rows = await parseXlsxResponse(exportRes.body as Buffer);
    expect(rows[0]["Тексты вариантов ответа"]).toBe("Кошка # Собака # Рыба || Мяу # Гав # Буль # Кваква");
    expect(rows[0]["Номера правильных ответов"]).toBe("1-2, 2-1, 3-3");

    // 2) Импорт того же файла (без ID, чтобы шёл путь создания)
    const reimport = await makeImportXlsx([
      {
        "Тема": "JavaScript",
        "Тип вопроса": rows[0]["Тип вопроса"],
        "Текст вопроса": rows[0]["Текст вопроса"],
        "Балл": rows[0]["Балл"],
        "Сложность": rows[0]["Сложность"],
        "Тексты вариантов ответа": rows[0]["Тексты вариантов ответа"],
        "Номера правильных ответов": rows[0]["Номера правильных ответов"],
        "Следование вариантов ответов": rows[0]["Следование вариантов ответов"],
        "Обратная связь": rows[0]["Обратная связь"],
      },
    ]);
    await asAuthor(request(app).post("/api/questions/import").attach("file", reimport, "q.xlsx"));

    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "matching",
        dataJson: matchingQuestion.dataJson,
        correctJson: matchingQuestion.correctJson,
      })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRD-14 Ф1 — Теги (FR-06)
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /import — Теги (PRD-14 Ф1)", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getContentHashesByTopic.mockResolvedValue(new Set());
    storageMock.createQuestion.mockResolvedValue({ ...dbQuestion });
    app = makeApp();
  });

  it("разбирает теги с разделителями ';' и ',' и нормализует", async () => {
    const buf = await makeImportXlsx([singleRow({ "Теги": "alpha; beta , alpha , Gamma" })]);
    await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ["alpha", "beta", "Gamma"] })
    );
  });

  it("экспорт пишет теги через '; '", async () => {
    storageMock.getQuestions.mockResolvedValue([{ ...dbQuestion, tags: ["финансы", "учёт"] }]);

    const res = await asAuthor(
      request(app).get("/api/questions/export").buffer(true).parse((r: any, cb: any) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      })
    );
    const rows = await parseXlsxResponse(res.body as Buffer);
    expect(rows[0]["Теги"]).toBe("финансы; учёт");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRD-14 Ф1 — условная обратная связь (FR-07)
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /import — условная ОС (PRD-14 Ф1)", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getContentHashesByTopic.mockResolvedValue(new Set());
    storageMock.createQuestion.mockResolvedValue({ ...dbQuestion });
    app = makeApp();
  });

  it("Режим ОС=условная → conditional + correct/incorrect, общая обнуляется", async () => {
    const buf = await makeImportXlsx([
      singleRow({
        "Режим ОС": "условная",
        "Обратная связь": "общий текст",
        "ОС при верном": "Верно!",
        "ОС при неверном": "Неверно!",
      }),
    ]);
    await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        feedbackMode: "conditional",
        feedback: null,
        feedbackCorrect: "Верно!",
        feedbackIncorrect: "Неверно!",
      })
    );
  });

  it("Режим ОС=общая → general + текст из «Обратная связь»", async () => {
    const buf = await makeImportXlsx([
      singleRow({ "Режим ОС": "общая", "Обратная связь": "Общий", "ОС при верном": "X" }),
    ]);
    await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        feedbackMode: "general",
        feedback: "Общий",
        feedbackCorrect: null,
        feedbackIncorrect: null,
      })
    );
  });

  it("экспорт условного вопроса пишет режим и тексты", async () => {
    storageMock.getQuestions.mockResolvedValue([
      {
        ...dbQuestion,
        feedbackMode: "conditional",
        feedback: null,
        feedbackCorrect: "Молодец",
        feedbackIncorrect: "Подучи",
      },
    ]);

    const res = await asAuthor(
      request(app).get("/api/questions/export").buffer(true).parse((r: any, cb: any) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      })
    );
    const rows = await parseXlsxResponse(res.body as Buffer);
    expect(rows[0]["Режим ОС"]).toBe("условная");
    expect(rows[0]["ОС при верном"]).toBe("Молодец");
    expect(rows[0]["ОС при неверном"]).toBe("Подучи");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRD-14 Ф1 — Цена ответа (FR-08..FR-10)
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /import — Цена ответа (PRD-14 Ф1)", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getContentHashesByTopic.mockResolvedValue(new Set());
    storageMock.createQuestion.mockResolvedValue({ ...dbQuestion });
    app = makeApp();
  });

  it("weighted (single) разбирается и попадает в scoringJson", async () => {
    const buf = await makeImportXlsx([
      singleRow({ "Тексты вариантов ответа": "A#B#C", "Цена ответа": "веса: 2 # 0 # 1" }),
    ]);
    await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ scoringJson: { kind: "weighted", weights: [2, 0, 1] } })
    );
  });

  it("tiered (multiple) разбирается", async () => {
    const buf = await makeImportXlsx([
      singleRow({
        "Тип вопроса": "multiple_response",
        "Тексты вариантов ответа": "A#B#C",
        "Номера правильных ответов": "1,2",
        "Цена ответа": "ступени: c==T & x==0 => 2; c>=1 => 1",
      }),
    ]);
    await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        scoringJson: {
          kind: "tiered",
          tiers: [
            { when: { all: [{ lhs: "c", op: "==", rhs: "T" }, { lhs: "x", op: "==", rhs: 0 }] }, score: 2 },
            { when: { all: [{ lhs: "c", op: ">=", rhs: 1 }] }, score: 1 },
          ],
        },
      })
    );
  });

  it("невалидная «Цена ответа» → ошибка строки, без создания", async () => {
    const buf = await makeImportXlsx([
      singleRow({ "Тексты вариантов ответа": "A#B#C", "Цена ответа": "ступени: c>=1 => 1" }),
    ]);
    const res = await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    // ступени для single недопустимы
    expect(res.body.errors).toHaveLength(1);
    expect(storageMock.createQuestion).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRD-14 Ф1 — FR-11: пустая ячейка vs отсутствие колонки (обновление по ID)
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /import — FR-11 (PRD-14 Ф1)", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getContentHashesByTopic.mockResolvedValue(new Set());
    storageMock.getQuestion.mockResolvedValue(dbQuestion);
    storageMock.updateQuestion.mockResolvedValue({ ...dbQuestion });
    app = makeApp();
  });

  it("отсутствие колонки → поле не входит в payload обновления", async () => {
    // Минимальный файл: только обязательные колонки + ID, без Балл/Теги/Цена ответа.
    const buf = await makeImportXlsx([
      {
        "ID": "q1",
        "Тема": "JavaScript",
        "Тип вопроса": "multiple_choice",
        "Текст вопроса": "What is JS?",
        "Тексты вариантов ответа": "A#B",
        "Номера правильных ответов": "1",
      },
    ]);
    await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    const payload = storageMock.updateQuestion.mock.calls[0][1];
    expect(payload).not.toHaveProperty("points");
    expect(payload).not.toHaveProperty("difficulty");
    expect(payload).not.toHaveProperty("tags");
    expect(payload).not.toHaveProperty("scoringJson");
    expect(payload).not.toHaveProperty("feedback");
    // обязательные поля присутствуют
    expect(payload).toMatchObject({ topicId: "t1", type: "single", prompt: "What is JS?" });
  });

  it("присутствие колонки с пустым значением → сброс к умолчанию", async () => {
    const buf = await makeImportXlsx([singleRow({ "ID": "q1", "Теги": "" })]);
    await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    const payload = storageMock.updateQuestion.mock.calls[0][1];
    expect(payload).toHaveProperty("tags");
    expect(payload.tags).toEqual([]);
  });

  it("присутствие колонки Теги со значением → теги обновляются", async () => {
    const buf = await makeImportXlsx([singleRow({ "ID": "q1", "Теги": "x; y" })]);
    await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(storageMock.updateQuestion).toHaveBeenCalledWith(
      "q1",
      expect.objectContaining({ tags: ["x", "y"] })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRD-14 Ф2 — шаблон (FR-12)
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /template (PRD-14 Ф2)", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    app = makeApp();
  });

  it("отдаёт книгу с листами «Вопросы» и «Справка», ID — первый заголовок", async () => {
    const res = await asAuthor(
      request(app).get("/api/questions/template").buffer(true).parse((r: any, cb: any) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      })
    );
    expect(res.status).toBe(200);
    const wb = await readWorkbookFromBuffer(res.body as Buffer);
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toContain("Вопросы");
    expect(names).toContain("Справка");

    const headers = sheetToArrays(wb.getWorksheet("Вопросы")!)[0] as string[];
    expect(headers[0]).toBe("ID");
    expect(headers).toContain("Цена ответа");
    expect(headers).toContain("Теги");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRD-14 Ф2 — предпросмотр импорта (dry-run, FR-13)
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /import?dryRun=true (PRD-14 Ф2)", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getContentHashesByTopic.mockResolvedValue(new Set());
    app = makeApp();
  });

  it("считает план создания, но не пишет в БД", async () => {
    const buf = await makeImportXlsx([singleRow()]);
    const res = await asAuthor(
      request(app).post("/api/questions/import?dryRun=true").attach("file", buf, "q.xlsx")
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: 1, dryRun: true });
    expect(storageMock.createQuestion).not.toHaveBeenCalled();
  });

  it("считает план обновления по ID, но не пишет", async () => {
    storageMock.getQuestion.mockResolvedValue(dbQuestion);

    const buf = await makeImportXlsx([singleRow({ "ID": "q1" })]);
    const res = await asAuthor(
      request(app).post("/api/questions/import?dryRun=true").attach("file", buf, "q.xlsx")
    );

    expect(res.body).toMatchObject({ updated: 1, dryRun: true });
    expect(storageMock.updateQuestion).not.toHaveBeenCalled();
  });

  it("не создаёт новую тему в режиме предпросмотра", async () => {
    storageMock.getTopics.mockResolvedValue([]);

    const buf = await makeImportXlsx([singleRow({ "Тема": "Совсем новая тема" })]);
    const res = await asAuthor(
      request(app).post("/api/questions/import?dryRun=true").attach("file", buf, "q.xlsx")
    );

    expect(res.body).toMatchObject({ created: 1, dryRun: true });
    expect(storageMock.createTopic).not.toHaveBeenCalled();
  });

  it("ошибки строк попадают в план предпросмотра", async () => {
    const buf = await makeImportXlsx([singleRow({ "Сложность": 150 })]);
    const res = await asAuthor(
      request(app).post("/api/questions/import?dryRun=true").attach("file", buf, "q.xlsx")
    );

    expect(res.body.dryRun).toBe(true);
    expect(res.body.errors).toHaveLength(1);
    expect(storageMock.createQuestion).not.toHaveBeenCalled();
  });
});
