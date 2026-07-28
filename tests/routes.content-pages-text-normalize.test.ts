/**
 * @module tests/routes.content-pages-text-normalize
 * @description Canonical form for the plain-text fields of a content page.
 *
 * `text` and `textarea` placeholders hold author text, exactly like a question
 * prompt does, and they are stored the same way: LF endings, no edge whitespace,
 * at most one blank line. `richText`/`html` values are markup and stay in the
 * hands of the sanitiser — normalising line breaks there could reflow the markup.
 *
 * Harness mirrors tests/routes.content-pages.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

const { storageMock, dbMock } = vi.hoisted(() => {
  const storageMock = {
    getTest: vi.fn(),
    getTestSections: vi.fn(),
    getUser: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    getContentPages: vi.fn(),
    getContentPage: vi.fn(),
    createContentPage: vi.fn(),
    updateContentPage: vi.fn(),
    deleteContentPage: vi.fn(),
    reorderContentPages: vi.fn(),
  };

  const makeChain = (result: unknown) => {
    const chain: any = {
      select: vi.fn(),
      from: vi.fn(),
      where: vi.fn(),
      then: (resolve: any) => resolve(result),
    };
    chain.select.mockReturnValue(chain);
    chain.from.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    return chain;
  };

  const dbMock = { _makeChain: makeChain, select: vi.fn() };
  return { storageMock, dbMock };
});

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/db", () => ({ db: dbMock }));
vi.mock("../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import contentPagesRouter from "../server/routes/content-pages";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    req.session.userId = "user-1";
    next();
  });
  app.use("/api/tests", contentPagesRouter);
  return app;
}

const baseTest = {
  id: "test-1",
  title: "Тест",
  ownerId: "user-1",
  status: "draft",
  designSettingsJson: { templateId: "corporate" },
};

const corporateTemplate = {
  id: "corporate",
  name: "Корпоративный",
  version: "1.0.0",
  templateApiVersion: "1.0",
  isActive: true,
  manifest: {
    params: [],
    contentTemplates: [
      {
        key: "intro.hero",
        label: "Введение",
        pageKind: "intro",
        placeholders: [
          { key: "title", type: "text", label: "Заголовок", required: true },
          { key: "note", type: "textarea", label: "Примечание", required: false },
          { key: "body", type: "richText", label: "Текст", required: false },
        ],
      },
    ],
  },
};

const authorUser = { id: "user-1", role: "author", status: "active" };

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getUser.mockResolvedValue(authorUser);
  storageMock.getTest.mockResolvedValue(baseTest);
  storageMock.getTestSections.mockResolvedValue([
    { id: "sec-1", testId: "test-1", topicId: "topic-1", questionsCount: 5 },
  ]);
  storageMock.createContentPage.mockImplementation(async (p: any) => ({ id: "page-1", ...p }));
  dbMock.select.mockReturnValue(dbMock._makeChain([corporateTemplate]));
});

describe("POST /api/tests/:id/content-pages — canonical text fields", () => {
  it("stores a text placeholder in canonical form", async () => {
    const res = await request(makeApp())
      .post("/api/tests/test-1/content-pages")
      .send({
        topicId: "topic-1",
        position: "before_topic",
        type: "intro",
        mode: "template",
        templateKey: "intro.hero",
        valuesJson: { values: { title: "  Заголовок теста  " } },
      });

    expect([200, 201]).toContain(res.status);
    const saved = storageMock.createContentPage.mock.calls[0][0];
    expect(saved.valuesJson.values.title).toBe("Заголовок теста");
  });

  it("stores a textarea placeholder in canonical form", async () => {
    await request(makeApp())
      .post("/api/tests/test-1/content-pages")
      .send({
        topicId: "topic-1",
        position: "before_topic",
        type: "intro",
        mode: "template",
        templateKey: "intro.hero",
        valuesJson: {
          values: { title: "Заголовок", note: " Первая \r\n\r\n\r\n Вторая " },
        },
      });

    const saved = storageMock.createContentPage.mock.calls[0][0];
    expect(saved.valuesJson.values.note).toBe("Первая\n\nВторая");
  });

  it("leaves richText markup alone, it is the sanitiser's business", async () => {
    await request(makeApp())
      .post("/api/tests/test-1/content-pages")
      .send({
        topicId: "topic-1",
        position: "before_topic",
        type: "intro",
        mode: "template",
        templateKey: "intro.hero",
        valuesJson: { values: { title: "Заголовок", body: "<p>Первый</p>\n\n\n<p>Второй</p>" } },
      });

    const saved = storageMock.createContentPage.mock.calls[0][0];
    expect(saved.valuesJson.values.body).toBe("<p>Первый</p>\n\n\n<p>Второй</p>");
  });
});
