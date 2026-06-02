/**
 * @module tests/routes.result-variables
 * @description Integration tests for the result-variable API (PRD-2, A5):
 * GET/POST/PUT/DELETE /api/tests/:id/result-variables,
 * PUT .../reorder and POST .../validate-formula.
 *
 * Covers authorization (401/403), test-existence (404), zod field validation
 * (422), the controls_status single-controller rule (422), formula validity
 * (422) and the happy-path CRUD/reorder/validate lifecycle.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getTest: vi.fn(),
    getUser: vi.fn(),
    getResultVariables: vi.fn(),
    createResultVariable: vi.fn(),
    updateResultVariable: vi.fn(),
    deleteResultVariable: vi.fn(),
    reorderResultVariables: vi.fn(),
    validateResultVariableFormula: vi.fn(),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import resultVariablesRouter from "../server/routes/result-variables";

// ─── App factory ──────────────────────────────────────────────────────────────

function makeApp(role: "author" | "learner" | null = "author") {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (role) req.session.userId = "user-1";
    next();
  });
  app.use("/api/tests", resultVariablesRouter);
  return app;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const baseTest = { id: "test-1", title: "Test" };
const authorUser = { id: "user-1", role: "author", status: "active" };
const learnerUser = { id: "user-1", role: "learner", status: "active" };

const validBody = {
  name: "pass_score",
  label: "Зачёт",
  type: "boolean",
  formula: "percent >= 50",
  showToLearner: true,
  scormTarget: "both",
  controlsStatus: "none",
};

const savedVar = {
  id: "rv-1",
  testId: "test-1",
  ...validBody,
  sortOrder: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const okValidation = { valid: true, returnType: "boolean", errors: [], warnings: [] };
const badValidation = {
  valid: false,
  errors: [{ message: "Неизвестная функция countScale", position: 1 }],
  warnings: [],
};

// ─── GET ──────────────────────────────────────────────────────────────────────

describe("GET /api/tests/:id/result-variables", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getTest.mockResolvedValue(baseTest);
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getResultVariables.mockResolvedValue([savedVar]);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(makeApp(null)).get("/api/tests/test-1/result-variables");
    expect(res.status).toBe(401);
  });

  it("returns 404 when test not found", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await request(makeApp()).get("/api/tests/missing/result-variables");
    expect(res.status).toBe(404);
  });

  it("returns the list of variables", async () => {
    const res = await request(makeApp()).get("/api/tests/test-1/result-variables");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("pass_score");
  });
});

// ─── POST ─────────────────────────────────────────────────────────────────────

describe("POST /api/tests/:id/result-variables", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getTest.mockResolvedValue(baseTest);
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getResultVariables.mockResolvedValue([]);
    storageMock.validateResultVariableFormula.mockResolvedValue(okValidation);
    storageMock.createResultVariable.mockResolvedValue(savedVar);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(makeApp(null)).post("/api/tests/test-1/result-variables").send(validBody);
    expect(res.status).toBe(401);
  });

  it("returns 403 when user is a learner", async () => {
    storageMock.getUser.mockResolvedValue(learnerUser);
    const res = await request(makeApp("learner")).post("/api/tests/test-1/result-variables").send(validBody);
    expect(res.status).toBe(403);
  });

  it("returns 404 when test not found", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await request(makeApp()).post("/api/tests/missing/result-variables").send(validBody);
    expect(res.status).toBe(404);
  });

  it("returns 422 when the name violates the grammar", async () => {
    const res = await request(makeApp())
      .post("/api/tests/test-1/result-variables")
      .send({ ...validBody, name: "Bad Name" });
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("name");
    expect(storageMock.createResultVariable).not.toHaveBeenCalled();
  });

  it("returns 422 when another variable already controls the same status", async () => {
    storageMock.getResultVariables.mockResolvedValue([
      { ...savedVar, id: "rv-other", controlsStatus: "success" },
    ]);
    const res = await request(makeApp())
      .post("/api/tests/test-1/result-variables")
      .send({ ...validBody, controlsStatus: "success" });
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("controlsStatus");
  });

  it("returns 422 when the formula is invalid", async () => {
    storageMock.validateResultVariableFormula.mockResolvedValue(badValidation);
    const res = await request(makeApp()).post("/api/tests/test-1/result-variables").send(validBody);
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("formula");
  });

  it("creates the variable and echoes the validation result", async () => {
    const res = await request(makeApp()).post("/api/tests/test-1/result-variables").send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.id).toBe("rv-1");
    expect(res.body.validation.valid).toBe(true);
    expect(storageMock.createResultVariable).toHaveBeenCalledTimes(1);
  });
});

// ─── PUT /:varId ────────────────────────────────────────────────────────────

describe("PUT /api/tests/:id/result-variables/:varId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getTest.mockResolvedValue(baseTest);
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getResultVariables.mockResolvedValue([savedVar]);
    storageMock.validateResultVariableFormula.mockResolvedValue(okValidation);
    storageMock.updateResultVariable.mockResolvedValue({ ...savedVar, label: "Новая метка" });
  });

  it("returns 404 when the variable does not exist", async () => {
    const res = await request(makeApp())
      .put("/api/tests/test-1/result-variables/missing")
      .send({ label: "x" });
    expect(res.status).toBe(404);
  });

  it("returns 422 when the merged formula is invalid", async () => {
    storageMock.validateResultVariableFormula.mockResolvedValue(badValidation);
    const res = await request(makeApp())
      .put("/api/tests/test-1/result-variables/rv-1")
      .send({ formula: "countScale()" });
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("formula");
  });

  it("updates the variable", async () => {
    const res = await request(makeApp())
      .put("/api/tests/test-1/result-variables/rv-1")
      .send({ label: "Новая метка" });
    expect(res.status).toBe(200);
    expect(res.body.label).toBe("Новая метка");
    expect(storageMock.updateResultVariable).toHaveBeenCalledWith("rv-1", { label: "Новая метка" });
  });
});

// ─── DELETE /:varId ───────────────────────────────────────────────────────────

describe("DELETE /api/tests/:id/result-variables/:varId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getTest.mockResolvedValue(baseTest);
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getResultVariables.mockResolvedValue([savedVar]);
    storageMock.deleteResultVariable.mockResolvedValue(undefined);
  });

  it("returns 404 when the variable does not exist", async () => {
    const res = await request(makeApp()).delete("/api/tests/test-1/result-variables/missing");
    expect(res.status).toBe(404);
  });

  it("deletes the variable", async () => {
    const res = await request(makeApp()).delete("/api/tests/test-1/result-variables/rv-1");
    expect(res.status).toBe(200);
    expect(storageMock.deleteResultVariable).toHaveBeenCalledWith("rv-1");
  });
});

// ─── reorder ──────────────────────────────────────────────────────────────────

describe("PUT /api/tests/:id/result-variables/reorder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getTest.mockResolvedValue(baseTest);
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.reorderResultVariables.mockResolvedValue(undefined);
  });

  it("returns 422 when the body is not an array", async () => {
    const res = await request(makeApp())
      .put("/api/tests/test-1/result-variables/reorder")
      .send({ nope: true });
    expect(res.status).toBe(422);
  });

  it("reorders the variables", async () => {
    const updates = [
      { id: "rv-1", sortOrder: 1 },
      { id: "rv-2", sortOrder: 0 },
    ];
    const res = await request(makeApp())
      .put("/api/tests/test-1/result-variables/reorder")
      .send(updates);
    expect(res.status).toBe(200);
    expect(storageMock.reorderResultVariables).toHaveBeenCalledWith(updates);
  });
});

// ─── validate-formula ─────────────────────────────────────────────────────────

describe("POST /api/tests/:id/result-variables/validate-formula", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getTest.mockResolvedValue(baseTest);
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.validateResultVariableFormula.mockResolvedValue(okValidation);
  });

  it("returns 422 when formula is missing", async () => {
    const res = await request(makeApp())
      .post("/api/tests/test-1/result-variables/validate-formula")
      .send({ type: "boolean" });
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("formula");
  });

  it("returns the validation result", async () => {
    const res = await request(makeApp())
      .post("/api/tests/test-1/result-variables/validate-formula")
      .send({ formula: "percent >= 50", type: "boolean" });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.returnType).toBe("boolean");
  });
});
