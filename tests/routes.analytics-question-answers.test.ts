/**
 * @module tests/routes.analytics-question-answers
 * @description PRD-57 FR-32 + PRD-56 FR-04: ответы одного задания понимают фильтр страницы.
 *
 * Страница вопроса показывает разбор по отобранной выборке (те же условия, что у психометрики),
 * и список ответов под ним, как и его книга, обязан говорить о тех же прохождениях. Без условий
 * в адресе ответ прежний — все ответы теста.
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
    getTest: vi.fn(),
    getTests: vi.fn().mockResolvedValue([]),
    getTopics: vi.fn().mockResolvedValue([{ id: "t1", name: "Тема" }]),
    getTestSections: vi.fn().mockResolvedValue([]),
    getTestQuestionScoring: vi.fn().mockResolvedValue([]),
    getQuestionsByIds: vi.fn(),
    getAllAttempts: vi.fn(),
    async getAttemptsByTests(ids: string[]) {
      return ((await this.getAllAttempts()) ?? []).filter((a: { testId: string }) => ids.includes(a.testId));
    },
    getAllScormAttempts: vi.fn(),
    getScormPackages: vi.fn().mockResolvedValue([]),
    selectObservations: vi.fn(),
    selectAnswersForTest: vi.fn(),
    selectOrgSpellings: vi.fn().mockResolvedValue({ organization: [], unit: [], position: [] }),
    getTestIdsByOwner: vi.fn().mockResolvedValue([]),
    getUserTestGrants: vi.fn().mockResolvedValue([]),
    getTestGrantForUser: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/db", () => ({ db: {} }));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import questionAnswersRouter from "../server/routes/analytics/question-answers";

const TEST = {
  id: "test1", title: "Сертификация", mode: "standard",
  overallPassRuleJson: { type: "percent", value: 70 }, createdBy: "author1",
};

const QUESTION = {
  id: "q1", topicId: "t1", type: "long", prompt: "Опишите подход",
  dataJson: {}, correctJson: {}, difficulty: null,
};

/** Веб-попытка участника u1 с развёрнутым ответом. */
function webAttempt(id: string, startedAt: string, answer: string) {
  return {
    id, testId: "test1", userId: "u1", snapshotId: null,
    variantJson: { sections: [{ topicId: "t1", questionIds: ["q1"] }] },
    answersJson: { q1: answer },
    resultJson: { overallPercent: 0, questionOutcomes: [{ questionId: "q1", result: "neutral" }] },
    startedAt: new Date(startedAt),
    finishedAt: new Date(new Date(startedAt).getTime() + 600_000),
  };
}

const IMPORTED = {
  id: "imp-1", testId: "test1", packageId: null, origin: "import",
  userId: null, participantKey: "7f3a9c21", groupId: null, lmsUserName: null,
  startedAt: new Date("2026-09-05T09:00:00Z"), finishedAt: new Date("2026-09-05T09:30:00Z"),
  resultPercent: null, resultPassed: null, maxPoints: 0, totalPoints: 0,
};

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    next();
  });
  app.use("/api/analytics", questionAnswersRouter);
  return app;
}

/** Список ответов задания с условиями в адресе. */
function answers(query = "") {
  return request(makeApp())
    .get(`/api/analytics/tests/test1/questions/q1/answers${query ? `?${query}` : ""}`)
    .set("x-test-user", "a1");
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.selectObservations.mockImplementation(observationsDouble(storageMock as never));
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getUser.mockResolvedValue({ id: "u1", name: "Морозова Анна" });
  storageMock.getTest.mockResolvedValue(TEST);
  storageMock.getQuestionsByIds.mockResolvedValue([QUESTION]);
  storageMock.getAllAttempts.mockResolvedValue([
    webAttempt("web-1", "2026-09-01T10:00:00Z", "Первая попытка"),
    webAttempt("web-2", "2026-09-03T10:00:00Z", "Вторая попытка"),
  ]);
  storageMock.getAllScormAttempts.mockResolvedValue([IMPORTED]);
  storageMock.selectAnswersForTest.mockResolvedValue([{
    questionId: "q1", attemptId: "imp-1", result: "neutral", latencyMs: null,
    points: null, maxPoints: null, userAnswer: "Ответ из выгрузки", origin: "import",
  }]);
});

describe("GET /tests/:testId/questions/:questionId/answers — фильтр страницы", () => {
  it("без условий отдаёт все ответы теста, как раньше", async () => {
    const res = await answers();

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.rows.map((r: { attemptId: string }) => r.attemptId).sort())
      .toEqual(["imp-1", "web-1", "web-2"]);
  });

  it("порция без условий — тоже прежнее поведение", async () => {
    const res = await answers("offset=0&limit=2");

    expect(res.body.total).toBe(3);
    expect(res.body.rows).toHaveLength(2);
  });

  it("условие источника ограничивает ответы отобранными прохождениями", async () => {
    const res = await answers("source=import");

    expect(res.body.total).toBe(1);
    expect(res.body.rows[0]).toMatchObject({ attemptId: "imp-1", source: "import", answer: "Ответ из выгрузки" });
  });

  it("«только первая попытка» оставляет первую попытку участника", async () => {
    const res = await answers("source=web&firstAttemptOnly=true");

    expect(res.body.rows.map((r: { attemptId: string }) => r.attemptId)).toEqual(["web-1"]);
  });

  it("явный отказ от «только первой» оставляет все попытки", async () => {
    const res = await answers("source=web&firstAttemptOnly=false");

    expect(res.body.total).toBe(2);
  });

  it("правило attempts=first совпадает с прежним firstAttemptOnly=true", async () => {
    const res = await answers("source=web&attempts=first");

    expect(res.body.rows.map((r: { attemptId: string }) => r.attemptId)).toEqual(["web-1"]);
  });

  it("«только последняя попытка» оставляет последнюю попытку участника", async () => {
    const res = await answers("source=web&attempts=last");

    expect(res.body.rows.map((r: { attemptId: string }) => r.attemptId)).toEqual(["web-2"]);
  });

  it("условия отбора уходят в выборку прохождений теста", async () => {
    await answers("source=web&groupId=g1&from=2026-09-01&to=2026-09-02");

    const query = storageMock.selectObservations.mock.calls.at(-1)![0];
    expect(query).toMatchObject({
      testIds: ["test1"],
      sources: ["web"],
      groupIds: ["g1"],
      from: new Date("2026-09-01T00:00:00.000Z"),
      to: new Date("2026-09-02T23:59:59.999Z"),
    });
  });
});

describe("GET .../answers/export/excel — фильтр страницы", () => {
  it("книга собирается по тем же условиям, что список", async () => {
    const res = await request(makeApp())
      .get("/api/analytics/tests/test1/questions/q1/answers/export/excel?source=web&firstAttemptOnly=true")
      .set("x-test-user", "a1")
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body as never);
    const sheet = workbook.getWorksheet("Ответы задания")!;
    const rows: unknown[][] = [];
    sheet.eachRow((row, index) => {
      if (index > 1) rows.push((row.values as unknown[]).slice(1));
    });
    expect(rows).toHaveLength(1);
    expect(rows[0][1]).toBe("Веб");
    expect(rows[0][3]).toBe("Первая попытка");
  });
});
