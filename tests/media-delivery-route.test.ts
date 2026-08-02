/**
 * @module tests/media-delivery-route
 * @description Delivery replaces the public static mount. Four behaviours carry the
 * design: the permission rule decides, a byte range is honoured (audio/video seeking),
 * a matching ETag answers 304, and the cache is private so a shared proxy cannot hand one
 * learner's file to another.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import { Readable } from "node:stream";

const { storageMock, storeMock, accessMock } = vi.hoisted(() => ({
  storageMock: { getMediaAsset: vi.fn(), getUser: vi.fn() },
  storeMock: { openRead: vi.fn(), stat: vi.fn() },
  accessMock: { canDeliverAsset: vi.fn() },
}));
vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/services/media/media-store", () => ({ mediaStore: storeMock }));
vi.mock("../server/services/media/asset-access", () => ({
  canDeliverAsset: accessMock.canDeliverAsset,
  clearAssetAccessCache: vi.fn(),
}));
vi.mock("../server/middleware/auth", () => ({
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../server/services/access", () => ({
  getEffectiveRoles: vi.fn().mockResolvedValue(["learner"]),
}));

import mediaRouter from "../server/routes/media";

const ASSET = {
  id: "a1", checksum: "c".repeat(64), storageKey: "media/aa/bb/x.png",
  mimeType: "image/png", byteSize: 10, kind: "image", originalName: "pic.png",
  ownerId: "author-1", visibility: "shared",
};

function makeApp() {
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { session: Record<string, unknown> }).session = { userId: "learner-1" };
    next();
  });
  app.use("/api/media", mediaRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getMediaAsset.mockResolvedValue(ASSET);
  storageMock.getUser.mockResolvedValue({ id: "learner-1", status: "active" });
  storeMock.stat.mockResolvedValue({ byteSize: 10 });
  // Mirrors the real fs-backed store: a ranged read yields ONLY that slice (fs.createReadStream
  // with {start, end}), never the full object — otherwise the route's Content-Length (computed
  // from the range) would lie about the piped byte count and corrupt the response framing.
  storeMock.openRead.mockImplementation(async (_key: string, range?: { start: number; end: number }) => {
    const full = Buffer.from("0123456789");
    return Readable.from([range ? full.subarray(range.start, range.end + 1) : full]);
  });
  accessMock.canDeliverAsset.mockResolvedValue(true);
});

describe("GET /api/media/:id", () => {
  it("delivers the file with a private cache and an ETag", async () => {
    const res = await request(makeApp()).get("/api/media/a1");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    expect(res.headers["cache-control"]).toContain("private");
    expect(res.headers["etag"]).toBe(`"${"c".repeat(64)}"`);
  });

  it("refuses when the rule says no", async () => {
    accessMock.canDeliverAsset.mockResolvedValue(false);
    const res = await request(makeApp()).get("/api/media/a1");
    expect(res.status).toBe(403);
  });

  it("answers 404 for an unknown id", async () => {
    storageMock.getMediaAsset.mockResolvedValue(undefined);
    const res = await request(makeApp()).get("/api/media/nope");
    expect(res.status).toBe(404);
  });

  it("refuses an anonymous request", async () => {
    const app = express();
    app.use((req, _res, next) => {
      (req as unknown as { session: Record<string, unknown> }).session = {};
      next();
    });
    app.use("/api/media", mediaRouter);
    const res = await request(app).get("/api/media/a1");
    expect(res.status).toBe(401);
  });

  it("answers 304 when the ETag matches", async () => {
    const res = await request(makeApp()).get("/api/media/a1").set("If-None-Match", `"${"c".repeat(64)}"`);
    expect(res.status).toBe(304);
  });

  it("honours a byte range", async () => {
    const res = await request(makeApp()).get("/api/media/a1").set("Range", "bytes=2-4");
    expect(res.status).toBe(206);
    expect(res.headers["content-range"]).toBe("bytes 2-4/10");
    expect(storeMock.openRead).toHaveBeenCalledWith("media/aa/bb/x.png", { start: 2, end: 4 });
  });

  it("answers 416 when the requested range starts past the end", async () => {
    const res = await request(makeApp()).get("/api/media/a1").set("Range", "bytes=999999-");
    expect(res.status).toBe(416);
    expect(res.headers["content-range"]).toBe("bytes */10");
  });
});
