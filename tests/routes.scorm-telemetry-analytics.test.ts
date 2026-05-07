/**
 * Tests for scorm-telemetry.ts and analytics/* routes
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";
import crypto from "crypto";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    // scorm-telemetry
    getScormPackage: vi.fn(), getScormPackages: vi.fn(), updateScormPackage: vi.fn(),
    getScormAttemptsByPackage: vi.fn(), getScormAttemptBySession: vi.fn(),
    getNextAttemptNumber: vi.fn(), createScormAttempt: vi.fn(), updateScormAttempt: vi.fn(),
    createScormAnswer: vi.fn(), getScormAttempt: vi.fn(),
    getAllScormAttempts: vi.fn(), getScormAnswersByAttempt: vi.fn(),
    // analytics
    getTests: vi.fn(), getTopics: vi.fn(), getAllAttempts: vi.fn(),
    getTest: vi.fn(), getAttempt: vi.fn(), getQuestionsByIds: vi.fn(),
    getTopicCourses: vi.fn(), getTestSections: vi.fn(),
  }
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));

import scormTelemetryRouter from "../server/routes/scorm-telemetry";
import analyticsGeneralRouter from "../server/routes/analytics/general";
import analyticsAttemptsRouter from "../server/routes/analytics/attempts";
import analyticsScormRouter from "../server/routes/analytics/scorm";
import analyticsCombinedRouter from "../server/routes/analytics/combined";

// ─── App factory ──────────────────────────────────────────────────────────────
const authorUser = {
  id: "author1", email: "a@test.com", name: "Author", role: "author",
  status: "active", mustChangePassword: false, gdprConsent: true,
  passwordHash: "x", emailHash: "x", createdAt: new Date(), lastLoginAt: null, createdBy: null,
};

function makeApp(...routers: [express.Router, string][]) {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    next();
  });
  for (const [router, path] of routers) app.use(path, router);
  return app;
}

function asAuthor(req: request.Test) { return req.set("x-test-user", "author1"); }

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const secretKey = "a".repeat(64);

function makeSignature(packageId: string, sessionId: string, timestamp: string, data: any) {
  const dataToSign = `${packageId}:${sessionId}:${timestamp}:${JSON.stringify(data || {})}`;
  return crypto.createHmac("sha256", secretKey).update(dataToSign).digest("hex");
}

const dbPkg = {
  id: "pkg1", testId: "test1", testTitle: "Test 1", testMode: "standard",
  secretKey, isActive: true, createdAt: new Date(),
};
const dbScormAttempt = {
  id: "satmp1", packageId: "pkg1", sessionId: "sess1", attemptNumber: 1,
  lmsUserId: "lms-u1", lmsUserName: "LMS User", lmsUserEmail: "lms@test.com", lmsUserOrg: null,
  startedAt: new Date(), finishedAt: null, lastActivityAt: new Date(),
  resultPercent: null, resultPassed: null, totalPoints: null, maxPoints: null,
  totalQuestions: null, correctAnswers: null, achievedLevelsJson: null, failedTopicCoursesJson: null,
};
const dbAttemptResult = {
  id: "atmp1", testId: "test1", userId: "u1",
  variantJson: { sections: [{ topicId: "t1", topicName: "JS", questionIds: ["q1"] }] },
  answersJson: { q1: 0 }, resultJson: {
    totalCorrect: 1, totalQuestions: 1, overallPercent: 100,
    totalEarnedPoints: 5, totalPossiblePoints: 5, overallPassed: true,
    topicResults: [{ topicId: "t1", topicName: "JS", correct: 1, total: 1,
      percent: 100, earnedPoints: 5, possiblePoints: 5, passed: true }],
  },
  startedAt: new Date(Date.now() - 60000), finishedAt: new Date(), testVersion: 1,
};

// ─────────────────────────────────────────────────────────────────────────────
// SCORM TELEMETRY — PUBLIC ENDPOINTS (no auth)
// ─────────────────────────────────────────────────────────────────────────────
describe("SCORM Telemetry — POST /scorm-telemetry/start", () => {
  let app: express.Express;
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    app = makeApp([scormTelemetryRouter, "/api"]);
  });

  it("returns 400 when required fields missing", async () => {
    const res = await request(app).post("/api/scorm-telemetry/start").send({ packageId: "pkg1" });
    expect(res.status).toBe(400);
  });

  it("returns 404 when package not found", async () => {
    storageMock.getScormPackage.mockResolvedValue(undefined);
    const ts = String(Date.now());
    const sig = makeSignature("pkg1", "sess1", ts, {});
    const res = await request(app).post("/api/scorm-telemetry/start")
      .send({ packageId: "pkg1", sessionId: "sess1", signature: sig, timestamp: ts });
    expect(res.status).toBe(404);
  });

  it("returns 404 when package is inactive", async () => {
    storageMock.getScormPackage.mockResolvedValue({ ...dbPkg, isActive: false });
    const ts = String(Date.now());
    const sig = makeSignature("pkg1", "sess1", ts, {});
    const res = await request(app).post("/api/scorm-telemetry/start")
      .send({ packageId: "pkg1", sessionId: "sess1", signature: sig, timestamp: ts });
    expect(res.status).toBe(404);
  });

  it("returns 401 when signature invalid", async () => {
    storageMock.getScormPackage.mockResolvedValue(dbPkg);
    const ts = String(Date.now());
    const res = await request(app).post("/api/scorm-telemetry/start")
      .send({ packageId: "pkg1", sessionId: "sess1", signature: "badsig", timestamp: ts });
    expect(res.status).toBe(401);
  });

  it("returns 401 when timestamp expired", async () => {
    storageMock.getScormPackage.mockResolvedValue(dbPkg);
    const ts = String(Date.now() - 10 * 60 * 1000); // 10 min ago
    const sig = makeSignature("pkg1", "sess1", ts, {});
    const res = await request(app).post("/api/scorm-telemetry/start")
      .send({ packageId: "pkg1", sessionId: "sess1", signature: sig, timestamp: ts });
    expect(res.status).toBe(401);
  });

  it("creates new attempt on valid request", async () => {
    storageMock.getScormPackage.mockResolvedValue(dbPkg);
    storageMock.getNextAttemptNumber.mockResolvedValue(1);
    storageMock.getScormAttemptBySession.mockResolvedValue(undefined);
    storageMock.createScormAttempt.mockResolvedValue(dbScormAttempt);
    const ts = String(Date.now());
    const data = { lmsUserId: "u1", lmsUserName: "User" };
    const sig = makeSignature("pkg1", "sess1", ts, data);
    const res = await request(app).post("/api/scorm-telemetry/start")
      .send({ packageId: "pkg1", sessionId: "sess1", signature: sig, timestamp: ts, data });
    expect(res.status).toBe(200);
    expect(res.body.attemptId).toBe("satmp1");
    expect(storageMock.createScormAttempt).toHaveBeenCalled();
  });

  it("resumes existing attempt instead of creating new", async () => {
    storageMock.getScormPackage.mockResolvedValue(dbPkg);
    storageMock.getNextAttemptNumber.mockResolvedValue(1);
    storageMock.getScormAttemptBySession.mockResolvedValue(dbScormAttempt);
    storageMock.updateScormAttempt.mockResolvedValue(dbScormAttempt);
    const ts = String(Date.now());
    const sig = makeSignature("pkg1", "sess1", ts, {});
    const res = await request(app).post("/api/scorm-telemetry/start")
      .send({ packageId: "pkg1", sessionId: "sess1", signature: sig, timestamp: ts });
    expect(res.status).toBe(200);
    expect(storageMock.createScormAttempt).not.toHaveBeenCalled();
    expect(storageMock.updateScormAttempt).toHaveBeenCalled();
  });
});

describe("SCORM Telemetry — POST /scorm-telemetry/answer", () => {
  let app: express.Express;
  beforeEach(() => {
    vi.clearAllMocks();
    app = makeApp([scormTelemetryRouter, "/api"]);
  });

  it("returns 400 when required fields missing", async () => {
    const res = await request(app).post("/api/scorm-telemetry/answer").send({ packageId: "pkg1" });
    expect(res.status).toBe(400);
  });

  it("saves answer for existing attempt", async () => {
    storageMock.getScormPackage.mockResolvedValue(dbPkg);
    storageMock.getScormAttemptBySession.mockResolvedValue(dbScormAttempt);
    storageMock.createScormAnswer.mockResolvedValue({});
    storageMock.updateScormAttempt.mockResolvedValue({});
    const ts = String(Date.now());
    const data = { questionId: "q1", questionPrompt: "Q?", questionType: "single",
      userAnswer: 0, correctAnswer: 0, isCorrect: true, points: 1, maxPoints: 1 };
    const sig = makeSignature("pkg1", "sess1", ts, data);
    const res = await request(app).post("/api/scorm-telemetry/answer")
      .send({ packageId: "pkg1", sessionId: "sess1", signature: sig, timestamp: ts, data });
    expect(res.status).toBe(200);
    expect(storageMock.createScormAnswer).toHaveBeenCalled();
  });

  it("returns 404 when attempt not started yet", async () => {
    storageMock.getScormPackage.mockResolvedValue(dbPkg);
    storageMock.getScormAttemptBySession.mockResolvedValue(undefined);
    const ts = String(Date.now());
    const data = { questionId: "q1" };
    const sig = makeSignature("pkg1", "sess1", ts, data);
    const res = await request(app).post("/api/scorm-telemetry/answer")
      .send({ packageId: "pkg1", sessionId: "sess1", signature: sig, timestamp: ts, data });
    expect(res.status).toBe(404);
  });
});

describe("SCORM Telemetry — POST /scorm-telemetry/finish", () => {
  let app: express.Express;
  beforeEach(() => {
    vi.clearAllMocks();
    app = makeApp([scormTelemetryRouter, "/api"]);
  });

  it("finishes attempt with result data", async () => {
    storageMock.getScormPackage.mockResolvedValue(dbPkg);
    storageMock.getScormAttemptBySession.mockResolvedValue(dbScormAttempt);
    storageMock.updateScormAttempt.mockResolvedValue({});
    const ts = String(Date.now());
    const data = { percent: 85, passed: true, earnedPoints: 17, possiblePoints: 20,
      totalQuestions: 5, correctAnswers: 4 };
    const sig = makeSignature("pkg1", "sess1", ts, data);
    const res = await request(app).post("/api/scorm-telemetry/finish")
      .send({ packageId: "pkg1", sessionId: "sess1", signature: sig, timestamp: ts, data });
    expect(res.status).toBe(200);
    expect(storageMock.updateScormAttempt).toHaveBeenCalledWith("satmp1", expect.objectContaining({
      resultPercent: 85, resultPassed: true, finishedAt: expect.any(Date),
    }));
  });

  it("returns 404 when attempt not found", async () => {
    storageMock.getScormPackage.mockResolvedValue(dbPkg);
    storageMock.getScormAttemptBySession.mockResolvedValue(undefined);
    const ts = String(Date.now());
    const sig = makeSignature("pkg1", "sess1", ts, {});
    const res = await request(app).post("/api/scorm-telemetry/finish")
      .send({ packageId: "pkg1", sessionId: "sess1", signature: sig, timestamp: ts });
    expect(res.status).toBe(404);
  });
});

describe("SCORM Telemetry — package management (author)", () => {
  let app: express.Express;
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    app = makeApp([scormTelemetryRouter, "/api"]);
  });

  it("GET /scorm-packages — returns packages with stats", async () => {
    storageMock.getScormPackages.mockResolvedValue([dbPkg]);
    storageMock.getScormAttemptsByPackage.mockResolvedValue([dbScormAttempt]);
    const res = await asAuthor(request(app).get("/api/scorm-packages"));
    expect(res.status).toBe(200);
    expect(res.body[0].stats.totalAttempts).toBe(1);
  });

  it("GET /scorm-packages — returns 401 when not authenticated", async () => {
    const res = await request(app).get("/api/scorm-packages");
    expect(res.status).toBe(401);
  });

  it("GET /scorm-packages/:id — returns package with attempts", async () => {
    storageMock.getScormPackage.mockResolvedValue(dbPkg);
    storageMock.getScormAttemptsByPackage.mockResolvedValue([dbScormAttempt]);
    const res = await asAuthor(request(app).get("/api/scorm-packages/pkg1"));
    expect(res.status).toBe(200);
    expect(res.body.attempts).toHaveLength(1);
  });

  it("GET /scorm-packages/:id — returns 404 when not found", async () => {
    storageMock.getScormPackage.mockResolvedValue(undefined);
    const res = await asAuthor(request(app).get("/api/scorm-packages/x"));
    expect(res.status).toBe(404);
  });

  it("POST /scorm-packages/:id/regenerate-key — regenerates secret key", async () => {
    storageMock.getScormPackage.mockResolvedValue(dbPkg);
    storageMock.updateScormPackage.mockResolvedValue({});
    const res = await asAuthor(request(app).post("/api/scorm-packages/pkg1/regenerate-key"));
    expect(res.status).toBe(200);
    expect(storageMock.updateScormPackage).toHaveBeenCalledWith("pkg1", expect.objectContaining({ secretKey: expect.any(String) }));
  });

  it("POST /scorm-packages/:id/deactivate — deactivates package", async () => {
    storageMock.getScormPackage.mockResolvedValue(dbPkg);
    storageMock.updateScormPackage.mockResolvedValue({});
    const res = await asAuthor(request(app).post("/api/scorm-packages/pkg1/deactivate"));
    expect(res.status).toBe(200);
    expect(storageMock.updateScormPackage).toHaveBeenCalledWith("pkg1", { isActive: false });
  });

  it("POST /scorm-packages/:id/activate — activates package", async () => {
    storageMock.getScormPackage.mockResolvedValue({ ...dbPkg, isActive: false });
    storageMock.updateScormPackage.mockResolvedValue({});
    const res = await asAuthor(request(app).post("/api/scorm-packages/pkg1/activate"));
    expect(res.status).toBe(200);
    expect(storageMock.updateScormPackage).toHaveBeenCalledWith("pkg1", { isActive: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ANALYTICS — GENERAL
// ─────────────────────────────────────────────────────────────────────────────
describe("Analytics — GET /analytics", () => {
  let app: express.Express;
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    app = makeApp([analyticsGeneralRouter, "/api/analytics"]);
  });

  it("returns 401 when not authenticated", async () => {
    const res = await request(app).get("/api/analytics/");
    expect(res.status).toBe(401);
  });

  it("returns summary, testStats, topicStats, trends", async () => {
    storageMock.getTests.mockResolvedValue([{ id: "test1", title: "Test 1" }]);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);
    storageMock.getAllAttempts.mockResolvedValue([dbAttemptResult]);
    const res = await asAuthor(request(app).get("/api/analytics/"));
    expect(res.status).toBe(200);
    expect(res.body.summary.totalTests).toBe(1);
    expect(res.body.summary.totalAttempts).toBe(1);
    expect(res.body.summary.overallPassRate).toBe(100);
    expect(res.body.testStats).toHaveLength(1);
    expect(res.body.testStats[0].passRate).toBe(100);
    expect(res.body.topicStats).toHaveLength(1);
  });

  it("returns zero stats when no completed attempts", async () => {
    storageMock.getTests.mockResolvedValue([{ id: "test1", title: "Test 1" }]);
    storageMock.getTopics.mockResolvedValue([]);
    storageMock.getAllAttempts.mockResolvedValue([]);
    const res = await asAuthor(request(app).get("/api/analytics/"));
    expect(res.status).toBe(200);
    expect(res.body.summary.totalAttempts).toBe(0);
    expect(res.body.summary.overallPassRate).toBe(0);
    expect(res.body.trends).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ANALYTICS — ATTEMPTS
// ─────────────────────────────────────────────────────────────────────────────
describe("Analytics — attempts routes", () => {
  let app: express.Express;
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    app = makeApp([analyticsAttemptsRouter, "/api/analytics"]);
  });

  it("GET /tests/:testId/attempts — returns attempts list", async () => {
    storageMock.getTest.mockResolvedValue({ id: "test1", title: "Test 1", mode: "standard" });
    storageMock.getAllAttempts.mockResolvedValue([dbAttemptResult]);
    storageMock.getUser
      .mockResolvedValueOnce(authorUser)  // middleware
      .mockResolvedValueOnce({ id: "u1", name: "User", email: "u@test.com" }); // user lookup
    const res = await asAuthor(request(app).get("/api/analytics/tests/test1/attempts"));
    expect(res.status).toBe(200);
    expect(res.body.testTitle).toBe("Test 1");
    expect(res.body.attempts).toHaveLength(1);
    expect(res.body.attempts[0].passed).toBe(true);
  });

  it("GET /tests/:testId/attempts — returns 404 when test not found", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await asAuthor(request(app).get("/api/analytics/tests/x/attempts"));
    expect(res.status).toBe(404);
  });

  it("GET /tests/:testId/attempts — filters to only that test's attempts", async () => {
    storageMock.getTest.mockResolvedValue({ id: "test1", title: "Test 1", mode: "standard" });
    const otherAttempt = { ...dbAttemptResult, id: "other", testId: "test2" };
    storageMock.getAllAttempts.mockResolvedValue([dbAttemptResult, otherAttempt]);
    storageMock.getUser
      .mockResolvedValueOnce(authorUser)
      .mockResolvedValueOnce({ id: "u1", name: "User", email: "u@test.com" });
    const res = await asAuthor(request(app).get("/api/analytics/tests/test1/attempts"));
    expect(res.status).toBe(200);
    expect(res.body.attempts).toHaveLength(1);
  });

  it("GET /attempts/:attemptId — returns 404 when not found", async () => {
    storageMock.getAttempt.mockResolvedValue(undefined);
    const res = await asAuthor(request(app).get("/api/analytics/attempts/x"));
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ANALYTICS — SCORM
// ─────────────────────────────────────────────────────────────────────────────
describe("Analytics — SCORM routes", () => {
  let app: express.Express;
  const finishedScormAttempt = { ...dbScormAttempt, finishedAt: new Date(),
    resultPercent: 90, resultPassed: true, totalPoints: 9, maxPoints: 10,
    totalQuestions: 5, correctAnswers: 4, achievedLevelsJson: null };

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    app = makeApp([analyticsScormRouter, "/api/analytics"]);
  });

  it("GET /scorm-attempts — returns enriched SCORM attempts", async () => {
    storageMock.getAllScormAttempts.mockResolvedValue([finishedScormAttempt]);
    storageMock.getScormPackages.mockResolvedValue([dbPkg]);
    storageMock.getScormAnswersByAttempt.mockResolvedValue([]);
    const res = await asAuthor(request(app).get("/api/analytics/scorm-attempts"));
    expect(res.status).toBe(200);
    expect(res.body[0].testTitle).toBe("Test 1");
    expect(res.body[0].answersCount).toBe(0);
    expect(res.body[0].source).toBe("lms");
  });

  it("GET /scorm-attempts — returns 401 when not authenticated", async () => {
    const res = await request(app).get("/api/analytics/scorm-attempts");
    expect(res.status).toBe(401);
  });

  it("GET /scorm-attempts/:attemptId — returns detailed SCORM attempt", async () => {
    storageMock.getScormAttempt.mockResolvedValue(finishedScormAttempt);
    storageMock.getScormPackage.mockResolvedValue(dbPkg);
    storageMock.getScormAnswersByAttempt.mockResolvedValue([{
      id: "ans1", questionId: "q1", questionPrompt: "Q?", questionType: "single",
      topicId: "t1", topicName: "JS", difficulty: 50, userAnswerJson: 0,
      correctAnswerJson: 0, isCorrect: true, points: 1, maxPoints: 1,
      optionsJson: null, leftItemsJson: null, rightItemsJson: null, itemsJson: null,
      levelIndex: null, levelName: null, answeredAt: new Date(),
    }]);
    const res = await asAuthor(request(app).get("/api/analytics/scorm-attempts/satmp1"));
    expect(res.status).toBe(200);
    expect(res.body.testTitle).toBe("Test 1");
    expect(res.body.answers).toHaveLength(1);
    expect(res.body.topicResults).toHaveLength(1);
  });

  it("GET /scorm-attempts/:attemptId — returns 404 when not found", async () => {
    storageMock.getScormAttempt.mockResolvedValue(undefined);
    const res = await asAuthor(request(app).get("/api/analytics/scorm-attempts/x"));
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ANALYTICS — COMBINED
// ─────────────────────────────────────────────────────────────────────────────
describe("Analytics — combined routes", () => {
  let app: express.Express;
  const finishedScormAttempt = { ...dbScormAttempt, finishedAt: new Date(),
    resultPercent: 90, resultPassed: true, totalPoints: 9, maxPoints: 10 };

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    app = makeApp([analyticsCombinedRouter, "/api/analytics"]);
  });

  it("GET /combined — returns merged web + lms attempts", async () => {
    storageMock.getAllAttempts.mockResolvedValue([dbAttemptResult]);
    storageMock.getAllScormAttempts.mockResolvedValue([finishedScormAttempt]);
    storageMock.getTests.mockResolvedValue([{ id: "test1", title: "Test 1" }]);
    storageMock.getScormPackages.mockResolvedValue([dbPkg]);
    storageMock.getUser
      .mockResolvedValueOnce(authorUser)
      .mockResolvedValueOnce({ id: "u1", name: "User", email: "u@test.com" });
    const res = await asAuthor(request(app).get("/api/analytics/combined"));
    expect(res.status).toBe(200);
    expect(res.body.attempts).toBeDefined();
    const sources = res.body.attempts.map((a: any) => a.source);
    expect(sources).toContain("web");
    expect(sources).toContain("lms");
  });

  it("GET /combined — filters by source=web", async () => {
    storageMock.getAllAttempts.mockResolvedValue([dbAttemptResult]);
    storageMock.getTests.mockResolvedValue([{ id: "test1", title: "Test 1" }]);
    storageMock.getUser
      .mockResolvedValueOnce(authorUser)
      .mockResolvedValueOnce({ id: "u1", name: "User", email: "u@test.com" });
    const res = await asAuthor(request(app).get("/api/analytics/combined?source=web"));
    expect(res.status).toBe(200);
    const sources = res.body.attempts.map((a: any) => a.source);
    expect(sources.every((s: string) => s === "web")).toBe(true);
  });

  it("GET /combined — filters by source=lms", async () => {
    storageMock.getAllScormAttempts.mockResolvedValue([finishedScormAttempt]);
    storageMock.getScormPackages.mockResolvedValue([dbPkg]);
    const res = await asAuthor(request(app).get("/api/analytics/combined?source=lms"));
    expect(res.status).toBe(200);
    const sources = res.body.attempts.map((a: any) => a.source);
    expect(sources.every((s: string) => s === "lms")).toBe(true);
  });

  it("GET /combined — returns 401 when not authenticated", async () => {
    const res = await request(app).get("/api/analytics/combined");
    expect(res.status).toBe(401);
  });
});
