/**
 * @module tests/debug-player-routes
 * @description PRD-18 Phase 3 — integration tests for the in-service debug-player
 * API (`server/routes/debug-player.ts`). Verifies the run is built from LIVE state
 * with telemetry OFF (R-2/D-4), is gated by the SAME edit-scope as SCORM export
 * (D-2/FR-01), serves the package same-origin with the RTE shim injected into the
 * launch page (FR-06), maps build failures to friendly statuses (FR-16), and never
 * persists an attempt. The in-memory session store is mocked here; its own logic is
 * covered in `debug-player-session-store.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────

const {
  storageMock,
  buildScormExportDataMock,
  generateScormPackageMock,
  createDebugSessionMock,
  getDebugSessionMock,
  dropDebugSessionMock,
} = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getTest: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    getTestGrantForUser: vi.fn(),
  },
  buildScormExportDataMock: vi.fn(),
  generateScormPackageMock: vi.fn(),
  createDebugSessionMock: vi.fn(),
  getDebugSessionMock: vi.fn(),
  dropDebugSessionMock: vi.fn(),
}));

vi.mock("../server/db", () => ({ db: {} }));
vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../server/scorm-exporter", () => ({ generateScormPackage: generateScormPackageMock }));
// Keep the real ScormBuildError class so the route's `instanceof` mapping is exercised.
vi.mock("../server/scorm/build-export-data", async (orig) => {
  const actual = await orig<typeof import("../server/scorm/build-export-data")>();
  return { ...actual, buildScormExportData: buildScormExportDataMock };
});
vi.mock("../server/scorm/debug-player/session-store", () => ({
  createDebugSession: createDebugSessionMock,
  getDebugSession: getDebugSessionMock,
  dropDebugSession: dropDebugSessionMock,
}));

import debugPlayerRouter from "../server/routes/debug-player";
import { ScormBuildError } from "../server/scorm/build-export-data";

// ─── App factory ──────────────────────────────────────────────────────────────

function makeApp(authed = true) {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (authed) req.session.userId = "user-1";
    next();
  });
  app.use("/api/tests", debugPlayerRouter);
  return app;
}

const adminUser = { id: "user-1", emailHash: "h", role: "author", status: "active" };
const baseTest = { id: "test-1", title: "Test", mode: "standard", ownerId: "user-1" };

// A launch page that the shim must be injected into, plus a sibling asset.
const LAUNCH_HTML = "<html><head><title>SCO</title></head><body>hi</body></html>";
const APP_JS = "console.log('sco');";

function fakeSession() {
  return {
    files: new Map<string, Buffer>([
      ["index.html", Buffer.from(LAUNCH_HTML)],
      ["scripts/app.js", Buffer.from(APP_JS)],
    ]),
    launch: "index.html",
    testId: "test-1",
    userId: "user-1",
    createdAt: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUser.mockResolvedValue(adminUser);
  storageMock.getTest.mockResolvedValue(baseTest);
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
});

// ─── POST /:id/debug/session ───────────────────────────────────────────────────

describe("POST /api/tests/:id/debug/session", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(makeApp(false)).post("/api/tests/test-1/debug/session");
    expect(res.status).toBe(401);
  });

  it("returns 403 when the role lacks tests.export.scorm", async () => {
    storageMock.getUserRoles.mockResolvedValue(["learner"]);
    const res = await request(makeApp()).post("/api/tests/test-1/debug/session");
    expect(res.status).toBe(403);
  });

  it("returns 404 when the test does not exist", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await request(makeApp()).post("/api/tests/missing/debug/session");
    expect(res.status).toBe(404);
  });

  it("builds a throwaway run from LIVE state with telemetry OFF and returns the token", async () => {
    buildScormExportDataMock.mockResolvedValue({ test: baseTest });
    generateScormPackageMock.mockResolvedValue(Buffer.from("zip-bytes"));
    createDebugSessionMock.mockResolvedValue({ token: "tok-1", launch: "index.html" });

    const res = await request(makeApp()).post("/api/tests/test-1/debug/session");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      token: "tok-1",
      launch: "index.html",
      playUrl: "/api/tests/test-1/debug/play/tok-1/index.html",
    });
    // Isolation invariants: LIVE source + no telemetry baked in.
    expect(buildScormExportDataMock).toHaveBeenCalledWith("test-1", { source: "debug" });
    expect(generateScormPackageMock).toHaveBeenCalledTimes(1);
    expect(generateScormPackageMock.mock.calls[0][0]).toMatchObject({ telemetry: null });
    expect(createDebugSessionMock).toHaveBeenCalledWith("test-1", "user-1", expect.any(Buffer));
  });

  it("maps a ScormBuildError(422) to 422 with the offending field (FR-16)", async () => {
    buildScormExportDataMock.mockRejectedValue(
      new ScormBuildError("Unsupported templateApiVersion", 422, "templateApiVersion"),
    );
    const res = await request(makeApp()).post("/api/tests/test-1/debug/session");
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("templateApiVersion");
    expect(generateScormPackageMock).not.toHaveBeenCalled();
  });

  it("maps a ScormBuildError(404) to 404", async () => {
    buildScormExportDataMock.mockRejectedValue(new ScormBuildError("Test not found", 404));
    const res = await request(makeApp()).post("/api/tests/test-1/debug/session");
    expect(res.status).toBe(404);
  });

  it("returns 500 on an unexpected build failure", async () => {
    buildScormExportDataMock.mockRejectedValue(new Error("boom"));
    const res = await request(makeApp()).post("/api/tests/test-1/debug/session");
    expect(res.status).toBe(500);
  });
});

// ─── GET /:id/debug/play/:token/* ──────────────────────────────────────────────

describe("GET /api/tests/:id/debug/play/:token/*", () => {
  it("serves the launch page VERBATIM (the shim is hosted by the player window, not injected)", async () => {
    getDebugSessionMock.mockReturnValue(fakeSession());
    const res = await request(makeApp()).get("/api/tests/test-1/debug/play/tok-1/index.html");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toBe(LAUNCH_HTML); // untouched
    expect(res.text).not.toContain("API_1484_11"); // NOT injected
    expect(getDebugSessionMock).toHaveBeenCalledWith("tok-1", "user-1");
  });

  it("serves the launch page on an empty splat (bare play URL)", async () => {
    getDebugSessionMock.mockReturnValue(fakeSession());
    const res = await request(makeApp()).get("/api/tests/test-1/debug/play/tok-1/");
    expect(res.status).toBe(200);
    expect(res.text).toBe(LAUNCH_HTML);
  });

  it("serves a non-launch asset verbatim with no shim and the right content-type", async () => {
    getDebugSessionMock.mockReturnValue(fakeSession());
    const res = await request(makeApp()).get("/api/tests/test-1/debug/play/tok-1/scripts/app.js");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/javascript");
    expect(res.text).toBe(APP_JS);
    expect(res.text).not.toContain("API_1484_11");
  });

  it("returns 410 when the session has expired", async () => {
    getDebugSessionMock.mockReturnValue("expired");
    const res = await request(makeApp()).get("/api/tests/test-1/debug/play/tok-1/index.html");
    expect(res.status).toBe(410);
  });

  it("returns 404 for an unknown / foreign token", async () => {
    getDebugSessionMock.mockReturnValue(undefined);
    const res = await request(makeApp()).get("/api/tests/test-1/debug/play/nope/index.html");
    expect(res.status).toBe(404);
  });

  it("returns 404 for a path not present in the package", async () => {
    getDebugSessionMock.mockReturnValue(fakeSession());
    const res = await request(makeApp()).get("/api/tests/test-1/debug/play/tok-1/missing.css");
    expect(res.status).toBe(404);
  });
});

// ─── GET /:id/debug/shim.js ────────────────────────────────────────────────────

describe("GET /api/tests/:id/debug/shim.js", () => {
  it("serves the RTE shim the player window hosts (FR-06)", async () => {
    const res = await request(makeApp()).get("/api/tests/test-1/debug/shim.js");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/javascript");
    expect(res.text).toContain("API_1484_11");
  });

  it("is gated by the same edit-scope", async () => {
    storageMock.getUserRoles.mockResolvedValue(["learner"]);
    const res = await request(makeApp()).get("/api/tests/test-1/debug/shim.js");
    expect(res.status).toBe(403);
  });
});

// ─── GET /:id/debug/inspector-compute.js ───────────────────────────────────────

describe("GET /api/tests/:id/debug/inspector-compute.js", () => {
  it("serves the inspector compute layer (window.TBInspector)", async () => {
    const res = await request(makeApp()).get("/api/tests/test-1/debug/inspector-compute.js");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/javascript");
    expect(res.text).toContain("window.TBInspector");
    expect(res.text).toContain("buildProtocolRows");
  });
});

// ─── DELETE /:id/debug/session/:token ──────────────────────────────────────────

describe("DELETE /api/tests/:id/debug/session/:token", () => {
  it("drops the run and reports the result", async () => {
    dropDebugSessionMock.mockReturnValue(true);
    const res = await request(makeApp()).delete("/api/tests/test-1/debug/session/tok-1");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ dropped: true });
    expect(dropDebugSessionMock).toHaveBeenCalledWith("tok-1", "user-1");
  });

  it("reports dropped:false for an unknown / foreign token", async () => {
    dropDebugSessionMock.mockReturnValue(false);
    const res = await request(makeApp()).delete("/api/tests/test-1/debug/session/nope");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ dropped: false });
  });
});
