/**
 * Tests for analytics/combined.ts routes:
 * - GET /analytics/summary
 * - GET /analytics/combined
 * - GET /analytics/combined-full
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getAllAttempts: vi.fn(),
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
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/utils/check-answer", () => ({
  checkAnswer: vi.fn().mockReturnValue(1),
}));

import combinedRouter from "../server/routes/analytics/combined";

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
  app.use("/api/analytics", combinedRouter);
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
describe("GET /analytics/combined", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(makeApp()).get("/api/analytics/combined");
    expect(res.status).toBe(401);
  });

  it("returns summary and attempts array", async () => {
    storageMock.getAllAttempts.mockResolvedValue([webAttemptPassed]);
    storageMock.getAllScormAttempts.mockResolvedValue([lmsAttemptPassed]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("summary");
    expect(res.body).toHaveProperty("attempts");
    expect(res.body.attempts).toHaveLength(2);
  });

  it("excludes unfinished attempts", async () => {
    storageMock.getAllAttempts.mockResolvedValue([webAttemptPassed, webAttemptUnfinished]);
    storageMock.getAllScormAttempts.mockResolvedValue([]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined"));
    expect(res.body.attempts).toHaveLength(1);
  });

  it("marks web attempts with source=web", async () => {
    storageMock.getAllAttempts.mockResolvedValue([webAttemptPassed]);
    storageMock.getAllScormAttempts.mockResolvedValue([]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined"));
    expect(res.body.attempts[0].source).toBe("web");
  });

  it("marks lms attempts with source=lms", async () => {
    storageMock.getAllAttempts.mockResolvedValue([]);
    storageMock.getAllScormAttempts.mockResolvedValue([lmsAttemptPassed]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined"));
    expect(res.body.attempts[0].source).toBe("lms");
  });

  it("sorts attempts by startedAt descending", async () => {
    const older = {
      ...webAttemptPassed,
      id: "wa-old",
      startedAt: new Date(now.getTime() - 1000000),
      finishedAt: new Date(now.getTime() - 900000),
    };
    const newer = {
      ...webAttemptPassed,
      id: "wa-new",
      startedAt: new Date(now.getTime() - 100),
      finishedAt: new Date(now.getTime() - 50),
    };
    storageMock.getAllAttempts.mockResolvedValue([older, newer]);
    storageMock.getAllScormAttempts.mockResolvedValue([]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined"));
    expect(res.body.attempts[0].id).toBe("wa-new"); // newer first
    expect(res.body.attempts[1].id).toBe("wa-old");
  });

  it("filters by testId", async () => {
    const otherPkg = { id: "pkg2", testId: "other-test", testTitle: "Other", testMode: "standard" };
    const otherLmsAttempt = { ...lmsAttemptPassed, id: "la-other", packageId: "pkg2" };
    storageMock.getAllAttempts.mockResolvedValue([webAttemptPassed]);
    storageMock.getAllScormAttempts.mockResolvedValue([lmsAttemptPassed, otherLmsAttempt]);
    storageMock.getScormPackages.mockResolvedValue([scormPkg, otherPkg]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined?testId=test1"));
    const lmsResults = res.body.attempts.filter((a: any) => a.source === "lms");
    expect(lmsResults).toHaveLength(1);
    expect(lmsResults[0].id).toBe("la1");
  });

  it("adaptive attempt shows resultPercent=100 when passed", async () => {
    const adaptiveAttempt = {
      ...webAttemptPassed, id: "wa-adapt",
      resultJson: { overallPassed: true, mode: "adaptive", topicResults: [] },
    };
    storageMock.getAllAttempts.mockResolvedValue([adaptiveAttempt]);
    storageMock.getAllScormAttempts.mockResolvedValue([]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined"));
    expect(res.body.attempts[0].resultPercent).toBe(100);
    expect(res.body.attempts[0].isAdaptive).toBe(true);
  });

  it("adaptive attempt shows resultPercent=0 when failed", async () => {
    const adaptiveAttempt = {
      ...webAttemptFailed, id: "wa-adapt",
      resultJson: { overallPassed: false, mode: "adaptive", topicResults: [] },
    };
    storageMock.getAllAttempts.mockResolvedValue([adaptiveAttempt]);
    storageMock.getAllScormAttempts.mockResolvedValue([]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined"));
    expect(res.body.attempts[0].resultPercent).toBe(0);
  });

  it("falls back to testTitle 'Удалённый тест' when test not found", async () => {
    storageMock.getAllAttempts.mockResolvedValue([{ ...webAttemptPassed, testId: "deleted-test" }]);
    storageMock.getTests.mockResolvedValue([]);
    storageMock.getAllScormAttempts.mockResolvedValue([]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined"));
    expect(res.body.attempts[0].testTitle).toBe("Удалённый тест");
  });

  it("summary avgPercent excludes adaptive attempts", async () => {
    const adaptiveAttempt = {
      ...webAttemptPassed, id: "wa-adapt",
      resultJson: { overallPassed: true, mode: "adaptive", topicResults: [] },
    };
    // webAttemptPassed has 80%, adaptive should be excluded from avgPercent
    storageMock.getAllAttempts.mockResolvedValue([webAttemptPassed, adaptiveAttempt]);
    storageMock.getAllScormAttempts.mockResolvedValue([]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined"));
    // Only webAttemptPassed (80%) counts, adaptive is excluded
    expect(res.body.summary.avgPercent).toBeCloseTo(80, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("GET /analytics/combined-full", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(makeApp()).get("/api/analytics/combined-full");
    expect(res.status).toBe(401);
  });

  it("returns summary, attempts, testStats, topicStats, trends, top5Tests, alerts", async () => {
    storageMock.getAllAttempts.mockResolvedValue([webAttemptPassed]);
    storageMock.getAllScormAttempts.mockResolvedValue([]);
    storageMock.getAttempt.mockResolvedValue(webAttemptPassed);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined-full"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("summary");
    expect(res.body).toHaveProperty("attempts");
    expect(res.body).toHaveProperty("testStats");
    expect(res.body).toHaveProperty("topicStats");
    expect(res.body).toHaveProperty("trends");
    expect(res.body).toHaveProperty("top5Tests");
    expect(res.body).toHaveProperty("alerts");
  });

  it("trends contains 30 entries (one per day)", async () => {
    storageMock.getAllAttempts.mockResolvedValue([]);
    storageMock.getAllScormAttempts.mockResolvedValue([]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined-full"));
    expect(res.body.trends).toHaveLength(30);
  });

  it("trends are sorted ascending by date", async () => {
    storageMock.getAllAttempts.mockResolvedValue([]);
    storageMock.getAllScormAttempts.mockResolvedValue([]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined-full"));
    const dates = res.body.trends.map((t: any) => t.date);
    const sorted = [...dates].sort();
    expect(dates).toEqual(sorted);
  });

  it("testStats aggregates attempts per test", async () => {
    storageMock.getAllAttempts.mockResolvedValue([webAttemptPassed, webAttemptFailed]);
    storageMock.getAllScormAttempts.mockResolvedValue([lmsAttemptPassed]);
    storageMock.getAttempt.mockImplementation((id: string) => {
      if (id === "wa1") return Promise.resolve(webAttemptPassed);
      if (id === "wa2") return Promise.resolve(webAttemptFailed);
      return Promise.resolve(null);
    });

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined-full"));
    const testStat = res.body.testStats.find((ts: any) => ts.testId === "test1");
    expect(testStat).toBeDefined();
    expect(testStat.totalAttempts).toBe(3);
    expect(testStat.webAttempts).toBe(2);
    expect(testStat.lmsAttempts).toBe(1);
  });

  it("testStats passRate calculation is correct", async () => {
    storageMock.getAllAttempts.mockResolvedValue([webAttemptPassed, webAttemptFailed]);
    storageMock.getAllScormAttempts.mockResolvedValue([]);
    storageMock.getAttempt.mockImplementation((id: string) =>
      Promise.resolve(id === "wa1" ? webAttemptPassed : webAttemptFailed)
    );

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined-full"));
    const testStat = res.body.testStats.find((ts: any) => ts.testId === "test1");
    expect(testStat.passRate).toBeCloseTo(50, 1);
  });

  it("uniqueWebUsers counts distinct userIds", async () => {
    // wa1 and wa2 have different users
    storageMock.getAllAttempts.mockResolvedValue([webAttemptPassed, webAttemptFailed]);
    storageMock.getAllScormAttempts.mockResolvedValue([]);
    storageMock.getAttempt.mockImplementation((id: string) =>
      Promise.resolve(id === "wa1" ? webAttemptPassed : webAttemptFailed)
    );

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined-full"));
    expect(res.body.summary.uniqueWebUsers).toBe(2);
  });

  it("top5Tests returns at most 5 tests sorted by attempts desc", async () => {
    const manyAttempts = Array.from({ length: 10 }, (_, i) => ({
      ...webAttemptPassed,
      id: `wa-${i}`, testId: `test${i}`,
    }));
    storageMock.getTests.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({ id: `test${i}`, title: `Test ${i}`, mode: "standard" }))
    );
    storageMock.getAllAttempts.mockResolvedValue(manyAttempts);
    storageMock.getAllScormAttempts.mockResolvedValue([]);
    storageMock.getAttempt.mockImplementation((id: string) =>
      Promise.resolve(manyAttempts.find(a => a.id === id) || null)
    );

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined-full"));
    expect(res.body.top5Tests.length).toBeLessThanOrEqual(5);
  });

  it("filters by source=web", async () => {
    storageMock.getAllAttempts.mockResolvedValue([webAttemptPassed]);
    storageMock.getAllScormAttempts.mockResolvedValue([lmsAttemptPassed]);
    storageMock.getAttempt.mockResolvedValue(webAttemptPassed);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined-full?source=web"));
    expect(res.body.summary.webAttempts).toBe(1);
    expect(res.body.summary.lmsAttempts).toBe(0);
    expect(storageMock.getAllScormAttempts).not.toHaveBeenCalled();
  });

  it("filters by source=lms", async () => {
    storageMock.getAllAttempts.mockResolvedValue([webAttemptPassed]);
    storageMock.getAllScormAttempts.mockResolvedValue([lmsAttemptPassed]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined-full?source=lms"));
    expect(res.body.summary.lmsAttempts).toBe(1);
    expect(res.body.summary.webAttempts).toBe(0);
    expect(storageMock.getAllAttempts).not.toHaveBeenCalled();
  });

  it("returns empty state gracefully when no attempts", async () => {
    storageMock.getAllAttempts.mockResolvedValue([]);
    storageMock.getAllScormAttempts.mockResolvedValue([]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined-full"));
    expect(res.status).toBe(200);
    expect(res.body.summary.totalAttempts).toBe(0);
    expect(res.body.testStats).toEqual([]);
    expect(res.body.topicStats).toEqual([]);
    expect(res.body.alerts).toEqual([]);
  });
});
