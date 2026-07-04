/**
 * @module tests/routes.scales.coverage
 * @description Branch-coverage tests for the /api/tests/:id/scales router that
 * complement {@link module:tests/routes.scales}. They target the branches the
 * happy-path suite leaves out: every handler's catch/500 block, the
 * update-path partial-validation and key-conflict 422s, the DELETE "scale not
 * found" 404 (reachable — the test exists), the POST explicit-sortOrder branch,
 * and the preview empty-measurements / missing-answers branches.
 *
 * Note: each mutation handler's own `if (!test) 404` is shadowed by the
 * requireTestScope middleware (it loads the test first and 404s), so those
 * handler branches are not reachable over HTTP and are not targeted here.
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

function makeApp(authed = true) {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (authed) req.session.userId = "user-1";
    next();
  });
  app.use("/api/tests", scalesRouter);
  return app;
}

const baseTest = { id: "test-1", title: "Test" };
const authorUser = { id: "user-1", role: "author", status: "active", emailHash: "x" };
const validScale = { key: "ee", label: "Истощение", type: "number" };
const savedScale = {
  id: "scale-1", testId: "test-1", ...validScale,
  aggregation: "sum", normalization: "none", direction: "positive",
  configJson: {}, showToLearner: false, scormTarget: "none", sortOrder: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getTest.mockResolvedValue(baseTest);
  storageMock.getUser.mockResolvedValue(authorUser);
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
});

// ─── catch / 500 branches ─────────────────────────────────────────────────────
describe("scales catch/500 branches", () => {
  it("GET scales — 500 when getScales throws", async () => {
    storageMock.getScales.mockRejectedValue(new Error("db"));
    const res = await request(makeApp()).get("/api/tests/test-1/scales");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to get scales");
  });

  it("POST scales — 500 when createScale throws", async () => {
    storageMock.getScales.mockResolvedValue([]);
    storageMock.createScale.mockRejectedValue(new Error("db"));
    const res = await request(makeApp()).post("/api/tests/test-1/scales").send(validScale);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to create scale");
  });

  it("reorder — 500 when reorderScales throws", async () => {
    storageMock.reorderScales.mockRejectedValue(new Error("db"));
    const res = await request(makeApp()).put("/api/tests/test-1/scales/reorder").send([{ id: "scale-1", sortOrder: 1 }]);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to reorder scales");
  });

  it("PUT scale — 500 when updateScale throws", async () => {
    storageMock.getScales.mockResolvedValue([savedScale]);
    storageMock.updateScale.mockRejectedValue(new Error("db"));
    const res = await request(makeApp()).put("/api/tests/test-1/scales/scale-1").send({ label: "New" });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to update scale");
  });

  it("DELETE scale — 500 when deleteScale throws", async () => {
    storageMock.getScales.mockResolvedValue([savedScale]);
    storageMock.deleteScale.mockRejectedValue(new Error("db"));
    const res = await request(makeApp()).delete("/api/tests/test-1/scales/scale-1");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to delete scale");
  });

  it("GET measurements — 500 when getQuestionMeasurements throws", async () => {
    storageMock.getQuestionMeasurements.mockRejectedValue(new Error("db"));
    const res = await request(makeApp()).get("/api/tests/test-1/measurements");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to get measurements");
  });

  it("PUT measurements — 500 when upsert throws", async () => {
    storageMock.upsertQuestionMeasurements.mockRejectedValue(new Error("db"));
    const row = { scaleId: "550e8400-e29b-41d4-a716-446655440000", sourceType: "option", sourceKey: "opt-0", valueJson: 3 };
    const res = await request(makeApp()).put("/api/tests/test-1/measurements/q1").send([row]);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to save measurements");
  });

  it("preview — 500 when getScales throws", async () => {
    storageMock.getScales.mockRejectedValue(new Error("db"));
    const res = await request(makeApp()).post("/api/tests/test-1/scales/preview").send({ answers: {} });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to preview scales");
  });
});

// ─── POST scales — explicit sortOrder branch ─────────────────────────────────
describe("POST /api/tests/:id/scales (coverage)", () => {
  it("honours an explicit sortOrder in the body", async () => {
    storageMock.getScales.mockResolvedValue([]);
    storageMock.createScale.mockImplementation(async (d: any) => ({ ...savedScale, ...d }));
    const res = await request(makeApp()).post("/api/tests/test-1/scales").send({ ...validScale, sortOrder: 5 });
    expect(res.status).toBe(201);
    expect(storageMock.createScale).toHaveBeenCalledWith(expect.objectContaining({ sortOrder: 5 }));
  });
});

// ─── PUT scale — validation / conflict branches ───────────────────────────────
describe("PUT /api/tests/:id/scales/:scaleId (coverage)", () => {
  it("returns 422 when the partial body fails validation", async () => {
    storageMock.getScales.mockResolvedValue([savedScale]);
    const res = await request(makeApp()).put("/api/tests/test-1/scales/scale-1").send({ aggregation: "invalid" });
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("aggregation");
    expect(storageMock.updateScale).not.toHaveBeenCalled();
  });

  it("renames the key when the new key is unique (no conflict)", async () => {
    storageMock.getScales.mockResolvedValue([savedScale]);
    storageMock.updateScale.mockResolvedValue({ ...savedScale, key: "renamed" });
    const res = await request(makeApp()).put("/api/tests/test-1/scales/scale-1").send({ key: "renamed" });
    expect(res.status).toBe(200);
    expect(storageMock.updateScale).toHaveBeenCalledWith("scale-1", expect.objectContaining({ key: "renamed" }));
  });

  it("returns 422 when the new key collides with another scale", async () => {
    storageMock.getScales.mockResolvedValue([savedScale, { ...savedScale, id: "scale-2", key: "xx" }]);
    const res = await request(makeApp()).put("/api/tests/test-1/scales/scale-1").send({ key: "xx" });
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("key");
    expect(storageMock.updateScale).not.toHaveBeenCalled();
  });
});

// ─── DELETE scale — reachable "scale not found" ───────────────────────────────
describe("DELETE /api/tests/:id/scales/:scaleId (coverage)", () => {
  it("returns 404 when the scale does not exist in the test", async () => {
    storageMock.getScales.mockResolvedValue([]); // test exists, scale does not
    const res = await request(makeApp()).delete("/api/tests/test-1/scales/scale-1");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Scale not found");
    expect(storageMock.deleteScale).not.toHaveBeenCalled();
  });
});

// ─── preview — empty measurements / missing answers ───────────────────────────
describe("POST /api/tests/:id/scales/preview (coverage)", () => {
  it("skips the questions lookup when there are no measurements", async () => {
    storageMock.getScales.mockResolvedValue([]);
    storageMock.getQuestionMeasurements.mockResolvedValue([]);
    const res = await request(makeApp()).post("/api/tests/test-1/scales/preview").send({ answers: {} });
    expect(res.status).toBe(200);
    expect(res.body.values).toEqual({});
    expect(storageMock.getQuestionsByIds).not.toHaveBeenCalled();
  });

  it("defaults answers to {} when the body omits it", async () => {
    storageMock.getScales.mockResolvedValue([]);
    storageMock.getQuestionMeasurements.mockResolvedValue([]);
    const res = await request(makeApp()).post("/api/tests/test-1/scales/preview").send({});
    expect(res.status).toBe(200);
    expect(res.body.values).toEqual({});
  });

  it("returns 422 when answers is a primitive (not an object)", async () => {
    const res = await request(makeApp()).post("/api/tests/test-1/scales/preview").send({ answers: 5 as unknown });
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("answers");
  });

  it("skips orphan rows and resolves null configJson / null source/weight", async () => {
    // configJson=null exercises toScaleSpec's `?? {}` + non-array bands branch;
    // the orphan row (unknown scaleId) exercises toMeasurementSpecs' skip; the
    // null sourceKey/weight exercise its `?? null` / `?? 1` fallbacks.
    const scaleA = {
      id: "sa", testId: "test-1", key: "aa", label: "", type: "number",
      aggregation: "sum", normalization: "none", direction: "positive",
      configJson: null, showToLearner: false, scormTarget: "none", sortOrder: 0,
    };
    storageMock.getScales.mockResolvedValue([scaleA]);
    storageMock.getQuestionMeasurements.mockResolvedValue([
      { id: "m1", testId: "test-1", questionId: "q1", scaleId: "sa", sourceType: "option", sourceKey: null, valueJson: 2, weight: null, conditionJson: null, sortOrder: 0 },
      { id: "m2", testId: "test-1", questionId: "q1", scaleId: "ORPHAN", sourceType: "option", sourceKey: "0", valueJson: 5, weight: 1, conditionJson: null, sortOrder: 1 },
    ]);
    storageMock.getQuestionsByIds.mockResolvedValue([{ id: "q1", type: "single" }]);
    const res = await request(makeApp()).post("/api/tests/test-1/scales/preview").send({ answers: { q1: 0 } });
    expect(res.status).toBe(200);
    expect(res.body.values.aa).toBeDefined();
  });
});
