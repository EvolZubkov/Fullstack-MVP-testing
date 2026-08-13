/**
 * @module tests/services.content-page-fields
 * @description Characterisation tests for content-page field normalisation.
 *
 * PRD-48 Э3: the Excel workbook will soon write page field values, and it must go
 * through the SAME normalisation and sanitisation the page editor goes through —
 * otherwise the workbook becomes an входом past the sanitiser. Before the rules
 * were lifted out of `server/routes/content-pages.ts` into
 * `server/services/content-page-fields.ts`, this file pinned the CURRENT observed
 * behaviour of the route, quirks included: silent drops, validation skipped when
 * the template cannot be read, and the difference between "no key" and "empty
 * value". These tests are the refactoring harness — they were green before the
 * move and must stay green after it.
 *
 * They deliberately drive the ROUTE, not the extracted functions: what has to
 * survive the refactor is the observable behaviour of saving a page.
 *
 * Harness mirrors tests/routes.content-pages-settings.test.ts.
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

  /** Captures every `where(...)` condition so the tests can see WHICH template id was read. */
  const whereConditions: unknown[] = [];

  const makeChain = (result: unknown) => {
    const chain: any = {
      select: vi.fn(),
      from: vi.fn(),
      where: vi.fn(),
      then: (resolve: any) => resolve(result),
    };
    chain.select.mockReturnValue(chain);
    chain.from.mockReturnValue(chain);
    chain.where.mockImplementation((condition: unknown) => {
      whereConditions.push(condition);
      return chain;
    });
    return chain;
  };

  const dbMock = { _makeChain: makeChain, _whereConditions: whereConditions, select: vi.fn() };
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

/**
 * Bound parameters of a drizzle condition, in order — enough for a test to see
 * WHICH template id was read and whether `isActive` was part of the filter.
 */
function conditionParams(condition: unknown): unknown[] {
  const out: unknown[] = [];
  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node.queryChunks)) {
      node.queryChunks.forEach(visit);
      return;
    }
    // A bound parameter is `{ value: <primitive> }`; a literal SQL chunk holds an
    // array, and a column carries neither.
    if ("value" in node && !Array.isArray(node.value) && typeof node.value !== "object") {
      out.push(node.value);
    }
  };
  visit(condition);
  return out;
}

const authorUser = { id: "user-1", role: "author", status: "active" };
const baseTest = {
  id: "test-1",
  title: "Тест",
  ownerId: "user-1",
  status: "draft",
  designSettingsJson: { templateId: "corporate" },
};

/** The test's SAVED design template — every field type the normaliser knows. */
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
        key: "info.rich",
        label: "Информация",
        kind: "info",
        placeholders: [
          { key: "title", type: "text", label: "Заголовок" },
          { key: "note", type: "textarea", label: "Примечание" },
          { key: "body", type: "richText", label: "Текст" },
          { key: "markup", type: "html", label: "Разметка" },
          { key: "amount", type: "number", label: "Число" },
          { key: "hero", type: "text", label: "Крупный", textFit: { allowAuthorFontSize: true } },
          {
            key: "score",
            type: "resultField",
            label: "Показатель",
            allowedPaths: ["result.score", "result.percent"],
            allowedRenderers: ["number", "gauge"],
            defaultPath: "result.score",
            defaultRenderer: "number",
          },
          { key: "free", type: "resultField", label: "Свободный показатель" },
        ],
        settings: [
          { key: "sequenceId", type: "sequence", label: "Последовательность" },
          { key: "nextLabel", type: "text", label: "Подпись кнопки", default: "Далее" },
          { key: "showHint", type: "boolean", label: "Подсказка" },
          { key: "columns", type: "number", label: "Колонки" },
          { key: "align", type: "select", label: "Выравнивание", options: ["left", "center"] },
          { key: "cover", type: "image", label: "Обложка" },
          { key: "hint", type: "text", label: "Подсказка без умолчания" },
        ],
      },
      {
        key: "info.plain",
        label: "Информация без настроек",
        kind: "info",
        placeholders: [{ key: "body", type: "richText", label: "Текст" }],
      },
    ],
  },
};

/** The DRAFT «Оформление» template the editor may send as `?templateId=`. */
const minimalTemplate = {
  id: "minimal",
  name: "Минимальный",
  version: "1.0.0",
  templateApiVersion: "1.0",
  isActive: true,
  manifest: {
    params: [],
    contentTemplates: [
      {
        key: "draft.only",
        label: "Только в черновике",
        kind: "info",
        placeholders: [{ key: "title", type: "text", label: "Заголовок" }],
      },
    ],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMock._whereConditions.length = 0;
  storageMock.getUser.mockResolvedValue(authorUser);
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getTest.mockResolvedValue(baseTest);
  storageMock.getTestSections.mockResolvedValue([
    { id: "sec-1", testId: "test-1", topicId: "topic-1", questionsCount: 5 },
  ]);
  dbMock.select.mockReturnValue(dbMock._makeChain([corporateTemplate]));
  storageMock.createContentPage.mockImplementation(async (p: any) => ({ id: "page-new", ...p }));
  storageMock.updateContentPage.mockImplementation(async (_id: string, u: any) => ({ id: "page-1", ...u }));
});

/** POST a template-mode page of the saved template's rich variant. */
function post(body: Record<string, unknown> = {}, query = "") {
  return request(makeApp())
    .post("/api/tests/test-1/content-pages" + query)
    .send({ position: "before", mode: "template", type: "info", templateKey: "info.rich", ...body });
}

/** The row the route handed to storage.createContentPage. */
function savedPage() {
  return storageMock.createContentPage.mock.calls[0][0];
}

// ─── Template and variant resolution ─────────────────────────────────────────

describe("Разрешение шаблона и варианта страницы", () => {
  it("черновик ?templateId= применяется, когда шаблон активен", async () => {
    dbMock.select.mockReturnValueOnce(dbMock._makeChain([minimalTemplate]));

    const res = await post({ templateKey: "draft.only", valuesJson: { values: { title: "Черновик" } } }, "?templateId=minimal");

    expect(res.status).toBe(201);
    expect(savedPage().valuesJson.values.title).toBe("Черновик");
    // The draft read filters by the draft id AND by isActive.
    expect(conditionParams(dbMock._whereConditions[0])).toEqual(["minimal", true]);
  });

  it("черновик игнорируется, когда шаблон не активен — берётся сохранённый", async () => {
    dbMock.select
      .mockReturnValueOnce(dbMock._makeChain([]))
      .mockReturnValueOnce(dbMock._makeChain([corporateTemplate]));

    const res = await post({ templateKey: "draft.only" }, "?templateId=minimal");

    expect(res.status).toBe(422);
    expect(res.body.field).toBe("templateKey");
  });

  it("черновик, совпадающий с сохранённым, не читается отдельно", async () => {
    const res = await post({}, "?templateId=corporate");

    expect(res.status).toBe(201);
    expect(dbMock.select).toHaveBeenCalledTimes(1);
    expect(conditionParams(dbMock._whereConditions[0])).toEqual(["corporate"]);
  });

  it("без templateId в оформлении читается шаблон «default»", async () => {
    storageMock.getTest.mockResolvedValue({ ...baseTest, designSettingsJson: {} });

    await post();

    expect(conditionParams(dbMock._whereConditions[0])).toEqual(["default"]);
  });

  it("сохранённый шаблон читается БЕЗ фильтра по активности", async () => {
    await post();

    // Only the id is in the condition: a deactivated template still validates
    // the pages of the tests already using it.
    expect(conditionParams(dbMock._whereConditions[0])).toEqual(["corporate"]);
  });

  it("шаблона нет в базе — проверка варианта и нормализация по манифесту пропускаются", async () => {
    dbMock.select.mockReturnValue(dbMock._makeChain([]));

    const res = await post({
      templateKey: "нет-такого-варианта",
      valuesJson: { values: { body: "<p>Текст<script>alert(1)</script></p>" } },
      settingsJson: { sequenceId: "A" },
    });

    // Unknown variant is NOT rejected, and settings are dropped wholesale.
    expect(res.status).toBe(201);
    expect(savedPage().templateKey).toBe("нет-такого-варианта");
    expect(savedPage().settingsJson).toEqual({});
    // The generic pass still sanitises every string value.
    expect(savedPage().valuesJson.values.body).toBe("<p>Текст</p>");
    expect(savedPage().valuesJson.placeholderStyles).toEqual({});
  });

  it("манифест без contentTemplates ведёт себя как отсутствующий шаблон", async () => {
    dbMock.select.mockReturnValue(dbMock._makeChain([{ ...corporateTemplate, manifest: { params: [] } }]));

    const res = await post({ templateKey: "нет-такого-варианта" });

    expect(res.status).toBe(201);
  });

  it("вариант, которого нет в шаблоне, отклоняется с 422", async () => {
    const res = await post({ templateKey: "info.absent" });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ field: "templateKey" });
  });
});

// ─── Values ───────────────────────────────────────────────────────────────────

describe("Нормализация значений полей страницы", () => {
  it("text и textarea приводятся к каноничному виду с типографикой", async () => {
    await post({
      valuesJson: {
        values: {
          title: '  Заголовок "важный"  \r\n\r\n\r\n  Продолжение  ',
          note: "Примечание\r\nвторая строка   ",
        },
      },
    });

    expect(savedPage().valuesJson.values.title).toBe("Заголовок «важный»\n\nПродолжение");
    expect(savedPage().valuesJson.values.note).toBe("Примечание\nвторая строка");
  });

  it("richText проходит санитайзер и разметочную нормализацию", async () => {
    await post({ valuesJson: { values: { body: "  <p>Текст<script>alert(1)</script></p>  " } } });

    expect(savedPage().valuesJson.values.body).toBe("<p>Текст</p>");
  });

  it("html-поле теряет обработчики событий", async () => {
    await post({ valuesJson: { values: { markup: '<p onclick="hack()">Текст</p>' } } });

    expect(savedPage().valuesJson.values.markup).toBe("<p>Текст</p>");
  });

  it("ГОЧА: разметка в text-поле НЕ вычищается — санитайзер смотрит только richText и html", async () => {
    await post({ valuesJson: { values: { title: "<script>alert(1)</script>Заголовок" } } });

    expect(savedPage().valuesJson.values.title).toContain("<script>");
  });

  it("ГОЧА: значение ключа, не объявленного вариантом, сохраняется нетронутым", async () => {
    await post({ valuesJson: { values: { undeclared: "<script>alert(1)</script>" } } });

    expect(savedPage().valuesJson.values.undeclared).toBe("<script>alert(1)</script>");
  });

  it("нестроковое значение объявленного поля не трогается", async () => {
    await post({ valuesJson: { values: { amount: 42 } } });

    expect(savedPage().valuesJson.values.amount).toBe(42);
  });

  it("пустое строковое значение становится пустой строкой", async () => {
    await post({ valuesJson: { values: { title: "   " } } });

    expect(savedPage().valuesJson.values.title).toBe("");
  });
});

// ─── placeholderStyles ────────────────────────────────────────────────────────

describe("Авторский кегль (placeholderStyles)", () => {
  it("fontSize сохраняется только у поля с textFit.allowAuthorFontSize", async () => {
    await post({
      valuesJson: {
        values: {},
        placeholderStyles: { hero: { fontSize: 32 }, title: { fontSize: 18 } },
      },
    });

    expect(savedPage().valuesJson.placeholderStyles).toEqual({ hero: { fontSize: 32 } });
  });

  it("прочие свойства стиля отбрасываются молча", async () => {
    await post({
      valuesJson: { values: {}, placeholderStyles: { hero: { fontSize: 32, color: "red" } } },
    });

    expect(savedPage().valuesJson.placeholderStyles).toEqual({ hero: { fontSize: 32 } });
  });

  it("нечисловой или бесконечный fontSize отбрасывается", async () => {
    await post({ valuesJson: { values: {}, placeholderStyles: { hero: { fontSize: "32" } } } });

    expect(savedPage().valuesJson.placeholderStyles).toEqual({});
  });

  it("стиль поля, не объявленного вариантом, не сохраняется", async () => {
    await post({ valuesJson: { values: {}, placeholderStyles: { undeclared: { fontSize: 32 } } } });

    expect(savedPage().valuesJson.placeholderStyles).toEqual({});
  });
});

// ─── resultField ──────────────────────────────────────────────────────────────

describe("Поле показателя (resultField)", () => {
  it("путь вне allowedPaths отклоняется с 422 и адресом поля", async () => {
    const res = await post({ valuesJson: { values: { score: { path: "result.secret" } } } });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ field: "valuesJson.values.score.path" });
  });

  it("рендерер вне allowedRenderers отклоняется с 422", async () => {
    const res = await post({
      valuesJson: { values: { score: { path: "result.score", renderer: "iframe" } } },
    });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ field: "valuesJson.values.score.renderer" });
  });

  it("отсутствующие путь и рендерер берут значения по умолчанию из манифеста", async () => {
    await post({ valuesJson: { values: { score: { label: "Балл" } } } });

    expect(savedPage().valuesJson.values.score).toEqual({
      label: "Балл",
      path: "result.score",
      renderer: "number",
      rendererOptions: {},
    });
  });

  it("rendererOptions не-объектом заменяются пустым объектом", async () => {
    await post({
      valuesJson: { values: { score: { path: "result.percent", renderer: "gauge", rendererOptions: ["x"] } } },
    });

    expect(savedPage().valuesJson.values.score.rendererOptions).toEqual({});
  });

  it("без allowedPaths и allowedRenderers принимается любое значение", async () => {
    await post({ valuesJson: { values: { free: { path: "что.угодно", renderer: "любой" } } } });

    expect(savedPage().valuesJson.values.free).toMatchObject({ path: "что.угодно", renderer: "любой" });
  });

  it("ГОЧА: не-объект в поле показателя проходит проверку насквозь", async () => {
    const res = await post({ valuesJson: { values: { score: "result.secret" } } });

    expect(res.status).toBe(201);
    expect(savedPage().valuesJson.values.score).toBe("result.secret");
  });
});

// ─── settings ─────────────────────────────────────────────────────────────────

describe("Нормализация настроек страницы (PRD-22)", () => {
  it("объявленные настройки приводятся к объявленному типу", async () => {
    await post({
      settingsJson: {
        sequenceId: "Вводная",
        showHint: "true",
        columns: "3",
        align: "center",
        cover: "/uploads/media/a.png",
      },
    });

    expect(savedPage().settingsJson).toEqual({
      sequenceId: "Вводная",
      showHint: true,
      columns: 3,
      align: "center",
      cover: "/uploads/media/a.png",
      // Declared default fills the value the author left empty…
      nextLabel: "Далее",
      // …while a setting without a default is simply absent.
    });
  });

  it("незаявленный ключ не сохраняется", async () => {
    await post({ settingsJson: { hackerKey: "x" } });

    expect(savedPage().settingsJson.hackerKey).toBeUndefined();
  });

  it("select вне списка options отбрасывается молча", async () => {
    await post({ settingsJson: { align: "justify" } });

    expect(savedPage().settingsJson.align).toBeUndefined();
  });

  it("number с нечисловым значением отбрасывается молча", async () => {
    await post({ settingsJson: { columns: "три" } });

    expect(savedPage().settingsJson.columns).toBeUndefined();
  });

  it("boolean принимает только true и строку «true», прочее читается как false", async () => {
    await post({ settingsJson: { showHint: "да" } });

    expect(savedPage().settingsJson.showHint).toBe(false);
  });

  it("пустая строка берёт default, а без default ключ не пишется вовсе", async () => {
    await post({ settingsJson: { nextLabel: "", hint: "" } });

    expect(savedPage().settingsJson.nextLabel).toBe("Далее");
    expect("hint" in savedPage().settingsJson).toBe(false);
  });

  it("text и sequence санитизируются", async () => {
    await post({ settingsJson: { nextLabel: "Начать<script>alert(1)</script>", sequenceId: "A<iframe></iframe>" } });

    expect(savedPage().settingsJson.nextLabel).toBe("Начать");
    expect(savedPage().settingsJson.sequenceId).toBe("A");
  });

  it("ГОЧА: к настройке-тексту типографика НЕ применяется", async () => {
    await post({ settingsJson: { nextLabel: 'Кнопка "раз"' } });

    expect(savedPage().settingsJson.nextLabel).toBe('Кнопка "раз"');
  });

  it("ГОЧА: настройка типа image не санитизируется", async () => {
    await post({ settingsJson: { cover: '<img src="x" onerror="hack()">' } });

    expect(savedPage().settingsJson.cover).toBe('<img src="x" onerror="hack()">');
  });

  it("вариант без settings[] сохраняет пустой объект настроек", async () => {
    await post({ templateKey: "info.plain", settingsJson: { sequenceId: "A" } });

    expect(savedPage().settingsJson).toEqual({});
  });
});

// ─── PUT: the same rules plus the FR-29 carry-over ───────────────────────────

describe("PUT страницы — нормализация и перенос последовательности", () => {
  const existingPage = {
    id: "page-1",
    testId: "test-1",
    topicId: null,
    position: "before",
    mode: "template",
    type: "info",
    kind: "info",
    templateKey: "info.rich",
    sortOrder: 0,
    valuesJson: { values: {} },
    settingsJson: { sequenceId: "Вводная", nextLabel: "Начать", columns: 4 },
    autoAdvance: false,
    autoAdvanceDelayMs: null,
  };

  const put = (body: Record<string, unknown>, query = "") =>
    request(makeApp()).put("/api/tests/test-1/content-pages/page-1" + query).send(body);

  const updates = () => storageMock.updateContentPage.mock.calls[0][1];

  beforeEach(() => {
    storageMock.getContentPage.mockResolvedValue(existingPage);
  });

  it("значения нормализуются теми же правилами, что и при создании", async () => {
    const res = await put({ valuesJson: { values: { body: "<p>Текст<script>x</script></p>", title: '  "раз"  ' } } });

    expect(res.status).toBe(200);
    expect(updates().valuesJson.values).toEqual({ body: "<p>Текст</p>", title: "«раз»" });
  });

  it("удалённое содержимое сообщается автору через sanitizeDiagnostics", async () => {
    const res = await put({ valuesJson: { values: { body: "<p><script>x</script></p>" } } });

    expect(res.body.sanitizeDiagnostics.body).toEqual([
      expect.objectContaining({ kind: "tag", label: "<script>", count: 1 }),
    ]);
  });

  it("sequenceId переносится, когда новый вариант его не объявляет (FR-29)", async () => {
    const res = await put({ templateKey: "info.plain" });

    expect(res.status).toBe(200);
    expect(updates().settingsJson).toEqual({ sequenceId: "Вводная" });
  });

  it("при смене варианта без settingsJson пересчитываются настройки из сохранённых", async () => {
    const res = await put({ templateKey: "info.rich" });

    expect(res.status).toBe(200);
    expect(updates().settingsJson).toEqual({ sequenceId: "Вводная", nextLabel: "Начать", columns: 4 });
  });

  it("настройки не пишутся, когда запрос их не несёт и вариант не меняется", async () => {
    const res = await put({ sortOrder: 3 });

    expect(res.status).toBe(200);
    expect(updates().settingsJson).toBeUndefined();
    expect(updates().valuesJson).toBeUndefined();
  });

  it("ГОЧА: settingsJson заменяет набор целиком — неназванный ключ теряется", async () => {
    const res = await put({ settingsJson: { sequenceId: "Итоги" } });

    expect(res.status).toBe(200);
    expect(updates().settingsJson).toEqual({ sequenceId: "Итоги", nextLabel: "Далее" });
  });

  it("вне режима шаблона значения проходят общий санитайзер без манифеста", async () => {
    storageMock.getContentPage.mockResolvedValue({ ...existingPage, mode: "html", templateKey: null });

    const res = await put({ valuesJson: { values: { __html: "<div>Свой<script>x</script></div>" } } });

    expect(res.status).toBe(200);
    expect(updates().valuesJson).toEqual({
      values: { __html: "<div>Свой</div>" },
      placeholderStyles: {},
    });
  });

  it("шаблона нет в базе — значения сохраняются как прислали", async () => {
    dbMock.select.mockReturnValue(dbMock._makeChain([]));

    const res = await put({ valuesJson: { values: { title: "  Как есть  " } } });

    expect(res.status).toBe(200);
    expect(updates().valuesJson).toEqual({ values: { title: "  Как есть  " }, placeholderStyles: {} });
  });

  it("непроходной путь показателя отклоняется с 422 и на обновлении", async () => {
    const res = await put({ valuesJson: { values: { score: { path: "result.secret" } } } });

    expect(res.status).toBe(422);
    expect(res.body.field).toBe("valuesJson.values.score.path");
  });
});

// ─── replace-variant reuses the same value normalisation ─────────────────────

describe("Смена варианта страницы — та же нормализация значений", () => {
  it("сохраняемые значения перепроверяются по полям нового варианта", async () => {
    storageMock.getContentPage.mockResolvedValue({
      id: "page-1",
      testId: "test-1",
      kind: "info",
      templateKey: "info.rich",
      valuesJson: {
        values: { body: "<p>Текст<script>x</script></p>", title: "Заголовок" },
        placeholderStyles: { hero: { fontSize: 32 } },
      },
    });

    const res = await request(makeApp())
      .post("/api/tests/test-1/content-pages/page-1/replace-variant")
      .send({ newTemplateKey: "info.plain" });

    expect(res.status).toBe(200);
    expect(res.body.diff.preserved).toEqual(["body"]);
    const saved = storageMock.updateContentPage.mock.calls[0][1];
    expect(saved.valuesJson.values.body).toBe("<p>Текст</p>");
    expect(saved.valuesJson.values.title).toBeUndefined();
    // `hero` is not a placeholder of the new variant, so its size is gone too.
    expect(saved.valuesJson.placeholderStyles).toEqual({});
  });
});
