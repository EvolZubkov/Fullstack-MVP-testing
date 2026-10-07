/**
 * @module tests/routes.analytics-scales
 * @description PRD-56 FR-21c, FR-21f: the route of the «Шкалы и показатели» tab.
 *
 * The summaries are tested with their functions; here — what belongs to the route: both halves
 * come in one answer, and the page filter narrows BOTH of them to the runs it selects.
 */
import express from "express";
import session from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { storageMock, loadObservations } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUserRoles: vi.fn(),
    getTest: vi.fn(),
    getTests: vi.fn().mockResolvedValue([]),
    getTestIdsByOwner: vi.fn().mockResolvedValue([]),
    getUserTestGrants: vi.fn().mockResolvedValue([]),
    getTestGrantForUser: vi.fn().mockResolvedValue(undefined),
    getScales: vi.fn(),
    getResultVariables: vi.fn(),
    selectScaleValuesForTest: vi.fn(),
    selectIndicatorValuesForTest: vi.fn(),
  },
  loadObservations: vi.fn(),
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/db", () => ({ db: {} }));
vi.mock("../server/services/analytics/observations", () => ({ loadObservations }));
vi.mock("../server/services/analytics/scale-ramp", () => ({ scaleRampOf: vi.fn().mockResolvedValue({}) }));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import scalesRouter from "../server/routes/analytics/scales";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    req.session.userId = "admin";
    next();
  });
  app.use("/api/analytics", scalesRouter);
  return app;
}

const ask = (query = "") => request(makeApp()).get(`/api/analytics/tests/test1/scales${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUser.mockResolvedValue({ id: "admin", name: "Админ", email: "a@b.c" });
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getTest.mockResolvedValue({ id: "test1", createdBy: "admin", designSettingsJson: {} });
  storageMock.getScales.mockResolvedValue([{ key: "focus", label: "Фокус", configJson: {} }]);
  storageMock.getResultVariables.mockResolvedValue([
    { name: "idx", label: "Индекс", type: "number", configJson: {}, sortOrder: 0 },
  ]);
  storageMock.selectScaleValuesForTest.mockResolvedValue([
    { attemptId: "a1", source: "web", values: { focus: 30 } },
    { attemptId: "a2", source: "telemetry", values: {} },
    { attemptId: "a3", source: "import", values: { focus: 10 } },
  ]);
  storageMock.selectIndicatorValuesForTest.mockResolvedValue([
    { attemptId: "a1", source: "web", values: { idx: 60 } },
    { attemptId: "a2", source: "telemetry", values: { idx: "40" } },
    { attemptId: "a3", source: "import", values: {} },
  ]);
  // Group g1 holds a1 and a2; without conditions the selection is all three.
  loadObservations.mockImplementation(async (filter: { groupIds?: string[] }) => ({
    rows: filter.groupIds?.includes("g1")
      ? [{ id: "a1" }, { id: "a2" }]
      : [{ id: "a1" }, { id: "a2" }, { id: "a3" }],
  }));
});

describe("GET /analytics/tests/:testId/scales", () => {
  it("answers with both scales and indicators over every run", async () => {
    const res = await ask();

    expect(res.status).toBe(200);
    expect(res.body.scales[0]).toMatchObject({ key: "focus", average: 20, sampleSize: 2 });
    expect(res.body.indicators[0]).toMatchObject({ name: "idx", average: 50, sampleSize: 2, missing: 1 });
    // A run counts when it holds a scale value OR an indicator value.
    expect(res.body.observations).toBe(3);
  });

  it("the page filter narrows scales and indicators alike", async () => {
    const res = await ask("?groupId=g1");

    expect(loadObservations).toHaveBeenCalledWith(
      expect.objectContaining({ groupIds: ["g1"], testIds: ["test1"] }),
      expect.anything(),
    );
    expect(res.body.scales[0]).toMatchObject({ average: 30, sampleSize: 1 });
    expect(res.body.indicators[0]).toMatchObject({ average: 50, sampleSize: 2, missing: 0 });
    expect(res.body.observations).toBe(2);
  });

  it("answers 404 for an unknown test", async () => {
    storageMock.getTest.mockResolvedValue(undefined);

    const res = await ask();

    expect(res.status).toBe(404);
  });
});
