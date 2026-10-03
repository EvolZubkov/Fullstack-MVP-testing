/**
 * Tests for analytics/summary.ts: GET /analytics/summary.
 *
 * `GET /analytics/combined` и `GET /analytics/combined-full` сняты вместе с «Обзором»
 * (PRD-56 FR-12) — вместе с ними ушли и их проверки.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { observationsDouble } from "./helpers/observations-double";
import express from "express";
import session from "express-session";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getAllAttempts: vi.fn(),
    // PRD-56 FR-33: сводка читает прохождения через выборку DAL.
    selectObservations: vi.fn(),
    getAllScormAttempts: vi.fn(),
    getScormPackages: vi.fn(),
    getTests: vi.fn(),
    getTopics: vi.fn(),
    getUser: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    getAttempt: vi.fn(),
    getScormAnswersByAttempt: vi.fn(),
    getQuestionsByIds: vi.fn(),
    // PRD-15 block D: effective-scoring chain sources (no overrides by default).
    getTest: vi.fn(),
    getTestSections: vi.fn(),
    getTestQuestionScoring: vi.fn(),
    // Э3.0: область видимости читателя без роли администратора.
    getTestIdsByOwner: vi.fn(),
    getUserTestGrants: vi.fn(),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/utils/check-answer", () => ({
  checkAnswer: vi.fn().mockReturnValue(1),
}));

import summaryRouter from "../server/routes/analytics/summary";

// ─── App factory ──────────────────────────────────────────────────────────────
const authorUser = {
  id: "author1", email: "a@test.com", name: "Author", role: "author",
  status: "active", mustChangePassword: false, gdprConsent: true,
  passwordHash: "x", emailHash: "x", createdAt: new Date(), lastLoginAt: null, createdBy: null,
};

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    next();
  });
  app.use("/api/analytics", summaryRouter);
  return app;
}

function asAuthor(req: request.Test) { return req.set("x-test-user", "author1"); }

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const now = new Date();
const yesterday = new Date(now.getTime() - 86400000);

const dbTest = { id: "test1", title: "JS Basics", mode: "standard" };

const webAttemptPassed = {
  id: "wa1", userId: "learner1", testId: "test1",
  startedAt: yesterday, finishedAt: now,
  answersJson: { q1: 0 },
  resultJson: { overallPassed: true, overallPercent: 80, totalEarnedPoints: 8, totalPossiblePoints: 10, mode: "standard" },
};
const webAttemptFailed = {
  id: "wa2", userId: "learner2", testId: "test1",
  startedAt: yesterday, finishedAt: now,
  answersJson: { q1: 1 },
  resultJson: { overallPassed: false, overallPercent: 40, totalEarnedPoints: 4, totalPossiblePoints: 10, mode: "standard" },
};
const webAttemptUnfinished = {
  id: "wa3", userId: "learner1", testId: "test1",
  startedAt: yesterday, finishedAt: null,
  answersJson: {}, resultJson: null,
};

const scormPkg = { id: "pkg1", testId: "test1", testTitle: "JS Basics", testMode: "standard" };
const lmsAttemptPassed = {
  id: "la1", packageId: "pkg1", lmsUserId: "lms1", lmsUserName: "LMS User", lmsUserEmail: "lms@x.com",
  startedAt: yesterday, finishedAt: now,
  resultPercent: 90, resultPassed: true, totalPoints: 9, maxPoints: 10,
};
const lmsAttemptFailed = {
  id: "la2", packageId: "pkg1", lmsUserId: "lms2", lmsUserName: null, lmsUserEmail: null,
  startedAt: yesterday, finishedAt: now,
  resultPercent: 50, resultPassed: false, totalPoints: 5, maxPoints: 10,
};
const lmsAttemptUnfinished = {
  id: "la3", packageId: "pkg1", lmsUserId: "lms1",
  startedAt: yesterday, finishedAt: null,
  resultPercent: 0, resultPassed: false, totalPoints: 0, maxPoints: 0,
};

beforeEach(() => {
  vi.resetAllMocks();
  storageMock.selectObservations.mockImplementation(observationsDouble(storageMock as never));
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getUser.mockImplementation((id: string) => {
    if (id === "author1") return Promise.resolve(authorUser);
    if (id === "learner1") return Promise.resolve({ id: "learner1", name: "Learner One", email: "l1@test.com" });
    if (id === "learner2") return Promise.resolve({ id: "learner2", name: "Learner Two", email: "l2@test.com" });
    return Promise.resolve(undefined);
  });
  storageMock.getTests.mockResolvedValue([dbTest]);
  storageMock.getTopics.mockResolvedValue([]);
  storageMock.getScormPackages.mockResolvedValue([scormPkg]);
  storageMock.getScormAnswersByAttempt.mockResolvedValue([]);
  storageMock.getQuestionsByIds.mockResolvedValue([]);
});

// ─────────────────────────────────────────────────────────────────────────────
describe("GET /analytics/summary", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(makeApp()).get("/api/analytics/summary");
    expect(res.status).toBe(401);
  });

  it("returns zeroes when no completed attempts", async () => {
    storageMock.getAllAttempts.mockResolvedValue([]);
    storageMock.getAllScormAttempts.mockResolvedValue([]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/summary"));
    expect(res.status).toBe(200);
    expect(res.body.totalAttempts).toBe(0);
    expect(res.body.passedAttempts).toBe(0);
    expect(res.body.passRate).toBe(0);
    expect(res.body.avgPercent).toBe(0);
    expect(res.body.webAttempts).toBe(0);
    expect(res.body.lmsAttempts).toBe(0);
  });

  it("counts only finished attempts", async () => {
    storageMock.getAllAttempts.mockResolvedValue([webAttemptPassed, webAttemptUnfinished]);
    storageMock.getAllScormAttempts.mockResolvedValue([lmsAttemptUnfinished]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/summary"));
    expect(res.body.totalAttempts).toBe(1);
    expect(res.body.webAttempts).toBe(1);
    expect(res.body.lmsAttempts).toBe(0);
  });

  it("aggregates web + lms attempts", async () => {
    storageMock.getAllAttempts.mockResolvedValue([webAttemptPassed, webAttemptFailed]);
    storageMock.getAllScormAttempts.mockResolvedValue([lmsAttemptPassed]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/summary"));
    expect(res.body.totalAttempts).toBe(3);
    expect(res.body.passedAttempts).toBe(2); // webPassed + lmsPassed
    expect(res.body.webAttempts).toBe(2);
    expect(res.body.lmsAttempts).toBe(1);
  });

  it("calculates passRate correctly", async () => {
    storageMock.getAllAttempts.mockResolvedValue([webAttemptPassed, webAttemptFailed]);
    storageMock.getAllScormAttempts.mockResolvedValue([]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/summary"));
    expect(res.body.passRate).toBeCloseTo(50, 1);
  });

  it("filters by source=web", async () => {
    storageMock.getAllAttempts.mockResolvedValue([webAttemptPassed]);
    storageMock.getAllScormAttempts.mockResolvedValue([lmsAttemptPassed]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/summary?source=web"));
    expect(res.body.webAttempts).toBe(1);
    expect(res.body.lmsAttempts).toBe(0);
    // getAllScormAttempts should not be called when source=web
    expect(storageMock.getAllScormAttempts).not.toHaveBeenCalled();
  });

  it("filters by source=lms", async () => {
    storageMock.getAllAttempts.mockResolvedValue([webAttemptPassed]);
    storageMock.getAllScormAttempts.mockResolvedValue([lmsAttemptPassed]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/summary?source=lms"));
    expect(res.body.lmsAttempts).toBe(1);
    expect(res.body.webAttempts).toBe(0);
    expect(storageMock.getAllAttempts).not.toHaveBeenCalled();
  });

  it("filters by testId", async () => {
    const otherAttempt = { ...webAttemptPassed, id: "wa-other", testId: "other-test" };
    storageMock.getAllAttempts.mockResolvedValue([webAttemptPassed, otherAttempt]);
    storageMock.getAllScormAttempts.mockResolvedValue([]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/summary?testId=test1"));
    expect(res.body.webAttempts).toBe(1);
  });

  it("counts unique web and lms users", async () => {
    storageMock.getAllAttempts.mockResolvedValue([webAttemptPassed, webAttemptFailed]);
    storageMock.getAllScormAttempts.mockResolvedValue([lmsAttemptPassed, lmsAttemptFailed]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/summary"));
    expect(res.body.uniqueWebUsers).toBe(2); // learner1, learner2
    expect(res.body.uniqueLmsUsers).toBe(2); // lms1, lms2
  });

  it("counts adaptive attempts separately", async () => {
    const adaptiveAttempt = {
      ...webAttemptPassed, id: "wa-adapt",
      resultJson: { overallPassed: true, mode: "adaptive", topicResults: [] },
    };
    storageMock.getAllAttempts.mockResolvedValue([webAttemptPassed, adaptiveAttempt]);
    storageMock.getAllScormAttempts.mockResolvedValue([]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/summary"));
    expect(res.body.adaptiveAttempts).toBe(1);
    expect(res.body.adaptivePassed).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Э3.0: вкладка «Тесты» общего уровня — сводка по каждому тесту, вход в аналитику теста.
describe("GET /analytics/tests", () => {
  const later = new Date(now.getTime() + 3600000);

  beforeEach(() => {
    storageMock.getTest.mockImplementation((id: string) =>
      Promise.resolve(id === "test1" ? dbTest : id === "test2" ? { id: "test2", title: "Охрана труда" } : undefined));
  });

  it("returns 401 when not authenticated", async () => {
    const res = await request(makeApp()).get("/api/analytics/tests");
    expect(res.status).toBe(401);
  });

  it("groups finished passages by test, both sources, abandoned ones left out", async () => {
    storageMock.getAllAttempts.mockResolvedValue([webAttemptPassed, webAttemptFailed, webAttemptUnfinished]);
    storageMock.getAllScormAttempts.mockResolvedValue([lmsAttemptPassed, lmsAttemptUnfinished]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/tests"));
    expect(res.status).toBe(200);
    expect(res.body.tests).toHaveLength(1);
    const [row] = res.body.tests;
    expect(row).toMatchObject({ testId: "test1", title: "JS Basics", completedAttempts: 3 });
    // 2 of 3 passed; mean of 80, 40 and 90.
    expect(row.passRate).toBeCloseTo(66.67, 1);
    expect(row.avgPercent).toBeCloseTo(70, 1);
    expect(row.lastAttemptAt).toBe(now.toISOString());
  });

  it("puts the test with the freshest passage first and names a deleted test", async () => {
    const other = { ...webAttemptPassed, id: "wa-t2", testId: "test2", finishedAt: later };
    const orphan = { ...webAttemptFailed, id: "wa-gone", testId: "gone", finishedAt: yesterday, startedAt: yesterday };
    storageMock.getAllAttempts.mockResolvedValue([webAttemptPassed, other, orphan]);
    storageMock.getAllScormAttempts.mockResolvedValue([]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/tests"));
    expect(res.body.tests.map((t: { testId: string }) => t.testId)).toEqual(["test2", "test1", "gone"]);
    expect(res.body.tests[2].title).toBe("Удалённый тест");
  });

  it("leaves pass rate and average empty for a test with no verdict and nothing graded", async () => {
    const survey = {
      ...webAttemptPassed, id: "wa-survey",
      resultJson: { mode: "standard", overallPassed: null, overallPercent: null, totalEarnedPoints: null, totalPossiblePoints: null },
    };
    storageMock.getAllAttempts.mockResolvedValue([survey]);
    storageMock.getAllScormAttempts.mockResolvedValue([]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/tests"));
    expect(res.body.tests[0]).toMatchObject({ completedAttempts: 1, passRate: null, avgPercent: null });
  });

  it("shows nothing outside the reader's scope", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getTestIdsByOwner.mockResolvedValue(["test2"]);
    storageMock.getUserTestGrants.mockResolvedValue([]);
    storageMock.getAllAttempts.mockResolvedValue([webAttemptPassed]);
    storageMock.getAllScormAttempts.mockResolvedValue([]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/tests"));
    expect(res.status).toBe(200);
    expect(res.body.tests).toEqual([]);
  });
});
