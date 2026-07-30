/**
 * @module tests/routes.report
 * @description Guards the endpoints that let the WEB host build the attempt report.
 *
 * The report is generated in the browser by `shared/report/*` — the same generator the
 * SCORM package runs. The browser gets the two package-only ingredients from here: the
 * vendored rasterizer/PDF writer and the report's background plates + logo. Both are
 * allowlisted by name, so a caller cannot walk out of the asset directory.
 */
import { describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";
import reportRouter from "../server/routes/report";
import { REPORT_BACKGROUND_FILES, REPORT_LOGO_FILE } from "../shared/report/export-pdf";

const app = express();
// A signed-in learner: the router's own gate only checks that a session exists.
app.use((req, _res, next) => {
  (req as unknown as { session: { userId: string } }).session = { userId: "u1" };
  next();
});
app.use("/api/report", reportRouter);

const anonApp = express();
anonApp.use((req, _res, next) => {
  (req as unknown as { session: Record<string, unknown> }).session = {};
  next();
});
anonApp.use("/api/report", reportRouter);

describe("GET /api/report/lib/:file", () => {
  it("serves the vendored libraries the report pipeline needs", async () => {
    for (const file of ["html2canvas.min.js", "jspdf.umd.min.js"]) {
      const res = await request(app).get(`/api/report/lib/${file}`);
      expect(res.status, file).toBe(200);
      expect(res.headers["content-type"]).toContain("text/javascript");
      // Real library payloads, not an error page.
      expect(res.text.length).toBeGreaterThan(10000);
    }
  });

  it("exposes the globals the shared export expects", async () => {
    const jspdf = await request(app).get("/api/report/lib/jspdf.umd.min.js");
    expect(jspdf.text).toContain("jspdf");
    const h2c = await request(app).get("/api/report/lib/html2canvas.min.js");
    expect(h2c.text).toContain("html2canvas");
  });

  it("serves nothing outside the allowlist", async () => {
    for (const bad of ["app.js", "..%2F..%2Fpackage.json", "runtime.js"]) {
      const res = await request(app).get(`/api/report/lib/${bad}`);
      expect(res.status, bad).toBe(404);
    }
  });
});

describe("GET /api/report/asset/:file", () => {
  it("serves every plate and the logo the shared module asks for", async () => {
    for (const file of [...REPORT_BACKGROUND_FILES, REPORT_LOGO_FILE]) {
      const res = await request(app).get(`/api/report/asset/${file}`);
      expect(res.status, file).toBe(200);
      expect(res.headers["content-type"]).toBe("image/png");
      expect(res.body.length).toBeGreaterThan(1000);
    }
  });

  it("serves nothing outside the allowlist", async () => {
    for (const bad of ["logo-dark.png", "..%2F..%2F.env", "pdf-bg-4.png"]) {
      const res = await request(app).get(`/api/report/asset/${bad}`);
      expect(res.status, bad).toBe(404);
    }
  });

  it("caches immutably — the learner pays for the plates once", async () => {
    const res = await request(app).get(`/api/report/asset/${REPORT_LOGO_FILE}`);
    expect(res.headers["cache-control"]).toContain("immutable");
  });
});

describe("report ingredients require a session", () => {
  it("rejects an anonymous caller", async () => {
    expect((await request(anonApp).get("/api/report/lib/jspdf.umd.min.js")).status).toBe(401);
    expect((await request(anonApp).get(`/api/report/asset/${REPORT_LOGO_FILE}`)).status).toBe(401);
  });
});
