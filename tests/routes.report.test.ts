/**
 * @module tests/routes.report
 * @description Guards the endpoints that let the WEB host build the attempt report.
 *
 * The report is generated in the browser by `shared/report/*` — the same generator the
 * SCORM package runs. What the browser needs from here is the package-only pair of
 * libraries (rasterizer + PDF writer), allowlisted by name so a caller cannot walk out
 * of the asset directory. The report's PICTURES are NOT served here since PRD-27 FR-05:
 * they belong to the template and travel through `/api/templates/:id/assets/*`.
 */
import { describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";
import reportRouter from "../server/routes/report";
import { readBinaryAsset } from "../server/scorm/assets/read-asset";

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

  it("caches immutably — the learner pays for the libraries once", async () => {
    const res = await request(app).get("/api/report/lib/jspdf.umd.min.js");
    expect(res.headers["cache-control"]).toContain("immutable");
  });
});

describe("картинки отчёта здесь больше не живут (PRD-27 FR-05)", () => {
  it("прежний ассетный роут отдаёт 404: подложка и логотип — файлы шаблона", async () => {
    for (const file of ["pdf-bg-1.png", "logo-light.png"]) {
      const res = await request(app).get(`/api/report/asset/${file}`);
      expect(res.status, file).toBe(404);
    }
  });
});

describe("report ingredients require a session", () => {
  it("rejects an anonymous caller", async () => {
    expect((await request(anonApp).get("/api/report/lib/jspdf.umd.min.js")).status).toBe(401);
  });
});

describe("readBinaryAsset", () => {
  it("возвращает байты существующего ассета пакета", () => {
    expect(readBinaryAsset("media/logo-dark.png")?.length).toBeGreaterThan(1000);
  });

  it("возвращает null, а не бросает, когда файла нет ни по одному из путей", () => {
    expect(readBinaryAsset("media/does-not-exist.png")).toBeNull();
  });
});
