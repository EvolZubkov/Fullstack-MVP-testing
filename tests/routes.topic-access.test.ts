/**
 * @module tests/routes.topic-access
 *
 * Route tests for PRD-15 block C (T-27/T-28): topic access grants, owner and
 * visibility endpoints, plus the list/question scoping and the test-section
 * visibility guard. The object-level resolution itself is unit-tested in
 * tests/topic-access.test.ts; here we exercise the HTTP surface and the
 * capability/owner gates as wired in the routers.
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
    getUser: vi.fn(),
    getUserRoles: vi.fn(),
    getUserGroups: vi.fn(),
    getGroup: vi.fn(),
    // topics
    getTopic: vi.fn(),
    getTopics: vi.fn(),
    createTopic: vi.fn(),
    updateTopic: vi.fn(),
    getTopicCourses: vi.fn(),
    getTopicEvents: vi.fn(),
    getQuestionsByTopic: vi.fn(),
    // visibility scope
    getSharedTopicIds: vi.fn(),
    getTopicIdsByOwner: vi.fn(),
    getActiveTopicGrantsForGrantees: vi.fn(),
    // grants
    getTopicGrants: vi.fn(),
    upsertTopicGrant: vi.fn(),
    removeTopicGrant: vi.fn(),
    setTopicGrantState: vi.fn(),
    setTopicVisibility: vi.fn(),
    setTopicOwner: vi.fn(),
    // hard-revoke feasibility
    getTestsUsingTopic: vi.fn(),
    getGroupUsers: vi.fn(),
    // questions
    getQuestions: vi.fn(),
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

const users: Record<string, { id: string; name?: string; status: string }> = {
  author1: { id: "author1", name: "Автор Один", status: "active" },
  author2: { id: "author2", name: "Автор Два", status: "active" },
  admin1: { id: "admin1", name: "Админ", status: "active" },
  u9: { id: "u9", name: "Грантополучатель", status: "active" },
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

const t1 = { id: "t1", name: "Тема 1", ownerId: "author1", visibility: "private" };
const t2 = { id: "t2", name: "Тема 2", ownerId: "author2", visibility: "private" };
const tS = { id: "tS", name: "Общая", ownerId: null, visibility: "shared" };
const topicsById: Record<string, typeof t1 | typeof tS> = { t1, t2, tS } as any;

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUser.mockImplementation(async (id: string) => users[id]);
  storageMock.getUserRoles.mockImplementation(async (id: string) => rolesByUser[id] ?? []);
  storageMock.getUserGroups.mockResolvedValue([]);
  storageMock.getGroup.mockResolvedValue(undefined);
  storageMock.getTopic.mockImplementation(async (id: string) => topicsById[id]);
  storageMock.getTopics.mockResolvedValue([t1, t2, tS]);
  storageMock.createTopic.mockImplementation(async (t: any) => ({
    id: "new-topic", ownerId: "author1", visibility: "private", ...t,
  }));
  storageMock.updateTopic.mockImplementation(async (id: string, patch: any) => ({
    ...(topicsById[id] ?? {}), id, ...patch,
  }));
  storageMock.getTopicCourses.mockResolvedValue([]);
  storageMock.getTopicEvents.mockResolvedValue([]);
  storageMock.getQuestionsByTopic.mockResolvedValue([]);
  // author1's visible scope: shared (tS) + owned (t1); no grants.
  storageMock.getSharedTopicIds.mockResolvedValue(["tS"]);
  storageMock.getTopicIdsByOwner.mockImplementation(async (uid: string) =>
    uid === "author1" ? ["t1"] : uid === "author2" ? ["t2"] : [],
  );
  storageMock.getActiveTopicGrantsForGrantees.mockResolvedValue([]);
  storageMock.getTopicGrants.mockResolvedValue([]);
  storageMock.upsertTopicGrant.mockImplementation(async (g: any) => ({ id: "grant-1", ...g }));
  storageMock.removeTopicGrant.mockResolvedValue(true);
  storageMock.setTopicGrantState.mockResolvedValue(undefined);
  storageMock.setTopicVisibility.mockResolvedValue(undefined);
  storageMock.setTopicOwner.mockResolvedValue(undefined);
  storageMock.getTestsUsingTopic.mockResolvedValue([]);
  storageMock.getGroupUsers.mockResolvedValue([]);
  storageMock.getQuestions.mockResolvedValue([
    { id: "qA", topicId: "t1", prompt: "A" },
    { id: "qB", topicId: "t2", prompt: "B" },
    { id: "qC", topicId: "tS", prompt: "C" },
  ]);
});

// ─── GET /api/topics — visibility scope (FR-22) ──────────────────────────────

describe("GET /api/topics — scoped to the visible set", () => {
  it("returns only shared + owned + granted topics for an author", async () => {
    const res = await asAuthor1(request(makeApp()).get("/api/topics"));
    expect(res.status).toBe(200);
    const ids = res.body.map((t: { id: string }) => t.id).sort();
    expect(ids).toEqual(["t1", "tS"]);
  });

  it("returns every topic for an administrator", async () => {
    const res = await asAdmin(request(makeApp()).get("/api/topics"));
    expect(res.status).toBe(200);
    expect(res.body.map((t: { id: string }) => t.id).sort()).toEqual(["t1", "t2", "tS"]);
  });
});

// ─── GET /api/questions — inherit topic visibility (FR-22) ───────────────────

describe("GET /api/questions — inherits topic visibility", () => {
  it("hides questions whose topic the author cannot see", async () => {
    const res = await asAuthor1(request(makeApp()).get("/api/questions"));
    expect(res.status).toBe(200);
    expect(res.body.map((q: { id: string }) => q.id).sort()).toEqual(["qA", "qC"]);
  });

  it("returns all questions for an administrator", async () => {
    const res = await asAdmin(request(makeApp()).get("/api/questions"));
    expect(res.status).toBe(200);
    expect(res.body.map((q: { id: string }) => q.id).sort()).toEqual(["qA", "qB", "qC"]);
  });
});

// ─── Topic access grants (T-27) ──────────────────────────────────────────────

describe("GET /api/topics/:id/access — owner or admin only", () => {
  it("returns owner, visibility and grants (with resolved names) for the owner", async () => {
    storageMock.getTopicGrants.mockResolvedValue([
      { id: "g1", topicId: "t1", granteeType: "user", granteeId: "u9", accessLevel: "use" },
    ]);
    const res = await asAuthor1(request(makeApp()).get("/api/topics/t1/access"));
    expect(res.status).toBe(200);
    expect(res.body.ownerId).toBe("author1");
    expect(res.body.visibility).toBe("private");
    expect(res.body.grants[0].granteeName).toBe("Грантополучатель");
  });

  it("denies a non-owner author (403)", async () => {
    const res = await asAuthor2(request(makeApp()).get("/api/topics/t1/access"));
    expect(res.status).toBe(403);
  });

  it("allows an administrator on any topic", async () => {
    const res = await asAdmin(request(makeApp()).get("/api/topics/t2/access"));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/topics/:id/access — grant use/manage", () => {
  it("upserts a grant for the owner (201)", async () => {
    const res = await asAuthor1(
      request(makeApp())
        .post("/api/topics/t1/access")
        .send({ granteeType: "user", granteeId: "u9", accessLevel: "manage" }),
    );
    expect(res.status).toBe(201);
    expect(storageMock.upsertTopicGrant).toHaveBeenCalledWith(
      expect.objectContaining({ topicId: "t1", granteeId: "u9", accessLevel: "manage" }),
    );
  });

  it("denies a non-owner author (403)", async () => {
    const res = await asAuthor2(
      request(makeApp())
        .post("/api/topics/t1/access")
        .send({ granteeType: "user", granteeId: "u9", accessLevel: "use" }),
    );
    expect(res.status).toBe(403);
    expect(storageMock.upsertTopicGrant).not.toHaveBeenCalled();
  });

  it("rejects an invalid accessLevel (400)", async () => {
    const res = await asAuthor1(
      request(makeApp())
        .post("/api/topics/t1/access")
        .send({ granteeType: "user", granteeId: "u9", accessLevel: "admin" }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when the grantee does not exist", async () => {
    const res = await asAuthor1(
      request(makeApp())
        .post("/api/topics/t1/access")
        .send({ granteeType: "user", granteeId: "ghost", accessLevel: "use" }),
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/topics/:id/access/:grantId — two-mode revoke (T-29)", () => {
  const grant = {
    id: "g1", topicId: "t1", granteeType: "user", granteeId: "u9",
    accessLevel: "use", state: "active",
  };
  const publishedDependent = {
    id: "pub1", title: "Тест получателя", ownerId: "u9", status: "published", mode: "standard",
  };
  beforeEach(() => {
    storageMock.getTopicGrants.mockResolvedValue([grant]);
  });

  it("soft-revokes by default (200, state revoked_in_use)", async () => {
    const res = await asAuthor1(request(makeApp()).delete("/api/topics/t1/access/g1"));
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("soft");
    expect(storageMock.setTopicGrantState).toHaveBeenCalledWith("g1", "revoked_in_use");
    expect(storageMock.removeTopicGrant).not.toHaveBeenCalled();
  });

  it("denies a non-owner author (403)", async () => {
    const res = await asAuthor2(request(makeApp()).delete("/api/topics/t1/access/g1"));
    expect(res.status).toBe(403);
    expect(storageMock.setTopicGrantState).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown grant id", async () => {
    const res = await asAuthor1(request(makeApp()).delete("/api/topics/t1/access/nope"));
    expect(res.status).toBe(404);
  });

  it("hard revoke is administrator-only (author -> 403)", async () => {
    const res = await asAuthor1(request(makeApp()).delete("/api/topics/t1/access/g1?mode=hard"));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("hard_revoke_admin_only");
  });

  it("hard revoke blocks (409) on a published dependent of the grantee", async () => {
    storageMock.getTestsUsingTopic.mockResolvedValue([publishedDependent]);
    const res = await asAdmin(request(makeApp()).delete("/api/topics/t1/access/g1?mode=hard"));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("grant_in_use");
    expect(res.body.dependents[0].testId).toBe("pub1");
    expect(storageMock.removeTopicGrant).not.toHaveBeenCalled();
  });

  it("hard revoke removes the grant when nothing blocks", async () => {
    const res = await asAdmin(request(makeApp()).delete("/api/topics/t1/access/g1?mode=hard"));
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("hard");
    expect(storageMock.removeTopicGrant).toHaveBeenCalledWith("g1");
  });

  it("admin force overrides a blocking published dependent", async () => {
    storageMock.getTestsUsingTopic.mockResolvedValue([publishedDependent]);
    const res = await asAdmin(
      request(makeApp()).delete("/api/topics/t1/access/g1?mode=hard&force=true"),
    );
    expect(res.status).toBe(200);
    expect(storageMock.removeTopicGrant).toHaveBeenCalledWith("g1");
  });
});

describe("PATCH /api/topics/:id/visibility — owner/admin", () => {
  it("sets visibility for the owner", async () => {
    const res = await asAuthor1(
      request(makeApp()).patch("/api/topics/t1/visibility").send({ visibility: "shared" }),
    );
    expect(res.status).toBe(200);
    expect(storageMock.setTopicVisibility).toHaveBeenCalledWith("t1", "shared");
  });

  it("rejects an invalid visibility (400)", async () => {
    const res = await asAuthor1(
      request(makeApp()).patch("/api/topics/t1/visibility").send({ visibility: "public" }),
    );
    expect(res.status).toBe(400);
  });

  it("denies a non-owner author (403)", async () => {
    const res = await asAuthor2(
      request(makeApp()).patch("/api/topics/t1/visibility").send({ visibility: "shared" }),
    );
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/topics/:id/owner — admin only", () => {
  it("changes the owner for an administrator", async () => {
    const res = await asAdmin(
      request(makeApp()).patch("/api/topics/t1/owner").send({ ownerId: "author2" }),
    );
    expect(res.status).toBe(200);
    expect(storageMock.setTopicOwner).toHaveBeenCalledWith("t1", "author2");
  });

  it("denies an author by capability (403, even on their own topic)", async () => {
    const res = await asAuthor1(
      request(makeApp()).patch("/api/topics/t1/owner").send({ ownerId: "author2" }),
    );
    expect(res.status).toBe(403);
    expect(storageMock.setTopicOwner).not.toHaveBeenCalled();
  });
});

// ─── Test sections may only cite visible topics (E-13) ───────────────────────

describe("POST /api/tests — section topic visibility guard", () => {
  it("rejects a section that references a topic the author cannot see (403)", async () => {
    const res = await asAuthor1(
      request(makeApp())
        .post("/api/tests")
        .send({ title: "Тест", mode: "standard", sections: [{ topicId: "t2", drawCount: 1 }] }),
    );
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("topic_forbidden");
    expect(res.body.topicId).toBe("t2");
  });
});

// ─── Same-name policy (T-30 / FR-27) ─────────────────────────────────────────

describe("Topic same-name policy (FR-27)", () => {
  it("blocks creating a second topic with the owner's existing name (409)", async () => {
    // author1 already owns t1 «Тема 1»; «тема 1» normalizes to the same key.
    const res = await asAuthor1(
      request(makeApp()).post("/api/topics").send({ name: "тема 1" }),
    );
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("duplicate_topic_name");
    expect(res.body.topicId).toBe("t1");
    expect(storageMock.createTopic).not.toHaveBeenCalled();
  });

  it("creates with a non-blocking warning on a cross-owner visible collision", async () => {
    // «Общая» collides with the shared topic tS, owned by someone else.
    const res = await asAuthor1(
      request(makeApp()).post("/api/topics").send({ name: "Общая" }),
    );
    expect(res.status).toBe(201);
    expect(storageMock.createTopic).toHaveBeenCalled();
    expect(res.body.warnings[0].kind).toBe("duplicate_name");
    expect(res.body.warnings[0].topics.map((t: { id: string }) => t.id)).toContain("tS");
  });

  it("creates cleanly with a unique name (no warnings)", async () => {
    const res = await asAuthor1(
      request(makeApp()).post("/api/topics").send({ name: "Совершенно новая" }),
    );
    expect(res.status).toBe(201);
    expect(res.body.warnings).toBeUndefined();
  });

  it("name-check reports the cross-owner duplicate without a same-owner clash", async () => {
    const res = await asAuthor1(
      request(makeApp()).get("/api/topics/name-check").query({ name: "Общая" }),
    );
    expect(res.status).toBe(200);
    expect(res.body.normalized).toBe("общая");
    expect(res.body.sameOwner).toBeNull();
    expect(res.body.duplicates.map((t: { id: string }) => t.id)).toContain("tS");
  });

  it("rename to another of the owner's topic names is a hard conflict (409)", async () => {
    // Give author1 a second owned topic and rename it onto t1's name.
    const t1b = { id: "t1b", name: "Финансы", ownerId: "author1", visibility: "private" };
    storageMock.getTopic.mockImplementation(async (id: string) =>
      id === "t1b" ? t1b : (topicsById as any)[id],
    );
    storageMock.getTopics.mockResolvedValue([t1, t1b, t2, tS]);
    const res = await asAuthor1(
      request(makeApp()).put("/api/topics/t1b").send({ name: "Тема 1" }),
    );
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("duplicate_topic_name");
    expect(storageMock.updateTopic).not.toHaveBeenCalled();
  });

  it("duplicates-report is administrator-only", async () => {
    storageMock.getTopics.mockResolvedValue([
      t1, t2, tS,
      { id: "dup", name: "общая", ownerId: "author2", visibility: "private" },
    ]);
    const denied = await asAuthor1(request(makeApp()).get("/api/topics/duplicates-report"));
    expect(denied.status).toBe(403);
    const ok = await asAdmin(request(makeApp()).get("/api/topics/duplicates-report"));
    expect(ok.status).toBe(200);
    const group = ok.body.groups.find((g: { nameNormalized: string }) => g.nameNormalized === "общая");
    expect(group.topics.map((t: { id: string }) => t.id).sort()).toEqual(["dup", "tS"]);
  });
});
