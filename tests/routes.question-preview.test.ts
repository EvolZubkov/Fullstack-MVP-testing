/**
 * @module tests/routes.question-preview
 * @description Маршрут предпросмотра задания (PRD-57 FR-24g).
 *
 * Предпросмотр обязан показать то, что увидит участник, а увидит он ПОДСВЕЧЕННЫЙ листинг и
 * формулу картинкой. И подсветка, и MathJax живут только на сервере, поэтому разметка для
 * окна считается здесь — иначе автору показали бы сырые кавычки и доллары.
 *
 * Маршрут ничего не пишет и ничего не читает из базы: это чистое преобразование текста
 * несохранённого задания.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://fake/test";
});

const { storageMock } = vi.hoisted(() => ({
  storageMock: { getQuestions: vi.fn(), getTopics: vi.fn(), getQuestion: vi.fn() },
}));
vi.mock("../server/storage", () => ({ storage: storageMock }));

/** Права: маршрут закрыт чтением вопросов; роль подставляется посередине. */
const { permissionMock } = vi.hoisted(() => ({ permissionMock: vi.fn() }));
vi.mock("../server/middleware/auth", () => ({
  requirePermission: (permission: string) => (req: unknown, res: unknown, next: () => void) => {
    permissionMock(permission);
    next();
  },
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import questionsRouter from "../server/routes/questions";

function app() {
  const server = express();
  server.use(express.json());
  server.use("/api/questions", questionsRouter);
  return server;
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/questions/preview", () => {
  it("отдаёт подсвеченный листинг: библиотека подсветки живёт на сервере", async () => {
    const res = await request(app())
      .post("/api/questions/preview")
      .send({ type: "single", prompt: "Что выведет код?\n\n```sql\nSELECT 1;\n```" });

    expect(res.status).toBe(200);
    expect(res.body.promptHtml).toContain("tb-code");
    expect(res.body.promptHtml).toContain("tb-code__kw");
  });

  it("отдаёт формулу картинкой, а не записью с долларами", async () => {
    const res = await request(app())
      .post("/api/questions/preview")
      .send({ type: "single", prompt: "Формула $$E = mc^2$$ известна всем." });

    expect(res.status).toBe(200);
    expect(res.body.promptHtml).toContain("<svg");
    expect(res.body.promptHtml).toContain("tb-formula");
    expect(res.body.promptHtml).not.toContain("$$E = mc^2$$");
  });

  it("текст без разметки возвращается как есть — считать нечего", async () => {
    const res = await request(app())
      .post("/api/questions/preview")
      .send({ type: "single", prompt: "Обычный вопрос без разметки" });

    expect(res.status).toBe(200);
    // Сравнение по словам: типографика ставит неразрывный пробел перед коротким словом,
    // и буквальное сравнение строки ловило бы её, а не содержание ответа.
    expect(res.body.promptHtml.replace(/\s+/g, " ")).toContain("Обычный вопрос без разметки");
  });

  it("ничего не пишет и не читает из базы", async () => {
    await request(app())
      .post("/api/questions/preview")
      .send({ type: "blanks", prompt: "Столица — {{city}}." });

    for (const call of Object.values(storageMock)) {
      expect(call).not.toHaveBeenCalled();
    }
  });

  it("закрыт правом на чтение вопросов", async () => {
    await request(app()).post("/api/questions/preview").send({ type: "single", prompt: "Текст" });
    expect(permissionMock).toHaveBeenCalledWith("questions.read");
  });

  it("пустой текст — не ошибка: задание может быть ещё не набрано", async () => {
    const res = await request(app()).post("/api/questions/preview").send({ type: "single", prompt: "" });
    expect(res.status).toBe(200);
    expect(res.body.promptHtml).toBe("");
  });

  it("текст не строкой — отказ, а не молчаливая пустота", async () => {
    const res = await request(app()).post("/api/questions/preview").send({ type: "single", prompt: { a: 1 } });
    expect(res.status).toBe(400);
  });
});
