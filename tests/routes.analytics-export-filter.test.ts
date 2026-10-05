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
    getScales: vi.fn().mockResolvedValue([]),
    getResultVariables: vi.fn().mockResolvedValue([]),
    getQuestionMeasurements: vi.fn().mockResolvedValue([]),
    getTestIdsByOwner: vi.fn().mockResolvedValue([]),
    getUserTestGrants: vi.fn().mockResolvedValue([]),
    selectObservations: vi.fn(),
    // План оргструктуры: хранящиеся написания оргполей.
    selectOrgSpellings: vi.fn(),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import exportRouter from "../server/routes/analytics/export";

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

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.selectObservations.mockImplementation(observationsDouble(storageMock as never));
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
  storageMock.getAllScormAttempts.mockResolvedValue([{
    id: "lms-1", testId: "test1", packageId: null, origin: "import",
    userId: null, participantKey: "7f3a9c21", groupId: null, lmsUserName: null,
    startedAt: new Date("2026-09-10T09:00:00Z"), finishedAt: new Date("2026-09-10T09:30:00Z"),
    resultPercent: 64, resultPassed: false, maxPoints: 20, totalPoints: 13,
  }]);
});

describe("POST /api/export/excel — состав строк задаёт фильтр", () => {
  it("выгружает прохождения всех источников, а не только веб-попытки", async () => {
    const res = await exportWith({ testIds: ["test1"] });

    expect(res.status).toBe(200);
    const rows = await sheetRows(res.body, "Попытки");
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r[2])).toEqual(
      expect.arrayContaining(["Морозова Анна", "Участник 7f3a9c"]),
    );
  });

  it("оставляет в книге только тот источник, который отобран", async () => {
    const res = await exportWith({ testIds: ["test1"], sources: ["import"] });

    const rows = await sheetRows(res.body, "Попытки");
    expect(rows).toHaveLength(1);
    expect(rows[0][2]).toBe("Участник 7f3a9c");
  });

  it("оставляет в книге только тот исход, который отобран", async () => {
    const res = await exportWith({ testIds: ["test1"], outcomes: ["failed"] });

    const rows = await sheetRows(res.body, "Попытки");
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

    const attemptsRows = await sheetRows(res.body, "Попытки");
    expect(attemptsRows.map(r => r[1])).toEqual(["web-1"]);
    const summary = await sheetRows(res.body, "Сводка");
    expect(summary).toContainEqual(["Попыток (завершённых)", 1]);
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

    const rows = await sheetRows(res.body, "Попытки");
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

    const rows = await sheetRows(res.body, "Попытки");
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
    expect(workbook.getWorksheet("Попытки")).toBeUndefined();
  });
});
