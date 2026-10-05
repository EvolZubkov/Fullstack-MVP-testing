/**
 * @module tests/routes.analytics-export-filter
 * @description PRD-56 FR-04: выгрузка отдаёт то, что отфильтровано.
 *
 * До этого экспорт жил своей жизнью: в окне выгрузки набирался ВТОРОЙ набор условий, и книга
 * могла не совпасть с тем, что человек видит на экране. Теперь состав строк задаёт фильтр
 * реестра, а выбор ЛИСТОВ остаётся за окном — это разные вопросы: «о ком отчёт» и «что в нём».
 *
 * Проверяется содержимое книги: заголовок ответа ничего не говорит о строках внутри.
 */
import ExcelJS from "exceljs";
import express from "express";
import session from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { observationsDouble } from "./helpers/observations-double";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    getTest: vi.fn(), getTests: vi.fn(), getTopics: vi.fn(),
    getAllAttempts: vi.fn(), async getAttemptsByTests(ids: string[]) { return ((await this.getAllAttempts()) ?? []).filter((a: { testId: string }) => ids.includes(a.testId)); }, getAllScormAttempts: vi.fn(), getScormPackages: vi.fn(),
    getQuestionsByIds: vi.fn(), getTopicCourses: vi.fn(),
    getTestSections: vi.fn(), getTestQuestionScoring: vi.fn(),
    getGroups: vi.fn(), getGroupUsers: vi.fn(),
    getScormAnswersByAttempt: vi.fn(),
    // Уровни и курсы прохождений LMS — из тех же строк, что отдаёт getAllScormAttempts.
    async getScormAttemptOutcomes(ids: string[]) {
      const rows = ((await this.getAllScormAttempts()) ?? []) as Array<{ id: string; achievedLevelsJson?: unknown; failedTopicCoursesJson?: unknown }>;
      return rows.filter(row => ids.includes(row.id))
        .map(row => ({ id: row.id, achievedLevelsJson: row.achievedLevelsJson ?? null, failedTopicCoursesJson: row.failedTopicCoursesJson ?? null }));
    },
    getScales: vi.fn().mockResolvedValue([]),
    getResultVariables: vi.fn().mockResolvedValue([]),
    getQuestionMeasurements: vi.fn().mockResolvedValue([]),
    getTestIdsByOwner: vi.fn().mockResolvedValue([]),
    getUserTestGrants: vi.fn().mockResolvedValue([]),
    selectObservations: vi.fn(),
    // План оргструктуры: хранящиеся написания оргполей.
    selectOrgSpellings: vi.fn(),
    // Ответы LMS теста — общий сбор ответов (`loadTestAnswerFacts`).
    selectAnswersForTest: vi.fn(),
    // Реестр в том же приложении: справочники порции (сбой — в лог, строки остаются).
    getGroup: vi.fn(), getUserGroups: vi.fn(), selectAttemptOrder: vi.fn(),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import exportRouter from "../server/routes/analytics/export";
// eslint-disable-next-line import/first -- must import AFTER vi.mock
import registryRouter from "../server/routes/analytics/registry";

const TEST = {
  id: "test1", title: "Сертификация", mode: "standard",
  overallPassRuleJson: { type: "percent", value: 70 },
};

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    next();
  });
  app.use("/api", exportRouter);
  // Реестр — тот, чьё «всего» окно выгрузки обещает: число строк книги сверяется с ним.
  app.use("/api/analytics", registryRouter);
  return app;
}

/** Строки листа книги без заголовка. */
async function sheetRows(body: Buffer, name: string): Promise<unknown[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(body as never);
  const sheet = workbook.getWorksheet(name);
  const rows: unknown[][] = [];
  sheet?.eachRow((row, index) => {
    if (index > 1) rows.push((row.values as unknown[]).slice(1));
  });
  return rows;
}

/** Запрос выгрузки: тело читается буфером, иначе xlsx не собрать обратно. */
function exportWith(body: Record<string, unknown>) {
  return request(makeApp())
    .post("/api/export/excel")
    .set("x-test-user", "a1")
    .send(body)
    .buffer(true)
    .parse((response, callback) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => callback(null, Buffer.concat(chunks)));
    });
}

/**
 * Двойник выборки, понимающий оргусловие по организации.
 *
 * Общий двойник оргусловий не разбирает (их сравнение живёт в настоящем запросе). Здесь хватает
 * правила OQ-04 в одну строку: у строки LMS — своё значение, у веб-попытки — профиль участника.
 */
function orgAwareDouble(profiles: Record<string, string>) {
  const base = observationsDouble(storageMock as never);
  return async (query: Parameters<typeof base>[0] = {}) => {
    const wanted = query.orgValues?.organization;
    if (!wanted) return base(query);
    const all = await base({ ...query, orgValues: undefined, limit: undefined, offset: undefined });
    const keep = new Set([
      ...(all.web as Array<{ id: string; userId: string }>)
        .filter(row => wanted.includes(profiles[row.userId] ?? "")).map(row => row.id),
      ...(all.lms as Array<{ id: string; lmsUserOrg?: string }>)
        .filter(row => wanted.includes(row.lmsUserOrg ?? "")).map(row => row.id),
    ]);
    const order = all.order.filter(k => keep.has(k.id));
    const page = query.limit === undefined
      ? order.slice(query.offset ?? 0)
      : order.slice(query.offset ?? 0, (query.offset ?? 0) + query.limit);
    const ids = new Set(page.map(k => k.id));
    return {
      web: (all.web as Array<{ id: string }>).filter(row => ids.has(row.id)) as never,
      lms: (all.lms as Array<{ id: string }>).filter(row => ids.has(row.id)) as never,
      order: page,
      total: order.length,
    };
  };
}

/** Живая телеметрия того же теста: незнакомец из LMS, сдал. */
const TELEMETRY = {
  id: "tel-1", testId: "test1", packageId: null, origin: "telemetry",
  userId: null, participantKey: null, lmsUserId: "lms-42", groupId: null, lmsUserName: "Петров Пётр",
  lmsUserOrg: "АО «Ромашка»",
  startedAt: new Date("2026-09-12T08:00:00Z"), finishedAt: new Date("2026-09-12T08:25:00Z"),
  resultPercent: 90, resultPassed: true, maxPoints: 20, totalPoints: 18,
};

/** Импортированное прохождение из выгрузки LMS: псевдоним, не сдал. */
const IMPORTED = {
  id: "lms-1", testId: "test1", packageId: null, origin: "import",
  userId: null, participantKey: "7f3a9c21", groupId: null, lmsUserName: null,
  startedAt: new Date("2026-09-10T09:00:00Z"), finishedAt: new Date("2026-09-10T09:30:00Z"),
  resultPercent: 64, resultPassed: false, maxPoints: 20, totalPoints: 13,
};

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.selectObservations.mockImplementation(observationsDouble(storageMock as never));
  storageMock.selectAnswersForTest.mockResolvedValue([]);
  storageMock.getGroup.mockResolvedValue(undefined);
  storageMock.getUserGroups.mockResolvedValue([]);
  storageMock.selectAttemptOrder.mockResolvedValue([]);
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getUser.mockResolvedValue({ id: "u1", name: "Морозова Анна", email: "a@b.c" });
  storageMock.getTest.mockResolvedValue(TEST);
  storageMock.getTests.mockResolvedValue([TEST]);
  storageMock.getTopics.mockResolvedValue([]);
  storageMock.getQuestionsByIds.mockResolvedValue([]);
  storageMock.getTestSections.mockResolvedValue([]);
  storageMock.getTestQuestionScoring.mockResolvedValue([]);
  storageMock.getScormPackages.mockResolvedValue([]);
  storageMock.getGroupUsers.mockResolvedValue([]);
  storageMock.getAllAttempts.mockResolvedValue([{
    id: "web-1", testId: "test1", userId: "u1",
    startedAt: new Date("2026-09-11T14:00:00Z"), finishedAt: new Date("2026-09-11T14:20:00Z"),
    variantJson: {}, answersJson: {},
    resultJson: { overallPercent: 78, overallPassed: true, totalPossiblePoints: 20, totalEarnedPoints: 16 },
  }]);
  storageMock.getAllScormAttempts.mockResolvedValue([IMPORTED]);
});

describe("POST /api/export/excel — состав строк задаёт фильтр", () => {
  it("выгружает прохождения всех источников, а не только веб-попытки", async () => {
    const res = await exportWith({ testIds: ["test1"] });

    expect(res.status).toBe(200);
    const rows = await sheetRows(res.body, "Прохождения");
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r[2])).toEqual(
      expect.arrayContaining(["Морозова Анна", "Участник 7f3a9c"]),
    );
  });

  it("оставляет в книге только тот источник, который отобран", async () => {
    const res = await exportWith({ testIds: ["test1"], sources: ["import"] });

    const rows = await sheetRows(res.body, "Прохождения");
    expect(rows).toHaveLength(1);
    expect(rows[0][2]).toBe("Участник 7f3a9c");
  });

  it("оставляет в книге только тот исход, который отобран", async () => {
    const res = await exportWith({ testIds: ["test1"], outcomes: ["failed"] });

    const rows = await sheetRows(res.body, "Прохождения");
    expect(rows).toHaveLength(1);
    expect(rows[0][2]).toBe("Участник 7f3a9c");
  });

  it("версия публикации сужает и лист прохождений, и листы по веб-попыткам", async () => {
    storageMock.getAllAttempts.mockResolvedValue([
      {
        id: "web-1", testId: "test1", userId: "u1", snapshotId: "snap-3",
        startedAt: new Date("2026-09-11T14:00:00Z"), finishedAt: new Date("2026-09-11T14:20:00Z"),
        variantJson: {}, answersJson: {},
        resultJson: { overallPercent: 78, overallPassed: true, totalPossiblePoints: 20, totalEarnedPoints: 16 },
      },
      {
        id: "web-2", testId: "test1", userId: "u2", snapshotId: "snap-2",
        startedAt: new Date("2026-09-12T14:00:00Z"), finishedAt: new Date("2026-09-12T14:20:00Z"),
        variantJson: {}, answersJson: {},
        resultJson: { overallPercent: 40, overallPassed: false, totalPossiblePoints: 20, totalEarnedPoints: 8 },
      },
    ]);

    const res = await exportWith({ testIds: ["test1"], snapshotIds: ["snap-3"] });

    const attemptsRows = await sheetRows(res.body, "Прохождения");
    expect(attemptsRows.map(r => r[1])).toEqual(["web-1"]);
    const summary = await sheetRows(res.body, "Сводка");
    expect(summary).toContainEqual(["Прохождений", 1]);
    expect(summary).toContainEqual(["Завершённых", 1]);
  });

  it("печатает оргполя за участником по правилу OQ-04: своё у импорта, профиль у веба", async () => {
    storageMock.getUser.mockResolvedValue({
      id: "u1", name: "Морозова Анна", email: "a@b.c", organization: "АО «Ромашка»", unit: "Логистика",
    });
    storageMock.getAllScormAttempts.mockResolvedValue([{
      id: "lms-1", testId: "test1", packageId: null, origin: "import",
      userId: null, participantKey: "7f3a9c21", groupId: null, lmsUserName: null,
      lmsUserUnit: "Отдел продаж", lmsUserPosition: "Менеджер",
      startedAt: new Date("2026-09-10T09:00:00Z"), finishedAt: new Date("2026-09-10T09:30:00Z"),
      resultPercent: 64, resultPassed: false, maxPoints: 20, totalPoints: 13,
    }]);

    const res = await exportWith({ testIds: ["test1"] });

    const rows = await sheetRows(res.body, "Прохождения");
    const byId = Object.fromEntries(rows.map(r => [r[1], r.slice(3, 6)]));
    // Нет значения — пустая клетка, а не прочерк: колонку фильтруют в Excel, и «—» встал бы
    // там отдельным значением.
    expect(byId["web-1"]).toEqual(["АО «Ромашка»", "Логистика", ""]);
    expect(byId["lms-1"]).toEqual(["", "Отдел продаж", "Менеджер"]);
  });

  it("передаёт оргусловия фильтра в отбор", async () => {
    storageMock.selectOrgSpellings.mockResolvedValue({
      organization: [], unit: ["Отдел продаж"], position: [],
    });

    await exportWith({ testIds: ["test1"], units: ["отдел продаж"] });

    const query = storageMock.selectObservations.mock.calls.at(-1)![0];
    expect(query.orgValues).toEqual({ unit: ["Отдел продаж"] });
  });

  it("подписывает источник каждой строки: импорт и веб читаются по-разному", async () => {
    const res = await exportWith({ testIds: ["test1"] });

    const rows = await sheetRows(res.body, "Прохождения");
    const sources = rows.map(r => r[r.length - 1]);
    expect(sources).toEqual(expect.arrayContaining(["Веб", "Импорт"]));
  });

  it("выбор листов по-прежнему за окном выгрузки", async () => {
    const res = await exportWith({
      testIds: ["test1"],
      includeSheets: { summary: true, attempts: false, answers: false, questionStats: false },
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body as never);
    expect(workbook.getWorksheet("Сводка")).toBeTruthy();
    expect(workbook.getWorksheet("Прохождения")).toBeUndefined();
  });

  it("телеметрия LMS попадает в лист прохождений со своим источником", async () => {
    storageMock.getAllScormAttempts.mockResolvedValue([IMPORTED, TELEMETRY]);

    const res = await exportWith({ testIds: ["test1"] });

    const rows = await sheetRows(res.body, "Прохождения");
    const telemetry = rows.find(r => r[1] === "tel-1");
    expect(telemetry).toBeDefined();
    expect(telemetry![2]).toBe("Петров Пётр");
    expect(telemetry![12]).toBe("Сдан");
    expect(telemetry![13]).toBe("Телеметрия LMS");
    expect(rows).toHaveLength(3);
  });

  it("условие «источник: веб» убирает телеметрию и импорт", async () => {
    storageMock.getAllScormAttempts.mockResolvedValue([IMPORTED, TELEMETRY]);

    const res = await exportWith({ testIds: ["test1"], sources: ["web"] });

    const rows = await sheetRows(res.body, "Прохождения");
    expect(rows.map(r => r[1])).toEqual(["web-1"]);
    expect(rows[0][13]).toBe("Веб");
  });

  it("условие по организации сужает строки: своё значение у LMS, профиль у веба", async () => {
    storageMock.getAllScormAttempts.mockResolvedValue([IMPORTED, TELEMETRY]);
    storageMock.selectObservations.mockImplementation(orgAwareDouble({ u1: "ООО «Лютик»" }));
    storageMock.selectOrgSpellings.mockResolvedValue({
      organization: ["АО «Ромашка»", "ООО «Лютик»"], unit: [], position: [],
    });

    const res = await exportWith({ testIds: ["test1"], organizations: ["ао «ромашка»"] });

    const rows = await sheetRows(res.body, "Прохождения");
    expect(rows.map(r => r[1])).toEqual(["tel-1"]);
  });

  it("число строк книги равно «всего» реестра при тех же условиях", async () => {
    storageMock.getAllScormAttempts.mockResolvedValue([IMPORTED, TELEMETRY]);
    storageMock.selectObservations.mockImplementation(orgAwareDouble({ u1: "АО «Ромашка»" }));
    storageMock.selectOrgSpellings.mockResolvedValue({
      organization: ["АО «Ромашка»"], unit: [], position: [],
    });

    const cases: Array<{ body: Record<string, unknown>; query: string }> = [
      { body: {}, query: "" },
      { body: { sources: ["telemetry", "import"] }, query: "source=telemetry,import" },
      { body: { outcomes: ["passed"] }, query: "outcome=passed" },
      { body: { organizations: ["АО «Ромашка»"] }, query: `organization=${encodeURIComponent("АО «Ромашка»")}` },
      { body: { dateFrom: "2026-09-11", dateTo: "2026-09-12" }, query: "from=2026-09-11&to=2026-09-12" },
    ];

    for (const { body, query } of cases) {
      const registry = await request(makeApp())
        .get(`/api/analytics/registry?testId=test1&limit=1${query ? `&${query}` : ""}`)
        .set("x-test-user", "a1");
      expect(registry.status).toBe(200);

      const book = await exportWith({ testIds: ["test1"], ...body });
      const rows = await sheetRows(book.body, "Прохождения");
      expect(rows.length, JSON.stringify(body)).toBe(registry.body.total);
    }
  });

  it("период передаётся в отбор тем же правилом, что у реестра: по дате начала, конец дня включительно", async () => {
    await exportWith({ testIds: ["test1"], dateFrom: "2026-09-11", dateTo: "2026-09-12" });

    const query = storageMock.selectObservations.mock.calls.at(-1)![0];
    expect(query.from).toEqual(new Date("2026-09-11T00:00:00.000Z"));
    expect(query.to).toEqual(new Date("2026-09-12T23:59:59.999Z"));
  });

  it("ответы и статистика вопросов собраны по всем источникам и только по отобранным прохождениям", async () => {
    const question = {
      id: "q1", topicId: "t1", type: "single", prompt: "Столица Франции?",
      dataJson: { options: ["Париж", "Лион"] }, correctJson: { correctIndex: 0 }, difficulty: 30,
    };
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "География" }]);
    storageMock.getQuestionsByIds.mockResolvedValue([question]);
    storageMock.getAllAttempts.mockResolvedValue([{
      id: "web-1", testId: "test1", userId: "u1",
      startedAt: new Date("2026-09-11T14:00:00Z"), finishedAt: new Date("2026-09-11T14:20:00Z"),
      variantJson: { sections: [{ topicId: "t1", questionIds: ["q1"] }] },
      answersJson: { q1: 0 },
      resultJson: {
        overallPercent: 100, overallPassed: true, totalPossiblePoints: 1, totalEarnedPoints: 1,
        questionOutcomes: [{ questionId: "q1", result: "correct", earned: 1, possible: 1 }],
      },
    }]);
    storageMock.getAllScormAttempts.mockResolvedValue([IMPORTED, TELEMETRY]);
    // Ответ чужого прохождения (не попавшего в выборку) обязан остаться за бортом.
    storageMock.selectAnswersForTest.mockResolvedValue([
      { questionId: "q1", attemptId: "lms-1", result: "incorrect", latencyMs: null, points: 0, maxPoints: 1, userAnswer: 1, origin: "import" },
      { questionId: "q1", attemptId: "tel-1", result: "correct", latencyMs: 12000, points: 1, maxPoints: 1, userAnswer: 0, origin: "telemetry" },
      { questionId: "q1", attemptId: "elsewhere", result: "incorrect", latencyMs: null, points: 0, maxPoints: 1, userAnswer: 1, origin: "import" },
    ]);

    // «Сдал» отбирает веб-попытку и телеметрию; несдавший импорт в выборку не входит.
    const res = await exportWith({ testIds: ["test1"], outcomes: ["passed"] });

    const answers = await sheetRows(res.body, "Ответы");
    expect(answers.map(r => [r[1], r[3], r[11], r[12]])).toEqual(expect.arrayContaining([
      ["web-1", "Веб", "1) Париж", "Верно"],
      ["tel-1", "Телеметрия LMS", "1) Париж", "Верно"],
    ]));
    expect(answers).toHaveLength(2);
    expect(answers.find(r => r[1] === "tel-1")![14]).toBe(12);

    const stats = await sheetRows(res.body, "Статистика вопросов");
    expect(stats).toEqual([[
      "Сертификация", "Столица Франции?", "География", "Один ответ", 30,
      "1) Париж\n2) Лион", "1) Париж", 2, 2, "100.0%",
    ]]);

    // Без условия исхода в статистику входит и неверный ответ импорта.
    const all = await exportWith({ testIds: ["test1"] });
    const allStats = await sheetRows(all.body, "Статистика вопросов");
    expect(allStats[0].slice(7)).toEqual([3, 2, "66.7%"]);
  });

  it("уровни и рекомендации телеметрии и импорта входят в листы без пояснительной строки", async () => {
    // Импорт читает блоки `topic_*` выгрузки и пишет их в те же колонки, что телеметрия.
    storageMock.getAllScormAttempts.mockResolvedValue([{
      ...IMPORTED,
      achievedLevelsJson: [{ topicId: "t-hist", topicName: "История", levelName: null }],
      failedTopicCoursesJson: [{ title: "Курс по истории", url: "" }],
    }, {
      ...TELEMETRY,
      achievedLevelsJson: [{ topicName: "География", levelName: "Продвинутый" }],
      failedTopicCoursesJson: JSON.stringify([{ title: "Курс по картам", url: "https://x" }]),
    }]);

    const res = await exportWith({
      testIds: ["test1"],
      includeSheets: { levelStats: true, recommendations: true },
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body as never);
    const headers: Record<string, string> = { "Статистика уровней": "Участник", "Рекомендации": "Участник" };
    for (const name of Object.keys(headers)) {
      const sheet = workbook.getWorksheet(name);
      expect(sheet, name).toBeTruthy();
      // Первая строка — шапка, пояснения про импорт больше нет.
      expect(String(sheet!.getRow(1).getCell(1).value)).toBe(headers[name]);
    }
    const levels = await sheetRows(res.body, "Статистика уровней");
    expect(levels.some(row => row.includes("География") && row.includes("Продвинутый"))).toBe(true);
    expect(levels.some(row => row.includes("История") && row.includes("Не достигнут"))).toBe(true);
    const courses = await sheetRows(res.body, "Рекомендации");
    expect(courses.some(row => row.includes("Курс по картам"))).toBe(true);
    expect(courses.some(row => row.includes("Курс по истории"))).toBe(true);
  });

  it("лучшая попытка выбирается по участнику любого источника", async () => {
    storageMock.getAllScormAttempts.mockResolvedValue([
      IMPORTED,
      { ...IMPORTED, id: "lms-2", startedAt: new Date("2026-09-13T09:00:00Z"), finishedAt: new Date("2026-09-13T09:30:00Z"), resultPercent: 81, resultPassed: true },
    ]);

    const res = await exportWith({ testIds: ["test1"], bestAttemptOnly: true });

    const rows = await sheetRows(res.body, "Прохождения");
    expect(rows.map(r => r[1]).sort()).toEqual(["lms-2", "web-1"]);
  });
});
