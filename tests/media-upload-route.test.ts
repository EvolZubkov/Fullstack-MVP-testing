/**
 * @module tests/media-upload-route
 * @description Upload now writes a registry row and answers with the CANONICAL address.
 * Re-uploading the same bytes by the same author returns the SAME asset instead of a
 * second row. The response keeps its old field names — the editor reads `url`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { storageMock, storeMock } = vi.hoisted(() => ({
  storageMock: {
    createMediaAsset: vi.fn(),
    findMediaAssetByOwnerChecksum: vi.fn(),
  },
  storeMock: { putFile: vi.fn() },
}));
vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/services/media/media-store", () => ({ mediaStore: storeMock }));

import mediaRouter from "../server/routes/media";

/**
 * Mini app with a logged-in session. No default value on purpose: JS default
 * parameters substitute whenever the argument is `undefined`, whether passed
 * explicitly or omitted — a default here would make `makeApp(undefined)` silently
 * behave like `makeApp("author-1")` and defeat the anonymous-session test below.
 */
function makeApp(userId: string | undefined) {
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { session: Record<string, unknown> }).session = userId ? { userId } : {};
    next();
  });
  app.use("/api/media", mediaRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  storeMock.putFile.mockResolvedValue({
    storageKey: "media/ab/cd/" + "a".repeat(64) + ".png",
    checksum: "a".repeat(64),
    byteSize: 5,
  });
});

describe("POST /api/media/upload", () => {
  it("creates a registry row and answers with the canonical address", async () => {
    storageMock.findMediaAssetByOwnerChecksum.mockResolvedValue(undefined);
    storageMock.createMediaAsset.mockResolvedValue({ id: "asset-1", mimeType: "image/png", byteSize: 5 });

    const res = await request(makeApp("author-1"))
      .post("/api/media/upload")
      .attach("file", Buffer.from("hello"), { filename: "pic.png", contentType: "image/png" });

    expect(res.status).toBe(200);
    expect(res.body.url).toBe("/api/media/asset-1");
    expect(res.body.id).toBe("asset-1");
    expect(res.body.originalName).toBe("pic.png");
    expect(storageMock.createMediaAsset).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "image", ownerId: "author-1", checksum: "a".repeat(64) }),
    );
  });

  it("returns the existing asset when the same author re-uploads the same bytes", async () => {
    storageMock.findMediaAssetByOwnerChecksum.mockResolvedValue({
      id: "asset-old", mimeType: "image/png", byteSize: 5,
    });

    const res = await request(makeApp("author-1"))
      .post("/api/media/upload")
      .attach("file", Buffer.from("hello"), { filename: "pic.png", contentType: "image/png" });

    expect(res.status).toBe(200);
    expect(res.body.url).toBe("/api/media/asset-old");
    expect(storageMock.createMediaAsset).not.toHaveBeenCalled();
  });

  it("accepts a PDF as a document", async () => {
    storageMock.findMediaAssetByOwnerChecksum.mockResolvedValue(undefined);
    storageMock.createMediaAsset.mockResolvedValue({ id: "asset-2", mimeType: "application/pdf", byteSize: 5 });

    const res = await request(makeApp("author-1"))
      .post("/api/media/upload")
      .attach("file", Buffer.from("%PDF-"), { filename: "memo.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(200);
    expect(storageMock.createMediaAsset).toHaveBeenCalledWith(expect.objectContaining({ kind: "document" }));
  });

  it("refuses an anonymous upload", async () => {
    const res = await request(makeApp(undefined))
      .post("/api/media/upload")
      .attach("file", Buffer.from("hello"), { filename: "pic.png", contentType: "image/png" });
    expect(res.status).toBe(401);
  });

  it("returns the winning asset when a concurrent upload got there first", async () => {
    storageMock.findMediaAssetByOwnerChecksum
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: "asset-race", mimeType: "image/png", byteSize: 5 });
    storageMock.createMediaAsset.mockRejectedValue(Object.assign(new Error("duplicate key"), { code: "23505" }));

    const res = await request(makeApp("author-1"))
      .post("/api/media/upload")
      .attach("file", Buffer.from("hello"), { filename: "pic.png", contentType: "image/png" });

    expect(res.status).toBe(200);
    expect(res.body.url).toBe("/api/media/asset-race");
  });
});
