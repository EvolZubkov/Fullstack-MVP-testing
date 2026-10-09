/**
 * @module tests/ensure-body
 * @description Тело запроса без парсера (Express 5 оставляет его `undefined`) не должно
 * ронять обработчик, который начинается с деструктуризации. Проверяется и сам middleware,
 * и его действие на настоящем маршруте: без него запрос без `Content-Type` отвечал `500`
 * вместо `400`, а в журнал уходило «Cannot destructure property ... of req.body».
 */
import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { ensureBody } from "../server/middleware/ensure-body";

describe("ensureBody", () => {
  it("подставляет пустой объект вместо неопределённого тела", () => {
    const req = {} as express.Request;
    const next = vi.fn();
    ensureBody(req, {} as express.Response, next);
    expect(req.body).toEqual({});
    expect(next).toHaveBeenCalledOnce();
  });

  it("не трогает уже разобранное тело", () => {
    const body = { confirmTitle: "Тест" };
    const req = { body } as unknown as express.Request;
    ensureBody(req, {} as express.Response, vi.fn());
    expect(req.body).toBe(body);
  });

  // Пустая строка и `null` — это РАЗОБРАННОЕ тело, а не его отсутствие: подменять их
  // значило бы врать обработчику о том, что прислал клиент.
  it("не трогает ложные, но определённые значения", () => {
    const req = { body: null } as unknown as express.Request;
    ensureBody(req, {} as express.Response, vi.fn());
    expect(req.body).toBeNull();
  });

  it("на маршруте с деструктуризацией даёт 400 вместо 500", async () => {
    const app = express();
    app.use(express.json());
    app.use(ensureBody);
    app.post("/thing", (req, res) => {
      const { confirmTitle } = req.body as { confirmTitle?: string };
      if (!confirmTitle) return res.status(400).json({ error: "title_mismatch" });
      res.json({ ok: true });
    });

    // Ни тела, ни заголовка — express.json() не срабатывает, тело остаётся неопределённым.
    const res = await request(app).post("/thing");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("title_mismatch");
  });
});
