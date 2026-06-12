/**
 * @module tests/content-ownership-acceptance
 *
 * PRD-15 block C phase-acceptance matrix (T-33). One representative assertion
 * per normative requirement — BRC-01..13, BRC-27 and audit edge cases E-11,
 * E-13, F-10 — so the phase has a single traceable gate. Decision rules are
 * asserted against the topic-access / test-access services (their source of
 * truth); the integration behaviours that only exist in handlers (visibility
 * filtering, the FR-25 derived in-context read, the delivery invariant) are
 * asserted at the route/structural level. Deeper per-endpoint coverage lives in
 * topic-access.test.ts, routes.topic-access.test.ts and content-protection.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import request from "supertest";
import express from "express";
import session from "express-session";
import { ROLES } from "@shared/access";

vi.hoisted(() => { process.env.DATABASE_URL = "postgresql://fake/test"; });

const { storageMock, serviceMock } = vi.hoisted(() => ({
  storageMock: {
    // auth / roles
    getUser: vi.fn(),
    getUserRoles: vi.fn(),
    getUserGroups: vi.fn(),
    getGroupUsers: vi.fn(),
    getGroup: vi.fn(),
    // topic visibility scope
    getSharedTopicIds: vi.fn(),
    getTopicIdsByOwner: vi.fn(),
    getActiveTopicGrantsForGrantees: vi.fn(),
    // topics / questions
    getTopic: vi.fn(),
    getTopics: vi.fn(),
    getTopicCourses: vi.fn().mockResolvedValue([]),
    getTopicEvents: vi.fn().mockResolvedValue([]),
    getQuestions: vi.fn(),
    getQuestionsByTopic: vi.fn().mockResolvedValue([]),
    getTestsUsingTopic: vi.fn().mockResolvedValue([]),
    // tests router + requireTestScope + loadFullTest
    getTest: vi.fn(),
    getTests: vi.fn().mockResolvedValue([]),
    getTestSections: vi.fn().mockResolvedValue([]),
    getTestGrantForUser: vi.fn().mockResolvedValue(undefined),
    getTestIdsByOwner: vi.fn().mockResolvedValue([]),
    getUserTestGrants: vi.fn().mockResolvedValue([]),
    isTestAssignedToUser: vi.fn().mockResolvedValue(false),
    setTestOwner: vi.fn().mockResolvedValue(undefined),
    getTestAccessGrants: vi.fn().mockResolvedValue([]),
    getAdaptiveTopicSettingsByTest: vi.fn().mockResolvedValue([]),
    getAdaptiveLevelsByTest: vi.fn().mockResolvedValue([]),
    getAdaptiveLevelLinks: vi.fn().mockResolvedValue([]),
    getResultVariables: vi.fn().mockResolvedValue([]),
    getScales: vi.fn().mockResolvedValue([]),
    getQuestionMeasurements: vi.fn().mockResolvedValue([]),
    getContentPages: vi.fn().mockResolvedValue([]),
    getLatestSnapshot: vi.fn().mockResolvedValue(undefined),
    getSnapshotsForTest: vi.fn().mockResolvedValue([]),
    getReferencedSnapshotIds: vi.fn().mockResolvedValue([]),
  },
  serviceMock: {
    create: vi.fn(),
    save: vi.fn(),
    reconcileExisting: vi.fn(async () => ({ deleted: 0, created: 0 })),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/db", () => ({ db: {} }));
vi.mock("../server/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../server/scorm-exporter", () => ({ generateScormPackage: vi.fn() }));
vi.mock("../server/template-registry", () => ({ isSupportedTemplateApiVersion: vi.fn().mockReturnValue(true) }));
vi.mock("../server/services/test-settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/services/test-settings")>();
  return { ...actual, testSettingsService: serviceMock };
});

import questionsRouter from "../server/routes/questions";
import testsRouter from "../server/routes/tests";
import {
  visibleTopic,
  canManageTopicContent,
  canDeleteTopic,
  canGrantTopicAccess,
  canChangeTopicOwner,
  visibleTopicScope,
  dependentTestsForGrant,
  sameOwnerNameClash,
  visibleSameNameTopics,
  duplicateNameGroups,
} from "../server/services/topic-access";
import { canGrantAccess, canChangeOwner } from "../server/services/test-access";
import { normalizeTopicName } from "@shared/topics/naming";

// ─── Identities and fixtures ──────────────────────────────────────────────────

const users: Record<string, { id: string; status: string }> = {
  author1: { id: "author1", status: "active" }, // owner
  author2: { id: "author2", status: "active" }, // stranger
  admin1: { id: "admin1", status: "active" },
};
const rolesByUser: Record<string, string[]> = {
  author1: ["author"], author2: ["author"], admin1: ["administrator"],
};

const tPrivate = { id: "t1", name: "Финансы", ownerId: "author1", visibility: "private" as const };
const tShared = { id: "tS", name: "Общая", ownerId: null, visibility: "shared" as const };

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    next();
  });
  app.use("/api/questions", questionsRouter);
  app.use("/api/tests", testsRouter);
  return app;
}
const as = (who: string) => (req: request.Test) => req.set("x-test-user", who);

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUser.mockImplementation(async (id: string) => users[id]);
  storageMock.getUserRoles.mockImplementation(async (id: string) => rolesByUser[id] ?? []);
  storageMock.getUserGroups.mockResolvedValue([]);
  storageMock.getActiveTopicGrantsForGrantees.mockResolvedValue([]);
  storageMock.getSharedTopicIds.mockResolvedValue(["tS"]);
  storageMock.getTopicIdsByOwner.mockImplementation(async (id: string) =>
    id === "author1" ? ["t1"] : [],
  );
  storageMock.getTopic.mockImplementation(async (id: string) =>
    ({ t1: tPrivate, tS: tShared } as any)[id],
  );
  storageMock.getTopics.mockResolvedValue([tPrivate, tShared]);
});

// ─── Service-level decision matrix (BRC-01..13, BRC-27) ──────────────────────

describe("PRD-15 block C — acceptance matrix (decision rules)", () => {
  it("BRC-01 — changing a topic's owner is administrator-only", () => {
    expect(canChangeTopicOwner([ROLES.ADMINISTRATOR])).toBe(true);
    expect(canChangeTopicOwner([ROLES.AUTHOR])).toBe(false);
  });

  it("BRC-02/F-10 — a private topic is hidden from a non-owner; a shared one is visible", async () => {
    expect(await visibleTopic([ROLES.AUTHOR], "author2", tPrivate)).toBe(false);
    expect(await visibleTopic([ROLES.AUTHOR], "author2", tShared)).toBe(true);
    expect(await visibleTopic([ROLES.AUTHOR], "author1", tPrivate)).toBe(true); // owner
  });

  it("BRC-04/BRC-06 — use grant sees but cannot manage; manage grant can; delete is owner/admin", async () => {
    storageMock.getActiveTopicGrantsForGrantees.mockResolvedValue([{ topicId: "t1", accessLevel: "use" }]);
    expect(await visibleTopic([ROLES.AUTHOR], "u2", tPrivate)).toBe(true);
    expect(await canManageTopicContent([ROLES.AUTHOR], "u2", tPrivate)).toBe(false);
    storageMock.getActiveTopicGrantsForGrantees.mockResolvedValue([{ topicId: "t1", accessLevel: "manage" }]);
    expect(await canManageTopicContent([ROLES.AUTHOR], "u2", tPrivate)).toBe(true);
    expect(canDeleteTopic([ROLES.AUTHOR], "u2", tPrivate)).toBe(false); // manage != delete
    expect(canDeleteTopic([ROLES.AUTHOR], "author1", tPrivate)).toBe(true); // owner
  });

  it("BRC-04 — a group grant resolves through the actor's groups", async () => {
    storageMock.getUserGroups.mockResolvedValue([{ id: "g1" }]);
    storageMock.getActiveTopicGrantsForGrantees.mockResolvedValue([{ topicId: "t1", accessLevel: "manage" }]);
    expect(await canManageTopicContent([ROLES.AUTHOR], "u2", tPrivate)).toBe(true);
  });

  it("BRC-05 — topic grants: owner on own, admin on any; not a non-owner", () => {
    expect(canGrantTopicAccess([ROLES.AUTHOR], "author1", tPrivate)).toBe(true);
    expect(canGrantTopicAccess([ROLES.ADMINISTRATOR], "x", tPrivate)).toBe(true);
    expect(canGrantTopicAccess([ROLES.AUTHOR], "author2", tPrivate)).toBe(false);
  });

  it("BRC-07/F-10 — a stranger's visible scope excludes the private topic (no keys leak)", async () => {
    const scope = await visibleTopicScope([ROLES.AUTHOR], "author2");
    expect(scope.all).toBe(false);
    expect(scope.ids.has("t1")).toBe(false);
    expect(scope.ids.has("tS")).toBe(true);
  });

  it("BRC-09/E-13 — a hard-revoke feasibility lists deps but never throws/blocks by itself", async () => {
    storageMock.getTestsUsingTopic.mockResolvedValue([
      { id: "pub1", title: "T", ownerId: "u9", status: "published", mode: "standard" },
    ]);
    const deps = await dependentTestsForGrant("t1", "u9");
    expect(deps).toEqual([{ testId: "pub1", title: "T", status: "published" }]);
  });

  it("BRC-11 — same name: per-owner clash is hard; cross-owner visible is a warning; ё/case fold", async () => {
    expect(normalizeTopicName("УЧЁТ")).toBe(normalizeTopicName("  учет "));
    expect(await sameOwnerNameClash("author1", "финансы")).not.toBeNull();   // owns «Финансы»
    expect(await sameOwnerNameClash("author2", "финансы")).toBeNull();       // different owner
    const warn = await visibleSameNameTopics([ROLES.AUTHOR], "author1", "общая");
    expect(warn.map((t) => t.id)).toContain("tS");
  });

  it("BRC-12 — administrator duplicates report groups same-normalized names", async () => {
    storageMock.getTopics.mockResolvedValue([
      tPrivate, tShared, { id: "dup", name: "общая", ownerId: "author2", visibility: "private" },
    ]);
    const groups = await duplicateNameGroups();
    const g = groups.find((x) => x.nameNormalized === "общая");
    expect(g?.topics.map((t) => t.id).sort()).toEqual(["dup", "tS"]);
  });

  it("BRC-27 — test grants: owner or admin; owner change admin-only", () => {
    const test = { id: "x", ownerId: "author1" } as const;
    expect(canGrantAccess([ROLES.AUTHOR], "author1", test)).toBe(true);
    expect(canGrantAccess([ROLES.ADMINISTRATOR], "z", test)).toBe(true);
    expect(canGrantAccess([ROLES.AUTHOR], "author2", test)).toBe(false);
    expect(canChangeOwner([ROLES.AUTHOR])).toBe(false);
    expect(canChangeOwner([ROLES.ADMINISTRATOR])).toBe(true);
  });
});

// ─── BRC-03 / BRC-07 / F-10 — questions inherit topic visibility (route) ─────

describe("PRD-15 block C — questions inherit topic visibility (BRC-03/F-10)", () => {
  beforeEach(() => {
    storageMock.getQuestions.mockResolvedValue([
      { id: "qP", topicId: "t1", prompt: "private", correctJson: { correctIndex: 0 } },
      { id: "qS", topicId: "tS", prompt: "shared", correctJson: { correctIndex: 1 } },
    ]);
  });

  it("a stranger sees only questions of visible topics (private keys never listed)", async () => {
    const res = await as("author2")(request(makeApp()).get("/api/questions"));
    expect(res.status).toBe(200);
    expect(res.body.map((q: { id: string }) => q.id)).toEqual(["qS"]);
  });

  it("the owner sees their private topic's questions", async () => {
    const res = await as("author1")(request(makeApp()).get("/api/questions"));
    expect(res.body.map((q: { id: string }) => q.id).sort()).toEqual(["qP", "qS"]);
  });
});

// ─── E-11 / E-13 — derived in-context read on test save (route) ──────────────

describe("PRD-15 block C — derived in-context read on test save (E-11/E-13)", () => {
  // test1 is owned by author1 and already references the now-invisible topic t1.
  const dbTest = {
    id: "test1", title: "T", mode: "standard", version: 1, status: "draft",
    ownerId: "author1", published: false,
    overallPassRuleJson: { type: "percent", value: 70 },
  };
  // t1 is invisible to author1 here (owned by someone else, private) — models a
  // grant soft-revoke / ownership transfer after the test was built.
  const tForeign = { id: "t1", name: "Финансы", ownerId: "owner-x", visibility: "private" as const };

  beforeEach(() => {
    storageMock.getTopic.mockImplementation(async (id: string) =>
      ({ t1: tForeign, tS: tShared } as any)[id],
    );
    storageMock.getTopicIdsByOwner.mockResolvedValue([]); // author1 owns no topics now
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestSections.mockResolvedValue([{ id: "s1", testId: "test1", topicId: "t1", drawCount: 1 }]);
    serviceMock.save.mockResolvedValue(dbTest);
  });

  it("E-11/E-13 — re-saving keeps a topic already referenced by the test (no 403)", async () => {
    const res = await as("author1")(
      request(makeApp()).put("/api/tests/test1").send({
        title: "T2", mode: "standard", sections: [{ topicId: "t1", drawCount: 1 }],
      }),
    );
    expect(res.status).toBe(200);
    expect(serviceMock.save).toHaveBeenCalled();
  });

  it("adding a NEW invisible topic to the same test is still blocked (403)", async () => {
    storageMock.getTopic.mockImplementation(async (id: string) =>
      ({ t1: tForeign, tNew: { id: "tNew", name: "Чужая", ownerId: "owner-x", visibility: "private" } } as any)[id],
    );
    const res = await as("author1")(
      request(makeApp()).put("/api/tests/test1").send({
        title: "T2", mode: "standard",
        sections: [{ topicId: "t1", drawCount: 1 }, { topicId: "tNew", drawCount: 1 }],
      }),
    );
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("topic_forbidden");
    expect(res.body.topicId).toBe("tNew");
    expect(serviceMock.save).not.toHaveBeenCalled();
  });
});

// ─── BRC-08 — delivery/grading never check content rights (structural) ───────

describe("PRD-15 block C — delivery invariant (BRC-08)", () => {
  it("the attempts (delivery) route does not import the topic-access service", () => {
    const src = readFileSync("server/routes/attempts.ts", "utf8");
    expect(src).not.toContain("topic-access");
  });
});
