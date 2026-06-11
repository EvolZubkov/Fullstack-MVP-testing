/**
 * @module tests/content-protection
 *
 * Acceptance tests of the PRD-15 block A content protection (FR-02/FR-05/
 * FR-06; audit matrix E-1..E-5, E-9, E-10, E-12): the creator restriction,
 * the 409 referential protection over published dependents, warnings for
 * drafts and drawAll, the admin force override and the publish-time gate.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://fake/test";
});

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    // users / roles
    getUser: vi.fn(),
    getUserRoles: vi.fn(),
    // topics & questions
    getTopic: vi.fn(),
    getTopics: vi.fn(),
    getQuestion: vi.fn(),
    getQuestionsByTopic: vi.fn(),
    deleteTopic: vi.fn(),
    deleteTopicsBulk: vi.fn(),
    deleteQuestion: vi.fn(),
    deleteQuestionsBulk: vi.fn(),
    updateQuestion: vi.fn(),
    getTopicCourses: vi.fn(),
    getTopicEvents: vi.fn(),
    // referential protection (PRD-15 FR-03..FR-05)
    getTestsUsingTopic: vi.fn(),
    getTestSectionsByTopic: vi.fn(),
    getMeasurementsForQuestions: vi.fn(),
    getTopicPageRefs: vi.fn(),
    getAdaptiveLevels: vi.fn(),
    getResultVariables: vi.fn(),
    getTest: vi.fn(),
    // publish gate (E-12)
    getTestSections: vi.fn(),
    patchTestStatus: vi.fn(),
    // snapshot build on publish (PRD-15 block B)
    getScales: vi.fn(),
    getQuestionMeasurements: vi.fn(),
    getResultVariables: vi.fn(),
    getContentPages: vi.fn(),
    getTopicCourses: vi.fn(),
    getTopicEvents: vi.fn(),
    getAdaptiveTopicSettingsByTest: vi.fn(),
    getAdaptiveLevelsByTest: vi.fn(),
    getAdaptiveLevelLinks: vi.fn(),
    getLatestSnapshot: vi.fn(),
    createTestSnapshot: vi.fn(),
    getSnapshotsForTest: vi.fn(),
    getReferencedSnapshotIds: vi.fn(),
    deleteSnapshotById: vi.fn(),
    // tests router extras pulled in by import
    getTests: vi.fn(),
    getTestIdsByOwner: vi.fn(),
    getUserTestGrants: vi.fn(),
    getTestGrantForUser: vi.fn(),
    isTestAssignedToUser: vi.fn(),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/db", () => ({ db: {} }));
vi.mock("../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../server/scorm-exporter", () => ({ generateScormPackage: vi.fn() }));

import topicsRouter from "../server/routes/topics";
import questionsRouter from "../server/routes/questions";
import testsRouter from "../server/routes/tests";

// ─── App and identities ──────────────────────────────────────────────────────

const users: Record<string, { id: string; status: string }> = {
  author1: { id: "author1", status: "active" },
  author2: { id: "author2", status: "active" },
  admin1: { id: "admin1", status: "active" },
};
const rolesByUser: Record<string, string[]> = {
  author1: ["author"],
  author2: ["author"],
  admin1: ["administrator"],
};

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    next();
  });
  app.use("/api/topics", topicsRouter);
  app.use("/api/questions", questionsRouter);
  app.use("/api/tests", testsRouter);
  return app;
}

const as = (who: string) => (req: request.Test) => req.set("x-test-user", who);
const asAuthor1 = as("author1");
const asAuthor2 = as("author2");
const asAdmin = as("admin1");

// ─── Fixtures ────────────────────────────────────────────────────────────────

const topic = { id: "t1", name: "Финансы", createdBy: "author1", folderId: null };
const q1 = {
  id: "q1", topicId: "t1", type: "single", prompt: "Q1?",
  dataJson: { options: ["A", "B"] }, correctJson: { correctIndex: 0 },
  points: 1, difficulty: 50, tags: ["финансы"], createdBy: "author1",
  shuffleAnswers: true, feedbackMode: "general",
};
const q2 = { ...q1, id: "q2", prompt: "Q2?" };

const publishedUsage = {
  id: "pub1", title: "Опубликованный тест", ownerId: "author2",
  status: "published", mode: "standard",
};
const draftUsage = { ...publishedUsage, id: "d1", title: "Черновик", status: "draft" };

const sectionOf = (testId: string, drawCount = 2, extra: Record<string, unknown> = {}) => ({
  id: `s-${testId}`, testId, topicId: "t1", drawCount, drawAll: false,
  drawBlueprintJson: null, ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUser.mockImplementation(async (id: string) => users[id]);
  storageMock.getUserRoles.mockImplementation(async (id: string) => rolesByUser[id] ?? []);
  storageMock.getTopic.mockResolvedValue(topic);
  storageMock.getQuestion.mockImplementation(async (id: string) =>
    id === "q1" ? q1 : id === "q2" ? q2 : undefined,
  );
  storageMock.getQuestionsByTopic.mockResolvedValue([q1, q2]);
  storageMock.getTestsUsingTopic.mockResolvedValue([]);
  storageMock.getTestSectionsByTopic.mockResolvedValue([]);
  storageMock.getMeasurementsForQuestions.mockResolvedValue([]);
  storageMock.getTopicPageRefs.mockResolvedValue([]);
  storageMock.getAdaptiveLevels.mockResolvedValue([]);
  storageMock.getResultVariables.mockResolvedValue([]);
  storageMock.getTestSections.mockResolvedValue([]);
  // Snapshot-build defaults (empty test): the publish path freezes a snapshot.
  storageMock.getScales.mockResolvedValue([]);
  storageMock.getQuestionMeasurements.mockResolvedValue([]);
  storageMock.getContentPages.mockResolvedValue([]);
  storageMock.getTopicCourses.mockResolvedValue([]);
  storageMock.getTopicEvents.mockResolvedValue([]);
  storageMock.getAdaptiveTopicSettingsByTest.mockResolvedValue([]);
  storageMock.getAdaptiveLevelsByTest.mockResolvedValue([]);
  storageMock.getAdaptiveLevelLinks.mockResolvedValue([]);
  storageMock.getLatestSnapshot.mockResolvedValue(undefined);
  storageMock.createTestSnapshot.mockResolvedValue({ id: "snap-1", version: 1 });
  storageMock.getSnapshotsForTest.mockResolvedValue([]);
  storageMock.getReferencedSnapshotIds.mockResolvedValue([]);
  storageMock.getTopics.mockResolvedValue([{ id: "tp1", name: "Финансы" }]);
  storageMock.deleteTopic.mockResolvedValue(true);
  storageMock.deleteQuestion.mockResolvedValue(true);
  storageMock.deleteQuestionsBulk.mockResolvedValue(1);
  storageMock.updateQuestion.mockResolvedValue(q1);
});

// ─── FR-02: creator restriction ──────────────────────────────────────────────

describe("FR-02 — destructive operations are creator/admin only", () => {
  it("denies a foreign author deleting someone else's topic (403)", async () => {
    const res = await asAuthor2(request(makeApp()).delete("/api/topics/t1"));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("content_forbidden");
    expect(storageMock.deleteTopic).not.toHaveBeenCalled();
  });

  it("lets the creator delete their topic when nothing depends on it", async () => {
    const res = await asAuthor1(request(makeApp()).delete("/api/topics/t1"));
    expect(res.status).toBe(200);
  });

  it("lets an administrator delete anyone's unused topic", async () => {
    const res = await asAdmin(request(makeApp()).delete("/api/topics/t1"));
    expect(res.status).toBe(200);
  });

  it("treats NULL-creator (legacy) content as admin-only", async () => {
    storageMock.getTopic.mockResolvedValue({ ...topic, createdBy: null });
    const res = await asAuthor1(request(makeApp()).delete("/api/topics/t1"));
    expect(res.status).toBe(403);
  });

  it("denies a foreign author a grading-affecting question edit (403)", async () => {
    const res = await asAuthor2(
      request(makeApp()).put("/api/questions/q1").send({ correctJson: { correctIndex: 1 } }),
    );
    expect(res.status).toBe(403);
  });

  it("allows a foreign author a non-grading edit (e.g. prompt typo)", async () => {
    const res = await asAuthor2(
      request(makeApp()).put("/api/questions/q1").send({ prompt: "Fixed typo?" }),
    );
    expect(res.status).toBe(200);
  });
});

// ─── E-2: deleting a topic used by tests ─────────────────────────────────────

describe("E-2 — topic deletion vs dependent tests", () => {
  beforeEach(() => {
    storageMock.getTestsUsingTopic.mockResolvedValue([publishedUsage]);
    storageMock.getTestSectionsByTopic.mockResolvedValue([sectionOf("pub1")]);
  });

  it("blocks with 409 and lists the published dependents", async () => {
    const res = await asAuthor1(request(makeApp()).delete("/api/topics/t1"));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("content_in_use");
    expect(res.body.blocking[0].testId).toBe("pub1");
    expect(res.body.blocking[0].title).toBe("Опубликованный тест");
    expect(storageMock.deleteTopic).not.toHaveBeenCalled();
  });

  it("admin ?force=true overrides the block (E-2 override)", async () => {
    const res = await asAdmin(request(makeApp()).delete("/api/topics/t1?force=true"));
    expect(res.status).toBe(200);
    expect(storageMock.deleteTopic).toHaveBeenCalled();
  });

  it("a non-admin cannot force", async () => {
    const res = await asAuthor1(request(makeApp()).delete("/api/topics/t1?force=true"));
    expect(res.status).toBe(409);
  });

  it("draft-only dependents warn instead of blocking", async () => {
    storageMock.getTestsUsingTopic.mockResolvedValue([draftUsage]);
    storageMock.getTestSectionsByTopic.mockResolvedValue([sectionOf("d1")]);
    const res = await asAuthor1(request(makeApp()).delete("/api/topics/t1"));
    expect(res.status).toBe(200);
    expect(res.body.warnings[0].testId).toBe("d1");
  });
});

// ─── E-1: question deletion shrinking the pool below drawCount ──────────────

describe("E-1 — question deletion vs drawCount of a published test", () => {
  it("blocks when the remaining pool is smaller than drawCount", async () => {
    storageMock.getTestsUsingTopic.mockResolvedValue([publishedUsage]);
    storageMock.getTestSectionsByTopic.mockResolvedValue([sectionOf("pub1", 2)]);
    const res = await asAuthor1(request(makeApp()).delete("/api/questions/q1"));
    expect(res.status).toBe(409);
    expect(res.body.blocking[0].issues).toContainEqual({
      kind: "pool_shortfall", required: 2, available: 1,
    });
  });

  it("passes when the pool still covers drawCount", async () => {
    storageMock.getTestsUsingTopic.mockResolvedValue([publishedUsage]);
    storageMock.getTestSectionsByTopic.mockResolvedValue([sectionOf("pub1", 1)]);
    const res = await asAuthor1(request(makeApp()).delete("/api/questions/q1"));
    expect(res.status).toBe(200);
  });
});

// ─── E-3: re-tagging vs blueprint quotas ─────────────────────────────────────

describe("E-3 — re-tagging vs blueprint quotas of a published test", () => {
  it("blocks an edit that makes a quota unsatisfiable", async () => {
    storageMock.getTestsUsingTopic.mockResolvedValue([publishedUsage]);
    storageMock.getTestSectionsByTopic.mockResolvedValue([
      sectionOf("pub1", 2, { drawBlueprintJson: { strata: [{ tag: "финансы", count: 2 }] } }),
    ]);
    // q1 loses its only quota tag -> only q2 remains tagged.
    const res = await asAuthor1(
      request(makeApp()).put("/api/questions/q1").send({ tags: ["другое"] }),
    );
    expect(res.status).toBe(409);
    expect(res.body.blocking[0].issues).toContainEqual({
      kind: "quota_shortfall", tag: "финансы", requested: 2, available: 1,
    });
  });
});

// ─── E-4: difficulty change vs adaptive levels ───────────────────────────────

describe("E-4 — difficulty change vs adaptive levels", () => {
  it("blocks a change that empties an adaptive level", async () => {
    storageMock.getTestsUsingTopic.mockResolvedValue([
      { ...publishedUsage, mode: "adaptive" },
    ]);
    storageMock.getTestSectionsByTopic.mockResolvedValue([sectionOf("pub1", 1)]);
    storageMock.getAdaptiveLevels.mockResolvedValue([
      { levelIndex: 1, levelName: "Профи", minDifficulty: 50, maxDifficulty: 100, questionsCount: 2 },
    ]);
    // q1 drops to 10 -> only q2 (50) remains in the 50..100 level.
    const res = await asAuthor1(
      request(makeApp()).put("/api/questions/q1").send({ difficulty: 10 }),
    );
    expect(res.status).toBe(409);
    expect(res.body.blocking[0].issues).toContainEqual({
      kind: "adaptive_shortfall", levelIndex: 1, levelName: "Профи", required: 2, available: 1,
    });
  });
});

// ─── E-6: emptying a tag referenced by a PRD-2 result-variable formula ──────

describe("E-6 — deleting questions empties a tag used by a result-variable formula", () => {
  it("reports formula_loss with the affected variable labels", async () => {
    storageMock.getTestsUsingTopic.mockResolvedValue([publishedUsage]);
    storageMock.getTestSectionsByTopic.mockResolvedValue([sectionOf("pub1", 1)]);
    // The whole topic pool for the formula inventory is just q1 (tagged финансы).
    storageMock.getQuestionsByTopic.mockResolvedValue([q1]);
    storageMock.getTestSections.mockResolvedValue([sectionOf("pub1", 1)]);
    storageMock.getResultVariables.mockResolvedValue([
      { name: "balance", label: "Финансовый баланс", formula: 'tag("финансы").percent' },
    ]);
    // Deleting q1 leaves the topic empty -> tag «финансы» is emptied.
    const res = await asAuthor1(request(makeApp()).delete("/api/questions/q1"));
    expect(res.status).toBe(409);
    expect(res.body.blocking[0].issues).toContainEqual({
      kind: "formula_loss",
      variableNames: ["Финансовый баланс"],
    });
  });

  it("does not flag a formula whose tag still has questions", async () => {
    storageMock.getTestsUsingTopic.mockResolvedValue([publishedUsage]);
    storageMock.getTestSectionsByTopic.mockResolvedValue([sectionOf("pub1", 1)]);
    storageMock.getQuestionsByTopic.mockResolvedValue([q1, q2]); // both tagged финансы
    storageMock.getTestSections.mockResolvedValue([sectionOf("pub1", 1)]);
    storageMock.getResultVariables.mockResolvedValue([
      { name: "balance", label: "Финансовый баланс", formula: 'tag("финансы").percent' },
    ]);
    // Deleting q1 leaves q2 still tagged финансы -> tag not emptied, pool still
    // covers drawCount, so the delete simply succeeds without any formula_loss.
    const res = await asAuthor1(request(makeApp()).delete("/api/questions/q1"));
    expect(res.status).toBe(200);
    const groups = [...(res.body.blocking ?? []), ...(res.body.warnings ?? [])];
    const issues = groups.flatMap((g: { issues?: { kind: string }[] }) => g.issues ?? []);
    expect(issues.some((i) => i.kind === "formula_loss")).toBe(false);
  });
});

// ─── E-5: measurement loss ───────────────────────────────────────────────────

describe("E-5 — deleting a question that feeds scales of a published test", () => {
  it("blocks and names the lost contributions", async () => {
    storageMock.getTestsUsingTopic.mockResolvedValue([publishedUsage]);
    storageMock.getTestSectionsByTopic.mockResolvedValue([sectionOf("pub1", 1)]);
    storageMock.getMeasurementsForQuestions.mockResolvedValue([
      { testId: "pub1", questionId: "q1" },
    ]);
    const res = await asAuthor1(request(makeApp()).delete("/api/questions/q1"));
    expect(res.status).toBe(409);
    expect(res.body.blocking[0].issues).toContainEqual({
      kind: "measurement_loss", questionIds: ["q1"],
    });
  });
});

// ─── E-9: drawAll shrink is advisory ─────────────────────────────────────────

describe("E-9 — drawAll sections shrink with a warning, never a block", () => {
  it("returns 200 with an advisory warning for a published drawAll dependent", async () => {
    storageMock.getTestsUsingTopic.mockResolvedValue([publishedUsage]);
    storageMock.getTestSectionsByTopic.mockResolvedValue([
      sectionOf("pub1", 0, { drawAll: true }),
    ]);
    const res = await asAuthor1(request(makeApp()).delete("/api/questions/q1"));
    expect(res.status).toBe(200);
    expect(res.body.warnings[0].issues[0].kind).toBe("draw_all_shrink");
  });
});

// ─── E-10: bulk path runs the same guards ────────────────────────────────────

describe("E-10 — bulk delete passes the same protection", () => {
  it("blocks a bulk question delete that breaks a published test", async () => {
    storageMock.getTestsUsingTopic.mockResolvedValue([publishedUsage]);
    storageMock.getTestSectionsByTopic.mockResolvedValue([sectionOf("pub1", 1)]);
    const res = await asAuthor1(
      request(makeApp()).post("/api/questions/bulk-delete").send({ ids: ["q1", "q2"] }),
    );
    expect(res.status).toBe(409);
    expect(storageMock.deleteQuestionsBulk).not.toHaveBeenCalled();
  });
});

// ─── E-12: publish-time gate ─────────────────────────────────────────────────

describe("E-12 — publishing an infeasible test is rejected", () => {
  it("returns 409 publish_infeasible with per-topic findings", async () => {
    storageMock.getTest.mockResolvedValue({
      id: "pub1", title: "Тест", ownerId: "author1", status: "draft",
      mode: "standard", version: 1,
    });
    storageMock.getTestSections.mockResolvedValue([sectionOf("pub1", 5)]);
    const res = await asAuthor1(
      request(makeApp()).patch("/api/tests/pub1/status").send({ status: "published" }),
    );
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("publish_infeasible");
    expect(res.body.findings[0].topicName).toBe("Финансы");
    expect(res.body.findings[0].issues).toContainEqual({
      kind: "pool_shortfall", required: 5, available: 2,
    });
    expect(storageMock.patchTestStatus).not.toHaveBeenCalled();
  });

  it("publishes when every section is satisfiable", async () => {
    storageMock.getTest.mockResolvedValue({
      id: "pub1", title: "Тест", ownerId: "author1", status: "draft",
      mode: "standard", version: 1,
    });
    storageMock.getTestSections.mockResolvedValue([sectionOf("pub1", 2)]);
    storageMock.patchTestStatus.mockResolvedValue({ id: "pub1", status: "published", version: 1 });
    const res = await asAuthor1(
      request(makeApp()).patch("/api/tests/pub1/status").send({ status: "published" }),
    );
    expect(res.status).toBe(200);
  });
});
