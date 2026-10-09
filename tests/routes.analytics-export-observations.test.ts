/**
 * @module tests/routes.analytics-export-observations
 * @description PRD-56 FR-25: выгрузка теста говорит то же, что экран.
 *
 * Лист «Сводка» считался по одним веб-попыткам, как и сама страница до этого этапа. Экран
 * починили — файл остался бы со своими числами, и автор получил бы два разных ответа на один
 * вопрос: один в браузере, другой в книге, которую он отправит коллеге.
 *
 * Книга уровня теста теперь — общая книга (`POST /api/export/excel` с `testIds: [testId]`);
 * свойство проверяется на ней.
 *
 * Проверяется содержимое книги, а не только её тип: заголовок `Content-Type` ничего не говорит
 * о числах внутри.
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
    getScales: vi.fn().mockResolvedValue([]),
    getResultVariables: vi.fn().mockResolvedValue([]),
    getQuestionMeasurements: vi.fn().mockResolvedValue([]),
    selectObservations: vi.fn(),
    // Уровни и курсы прохождений LMS — для листов уровней и рекомендаций книги.
    // PRD-56 FR-21h: stored measurements of LMS runs — from the same rows.
    getScormAttemptMeasures: vi.fn(async (ids: string[]) => ((await storageMock.getAllScormAttempts()) ?? [])
      .filter((row: { id: string }) => ids.includes(row.id))
      .map((row: { id: string; scalesJson?: unknown; variablesJson?: unknown }) => ({
        id: row.id, scalesJson: row.scalesJson ?? null, variablesJson: row.variablesJson ?? null,
      }))),
    getScormAttemptOutcomes: vi.fn(async (ids: string[]) => ((await storageMock.getAllScormAttempts()) ?? [])
      .filter((row: { id: string }) => ids.includes(row.id))
      .map((row: { id: string; achievedLevelsJson?: unknown; failedTopicCoursesJson?: unknown }) => ({
        id: row.id, achievedLevelsJson: row.achievedLevelsJson ?? null, failedTopicCoursesJson: row.failedTopicCoursesJson ?? null,
      }))),
    selectAnswersForTest: vi.fn().mockResolvedValue([]),
    selectOrgSpellings: vi.fn().mockResolvedValue({ organization: [], unit: [], position: [] }),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import exportRouter from "../server/routes/analytics/export";

const TEST = {
  id: "test1", title: "Сертификация", mode: "standard",
  overallPassRuleJson: { type: "percent", value: 70 }, createdAt: new Date(),
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

/** Значение показателя из листа «Сводка». */
async function summaryValue(body: Buffer, label: string): Promise<unknown> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(body as never);
  const sheet = workbook.getWorksheet("Сводка");
  let found: unknown;
  sheet?.eachRow(row => {
    if (String(row.getCell(1).value ?? "").trim() === label) found = row.getCell(2).value;
  });
  return found;
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
  storageMock.getTopicCourses.mockResolvedValue([]);
  storageMock.getTestSections.mockResolvedValue([]);
  storageMock.getTestQuestionScoring.mockResolvedValue([]);
  storageMock.getScormPackages.mockResolvedValue([]);
});

describe("POST /api/export/excel — сводка книги одного теста", () => {
  it("считает прохождения всех источников, а не только веб-попытки", async () => {
    storageMock.getAllAttempts.mockResolvedValue([{
      id: "web-1", testId: "test1", userId: "u1",
      startedAt: new Date("2026-09-11T14:00:00Z"), finishedAt: new Date("2026-09-11T14:20:00Z"),
      variantJson: { sections: [] }, answersJson: {},
      resultJson: { overallPercent: 80, overallPassed: true, totalPossiblePoints: 20, totalEarnedPoints: 16 },
    }]);
    storageMock.getAllScormAttempts.mockResolvedValue([{
      id: "lms-1", testId: "test1", packageId: null, origin: "telemetry",
      userId: null, participantKey: null, groupId: null, lmsUserName: "Иванов Пётр",
      startedAt: new Date("2026-09-10T09:00:00Z"), finishedAt: new Date("2026-09-10T09:30:00Z"),
      resultPercent: 60, resultPassed: false, maxPoints: 20, totalPoints: 12,
    }]);

    const res = await request(makeApp())
      .post("/api/export/excel")
      .set("x-test-user", "author1")
      .send({ testIds: ["test1"] })
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(await summaryValue(res.body, "Завершённых")).toBe(2);
    expect(await summaryValue(res.body, "Участников")).toBe(2);
    // Средний результат по обоим источникам: (80 + 60) / 2.
    expect(await summaryValue(res.body, "Средний результат")).toBe("70.0%");
    expect(await summaryValue(res.body, "Процент прохождения")).toBe("50.0%");
  });
});
