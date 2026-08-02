/**
 * @module tests/it/media-repository
 * @description Registry queries against a real schema: dedup lookup is scoped to the
 * owner (two authors with identical bytes get two rows), and usage rows for one entity
 * are replaced wholesale on re-sync.
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
import { MediaRepository } from "../../server/storage/media-repository";

let repo: MediaRepository;

beforeAll(async () => {
  h.current = await createHarness();
  repo = new MediaRepository();
});
afterAll(async () => {
  await h.current!.close();
});
beforeEach(async () => {
  await h.current!.reset();
});

/** Minimal insert payload; only the fields a test cares about vary. */
function asset(overrides: Partial<Parameters<MediaRepository["createAsset"]>[0]> = {}) {
  return {
    checksum: "a".repeat(64),
    storageKey: "media/aa/aa/" + "a".repeat(64) + ".png",
    mimeType: "image/png",
    byteSize: 10,
    kind: "image" as const,
    originalName: "pic.png",
    ownerId: "u1",
    visibility: "shared" as const,
    ...overrides,
  };
}

describe("MediaRepository", () => {
  it("finds an existing asset by owner and checksum", async () => {
    const created = await repo.createAsset(asset());
    const found = await repo.findAssetByOwnerChecksum("u1", "a".repeat(64));
    expect(found?.id).toBe(created.id);
  });

  it("keeps owners apart: identical bytes give two rows", async () => {
    await repo.createAsset(asset({ ownerId: "u1" }));
    await repo.createAsset(asset({ ownerId: "u2" }));
    expect(await repo.findAssetByOwnerChecksum("u2", "a".repeat(64))).toBeDefined();
    expect(await repo.countAssetsByChecksum("a".repeat(64))).toBe(2);
  });

  it("replaces the usage rows of one entity", async () => {
    const a = await repo.createAsset(asset());
    await repo.replaceUsages("question", "q1", [{ assetId: a.id, field: "mediaUrl" }]);
    await repo.replaceUsages("question", "q1", [{ assetId: a.id, field: "data.options.0.image" }]);
    const usages = await repo.getUsagesByAsset(a.id);
    expect(usages).toHaveLength(1);
    expect(usages[0].field).toBe("data.options.0.image");
  });

  it("lists orphan assets", async () => {
    const used = await repo.createAsset(asset({ checksum: "b".repeat(64) }));
    const orphan = await repo.createAsset(asset({ checksum: "c".repeat(64) }));
    await repo.replaceUsages("question", "q1", [{ assetId: used.id, field: "mediaUrl" }]);
    const orphans = await repo.listOrphanAssets();
    expect(orphans.map((o) => o.id)).toEqual([orphan.id]);
  });

  it("finds a legacy backfilled asset by null owner and checksum", async () => {
    const created = await repo.createAsset(asset({ ownerId: null }));
    const found = await repo.findAssetByOwnerChecksum(null, "a".repeat(64));
    expect(found?.id).toBe(created.id);
    // A real owner with the same bytes must NOT match the legacy bucket.
    expect(await repo.findAssetByOwnerChecksum("u1", "a".repeat(64))).toBeUndefined();
  });

  it("deletes an asset and reports false for an unknown id", async () => {
    const created = await repo.createAsset(asset());
    expect(await repo.deleteAsset(created.id)).toBe(true);
    expect(await repo.getAsset(created.id)).toBeUndefined();
    expect(await repo.deleteAsset(created.id)).toBe(false);
  });

  it("deleteUsagesExcept drops one type's stale rows and leaves everything else alone", async () => {
    const a = await repo.createAsset(asset());
    await repo.replaceUsages("question", "q-gone", [{ assetId: a.id, field: "mediaUrl" }]);
    await repo.replaceUsages("question", "q-live", [{ assetId: a.id, field: "mediaUrl" }]);
    await repo.replaceUsages("content_page", "p1", [{ assetId: a.id, field: "body" }]);

    await repo.deleteUsagesExcept("question", ["q-live"]);

    const remaining = await repo.getUsagesByAsset(a.id);
    // The stale question row is gone, the live question's row survives, and the
    // content-page row (a different entity type, untouched by this call) is
    // unaffected — the cleanup is scoped to ONE type per call.
    expect(remaining).toHaveLength(2);
    expect(remaining.map((u) => `${u.entityType}:${u.entityId}`).sort()).toEqual([
      "content_page:p1",
      "question:q-live",
    ]);
  });

  it("deleteUsagesExcept with an empty keep list drops every row of that type", async () => {
    const a = await repo.createAsset(asset());
    await repo.replaceUsages("question", "q1", [{ assetId: a.id, field: "mediaUrl" }]);
    await repo.replaceUsages("content_page", "p1", [{ assetId: a.id, field: "body" }]);

    await repo.deleteUsagesExcept("question", []);

    const remaining = await repo.getUsagesByAsset(a.id);
    expect(remaining.map((u) => u.entityType)).toEqual(["content_page"]);
  });

  it("deleteUsagesExcept scales past a small keep list (single array-typed bind parameter)", async () => {
    // Guards against the shape that hits Postgres's 65535-parameter cap on a prepared
    // statement (server/storage/media-repository.ts JSDoc) — `keepIds` must travel as
    // ONE bind parameter (`<> ALL($1)`), not one per id like `inArray` would build.
    // A few thousand ids is enough to prove the query shape scales without needing a
    // slow test that actually approaches the real cap.
    const a = await repo.createAsset(asset());
    const keepIds = Array.from({ length: 5000 }, (_, i) => `q-${i}`);
    for (const id of keepIds.slice(0, 3)) {
      await repo.replaceUsages("question", id, [{ assetId: a.id, field: "mediaUrl" }]);
    }
    await repo.replaceUsages("question", "q-gone", [{ assetId: a.id, field: "mediaUrl" }]);

    await repo.deleteUsagesExcept("question", keepIds);

    const remaining = await repo.getUsagesByAsset(a.id);
    expect(remaining.map((u) => u.entityId).sort()).toEqual(["q-0", "q-1", "q-2"]);
  });

  it("lists assets scoped to one owner", async () => {
    await repo.createAsset(asset({ ownerId: "u1", checksum: "b".repeat(64) }));
    await repo.createAsset(asset({ ownerId: "u2", checksum: "c".repeat(64) }));
    const mine = await repo.listAssetsByOwner("u1");
    expect(mine).toHaveLength(1);
    expect(mine[0].ownerId).toBe("u1");
  });

  it("resolves an asset by its storage key", async () => {
    const created = await repo.createAsset(asset({ storageKey: "media/zz/zz/key.png" }));
    const found = await repo.getAssetByStorageKey("media/zz/zz/key.png");
    expect(found?.id).toBe(created.id);
  });

  it("swallows a duplicate reference inside one replaceUsages call", async () => {
    const a = await repo.createAsset(asset());
    // Two identical (assetId, field) refs in the same batch would violate the
    // composite PK without onConflictDoNothing().
    await expect(
      repo.replaceUsages("question", "q1", [
        { assetId: a.id, field: "mediaUrl" },
        { assetId: a.id, field: "mediaUrl" },
      ]),
    ).resolves.not.toThrow();
    expect(await repo.getUsagesByAsset(a.id)).toHaveLength(1);
  });
});
