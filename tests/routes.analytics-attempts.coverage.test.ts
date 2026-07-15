/**
 * Branch-coverage tests for server/routes/analytics/attempts.ts.
 *
 * Complements routes.scorm-telemetry-analytics.test.ts (the happy-path harness):
 * here we drive the conditional branches — object-scope 403, handler-side 404,
 * adaptive vs standard, unfinished/null-field attempts, snapshot-version
 * fallbacks, the completed/date sort comparator and the catch/500 paths.
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
    getTest: vi.fn(),
    getAllAttempts: vi.fn(),
    getAttempt: vi.fn(),
    getQuestionsByIds: vi.fn().mockResolvedValue([]),
    getTopics: vi.fn().mockResolvedValue([]),
    // PRD-15 block D: effective-scoring chain sources (no overrides by default).
    getTestSections: vi.fn().mockResolvedValue([]),
    getTestQuestionScoring: vi.fn().mockResolvedValue([]),
    // PRD-15 T-20: publication-version resolution.
    getSnapshotsForTest: vi.fn().mockResolvedValue([]),
    getSnapshot: vi.fn().mockResolvedValue(undefined),
    // Object-level scope resolution (author owner/grant paths).
    getTestGrantForUser: vi.fn().mockResolvedValue(undefined),
    getTestIdsByOwner: vi.fn().mockResolvedValue([]),
    getUserTestGrants: vi.fn().mockResolvedValue([]),
    isTestAssignedToUser: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));

import attemptsRouter from "../server/routes/analytics/attempts";

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
  app.use("/api/analytics", attemptsRouter);
  return app;
}

function asAuthor(req: request.Test) { return req.set("x-test-user", "author1"); }

let app: express.Express;
beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getQuestionsByIds.mockResolvedValue([]);
  storageMock.getTopics.mockResolvedValue([]);
  storageMock.getTestSections.mockResolvedValue([]);
  storageMock.getTestQuestionScoring.mockResolvedValue([]);
  storageMock.getSnapshotsForTest.mockResolvedValue([]);
  storageMock.getSnapshot.mockResolvedValue(undefined);
  storageMock.getTestGrantForUser.mockResolvedValue(undefined);
  storageMock.getTestIdsByOwner.mockResolvedValue([]);
  storageMock.getUserTestGrants.mockResolvedValue([]);
  storageMock.isTestAssignedToUser.mockResolvedValue(false);
  storageMock.getUser.mockImplementation((id: string) =>
    Promise.resolve(id === "author1" ? authorUser : { id, name: `User ${id}`, email: `${id}@t.com` }),
  );
  app = makeApp();
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /tests/:testId/attempts
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /tests/:testId/attempts — scope & error branches", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(app).get("/api/analytics/tests/test1/attempts");
    expect(res.status).toBe(401);
  });

  it("returns 403 when an author has no owner/grant scope on the test", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getTest.mockResolvedValue({ id: "test1", title: "T", mode: "standard", ownerId: "someoneelse" });
    const res = await asAuthor(request(app).get("/api/analytics/tests/test1/attempts"));
    expect(res.status).toBe(403);
  });

  it("returns 404 from the handler when the test vanishes after the scope check", async () => {
    // Admin bypasses scope; the middleware sees the test, the handler re-fetch is undefined.
    storageMock.getTest.mockResolvedValueOnce({ id: "test1", title: "T", mode: "standard", ownerId: null })
      .mockResolvedValueOnce(undefined);
    const res = await asAuthor(request(app).get("/api/analytics/tests/test1/attempts"));
    expect(res.status).toBe(404);
  });

  it("returns 500 when attempt loading throws", async () => {
    storageMock.getTest.mockResolvedValue({ id: "test1", title: "T", mode: "standard", ownerId: null });
    storageMock.getAllAttempts.mockRejectedValue(new Error("db down"));
    const res = await asAuthor(request(app).get("/api/analytics/tests/test1/attempts"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to fetch attempts list");
  });
});

describe("GET /tests/:testId/attempts — data branches", () => {
  it("adaptive test: achieved levels, unfinished/null-field attempts, snapshot fallbacks and sort", async () => {
    storageMock.getTest.mockResolvedValue({ id: "test1", title: "Adaptive", mode: "adaptive", ownerId: null });
    storageMock.getSnapshotsForTest.mockResolvedValue([{ id: "snap1", version: 2 }]);

    const a1 = {
      id: "a1", testId: "test1", userId: "u1", snapshotId: "snap1",
      startedAt: new Date(Date.now() - 60000), finishedAt: new Date(),
      variantJson: { mode: "adaptive", topics: [] },
      resultJson: {
        overallPercent: 80, totalEarnedPoints: 8, totalPossiblePoints: 10, overallPassed: true,
        topicResults: [
          { topicId: "t1", topicName: "JS", achievedLevelName: "Профи" },
          { topicId: "t2", topicName: "CSS", achievedLevelName: null },
        ],
      },
    };
    // Unfinished: result null, finishedAt null (duration null, completed false, fallbacks).
    const a2 = {
      id: "a2", testId: "test1", userId: "u2",
      startedAt: new Date(Date.now() - 30000), finishedAt: null,
      variantJson: null, resultJson: null,
    };
    // snapshotId present but absent from the snapshot list -> version resolves to null.
    const a3 = {
      id: "a3", testId: "test1", userId: "u1", snapshotId: "ghost",
      startedAt: new Date(Date.now() - 90000), finishedAt: new Date(Date.now() - 80000),
      variantJson: { mode: "adaptive", topics: [] },
      resultJson: { overallPercent: 50, overallPassed: false, topicResults: [] },
    };
    // startedAt AND finishedAt null -> the "" date fallback in the sort comparator.
    const a4 = {
      id: "a4", testId: "test1", userId: "u3",
      startedAt: null, finishedAt: null, variantJson: null, resultJson: null,
    };
    // Attempt of another test — filtered out.
    const other = { ...a1, id: "z", testId: "test2" };
    storageMock.getAllAttempts.mockResolvedValue([a2, a1, a3, a4, other]);
    // u1 resolves with no name/email (-> "Unknown" via the name||email fallback);
    // u2 resolves undefined (-> absent from the map, "Unknown" via the map fallback).
    storageMock.getUser.mockImplementation((id: string) => {
      if (id === "author1") return Promise.resolve(authorUser);
      if (id === "u1") return Promise.resolve({ id: "u1", name: null, email: null });
      if (id === "u2") return Promise.resolve(undefined);
      return Promise.resolve({ id, name: `User ${id}`, email: `${id}@t.com` });
    });

    const res = await asAuthor(request(app).get("/api/analytics/tests/test1/attempts"));
    expect(res.status).toBe(200);
    expect(res.body.testMode).toBe("adaptive");
    expect(res.body.currentVersion).toBe(2);
    expect(res.body.attempts).toHaveLength(4);

    const byId = Object.fromEntries(res.body.attempts.map((a: any) => [a.attemptId, a]));
    expect(byId.a1.achievedLevels).toEqual([
      { topicName: "JS", levelName: "Профи" },
      { topicName: "CSS", levelName: null },
    ]);
    expect(byId.a1.snapshotVersion).toBe(2);
    expect(byId.a1.duration).toBeGreaterThan(0);
    expect(byId.a1.completed).toBe(true);
    expect(byId.a1.username).toBe("Unknown"); // u1: null name/email
    expect(byId.a2.username).toBe("Unknown"); // u2: not resolvable
    expect(byId.a2.completed).toBe(false);
    expect(byId.a2.duration).toBeNull();
    expect(byId.a2.overallPercent).toBe(0);
    expect(byId.a2.passed).toBe(false);
    expect(byId.a3.snapshotVersion).toBeNull();
    expect(byId.a4.startedAt).toBeNull();

    // Version breakdown: v2 (a1) once, null (a2/a3/a4) three times, newest first.
    expect(res.body.versions).toEqual([
      { snapshotVersion: 2, attemptCount: 1 },
      { snapshotVersion: null, attemptCount: 3 },
    ]);
    // Completed attempts sort ahead of the unfinished ones.
    expect(res.body.attempts[0].completed).toBe(true);
    expect(res.body.attempts[res.body.attempts.length - 1].completed).toBe(false);
  });

  it("standard test with no snapshots: currentVersion null, no achievedLevels", async () => {
    storageMock.getTest.mockResolvedValue({ id: "test1", title: "Std", mode: "standard", ownerId: null });
    storageMock.getSnapshotsForTest.mockResolvedValue([]);
    const a1 = {
      id: "a1", testId: "test1", userId: "u1", snapshotId: null,
      startedAt: new Date(Date.now() - 1000), finishedAt: new Date(),
      variantJson: { sections: [] },
      resultJson: { overallPercent: 70, totalEarnedPoints: 7, totalPossiblePoints: 10, overallPassed: true, topicResults: [] },
    };
    storageMock.getAllAttempts.mockResolvedValue([a1]);
    const res = await asAuthor(request(app).get("/api/analytics/tests/test1/attempts"));
    expect(res.status).toBe(200);
    expect(res.body.currentVersion).toBeNull();
    expect(res.body.attempts[0].achievedLevels).toBeUndefined();
    expect(res.body.attempts[0].snapshotVersion).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /attempts/:attemptId
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /attempts/:attemptId — scope & error branches", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(app).get("/api/analytics/attempts/atmp1");
    expect(res.status).toBe(401);
  });

  it("returns 404 when the attempt is not found", async () => {
    storageMock.getAttempt.mockResolvedValue(undefined);
    const res = await asAuthor(request(app).get("/api/analytics/attempts/x"));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Attempt not found");
  });

  it("returns 404 when the attempt's test is not found", async () => {
    storageMock.getAttempt.mockResolvedValue({ id: "atmp1", testId: "gone", userId: "u1" });
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await asAuthor(request(app).get("/api/analytics/attempts/atmp1"));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Test not found");
  });

  it("returns 403 when an author has no analytics scope on the attempt's test", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getAttempt.mockResolvedValue({ id: "atmp1", testId: "test1", userId: "u1" });
    storageMock.getTest.mockResolvedValue({ id: "test1", title: "T", mode: "standard", ownerId: "someoneelse" });
    const res = await asAuthor(request(app).get("/api/analytics/attempts/atmp1"));
    expect(res.status).toBe(403);
  });

  it("returns 500 when attempt loading throws", async () => {
    storageMock.getAttempt.mockRejectedValue(new Error("db down"));
    const res = await asAuthor(request(app).get("/api/analytics/attempts/atmp1"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to fetch attempt details");
  });
});

describe("GET /attempts/:attemptId — data branches", () => {
  it("standard: unknown answer skipped, missing dataJson keeps raw answers, null result & duration", async () => {
    const questions = [
      { id: "q1", topicId: "t1", type: "single", prompt: "S?", dataJson: null, correctJson: { correctIndex: 0 }, difficulty: 40, contentHash: "h1" },
      { id: "q2", topicId: "t1", type: "multiple", prompt: "M?", dataJson: null, correctJson: { correctIndices: [0] }, difficulty: 40, contentHash: "h2" },
      { id: "q3", topicId: "t1", type: "matching", prompt: "P?", dataJson: null, correctJson: { pairs: [] }, difficulty: 40, contentHash: "h3" },
      { id: "q4", topicId: "t1", type: "ranking", prompt: "R?", dataJson: null, correctJson: { correctOrder: [] }, difficulty: 40, contentHash: "h4" },
    ];
    const attempt = {
      id: "atmp1", testId: "test1", userId: "u1", snapshotId: null,
      startedAt: new Date(Date.now() - 1000), finishedAt: null, // duration null
      variantJson: { sections: [{ topicId: "t1", topicName: "JS", questionIds: ["q1", "q2", "q3", "q4"] }] },
      answersJson: { q1: 0, q2: [0], q3: {}, q4: [0], qGhost: 9 }, // qGhost has no question -> skipped
      resultJson: null, // null result -> response fallbacks
    };
    storageMock.getAttempt.mockResolvedValue(attempt);
    storageMock.getTest.mockResolvedValue({ id: "test1", title: "T", mode: "standard", ownerId: null });
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);
    storageMock.getQuestionsByIds.mockResolvedValue(questions);

    const res = await asAuthor(request(app).get("/api/analytics/attempts/atmp1"));
    expect(res.status).toBe(200);
    expect(res.body.answers).toHaveLength(4); // qGhost skipped
    expect(res.body.duration).toBeNull();
    expect(res.body.overallPercent).toBe(0);
    expect(res.body.passed).toBe(false);
    expect(res.body.snapshotVersion).toBeNull();
    expect(res.body.topicResults).toEqual([]);
    const byId = Object.fromEntries(res.body.answers.map((a: any) => [a.questionId, a]));
    // dataJson null -> the per-type formatters fall through, raw answer preserved.
    expect(byId.q1.userAnswer).toBe(0);
    expect(byId.q2.userAnswer).toEqual([0]);
    // difficulty passes through from the question (40, not the 50 default).
    expect(byId.q1.difficulty).toBe(40);
  });

  it("standard: out-of-range indices exercise the formatter fallbacks; null difficulty/user/startedAt fallbacks", async () => {
    const questions = [
      { id: "q1", topicId: "t1", type: "single", prompt: "S?", dataJson: { options: ["A", "B"] }, correctJson: { correctIndex: 9 }, difficulty: null, contentHash: "h1" },
      { id: "q2", topicId: "t1", type: "multiple", prompt: "M?", dataJson: { options: ["X", "Y"] }, correctJson: { correctIndices: [9] }, difficulty: null, contentHash: "h2" },
      { id: "q3", topicId: "t1", type: "matching", prompt: "P?", dataJson: { left: ["L1"], right: ["R1"] }, correctJson: { pairs: [{ left: 9, right: 9 }] }, difficulty: null, contentHash: "h3" },
      { id: "q4", topicId: "t1", type: "ranking", prompt: "R?", dataJson: { items: ["I1"] }, correctJson: { correctOrder: [9] }, difficulty: null, contentHash: "h4" },
    ];
    const attempt = {
      id: "atmp1", testId: "test1", userId: "ghost", snapshotId: null,
      startedAt: null, finishedAt: null, // startedAt null -> the toISOString || null fallback
      variantJson: { sections: [{ topicId: "t9", topicName: "Missing", questionIds: ["q1", "q2", "q3", "q4"] }] },
      answersJson: { q1: 5, q2: [5], q3: { 5: 9 }, q4: [9] }, // all indices out of range
      resultJson: null,
    };
    storageMock.getAttempt.mockResolvedValue(attempt);
    storageMock.getTest.mockResolvedValue({ id: "test1", title: "T", mode: "standard", ownerId: null });
    storageMock.getTopics.mockResolvedValue([]); // topicMap empty -> "Unknown" topic name
    storageMock.getQuestionsByIds.mockResolvedValue(questions);
    // Attempt user unresolvable -> username "Unknown".
    storageMock.getUser.mockImplementation((id: string) =>
      Promise.resolve(id === "author1" ? authorUser : undefined));

    const res = await asAuthor(request(app).get("/api/analytics/attempts/atmp1"));
    expect(res.status).toBe(200);
    expect(res.body.username).toBe("Unknown");
    expect(res.body.startedAt).toBeNull();
    const byId = Object.fromEntries(res.body.answers.map((a: any) => [a.questionId, a]));
    expect(byId.q1.difficulty).toBe(50);            // null difficulty -> 50 default
    expect(byId.q1.userAnswer).toBe(5);             // options[5] undefined -> raw index
    expect(byId.q2.userAnswer).toEqual([]);         // out-of-range filtered out
    expect(byId.q4.userAnswer).toEqual([]);         // ranking filtered out
    expect(byId.q1.topicName).toBe("Unknown");      // topic not in map
  });

  it("adaptive: null finalLevelIndex -> null level, non-terminal status skipped in trajectory, missing snapshot -> null version", async () => {
    const attempt = {
      id: "atmp1", testId: "test1", userId: "u1", snapshotId: "s1",
      startedAt: new Date(Date.now() - 1000), finishedAt: new Date(),
      variantJson: {
        mode: "adaptive",
        topics: [{
          topicId: "t1", topicName: "JS", finalLevelIndex: null,
          levelsState: [
            { levelIndex: 0, levelName: "База", questionIds: ["q1"], answeredQuestionIds: ["q1"], status: "passed" },
            { levelIndex: 1, levelName: "Средний", questionIds: [], answeredQuestionIds: [], status: "in_progress" },
          ],
        }],
      },
      answersJson: { q1: 0 },
      resultJson: { mode: "adaptive", overallPassed: false, topicResults: [] },
    };
    storageMock.getAttempt.mockResolvedValue(attempt);
    storageMock.getTest.mockResolvedValue({ id: "test1", title: "T", mode: "adaptive", ownerId: null });
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);
    storageMock.getQuestionsByIds.mockResolvedValue([
      { id: "q1", topicId: "t1", type: "single", prompt: "S?", dataJson: { options: ["A", "B"] }, correctJson: { correctIndex: 0 }, difficulty: 50, contentHash: "h1" },
    ]);
    storageMock.getSnapshot.mockResolvedValue(undefined); // snapshotId set but not found -> null

    const res = await asAuthor(request(app).get("/api/analytics/attempts/atmp1"));
    expect(res.status).toBe(200);
    expect(res.body.snapshotVersion).toBeNull();
    // finalLevelIndex null -> levelName null.
    expect(res.body.achievedLevels).toEqual([
      { topicId: "t1", topicName: "JS", levelIndex: null, levelName: null },
    ]);
    // Only the "passed" level produces a trajectory step; the "in_progress" one is dropped.
    expect(res.body.trajectory).toEqual([
      expect.objectContaining({ action: "level_up", levelName: "База" }),
    ]);
    // The answered level name is resolved from levelsState.
    expect(res.body.answers[0].levelName).toBe("База");
  });
});
