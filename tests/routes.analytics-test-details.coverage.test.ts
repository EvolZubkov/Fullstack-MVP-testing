/**
 * Branch-coverage tests for server/routes/analytics/test-details.ts.
 *
 * Complements routes.analytics-helpers-test-details.test.ts (happy path): here we
 * drive the conditional branches — object-scope 403, handler-side 404, topic-stats
 * passed/failed/neither rollups (with alt field names and adaptive levelIndex),
 * question-stats via the variant.topics path + unknown answers + null difficulty,
 * daily-trends null/old-finish filters, duration counting, adaptive level-stats
 * (failed status, default level name, two-topic sort) and the catch/500 path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { observationsDouble } from "./helpers/observations-double";
import express from "express";
import session from "express-session";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    getTest: vi.fn(),
    getAllAttempts: vi.fn(),
    // PRD-56 FR-33: страница теста читает прохождения через выборку DAL.
    selectObservations: vi.fn(),
    // PRD-56 FR-25: ответы прохождений из LMS — часть выборки страницы теста.
    selectAnswersForTest: vi.fn().mockResolvedValue([]),
    getQuestionsByIds: vi.fn().mockResolvedValue([]),
    getTopics: vi.fn().mockResolvedValue([]),
    // PRD-15 block D: effective-scoring chain sources (no overrides by default).
    getTestSections: vi.fn().mockResolvedValue([]),
    getTestQuestionScoring: vi.fn().mockResolvedValue([]),
    // PRD-56 FR-21: признак «у теста есть шкалы» для вкладки «Шкалы».
    getScales: vi.fn().mockResolvedValue([]),
    // Object-level scope resolution (author owner/grant paths).
    getTestGrantForUser: vi.fn().mockResolvedValue(undefined),
    getTestIdsByOwner: vi.fn().mockResolvedValue([]),
    getUserTestGrants: vi.fn().mockResolvedValue([]),
    isTestAssignedToUser: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));

import testDetailsRouter from "../server/routes/analytics/test-details";

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
  app.use("/api/analytics", testDetailsRouter);
  return app;
}

function asAuthor(req: request.Test) { return req.set("x-test-user", "author1"); }

const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 86400000);

let app: express.Express;
beforeEach(() => {
  vi.clearAllMocks();
  storageMock.selectObservations.mockImplementation(observationsDouble(storageMock as never));
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getQuestionsByIds.mockResolvedValue([]);
  storageMock.getTopics.mockResolvedValue([]);
  storageMock.getTestSections.mockResolvedValue([]);
  storageMock.getTestQuestionScoring.mockResolvedValue([]);
  storageMock.getTestGrantForUser.mockResolvedValue(undefined);
  storageMock.getTestIdsByOwner.mockResolvedValue([]);
  storageMock.getUserTestGrants.mockResolvedValue([]);
  storageMock.isTestAssignedToUser.mockResolvedValue(false);
  storageMock.getUser.mockResolvedValue(authorUser);
  app = makeApp();
});

// ─────────────────────────────────────────────────────────────────────────────
// Scope & error branches
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /:testId — scope & error branches", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(app).get("/api/analytics/test1");
    expect(res.status).toBe(401);
  });

  it("returns 403 when an author has no owner/grant scope", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getTest.mockResolvedValue({ id: "test1", title: "T", mode: "standard", ownerId: "someoneelse" });
    const res = await asAuthor(request(app).get("/api/analytics/test1"));
    expect(res.status).toBe(403);
  });

  it("returns 404 from the handler when the test vanishes after the scope check", async () => {
    storageMock.getTest.mockResolvedValueOnce({ id: "test1", title: "T", mode: "standard", ownerId: null })
      .mockResolvedValueOnce(undefined);
    const res = await asAuthor(request(app).get("/api/analytics/test1"));
    expect(res.status).toBe(404);
  });

  it("returns 500 when attempt loading throws", async () => {
    storageMock.getTest.mockResolvedValue({ id: "test1", title: "T", mode: "standard", ownerId: null });
    storageMock.getAllAttempts.mockRejectedValue(new Error("db down"));
    const res = await asAuthor(request(app).get("/api/analytics/test1"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to fetch test analytics");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Topic stats: passed / failed / neither, alt field names, adaptive levelIndex
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /:testId — разрезы по темам", () => {
  it("считает долю верных по ответам, а взятие порога — по прохождениям", async () => {
    // PRD-56 FR-14a: две разные единицы счёта. Тема из двух вопросов с порогом 75 %:
    // оба участника берут по одному — доля верных 50 %, тему не взял никто.
    storageMock.getTest.mockResolvedValue({
      id: "test1", title: "T", mode: "standard", ownerId: null,
      overallPassRuleJson: { type: "percent", value: 70 },
    });
    storageMock.getTestSections.mockResolvedValue([
      { id: "s1", testId: "test1", topicId: "t1", topicPassRuleJson: { source: "custom", type: "percent", value: 75 } },
    ]);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "Право" }]);
    storageMock.getQuestionsByIds.mockResolvedValue([
      { id: "q1", prompt: "В1", type: "single", topicId: "t1", difficulty: 50, tags: ["Антикоррупция"], correctJson: { correctIndex: 0 } },
      { id: "q2", prompt: "В2", type: "single", topicId: "t1", difficulty: 50, tags: [], correctJson: { correctIndex: 0 } },
    ]);
    const attempt = (id: string, answers: Record<string, number>) => ({
      id, testId: "test1", userId: id,
      startedAt: daysAgo(1), finishedAt: now,
      variantJson: { sections: [{ questionIds: ["q1", "q2"] }] },
      answersJson: answers,
      resultJson: { overallPercent: 50, overallPassed: false, totalPossiblePoints: 2, totalEarnedPoints: 1 },
    });
    storageMock.getAllAttempts.mockResolvedValue([
      attempt("a1", { q1: 0, q2: 1 }),
      attempt("a2", { q1: 1, q2: 0 }),
    ]);

    const res = await asAuthor(request(app).get("/api/analytics/test1"));

    expect(res.status).toBe(200);
    const topic = res.body.topicStats.find((t: any) => t.topicId === "t1");
    expect(topic).toMatchObject({
      correctShare: 50, passedShare: 0, thresholdPercent: 75, inSample: 2,
    });
  });

  it("показывает подтемы внутри темы и наследует им её порог", async () => {
    storageMock.getTest.mockResolvedValue({
      id: "test1", title: "T", mode: "standard", ownerId: null,
      overallPassRuleJson: { type: "percent", value: 70 },
    });
    storageMock.getTestSections.mockResolvedValue([
      { id: "s1", testId: "test1", topicId: "t1", topicPassRuleJson: { source: "inherit_overall" } },
    ]);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "Право" }]);
    storageMock.getQuestionsByIds.mockResolvedValue([
      { id: "q1", prompt: "В1", type: "single", topicId: "t1", difficulty: 50, tags: ["Антикоррупция"], correctJson: { correctIndex: 0 } },
    ]);
    storageMock.getAllAttempts.mockResolvedValue([{
      id: "a1", testId: "test1", userId: "u1",
      startedAt: daysAgo(1), finishedAt: now,
      variantJson: { sections: [{ questionIds: ["q1"] }] },
      answersJson: { q1: 0 },
      resultJson: { overallPercent: 100, overallPassed: true, totalPossiblePoints: 1, totalEarnedPoints: 1 },
    }]);

    const res = await asAuthor(request(app).get("/api/analytics/test1"));

    const topic = res.body.topicStats.find((t: any) => t.topicId === "t1");
    expect(topic.subtopics).toEqual([
      expect.objectContaining({ name: "Антикоррупция", correctShare: 100, thresholdPercent: 70 }),
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Question stats: variant.topics path, unknown answers, null difficulty
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /:testId — question stats branches", () => {
  it("collects question ids from variant.topics, skips unknown answers, defaults null difficulty", async () => {
    storageMock.getTest.mockResolvedValue({ id: "test1", title: "T", mode: "standard", ownerId: null });
    const attempt = {
      id: "a1", testId: "test1", userId: "u1",
      startedAt: daysAgo(1), finishedAt: now,
      variantJson: { topics: [{ topicId: "t1", levelsState: [{ questionIds: ["q1"] }] }] },
      answersJson: { q1: 1, qGhost: 0 }, // wrong answer + unknown question id
      resultJson: { overallPercent: 0, overallPassed: false, topicResults: [] },
    };
    storageMock.getAllAttempts.mockResolvedValue([attempt]);
    storageMock.getQuestionsByIds.mockResolvedValue([
      { id: "q1", topicId: "t1", type: "single", prompt: "S?", dataJson: { options: ["A", "B"] }, correctJson: { correctIndex: 0 }, difficulty: null, contentHash: "h1" },
    ]);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);

    const res = await asAuthor(request(app).get("/api/analytics/test1"));
    expect(res.status).toBe(200);
    expect(res.body.questionStats).toHaveLength(1); // qGhost skipped
    expect(res.body.questionStats[0].difficulty).toBeNull(); // Э4а: незаданная сложность — null, не 50
    expect(res.body.questionStats[0].correctAnswers).toBe(0); // wrong answer
    expect(res.body.questionStats[0].correctPercent).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Динамика сдаваемости и длительность
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /:testId — динамика и длительность", () => {
  it("держит в линии все месяцы, а в длительности — только прохождения с обеими отметками", async () => {
    storageMock.getTest.mockResolvedValue({ id: "test1", title: "T", mode: "standard", ownerId: null });
    const recent = {
      id: "r", testId: "test1", userId: "u1",
      startedAt: new Date(now.getTime() - 60000), finishedAt: now,
      variantJson: { sections: [] },
      resultJson: { overallPercent: 90, overallPassed: true, topicResults: [] },
    };
    // Completed but finishedAt null -> skipped in trends AND not counted for duration.
    const noFinish = {
      id: "n", testId: "test1", userId: "u2",
      startedAt: daysAgo(1), finishedAt: null,
      variantJson: { sections: [] },
      resultJson: { overallPercent: 40, overallPassed: false, topicResults: [] },
    };
    // Прохождение прошлого месяца: в помесячной линии у него СВОЯ точка (FR-13).
    const old = {
      id: "o", testId: "test1", userId: "u3",
      startedAt: daysAgo(41), finishedAt: daysAgo(40),
      variantJson: { sections: [] },
      resultJson: { overallPercent: 20, overallPassed: false, topicResults: [] },
    };
    // Unfinished (result null) -> in totalAttempts but not completed.
    const unfinished = {
      id: "u", testId: "test1", userId: "u4",
      startedAt: daysAgo(1), finishedAt: null, variantJson: null, resultJson: null,
    };
    storageMock.getAllAttempts.mockResolvedValue([recent, noFinish, old, unfinished]);
    storageMock.getTopics.mockResolvedValue([]);

    const res = await asAuthor(request(app).get("/api/analytics/test1"));
    expect(res.status).toBe(200);
    expect(res.body.summary.totalAttempts).toBe(4);
    expect(res.body.summary.completedAttempts).toBe(3);
    // PRD-56 FR-13: линия помесячная, окна в тридцать дней у неё нет — старое прохождение
    // не исчезает, а даёт точку своего месяца. В точку идут ВСЕ прохождения месяца, включая
    // незавершённые: они показывают, сколько людей за тест брались.
    expect(res.body.passTrend.length).toBeGreaterThanOrEqual(1);
    const trendTotal = res.body.passTrend.reduce((sum: number, p: any) => sum + p.attempts, 0);
    expect(trendTotal).toBe(4);
    expect(res.body.summary.avgDuration).toBeGreaterThan(0); // only `recent` had both timestamps
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Adaptive level stats
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /:testId — adaptive level stats", () => {
  it("covers failed status, default level name, zero-answered avg and two-topic sort", async () => {
    storageMock.getTest.mockResolvedValue({ id: "test1", title: "T", mode: "adaptive", ownerId: null });
    const attempt = {
      id: "a1", testId: "test1", userId: "u1",
      startedAt: daysAgo(1), finishedAt: now,
      variantJson: { mode: "adaptive", topics: [] },
      resultJson: {
        overallPercent: 70, overallPassed: true,
        topicResults: [
          {
            topicId: "t2", topicName: "T2", achievedLevelIndex: 0, achievedLevelName: "Beginner",
            levelsAttempted: [
              { levelIndex: 0, levelName: "Beginner", status: "passed", correctCount: 3, questionsAnswered: 4 },
              // failed status + missing counts -> totalAnswered stays 0 -> avgCorrectPercent 0
              { levelIndex: 1, levelName: "Advanced", status: "failed" },
            ],
          },
          {
            // achievedLevelIndex set but NO achievedLevelName -> "Level N" default; different topic for sort.
            topicId: "t1", topicName: "T1", achievedLevelIndex: 2,
            levelsAttempted: [],
          },
        ],
      },
    };
    storageMock.getAllAttempts.mockResolvedValue([attempt]);
    storageMock.getTopics.mockResolvedValue([]);

    const res = await asAuthor(request(app).get("/api/analytics/test1"));
    expect(res.status).toBe(200);
    expect(res.body.levelStats).toBeDefined();
    // Sorted by topicId first (t1 before t2).
    expect(res.body.levelStats[0].topicId).toBe("t1");
    const advanced = res.body.levelStats.find((l: any) => l.topicId === "t2" && l.levelIndex === 1);
    expect(advanced.failedCount).toBe(1);
    expect(advanced.avgCorrectPercent).toBe(0); // zero answered
    const defaulted = res.body.levelStats.find((l: any) => l.topicId === "t1" && l.levelIndex === 2);
    expect(defaulted.levelName).toBe("Level 2"); // achievedLevelName absent -> default
  });
});
