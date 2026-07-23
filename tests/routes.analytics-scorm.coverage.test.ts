/**
 * Branch-coverage tests for server/routes/analytics/scorm.ts.
 *
 * Complements routes.scorm-telemetry-analytics.test.ts (happy path): here we drive
 * the conditional branches — analytics-scope filtering (admin vs author, deleted
 * packages), the missing-package fallbacks, the 403 on a single attempt, the
 * topic rollup with/without topicId and correct/incorrect rows, null-field
 * fallbacks, and the three achievedLevelsJson shapes (object / valid string /
 * invalid string), plus the catch/500 paths.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    getAllScormAttempts: vi.fn().mockResolvedValue([]),
    getScormPackages: vi.fn().mockResolvedValue([]),
    getScormAnswersByAttempt: vi.fn().mockResolvedValue([]),
    getScormAttempt: vi.fn(),
    getScormPackage: vi.fn(),
    // Object-level scope resolution (author owner/grant paths).
    // PRD-2/PRD-5: analytics recomputes scale contributions and indicators from
    // the test's CURRENT config, so `loadScoringConfig` reads these three. Absent
    // stubs made every detail route answer 500 (`source.getScales is not a function`).
    getScales: vi.fn().mockResolvedValue([]),
    getQuestionMeasurements: vi.fn().mockResolvedValue([]),
    getResultVariables: vi.fn().mockResolvedValue([]),
    getTestIdsByOwner: vi.fn().mockResolvedValue([]),
    getUserTestGrants: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));

import scormRouter from "../server/routes/analytics/scorm";

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
  app.use("/api/analytics", scormRouter);
  return app;
}

function asAuthor(req: request.Test) { return req.set("x-test-user", "author1"); }

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const pkgOwned = { id: "pkg1", testId: "test1", testTitle: "Test 1", testMode: "standard" };
const pkgOther = { id: "pkg2", testId: "testOther", testTitle: "Other", testMode: "adaptive" };

const baseAttempt = {
  id: "sa1", packageId: "pkg1", sessionId: "sess1",
  lmsUserId: "lms1", lmsUserName: "LMS User", lmsUserEmail: "lms@x.com", lmsUserOrg: null,
  startedAt: new Date(Date.now() - 60000), finishedAt: new Date(),
  resultPercent: 90, resultPassed: true, totalPoints: 9, maxPoints: 10,
  totalQuestions: 5, correctAnswers: 4, achievedLevelsJson: null,
};

let app: express.Express;
beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getAllScormAttempts.mockResolvedValue([]);
  storageMock.getScormPackages.mockResolvedValue([]);
  storageMock.getScormAnswersByAttempt.mockResolvedValue([]);
  storageMock.getTestIdsByOwner.mockResolvedValue([]);
  storageMock.getUserTestGrants.mockResolvedValue([]);
  storageMock.getUser.mockResolvedValue(authorUser);
  app = makeApp();
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /scorm-attempts
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /scorm-attempts", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(app).get("/api/analytics/scorm-attempts");
    expect(res.status).toBe(401);
  });

  it("admin sees deleted-package attempts with fallbacks", async () => {
    const withPkg = { ...baseAttempt, id: "sa1", packageId: "pkg1" };
    const orphan = { ...baseAttempt, id: "sa2", packageId: "missing" };
    storageMock.getAllScormAttempts.mockResolvedValue([withPkg, orphan]);
    storageMock.getScormPackages.mockResolvedValue([pkgOwned]);
    storageMock.getScormAnswersByAttempt.mockResolvedValue([{ id: "x" }]);

    const res = await asAuthor(request(app).get("/api/analytics/scorm-attempts"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const byId = Object.fromEntries(res.body.map((a: any) => [a.id, a]));
    expect(byId.sa1.testId).toBe("test1");
    expect(byId.sa1.answersCount).toBe(1);
    // Orphaned attempt -> deleted-test fallbacks.
    expect(byId.sa2.testId).toBeNull();
    expect(byId.sa2.testTitle).toBe("Удалённый тест");
    expect(byId.sa2.testMode).toBe("standard");
    expect(byId.sa2.source).toBe("lms");
  });

  it("author scope filters out unreadable and orphaned attempts", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getTestIdsByOwner.mockResolvedValue(["test1"]); // owns test1 only
    const kept = { ...baseAttempt, id: "sa1", packageId: "pkg1" };
    const otherTest = { ...baseAttempt, id: "sa2", packageId: "pkg2" };
    const orphan = { ...baseAttempt, id: "sa3", packageId: "missing" };
    storageMock.getAllScormAttempts.mockResolvedValue([kept, otherTest, orphan]);
    storageMock.getScormPackages.mockResolvedValue([pkgOwned, pkgOther]);

    const res = await asAuthor(request(app).get("/api/analytics/scorm-attempts"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].testId).toBe("test1");
  });

  it("returns 500 when loading throws", async () => {
    storageMock.getAllScormAttempts.mockRejectedValue(new Error("db down"));
    const res = await asAuthor(request(app).get("/api/analytics/scorm-attempts"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to get SCORM attempts");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /scorm-attempts/:attemptId
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /scorm-attempts/:attemptId", () => {
  it("returns 404 when the attempt is not found", async () => {
    storageMock.getScormAttempt.mockResolvedValue(undefined);
    const res = await asAuthor(request(app).get("/api/analytics/scorm-attempts/x"));
    expect(res.status).toBe(404);
  });

  it("returns 403 when scope excludes the (deleted-package) attempt for a non-admin", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getScormAttempt.mockResolvedValue({ ...baseAttempt, packageId: "missing" });
    storageMock.getScormPackage.mockResolvedValue(undefined); // deleted package -> testId null
    const res = await asAuthor(request(app).get("/api/analytics/scorm-attempts/sa1"));
    expect(res.status).toBe(403);
  });

  it("details answers with topic rollup, correct/incorrect and null-point fallbacks", async () => {
    storageMock.getScormAttempt.mockResolvedValue({
      ...baseAttempt, achievedLevelsJson: { levels: [1, 2] },
    });
    storageMock.getScormPackage.mockResolvedValue(pkgOwned);
    storageMock.getScormAnswersByAttempt.mockResolvedValue([
      { questionId: "q1", questionPrompt: "A?", questionType: "single", topicId: "t1", topicName: "JS",
        difficulty: 50, userAnswerJson: 0, correctAnswerJson: 0, isCorrect: true, points: 2, maxPoints: 3,
        optionsJson: null, leftItemsJson: null, rightItemsJson: null, itemsJson: null,
        levelIndex: null, levelName: null, answeredAt: new Date() },
      // incorrect, maxPoints null -> +1, points null -> +0, topicName null -> "Unknown"
      { questionId: "q2", questionPrompt: "B?", questionType: "single", topicId: "t1", topicName: null,
        difficulty: 50, userAnswerJson: 1, correctAnswerJson: 0, isCorrect: false, points: null, maxPoints: null,
        optionsJson: null, leftItemsJson: null, rightItemsJson: null, itemsJson: null,
        levelIndex: null, levelName: null, answeredAt: new Date() },
      // no topicId -> excluded from the topic rollup
      { questionId: "q3", questionPrompt: "C?", questionType: "single", topicId: null, topicName: null,
        difficulty: 50, userAnswerJson: 0, correctAnswerJson: 0, isCorrect: true, points: 1, maxPoints: 1,
        optionsJson: null, leftItemsJson: null, rightItemsJson: null, itemsJson: null,
        levelIndex: null, levelName: null, answeredAt: new Date() },
    ]);

    const res = await asAuthor(request(app).get("/api/analytics/scorm-attempts/sa1"));
    expect(res.status).toBe(200);
    expect(res.body.answers).toHaveLength(3);
    expect(res.body.topicResults).toHaveLength(1); // only t1 rows rolled up
    const t1 = res.body.topicResults[0];
    expect(t1.earnedPoints).toBe(2);      // 2 + 0
    expect(t1.possiblePoints).toBe(4);    // 3 + (null->1)
    expect(t1.percent).toBe(50);          // 2/4
    expect(res.body.achievedLevels).toEqual({ levels: [1, 2] }); // object passthrough
    expect(res.body.duration).toBeGreaterThan(0);
  });

  it("parses achievedLevelsJson when it is a valid JSON string", async () => {
    storageMock.getScormAttempt.mockResolvedValue({
      ...baseAttempt, achievedLevelsJson: '[{"topicId":"t1","levelIndex":2}]',
    });
    storageMock.getScormPackage.mockResolvedValue(pkgOwned);
    const res = await asAuthor(request(app).get("/api/analytics/scorm-attempts/sa1"));
    expect(res.status).toBe(200);
    expect(res.body.achievedLevels).toEqual([{ topicId: "t1", levelIndex: 2 }]);
  });

  it("falls back to null when achievedLevelsJson is an invalid JSON string", async () => {
    storageMock.getScormAttempt.mockResolvedValue({
      ...baseAttempt, achievedLevelsJson: "{not valid json",
    });
    storageMock.getScormPackage.mockResolvedValue(pkgOwned);
    const res = await asAuthor(request(app).get("/api/analytics/scorm-attempts/sa1"));
    expect(res.status).toBe(200);
    expect(res.body.achievedLevels).toBeNull();
  });

  it("applies null-field fallbacks with a deleted package", async () => {
    storageMock.getScormAttempt.mockResolvedValue({
      ...baseAttempt, packageId: "missing",
      startedAt: null, finishedAt: null,
      resultPercent: null, resultPassed: null, totalPoints: null, maxPoints: null,
      achievedLevelsJson: null,
    });
    storageMock.getScormPackage.mockResolvedValue(undefined); // admin -> has(null) allowed
    const res = await asAuthor(request(app).get("/api/analytics/scorm-attempts/sa1"));
    expect(res.status).toBe(200);
    expect(res.body.duration).toBeNull();
    expect(res.body.overallPercent).toBe(0);
    expect(res.body.earnedPoints).toBe(0);
    expect(res.body.possiblePoints).toBe(0);
    expect(res.body.passed).toBe(false);
    expect(res.body.startedAt).toBeNull();
    expect(res.body.testId).toBeNull();
    expect(res.body.testTitle).toBe("Удалённый тест");
    expect(res.body.testMode).toBe("standard");
    expect(res.body.achievedLevels).toBeNull();
  });

  it("returns 500 when loading throws", async () => {
    storageMock.getScormAttempt.mockRejectedValue(new Error("db down"));
    const res = await asAuthor(request(app).get("/api/analytics/scorm-attempts/sa1"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to get attempt details");
  });
});
