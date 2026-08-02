/**
 * @module tests/media-delete-route
 * @description Deleting a used file is refused with 409 and the list of places, mirroring
 * the PRD-15 content-guard. The physical bytes go only when the LAST registry row holding
 * that checksum goes — another author may own a row over the same content.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { storageMock, storeMock } = vi.hoisted(() => ({
  storageMock: {
    getMediaAsset: vi.fn(),
    getMediaUsagesByAsset: vi.fn(),
    deleteMediaAsset: vi.fn(),
    countMediaAssetsByChecksum: vi.fn(),
  },
  storeMock: { remove: vi.fn() },
}));
vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/services/media/media-store", () => ({ mediaStore: storeMock }));
vi.mock("../server/middleware/auth", () => ({
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../server/services/access", () => ({
  getEffectiveRoles: vi.fn().mockResolvedValue(["author"]),
}));

import mediaRouter from "../server/routes/media";

const ASSET = { id: "a1", checksum: "c".repeat(64), storageKey: "media/aa/bb/x.png", ownerId: "author-1" };

function makeApp() {
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { session: Record<string, unknown> }).session = { userId: "author-1" };
    next();
  });
  app.use("/api/media", mediaRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getMediaAsset.mockResolvedValue(ASSET);
  storageMock.getMediaUsagesByAsset.mockResolvedValue([]);
  storageMock.deleteMediaAsset.mockResolvedValue(true);
  storageMock.countMediaAssetsByChecksum.mockResolvedValue(0);
});

describe("DELETE /api/media/:id", () => {
  it("deletes an orphan and removes the bytes", async () => {
    const res = await request(makeApp()).delete("/api/media/a1");
    expect(res.status).toBe(200);
    expect(storeMock.remove).toHaveBeenCalledWith("media/aa/bb/x.png");
  });

  it("refuses a used asset with 409 and the list of places", async () => {
    storageMock.getMediaUsagesByAsset.mockResolvedValue([
      { assetId: "a1", entityType: "question", entityId: "q1", field: "mediaUrl" },
    ]);
    const res = await request(makeApp()).delete("/api/media/a1");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("media_in_use");
    expect(res.body.usages).toEqual([
      { entityType: "question", entityId: "q1", field: "mediaUrl" },
    ]);
    expect(storageMock.deleteMediaAsset).not.toHaveBeenCalled();
  });

  it("reports without deleting on a dry run", async () => {
    const res = await request(makeApp()).delete("/api/media/a1?dryRun=true");
    expect(res.status).toBe(200);
    expect(res.body.wouldDelete).toBe(true);
    expect(storageMock.deleteMediaAsset).not.toHaveBeenCalled();
  });

  it("keeps the bytes while another row holds the same checksum", async () => {
    storageMock.countMediaAssetsByChecksum.mockResolvedValue(1);
    const res = await request(makeApp()).delete("/api/media/a1");
    expect(res.status).toBe(200);
    expect(storeMock.remove).not.toHaveBeenCalled();
  });

  it("refuses a stranger", async () => {
    storageMock.getMediaAsset.mockResolvedValue({ ...ASSET, ownerId: "someone-else" });
    const res = await request(makeApp()).delete("/api/media/a1");
    expect(res.status).toBe(403);
  });
});
