/**
 * @module tests/media-legacy-alias
 * @description After the static mount is gone, addresses stored before the registry must
 * still resolve — through the registry, by storage key, with the permission rule applied.
 * Without this the switch-off breaks silently: a broken picture, not an error.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import { Readable } from "node:stream";

const { storageMock, storeMock, accessMock } = vi.hoisted(() => ({
  storageMock: { getMediaAssetByStorageKey: vi.fn(), getUser: vi.fn() },
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
  getEffectiveRoles: vi.fn().mockResolvedValue(["author"]),
}));

import { legacyUploadsAlias } from "../server/routes/media";

const ASSET = {
  id: "a1", checksum: "c".repeat(64), storageKey: "media/1717_old.png",
  mimeType: "image/png", byteSize: 3, originalName: "1717_old.png",
  ownerId: null, visibility: "shared",
};

function makeApp() {
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { session: Record<string, unknown> }).session = { userId: "author-1" };
    next();
  });
  app.use("/uploads", legacyUploadsAlias);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getMediaAssetByStorageKey.mockResolvedValue(ASSET);
  storageMock.getUser.mockResolvedValue({ id: "author-1", status: "active" });
  storeMock.stat.mockResolvedValue({ byteSize: 3 });
  storeMock.openRead.mockImplementation(async () => Readable.from([Buffer.from("abc")]));
  accessMock.canDeliverAsset.mockResolvedValue(true);
});

describe("legacy /uploads/media alias", () => {
  it("resolves a pre-registry address through the registry", async () => {
    const res = await request(makeApp()).get("/uploads/media/1717_old.png");
    expect(res.status).toBe(200);
    expect(storageMock.getMediaAssetByStorageKey).toHaveBeenCalledWith("media/1717_old.png");
  });

  it("applies the permission rule to the legacy address too", async () => {
    accessMock.canDeliverAsset.mockResolvedValue(false);
    const res = await request(makeApp()).get("/uploads/media/1717_old.png");
    expect(res.status).toBe(403);
  });

  it("answers 404 for a file that was never indexed", async () => {
    storageMock.getMediaAssetByStorageKey.mockResolvedValue(undefined);
    const res = await request(makeApp()).get("/uploads/media/ghost.png");
    expect(res.status).toBe(404);
  });
});
