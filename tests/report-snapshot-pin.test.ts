/**
 * @module tests/report-snapshot-pin
 *
 * PRD-27 Фаза 5 — вариант отчёта ПРИКОЛОТ к снапшоту выдачи (FR-24).
 *
 * Смысл требования: автор вправе поменять вид отчёта у опубликованного теста, и это
 * НЕ должно задним числом переписывать документы по уже выданным попыткам. Тест
 * проверяет ровно это: попытка, приколотая к снапшоту (PRD-15), собирает отчёт по
 * варианту ИЗ СНАПШОТА, а не по текущему черновику.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

const { storageMock, renderMock } = vi.hoisted(() => ({
  storageMock: {
    getAttempt: vi.fn(),
    getTest: vi.fn(),
    getAttemptsByUserAndTest: vi.fn().mockResolvedValue([]),
    getSnapshot: vi.fn(),
    getLatestSnapshot: vi.fn().mockResolvedValue(undefined),
    getUser: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["learner"]),
    getTopics: vi.fn().mockResolvedValue([]),
    getTestSections: vi.fn().mockResolvedValue([]),
    getContentPages: vi.fn().mockResolvedValue([]),
  },
  // Перехватываем чтение файлов шаблона: тесту важен ВЫБОР, доехавший до сборщика
  // страницы, а не содержимое макета на диске.
  renderMock: {
    readResultsRenderPayload: vi.fn().mockReturnValue(null),
    readReportRenderPayload: vi.fn().mockReturnValue({
      layout: "<div class=\"tb-report\"></div>",
      css: "",
      variantKey: "resolved",
      values: {},
    }),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/db", () => ({ db: {} }));
// Каталог шаблона на диске тесту не нужен: проверяется ВЫБОР варианта, а не файлы.
vi.mock("../server/services/template-dir", () => ({
  resolveSystemScreenDir: vi.fn().mockResolvedValue("/tpl/default"),
  resolveTemplateDir: vi.fn().mockResolvedValue("/tpl/default"),
}));
vi.mock("../server/services/template-render", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../server/services/template-render");
  return { ...actual, ...renderMock };
});

import attemptsRouter from "../server/routes/attempts";

const app = express();
app.use(express.json());
app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
app.use((req: any, _res: any, next: any) => {
  req.session.userId = "learner1";
  next();
});
app.use("/api", attemptsRouter);

// ─── Фикстуры ────────────────────────────────────────────────────────────────

/** Вариант, действовавший НА МОМЕНТ выдачи (замороженный в снапшоте). */
const DELIVERED = { standard: { variantKey: "report.delivered", values: { headline: "Как выдавали" } } };
/** Вариант, на который автор переключился ПОСЛЕ выдачи (живой черновик). */
const CURRENT = { standard: { variantKey: "report.current", values: { headline: "Как сейчас" } } };

const liveTest = {
  id: "test1",
  title: "Тест",
  mode: "standard",
  status: "published",
  version: 7,
  maxAttempts: null,
  designSettingsJson: { templateId: "default", params: {} },
  reportSettingsJson: CURRENT,
  overallPassRuleJson: { type: "percent", value: 70 },
  createdAt: new Date(),
};

const resultJson = {
  mode: "standard",
  totalCorrect: 1,
  totalQuestions: 2,
  overallPercent: 50,
  overallPassed: false,
  topicResults: [
    {
      topicId: "t1", topicName: "Тема", correct: 1, total: 2, percent: 50,
      earnedPoints: 1, possiblePoints: 2, passed: false,
    },
  ],
};

function attempt(snapshotId: string | null) {
  return {
    id: "atmp1", userId: "learner1", testId: "test1", snapshotId,
    variantJson: { sections: [] }, answersJson: {}, resultJson,
    startedAt: new Date(), finishedAt: new Date(), testVersion: 1,
  };
}

/** Выбор варианта, с которым маршрут позвал сборщик страницы отчёта. */
function authoredArg() {
  return renderMock.readReportRenderPayload.mock.calls[0]?.[2] ?? null;
}

const learnerUser = {
  id: "learner1", email: "l@test.com", name: "Ученик", status: "active",
  mustChangePassword: false, gdprConsent: true, passwordHash: "x", emailHash: "x",
  createdAt: new Date(), lastLoginAt: null, createdBy: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUser.mockResolvedValue(learnerUser);
  storageMock.getUserRoles.mockResolvedValue(["learner"]);
  renderMock.readResultsRenderPayload.mockReturnValue(null);
  renderMock.readReportRenderPayload.mockReturnValue({
    layout: "<div class=\"tb-report\"></div>", css: "", variantKey: "resolved", values: {},
  });
  storageMock.getTest.mockResolvedValue(liveTest);
  storageMock.getAttemptsByUserAndTest.mockResolvedValue([]);
});

// ─── FR-24 ───────────────────────────────────────────────────────────────────

describe("отчёт по попытке берёт вариант ИЗ ВЫДАЧИ (FR-24)", () => {
  it("попытка на снапшоте: вариант из снапшота, а не из живого теста", async () => {
    storageMock.getAttempt.mockResolvedValue(attempt("snap1"));
    storageMock.getSnapshot.mockResolvedValue({
      id: "snap1",
      contentJson: { test: { ...liveTest, version: 3, reportSettingsJson: DELIVERED }, sections: [] },
    });

    const res = await request(app).get("/api/attempts/atmp1/result");
    expect(res.status).toBe(200);
    expect(authoredArg()).toEqual(DELIVERED.standard);
    // Смена вида автором после публикации не переписывает старый документ.
    expect(authoredArg()).not.toEqual(CURRENT.standard);
  });

  it("попытка без снапшота (черновик): вариант живого теста", async () => {
    storageMock.getAttempt.mockResolvedValue(attempt(null));

    const res = await request(app).get("/api/attempts/atmp1/result");
    expect(res.status).toBe(200);
    expect(authoredArg()).toEqual(CURRENT.standard);
    expect(storageMock.getSnapshot).not.toHaveBeenCalled();
  });

  it("снапшот без настройки отчёта: вариант с isDefault, а не текущий выбор автора", async () => {
    // Тест, опубликованный ДО этого PRD (FR-28): в снапшоте колонки нет. Отчёт обязан
    // деградировать к умолчанию шаблона, а не подхватить сегодняшний выбор автора.
    storageMock.getAttempt.mockResolvedValue(attempt("snap1"));
    storageMock.getSnapshot.mockResolvedValue({
      id: "snap1",
      contentJson: { test: { ...liveTest, version: 3, reportSettingsJson: null }, sections: [] },
    });

    const res = await request(app).get("/api/attempts/atmp1/result");
    expect(res.status).toBe(200);
    expect(authoredArg()).toBeNull();
  });

  it("страница отчёта всё равно отдаётся клиенту", async () => {
    storageMock.getAttempt.mockResolvedValue(attempt("snap1"));
    storageMock.getSnapshot.mockResolvedValue({
      id: "snap1",
      contentJson: { test: { ...liveTest, reportSettingsJson: DELIVERED }, sections: [] },
    });

    const res = await request(app).get("/api/attempts/atmp1/result");
    expect(res.body.reportRender).toBeTruthy();
    expect(res.body.report).toBeTruthy();
  });
});
