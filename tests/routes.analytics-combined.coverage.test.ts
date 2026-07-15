/**
 * @module tests/routes.analytics-combined.coverage
 *
 * Branch-focused coverage for `server/routes/analytics/combined.ts`. The sibling
 * `routes.analytics-combined.test.ts` establishes the harness and happy paths;
 * this file drives the conditional branches the happy-path suite leaves cold:
 * optional-field fallbacks (name/email/points/percent), adaptive vs standard
 * shaping, empty vs populated aggregations, per-source filters, the PRD-15 FR-08
 * readable-test scope (author owner filtering, `has(null)`), the alert threshold,
 * 403 for a role without `analytics.read`, and the catch/500 paths.
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
    getUserRoles: vi.fn(),
    getAttempt: vi.fn(),
    getScormAnswersByAttempt: vi.fn(),
    getQuestionsByIds: vi.fn(),
    // PRD-15 block D: effective-scoring chain sources (no overrides by default).
    getTest: vi.fn(),
    getTestSections: vi.fn(),
    getTestQuestionScoring: vi.fn(),
    // PRD-15 FR-08 readable-test scope sources (author owner + grants).
    getTestIdsByOwner: vi.fn(),
    getUserTestGrants: vi.fn(),
    isTestAssignedToUser: vi.fn(),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/utils/check-answer", () => ({ checkAnswer: vi.fn() }));

import combinedRouter from "../server/routes/analytics/combined";
import { checkAnswer } from "../server/utils/check-answer";

const checkAnswerMock = vi.mocked(checkAnswer);

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
const daysAgo = (n: number) => new Date(now.getTime() - n * 86400000);
const yesterday = daysAgo(1);

const dbTest = { id: "test1", title: "JS Basics", mode: "standard" };
const scormPkg = { id: "pkg1", testId: "test1", testTitle: "JS Basics", testMode: "standard" };

beforeEach(() => {
  vi.resetAllMocks();
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getUser.mockImplementation((id: string) => {
    if (id === "author1") return Promise.resolve(authorUser);
    if (id === "learner1") return Promise.resolve({ id: "learner1", name: "Learner One", email: "l1@test.com" });
    if (id === "learner2") return Promise.resolve({ id: "learner2", name: "Learner Two", email: "l2@test.com" });
    if (id === "noname") return Promise.resolve({ id: "noname", name: null, email: "noname@test.com" });
    // "ghost" and anything else resolves undefined (missing-user branch).
    return Promise.resolve(undefined);
  });
  storageMock.getTests.mockResolvedValue([dbTest]);
  storageMock.getTopics.mockResolvedValue([]);
  storageMock.getScormPackages.mockResolvedValue([scormPkg]);
  storageMock.getScormAnswersByAttempt.mockResolvedValue([]);
  storageMock.getQuestionsByIds.mockResolvedValue([]);
  storageMock.getAllAttempts.mockResolvedValue([]);
  storageMock.getAllScormAttempts.mockResolvedValue([]);
  storageMock.getAttempt.mockResolvedValue(undefined);
  storageMock.getTest.mockResolvedValue(undefined);
  storageMock.getTestSections.mockResolvedValue([]);
  storageMock.getTestQuestionScoring.mockResolvedValue([]);
  storageMock.getTestIdsByOwner.mockResolvedValue([]);
  storageMock.getUserTestGrants.mockResolvedValue([]);
  storageMock.isTestAssignedToUser.mockResolvedValue(false);
  checkAnswerMock.mockReturnValue(1);
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /analytics/combined
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /analytics/combined — branch coverage", () => {
  it("renders 'Unknown' username and null email when the user is missing", async () => {
    storageMock.getAllAttempts.mockResolvedValue([{
      id: "wa-ghost", userId: "ghost", testId: "test1",
      startedAt: yesterday, finishedAt: now,
      answersJson: {}, resultJson: { mode: "standard", overallPassed: true, overallPercent: 70 },
    }]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined"));
    expect(res.status).toBe(200);
    expect(res.body.attempts[0].username).toBe("Unknown");
    expect(res.body.attempts[0].userEmail).toBeNull();
  });

  it("falls back to the user email when the name is empty", async () => {
    storageMock.getAllAttempts.mockResolvedValue([{
      id: "wa-noname", userId: "noname", testId: "test1",
      startedAt: yesterday, finishedAt: now,
      answersJson: {}, resultJson: { mode: "standard", overallPassed: true, overallPercent: 70 },
    }]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined"));
    expect(res.body.attempts[0].username).toBe("noname@test.com");
    expect(res.body.attempts[0].userEmail).toBe("noname@test.com");
  });

  it("defaults points/percent/passed to zero-values when result fields are absent", async () => {
    storageMock.getAllAttempts.mockResolvedValue([{
      id: "wa-bare", userId: "learner1", testId: "test1",
      startedAt: yesterday, finishedAt: now,
      answersJson: {}, resultJson: { mode: "standard" }, // no percent/points/passed
    }]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined"));
    const a = res.body.attempts[0];
    expect(a.resultPercent).toBe(0);
    expect(a.resultPassed).toBe(false);
    expect(a.totalPoints).toBe(0);
    expect(a.maxPoints).toBe(0);
    expect(a.isAdaptive).toBe(false);
  });

  it("includes an LMS attempt on a deleted package (admin has(null)) with fallbacks", async () => {
    storageMock.getAllScormAttempts.mockResolvedValue([{
      id: "la-del", packageId: "gone", lmsUserId: "lmsx",
      startedAt: yesterday, finishedAt: now,
      // resultPercent/passed/points intentionally absent -> falsy-fallback branches
    }]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined"));
    expect(res.status).toBe(200);
    const a = res.body.attempts.find((x: any) => x.id === "la-del");
    expect(a.testId).toBeNull();
    expect(a.testTitle).toBe("Удалённый тест");
    expect(a.resultPercent).toBe(0);
    expect(a.resultPassed).toBe(false);
    expect(a.totalPoints).toBe(0);
    expect(a.maxPoints).toBe(0);
  });

  it("summary avgPercent is 0 when every attempt is adaptive", async () => {
    storageMock.getAllAttempts.mockResolvedValue([{
      id: "wa-ad", userId: "learner1", testId: "test1",
      startedAt: yesterday, finishedAt: now,
      answersJson: {}, resultJson: { mode: "adaptive", overallPassed: true, topicResults: [] },
    }]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined"));
    expect(res.body.summary.avgPercent).toBe(0);
    expect(res.body.summary.adaptiveAttempts).toBe(1);
    expect(res.body.summary.adaptivePassed).toBe(1);
  });

  it("uniqueLmsUsers ignores attempts whose lmsUserId is null", async () => {
    storageMock.getAllScormAttempts.mockResolvedValue([{
      id: "la-null", packageId: "pkg1", lmsUserId: null,
      startedAt: yesterday, finishedAt: now,
      resultPercent: 50, resultPassed: false, totalPoints: 5, maxPoints: 10,
    }]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined"));
    expect(res.body.summary.lmsAttempts).toBe(1);
    expect(res.body.summary.uniqueLmsUsers).toBe(0);
  });

  it("author scope drops attempts on tests the author cannot read", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getTestIdsByOwner.mockResolvedValue(["test1"]);
    const pkg2 = { id: "pkg2", testId: "test2", testTitle: "Other", testMode: "standard" };
    storageMock.getScormPackages.mockResolvedValue([scormPkg, pkg2]);
    storageMock.getAllAttempts.mockResolvedValue([
      { id: "wa1", userId: "learner1", testId: "test1", startedAt: yesterday, finishedAt: now, answersJson: {}, resultJson: { mode: "standard", overallPassed: true, overallPercent: 80 } },
      { id: "wa2", userId: "learner2", testId: "test2", startedAt: yesterday, finishedAt: now, answersJson: {}, resultJson: { mode: "standard", overallPassed: true, overallPercent: 80 } },
    ]);
    storageMock.getAllScormAttempts.mockResolvedValue([
      { id: "la1", packageId: "pkg1", lmsUserId: "lms1", startedAt: yesterday, finishedAt: now, resultPercent: 90, resultPassed: true, totalPoints: 9, maxPoints: 10 },
      { id: "la2", packageId: "pkg2", lmsUserId: "lms2", startedAt: yesterday, finishedAt: now, resultPercent: 90, resultPassed: true, totalPoints: 9, maxPoints: 10 },
    ]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined"));
    expect(res.status).toBe(200);
    expect(res.body.summary.webAttempts).toBe(1);
    expect(res.body.summary.lmsAttempts).toBe(1);
    expect(res.body.attempts.map((a: any) => a.id).sort()).toEqual(["la1", "wa1"]);
  });

  it("returns 403 for a role without analytics.read", async () => {
    storageMock.getUserRoles.mockResolvedValue(["learner"]);
    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined"));
    expect(res.status).toBe(403);
  });

  it("returns 500 when storage throws", async () => {
    storageMock.getAllAttempts.mockRejectedValue(new Error("boom"));
    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to get combined analytics");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /analytics/summary
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /analytics/summary — branch coverage", () => {
  it("applies the LMS testId filter by package testId", async () => {
    const pkg2 = { id: "pkg2", testId: "test2", testTitle: "Other", testMode: "standard" };
    storageMock.getScormPackages.mockResolvedValue([scormPkg, pkg2]);
    storageMock.getAllScormAttempts.mockResolvedValue([
      { id: "la1", packageId: "pkg1", lmsUserId: "lms1", startedAt: yesterday, finishedAt: now, resultPercent: 90, resultPassed: true },
      { id: "la2", packageId: "pkg2", lmsUserId: "lms2", startedAt: yesterday, finishedAt: now, resultPercent: 50, resultPassed: false },
    ]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/summary?testId=test1"));
    expect(res.status).toBe(200);
    expect(res.body.lmsAttempts).toBe(1);
  });

  it("counts a failed LMS attempt with a null user (no unique user, not passed)", async () => {
    storageMock.getAllScormAttempts.mockResolvedValue([{
      id: "la-null", packageId: "pkg1", lmsUserId: null,
      startedAt: yesterday, finishedAt: now,
      resultPercent: 30, resultPassed: false,
    }]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/summary?source=lms"));
    expect(res.body.lmsAttempts).toBe(1);
    expect(res.body.passedAttempts).toBe(0);
    expect(res.body.uniqueLmsUsers).toBe(0);
    expect(res.body.avgPercent).toBeCloseTo(30, 1);
  });

  it("accumulates web percent for a failed standard attempt", async () => {
    storageMock.getAllAttempts.mockResolvedValue([{
      id: "wa-fail", userId: "learner1", testId: "test1",
      startedAt: yesterday, finishedAt: now,
      answersJson: {}, resultJson: { mode: "standard", overallPassed: false, overallPercent: 40 },
    }]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/summary?source=web"));
    expect(res.body.passedAttempts).toBe(0);
    expect(res.body.webAttempts).toBe(1);
    expect(res.body.avgPercent).toBeCloseTo(40, 1);
  });

  it("avgPercent is 0 when the standard count is 0 (adaptive-only)", async () => {
    storageMock.getAllAttempts.mockResolvedValue([{
      id: "wa-ad", userId: "learner1", testId: "test1",
      startedAt: yesterday, finishedAt: now,
      answersJson: {}, resultJson: { mode: "adaptive", overallPassed: true, topicResults: [] },
    }]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/summary?source=web"));
    expect(res.body.avgPercent).toBe(0);
    expect(res.body.adaptiveAttempts).toBe(1);
    expect(res.body.adaptivePassed).toBe(1);
  });

  it("author scope limits the summary aggregate", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getTestIdsByOwner.mockResolvedValue(["test1"]);
    storageMock.getAllAttempts.mockResolvedValue([
      { id: "wa1", userId: "learner1", testId: "test1", startedAt: yesterday, finishedAt: now, answersJson: {}, resultJson: { mode: "standard", overallPassed: true, overallPercent: 80 } },
      { id: "wa2", userId: "learner2", testId: "test2", startedAt: yesterday, finishedAt: now, answersJson: {}, resultJson: { mode: "standard", overallPassed: true, overallPercent: 80 } },
    ]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/summary?source=web"));
    expect(res.body.webAttempts).toBe(1);
    expect(res.body.totalAttempts).toBe(1);
  });

  it("returns 403 for a role without analytics.read", async () => {
    storageMock.getUserRoles.mockResolvedValue(["learner"]);
    const res = await asAuthor(request(makeApp()).get("/api/analytics/summary"));
    expect(res.status).toBe(403);
  });

  it("returns 500 when storage throws", async () => {
    storageMock.getAllAttempts.mockRejectedValue(new Error("boom"));
    const res = await asAuthor(request(makeApp()).get("/api/analytics/summary"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to get summary");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /analytics/combined-full
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /analytics/combined-full — branch coverage", () => {
  it("builds topicStats for a standard web attempt (correct + wrong + unknown question)", async () => {
    const attempt = {
      id: "wa-std", userId: "learner1", testId: "test1",
      startedAt: yesterday, finishedAt: now,
      answersJson: { q1: "a", q2: "a", q3: "a" },
      resultJson: { mode: "standard", overallPassed: true, overallPercent: 60, totalEarnedPoints: 6, totalPossiblePoints: 10 },
    };
    storageMock.getAllAttempts.mockResolvedValue([attempt]);
    storageMock.getAttempt.mockResolvedValue(attempt);
    storageMock.getQuestionsByIds.mockResolvedValue([
      { id: "q1", topicId: "t1", contentHash: null, difficulty: null },
      { id: "q2", topicId: "t1", contentHash: null, difficulty: null },
      // q3 intentionally absent -> `if (!q) continue`
    ]);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "Topic One" }]);
    checkAnswerMock.mockImplementation((q: any) => (q.id === "q1" ? 1 : 0));

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined-full"));
    expect(res.status).toBe(200);
    const t1 = res.body.topicStats.find((t: any) => t.topicId === "t1");
    expect(t1.topicName).toBe("Topic One");
    expect(t1.totalAnswers).toBe(2);
    expect(t1.correctAnswers).toBe(1);
    expect(t1.failureCount).toBe(1);
    expect(t1.avgPercent).toBeCloseTo(50, 1);
  });

  it("builds topicStats for an adaptive web attempt from topicResults", async () => {
    const attempt = {
      id: "wa-adapt", userId: "learner1", testId: "test1",
      startedAt: yesterday, finishedAt: now,
      answersJson: {},
      resultJson: {
        mode: "adaptive", overallPassed: true,
        topicResults: [
          { topicId: "t2", topicName: "Adaptive T2", totalQuestionsAnswered: 4, totalCorrect: 3, achievedLevelIndex: 1 },
          { topicId: "t3", totalQuestionsAnswered: 2, totalCorrect: 2, achievedLevelIndex: null },
        ],
      },
    };
    storageMock.getAllAttempts.mockResolvedValue([attempt]);
    storageMock.getAttempt.mockResolvedValue(attempt);
    storageMock.getTopics.mockResolvedValue([{ id: "t3", name: "MappedT3" }]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined-full"));
    expect(res.status).toBe(200);
    const t2 = res.body.topicStats.find((t: any) => t.topicId === "t2");
    const t3 = res.body.topicStats.find((t: any) => t.topicId === "t3");
    expect(t2.topicName).toBe("Adaptive T2");
    expect(t2.totalAnswers).toBe(4);
    expect(t2.correctAnswers).toBe(3);
    expect(t2.failureCount).toBe(1);
    expect(t3.topicName).toBe("MappedT3");
    expect(t3.failureCount).toBe(0);
    // achievedTopics counts only topics with a non-null achievedLevelIndex.
    expect(res.body.attempts[0].achievedTopics).toBe(1);
    expect(res.body.attempts[0].totalTopics).toBe(2);
  });

  it("adaptive attempt without topicResults yields achievedTopics/totalTopics 0", async () => {
    const attempt = {
      id: "wa-adapt2", userId: "learner1", testId: "test1",
      startedAt: yesterday, finishedAt: now,
      answersJson: {},
      resultJson: { mode: "adaptive", overallPassed: false },
    };
    storageMock.getAllAttempts.mockResolvedValue([attempt]);
    storageMock.getAttempt.mockResolvedValue(attempt);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined-full"));
    expect(res.body.attempts[0].achievedTopics).toBe(0);
    expect(res.body.attempts[0].totalTopics).toBe(0);
    expect(res.body.attempts[0].resultPercent).toBe(0); // adaptive + not passed
  });

  it("builds topicStats from LMS scorm answers with topicName fallbacks", async () => {
    storageMock.getAllScormAttempts.mockResolvedValue([{
      id: "la1", packageId: "pkg1", lmsUserId: "lms1", lmsUserName: "U", lmsUserEmail: "u@x.com",
      startedAt: yesterday, finishedAt: now,
      resultPercent: 90, resultPassed: true, totalPoints: 9, maxPoints: 10,
    }]);
    storageMock.getScormAnswersByAttempt.mockResolvedValue([
      { topicId: "t1", topicName: "Named1", isCorrect: true },
      { topicId: "t3", isCorrect: false }, // no topicName -> topicMap fallback
      { topicId: "t4", isCorrect: true },  // no topicName, not in map -> "Unknown"
      { topicId: null, isCorrect: true },  // skipped
    ]);
    storageMock.getTopics.mockResolvedValue([{ id: "t3", name: "MappedT3" }]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined-full"));
    expect(res.status).toBe(200);
    const t1 = res.body.topicStats.find((t: any) => t.topicId === "t1");
    const t3 = res.body.topicStats.find((t: any) => t.topicId === "t3");
    const t4 = res.body.topicStats.find((t: any) => t.topicId === "t4");
    expect(t1.topicName).toBe("Named1");
    expect(t1.correctAnswers).toBe(1);
    expect(t3.topicName).toBe("MappedT3");
    expect(t3.failureCount).toBe(1);
    expect(t4.topicName).toBe("Unknown");
    expect(res.body.topicStats.find((t: any) => t.topicId === null)).toBeUndefined();
  });

  it("web attempt with null startedAt yields null duration", async () => {
    const attempt = {
      id: "wa-nostart", userId: "learner1", testId: "test1",
      startedAt: null, finishedAt: now,
      answersJson: {}, resultJson: { mode: "standard", overallPassed: true, overallPercent: 70 },
    };
    storageMock.getAllAttempts.mockResolvedValue([attempt]);
    storageMock.getAttempt.mockResolvedValue(attempt);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined-full"));
    expect(res.body.attempts[0].duration).toBeNull();
  });

  it("LMS attempt with null startedAt yields null duration", async () => {
    storageMock.getAllScormAttempts.mockResolvedValue([{
      id: "la-nostart", packageId: "pkg1", lmsUserId: "lms1",
      startedAt: null, finishedAt: now,
      resultPercent: 90, resultPassed: true, totalPoints: 9, maxPoints: 10,
    }]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined-full"));
    expect(res.body.attempts[0].duration).toBeNull();
  });

  it("resolves totalPoints/maxPoints via earnedPoints, then totalEarnedPoints, then 0", async () => {
    const mk = (id: string, resultJson: any) => ({
      id, userId: "learner1", testId: "test1",
      startedAt: yesterday, finishedAt: now, answersJson: {}, resultJson,
    });
    const a1 = mk("wa-e", { mode: "standard", overallPassed: true, overallPercent: 70, earnedPoints: 7, possiblePoints: 9, totalEarnedPoints: 1, totalPossiblePoints: 2 });
    const a2 = mk("wa-t", { mode: "standard", overallPassed: true, overallPercent: 70, totalEarnedPoints: 3, totalPossiblePoints: 5 });
    const a3 = mk("wa-z", { mode: "standard", overallPassed: true, overallPercent: 70 });
    storageMock.getAllAttempts.mockResolvedValue([a1, a2, a3]);
    storageMock.getAttempt.mockImplementation((id: string) =>
      Promise.resolve([a1, a2, a3].find(a => a.id === id) ?? null));

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined-full"));
    const byId = (id: string) => res.body.attempts.find((a: any) => a.id === id);
    expect(byId("wa-e").totalPoints).toBe(7);
    expect(byId("wa-e").maxPoints).toBe(9);
    expect(byId("wa-t").totalPoints).toBe(3);
    expect(byId("wa-t").maxPoints).toBe(5);
    expect(byId("wa-z").totalPoints).toBe(0);
    expect(byId("wa-z").maxPoints).toBe(0);
  });

  it("testMode falls back to 'standard' and title to 'Удалённый тест' when the test is gone", async () => {
    const attempt = {
      id: "wa-gone", userId: "learner1", testId: "deleted-test",
      startedAt: yesterday, finishedAt: now,
      answersJson: {}, resultJson: { mode: "standard", overallPassed: true, overallPercent: 70 },
    };
    storageMock.getTests.mockResolvedValue([]);
    storageMock.getAllAttempts.mockResolvedValue([attempt]);
    storageMock.getAttempt.mockResolvedValue(attempt);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined-full"));
    expect(res.body.attempts[0].testMode).toBe("standard");
    expect(res.body.attempts[0].testTitle).toBe("Удалённый тест");
  });

  it("skips testStats for an LMS attempt without a testId (deleted package)", async () => {
    storageMock.getAllScormAttempts.mockResolvedValue([{
      id: "la-del", packageId: "gone", lmsUserId: "lms1",
      startedAt: yesterday, finishedAt: now,
      resultPercent: 90, resultPassed: true, totalPoints: 9, maxPoints: 10,
    }]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined-full"));
    expect(res.status).toBe(200);
    expect(res.body.attempts).toHaveLength(1);
    expect(res.body.attempts[0].testId).toBeNull();
    expect(res.body.testStats).toEqual([]);
  });

  it("emits an alert when the recent pass rate drops sharply", async () => {
    const recent = Array.from({ length: 3 }, (_, i) => ({
      id: `ar${i}`, userId: "learner1", testId: "alertTest",
      startedAt: daysAgo(1), finishedAt: daysAgo(1),
      answersJson: {}, resultJson: { mode: "standard", overallPassed: false, overallPercent: 20 },
    }));
    const prev = Array.from({ length: 3 }, (_, i) => ({
      id: `ap${i}`, userId: "learner1", testId: "alertTest",
      startedAt: daysAgo(10), finishedAt: daysAgo(10),
      answersJson: {}, resultJson: { mode: "standard", overallPassed: true, overallPercent: 90 },
    }));
    storageMock.getTests.mockResolvedValue([{ id: "alertTest", title: "Alert Test", mode: "standard" }]);
    storageMock.getAllAttempts.mockResolvedValue([...recent, ...prev]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined-full"));
    expect(res.status).toBe(200);
    expect(res.body.alerts).toHaveLength(1);
    expect(res.body.alerts[0].testId).toBe("alertTest");
    expect(res.body.alerts[0].recentPassRate).toBe(0);
    expect(res.body.alerts[0].prevPassRate).toBe(100);
    expect(res.body.alerts[0].drop).toBe(100);
  });

  it("emits no alert when the drop is below the threshold despite enough samples", async () => {
    const mk = (id: string, when: Date) => ({
      id, userId: "learner1", testId: "steadyTest",
      startedAt: when, finishedAt: when,
      answersJson: {}, resultJson: { mode: "standard", overallPassed: true, overallPercent: 90 },
    });
    const recent = Array.from({ length: 3 }, (_, i) => mk(`sr${i}`, daysAgo(1)));
    const prev = Array.from({ length: 3 }, (_, i) => mk(`sp${i}`, daysAgo(10)));
    storageMock.getTests.mockResolvedValue([{ id: "steadyTest", title: "Steady", mode: "standard" }]);
    storageMock.getAllAttempts.mockResolvedValue([...recent, ...prev]);

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined-full"));
    expect(res.body.alerts).toEqual([]);
  });

  it("counts trends only within 30 days and tallies byTest for top-5 tests", async () => {
    const recent = {
      id: "wa-recent", userId: "learner1", testId: "test1",
      startedAt: daysAgo(2), finishedAt: daysAgo(2),
      answersJson: {}, resultJson: { mode: "standard", overallPassed: true, overallPercent: 80 },
    };
    const old = {
      id: "wa-old", userId: "learner1", testId: "test1",
      startedAt: daysAgo(40), finishedAt: daysAgo(40),
      answersJson: {}, resultJson: { mode: "standard", overallPassed: true, overallPercent: 80 },
    };
    storageMock.getAllAttempts.mockResolvedValue([recent, old]);
    storageMock.getAttempt.mockImplementation((id: string) =>
      Promise.resolve([recent, old].find(a => a.id === id) ?? null));

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined-full"));
    expect(res.status).toBe(200);
    // Both attempts count in the summary, only the recent one lands in trends.
    expect(res.body.summary.totalAttempts).toBe(2);
    const trendTotal = res.body.trends.reduce((s: number, t: any) => s + t.attempts, 0);
    expect(trendTotal).toBe(1);
    const recentDate = daysAgo(2).toISOString().split("T")[0];
    const row = res.body.trends.find((t: any) => t.date === recentDate);
    expect(row.attempts).toBe(1);
    expect(row.passRate).toBe(100);
    expect(row.test1).toBe(1); // byTest tally spread into the row
    // A zero-attempt day exercises the avgPercent/passRate else-branch.
    const emptyRow = res.body.trends.find((t: any) => t.attempts === 0);
    expect(emptyRow.avgPercent).toBe(0);
    expect(emptyRow.passRate).toBe(0);
  });

  it("author scope limits combined-full aggregates", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getTestIdsByOwner.mockResolvedValue(["test1"]);
    const a1 = { id: "wa1", userId: "learner1", testId: "test1", startedAt: yesterday, finishedAt: now, answersJson: {}, resultJson: { mode: "standard", overallPassed: true, overallPercent: 80 } };
    const a2 = { id: "wa2", userId: "learner2", testId: "test2", startedAt: yesterday, finishedAt: now, answersJson: {}, resultJson: { mode: "standard", overallPassed: true, overallPercent: 80 } };
    storageMock.getAllAttempts.mockResolvedValue([a1, a2]);
    storageMock.getAttempt.mockImplementation((id: string) =>
      Promise.resolve([a1, a2].find(a => a.id === id) ?? null));

    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined-full"));
    expect(res.body.attempts).toHaveLength(1);
    expect(res.body.attempts[0].id).toBe("wa1");
    expect(res.body.summary.webAttempts).toBe(1);
  });

  it("returns 403 for a role without analytics.read", async () => {
    storageMock.getUserRoles.mockResolvedValue(["learner"]);
    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined-full"));
    expect(res.status).toBe(403);
  });

  it("returns 500 when storage throws", async () => {
    storageMock.getTests.mockRejectedValue(new Error("boom"));
    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined-full"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to get analytics");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Extra data branches (per-source blocks, empty-passRate, optional-field falsy
// sides) not otherwise driven above.
// ══════════════════════════════════════════════════════════════════════════════
const webPassed = {
  id: "wp", userId: "learner1", testId: "test1",
  startedAt: yesterday, finishedAt: now,
  answersJson: {}, resultJson: { mode: "standard", overallPassed: true, overallPercent: 80, totalEarnedPoints: 8, totalPossiblePoints: 10 },
};
const lmsPassed = {
  id: "lp", packageId: "pkg1", lmsUserId: "lms1", lmsUserName: "L", lmsUserEmail: "l@x.com",
  startedAt: yesterday, finishedAt: now,
  resultPercent: 90, resultPassed: true, totalPoints: 9, maxPoints: 10,
};

describe("GET /analytics/combined — extra branches", () => {
  it("source=web skips the LMS block entirely", async () => {
    storageMock.getAllAttempts.mockResolvedValue([webPassed]);
    storageMock.getAllScormAttempts.mockResolvedValue([lmsPassed]);
    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined?source=web"));
    expect(res.body.summary.webAttempts).toBe(1);
    expect(res.body.summary.lmsAttempts).toBe(0);
    expect(storageMock.getAllScormAttempts).not.toHaveBeenCalled();
  });

  it("source=lms skips the web block entirely", async () => {
    storageMock.getAllAttempts.mockResolvedValue([webPassed]);
    storageMock.getAllScormAttempts.mockResolvedValue([lmsPassed]);
    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined?source=lms"));
    expect(res.body.summary.lmsAttempts).toBe(1);
    expect(res.body.summary.webAttempts).toBe(0);
    expect(storageMock.getAllAttempts).not.toHaveBeenCalled();
  });

  it("passRate is 0 when there are no attempts", async () => {
    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined"));
    expect(res.body.summary.totalAttempts).toBe(0);
    expect(res.body.summary.passRate).toBe(0);
  });
});

describe("GET /analytics/summary — extra branches", () => {
  it("adaptive failed attempt does not increment adaptivePassed", async () => {
    storageMock.getAllAttempts.mockResolvedValue([{
      id: "wa-adf", userId: "learner1", testId: "test1",
      startedAt: yesterday, finishedAt: now,
      answersJson: {}, resultJson: { mode: "adaptive", overallPassed: false, topicResults: [] },
    }]);
    const res = await asAuthor(request(makeApp()).get("/api/analytics/summary?source=web"));
    expect(res.body.adaptiveAttempts).toBe(1);
    expect(res.body.adaptivePassed).toBe(0);
  });

  it("standard attempt with missing percent contributes 0 to avg", async () => {
    storageMock.getAllAttempts.mockResolvedValue([{
      id: "wa-np", userId: "learner1", testId: "test1",
      startedAt: yesterday, finishedAt: now,
      answersJson: {}, resultJson: { mode: "standard", overallPassed: true }, // no overallPercent
    }]);
    const res = await asAuthor(request(makeApp()).get("/api/analytics/summary?source=web"));
    expect(res.body.webAttempts).toBe(1);
    expect(res.body.avgPercent).toBe(0);
  });

  it("LMS attempt on a deleted package with missing fields still counts", async () => {
    storageMock.getAllScormAttempts.mockResolvedValue([{
      id: "la-del", packageId: "gone", lmsUserId: "lx",
      startedAt: yesterday, finishedAt: now, // no resultPercent/passed
    }]);
    const res = await asAuthor(request(makeApp()).get("/api/analytics/summary?source=lms"));
    expect(res.body.lmsAttempts).toBe(1);
    expect(res.body.passedAttempts).toBe(0);
    expect(res.body.avgPercent).toBe(0);
  });
});

describe("GET /analytics/combined-full — extra branches", () => {
  it("applies the testId filter across web and lms", async () => {
    const pkg2 = { id: "pkg2", testId: "test2", testTitle: "Other", testMode: "standard" };
    const a1 = { ...webPassed, id: "wa1", testId: "test1" };
    const a2 = { ...webPassed, id: "wa2", testId: "test2" };
    storageMock.getScormPackages.mockResolvedValue([scormPkg, pkg2]);
    storageMock.getAllAttempts.mockResolvedValue([a1, a2]);
    storageMock.getAttempt.mockImplementation((id: string) =>
      Promise.resolve([a1, a2].find(a => a.id === id) ?? null));
    storageMock.getAllScormAttempts.mockResolvedValue([
      { ...lmsPassed, id: "l1", packageId: "pkg1" },
      { ...lmsPassed, id: "l2", packageId: "pkg2" },
    ]);
    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined-full?testId=test1"));
    expect(res.body.attempts.map((a: any) => a.id).sort()).toEqual(["l1", "wa1"]);
  });

  it("web user fallbacks: missing user -> Unknown, empty name -> email", async () => {
    const ghost = { ...webPassed, id: "wa-ghost", userId: "ghost" };
    const noname = { ...webPassed, id: "wa-noname", userId: "noname" };
    storageMock.getAllAttempts.mockResolvedValue([ghost, noname]);
    storageMock.getAttempt.mockImplementation((id: string) =>
      Promise.resolve([ghost, noname].find(a => a.id === id) ?? null));
    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined-full"));
    const byId = (id: string) => res.body.attempts.find((a: any) => a.id === id);
    expect(byId("wa-ghost").username).toBe("Unknown");
    expect(byId("wa-ghost").userEmail).toBeNull();
    expect(byId("wa-noname").username).toBe("noname@test.com");
  });

  it("standard attempt with missing percent yields resultPercent 0", async () => {
    const attempt = {
      id: "wa-np", userId: "learner1", testId: "test1",
      startedAt: yesterday, finishedAt: now,
      answersJson: {}, resultJson: { mode: "standard", overallPassed: true }, // no percent
    };
    storageMock.getAllAttempts.mockResolvedValue([attempt]);
    storageMock.getAttempt.mockResolvedValue(attempt);
    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined-full"));
    expect(res.body.attempts[0].resultPercent).toBe(0);
  });

  it("lms attempt with missing fields yields zero-values", async () => {
    storageMock.getAllScormAttempts.mockResolvedValue([{
      id: "la-bare", packageId: "pkg1", lmsUserId: "lms1",
      startedAt: yesterday, finishedAt: now, // no resultPercent/passed/points
    }]);
    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined-full"));
    const a = res.body.attempts[0];
    expect(a.resultPercent).toBe(0);
    expect(a.resultPassed).toBe(false);
    expect(a.totalPoints).toBe(0);
    expect(a.maxPoints).toBe(0);
  });

  it("adaptive topicResult with missing counts and an unmapped topic -> Unknown/0", async () => {
    const attempt = {
      id: "wa-adz", userId: "learner1", testId: "test1",
      startedAt: yesterday, finishedAt: now, answersJson: {},
      resultJson: { mode: "adaptive", overallPassed: true, topicResults: [{ topicId: "tz", achievedLevelIndex: null }] },
    };
    storageMock.getAllAttempts.mockResolvedValue([attempt]);
    storageMock.getAttempt.mockResolvedValue(attempt);
    storageMock.getTopics.mockResolvedValue([]); // tz not in the map
    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined-full"));
    const tz = res.body.topicStats.find((t: any) => t.topicId === "tz");
    expect(tz.topicName).toBe("Unknown");
    expect(tz.totalAnswers).toBe(0);
    expect(tz.avgPercent).toBe(0);
  });

  it("standard web question whose topic is unmapped -> Unknown topicName", async () => {
    const attempt = {
      id: "wa-uq", userId: "learner1", testId: "test1",
      startedAt: yesterday, finishedAt: now,
      answersJson: { q9: "a" },
      resultJson: { mode: "standard", overallPassed: true, overallPercent: 100 },
    };
    storageMock.getAllAttempts.mockResolvedValue([attempt]);
    storageMock.getAttempt.mockResolvedValue(attempt);
    storageMock.getQuestionsByIds.mockResolvedValue([{ id: "q9", topicId: "tx", contentHash: null, difficulty: null }]);
    storageMock.getTopics.mockResolvedValue([]); // tx not mapped
    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined-full"));
    const tx = res.body.topicStats.find((t: any) => t.topicId === "tx");
    expect(tx.topicName).toBe("Unknown");
    expect(tx.correctAnswers).toBe(1);
  });

  it("alert prev bucket records both passed and failed prev attempts", async () => {
    const recent = Array.from({ length: 3 }, (_, i) => ({
      id: `xr${i}`, userId: "learner1", testId: "mixTest",
      startedAt: daysAgo(1), finishedAt: daysAgo(1),
      answersJson: {}, resultJson: { mode: "standard", overallPassed: true, overallPercent: 90 },
    }));
    const prev = [true, true, false].map((passed, i) => ({
      id: `xp${i}`, userId: "learner1", testId: "mixTest",
      startedAt: daysAgo(10), finishedAt: daysAgo(10),
      answersJson: {}, resultJson: { mode: "standard", overallPassed: passed, overallPercent: passed ? 90 : 20 },
    }));
    storageMock.getTests.mockResolvedValue([{ id: "mixTest", title: "Mix", mode: "standard" }]);
    storageMock.getAllAttempts.mockResolvedValue([...recent, ...prev]);
    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined-full"));
    // recent pass rate (100) is not below prev (66.7), so no alert is emitted.
    expect(res.body.alerts).toEqual([]);
  });

  it("adaptive-from-list attempt whose full result is not adaptive is handled", async () => {
    // Inconsistent state: the list result marks it adaptive, the full attempt does not.
    const listAttempt = {
      id: "wa-inc", userId: "learner1", testId: "test1",
      startedAt: yesterday, finishedAt: now, answersJson: {},
      resultJson: { mode: "adaptive", overallPassed: true, topicResults: [] },
    };
    storageMock.getAllAttempts.mockResolvedValue([listAttempt]);
    storageMock.getAttempt.mockResolvedValue({
      ...listAttempt, answersJson: {}, resultJson: { mode: "standard", overallPassed: true },
    });
    const res = await asAuthor(request(makeApp()).get("/api/analytics/combined-full"));
    expect(res.status).toBe(200);
    expect(res.body.attempts[0].isAdaptive).toBe(true);
    expect(res.body.topicStats).toEqual([]);
  });
});
