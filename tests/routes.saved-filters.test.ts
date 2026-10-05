/**
 * @module tests/routes.saved-filters
 * @description Сохранённые фильтры списков (решение владельца 2026-10-05: сохранение — везде, где
 * есть фильтр): экран обязателен и проверяется правом на сам список, имя и условия обязательны,
 * одноимённый набор — 409, чужой набор — 404.
 */
import express from "express";
import session from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUserRoles: vi.fn(),
    getSavedFilters: vi.fn(),
    createSavedFilter: vi.fn(),
    updateSavedFilter: vi.fn(),
    deleteSavedFilter: vi.fn(),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import savedFiltersRouter from "../server/routes/saved-filters";

const ID = "6f1c2a7e-3b4d-4c5e-8f90-1a2b3c4d5e6f";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    req.session.userId = "u-owner";
    next();
  });
  app.use("/api/saved-filters", savedFiltersRouter);
  return app;
}

const ROW = {
  id: ID, scope: "tests", name: "Опубликованные", conditionsJson: { statuses: ["published"] },
  createdBy: "u-owner", createdAt: new Date(), updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUser.mockResolvedValue({ id: "u-owner", status: "active", email: "a@b.c" });
  storageMock.getUserRoles.mockResolvedValue(["author"]);
});

describe("GET /api/saved-filters", () => {
  it("отдаёт наборы владельца для экрана", async () => {
    storageMock.getSavedFilters.mockResolvedValue([ROW]);
    const res = await request(makeApp()).get("/api/saved-filters?scope=tests");

    expect(res.status).toBe(200);
    expect(res.body.filters).toEqual([{ id: ID, scope: "tests", name: "Опубликованные", conditions: { statuses: ["published"] } }]);
    expect(storageMock.getSavedFilters).toHaveBeenCalledWith("u-owner", "tests");
  });

  it("неизвестный экран — 400", async () => {
    const res = await request(makeApp()).get("/api/saved-filters?scope=analytics");
    expect(res.status).toBe(400);
  });

  it("экран, список которого читателю не виден, — 403", async () => {
    // Автор видит банк и тесты, но не список пользователей.
    const res = await request(makeApp()).get("/api/saved-filters?scope=users");
    expect(res.status).toBe(403);
    expect(storageMock.getSavedFilters).not.toHaveBeenCalled();
  });

  it("без права хотя бы на один список — 403", async () => {
    storageMock.getUserRoles.mockResolvedValue(["learner"]);
    const res = await request(makeApp()).get("/api/saved-filters?scope=tests");
    expect(res.status).toBe(403);
  });
});

describe("POST /api/saved-filters", () => {
  const post = (body: Record<string, unknown>) => request(makeApp()).post("/api/saved-filters").send(body);

  it("сохраняет набор владельца", async () => {
    storageMock.createSavedFilter.mockResolvedValue(ROW);
    const res = await post({ scope: "tests", name: "  Опубликованные ", conditions: { statuses: ["published"] } });

    expect(res.status).toBe(201);
    expect(storageMock.createSavedFilter).toHaveBeenCalledWith({
      scope: "tests", name: "Опубликованные", conditionsJson: { statuses: ["published"] }, createdBy: "u-owner",
    });
    expect(res.body.filter.name).toBe("Опубликованные");
  });

  it("без имени, без условий или с пустыми условиями — 400", async () => {
    expect((await post({ scope: "tests", name: " ", conditions: { statuses: ["published"] } })).status).toBe(400);
    expect((await post({ scope: "tests", name: "Набор" })).status).toBe(400);
    expect((await post({ scope: "tests", name: "Набор", conditions: { statuses: [], author: "" } })).status).toBe(400);
    expect(storageMock.createSavedFilter).not.toHaveBeenCalled();
  });

  it("одноимённый набор экрана — 409 с понятным текстом", async () => {
    storageMock.createSavedFilter.mockRejectedValue(Object.assign(new Error("dup"), { code: "23505" }));
    const res = await post({ scope: "tests", name: "Опубликованные", conditions: { statuses: ["published"] } });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Фильтр с таким именем уже есть");
  });

  it("409 и тогда, когда Drizzle завернул ошибку драйвера (код — в cause)", async () => {
    storageMock.createSavedFilter.mockRejectedValue(
      Object.assign(new Error("Failed query: insert into saved_list_filters"), { cause: { code: "23505" } }),
    );
    const res = await post({ scope: "tests", name: "Опубликованные", conditions: { statuses: ["published"] } });
    expect(res.status).toBe(409);
  });
});

describe("PUT и DELETE /api/saved-filters/:id", () => {
  it("обновляет условия своего набора", async () => {
    storageMock.updateSavedFilter.mockResolvedValue({ ...ROW, conditionsJson: { statuses: ["draft"] } });
    const res = await request(makeApp()).put(`/api/saved-filters/${ID}`).send({ conditions: { statuses: ["draft"] } });

    expect(res.status).toBe(200);
    expect(storageMock.updateSavedFilter).toHaveBeenCalledWith(ID, "u-owner", { conditionsJson: { statuses: ["draft"] } });
  });

  it("чужой или несуществующий набор — 404", async () => {
    storageMock.updateSavedFilter.mockResolvedValue(undefined);
    storageMock.deleteSavedFilter.mockResolvedValue(false);

    expect((await request(makeApp()).put(`/api/saved-filters/${ID}`).send({ name: "Другое" })).status).toBe(404);
    expect((await request(makeApp()).delete(`/api/saved-filters/${ID}`)).status).toBe(404);
    // Не uuid — тоже «нет такого», без похода в базу.
    expect((await request(makeApp()).delete("/api/saved-filters/zzz")).status).toBe(404);
    expect(storageMock.deleteSavedFilter).toHaveBeenCalledTimes(1);
  });

  it("удаляет свой набор — 204", async () => {
    storageMock.deleteSavedFilter.mockResolvedValue(true);
    const res = await request(makeApp()).delete(`/api/saved-filters/${ID}`);
    expect(res.status).toBe(204);
  });
});
