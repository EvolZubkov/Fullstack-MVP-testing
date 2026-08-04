/**
 * @module tests/media-backfill
 * @description The one-off indexing of pre-registry files. Owner is unknowable (the old
 * file name carried none), so rows land in the legacy bucket with a null owner. Two files
 * with identical bytes must collapse into ONE legacy row, otherwise the null-owner bucket
 * accumulates duplicates the unique index cannot catch.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    findMediaAssetByOwnerChecksum: vi.fn(),
    createMediaAsset: vi.fn(),
  },
}));
vi.mock("../server/storage", () => ({ storage: storageMock }));

import { backfillMediaRegistry } from "../scripts/db/backfill-media-registry";

let root: string;

beforeEach(() => {
  vi.clearAllMocks();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "backfill-"));
  fs.mkdirSync(path.join(root, "media"), { recursive: true });
  storageMock.findMediaAssetByOwnerChecksum.mockResolvedValue(undefined);
  storageMock.createMediaAsset.mockImplementation(async (a) => ({ id: "new", ...a }));
});

describe("backfillMediaRegistry", () => {
  it("indexes a file into the legacy bucket", async () => {
    fs.writeFileSync(path.join(root, "media", "1717_a.png"), "hello");
    const report = await backfillMediaRegistry(root);
    expect(report.created).toBe(1);
    expect(storageMock.createMediaAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: null,
        visibility: "shared",
        kind: "image",
        originalName: "1717_a.png",
        storageKey: "media/1717_a.png",
      }),
    );
  });

  it("collapses identical bytes into one legacy row", async () => {
    fs.writeFileSync(path.join(root, "media", "one.png"), "same");
    fs.writeFileSync(path.join(root, "media", "two.png"), "same");
    const report = await backfillMediaRegistry(root);
    expect(report.created).toBe(1);
    expect(report.skipped).toBe(1);
  });

  it("skips a file already in the registry", async () => {
    fs.writeFileSync(path.join(root, "media", "known.png"), "hello");
    storageMock.findMediaAssetByOwnerChecksum.mockResolvedValue({ id: "existing" });
    const report = await backfillMediaRegistry(root);
    expect(report.created).toBe(0);
    expect(report.skipped).toBe(1);
  });
});
