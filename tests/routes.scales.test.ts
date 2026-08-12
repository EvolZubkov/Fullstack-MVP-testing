/**
 * @module tests/routes.scales
 * @description Integration tests for the PRD-5 scales + measurements API (B3):
 * GET/POST/PUT/DELETE /api/tests/:id/scales, .../scales/reorder,
 * GET /api/tests/:id/measurements and PUT .../measurements/:questionId.
 *
 * Covers authorization, test-existence, zod field validation, the key-uniqueness
 * rule and the CRUD/reorder/upsert lifecycle.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getTest: vi.fn(),
    getUser: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    getScales: vi.fn(),
    createScale: vi.fn(),
    updateScale: vi.fn(),
    deleteScale: vi.fn(),
    reorderScales: vi.fn(),
    getQuestionMeasurements: vi.fn(),
    upsertQuestionMeasurements: vi.fn(),
    getQuestionsByIds: vi.fn(),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import scalesRouter from "../server/routes/scales";

function makeApp(role: "author" | "learner" | null = "author") {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (role) req.session.userId = "user-1";
    next();
  });
  app.use("/api/tests", scalesRouter);
  return app;
}

const baseTest = { id: "test-1", title: "Test" };
const authorUser = { id: "user-1", role: "author", status: "active" };
const learnerUser = { id: "user-1", role: "learner", status: "active" };

const validScale = { key: "ee", label: "Истощение", type: "number" };
const savedScale = {
  id: "scale-1",
  testId: "test-1",
  ...validScale,
  aggregation: "sum",
  normalization: "none",
  direction: "positive",
  configJson: {},
  learnerVisibility: "hidden",
  scormTarget: "none",
  sortOrder: 0,
};

// ─── scales: GET ──────────────────────────────────────────────────────────────

describe("GET /api/tests/:id/scales", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getTest.mockResolvedValue(baseTest);
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getScales.mockResolvedValue([savedScale]);
  });

  it("returns 401 when unauthenticated", async () => {
    expect((await request(makeApp(null)).get("/api/tests/test-1/scales")).status).toBe(401);
  });

  it("returns 404 when test not found", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    expect((await request(makeApp()).get("/api/tests/missing/scales")).status).toBe(404);
  });

  it("returns the list of scales", async () => {
    const res = await request(makeApp()).get("/api/tests/test-1/scales");
    expect(res.status).toBe(200);
    expect(res.body[0].key).toBe("ee");
  });
});

// ─── scales: POST ─────────────────────────────────────────────────────────────

describe("POST /api/tests/:id/scales", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getTest.mockResolvedValue(baseTest);
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getScales.mockResolvedValue([]);
    storageMock.createScale.mockResolvedValue(savedScale);
  });

  it("returns 403 when user is a learner", async () => {
    storageMock.getUserRoles.mockResolvedValueOnce(["learner"]);
    storageMock.getUser.mockResolvedValue(learnerUser);
    expect((await request(makeApp("learner")).post("/api/tests/test-1/scales").send(validScale)).status).toBe(403);
  });

  it("returns 422 when the key violates the grammar", async () => {
    const res = await request(makeApp()).post("/api/tests/test-1/scales").send({ ...validScale, key: "Bad Key" });
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("key");
    expect(storageMock.createScale).not.toHaveBeenCalled();
  });

  it("returns 422 when the key already exists in the test", async () => {
    storageMock.getScales.mockResolvedValue([{ ...savedScale, id: "other", key: "ee" }]);
    const res = await request(makeApp()).post("/api/tests/test-1/scales").send(validScale);
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("key");
  });

  it("creates the scale", async () => {
    const res = await request(makeApp()).post("/api/tests/test-1/scales").send(validScale);
    expect(res.status).toBe(201);
    expect(res.body.key).toBe("ee");
    expect(storageMock.createScale).toHaveBeenCalledTimes(1);
  });
});

// ─── scales: PUT / DELETE / reorder ──────────────────────────────────────────

describe("PUT/DELETE/reorder scales", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getTest.mockResolvedValue(baseTest);
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getScales.mockResolvedValue([savedScale]);
    storageMock.updateScale.mockResolvedValue({ ...savedScale, label: "Новая" });
    storageMock.deleteScale.mockResolvedValue(true);
    storageMock.reorderScales.mockResolvedValue(undefined);
  });

  it("updates a scale", async () => {
    const res = await request(makeApp()).put("/api/tests/test-1/scales/scale-1").send({ label: "Новая" });
    expect(res.status).toBe(200);
    expect(storageMock.updateScale).toHaveBeenCalledWith("scale-1", { label: "Новая" });
  });

  it("returns 404 updating an unknown scale", async () => {
    expect((await request(makeApp()).put("/api/tests/test-1/scales/missing").send({ label: "x" })).status).toBe(404);
  });

  it("deletes a scale", async () => {
    const res = await request(makeApp()).delete("/api/tests/test-1/scales/scale-1");
    expect(res.status).toBe(200);
    expect(storageMock.deleteScale).toHaveBeenCalledWith("scale-1");
  });

  it("reorders scales", async () => {
    const updates = [{ id: "scale-1", sortOrder: 1 }];
    const res = await request(makeApp()).put("/api/tests/test-1/scales/reorder").send(updates);
    expect(res.status).toBe(200);
    expect(storageMock.reorderScales).toHaveBeenCalledWith(updates);
  });

  it("returns 422 when reorder body is not an array", async () => {
    expect((await request(makeApp()).put("/api/tests/test-1/scales/reorder").send({ x: 1 })).status).toBe(422);
  });
});

// ─── measurements ─────────────────────────────────────────────────────────────

describe("measurements GET/PUT", () => {
  const row = {
    scaleId: "550e8400-e29b-41d4-a716-446655440000",
    sourceType: "option",
    sourceKey: "opt-0",
    valueJson: 3,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getTest.mockResolvedValue(baseTest);
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getQuestionMeasurements.mockResolvedValue([{ id: "m1", ...row }]);
    storageMock.upsertQuestionMeasurements.mockResolvedValue([{ id: "m1", ...row }]);
  });

  it("returns the test's measurements", async () => {
    const res = await request(makeApp()).get("/api/tests/test-1/measurements");
    expect(res.status).toBe(200);
    expect(res.body[0].sourceType).toBe("option");
  });

  it("returns 422 when the body is not an array", async () => {
    expect((await request(makeApp()).put("/api/tests/test-1/measurements/q1").send({ x: 1 })).status).toBe(422);
  });

  it("returns 422 when a row is missing a required field", async () => {
    const res = await request(makeApp())
      .put("/api/tests/test-1/measurements/q1")
      .send([{ sourceType: "option", valueJson: 3 }]); // no scaleId
    expect(res.status).toBe(422);
  });

  it("upserts the question's rows with test/question id from the path", async () => {
    const res = await request(makeApp()).put("/api/tests/test-1/measurements/q1").send([row]);
    expect(res.status).toBe(200);
    expect(storageMock.upsertQuestionMeasurements).toHaveBeenCalledWith("test-1", "q1", [
      { ...row, testId: "test-1", questionId: "q1" },
    ]);
  });
});

// ─── scales: POST preview (PRD-5 B5) ──────────────────────────────────────────

describe("POST /api/tests/:id/scales/preview", () => {
  const previewScale = {
    id: "scale-uuid-1",
    testId: "test-1",
    key: "ee",
    label: "Истощение",
    type: "number",
    aggregation: "sum",
    normalization: "none",
    direction: "positive",
    configJson: { bands: [{ min: 0, max: 5, level: "low", label: "Низкий" }, { min: 6, max: 100, level: "high", label: "Высокий" }] },
    learnerVisibility: "hidden",
    scormTarget: "both",
    sortOrder: 0,
  };
  const previewMeasurements = [
    { id: "m1", testId: "test-1", questionId: "q1", scaleId: "scale-uuid-1", sourceType: "option", sourceKey: "1", valueJson: 3, weight: 1, conditionJson: null, sortOrder: 0 },
    { id: "m2", testId: "test-1", questionId: "q1", scaleId: "scale-uuid-1", sourceType: "option", sourceKey: "0", valueJson: 7, weight: 1, conditionJson: null, sortOrder: 1 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getTest.mockResolvedValue(baseTest);
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getScales.mockResolvedValue([previewScale]);
    storageMock.getQuestionMeasurements.mockResolvedValue(previewMeasurements);
    storageMock.getQuestionsByIds.mockResolvedValue([{ id: "q1", type: "single" }]);
  });

  it("requires author role", async () => {
    storageMock.getUserRoles.mockResolvedValueOnce(["learner"]);
    storageMock.getUser.mockResolvedValue(learnerUser);
    const res = await request(makeApp("learner")).post("/api/tests/test-1/scales/preview").send({ answers: {} });
    expect(res.status).toBe(403);
  });

  it("returns 404 when the test does not exist", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await request(makeApp()).post("/api/tests/test-1/scales/preview").send({ answers: {} });
    expect(res.status).toBe(404);
  });

  it("returns 422 when answers is not an object", async () => {
    const res = await request(makeApp()).post("/api/tests/test-1/scales/preview").send({ answers: [1, 2] });
    expect(res.status).toBe(422);
  });

  it("computes scale.* over the demo answers and applies bands", async () => {
    // single answer = option index 0 -> value 7 -> raw 7 -> band "Высокий"
    const res = await request(makeApp()).post("/api/tests/test-1/scales/preview").send({ answers: { q1: 0 } });
    expect(res.status).toBe(200);
    expect(res.body.values.ee.raw).toBe(7);
    expect(res.body.values.ee.hasValue).toBe(true);
    expect(res.body.values.ee.label).toBe("Высокий");
    expect(res.body.errors).toEqual([]);
  });

  it("yields hasValue=false when no measured option is selected", async () => {
    const res = await request(makeApp()).post("/api/tests/test-1/scales/preview").send({ answers: { q1: 2 } });
    expect(res.status).toBe(200);
    expect(res.body.values.ee.raw).toBe(0);
    expect(res.body.values.ee.hasValue).toBe(false);
  });
});
