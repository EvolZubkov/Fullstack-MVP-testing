/**
 * @module tests/routes.analytics-summary.coverage
 *
 * Branch-focused coverage for `server/routes/analytics/summary.ts`. The sibling
 * `routes.analytics-summary.test.ts` establishes the harness and happy paths;
 * this file drives the conditional branches the happy-path suite leaves cold:
 * optional-field fallbacks (name/email/points/percent), adaptive vs standard
 * shaping, per-source filters, the PRD-15 FR-08 readable-test scope (author owner
 * filtering, `has(null)`), 403 for a role without `analytics.read`, and the
 * catch/500 paths.
 *
 * Ветки `combined`/`combined-full` ушли вместе с самими ручками (PRD-56 FR-12).
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

import summaryRouter from "../server/routes/analytics/summary";
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
  app.use("/api/analytics", summaryRouter);
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
  storageMock.selectObservations.mockImplementation(observationsDouble(storageMock as never));
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

