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

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";
import * as XLSX from "xlsx";

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
    createTopic: vi.fn(),
    getTestSections: vi.fn(),
    getUser: vi.fn(),
    getContentHashesByTopic: vi.fn(),
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
function makeImportXlsx(rows: Record<string, unknown>[]): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Вопросы");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

/** Читает XLSX-буфер из ответа и возвращает строки */
function parseXlsxResponse(body: Buffer): Record<string, unknown>[] {
  const wb = XLSX.read(body, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws);
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
    const rows = parseXlsxResponse(res.body as Buffer);
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
    const rows = parseXlsxResponse(res.body as Buffer);
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
    const wb = XLSX.read(res.body as Buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const headers = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 })[0];
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

    const buf = makeImportXlsx([singleRow({ "Тема": "Новая тема" })]);
    const res = await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(res.status).toBe(200);
    expect(storageMock.createTopic).toHaveBeenCalledWith({ name: "Новая тема" });
  });

  it("использует существующую тему (без учёта регистра)", async () => {
    storageMock.getTopics.mockResolvedValue([dbTopic]);

    const buf = makeImportXlsx([singleRow({ "Тема": "JAVASCRIPT" })]);
    await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(storageMock.createTopic).not.toHaveBeenCalled();
    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ topicId: "t1" })
    );
  });

  it("не создаёт тему дважды если несколько строк с одной новой темой", async () => {
    storageMock.getTopics.mockResolvedValue([]);
    storageMock.createTopic.mockResolvedValue({ ...dbTopic, id: "t-new", name: "Новая тема" });

    const buf = makeImportXlsx([
      singleRow({ "Тема": "Новая тема", "Текст вопроса": "Q1?" }),
      singleRow({ "Тема": "Новая тема", "Текст вопроса": "Q2?" }),
    ]);
    await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(storageMock.createTopic).toHaveBeenCalledTimes(1);
  });

  it("возвращает ошибку строки если поле Тема пустое", async () => {
    storageMock.getTopics.mockResolvedValue([dbTopic]);

    const buf = makeImportXlsx([singleRow({ "Тема": "" })]);
    const res = await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(res.status).toBe(200);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0]).toMatch(/тема/i);
    expect(storageMock.createTopic).not.toHaveBeenCalled();
  });

  it("сохраняет оригинальный регистр при создании новой темы", async () => {
    storageMock.getTopics.mockResolvedValue([]);
    storageMock.createTopic.mockResolvedValue({ ...dbTopic, name: "Базы Данных" });

    const buf = makeImportXlsx([singleRow({ "Тема": "Базы Данных" })]);
    await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(storageMock.createTopic).toHaveBeenCalledWith({ name: "Базы Данных" });
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

    const buf = makeImportXlsx([singleRow({ "ID": "q1", "Балл": 5 })]);
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

    const buf = makeImportXlsx([singleRow({ "ID": "q1" })]);
    const res = await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(res.body.updated).toBe(1);
    expect(res.body.created).toBe(0);
  });

  it("создаёт новый вопрос если ID не найден", async () => {
    storageMock.getQuestion.mockResolvedValue(undefined);

    const buf = makeImportXlsx([singleRow({ "ID": "nonexistent-id" })]);
    const res = await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(res.status).toBe(200);
    expect(storageMock.createQuestion).toHaveBeenCalled();
    expect(storageMock.updateQuestion).not.toHaveBeenCalled();
  });

  it("ответ содержит created=1 если ID не найден и создан новый", async () => {
    storageMock.getQuestion.mockResolvedValue(undefined);

    const buf = makeImportXlsx([singleRow({ "ID": "nonexistent-id" })]);
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

    const buf = makeImportXlsx([singleRow()]);
    const res = await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(res.body.skipped).toBe(1);
    expect(res.body.created).toBe(0);
    expect(storageMock.createQuestion).not.toHaveBeenCalled();
  });

  it("обновление обновляет все поля включая тип", async () => {
    storageMock.getQuestion.mockResolvedValue(dbQuestion);
    storageMock.getTopics.mockResolvedValue([dbTopic]);

    const buf = makeImportXlsx([singleRow({
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

    const buf = makeImportXlsx([singleRow({ "ID": "q1", "Тема": "TypeScript" })]);
    await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(storageMock.updateQuestion).toHaveBeenCalledWith("q1", expect.objectContaining({
      topicId: "t2",
    }));
  });

  it("дублирующийся ID в файле — обновляется дважды (последняя строка побеждает)", async () => {
    storageMock.getQuestion.mockResolvedValue(dbQuestion);

    const buf = makeImportXlsx([
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

    const buf = makeImportXlsx([singleRow({ "ID": "q1", "Текст вопроса": "New question text?" })]);
    await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    const updateCall = storageMock.updateQuestion.mock.calls[0];
    const updatedData = updateCall[1];
    expect(updatedData.contentHash).toBeDefined();
    expect(updatedData.contentHash).not.toBe("abc123");
  });

  it("ответ содержит поля created, updated, skipped, errors", async () => {
    storageMock.getQuestion.mockResolvedValue(dbQuestion);

    const buf = makeImportXlsx([singleRow({ "ID": "q1" })]);
    const res = await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(res.body).toHaveProperty("created");
    expect(res.body).toHaveProperty("updated");
    expect(res.body).toHaveProperty("skipped");
    expect(res.body).toHaveProperty("errors");
  });

  it("смешанный файл: часть с ID (update), часть без ID (create)", async () => {
    storageMock.getQuestion.mockResolvedValue(dbQuestion);

    const buf = makeImportXlsx([
      singleRow({ "ID": "q1", "Текст вопроса": "Updated?" }),
      singleRow({ "Текст вопроса": "Brand new question?" }),
    ]);
    const res = await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(res.body.updated).toBe(1);
    expect(res.body.created).toBe(1);
  });

  it("обновление балла и сложности без изменения контента", async () => {
    storageMock.getQuestion.mockResolvedValue(dbQuestion);

    const buf = makeImportXlsx([singleRow({ "ID": "q1", "Балл": 3, "Сложность": 75 })]);
    await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(storageMock.updateQuestion).toHaveBeenCalledWith("q1", expect.objectContaining({
      points: 3,
      difficulty: 75,
    }));
  });

  it("обновление обратной связи", async () => {
    storageMock.getQuestion.mockResolvedValue(dbQuestion);

    const buf = makeImportXlsx([singleRow({ "ID": "q1", "Обратная связь": "Правильно!" })]);
    await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(storageMock.updateQuestion).toHaveBeenCalledWith("q1", expect.objectContaining({
      feedback: "Правильно!",
    }));
  });

  it("ошибка строки если Тип вопроса неизвестен при обновлении по ID", async () => {
    storageMock.getQuestion.mockResolvedValue(dbQuestion);

    const buf = makeImportXlsx([singleRow({ "ID": "q1", "Тип вопроса": "Неизвестный тип" })]);
    const res = await asAuthor(request(app).post("/api/questions/import").attach("file", buf, "q.xlsx"));

    expect(res.body.errors).toHaveLength(1);
    expect(storageMock.updateQuestion).not.toHaveBeenCalled();
  });
});
