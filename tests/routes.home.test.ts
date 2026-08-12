/**
 * PRD-25: GET /api/home — capability gating (FR-02), failure isolation (FR-15)
 * and the «no sections» floor. The section builders themselves are mocked: what
 * is under test here is WHICH builders run and how their outcome lands in the
 * payload, not what they compute.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const { rolesMock, storageMock, sectionsMock, topicAccessMock } = vi.hoisted(() => ({
  rolesMock: { getEffectiveRoles: vi.fn() },
  storageMock: { getUser: vi.fn() },
  sectionsMock: {
    buildAssigned: vi.fn(),
    buildRecentResults: vi.fn(),
    buildMyTests: vi.fn(),
    buildMyTopics: vi.fn(),
    buildPeople: vi.fn(),
    buildSummary: vi.fn(),
    buildMaterials: vi.fn(),
  },
  topicAccessMock: { duplicateNameGroups: vi.fn() },
}));

vi.mock("../server/services/access", () => rolesMock);
vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/services/home/assigned", () => ({
  buildAssigned: sectionsMock.buildAssigned,
  buildRecentResults: sectionsMock.buildRecentResults,
}));
vi.mock("../server/services/home/my-tests", () => ({ buildMyTests: sectionsMock.buildMyTests }));
vi.mock("../server/services/home/my-topics", () => ({ buildMyTopics: sectionsMock.buildMyTopics }));
vi.mock("../server/services/home/people", () => ({ buildPeople: sectionsMock.buildPeople }));
vi.mock("../server/services/home/summary", () => ({ buildSummary: sectionsMock.buildSummary }));
// MATERIAL_CAPABILITIES is the real list — the gate under test is «есть хотя бы
// один доступный документ», so mocking it away would test nothing.
vi.mock("../server/services/home/materials", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/services/home/materials")>();
  return { MATERIAL_CAPABILITIES: actual.MATERIAL_CAPABILITIES, buildMaterials: sectionsMock.buildMaterials };
});
vi.mock("../server/services/topic-access", () => ({
  duplicateNameGroups: topicAccessMock.duplicateNameGroups,
}));

import homeRouter from "../server/routes/home";

// ─── App factory ──────────────────────────────────────────────────────────────
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    next();
  });
  app.use("/api/home", homeRouter);
  return app;
}

function get() {
  return request(makeApp()).get("/api/home").set("x-test-user", "u1");
}

beforeEach(() => {
  // `clearAllMocks` also drops the resolved values, so every default is set here
  // rather than in `vi.hoisted` — otherwise the second test would see `undefined`.
  vi.clearAllMocks();
  storageMock.getUser.mockResolvedValue({ id: "u1", emailHash: "hash" });
  sectionsMock.buildAssigned.mockResolvedValue({ items: [], total: 0 });
  sectionsMock.buildRecentResults.mockResolvedValue({ items: [] });
  sectionsMock.buildMyTests.mockResolvedValue({ items: [], total: 0 });
  sectionsMock.buildMyTopics.mockResolvedValue({ items: [], total: 0 });
  sectionsMock.buildPeople.mockResolvedValue({ activeAssignments: 0, notStarted: 0, newUsers7d: 0 });
  sectionsMock.buildSummary.mockResolvedValue({
    attempts30d: 0,
    passRate: 0,
    avgPercent: 0,
    activeUsers: 0,
  });
  sectionsMock.buildMaterials.mockResolvedValue({ activeTemplates: [], docs: [] });
  topicAccessMock.duplicateNameGroups.mockResolvedValue([]);
});

// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/home", () => {
  it("rejects an anonymous request", async () => {
    const res = await request(makeApp()).get("/api/home");
    expect(res.status).toBe(401);
  });

  it("rejects a session whose user no longer exists", async () => {
    rolesMock.getEffectiveRoles.mockResolvedValue(["learner"]);
    storageMock.getUser.mockResolvedValue(undefined);

    const res = await get();

    expect(res.status).toBe(401);
  });

  it("gives a pure learner only the learner sections", async () => {
    rolesMock.getEffectiveRoles.mockResolvedValue(["learner"]);

    const res = await get();

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("assigned");
    expect(res.body).toHaveProperty("recentResults");
    expect(res.body).not.toHaveProperty("myTests");
    expect(res.body).not.toHaveProperty("myTopics");
    expect(res.body).not.toHaveProperty("summary");
    expect(res.body).not.toHaveProperty("peopleAssignments");
    expect(res.body).not.toHaveProperty("materials");
    // FR-02: an absent key must mean the builder never ran, not a hidden card.
    expect(sectionsMock.buildMyTests).not.toHaveBeenCalled();
    expect(sectionsMock.buildMyTopics).not.toHaveBeenCalled();
    expect(sectionsMock.buildSummary).not.toHaveBeenCalled();
    expect(sectionsMock.buildPeople).not.toHaveBeenCalled();
    expect(sectionsMock.buildMaterials).not.toHaveBeenCalled();
    expect(topicAccessMock.duplicateNameGroups).not.toHaveBeenCalled();
    // A learner may perform no quick action, so the section is dropped (FR-06).
    expect(res.body).not.toHaveProperty("quickActions");
  });

  it("gives an author the content sections", async () => {
    rolesMock.getEffectiveRoles.mockResolvedValue(["author"]);

    const res = await get();

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("myTests");
    expect(res.body).toHaveProperty("myTopics");
    expect(res.body).toHaveProperty("summary");
    expect(res.body).toHaveProperty("quickActions");
    expect(sectionsMock.buildMyTests).toHaveBeenCalledWith("u1", ["author"]);
    // An author does not hold users.read, so the people section stays away…
    expect(res.body).not.toHaveProperty("peopleAssignments");
    expect(sectionsMock.buildPeople).not.toHaveBeenCalled();
    // …but «Материалы» is the shared documentation shelf: an author reaches the
    // authoring and import guides, so the section is built for them too.
    expect(res.body).toHaveProperty("materials");
    expect(sectionsMock.buildMaterials).toHaveBeenCalledWith(["author"]);
  });

  it("gives a manager the people section without the content ones", async () => {
    rolesMock.getEffectiveRoles.mockResolvedValue(["manager"]);

    const res = await get();

    expect(res.body).toHaveProperty("peopleAssignments");
    expect(res.body).toHaveProperty("myTests");
    expect(res.body).not.toHaveProperty("myTopics");
    expect(sectionsMock.buildMyTopics).not.toHaveBeenCalled();
    expect(topicAccessMock.duplicateNameGroups).not.toHaveBeenCalled();
  });

  it("gives an administrator the materials section", async () => {
    rolesMock.getEffectiveRoles.mockResolvedValue(["administrator"]);

    const res = await get();

    expect(res.body).toHaveProperty("materials");
    expect(sectionsMock.buildMaterials).toHaveBeenCalledTimes(1);
  });

  it("isolates a failing section instead of failing the whole response", async () => {
    rolesMock.getEffectiveRoles.mockResolvedValue(["author"]);
    sectionsMock.buildMyTopics.mockRejectedValue(new Error("boom"));

    const res = await get();

    expect(res.status).toBe(200);
    expect(res.body.myTopics).toEqual({ failed: true });
    expect(res.body.myTests).toEqual({ items: [], total: 0 });
  });

  it("keeps the payload alive when the duplicates report fails", async () => {
    rolesMock.getEffectiveRoles.mockResolvedValue(["author"]);
    topicAccessMock.duplicateNameGroups.mockRejectedValue(new Error("boom"));

    const res = await get();

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("myTopics");
    expect(res.body).not.toHaveProperty("attention");
  });

  it("derives attention rows from the sections it already built", async () => {
    rolesMock.getEffectiveRoles.mockResolvedValue(["administrator"]);
    sectionsMock.buildAssigned.mockResolvedValue({
      items: [
        {
          testId: "t1",
          title: "Тест",
          description: null,
          questionCount: 3,
          completedAttempts: 0,
          maxAttempts: null,
          inProgressAttemptId: "a1",
          blockedUntil: null,
        },
      ],
      total: 1,
    });
    sectionsMock.buildPeople.mockResolvedValue({
      activeAssignments: 5,
      notStarted: 2,
      newUsers7d: 0,
    });
    topicAccessMock.duplicateNameGroups.mockResolvedValue([
      { nameNormalized: "тема", topics: [] },
    ]);

    const res = await get();

    expect(res.status).toBe(200);
    const kinds = (res.body.attention as Array<{ kind: string }>).map((r) => r.kind);
    expect(kinds).toContain("attempt-in-progress");
    expect(kinds).toContain("topic-duplicates");
    expect(kinds).toContain("assignment-not-started");
  });

  it("omits the attention section when nothing needs attention", async () => {
    rolesMock.getEffectiveRoles.mockResolvedValue(["administrator"]);

    const res = await get();

    expect(res.body).not.toHaveProperty("attention");
  });

  it("returns 500 when resolving the roles themselves fails", async () => {
    rolesMock.getEffectiveRoles.mockRejectedValue(new Error("db down"));

    const res = await get();

    expect(res.status).toBe(500);
  });
});
