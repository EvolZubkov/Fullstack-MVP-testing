/**
 * @module tests/routes.content-pages-settings
 * @description PRD-22: page SETTINGS (`settings_json`) on the content-pages API.
 *
 * Settings are the variant's `settings[]` values — properties of the page, kept
 * apart from authored content so the two can obey different rules. These tests
 * lock the server side of that contract: only declared keys are stored, values
 * are coerced to the declared type, declared defaults fill an empty value, and a
 * sequence identifier survives a variant that no longer declares it (FR-29).
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

const baseTest = { id: "test-1", title: "Test", mode: "standard", designSettingsJson: {} };
const authorUser = { id: "user-1", role: "author", status: "active" };

/** Template whose gallery variant declares every setting type we care about. */
const templateRow = {
  id: "default",
  name: "Стандартный",
  version: "1.0.0",
  templateApiVersion: "1.0",
  isActive: true,
  manifest: {
    params: [],
    contentTemplates: [
      {
        key: "gallery.card",
        label: "Галерея: карточка",
        kind: "info",
        placeholders: [{ key: "header", type: "text", label: "Заголовок" }],
        settings: [
          { key: "sequenceId", type: "sequence", label: "Последовательность" },
          { key: "nextLabel", type: "text", label: "Подпись кнопки", default: "Далее" },
          { key: "showHint", type: "boolean", label: "Подсказка" },
          { key: "columns", type: "number", label: "Колонки" },
          { key: "align", type: "select", label: "Выравнивание", options: ["left", "center"] },
        ],
      },
      {
        // A variant WITHOUT settings — used for the "switch away and back" case.
        key: "info.text",
        label: "Информация",
        kind: "info",
        placeholders: [{ key: "body", type: "richText", label: "Текст" }],
      },
    ],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUser.mockResolvedValue(authorUser);
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getTest.mockResolvedValue(baseTest);
  storageMock.getTestSections.mockResolvedValue([]);
  dbMock.select.mockReturnValue(dbMock._makeChain([templateRow]));
  storageMock.createContentPage.mockImplementation(async (p: any) => ({ id: "page-new", ...p }));
  storageMock.updateContentPage.mockImplementation(async (_id: string, u: any) => ({ id: "page-1", ...u }));
});

describe("POST /api/tests/:id/content-pages — settings", () => {
  const post = (body: Record<string, unknown>) =>
    request(makeApp()).post("/api/tests/test-1/content-pages").send({
      position: "before",
      mode: "template",
      type: "info",
      templateKey: "gallery.card",
      ...body,
    });

  it("stores declared settings and coerces them to the declared type", async () => {
    const res = await post({
      settingsJson: { sequenceId: "Вводная галерея", showHint: "true", columns: "3", align: "center" },
    });

    expect(res.status).toBe(201);
    const saved = storageMock.createContentPage.mock.calls[0][0];
    expect(saved.settingsJson).toEqual({
      sequenceId: "Вводная галерея",
      showHint: true,
      columns: 3,
      align: "center",
      // Declared default fills the value the author left empty.
      nextLabel: "Далее",
    });
  });

  it("drops keys the variant does not declare", async () => {
    const res = await post({ settingsJson: { sequenceId: "A", hackerKey: "x" } });

    expect(res.status).toBe(201);
    const saved = storageMock.createContentPage.mock.calls[0][0];
    expect(saved.settingsJson.hackerKey).toBeUndefined();
    expect(saved.settingsJson.sequenceId).toBe("A");
  });

  it("drops a select value outside the declared options", async () => {
    await post({ settingsJson: { align: "justify" } });
    const saved = storageMock.createContentPage.mock.calls[0][0];
    expect(saved.settingsJson.align).toBeUndefined();
  });

  it("sanitises text settings — a caption reaches the layout as markup", async () => {
    await post({ settingsJson: { nextLabel: 'Начать<script>alert(1)</script>' } });
    const saved = storageMock.createContentPage.mock.calls[0][0];
    expect(saved.settingsJson.nextLabel).toBe("Начать");
  });

  it("a page of a variant without settings stores an empty object", async () => {
    const res = await request(makeApp()).post("/api/tests/test-1/content-pages").send({
      position: "before",
      mode: "template",
      type: "info",
      templateKey: "info.text",
      settingsJson: { sequenceId: "A" },
    });

    expect(res.status).toBe(201);
    expect(storageMock.createContentPage.mock.calls[0][0].settingsJson).toEqual({});
  });
});

describe("PUT /api/tests/:id/content-pages/:pageId — settings", () => {
  const existingPage = {
    id: "page-1",
    testId: "test-1",
    topicId: null,
    position: "before",
    mode: "template",
    type: "info",
    kind: "info",
    templateKey: "gallery.card",
    sortOrder: 0,
    valuesJson: { values: {} },
    settingsJson: { sequenceId: "Вводная галерея", nextLabel: "Начать" },
    autoAdvance: false,
    autoAdvanceDelayMs: null,
  };

  beforeEach(() => {
    storageMock.getContentPage.mockResolvedValue(existingPage);
  });

  it("updates settings without touching content", async () => {
    const res = await request(makeApp())
      .put("/api/tests/test-1/content-pages/page-1")
      .send({ settingsJson: { sequenceId: "Итоги", nextLabel: "Дальше" } });

    expect(res.status).toBe(200);
    const updates = storageMock.updateContentPage.mock.calls[0][1];
    expect(updates.settingsJson).toEqual({ sequenceId: "Итоги", nextLabel: "Дальше" });
    expect(updates.valuesJson).toBeUndefined();
  });

  it("keeps the sequence identifier when the new variant does not declare settings (FR-29)", async () => {
    const res = await request(makeApp())
      .put("/api/tests/test-1/content-pages/page-1")
      .send({ templateKey: "info.text" });

    expect(res.status).toBe(200);
    const updates = storageMock.updateContentPage.mock.calls[0][1];
    // The caption belonged to the old variant and is gone; the sequence survives,
    // so switching back restores the page's place in the gallery.
    expect(updates.settingsJson).toEqual({ sequenceId: "Вводная галерея" });
  });

  it("leaves settings untouched when the request carries none and the variant is unchanged", async () => {
    const res = await request(makeApp())
      .put("/api/tests/test-1/content-pages/page-1")
      .send({ sortOrder: 3 });

    expect(res.status).toBe(200);
    const updates = storageMock.updateContentPage.mock.calls[0][1];
    expect(updates.settingsJson).toBeUndefined();
    expect(updates.sortOrder).toBe(3);
  });
});
