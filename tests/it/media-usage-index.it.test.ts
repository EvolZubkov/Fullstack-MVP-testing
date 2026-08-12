/**
 * @module tests/it/media-usage-index
 * @description syncEntityUsages through the REAL facade against pglite: catches a
 * facade/repository method-name or signature drift that the mock-based unit suite
 * (tests/media-usage-index.test.ts) cannot see, since that suite mocks server/storage
 * wholesale.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { createHarness, type Harness } from "./db-harness";

const h = vi.hoisted(() => ({ current: null as Harness | null }));
vi.mock("../../server/db", () => ({
  get db() {
    if (!h.current) throw new Error("harness not initialized");
    return h.current.db;
  },
}));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { storage } from "../../server/storage";
// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { syncEntityUsages } from "../../server/services/media/usage-index";

beforeAll(async () => {
  h.current = await createHarness();
});
afterAll(async () => {
  await h.current!.close();
});
beforeEach(async () => {
  await h.current!.reset();
});

describe("syncEntityUsages — through the real facade against pglite", () => {
  it("writes a resolvable reference and reads it back via the asset", async () => {
    const asset = await storage.createMediaAsset({
      checksum: "a".repeat(64),
      storageKey: "media/aa/aa/" + "a".repeat(64) + ".png",
      mimeType: "image/png",
      byteSize: 10,
      kind: "image",
      originalName: "pic.png",
      ownerId: "u1",
      visibility: "shared",
    });

    await syncEntityUsages("question", "q1", { mediaUrl: `/api/media/${asset.id}` });

    const usages = await storage.getMediaUsagesByAsset(asset.id);
    expect(usages).toHaveLength(1);
    expect(usages[0].entityId).toBe("q1");
    expect(usages[0].field).toBe("mediaUrl");
  });

  it("resolves a legacy address through the storage key", async () => {
    const asset = await storage.createMediaAsset({
      checksum: "b".repeat(64),
      storageKey: "media/1717_legacy.png",
      mimeType: "image/png",
      byteSize: 7,
      kind: "image",
      originalName: "1717_legacy.png",
      ownerId: null,
      visibility: "shared",
    });

    await syncEntityUsages("content_page", "p1", { body: "/uploads/media/1717_legacy.png" });

    const usages = await storage.getMediaUsagesByAsset(asset.id);
    expect(usages).toHaveLength(1);
    expect(usages[0].entityType).toBe("content_page");
  });

  it("drops an unresolvable legacy reference instead of writing a dangling row", async () => {
    await syncEntityUsages("question", "q2", { mediaUrl: "/uploads/media/gone.png" });
    expect(await storage.getMediaUsagesByAsset("00000000-0000-0000-0000-000000000000")).toHaveLength(0);
  });
});
